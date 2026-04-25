import {
  test,
  expect,
  gotoScenario,
  collectBackdropFilterOffenders,
  countRunningAnimations,
  measurePaintCountDelta,
} from "./fixtures/harness";

/**
 * Blink-budget invariants — these run on multiple scenarios and fail
 * IMMEDIATELY on any backdrop-filter offender, any idle-paint explosion,
 * or any excessive animation leak.
 *
 * The reason we have this file in addition to per-scenario snapshot tests
 * is that pixel-diff tests can pass when the flicker is sub-pixel (e.g.
 * a 1-frame composite at low alpha), while these structural tests catch
 * the CAUSE regardless of how visible the flicker is in a single frame.
 *
 * This is the agent-equivalent of the "no backdrop-filter over Pixi-canvas"
 * invariant the PM fought for in the 2026-04-24 chrome-devtools analysis.
 */

const SCENARIOS_TO_BUDGET = ["idle", "buy-popup", "draw-active"] as const;

test.describe("blink budget — backdrop-filter", () => {
  for (const scenario of SCENARIOS_TO_BUDGET) {
    test(`no rogue backdrop-filter (${scenario})`, async ({ page }) => {
      await gotoScenario(page, scenario);
      const offenders = await collectBackdropFilterOffenders(page);
      expect(
        offenders,
        `[${scenario}] Unexpected backdrop-filter elements found. ` +
          `Only popup/dialog backdrops are allowed. ` +
          `Offenders:\n${JSON.stringify(offenders, null, 2)}`,
      ).toEqual([]);
    });
  }
});

test.describe("blink budget — animation count", () => {
  test("idle has few running animations", async ({ page }) => {
    await gotoScenario(page, "idle");
    const { total, infinite, samples } = await countRunningAnimations(page);
    // Idle state budget: max 10 simultaneous CSS animations, max 3 infinite.
    // Higher than expected means an overlay/panel leaked an animation into
    // the baseline idle scene.
    expect(
      total,
      `[idle] too many animations (${total}). Samples:\n${JSON.stringify(samples, null, 2)}`,
    ).toBeLessThanOrEqual(10);
    expect(infinite, `[idle] too many infinite animations (${infinite}).`)
      .toBeLessThanOrEqual(3);
  });

  test("buy-popup has few running animations", async ({ page }) => {
    await gotoScenario(page, "buy-popup");
    const { total, infinite, samples } = await countRunningAnimations(page);
    // Buy popup budget: popup itself adds 2-3 animations (hover states,
    // button gradient) — total 12, infinite 3 is the ceiling.
    expect(
      total,
      `[buy-popup] too many animations (${total}). Samples:\n${JSON.stringify(samples, null, 2)}`,
    ).toBeLessThanOrEqual(12);
    expect(infinite, `[buy-popup] too many infinite animations (${infinite}).`)
      .toBeLessThanOrEqual(3);
  });
});

test.describe("blink budget — paint count", () => {
  test("idle produces few paints in a 2s window", async ({ page }) => {
    await gotoScenario(page, "idle");
    // Let the page fully settle (scenario-side markReady fires at 300ms after
    // first RAF, so wait a generous 500ms more for any DOM-style flush).
    await page.waitForTimeout(500);
    const delta = await measurePaintCountDelta(page, 2000);
    // Budget: 0-20 additional paints over a 2-second idle window. Healthy
    // Pixi apps plateau near 0 once the WebGL context stops scheduling new
    // draw calls. A runaway backdrop-filter + infinite-keyframe combo pushes
    // this into the hundreds (60 fps × 2 seconds = 120).
    expect(
      delta,
      `[idle] paint-count delta was ${delta} over 2s; budget is <=20. ` +
        `High counts usually indicate backdrop-filter or infinite keyframe leak.`,
    ).toBeLessThanOrEqual(20);
  });
});
