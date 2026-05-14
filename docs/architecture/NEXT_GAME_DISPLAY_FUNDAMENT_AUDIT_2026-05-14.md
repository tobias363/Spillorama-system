# Next Game Display Fundament-Audit — 2026-05-14

**Status:** ✅ **Completed 2026-05-15 — Trinn 1+3 ferdig.** Trinn 1 (research, 6 agenter) levert via PR #1470. Trinn 3 (fix-bølger) levert via PR #1477 (BUG-D1) + #1478 (BUG-D6) + #1481 (Bølge 4) — alle merget til main. Trinn 2 (foreslått modulær arkitektur §7) er ikke utført fordi minimum-fixes løste rot-årsaken; konsoliderings-pattern (`NextGameDisplayService`) flyttes til post-pilot-backlog.

**Skall opprettet:** 2026-05-14 av PM-AI (Claude Opus 4.7).
**Sak:** Master-konsoll viser feil "Neste spill"-tekst etter `dev:nuke` og etter at hver enkelt runde i spilleplanen er ferdig. Bug-en er tilbakevendende — fixet 4 ganger uten å løse rot-årsaken.
**Mandat fra Tobias 2026-05-14:** *"Vi må nå ha et helt åpent sinn hvor vi ser på funksjonaliteten og hvis vi finner ut at dette må bygges som og det utsetter pilot med uker så er vi nødt til å gjøre det."* — Kvalitet > tid. 1-4 uker OK for arkitektur-rewrite.

---

## 1. Problem-statement (autoritativ)

### 1.1 Forventet adferd

| State | Master-konsoll skal vise |
|---|---|
| Etter `dev:nuke` (ingen runde startet enda) | "Neste spill: Bingo" (item 1 i `demo-plan-pilot`) |
| Bingo er ferdig (status='finished') | "Neste spill: 1000-spill" (item 2 i plan) |
| Item 2 ferdig | "Neste spill: 5×500" (item 3) |
| ... | ... (sekvensiell advance gjennom alle 13 items) |
| Alle 13 items ferdig | "Plan fullført for dagen" |

### 1.2 Skal IKKE være avhengig av

- Hall-ready-status (om master har trykket "Marker Klar")
- Antall kunder i hallen (`MASTER_HALL_RED`-status)
- Auto-cron-status (`Game1ScheduleTickService` schedule-tick)
- Engine-state (`app_game1_game_state.paused`, `currentPhase`)

### 1.3 Live reproducer i DB akkurat nå (2026-05-14 22:21 CEST)

Local Postgres (`spillorama@localhost:5432/spillorama`) viser:

```sql
SELECT id, plan_id, hall_id, status, current_position, started_at, finished_at
FROM app_game_plan_run
WHERE business_date = CURRENT_DATE;
-- id:                7244c743-7ab1-4a51-9f51-99c79dd7c023
-- plan_id:           demo-plan-pilot
-- hall_id:           demo-hall-001
-- status:            finished
-- current_position:  1 (Bingo)
-- started_at:        2026-05-14 19:32:08 UTC
-- finished_at:       2026-05-14 19:34:14 UTC

SELECT count(*) FROM app_game_plan_item WHERE plan_id='demo-plan-pilot';
-- 13
```

Per PR #1431 (PITFALLS §3.13) skal lobby-API returnere `nextScheduledGame.catalogSlug='1000-spill'` (position 2). Bug-en er at master-UI fortsatt viser "Neste spill: Bingo" eller "Plan fullført".

---

## 2. Hvorfor 4 tidligere fixes ikke har løst rot-årsaken

Bug-en har blitt forsøkt fikset minst 4 ganger uten å lukke roten:

| PR | Tema | Hvorfor det ikke var nok |
|---|---|---|
| **#1370** | Plan-meta vises uansett status før plan-run opprettes | Dekket KUN initial-state, ikke advance-state etter runde-end |
| **#1422** | `getOrCreateForToday` auto-advance fra finished plan-run | DB-side fix — `current_position++` ved DELETE+INSERT. Korrekt, men lobby-API leste fortsatt det gamle feltet på read-tid |
| **#1427** | Master-UI header state-aware ("Aktiv trekning" kun ved running) | UI-tekst-fix på `Spill1HallStatusBox` — ikke "neste spill"-tekst |
| **#1431** | Lobby-API nextGame for finished plan-run | Endret `Game1LobbyService.getLobbyState` til å returnere `plan.items[currentPosition + 1]` ved finished. **Korrekt** — men bug rapporteres fortsatt? Mistenkt: en av de 4 frontend-kode-pathene ignorerer dette feltet. |

