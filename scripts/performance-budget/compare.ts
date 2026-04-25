/**
 * Diff `report.json` against `baseline.json` and emit a human-readable
 * + machine-readable report. Exits 1 if any tracked metric exceeds its
 * budget.
 *
 * Used by:
 *   - CI (`.github/workflows/performance-budget.yml`) — exit code is
 *     the gate, markdown output is posted to the PR.
 *   - Developers (`npm run perf:check` → `scripts/performance-budget/
 *     check.ts`) — colored plaintext output.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  METRIC_KEYS,
  METRIC_LABELS,
  type ScenarioMetrics,
} from "./browser-probe.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, "report.json");
const BASELINE_PATH = resolve(__dirname, "baseline.json");
const MARKDOWN_OUT = resolve(__dirname, "report.md");

interface Report {
  generatedAt: string;
  scenarios: Record<string, ScenarioMetrics>;
}
interface Baseline {
  description: string;
  scenarios: Record<string, Record<string, { max: number; current: number }>>;
}

export interface MetricCheck {
  key: keyof ScenarioMetrics;
  label: string;
  current: number;
  baseline: number;
  max: number;
  delta: number;
  overBudget: boolean;
  unmeasured: boolean;
}

export interface ScenarioCheck {
  name: string;
  metrics: MetricCheck[];
  failed: boolean;
}

export interface CompareResult {
  scenarios: ScenarioCheck[];
  overallFailed: boolean;
  missingScenarios: string[];
}

export function compare(report: Report, baseline: Baseline): CompareResult {
  const scenarios: ScenarioCheck[] = [];
  const missingScenarios: string[] = [];

  for (const [name, metrics] of Object.entries(report.scenarios)) {
    const baselineScenario = baseline.scenarios[name];
    if (!baselineScenario) {
      missingScenarios.push(name);
      continue;
    }

    const checks: MetricCheck[] = METRIC_KEYS.map((key) => {
      const current = metrics[key];
      const bl = baselineScenario[key];
      const unmeasured = key === "gsapActiveTweens" && current < 0;
      return {
        key,
        label: METRIC_LABELS[key],
        current,
        baseline: bl?.current ?? 0,
        max: bl?.max ?? Number.POSITIVE_INFINITY,
        delta: current - (bl?.current ?? 0),
        overBudget: !unmeasured && current > (bl?.max ?? Number.POSITIVE_INFINITY),
        unmeasured,
      };
    });

    scenarios.push({
      name,
      metrics: checks,
      failed: checks.some((c) => c.overBudget),
    });
  }

  return {
    scenarios,
    overallFailed: scenarios.some((s) => s.failed) || missingScenarios.length > 0,
    missingScenarios,
  };
}

/**
 * Render the compare result as Markdown for the PR comment.
 */
export function renderMarkdown(result: CompareResult): string {
  const lines: string[] = [];
  lines.push("## Spill 1 Performance Budget");
  lines.push("");
  if (result.overallFailed) {
    lines.push("**Status: FAIL** — one or more metrics exceeded the budget.");
  } else {
    lines.push("**Status: OK** — all tracked metrics within budget.");
  }
  lines.push("");

  for (const scenario of result.scenarios) {
    lines.push(`### \`${scenario.name}\` ${scenario.failed ? "FAIL" : "OK"}`);
    lines.push("");
    lines.push("| Metric | Current | Baseline | Δ | Max | Status |");
    lines.push("|---|---:|---:|---:|---:|:---:|");
    for (const m of scenario.metrics) {
      const cur = m.unmeasured ? "n/a" : String(m.current);
      const base = m.unmeasured ? "n/a" : String(m.baseline);
      const delta = m.unmeasured ? "—" : formatDelta(m.delta);
      const max = m.unmeasured || !Number.isFinite(m.max) ? "—" : String(m.max);
      const status = m.unmeasured ? "SKIP" : m.overBudget ? "FAIL" : "OK";
      lines.push(`| ${m.label} | ${cur} | ${base} | ${delta} | ${max} | ${status} |`);
    }
    lines.push("");
  }

  if (result.missingScenarios.length > 0) {
    lines.push("> Missing baseline for: " + result.missingScenarios.map((s) => `\`${s}\``).join(", "));
    lines.push("> Run `npm run perf:baseline` to regenerate and commit the result.");
    lines.push("");
  }

  lines.push("<sub>See `scripts/performance-budget/README.md` for how these metrics are collected and how to update the baseline.</sub>");
  return lines.join("\n");
}

/**
 * Render a colored plaintext report for the terminal (the `check`
 * entry-point). ANSI-codes are stripped automatically when stdout is
 * not a TTY (e.g. CI logs), so this output is safe for both contexts.
 */
export function renderTerminal(result: CompareResult): string {
  const useColor = process.stdout.isTTY;
  const c = {
    red: useColor ? "\x1b[31m" : "",
    green: useColor ? "\x1b[32m" : "",
    yellow: useColor ? "\x1b[33m" : "",
    dim: useColor ? "\x1b[2m" : "",
    bold: useColor ? "\x1b[1m" : "",
    reset: useColor ? "\x1b[0m" : "",
  };

  const lines: string[] = [];
  lines.push("");
  lines.push(`${c.bold}Spill 1 Performance Check${c.reset}`);
  lines.push("");

  for (const scenario of result.scenarios) {
    lines.push(`${c.bold}Scenario: ${scenario.name}${c.reset}`);
    for (const m of scenario.metrics) {
      const statusIcon = m.unmeasured
        ? `${c.yellow}SKIP${c.reset}`
        : m.overBudget
          ? `${c.red}FAIL${c.reset}`
          : `${c.green}OK${c.reset}`;
      const cur = m.unmeasured ? "n/a" : String(m.current);
      const max = m.unmeasured || !Number.isFinite(m.max) ? "—" : String(m.max);
      const delta = m.unmeasured ? "" : `  ${c.dim}(Δ ${formatDelta(m.delta)})${c.reset}`;
      lines.push(`  ${m.label}: ${cur} / ${max}  ${statusIcon}${delta}`);
    }
    lines.push("");
  }

  if (result.missingScenarios.length > 0) {
    lines.push(`${c.yellow}Missing baseline for: ${result.missingScenarios.join(", ")}${c.reset}`);
    lines.push(`${c.yellow}Run \`npm run perf:baseline\` to regenerate.${c.reset}`);
    lines.push("");
  }

  if (result.overallFailed) {
    lines.push(`${c.red}${c.bold}Budget exceeded${c.reset}`);
  } else {
    lines.push(`${c.green}${c.bold}All within budget${c.reset}`);
  }
  return lines.join("\n");
}

function formatDelta(delta: number): string {
  if (delta === 0) return "0";
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

async function main(): Promise<void> {
  const [reportRaw, baselineRaw] = await Promise.all([
    readFile(REPORT_PATH, "utf8"),
    readFile(BASELINE_PATH, "utf8"),
  ]);
  const report = JSON.parse(reportRaw) as Report;
  const baseline = JSON.parse(baselineRaw) as Baseline;

  const result = compare(report, baseline);

  const markdown = renderMarkdown(result);
  await writeFile(MARKDOWN_OUT, markdown + "\n", "utf8");

  // Always print the markdown to stdout when running under `compare.ts`
  // directly (CI). The dedicated terminal view is `check.ts`.
  process.stdout.write(markdown + "\n");

  process.exit(result.overallFailed ? 1 : 0);
}

// Only run main if invoked directly (not when imported by check.ts).
const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  main().catch((err) => {
    process.stderr.write(
      `compare failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(2);
  });
}
