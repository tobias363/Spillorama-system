---
name: spill1-master-flow
description: When the user/agent works with Spill 1 master-konsoll, plan-runtime, scheduled-game lifecycle, GoH-master-rom, or hall-ready-state. Also use when they mention master-actions, GamePlanRunService, GamePlanEngineBridge, Game1MasterControlService, Game1HallReadyService, Game1TransferHallService, Game1ScheduleTickService, Game1LobbyService, GameLobbyAggregator, MasterActionService, NextGamePanel, Spill1HallStatusBox, Spill1AgentControls, plan-run-id, scheduled-game-id, currentScheduledGameId, master-hall, ekskluderte haller, "Marker Klar", "Start neste spill", master-flyt, plan-runtime-koblingen, ADR-0021, ADR-0022, stuck-game-recovery, I14, I15, I16, BIN-1018, BIN-1024, BIN-1030, BIN-1041. Make sure to use this skill whenever someone touches the master/agent UI, plan or scheduled-game services, or anything related to who controls a Spill 1 round — even if they don't explicitly ask for it.
metadata:
  version: 1.1.0
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