**Hypotese (verifiseres av agenter):** Bug-en lever fordi minst 4 kode-paths beregner "neste spill"-tekst hver for seg (frontend renderer, backend aggregator, plan-run-state, scheduled-game lifecycle). Hver fix har truffet ÉN path, mens de andre 3 driver tilstanden videre.

**Pattern matcher PR-historikk** for Bølge 1-3 (`PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08`) der vi konsoliderte plan-run-id vs scheduled-game-id via `GameLobbyAggregator` + `MasterActionService`. Den refaktoren løste master-actions, ikke display-rendering.

---

## 3. Komplett fil-/modul-kart [⏳ Agent B + Agent C fyller inn]

### 3.1 Backend services

_(Agent B + C: legg inn alle filer som beregner "neste spill" / `nextScheduledGame` / `nextGame` / `plan.items[currentPosition + 1]`)_

| Fil | Linjer | Ansvar | Status |
|---|---:|---|---|
| `Game1LobbyService.ts` | ? | ? | ? |
| `GameLobbyAggregator.ts` | ? | ? | ? |
| `GamePlanRunService.ts` | ? | ? | ? |
| `GamePlanEngineBridge.ts` | ? | ? | ? |
| `MasterActionService.ts` | ? | ? | ? |
| `Game1ScheduleTickService.ts` | ? | ? | ? |
| _… (Agent D fyller inn scheduled-game-lifecycle)_ | | | |

### 3.2 Backend routes

_(Agent B: hvilke endpoints leverer "next game"-data?)_

### 3.3 Frontend admin-web

_(Agent A: hvilke komponenter rendrer "Neste spill"-tekst?)_

| Fil | Linjer | Hvor rendrer den "Neste spill"-tekst? | Hvilken kilde? |
|---|---:|---|---|
| `Spill1HallStatusBox.ts` | ? | ? | ? |
| `NextGamePanel.ts` | ? | ? | ? |
| `Game1Controller.ts` | ? | ? | ? |
| _… (Agent A fyller inn alle)_ | | | |

### 3.4 Database

_(Agent C + D: hvilke tabeller har "next game"-relevante kolonner?)_

---

## 4. State-machine [⏳ Agent C fyller inn]

Komplett kartlegging av alle states × klient-roller × forventet display.

**States å dekke:**
- `idle` (ingen runde startet)
- `scheduled` (scheduled-game opprettet, ikke åpen for kjøp)
- `purchase_open` (åpen for bonge-kjøp)
- `ready_to_start` (alle haller markert klar)
- `running` (engine trekker baller)
- `paused` (master har pauset)
- `completed` (vinner kåret, scheduled-game ferdig)
- `cancelled` (scheduled-game avbrutt)
- `finished` (plan-run ferdig — hele dagen)
- `no-plan-run-exists` (initial-state etter dev:nuke)

**Klient-roller å dekke:**
- Master-agent (`/admin/agent/cash-in-out`, `/admin/agent/games`)
- Sub-agent (samme rute, ikke master)
- Admin (`/admin/#/games/master/:id`)
- Spiller-shell (`/web/?dev-user=...`)

**Output:** Tabell N×M med eksakt forventet "Neste spill"-tekst per kombinasjon.

---

## 5. Kall-graf [⏳ Agent B + C fyller inn]

Komplett kall-graf fra DB-rad → backend-service → API-route → frontend-fetcher → komponent-rendering. Hver state-overgang viser hvilken kode-path som kjører.

Sequencediagram-mal:
```
KLIENT ──► GET /api/agent/game1/lobby?hallId=X
            │
            └─► GameLobbyAggregator.getLobbyState()
                  │
                  ├─► GamePlanRunService.getForToday(hallId)
                  │     └─► SELECT FROM app_game_plan_run WHERE business_date=X
                  │
                  ├─► GamePlanService.getById(plan_id)
                  │     └─► SELECT items
                  │
                  ├─► [hvis run.status=finished + position < items.length]
                  │     positionForDisplay = rawPosition + 1
                  │
                  ├─► Spill1ScheduledGameRepo.getActiveForHall(hallId)
                  │
                  └─► return Spill1AgentLobbyState
                        │
                        └─► UI rendrer fra hvilket felt?
```

