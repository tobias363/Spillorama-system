/**
 * Game1LobbyService.tryReconcileTerminalScheduledGame — unit-tests (I16, F-02).
 *
 * Tester auto-reconcile av stuck state mellom plan-run og scheduled-game.
 * Dekker:
 *
 *   1. Stuck state @ siste position: run='running' + scheduledGame='completed'
 *      → auto-reconciled til run='finished', response viser finished-state.
 *   2. Stuck state @ ikke-siste position: run='running' + scheduledGame=
 *      'completed' midt i plan → run forblir 'running', scheduledGame
 *      skjules fra response (overallStatus='idle', scheduledGameId=null).
 *   3. Normal state: run='running' + scheduledGame='running' → no-op.
 *   4. All-finished state: run='finished' → no-op (idempotent — engaged
 *      via existing finished-path before reconcile).
 *   5. Paused state: run='paused' + terminal scheduledGame → IKKE auto-
 *      reconciled (master må explicit resume/stop).
 *   6. DB-error during finish: planRunService.finish kaster → fail-safe
 *      (lobby-poll fortsetter, scheduledGame skjules midlertidig).
 *   7. Cancelled status: run='running' + scheduledGame='cancelled' → reconciled.
 *   8. Performance: reconcile-pathen legger < 50ms til lobby-poll.
 *
 * Tester bruker Object.create-pattern + stub-pool + stub-services i samme
 * stil som `Game1LobbyService.test.ts`, med samme stub-data og helpers
 * inlinet for selvstendighet (tester skal kunne kjøres uavhengig av
 * eksisterende test-fil).
 *
 * Ingen Postgres — alle interaksjoner stubes.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Game1LobbyService } from "../Game1LobbyService.js";
import { GamePlanService } from "../GamePlanService.js";
import { GamePlanRunService } from "../GamePlanRunService.js";
import { GameCatalogService } from "../GameCatalogService.js";
import { DomainError } from "../../errors/DomainError.js";
import type {
  GamePlan,
  GamePlanWithItems,
  GamePlanRun,
} from "../gamePlan.types.js";
import type { GameCatalogEntry } from "../gameCatalog.types.js";

// ── helpers ──────────────────────────────────────────────────────────────

function makeCatalogEntry(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  return {
    id: "gc-bingo",
    slug: "bingo",
    displayName: "Bingo",
    description: null,
    rules: {},
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 100000 },
    },
    prizeMultiplierMode: "auto",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    ...overrides,
  };
}

function makePlan(
  overrides: Partial<GamePlan> = {},
  items: { gameCatalogId: string; catalogEntry: GameCatalogEntry }[] = [
    { gameCatalogId: "gc-bingo", catalogEntry: makeCatalogEntry() },
    {
      gameCatalogId: "gc-jackpot",
      catalogEntry: makeCatalogEntry({
        id: "gc-jackpot",
        slug: "jackpot",
        displayName: "Jackpot",
      }),
    },
  ],
): GamePlanWithItems {
  return {
    id: "gp-1",
    name: "Pilot-spilleplan",
    description: null,
    hallId: "hall-1",
    groupOfHallsId: null,
    weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    startTime: "11:00",
    endTime: "21:00",
    isActive: true,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    items: items.map((it, idx) => ({
      id: `item-${idx + 1}`,
      planId: "gp-1",
      position: idx + 1,
      gameCatalogId: it.gameCatalogId,
      bonusGameOverride: null,
      notes: null,
      createdAt: "2026-05-07T12:00:00Z",
      catalogEntry: it.catalogEntry,
    })),
    ...overrides,
  };
}

function makeRun(overrides: Partial<GamePlanRun> = {}): GamePlanRun {
  return {
    id: "run-1",
    planId: "gp-1",
    hallId: "hall-1",
    businessDate: "2026-05-08",
    currentPosition: 1,
    status: "running",
    jackpotOverrides: {},
    startedAt: "2026-05-08T11:00:00Z",
    finishedAt: null,
    masterUserId: "u-master",
    createdAt: "2026-05-08T11:00:00Z",
    updatedAt: "2026-05-08T11:00:00Z",
    ...overrides,
  };
}

function stubCatalogService(): GameCatalogService {
  const svc = Object.create(GameCatalogService.prototype) as GameCatalogService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  return svc;
}

function stubPlanService(plans: GamePlanWithItems[]): GamePlanService {
  const svc = Object.create(GamePlanService.prototype) as GamePlanService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { catalogService: GameCatalogService }).catalogService =
    stubCatalogService();
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  (svc as unknown as {
    list: (filter: {
      hallId?: string;
      groupOfHallsIds?: string[];
      isActive?: boolean;
    }) => Promise<GamePlan[]>;
  }).list = async (filter) => {
    return plans.filter((p) => {
      if (filter.isActive !== undefined && p.isActive !== filter.isActive) {
        return false;
      }
      const matchesHall =
        filter.hallId !== undefined && p.hallId === filter.hallId;
      const matchesGroup =
        Array.isArray(filter.groupOfHallsIds) &&
        p.groupOfHallsId !== null &&
        filter.groupOfHallsIds.includes(p.groupOfHallsId);
      if (filter.hallId === undefined && !filter.groupOfHallsIds) return true;
      return matchesHall || matchesGroup;
    });
  };
  (svc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => plans.find((p) => p.id === id) ?? null;
  return svc;
}

interface FinishCall {
  hallId: string;
  businessDate: string | Date;
  masterUserId: string;
}

function stubRunService(opts: {
  run: GamePlanRun | null;
  finishImpl?: (call: FinishCall) => Promise<GamePlanRun>;
  finishError?: Error;
}): { service: GamePlanRunService; finishCalls: FinishCall[] } {
  const finishCalls: FinishCall[] = [];
  const svc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as {
    findForDay: (
      hallId: string,
      businessDate: string | Date,
    ) => Promise<GamePlanRun | null>;
  }).findForDay = async () => opts.run;
  (svc as unknown as {
    finish: (
      hallId: string,
      businessDate: string | Date,
      masterUserId: string,
    ) => Promise<GamePlanRun>;
  }).finish = async (hallId, businessDate, masterUserId) => {
    const call = { hallId, businessDate, masterUserId };
    finishCalls.push(call);
    if (opts.finishError) {
      throw opts.finishError;
    }
    if (opts.finishImpl) {
      return opts.finishImpl(call);
    }
    if (!opts.run) {
      throw new DomainError("GAME_PLAN_RUN_NOT_FOUND", "no run");
    }
    return { ...opts.run, status: "finished" };
  };
  return { service: svc, finishCalls };
}

interface ScheduledGameRow {
  id: string;
  status: string;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  actual_start_time: string | null;
  catalog_entry_id: string | null;
}

interface QueryRecord {
  sql: string;
  params: unknown[] | undefined;
}

function makeLobbyService(opts: {
  plans: GamePlanWithItems[];
  run: GamePlanRun | null;
  scheduledGame?: ScheduledGameRow | null;
  goHIds?: string[];
  finishImpl?: (call: FinishCall) => Promise<GamePlanRun>;
  finishError?: Error;
}): {
  service: Game1LobbyService;
  queries: QueryRecord[];
  finishCalls: FinishCall[];
} {
  const queries: QueryRecord[] = [];
  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });
      if (/app_hall_group_members/i.test(sql)) {
        return { rows: (opts.goHIds ?? []).map((g) => ({ group_id: g })) };
      }
      if (/app_game1_scheduled_games/i.test(sql)) {
        if (opts.scheduledGame) {
          return { rows: [opts.scheduledGame] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const planSvc = stubPlanService(opts.plans);
  const { service: runSvc, finishCalls } = stubRunService({
    run: opts.run,
    finishImpl: opts.finishImpl,
    finishError: opts.finishError,
  });
  const svc = Game1LobbyService.forTesting({
    pool: stubPool as unknown as import("pg").Pool,
    schema: "public",
    planService: planSvc,
    planRunService: runSvc,
  });
  return { service: svc, queries, finishCalls };
}

/** 14:00 Oslo on Friday 2026-05-08 (within plan opening 11:00-21:00). */
function fridayAt1400Oslo(): Date {
  return new Date("2026-05-08T12:00:00Z");
}

