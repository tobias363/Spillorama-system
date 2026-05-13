import { Application, Container } from "pixi.js";
import { SpilloramaSocket } from "../net/SpilloramaSocket.js";
import { GameBridge } from "../bridge/GameBridge.js";
import { AudioManager } from "../audio/AudioManager.js";
import { createGame, registryReady, type GameController } from "../games/registry.js";
import { telemetry } from "../telemetry/Telemetry.js";
import { initSentry, captureClientMessage } from "../telemetry/Sentry.js";
import { bootstrapClientSentry } from "../observability/sentryBootstrap.js";
import { LoadingOverlay } from "../components/LoadingOverlay.js";
import { WebGLContextGuard } from "./WebGLContextGuard.js";
import { installDebugSuite, setDebugStateGetter, isDebugEnabled } from "../debug/index.js";

export interface GameMountConfig {
  gameSlug: string;
  accessToken: string;
  hallId: string;
  serverUrl: string;
}

/**
 * Wraps a PixiJS Application with Spillorama-specific lifecycle.
 * Creates shared infrastructure (socket, bridge, audio) and dispatches
 * to the correct game controller via the registry.
 */
export class GameApp {
  readonly app: Application;
  readonly stage: Container;
  private config: GameMountConfig | null = null;
  private socket: SpilloramaSocket | null = null;
  private bridge: GameBridge | null = null;
  private audio: AudioManager | null = null;
  private gameController: GameController | null = null;
  /** BIN-539: 30-second gap-metric watchdog. */
  private gapWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  /** BIN-542: WebGL context-loss recovery. */
  private contextGuard: WebGLContextGuard | null = null;
  private recoveryOverlay: LoadingOverlay | null = null;
  private container: HTMLElement | null = null;
  private restartInFlight = false;

  constructor() {
    this.app = new Application();
    this.stage = this.app.stage;
  }

