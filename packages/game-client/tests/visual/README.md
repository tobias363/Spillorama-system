# Spill 1 — Visual Regression Testing

Playwright-baserte visual-regression-tester som beskytter Spill 1 mot blink-regresjon og uønsket visuell drift.

## Hvorfor

Blink-problemet i Spill 1 har gjentatt seg i måneder fordi DOM-baserte tester ikke fanget opp paint-flashing. Chrome DevTools-analyse 2026-04-24 viste at `backdrop-filter` over Pixi-canvas var hovedkilden. Dette suite-t er designet for å fange enhver ny blink-kilde _før_ PR merges til `main`.

## Testarkitektur

- **Harness** (`packages/game-client/src/visual-harness/`): Standalone HTML/TS side som mounter Spill 1-komponenter i deterministiske tilstander uten backend/socket. Playwright navigerer hit via `?scenario=<navn>`.
- **Server** (`scripts/serve-visual-harness.mjs`): Minimal statisk fil-server på port 4173 som speiler produksjons-URL-layout (`/web/games/...`).
- **Tester** (`packages/game-client/tests/visual/*.spec.ts`): Playwright-specs som verifiserer tre invarianter:
  1. **Pixel-diff vs. committede baselines** (`spill1-*.spec.ts`) — fanger visuell regresjon.
  2. **Backdrop-filter-budget** (`blink-budget.spec.ts`) — ingen nye `backdrop-filter`-elementer utenfor populært-whitelistede popups.
  3. **Paint-count + animation-count** (`blink-budget.spec.ts`) — fanger runaway-repaint (idle-flicker).
  4. **Frame-invarians** (`spill1-idle-stability.spec.ts`) — 5 screenshots tatt med 100 ms mellomrom skal være byte-identiske i idle.

## Scenarioer

Alle scenarioer lastes via `http://127.0.0.1:4173/web/games/visual-harness.html?scenario=<navn>`:

| Scenario       | Dekker                                                                  |
| -------------- | ----------------------------------------------------------------------- |
| `idle`         | Pre-round lobby med tom ball-tube og sentre-ball                        |
| `buy-popup`    | `Game1BuyPopup` åpen (backdrop-blur scenario)                           |
| `draw-active`  | Ball-tube med 5 baller + centre-ball viser tall 42                      |
| `pattern-won`  | `WinPopup` åpen for 2-rad vinn (500 kr)                                 |
| `win-screen`   | `WinScreenV2` — full-hus bingo-vinn                                     |

## Kjøre lokalt

```bash
# Første gang: installer Playwright-nettlesere
npx playwright install chromium

# Kjør hele suite
npm run test:visual

# Kjør interaktivt (Playwright UI mode)
npm run test:visual:ui

# Kjør bare ett prosjekt
npx playwright test --project=tv-kiosk-1920

# Kjør en enkelt spec
npx playwright test packages/game-client/tests/visual/spill1-idle.spec.ts
```

## Oppdatere baselines

**Når har man lov?** Kun når:
1. Visuell endring er _intensjonell_ (design-review signert av PM), eller
2. GPU-/Chromium-oppgradering har skapt sub-pixel-drift som ikke kan absorberes av `maxDiffPixelRatio: 0.005`.

**Prosess:**

1. Lag branch og push koden som endrer utseende.
2. Kjør lokalt:
   ```bash
   npm run build:visual-harness
   npm run test:visual:update
   ```
3. Commit de nye PNG-ene under `packages/game-client/tests/visual/__snapshots__/`.
4. **Krev review av minst én annen person** på PR-en — baseline-oppdatering er den eneste måten å "slippe gjennom" visuelle regresjoner, så det skal ikke kunne merges av én person alene.

### Cross-platform: macOS vs. Linux baselines

Playwright-konfig er satt opp til å droppe platform-suffikset fra baseline-filnavn (`spill1-idle-tv-kiosk-1920.png`, ikke `-darwin.png`). Dette betyr at én committet PNG må fungere både lokalt og på CI. **Slackgrensen på 0.5% pixel-diff er designet til å absorbere mindre GPU-/raster-forskjeller** mellom macOS og Ubuntu Chromium.

Hvis du oppdaterer en baseline på macOS og CI feiler pga. > 0.5% diff, har du to valg:

**A) Kjør i Docker lokalt** (anbefalt):

```bash
docker run --rm --network host -v "$(pwd):/work" -w /work \
  mcr.microsoft.com/playwright:v1.59.1-jammy \
  bash -c "npm ci && npm run build:visual-harness && npm run test:visual:update"
```

Dette produserer Linux-kompatible baselines i én kjøring.

**B) Push, la CI feile én gang, last ned `__output__`-artifacten**:

1. Pushe endringen uten baseline-oppdatering.
2. CI feiler; gå til Actions-tab og last ned `visual-regression-diffs-*` artifact.
3. Kopier `*-actual.png` inn som nye baselines under `__snapshots__/`.
4. Push en commit til med de nye baselines.

## CI-integrasjon

`.github/workflows/visual-regression.yml` kjører på hver PR mot `main` som rører `packages/game-client`, `playwright.config.ts`, eller denne test-mappen. Ved feil:
- PR-check-en markeres rød.
- `visual-regression-diffs-*` artifact inneholder `<test>-actual.png`, `<test>-expected.png`, `<test>-diff.png` for hver feilet scenario — åpne i PR Checks-fanen og zoom inn på diff-PNG-en.
- `playwright-report-*` artifact inneholder den fulle HTML-rapporten med videoer og trace-zip-filer.

## Feilsøking

### "A snapshot doesn't exist..."
Første gang testen kjører uten baseline. Løsning: kjør `npm run test:visual:update`.

### "Idle frames differ across capture window..."
Flicker-guarden har oppdaget pikseldrift mellom 5 frames tatt 100 ms fra hverandre i en stat som skal være idle. Dette er den viktigste testen i suite-et — hvis denne feiler, _lander det sannsynligvis en ny blink-kilde._ Sjekk:
1. Har du lagt til en ny `backdrop-filter` et sted?
2. Har du lagt til en CSS-animasjon med `iteration-count: infinite`?
3. Har du lagt til en `requestAnimationFrame`-loop som ikke respekterer idle-state?

### "Unexpected backdrop-filter elements found..."
Backdrop-filter-budgetten er brutt. Sjekk `backdrop-filter` eller `-webkit-backdrop-filter` i dine nylige endringer. Hvis det MÅ være der (f.eks. ny popup-backdrop), utvid whitelisten i `fixtures/harness.ts:isAllowed()`.

### "paint-count delta was X over 2s; budget is <=20"
Idle-tilstanden repainter for ofte. Samme feilsøking som flicker-guard, men her har du fått en numerisk terskel — typisk 60–120 betyr konstant 30–60 fps repaint, som alltid er et GPU-komposisjon-problem.

## Referanser
- Playwright screenshot-API: https://playwright.dev/docs/screenshots
- `toHaveScreenshot` thresholds: https://playwright.dev/docs/test-snapshots
- PM chrome-devtools-analyse 2026-04-24 — identifiserte backdrop-filter over Pixi som hovedkilde.
