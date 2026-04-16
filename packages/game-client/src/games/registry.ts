import type { GameApp } from "../core/GameApp.js";
import type { GameBridge } from "../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../net/SpilloramaSocket.js";
import type { AudioManager } from "../audio/AudioManager.js";

export interface GameController {
  start(): Promise<void>;
  destroy(): void;
}

export type GameFactory = (deps: GameDeps) => GameController;

export interface GameDeps {
  app: GameApp;
  bridge: GameBridge;
  socket: SpilloramaSocket;
  audio: AudioManager;
  roomCode: string;
  hallId: string;
}

const registry = new Map<string, GameFactory>();

export function registerGame(slug: string, factory: GameFactory): void {
  registry.set(slug, factory);
}

export function createGame(slug: string, deps: GameDeps): GameController | null {
  const factory = registry.get(slug);
  if (!factory) return null;
  return factory(deps);
}

// Game registrations (side-effect imports).
// Await this promise before calling createGame() to ensure all controllers are loaded.
export const registryReady: Promise<void> = Promise.all([
  import("./game1/Game1Controller.js").catch((e) => console.warn("[registry] game1 load failed:", e.message)),
  import("./game2/Game2Controller.js").catch((e) => console.warn("[registry] game2 load failed:", e.message)),
  import("./game3/Game3Controller.js").catch((e) => console.warn("[registry] game3 load failed:", e.message)),
  import("./game5/Game5Controller.js").catch((e) => console.warn("[registry] game5 load failed:", e.message)),
]).then(() => {});
