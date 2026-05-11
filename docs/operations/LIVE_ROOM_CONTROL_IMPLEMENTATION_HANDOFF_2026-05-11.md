# Live-Room Control Implementation Handoff — 2026-05-11

## Purpose

This document explains the live-room control hardening implemented on
2026-05-11 so the next PM/agent can continue without rediscovering the same
failure modes.

Scope covered:

- Spill 1 scheduled/master room ownership.
- Spill 1 reconnect/resync binding.
- Spill 1 master/ready inter-round recovery.
- Spill 2/3 perpetual-room safety guards.
- Live-room health/control-plane metadata.
- CI/test gates touched by live-room paths.

## Incident Context

Observed production-like local symptom:

```text
[GameBridge] drawNew gap detected (got: 48, expected: 0)
[Game1Controller] plan-advance: f46ae379 -> 2b475df7
ROOM_NOT_FOUND
```

Later admin symptom during local verification:

```text
PLAN_SCHED_STATUS_MISMATCH:
Plan-run.status='running' krangler med scheduled-game.status='completed'
```

The important correction is that this was not a rate-limit issue, not a
per-IP anti-pattern issue, and not a Service Worker cache issue. The live-room
system had multiple places where the client, scheduled-game row, in-memory
engine room, and master plan-run could disagree about which room was
authoritative.

## Decisions Made

1. Spill 1 live rooms are owned by the scheduled/master path.
2. Player clients must not create ad-hoc Spill 1 rooms when a Spill 1 plan is open.
3. Scheduled binding is explicit: `scheduledGameId + roomCode` must match for
   scheduled room state/resume.
4. A completed scheduled-game at the current plan position is normal
   inter-round state, not automatically a fatal mismatch.
5. Master `Start neste spill` and pre-game `Marker Klar` are allowed to move
   the plan forward when the current scheduled-game is terminal.
6. Spill 2/3 perpetual rooms must not be driven by generic `game:start` /
   `game:end`; only the system owner may drive those rooms.
7. Live-room touched paths must remain covered by hard E2E/health checks before
   pilot go/no-go.

## Spill 1 Contract After This Change

### Authoritative Ownership

For Spill 1, the authoritative chain is:

```text
GamePlanRun.currentPosition
  -> app_game1_scheduled_games(plan_run_id, plan_position)
  -> roomCode
  -> BingoEngine in-memory room
  -> client join/resync
```

The player client must follow scheduled state. It should not silently create a
new ad-hoc room if the scheduled/master path exists.

### Valid Scheduled Join Statuses

`game1:join-scheduled` and scheduled room recovery support:

- `purchase_open`
- `ready_to_start`
- `running`
- `paused`

They must not join terminal games:

- `completed`
- `cancelled`

### Inter-Round State

This state is valid:

```text
plan-run.status = running
scheduled-game.status = completed
```

Meaning: the current plan position has finished, and the next master/ready
action should advance the plan to the next position.

This should not create `PLAN_SCHED_STATUS_MISMATCH`.

This state remains suspicious:

```text
plan-run.status = running
scheduled-game.status = cancelled
```

It is terminal, but cancelled may represent an abnormal/manual stop. The code
can still advance past it, but agents should inspect why it was cancelled.

## What Was Implemented

### 1. Spill 1 Client Scheduled Path

Files:

- `packages/game-client/src/games/game1/Game1Controller.ts`
- `packages/game-client/src/games/game1/logic/ReconnectFlow.ts`
- `packages/game-client/src/bridge/GameBridge.ts`
- `packages/game-client/src/net/SpilloramaSocket.ts`
- `packages/game-client/src/games/game1/Game1Controller.autoJoinScheduled.test.ts`

Changes:

- Spill 1 client uses scheduled join when plan metadata is present.
- Resync/reconnect carries `scheduledGameId`.
- `room:state` and resume requests include enough binding information for the
  backend to reject wrong-room state.
- Client-side ad-hoc fallback is narrowed so it does not mask scheduled/master
  mismatches.

Rule for future agents:

- Do not reintroduce a generic client fallback that creates a new live room
  when a scheduled Spill 1 plan is active. That recreates the split-brain room
  bug.

### 2. Backend Scheduled Join and Room Binding

Files:

- `apps/backend/src/sockets/game1ScheduledEvents.ts`
- `apps/backend/src/sockets/gameEvents/roomEvents.ts`
- `apps/backend/src/sockets/gameEvents/gameLifecycleEvents.ts`
- `apps/backend/src/sockets/gameEvents/deps.ts`
- `apps/backend/src/sockets/gameEvents/types.ts`
- `apps/backend/src/sockets/__tests__/game1JoinScheduled.test.ts`
- `apps/backend/src/sockets/__tests__/gameLifecycleEvents.test.ts`
- `apps/backend/src/sockets/__tests__/roomEvents.scheduledBinding.test.ts`
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.ts`
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.test.ts`

Changes:

- `game1:join-scheduled` can recover a missing in-memory BingoEngine room from
  scheduled DB state when safe.
- Scheduled join accepts only non-terminal statuses listed above.
- `room:state` validates scheduled binding when `scheduledGameId` is provided.
- `room:resume` validates scheduled binding as well.
- Wrong `scheduledGameId` / `roomCode` combinations are rejected with clear
  mismatch errors instead of returning stale state.

Rule for future agents:

- If a client reports `ROOM_NOT_FOUND`, do not first add another fallback.
  Check whether scheduled DB row, roomCode, and engine room match.

### 3. MasterActionService Terminal Recovery

File:

- `apps/backend/src/game/MasterActionService.ts`
- `apps/backend/src/game/__tests__/MasterActionService.test.ts`

Implemented recovery:

```text
if plan-run is running
and scheduled-game at currentPosition is completed/cancelled
then advanceToNext before bridge-spawn/start
```

This was added in two paths:

- `start()`:
  - Used by master `Start neste spill`.
  - Auto-advances before engine start.
  - Audit action:
    `spill1.master.start.auto_advance_terminal_position`

- `prepareScheduledGame()`:
  - Used by `Marker Klar` / `Ingen kunder` lazy-spawn flow when no gameId is
    sent.
  - Auto-advances before creating the next ready/scheduled row.
  - Audit action:
    `spill1.master.prepare.auto_advance_terminal_position`

Important behavior:

- If the next plan position requires jackpot setup, recovery throws
  `JACKPOT_SETUP_REQUIRED`.
- If advancing passes the end of the plan, it records `spill1.master.finish`
  and returns/throws finished semantics depending on action path.

Local verification performed:

- Starting from stuck local state:
  - `plan-run.current_position = 1`
  - position 1 scheduled-game was `completed`
- API `POST /api/agent/game1/master/start` advanced to position 2 and started
  new scheduled-game.
- After position 2 completed, API `POST /api/admin/game1/halls/demo-hall-001/ready`
  with no `gameId` advanced to position 3 and marked demo-hall-001 ready.

Rule for future agents:

- Do not manually update `app_game_plan_run.current_position` in DB to "fix"
  this unless recovery itself is broken. The service now owns the forward
  transition.

### 4. GameLobbyAggregator Status Contract

Files:

- `apps/backend/src/game/GameLobbyAggregator.ts`
- `apps/backend/src/game/__tests__/GameLobbyAggregator.test.ts`

Change:

- `plan-run.running + scheduled-game.completed` is treated as consistent
  inter-round state.
- Added test:
  `state=inter-round: plan-run.running med scheduled-game.completed er ikke mismatch`

Still a warning:

- `plan-run.running + scheduled-game.cancelled`

Reason:

- Completed is normal end-of-round.
- Cancelled may be abnormal and should remain visible for operators, while
  still being recoverable by master/ready actions.

Rule for future agents:

- Do not make every terminal scheduled-game a hard mismatch. That blocks normal
  "next game" operation.

### 5. Admin Cash-In/Out UI Behavior

File:

- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`

Changes:

- Tracks lobby warning codes in the local view model.
- `Start neste spill` is enabled for:
  - `purchase_open`
  - `ready_to_start`
  - `completed`
  - `cancelled`
- Hall actions are editable for:
  - `idle`
  - `scheduled`
  - `purchase_open`
  - `ready_to_start`
  - `completed`
  - `cancelled`
- If the displayed scheduled-game is terminal, hall ready/no-customers actions
  send `gameId = null`. This forces backend lazy-spawn/prepare flow instead of
  trying to write ready status onto a completed game.

Why this matters:

- Before this fix, the UI tried to mark ready on a completed scheduled-game and
  backend correctly returned:

```text
GAME_NOT_READY_ELIGIBLE:
Kan kun markere klar for spill i status 'scheduled', 'purchase_open' eller 'ready_to_start'
```

Rule for future agents:

- For terminal scheduled-game UI state, ready/no-customers actions must target
  the next round by omitting `gameId`.

### 6. Live-Room Health / Control Plane

Files:

- `apps/backend/src/routes/publicGameHealth.ts`
- `apps/backend/src/routes/__tests__/publicGameHealth.test.ts`
- `apps/backend/src/game/types.ts`
- `apps/backend/src/index.ts`
- `packages/shared-types/src/game.ts`
- `packages/shared-types/src/schemas/game.ts`

Health endpoint now exposes control-plane metadata including:

- `authority`
- `expectedRoomCode`
- `engineRoomExists`
- `scheduledGameId`
- `currentGameId`
- `drawIndex`
- `schedulerOwner`
- `mismatchStatus`

Example endpoint:

```text
GET /api/games/spill1/health?hallId=demo-hall-001
```

Rule for future agents:

- When diagnosing live-room bugs, capture health output before coding. It now
  contains the exact room authority/mismatch data needed for triage.

### 7. Spill 2/3 Perpetual Room Guards

Files:

- `apps/backend/src/sockets/gameEvents/gameLifecycleEvents.ts`
- `apps/backend/src/sockets/__tests__/gameLifecycleEvents.test.ts`
- `apps/backend/src/util/canonicalRoomCode.ts`
- `apps/backend/src/util/canonicalRoomCode.test.ts`
- `apps/backend/src/boot/bootstrapHallGroupRooms.ts`

Changes:

- Generic `game:start` / `game:end` cannot drive perpetual rooms for Spill 2/3.
- Canonical aliases map to global rooms instead of creating non-canonical rooms.
- This protects:
  - `ROCKET`
  - `MONSTERBINGO`
  - aliases like `game_2`, `tallspill`, `game_3`

Rule for future agents:

- Do not use generic lifecycle events to start/end perpetual rooms. Use the
  system-owner/scheduler path for Spill 2/3.

### 8. CI Gate

File:

- `.github/workflows/e2e-test.yml`

Change:

- Live-room related paths are included in E2E workflow triggering/path filters.

Rule for future agents:

- Any change to live-room socket/client/control paths should keep the golden
  path E2E green before merge.

### 9. Spill 1 Pre-Start Purchases, Ticket Snapshot, and 75-Draw Limit

Files:

- `packages/game-client/src/games/game1/logic/SocketActions.ts`
- `packages/game-client/src/games/game1/logic/SocketActions.test.ts`
- `packages/game-client/src/games/game1/Game1Controller.ts`
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.ts`
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.test.ts`
- `apps/backend/src/game/Game1DrawEngineService.ts`
- `apps/backend/src/game/Game1DrawEngineService.test.ts`

Observed symptom during local test:

```text
Player bought bonger before master started.
UI showed "Forhandskjop: 300 kr".
Running scheduled round showed MyTickets: 0 and MyMarks: 0.
Draw engine stopped at 52/75.
Debug HUD showed room=BINGO_DEMO-PILOT-GOH and scheduledGameId=9ee71c98...
```

Actual root causes:

1. The player buy action still used legacy socket `bet:arm` before scheduled
   start. That created an in-memory/legacy pre-round reservation instead of
   durable `app_game1_ticket_purchases` rows. Scheduled games only assign active
   bonger from the DB purchase path.
2. Scheduled room snapshots returned synthetic `currentGame.tickets = {}` and
   `currentGame.marks = {}` even when DB assignments existed. Reconnect/resync
   could therefore hide active tickets from the client.
3. `DEFAULT_GAME1_MAX_DRAWS` was `52`. Scheduled 75-ball rounds without an
   explicit `ticket_config_json.maxDraws` ended at 52 draws with
   `MAX_DRAWS_REACHED`.

Implemented behavior:

- When a scheduled Spill 1 plan is in `purchase_open` or `ready_to_start`,
  player buy now calls:

```text
POST /api/game1/purchase
```

- The request includes:
  - `scheduledGameId`
  - `buyerUserId`
  - `hallId`
  - `paymentMethod = digital_wallet`
  - `idempotencyKey`
  - scheduled `ticketSpec`
- Legacy socket `bet:arm` remains only as fallback when there is no joinable
  scheduled purchase context.
- Scheduled room snapshots now load `app_game1_ticket_assignments` and map them
  into `currentGame.tickets[playerId]` and `currentGame.marks[playerId]`.
- Default Spill 1 draw limit is now 75 unless a scheduled-game explicitly
  overrides `ticket_config_json.maxDraws`.

Important pricing caveat:

- The current legacy buy-popup config and scheduled DB ticket catalog are not
  identical for large tickets.
- The scheduled REST purchase path intentionally uses DB-catalog-compatible
  prices. Example: large yellow is priced as two small yellow units, because
  the purchase API validates against DB ticket types.
- Future agents should not "fix" this by sending legacy large-ticket pricing
  into `/api/game1/purchase`; that will fail validation. The proper follow-up is
  to unify the ticket catalog used by the buy UI and scheduled purchase API.

Rule for future agents:

- For scheduled Spill 1, durable ticket purchase must happen before engine
  start via `/api/game1/purchase`. If the UI shows pre-purchase but
  `app_game1_ticket_purchases` has no rows for the scheduled game, the player
  will not receive active bonger.
- If draw count stops before 75, inspect `ticket_config_json.maxDraws` and
  `Game1DrawEngineService` before assuming socket disconnect.

## Tests Run In This Session

Commands run and passed:

```bash
npm --prefix packages/shared-types run check -- --pretty false
npm --prefix apps/backend run check -- --pretty false
npm --prefix packages/game-client run check -- --pretty false
npm --prefix apps/admin-web run check -- --pretty false
```

Additional checks after fixing pre-start scheduled purchase and 52-draw stop:

```bash
npm --prefix packages/game-client run check -- --pretty false
npm --prefix apps/backend run check -- --pretty false
LOG_LEVEL=warn npx tsx --test src/game/Game1ScheduledRoomSnapshot.test.ts src/game/Game1DrawEngineService.test.ts
npm --prefix packages/game-client run test -- --run src/games/game1/logic/SocketActions.test.ts
npm run build:games
```

Runtime re-check after admin reported repeated
`GET /api/agent/game1/lobby 500`:

```text
Root cause in local runtime: backend process was not listening on port 4000.
apps/backend/.env has PORT=3000, while admin-web dev proxy expects backend
at http://localhost:4000 when started through scripts/dev/start-all.mjs.
Fix for local manual restart:
PORT=4000 npm --prefix apps/backend run dev
VITE_DEV_BACKEND_URL=http://localhost:4000 npm -w @spillorama/admin-web run dev -- --host ::1 --port 5174
```

Smoke verified after restart:

```text
GET /health on :4000 -> 200
GET /api/agent/game1/lobby through :5174 proxy -> 200
POST /api/admin/game1/halls/demo-hall-001/ready -> ready_to_start scheduled-game f095bbf2...
POST /api/game1/purchase as demo-pilot-spiller-1 -> 200 purchaseId g1p-4490119d...
```

Focused tests run and passed:

```bash
LOG_LEVEL=warn npx tsx --test src/game/__tests__/MasterActionService.test.ts
LOG_LEVEL=warn npx tsx --test src/game/__tests__/GameLobbyAggregator.test.ts src/game/__tests__/MasterActionService.test.ts
```

Earlier focused suites in this hardening branch also passed:

- backend focused tests: 129 pass
- game-client focused tests: 89 pass
- Docker-backed backend E2E: 34 pass
- `git diff --check`

Latest local runtime API verification:

1. Master start advanced terminal position:

```text
POST /api/agent/game1/master/start
-> ok: true
-> scheduledGameId: 8bd9ae02-172d-47d9-a75d-e5bf9a7ffc01
-> plan position advanced to 2
```

2. Ready flow after completed round advanced to next position:

```text
POST /api/admin/game1/halls/demo-hall-001/ready
body: {}
-> ok: true
-> gameId: 9ee71c98-70b7-4387-a98b-3c6642716ce5
-> isReady: true
-> plan position advanced to 3
```

3. Lobby after ready:

```text
currentScheduledGameId: 9ee71c98-70b7-4387-a98b-3c6642716ce5
plan.currentPosition: 3
catalogDisplayName: 5x500
scheduledGame.status: ready_to_start
inconsistencyWarnings: []
```

## How To Diagnose If It Breaks Again

Before changing code, collect all of this:

1. Browser console logs from admin and player.
2. Network request/response for:
   - `/api/agent/game1/lobby`
   - `/api/agent/game1/master/start`
   - `/api/admin/game1/halls/:hallId/ready`
   - socket `game1:join-scheduled`
   - socket `room:state`
3. Backend logs around:
   - `master-action-service`
   - `lobby-aggregator`
   - `game1:join-scheduled`
4. DB snapshot:

```sql
select id, plan_id, hall_id, business_date, current_position, status,
       started_at, finished_at, updated_at
