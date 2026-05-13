# Pilot-flow E2E tests

End-to-end tester som driver hele Spill 1 pilot-flyten ende-til-ende mot
en levende `dev:all`-stack. **Bygget 2026-05-13** etter Tobias-direktiv om
å bygge fullverdig test-infrastruktur **før** vi iterer videre på buy-flow-
buggene som har stoppet pilot-fremgangen i 3 dager.

> "Vi må ha en fullverdig testflyt for effektiv utvikling. Hvis dette tar
> 3 dager å lage er det 100% verdt det vi har nå brukt 3 dager på og
> nesten ingen fremgang. … Pilot-dato skal ikke komme på bekostning av
> kvalitet."
>
> — Tobias 2026-05-13

## Hva testen dekker

`spill1-pilot-flow.spec.ts` driver hele master + spiller-flyten:

1. **Auto-login** master (`demo-agent-1@spillorama.no`) + spiller
   (`demo-pilot-spiller-1@example.com`) via `/api/dev/auto-login`
2. **Reset state** — stopper evt. pågående runde via REST
3. **Mark hall ready** (`POST /api/admin/game1/halls/<hallId>/ready`)
   → lazy-spawner scheduled-game
4. **Master start** (`POST /api/agent/game1/master/start`) → spill running
5. **Spiller åpner klient** med pre-seeded `sessionStorage.lobby.activeHallId`
   = `demo-hall-001` så lobby joiner pilot-GoH-rommet (uten dette default-er
   lobby til `hall-default`)
6. **Klikk Bingo-tile** → game-bundle mountes (Pixi + HTML-overlay)
7. **Verifiser pris-tekst** per bongfarge i popup:
   - Liten hvit `5 kr` / Liten gul `10 kr` / Liten lilla `15 kr`
   - Stor hvit `15 kr` / Stor gul `30 kr` / Stor lilla `45 kr`
8. **Klikk +** på hver rad (kjøp 1 av hver = 6 bonger / 12 brett)
9. **Verifiser total** = 120 kr / 12 brett
10. **Klikk Kjøp** og vent på success
11. **Verifiser 12 brett i ticket-grid** med riktig per-brett-pris
    (Liten hvit 5 kr per brett, Stor hvit 5 kr per brett, etc. —
    `bundle / count`, ikke `bundle`-pris)
12. **Re-åpne popup** (bug-2-test): etter første kjøp må popup kunne
    åpnes igjen via "Kjøp flere bonger" eller
    `window.__spillorama.playScreen.showBuyPopup()`
13. **Verifiser at re-åpnet popup har samme priser + qty=0**
14. **Cleanup**: master stop

## Forutsetninger

1. **Dev-stack må kjøre på port 4000** (backend + bundled klient):

   ```bash
   cd /Users/tobiashaugen/Projects/Spillorama-system
   ENABLE_BUY_DEBUG=1 npm run dev:nuke
   ```

   `ENABLE_BUY_DEBUG=1` gir oss `[BUY-DEBUG]`-logs både server-side (i
   backend-output) og klient-side (i Playwright `page.console`-stream)
   slik at failure-diagnose blir rask. `?debug=1`-query-param trigger
   det samme på klient-siden.

2. **Pilot demo-seed** må være kjørt — `npm run dev:nuke` seeder
   `demo-hall-001..004`, demo-agenter og demo-spillere fra
   `apps/backend/scripts/seed-demo-pilot-day.ts`.

3. **Demo-master-bruker** må være knyttet til `demo-hall-001` som master
   av Group of Halls. Verifiserer i `beforeAll` med
   `expect(master.hallId).toBe(HALL_ID)`.

## Kjøre testen

```bash
# Hele suiten
npm run test:pilot-flow

# Med UI (Playwright-inspector for steg-for-steg debug)
npm run test:pilot-flow:ui

# Med Playwright-debugger (browser åpen, breakpoints)
npm run test:pilot-flow:debug

# Direkte
npx playwright test --config=tests/e2e/playwright.config.ts
```

På failure ligger artifacts i `tests/e2e/__output__/<test-name>/`:
- `test-failed-N.png` — DOM-snapshot
- `video.webm` — full kjøring
- `trace.zip` — Playwright trace (åpne med `npx playwright show-trace ...`)
- `error-context.md` — feilmelding + kode-snippet

## Forskjell fra visual-regression-tester

| Aspekt | Visual regression (`playwright.config.ts` rot) | Pilot-flow (`tests/e2e/playwright.config.ts`) |
|---|---|---|
| Stack | Vite preview (visual-harness build, ingen backend) | Live `dev:all` på port 4000 |
| Assertions | Pixel-diff mot snapshots | DOM + tekst + state |
| Driver | Statiske scenarier i harness | Master + REST orchestrering |
| Workers | 1 (deterministisk pixels) | 1 (stateful flyt) |
| Retries | 2 CI / 1 lokalt (pixel-flakiness) | 1 CI / 0 lokalt (statefull, retry maskerer bugs) |
| Når kjøres | Hver PR (visuell paritet) | TODO: blokkende gate før pilot-merge |

Begge bruker chromium og samme `@playwright/test`-dep — bare separate
configs så de ikke konflikter.

## Hvordan testen er designet å fange bugs

Testen er bygget rundt **tre konkrete bugs Tobias har sett 2026-05-13**:

