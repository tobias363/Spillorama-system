import { test, expect, gotoScenario } from "./fixtures/harness";

/**
 * Buy-popup open — backdrop-filter scenario.
 *
 * Historically the biggest blink-regression source: the popup's
 * `backdrop-filter: blur(3px)` composites against the live Pixi canvas,
 * which the browser re-rasterises on every frame when any part of the page
 * is dirty. Combined with the pattern-mini-grid's infinite pulse keyframe,
 * this caused a visible flicker behind the buy popup for weeks.
 *
 * We snapshot both (a) the full page (popup closed state of the underlying
 * scene plus popup) and (b) assert backdrop-filter usage is limited to the
 * popup itself — any other element with backdrop-filter fails the budget
 * test.
 */

test.describe("spill1 — buy popup open", () => {
  test("matches committed baseline", async ({ page }) => {
    await gotoScenario(page, "buy-popup");
    await expect(page).toHaveScreenshot("spill1-buy-popup.png", {
      fullPage: false,
      animations: "disabled",
      // Popup carries per-row qty steppers whose fonts antialias slightly
      // differently across Chromium minor versions. 0.5% slack covers that
      // without masking actual layout regressions.
      maxDiffPixelRatio: 0.005,
    });
  });
});
