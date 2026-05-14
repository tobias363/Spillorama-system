# Next Game Display Fundament-Audit — 2026-05-14

**Status:** ⏳ In progress — skall opprettet 2026-05-14 av PM-AI (Claude Opus 4.7). 6 research-agenter spawnet for å fylle §§3-8.
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

## 6. Identifiserte bugs [⏳ Agentene fyller inn]

Hver state-overgang som faller mellom kode-paths dokumenteres her med file:line + reproducer.

---

## 7. Foreslått modulær arkitektur [⏳ Trinn 2 — etter all data samlet]

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

## 9. Refaktor-bølger [⏳ Trinn 3 — etter audit ferdig]

Foreslås etter Trinn 2 er konsolidert.

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
