# Agent D — Scheduled-game lifecycle research

**Branch:** `research/next-game-display-d-scheduledgame-2026-05-14`
**Agent type:** general-purpose (PM Trinn 1, Next Game Display fundament-audit)
**Status:** Trinn 1 data-collection ferdig. Trinn 2-3 (SKILL-update + arkitektur-forslag) er ikke i scope.
**Reads:** Read-only audit. INGEN kode-endringer.

## 0. TL;DR

Scheduled-game-lifecycle har **fire alvorlige strukturelle problemer** som driver Next Game Display-bugen tilbake hver gang den fikses:

1. **Dual-spawn-problem (Bølge 4 ikke fullført):** `Game1ScheduleTickService.spawnUpcomingGame1Games` (LEGACY) og `GamePlanEngineBridge.createScheduledGameForPlanRunPosition` (BRIDGE) skriver BEGGE til `app_game1_scheduled_games`-tabellen uten å koordinere. Ingen guard hindrer dem fra å spawne parallelt. UNIQUE-keys er disjunkte: `(daily_schedule_id, scheduled_day, sub_game_index)` for legacy vs `(plan_run_id, plan_position)` for bridge — så DB tolererer to konkurrerende rader for samme runde.

2. **`GamePlanRunService.start()` overskriver alltid `current_position = 1`:** Selv etter `getOrCreateForToday`-auto-advance (linje 666-684 i `GamePlanRunService.ts`) som beregner riktig `nextPosition`, vil `start()` på linje 780 hardkode position til 1. Dette er en latent bug — kanskje delvis dekket av nye `MasterActionService.start()` som har egen advance-logikk (linje 607-672), men master-flyten har to inngangs-paths som driver forskjellig oppførsel.

3. **Cron-promotering i `Game1ScheduleTickService.transitionReadyToStartGames` rører ikke plan-run-id-knyttede rader:** Den flipper `purchase_open → ready_to_start` basert på ready-status. Hvis bridgen spawner med initial `status='ready_to_start'` (linje 1248 i bridge), bypassser den hele "wait for all halls"-cron-gaten. Det er bevisst design men skaper inkonsistens med Next Game Display-spec som forventer plan-run-progresjon, ikke cron-progresjon.

4. **`getOrCreateForToday` har tre forskjellige reconcile-paths som kan kollidere:** PR #1407 (`reconcileNaturalEndStuckRuns` cron 30s), PR #1403 (`MasterActionService.reconcileStuckPlanRuns` on master.start), `GamePlanRunCleanupService.inlineCleanupHook` (03:00 + inline ved `getOrCreateForToday`). Alle tre kan kjøre samtidig under samme runde-end-trigger og gi forskjellige resultater.

**Bug-resultat for "Neste spill"-display:** Etter `dev:nuke` eller etter runde-slutt, kan plan-run være `running`/`finished` med scheduled-game-rad i `completed`/`cancelled` — eller motsatt. Hver fix har truffet én transition, men de andre kan fortsette å drive UI'en bakover.

---

## 1. File-list (skrivere/lesere mot `app_game1_scheduled_games`)

### 1.1 Writers (INSERT/UPDATE — primær)

| Fil | Linjer | Operasjon | Status-overgang | Trigger |
|---|---|---|---|---|
| `apps/backend/src/game/Game1ScheduleTickService.ts:705-756` | INSERT | new row, `status='scheduled'` | Cron-tick (15s, prod) leser `app_daily_schedules` med `status='running'`. |
| `apps/backend/src/game/Game1ScheduleTickService.ts:780-790` | UPDATE | `scheduled → purchase_open` | `openPurchaseForImminentGames` (cron-tick). Kjører på BÅDE legacy og bridge-spawnete rader fordi WHERE-klausul kun filtrerer på `status` + tid. |
| `apps/backend/src/game/Game1ScheduleTickService.ts:828-920` | UPDATE | `purchase_open → ready_to_start` | `transitionReadyToStartGames` (cron-tick) når ALLE participating non-excluded haller er ready. |
| `apps/backend/src/game/Game1ScheduleTickService.ts:797-810` | UPDATE | `scheduled\|purchase_open\|ready_to_start → cancelled` | `cancelEndOfDayUnstartedGames` (cron-tick) når `scheduled_end_time < now()`. |
| `apps/backend/src/game/GamePlanEngineBridge.ts:1224-1279` | INSERT | new row, `status='ready_to_start'` (linje 1248) | `MasterActionService.start/advance` kaller `createScheduledGameForPlanRunPosition`. Idempotent på `(plan_run_id, plan_position) WHERE status NOT IN ('cancelled', 'completed')`. |
| `apps/backend/src/game/GamePlanEngineBridge.ts:1690-1700` | UPDATE | `* → cancelled` | `releaseStaleRoomCodeBindings` (F-NEW-3, 2026-05-12) — auto-cancel stale rader med samme `room_code`. |
| `apps/backend/src/game/Game1MasterControlService.ts:719-729` | UPDATE | `ready_to_start → running` | Master `startGame` action. |
| `apps/backend/src/game/Game1MasterControlService.ts:1108-1116` | UPDATE | `running → paused` | Master `pauseGame` action. |
| `apps/backend/src/game/Game1MasterControlService.ts:1211-1220` | UPDATE | `paused → running` (status) + `auto_resume_eligible_at=NULL` | Master `resumeGame` (manual case a). |
| `apps/backend/src/game/Game1MasterControlService.ts:1247-1256` | UPDATE | status unchanged + `auto_resume_eligible_at=NULL` | Master `resumeGame` (auto-pause case b). |
| `apps/backend/src/game/Game1MasterControlService.ts:1337-1350` | UPDATE | `purchase_open\|ready_to_start\|running\|paused → cancelled` | Master `stopGame` action. |
| `apps/backend/src/game/Game1MasterControlService.ts:1004-1009` | UPDATE | `ready_to_start → purchase_open` | `excludeHall` — hvis ekskludering bringer ready-state under threshold, downgrade. |
| `apps/backend/src/game/Game1MasterControlService.ts:915-921` | UPDATE | `running → preStatus` (rollback) | CRIT-7 compensating rollback når `drawEngine.startGame` feiler etter master-commit. |
| `apps/backend/src/game/Game1DrawEngineService.ts:1413-1420` | UPDATE | `running → completed` + `actual_end_time` | Engine når Fullt Hus vunnet eller maxDraws nådd. |
| `apps/backend/src/game/Game1DrawEngineService.ts:1402-1409` | UPDATE | `running → running` + `auto_resume_eligible_at=now()+autoResumeDelayMs` | Auto-pause etter phase-won. |
| `apps/backend/src/game/Game1TransferHallService.ts` | UPDATE | endrer `master_hall_id` etter 60s handshake | Master-overføring til annen hall. |
| `apps/backend/src/game/Game1RescheduleService.ts` | UPDATE | endrer `scheduled_start_time`/`scheduled_end_time` | Admin-tool. |
| `apps/backend/src/game/Game1RecoveryService.ts` | UPDATE | * → cancelled | `cancelOverdueGame` for recovery. |