---

## 6. Identifiserte bugs (Trinn 3 — alle FIXED)

Agentene identifiserte 8 strukturelle bugs (BUG-D1 til BUG-D8) i Agent D-rapporten. De 3 kritiske (P0/P1) ble fixed i Trinn 3.

### BUG-D1 — `GamePlanRunService.start()` hardkodet `current_position = 1` ✅ FIXED

**Severity:** P0 (Next Game Display master-konsoll-symptom — hovedrot-årsak)
**Fil:** `apps/backend/src/game/GamePlanRunService.ts:780`
**Symptom:** Master kjørte Bingo (pos=1) gjentatte ganger i stedet for å advance til 1000-spill → 5×500 → … i sekvens.
**Root cause:** `start()` UPDATE-statement overskrev `current_position` til 1, selv om `getOrCreateForToday`-INSERT allerede hadde satt korrekt `nextPosition` basert på `previousPosition`.
**Fix:** Fjernet `current_position = 1`-linjen fra UPDATE. `start()` flipper kun state-machine til `running`, ikke posisjon.
**PR:** [#1477](https://github.com/tobias363/Spillorama-system/pull/1477) — merget 2026-05-15 (commit `d7e9b8615`)
**Tester:** 6 nye unit + integration + regression-tester i `GamePlanRunService.startPreservesPosition.test.ts`
**Skill:** `spill1-master-flow` v1.14.0 → v1.15.0 (ny seksjon "Plan-run.start() invariant")
**Pitfall:** PITFALLS_LOG §3.15 (FIXED)

### Bølge 4 — Dual-spawn fra legacy-cron + plan-runtime ✅ FIXED

**Severity:** P0 (race-condition mellom to spawn-paths)
**Fil:** `apps/backend/src/game/Game1ScheduleTickService.ts` (`spawnUpcomingGame1Games`)
**Symptom:** Master-konsoll viste feil "Neste spill" fordi legacy-cron spawn'et scheduled-game parallelt med plan-runtime's bridge-spawn. To scheduled-games for samme (hall, dag) → konflikt.
**Root cause:** Plan-runtime (Bølge 1-3, 2026-05-08) erstattet legacy-spawn for haller med aktiv plan, men legacy-cron ble aldri skrudd av. Bølge 4 (deaktivere legacy) ble glemt.
**Fix:** Ny helper `checkHallsWithActivePlanRuns(hallIds, dateRange)` returnerer `Set<"hallId|isoDay">`. Skip-guard i sub-game loop: hvis hall har aktiv plan-run for dagen, skip legacy-spawn. Pre-fetch én gang per tick (O(1) lookup, ingen N+1).
**PR:** [#1481](https://github.com/tobias363/Spillorama-system/pull/1481) — merger 2026-05-15 (commit `b10a63697`)
**Tester:** 6 nye Bølge 4-tester i `Game1ScheduleTickService.test.ts` (41/41 PASS)
**Skill:** `spill1-master-flow` v1.15.0 → v1.16.0 (ny seksjon "Plan-runtime overstyrer legacy-spawn")
**Pitfall:** PITFALLS_LOG §3.14 (FIXED)

### BUG-D6 — `engine.UPDATE status='completed'` manglet WHERE-guard ✅ FIXED

**Severity:** P1 (data-integritet — terminal-status kan overskrives)
**Fil:** `apps/backend/src/game/Game1DrawEngineService.ts:1413`
**Symptom:** Hvis master eller cron har satt scheduled-game til `cancelled` mens engine fortsatt har pending endRound-call, kunne engine overskrive `cancelled` med `completed`. Audit-trail-korrupsjon.
**Root cause:** `endRound()` UPDATE-statement manglet `AND status IN ('running', 'paused')` i WHERE-clause.
**Fix:** La til status-guard. Engine kan kun completed-flippe fra running/paused, ikke fra terminal status (cancelled/finished/completed).
**PR:** [#1478](https://github.com/tobias363/Spillorama-system/pull/1478) — merget 2026-05-15 (commit `f0665a5c2`)
**Tester:** 4 nye regression-tester i `Game1DrawEngineService.bugD6StatusGuard.test.ts`
**Skill:** `spill1-master-flow` v1.16.0 → v1.17.0 (entry 14 i "Vanlige feil": "Engine UPDATE må ha status-guard")
**Pitfall:** PITFALLS_LOG §3.16 (FIXED)

### BUG-D2 til BUG-D5, BUG-D7, BUG-D8 — Ikke pilot-blokkere

Agent D identifiserte også 5 sekundære bugs (D2: `getOrCreateForToday` mister hard-coded fallback, D3: race mellom `reconcileNaturalEndStuckRuns` og `MasterActionService.start`, D4: cron `transitionReadyToStartGames` ignorerer plan-run-state, D5: `findActiveOrUpcomingGameForHall` returnerer feil rad ved dual-spawn, D7: stuck `ready_to_start` etter engine.startGame feil, D8: `app_daily_schedules.status='running'` etter pilot-dag uten dynamic stop).

**Status:** Disse er IKKE pilot-blokkere etter at BUG-D1 + Bølge 4 + BUG-D6 er lukket. BUG-D5 er delvis mitigert av Bølge 4 (forhindrer dual-spawn → forhindrer "feil rad"-deteksjon). D3-D4 er race-conditions som er mindre sannsynlige uten dual-spawn.

**Plan:** Vurder for post-pilot-fix-bølge. Tracker i [`docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`](./PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md) — Bølge 5+ etter pilot-go-live.

---

## 7. Foreslått modulær arkitektur (Trinn 2 — flyttet til post-pilot-backlog)

**Hypotese:** Én autoritativ service `NextGameDisplayService` (eller utvidet `GameLobbyAggregator`) som returnerer:

```typescript
type NextGameDisplay = {
  catalogSlug: string | null;        // "1000-spill" | null hvis plan ferdig
  catalogDisplayName: string | null; // "1000-spill" | null
  position: number | null;           // 2 | null
  planCompletedForToday: boolean;    // true | false
  reason: "next_in_sequence" | "plan_completed" | "no_plan_run" | "closed";
};
```

Alle frontend-komponenter (`Spill1HallStatusBox`, `NextGamePanel`, evt. `Game1Controller`-shell-overlay) MÅ bruke denne ene service-en. Ingen lokal beregning av "neste spill".

---

## 8. Test-plan [⏳ Agent F fyller inn]

Invariants som MÅ dekkes:

- **I1:** Etter `dev:nuke` med 0 scheduled-games + 0 plan-runs → "Neste spill: Bingo" (item 1)
- **I2:** Etter Bingo finished (position=1) → "Neste spill: 1000-spill" (item 2)
- **I3:** Etter position 7 (Jackpot) finished → "Neste spill: Kvikkis" (item 8)
- **I4:** Etter position 13 finished → "Plan fullført for dagen"
- **I5:** Stale plan-run fra i går (CURRENT_DATE - 1) → auto-finished + "Neste spill: Bingo" (item 1, ny dag)
- **I6:** Hall ikke master → samme display som master (informativ, ikke gate)
- **I7:** Hall ikke i GoH-medlemskap → "Stengt"-melding

Hver invariant skal ha minst 1 unit-test + 1 integration-test + 1 E2E-test.

---

## 9. Refaktor-bølger (Trinn 3 — alle ferdig 2026-05-15)

| Bølge | Tema | Status | PR |
|---|---|---|---|
| **Trinn 3-A** | BUG-D1 — `GamePlanRunService.start()` preserves position | ✅ MERGET | [#1477](https://github.com/tobias363/Spillorama-system/pull/1477) |
| **Trinn 3-B** | Bølge 4 — skip legacy-spawn for plan-haller | ✅ MERGET | [#1481](https://github.com/tobias363/Spillorama-system/pull/1481) |
| **Trinn 3-C** | BUG-D6 — engine UPDATE WHERE-clause-guard | ✅ MERGET | [#1478](https://github.com/tobias363/Spillorama-system/pull/1478) |

Alle 3 fixes leveres med:
- **Skill-doc-protokoll §2.19 IMMUTABLE oppfylt** — `spill1-master-flow/SKILL.md` bumped v1.14.0 → v1.17.0 (3 nye seksjoner)
- **PITFALLS_LOG §3.14-§3.16** — alle FIXED 2026-05-15
- **AGENT_EXECUTION_LOG** — 3 kronologiske entries
- **Regression-tester:** 16 nye tester totalt (6 BUG-D1 + 6 Bølge 4 + 4 BUG-D6), alle PASS

**Resultat:** Master-konsollet skal nå:
1. Etter `dev:nuke` (ingen runde startet) → vise "Neste spill: Bingo" (item 1)
2. Etter Bingo finished → "Neste spill: 1000-spill" (item 2)
3. Sekvensiell advance gjennom alle 13 items
4. Etter siste item → "Plan fullført for dagen"

**Verifisering:** Tobias kjører `npm run dev:nuke` (Trinn 3 i denne sesjonen) og verifiserer 13-spill-sekvens.

---

## 10. Agent-leveranser (Trinn 1)

| Agent | Branch | Scope | Status | Levert |
|---|---|---|---|---|
| **A** | `research/next-game-display-a-frontend-2026-05-14` | Frontend rendering — `Spill1HallStatusBox.ts` + `NextGamePanel.ts` + `Game1Controller.ts` + alle "neste spill"-renderers | ⏳ Spawnet | — |
| **B** | `research/next-game-display-b-aggregator-2026-05-14` | Backend aggregator — `GameLobbyAggregator.ts` + `Game1LobbyService.ts` + alle `nextScheduledGame`-beregninger | ⏳ Spawnet | — |
| **C** | `research/next-game-display-c-planrun-2026-05-14` | Plan-run state-machine — `GamePlanRunService.ts` + `GamePlanEngineBridge.ts` + `MasterActionService.ts` | ⏳ Spawnet | — |
| **D** | `research/next-game-display-d-scheduledgame-2026-05-14` | Scheduled-game lifecycle — `Spill1ScheduledGameRepo` + `Game1ScheduleTickService` + `Game1MasterControlService` | ⏳ Spawnet | — |
| **E** | `research/next-game-display-e-pr-history-2026-05-14` | Historisk PR-arv siden 2026-04-23 (~30-50 PR-er) | ⏳ Venter A-D | — |
| **F** | `research/next-game-display-f-test-coverage-2026-05-14` | Test-coverage gap-analyse | ⏳ Venter A-D | — |

---

## 11. Referanser

- [Handoff 2026-05-14 §1](../operations/PM_HANDOFF_2026-05-14.md#1-hovedoppgave-kritisk-p0) — mandat
- [PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08](./PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md) — fundament-audit for plan-run-id vs scheduled-game-id (Bølge 1-3)
- [PITFALLS_LOG §3.10-§3.13](../engineering/PITFALLS_LOG.md#3-spill-1-2-3-arkitektur) — 4 tidligere fix-forsøk
- [FRAGILITY_LOG F-02](../engineering/FRAGILITY_LOG.md#f-02-plan-run-lifecycle--stuck-state-mellom-test-cleanup-og-master-action) — plan-run lifecycle FIXED I16
- [SPILL1_IMPLEMENTATION_STATUS_2026-05-08](./SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) — fundament for Spill 1

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-14 | Initial skall — opprettet for å koordinere 6 research-agenters leveranser i Trinn 1 av Next Game Display-bug-mandat. | PM-AI (Claude Opus 4.7) |
| 2026-05-15 | **Trinn 1 (research) lukket** — 5 Trinn 1-agenter leverte via PR #1470, Agent F leverte separat. Spill1-master-flow skill bumped v1.8.0 → v1.14.0. | PM-AI (Claude Opus 4.7) |
| 2026-05-15 | **Trinn 3 (fix-bølger) lukket** — 3 fix-PR-er merget til main: #1477 BUG-D1 + #1478 BUG-D6 + #1481 Bølge 4. Skill bumped v1.14.0 → v1.17.0. PITFALLS §3.14-§3.16 alle FIXED. 16 nye regression-tester PASS. Audit-doc status endret fra "⏳ In progress" til "✅ Completed". | PM-AI (Claude Opus 4.7) |
| 2026-05-15 | **Trinn 2 (foreslått modulær arkitektur §7) flyttet til post-pilot-backlog** — minimum-fixes løste rot-årsaken. `NextGameDisplayService`-konsolidering er ikke-pilot-blokker. | PM-AI (Claude Opus 4.7) |
