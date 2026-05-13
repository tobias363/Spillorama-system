import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Spill 1 pilot-flow E2E tests.
 *
 * Tobias-direktiv 2026-05-13: autonomous test loop som driver hele
 * pilot-flyten ende-til-ende — master mark ready + start, klient kjøper
 * 6 bonger (1 av hver av Liten/Stor × Hvit/Gul/Lilla), verifiserer
 * pris-tekst i popup, og verifiserer at popup-en kan re-åpnes etter et
 * vellykket kjøp.
 *
 * Forskjell fra `playwright.config.ts` i repo-rot (visual-regression):
 *   - Driver mot LIVE backend på `http://localhost:4000` (dev:all)
 *   - Ingen visual snapshots — kun DOM-assertions
 *   - 1 prosjekt (chromium 1280×720), 1 worker (deterministisk state)
 *   - `reuseExistingServer: true` — antar dev:all kjører allerede;
 *     starter ikke ny stack
 *
 * Forutsetning:
 *   bash scripts/dev/nuke-restart.sh   # eller `ENABLE_BUY_DEBUG=1 npm run dev:nuke`
 *
 * Kjør (fra repo-rot):
 *   npx playwright test --config=tests/e2e/playwright.config.ts
 * eller
 *   npm run test:pilot-flow
 */
export default defineConfig({
  testDir: ".",
  outputDir: "./__output__",

  // E2E flow er stateful: spawner real scheduled-game per test og må kjøre
  // sekvensielt. Hver test resetter state via REST helpers før den begynner.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Generøs retry lokalt fordi nettverks-glipper / hot-reload kan gi
  // false negatives — pilot-flow er IKKE en kandidat for streng zero-retry.
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  // 90s per test — full flow er ~30s, men popup-animations + socket-roundtrip
  // kan trekke det ut. Bedre å gi ekstra margin enn å få flaky failures.
  timeout: 90_000,

  expect: {
    // Klient-state synkroniserer mot socket-events; de fleste DOM-assertions
    // trenger korte polling-vinduer.
    timeout: 15_000,
  },

  use: {
    // Backend serverer både API og statisk klient på samme port (apps/backend
    // public/web). Vite-dev for admin-web ligger på 5174, men spillerklienten
    // består av en pre-built bundle servert via Express på 4000.
    baseURL: "http://localhost:4000",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    // Headless. Hvis du vil debugge visuelt: PWDEBUG=1 npx playwright test ...
    headless: true,
  },

  projects: [
    {
      name: "chromium-1280",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],

  // Antar dev:all kjører allerede. Hvis vi prøvde å spawne dev:all her, ville
  // det blokkere fordi prosessen aldri exit-er. PR-mottaker må kjøre
  // `npm run dev:nuke` før test.
  webServer: {
    // Bare en `wait-for` mot backend health-endpoint — ingen ny prosess
    // spawnes. `reuseExistingServer: true` betyr at hvis port 4000 svarer,
    // bruker vi den; hvis ikke, prøver Playwright å kjøre `command` (som
    // bare er en feilmelding her).
    command: "echo '[pilot-flow] dev:all må kjøre på port 4000. Kjør `npm run dev:nuke` først.' && exit 1",
    url: "http://localhost:4000/health",
    timeout: 5_000,
    reuseExistingServer: true,
  },
});