### 1.2 Writers (sekundær — indirect)

| Fil | Hva | Effekt på scheduled-game |
|---|---|---|
| `apps/backend/scripts/seed-demo-pilot-day.ts:2651-2693` | INSERT app_daily_schedules + INSERT app_game_plan + (`spawnScheduledGamesForDay`) | Seed: kan duplisere data hvis run igjen etter `dev:nuke`. Aktiv `app_daily_schedules` + `app_game_plan` samtidig for SAMME hall. |
| `apps/backend/scripts/seed-demo-pilot-day.ts:2771-2780` | Direkte INSERT scheduled-games (bypasser cron) | I dev: bypass cron-disabled. Replikerer legacy-spawn-INSERT-shape. |

### 1.3 Readers (SELECT — Next Game Display-relevante)

| Fil | Linjer | Hva leses | Brukes til |
|---|---|---|---|
| `apps/backend/src/game/Game1ScheduledGameFinder.ts:142-197` | All `findFor({hallId, statuses, orderBy})` queries | Konsolidert finder. Tre buckets: `ACTIVE`, `ACTIVE_OR_UPCOMING`, `SCHEDULED_ONLY`. |
| `apps/backend/src/routes/agentGame1.ts:256-263` | wrapper: `findActiveGameForHall` → `ACTIVE` | Master-current-game via `/api/agent/game1/current-game`. |
| `apps/backend/src/routes/agentGame1.ts:271-278` | wrapper: `findActiveOrUpcomingGameForHall` → `ACTIVE_OR_UPCOMING` | `/api/agent/game1/current-game` for å vise neste runde også. |
| `apps/backend/src/routes/agentGame1.ts:288-295` | wrapper: `findScheduledGameForHall` → `SCHEDULED_ONLY` | `/api/agent/game1/start` for å gi presis feilmelding hvis purchase ennå ikke er åpen. |
| `apps/backend/src/game/GameLobbyAggregator.ts` | Bruker `Spill1ScheduledGameRepo` for `currentScheduledGameId`-felt | NY single-source-of-truth for master-UI (Bølge 1 fra 2026-05-08). |
| `apps/backend/src/game/Game1LobbyService.ts` | `nextScheduledGame`-felt | Public klient-shell-API (`/api/games/spill1/lobby`). |
| `apps/backend/src/game/GamePlanRunCleanupService.ts:351-401` | CTE: `completed_sched` + `active_sched_counts` per plan_run_id | `reconcileNaturalEndStuckRuns` (R3). |
| `apps/backend/src/game/MasterActionService.ts:608-611` | `getPlanRunScheduledGameForPosition(started.id, started.currentPosition)` | Pre-validate at scheduled-game ikke er i TERMINAL-status. |
| `apps/backend/src/game/GamePlanEngineBridge.ts:962-971` | SELECT for `(plan_run_id, plan_position) WHERE status NOT IN ('cancelled', 'completed')` | Idempotency-sjekk på spawn. |
| `apps/backend/src/game/GamePlanEngineBridge.ts:1676-1681` | SELECT `WHERE room_code = $1 AND status NOT IN ('completed','cancelled')` | `releaseStaleRoomCodeBindings` for konflikt-cancel. |

### 1.4 Migrations som har endret statuser/kolonner

| Migration | Endring |
|---|---|
| `20260428000000_game1_scheduled_games.sql` | Original schema. Status-enum, UNIQUE `(daily_schedule_id, scheduled_day, sub_game_index)`, FK til `app_daily_schedules` + `app_schedules`. |
| `20260601000000_app_game1_scheduled_games_room_code.sql` | Lagt til `room_code`-kolonne (lazy-binding). |
| `20260605000000_app_game1_scheduled_games_game_config.sql` | Lagt til `game_config_json`-kolonne. |
| `20261210010000_app_game1_scheduled_games_catalog_link.sql` | Lagt til `catalog_entry_id`, `plan_run_id`, `plan_position` (alle NULLABLE for legacy compat). |
| `20261210010100_app_game1_scheduled_games_nullable_legacy_fks.sql` | Gjorde `daily_schedule_id` + `schedule_id` NULLABLE for bridgen. |
| `20261218000000_app_game1_scheduled_games_pause_reason.sql` | Lagt til `pause_reason`. |
| `20261221000000_app_game1_scheduled_games_room_code_active_only.sql` | **KRITISK:** Endret partial unique index på `room_code` til kun gjelde aktive rader (`status NOT IN ('completed', 'cancelled')`). Lar bridge gjenbruke samme `room_code` for ny runde etter forrige er ferdig. |
| `20261224000000_cleanup_stale_null_room_code.sql` | Cleanup. |

---

## 2. Status-overganger (komplett state-diagram)

