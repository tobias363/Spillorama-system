---
name: agent-portal-master-konsoll
description: When the user/agent works with the Spill 1 master-konsoll UI in the admin-portal — the agent-portal cash-in-out box, hall-status pills, master-actions buttons, JackpotSetupModal — in the Spillorama bingo platform. Also use when they mention Spill1HallStatusBox, Spill1Panel, NextGamePanel, Spill1AgentControls, Spill1AgentStatus, JackpotSetupModal, Game1MasterConsole, master-konsoll, master-handlinger, master actions UI, Spill1AgentLobbyState, currentScheduledGameId, fetchLobbyState, fetchAgentGame1CurrentGame, agent-game-plan-adapter, agent-master-actions, plan-run-id vs scheduled-game-id, ID-rom, isMasterAgent, data-action buttons, polling 2s, spill1:lobby socket, BIN-1041, BIN-1030, BIN-1033, BIN-1035, Bølge 1/2/3 refaktor, GameLobbyAggregator, MasterActionService. The plan-run-id vs scheduled-game-id schism has caused multiple bugs (PR #1030 #1035 #1041) — this skill enforces the single-source rule. Make sure to use this skill whenever someone touches Spill1HallStatusBox, NextGamePanel, master-action wiring, or LobbyState consumption — even if it looks like a small UI tweak — because using the wrong ID for a master-action sends pause/start to the wrong scheduled-game.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts, apps/admin-web/src/pages/cash-inout/CashInOutPage.ts, apps/admin-web/src/pages/agent-portal/NextGamePanel.ts, apps/admin-web/src/pages/agent-portal/Spill1AgentControls.ts, apps/admin-web/src/pages/agent-portal/Spill1AgentStatus.ts, apps/admin-web/src/pages/agent-portal/JackpotSetupModal.ts, apps/admin-web/src/pages/agent-portal/AgentCashInOutPage.ts, apps/admin-web/src/pages/games/master/Game1MasterConsole.ts, apps/admin-web/src/pages/games/master/adminGame1Socket.ts, apps/admin-web/src/api/agent-game-plan.ts, apps/admin-web/src/pages/cash-inout/modals/** -->

# Agent-Portal Master-Konsoll (Spill 1 UI)

The master-konsoll is where the bingovert at the master-hall drives a Spill 1 round: starts the next game, marks self/hall ready, sees other halls' status, sets jackpot popups, pauses/resumes/stops. It lives in two places — the admin agent-portal box (`Spill1HallStatusBox` inside `CashInOutPage`) and the standalone `Game1MasterConsole` admin page.

This UI has had repeated patch-spirals because of the **plan-run-id vs scheduled-game-id schism** (see `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`). PR #1030, #1035, and #1041 each layered fixes on top of the wrong id flowing into master-action calls. The architectural fix is on a 3-bølge refaktor (Bølge 1 done; 2+3 pending).

## Kontekst (read first)

- `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` — fundament-audit, especially §3 (sequence diagrams) and §6.3 (target state)
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §3 (UI status table)
- `goh-master-binding` skill — the routing/scope rules behind `isMasterAgent`
- Source files (current state, mid-refaktor):
  - `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts` (762 lines, polls 2s)
  - `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` (1445 lines, hybrid Spill 1+2+3)
  - `apps/admin-web/src/pages/agent-portal/Spill1AgentControls.ts` (274, render-only buttons)
  - `apps/admin-web/src/pages/agent-portal/Spill1AgentStatus.ts` (hall pills)
  - `apps/admin-web/src/pages/agent-portal/JackpotSetupModal.ts` (popup)
  - `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts` (1424 lines, admin direct)
  - `apps/admin-web/src/api/agent-game-plan-adapter.ts` — **D1 dødkode, slated for deletion**
  - `apps/admin-web/src/api/agent-master-actions.ts` — **D2 dødkode, slated for deletion**
- Backend (Bølge 1 ✅ done):
  - `apps/backend/src/game/GameLobbyAggregator.ts` — single read-aggregator
  - `apps/backend/src/routes/agentGame1Lobby.ts` — `GET /api/agent/game1/lobby?hallId=X`
  - `packages/shared-types/src/spill1-lobby-state.ts` — `Spill1AgentLobbyState`

## Kjerne-arkitektur

### The schism (and why it caused bugs)

There are two parallel ID-rooms:

| ID | Where | Used for |
|---|---|---|
| `plan_run_id` (UUID) | `app_game_plan_run.id` | Plan-runtime state-machine (idle/running/paused/finished) |
| `scheduled_game_id` (UUID) | `app_game1_scheduled_games.id` | Engine-actions: start, pause, resume, stop, jackpot, mark-ready |

Master-actions go to `scheduled_game_id`. The bridge (`GamePlanEngineBridge`) creates a `scheduled_game` row from a `plan_run` position. UI must NEVER send `plan_run_id` to `/api/admin/game1/games/:gameId/...` routes.

The dead `agent-game-plan-adapter.ts` was the source of bugs: it set `currentGame.id = run.id` (plan-run-id), and downstream code blindly used that. PR #1041 patched by overwriting with `findActiveGameForHall`-result, but that opened a new race-condition.

### Single-source rule (Bølge 1 contract)

**Always use `currentScheduledGameId` from the lobby-aggregator response.** Never reach for `plan.run.id` or merge plan + legacy data in the UI.

```typescript
// Correct (Bølge 1+2+3 target)
const lobby = await fetchLobbyState(hallId);
await pauseMaster(lobby.currentScheduledGameId);

// Wrong (current pre-Bølge-3 — patch-and-pray)
const plan = await fetchAgentGamePlanCurrent();
const legacy = await fetchAgentGame1CurrentGame(hallId);
const id = legacy.currentGame.id ?? plan.run.id;  // ← bugs live here
```

### Inconsistency-warnings as UI feedback

The lobby-aggregator returns `inconsistencyWarnings: string[]` with stable codes:

- `PLAN_SCHED_STATUS_MISMATCH` — plan says `running`, scheduled-game says `cancelled`
- `MISSING_GOH_MEMBERSHIP` — hall isn't in current GoH-membership
- `STALE_PLAN_RUN` — plan-run for old businessDate
- `BRIDGE_FAILED` — plan tried to spawn but bridge errored
- `DUAL_SCHEDULED_GAMES` — two active scheduled-games for same plan-position (rare)

UI MUST show these as user-facing warnings (yellow banner). Never silently merge/pick.

### Polling + socket subscribe

`Spill1HallStatusBox` polls `GET /api/agent/game1/lobby?hallId=X` every 2s (current state) and subscribes to `spill1:lobby:{hallId}` for push-updates. Polling is the safety net; socket is the latency-optimisation. Both consume the same `Spill1AgentLobbyState`.

`Game1MasterConsole` polls `/api/admin/game1/games/:gameId` every 2s and subscribes to per-game socket-room. It's the admin direct-edit view (without plan-context).

### `isMasterAgent` boolean drives button-enabled-state

The lobby-aggregator returns `isMasterAgent: boolean` (true if caller's hallId === scheduled_game.master_hall_id || role === 'ADMIN'). Master-action buttons are visible to all but **disabled** for non-masters. This is UX-clarity, not security — the backend re-validates.

### `data-action` buttons (event delegation)

`Spill1AgentControls` renders buttons with `data-action="start" | "pause" | "resume" | "stop" | "jackpot" | "ready" | "unready"`. The container delegates click → handler. Disabled-state is computed from `currentGameStatus + isMasterAgent + currentScheduledGameId !== null`. Don't bypass this — every new master-action goes through the data-action pattern.

## Immutable beslutninger

1. **`currentScheduledGameId` is the single source of truth for master-action calls.** Never use `plan.run.id` for anything that hits a `/api/admin/game1/games/:gameId/...` route.
2. **Inconsistency-warnings surface in UI.** Don't auto-pick one branch over the other.
3. **Master-action buttons gate on `isMasterAgent + currentScheduledGameId`.** Backend re-validates regardless.
4. **Polling 2s + socket subscribe.** Both must be present; one without the other is fragile.
5. **`Game1MasterConsole` is the admin direct-edit path** (without plan). Don't merge it into agent-portal flows.
6. **Bølge 3 will replace `agent-game-plan-adapter.ts` and `agent-master-actions.ts` with a single `api/agent-game1.ts` client.** Don't ship new code that depends on the deprecated adapters.
7. **The new path post-Bølge-3 uses `/api/agent/game1/master/*` (no `:gameId` in path) and `/api/agent/game1/lobby` for read.** Routes under `/api/admin/game1/games/:id/...` will remain for `Game1MasterConsole` (admin direct-edit only).
8. **Master-actions don't go to `/api/agent/game-plan/*`.** Plan endpoints are read-only for the master-konsoll. State-changes happen via master-action routes that go through plan internally.

## Vanlige feil og hvordan unngå dem

1. **Sending `plan.run.id` to master-action endpoints.** Backend returns `GAME_NOT_FOUND` because that ID isn't in `app_game1_scheduled_games`.
2. **Reading the scheduled-game-id from a polling refresh that's 2s stale.** When master advances to next position, the old ID points to the previous (cancelled/finished) game. Wait for the next lobby-fetch or use the socket update.
3. **Auto-picking on `inconsistencyWarnings`.** Show the warning to the user; let them decide. Silent recovery hides the bug instead of surfacing it.
4. **Adding new master-action calls in `agent-master-actions.ts`.** That file is dead code (D2). New work should go in `api/agent-game1.ts` per the Bølge 3 plan.
5. **Computing `isMasterAgent` in the UI from user.role.** No — `isMasterAgent` is server-computed (hallId match check + admin override). Use the boolean from lobby-state.
6. **Bypassing `data-action` button pattern for "just one quick action".** All master-actions go through it for consistent disabled-state + event-delegation.
7. **Merging plan-state and legacy-state field-by-field to construct UI.** Don't — `Spill1AgentLobbyState` is canonical. Read from one place.
8. **Trying to pause/resume via `/api/agent/game-plan/pause` for the engine.** That route only updates plan-runtime state; engine pause goes via master-control. Bølge 2's `MasterActionService` will hide this fan-out.
9. **Consuming `currentGame.id` from a `Spill1CurrentGameResponse` typed as nullable, then sending null.** The data-action handler must short-circuit when `currentScheduledGameId === null`.

## Bølge-status (refaktor-progresjon)

- ✅ **Bølge 1** — Backend lobby-aggregator + `Spill1AgentLobbyState` wire-format. Done 2026-05-08.
- ⏳ **Bølge 2** — `MasterActionService` (single sequencing). Pending.
- ⏳ **Bølge 3** — Frontend cutover from old endpoints to `/api/agent/game1/lobby` + `/api/agent/game1/master/*`. Pending. Bringer dødkode-sletting (D1, D2).

Until Bølge 2+3 land, current code uses the dual-fetch + adapter pattern. New work should stage for the cutover, not extend the legacy paths.

## Kanonisk referanse

- Fundament-audit: `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`
- Implementation status: `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`
- Wire-format: `packages/shared-types/src/spill1-lobby-state.ts`
- Aggregator: `apps/backend/src/game/GameLobbyAggregator.ts`
- Lobby-route: `apps/backend/src/routes/agentGame1Lobby.ts`
- UI:
  - `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`
  - `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts`
  - `apps/admin-web/src/pages/agent-portal/Spill1AgentControls.ts`
  - `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts`

## Når denne skill-en er aktiv

LOAD when:
- Modifying `Spill1HallStatusBox`, `NextGamePanel`, `Spill1AgentControls`, `Spill1AgentStatus`, or `JackpotSetupModal`
- Touching `Game1MasterConsole`
- Adding or changing a master-action route or UI handler
- Consuming `Spill1AgentLobbyState` or building a new lobby-aware view
- Writing new code that involves both plan-state and scheduled-game-state
- Investigating a "pause is silently ignored" or "wrong game paused" bug

SKIP when:
- Pure CSS/visual styling that doesn't touch button-enabled-state or ID-flow
- Spill 2/3 (which use room-code paradigm, not scheduled-game)
- Backend services that don't render or wire up master-actions