// ── tests ────────────────────────────────────────────────────────────────

test("reconcile: stuck state @ last position auto-finishes plan-run", async () => {
  // Plan has 2 positions; run is at position 2 (last); scheduled-game
  // for position 2 is 'completed' → should auto-finish.
  const plan = makePlan();
  const run = makeRun({ currentPosition: 2, status: "running" });
  const scheduledGame: ScheduledGameRow = {
    id: "sg-completed",
    status: "completed",
    scheduled_start_time: "2026-05-08T11:30:00Z",
    scheduled_end_time: "2026-05-08T12:00:00Z",
    actual_start_time: "2026-05-08T11:30:00Z",
    catalog_entry_id: "gc-jackpot",
  };
  const { service, finishCalls } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.runStatus, "finished");
  assert.equal(state.overallStatus, "finished");
  assert.equal(state.nextScheduledGame, null);
  assert.equal(finishCalls.length, 1, "finish should be called once");
  assert.equal(finishCalls[0].hallId, "hall-1");
  assert.equal(
    finishCalls[0].masterUserId,
    "system:lobby-auto-reconcile",
    "audit-actor should mark auto-reconcile",
  );
});

test("reconcile: stuck state @ non-last position hides scheduledGame but keeps run='running'", async () => {
  // Plan has 2 positions; run is at position 1 (NOT last); scheduled-game
  // for position 1 is 'completed' → should hide scheduled-game from
  // response but NOT auto-finish (master must advance).
  const plan = makePlan();
  const run = makeRun({ currentPosition: 1, status: "running" });
  const scheduledGame: ScheduledGameRow = {
    id: "sg-completed",
    status: "completed",
    scheduled_start_time: "2026-05-08T11:30:00Z",
    scheduled_end_time: "2026-05-08T12:00:00Z",
    actual_start_time: "2026-05-08T11:30:00Z",
    catalog_entry_id: "gc-bingo",
  };
  const { service, finishCalls } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.runStatus, "running", "plan-run stays running");
  assert.equal(state.overallStatus, "idle", "lobby reports idle (waiting)");
  assert.notEqual(state.nextScheduledGame, null);
  assert.equal(
    state.nextScheduledGame?.scheduledGameId,
    null,
    "scheduledGameId hidden so client doesn't join terminal game",
  );
  assert.equal(state.nextScheduledGame?.status, "idle");
  assert.equal(finishCalls.length, 0, "finish should NOT be called");
});