```
                              ┌─────────────────────────────────────────────┐
                              │  scheduled                                  │
                              │  (initial — Game1ScheduleTickService spawn  │
                              │   eller bridge override fra "ready_to_start")│
                              └────┬─────────────────────────┬──────────────┘
                                   │                         │
                                   ▼ cron tick               ▼ admin reschedule
                              ┌────────────────┐         (status uendret)
                              │ purchase_open   │
                              │ (kjøp åpent)    │
                              └────┬────────────┘
                                   │
                       ┌───────────┴────────────────────────────┐
                       ▼ cron: alle haller klar                  ▼ master exclude_hall
                  ┌─────────────────┐                       (bringer ned under threshold)
                  │ ready_to_start  │                            │
                  │ (master kan     │                            ▼
                  │  starte)        │                       ┌──────────────────┐
                  └────┬─────────┬──┘                       │  purchase_open    │
                       │         │                          │  (downgrade)      │
                       │         └─ master include_hall ───►└──────────────────┘
                       ▼ master startGame
                  ┌────────────────────┐
       ┌──────────┤  running           │◄─────┐
       │          │  (engine trekker)  │      │
       │          └────┬───────────────┘      │ master resumeGame
       │               │                       │ (manual case a)
       │               ▼ master pauseGame      │
       │          ┌─────────────────────┐     │
       │          │  paused             │─────┘
       │          └────┬────────────────┘
       │               │
       │               ▼ master stopGame eller engine.startGame feiler etter master-commit (CRIT-7)
       │          ┌─────────────────────┐
       │          │  cancelled          │
       │          │  + stop_reason      │
       │          └─────────────────────┘
       │
       ▼ engine: Fullt Hus eller maxDraws
  ┌──────────────────────┐
  │  completed           │
  │  + actual_end_time   │
  └──────────────────────┘
```

### 2.1 Auto-pause-side-state (orthogonal til status)

```
status='running' + game_state.paused=true → auto-pause etter phase-won
    ↓
status='running' + auto_resume_eligible_at = now() + autoResumeDelayMs
    ↓
Master kan trykke Resume → status fortsatt 'running' men game_state.paused=false
```

Det er en **side-state** av engine, ikke en scheduled-game-status. Master-UI må vise "Pauset" i begge tilfellene, men actions er forskjellige.

### 2.2 Race-conditions per transition

| Transition | Konkurrenter | Sikret av? | Race-resultat hvis ikke sikret |
|---|---|---|---|
| `scheduled → purchase_open` | Legacy-cron vs bridge | Kun cron skriver scheduled→purchase_open. Bridge starter på `ready_to_start`. | Bridge-rader hopper over cron-tick-promoteringen. |
| `purchase_open → ready_to_start` | Cron + concurrent ready-marks fra haller | `WHERE id = $1 AND status = 'purchase_open'` (linje 905-910 i tick) | OK |
| `ready_to_start → running` | Master.startGame parallelt med cron | Master holder FOR UPDATE lock via `loadGameForUpdate` (transaction) | OK i master-action |
| `running → completed` | Engine + master stopGame | Engine UPDATE WHERE id=$1 (uten WHERE status check!) | **Potensiell race:** master stop kan komme MELLOM engine.completion-detect og UPDATE. Uten WHERE-status, kan completed-rad bli skrevet over master-cancelled. |
| `purchase_open → cancelled` (end-of-day) | Cron vs master vs bridge release | Hver UPDATE filtrerer på WHERE status fra annet sett | OK |
| Idempotency-spawn på `(plan_run_id, plan_position)` | To master-starts samtidig | SELECT-then-INSERT — race-vinneren gjør INSERT, taperen kan racee inn etter SELECT | **Reel race** — håndteres delvis av idempotency-sjekk (linje 960-971) men det er ingen DB-side UNIQUE på `(plan_run_id, plan_position)` for active-only. |

### 2.3 Hva inneholder status etter `dev:nuke`?

`dev:nuke` (per scripts/dev/nuke-restart.sh) gjør:
1. Kill alle prosesser
2. FLUSHALL Redis
3. SQL: `UPDATE app_game_plan_run SET status='finished' WHERE status NOT IN ('finished','idle')` + `UPDATE app_game1_scheduled_games SET status='cancelled', actual_end_time=now() WHERE status IN ('running','purchase_open','ready_to_start','paused')`
4. Re-seed

**Etter dev:nuke:**
- `app_game_plan_run` har historiske `finished`-rader fra forrige sesjon
- `app_game1_scheduled_games` har historiske `cancelled`-rader (fra nuke) + `completed`-rader (fra natural-end)
- `seed-demo-pilot-day.ts` lager NYE rader for "i dag" (om de ikke allerede finnes)

**Path til Next Game Display etter dev:nuke:**
1. Klient åpner master-UI
2. UI henter via `GameLobbyAggregator.getLobbyState(hallId)`
3. Aggregator leser `app_game_plan_run` for `(hallId, business_date)` — typisk INGEN rad eksisterer for "i dag" (kun gårsdagens finished)
4. Master klikker "Start" → `MasterActionService.start` → `getOrCreateForToday(hallId, today)` → opprett ny idle rad
5. `start()` UPDATE-r `current_position = 1, status='running'`
6. Bridge spawner ny scheduled-game-rad med `plan_position=1`
7. Engine starter ved `drawEngine.startGame`

**Forventet display etter dev:nuke:** "Neste spill: Bingo" (position 1)

**Hva som FAKTISK skjer (per PITFALLS §3.13 reproducer fra 2026-05-14 22:21):** Plan-run kan være `finished` med `current_position=1`. Lobby-API returnerer `nextScheduledGame.catalogSlug='1000-spill'` (position 2) per fix-en, MEN master-UI viser fortsatt "Bingo".

→ **Det er primært Agent A/B sitt scope** (UI rendering + aggregator). Agent D's bidrag er at scheduled-game `plan_position` ALDRI advancers separat — UI'en må stole på plan-run.current_position + lobby-API-projeksjon. Hvis lobby-API returnerer feil felt, har scheduled-game-laget ikke noe ord i saken.

---

## 3. Dual-spawn-problem (Bølge 4 — IKKE FULLFØRT)

### 3.1 Verifikasjon av dual-spawn risiko

**Sjekklist:**

- [x] **`Game1ScheduleTickService.spawnUpcomingGame1Games` finnes fortsatt og er IKKE deaktivert.** (Linje 386-771 i `Game1ScheduleTickService.ts`. Job registreres i `index.ts:2364-2380`.)
- [x] **Ingen guard "skip if plan exists" eksisterer i tick-servicen.** Grep mot `Game1ScheduleTickService.ts` returnerte 0 treff på "plan", "skip", "hasActivePlan".
- [x] **Feature-flag `GAME1_SCHEDULE_TICK_ENABLED` er `true` i prod** (per `docs/operations/RENDER_ENV_VAR_RUNBOOK.md:70` og `apps/backend/src/util/envConfig.ts:253` default `false` lokalt). Det betyr at i prod kjører LEGACY-spawnen 15 sek lakker.
- [x] **Seed-en seeder BÅDE `app_daily_schedules` (med `status='running'`) OG `app_game_plan` for samme hall.** (Linjer 1422-1447 + 2651-2693 i `seed-demo-pilot-day.ts`.)
- [x] **Cron-tick filter ser ikke på `plan_run_id`:** Verifisert at `spawnUpcomingGame1Games` (linje 398-407) henter alle daily_schedules med `status='running' AND stop_game=false AND deleted_at IS NULL`.
- [x] **Idempotency-key er disjunkt:** Legacy bruker `(daily_schedule_id, scheduled_day, sub_game_index)` (linje 716-717), bridge bruker `(plan_run_id, plan_position) WHERE status NOT IN ('cancelled', 'completed')` (linje 962-971). **Forskjellige keys** ⇒ to rader kan eksistere for samme runde uten DB-konflikt.

