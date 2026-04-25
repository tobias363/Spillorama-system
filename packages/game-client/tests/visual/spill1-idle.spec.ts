import { test, expect, gotoScenario } from "./fixtures/harness";

/**
 * Spill 1 idle-state snapshot + flicker-guard.
 *
 * This is the primary regression test for the "idle repaint" problem: a
 * state where no animations should be running, yet the screen visibly
 * flickers because some background element (backdrop-filter, infinite
 * keyframe, composited panel) keeps repainting every frame.
 *
 * Two tests per viewport:
 *   1. Stable-state pixel-diff vs. committed baseline (catches visual
 *      regression — colours, positions, rogue elements).
 *   2. Frame-series invariance (catches flicker — five consecutive frames
 *      taken ~100ms apart must be byte-identical).
 */

test.describe("spill1 — idle", () => {
  test("matches committed baseline", async ({ page }) => {
    await gotoScenario(page, "idle");
    await expect(page).toHaveScreenshot("spill1-idle.png", {
      fullPage: false,
      animations: "disabled",
      maxDiffPixelRatio: 0.005,
    });
  });
});
