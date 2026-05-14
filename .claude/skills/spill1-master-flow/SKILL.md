---
name: spill1-master-flow
description: When the user/agent works with Spill 1 master-konsoll, plan-runtime, scheduled-game lifecycle, GoH-master-rom, or hall-ready-state. Also use when they mention master-actions, GamePlanRunService, GamePlanEngineBridge, Game1MasterControlService, Game1HallReadyService, Game1TransferHallService, Game1ScheduleTickService, Game1LobbyService, GameLobbyAggregator, MasterActionService, NextGamePanel, Spill1HallStatusBox, Spill1AgentControls, plan-run-id, scheduled-game-id, currentScheduledGameId, master-hall, ekskluderte haller, "Marker Klar", "Start neste spill", master-flyt, plan-runtime-koblingen, ADR-0021, ADR-0022, stuck-game-recovery, I14, I15, I16, BIN-1018, BIN-1024, BIN-1030, BIN-1041. Make sure to use this skill whenever someone touches the master/agent UI, plan or scheduled-game services, or anything related to who controls a Spill 1 round — even if they don't explicitly ask for it.
metadata:
  version: 1.4.0
  project: spillorama
---

<!-- scope: apps/backend/src/game/Game1*, apps/backend/src/game/MasterActionService.ts, apps/backend/src/game/GamePlanRunService.ts, apps/backend/src/game/GamePlanRunCleanupService.ts, apps/backend/src/game/GamePlanEngineBridge.ts, apps/backend/src/game/GameLobbyAggregator.ts, apps/backend/src/game/Spill1LobbyBroadcaster.ts, apps/backend/src/game/BingoEngine.ts, apps/backend/src/game/BingoEngine.spill1*.test.ts, apps/backend/src/routes/agentGame1*.ts, apps/backend/src/routes/agentGamePlan.ts, apps/backend/src/routes/adminGame1*.ts, apps/backend/src/jobs/game1*.ts, apps/backend/src/jobs/gamePlanRunCleanup.ts, apps/backend/src/__tests__/MasterActionService*.test.ts, apps/backend/src/game/__tests__/GamePlan*.test.ts, apps/backend/src/game/__tests__/GameLobbyAggregator*.test.ts, apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts, apps/admin-web/src/pages/agent-portal/Spill1*.ts, apps/admin-web/src/pages/games/master/Game1MasterConsole.ts -->

# Spill 1 — Master-flyt og plan/scheduled-game-kobling

Spill 1 (slug-familie `bingo`, 13 katalog-varianter) er hovedspill-fundamentet for Spillorama-pilot. Master-konsollet styrer plan-runtime + scheduled-games + per-hall ready-state for 4 pilot-haller (Teknobingo Årnes som master + Bodø + Brumunddal + Fauske). Fundamentet er kompromisert av en ID-disambiguasjons-bug og er under aktiv refaktor (Bølge 1-3, 2026-05-08).

## Kontekst — hvorfor er dette kritisk?

**Lese-først-doc-er:**
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` — autoritativ status, all flyt, immutable beslutninger
- `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` — rotårsak-analyse for ID-disambiguasjons-bug og refaktor-plan
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` — kanonisk premie-mekanikk (auto-multiplikator, pot-deling, Trafikklys/Oddsen)
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — Evolution Gaming-grade oppetidsmål

Pilot-direktiv 2026-05-08 (Tobias):
> "Det er ekstremt viktig at fundamentet her er godt dokumentert slik at fremtidige PM/agenter har full forståelse og ikke fraviker fra planen."

## Den viktigste regelen — ID-disambiguasjon

**Det finnes TO ID-rom som krangler i UI-laget:**

| ID | Tabell | Hva det er | Hvor master-actions går |
|---|---|---|---|
| `plan-run-id` | `app_game_plan_run.id` | Plan-runtime-state per (hall, businessDate) | Plan-state-overganger (idle→running→paused) |
| `scheduled-game-id` | `app_game1_scheduled_games.id` | Engine-state per faktisk runde | **ALLE master-actions (start/pause/resume/stop)** |

**Regel:** Master-handlinger (pause, resume, stop, exclude-hall) MÅ alltid sendes med `scheduled-game-id`, aldri med `plan-run-id`. Dette er roten til pause-bugen i PR #1041 — `adaptGamePlanToLegacyShape` satte `currentGame.id = run.id` (plan-run-id), men backend krevde `app_game1_scheduled_games.id`.

**Ny kontrakt (Bølge 1, 2026-05-08):** `GameLobbyAggregator` eksponerer `currentScheduledGameId` som **ENESTE** id-felt UI bruker for master-actions. Aldri plan-run-id. Eksponert via `GET /api/agent/game1/lobby?hallId=X`.

## Kjerne-arkitektur

### Master-flyt ende-til-ende

```
1. Admin oppretter spilleplan
   /admin/#/games/plans/new → GoH eller hall (XOR), ukedager, åpningstid, drar inn 13 katalog-spill
2. Admin setter master-hall på GoH
   /admin/#/groupHall → master-hall-dropdown (BIN-1034) → app_hall_groups.master_hall_id
3. Master-agent åpner /admin/agent/cash-in-out
   → plan-runtime lazy-creates plan-run (status=idle)
   → "MIN HALL" + "ANDRE HALLER I GRUPPEN"-seksjoner med ready-pills
4. Master klikker "Start neste spill"
   POST /api/agent/game-plan/start
   → GamePlanRunService.start() — oppretter run
   → GamePlanEngineBridge.createScheduledGameForPlanRunPosition() — INSERT app_game1_scheduled_games
   → Game1MasterControlService.startGame() — engine begynner
   → Spill1LobbyBroadcaster.broadcastForHall() — emit til klienter
5. Engine kjører — Game1DrawEngineService trekker baller, compliance-ledger, TV+spiller-klient via Socket.IO
6. Spillere markerer numre — socket-event ticket:mark med clientRequestId for idempotens (BIN-1028)
7. Vinner-deteksjon — engine sjekker pattern (Rad 1-4, Fullt Hus), pot-per-bongstørrelse-utbetaling (§9 i regel-doc)
8. Master pause/fortsett — POST /api/admin/game1/games/<scheduled-game-id>/pause (NB: scheduled-game-id, ikke plan-run-id, BIN-1041)
9. Master advance — POST /api/agent/game-plan/advance → ny scheduled-game spawnet for plan-position+1
10. Etter plan.endTime → run.status=finished, rommet stenger
```