test("reconcile: normal running state is no-op", async () => {
  // run='running' + scheduledGame='running' → no reconcile, normal path.
  const plan = makePlan();
  const run = makeRun({ currentPosition: 1, status: "running" });
  const scheduledGame: ScheduledGameRow = {
    id: "sg-running",
    status: "running",
    scheduled_start_time: "2026-05-08T11:30:00Z",
    scheduled_end_time: "2026-05-08T12:00:00Z",
    actual_start_time: "2026-05-08T11:30:00Z",
    catalog_entry_id: "gc-bingo",
  };
  const { service, finishCalls } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.runStatus, "running");
  assert.equal(state.overallStatus, "running");
  assert.equal(state.nextScheduledGame?.scheduledGameId, "sg-running");
  assert.equal(state.nextScheduledGame?.status, "running");
  assert.equal(finishCalls.length, 0, "finish should NOT be called");
});

test("reconcile: already-finished run is no-op (idempotent via finished-path)", async () => {
  // run is already 'finished' → existing finished-handler returns first,
  // reconcile never reached.
  const plan = makePlan();
  const run = makeRun({
    currentPosition: 2,
    status: "finished",
    finishedAt: "2026-05-08T12:30:00Z",
  });
  const scheduledGame: ScheduledGameRow = {
    id: "sg-completed",
    status: "completed",
    scheduled_start_time: "2026-05-08T11:30:00Z",
    scheduled_end_time: "2026-05-08T12:00:00Z",
    actual_start_time: "2026-05-08T11:30:00Z",
    catalog_entry_id: "gc-jackpot",
  };
  const { service, finishCalls } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.runStatus, "finished");
  assert.equal(state.overallStatus, "finished");
  assert.equal(state.nextScheduledGame, null);
  assert.equal(finishCalls.length, 0, "finish NOT called — already finished");
});

