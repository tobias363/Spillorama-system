# Pilot Hardware Test Profile

Emulerer faktisk pilot-terminal-hardware (svakere CPU/GPU enn dev-MacBook)
i visuelle regresjons-tester og performance-budget-målinger.

**Motivasjon:** Blink/paint-storm-regresjoner manifesterer seg ofte først
på pilot-hardware. Dev-maskin har for mye GPU-headroom til å fange dem.
Se #468 og `docs/engineering/PILOT_HARDWARE_SPECS.md`.

## Filer

| Fil | Rolle |
| --- | --- |
| `profile.json` | Kilden til sannhet for pilot-hw-profil (CPU-throttle, GPU-flags, viewport) |
| `profile.schema.json` | JSON-Schema for profile-validering |
| `baseline-pilot-hw.json` | Budget-terskler, strengere enn dev-baseline |
| `baseline.schema.json` | Schema for baseline |
| `load-profile.ts` | Profile-loader + runtime-validering |
| `apply-cdp-throttle.ts` | CDP-adapter (Playwright + Puppeteer) |
| `playwright-project.ts` | Eksportert project-definisjon for #470 |
| `playwright-fixture.ts` | Auto-fixture som anvender throttle per test |
| `collect-metrics-pilot-hw.ts` | Wrapper rundt #469 sin collector |
| `compare-pilot-hw.ts` | Compare-skript med fpsMin-support |
| `validate-profile.ts` | CI self-check |

## Kommandoer

```bash
# Valider at profile.json + baseline er interne konsistente
npm run pilot-hw:validate

# Samle metrics under pilot-hw-throttle (krever #469 merget)
npm run perf:collect:pilot-hw

# Sammenlign mot baseline-pilot-hw.json
npm run perf:compare:pilot-hw

# Begge deler
npm run perf:check:pilot-hw

# Kjør Playwright visual-tester under pilot-hw (krever #470 merget)
npm run test:visual:pilot-hw
```

## Integrasjon

### Playwright (#470)

Legg til i `packages/game-client/playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test';
import { pilotHardwareProject } from '../../scripts/pilot-hardware/playwright-project.js';

export default defineConfig({
  projects: [
    { name: 'chromium-dev', use: { ...devices['Desktop Chrome'] } },
    pilotHardwareProject(),
  ],
});
```

Og i test-fil-ene:

```typescript
import { test as base } from '@playwright/test';
import { pilotHardwareFixture } from '../../../../scripts/pilot-hardware/playwright-fixture.js';

export const test = base.extend(pilotHardwareFixture);
```

### Puppeteer (#469)

`collect-metrics-pilot-hw.ts` setter følgende env-vars som
`scripts/performance-budget/collect-metrics.ts` må respektere:

| Env-var | Betydning |
| --- | --- |
| `PERF_BUDGET_OUT` | Output-filnavn (`report-pilot-hw.json`) |
| `PERF_BUDGET_CHROMIUM_ARGS` | JSON-array av launch args |
| `PERF_BUDGET_CPU_THROTTLE` | Integer — sendes til `page.emulateCPUThrottling(rate)` |
| `PERF_BUDGET_PROFILE_NAME` | `pilot-hw` — stemples i report |
| `PERF_BUDGET_PROFILE_VERSION` | Semver fra profile.json |
| `PERF_BUDGET_VIEWPORT_WIDTH` | Px |
| `PERF_BUDGET_VIEWPORT_HEIGHT` | Px |
| `PERF_BUDGET_NETWORK_PRESET` | Chrome DevTools preset-navn |

**Hvis #469 sin collector ikke allerede leser disse env-varene:** legg
til lesing i `collect-metrics.ts` før oppstart. Forventet patch er minimal
(ca 15 linjer på toppen av main()). Se open-question i PR-beskrivelsen.

## Baseline-update

1. Juster `profile.json` (hvis nødvendig) og bump `version`.
2. Kjør `npm run perf:collect:pilot-hw` lokalt.
3. Sjekk `scripts/performance-budget/report-pilot-hw.json` — er verdiene
   realistiske?
4. Oppdater `baseline-pilot-hw.json` manuelt med ca 10-20% headroom over
   observert verdi. Unngå å auto-bumpe; se om regresjon er reell før
   du løsner terskelen.
5. Sync `baseline.profileVersion` med `profile.version`.
6. `npm run pilot-hw:validate` for å sjekke.
7. Commit begge filer sammen — baseline uten profile-bump tolkes som
   bug.

## FPS-metric

`fpsMin` er ny for pilot-hw-profilen. Den beregnes i `browser-probe.ts`
(fra #469) som `1000 / avg(long-animation-frame.duration over window)`.
Dev-baseline har ikke `fpsMin` fordi dev-hardware rarely drops under
60fps; pilot-hw fanger "stuttering under buy-popup".
