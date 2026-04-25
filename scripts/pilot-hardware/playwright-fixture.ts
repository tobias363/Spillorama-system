/**
 * Playwright-fixture som anvender CPU-throttling via CDP før hver test
 * når testen kjører i chromium-pilot-hw-project.
 *
 * Registreres i #470 sin playwright.config.ts / test.extend ved å gjøre:
 *
 *   import { test as base } from '@playwright/test';
 *   import { pilotHardwareFixture } from '../../../../scripts/pilot-hardware/playwright-fixture';
 *
 *   export const test = base.extend(pilotHardwareFixture);
 *
 * Fixtur-en er en no-op i chromium-dev-project, slik at dev-baseline
 * forblir uendret.
 */
import { loadPilotHardwareProfile } from './load-profile.js';
import { applyPilotHardwareThrottle } from './apply-cdp-throttle.js';

// Strukturelle typer — unngår import fra @playwright/test (se
// playwright-project.ts for begrunnelse).
interface PWPage {
  context(): {
    newCDPSession(page: PWPage): Promise<{
      send(m: string, p?: Record<string, unknown>): Promise<unknown>;
    }>;
  };
}

interface PWTestInfo {
  project: { name: string };
}

type PWFixtureFn = (
  args: { page: PWPage },
  use: (v: unknown) => Promise<void>,
  testInfo: PWTestInfo,
) => Promise<void>;

export const pilotHardwareFixture: {
  pilotHardwareThrottle: [PWFixtureFn, { auto: true }];
} = {
  pilotHardwareThrottle: [
    async (
      { page }: { page: PWPage },
      use: (v: unknown) => Promise<void>,
      testInfo: PWTestInfo,
    ) => {
      if (testInfo.project.name === 'chromium-pilot-hw') {
        const profile = loadPilotHardwareProfile();
        const cdp = await page.context().newCDPSession(page);
        await applyPilotHardwareThrottle(cdp, profile);
      }
      await use(undefined);
    },
    { auto: true },
  ],
};
