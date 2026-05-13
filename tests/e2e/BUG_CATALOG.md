# Pilot-flow bug-katalog

Lokalisering av strukturelle vs implementasjons-bugs avdekket av
`tests/e2e/spill1-pilot-flow.spec.ts` (Tobias-direktiv 2026-05-13).

## Kategorisering

- **Strukturell** — fundamentet/arkitekturen er feil. Krever større rewrite
  før test går grønn. Trigger plan C (`docs/architecture/PLAN_C_*`).
- **Implementasjons** — én linje / én fil-fix. Test grønner etter PR.

**Cut-off for plan C:** Hvis ≥ 3 strukturelle bugs avdekkes, eskalér til
Tobias for arkitektur-rewrite av buy-flow.

## Aktive funn (oppdateres mens testen kjøres mot dagens kode)

> Status per 2026-05-13 09:51: testen er under utvikling. Første kjøringer
> har avdekket Lobby-side-state-bug og dev-user-redirect-race. Disse er
> testharness-issues (test-side), ikke kode-bugs.

### Test-harness-issues (fix i test-koden)

| # | Funn | Kategori | Status |
|---|---|---|---|
| H1 | Player-shell defaulter til `hall-default` (første hall i listen), ikke pilot-hall | Test-harness | ✅ Fixet via `sessionStorage.setItem("lobby.activeHallId", "demo-hall-001")` pre-navigate |
| H2 | `?dev-user=…` trigger `window.location.replace()` redirect — Playwright må vente på redirect før klikk | Test-harness | 🟡 Under iterasjon |
| H3 | Bingo-tile click triggers game-bundle download (delay før popup mounter) | Test-harness | 🟡 Forventet — `toBeVisible({timeout:30_000})` skal dekke |

### Implementasjons-bugs (fix i prod-kode)

| # | Funn | Kategori | Fix-PR | Status |
|---|---|---|---|---|
| I1 | LARGE_TICKET_PRICE_MULTIPLIER var 2 i stedet for 3 — Stor-bonger viste feil pris | Implementasjons | #1301 | ✅ Merget |
| I2 | TicketGrid leste `state.entryFee=20` (room.gameVariant default) i stedet for `lobbyTicketConfig.entryFee=5` — alle brett viste 20 kr | Implementasjons | #1303 | ✅ Merget |
| I3 | Armed-to-purchase SQL refererte ikke-eksisterende `hall_id`-kolonne | Implementasjons | #1293 | ✅ Merget |
| I4 | BuyPopup auto-showet kun én gang per session | Implementasjons | #1273 | ✅ Merget |
| I5 | `waitingForMaster` state låste Buy-knappen | Implementasjons | #1279 | ✅ Merget |
| I6 | Game-end resetter rom helt (ROOM_NOT_FOUND ved neste runde) | Implementasjons | #1291 | ✅ Merget |
| I7 | Watchdog auto-cancellet paused rounds | Implementasjons | #1286 | ✅ Merget |
| I8 | `SocketActions.buildScheduledTicketSpec` hardkodet Large = small × 2 i stedet for å bruke `priceMultiplier` direkte fra ticketTypes-tabellen (3/6/9 for Large white/yellow/purple). Buy-API avviste med `INVALID_TICKET_SPEC: "Pris for white/large matcher ikke spillets konfig (forventet 1500 øre)"`. Fix: bruk `ticketType.priceMultiplier` direkte siden lobbyTicketConfig allerede har korrekt verdi (3/6/9). | Implementasjons | feat/autonomous-pilot-test-loop-2026-05-13 | 🟡 PR pending |
| I9 | `TicketGridHtml.computePrice` brukte `state.ticketTypes` (8 legacy small_yellow-style types) for å mappe ticket.type → priceMultiplier, men server-rendrede tickets bruker `(size, color)`-modell (`type: "small"/"large"`, `color: "white"/"yellow"/"purple"`). Find returnerte feil entry → multiplier=1 → alle brett viste samme pris (5 kr). Fix: pass `lobbyTicketConfig.ticketTypes` til TicketGridHtml.setTickets og match på (name contains color) + (type matches size). | Implementasjons | feat/autonomous-pilot-test-loop-2026-05-13 | 🟡 PR pending |
| I10 | `Game1BuyPopup.showWithTypes` nullstilte `uiState`, `typeRows`, `buyBtn` ved re-open, men IKKE `cancelBtn` (opacity 0.5, disabled, cursor:default fra `handleBuy()` → `showResult()`-pathen). Re-åpnet popup hadde stale cancelBtn-state → Avbryt-knapp ikke klikkbar. Fix: eksplisitt reset av `cancelBtn.disabled = false`, opacity = 1, cursor = pointer ved hver showWithTypes-init. | Implementasjons | feat/autonomous-pilot-test-loop-2026-05-13 | 🟡 PR pending |
| I11 | `/api/admin/rooms/<code>/draw-next` returnerer `USE_SCHEDULED_API` for scheduled Spill 1 (`gameSlug=bingo`). BingoEngine `drawNextNumber` for scheduled-runder kaster med beskjeden "Scheduled Spill 1 må trekkes via Game1DrawEngineService — ikke BingoEngine." Ingen public/admin REST-endpoint finnes for å trigge scheduled-game-drawNext utenfor cron-tick eller socket-event. Konsekvens: tester kan ikke akselerere draws — må vente på auto-tick (4s interval per `Game1AutoDrawTickService.defaultSeconds`). Forslag: legg til `POST /api/admin/game1/games/:gameId/draw-next` som wrapper rundt `Game1DrawEngineService.drawNext(scheduledGameId)`. | Implementasjons (ikke pilot-blokker) | TODO | 📋 Foreslått (Rad-vinst-test) |
| I12 | `/api/_dev/game-state-snapshot` returnerer SPA-HTML (200 OK med index.html) hvis `RESET_TEST_PLAYERS_TOKEN`-env-var ikke er satt. Route should fail-closed med 503 + JSON-error (eller returnere 404 så fall-through til SPA stoppes). Aktuell oppførsel forvirrer test-clients som forventer JSON. Fix: legg til check tidligere i request-pipeline (før SPA-fallback). | Implementasjons (test-infra) | TODO | 📋 Foreslått (Rad-vinst-test) |
| I13 | Demo-hall (`is_test_hall=TRUE`) auto-pauser likevel ved Rad-vinst, motsatt av hva migration `20261110000000_app_halls_is_test_hall.sql:38` claimer ("bypasser pause/end-on-pattern-flyt"). Test-run viste `isPaused=true, pausedAtPhase=N` etter Rad-vinst på demo-hall-001. Enten er dokumentasjon stale eller `BINGO_TEST_HALL_BYPASS_RTP_CAP`-env-var må også settes. Praktisk konsekvens for test: Rad-vinst-test kan trygt forvente auto-pause på demo-hall. | Doc/kode-mismatch | TODO | 📋 Flagget (Rad-vinst-test) |

