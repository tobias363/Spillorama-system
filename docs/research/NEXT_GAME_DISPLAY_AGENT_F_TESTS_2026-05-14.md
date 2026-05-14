# Agent F — Test-coverage gap-analyse for Next Game Display-bug

**Status:** Trinn 1 research-leveranse (data-collection)
**Dato:** 2026-05-14
**Agent:** F (Test-coverage gap-analyse)
**Branch:** `research/next-game-display-f-tests-2026-05-14`
**Mandat:** Map tester for Next Game Display-flyten, identifiser hull. **IKKE fiks buggen** — produser kun research-data for konsolidering i Trinn 2.

---

## TL;DR — Hovedfunn

1. **5+ kode-paths beregner "neste spill"** uavhengig (backend `Game1LobbyService`, backend `GameLobbyAggregator.buildPlanMeta`, frontend `Spill1HallStatusBox.getMasterHeaderText`, frontend `NextGamePanel.mapLobbyToLegacyShape`, frontend `Game1Controller.applyLobbyState`). **Hver path har egne unit-tester. Ingen invariants binder dem.**

2. **Ingen test sekvenserer gjennom alle 13 plan-items** — eksisterende tester verifiserer KUN snapshots (position=1, position=7, position=13). Bug-en oppstår mellom transisjoner (item N finished → item N+1 idle) som dekkes 1:1 i `Game1LobbyService.test.ts:451+469` og `GameLobbyAggregator.test.ts:873+968`. **Men disse er rene unit-tester med stubbed pool — ingen kjører fanger DB+API+UI sammen.**

3. **Synthetic test (`scripts/synthetic/spill1-round-bot.ts`) tester KUN én runde**. I1-I6 invariants dekker wallet/compliance/idempotency innenfor én runde. **Tester ALDRI advance-flyten eller next-game-display.**

4. **Playwright E2E (`tests/e2e/spill1-pilot-flow.spec.ts` + 5 andre)** tester én master+spiller-runde med en hardkodet hall+spill. **Ingen verifiserer "neste spill"-tekst eller advance.**

5. **`spillerklientRebuildE2E.test.ts` Test 5 er nærmeste E2E** — men det er en MOCKED state-test (`SpillerklientHarness` med `emitStateUpdate(makeLobbyState(...))`). Tester at IF lobby-state er korrekt-formet, UI rendrer korrekt. Tester ikke at backend faktisk produserer den lobby-state-shapen.

6. **`MasterActionService.integration.test.ts`** tester full master-loop start→advance→pause→resume→stop, men med MOCKED `planRunService.advanceToNext` og MOCKED `engineBridge.createScheduledGameForPlanRunPosition`. **Ekte DB-integrasjon tester KUN at SQL kompilerer**, ikke at flyten gir riktig `nextScheduledGame`.

7. **`GameLobbyAggregator.integration.test.ts`** dekker KUN 4 SQL-queries mot et minimum-shape test-schema. **Hele plan-runtime → aggregator → respons-pipelinen er ikke ekte-DB-testet.**

---

## 1. File-list — alle test-filer som tester Next Game Display-flyten

### 1.1 Backend unit-tester (vitest/node:test) — 18 filer

