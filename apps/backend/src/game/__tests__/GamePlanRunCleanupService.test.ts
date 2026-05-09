/**
 * Unit-tests for GamePlanRunCleanupService.
 *
 * Verifies the 5 mandated scenarios:
 *   1. 0 stale → 0 cleanups
 *   2. 1 stale running → 1 cleanup
 *   3. 1 stale paused → 1 cleanup
 *   4. 1 dagens running → IKKE cleanup
 *   5. 1 gårsdagens finished → IKKE cleanup
 *
 * Plus:
 *   - audit-event written (when AuditLogService injected)
 *   - hall-scoped cleanup applies hall_id filter
 *   - 42P01 table-missing → soft no-op (boots cleanly on fresh DB)
 *   - inline self-heal hook delegates to cleanupStaleRunsForHall
 *
 * Strategy: emulate the WHERE-filter in-memory by capturing UPDATE SQL
 * + params and returning matching rows. We don't validate exact PG SQL
 * shape — that's covered by the integration test against real Postgres.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import {
  GamePlanRunCleanupService,
  makeInlineCleanupHook,
} from "../GamePlanRunCleanupService.js";
import type { AuditLogInput } from "../../compliance/AuditLogService.js";

// ── Fixture types ────────────────────────────────────────────────────────

interface PlanRunRow {
  id: string;
  plan_id: string;
  hall_id: string;
  business_date: string;
  current_position: number;
  status: string;
  jackpot_overrides_json: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  master_user_id: string | null;
  created_at: string;
  updated_at: string;
}

function row(overrides: Partial<PlanRunRow> & { id: string }): PlanRunRow {
  return {
    id: overrides.id,
    plan_id: overrides.plan_id ?? `plan-${overrides.id}`,
    hall_id: overrides.hall_id ?? "hall-1",
    business_date: overrides.business_date ?? "2026-05-08",
    current_position: overrides.current_position ?? 1,
    status: overrides.status ?? "running",
    jackpot_overrides_json: overrides.jackpot_overrides_json ?? {},
    started_at: overrides.started_at ?? "2026-05-08T11:00:00Z",
    finished_at: overrides.finished_at ?? null,
    master_user_id: overrides.master_user_id ?? "user-1",
    created_at: overrides.created_at ?? "2026-05-08T10:55:00Z",
    updated_at: overrides.updated_at ?? "2026-05-08T11:00:00Z",
  };
}

interface PoolCall {
  sql: string;
  params: unknown[];
}

/**
 * Pool stub that emulates the WHERE-filter from `cleanupStaleRunsInternal`:
 *   - status IN ('running', 'paused')
 *   - business_date < $1::date
 *   - hall_id = $2 (when 2 params)
 *
 * Returns matching rows from `seedRows`. Out-of-band errors (failCode) bubble
 * via standard pg-error shape.
 */
function makePool(
  seedRows: PlanRunRow[],
  opts?: { failCode?: string },
): { pool: Pool; calls: PoolCall[] } {
  const calls: PoolCall[] = [];
  const pool = {
    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: unknown[] = [],
    ): Promise<QueryResult<T>> {
      calls.push({ sql, params });
      if (opts?.failCode) {
        const err = new Error(`pg-error ${opts.failCode}`) as Error & {
          code: string;
        };
        err.code = opts.failCode;
        throw err;
      }
      // Filter the seed by the WHERE-clause semantics.
      const todayKey = String(params[0]);
      const hallFilter = params.length >= 2 ? String(params[1]) : null;
      const matching = seedRows.filter((r) => {
        if (r.status !== "running" && r.status !== "paused") return false;
        if (r.business_date >= todayKey) return false;
        if (hallFilter !== null && r.hall_id !== hallFilter) return false;
        return true;
      });
      return {
        rows: matching as unknown as T[],
        rowCount: matching.length,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as unknown as QueryResult<T>;
    },
  } as unknown as Pool;
  return { pool, calls };
}

interface FakeAuditLog {
  service: { record(input: AuditLogInput): Promise<void> };
  recorded: AuditLogInput[];
}

