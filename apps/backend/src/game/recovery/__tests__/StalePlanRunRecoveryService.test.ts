/**
 * Unit tests for StalePlanRunRecoveryService (2026-05-09).
 *
 * Strategy: stub-pool that records SQL fragments and returns canned rows
 * per query. Same pattern as `Game1RecoveryService.test.ts` so the two
 * services read consistently.
 *
 * Coverage:
 *   ✓ idempotent run with no stale rows returns {0, 0}
 *   ✓ stale plan-runs are transitioned to 'finished'
 *   ✓ stuck scheduled-games are transitioned to 'cancelled'
 *   ✓ both kinds cleared in single transaction (BEGIN+COMMIT seen)
 *   ✓ ROLLBACK on error
 *   ✓ audit-event written with full snapshot
 *   ✓ audit-failure does NOT block recovery
 *   ✓ INVALID_INPUT for missing hallId
 *   ✓ INVALID_INPUT for missing actor.userId
 *   ✓ INVALID_INPUT for invalid actor.role
 *   ✓ INVALID_CONFIG for bad schema-name
 *   ✓ stop_reason includes sanitized actor-id
 *   ✓ race-loser (UPDATE returns 0 rows) is gracefully skipped
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../../errors/DomainError.js";
import { StalePlanRunRecoveryService } from "../StalePlanRunRecoveryService.js";
import type { MasterActor } from "../../Game1MasterControlService.js";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  /** Match returns true if this response should be returned for the SQL. */
  match: (sql: string) => boolean;
  rows: unknown[];
  /** Optional — defaults to rows.length. */
  rowCount?: number;
  /** Optional — when set, throw this error on match. */
  throws?: Error;
}

interface StubClient {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: { connect: () => Promise<StubClient> };
  queries: RecordedQuery[];
  releaseCount: number;
} {
  const queries: RecordedQuery[] = [];
  let released = 0;
  // We use shift() so each response is consumed in order — same as
  // Game1RecoveryService.test.ts pattern. Match-fn is still required
  // because the order is per-test-case but multiple SELECT/UPDATE
  // queries may match the same fragment.
  const remaining = responses.slice();

  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i]!;
      if (r.match(sql)) {
        remaining.splice(i, 1);
        if (r.throws) throw r.throws;
        return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };

  return {
    pool: {
      connect: async (): Promise<StubClient> => ({
        query,
        release: () => {
          released += 1;
        },
      }),
    },
    queries,
    get releaseCount(): number {
      return released;
    },
  };
}

const HALL_ID = "11111111-1111-1111-1111-111111111111";

const ACTOR: MasterActor = {
  userId: "user-master-1",
  hallId: HALL_ID,
  role: "AGENT",
};

// Fixed clock returning a known business-date in Oslo-tz.
const FIXED_NOW = new Date("2026-05-09T15:00:00.000Z");
const fixedClock = (): Date => FIXED_NOW;

interface PlanRunRowFixture {
  id: string;
  plan_id: string;
  business_date: string;
  status: string;
  current_position: number;
}

interface ScheduledGameRowFixture {
  id: string;
  status: string;
  scheduled_start_time: Date;
  scheduled_end_time: Date;
  sub_game_name: string;
  group_hall_id: string;
}

function planRunRow(
  overrides: Partial<PlanRunRowFixture> = {},
): PlanRunRowFixture {
  return {
    id: "run-yesterday-1",
    plan_id: "plan-1",
    business_date: "2026-05-08",
    status: "running",
    current_position: 3,
    ...overrides,
  };
}

function scheduledGameRow(
  overrides: Partial<ScheduledGameRowFixture> = {},
): ScheduledGameRowFixture {
  return {
    id: "game-stuck-1",
    status: "running",
    scheduled_start_time: new Date("2026-05-07T15:00:00.000Z"),
    scheduled_end_time: new Date("2026-05-07T17:00:00.000Z"),
    sub_game_name: "Bingo",
    group_hall_id: "grp-1",
    ...overrides,
  };
}

// ── Construction ─────────────────────────────────────────────────────────

