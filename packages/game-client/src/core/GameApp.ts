import { Application, Container } from "pixi.js";
import { SpilloramaSocket } from "../net/SpilloramaSocket.js";
import { GameBridge } from "../bridge/GameBridge.js";
import { AudioManager } from "../audio/AudioManager.js";
import { createGame, registryReady, type GameController } from "../games/registry.js";
import { telemetry } from "../telemetry/Telemetry.js";

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

  constructor() {
    this.app = new Application();
    this.stage = this.app.stage;
  }

  async init(container: HTMLElement, config: GameMountConfig): Promise<void> {
    this.config = config;

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

    // Init telemetry
    telemetry.init({
      gameSlug: config.gameSlug,
      hallId: config.hallId,
      releaseVersion: "0.1.0",
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
  }

  getConfig(): GameMountConfig | null {
    return this.config;
  }

  destroy(): void {
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
}
