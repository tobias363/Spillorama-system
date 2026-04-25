#!/usr/bin/env tsx
/**
 * Sammenligner report-pilot-hw.json mot baseline-pilot-hw.json og
 * feiler hvis noen terskler er brutt. Parallell til #469 sin
 * scripts/performance-budget/compare.ts, men med pilot-hw-spesifikke
 * felter (fpsMin som min-budget istedenfor max).
 */
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const REPORT_PATH =
  process.env.PILOT_HW_REPORT ??
  join(REPO_ROOT, 'scripts', 'performance-budget', 'report-pilot-hw.json');
const BASELINE_PATH =
  process.env.PILOT_HW_BASELINE ?? join(HERE, 'baseline-pilot-hw.json');

interface BudgetMax {
  max: number;
  devMax?: number | null;
}
interface BudgetMin {
  min: number;
  devMin?: number | null;
}
type Budget = BudgetMax | BudgetMin;

interface Baseline {
  profile: string;
  profileVersion: string;
  scenarios: Record<string, Record<string, Budget>>;
}

interface ReportMetric {
  value: number;
}
interface Report {
  scenarios: Record<string, Record<string, ReportMetric | number>>;
}

function isMinBudget(b: Budget): b is BudgetMin {
  return 'min' in b;
}

function getValue(m: ReportMetric | number | undefined): number | null {
  if (m == null) return null;
  if (typeof m === 'number') return m;
  return m.value;
}

interface Breach {
  scenario: string;
  metric: string;
  actual: number;
  budget: number;
  direction: 'over-max' | 'under-min';
}

function compare(report: Report, baseline: Baseline): Breach[] {
  const breaches: Breach[] = [];
  for (const [scenario, metrics] of Object.entries(baseline.scenarios)) {
    const reportScenario = report.scenarios?.[scenario];
    if (!reportScenario) {
      console.warn(`[pilot-hw] scenario "${scenario}" missing from report`);
      continue;
    }
    for (const [metricName, budget] of Object.entries(metrics)) {
      const actual = getValue(reportScenario[metricName]);
      if (actual == null) {
        console.warn(
          `[pilot-hw] metric "${metricName}" missing from scenario "${scenario}"`,
        );
        continue;
      }
      if (isMinBudget(budget)) {
        if (actual < budget.min) {
          breaches.push({
            scenario,
            metric: metricName,
            actual,
            budget: budget.min,
            direction: 'under-min',
          });
        }
      } else {
        if (actual > budget.max) {
          breaches.push({
            scenario,
            metric: metricName,
            actual,
            budget: budget.max,
            direction: 'over-max',
          });
        }
      }
    }
  }
  return breaches;
}

function formatMarkdown(breaches: Breach[], baseline: Baseline): string {
  if (breaches.length === 0) {
    return `## Pilot Hardware Test: PASS\n\nProfile: \`${baseline.profile}\` v${baseline.profileVersion}\n\nAll ${Object.keys(baseline.scenarios).length} scenario(s) innenfor budget.`;
  }
  const rows = breaches
    .map(
      (b) =>
        `| \`${b.scenario}\` | \`${b.metric}\` | ${b.actual} | ${b.direction === 'over-max' ? '≤' : '≥'} ${b.budget} | ${b.direction === 'over-max' ? 'OVER' : 'UNDER'} |`,
    )
    .join('\n');
  return [
    `## Pilot Hardware Test: FAIL`,
    ``,
    `Profile: \`${baseline.profile}\` v${baseline.profileVersion}`,
    ``,
    `${breaches.length} budget-brudd på pilot-hardware-profil (4x CPU throttle, integrated GPU, 1080p 60Hz):`,
    ``,
    `| Scenario | Metric | Actual | Budget | Direction |`,
    `| --- | --- | --- | --- | --- |`,
    rows,
    ``,
    `Pilot-hw-baseline er strengere enn dev-baseline med overlegg. Hvis disse bruddene også vises på dev-baseline, fiks der først.`,
  ].join('\n');
}

function main(): void {
  if (!existsSync(REPORT_PATH)) {
    console.error(`[pilot-hw] report missing: ${REPORT_PATH}`);
    console.error(
      '[pilot-hw] Kjør `npm run perf:collect:pilot-hw` først, eller sjekk PILOT_HW_REPORT env-var.',
    );
    process.exit(1);
  }
  if (!existsSync(BASELINE_PATH)) {
    console.error(`[pilot-hw] baseline missing: ${BASELINE_PATH}`);
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as Report;
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;

  const breaches = compare(report, baseline);
  const md = formatMarkdown(breaches, baseline);
  console.log(md);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  }

  process.exit(breaches.length === 0 ? 0 : 1);
}

main();