### 3.2 Når kjører hver path?

**LEGACY (`Game1ScheduleTickService.spawnUpcomingGame1Games`):**
- Trigget av: `JobScheduler` hvert `jobGame1ScheduleTickIntervalMs` (default 15s)
- Kjører hvis: `GAME1_SCHEDULE_TICK_ENABLED=true` (prod default true, dev default false)
- Filtrerer på: `app_daily_schedules.status='running' AND stop_game=false AND deleted_at IS NULL`
- Spawner: 24t lookahead-vindu, én rad per `(daily_schedule × sub_game × weekday match)`
- Setter: `daily_schedule_id`, `schedule_id`, `sub_game_index`, `status='scheduled'` (initial)
- `catalog_entry_id` = NULL, `plan_run_id` = NULL

**BRIDGE (`GamePlanEngineBridge.createScheduledGameForPlanRunPosition`):**
- Trigget av: Master-action via `MasterActionService.start/advance` → `engineBridge.createScheduledGameForPlanRunPosition(runId, position)`
- Også: `DemoAutoMasterTickService.tick` for demo/staging
- Filtrerer på: ingen — caller bestemmer runId/position
- Spawner: én rad per `(plan_run_id, plan_position)` ved master-action
- Setter: `catalog_entry_id`, `plan_run_id`, `plan_position`, `status='ready_to_start'` (initial, hopper over cron-promotering)
- `daily_schedule_id` = NULL, `schedule_id` = NULL

### 3.3 Konkrete dual-spawn-scenarioer i pilot

**Scenario A: Pilot-hall har BÅDE daily_schedule OG plan**
- Seed-data har dette for `demo-hall-001..004` (verifisert via grep).
- Ved `dev:nuke` + ny dag: daily_schedule (med `status='running'`) trigger cron tick — spawn rad #1 med `daily_schedule_id` satt, `status='scheduled'`.
- Master åpner UI og klikker "Start" → bridge spawn rad #2 med `plan_run_id` satt, `status='ready_to_start'`.
- **DB-state:** TO scheduled-games for samme (hall, business_date) er aktive samtidig.
- `findActiveOrUpcomingGameForHall(hallId)` returnerer ÉN av dem (sortert by `scheduled_start_time ASC LIMIT 1`).
- `GameLobbyAggregator.buildPlanMeta` er bevisst om DUAL_SCHEDULED_GAMES (per PLAN_SPILL_KOBLING audit) men flagger som warning, ikke blocker.

**Scenario B: Bridge spawner samme `room_code` som legacy-rad har**
- Bridge bruker `getCanonicalRoomCode("bingo", masterHallId, groupHallId)` (linje 1181-1185) = `BINGO_<groupId>`.
- Legacy bruker IKKE deterministisk room_code (det settes lazy ved første join).
- F-NEW-3 (`releaseStaleRoomCodeBindings`) auto-cancel rader med samme `room_code` → cancel legacy-spawn ved bridge-INSERT.
- **Sekundær effekt:** Legacy-rad blir `cancelled` med `stop_reason='auto_cancelled_by_bridge_takeover'`. Audit-event skrives.

**Scenario C: Cron-tick promoterer legacy-rad til `purchase_open` MELLOM bridge-spawn og master-start**
- Bridge spawner rad #2 med `status='ready_to_start'` (hopper over cron-gate).
- Cron-tick på samme sekund promoterer legacy-rad #1 fra `scheduled → purchase_open`.
- Hvis legacy-rad har samme `room_code` (etter lazy-binding): F-NEW-3 cancels den.
- Hvis legacy-rad IKKE har room_code: den fortsetter å eksistere i `purchase_open` parallelt med bridge-rad i `ready_to_start`.
- `findActiveOrUpcomingGameForHall` returnerer kun ÉN. UI viser den raden, men master.start mot bridge-rad-id virker likevel.

### 3.4 Hva sier `Game1ScheduledGameFinder` ved dual-state?

`findFor({hallId, statuses=ACTIVE_OR_UPCOMING, orderBy='first-by-scheduled-start'})` returnerer raden med tidligst `scheduled_start_time`. Hvis bridge-rad har `scheduled_start_time = now()` (linje 1136-1137 i bridge) og legacy-rad har `scheduled_start_time = scheduledDay + sg.startTime` (kan være `now() + 5min`), så vil bridge-rad vinne. Men hvis legacy ble spawn'et først for tidligere på dagen (eks. forrige planlagte runde fra `app_daily_schedules.subgames_json`), vil legacy vinne.

**Konklusjon:** Finder-en returnerer en deterministisk RAD, men hvilken er ikke styrt av plan-run-progresjon. Det er en mismatch hvis vi forventer at "current scheduled game for hall" matcher "current plan-run position".

---

## 4. Kall-graf for "neste spill"-data

### 4.1 Data-flyt fra master.start til Next Game Display

