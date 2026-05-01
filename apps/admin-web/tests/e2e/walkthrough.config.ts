/**
 * Standalone Playwright config for the prod bug-walkthrough.
 *
 * Decoupled fra root playwright.config.ts som bygger visual-harness; denne
 * konfigen treffer LIVE prod direkte og trenger ingen lokal web-server.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /agent-portal-bug-walkthrough\.spec\.ts$/,
  // Hver test (én per rolle) kan ta opp til 20 min — sett global stor.
  timeout: 30 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-walkthrough", open: "never" }]],
  use: {
    headless: true,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