| Fil | Linjer | Tester | Kategori | Scope |
|---|---:|---:|---|---|
| `apps/backend/src/game/Game1LobbyService.test.ts` | 644+ | 20 | Lobby state-machine | idle/purchase_open/running/paused/finished + planCompletedForToday — 20 scenarier |
| `apps/backend/src/game/Game1LobbyService.survivors.test.ts` | 487+ | 11 | Mutation-tester (Stryker survivors) | Edge-cases for ticketPricesCents, bonusGameOverride, prizeMultiplierMode |
| `apps/backend/src/game/__tests__/Game1LobbyService.reconcile.test.ts` | 580+ | 11 | Stuck-state recovery | Auto-reconcile av terminal scheduled-game; finished-state path |
| `apps/backend/src/game/__tests__/GameLobbyAggregator.test.ts` | 1800+ | 26 | Aggregator state-machine | Alle states + planMeta advance-bug-fix + isMasterAgent + warnings |
| `apps/backend/src/game/__tests__/gameLobbyAggregator.pauseReason.test.ts` | ? | ? | pauseReason-feltet | Auto-paused-state |
| `apps/backend/src/game/GamePlanRunService.test.ts` | 840+ | 26 | Plan-run state-machine | getOrCreateForToday, start, advanceToNext, pause, resume, finish |
| `apps/backend/src/game/__tests__/GamePlanRunService.autoAdvanceFromFinished.test.ts` | 600+ | 10 | DB-side advance | F-Plan-Reuse fix (PR #1422) — finished→ny-position |
| `apps/backend/src/game/__tests__/GamePlanRunService.goh.test.ts` | ? | ? | GoH plan-routing | Multi-hall-medlemskap |
| `apps/backend/src/game/__tests__/GamePlanRunService.dateRowToString.test.ts` | ? | ? | Date-handling | F4-regression Oslo-tz |
| `apps/backend/src/game/__tests__/MasterActionService.test.ts` | 1700+ | 49 | Sekvenseringsmotor | start/advance/pause/resume/stop/setJackpot + retry-rollback |
| `apps/backend/src/game/__tests__/MasterActionService.stuckReconcile.test.ts` | 460+ | 9 | Reconcile-flyt | start/advance kaller findStuck+finish |
| `apps/backend/src/__tests__/MasterActionService.integration.test.ts` | 350+ | 3 | Integration | Full loop med InMemoryAuditLogStore (mocked services) |
| `apps/backend/src/__tests__/MasterActionService.armedConversionHook.test.ts` | ? | 3 | Hook invariants | onScheduledGameSpawned trigger |
| `apps/backend/src/game/__tests__/GamePlanRunCleanupService.naturalEndReconcile.test.ts` | 580+ | 11 | Natural-end reconcile | scheduled.completed+plan.running > 30s → finish |
| `apps/backend/src/game/GamePlanEngineBridge.test.ts` | 1100+ | 24 | Bridge-mekanikk | buildTicketConfigFromCatalog, jackpot, idempotent retry |
| `apps/backend/src/game/GamePlanEngineBridge.onScheduledGameCreated.test.ts` | ? | 9 | Hook-flyt | F-NEW-3 pre-engine binding |
| `apps/backend/src/game/__tests__/GamePlanEngineBridge.*.test.ts` (3 filer) | ? | ? | Multi-hall + cancelled-reuse + takeover | §4.4 cancelled-reuse + multi-GoH |
| `apps/backend/src/observability/roundReplayBuilder.test.ts` | ? | ? | Round-replay-API | Audit timeline (post-mortem, ikke live) |

### 1.2 Backend route-tester (integration) — 4 filer

| Fil | Tester | Scope |
|---|---:|---|
| `apps/backend/src/routes/__tests__/spill1Lobby.test.ts` | 8 | `GET /api/games/spill1/lobby` — closed/idle/purchase_open + headers + 400-fall + DomainError propagering |
| `apps/backend/src/routes/__tests__/agentGamePlan.test.ts` | 40+ | Fase 3+4 plan-runtime — current/start/advance/jackpot-setup/pause/resume + RBAC + bridge-feilfanging |
| `apps/backend/src/routes/__tests__/agentGamePlan.lobbyBroadcast.test.ts` | 6 | Lobby-broadcast etter master-actions |
| `apps/backend/src/__tests__/GamePlanRunCleanupService.naturalEndReconcile.integration.test.ts` | 2 | Postgres-integrasjon for reconcile |

### 1.3 Backend E2E (skip-graceful) — 4 filer

| Fil | Tester | Scope |
|---|---:|---|
| `apps/backend/src/__tests__/e2e/spill1FullFlow.test.ts` | 6 | F22 (max-draws 75) + F17 (slug planId) + ADR-0017-shape-tests — **unit-level kontrakts-tester, ikke faktisk E2E** |
| `apps/backend/src/__tests__/e2e/spill1PilotBlockers.test.ts` | 9 | Regresjons-tests for F4/F17/F-NEW-2/ADR-0017/F-Plan-Reuse |
| `apps/backend/src/__tests__/e2e/spill1PilotFinalVerification.test.ts` | 6 | Doc-only regression-tests for F-NEW-3/F-Plan-Reuse/F-Recovery-Incomplete |
| `apps/backend/src/__tests__/e2e/Spill1FullDay.e2e.test.ts` | 13 | Phase 1-5 — health, register, wallet, auth, smoke — **dekker ikke advance** |

### 1.4 Backend E2E full-flow (skip-graceful) — 1 fil

| Fil | Tester | Scope |
|---|---:|---|
| `apps/backend/src/__tests__/e2e_4hall_master_flow.test.ts` | 30+ | STEP 1-8: 4-hall master-flow — agent-shifts, RoomStartPreFlightValidator, ready-state, master start auto-eksklusjon, pause/resume — **dekker ikke advance gjennom plan-items** |

### 1.5 Admin-web frontend unit-tester (vitest) — 13 filer

| Fil | Tester | Scope |
|---|---:|---|
| `apps/admin-web/tests/masterHeaderText.test.ts` | 28 | `getMasterHeaderText` pure helper — 12 states × gameName-variants. **Inkluderer "regression Tobias 3-gang-bug"** |
| `apps/admin-web/tests/spill1HallStatusBoxAngreKlar.test.ts` | 5 | "Angre Klar"-knappen |
| `apps/admin-web/tests/spill1HallStatusBoxRecoverButton.test.ts` | 7 | "Recover stale"-knappen |
| `apps/admin-web/tests/spill1AgentControls.test.ts` | ? | Agent-controls |
| `apps/admin-web/tests/nextGamePanel.test.ts` | 28 | AgentHallSocket + NextGamePanel rendering |
| `apps/admin-web/tests/nextGamePanelMapping.test.ts` | 16 | `mapLobbyToLegacyShape` — empty/full state |
| `apps/admin-web/tests/nextGamePanelSpill1Unified.test.ts` | 11 | NextGamePanel Spill 1 unified-view |
| `apps/admin-web/tests/agentGame1MasterActions.test.ts` | 21 | Master-actions API-klient |
| `apps/admin-web/tests/agentPortalSkeleton.test.ts` | ? | Sidebar |
| `apps/admin-web/tests/lobbyHallSwitcher.test.ts` | ? | Hall-switching |
| `apps/admin-web/tests/cashInOutLayout.test.ts` | ? | Layout |
| `apps/admin-web/tests/TVScreenPage.*.test.ts` (3 filer) | ? | TV-skjerm |

### 1.6 Game-client unit-tester (vitest) — 8 filer

| Fil | Tester | Scope |
|---|---:|---|
| `packages/game-client/src/games/game1/Game1Controller.waitingForMaster.test.ts` | 8 | N1-N7 + regression — "Neste spill"-idle-text via mock ControllerFlowHarness |
| `packages/game-client/src/games/game1/Game1Controller.autoJoinScheduled.test.ts` | ? | Auto-join scheduled-game |
| `packages/game-client/src/games/game1/Game1Controller.lobbyInitOrder.test.ts` | ? | Init-order ved fetch-race |
| `packages/game-client/src/games/game1/__tests__/spillerklientRebuildE2E.test.ts` | 16 | Test 1-6 + 8 sek robusthet — **Test 5 dekker advance-flyt med mocked lobby** |
| `packages/game-client/src/games/game1/logic/LobbyStateBinding.test.ts` | ? | Lobby-binding |
| `packages/game-client/src/games/game1/logic/LobbyStateBinding.fetchResilience.test.ts` | ? | Fetch-resilience |
| `packages/game-client/src/games/game1/logic/lobbyTicketTypes.test.ts` | ? | Ticket-types-mapping |
| `packages/game-client/src/games/game1/screens/PlayScreen.waitOnMasterPurchase.test.ts` | ? | Buy-purchase-flyt |

### 1.7 Synthetic + Playwright E2E — 8 filer

| Fil | Type | Tester | Scope |
|---|---|---:|---|
| `scripts/synthetic/spill1-round-bot.ts` + `invariants.ts` | Synthetic bot | I1-I6 | **ÉN RUNDE**: wallet/compliance/hash-chain/draw-seq/idempotency/round-end |
| `scripts/__tests__/synthetic/spill1-round-bot.test.ts` | Synthetic unit-tester | ~30 | Pure-compute invariant evaluators |
| `tests/e2e/spill1-pilot-flow.spec.ts` | Playwright | 1 | Master starter + spiller kjøper bonger + verifiser priser — **ÉN runde Bingo, ingen advance** |
| `tests/e2e/spill1-no-auto-start.spec.ts` | Playwright | 2 | mark-ready + buy skal IKKE auto-starte |
| `tests/e2e/spill1-rad-vinst-flow.spec.ts` | Playwright | 1 | Master + spiller + master Fortsett — Rad 1 → Rad 2 (intra-runde) |
| `tests/e2e/spill1-wallet-flow.spec.ts` | Playwright | 1 | Wallet belastes 120 kr + compliance-ledger |
| `tests/e2e/spill1-reentry-during-draw.spec.ts` | Playwright | 1 | Re-entry under aktiv trekning |
| `tests/e2e/spill1-manual-flow.spec.ts` | Playwright | 1 | Tobias' manuelle flyt — dev-user → default-hall → bytt hall → bingo → kjøp |

### 1.8 Shared-types + observability — 3 filer

| Fil | Scope |
|---|---|
| `packages/shared-types/__tests__/spill1-lobby-state.idShape.test.ts` | UUID vs slug planId-shape |
| `apps/backend/src/observability/roundReplayBuilder.test.ts` | Round-replay-API (post-mortem) |
| `apps/backend/src/routes/devFrontendStateDump.test.ts` | Frontend State Dump (debug-HUD) |

---

## 2. Test-matrise per state-transition

State-machine fra audit-skall §4:
- `no-plan-run-exists` (etter dev:nuke)
- `idle` (plan-run idle)
- `scheduled` → `purchase_open` → `ready_to_start` → `running` → `paused` → `completed`
- `cancelled` (master stoppet)
- `finished` (plan-run.status='finished')
- `closed` (utenfor åpningstid)

### 2.1 Backend state-transitions

| Transition | Dekket av | Edge-cases dekket | Edge-cases IKKE dekket |
|---|---|---|---|
| **no-plan-run-exists → first-display** (KRITISK — bug-en) | `Game1LobbyService.test.ts:302` "idle når innenfor åpningstid + ingen run" + `GamePlanRunService.test.ts:341` "lazy-create idle-run" | Single-hall, multi-hall via GoH-medlemskap, weekday-mismatch, kant av åpningstid | **Ingen test: fresh dev:nuke der `app_game_plan_run` er tom + scheduled-games tom + items[0] skal vises som "neste spill: Bingo"**. Test 302 forutsetter at master HAR opprettet idle-run, ikke en helt fresh state. |
| **idle → running (master start)** | `Game1LobbyService.test.ts:340` + `MasterActionService.test.ts:598` + `agentGamePlan.test.ts:607` | Idempotent re-start, jackpot-required, bridge-feil-retry/rollback | OK |
| **running → completed** (engine ender naturlig) | `Game1LobbyService.test.ts:367` + `Game1LobbyService.reconcile.test.ts:298` | Stuck > 30s → auto-reconcile, last-position vs non-last | OK |
| **completed → finished (plan-run.finished, position=N)** (KRITISK — bug-en, mid-plan) | `Game1LobbyService.test.ts:451` "finished på position=1 av 2" + `:469` "position=7 av 13" + `GameLobbyAggregator.test.ts:873+968` | position=1, position=7, position=13 (siste) | **Ingen E2E som actually KJØRER engine→completed→finished→next**. Alle er stub-baserte unit-tester. |
| **finished → next-item-idle (UI viser items[N+1])** | `Game1LobbyService.test.ts:451+469` + `GameLobbyAggregator.test.ts:873` | Position=1→2, position=7→8 | **Ingen test som sekvenserer ALLE 13 items i rekkefølge**. Skip fra position=1 til 7 til 13. Hvis bug ligger på spesifikk posisjon (eks. items[3]→items[4]) fanges det ikke. |
| **finished på siste position → planCompletedForToday=true** | `Game1LobbyService.test.ts:500` "finished på position=13 av 13" + `GameLobbyAggregator.test.ts:825` + `GamePlanRunService.autoAdvanceFromFinished.test.ts:461` "PLAN_COMPLETED_FOR_TODAY" | 2-item plan + 13-item plan, currentPosition >= items.length | OK |
| **getOrCreateForToday: finished+position<items.length → DELETE+INSERT på position+1** | `GamePlanRunService.autoAdvanceFromFinished.test.ts:380` (position=1→2) + `:413` (position=2→3) + `:437` (position=12→13) | position=1, 2, 12, plan med 0 items, previousPosition=null, status=idle/running | **Manglende: hvis DELETE lykkes men INSERT feiler (transaction-edge)** |
| **Master advance** | `MasterActionService.test.ts:804+835` + `agentGamePlan.test.ts:759` | jackpot-required, siste position, engine-feil, retry/rollback | OK |
| **GamePlanRunCleanupService natural-end reconcile** | `GamePlanRunCleanupService.naturalEndReconcile.test.ts:224-557` | < 30s grace, scheduled=cancelled, audit, idempotent, multi-hall, DB-error fallback | OK |
| **stale plan-run fra i går** | `GameLobbyAggregator.test.ts:1454` + `:1678` (paused-state) | Stale=running, stale=paused | **Ingen test: dev:nuke etter en stale plan-run finnes (mest realistisk scenario)** |

### 2.2 Frontend state-transitions

| Transition | Dekket av | Hvordan testes | Hva mangler |
|---|---|---|---|
| **Master-konsoll: idle → header = "Neste spill: Bingo"** | `masterHeaderText.test.ts:31` "idle + Bingo → 'Neste spill: Bingo'" | Pure helper-unit-test (`getMasterHeaderText`) | OK for helper-laget. **Ingen test verifiserer at `data.catalogDisplayName` propageres riktig fra aggregator** når run finished+position<items.length |
| **Master-konsoll: purchase_open → header** | `masterHeaderText.test.ts:53` (regression for Tobias 3-gang-bug) | Pure helper-test | OK |
| **NextGamePanel: subGameName trekkes fra planMeta** | `nextGamePanelMapping.test.ts:253` "subGameName trekkes fra planMeta.catalogDisplayName" | Pure mapping-unit-test | **Ingen test for finished-state** — alle tester antar `lobby.planMeta?.catalogDisplayName = 'Bingo'`. Tester ikke advance-flyt. |
| **Game1Controller idle → 'Neste spill: Bingo' i CenterBall** | `Game1Controller.waitingForMaster.test.ts:122-216` | Mock `ControllerFlowHarness.applyLobbyState(state)` | **Ingen test som driver hele `Game1Controller` mot ekte backend** — alt er mocks |
| **Etter Fullt Hus → ny purchase_open viser nytt navn** | `spillerklientRebuildE2E.test.ts:531` Test 5 | `SpillerklientHarness` + mock socket + `emitStateUpdate(makeLobbyState({...nextScheduledGame: ...innsatsen}))` | **CRITICAL: testen tester KUN at IF backend returnerer korrekt state, klient rendrer korrekt. Tester IKKE at backend actually returnerer korrekt state etter finished-runde.** Mock-grensen mellom backend og klient er ufanget. |
| **NextGamePanel rendering med ulike states** | `nextGamePanel.test.ts:303-590` | DOM-render mot mocked lobby-state | **Ingen test for finished+nextItem-flyt** |

### 2.3 E2E-coverage

| E2E-scope | Dekket | Hvordan | Mangler |
|---|---|---|---|
| Full master-start + spiller-buy + draws | `tests/e2e/spill1-pilot-flow.spec.ts` | Playwright med faktisk backend | **Tester ÉN runde Bingo**. Ingen advance. Ingen UI-assertion på "Neste spill"-tekst. |
| Master Fortsett intra-runde | `tests/e2e/spill1-rad-vinst-flow.spec.ts` | Playwright | **Intra-runde pause/fortsett, ikke inter-runde advance** |
| Wallet + compliance | `tests/e2e/spill1-wallet-flow.spec.ts` | Playwright | OK for wallet |
| 4-hall ready-progression | `apps/backend/src/__tests__/e2e_4hall_master_flow.test.ts` | Node-test mot DB | **Tester ready-state, master start, pause/resume — IKKE advance gjennom 13 items** |
| Synthetic bot ÉN runde | `scripts/synthetic/spill1-round-bot.ts` | TS-bot mot live backend | **ÉN runde Bingo**. Ingen advance. Ingen UI-rendering. |
| MasterActionService full loop | `apps/backend/src/__tests__/MasterActionService.integration.test.ts` | Mocked services + InMemoryAuditLogStore | start→advance→pause→resume→stop, MEN mocked `planRunService.advanceToNext` returnerer alltid samme catalog-entry. Tester ikke at advance gir korrekt nytt item-display. |

---

## 3. Identifiserte coverage-hull (KRITISK)

### 3.1 Hvorfor fanget IKKE eksisterende tester den siste Next Game Display-bug-en?

**PITFALLS §3.13 (PR #1431) la til disse testene:**
- `Game1LobbyService.test.ts:451` "finished på position=1 av 2 → nextScheduledGame=items[1]"
- `Game1LobbyService.test.ts:469` "finished på position=7 av 13 → nextScheduledGame=items[8]"
- `GameLobbyAggregator.test.ts:873` "finished mid-plan: planMeta peker til NESTE catalog-slug"
- `GameLobbyAggregator.test.ts:968` "finished på position=7 av 13"

**Disse tester nøyaktig dette mønsteret:** "finished + position<items.length → nextScheduledGame.catalogSlug = items[position+1].catalogEntry.slug". Likevel dukket bug-en opp igjen. Hvorfor?

**Hypotese A — Multi-source-divergens:**
- Backend `Game1LobbyService` returnerer korrekt `nextScheduledGame`
- Backend `GameLobbyAggregator.buildPlanMeta` returnerer korrekt `planMeta.catalogSlug`
- **MEN** frontend reads fra ulike kilder:
  - `Spill1HallStatusBox` line 692 leser `data.catalogDisplayName` (kommer fra `lobby.planMeta?.catalogDisplayName`)
  - `NextGamePanel` line 620 leser `lobby.planMeta?.catalogDisplayName`
  - `Game1Controller.applyLobbyState` line 59 i test leser `state?.nextScheduledGame?.catalogDisplayName ?? "Bingo"`
- Hvis BARE `planMeta.catalogDisplayName` ble fixet i `GameLobbyAggregator`, men `nextScheduledGame.catalogDisplayName` fra `Game1LobbyService` ble glemt → klient som leser fra sistnevnte (game-client) viser fortsatt feil.

**Hypotese B — Tester fanger ikke fresh-state etter dev:nuke:**
- Bug-en sier: "Etter dev:nuke" → mest realistiske scenario er `app_game_plan_run` er TOM (ikke "finished på position=1"). 
- `Game1LobbyService.test.ts:302` "idle når innenfor åpningstid + ingen run" forutsetter at `getOrCreateForToday` er kalt FØR. I `Game1LobbyService.getLobbyState` (ikke testet med dette navnet) er det `lazy-create`-pathen.
- **Ingen test for: "tom DB + lobby-fetch → returnerer plan-items[0] som nextGame"**

**Hypotese C — Aggregator + LobbyService divergerer:**
- `GameLobbyAggregator.buildPlanMeta` returnerer `catalogSlug` fra `plan.items[positionForDisplay].catalogEntry.slug` (advance hvis finished)
- `Game1LobbyService.getLobbyState` returnerer `nextScheduledGame` fra `plan.items[currentPosition].catalogEntry.slug` (advance hvis finished)
- **De har overlappende men ulike paths**. Tester verifiserer hver isolert. Ingen test verifiserer at de gir SAMME slug for samme input.

### 3.2 Manglende invariants (cross-service kontrakter)

**Bug-typen "minst 4 kode-paths beregner samme ting" handler om manglende invariants.** Eksisterende tester sjekker hver path isolert. Det fanger ikke at de DIVERGERER.

**Kritiske invariants som mangler:**

1. **I-NextGame-1: Aggregator + LobbyService gir SAMME catalogSlug**
   ```typescript
   // Gitt: samme (hallId, businessDate, plan-state)
   // Forventer: aggregator.planMeta.catalogSlug === lobbyService.nextScheduledGame.catalogSlug
   ```
   Ingen slik invariant finnes.

2. **I-NextGame-2: Frontend rendring matcher backend-output**
   ```typescript
   // Gitt: lobby-state med planMeta.catalogDisplayName="Innsatsen"
   // Forventer: Spill1HallStatusBox header inneholder "Innsatsen"
   //          + NextGamePanel viser "Innsatsen" 
   //          + Game1Controller idle-text viser "Neste spill: Innsatsen"
   ```
   Ingen integration-test verifiserer dette på tvers av komponenter.

3. **I-NextGame-3: Sekvensiell advance gjennom alle items**
   ```typescript
   // Gitt: dev:nuke fresh state
   // For hver position i 1..13:
   //   1. Master start → next-display = items[1] (Bingo)
   //   2. Engine kjører → finished
   //   3. Lobby-API returnerer items[2] som next
   //   4. Master start igjen → next-display = items[2] (1000-spill)
   //   ...
   // Forventer: aldri samme slug to ganger på rad, alltid +1 progresjon
   ```
   Ingen slik test finnes.

4. **I-NextGame-4: Fresh state (tom DB) gir items[0]**
   ```typescript
   // Gitt: app_game_plan_run tom + app_game1_scheduled_games tom
   // Forventer: GET /api/agent/game1/lobby returnerer items[1] som nextScheduledGame
   ```
   Ingen test dekker dette scenarioet.

5. **I-NextGame-5: dev:nuke + stale plan-run fra i går (S-Recovery)**
   ```typescript
   // Gitt: i går stale plan-run med status='running' (instans-krasj)
   // Forventer: dagens lobby-fetch returnerer items[1] (cleanup-cron har finishet stalen)
   ```
   `GameLobbyAggregator.test.ts:1454` tester stale-warning, men ikke full E2E gjennom cleanup→reset→lobby-fetch.

### 3.3 Mocks vs ekte DB — tester divergerer fra real-world

**Pattern observert:** Nesten alle unit-tester bruker stub-pool (`pool.query`-mock) med regex-match på SQL. Eksempel fra `Game1LobbyService.test.ts:217-223`:
```typescript
if (/app_hall_group_members/i.test(sql)) {
  return { rows: ... };
}
if (/app_game1_scheduled_games/i.test(sql)) {
  return { rows: ... };
}
```

**Risiko:** Mock returnerer hardkodede rader. Hvis backend-koden endrer SQL (legger til kolonne, endrer WHERE-clause), kan mock fortsatt matche regex og returnere stale data. Bug-en lever videre i prod men test-en passerer.

**Eksempel:** `GameLobbyAggregator.test.ts` har 26 tester med stubbed `pool.query`. Selve `GameLobbyAggregator.integration.test.ts` har KUN 4 tester som faktisk kjører SQL — og de tester ikke noe i nærheten av full plan-runtime → aggregator → respons-flyt.

**Andre bekymringer:**
- `MasterActionService.integration.test.ts` har stubbed `planRunService.advanceToNext` som ALLTID returnerer samme catalog-entry — tester ikke at advance faktisk gir korrekt next-item.
- `MasterActionService.integration.test.ts` har stubbed `engineBridge.createScheduledGameForPlanRunPosition` som returnerer hardkodet `{ scheduledGameId: SCHED_ID, reused: false }`.

### 3.4 Playwright E2E-tester dekker IKKE Next Game Display

**Verifisert:** Sjekket alle 6 playwright-spec-filer. Ingen `expect(page).toHaveText("Neste spill:...")`. Ingen `expect(page).toContainText(/1000-spill|5×500|Innsatsen/)`. Bare `spill1-rad-vinst-flow.spec.ts` leser `lobbyAfterPause.planMeta?.planRunStatus` (linje 483) — men det er intra-runde pause/resume, ikke inter-runde advance.

**Konsekvens:** Selv om backend gir korrekt lobby-state, kan UI fortsatt rendere feil tekst. Vi ville aldri vite før Tobias rapporterer.

### 3.5 Synthetic-test er IRRELEVANT for denne bug-en

`scripts/synthetic/spill1-round-bot.ts` tester I1-I6 invariants:
- I1: Wallet-konservering
- I2: Compliance-ledger entries
- I3: Hash-chain
- I4: Draw-sequence
- I5: Idempotency
- I6: Round-end-state

**Ingen av disse handler om next-game display.** Botens scope er én runde — den starter, kjøper, venter på 75 trekk, sjekker payout, ferdig. Ingen advance-flyt.

### 3.6 SpillerklientRebuildE2E Test 5 — falsk trygghet

`packages/game-client/src/games/game1/__tests__/spillerklientRebuildE2E.test.ts:531` "Test 5: Etter Fullt Hus → ny purchase_open viser idle-text for neste plan-position":

```typescript
emitStateUpdate(
  makeLobbyState({
    overallStatus: "purchase_open",
    currentRunPosition: 2,
    nextScheduledGame: makeNextScheduledGameStandardBingo({
      position: 2,
      catalogSlug: "innsatsen",
      catalogDisplayName: "Innsatsen",
    }),
  }),
);
expect(harness.getIdleHeadline()).toBe("Neste spill: Innsatsen");
```

**Hva testen gjør:** Mocker socket-event som returnerer hardkodet `lobby-state` med `nextScheduledGame.catalogDisplayName="Innsatsen"`. Verifiserer at klient rendrer "Innsatsen".

**Hva testen IKKE gjør:** Verifiserer at backend faktisk produserer denne lobby-state-shapen etter finished-runde. Det er nettopp her bug-en lever.

---

## 4. Mocks vs ekte DB — sammendrag

| Test-fil | Bruker ekte DB? | Mock-pattern | Risiko |
|---|---|---|---|
| `Game1LobbyService.test.ts` | ❌ Nei | Stub `pool.query` + regex-match | Stale mock kan returnere data som backend ikke faktisk produserer |
| `GameLobbyAggregator.test.ts` | ❌ Nei | Stub `pool.query` + planById-Map | Samme |
| `GameLobbyAggregator.integration.test.ts` | ✅ Ja (skip-graceful) | Minimum-shape schema | Bare 4 tester — dekker SQL-syntaks, ikke flyt |
| `GamePlanRunService.autoAdvanceFromFinished.test.ts` | ❌ Nei | Stub `pool.query` + DELETE+INSERT-mocks | Tester logikk, ikke transaksjon-rollback |
| `MasterActionService.test.ts` | ❌ Nei | Stub services | Tester orchestration, ikke service-implementasjon |
| `MasterActionService.integration.test.ts` | ✅ Ja (skip-graceful) | InMemoryAuditLogStore + PostgresAuditLogStore | Tester KUN audit-trail, ikke faktisk advance |
| `spill1Lobby.test.ts` (routes) | ❌ Nei | Stub `lobbyService.getLobbyState` | Tester HTTP-skall, ikke service |
| `agentGamePlan.test.ts` (routes) | ❌ Nei | Stub services | Samme |
| `spillerklientRebuildE2E.test.ts` | ❌ Nei | Mocked socket + `emitStateUpdate` | Tester klient i isolasjon |
| `Game1Controller.waitingForMaster.test.ts` | ❌ Nei | `ControllerFlowHarness` mock | Tester KUN handler-logikk |
| `nextGamePanelMapping.test.ts` | ❌ Nei | Hardkodet lobby-state | Tester KUN mapping-funksjon |
| `tests/e2e/spill1-*.spec.ts` (Playwright) | ✅ Ja (live backend) | ✓ Ekte | Tester én runde, ikke advance |
| `scripts/synthetic/spill1-round-bot.ts` | ✅ Ja (live backend) | ✓ Ekte | Tester én runde, ikke advance |

**Konklusjon:** Ekte-DB-tester er bare 4: integration (4 SQL-tester), playwright (6 tester én runde), e2e_4hall (ready-state, ikke advance), Spill1FullDay.e2e (smoke). **Ingen ekte-DB test sekvenserer gjennom advance-flyten.**

---

## 5. Recommendations for Trinn 3 (refactor)

For å hindre at bug-en kommer tilbake må disse testene finnes (Tobias-direktiv 2026-05-14: kvalitet > tid, 1-4 uker OK for arkitektur-rewrite). Spesifikke forslag rangert etter prioritet:

### 5.1 Invariants (CRITICAL — disse låser kontrakten)

| ID | Invariant | Hvor | Hvordan |
|---|---|---|---|
| **I-NextGame-1** | Aggregator + LobbyService gir SAMME catalogSlug for samme input | `apps/backend/src/game/__tests__/NextGameDisplayInvariants.test.ts` (NY) | Loop over alle 11 states × 13 positions. Kall begge services. Assert lik output. |
| **I-NextGame-2** | nextScheduledGame.catalogSlug = items[positionForDisplay].catalogEntry.slug | Samme fil | For hver state-transition: verifiser at output peker til riktig item |
| **I-NextGame-3** | planMeta.catalogDisplayName ALDRI er stale i finished+items<length-state | Samme fil | Spesifikk regression for bug-en |
| **I-NextGame-4** | Etter dev:nuke (tom DB) → next-display = items[0] | `apps/backend/src/__tests__/e2e/freshStateNextGameDisplay.test.ts` (NY) | Integration mot ekte DB (skip-graceful). TRUNCATE alle tabeller. Fetch lobby. Assert items[0]. |
| **I-NextGame-5** | Sekvensiell advance: ingen samme slug to ganger på rad | `apps/backend/src/__tests__/e2e/sequentialAdvanceAllItems.test.ts` (NY) | Loop position 1→13. For hver: start, kjør engine til finished, fetch lobby, assert slug = items[next].slug |

### 5.2 Scenario-tester (state-transitions)

Hver state-transition skal ha minst én test som driver ENTIRE flyten ende-til-ende (ikke via mocks):

1. **fresh-state → items[0]**: dev:nuke, deretter `GET /api/agent/game1/lobby` direkte mot backend → assert `nextScheduledGame.catalogSlug === 'bingo'` (items[0])

2. **first-master-start → running med items[0]**: fresh-state → POST `/api/agent/game1/master/start` → verifiser scheduled-game opprettet for position=1, status=running

3. **engine completion → finished med next=items[1]**: kjør engine til ferdig → GET lobby → assert `nextScheduledGame.catalogSlug === '1000-spill'` (items[1])

4. **second master-start → ny runde med items[1]**: POST master/start → verifiser ny scheduled-game spawnet for position=2, ny `currentScheduledGameId` !== gammel

5. **Loop til position=13 → planCompletedForToday=true**: gjenta steg 3-4 for hver av 13 items

6. **dev:nuke etter ferdig dag → fresh state for ny dag**: kjør hele dagen, deretter dev:nuke, deretter fetch lobby for next-day-business-date → assert items[0]

### 5.3 E2E playwright-test (manuell-bekreftbar)

`tests/e2e/spill1-next-game-display-flow.spec.ts` (NY):

```typescript
test("master ser riktig 'Neste spill'-tekst gjennom hele planen", async ({ page }) => {
  await resetPilotState({ destroyRooms: true });
  await autoLogin(MASTER_EMAIL);
  await page.goto("/admin/agent/cash-in-out");
  
  // Step 1: Fresh state etter dev:nuke
  await expect(page.locator('[data-testid="master-header"]')).toContainText("Neste spill: Bingo");
  
  // Step 2: Start runde
  await page.click('[data-testid="master-start-button"]');
  await expect(page.locator('[data-testid="master-header"]')).toContainText("Aktiv trekning - Bingo");
  
  // Step 3: Vent på engine ferdig + auto-reconcile
  await waitForRoundFinished();
  await expect(page.locator('[data-testid="master-header"]')).toContainText("Neste spill: 1000-spill");
  
  // Step 4-15: Repeter for alle 13 items
  for (let i = 1; i <= 12; i++) {
    await page.click('[data-testid="master-start-button"]');
    await waitForRoundFinished();
    const expectedNext = PILOT_PLAN_ITEMS[i + 1] ?? "Spilleplan ferdig";
    await expect(page.locator('[data-testid="master-header"]')).toContainText(expectedNext);
  }
  
  // Step 16: Plan fullført
  await expect(page.locator('[data-testid="master-header"]')).toContainText("Spilleplan ferdig for i dag");
});
```

### 5.4 Synthetic-test utvidelse

`scripts/synthetic/spill1-multi-round-bot.ts` (NY) — driver gjennom alle 13 items:

```typescript
for (let position = 1; position <= 13; position++) {
  const lobby = await fetchLobby(hallId);
  assert.equal(lobby.nextScheduledGame.catalogSlug, EXPECTED_PLAN[position - 1].slug);
  
  await masterStart();
  await runEngineToCompletion();
  
  const lobbyAfter = await fetchLobby(hallId);
  if (position < 13) {
    assert.equal(lobbyAfter.nextScheduledGame.catalogSlug, EXPECTED_PLAN[position].slug);
  } else {
    assert.equal(lobbyAfter.nextScheduledGame, null);
    assert.equal(lobbyAfter.planCompletedForToday, true);
  }
}
```

### 5.5 Cross-service kontrakts-test (LOW-LEVEL)

`apps/backend/src/game/__tests__/NextGameDisplayContract.test.ts` (NY) — pure invariant-test som tar samme input til alle 4 frontend-paths og asserter SAMME output:

```typescript
test("kontrakt: alle 4 next-game-display-paths gir samme catalogSlug", () => {
  const lobbyState = makeFinishedLobbyState({ position: 7, planItems: 13 });
  
  const headerText = getMasterHeaderText("idle", lobbyState.planMeta.catalogDisplayName);
  const nextPanelMapping = mapLobbyToLegacyShape(lobbyState);
  const controllerName = lobbyState.nextScheduledGame?.catalogDisplayName ?? "Bingo";
  
  // Alle 3 må peke til items[8]
  expect(headerText).toContain("Spill 8");
  expect(nextPanelMapping.currentGame?.subGameName).toBe("Spill 8");
  expect(controllerName).toBe("Spill 8");
});
```

---

## 6. Konkret pre-existing kode-paths som beregner "neste spill"

Verifisert via grep gjennom kodebasen:

| Path | Fil | Linje | Hva den leser | Hva den returnerer |
|---|---|---:|---|---|
| **Backend Aggregator (master/agent-UI)** | `apps/backend/src/game/GameLobbyAggregator.ts` | `buildPlanMeta` | plan.items + planRun.currentPosition + planRun.status | `planMeta.catalogSlug` + `planMeta.catalogDisplayName` |
| **Backend LobbyService (spiller-shell)** | `apps/backend/src/game/Game1LobbyService.ts` | `getLobbyState` | Samme som over | `nextScheduledGame.catalogSlug` + `nextScheduledGame.catalogDisplayName` |
| **Backend GamePlanRunService.getOrCreateForToday** | `apps/backend/src/game/GamePlanRunService.ts` | `getOrCreateForToday` | previousPosition + items.length | INSERT med `current_position = previousPosition + 1` |
| **Frontend Spill1HallStatusBox** | `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts` | 692, 763, 1513 | `data.catalogDisplayName` (kommer fra aggregator's `planMeta`) | `getMasterHeaderText(...)` |
| **Frontend NextGamePanel** | `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` | 620 | `lobby.planMeta?.catalogDisplayName` | `currentGame.subGameName` |
| **Game-client Game1Controller** | `packages/game-client/src/games/game1/Game1Controller.ts` (forutsetter ~ samme som tester) | `applyLobbyState` | `state?.nextScheduledGame?.catalogDisplayName ?? "Bingo"` | CenterBall idle-text via `setBuyPopupDisplayName` |

**Konsekvens av 6 separate paths:** Hver fix har truffet 1-2 paths. De andre lever uforandret. **Refactor må konsolidere til ÉN `NextGameDisplayService`** som alle 6 paths leser fra — og tester som verifiserer at ingen path har egen logikk.

---

## 7. Konklusjon

| Spørsmål | Svar |
|---|---|
| Antall test-filer som tester noen del av Next Game Display? | ~52 filer, ~400+ tester |
| Antall ekte-DB E2E-tester som dekker full advance? | **0** |
| Antall invariants som binder backend-paths sammen? | **0** |
| Antall sequenstest gjennom alle 13 items? | **0** |
| Antall tests for fresh-state (dev:nuke)? | **0** (alle forutsetter idle-run finnes) |
| Antall tests som binder frontend+backend uten mock? | **0** (alle frontend-tester mocker socket/lobby-state) |

**Diagnose:** Tester er omfattende på unit-laget (49 tester for `MasterActionService.test.ts` alene) men splittet og isolert. Hver komponent har egen test-suite med egen mock-data. **Ingen kontrakter låser at de gir KONSISTENT output.**

**Anbefaling for Trinn 3:** Sentral `NextGameDisplayService` + 5 invariants (§5.1) + E2E sequence-test (§5.3) + multi-round synthetic (§5.4). Estimat: 3-5 dager test-skrivning hvis refactor-en lykkes.

---

## SKILL_UPDATE_PROPOSED

For Trinn 2-konsolidering bør disse skills oppdateres når refactor lander:

1. **`spill1-master-flow` skill** — ny seksjon "Next Game Display flow" som peker til:
   - Sentral `NextGameDisplayService` (etter Trinn 3 refactor)
   - I-NextGame-1 til I-NextGame-5 invariants
   - Sequential advance-test
   - Anti-mønster: aldri lag lokal "beregn neste spill"-logikk

2. **`casino-grade-testing` skill** — ny seksjon "Cross-service invariants":
   - Når flere services beregner samme output, må de ha en invariant-test
   - Loop over input-rom og assert lik output
   - Detect divergent path silently

3. **PITFALLS_LOG §6 (Test-infrastruktur)** — ny entry:
   - "Mocked lobby-state + isolated unit-tester fanger ikke cross-service-divergens. Krever invariants."

---

## Referanser

- Audit-skall: `docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md`
- Handoff: `docs/operations/PM_HANDOFF_2026-05-14.md` §1
- Tidligere fix-arv: PITFALLS_LOG §3.10, §3.11, §3.12, §3.13
- Robusthet-mandat: `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
- Bølge 1-3 grunnlag: `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`
