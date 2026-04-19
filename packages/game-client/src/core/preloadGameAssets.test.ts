/**
 * preloadGameAssets tests (BIN-673).
 *
 * The helper is a thin wrapper around `Assets.load` — we verify the slug→
 * asset-list mapping + the Promise.allSettled semantics. Actual Pixi
 * asset loading is mocked because vitest's node env has no canvas.
 *
 * Run: `npm --prefix packages/game-client test -- --run preloadGameAssets`
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectAssetsFor, preloadGameAssets } from "./preloadGameAssets.js";

describe("selectAssetsFor (BIN-673)", () => {
  it("Game 1 slugs return center-ball.png", () => {
    expect(selectAssetsFor("bingo")).toContain("/web/games/assets/game1/center-ball.png");
    expect(selectAssetsFor("game_1")).toContain("/web/games/assets/game1/center-ball.png");
  });

  it("Game 2/3/5/6 slugs return empty list (procedural visuals)", () => {
    expect(selectAssetsFor("rocket")).toEqual([]);
    expect(selectAssetsFor("monsterbingo")).toEqual([]);
    expect(selectAssetsFor("spillorama")).toEqual([]);
    expect(selectAssetsFor("candy")).toEqual([]);
  });

  it("unknown slug returns empty list (no-op preload)", () => {
    expect(selectAssetsFor("future-game-v2")).toEqual([]);
  });
});

describe("preloadGameAssets (BIN-673)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops for slugs with empty asset list", async () => {
    // No throw, resolves quickly.
    await expect(preloadGameAssets("rocket")).resolves.toBeUndefined();
  });

  it("never rejects — failed loads are caught and logged as warnings", async () => {
    // Mock Pixi's Assets.load via dynamic import — replace the global one
    // with a rejecting stub. The helper uses Promise.allSettled so a
    // rejection should not propagate.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pixi = await import("pixi.js");
    const origLoad = pixi.Assets.load;
    pixi.Assets.load = vi.fn().mockRejectedValue(new Error("simulated network failure")) as typeof pixi.Assets.load;

    try {
      await expect(preloadGameAssets("bingo")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("failed to load"),
        expect.any(Error),
      );
    } finally {
      pixi.Assets.load = origLoad;
      warn.mockRestore();
    }
  });
});
