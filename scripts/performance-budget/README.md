# Spill 1 Performance Budget

Automated CI-gate that samples runtime performance of Spill 1 in a
headless Chromium on every PR, diffs the result against a checked-in
baseline, and fails CI when a tracked metric exceeds its budget.

## Motivation

On 2026-04-24 we discovered 12 stacked `backdrop-filter: blur()`
elements over the Pixi canvas in Spill 1, producing an estimated
~3 600 GPU shader operations per second (120 Hz display × 12 blurred
overlays × ~2.5 composited layers each). The symptom was persistent
visual flicker; the root cause was invisible to static CSS linting
because it only emerges at composite time. Agents had repeatedly
added or edited the CSS without anyone catching the compounding cost.

This tool exists so regressions of that shape fail CI automatically,
without relying on humans to spot them in review.

## How it works

1. **Static server** (`serve.ts`) — serves `apps/backend/public/` on
   a random loopback port, mirroring `app.use(express.static(publicDir))`
   in the real backend. The same HTML/CSS/JS ships to production.
2. **Headless Chromium** (`collect-metrics.ts` via Puppeteer) —
   navigates to `/web/games/preview.html`, drives the page into three
   scenarios, and samples metrics via an IIFE injected at
   new-document time.
3. **Browser probe** (`browser-probe.ts`) — installs a
   `requestAnimationFrame` monkey-patch and a `PerformanceObserver`
   for `paint` + `long-animation-frame` entries, then exposes
   `window.__perfBudget.measure({ stabilizeMs, measureMs })` for the
   Node-side collector.
4. **Comparison** (`compare.ts`) — loads `report.json` + `baseline.json`,
   produces a Markdown table, and exits 1 if any metric exceeds its
   `max`.
5. **CI workflow** (`.github/workflows/performance-budget.yml`) —
   uploads the report as an artifact, posts (or updates) a sticky PR
   comment, and fails the check-run when the budget is exceeded.

### Scenarios

| Scenario | What it measures |
|---|---|
| `spill1_idle` | Preview page loaded, all overlays hidden, Pixi canvases rendered. Baseline for "nothing should be animating". |
| `spill1_buy_popup` | Wheel trigger popup active over canvas. Catches the exact regression-shape the backdrop-filter bug took. |
| `spill1_during_draw` | Wheel mid-spin. Covers GSAP tweens + Pixi ticker running simultaneously. |

### Metrics

| Metric | Meaning | Why it matters |
|---|---|---|
| `backdropFilterCount` | Count of visible elements with `backdrop-filter ≠ none`. | Each compositing pass applies the blur to a GPU texture; stacking many is exponential. |
| `cssAnimationCount` | Elements with `animation-name ≠ none`. | Background CSS animations compound with any game-loop work on top. |
| `infiniteAnimationCount` | Subset of the above with `animation-iteration-count: infinite`. | These never stop until the element is removed — worst-case for the main thread. |
| `rafCallsPerSec` | Monkey-patched `requestAnimationFrame` calls over the measurement window. | Runaway tween loops push this far above display refresh rate. |
| `paintCountPer2s` | `PerformanceObserver` `paint` entries, normalised to a 2s window. | On a correctly idle Pixi canvas this is 0. |
| `gsapActiveTweens` | `window.gsap.globalTimeline.getChildren(…).length`, or `-1` if GSAP isn't exposed on window. | Direct signal of orphaned tweens left running. Currently unmeasured; marker reserved. |
| `longAnimationFrames` | Chrome 123+ `long-animation-frame` entries (>50ms). | Jank signal — fires on main-thread blocking during animations. |

## Developer workflow

From the repo root:

```bash
# Single pass: collect + compare + print colored report
npm run perf:check

# Collect only (writes report.json)
npm run perf:collect

# Compare only (requires a fresh report.json)
npm run perf:compare

# Refresh the committed baseline from the current HEAD
npm run perf:baseline
```

The first run downloads Puppeteer's pinned Chromium (~170 MB) to
`~/.cache/puppeteer`. Subsequent runs use the cache.

### Typical output