from app_game_plan_run
where hall_id = 'demo-hall-001'
order by updated_at desc;

select id, plan_run_id, plan_position, master_hall_id, room_code, status,
       actual_start_time, actual_end_time, updated_at
from app_game1_scheduled_games
where master_hall_id = 'demo-hall-001'
order by updated_at desc;
```

5. Health snapshot:

```bash
curl -sS 'http://localhost:4000/api/games/spill1/health?hallId=demo-hall-001'
curl -sS 'http://localhost:4000/health/draw-engine'
```

## Expected Local Test Flow Now

For demo master agent:

```text
Admin: http://localhost:5174/admin/#/agent/cashinout
Agent: demo-agent-1@spillorama.no
Password: Spillorama123!
```

Flow:

1. If previous round is `completed`, `Marker Klar` must be clickable.
2. Clicking `Marker Klar` must create/prepare the next scheduled-game and mark
   own hall ready.
3. UI should change button to `Angre Klar`.
4. `Start neste spill` should be clickable by master on `ready_to_start`.
5. Player must join scheduled room, not ad-hoc room.
6. Buying bonger before master start should create active bonger for the
   scheduled game, not only show `Forhandskjop`.
7. Player should receive draws without `ROOM_NOT_FOUND` and without draw gap
   from missing initial state.
8. A 75-ball scheduled round should not stop at 52 unless the game config
   explicitly sets `maxDraws = 52`.

## Do Not Do This

- Do not add another broad refactor before reproducing with console, Network,
  backend log, DB state, and health output.
- Do not reintroduce ad-hoc Spill 1 room creation as a fallback while a plan is
  open.
- Do not hide `ROOM_NOT_FOUND` by retry-looping forever on the client.
- Do not manually reset `app_game_plan_run` as the normal fix. Service recovery
  should advance state.
- Do not treat `running plan + completed scheduled-game` as a fatal mismatch.
- Do not let generic lifecycle socket events start/end Spill 2/3 perpetual rooms.

## Known Remaining Work

This hardening reduces the split-brain room risk, but pilot should still remain
blocked until the full golden path is green:

1. Browser/socket E2E:
   - master start
   - player joins scheduled room
   - player receives at least 3 draws
   - `room:state` resync works
   - no `ROOM_NOT_FOUND`
   - no draw gap
2. Active R2/R3 chaos validation with actual draws and marks greater than 0.
3. R7/R8/R12 validation after the latest live-room changes.
4. Confirm `DEMO_AUTO_MASTER_ENABLED=false` manual master flow versus auto-master
   flow if the old ROOM_NOT_FOUND symptom returns.

## Primary Files To Read Before Further Work

Start here:

- `docs/operations/PM_HANDOFF_2026-05-11_SESSION_END.md`
- `docs/operations/LIVE_ROOM_CONTROL_IMPLEMENTATION_HANDOFF_2026-05-11.md`
- `apps/backend/src/game/MasterActionService.ts`
- `apps/backend/src/game/GameLobbyAggregator.ts`
- `apps/backend/src/sockets/game1ScheduledEvents.ts`
- `apps/backend/src/sockets/gameEvents/roomEvents.ts`
- `packages/game-client/src/games/game1/Game1Controller.ts`
- `packages/game-client/src/games/game1/logic/SocketActions.ts`
- `packages/game-client/src/bridge/GameBridge.ts`
- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`
- `apps/backend/src/routes/publicGameHealth.ts`
- `apps/backend/src/game/Game1DrawEngineService.ts`
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.ts`

If touching these files, run at minimum:

```bash
npm --prefix apps/backend run check -- --pretty false
npm --prefix apps/admin-web run check -- --pretty false
npm --prefix packages/game-client run check -- --pretty false
LOG_LEVEL=warn npx tsx --test src/game/__tests__/GameLobbyAggregator.test.ts src/game/__tests__/MasterActionService.test.ts
LOG_LEVEL=warn npx tsx --test src/game/Game1ScheduledRoomSnapshot.test.ts src/game/Game1DrawEngineService.test.ts
npm --prefix packages/game-client run test -- --run src/games/game1/logic/SocketActions.test.ts
```
