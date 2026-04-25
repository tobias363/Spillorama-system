#!/usr/bin/env tsx
/**
 * Self-check: validerer at profile.json og baseline-pilot-hw.json er
 * interne konsistente. Kalles i CI-workflow før noen tester kjøres,
 * slik at korrupt/ufullstendig config feiler raskt og med god feilmelding.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPilotHardwareProfile } from './load-profile.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function main(): void {
  const profile = loadPilotHardwareProfile();
  const baseline = JSON.parse(
    readFileSync(join(HERE, 'baseline-pilot-hw.json'), 'utf8'),
  ) as { profile: string; profileVersion: string };

  if (baseline.profile !== profile.name) {
    console.error(
      `[pilot-hw] profile.name (${profile.name}) != baseline.profile (${baseline.profile})`,
    );
    process.exit(1);
  }
  if (baseline.profileVersion !== profile.version) {
    console.error(
      `[pilot-hw] profile.version (${profile.version}) != baseline.profileVersion (${baseline.profileVersion}) — baseline må regenereres.`,
    );
    process.exit(1);
  }

  console.log(
    `[pilot-hw] profile ${profile.name} v${profile.version} valid (CPU ${profile.cpuThrottleRate}x, ${profile.viewport.width}x${profile.viewport.height}@${profile.monitorRefreshRate}Hz, gpu=${profile.gpuTier}).`,
  );
}

main();
