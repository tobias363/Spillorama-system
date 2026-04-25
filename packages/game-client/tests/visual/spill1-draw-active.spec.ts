import { test, expect, gotoScenario } from "./fixtures/harness";

/**
 * Draw-active state — ball tube populated, centre ball showing a number.
 *
 * Catches:
 *  - Ball sprite regressions (missing PNGs, wrong column-colour mapping).
 *  - Centre-ball size/position drift (this has broken 3 times in the last
 *    two months from layout refactors).
 *  - Pixi frame-loop issues where a stale texture paints behind a new one,
 *    manifesting as a one-frame flash.
 *
 * The harness loads balls synchronously (`loadBalls([7,23,42,58,72])`) and
 * sets the centre-ball number directly — no tween mid-capture.
 */

test.describe("spill1 — draw active", () => {
  test("matches committed baseline", async ({ page }) => {
    await gotoScenario(page, "draw-active");
    await expect(page).toHaveScreenshot("spill1-draw-active.png", {
      fullPage: false,
      animations: "disabled",
      // Ball PNGs are antialiased at scale; small sub-pixel differences
      // across GPU drivers are expected. 1% slack is generous but safe
      // because the layout test catches anything that actually moves.
      maxDiffPixelRatio: 0.01,
    });
  });
});
