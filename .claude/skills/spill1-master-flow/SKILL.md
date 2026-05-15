---
name: spill1-master-flow
description: When the user/agent works with Spill 1 master-konsoll, plan-runtime, scheduled-game lifecycle, GoH-master-rom, or hall-ready-state. Also use when they mention master-actions, GamePlanRunService, GamePlanEngineBridge, Game1MasterControlService, Game1HallReadyService, Game1TransferHallService, Game1ScheduleTickService, Game1LobbyService, GameLobbyAggregator, MasterActionService, NextGamePanel, Spill1HallStatusBox, Spill1AgentControls, plan-run-id, scheduled-game-id, currentScheduledGameId, master-hall, ekskluderte haller, "Marker Klar", "Start neste spill", master-flyt, plan-runtime-koblingen, ADR-0021, ADR-0022, stuck-game-recovery, I14, I15, I16, BIN-1018, BIN-1024, BIN-1030, BIN-1041. Make sure to use this skill whenever someone touches the master/agent UI, plan or scheduled-game services, or anything related to who controls a Spill 1 round — even if they don't explicitly ask for it.
metadata:
  version: 1.18.0
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

### Auto-advance fra finished plan-run (BUG E, 2026-05-14)

**Tobias-direktiv 2026-05-14 09:58 (KANONISK):**
> "Hvert spill spilles kun en gang deretter videre til nytt spill. Før var det sånn at man måtte spille dette spillet 2 ganger før den går videre til neste på lista. Nå går den ikke videre til neste spiller heller."

**Hvordan flyten fungerer nå (etter fix):**

1. Master klikker "Start neste spill" → `MasterActionService.start()` → `GamePlanRunService.getOrCreateForToday()`
2. `getOrCreateForToday` ser at det finnes en `status='finished'` plan-run for `(hall_id, business_date)` i dag
3. Capture `previousPosition = existing.currentPosition` FØR DELETE
4. DELETE finished-raden + INSERT ny idle-rad med:
   - `current_position = previousPosition + 1` hvis flere positions gjenstår i planen
   - `current_position = 1` hvis previousPosition var siste position (wrap til ny syklus)
5. Bridge spawner scheduled-game for nye position → master spiller neste spill i sekvensen

**Eksempel-flyt (13-spill plan):**
- Runde 1: master starter → Bingo (position=1) spilles ferdig → plan-run finished på pos=1
- Runde 2: master klikker "Start neste spill" → nye plan-run på pos=2 (1000-spill) — IKKE Bingo igjen!
- Runde 3: 1000-spill ferdig → master starter neste → pos=3 (5×500)
- ... osv til position=13 (TV-Extra)
- Runde 14: TV-Extra ferdig → master starter neste → pos=1 (Bingo, ny syklus)

**Hvorfor er dette nødvendig:**