function makeAuditStub(): FakeAuditLog {
  const recorded: AuditLogInput[] = [];
  return {
    service: {
      async record(input: AuditLogInput) {
        recorded.push(input);
      },
    },
    recorded,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

test("scenario 1: 0 stale → 0 cleanups, no audit", async () => {
  const { pool } = makePool([]);
  const audit = makeAuditStub();
  const svc = new GamePlanRunCleanupService({
    pool,
    auditLogService: audit.service as unknown as never,
  });
  const result = await svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z"));
  assert.equal(result.cleanedCount, 0);
  assert.equal(result.closedRuns.length, 0);
  // Allow microtask drain so any best-effort audit posts settle.
  await new Promise((r) => setImmediate(r));
  assert.equal(audit.recorded.length, 0);
});

test("scenario 2: 1 stale running → 1 cleanup + 1 audit-event", async () => {
  const { pool, calls } = makePool([
    row({ id: "run-stale-1", status: "running", business_date: "2026-05-08" }),
  ]);
  const audit = makeAuditStub();
  const svc = new GamePlanRunCleanupService({
    pool,
    auditLogService: audit.service as unknown as never,
  });
  const result = await svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z"));
  assert.equal(result.cleanedCount, 1);
  assert.equal(result.closedRuns[0]?.id, "run-stale-1");
  assert.equal(result.closedRuns[0]?.previousStatus, "running");
  assert.match(calls[0]!.sql, /WITH stale AS/);
  assert.match(calls[0]!.sql, /status IN \('running', 'paused'\)/);
  assert.match(calls[0]!.sql, /business_date < \$1::date/);
  // Drain audit fire-and-forget queue.
  await new Promise((r) => setImmediate(r));
  assert.equal(audit.recorded.length, 1);
  assert.equal(audit.recorded[0]?.action, "game_plan_run.auto_cleanup");
  assert.equal(audit.recorded[0]?.actorType, "SYSTEM");
  assert.equal(audit.recorded[0]?.resourceId, "run-stale-1");
});

test("scenario 3: 1 stale paused → 1 cleanup", async () => {
  const { pool } = makePool([
    row({ id: "run-paused-1", status: "paused", business_date: "2026-05-08" }),
  ]);
  const svc = new GamePlanRunCleanupService({ pool });
  const result = await svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z"));
  assert.equal(result.cleanedCount, 1);
  assert.equal(result.closedRuns[0]?.previousStatus, "paused");
});

test("scenario 4: 1 dagens running → IKKE cleanup (today's row safe)", async () => {
  const { pool } = makePool([
    row({ id: "run-today", status: "running", business_date: "2026-05-09" }),
  ]);
  const svc = new GamePlanRunCleanupService({ pool });
  const result = await svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z"));
  assert.equal(result.cleanedCount, 0);
});

test("scenario 5: 1 gårsdagens finished → IKKE cleanup (already finished)", async () => {
  const { pool } = makePool([
    row({
      id: "run-finished-yesterday",
      status: "finished",
      business_date: "2026-05-08",
      finished_at: "2026-05-08T22:00:00Z",
    }),
  ]);
  const svc = new GamePlanRunCleanupService({ pool });
  const result = await svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z"));
  assert.equal(result.cleanedCount, 0);
});

test("hall-scoped cleanup: only the requested hall is swept", async () => {
  const { pool, calls } = makePool([
    row({ id: "run-hall1", hall_id: "hall-1", business_date: "2026-05-08" }),
    row({ id: "run-hall2", hall_id: "hall-2", business_date: "2026-05-08" }),
  ]);
  const svc = new GamePlanRunCleanupService({ pool });
  const result = await svc.cleanupStaleRunsForHall(
    "hall-1",
    new Date("2026-05-09T03:00:00Z"),
  );
  assert.equal(result.cleanedCount, 1);
  assert.equal(result.closedRuns[0]?.hallId, "hall-1");
  // SQL must include the hall_id filter clause.
  assert.match(calls[0]!.sql, /AND hall_id = \$2/);
  assert.equal(calls[0]!.params[1], "hall-1");
});

test("hall-scoped cleanup: rejects empty hallId", async () => {
  const { pool } = makePool([]);
  const svc = new GamePlanRunCleanupService({ pool });
  await assert.rejects(
    () => svc.cleanupStaleRunsForHall("", new Date()),
    /hallId is required/,
  );
});

test("inline cleanup hook: delegates to cleanupStaleRunsForHall", async () => {
  const { pool, calls } = makePool([
    row({ id: "run-h1", hall_id: "hall-7", business_date: "2026-05-08" }),
  ]);
  const svc = new GamePlanRunCleanupService({ pool });
  const hook = makeInlineCleanupHook(svc);
  const result = await hook("hall-7", new Date("2026-05-09T03:00:00Z"));
  assert.equal(result.cleanedCount, 1);
  // Verify SQL got hall-filter applied (proves we delegated through the
  // hall-scoped path, not the all-stale path).
  assert.match(calls[0]!.sql, /AND hall_id = \$2/);
});

test("42P01 table missing → soft no-op (fresh DB boot-safe)", async () => {
  const { pool } = makePool([], { failCode: "42P01" });
  const svc = new GamePlanRunCleanupService({ pool });
  const result = await svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z"));
  assert.equal(result.cleanedCount, 0);
  assert.deepEqual(result.closedRuns, []);
});

test("non-42P01 PG error rethrows (no swallowing of unexpected failures)", async () => {
  const { pool } = makePool([], { failCode: "08000" });
  const svc = new GamePlanRunCleanupService({ pool });
  await assert.rejects(
    () => svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z")),
    /pg-error 08000/,
  );
});

test("audit failure does NOT prevent cleanup from succeeding", async () => {
  const { pool } = makePool([
    row({ id: "run-x", status: "running", business_date: "2026-05-08" }),
  ]);
  const failingAudit = {
    async record() {
      throw new Error("audit-store-down");
    },
  };
  const svc = new GamePlanRunCleanupService({
    pool,
    auditLogService: failingAudit as unknown as never,
  });
  const result = await svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z"));
  // Cleanup-status returned successfully — the audit-failure is logged
  // (via void) but does not block the caller.
  assert.equal(result.cleanedCount, 1);
  await new Promise((r) => setImmediate(r));
});

test("setAuditLogService allows post-construction binding", async () => {
  const { pool } = makePool([
    row({ id: "run-y", status: "running", business_date: "2026-05-08" }),
  ]);
  const audit = makeAuditStub();
  const svc = new GamePlanRunCleanupService({ pool });
  // No audit at construction time → cleanup still works
  await svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z"));
  await new Promise((r) => setImmediate(r));
  assert.equal(audit.recorded.length, 0);

  // Bind audit, run again, expect events
  svc.setAuditLogService(audit.service as unknown as never);
  await svc.cleanupAllStale(new Date("2026-05-09T03:00:00Z"));
  await new Promise((r) => setImmediate(r));
  assert.equal(audit.recorded.length, 1);
});