```
KLIENT (master-UI)
   │ klikk "Start neste spill"
   ▼
POST /api/agent/game1/master/start   (Bølge 2 endepunkt)
   │
   ▼
MasterActionService.start(input)
   │
   ├─► reconcileStuckPlanRuns(hallId, businessDate)
   │      └─► UPDATE plan-runs som er stuck running (DAGENS, samme hall)
   │
   ├─► planRunService.getOrCreateForToday(hallId, businessDate)
   │      ├─► inlineCleanupHook(hallId)   (gårsdagens stale runs)
   │      ├─► findForDay(hallId, businessDate)
   │      │     └─► hvis existing.status === 'finished':
   │      │          • capture previousPosition
   │      │          • DELETE existing rad
   │      │          • beregn nextPosition = previousPosition + 1
   │      │          • (eller throw PLAN_COMPLETED_FOR_TODAY)
   │      └─► INSERT app_game_plan_run (status='idle', current_position=nextPosition)
   │
   ├─► planRunService.start(hallId, businessDate, actor.userId)
   │      └─► UPDATE status='running', current_position = 1   ◄── ⚠️ HARDKODET 1
   │      (mister `nextPosition` som getOrCreateForToday akkurat beregnet!)
   │
   ├─► engineBridge.createScheduledGameForPlanRunPosition(run.id, started.currentPosition=1)
   │      ├─► SELECT idempotency: WHERE (plan_run_id, plan_position) WHERE NOT terminal
   │      ├─► hent plan + item[position-1]
   │      ├─► resolveGroupHallId, resolveParticipatingHallIds
   │      ├─► releaseStaleRoomCodeBindings (cancel rader med samme room_code)
   │      └─► INSERT scheduled-games (status='ready_to_start', room_code, plan_run_id, plan_position)
   │
   └─► drawEngine.startGame(scheduledGameId, actorUserId)
          └─► UPDATE scheduled-games status='ready_to_start' → 'running'
          (faktisk: trigger engine + INSERT app_game1_game_state)


CRON (parallelt, hvert 15 sek):
   Game1ScheduleTickService.spawnUpcomingGame1Games (legacy)
   Game1ScheduleTickService.openPurchaseForImminentGames (cron-promoter)
   Game1ScheduleTickService.transitionReadyToStartGames (cron-promoter)
   Game1ScheduleTickService.cancelEndOfDayUnstartedGames (cron-cancel)
```

### 4.2 Hvor leses "neste spill"-data?

```
KLIENT (master-UI)
   │ poll hvert 2 sek
   ▼
GET /api/agent/game1/lobby?hallId=X    (Bølge 1 — GameLobbyAggregator)
   │
   ▼
GameLobbyAggregator.getLobbyState(hallId)
   │
   ├─► GamePlanRunService.findForDay(hallId, businessDate)
   │      └─► SELECT app_game_plan_run WHERE business_date=$1 AND hall_id=$2
   │
   ├─► (hvis run finnes) GamePlanService.getById(run.planId)
   │      └─► SELECT plan + items
   │
   ├─► (hvis run + plan) buildPlanMeta:
   │      • positionForDisplay = run.currentPosition
   │      • hvis run.status='finished' AND rawPosition < items.length:
   │           positionForDisplay = rawPosition + 1  ◄── PR #1431 fix
   │
   ├─► Spill1ScheduledGameRepo.getActiveForHall(hallId)
   │      └─► Game1ScheduledGameFinder.findFor({statuses: ACTIVE, hallId})
   │            └─► SELECT scheduled-games WHERE hall i master_hall_id OR participating_halls_json
   │                AND status IN (purchase_open, ready_to_start, running, paused)
   │
   └─► return Spill1AgentLobbyState {
         currentScheduledGameId: aggregator's choice (kan være null hvis ingen aktiv),
         planMeta: { currentPosition, currentCatalogSlug, currentCatalogDisplayName, ... },
         inconsistencyWarnings: [...]
       }
```

**Critical mismatch:** `planMeta.positionForDisplay` er beregnet basert på `run.currentPosition` + `run.status`. `currentScheduledGameId` er beregnet basert på status-filter mot `app_game1_scheduled_games`. **Disse er separate kilder.**

Hvis plan-run.current_position=1 (Bingo) men scheduled-game-rad er `completed`, så:
- `positionForDisplay` = 1 (Bingo) hvis run.status != 'finished'
- `positionForDisplay` = 2 (1000-spill) hvis run.status = 'finished' AND 1 < items.length
- `currentScheduledGameId` = null (ingen aktiv scheduled-game)

UI'en må bruke `positionForDisplay` for "Neste spill"-tekst, ikke scheduled-games. Det er ikke Agent D's scope men det forklarer hvorfor scheduled-game-status alene er feil kilde.

---

## 5. Identifiserte bugs/edge-cases

### 5.1 BUG-D1: `GamePlanRunService.start()` hardkoder `current_position = 1` (linje 780)

```sql
UPDATE app_game_plan_run
SET status = 'running',
    started_at = COALESCE(started_at, now()),
    current_position = 1,            -- ⚠️ ALLTID 1, uavhengig av nextPosition
    master_user_id = $2,
    updated_at = now()
WHERE id = $1
```

**Pre-condition i `getOrCreateForToday`:** Beregner riktig `nextPosition` basert på `previousPosition` (linje 666-684 i `GamePlanRunService.ts`):
- `previousPosition < items.length` → `nextPosition = prev + 1`
- `previousPosition >= items.length` → kast `PLAN_COMPLETED_FOR_TODAY`

INSERT lager rad med `current_position = nextPosition`. Men så kommer `start()` og overskriver.

**Konsekvens for Next Game Display:**
- Master kjører Bingo (pos=1) → ferdig
- `reconcileNaturalEndStuckRuns` setter run.status='finished'
- Master klikker "Start neste spill"
- `getOrCreateForToday`: DELETE finished run, beregn nextPosition=2, INSERT idle (cp=2)
- `MasterActionService.start` sjekker `run.status === 'idle'` → kaller `planRunService.start(...)`
- `planRunService.start` UPDATE cp = 1   ◄── ⚠️ bug
- Bridge spawn for position=1 (Bingo igjen, ikke 1000-spill)

Men: `MasterActionService` har egen advance-logikk (linje 607-672) som kjører ETTER `started = await planRunService.start(...)`. Den sjekker `currentScheduledGame` for current position og advancer hvis terminal. Dette delvis mitigerer bug-en, MEN logikken antar at scheduled-game-rad for `currentPosition=1` finnes — hvis ingen rad finnes ennå (helt fresh state), gjør den ingenting.

**Reproducer:** PITFALLS §3.12 beskrev presist denne bug-en fra 2026-05-14 09:58 — Tobias-rapport at "spillet kommer aldri til 1000-spill, 5×500". Fixet av PR #1422 ved å sette `current_position=nextPosition` i `getOrCreateForToday`-INSERT, men `start()` overskriver fortsatt.

**Anbefaling:** Fjern `current_position = 1` fra `start()`-UPDATE. La `getOrCreateForToday`-INSERT være eneste sannhet for `current_position` ved start.

