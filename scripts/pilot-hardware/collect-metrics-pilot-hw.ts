#!/usr/bin/env tsx
/**
 * Performance-metrics-collector under pilot-hardware-profil.
 *
 * Wrapper rundt scripts/performance-budget/collect-metrics.ts (fra #469):
 *  1) Starter Puppeteer med pilot-hw chromiumArgs
 *  2) Setter CPU-throttle via page.emulateCPUThrottling(rate)
 *  3) Kjører samme scenario-suite som dev-baseline
 *  4) Skriver report til scripts/performance-budget/report-pilot-hw.json
 *  5) Sammenlignes mot baseline-pilot-hw.json (strengere budgets)
 *
 * Kjøres fra root:
 *   npm run perf:check:pilot-hw
 *
 * Standalone-fallback: hvis #469 ikke er merget ennå, logger scripten
 * en tydelig feilmelding og exiter med kode 2 (ikke 1 — slik at CI-
 * gaten ikke feiler på fraværende dependency før selve metrics-feiler).
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPilotHardwareProfile } from './load-profile.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const PERF_BUDGET_DIR = join(REPO_ROOT, 'scripts', 'performance-budget');
const BASE_COLLECTOR = join(PERF_BUDGET_DIR, 'collect-metrics.ts');

async function main(): Promise<void> {
  const profile = loadPilotHardwareProfile();
  console.log(`[pilot-hw] profile=${profile.name} v${profile.version}`);
  console.log(
    `[pilot-hw] cpuThrottle=${profile.cpuThrottleRate}x, gpu=${profile.gpuTier}, refresh=${profile.monitorRefreshRate}Hz`,
  );

  if (!existsSync(BASE_COLLECTOR)) {
    console.error(
      `[pilot-hw] FATAL: ${BASE_COLLECTOR} finnes ikke. Dette tyder på at #469 (feat/performance-budget-ci-gate) ikke er merget ennå. Pilot-hw-collector krever den som base.`,
    );
    console.error(
      '[pilot-hw] Løsning: merge #469 først, eller kjør `git merge origin/feat/performance-budget-ci-gate`.',
    );
    process.exit(2);
  }

  // Overrides som collect-metrics.ts må respektere — settes via env:
  // PERF_BUDGET_OUT: output-filnavn
  // PERF_BUDGET_CHROMIUM_ARGS: JSON-array
  // PERF_BUDGET_CPU_THROTTLE: integer
  process.env.PERF_BUDGET_OUT = 'report-pilot-hw.json';
  process.env.PERF_BUDGET_CHROMIUM_ARGS = JSON.stringify(profile.chromiumArgs);
  process.env.PERF_BUDGET_CPU_THROTTLE = String(profile.cpuThrottleRate);
  process.env.PERF_BUDGET_PROFILE_NAME = profile.name;
  process.env.PERF_BUDGET_PROFILE_VERSION = profile.version;
  process.env.PERF_BUDGET_VIEWPORT_WIDTH = String(profile.viewport.width);
  process.env.PERF_BUDGET_VIEWPORT_HEIGHT = String(profile.viewport.height);
  if (profile.networkThrottling) {
    process.env.PERF_BUDGET_NETWORK_PRESET = profile.networkThrottling;
  }

  // Delegér til base-collector. Importerer dynamically slik at modulen
  // ikke lastes hvis #469 mangler.
  await import(BASE_COLLECTOR);
}

main().catch((err: unknown) => {
  console.error('[pilot-hw] collector failed:', err);
  process.exit(1);
});