  async init(container: HTMLElement, config: GameMountConfig): Promise<void> {
    this.config = config;
    this.container = container;

    // Store token for socket/api access
    if (config.accessToken) {
      sessionStorage.setItem("spillorama.accessToken", config.accessToken);
    }

    // Init PixiJS
    await this.app.init({
      resizeTo: container,
      background: 0x1a0a0a, // Dark maroon — matches Unity Spillorama
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // PIXI-P0-001 (Bølge 2A stopgap, 2026-04-28): Cap ticker to 60 fps.
    //
    // Pixi v8's default ticker runs uncapped, often at 90-144 fps on
    // high-refresh displays. Combined with persistent HTML overlays
    // z-stacked over the canvas, the GPU compositor races with Pixi's
    // render loop on every frame — visible to users as "blink". This
    // single line is the 30-min stopgap from the audit; per
    // GAME_CLIENT_PIXI_AUDIT_2026-04-28.md §"Refactor Roadmap" Phase 1
    // it eliminates ~80-90% of the remaining blink class on its own.
    //
    // The full fix (manual ticker start/stop driven by an animation-
    // lease registry — also called "Plan B" in
    // SPILL1_BLINK_ELIMINATION_RUNDE_7 §5) is deferred to Bølge 3.
    this.app.ticker.maxFPS = 60;

    container.appendChild(this.app.canvas);

    // BIN-542: Guard against WebGL context-loss (iOS Safari, low memory).
    // On loss: show overlay. On restored: destroy + re-init via onRestored.
    this.contextGuard = new WebGLContextGuard({
      canvas: this.app.canvas,
      gameSlug: config.gameSlug,
      hallId: config.hallId,
      onContextLost: () => this.handleContextLost(),
      onContextRestored: () => this.handleContextRestored(),
    });

    // Init telemetry + Sentry sidecar. Sentry is a no-op when
    // VITE_SENTRY_DSN is unset, so dev stays noise-free.
    telemetry.init({
      gameSlug: config.gameSlug,
      hallId: config.hallId,
      releaseVersion: "0.1.0",
    });
    // OBS-2 (2026-05-13): bootstrapClientSentry wires browserTracing +
    // Replay + user-context in one call. accessToken acts as the opaque
    // PII source (hashed before being sent) so the hashed id stays
    // consistent across reconnects without needing the raw player id.
    void bootstrapClientSentry({
      release: "0.1.0",
      gameSlug: config.gameSlug,
      hallId: config.hallId,
      playerId: config.accessToken,
    });
    // Backwards-compat: `initSentry` retains the same behavior so any
    // external consumer that imports it directly still works.
    void initSentry; // eslint-disable-line @typescript-eslint/no-unused-expressions
    telemetry.trackFunnelStep("game_loaded");

    // Create shared infrastructure
    this.socket = new SpilloramaSocket(config.serverUrl);
    this.bridge = new GameBridge(this.socket);
    this.audio = new AudioManager();

    // Debug suite (Fase 2B). Activation gate inside `installDebugSuite`
    // — when `?debug=1` (or localStorage flag) is missing, the call is a
    // no-op and tree-shakes nothing extra into the prod bundle. We
    // install BEFORE the controller starts so socket events the bridge
    // emits during start() are captured by the buffer.
    if (isDebugEnabled()) {
      const installed = installDebugSuite(this.socket, {
        gameSlug: config.gameSlug,
        hallId: config.hallId,
        // We only ever pass first-8 of accessToken upstream — never log
        // the full JWT.
        playerId: config.accessToken?.slice(0, 8),
      });
      if (installed) {
        // Register the bridge state-getter so HUD/inspector can read
        // current GameState. The bridge exposes `getState()` already.
        const bridgeRef = this.bridge;
        setDebugStateGetter(() => bridgeRef?.getState() ?? null);
      }
    }

    // Wait for all game controllers to be registered before creating one
    await registryReady;

    // Create and start game controller
    const roomCode = `BINGO1`; // Canonical room alias — backend resolves to hall-specific room
    this.gameController = createGame(config.gameSlug, {
      app: this,
      bridge: this.bridge,
      socket: this.socket,
      audio: this.audio,
      roomCode,
      hallId: config.hallId,
    });

    if (this.gameController) {
      try {
        await this.gameController.start();
      } catch (err) {
        console.error("[GameApp] Controller start failed:", err);
      }
    } else {
      console.warn("[GameApp] No game controller found for slug:", config.gameSlug);
    }

    // BIN-539: 30 seconds after mount, check whether GameBridge has seen any
    // drawIndex gaps. A gap means at least one draw:new arrived out of order
    // or was lost — BIN-502's resync should have handled it, but we still
    // want to know because a healthy pilot has gaps=0 on most sessions.
    this.gapWatchdogTimer = setTimeout(() => {
      const metrics = this.bridge?.getGapMetrics();
      if (metrics && metrics.gaps > 0) {
        captureClientMessage(
          `client_draw_gap: ${metrics.gaps} gaps, ${metrics.duplicates} duplicates, last=${metrics.lastAppliedDrawIndex}`,
          "warning",
        );
        telemetry.trackEvent("client_draw_gap", metrics);
      }
    }, 30_000);
  }

  getConfig(): GameMountConfig | null {
    return this.config;
  }

  destroy(): void {
    if (this.gapWatchdogTimer) {
      clearTimeout(this.gapWatchdogTimer);
      this.gapWatchdogTimer = null;
    }
    this.contextGuard?.destroy();
    this.contextGuard = null;
    this.recoveryOverlay?.destroy();
    this.recoveryOverlay = null;
    this.gameController?.destroy();
    this.gameController = null;
    this.bridge?.stop();
    this.bridge = null;
    this.socket?.disconnect();
    this.socket = null;
    this.audio?.destroy();
    this.audio = null;
    this.app.destroy(true, { children: true });
  }

  /**
   * BIN-542: Show recovery overlay when WebGL context is lost.
   * The PIXI canvas is frozen; we can't render anything on-canvas.
   * Use HTML overlay instead.
   */
  private handleContextLost(): void {
    if (!this.container) return;
    this.recoveryOverlay?.destroy();
    this.recoveryOverlay = new LoadingOverlay(this.container);
    this.recoveryOverlay.show("Gjenoppretter visning...");
  }

  /**
   * BIN-542: On context-restored, destroy + re-init the app. The existing
   * access token in sessionStorage + server-side room:state snapshot restores
   * the full game state via the normal late-join flow (SPECTATING + loader-
   * barrier + checkpoint recovery). `restartInFlight` prevents re-entrant
   * restarts if context is lost again during recovery.
   */
  private async handleContextRestored(): Promise<void> {
    if (this.restartInFlight || !this.container || !this.config) return;
    this.restartInFlight = true;

    const container = this.container;
    const config = this.config;

    try {
      // Tear down everything bound to the lost context.
      this.contextGuard?.destroy();
      this.contextGuard = null;
      this.gameController?.destroy();
      this.gameController = null;
      this.bridge?.stop();
      this.bridge = null;
      this.socket?.disconnect();
      this.socket = null;
      this.audio?.destroy();
      this.audio = null;

      // Replace the dead PIXI app with a fresh one. Can't reuse `this.app`
      // because its GL state is bound to the (now-disposed) lost context.
      this.app.destroy(true, { children: true });
      (this as { app: Application }).app = new Application();
      (this as { stage: Container }).stage = this.app.stage;

      // Re-run init. This re-attaches the guard, reconnects, re-subscribes,
      // and triggers the normal late-join flow.
      await this.init(container, config);
    } finally {
      this.restartInFlight = false;
      this.recoveryOverlay?.hide();
      this.recoveryOverlay?.destroy();
      this.recoveryOverlay = null;
    }
  }
}