### 5.2 BUG-D2: `getOrCreateForToday` mister hard-coded fallback ved fresh state

I `getOrCreateForToday`-INSERT (linje 686-691):

```sql
INSERT INTO app_game_plan_run
  (id, plan_id, hall_id, business_date, current_position, status, jackpot_overrides_json)
VALUES ($1, $2, $3, $4::date, $5, 'idle', '{}'::jsonb)
```

`$5` = `nextPosition` som er:
- 1 hvis ingen forrige finished run (linje 666: `let nextPosition = 1;`)
- previousPosition + 1 hvis forrige finished run < items.length
- (else throws PLAN_COMPLETED_FOR_TODAY)

Det er korrekt. Men hvis `start()` overskriver til 1 (BUG-D1), mister vi advance.

### 5.3 BUG-D3: Race mellom `reconcileNaturalEndStuckRuns` og `MasterActionService.start`

To reconcile-paths:

1. **Cron** `reconcileNaturalEndStuckRuns` kjører hvert 30s (default threshold), UPDATE plan-run til `finished` hvis scheduled-game er `completed` > 30s.
2. **MasterActionService.start** kjører `reconcileStuckPlanRuns` umiddelbart før `getOrCreateForToday`.

Hvis master klikker "Start neste" mellom engine-completion og cron-tick:
- Plan-run.status = 'running', scheduled-game.status = 'completed'
- `MasterActionService.start`:
  - `reconcileStuckPlanRuns` → finner stuck, marker plan-run finished (audit `plan_run.reconcile_stuck`)
  - `getOrCreateForToday` → DELETE finished, INSERT idle (cp=2)
  - `start()` → UPDATE cp=1 (BUG-D1)
  - Bridge spawn for plan_position=1 → Bingo

Hvis cron-tick rakk å markere plan-run finished FØR master:
- Plan-run.status = 'finished'
- `MasterActionService.start`:
  - `reconcileStuckPlanRuns` → ingen-op (allerede finished)
  - `getOrCreateForToday` → DELETE finished, INSERT idle (cp=2)
  - `start()` → UPDATE cp=1 (BUG-D1)
  - Same result

Begge paths havner samme sted, men `reconcileStuckPlanRuns` skriver ekstra audit-event hvis den var den som markerte stuck. Det er duplikat-skriving av samme transition.

### 5.4 BUG-D4: Cron `transitionReadyToStartGames` ignorerer plan-run-state

Cron-funksjonen (linje 828-920) sjekker:
- Kun `WHERE status = 'purchase_open'`
- Ready-status per participating hall

Den ser IKKE på `plan_run_id` eller `plan_run.status`. Hvis bridge spawner en rad med `status='ready_to_start'` (initial), så er den allerede der. Hvis legacy-rad er i `purchase_open` og master har en parallell bridge-rad i `running`, kan cron tick fortsette å bumpe legacy-rad mot `ready_to_start` selv om master har en active runde via bridge-rad.

**Symptom:** UI viser to konkurrerende rader. `findActiveOrUpcomingGameForHall` returnerer den med tidligst `scheduled_start_time` — kan være feil rad.

### 5.5 BUG-D5: `findActiveOrUpcomingGameForHall` returnerer feil rad ved dual-spawn

`Game1ScheduledGameFinder.findFor({orderBy: 'first-by-scheduled-start'})` sorterer ASC på `scheduled_start_time` LIMIT 1.

Bridge-rad: `scheduled_start_time = now()` (linje 1136-1137).
Legacy-rad: `scheduled_start_time = scheduledDay + sg.startTime` fra plan-mal.

Hvis legacy-mal har en runde 30 min frem i tid og bridge spawner NÅ for current position, så vil bridge vinne (lavere `scheduled_start_time`). Men hvis legacy-mal har en runde 30 min siden (tidligere på dagen) som ennå ikke er promoted til running, så vinner legacy.

`orderBy='most-recent'` (`created_at DESC`) ville løse dette deterministisk for bridge-spawn-tid, men er ikke brukt i agent-routes.

### 5.6 BUG-D6: `engine.UPDATE status='completed'` mangler WHERE-clause-guard

`Game1DrawEngineService.ts:1413-1420`:

```sql
UPDATE app_game1_scheduled_games
SET status = 'completed',
    actual_end_time = COALESCE(actual_end_time, now()),
    updated_at = now()
WHERE id = $1
```

Ingen `AND status = 'running'`-guard. Hvis master har gjort `stopGame` MELLOM engine-completion-detect og denne UPDATE-en, vil engine overskrive `cancelled` med `completed`. Status-history mistes (men `stop_reason` er fortsatt 'master_stop' fra master-action, så vi kan reverse-engineer).

**Konsekvens:** Audit-trail blir misvisende. Også: hvis CRIT-7 rollback har satt status tilbake til pre-master-commit-status (`purchase_open`/`ready_to_start`), så vil engine senere overskrive til `completed` selv om engine-state ikke matcher.

**Anbefaling:** Legg til `AND status = 'running'` i WHERE.

### 5.7 BUG-D7: Stuck `ready_to_start` etter engine.startGame feil

Master.start UPDATE-r status til `running` FØR engine.startGame trigges. CRIT-7 rollback håndterer feilen ved å sette tilbake til `preStatus`. Men hvis rollback selv feiler (eks. DB-feil under rollback), så har vi:
- `app_game1_scheduled_games.status = 'running'`
- `app_game1_game_state` finnes IKKE (engine.startGame feilet)
- Auto-draw-tick hopper over (krever game_state-rad)
- Master kan ikke pause (engine kaster fordi state mangler)

Per CRIT-7-kommentar (Game1MasterControlService.ts:811): "Rollback feilet — vi kan ikke gjøre mer her. Loggen er kritisk for ops-recovery (manuell DB-edit)."

**Symptom for Next Game Display:** Plan-run.status='running', scheduled-game.status='running' for evig. Master-UI viser "kjørende spill" som ikke faktisk kjører.

### 5.8 BUG-D8: `app_daily_schedules.status='running'` etter pilot-dag uten dynamic stop

`Game1ScheduleTickService.spawnUpcomingGame1Games` (linje 398-407) filtrerer på `app_daily_schedules.status='running'`. Hvis admin ikke har manuelt satt `stop_game=true` eller `status='paused'`, vil legacy-cron fortsette å spawne hver tick — også etter pilot-dag er ferdig.