### Bug 1: "Alle brett vises som 20 kr i grid"
Pre-fix leste TicketGrid `state.entryFee` (room.gameVariant default 20).
Lobby-config har korrekt per-bong-pris (5 kr for billigste). Fixen i
`PlayScreen.ts:599-608` prioriterer `lobbyTicketConfig.entryFee` først.

**Test fanger:** Steg 12 sjekker `data-test-ticket-price`-attributter
per brett. Hvis alle viser samme pris → bug.

### Bug 2: "Kan ikke kjøpe flere bonger etter første kjøp"
Pre-fix: popup auto-showet kun én gang per session.

**Test fanger:** Steg 13 forsøker å re-åpne popup eksplisitt og
verifiserer at den dukker opp med ferske qty=0 + samme priser.

### Bug 3: "Feil priser i popup"
Pre-fix: LARGE_TICKET_PRICE_MULTIPLIER var 2 (skal være 3).

**Test fanger:** Steg 7 verifiserer eksakte priser per bongfarge.
Liten white = 5, Stor white = 15 (5 × 3), etc.

## data-test-attributter

Testen bruker `data-test`-attributter (ikke `data-testid`) på inert
elementer. Lagt til i:

- `Game1BuyPopup.ts`: `buy-popup-backdrop`, `buy-popup-row-<slug>`,
  `buy-popup-price-<slug>`, `buy-popup-plus-<slug>`, `buy-popup-minus-<slug>`,
  `buy-popup-qty-<slug>`, `buy-popup-total-kr`, `buy-popup-total-brett`,
  `buy-popup-confirm`, `buy-popup-cancel`
- `BingoTicketHtml.ts`: `ticket-card`, `data-test-ticket-id`,
  `data-test-ticket-color`, `data-test-ticket-type`, `data-test-ticket-price`
- `TicketGridHtml.ts`: `ticket-grid`

Slug-konvensjon: lowercase, hyphenated canonical name
(`Small White` → `small-white`).

Inert i produksjon (nul CSS-impact, kun string-attributter). Last-loaded
nettleser parser dem som strings og lagrer dem direkte — ikke målbar
runtime-cost.

## REST-helpers

`helpers/rest.ts` har Norwegian-named functions for:

- `autoLogin(email)` → `{accessToken, userId, email, hallId, role, walletBalance}`
- `getLobbyState(token, hallId)` → snapshot av lobby-state via aggregator
- `markHallReady(token, hallId)` → `{gameId, allReady}`
- `masterStart(token)` → `{scheduledGameId, planRunId, status, ...}`
- `masterStop(token, reason?)` → void (idempotent)
- `resetPilotState(masterToken)` → stopper pågående spill
- `fetchPurchasesForGame(token, scheduledGameId)` → DB-rader (nullable —
  endpoint finnes ikke nødvendigvis i prod)

Alle throw på non-OK responses; tester skal IKKE retry-e silently.

## Eskalering — når testen finner bug

1. **Test fanger bug, kode må fikses:** Standard PR-flow. Test forblir
   grønn etter fix.
2. **Test fanger bug, men FIX krever arkitektur-endring:** Logg i
   `tests/e2e/BUG_CATALOG.md` (følger i B-fase 2c). Eskaler til Tobias.
3. **Bug-katalog viser ≥ 3 strukturelle bugs:** Trigger plan C
   (arkitektur-rewrite av buy-flow med server pre-rendret ticket-objekter
   og pure-render-klient). Per Tobias-direktiv 2026-05-13.

## Vedlikehold

- **Demo-data:** Når seed-script endrer demo-bruker-IDer eller hall-IDer,
  oppdater konstantene øverst i `spill1-pilot-flow.spec.ts`.
- **Pris-matrix:** `EXPECTED_ROWS` styrer alle pris-asserts. Hvis Tobias
  endrer ticket-prising (eks. lilla-mult fra 3 → 4), oppdater her.
- **data-test:** Klient-utviklere må holde data-test-attrs stabile. Hvis
  popup-struktur endres, oppdater Game1BuyPopup-attrs + testen samtidig.

## Status (2026-05-13)

- ✅ Foundation: config, REST-helpers, data-test-attrs, npm-scripts
- ✅ First test: master + spiller buy-flow + re-open popup (grønn lokalt 13s)
- ⏳ B-fase 2c: Rad-vinst + Fortsett til Rad 2 + auto-start-bug
- ✅ B-fase 3: CI-integration via `.github/workflows/pilot-flow-e2e.yml`

## CI-modus

Workflow `.github/workflows/pilot-flow-e2e.yml` kjører automatisk på PR
mot main hvis kode-paths matcher Spill 1 buy-flow (apps/backend/src/game,
packages/game-client/src/games/game1, tests/e2e, m.fl.).

**Env-vars som triggrer CI-modus:**

- `E2E_DESTROY_ROOMS=1` — `resetPilotState` destruerer GoH-rom eksplisitt
  (default-er også til true lokalt; CI signaliserer intent eksplisitt)
- `CI=true` — Playwright switcher til GitHub-reporter + 1 retry

**Helper `shouldDestroyRoomsForCi()`** i `helpers/rest.ts` brukes av
testkoden til diagnose-logging.

Workflow må starte `node dist/index.js` med `NODE_ENV=test` (ikke
production) slik at `/api/dev/auto-login`-ruten er mountet. Se workflow
for full env-konfig.

**Branch protection:** workflow må registreres som required check via
gh-API etter første grønne kjøring (PM ansvar).