test("reconcile: paused state is preserved (master must resume/stop explicitly)", async () => {
  // run='paused' + scheduledGame='cancelled' → NOT auto-reconciled.
  // Master has paused intentionally; reconcile only fires on 'running'.
  const plan = makePlan();
  const run = makeRun({ currentPosition: 1, status: "paused" });
  const scheduledGame: ScheduledGameRow = {
    id: "sg-cancelled",
    status: "cancelled",
    scheduled_start_time: "2026-05-08T11:30:00Z",
    scheduled_end_time: "2026-05-08T12:00:00Z",
    actual_start_time: "2026-05-08T11:30:00Z",
    catalog_entry_id: "gc-bingo",
  };
  const { service, finishCalls } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.runStatus, "paused");
  // scheduledGame.status='cancelled' maps to 'idle' via mapScheduledGameStatus,
  // but engineStatus is overridden by `else if (run.status === 'paused')` if
  // scheduledGame is null. Since scheduledGame is non-null and NOT hidden by
  // reconcile (run.status='paused' bails out), mapScheduledGameStatus runs.
  assert.equal(
    state.overallStatus,
    "idle",
    "paused run + cancelled sched maps to idle (cancelled is not in mapScheduledGameStatus whitelist)",
  );
  assert.equal(
    state.nextScheduledGame?.scheduledGameId,
    "sg-cancelled",
    "scheduledGameId still exposed — reconcile only fires on running",
  );
  assert.equal(finishCalls.length, 0, "finish NOT called for paused run");
});

test("reconcile: finish-error is fail-safe — lobby continues, scheduledGame hidden", async () => {
  // last-position + terminal scheduled-game + finish throws → reconcile
  // catches, returns hideScheduledGame=true so client doesn't join
  // terminal game. Next poll retries.
  const plan = makePlan();
  const run = makeRun({ currentPosition: 2, status: "running" });
  const scheduledGame: ScheduledGameRow = {
    id: "sg-completed",
    status: "completed",
    scheduled_start_time: "2026-05-08T11:30:00Z",
    scheduled_end_time: "2026-05-08T12:00:00Z",
    actual_start_time: "2026-05-08T11:30:00Z",
    catalog_entry_id: "gc-jackpot",
  };
  const { service, finishCalls } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
    finishError: new DomainError(
      "GAME_PLAN_RUN_INVALID_TRANSITION",
      "race with concurrent reconcile",
    ),
  });

  // Should NOT throw — reconcile is fail-safe.
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.runStatus, "running", "run unchanged (finish failed)");
  assert.equal(state.overallStatus, "idle", "lobby reports idle gracefully");
  assert.equal(
    state.nextScheduledGame?.scheduledGameId,
    null,
    "scheduledGameId hidden — client retries on next poll",
  );
  assert.equal(finishCalls.length, 1, "finish was attempted once");
});

test("reconcile: cancelled scheduledGame triggers same auto-finish path", async () => {
  // Same as scenario 1 but with status='cancelled' instead of 'completed'.
  // Both are in TERMINAL_SCHEDULED_GAME_STATUSES.
  const plan = makePlan();
  const run = makeRun({ currentPosition: 2, status: "running" });
  const scheduledGame: ScheduledGameRow = {
    id: "sg-cancelled",
    status: "cancelled",
    scheduled_start_time: "2026-05-08T11:30:00Z",
    scheduled_end_time: "2026-05-08T12:00:00Z",
    actual_start_time: "2026-05-08T11:30:00Z",
    catalog_entry_id: "gc-jackpot",
  };
  const { service, finishCalls } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.runStatus, "finished");
  assert.equal(state.overallStatus, "finished");
  assert.equal(finishCalls.length, 1);
});

test("reconcile: non-terminal status ('paused' on scheduledGame) is no-op even when run='running'", async () => {
  // run='running' + scheduledGame='paused' → no reconcile (not terminal).
  const plan = makePlan();
  const run = makeRun({ currentPosition: 1, status: "running" });
  const scheduledGame: ScheduledGameRow = {
    id: "sg-paused",
    status: "paused",
    scheduled_start_time: "2026-05-08T11:30:00Z",
    scheduled_end_time: "2026-05-08T12:00:00Z",
    actual_start_time: "2026-05-08T11:30:00Z",
    catalog_entry_id: "gc-bingo",
  };
  const { service, finishCalls } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.runStatus, "running");
  assert.equal(state.overallStatus, "paused");
  assert.equal(state.nextScheduledGame?.scheduledGameId, "sg-paused");
  assert.equal(finishCalls.length, 0);
});

