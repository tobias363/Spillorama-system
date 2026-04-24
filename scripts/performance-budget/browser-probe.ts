/**
 * Browser-side probe for the performance-budget collector.
 *
 * This module is **stringified** via `Function.prototype.toString()` and
 * injected into the Puppeteer page context. It therefore MUST:
 *   - Be a single top-level IIFE / function declaration set — no imports.
 *   - Avoid TypeScript-only constructs that V8 can't parse (interfaces,
 *     `satisfies`, `as const` at the expression position, generic arrows).
 *   - Attach its public API to `window.__perfBudget` so the Node-side
 *     collector can call it via `page.evaluate`.
 *
 * Pair with `collect-metrics.ts` which injects this at new-document
 * time and then calls `__perfBudget.measure({...})` during each
 * scenario.
 */

export const BROWSER_PROBE_SOURCE = `
(function () {
  if (window.__perfBudgetInstalled) return;
  window.__perfBudgetInstalled = true;

  var rafCount = 0;
  var originalRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    rafCount += 1;
    return originalRaf(cb);
  };

  var paintEntries = [];
  var loafEntries = [];

  // PerformanceObserver is Chrome-only for 'long-animation-frame'. We
  // try each entry type individually and swallow unsupported-type
  // errors so the probe still runs on non-Chrome engines.
  try {
    var po = new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.entryType === 'paint') paintEntries.push(entry);
        else if (entry.entryType === 'long-animation-frame') loafEntries.push(entry);
      }
    });
    var types = ['paint', 'long-animation-frame'];
    for (var t = 0; t < types.length; t++) {
      try { po.observe({ type: types[t], buffered: true }); } catch (e) { /* unsupported */ }
    }
  } catch (e) { /* no PerformanceObserver */ }

  function sampleDomMetrics() {
    var backdropFilterCount = 0;
    var cssAnimationCount = 0;
    var infiniteAnimationCount = 0;

    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      // Both the standard and -webkit- prefix are exposed across
      // browsers. Safari + old Chrome only have the prefixed form.
      var bf = style.getPropertyValue('backdrop-filter') ||
               style.getPropertyValue('-webkit-backdrop-filter');
      if (bf && bf !== 'none' && bf.trim() !== '') backdropFilterCount += 1;

      var anim = style.animationName;
      if (anim && anim !== 'none' && anim.trim() !== '') {
        cssAnimationCount += 1;
        if (style.animationIterationCount === 'infinite') infiniteAnimationCount += 1;
      }
    }

    return {
      backdropFilterCount: backdropFilterCount,
      cssAnimationCount: cssAnimationCount,
      infiniteAnimationCount: infiniteAnimationCount,
    };
  }

  async function measure(options) {
    await new Promise(function (r) { setTimeout(r, options.stabilizeMs); });

    rafCount = 0;
    paintEntries.length = 0;
    loafEntries.length = 0;

    var startedAt = performance.now();
    await new Promise(function (r) { setTimeout(r, options.measureMs); });
    var elapsedMs = performance.now() - startedAt;
    var elapsedSec = elapsedMs / 1000;

    var dom = sampleDomMetrics();

    // GSAP detection: preview.ts imports gsap but doesn't expose it on
    // window, so this typically returns -1 ("unmeasured"). A future
    // debug build could expose it for tighter budgeting.
    var gsapActiveTweens = -1;
    if (window.gsap && window.gsap.globalTimeline &&
        typeof window.gsap.globalTimeline.getChildren === 'function') {
      try {
        gsapActiveTweens = window.gsap.globalTimeline.getChildren(true, true, true).length;
      } catch (e) { gsapActiveTweens = -1; }
    }

    return {
      backdropFilterCount: dom.backdropFilterCount,
      cssAnimationCount: dom.cssAnimationCount,
      infiniteAnimationCount: dom.infiniteAnimationCount,
      rafCallsPerSec: Math.round(rafCount / elapsedSec),
      paintCountPer2s: Math.round((paintEntries.length * 2000) / elapsedMs),
      gsapActiveTweens: gsapActiveTweens,
      longAnimationFrames: loafEntries.length,
    };
  }

  window.__perfBudget = {
    sampleDomMetrics: sampleDomMetrics,
    measure: measure,
  };
})();
`;

/**
 * Keyed metrics emitted by the browser probe. Node-side consumers
 * import this type; the stringified IIFE above is the source of
 * truth for the numeric behaviour.
 */
export interface ScenarioMetrics {
  backdropFilterCount: number;
  cssAnimationCount: number;
  infiniteAnimationCount: number;
  rafCallsPerSec: number;
  paintCountPer2s: number;
  gsapActiveTweens: number;
  longAnimationFrames: number;
}

export const METRIC_KEYS: Array<keyof ScenarioMetrics> = [
  "backdropFilterCount",
  "cssAnimationCount",
  "infiniteAnimationCount",
  "rafCallsPerSec",
  "paintCountPer2s",
  "gsapActiveTweens",
  "longAnimationFrames",
];

export const METRIC_LABELS: Record<keyof ScenarioMetrics, string> = {
  backdropFilterCount: "backdrop-filter elements",
  cssAnimationCount: "CSS animations",
  infiniteAnimationCount: "infinite CSS animations",
  rafCallsPerSec: "requestAnimationFrame / sec",
  paintCountPer2s: "paint entries / 2s",
  gsapActiveTweens: "GSAP active tweens",
  longAnimationFrames: "long-animation-frames",
};
