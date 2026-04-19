import { Assets } from "pixi.js";

/**
 * BIN-673: Pre-warm Pixi's asset cache with critical game assets so the
 * `LOADING_ASSETS` phase of the mount-flow has a real promise to await.
 *
 * Without this, assets load lazily on first use (e.g. CenterBall.loadSprite
 * fires `Assets.load("center-ball.png")` the first time `showNumber` is
 * called). That produced brief blank-ball flashes when a user landed in a
 * fast-running round — CenterBall showed number text before the backdrop
 * finished decoding.
 *
 * Pre-warming also makes the `LOADING_ASSETS` UI state actually meaningful:
 * users on slow networks get explicit "Laster spill..." feedback instead
 * of an opaque "Syncer..." that only appears for late-joiners.
 *
 * The returned promise resolves when all listed assets have been loaded OR
 * failed (failures are caught and downgraded to warnings — a missing asset
 * shouldn't block game mount; components have their own fallbacks).
 *
 * Game 2/3/5 can register their own asset lists as separate arrays if
 * needed later; for now Game 1 is the only slug that uses explicit assets.
 */
const GAME1_CRITICAL_ASSETS = [
  "/web/games/assets/game1/center-ball.png",
];

/**
 * Pre-warm Pixi's asset cache. Resolves when every URL has settled
 * (loaded OR failed). Never rejects — failure of one asset is logged
 * but not propagated.
 */
export async function preloadGameAssets(gameSlug: string): Promise<void> {
  const urls = selectAssetsFor(gameSlug);
  if (urls.length === 0) return;

  const results = await Promise.allSettled(
    urls.map((url) => Assets.load(url)),
  );

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (r.status === "rejected") {
      console.warn(
        `[preloadGameAssets] failed to load ${urls[i]} — component fallback will handle it:`,
        r.reason,
      );
    }
  }
}

/**
 * Exposed for tests. Returns the asset-URL list for a given slug.
 */
export function selectAssetsFor(gameSlug: string): readonly string[] {
  if (gameSlug === "bingo" || gameSlug === "game_1") return GAME1_CRITICAL_ASSETS;
  // Game 2/3/5/6 currently generate their visuals procedurally — no
  // external assets to preload. Returning empty is fine; the preload
  // step no-ops and LOADING_ASSETS flashes briefly.
  return [];
}