test("recover-stale: construction throws on invalid schema", () => {
  const { pool } = createStubPool();
  assert.throws(
    () =>
      new StalePlanRunRecoveryService({
        pool: pool as never,
        schema: "drop;",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

test("recover-stale: forTesting helper bypasses pool-check", () => {
  const { pool } = createStubPool();
  const svc = StalePlanRunRecoveryService.forTesting({
    pool: pool as never,
  });
  assert.ok(svc instanceof StalePlanRunRecoveryService);
});

// ── Input validation ─────────────────────────────────────────────────────

test("recover-stale: throws INVALID_INPUT when hallId is missing", async () => {
  const { pool } = createStubPool();
  const svc = new StalePlanRunRecoveryService({ pool: pool as never });
  await assert.rejects(
    () =>
      svc.recoverStaleForHall({
        actor: ACTOR,
        hallId: "",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("recover-stale: throws INVALID_INPUT when actor.userId is missing", async () => {
  const { pool } = createStubPool();
  const svc = new StalePlanRunRecoveryService({ pool: pool as never });
  await assert.rejects(
    () =>
      svc.recoverStaleForHall({
        actor: { ...ACTOR, userId: "" },
        hallId: HALL_ID,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("recover-stale: throws INVALID_INPUT when actor.role is invalid", async () => {
  const { pool } = createStubPool();
  const svc = new StalePlanRunRecoveryService({ pool: pool as never });
  await assert.rejects(
    () =>
      svc.recoverStaleForHall({
        actor: { ...ACTOR, role: "PLAYER" as never },
        hallId: HALL_ID,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

// ── Happy path: idempotent / no-op ───────────────────────────────────────

test("recover-stale: returns 0/0 when no stale state exists", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("FROM ") &&
        s.includes("app_game_plan_run") &&
        s.includes("FOR UPDATE"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM ") &&
        s.includes("app_game1_scheduled_games") &&
        s.includes("FOR UPDATE"),
      rows: [],
    },
    { match: (s) => s.includes("COMMIT"), rows: [] },
  ]);

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    clock: fixedClock,
  });

  const result = await svc.recoverStaleForHall({
    actor: ACTOR,
    hallId: HALL_ID,
  });

  assert.equal(result.planRunsCleared, 0);
  assert.equal(result.scheduledGamesCleared, 0);
  assert.equal(result.clearedPlanRuns.length, 0);
  assert.equal(result.clearedScheduledGames.length, 0);
  assert.equal(result.hallId, HALL_ID);
  assert.equal(result.todayBusinessDate, "2026-05-09");

  // BEGIN, SELECT plan_run, SELECT scheduled_game, COMMIT — exactly 4 queries.
  assert.equal(queries.length, 4);
  assert.ok(queries[0]!.sql.includes("BEGIN"));
  assert.ok(queries[3]!.sql.includes("COMMIT"));
});

// ── Plan-run cleanup ─────────────────────────────────────────────────────

test("recover-stale: transitions stale plan-runs to finished", async () => {
  const stalePlan = planRunRow({
    id: "run-yesterday-1",
    business_date: "2026-05-08",
    status: "running",
    current_position: 5,
  });

  const { pool, queries } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [stalePlan],
    },
    {
      match: (s) =>
        s.includes("UPDATE ") &&
        s.includes("app_game_plan_run") &&
        s.includes("RETURNING id"),
      rows: [{ id: "run-yesterday-1" }],
    },
    {
      match: (s) =>
        s.includes("app_game1_scheduled_games") && s.includes("FOR UPDATE"),
      rows: [],
    },
    { match: (s) => s.includes("COMMIT"), rows: [] },
  ]);

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    clock: fixedClock,
  });

  const result = await svc.recoverStaleForHall({
    actor: ACTOR,
    hallId: HALL_ID,
  });

  assert.equal(result.planRunsCleared, 1);
  assert.equal(result.scheduledGamesCleared, 0);
  assert.equal(result.clearedPlanRuns.length, 1);
  assert.equal(result.clearedPlanRuns[0]!.id, "run-yesterday-1");
  assert.equal(result.clearedPlanRuns[0]!.businessDate, "2026-05-08");
  assert.equal(result.clearedPlanRuns[0]!.currentPosition, 5);

  // Verify SQL includes 'finished' transition.
  const updateQuery = queries.find(
    (q) =>
      q.sql.includes("UPDATE ") &&
      q.sql.includes("app_game_plan_run") &&
      q.sql.includes("'finished'"),
  );
  assert.ok(updateQuery, "Expected UPDATE app_game_plan_run SET status='finished'");
});

test("recover-stale: race-loser (UPDATE returns 0 rows) is dropped", async () => {
  const stalePlan = planRunRow();

  const { pool } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [stalePlan],
    },
    {
      // UPDATE returns no rows — race-loser.
      match: (s) =>
        s.includes("UPDATE ") && s.includes("app_game_plan_run"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_scheduled_games") && s.includes("FOR UPDATE"),
      rows: [],
    },
    { match: (s) => s.includes("COMMIT"), rows: [] },
  ]);

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    clock: fixedClock,
  });

  const result = await svc.recoverStaleForHall({
    actor: ACTOR,
    hallId: HALL_ID,
  });

  // Race-loser is silently dropped from the snapshot.
  assert.equal(result.planRunsCleared, 0);
  assert.equal(result.clearedPlanRuns.length, 0);
});

// ── Scheduled-game cleanup ───────────────────────────────────────────────

test("recover-stale: transitions stuck scheduled-games to cancelled", async () => {
  const stuckGame = scheduledGameRow({
    id: "game-stuck-1",
    sub_game_name: "Trafikklys",
    group_hall_id: "grp-1",
  });

  const { pool, queries } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_scheduled_games") && s.includes("FOR UPDATE"),
      rows: [stuckGame],
    },
    {
      match: (s) =>
        s.includes("UPDATE ") &&
        s.includes("app_game1_scheduled_games") &&
        s.includes("RETURNING id"),
      rows: [{ id: "game-stuck-1" }],
    },
    { match: (s) => s.includes("COMMIT"), rows: [] },
  ]);

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    clock: fixedClock,
  });

  const result = await svc.recoverStaleForHall({
    actor: ACTOR,
    hallId: HALL_ID,
  });

  assert.equal(result.planRunsCleared, 0);
  assert.equal(result.scheduledGamesCleared, 1);
  assert.equal(result.clearedScheduledGames[0]!.id, "game-stuck-1");
  assert.equal(result.clearedScheduledGames[0]!.subGameName, "Trafikklys");
  assert.equal(result.clearedScheduledGames[0]!.groupHallId, "grp-1");

  // Verify SQL includes 'cancelled' transition + sanitized stop_reason.
  const updateQuery = queries.find(
    (q) =>
      q.sql.includes("UPDATE ") &&
      q.sql.includes("app_game1_scheduled_games") &&
      q.sql.includes("'cancelled'"),
  );
  assert.ok(updateQuery, "Expected UPDATE app_game1_scheduled_games SET status='cancelled'");
  // params: [id, 'SYSTEM', stop_reason]
  assert.equal(updateQuery!.params.length, 3);
  assert.equal(updateQuery!.params[1], "SYSTEM");
  assert.match(
    String(updateQuery!.params[2]),
    /^stale_recovery_user-master-1$/,
  );
});

test("recover-stale: stop_reason sanitizes actor.userId for safety", async () => {
  const actorWithSpecialChars: MasterActor = {
    ...ACTOR,
    userId: "user@hall.com'; DROP TABLE--",
  };
  const stuckGame = scheduledGameRow();

  const { pool, queries } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_scheduled_games") && s.includes("FOR UPDATE"),
      rows: [stuckGame],
    },
    {
      match: (s) =>
        s.includes("UPDATE ") && s.includes("app_game1_scheduled_games"),
      rows: [{ id: "game-stuck-1" }],
    },
    { match: (s) => s.includes("COMMIT"), rows: [] },
  ]);

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    clock: fixedClock,
  });

  await svc.recoverStaleForHall({
    actor: actorWithSpecialChars,
    hallId: HALL_ID,
  });

  const updateQuery = queries.find(
    (q) =>
      q.sql.includes("UPDATE ") && q.sql.includes("app_game1_scheduled_games"),
  );
  // Should strip everything except [a-zA-Z0-9_-].
  assert.equal(
    updateQuery!.params[2],
    "stale_recovery_user_hall_com___DROP_TABLE--",
  );
});

