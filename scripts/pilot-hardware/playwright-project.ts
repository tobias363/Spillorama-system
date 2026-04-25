/**
 * Playwright-project-definisjon for pilot-hardware-profil.
 *
 * Brukes som:
 *   import { pilotHardwareProject } from '../../scripts/pilot-hardware/playwright-project';
 *   export default defineConfig({
 *     projects: [
 *       { name: 'chromium-dev', use: { ...devices['Desktop Chrome'] } },
 *       pilotHardwareProject(),
 *     ],
 *   });
 *
 * Denne modulen importerer ingen playwright-core-symboler direkte —
 * den returnerer et plain object som matcher PlaywrightTestProject,
 * slik at den kan lastes fra Node uten at @playwright/test nødvendigvis
 * er installert i rot-workspacet.
 */
import { loadPilotHardwareProfile } from './load-profile.js';

// Minimal strukturell type — unngår hard dependency på @playwright/test
// i root-workspace. Hele objektet er kompatibelt med PlaywrightTestProject.
export interface PilotProjectSpec {
  name: string;
  use: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    launchOptions: {
      args: string[];
    };
  };
  metadata: {
    pilotHardwareProfile: string;
    pilotHardwareVersion: string;
  };
}

export function pilotHardwareProject(): PilotProjectSpec {
  const profile = loadPilotHardwareProfile();
  return {
    name: 'chromium-pilot-hw',
    use: {
      viewport: {
        width: profile.viewport.width,
        height: profile.viewport.height,
      },
      deviceScaleFactor: profile.viewport.deviceScaleFactor,
      launchOptions: {
        args: profile.chromiumArgs,
      },
    },
    metadata: {
      pilotHardwareProfile: profile.name,
      pilotHardwareVersion: profile.version,
    },
  };
}
