import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for visual-regression tests.
 *
 * Scope: Spill 1 blink-regresjon-vern. DOM-tester fanger ikke paint-flashing,
 * så vi snapshotter deterministic harness-states og sammenligner pixel-diff
 * mot committede baselines (packages/game-client/tests/visual/__snapshots__).
 *
 * Key design choices:
 * - Kun chromium (matching prod web shell / TV-kiosk).
 * - Dual viewport: 1920×1080 (TV-kiosk) + 1280×720 (agent-portal).
 * - `reducedMotion: "reduce"` er IKKE satt — vi vil at flimring skal
 *   manifestere seg. `animations: "disabled"` settes per toHaveScreenshot()
 *   når vi sammenligner mot baseline (stabile stills); lot idle/flicker-testene
 *   (spill1-idle-stability) snapshotte uten disable for å se om noe blinker.
 * - Webserver: Vite preview med visual-harness build (ingen backend kreves).
 */
export default defineConfig({
  testDir: "./packages/game-client/tests/visual",
  outputDir: "./packages/game-client/tests/visual/__output__",
  snapshotDir: "./packages/game-client/tests/visual/__snapshots__",
  // Keep the project suffix (tv-kiosk-1920 vs agent-portal-1280) so viewport-
  // specific baselines don't collide, but drop `-darwin`/`-linux` — GPU
  // rasterisation differs slightly between platforms and the 0.5% pixel-diff
  // slack on toHaveScreenshot is designed to absorb that. Anything above
  // 0.5% is a real regression regardless of OS.
  //
  // Tradeoff: a developer who `--update-snapshots` on macOS ships pixels
  // that a Linux CI runner renders slightly differently. README documents
  // the Docker recipe to generate Linux baselines locally, and CI uploads
  // the `__output__` diff-images so you can see the actual vs. expected
  // when you push without baseline-regen.
  snapshotPathTemplate:
    "{snapshotDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",

  // Flaky-safety: én ekstra retry lokalt, to i CI for nett-/build-hikker.
  retries: process.env.CI ? 2 : 1,
  // Visual-tester er billige; én worker gir stabile snapshots (færre race-betingelser
  // med shared Vite-server, særlig på CI-runners med 2 vCPU).
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],

  expect: {
    // Default threshold for toHaveScreenshot — 0.5% pixel-forskjell er bruker-kravet.
    // Tester som krever strengere (idle-stabilitet) overrider per-assertion.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005,
      animations: "disabled",
      // Skjul caret som blinker i input-felt; ikke relevant for Spill 1 men
      // safe default for all future testing.
      caret: "hide",
    },
  },

  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    // Deterministisk pixel-ratio for stabile baselines (ingen retina-zoom).
    deviceScaleFactor: 1,
  },

  projects: [
    {
      name: "tv-kiosk-1920",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "agent-portal-1280",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],

  webServer: {
    // Bygger game-client (main + preview + visual-harness) og serverer via Vite preview.
    // Preview-server serverer static dist/ som apps/backend/public/web/games/
    // skriver til; visual-harness.html er en av entry-punktene i preview-builden.
    command: "npm run build:visual-harness && npm run serve:visual-harness",
    url: "http://127.0.0.1:4173/web/games/visual-harness.html",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