Seed setter `status='running'`. Det er bevisst design for å la cron umiddelbart spawne, men når plan-runtime tar over (Bølge 4-mål), bør legacy stoppes for samme hall.

---

## 6. Recommendations (anbefalinger for arkitektur-konsolidering)

### 6.1 KRITISK — fjern `current_position = 1` fra `GamePlanRunService.start()`

**Fil:** `apps/backend/src/game/GamePlanRunService.ts:780`

```diff
 await this.pool.query(
   `UPDATE ${this.table()}
    SET status = 'running',
        started_at = COALESCE(started_at, now()),
-       current_position = 1,
        master_user_id = $2,
        updated_at = now()
    WHERE id = $1`,
   [run.id, masterUserId.trim()],
 );
```

`getOrCreateForToday`-INSERT setter allerede korrekt `current_position` basert på `previousPosition`. `start()` skal kun flippe state-machine til 'running', ikke endre position.

**Test som må skrives:** Verifiser at flyten `getOrCreateForToday(nextPos=2) → start()` resulterer i `current_position = 2` (ikke 1).

### 6.2 KRITISK — Bølge 4: skip legacy-spawn for plan-haller

**Fil:** `apps/backend/src/game/Game1ScheduleTickService.ts:386-771` (`spawnUpcomingGame1Games`)

Legg inn guard etter daily_schedule-resolve:

```typescript
// Bølge 4 (2026-05-XX): Skip legacy-spawn for haller med aktiv plan.
const hasActivePlan = await this.checkHallHasActivePlan(
  daily.hallIds.masterHallId,
  isoDay,
);
if (hasActivePlan) {
  log.debug(
    { dailyScheduleId: daily.id, hallId: daily.hallIds.masterHallId, isoDay },
    "[bolge-4] skip legacy-spawn — hall har aktiv plan for samme dag",
  );
  result.skippedSchedules += 1;
  continue;
}
```

`checkHallHasActivePlan` = SELECT 1 FROM app_game_plan WHERE (hall_id = $1 OR group_of_halls_id IN ...) AND is_active = TRUE AND $2 in weekdays_json LIMIT 1.

Eller, mer aggressivt: Sjekk om det finnes en `app_game_plan_run` for `(hall, business_date)`, og hvis ja, skip.

### 6.3 SEKUNDÆR — Konsolider status-overganger gjennom én service

I dag er det 11+ steder som skriver til `app_game1_scheduled_games`. Hver med egen WHERE-guard og audit-strategi.

Forslag: `ScheduledGameStatusService` med metoder:
- `transition(gameId, fromStatus[], toStatus, ctx)` — sentral WHERE-clause-guard
- `cancel(gameId, reason, actor)` — én cancel-flyt
- `complete(gameId, finalCtx)` — én complete-flyt
- Audit-event skrives sentralt

Disse erstatter all direkte SQL i `Game1MasterControlService`, `Game1DrawEngineService`, `Game1ScheduleTickService`, `GamePlanEngineBridge`, etc.

Risk-mitigation: Service-en er stateless og kan testet for hver transition. Eksisterende services kaller den i stedet for å gjøre egne UPDATE.

### 6.4 SEKUNDÆR — `engine.UPDATE status='completed'` må ha WHERE-guard

**Fil:** `apps/backend/src/game/Game1DrawEngineService.ts:1413-1420`

```diff
 await client.query(
   `UPDATE ${this.scheduledGamesTable()}
       SET status          = 'completed',
           actual_end_time = COALESCE(actual_end_time, now()),
           updated_at      = now()
-    WHERE id = $1`,
+    WHERE id = $1
+      AND status IN ('running', 'paused')`,
   [scheduledGameId]
 );
```

Forhindrer at engine skriver over `cancelled` med `completed`.

### 6.5 OBSERVABILITY — Audit-event på hver status-transition

I dag har mange transitioner ingen tilhørende audit-event:
- Cron `openPurchaseForImminentGames` → ingen audit
- Cron `transitionReadyToStartGames` → kun `log.info`, ingen audit
- Cron `cancelEndOfDayUnstartedGames` → ingen audit
- `Game1RecoveryService.cancelOverdueGame` → noe audit men inkonsistent

Lotteritilsynet trenger full audit-trail. Forslag: hvert UPDATE skal skrive til `app_game1_master_audit` med `action='status_changed'`, `metadata={from, to, reason, triggeredBy}`.

---

## 7. Hva som ALDRI skal endres uten Tobias-godkjenning

- `getCanonicalRoomCode` deterministisk mapping fra slug+hall → `room_code`. Dette er fundamentet for `releaseStaleRoomCodeBindings` og auto-draw-tick-broadcasting.
- Idempotency-sjekk i bridge på `(plan_run_id, plan_position) WHERE status NOT IN ('cancelled', 'completed')` (linje 962-971). Endre filter-statusene kun via PITFALLS §4.4-prinsipp.
- F-NEW-3 `releaseStaleRoomCodeBindings`-pre-INSERT-pass. Uten den blokkerer unique-index på room_code nye runder etter forrige runde sin completed-rad er ryddet.
- Partial unique index `idx_app_game1_scheduled_games_room_code` (migration `20261221000000`) som ekskluderer terminal status. Endre filter krever forsiktig review.

---

## 8. SKILL_UPDATE_PROPOSED (utsettes til Trinn 2)

Følgende skill-oppdateringer foreslås men er ikke i scope for Trinn 1:

### 8.1 SKILL `spill1-master-flow` — utvid §"Scheduled-game lifecycle"

- Dokumenter komplette state-overgang-diagram (§2 i denne rapporten)
- Marker BUG-D1 (`start()` hardkoder current_position=1) som kjent fallgruve
- Legg til guidance: "ALDRI overstyr `current_position` i status-transitions — kun i `getOrCreateForToday`"
- Legg til: "Cron `transitionReadyToStartGames` ignorerer plan-runtime — bridge spawn må starte på `ready_to_start` for å bypasse cron-gate"

### 8.2 SKILL `database-migration-policy` — utvid §"WHERE-guards i UPDATE"

- Legg til guidance: "All UPDATE av `app_game1_scheduled_games.status` MÅ ha `AND status IN (...)` WHERE-guard. Ellers kan engine overskrive master-cancel, eller vice versa."

### 8.3 PITFALLS_LOG §3 — nye entries

#### §3.14 (foreslått) — `Game1ScheduleTickService.spawnUpcomingGame1Games` aktiv i prod (Bølge 4 ikke fullført)

**Severity:** P0 (dual-spawn til samme tabell)
**Oppdaget:** 2026-05-14 (Agent D research)
**Symptom:** Pilot-haller har `app_daily_schedules` + `app_game_plan` for samme hall + business_date. Begge spawn-paths kan kjøre parallelt og lage to scheduled-game-rader.
**Root cause:** Bølge 4 (PLAN_SPILL_KOBLING audit §7) er IKKE fullført. `Game1ScheduleTickService.spawnUpcomingGame1Games` har ingen "skip if plan exists"-guard. `GAME1_SCHEDULE_TICK_ENABLED=true` i prod.
**Fix:** Implementer Bølge 4 guard (se §6.2 i denne rapporten). I mellomtiden: master-flyt fungerer fordi F-NEW-3 cancels stale rader, men UI kan vise feil rad i mellomtilstand.
**Prevention:**
- Verifiser via SQL: `SELECT count(*) FROM app_game1_scheduled_games WHERE daily_schedule_id IS NOT NULL AND plan_run_id IS NOT NULL` skal være 0
- Verifiser via SQL: `SELECT hall_id, business_date, count(*) FROM app_game_plan_run WHERE business_date = CURRENT_DATE GROUP BY 1, 2 HAVING count(*) > 1` skal være tom

#### §3.15 (foreslått) — `GamePlanRunService.start()` overskriver `current_position`

**Severity:** P0 (latent bug — kan trigge "Bingo igjen" i Next Game Display)
**Oppdaget:** 2026-05-14 (Agent D research)
**Symptom:** Etter `getOrCreateForToday` beregner riktig `nextPosition=2`, `start()`-UPDATE overskriver til 1.
**Root cause:** Linje 780 i `GamePlanRunService.ts` har hardkodet `current_position = 1` som arv fra opprinnelig implementasjon.
**Fix:** Fjern `current_position = 1` fra `start()`-UPDATE (se §6.1).
**Prevention:**
- Test som verifiserer at `(getOrCreateForToday → start)` for nextPos=2 resulterer i `current_position = 2`
- MasterActionService advance-logikk (linje 607-672) er WORKAROUND, ikke fix

---

## 9. AGENT_EXECUTION_LOG entry

```markdown
### 2026-05-14 — Agent D — Next Game Display research (Scheduled-game lifecycle)

