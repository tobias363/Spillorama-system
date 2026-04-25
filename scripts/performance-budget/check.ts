/**
 * Developer entry-point for the performance-budget check.
 *
 * Runs:
 *   1. `collect-metrics.ts` — samples the preview build in headless
 *      Chromium and writes `report.json`.
 *   2. `compare.ts` — diffs the report against `baseline.json` and
 *      prints a colored terminal report.
 *
 * Exit-code follows the same policy as the CI workflow:
 *   0 — all metrics within budget
 *   1 — at least one metric exceeds budget (or a scenario is missing)
 *   2 — unexpected error during collect/compare
 *
 * Invoked by `npm run perf:check` from the repo root.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compare, renderTerminal } from "./compare.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, "report.json");
const BASELINE_PATH = resolve(__dirname, "baseline.json");

async function runCollect(): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", resolve(__dirname, "collect-metrics.ts")],
      { stdio: "inherit", env: process.env },
    );
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`collect-metrics exited ${code ?? "?"}`));
    });
  });
}

async function main(): Promise<void> {
  await runCollect();

  const [reportRaw, baselineRaw] = await Promise.all([
    readFile(REPORT_PATH, "utf8"),
    readFile(BASELINE_PATH, "utf8"),
  ]);
  const report = JSON.parse(reportRaw);
  const baseline = JSON.parse(baselineRaw);

  const result = compare(report, baseline);
  process.stdout.write(renderTerminal(result) + "\n");
  process.exit(result.overallFailed ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(
    `perf:check failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(2);
});
