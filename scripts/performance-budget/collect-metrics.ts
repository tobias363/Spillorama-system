/**
 * Performance-budget collector for Spill 1.
 *
 * ─────────────────────────────────────────────────────────────────
 * WHAT IT DOES
 *
 * 1. Starts a local static server against `apps/backend/public/web/`
 *    (the same directory the real backend serves; no backend boot).
 * 2. Launches a headless Chromium via Puppeteer.
 * 3. Navigates to the Spill 1 preview (`/games/preview.html`) and
 *    drives it into three well-defined scenarios:
 *      - `spill1_idle`         — page loaded, no overlay triggered
 *      - `spill1_buy_popup`    — wheel trigger popup active over canvas
 *      - `spill1_during_draw`  — mid-animation (wheel spinning)
 * 4. For each scenario, samples:
 *      - backdrop-filter count (DOM)
 *      - CSS animation-count (DOM)
 *      - infinite CSS animations (DOM)
 *      - RAF calls / sec (monkey-patched)
 *      - paint-entries per 2s (PerformanceObserver)
 *      - GSAP active tweens (if window.gsap is exposed)
 *      - long-animation-frame entries (Chrome 123+ only)
 * 5. Writes a merged JSON report to `report.json` in this directory.
 *    (`compare.ts` reads that file.)
 *
 * ─────────────────────────────────────────────────────────────────
 * WHY PUPPETEER, NOT PLAYWRIGHT
 *
 * Both would work. Puppeteer ships a single pinned Chromium and has
 * a smaller install footprint; Playwright pulls a three-browser
 * bundle we don't need. `evaluateOnNewDocument` + `page.evaluate`
 * cover both the RAF monkey-patch install and the per-scenario
 * measurement call cleanly.
 *
 * ─────────────────────────────────────────────────────────────────
 * WHY PREVIEW.HTML, NOT THE FULL WEB SHELL
 *
 * preview.html renders the five Spill 1 overlays against real
 * Pixi.Application instances with no backend dependency. It is the
 * same component code that ships to production (same imports from
 * src/games/game1/components/), so any rendering regression surfaces
 * here. Running against the full shell would require auth, socket.io,
 * postgres, and a running draw loop — far out of scope for a CI-gate.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer";
import {
  BROWSER_PROBE_SOURCE,
  METRIC_KEYS,
  type ScenarioMetrics,
} from "./browser-probe.ts";
import { startServer, type ServeHandle } from "./serve.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
/**
 * Output path for the JSON report. Defaults to `report.json` in this
 * directory. Wrappers (e.g. scripts/pilot-hardware/collect-metrics-pilot-hw.ts)
 * can override the filename via `PERF_BUDGET_OUT` — relative paths are
 * resolved against this directory so the companion compare script in the
 * performance-budget folder can find them, absolute paths are used as-is.
 * Only the report file is overridable; baseline path is unchanged.
 */
const REPORT_PATH = resolve(__dirname, process.env.PERF_BUDGET_OUT ?? "report.json");
const BASELINE_PATH = resolve(__dirname, "baseline.json");

const STABILIZE_MS = 1500;
const MEASURE_MS = 2000;

interface ScenarioDefinition {
  name: string;
  /**
   * Drives the page into the scenario's steady state before
   * measurement begins. Must leave the page in a state that remains
   * observable for the full `MEASURE_MS` window.
   */
  setup: (page: Page) => Promise<void>;
}

const SCENARIOS: ScenarioDefinition[] = [
  {
    name: "spill1_idle",
    setup: async () => {
      // Nothing — freshly-navigated preview page is the idle state.
    },
  },
  {
    name: "spill1_buy_popup",
    setup: async (page) => {
      // Wheel trigger button — surfaces the popup-over-canvas state
      // that the backdrop-filter regression hit hardest.
      await page.click('button[data-action="trigger"][data-overlay="wheel"]');
      await new Promise((r) => setTimeout(r, 600));
    },
  },
  {
    name: "spill1_during_draw",
    setup: async (page) => {
      // Trigger + SPIN to exercise the mid-animation state (running
      // GSAP tweens + Pixi ticker + result reveal animation).
      await page.click('button[data-action="trigger"][data-overlay="wheel"]');
      await new Promise((r) => setTimeout(r, 300));
      await page.click('button[data-action="choice"][data-overlay="wheel"]');
      await new Promise((r) => setTimeout(r, 300));
    },
  },
];

interface Report {
  generatedAt: string;
  scenarios: Record<string, ScenarioMetrics>;
}

type BudgetEntry = { max: number; current: number };
type BaselineScenario = Record<keyof ScenarioMetrics, BudgetEntry>;
export interface Baseline {
  description: string;
  scenarios: Record<string, BaselineScenario>;
}