```
Spill 1 Performance Check

Scenario: spill1_idle
  backdrop-filter elements: 0 / 2  OK  (Δ 0)
  CSS animations: 0 / 5  OK  (Δ 0)
  infinite CSS animations: 0 / 1  OK  (Δ 0)
  requestAnimationFrame / sec: 210 / 500  OK  (Δ -10)
  paint entries / 2s: 0 / 30  OK  (Δ 0)
  GSAP active tweens: n/a / —  SKIP
  long-animation-frames: 0 / 2  OK  (Δ 0)

All within budget
```

`rafCallsPerSec` hovers around 200-400 on a clean preview because the page
hosts five independent Pixi.Application instances (one per overlay),
each running its own ticker. At 60Hz CI that aggregates to ~300; on a
120Hz dev display the same code reports ~600. The `max` values in
`baseline.json` carry ~2x headroom to tolerate that spread.

## Updating the baseline

**Do not update the baseline just to make CI pass.** The baseline is
the source of truth for "how Spill 1 should perform" — a drift upward
should trigger a design conversation, not a rubber-stamp.

### Legitimate baseline updates

- A new overlay is added (expect `backdropFilterCount` to rise by 1-2
  in the relevant scenarios).
- A refresh-rate-capped render loop is introduced intentionally
  (expect `rafCallsPerSec` to rise).
- Chrome adds a new `long-animation-frame` classification that
  surfaces existing behaviour (not a regression).

### Review protocol

1. Author runs `npm run perf:baseline` locally.
2. Author commits `scripts/performance-budget/baseline.json` alongside
   the source change that justifies it.
3. Reviewer looks at the `current` diff: is each rise explained by a
   corresponding source change? If not, request a rollback.
4. If the rise is genuine, approve. The `max` values are recomputed
   automatically via the policy in `collect-metrics.ts`
   (`budgetMax()`), but reviewers can tighten them manually by
   editing the JSON before merge.

## Debugging a failing PR

1. Pull the `performance-budget-report` artifact from the failing run.
2. Open `report.md` to see which metric failed in which scenario.
3. Run `npm run perf:check` locally against your branch. The colored
   terminal output should match the CI report within CI-runner
   variance.
4. Common regression shapes:
   - **`backdropFilterCount` rose** — you added a new
     `backdrop-filter` rule. Consider whether it can be replaced with
     a static translucent overlay, or whether the element can be
     removed from the stacking context above the Pixi canvas.
   - **`infiniteAnimationCount` rose** — you added a CSS animation
     with `animation-iteration-count: infinite`. Cap it at a finite
     count, or pause it when the element isn't visible.
   - **`rafCallsPerSec` rose** — a RAF loop is no longer cancelling
     on unmount. Check that every `requestAnimationFrame` has a
     matching `cancelAnimationFrame` in the teardown path.
   - **`paintCountPer2s` rose** — something on the main thread is
     invalidating layout. Check for newly-added `transition:` rules,
     animated box-shadows, or tall scroll-linked effects.

## Why Puppeteer, not Playwright or Lighthouse CI

- **Puppeteer vs Playwright** — Both would work. Puppeteer pins a
  single Chromium and has a smaller install footprint (Playwright
  downloads three browsers). The `evaluateOnNewDocument` +
  `page.evaluate` APIs we use exist in both; we pick Puppeteer for
  the lighter dependency surface.
- **vs Lighthouse CI cloud** — Lighthouse is excellent for
  page-load Core Web Vitals, but our regressions manifest as
  steady-state GPU/paint cost, not load-time metrics. Lighthouse
  doesn't expose per-element `backdrop-filter` counts.
- **vs Chromatic / Percy** — Visual-diff tools catch *look* regressions,
  not *performance* regressions. The backdrop-filter bug was visually
  acceptable; it was only the GPU cost that was unacceptable.

No cloud vendors. Only Puppeteer + GitHub Actions, both already in
use elsewhere in the repo.

## Files

- `browser-probe.ts` — Injected IIFE that installs the RAF counter
  and PerformanceObserver. Single source of truth for the in-browser
  measurement logic.
- `collect-metrics.ts` — Node-side collector (Puppeteer).
- `compare.ts` — Diff + Markdown/terminal renderers.
- `check.ts` — Developer entry-point (`npm run perf:check`).
- `serve.ts` — Stdlib static server (no Express) used by the collector.
- `baseline.json` — Committed budget.
- `report.json` / `report.md` — Generated outputs (gitignored).
- `package.json` / `tsconfig.json` — Isolated from the workspace so
  Puppeteer is only installed when this tool actually runs.