**Branch:** `research/next-game-display-d-scheduledgame-2026-05-14`
**Agent type:** general-purpose (PM Trinn 1)
**Tidsbudsjett brukt:** ~70 min (les + analyse + dokumentasjon)

**Hva ble gjort:**
- Mappet alle 14 writer-sites mot `app_game1_scheduled_games`-tabellen
- Mappet 11 reader-sites for "neste spill"-data
- Verifiserte at Bølge 4 (legacy-spawn skip-guard) IKKE er fullført — `GAME1_SCHEDULE_TICK_ENABLED=true` i prod
- Identifiserte 8 strukturelle bugs/edge-cases (BUG-D1 til BUG-D8)
- Konstruerte komplett state-overgang-diagram inkl. auto-pause side-state
- Verifiserte race-condition-håndtering for hver transition

**Kritiske funn:**
1. `GamePlanRunService.start()` hardkoder `current_position = 1` (linje 780) — kjent bug-kilde for "Bingo igjen" i Next Game Display
2. Dual-spawn-problem (legacy + bridge) er aktivt i prod — Bølge 4 må fullføres
3. `engine.UPDATE status='completed'` mangler WHERE-guard mot `status='cancelled'`
4. Tre forskjellige reconcile-paths kan kollidere ved naturlig runde-end

**Output:**
- `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md` (denne filen)

**Lessons learned:**
- Idempotency-keys for legacy vs bridge er disjunkte (`(daily_schedule_id, ...)` vs `(plan_run_id, plan_position)`) — DB tillater dual-spawn uten konflikt. Audit-trail må håndtere det.
- F-NEW-3 `releaseStaleRoomCodeBindings` redder pilot-flyten ved å auto-cancel legacy-rader med samme room_code, men det er en kompensation, ikke en fix.
- `MasterActionService` har egen advance-logikk (linje 607-672) som mitigerer BUG-D1, men bare for visse paths.

**Ingen kode-endringer.** Read-only audit.
```

---

## 10. Referanser

- [`docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md`](../architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md) — audit-skall
- [`docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`](../architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md) — §5 C1 (dual-spawn) + §7 Bølge 4
- [`docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) — §4 Backend-tjenester
- [`docs/engineering/PITFALLS_LOG.md`](../engineering/PITFALLS_LOG.md) §§3.9-3.13 — kjente fallgruver
- `apps/backend/src/game/Game1ScheduleTickService.ts` — LEGACY spawn-path
- `apps/backend/src/game/GamePlanEngineBridge.ts:887-1465` — BRIDGE spawn-path
- `apps/backend/src/game/Game1MasterControlService.ts` — master-actions
- `apps/backend/src/game/GamePlanRunService.ts:536-794` — plan-run lifecycle
- `apps/backend/src/game/Game1ScheduledGameFinder.ts` — Bølge 6 konsolidert finder
- `apps/backend/src/routes/agentGame1.ts:256-295` — finder-wrappers
- `apps/backend/src/game/Game1DrawEngineService.ts:1411-1450` — engine-completion-UPDATE
- `apps/backend/src/game/GamePlanRunCleanupService.ts:332-465` — `reconcileNaturalEndStuckRuns`
- `apps/backend/src/jobs/game1ScheduleTick.ts` — cron job
- `apps/backend/migrations/20260428000000_game1_scheduled_games.sql` — original schema
- `apps/backend/migrations/20261210010000_app_game1_scheduled_games_catalog_link.sql` — catalog/plan FK
- `apps/backend/migrations/20261210010100_app_game1_scheduled_games_nullable_legacy_fks.sql` — NULLABLE legacy FKs
- `apps/backend/migrations/20261221000000_app_game1_scheduled_games_room_code_active_only.sql` — partial unique index

---

**Slutt på Agent D's data-collection.**
