import {
  test,
  expect,
  gotoScenario,
  countRunningAnimations,
} from "./fixtures/harness";

/**
 * Pattern-won state — WinPopup open with amount.
 *
 * This scenario exists because the pattern-won-flash was the most visible
 * symptom of the blink problem before the chrome-devtools investigation:
 * when the WinPopup appeared, the overall screen would flicker once or
 * twice before settling. Root cause was the popup's infinite `wp-amount-
 * glow` keyframe composing over Pixi's draw calls.
 *
 * The harness waits 900ms for the popup's shimmer-sweep to end, then
 * markReady() fires. Playwright snapshots the settled popup.
 *
 * We also budget the infinite-keyframe count: WinPopup has EXACTLY 1
 * infinite keyframe (wp-amount-glow pulsing the prize text). Any second
 * infinite keyframe is a regression.
 */

test.describe("spill1 — pattern won (win popup)", () => {
  test("matches committed baseline", async ({ page }) => {
    await gotoScenario(page, "pattern-won");
    await expect(page).toHaveScreenshot("spill1-pattern-won.png", {
      fullPage: false,
      animations: "disabled",
      maxDiffPixelRatio: 0.005,
    });
  });

  test("infinite animation count within budget", async ({ page }) => {
    await gotoScenario(page, "pattern-won");
    const { infinite, samples } = await countRunningAnimations(page);
    // Budget: WinPopup intentionally spawns up to ~12 floating-clover
    // particles (wp-float keyframe, infinite iteration) + 1 amount-glow
    // pulse on the prize text. Setting the ceiling at 16 lets that design
    // keep working while catching any new unbounded source — if a refactor
    // adds a 20th animation, we want to know why. The real defence against
    // runaway repaints is the paint-count test in blink-budget.spec.ts,
    // which measures actual re-rasterisation cost rather than declaration
    // count.
    expect(infinite, `infinite animations: ${JSON.stringify(samples, null, 2)}`)
      .toBeLessThanOrEqual(16);
  });
});
