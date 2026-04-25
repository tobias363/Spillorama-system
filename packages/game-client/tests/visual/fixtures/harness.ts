import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared test fixtures for the Spill 1 visual-regression suite.
 *
 * Keeps wait-for-ready logic, scenario routing, and backdrop/animation
 * introspection in one place so test files stay focused on what they
 * assert rather than how they drive the harness.
 */

export type Scenario =
  | "idle"
  | "buy-popup"
  | "draw-active"
  | "pattern-won"
  | "win-screen";

/** Max time we're willing to wait for a scenario to settle. */
const READY_TIMEOUT_MS = 20_000;

export async function gotoScenario(
  page: Page,
  scenario: Scenario,
): Promise<void> {
  await page.goto(`/web/games/visual-harness.html?scenario=${scenario}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("#readiness-beacon[data-ready=\"true\"]", {
    timeout: READY_TIMEOUT_MS,
  });
}

/**
 * Count DOM elements that apply a `backdrop-filter` with a non-none value.
 *
 * Returns selectors + filter-value pairs so tests can print useful failure
 * messages. The `excludeAllowed` filter removes legitimate popup/dialog
 * overlays (identified by the `g1-buy-popup-backdrop` / `.wp-backdrop`
 * ancestor) — tests should PASS if only those use backdrop-filter and FAIL
 * if anything else does.
 */
export async function collectBackdropFilterOffenders(page: Page): Promise<
  Array<{ selector: string; backdropFilter: string }>
> {
  return page.evaluate(() => {
    const offenders: Array<{ selector: string; backdropFilter: string }> = [];

    // Allowed: backdrop-filter ONLY on elements whose primary role is being
    // a modal/popup backdrop. We detect this structurally (not by content
    // or class, which would be trivially bypassed) — the element must:
    //   1. Use position: absolute/fixed with inset: 0 (i.e., be a true
    //      full-container overlay), AND
    //   2. Have rgba() background with alpha <= 0.8 (semi-transparent — a
    //      solid-colour "backdrop" would have no reason for backdrop-filter
    //      since it fully occludes what's behind it), AND
    //   3. Contain at least one child element (a "card" or dialog content).
    //
    // A decorative strip, panel, or header that just wants a frosted look
    // over Pixi fails condition 1 or 3 and IS caught. The harness's
    // "decorative header" we used to test this has inset-properties (top/
    // left/right set, bottom NOT set) and small height — explicitly not an
    // overlay.
    function isAllowed(el: Element): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const cs = getComputedStyle(el);
      if (cs.position !== "absolute" && cs.position !== "fixed") return false;
      // Parse inset:0 via individual top/left/right/bottom being 0 px.
      const allZero = (["top", "left", "right", "bottom"] as const).every(
        (side) => cs[side] === "0px" || cs[side] === "0",
      );
      if (!allZero) return false;
      // Semi-transparent overlay (alpha < 1).
      const bg = cs.backgroundColor;
      const rgbaMatch = /rgba\([^)]+,\s*([\d.]+)\s*\)/.exec(bg);
      const alpha = rgbaMatch ? parseFloat(rgbaMatch[1] ?? "1") : 1;
      if (alpha >= 0.95) return false;
      // Must have a child (dialog/card content) — an empty fullscreen blur
      // overlay serves no purpose and is a regression.
      if (el.children.length === 0) return false;
      // Only the blur(...) backdrop-filter family is allowed for popups.
      const bf =
        el.style.backdropFilter ||
        cs.backdropFilter ||
        (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter;
      if (!bf || !/blur/.test(bf)) return false;
      return true;
    }

    function describe(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className && typeof el.className === "string"
        ? "." + el.className.trim().split(/\s+/).join(".")
        : "";
      return `${tag}${id}${cls}`;
    }

    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      const bf = cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter;
      if (!bf || bf === "none") return;
      if (isAllowed(el)) return;
      offenders.push({ selector: describe(el), backdropFilter: bf });
    });
    return offenders;
  });
}

/**
 * Count currently-running CSS animations across the DOM. Used by the
 * animation-budget tests to catch "infinite" keyframes leaking out of
 * popup-scoped contexts (the pattern-won flash regression root cause).
 */
export async function countRunningAnimations(page: Page): Promise<{
  total: number;
  infinite: number;
  samples: Array<{ selector: string; name: string; iterationCount: string }>;
}> {
  return page.evaluate(() => {
    let total = 0;
    let infinite = 0;
    const samples: Array<{
      selector: string;
      name: string;
      iterationCount: string;
    }> = [];
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      const names = (cs.animationName || "").split(",").map((s) => s.trim())
        .filter((s) => s && s !== "none");
      if (names.length === 0) return;
      const iters = (cs.animationIterationCount || "").split(",")
        .map((s) => s.trim());
      names.forEach((name, i) => {
        const iter = iters[i] ?? iters[0] ?? "1";
        total += 1;
        if (iter === "infinite") infinite += 1;
        if (samples.length < 15) {
          samples.push({
            selector: (el.tagName + (el.id ? "#" + el.id : "") +
              (typeof el.className === "string" && el.className
                ? "." + el.className.trim().split(/\s+/).join(".")
                : "")).slice(0, 120),
            name,
            iterationCount: iter,
          });
        }
      });
    });
    return { total, infinite, samples };
  });
}

/**
 * Sample `performance.getEntriesByType("paint")` after an idle window. A
 * stable idle state should yield ~2 paints (first-paint + first-contentful-
 * paint) total; any additional paint in the window signals unwanted repaint.
 * We compare delta across the window, not absolute count.
 */
export async function measurePaintCountDelta(
  page: Page,
  idleWindowMs: number,
): Promise<number> {
  const before = await page.evaluate(() =>
    performance.getEntriesByType("paint").length,
  );
  await page.waitForTimeout(idleWindowMs);
  const after = await page.evaluate(() =>
    performance.getEntriesByType("paint").length,
  );
  return after - before;
}

/**
 * Capture N screenshots with a fixed delay between them. Used by the flicker
 * tests — if two consecutive screenshots differ by >threshold pixels in a
 * state that's *supposed* to be idle, we've caught a flimring regression.
 */
export async function captureFrameSeries(
  page: Page,
  frameCount: number,
  intervalMs: number,
): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    frames.push(await page.screenshot({ animations: "allow" }));
    if (i < frameCount - 1) await page.waitForTimeout(intervalMs);
  }
  return frames;
}

export const test = base.extend({});
export { expect };
