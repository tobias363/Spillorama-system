/**
 * Shared loader for pilot-hardware profile config.
 *
 * Brukes fra:
 *  - Playwright config (packages/game-client/playwright.config.ts)
 *  - Puppeteer metrics collector (scripts/performance-budget/collect-metrics-pilot-hw.ts)
 *  - CI validering
 *
 * Hvorfor en egen loader: holder én kilde til sannhet for profilen,
 * og tvinger schema-validering ved boot slik at feil i profile.json
 * fanges umiddelbart i CI istedenfor tause regressions.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface PilotHardwareProfile {
  name: string;
  version: string;
  cpuThrottleRate: number;
  networkThrottling?: string;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  monitorRefreshRate: number;
  gpuTier: 'low' | 'mid' | 'high';
  chromiumArgs: string[];
  description?: string;
}

const PROFILE_PATH_FROM_THIS_FILE = 'profile.json';

function thisDir(): string {
  // Prefer import.meta.url — unik per modul. __dirname under tsx/bundler
  // kan peke på consumer-CWD, ikke denne filens dir.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url: string | undefined = (import.meta as any)?.url;
    if (url) return dirname(fileURLToPath(url));
  } catch {
    // no-op
  }
  if (typeof __dirname !== 'undefined') return __dirname;
  throw new Error(
    'Cannot resolve this module directory — pass path eksplisitt til loadPilotHardwareProfile().',
  );
}

export function loadPilotHardwareProfile(
  path?: string,
): PilotHardwareProfile {
  const resolved = path ?? join(thisDir(), PROFILE_PATH_FROM_THIS_FILE);
  const raw = readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw) as PilotHardwareProfile & {
    $schema?: string;
  };

  // Minimal runtime-validering. Full JSON-Schema-validering skjer via
  // ajv hvis pilot-hardware/package.json er installert; fallback her
  // dekker bare de kritiske feltene.
  const errors: string[] = [];
  if (typeof parsed.name !== 'string') errors.push('name');
  if (typeof parsed.version !== 'string') errors.push('version');
  if (typeof parsed.cpuThrottleRate !== 'number') {
    errors.push('cpuThrottleRate');
  }
  if (!parsed.viewport || typeof parsed.viewport.width !== 'number') {
    errors.push('viewport.width');
  }
  if (!Array.isArray(parsed.chromiumArgs)) errors.push('chromiumArgs');
  if (![30, 60, 120, 144].includes(parsed.monitorRefreshRate)) {
    errors.push('monitorRefreshRate');
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid pilot-hardware profile (${resolved}): missing/invalid fields: ${errors.join(', ')}`,
    );
  }

  return parsed;
}

export const PILOT_HW_BASELINE_SUFFIX = '-pilot-hw';
