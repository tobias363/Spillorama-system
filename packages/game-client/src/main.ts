import { GameApp, type GameMountConfig } from "./core/GameApp.js";

let currentApp: GameApp | null = null;

/**
 * Mount the web game client into a container element.
 * Called by the web shell (lobby.js) when a player selects a game.
 */
export async function mountGame(
  container: HTMLElement,
  config: GameMountConfig,
): Promise<void> {
  // Tear down previous game if any
  if (currentApp) {
    currentApp.destroy();
    currentApp = null;
  }

  currentApp = new GameApp();
  await currentApp.init(container, config);
}

/**
 * Unmount the current game and clean up resources.
 * Called by the web shell when navigating back to lobby.
 */
export function unmountGame(): void {
  if (currentApp) {
    currentApp.destroy();
    currentApp = null;
  }
}

// Expose on window for dynamic import from lobby.js
(window as unknown as Record<string, unknown>).__spilloramaGameClient = {
  mountGame,
  unmountGame,
};

// Dev mode: auto-mount is handled by the dev lobby in index.html.
// The lobby logs in via /api/auth/login, gets a real accessToken,
// and calls mountGame() with correct hallId and credentials.