async function collectForScenario(
  browser: Browser,
  baseUrl: string,
  scenario: ScenarioDefinition,
): Promise<ScenarioMetrics> {
  const page = await browser.newPage();
  try {
    // Install RAF counter + PerformanceObserver BEFORE any page
    // script runs. `evaluateOnNewDocument` queues the init IIFE so
    // it executes on every navigation, ahead of the page's own JS.
    await page.evaluateOnNewDocument(BROWSER_PROBE_SOURCE);

    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    // `/web/games/preview.html` matches the backend's express.static mount
    // ("apps/backend/public" at "/") and the `base: "/web/games/"` baked
    // into preview.js by Vite. Serve.ts mirrors the same prefix.
    await page.goto(`${baseUrl}/web/games/preview.html`, { waitUntil: "networkidle0" });

    // Wait for Pixi's first canvas to attach before running scenario
    // setup. Without this the click handlers may race initialization.
    await page.waitForSelector("#stage-wheel canvas");
    await new Promise((r) => setTimeout(r, 500));

    await scenario.setup(page);

    const metrics = (await page.evaluate(
      async (opts: { stabilizeMs: number; measureMs: number }) => {
        type Probe = { measure: (o: typeof opts) => Promise<ScenarioMetrics> };
        const probe = (window as unknown as { __perfBudget: Probe }).__perfBudget;
        return probe.measure(opts);
      },
      { stabilizeMs: STABILIZE_MS, measureMs: MEASURE_MS },
    )) as ScenarioMetrics;

    return metrics;
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const writeBaseline = process.argv.includes("--write-baseline");
  const overrideBaseUrl = process.env.PERF_BASE_URL;

  let serverHandle: ServeHandle | null = null;
  let baseUrl: string;
  if (overrideBaseUrl) {
    baseUrl = overrideBaseUrl.replace(/\/$/, "");
  } else {
    serverHandle = await startServer({});
    baseUrl = serverHandle.url;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // Deterministic rendering & steady RAF cadence in CI containers.
      "--disable-gpu",
      "--enable-precise-memory-info",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });

  const scenarios: Record<string, ScenarioMetrics> = {};
  try {
    for (const scenario of SCENARIOS) {
      process.stdout.write(`collecting ${scenario.name}... `);
      scenarios[scenario.name] = await collectForScenario(browser, baseUrl, scenario);
      process.stdout.write("ok\n");
    }
  } finally {
    await browser.close();
    if (serverHandle) await serverHandle.close();
  }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    scenarios,
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote ${REPORT_PATH}\n`);

  if (writeBaseline) {
    // Try to read existing baseline first so we can show the diff.
    let existing: Baseline | null = null;
    try {
      const raw = await readFile(BASELINE_PATH, "utf8");
      existing = JSON.parse(raw) as Baseline;
    } catch {
      /* first-time baseline, ok */
    }
    const baseline = buildBaseline(report, existing);
    await writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf8");
    process.stdout.write(`wrote ${BASELINE_PATH}\n`);
  }
}

/**
 * Per-metric policy for converting a raw `current` reading into a
 * `max` budget. Small absolute headroom for DOM-count metrics (where
 * any drift is suspicious) and a proportional headroom for rate
 * metrics (where CI-runner variance is higher).
 */
function budgetMax(key: keyof ScenarioMetrics, current: number): number {
  switch (key) {
    case "backdropFilterCount":
      // Hard-cap one above current — any new backdrop-filter addition
      // must go through a deliberate baseline-update review.
      return current + 1;
    case "cssAnimationCount":
      return current + 2;
    case "infiniteAnimationCount":
      // Regressions here should fire loud — infinite animations are
      // the exact class of bug the 2026-04-24 flicker was caused by.
      return current;
    case "rafCallsPerSec":
      // 120Hz dev displays report ~120/s; CI runners usually 60/s.
      // Allow 25% headroom for jitter, min +10.
      return Math.max(current + 10, Math.ceil(current * 1.25));
    case "paintCountPer2s":
      return Math.max(current + 5, Math.ceil(current * 1.5));
    case "gsapActiveTweens":
      return current < 0 ? -1 : current + 2;
    case "longAnimationFrames":
      return current + 2;
  }
}

function buildBaseline(report: Report, existing: Baseline | null): Baseline {
  const scenarios: Record<string, BaselineScenario> = {};
  for (const [name, metrics] of Object.entries(report.scenarios)) {
    const scenario = {} as BaselineScenario;
    const prev = existing?.scenarios[name];
    for (const key of METRIC_KEYS) {
      const cur = metrics[key];
      // Preserve existing `max` if it's already higher than what the
      // policy would produce — refreshing the baseline should not
      // silently tighten the budget.
      const policyMax = budgetMax(key, cur);
      const prevMax = prev?.[key]?.max;
      const finalMax =
        prevMax !== undefined && prevMax > policyMax ? prevMax : policyMax;
      scenario[key] = { current: cur, max: finalMax };
    }
    scenarios[name] = scenario;
  }
  return {
    description:
      "Spill 1 performance budget — refresh with `npm run perf:baseline` after an intentional change. Reviewers must check the `current` diff carefully; see scripts/performance-budget/README.md for the review protocol.",
    scenarios,
  };
}

main().catch((err) => {
  process.stderr.write(
    `collect failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