F-Plan-Reuse (PR #1006, 2026-05-09) introduserte DELETE+INSERT for å la master starte ny runde samme dag etter accidental stop. Men den hardkodet `current_position=1` på den nye raden — uavhengig av hvor langt forrige plan-run faktisk kom. Resultat (Tobias' rapport):
- Bingo (position=1) spilles → finished på pos=1
- Master klikker "Start neste spill" → ny plan-run på pos=1 → Bingo IGJEN
- Master spiller Bingo 2-3 ganger før systemet endelig advancerer

**Audit-trail:**

Audit-eventet `game_plan_run.recreate_after_finish` inkluderer disse feltene for Lotteritilsynet-sporing:
```json
{
  "previousRunId": "<UUID av forrige plan-run>",
  "previousPosition": 1,
  "newPosition": 2,
  "autoAdvanced": true,
  "planItemCount": 13,
  "planId": "<UUID>",
  "hallId": "<UUID>",
  "businessDate": "2026-05-14",
  "bindingType": "direct" | "group"
}
```

`autoAdvanced=true` betyr at vi advancerte fra forrige posisjon. `autoAdvanced=false` betyr wrap (siste posisjon → 1) eller defensive fallback (plan har 0 items eller previousPosition > items.length).

**Symptom hvis denne fjernes:** Master må klikke "Start neste spill" gjentatte ganger — hver gang starter samme spill (Bingo). Spillet kommer ALDRI til pos=2 fordi `current_position=1` alltid resettes ved finished-replay.

**Tester som beskytter mot regresjon:**
- `apps/backend/src/game/__tests__/GamePlanRunService.autoAdvanceFromFinished.test.ts` (10 tester)
  - Ingen tidligere → pos=1
  - Forrige pos=1 → ny pos=2
  - Forrige pos=2 → ny pos=3
  - Forrige pos=12 → ny pos=13 (siste)
  - Forrige pos=13 (siste) → wrap til 1
  - previousPosition > items.length → wrap til 1 (defensiv)
  - Plan med 0 items → wrap til 1
  - idle/running plan-run → returneres som-er (ingen advance)
  - Audit-event inkluderer alle sporbarhets-felter

**Plassering:** `apps/backend/src/game/GamePlanRunService.ts` — `getOrCreateForToday()` linje ~570-720. NB: `planService.list()` returnerer `GamePlan[]` (uten items), så vi kaller `planService.getById(matched.id)` for å få `GamePlanWithItems.items.length`.

### Plan-run.start() invariant — bevarer current_position (BUG-D1 fix 2026-05-15)

**Invariant:** `GamePlanRunService.start()` skal ALDRI overstyre `current_position`. `getOrCreateForToday`-INSERT er eneste sannhet for posisjon ved start. `start()` flipper kun state-machine: `idle → running` + setter `started_at` + `master_user_id`.

**Pre-fix-bug (BUG-D1, FIXED 2026-05-15):**
- Linje 780 hadde hardkodet `current_position = 1` i UPDATE-en
- Symptom: Master spilte Bingo (pos=1) gjentatte ganger i stedet for å advance til 1000-spill, 5×500, osv. fordi `start()` resettet auto-advanced posisjonen
- Dette var én av 5 rot-årsaker til "Neste spill"-display-bug-en som ble fixet 4 ganger uten å løse alle paths (PR #1370, #1422, #1427, #1431)
- Audit-trail referanse: `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md` §5.1 + `docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md`
- Symptom: Master spilte Bingo (pos=1) gjentatte ganger i stedet for å advance til 1000-spill, 5×500
- Audit-trail referanse: PITFALLS §3.15 + `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md` §5.1

**Post-fix SQL:**
```sql
UPDATE app_game_plan_run
SET status = 'running',
    started_at = COALESCE(started_at, now()),
    -- current_position skal IKKE være her — INSERT er sannhet
    master_user_id = $2,
    updated_at = now()
WHERE id = $1
```

**Hvilke services ER tillatt å mutere current_position:**
- `getOrCreateForToday`-INSERT (eneste sted som setter initial posisjon ved start av dagen)
- `advanceToNext()` (eksplisitt UPDATE som inkrementerer)
- `rollbackToPrePosition()` / lignende rollback-paths (eksplisitt med både gammel- og ny-verdi i WHERE for race-safety)

**Hvilke services skal IKKE mutere current_position:**
- `start()` — kun state-flip
- `pause()` — kun status-overgang
- `resume()` — kun status-overgang
- `finish()` — kun status-overgang
- Andre UPDATE-paths i denne service-en

**Tester som beskytter mot regresjon:**
- `apps/backend/src/game/__tests__/GamePlanRunService.startPreservesPosition.test.ts` (6 tester):
  - `start()` bevarer cp=2 (regression for selve BUG-D1)
  - SQL-UPDATE inneholder ikke `current_position = ` (strukturell guard — feiler hvis noen reintroduserer hardkoding)
  - cp=5 bevares (vilkårlig mid-plan position)
  - cp=1 bevares (sanity-test for første-spill)
  - Audit-event `game_plan_run.start` skrives uendret
  - `GAME_PLAN_RUN_INVALID_TRANSITION` kastes ved non-idle status (uendret guard)
- `getOrCreateForToday`-INSERT (eneste sted som setter initial posisjon)
- `advanceToNext()` (eksplisitt UPDATE som inkrementerer)

**Hvilke services skal IKKE mutere current_position:**
- `start()`, `pause()`, `resume()`, `finish()` — kun state-flip

**Tester som beskytter mot regresjon:**
- `apps/backend/src/game/__tests__/GamePlanRunService.startPreservesPosition.test.ts` (6 tester)

### Plan-runtime overstyrer legacy-spawn (Bølge 4 fix 2026-05-15)

**Invariant:** `Game1ScheduleTickService.spawnUpcomingGame1Games` skipper haller med aktiv `app_game_plan_run`-rad for samme `business_date`. Plan-runtime + bridge er eneste spawn-path for plan-haller. Ikke-plan-haller fortsetter med legacy-cron (bakoverkompat).

**Pre-fix-bug (Bølge 4 IKKE fullført, FIXED 2026-05-15):**
- `Game1ScheduleTickService.spawnUpcomingGame1Games` (legacy-cron) hadde INGEN guard mot å spawne for haller hvor plan-runtime + bridge allerede har overtatt
- `GamePlanEngineBridge.createScheduledGameForPlanRunPosition` (master-trigger) spawnet uavhengig
- Idempotency-keys disjunkte: legacy = `(daily_schedule_id, scheduled_day, sub_game_index)` UNIQUE, bridge = `(plan_run_id, plan_position) WHERE NOT terminal`
- Resultat: to scheduled-game-rader for samme (hall, dato) parallelt. UI viste én, master-action treffet en annen
- Plan-runtime (Bølge 1-3, 2026-05-08) erstattet legacy-spawn for plan-haller, men legacy-cron ble aldri skrudd av. Bølge 4 (deaktivere legacy) ble glemt
- Audit-trail referanse: PITFALLS §3.14 + `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md` §3 + §6.2

**Post-fix flyt:**
- Ny helper `checkHallsWithActivePlanRuns(hallIds, dateRange)`: bulk-query mot `app_game_plan_run` for kandidat-haller i lookahead-vinduet, returnerer Set med keys `${hallId}|${isoDay}` for O(1)-lookup
- Spawn-loop sjekker `activePlanRunKeys.has(${masterHallId}|${isoDay})` etter daily-schedule + weekday-validering, men FØR sub-game-iterasjon
- Hvis hall har plan-run for dagen → skip alle subgames for den dagen (teller som `skippedSchedules`)
- Plan-run-query-feil (eks. test-DB uten migrasjoner) → fail-open: warning logges, legacy-spawn fortsetter normalt

**Hvorfor sjekke plan-run-rad (ikke bare plan-config):**
- Plan-config viser BARE at hall *kan* ha plan på denne ukedagen
- Plan-run viser at plan-runtime FAKTISK har tatt over for (hall, dato)
- Strengere guard — slår kun inn etter master har startet via plan-runtime; bakoverkompat for haller uten aktiv plan-runtime

**Hvorfor F-NEW-3 fortsatt er nødvendig:**
- F-NEW-3 `releaseStaleRoomCodeBindings` (2026-05-12) canceller stale rader ved bridge-INSERT — defense-in-depth
- ALDRI fjern F-NEW-3 selv etter Bølge 4 — komplementære guards: Bølge 4 hindrer DB-spawn, F-NEW-3 rydder eldre rader

**Tester som beskytter mot regresjon:**
- `apps/backend/src/game/Game1ScheduleTickService.test.ts` (6 nye Bølge 4-tester):
  - Skip legacy-spawn for plan-haller (positiv case)
  - Legacy-spawn fortsatt aktiv for ikke-plan-haller (negativ case)
  - Blandet — én plan-hall + én legacy-hall i samme tick
  - Skip kun gjelder spesifikk (hall, dato) — andre dager spawnes
  - DB-feil i plan-run-query → fail-open
  - Ingen plan-run-query når kandidat-haller er tom

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

### Design-iterasjons-sider (stand-alone preview, ingen live-stack)

For raskt å tweake design uten å starte hele spill-stacken finnes det
stand-alone preview-sider under `packages/game-client/src/*-design/` som
bygges via egne Vite-configs:

| URL | Filer | Vite-config | Build-script | Når bruke |
|---|---|---|---|---|
| `/web/games/premie-design.html` | `src/premie-design/premie-design.html` | `vite.premie-design.config.ts` | `npm --prefix packages/game-client run build:premie-design` | Premietabell-design (5×3 grid Hvit/Gul/Lilla, mini-grid, player-info, actions) |
| `/web/games/bong-design.html` | `src/bong-design/bong-design.{html,ts}` | `vite.bong-design.config.ts` | `npm --prefix packages/game-client run build:bong-design` | Bong-design preview (3 farger × 3 scenarier: fresh / mid-spill / Rad 1 bingo) |
| `/web/games/preview.html` | `src/preview/*` | `vite.preview.config.ts` | (del av `build`) | Spill 1 bonus-games preview (Pixi-runtime) |
| `/web/games/visual-harness.html` | `src/visual-harness/*` | `vite.visual-harness.config.ts` | `npm --prefix packages/game-client run build:visual-harness` | Pixi-snapshot visual regression (Playwright) |
| `/web/games/dev-overview.html` | `src/dev-overview/*` | `vite.dev-overview.config.ts` | `npm --prefix packages/game-client run build:dev-overview` | Sentral dev-landingsside med iframes/lenker til alle preview-sider |

**Regel ved iterasjon:** Når design er godkjent i preview-siden MÅ
endringen reflekteres 1:1 i prod-komponenten (`BingoTicketHtml.ts` for
bong, `CenterTopPanel.ts` for premietabell). Hvis preview avviker fra
prod uten å oppdatere prod, blir preview-siden falsk sannhet. Se
PITFALLS_LOG §7.26 (bong) + §7.24 (premie).

## Master-UI header-tekst per state (KANONISK — Tobias-direktiv 2026-05-15 IMMUTABLE)

**Tobias-direktiv 2026-05-15 (IMMUTABLE):**
> "Uavhengig av hvilken status agentene har skal teksten ALLTID være FØR spillet starter: 'Neste spill: {neste spill på lista}'. Når spillet er i gang: 'Aktiv trekning: {neste spill på lista}'."

Dette superseder den eldre mappingen (2026-05-14) med "Klar til å starte" og "Runde ferdig" som mellom-states. **Alle pre-running-states viser nå "Neste spill: {name}".** Bare `running` viser "Aktiv trekning: {name}" (med KOLON, ikke bindestrek).

**Korrekt mapping per `Spill1ScheduledGameStatus`:**

| Master-state | Header-tekst | Kommentar |
|---|---|---|
| `idle` (ingen plan-run aktiv) | "Neste spill: {gameName}" | Master kan starte |
| `scheduled` (sched-game spawnet, ikke startet) | "Neste spill: {gameName}" | Master kan starte |
| `purchase_open` | "Neste spill: {gameName}" | Bonge-salg åpent, engine IKKE running |
| `ready_to_start` | "Neste spill: {gameName}" | Master har trykket "Marker klar" — fortsatt pre-game |
| `running` | "**Aktiv trekning: {gameName}**" | **ENESTE state hvor "Aktiv trekning" er gyldig.** Bruk KOLON, ikke bindestrek. |
| `paused` | "Pauset: {gameName}" | Engine pauset (manuell eller auto) — midt i runde |
| `completed` | "Neste spill: {gameName}" | Aggregator setter `catalogDisplayName` til NESTE plan-item (PR #1422). Header viser kommende spill, ikke det som nettopp ble ferdig. |
| `cancelled` | "Neste spill: {gameName}" | Samme som completed |
| `plan_completed_for_today` | "Spilleplan ferdig for i dag" (+ "— neste plan: HH:MM neste dag" hvis info) | Hele planen ferdig |
| `closed` / `outside_opening_hours` | "Stengt — åpner HH:MM" | Utenfor åpningstid |

**Helper:** `getMasterHeaderText(state, gameName, info?)` i `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`. Pure function (no DOM, no fetch), eksportert. 41 tester i `apps/admin-web/tests/masterHeaderText.test.ts` med 3 regression-trip-wires:
1. INGEN ikke-running state returnerer streng som starter med "Aktiv trekning" (Tobias-bug 2026-05-14)
2. INGEN state returnerer "Klar til å starte" (Tobias-bug 2026-05-15)
3. INGEN state returnerer "Runde ferdig" (Tobias-bug 2026-05-15)
4. Running bruker KOLON (`:`), ikke bindestrek (` - `) (Tobias-direktiv 2026-05-15)

**Backend-støtte for "Neste spill: Bingo" i idle:** Aggregator slår opp aktiv plan via `GamePlanRunService.findActivePlanForDay(hall, businessDate)` når ingen plan-run finnes. Det betyr at `catalogDisplayName` settes til `items[0].displayName` direkte etter `dev:nuke` — ingen "tom" header. Tobias-bug 2026-05-15 Image 1.

**Tester som beskytter:**
- `apps/admin-web/tests/masterHeaderText.test.ts` — 41 tester (frontend mapping)
- `apps/backend/src/game/__tests__/GameLobbyAggregator.test.ts` — 26 tester (inkl. 2 nye for `catalogDisplayName` i idle-state uten plan-run)
- Alle må passere i CI før merge.

**ALDRI:**
- Hardkode "Aktiv trekning" som standard header — det er state-driven
- Vis "Klar til å starte" eller "Runde ferdig" (Tobias-direktiv 2026-05-15 — fjernet)
- Bruk bindestrek mellom "Aktiv trekning" og navnet — det skal være KOLON

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

### 14. Engine UPDATE må ha status-guard mot terminal status (BUG-D6, fikset 2026-05-15)

**Symptom:** `app_game1_scheduled_games`-rad var `cancelled` (eller `finished`), men engine overskrev til `completed`. Audit-trail blir korrupt fordi terminal status forsvinner.

**Root cause:** `Game1DrawEngineService.ts` endRound-pathen sendte en UPDATE uten WHERE-guard:

```sql
-- FØR fix (BUG-D6)
UPDATE app_game1_scheduled_games
SET status='completed', actual_end_time = ..., updated_at = now()
WHERE id = $1
```

Race-window: master eller cron flippet status til `cancelled` mellom engine-completion-detect og denne UPDATE-en, og engine kjørte rett over.

**Fix (PR for BUG-D6):**

```sql
-- ETTER fix
UPDATE app_game1_scheduled_games
SET status='completed', actual_end_time = ..., updated_at = now()
WHERE id = $1
  AND status IN ('running', 'paused')
```

Engine kan kun flippe til `completed` fra ikke-terminal status. Hvis raden allerede er `cancelled` / `completed` / `finished`, no-op'er UPDATE-en (rowCount=0) og transaksjonen fortsetter — service-koden avhenger IKKE av rowCount==1.

**Kanonisk pattern (alle UPDATE som flipper til terminal status):**

```sql
UPDATE <table>
SET status = '<terminal>', ...
WHERE id = $1
  AND status IN (<ikke-terminal-statuser>)
```

Aldri whitelist `cancelled` / `completed` / `finished` i WHERE-guarden for en flip TIL en av disse — det åpner igjen for race-overskrivning.

**Referanser:**
- Agent D research §5.6 + §6.4 — `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md`
- Audit-skall — `docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md`
- PITFALLS entry §3.X — `docs/engineering/PITFALLS_LOG.md`
- Regression-suite — `apps/backend/src/game/__tests__/Game1DrawEngineService.bugD6StatusGuard.test.ts` (4 tester)

**Konsekvens for skill:** Hvis du legger til ny UPDATE som flipper en scheduled-game eller plan-run til terminal status, kopier WHERE-guard-mønsteret. Glem aldri å skrive regression-test som låser SQL-formen — guard-fjerning skal være vanskelig å gjøre ved uhell.

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

## Bong-pris bevares gjennom game-state-transisjoner (PR #1423, 2026-05-14)

> **Tobias-direktiv 2026-05-14:** Når engine starter (status: WAITING → RUNNING), MÅ frontend bevare bong-pris-display. Priser skal ALDRI vises som "0 kr" på en kjøpt bonge.

### Bug-historie

Pre-trekning viste bong-pris korrekt (5/10/15 kr). UNDER trekning (etter engine-start) viste alle bonger "0 kr". Innsats totalt var riktig (30 kr = 5+10+15 i DB), men individuell pris per brett ble 0.

### Root cause (field-navn-mismatch)

`GamePlanEngineBridge.buildTicketConfigFromCatalog` skriver `pricePerTicket` i `ticket_config_json.ticketTypesData[]`. Men `Game1ScheduledRoomSnapshot.entryFeeFromTicketConfig` leste KUN `priceCentsEach`. Når engine startet (status WAITING → RUNNING) trigget `enrichScheduledGame1RoomSnapshot` bygging av `currentGame` med `entryFee = 0`. Det propagerte via `roomHelpers.currentEntryFee` (linje 420, `??` tar ikke 0) → `enrichTicketList` satte alle `ticket.price = 0` → klient-state.entryFee ble overskrevet til 0 → `gridEntryFee = state.entryFee ?? 10` ble 0 (samme `??`-bug på klient).

### Kilder (i prioritert rekkefølge)

1. `state.ticketTypes` + `state.entryFee` (room-snapshot) — primær når > 0
2. `lobbyTicketConfig.entryFee` + `lobbyTicketConfig.ticketTypes` — fallback hvis state-clear eller state.entryFee=0
3. `ticket.price` (server-side) — KUN hvis ≠ 0 (defensive)

ALDRI bruk `ticket.price === 0` som gyldig pris — fall til computed.

### Fix (defense-in-depth, 5 lag)

1. **Backend `entryFeeFromTicketConfig`** (Game1ScheduledRoomSnapshot.ts:182-196): les alle 4 historiske felt-navn (`priceCents`, `priceCentsEach`, `pricePerTicket`, `price`) — matcher `Game1TicketPurchaseService.extractTicketCatalog`
2. **Backend `roomHelpers.currentEntryFee`** (line 420): `> 0`-sjekk istedenfor `??` (match line 386-388 for `variantEntryFee`)
3. **Klient `GameBridge.applyGameSnapshot`** (line 854): overskriv `state.entryFee` KUN hvis `game.entryFee > 0`
4. **Klient `PlayScreen.gridEntryFee`**: `validStateEntryFee = entryFee > 0 ? entryFee : null` → `??`-fallback fungerer riktig
5. **Klient `TicketGridHtml.computePrice`**: `ticket.price > 0`-sjekk istedenfor `typeof === "number"` (0 er et tall)
6. **Klient `BingoTicketHtml.priceEl + populateBack`**: skjul price-rad hvis 0 (ALDRI vis "0 kr" på en kjøpt bonge)

### Verifisering

- Backend: 3 nye tester i `Game1ScheduledRoomSnapshot.test.ts` (pricePerTicket prod-format, priceCentsEach legacy-format, defensive 0-return)
- Klient: 6 nye tester i `TicketGridHtml.priceZeroBug.test.ts` (alle 6 scenarier — pre/under-game, server-side 0, lobby-fallback)

### ALDRI tillat priceEl å vise "0 kr"

Kjøpt bonge har alltid pris > 0. Hvis du ser "0 kr" på en bonge i klient-UI, er det en regression — sjekk hele defensive-laget for `> 0`-checks (ikke `??`-fallback på numeric fields).

## Pre-runde bong-pris: lobby-types autoritativ over server-pris (PR #<bong-pris-pre-runde-bug>, 2026-05-15)

> **Tobias-direktiv 2026-05-15:** Pre-runde bong-pris MÅ vise riktig pris per bongfarge (5/10/15 kr for hvit/gul/lilla i standard Spill 1). Backend's `enrichTicketList` kan ikke stoles på FØR master har spawnet scheduled-game — den faller tilbake til env-default `AUTO_ROUND_ENTRY_FEE=20` × DEFAULT-variant `priceMultiplier=1` = 20 kr for ALLE bonger.

### Bug-historie (Tobias-rapport 2026-05-15)

Etter spilleren kjøpte Small White + Small Yellow + Small Purple (5 kr / 10 kr / 15 kr — én av hver) FØR master trykket Start, viste ALLE 3 bonger pris "20 kr" i pre-runde-grid. Etter master trykket Start: korrekt pris (5/10/15 kr). Bug var INTERMITTENT — etter første master-start beholdt backend `roomConfiguredEntryFeeByRoom`-cache, så neste runde i samme rom-kode viste riktige priser. `dev:nuke` eller backend-restart wipe-et state og bug-en kom tilbake for første runde.

### Root cause

Pre-runde har ingen scheduled-game spawnet ennå (master har ikke trykket Start). `roomState.roomConfiguredEntryFeeByRoom` er tom for rom-koden. `getRoomConfiguredEntryFee(roomCode)` faller tilbake til `runtimeBingoSettings.autoRoundEntryFee` = `AUTO_ROUND_ENTRY_FEE=20` (`apps/backend/.env:41`). Parallelt setter `bindVariantConfigForRoom(roomCode, { gameSlug: "bingo" })` (`apps/backend/src/sockets/gameEvents/roomEvents.ts:594-600`) DEFAULT_NORSK_BINGO_CONFIG der ALLE small_* har flat `priceMultiplier=1, ticketCount=1` (`apps/backend/src/game/variantConfig.ts:514-538`). Server-side `enrichTicketList` (`apps/backend/src/util/roomHelpers.ts:458-509`) regner derfor `t.price = 20 × 1 / 1 = 20` for ALLE bonger uavhengig av farge.

### Hvorfor intermittent

Etter master trykker "Start neste spill" trigger `onScheduledGameCreated`-hook + `onEngineStarted`-hook (`apps/backend/src/index.ts:2663-2886`) som binder `roomConfiguredEntryFeeByRoom = 5` (billigste bong) + variantConfig med korrekte per-farge ticketTypes fra `ticket_config_json`. Disse persisterer in-memory så lenge backend-prosessen lever. Neste runde i samme rom-kode treffer cache → korrekte priser. `dev:nuke` / crash / cold-start wipe-er Map-en → bug treffer FØRSTE runde igjen.

### Fix-strategi (klient-side defensive)

Klient-side `computePrice` i `TicketGridHtml.ts` prioriterer nå `lobbyTicketConfig.ticketTypes` (fra `Game1LobbyService` → catalog-data) OVER server-provided `ticket.price` når lobby kan matche `(color, type)`. Lobby-data leses direkte fra `app_game_catalog` via plan-runtime-aggregator (`GameLobbyAggregator`), så det er kanonisk pris-kilde uavhengig av in-memory state.

Den nye fallback-rekkefølgen i `computePrice`:

```
1. lobbyTypes.find((color, type) match) → entryFee × multiplier / count  (AUTORITATIV pre-runde)
2. ticket.price > 0 → bruk direkte                                       (legacy server-pris-path)
3. state.ticketTypes.find(type) → entryFee × multiplier / count          (legacy room-snapshot)
4. Default → entryFee × 1 / 1
```

### Hvorfor klient-side over backend-side

- `lobbyTicketConfig` er allerede tilgjengelig i klient via `Game1Controller.setBuyPopupTicketConfig` etter `lobbyStateBinding.getBuyPopupTicketConfig()` — ingen nye fetcher trengs
- BuyPopup viser ALLEREDE korrekte priser via samme `entryFee × priceMultiplier`-formel, så dette aligner ticket-grid-prisene med BuyPopup (UX-konsistens)
- DB-rader (`app_game1_ticket_purchases.ticket_spec_json[].priceCentsEach`) var alltid korrekte (500/1000/1500 øre); kun display-laget var feil
- Backend-fix krever endring i `room:create`-flyten for lazy-binding av scheduled-game-config FØR master har trykket Start (større arkitektur-endring; klient-fix er additiv defense-in-depth)
- Wallet/regulatory binding er UPÅVIRKET — kun visning av bong-pris-label

### Verifisering

5 nye regression-tester i `packages/game-client/src/games/game1/components/TicketGridHtml.preRundePris20Bug.test.ts`:
- Pre-runde: lobby-types VINNER over stale `ticket.price=20` fra backend default-variant
- State-transition WAITING → RUNNING: priser forblir stabile (5/10/15) på tvers av fasen
- Trafikklys-scenario: flat 15 kr per bong, ikke 20
- Lobby-types mangler: server's `ticket.price` brukes (bakover-kompat for legacy-klient)
- Large-bong pre-runde: lobby gir korrekt per-brett-pris (5×3/3=5 kr per brett)

Eksisterende `TicketGridHtml.priceZeroBug.test.ts` (6 tester) fortsatt grønne — `ticket.price > 0`-path er bevart for legacy-clients uten lobbyTypes. Alle 36 TicketGridHtml-tester (4 test-filer) passerer.

### ALDRI fjern lobby-types-prioritering når lobbyTypes kan matche

Lobby-data fra `Game1LobbyService` er kanonisk pris-kilde for Spill 1. Server-side `ticket.price` regnes fra `getRoomConfiguredEntryFee × variant.priceMultiplier / ticketCount` — og begge faktorer kan være stale når in-memory state ikke er bound (cold-start, pre-master-start, dev:nuke). Hvis du fjerner lobby-prioritering, kommer 20-kr-bug-en tilbake.

### Post-pilot defense-in-depth (anbefales, ikke pilot-blokker)

Vurder å lazy-binde scheduled-game-config i `room:create`-handler ved å hente `Game1LobbyService.getLobbyState(hallId).nextGame.ticketPricesCents` og kalle `roomState.roomConfiguredEntryFeeByRoom.set(roomCode, smallestKr)` umiddelbart. Da blir server-pris også korrekt pre-runde, og klient-fallback blir ren dobbel-sikring i stedet for hoved-mekanisme.

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

## WinScreen viser kun vinnende rader (Tobias 2026-05-14)

Etter runde-end skal `Game1EndOfRoundOverlay` vise KUN faser spilleren har
vunnet. Dette er kritisk pilot-UX — Tobias-rapport 2026-05-14 13:00 (runde
1edd90a1) viste at WinScreen feilaktig viste "Ikke vunnet" for Rad 1-4 selv
om DB-en (`app_game1_phase_winners`) hadde alle 6 vinninger korrekt
registrert.

### Designvalg (immutable)

- **Vis KUN faser spilleren har vunnet** (`winnerUserId === myPlayerId`).
  Ikke 5 rader med "Ikke vunnet"-default.
- **Sort etter `phase` 1 → 5** for konsistent rekkefølge.
- **Multi-vinst i samme fase** (yellow + white i Rad 2) → vis begge separat.
  Hver record blir en egen rad.
- **Ingen vinst** → "Beklager, ingen gevinst" (ikke skremmende, nøytral tone).
  "Tilbake til lobby"-knapp forblir alltid synlig.
- **ALDRI vis "Ikke vunnet"-rader** for faser uten vinst.

### Datakilde

Game1Controller akkumulerer `myRoundWinnings: MyPhaseWinRecord[]` per
`pattern:won`-event der spilleren er i `winnerIds`. Reset ved `gameStarted`
(samtidig med `roundAccumulatedWinnings`). Sendes til overlay via
`summary.myWinnings` (snapshot via spread så overlay ikke kan mutere
controller-state).

**HVORFOR egen liste i Controller i stedet for `state.patternResults`:**
- Scheduled Spill 1 sin `enrichScheduledGame1RoomSnapshot` returnerer
  `patternResults: []` (synthetic snapshot uten engine-state).
- Når game-end-snapshot ankommer via `room:update`, blir
  `state.patternResults` RESET til [] av `GameBridge.applyGameSnapshot`.
- Deretter SEEDET med `isWon: false` for alle 5 faser → "Ikke vunnet"-default.
- Per-event tracking i klient er upåvirket av denne reset-pathen.

### Multi-color per fase (kjent limitation)

Backend's `pattern:won`-wire sender ÉN event per fase med første color-
gruppes `payoutAmount`. Klient kan IKKE rekonstruere alle color-vinninger
fra `pattern:won` alene — kun det som ble annonsert i live-pop-ups. WinScreen-
totalen matcher derfor summen som ble vist undervegs (samme som
`roundAccumulatedWinnings`).

For full per-color-breakdown må backend utvide wire-formatet til
`phaseWinners[]`-array i `room:update`-snapshot (eksponer
`app_game1_phase_winners`-rader). TODO post-pilot.

### Tester

- `packages/game-client/src/games/game1/components/Game1EndOfRoundOverlay.winnerFiltering.test.ts` (22 tester):
  - Scenario A — spiller vant alle faser (Tobias prod-bug runde 1edd90a1, 6 rader inkludert multi-color Rad 2)
  - Scenario B — sparse-win (Rad 1 + Fullt Hus, ingen "Ikke vunnet" for Rad 2/3/4)
  - Scenario C — ingen vinst → "Beklager, ingen gevinst"
  - shared-count: "Du delte med X annen/andre" varianter
  - ticket-color: vises inline når satt
  - Backwards-compat: legacy patternResults-path når myWinnings undefined

### ALDRI gjør

- IKKE vis "Ikke vunnet"-default-rader i SUMMARY-skjerm
- IKKE rekonstruer winnings fra `state.patternResults` post-game-end for scheduled Spill 1 — listen er reset+seeded av GameBridge
- IKKE fjern `myRoundWinnings`-reset i `gameStarted`-handler — forrige rundes liste vil lekke inn i WinScreen ved rask round-transition
- IKKE muter `summary.myWinnings`-listen inne i overlay — Controller eier sannheten

## Frontend-state-dump (debug-tool, 2026-05-14)

Når du debugger frontend-state-bugs (eks. "Bongen viser 20 kr men skulle vært 10 kr"), klikk **"Dump State"-knappen** i SPILL1 DEBUG-HUD (øverst høyre). Dette dumper komplett state-tree i én operasjon til fire kanaler:

1. **`window.__SPILL1_STATE_DUMP`** — JS-global. Inspiser i DevTools:
   ```js
   JSON.stringify(window.__SPILL1_STATE_DUMP, null, 2)
   ```
2. **`localStorage["spill1.lastStateDump"]`** — persistert tvers reloads.
3. **Backend-server-fil** via `POST /api/_dev/debug/frontend-state-dump?token=<TOKEN>` → `/tmp/frontend-state-dumps/dump-<ts>-<id>.json`. Hent senere via `GET /api/_dev/debug/frontend-state-dumps/<dumpId>`.
4. **`console.log("[STATE-DUMP]", ...)`** — Live-monitor-agent plukker det opp automatisk.

**Hva dumpen inneholder (fem hovedseksjoner + derived):**
- `lobbyState` — activeHallId, halls, games, ticketPricesCents, nextGame, compliance, balanceKr
- `roomState` — roomCode, gameStatus, entryFee, ticketTypes (med priceMultiplier), jackpot, pause-state
- `playerState` — myPlayerId, myTickets, preRoundTickets, myStake, myPendingStake, isArmed, myLuckyNumber, walletBalanceKr
- `screenState` — currentScreen + siste 10 transitions
- `socketState` — connected, connectionState, siste 20 events
- `derivedState` — **kjernen i bug-investigation:**
  - `pricePerColor` — entryFee × priceMultiplier per fargen (eks: `{yellow:5, white:10, purple:15}`)
  - `autoMultiplikatorApplied` — true hvis minst én multiplier ≠ 1
  - `innsatsVsForhandskjop` — `{activeStakeKr, pendingStakeKr, summedKr, classification}` der classification er `active`/`pre-round`/`both`/`none`
  - `pricingSourcesComparison` — sammenligner room.entryFee × multipliers vs lobby.ticketPricesCents vs nextGame.ticketPricesCents. `consistency: "divergent"` er rødt flag.

**Brukstilfeller (eksempler fra Tobias):**

1. *"Pris viser 20 kr men skulle vært 10 kr"* — Dump → se `derivedState.pricingSourcesComparison`. Hvis `consistency: "divergent"` peker det rett på hvilken kilde som er feil.
2. *"Innsats + Forhåndskjøp dobbel-tellet"* — Dump → se `derivedState.innsatsVsForhandskjop`. `classification` viser hvor i syklusen vi er. `summedKr` bør **aldri** vises i UI som "total betalt" — det er sum av to separate buckets.
3. *"Frontend henger etter runde-end"* — Dump → se `screenState.transitionHistory` + `socketState.lastEvents` for å finne om event mottatt men screen ikke flippet.

**ALDRI fjern Dump State-knappen** — det er primær-verktøy for frontend-bug-investigation per Tobias-direktiv 2026-05-14.

**Implementasjon:**
- `packages/game-client/src/debug/StateDumpTool.ts` — bygger dump + publisering
- `packages/game-client/src/debug/StateDumpButton.ts` — DOM-knapp for HUD
- `apps/backend/src/routes/devFrontendStateDump.ts` — server-side persistering
- Token-gated samme som rrweb (`RESET_TEST_PLAYERS_TOKEN`)

**Tester:**
- `packages/game-client/src/debug/StateDumpTool.test.ts` — 17 tester (struktur, derived, idempotens, fail-soft)
- `packages/game-client/src/debug/StateDumpButton.test.ts` — 6 tester (DOM-mount, klikk-flyt)
- `apps/backend/src/routes/devFrontendStateDump.test.ts` — 12 tester (token, validering, rotering)

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

## "Next Game Display"-beregning (single-source-of-truth, Agent B research 2026-05-14)

**Status (per 2026-05-14):** Det finnes TO parallelle backend-paths som beregner "neste spill", samt LEGACY-endpoints som IKKE er next-aware:

1. **`GameLobbyAggregator.buildPlanMeta`** (kanonisk for master/agent-UI) — `apps/backend/src/game/GameLobbyAggregator.ts:971-1070`
2. **`Game1LobbyService.getLobbyState`** (spiller-shell) — `apps/backend/src/game/Game1LobbyService.ts:410-680`

Legacy som IKKE er next-aware (sannsynlig hovedmistanke for hvorfor buggen kommer tilbake):
- `GET /api/agent/game-plan/current` (`routes/agentGamePlan.ts:343-438`) — viser `currentItem` på `run.currentPosition` UTEN finished-advance. **Ble GLEMT i PR #1422+#1431-fixene.**
- `GET /api/agent/game1/current-game` (`routes/agentGame1.ts:384-549`) — viser KUN scheduled-game-rad uten plan-kontekst.

**Hovedregel:** ALDRI legg til ny "next-game"-logikk uten å oppdatere BÅDE aggregator OG Game1LobbyService. Sjekk PITFALLS §3.13.

**Forventet adferd:**

| Master-state | catalogSlug skal være |
|---|---|
| dev:nuke, ingen plan-run | "bingo" (item 1) |
| Bingo finished, pos=1 av 13 | "1000-spill" (item 2) |
| Position 7 (Jackpot) finished | "kvikkis" (item 8) |
| Position 13 (siste) finished | null + `planCompletedForToday=true` |

**Tester som beskytter mot regresjon:**
- `apps/backend/src/game/__tests__/GameLobbyAggregator.test.ts` — 19 navngitte test-states, finished mid-plan (linje 873, 968)
- `apps/backend/src/game/Game1LobbyService.test.ts` — 18 tester inkl. finished position-cases (linje 415-525)
- `apps/backend/src/game/__tests__/GamePlanRunService.autoAdvanceFromFinished.test.ts` — 10 tester (PR #1422)

**Anti-mønstre (ALDRI gjør):**
- ALDRI fall til `plan.items[0]` eller hardkode "Bingo" som fallback i frontend
- ALDRI clamp `positionForDisplay` til `Math.min(rawPosition, items.length)` uten å håndtere finished-state separat
- ALDRI returner `nextScheduledGame=null` ved finished-state uten å først sjekke `currentPosition < items.length`
- ALDRI patch `/api/agent/game-plan/current` med ad-hoc finished-advance — slett endepunktet helt (Bølge 4 fra PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT)

**Anbefaling (Trinn 3 refactor):** Slett `agentGamePlan /current` og `agentGame1 /current-game` helt; konsolider til ÉN aggregator-output med pre-computed `nextGameDisplay`-felt (se Agent A's recommendation i `docs/research/NEXT_GAME_DISPLAY_AGENT_A_FRONTEND_2026-05-14.md`).

## Lobby-broadcast invariant -- ALLE state-overganger MAA trigge broadcastForHall (FIXED 2026-05-15)

**Tobias-rapport 2026-05-15 (pilot-blokker):** "Etter at runden var fullfort viser fortsatt 'Neste spill: Bingo' i ca 2 min FOR det endret seg til '1000-spill'. Spiller skal ALDRI se gammelt spill."

**Root cause:** Backend hadde 4 paths som flippet runde/plan til terminal status uten aa pushe socket-broadcast til spiller-shellen. Klient maatte vente paa 10s-poll for aa oppdatere "Neste spill"-display. Broadcast var KUN wired paa `MasterActionService` (master-actions via UI-knapp).

**Invariant (FIXED 2026-05-15):**

ALLE state-flipp som setter `app_game1_scheduled_games.status='completed'` ELLER `app_game_plan_run.status='finished'` MAA trigge `Spill1LobbyBroadcaster.broadcastForHall(hallId)` POST-commit som fire-and-forget.

**Path-katalog (alle wired etter 2026-05-15):**

| Path | Trigger | Hall-fan-out |
|---|---|---|
| `Game1DrawEngineService.drawNext()` POST-commit | `isFinished=true` (Fullt Hus vunnet ELLER maxDraws naadd) | `master_hall_id` + alle i `participating_halls_json` via `collectHallIdsForBroadcast` |
| `GamePlanRunService.changeStatus(target='finished')` | Master kaller `finish()` manuelt | run.hall_id |
| `GamePlanRunService.advanceToNext()` past-end | Master advance forbi siste posisjon -> status='finished' | run.hall_id |
| `GamePlanRunCleanupService.reconcileNaturalEndStuckRuns()` | Cron auto-finish for stuck plan-run | Per closedRun.hallId |
| `MasterActionService.fireLobbyBroadcast` | Master-actions (start/pause/resume/stop/advance) | run.hall_id |

**Wiring i index.ts:**
- `Game1DrawEngineService` constructor faar `lobbyBroadcaster: spill1LobbyBroadcaster`
- `gamePlanRunService.setLobbyBroadcaster(spill1LobbyBroadcaster)` late-binding
- `gamePlanRunCleanupService.setLobbyBroadcaster(spill1LobbyBroadcaster)` late-binding

**Best-effort kontrakt:** Broadcaster-feil MAA ALDRI rulle tilbake state-mutering. Alle call-sites bruker `try { void Promise.resolve(...).catch(...) } catch { ... }`. Hvis Socket.IO er nede, faller klienten tilbake paa 3s-poll.

**Frontend-side:**
- Poll-intervall: 3 sekunder (redusert fra 10s) i `LobbyFallback.ts` og `LobbyStateBinding.ts`
- "Forbereder neste spill..."-loader i `CenterBall.setIdleMode("loading")` vises i transition-vinduet mellom natural round-end og server-advance av plan-runtime. Timeout 10s (`PlayScreen.LOADING_TRANSITION_TIMEOUT_MS`)

**ANTI-MOENSTRE (ALDRI gjor):**
- ALDRI legg til ny path som setter `status='completed'`/`'finished'` uten aa trigge broadcast samme sted
- ALDRI kast fra `broadcastForHall` (bryter best-effort-kontrakten)
- ALDRI fjern poll-intervallet -- det er safety-net for broken Socket.IO
- ALDRI optimaliser bort `fireLobbyBroadcastForNaturalEnd` med paastand om "MasterActionService dekker dette" -- engine, plan-service, cron-cleanup og master kjorer i separate kode-paths

**Tester:**
- `apps/backend/src/game/__tests__/Game1DrawEngineService.lobbyBroadcastOnNaturalEnd.test.ts` (11 tester -- fan-out, fail-soft, bakoverkompat)
- `apps/backend/src/game/__tests__/GamePlanRunService.lobbyBroadcastOnFinish.test.ts` (7 tester -- finish vs pause/resume, late-binding)
- `packages/game-client/src/games/game1/screens/PlayScreen.loadingTransition.test.ts` (19 tester -- loader-state-maskinen, slug-tracker)

**Naar du lager en ny state-overgang som setter terminal status:**
1. Wire `lobbyBroadcaster` parameteren inn i service-en (matcher pattern fra MasterActionService).
2. Kall `broadcastForHall(hallId)` POST-commit som `void Promise.resolve(...).catch(...)`.
3. Skriv test som verifiserer at broadcaster fyres + at service ikke kaster naar broadcaster selv kaster.
4. Verifiser i live-test: Tobias skal se "Neste spill: X" oppdatere seg innen ~2 sekunder etter natural round-end.

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
| 2026-05-14 | v1.6.0 — PR #1422 BUG E auto-advance + plan-completed-beats-stengetid: `GamePlanRunService.getOrCreateForToday` capturer `previousPosition` FØR F-Plan-Reuse DELETE, og advancer til `previousPosition + 1` for å forhindre Bingo-loop. **PM follow-up (Tobias 10:17):** Erstattet wrap-til-1 med AVVIS via `PLAN_COMPLETED_FOR_TODAY` + åpningstid-check via `PLAN_OUTSIDE_OPENING_HOURS`. "Plan-completed beats stengetid" — selv om bingohall fortsatt åpen, spillet er over for dagen når plan=ferdig. PITFALLS §3.12. |
| 2026-05-14 | v1.7.0 — PR `fix/winscreen-show-only-winning-phases` (Tobias-rapport 13:00 runde 1edd90a1): `Game1EndOfRoundOverlay` viser KUN vinnende rader (filter på `summary.myWinnings`). Tom liste → "Beklager, ingen gevinst". Multi-color per fase (eks. yellow + purple på Rad 2) → separate rader. Game1Controller akkumulerer `myRoundWinnings`-liste per `pattern:won`-event (single source of truth, upåvirket av snapshot-reset i scheduled Spill 1). 22 nye vitest-tester i `Game1EndOfRoundOverlay.winnerFiltering.test.ts`. Backwards-compat bevart for legacy patternResults-path. PITFALLS §7.22. |
| 2026-05-14 | v1.8.0 — la til "Frontend-state-dump (debug-tool, 2026-05-14)"-seksjon. "Dump State"-knapp i HUD dumper komplett state-tree til window-global + localStorage + server-POST + console.log. `derivedState.pricePerColor`, `derivedState.innsatsVsForhandskjop`, og `derivedState.pricingSourcesComparison` er primær-verktøy for frontend-bug-investigation (eks. "20 kr men skulle vært 10 kr"). Implementasjon i `packages/game-client/src/debug/StateDumpTool.ts` + `StateDumpButton.ts` + `apps/backend/src/routes/devFrontendStateDump.ts`. 35 tester totalt (17+6+12). PITFALLS §7.23. |
| 2026-05-14 | v1.9.0 — Agent B research (Backend aggregator + lobby-API, Trinn 1 av Next Game Display refactor): la til seksjon "Next Game Display-beregning (single-source-of-truth)" som dokumenterer 4 backend-paths (2 kanoniske + 2 legacy). Hovedfunn: `agentGamePlan /current` ble GLEMT i PR #1422+#1431-fixene → hovedmistanke for hvorfor buggen kommer tilbake. Anbefaling: slett legacy-endpoints, konsolider til ÉN aggregator med pre-computed `nextGameDisplay`. Tester referert + anti-mønstre dokumentert. Kilde: `docs/research/NEXT_GAME_DISPLAY_AGENT_B_AGGREGATOR_2026-05-14.md` (502 linjer). PITFALLS §3.13. |
| 2026-05-14 | v1.10.0 — Agent A research (Frontend rendering paths, Trinn 1): identifiserte **6 aktive frontend-paths** som rendrer "neste spill"-tekst fordelt på 4 forskjellige datakilder. Hovedfunn: hver path har sin egen fallback-strategi (tom streng / "Bingo" hardkodet / generisk "Neste spill") → divergens. Anbefaling: backend eksponer pre-computed `nextGameDisplay`-felt i `Spill1AgentLobbyStateSchema`; frontend leser fra ÉN feltverdi, ingen lokal beregning. 9 invariants (F-I1 til F-I9) for refactor-testing. Estimat 3 dev-dager. Kilde: `docs/research/NEXT_GAME_DISPLAY_AGENT_A_FRONTEND_2026-05-14.md` (618 linjer). PITFALLS §7.25 lagt til. |
| 2026-05-14 | v1.11.0 — Agent C research (Plan-run state-machine, Trinn 1): KRITISK strukturell funn — **4 forskjellige mekanismer kan endre `current_position`** (`MasterActionService.start/advance`, `reconcileStuckPlanRuns`, `GamePlanRunCleanupService.reconcileNaturalEndStuckRuns` cron, `agentGamePlan.ts:loadCurrent` lazy-create). Hver har egen race-window. 4 KRITISKE bugs identifisert. Quick-fix: fjern lazy-create-mutasjon fra `agentGamePlan.ts:loadCurrent:308-326`. Langsiktig: event-sourced plan-run (3-4 uker). Kilde: `docs/research/NEXT_GAME_DISPLAY_AGENT_C_PLANRUN_2026-05-14.md` (854 linjer). PITFALLS §3.14 lagt til. |
| 2026-05-14 | v1.12.0 — Agent D research (Scheduled-game lifecycle, Trinn 1): **BUG-D1 (P0) identifisert: `GamePlanRunService.start()` overskriver `current_position = 1` på linje 780** — selv etter PR #1422-fix av `getOrCreateForToday`. Sannsynlig rot-årsak for Bingo-loop. Fix: fjern hardkodet `current_position = 1` fra UPDATE (3 linjer). Andre P0: Bølge 4 IKKE fullført (dual-spawn Game1ScheduleTickService + GamePlanEngineBridge). 14 writer-sites + 11 reader-sites mot `app_game1_scheduled_games`. Kilde: `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md` (763 linjer). PITFALLS §3.14 + §3.15. |
| 2026-05-14 | v1.13.0 — Agent E research (Historisk PR-arv, Trinn 1): **META-funn — 199+ PR-er rørte temaet siden 2026-04-23, 11+ direkte fix-forsøk på Next Game Display-bug**. `Spill1HallStatusBox.ts` har 56+ touches, `NextGamePanel.ts` 39 touches — patch-spiral peak anti-pattern. **ROT-ÅRSAK: Bølge 4 (slett legacy parallel-spawn) ble ALDRI fullført** — dual-write fra `GamePlanEngineBridge` + `Game1ScheduleTickService` på `app_game1_scheduled_games` ligger fortsatt åpent. Tobias' 5+ rapporter samme dag = EN bug-klasse med 4 manifestasjoner, IKKE flere bugs. Anbefaling: **Bølge 7 (konsolidering) + Bølge 4 (slett legacy)** parallelt. 3-5 dev-dager med 2-3 agenter, eller fundamental rewrite 1-4 uker. Kilde: `docs/research/NEXT_GAME_DISPLAY_AGENT_E_HISTORY_2026-05-14.md` (559 linjer). |
| 2026-05-14 | v1.14.0 — Agent F research (Test-coverage gap-analyse, Trinn 1 SISTE): **6 KRITISKE coverage-hull identifisert**. Hovedfunn: **6 kode-paths beregner "neste spill" uavhengig — INGEN invariants binder dem**. PR #1431 la til 4 finished-state-tester men buggen kom tilbake fordi de fire kun testet ÉN path. Bare 4 ekte-DB-tester totalt, ingen sekvenserer alle 13 plan-items. Synthetic-test (PR #1460) dekker KUN én runde, ikke advance-flyt. Playwright E2E (6 spec-filer) har INGEN advance-assertion. `spillerklientRebuildE2E` Test 5 mocker socket-state → falsk trygghet. Anbefaling: **5 cross-service invariants** (I-NextGame-1 til I-NextGame-5) + 6 ekte-DB scenario-tester + 1 Playwright E2E `spill1-next-game-display-flow.spec.ts` + 1 multi-round synthetic. Estimat 3-5 dager test-skriving etter refactor. Kilde: `docs/research/NEXT_GAME_DISPLAY_AGENT_F_TESTS_2026-05-14.md` (1024 linjer). Skill-pekere foreslås for `casino-grade-testing` + `spill1-master-flow`. |
| 2026-05-15 | v1.15.0 — BUG-D1 fix (branch `fix/bug-d1-planrun-start-hardcode-2026-05-15`): Fjernet `current_position = 1` fra `GamePlanRunService.start()`-UPDATE (linje 780). `getOrCreateForToday`-INSERT er nå eneste sannhet for `current_position` ved start. Ny seksjon "Plan-run.start() invariant — bevarer current_position" mellom Auto-advance og UI-komponenter. 6 nye regression-tester. PITFALLS §3.15 markert FIXED. |
| 2026-05-15 | v1.16.0 — Bølge 4 fix (branch `fix/bolge-4-skip-legacy-spawn-for-plan-haller-2026-05-15`): `Game1ScheduleTickService.spawnUpcomingGame1Games` skipper nå haller med aktiv `app_game_plan_run`-rad for samme `business_date`. Ny privat helper `checkHallsWithActivePlanRuns(hallIds, dateRange)` bulk-querier plan-runs i lookahead-vinduet → Set med keys `${hallId}|${isoDay}` for O(1)-lookup. Skip-guard i spawn-loopen mellom weekday-validering og sub-game-iterasjon. DB-feil → fail-open. Audit-event på debug-nivå: `bolge-4.legacy_spawn_skipped_due_to_plan`. Ny seksjon "Plan-runtime overstyrer legacy-spawn (Bølge 4 fix 2026-05-15)" mellom BUG-D1 invariant og UI-komponenter. 6 nye regression-tester. PITFALLS §3.14 markert FIXED. Defense-in-depth: F-NEW-3 `releaseStaleRoomCodeBindings` BEHOLDES. |
| 2026-05-15 | v1.17.0 — Header-text + catalogDisplayName fix (branch `fix/master-header-text-and-catalog-name-2026-05-15`, Tobias-rapport 2026-05-15 live-test): forenklet `getMasterHeaderText`-mapping per Tobias-direktiv IMMUTABLE: ALLE pre-running-states (idle/scheduled/purchase_open/ready_to_start/completed/cancelled) viser "Neste spill: {name}". Bare `running` viser "Aktiv trekning: {name}" (KOLON, ikke bindestrek). "Klar til å starte" og "Runde ferdig" som mellom-tekster er fjernet. Backend: `GamePlanRunService.findActivePlanForDay(hall, businessDate)` slår opp aktiv plan UTEN å opprette plan-run; `GameLobbyAggregator` kaller den når `planRun=null` så `catalogDisplayName` settes til `items[0].displayName` direkte etter dev:nuke. 41 frontend-tester + 26 backend-aggregator-tester (2 nye). PITFALLS §7.20 utvidet + §7.21 ny entry. Oppdatert master-UI-tabell i skill. |
| 2026-05-15 | v1.18.0 — Bong-design preview-side (branch `feat/bong-design-preview-page-2026-05-15`, Tobias-direktiv 2026-05-15): ny stand-alone HTML/CSS-side på `/web/games/bong-design.html` for å tweake bong-design uten å starte live-stacken. Viser 3 bonger (Hvit/Gul/Lilla) × 3 scenarier (fresh / mid-spill / Rad 1 bingo). Palett kopiert 1:1 fra `BingoTicketHtml.BONG_COLORS`. Egne Vite-config (`vite.bong-design.config.ts`) + build-script (`build:bong-design`) wired inn i `npm run build`. PITFALLS §7.26 ny entry. Ny tabell "Design-iterasjons-sider" i skill listing alle 5 preview-sider. |