// ── Combined cleanup + audit-log ─────────────────────────────────────────

test("recover-stale: writes audit-event with full snapshot", async () => {
  const stalePlan = planRunRow();
  const stuckGame = scheduledGameRow();

  const { pool } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [stalePlan],
    },
    {
      match: (s) =>
        s.includes("UPDATE ") && s.includes("app_game_plan_run"),
      rows: [{ id: stalePlan.id }],
    },
    {
      match: (s) =>
        s.includes("app_game1_scheduled_games") && s.includes("FOR UPDATE"),
      rows: [stuckGame],
    },
    {
      match: (s) =>
        s.includes("UPDATE ") && s.includes("app_game1_scheduled_games"),
      rows: [{ id: stuckGame.id }],
    },
    { match: (s) => s.includes("COMMIT"), rows: [] },
  ]);

  const captured: Array<{ action: string; details: Record<string, unknown> }> =
    [];
  const auditStub = {
    record: async (input: {
      action: string;
      details: Record<string, unknown>;
    }): Promise<void> => {
      captured.push({ action: input.action, details: input.details });
    },
  };

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    auditLogService: auditStub as never,
    clock: fixedClock,
  });

  const result = await svc.recoverStaleForHall({
    actor: ACTOR,
    hallId: HALL_ID,
  });

  assert.equal(result.planRunsCleared, 1);
  assert.equal(result.scheduledGamesCleared, 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.action, "spill1.master.recover_stale_plan_run");
  assert.equal(captured[0]!.details["hallId"], HALL_ID);
  assert.equal(captured[0]!.details["planRunsCleared"], 1);
  assert.equal(captured[0]!.details["scheduledGamesCleared"], 1);
  assert.equal(captured[0]!.details["todayBusinessDate"], "2026-05-09");
  assert.ok(Array.isArray(captured[0]!.details["clearedPlanRuns"]));
  assert.ok(Array.isArray(captured[0]!.details["clearedScheduledGames"]));
});