### Backend-services

| Service | Fil | Ansvar |
|---|---|---|
| `BingoEngine` | `apps/backend/src/game/BingoEngine.ts` | Hovedengine for 75-ball 5×5 |
| `Game1MasterControlService` | `apps/backend/src/game/Game1MasterControlService.ts` | Master-handlinger mot scheduled-games (start, pause, advance) |
| `Game1HallReadyService` | `apps/backend/src/game/Game1HallReadyService.ts` | Per-hall ready-state per scheduled-game |
| `Game1LobbyService` | `apps/backend/src/game/Game1LobbyService.ts` | Lobby-state-aggregat for SPILLER-shell (R1) |
| `GameLobbyAggregator` (Bølge 1, 2026-05-08) | `apps/backend/src/game/GameLobbyAggregator.ts` | **Kanonisk** lobby-state for MASTER/AGENT-konsoll. Erstatter dual-fetch + adapter. |
| `Spill1LobbyBroadcaster` | `apps/backend/src/game/Spill1LobbyBroadcaster.ts` | Fan-out til lobby-rom (R1) |
| `Game1ScheduleTickService` | `apps/backend/src/game/Game1ScheduleTickService.ts` | Auto-flip scheduled→purchase_open→running (LEGACY parallel-spawn) |
| `GamePlanEngineBridge` | `apps/backend/src/game/GamePlanEngineBridge.ts` | Spawner scheduled-games fra plan-runtime, idempotent på (run_id, position) |
| `GamePlanRunService` | `apps/backend/src/game/GamePlanRunService.ts` | Plan-run-state-machine idle→running→paused→finished |
| `Game1TransferHallService` | `apps/backend/src/game/Game1TransferHallService.ts` | 60s-handshake for runtime master-overføring |
| `GamePlanRunCleanupService` | `apps/backend/src/game/GamePlanRunCleanupService.ts` | Reconcile-mekanismer for stuck plan-runs (se Reconcile-seksjon under) |

### Reconcile-mekanismer for stuck plan-runs (PR #1407, oppdatert 2026-05-14)

Spill 1 plan-runs kan ende i `status='running'` UTEN at master har advanced eller finished planen. Tre komplementære reconcile-lag fanger forskjellige scenarier:

