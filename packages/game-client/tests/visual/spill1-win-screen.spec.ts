import {
  test,
  expect,
  gotoScenario,
  collectBackdropFilterOffenders,
} from "./fixtures/harness";

/**
 * Full-house win screen — WinScreenV2 fullscreen overlay.
 *
 * WinScreenV2 stacks a sparkles layer, fountain-particle rAF loop,
 * count-up number text, and a radial gradient background. The fountain is
 * driven by `requestAnimationFrame` that cannot be paused by
 * `gsap.globalTimeline.pause()`, so per-frame particle positions differ
 * between capture moments — a pixel-diff snapshot is flaky by design.
 *
 * Instead we verify the STRUCTURAL invariants that matter for blink-
 * regression:
 *   1. No backdrop-filter outside the allowed popup/backdrop whitelist.
 *   2. The WinScreenV2 root element is rendered with position:fixed and
 *      fully covers the viewport (otherwise Pixi bleeds through during
 *      the initial fade-in — the classic "pattern-won flash" regression).
 *
 * A pixel-diff baseline IS committed for the win-popup (non-full-house,
 * spill1-pattern-won.spec.ts) which has fewer non-deterministic effects.
 */

test.describe("spill1 — full-house win screen (structural checks)", () => {
  test("no rogue backdrop-filter", async ({ page }) => {
    await gotoScenario(page, "win-screen");
    const offenders = await collectBackdropFilterOffenders(page);
    expect(
      offenders,
      `[win-screen] unexpected backdrop-filter: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  test("win-screen root fully covers viewport", async ({ page }, testInfo) => {
    await gotoScenario(page, "win-screen");
    const viewport = testInfo.project.use.viewport ?? { width: 1280, height: 720 };
    // WinScreenV2 sets its outer root to position: fixed; inset: 0 so the
    // Pixi canvas is fully occluded during the win celebration. If this
    // invariant breaks (e.g. someone changes the root to absolute or
    // shrinks it), Pixi can repaint through gaps and cause the classic
    // pattern-won flash.
    //
    // We find it by scanning direct children of <body> for the largest
    // position:fixed element; WinScreenV2 appends its root here directly.
    const coverage = await page.evaluate(() => {
      let best: { width: number; height: number; left: number; top: number } | null = null;
      const bodyChildren = Array.from(document.body.children);
      // Also check direct children of #game-container since the harness
      // mounts WinScreenV2 there.
      const container = document.getElementById("game-container");
      const candidates = bodyChildren.concat(
        container ? Array.from(container.children) : [],
      );
      candidates.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed") return;
        const r = el.getBoundingClientRect();
        if (r.width < window.innerWidth * 0.5) return; // ignore toasts etc.
        if (!best || r.width * r.height > best.width * best.height) {
          best = { width: r.width, height: r.height, left: r.left, top: r.top };
        }
      });
      return best;
    });
    expect(coverage, "no large position:fixed element found — WinScreenV2 root missing").not.toBeNull();
    // Use non-null assertion; expect() above guarantees it.
    const c = coverage as NonNullable<typeof coverage>;
    expect(c.left).toBeLessThanOrEqual(0);
    expect(c.top).toBeLessThanOrEqual(0);
    expect(c.width).toBeGreaterThanOrEqual(viewport.width);
    expect(c.height).toBeGreaterThanOrEqual(viewport.height);
  });
});
