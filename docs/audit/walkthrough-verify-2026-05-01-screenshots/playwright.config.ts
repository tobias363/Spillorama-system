import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "walkthrough.spec.ts",
  retries: 0,
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  use: {
    trace: "on",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "verify",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