| Lag | Trigger | Audit-event | Når kjører |
|---|---|---|---|
| 1. **Master-action-reconcile** (PR #1403) | Master kaller `start()` eller `advanceToNext()` | `plan_run.reconcile_stuck` | Manuelle handlinger |
| 2. **Daglig cron 03:00 Oslo** (eksisterende) | `business_date < CURRENT_DATE` | `plan_run.cron_cleanup` | Gårsdagens leftover |
| 3. **Naturlig runde-end-poll** (PR #1407, ny) | Plan-run=running + scheduled-game=completed > 30s | `plan_run.reconcile_natural_end` | Mellom-runder NÅR (typisk Spill 1) |

**ALDRI fjern lag 3 uten å verifisere alle scenarier:**
- Master glemmer å klikke "advance" etter at runde naturlig endte → lag 3 fanger
- Master krasj/disconnect midt mellom runder → lag 3 fanger
- Pilot-flyt der master pauser mellom hver runde → lag 3 fanger
- PR #1403 (lag 1) dekker BARE manuell master-handling, ikke naturlig runde-end
- Cron (lag 2) kjører bare på gårsdagens, fanger ikke i-dag-runder

**Konfig (lag 3):**
- Threshold: env `PLAN_RUN_NATURAL_END_RECONCILE_THRESHOLD_MS` (default 30000ms)
- Poll-interval: lik threshold
- Soft-fail på Postgres 42P01 (fresh DB)

**Tester som beskytter mot regresjon:**
- `apps/backend/src/game/__tests__/GamePlanRunCleanupService.naturalEndReconcile.test.ts` (12 unit-tester)
- `apps/backend/src/jobs/__tests__/gamePlanRunNaturalEndReconcile.test.ts` (14 job-tester)
- `apps/backend/src/__tests__/GamePlanRunCleanupService.naturalEndReconcile.integration.test.ts` (2 integration mot Postgres)

**Symptom hvis lag 3 fjernes:** "Laster..." infinity i klient når master ikke advancer etter naturlig runde-end. Room-snapshot mangler `currentGame`. Tobias-rapport 2026-05-14 — bug-en bringer pilot-flyt til stillstand.

### UI-komponenter (admin-web)

| Fil | Hva |
|---|---|
| `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts` | Polling 2s, render hall-status + master-knapper. Bruker dual-fetch + merge (deprecated etter Bølge 3) |
| `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` | Hybrid Spill 1/2/3-panel med master-handlinger |
| `apps/admin-web/src/pages/agent-portal/Spill1AgentControls.ts` | Render-only, knapper med `data-action` |
| `apps/admin-web/src/pages/agent-portal/Spill1AgentStatus.ts` | Render hall-status pills |
| `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts` | Admin direct-edit master-konsoll, KUN scheduled-game-id (referanse-implementasjon) |
| `apps/admin-web/src/api/agent-game-plan-adapter.ts` | **DEPRECATED** — adapter setter `currentGame.id = run.id` (lyver om id) |
| `apps/admin-web/src/api/agent-master-actions.ts` | **DEPRECATED** — wrapper kaller plan→legacy sekvensielt |

## Inconsistency-warnings fra GameLobbyAggregator

Bølge 1-aggregator returnerer `inconsistencyWarnings[]` med stabile koder. Bølge 2 reconciliere på dem, Bølge 3 viser feilbannere:

| Kode | Betydning |
|---|---|
| `PLAN_SCHED_STATUS_MISMATCH` | plan-run.status og scheduled-game.status er ute av synk (eks. plan=running, scheduled=cancelled) |
| `MISSING_GOH_MEMBERSHIP` | Hall ble fjernet fra GoH etter scheduled-game spawn (stale `participating_halls_json`) |
| `STALE_PLAN_RUN` | plan-run.status=running men ingen aktiv scheduled-game finnes |
| `BRIDGE_FAILED` | `createScheduledGameForPlanRunPosition` kastet feil siste forsøk |
| `DUAL_SCHEDULED_GAMES` | Både legacy `Game1ScheduleTickService`-spawn og bridge-spawn har skapt rader for samme (hall, dato) |

Aggregator throw KUN ved infrastruktur-feil (`LOBBY_AGGREGATOR_INFRA_ERROR` → 5xx). Alle "data ser rar ut"-scenarioer flagges som warnings, aldri throw.

## Per-hall lobby + GoH-master-rom

**Klient-rom-konsept (R1 / BIN-822 / 1033):**
- Klient kobler til `spill1:lobby:{hallId}` ved hall-valg
- Henter state via `GET /api/games/spill1/lobby?hallId=X`
- State: `{ isOpen, openingTimeStart, openingTimeEnd, nextScheduledGame, runStatus, overallStatus }`
- Innenfor åpningstid + ingen aktiv runde → "Neste spill: <name> (om X min)"
- Aktiv runde → bytter til runde-modus (live trekk + pattern-evaluering)
- Etter Fullt Hus → tilbake til lobby-modus
- Etter `plan.endTime` → "Stengt"-melding

**Reconnect-flyt (R5 idempotency, BIN-1028):**
- `clientRequestId` (UUID v4) på alle socket-events
- Server dedup-erer i Redis med 5-min TTL
- Cache-key: `(userId, eventName, clientRequestId)`
- Marks/claims/buys cache-es lokalt under disconnect, replay-es etter reconnect

## Hall-switching state-refresh (lobby.js, 2026-05-14)

Når bruker bytter hall i `/web/`-lobby-dropdown (`apps/backend/public/web/lobby.js:switchHall`), MÅ disse stegene skje atomisk:

1. **Idempotens-sjekk:** Hvis ny hallId === gammel → no-op (ingen network-roundtrips).
2. **Aktiv-runde-vakt:** Hvis `isWebGameActive()` (Pixi container vises) → `window.confirm("Bytte hall vil avslutte pågående runde. Vil du fortsette?")`. Nei → revert via re-render, ja → unmount via `returnToShellLobby()` (som re-loader full lobby).
3. **Update state:** `lobbyState.activeHallId` + `sessionStorage.lobby.activeHallId`.
4. **Sync bridges:** `window.SetActiveHall(hallId, hallName)` (spillvett.js) + `dispatchEvent("spillorama:hallChanged")`.
5. **Parallell-refetch (Promise.all):**
   - `/api/wallet/me` (balance, cache-buster)
   - `/api/wallet/me/compliance?hallId=...`
   - `/api/games/spill1/lobby?hallId=...` ← per-hall Spill 1 status
   - `/api/games/status` ← global, for Spill 2/3 perpetual (uendret)
6. **Re-render game-tiles** med oppdatert badge-status.

**ALDRI fjern step 5.3 (`loadSpill1Lobby`)** — `/api/games/status` er GLOBAL og kan ikke besvare per-hall-spørsmål. Spiller ville da sett feil "Åpen/Stengt"-status etter bytte (PITFALLS §7.17).

**Per-hall badge-mapping** (`buildSpill1StatusBadge` i lobby.js):

| `Game1LobbyState.overallStatus` | Badge |
|---|---|
| `running`, `purchase_open` | Åpen (grønn) |
| `ready_to_start` | Starter snart / Starter HH:MM |
| `paused` | Pauset |
| `idle` (med nextScheduledGame) | Starter HH:MM |
| `idle` (uten nextScheduledGame) | Venter |
| `closed`, `finished` | Stengt (rød) |

Fail-soft: hvis `/api/games/spill1/lobby` feiler, falle tilbake til global `gameStatus['bingo']` for å ikke vise feil til kunde.

**Tester:** `apps/admin-web/tests/lobbyHallSwitcher.test.ts` (13 tester, jsdom + mock-fetch).

## Master-rolle-modellen (Tobias 2026-05-08)

Master = bingovert med mer ansvar. INGEN egen brukerrolle — håndheves via route-guard på `master_hall_id` matching agentens `hall_id`.

**Master-handlinger:**
- ✅ Master kan starte/stoppe **uavhengig** av om andre haller er klare (ready-status er KUN informativ, ikke gate)
- ❌ Master kan **aldri** hoppe over neste spill i sekvensen (alltid umiddelbart neste i spilleplan-rekkefølgen)
- ❌ Ingen "Avbryt spill"-knapp for master (flyttet til admin-only — regulatorisk-tung)
- ❌ Ingen "Kringkast Klar + 2-min countdown" (master starter direkte)

**Master-overføring:** `Game1TransferHallService` 60s-handshake. Ved godkjent overføring oppdateres `app_hall_groups.master_hall_id` (eller midlertidig override på scheduled-game-rad).

## Immutable beslutninger (det som ALDRI endres uten Tobias)

1. **Spill 1 gevinstmønstre er låst:** Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus. Nye mønstre (Bokstav, T/L/X, Pyramide) hører hjemme på Spill 3.
2. **Master starter uavhengig av ready-state** — ready-pill er informativ, ikke gate.
3. **Master kan ikke skip neste spill** — alltid umiddelbart neste i sekvensen.
4. **Lobby-rom er åpent innenfor `plan.startTime` til `plan.endTime`** — spillere kan kjøpe bonger til kommende spill.
5. **Ingen single-prize cap på hovedspill** — kun databingo (SpinnGo) har 2500 kr-cap. Lilla-bong får 3000 kr på Innsatsen Fullt Hus, 4500 kr på Oddsen-HIGH.
6. **Multi-vinner pot-deling per bongstørrelse** (BIN-997, ikke flat-deling, ikke per-vinner-uavhengig). Se SPILL_REGLER_OG_PAYOUT.md §9.
7. **GoH master-hall er pinnet via `app_hall_groups.master_hall_id`** (BIN-1034). Bridge bruker det som `effectiveMasterHallId` — fallback til `run.hall_id` hvis pinnet hall er deaktivert.
8. **Pilot-omfang: 4 haller.** Utvidelse betinger 4-hall-pilot grønn 2 uker + R4 (load-test 1000) bestått + R6 (outbox-validering) bestått.

## Vanlige feil og hvordan unngå dem

### 1. Sender plan-run-id til master-actions
Symptom: `pauseGame1(currentGame.id)` returnerer 400 "Game not found" eller 0 rows updated.
**Fix:** Bruk `currentScheduledGameId` fra ny `GET /api/agent/game1/lobby`-aggregator, ALDRI `state.spill1.currentGame.id` fra deprecated adapter.

### 2. Lager NY GoH via UI når seed-GoH allerede finnes
Symptom: Seed-data har scheduled-games koblet til en GoH-id, men admin-UI skapt en NY GoH med ny id. Hard-delete-cascade fjerner alle scheduled-games for seed-GoH.
**Fix:** Rediger seed-GoH heller enn å lage ny. Hvis du må slette en GoH med scheduled-games, vit at FK-cascade (BIN-1038) fjerner alle relaterte rader.

### 3. Ignorerer `inconsistencyWarnings[]`
Symptom: UI viser "alt fint" mens DB har stale `participating_halls_json` eller dual scheduled-games.
**Fix:** I Bølge 3 skal warnings vises som feilbannere. Aldri silent-swallow.

### 4. Phantom-rom etter restart
Symptom: Backend gjenoppretter rooms fra Redis ved restart, men staletilstand kan henge igjen.
**Fix:** Drep backend, FLUSHALL Redis, restart for ren state.

### 5. Endrer Spill 1 og forventer at Spill 2/3 påvirkes
Symptom: Endring i `GamePlanEngineBridge` eller `GamePlanRunService` påvirker IKKE Spill 2/3. Spill 2/3 har INGEN plan-state.
**Fix:** Verifiser via SPILL2/3_IMPLEMENTATION_STATUS hvilke services som er per-spill vs delt.

### 6. Endrer auto-multiplikator-regel uten å oppdatere bridge
Symptom: `GamePlanEngineBridge.buildTicketConfigFromCatalog` skriver auto-mult-skalert pris i `ticket_config_json`. Hvis du endrer regel i `GameCatalogService.calculateActualPrize`, må du også sjekke bridge.
**Fix:** Test pre-game-spawn med nye katalog-tall i `apps/backend/src/game/GamePlanEngineBridge.test.ts`.

### 7. I14 — plan-run vs scheduled-game ID-mismatch (fikset 2026-05-13)
Symptom: Master pause/resume går mot plan-run-id istedenfor scheduled-game-id → 400 "Game not found".
**Root cause:** Dual-fetch + adapter satte feil id i `currentGame.id`.
**Fix:** Single-source `GameLobbyAggregator` med `currentScheduledGameId`. Master-action-service (PR #1241) verifiserer at id-feltet tilhører scheduled-game.
**Test:** `apps/backend/src/__tests__/MasterActionService*.test.ts` (33 unit-tester).

### 8. I15 — re-entry-during-draw (fikset 2026-05-13)
Symptom: Spiller koblet til `spill1:scheduled-{gameId}`-rom mens draw pågår → `ROOM_LOCKED`-error.
**Root cause:** Manglet re-attach-guard i `joinScheduledGame` for "spiller var her, koblet av, koblet på igjen"-flyten.
**Fix:** Re-attach-guard sjekker om spillerens `playerId` allerede finnes i room-state.
**PR:** #1325 (`fix(spill1): re-attach-guard i joinScheduledGame — fikser I15`).

### 9. I16 — master-action-timing-bug (fikset 2026-05-13)
Symptom: Master-action sendt midt mellom plan-mutering og bridge-spawn → orphan scheduled-game.
**Root cause:** Race condition i sekvensering plan-mutering + bridge.
**Fix:** `MasterActionService` (PR #1241 ADR-0022) — single-entry sekvenseringsmotor som vet om plan-run + scheduled-game-id. Inkluderer multi-lag stuck-game-recovery: (1) lobby-poll auto-reconcile, (2) periodic stuck-game scan, (3) admin-override, (4) DR-runbook fallback.
**Test:** Mutation testing dekker `MasterActionService.ts` (2077 LOC) per `apps/backend/stryker.config.json`.

### 10. Master starter med 0 spillere (ADR-0021, 2026-05-11)
Symptom: UI viser `MASTER_HALL_RED` selv om master vil starte uten registrerte spillere.
**Fix:** ADR-0021 — fjernet `MASTER_HALL_RED`-gate. Master kan starte uten solgte bonger.
**PR:** #1177 (`feat(master-control): allow master start with 0 players`).
**Konsekvens for skill:** Hvis du sjekker "har vi nok spillere?" som pre-start-gate, det er IKKE Spill 1 sin ansvar. Master har frihet til å starte når han vil.

### 11. Stale plan-run fra gårsdagen blokkerer dagens master-actions
Symptom: `STALE_PLAN_RUN`-warning på lobby + master kan ikke starte.
**Fix:** `GamePlanRunCleanupService` — cron 03:00 Oslo auto-finishes alle `status IN ('running','paused')` med `business_date < CURRENT_DATE`. Inline self-heal-hook bound til `getOrCreateForToday`. Audit-event `game_plan_run.auto_cleanup`.

### 13. Innsats + Forhåndskjøp dobbel-telling (PR #<this-PR>, 2026-05-14)

Symptom: Spiller-shell (LeftInfoPanel) viser BÅDE `Innsats: 30 kr` og `Forhåndskjøp: 30 kr` etter at bruker har kjøpt 3 bonger PRE-game. Korrekt: kun `Innsats: 30 kr`.

**Tobias-direktiv 2026-05-14 (KANONISK):**
- Bonger kjøpt **FØR** runde starter → telles som **INNSATS** for kommende/aktive spill
- Bonger kjøpt **MIDT i** runde → telles som **FORHÅNDSKJØP** for **neste runde**
- ALDRI tell samme bonge i begge

**Root cause:** Pre-game `bet:arm` setter `armedPlayerSelections` i `RoomStateManager`. `Game1ArmedToPurchaseConversionService.convertArmedToPurchases` konverterer dem til DB-purchase-rader når master starter runden — men hooken `runArmedToPurchaseConversionForSpawn` glemte å kalle `roomState.disarmPlayer(roomCode, playerId)` etter conversion. `buildRoomUpdatePayload` (roomHelpers.ts:572) regnet BÅDE `playerStakes` (fra gameTickets) OG `playerPendingStakes` (fra lingering armedPlayerSelections) → samme kjøp talt to ganger.

**Fix (PR #<this-PR>):** `runArmedToPurchaseConversionForSpawn()` i `apps/backend/src/index.ts` kaller nå `roomState.disarmPlayer(roomCode, playerId)` for hver successful conversion. Speiler `gameLifecycleEvents.ts:153`-mønsteret som er etablert for generisk `BingoEngine.startGame`-flyt.

**Tester:** `apps/backend/src/util/roomHelpers.armedConversionIsolation.test.ts` — 7 scenarier (pre-game-only, mid-round-additive, multi-color, spectator, idempotens, round-transition + negativ regresjons-test).

**Konsekvens for skill:** Hvis du legger til ny scheduled-game-spawn-vei eller endrer conversion-hooken, sørg ALLTID for at armed-state cleares post-conversion. `buildRoomUpdatePayload` er ren funksjonell — bug-en ligger i caller-state, ikke i payload-funksjonen.

### 12. Pre-game viser 20 kr per bong istedenfor 10 kr (Yellow) / 30 kr istedenfor 15 kr (Purple)
Symptom: Spillere som åpner buy-popup PRE-game (mellom runder, eller før master har trykket "Start") ser feil priser. Backend room-snapshot returnerer `gameVariant.ticketTypes` med flat `priceMultiplier: 1` for ALLE farger istedenfor riktige per-farge multipliers (Yellow=2, Purple=3).

**Rot-årsak (regresjon 2026-05-14):** PR #1375 (`Game1MasterControlService.onEngineStarted`) løste KUN post-engine-start-pathen. Pre-game-vinduet — fra scheduled-game opprettes (`status='ready_to_start'`) til master trykker "Start" — var ikke dekket. Klient (`PlayScreen.ts:606`) faller til `state.entryFee ?? 10` og multipliserer med flat `priceMultiplier: 1` → `10 × 2 = 20 kr` for Yellow (eksempel: Tobias-rapport 2026-05-14 07:55).

**Fix:** To-fase ticket-config-binding (PR #1375 + PR #<this-PR>). Se seksjon under for detaljer.

## Ticket-pris-propagering (kritisk TRE-fase-binding)

> **Tobias-direktiv 2026-05-14:** Fremtidige agenter MÅ ikke overskrive denne fixen. Hvis du jobber med ticket-pris-pipeline må du forstå at ALLE tre faser er nødvendige.

**Hvorfor TRE-fase-binding:**

Spillorama har TO distinkte tilstander for et room:
1. **Pre-game:** scheduled-game er INSERT-et med `status='ready_to_start'`, men master har ikke trykket "Start". Engine kjører IKKE ennå, men klient kan joine rommet og åpne buy-popup.
2. **Post-engine-start:** Master har trykket "Start", `engine.startGame()` har returnert.

Begge faser krever at `roomState.roomConfiguredEntryFeeByRoom` + `variantByRoom` er bundet til riktige verdier fra `ticket_config_json`. Hvis ikke faller klient til default-fallback (`state.entryFee ?? 10` × flat `priceMultiplier: 1`).

**Men entryFee alene er ikke nok.** Klient leser ticket-priser fra TO kilder:
- (A) `lobby.nextGame.ticketPricesCents` → korrekt via `lobbyTicketTypes.buildBuyPopupTicketConfigFromLobby` (alltid riktig hvis lobby-API kjører)
- (B) `state.ticketTypes` (room:update snapshot) → MÅ ha korrekte per-farge `priceMultiplier`-verdier

Fase 0 (kilden) + Fase 1 + Fase 2 dekker entryFee. Fase 2 (variantConfig-mapping) MÅ ALSO mappe `priceNok` til per-farge multipliers i `gameVariant.ticketTypes`.

### Fase 0 (kilde): `ticket_config_json` har `spill1.ticketColors[].priceNok`

`GamePlanEngineBridge.buildTicketConfigJsonFromCatalog` skriver kanonisk `spill1.ticketColors[]`-blokk per (color, size) med korrekt `priceNok` i kr. Bridgen håndterer auto-multiplier på catalog-Rad-base (calculateActualPrize). Verifisert OK per `GamePlanEngineBridge.rowPayout.test.ts:148-158`.

### Fase 1 (pre-engine entryFee-binding, PR #1408)

Hook: `GamePlanEngineBridge.onScheduledGameCreated`

- **Trigger:** POST-INSERT av `app_game1_scheduled_games`-rad i `createScheduledGameForPlanRunPosition`
- **Wired i:** `apps/backend/src/index.ts` via `gamePlanEngineBridge.setOnScheduledGameCreated(...)`
- **Input:** `{ scheduledGameId, roomCode, ticketConfigJson }` (ticket_config_json kommer direkte fra bridgen, ingen ekstra SELECT)
- **Tre steg:** (1) bind `roomConfiguredEntryFeeByRoom` (billigste bongpris i kr), (2) re-bind `variantByRoom` via `buildVariantConfigFromGameConfigJson`, (3) `emitRoomUpdate(roomCode)`

### Fase 2 (variantByRoom per-farge multipliers, PR #1411 — sub-bug PR #1408)

Funksjon: `spill1VariantMapper.buildVariantConfigFromSpill1Config`

- **Trigger:** Kalt av `buildVariantConfigFromGameConfigJson` (i Fase 1 + Fase 3).
- **Hva fixen gjør:** Beregner `minPriceNok` på tvers av alle konfigurerte farger, og kaller `ticketTypeFromSlug(color, priceNok, minPriceNok)` for hver. Auto-multiplier-baseline: `priceNok / minPriceNok`. Speiler `lobbyTicketTypes.buildBuyPopupTicketConfigFromLobby`-matematikken eksakt.
- **Output:** `gameVariant.ticketTypes[]` med korrekte per-farge multipliers. Standard Bingo (5/10/15 kr): `[1, 3, 2, 6, 3, 9]`. Trafikklys (flat 15 kr): `[1, 3]`.
- **Backward-compat:** Hvis `priceNok` mangler eller er ugyldig (0/NaN/null), faller mapperen til legacy-hardkodet multipliers (1/3/2). Beskytter eksisterende tester og legacy-config.

### Fase 3 (post-engine re-binding, PR #1375)

Hook: `Game1MasterControlService.onEngineStarted`

- **Trigger:** POST-commit + POST-engine.startGame i `startGame`-suksess-path
- **Wired i:** `apps/backend/src/index.ts` via `game1MasterControlService.setOnEngineStarted(...)`
- **Input:** `{ scheduledGameId, actorUserId }` (henter `ticket_config_json` + `room_code` med SELECT)
- **Samme tre steg som fase 1.** Defense-in-depth — re-binder samme verdier ved engine-start. Bruker ALSO Fase 2-mapping internt.

### Symptom hvis Fase 0 (bridge) er ødelagt

- `ticket_config_json` mangler `spill1.ticketColors[]` eller har feil `priceNok` — INGEN av de andre fasene kan rette opp.
- Hele pipelinen kollapser. Sjekk `GamePlanEngineBridge.buildTicketConfigJsonFromCatalog` først.

### Symptom hvis Fase 1 mangler (PR #1408 ikke kjørt)

- Pre-game-spillere ser entryFee fallback til 10 kr (default) istedenfor riktig billigste bongpris.
- Etter master starter engine → Fase 3 binder verdier → klient korrigerer ved neste room:update.

### Symptom hvis Fase 2 mangler (PR #1411 ikke kjørt)

- `gameVariant.ticketTypes` i room-snapshot rendrer flat `priceMultiplier=1/3` for alle farger.
- Frontend som leser fra `state.ticketTypes` (room-snapshot) kalkulerer `10 kr × 2 = 20 kr` for yellow istedenfor 10 kr.
- Lobby-API'et fortsetter å gi korrekte priser (separat path via `lobbyTicketTypes.ts`), så klient kan se motstridende priser fra to kilder samtidig.
- Eksakt scenario Tobias rapporterte 2026-05-14 08:45.

### Symptom hvis Fase 3 mangler

- Post-engine room:update returnerer fortsatt riktig data (fra Fase 1 + 2) inntil neste binding-feil eller restart.
- Mister defense-in-depth — hvis Fase 1 ikke kjørte (eks. bridge re-spawn uten hook), faller klient til default.

### ALDRI fjern noen av fasene uten å verifisere at de andre dekker pathen

Alle faser kjører idempotent — re-binding for samme room+scheduledGameId setter samme verdi (no-op fra klient-perspektiv). Hvis du fjerner Fase 1, kommer entryFee-buggen tilbake. Hvis du fjerner Fase 2, kommer multiplier-buggen (20kr/30kr) tilbake. Hvis du fjerner Fase 3, mister du defense-in-depth ved engine-start.

## Payout-pipeline auto-multiplikator (PR #1417, REGULATORISK-KRITISK)

> **Tobias-direktiv 2026-05-14:** Engine MÅ lese per-farge pre-multipliserte premier fra `ticket_config_json.spill1.ticketColors[].prizePerPattern[<pattern>].amount` ved payout-tid — IKKE fra `gameVariant.patterns[].prize1` (som er HVIT base) direkte. Hvis du fjerner denne logikken kommer auto-mult-buggen tilbake.

### Bakgrunn (runde 7dcbc3ba 2026-05-14)

Live DB-bevis fra runde `7dcbc3ba-bb64-4596-8410-f0bfe269efd6`:

| phase | ticket_color | utbetalt (pre-fix) | korrekt (auto-mult) |
|---|---|---|---|
| 1 | yellow (small) | 100 kr | 200 kr (= 100 × 2) |
| 2 | purple (small) | 200 kr | 300 kr (= 100 × 3) |
| 3 | yellow (small) | 200 kr | 200 kr (= 100 × 2) ✓ (tilfeldigvis) |
| 4 | yellow (small) | 200 kr | 200 kr (= 100 × 2) ✓ (tilfeldigvis) |

Phase 1 yellow og phase 2 purple er klart UNDER-betalt. REGULATORISK FEIL — spillere får for lav premie.

### Root cause

`app_game1_ticket_assignments.ticket_color` lagres som **FAMILY-form** ("yellow"/"purple"/"white") av `Game1TicketPurchaseService` — IKKE slug-form. Pre-fix:

1. `payoutPerColorGroups` grupperte winnere på `w.ticketColor = "yellow"`
2. `resolveEngineColorName("yellow")` → returnerer "yellow" uendret (ingen slug-match)
3. `resolvePatternsForColor(variantConfig, "yellow", ...)` → ingen key "yellow" i `patternsByColor` (som er keyed på engine-navn "Small Yellow") → fall til `__default__` matrise
4. `__default__` = `DEFAULT_NORSK_BINGO_CONFIG.patterns` = HVIT base (100/200/200/200/1000)
5. Auto-mult (yellow×2, purple×3) går tapt → spillere får hvit-pris

### Fix

Engine bygger nå **slug-form** ("small_yellow"/"large_purple") fra `(ticket_color family-form, ticket_size)` før lookup:

1. `evaluateAndPayoutPhase` SELECT inkluderer `a.ticket_size` (i tillegg til `a.ticket_color`)
2. `Game1WinningAssignment.ticketSize` propageres til payout-pathen
3. `resolveColorSlugFromAssignment("yellow", "small")` → `"small_yellow"`
4. `resolveEngineColorName("small_yellow")` → `"Small Yellow"` (via `SCHEDULER_COLOR_SLUG_TO_NAME`)
5. `patternsByColor["Small Yellow"]` har korrekt per-farge pre-multipliserte premier fra bridge

### Kilde-felter (kanoniske)

- `ticket_config_json.spill1.ticketColors[].color` — slug-form ("small_yellow")
- `ticket_config_json.spill1.ticketColors[].prizePerPattern[<row_N|full_house>].amount` — pre-multiplisert i kr (bridge har gjort `calculateActualPrize` allerede)
- `app_game1_ticket_assignments.ticket_color` — FAMILY-form (legacy: "yellow")
- `app_game1_ticket_assignments.ticket_size` — "small" | "large"

### ALDRI gjør

- IKKE fjern `a.ticket_size` fra payout-SELECT i `evaluateAndPayoutPhase`
- IKKE bruk `w.ticketColor` direkte som key for `patternsByColor` — bygg slug først
- IKKE bruk `pattern.prize1` (HVIT base) for payout-amount uten å gange med color-multiplier
- IKKE endre `Game1WinningAssignment.ticketSize` til required uten å oppdatere ALLE call-sites (legacy stubs sender ikke size)

### Tester som beskytter

- `apps/backend/src/game/Game1DrawEngineService.payoutAutoMultiplier.test.ts` (6 tester — yellow/purple/white Rad 1, yellow Fullt Hus, multi-vinner, compliance-ledger-metadata)
- `apps/backend/src/game/Game1DrawEngineHelpers.resolveColorSlugFromAssignment.test.ts` (20 tester — slug-builder edge cases)

### Compliance-ledger-metadata

Hver PRIZE-event har nå `bongMultiplier` + `potCentsForBongSize` i metadata for §71-sporbarhet (pengespillforskriften). Auditor kan reprodusere utbetalingen fra ledger-data alene.

ALDRI fjern disse kilden fra payout-pipeline — den er regulatorisk forpliktet per §71 og SPILL_REGLER_OG_PAYOUT.md §3.

### Tester som beskytter mot regresjon

- `apps/backend/src/game/spill1VariantMapper.test.ts` — Fase 2: 7 nye PR #1411-tester (Standard Bingo `[1,3,2,6,3,9]`, Trafikklys `[1,3]`, hvit+gul `[1,3,2,6]`, tom-fallback, idempotent, priceNok=0-fallback, blandet priceNok)
- `apps/backend/src/game/GamePlanEngineBridge.onScheduledGameCreated.test.ts` (9 tester — Fase 1)
- `apps/backend/src/game/Game1MasterControlService.onEngineStarted.test.ts` (5 tester — Fase 3)
- Snapshot-baseline i `apps/backend/src/game/__tests__/r2InvariantsBaseline.test.ts` — verifiserer at ticket_config_json propageres til scheduled-games-raden

## Når denne skill-en er aktiv

**Gjør:**
- Les `SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` FØRST
- Bruk `currentScheduledGameId` for master-actions (Bølge 1-kontrakt)
- Sjekk `inconsistencyWarnings[]` på lobby-aggregator-respons
- Match patches mot eksisterende refaktor-bølger (1, 2, 3) — ikke patch symptomer
- Verifiser at endringer respekterer immutable beslutninger (§5 i status-doc)

**Ikke gjør:**
- IKKE endre `Spill1AgentLobbyState`-shape uten å oppdatere `packages/shared-types/src/spill1-lobby-state.ts` + Bølge 2/3-kontrakt
- IKKE legg til ny "merge plan + legacy"-logikk i UI — Bølge 1 fjerner det
- IKKE introduser nye gevinstmønstre på Spill 1 — flytt til Spill 3
- IKKE bypass route-guard på `master_hall_id`-matching for master-actions
- IKKE rør `app_game1_scheduled_games`-skjema uten å sjekke at `GamePlanEngineBridge` + `Game1ScheduleTickService` parallel-spawn ikke krasjer

## Kanonisk referanse

Ved tvil mellom kode og doc: **doc-en vinner**, koden må fikses. Spør Tobias før du:
- Endrer master-handling-spec
- Endrer multi-vinner-regel
- Endrer pilot-go-live-kriterier
- Lager nye gevinstmønstre for Spill 1

## Relaterte ADR-er

- [ADR-0002 — Perpetual rom-modell for Spill 2/3](../../../docs/adr/0002-perpetual-room-model-spill2-3.md) — kontrast: Spill 1 forblir per-hall master-styrt
- [ADR-0008 — Spillkatalog-paritet (Spill 1-3 = MAIN_GAME)](../../../docs/adr/0008-spillkatalog-classification.md) — bindende: MAIN_GAME for bingo
- [ADR-0009 — PM-sentralisert git-flyt](../../../docs/adr/0009-pm-centralized-git-flow.md) — relevant for koordinering av master-flyt-PR-er
- [ADR-0011 — Casino-grade observability](../../../docs/adr/0011-casino-grade-observability.md) — trace-ID-propagering gjelder også master-actions
- [ADR-0016 — Master-action bridge-retry + rollback](../../../docs/adr/0016-master-action-bridge-retry-rollback.md) — feilhåndtering ved bridge-spawn-feil
- [ADR-0017 — Fjerne daglig jackpot-akkumulering](../../../docs/adr/0017-remove-daily-jackpot-accumulation.md) — bingovert setter manuelt
- [ADR-0019 — Evolution-grade state-konsistens (Bølge 1)](../../../docs/adr/0019-evolution-grade-state-consistency-bolge1.md) — monotonic stateVersion, sync-persist, targeted broadcast
- [ADR-0020 — Evolution-grade utvidelses-fundament (Bølge 2)](../../../docs/adr/0020-evolution-grade-utvidelses-fundament-bolge2.md) — R11 circuit-breaker, R4 load-test
- [ADR-0021 — Master kan starte uten solgte bonger](../../../docs/adr/0021-allow-master-start-without-players.md) — fjernet MASTER_HALL_RED
- [ADR-0022 — Multi-lag stuck-game-recovery](../../../docs/adr/0022-stuck-game-recovery-multilayer.md) — auto-reconcile + recovery-layers

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-08 | Initial — master-flyt fundament + Bølge 1 GameLobbyAggregator |
| 2026-05-13 | v1.1.0 — la til I14/I15/I16-fix-mønstre, ADR-0019/0020/0021/0022, MasterActionService som single-entry sekvenseringsmotor, GamePlanRunCleanupService for stale-plan-cleanup, master kan starte med 0 spillere |
| 2026-05-14 | v1.2.0 — BUG-F2: la til seksjon "Ticket-pris-propagering" som dokumenterer to-fase-binding (pre-engine via `GamePlanEngineBridge.onScheduledGameCreated` + post-engine via `Game1MasterControlService.onEngineStarted`). Pre-engine-fasen dekker hullet fra PR #1375 og forhindrer 20kr-regresjonen. Begge faser MÅ beholdes — fremtidige agenter må ikke fjerne den ene uten å verifisere at den andre dekker pathen. |
| 2026-05-14 | v1.3.0 — PR #1413 (sub-bug PR #1408): utvidet "Ticket-pris-propagering" til TRE-fase-fix. Fase 2 (variantByRoom-binding) manglet per-farge multipliers — `gameVariant.ticketTypes` i room-snapshot rendret flat mult=1/3 selv om backend `ticket_config_json` hadde korrekte priser. Fixen mapper `priceNok / minPriceNok` for hver farge i `spill1VariantMapper.ticketTypeFromSlug`. Speiler `lobbyTicketTypes.buildBuyPopupTicketConfigFromLobby`-matematikken eksakt. 7 nye tester. PR #1408's hook setter entryFee, men IKKE multipliers — derfor komplementært. |
| 2026-05-14 | v1.4.0 — F-04 hall-switcher-bug (PR #1415): la til seksjon "Hall-switching state-refresh (lobby.js, 2026-05-14)" som dokumenterer at switchHall() MÅ parallell-refetche `/api/games/spill1/lobby?hallId=...` ved hall-bytte. `/api/games/status` er GLOBAL og kan ikke besvare per-hall-spørsmål. Inkluderer per-hall badge-mapping fra `Game1LobbyState.overallStatus` til Åpen/Stengt/Starter snart osv. PITFALLS §7.17. Tester i `apps/admin-web/tests/lobbyHallSwitcher.test.ts`. |
| 2026-05-14 | v1.5.0 — PR #1417 Payout auto-multiplikator-fix (REGULATORISK, runde 7dcbc3ba): payoutPerColorGroups bygget feil lookup-key (family-form "yellow" i stedet for slug "small_yellow") → fall til __default__ HVIT-matrise → auto-mult (yellow×2, purple×3) gikk tapt → REGULATORISK feil. Fix: ny `resolveColorSlugFromAssignment(color, size)` builder, propager `ticketSize` via `Game1WinningAssignment`, SELECT inkluderer `a.ticket_size`. Tester: `Game1DrawEngineService.payoutAutoMultiplier.test.ts` + `Game1DrawEngineHelpers.resolveColorSlugFromAssignment.test.ts`. PITFALLS §1.9. |