test("recover-stale: audit-failure does NOT block recovery", async () => {
  const stalePlan = planRunRow();
  const { pool } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [stalePlan],
    },
    {
      match: (s) =>
        s.includes("UPDATE ") && s.includes("app_game_plan_run"),
      rows: [{ id: stalePlan.id }],
    },
    {
      match: (s) =>
        s.includes("app_game1_scheduled_games") && s.includes("FOR UPDATE"),
      rows: [],
    },
    { match: (s) => s.includes("COMMIT"), rows: [] },
  ]);

  const auditStub = {
    record: async (): Promise<void> => {
      throw new Error("audit DB unreachable");
    },
  };

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    auditLogService: auditStub as never,
    clock: fixedClock,
  });

  // Should NOT throw — audit failure is logged but suppressed.
  const result = await svc.recoverStaleForHall({
    actor: ACTOR,
    hallId: HALL_ID,
  });

  assert.equal(result.planRunsCleared, 1);
});

// ── Transaction safety ──────────────────────────────────────────────────

test("recover-stale: ROLLBACK is called on error during query", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [],
      throws: new Error("simulated DB outage"),
    },
    { match: (s) => s.includes("ROLLBACK"), rows: [] },
  ]);

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    clock: fixedClock,
  });

  await assert.rejects(
    () =>
      svc.recoverStaleForHall({
        actor: ACTOR,
        hallId: HALL_ID,
      }),
    /simulated DB outage/,
  );

  // Verify ROLLBACK was attempted.
  const rollback = queries.find((q) => q.sql.includes("ROLLBACK"));
  assert.ok(rollback, "Expected ROLLBACK to be called on error");
});

test("recover-stale: client.release() is always called (even on error)", async () => {
  const stub = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [],
      throws: new Error("simulated DB outage"),
    },
    { match: (s) => s.includes("ROLLBACK"), rows: [] },
  ]);

  const svc = new StalePlanRunRecoveryService({
    pool: stub.pool as never,
    clock: fixedClock,
  });

  await assert.rejects(() =>
    svc.recoverStaleForHall({ actor: ACTOR, hallId: HALL_ID }),
  );

  assert.equal(stub.releaseCount, 1, "client.release() must be called");
});

// ── No-audit path ────────────────────────────────────────────────────────

test("recover-stale: works with no auditLogService", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_scheduled_games") && s.includes("FOR UPDATE"),
      rows: [],
    },
    { match: (s) => s.includes("COMMIT"), rows: [] },
  ]);

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    clock: fixedClock,
    // auditLogService omitted
  });

  const result = await svc.recoverStaleForHall({
    actor: ACTOR,
    hallId: HALL_ID,
  });

  assert.equal(result.planRunsCleared, 0);
});

// ── setAuditLogService ──────────────────────────────────────────────────

test("recover-stale: setAuditLogService rebinds dep at runtime", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.includes("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game_plan_run") && s.includes("FOR UPDATE"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_scheduled_games") && s.includes("FOR UPDATE"),
      rows: [],
    },
    { match: (s) => s.includes("COMMIT"), rows: [] },
  ]);

  const captured: Array<{ action: string }> = [];
  const auditStub = {
    record: async (input: { action: string }): Promise<void> => {
      captured.push({ action: input.action });
    },
  };

  const svc = new StalePlanRunRecoveryService({
    pool: pool as never,
    clock: fixedClock,
  });
  svc.setAuditLogService(auditStub as never);

  await svc.recoverStaleForHall({
    actor: ACTOR,
    hallId: HALL_ID,
  });

  // No-op recovery still emits an audit event for traceability.
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.action, "spill1.master.recover_stale_plan_run");
});
