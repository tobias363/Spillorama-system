/**
 * Utility som bruker Chrome DevTools Protocol (CDP) til å sette CPU- og
 * nettverks-throttling på en Page.
 *
 * Wrappet som en tynn adapter slik at den samme koden kan kjøres både
 * fra Playwright (page.context().newCDPSession) og Puppeteer (page.target().createCDPSession / page.emulateCPUThrottling).
 *
 * Playwright har ikke førstepart network-preset-API; vi mapper
 * networkThrottling-strenger til CDP Network.emulateNetworkConditions
 * rå-tall manuelt. Disse verdiene matcher Chrome DevTools-UI-ens preset.
 */
import type { PilotHardwareProfile } from './load-profile.js';

export interface MinimalCDPSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

const NETWORK_PRESETS: Record<
  string,
  {
    downloadThroughput: number;
    uploadThroughput: number;
    latency: number;
    offline: boolean;
  }
> = {
  'No throttling': {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  },
  'Slow 3G': {
    offline: false,
    latency: 400,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
  },
  'Fast 3G': {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  },
  'Slow 4G': {
    offline: false,
    latency: 150,
    downloadThroughput: (3 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  },
  'Fast 4G': {
    offline: false,
    latency: 60,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (3 * 1024 * 1024) / 8,
  },
};

export async function applyPilotHardwareThrottle(
  cdp: MinimalCDPSession,
  profile: PilotHardwareProfile,
): Promise<void> {
  // 1) CPU throttling
  await cdp.send('Emulation.setCPUThrottlingRate', {
    rate: profile.cpuThrottleRate,
  });

  // 2) Network throttling (hvis satt)
  if (profile.networkThrottling) {
    const preset = NETWORK_PRESETS[profile.networkThrottling];
    if (!preset) {
      throw new Error(
        `Unknown networkThrottling preset: ${profile.networkThrottling}`,
      );
    }
    await cdp.send('Network.enable', {});
    await cdp.send('Network.emulateNetworkConditions', preset);
  }

  // 3) Device metrics — fremtving monitor refresh rate via
  //    requestAnimationFrame-modulering i test-harness. CDP har ingen
  //    direkte "refresh rate"-knapp. Vi eksponerer monitorRefreshRate
  //    som window-attributt slik at vår probe kan respektere den.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__PILOT_HW_PROFILE__ = ${JSON.stringify({
        monitorRefreshRate: profile.monitorRefreshRate,
        cpuThrottleRate: profile.cpuThrottleRate,
        gpuTier: profile.gpuTier,
        name: profile.name,
      })};
    `,
  });
}