### Strukturelle bugs (krever større endring)

> Per 2026-05-13 09:51: **ingen strukturelle bugs identifisert via test enda.**
> Plan C-trigger er IKKE aktivert.

| # | Funn | Hvorfor strukturell | Foreslått fix | Status |
|---|---|---|---|---|
| _(ingen)_ | — | — | — | — |

### Verifiserte ikke-bugs (test bekrefter forventet atferd)

> Tester som ble lagt til etter rapport, men kunne IKKE reprodusere
> rapporterte bug på `main`. Tjener som permanente regresjons-vern.

| # | Rapport | Test-fil | Faktisk root-cause | Status |
|---|---|---|---|---|
| V1 | "runden startet automatisk etter jeg kjøpte bong" (Tobias 2026-05-13) | `tests/e2e/spill1-no-auto-start.spec.ts` | UI-misdisplay: master-konsoll viste "Aktiv trekning" for `purchase_open`/`ready_to_start` (fixed i commit `6b90b32e` 2026-05-12). DB-status var ALDRI auto-flippet til `running`. Test verifiserer: status=`purchase_open`/`ready_to_start` etter 1 buy + 10s wait, OG etter 3 raske buys + 15s wait. `actualStartTime` forblir null. Master må eksplisitt kalle `/api/agent/game1/master/start` for å trigge `running`. | ✅ Permanent regression-watch |

## Når katalogen brukes

1. **Test feiler → første-undersøkelse:** Er det test-side eller kode-side?
   - Logg under "Test-harness-issues" hvis test-koden.
   - Logg under "Implementasjons-bugs" eller "Strukturelle bugs" hvis prod-kode.

2. **Implementasjons-bug:** Standard PR-flow. Sett `Fix-PR` etter merge.

3. **Strukturell bug:** Beskriv WHY structural i kolonnen
   "Hvorfor strukturell". Eks:
   - "Krever endring i hvordan ticket-typer rendres på server vs klient"
   - "Krever ny outbox-tabell for å unngå race"
   - "Krever bytte av lobby-flow fra hall-spesifikk til GoH-spesifikk"

4. **≥ 3 strukturelle bugs:** Eskalér til Tobias og lag
   `docs/architecture/PLAN_C_BUY_FLOW_REWRITE_<dato>.md`.

## Format-mal for nye funn

```markdown
| <N> | <Kort beskrivelse> | <Strukturell/Implementasjons> | <PR-nr eller TODO> | <Status> |
```

Status-verdier:
- 🔴 **Bekreftet** — sett av test-failure, ikke fikset
- 🟡 **Under iterasjon** — PR åpen, ikke merget
- ✅ **Merget** — fikset i main
- ⚠️ **Avhenger av** — blokkert av annen PR

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — etablert template + listet 7 allerede-fiksede implementasjons-bugs | PM-AI (Claude Opus 4.7) |
| 2026-05-13 | E2E-test grønn etter fixes for I8/I9/I10 (SocketActions multiplier, TicketGrid mapping, BuyPopup cancelBtn-reset). Test kjører i 12.3s deterministic. | Autonomous-pilot-test-loop agent |
| 2026-05-13 | Lagt til V1 (no-auto-start regression). Test verifiserer at REST `/api/game1/purchase` ALDRI auto-trigger `status=running` for Spill 1. Tobias' rapporterte "auto-start" var UI-misdisplay-bug fra PR #1277, fixed i commit 6b90b32e før denne testen ble skrevet. Test grønn i 27s for 2 scenarios (single buy + stress 3 raske buys). | feat/pilot-test-no-auto-start-2026-05-13 agent |
| 2026-05-13 | Rad-vinst-flow E2E test grønn (4 consecutive runs PASS, 48-60s). I11/I12/I13 lagt til (admin draw-next blokkert, snapshot-route fail-mode, test-hall auto-pause mismatch). `spill1-rad-vinst-flow.spec.ts` + `helpers/rad-vinst-helpers.ts` + WinPopup data-test-attributes pushed på `feat/pilot-test-rad-vinst-2026-05-13`. | general-purpose agent |
