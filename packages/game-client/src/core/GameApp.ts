import { Application, Container } from "pixi.js";
import { SpilloramaSocket } from "../net/SpilloramaSocket.js";
import { GameBridge } from "../bridge/GameBridge.js";
import { AudioManager } from "../audio/AudioManager.js";
import { createGame, registryReady, type GameController } from "../games/registry.js";
import { telemetry } from "../telemetry/Telemetry.js";
import { initSentry, captureClientMessage } from "../telemetry/Sentry.js";
import { LoadingOverlay } from "../components/LoadingOverlay.js";
import { WebGLContextGuard } from "./WebGLContextGuard.js";
import { playerPrefs } from "../storage/PlayerPrefs.js";

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

    // BIN-544: Trigger one-time Unity → web PlayerPrefs migration before any
    // consumer (AudioManager) reads localStorage. The migration is idempotent
    // so this is safe on every mount. First migration also populates
    // AudioManager's legacy keys so audio settings survive the cutover.
    const migrationInfo = playerPrefs.getMigrationInfo();
    if (migrationInfo.completedAt === null) {
      playerPrefs.has("markerDesign"); // force first-call migration
      const info = playerPrefs.getMigrationInfo();
      if (info.keysMigrated > 0) {
        telemetry.trackEvent("unity_prefs_migrated", {
          gameSlug: config.gameSlug,
          hallId: config.hallId,
          keysMigrated: info.keysMigrated,
        });
      }
    }

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
    void initSentry({
      release: "0.1.0",
      environment: import.meta.env.MODE,
      gameSlug: config.gameSlug,
      hallId: config.hallId,
      // accessToken is an opaque JWT; using it as the PII source keeps the
      // hash consistent across reconnects without needing the player id.
      playerId: config.accessToken,
    });
    telemetry.trackFunnelStep("game_loaded");

    // Create shared infrastructure
    this.socket = new SpilloramaSocket(config.serverUrl);
    this.bridge = new GameBridge(this.socket);
    this.audio = new AudioManager();

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