test("reconcile: latency overhead < 50ms in stuck-state path", async () => {
  // Acceptance criterion: reconcile must not add > 50ms to lobby-poll.
  // Use a fast stub-finish (returns immediately) and measure full
  // getLobbyState() roundtrip. We assert wall-clock < 50ms over 10
  // iterations (median) to filter out single jittery runs.
  const plan = makePlan();
  const scheduledGame: ScheduledGameRow = {
    id: "sg-completed",
    status: "completed",
    scheduled_start_time: "2026-05-08T11:30:00Z",
    scheduled_end_time: "2026-05-08T12:00:00Z",
    actual_start_time: "2026-05-08T11:30:00Z",
    catalog_entry_id: "gc-jackpot",
  };

  const latencies: number[] = [];
  for (let i = 0; i < 10; i++) {
    // Each iteration uses fresh run/service (no carry-over) so finish runs each time.
    const run = makeRun({ currentPosition: 2, status: "running" });
    const { service } = makeLobbyService({
      plans: [plan],
      run,
      scheduledGame,
    });
    const t0 = performance.now();
    await service.getLobbyState("hall-1", fridayAt1400Oslo());
    latencies.push(performance.now() - t0);
  }
  latencies.sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)];
  assert.ok(
    median < 50,
    `median latency ${median.toFixed(2)}ms should be < 50ms (samples: ${latencies.map((n) => n.toFixed(1)).join(",")})`,
  );
});

test("reconcile: idempotent — second call after auto-finish is no-op", async () => {
  // Call 1: stuck state → auto-finish, finish called once.
  // Call 2: stub now returns the finished run → no reconcile, finish not called again.
  const plan = makePlan();
  const initialRun = makeRun({ currentPosition: 2, status: "running" });
  const finishedRun = { ...initialRun, status: "finished" as const };

  // First call: run is 'running'.
  let currentRun: GamePlanRun = initialRun;
  const finishCalls: FinishCall[] = [];

  const planSvc = stubPlanService([plan]);
  const runSvc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (runSvc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (runSvc as unknown as { schema: string }).schema = "public";
  (runSvc as unknown as {
    findForDay: () => Promise<GamePlanRun | null>;
  }).findForDay = async () => currentRun;
  (runSvc as unknown as {
    finish: (
      hallId: string,
      businessDate: string | Date,
      masterUserId: string,
    ) => Promise<GamePlanRun>;
  }).finish = async (hallId, businessDate, masterUserId) => {
    finishCalls.push({ hallId, businessDate, masterUserId });
    currentRun = finishedRun; // mutate visible state for next findForDay()
    return finishedRun;
  };

  const stubPool = {
    async query(textOrConfig: unknown): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      if (/app_hall_group_members/i.test(sql)) return { rows: [] };
      if (/app_game1_scheduled_games/i.test(sql)) {
        return {
          rows: [
            {
              id: "sg-completed",
              status: "completed",
              scheduled_start_time: "2026-05-08T11:30:00Z",
              scheduled_end_time: "2026-05-08T12:00:00Z",
              actual_start_time: "2026-05-08T11:30:00Z",
              catalog_entry_id: "gc-jackpot",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const svc = Game1LobbyService.forTesting({
    pool: stubPool as unknown as import("pg").Pool,
    schema: "public",
    planService: planSvc,
    planRunService: runSvc,
  });

  // Call 1: reconcile fires.
  const state1 = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.equal(state1.runStatus, "finished");
  assert.equal(finishCalls.length, 1);

  // Call 2: run is now 'finished'; we hit the finished-state early-return
  // BEFORE reconcile is reached. finish should NOT be called again.
  const state2 = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.equal(state2.runStatus, "finished");
  assert.equal(
    finishCalls.length,
    1,
    "finish should remain called once across two polls (idempotent)",
  );
});
