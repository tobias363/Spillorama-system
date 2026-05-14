/**
 * BUG-A (audit:db `stuck-plan-run` 2026-05-14): unit-tests for
 * GamePlanRunCleanupService.reconcileNaturalEndStuckRuns.
 *
 * Bakgrunn:
 *   Plan-run kan stå `status='running'` etter naturlig runde-end uten at
 *   master-advance trigges. PR #1403 dekket kun manuell master-handling-
 *   trigget reconcile; nightly cron dekker kun gårsdagens stale.
 *   Natural-end-reconcile fyller hullet — poll-job som hver 30s sjekker
 *   for DAGENS stuck plan-runs etter completed scheduled-games.
 *
 * Disse testene verifiserer 8 mandaterte scenarier:
 *   1. Reconcile fyrer når plan-run=running + sched-game=completed + > 30s
 *   2. Reconcile fyrer IKKE når < 30s siden completed.actual_end_time
 *   3. Reconcile fyrer IKKE når sched-game er cancelled (ikke natural-end)
 *   4. Reconcile fyrer IKKE når plan-run er finished/idle/paused
 *   5. Audit-event skrives med korrekt action + reason
 *   6. Idempotent (re-kjøring etter første finish er no-op)
 *   7. PG-feil (42P01) → soft-fail, returnerer { cleanedCount: 0 }
 *   8. Multi-hall: hver hall reconciles uavhengig
 *
 * Strategi: pool-stub emulerer SQL-en's WHERE/HAVING semantikk in-memory.
 * Vi sjekker SQL-shape med regex-match for å verifisere at riktige
 * filter-klausuler er inkludert. Full ende-til-ende-validering dekkes av
 * skip-graceful integration-test mot ekte Postgres (separat fil).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import { GamePlanRunCleanupService } from "../GamePlanRunCleanupService.js";
import type { AuditLogInput } from "../../compliance/AuditLogService.js";

// ── Fixture types ────────────────────────────────────────────────────────

interface PlanRunRow {
  id: string;
  plan_id: string;
  hall_id: string;
  business_date: string;
  current_position: number;
  status: string; // 'running' | 'paused' | 'finished' | 'idle'
  jackpot_overrides_json: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  master_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SchedGameRow {
  id: string;
  plan_run_id: string;
  status:
    | "scheduled"
    | "purchase_open"
    | "ready_to_start"
    | "running"
    | "paused"
    | "completed"
    | "cancelled";
  actual_end_time: string | null;
}

function planRun(overrides: Partial<PlanRunRow> & { id: string }): PlanRunRow {
  return {
    id: overrides.id,
    plan_id: overrides.plan_id ?? `plan-${overrides.id}`,
    hall_id: overrides.hall_id ?? "hall-1",
    business_date: overrides.business_date ?? "2026-05-14",
    current_position: overrides.current_position ?? 1,
    status: overrides.status ?? "running",
    jackpot_overrides_json: overrides.jackpot_overrides_json ?? {},
    started_at: overrides.started_at ?? "2026-05-14T07:00:00Z",
    finished_at: overrides.finished_at ?? null,
    master_user_id: overrides.master_user_id ?? "user-master-1",
    created_at: overrides.created_at ?? "2026-05-14T06:55:00Z",
    updated_at: overrides.updated_at ?? "2026-05-14T07:00:00Z",
  };
}

function schedGame(
  overrides: Partial<SchedGameRow> & { id: string; plan_run_id: string },
): SchedGameRow {
  return {
    id: overrides.id,
    plan_run_id: overrides.plan_run_id,
    status: overrides.status ?? "completed",
    actual_end_time: overrides.actual_end_time ?? "2026-05-14T07:39:31Z",
  };
}

interface PoolCall {
  sql: string;
  params: unknown[];
}

/**
 * Pool-stub som emulerer reconcileNaturalEndStuckRuns-SQL-en:
 *   - INNER JOIN på nyeste completed scheduled-game (med actual_end_time IS
 *     NOT NULL)
 *   - LEFT JOIN aktivt scheduled-games-count
 *   - WHERE plan_run.status='running'
 *   - AND active_count = 0
 *   - AND completed.actual_end_time < now() - threshold
 *
 * Returnerer rader med tilleggsfelter `scheduled_game_id`,
 * `scheduled_game_ended_at`, `stuck_for_seconds` som SQL-spørringen ville
 * produsert.
 */
function makePool(args: {
  planRuns: PlanRunRow[];
  schedGames: SchedGameRow[];
  failCode?: string;
  /** Default Date for "now" — tests overstyrer for predikterbarhet. */
  now?: Date;
}): { pool: Pool; calls: PoolCall[] } {
  const calls: PoolCall[] = [];
  const now = args.now ?? new Date("2026-05-14T08:30:00Z");

  const pool = {
    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: unknown[] = [],
    ): Promise<QueryResult<T>> {
      calls.push({ sql, params });
      if (args.failCode) {
        const err = new Error(`pg-error ${args.failCode}`) as Error & {
          code: string;
        };
        err.code = args.failCode;
        throw err;
      }

      // SQL-en bruker $1 = threshold-ms.
      const thresholdMs = Number(params[0]);
      const matching: Array<{
        run: PlanRunRow;
        schedId: string;
        endedAtIso: string;
        stuckForSeconds: number;
      }> = [];

      for (const run of args.planRuns) {
        if (run.status !== "running") continue;

        // Aktive scheduled-games-count (status IN active-set).
        const activeCount = args.schedGames.filter((sg) => {
          if (sg.plan_run_id !== run.id) return false;
          return (
            sg.status === "scheduled" ||
            sg.status === "purchase_open" ||
            sg.status === "ready_to_start" ||
            sg.status === "running" ||
            sg.status === "paused"
          );
        }).length;
        if (activeCount !== 0) continue;

        // Nyeste completed scheduled-game (med ikke-null actual_end_time).
        const completed = args.schedGames
          .filter(
            (sg) =>
              sg.plan_run_id === run.id &&
              sg.status === "completed" &&
              sg.actual_end_time !== null,
          )
          .sort((a, b) =>
            (b.actual_end_time ?? "").localeCompare(a.actual_end_time ?? ""),
          );
        if (completed.length === 0) continue;
        const newest = completed[0]!;
        const endedAtMs = new Date(newest.actual_end_time!).getTime();
        const stuckForMs = now.getTime() - endedAtMs;
        if (stuckForMs <= thresholdMs) continue;

        matching.push({
          run,
          schedId: newest.id,
          endedAtIso: newest.actual_end_time!,
          stuckForSeconds: Math.floor(stuckForMs / 1000),
        });
      }

      const rows = matching.map((m) => ({
        ...m.run,
        scheduled_game_id: m.schedId,
        scheduled_game_ended_at: m.endedAtIso,
        stuck_for_seconds: m.stuckForSeconds,
      }));

      return {
        rows: rows as unknown as T[],
        rowCount: rows.length,
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

test("scenario 1: stuck plan-run + completed sched > 30s → reconcile fyrer", async () => {
  const now = new Date("2026-05-14T08:30:00Z");
  const { pool, calls } = makePool({
    planRuns: [planRun({ id: "run-1", status: "running" })],
    schedGames: [
      schedGame({
        id: "sched-1",
        plan_run_id: "run-1",
        status: "completed",
        actual_end_time: "2026-05-14T07:39:31Z", // ~50 min siden — > 30s
      }),
    ],
    now,
  });
  const audit = makeAuditStub();
  const svc = new GamePlanRunCleanupService({
    pool,
    auditLogService: audit.service as unknown as never,
  });

  const result = await svc.reconcileNaturalEndStuckRuns(now);

  assert.equal(result.cleanedCount, 1);
  assert.equal(result.closedRuns[0]?.id, "run-1");
  assert.equal(result.closedRuns[0]?.scheduledGameId, "sched-1");
  assert.equal(result.closedRuns[0]?.previousStatus, "running");
  assert.ok(
    result.closedRuns[0]!.stuckForSeconds > 30,
    `stuck_for_seconds skal være > 30, fikk ${result.closedRuns[0]!.stuckForSeconds}`,
  );

  // SQL skal inneholde de kritiske filter-klausulene.
  assert.match(calls[0]!.sql, /WITH active_sched_counts AS/);
  assert.match(calls[0]!.sql, /completed_sched AS/);
  assert.match(calls[0]!.sql, /pr\.status = 'running'/);
  assert.match(calls[0]!.sql, /status = 'completed'/);
  assert.match(calls[0]!.sql, /COALESCE\(asc_t\.active_count, 0\) = 0/);

  // Audit-event skrives.
  await new Promise((r) => setImmediate(r));
  assert.equal(audit.recorded.length, 1);
  assert.equal(audit.recorded[0]?.action, "plan_run.reconcile_natural_end");
  assert.equal(audit.recorded[0]?.actorType, "SYSTEM");
  assert.equal(audit.recorded[0]?.resourceId, "run-1");
});

test("scenario 2: < 30s siden completed → IKKE reconcile (master har gress-periode)", async () => {
  const now = new Date("2026-05-14T08:30:00Z");
  const recentEndedAt = new Date(now.getTime() - 10_000).toISOString(); // 10 sek siden
  const { pool } = makePool({
    planRuns: [planRun({ id: "run-fresh", status: "running" })],
    schedGames: [
      schedGame({
        id: "sched-fresh",
        plan_run_id: "run-fresh",
        status: "completed",
        actual_end_time: recentEndedAt,
      }),
    ],
    now,
  });
  const svc = new GamePlanRunCleanupService({ pool });

  const result = await svc.reconcileNaturalEndStuckRuns(now);

  assert.equal(result.cleanedCount, 0);
  assert.equal(result.closedRuns.length, 0);
});

test("scenario 3: sched-game cancelled (ikke completed) → IKKE reconcile", async () => {
  const now = new Date("2026-05-14T08:30:00Z");
  const { pool } = makePool({
    planRuns: [planRun({ id: "run-c", status: "running" })],
    schedGames: [
      schedGame({
        id: "sched-c",
        plan_run_id: "run-c",
        status: "cancelled", // manuell cancel — IKKE natural-end
        actual_end_time: "2026-05-14T07:00:00Z", // > 30s siden
      }),
    ],
    now,
  });
  const svc = new GamePlanRunCleanupService({ pool });

  const result = await svc.reconcileNaturalEndStuckRuns(now);

  assert.equal(
    result.cleanedCount,
    0,
    "cancelled scheduled-game skal IKKE trigge natural-end-reconcile — det maskerer cancellation-bugs",
  );
});

test("scenario 4: plan-run i status=paused/idle/finished → IKKE reconcile", async () => {
  const now = new Date("2026-05-14T08:30:00Z");
  const oldEndedAt = "2026-05-14T07:00:00Z"; // > 30s

  for (const status of ["paused", "idle", "finished"] as const) {
    const { pool } = makePool({
      planRuns: [planRun({ id: `run-${status}`, status })],
      schedGames: [
        schedGame({
          id: `sched-${status}`,
          plan_run_id: `run-${status}`,
          status: "completed",
          actual_end_time: oldEndedAt,
        }),
      ],
      now,
    });
    const svc = new GamePlanRunCleanupService({ pool });
    const result = await svc.reconcileNaturalEndStuckRuns(now);
    assert.equal(
      result.cleanedCount,
      0,
      `plan-run i status=${status} skal IKKE reconciles`,
    );
  }
});

test("scenario 5: audit-event detaljer dekker alle påkrevde felter (reason, sched-id, etc.)", async () => {
  const now = new Date("2026-05-14T08:30:00Z");
  const endedAt = "2026-05-14T07:39:31Z";
  const { pool } = makePool({
    planRuns: [
      planRun({
        id: "run-audit",
        status: "running",
        hall_id: "hall-test",
        business_date: "2026-05-14",
        current_position: 3,
      }),
    ],
    schedGames: [
      schedGame({
        id: "sched-audit",
        plan_run_id: "run-audit",
        status: "completed",
        actual_end_time: endedAt,
      }),
    ],
    now,
  });
  const audit = makeAuditStub();
  const svc = new GamePlanRunCleanupService({
    pool,
    auditLogService: audit.service as unknown as never,
  });

  await svc.reconcileNaturalEndStuckRuns(now);
  await new Promise((r) => setImmediate(r));

  assert.equal(audit.recorded.length, 1);
  const entry = audit.recorded[0]!;
  assert.equal(entry.action, "plan_run.reconcile_natural_end");
  assert.equal(entry.resource, "game_plan_run");
  assert.equal(entry.resourceId, "run-audit");
  const d = entry.details as Record<string, unknown>;
  assert.equal(d.planRunId, "run-audit");
  assert.equal(d.hallId, "hall-test");
  assert.equal(d.currentPosition, 3);
  assert.equal(d.scheduledGameId, "sched-audit");
  assert.equal(d.scheduledGameEndedAt, endedAt);
  assert.equal(d.reason, "no_master_advance_after_natural_end");
  assert.ok(typeof d.stuckForSeconds === "number");
  assert.ok((d.stuckForSeconds as number) > 30);
  assert.ok(typeof d.thresholdMs === "number");
});

test("scenario 6: idempotent — re-kjøring etter første finish er no-op", async () => {
  const now = new Date("2026-05-14T08:30:00Z");
  // Simuler at vi har én rad som er PARSED som running, men etter første
  // reconcile har UPDATE-en flippet den til finished. Vi modellerer dette
  // ved at pool-stuben SLUTTER å returnere raden etter at den er "finished"
  // av en tidligere kjøring.
  let alreadyReconciled = false;
  const pool = {
    async query<T extends QueryResultRow = QueryResultRow>(
      _sql: string,
      params: unknown[],
    ): Promise<QueryResult<T>> {
      if (alreadyReconciled) {
        return {
          rows: [] as unknown as T[],
          rowCount: 0,
          command: "SELECT",
          oid: 0,
          fields: [],
        } as unknown as QueryResult<T>;
      }
      alreadyReconciled = true;
      const stuckRow = {
        ...planRun({ id: "run-idem", status: "running" }),
        scheduled_game_id: "sched-idem",
        scheduled_game_ended_at: "2026-05-14T07:00:00Z",
        stuck_for_seconds: 5400,
      };
      assert.equal(Number(params[0]), 30_000);
      return {
        rows: [stuckRow] as unknown as T[],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as unknown as QueryResult<T>;
    },
  } as unknown as Pool;
  const svc = new GamePlanRunCleanupService({ pool });

  const first = await svc.reconcileNaturalEndStuckRuns(now);
  assert.equal(first.cleanedCount, 1);

  const second = await svc.reconcileNaturalEndStuckRuns(now);
  assert.equal(second.cleanedCount, 0, "Andre kjøring må være no-op");
});

test("scenario 7a: 42P01 (tabell mangler) → soft no-op", async () => {
  const { pool } = makePool({
    planRuns: [],
    schedGames: [],
    failCode: "42P01",
  });
  const svc = new GamePlanRunCleanupService({ pool });

  const result = await svc.reconcileNaturalEndStuckRuns(new Date());

  assert.equal(result.cleanedCount, 0);
  assert.deepEqual(result.closedRuns, []);
});

test("scenario 7b: non-42P01 PG-feil → bubbles til JobScheduler", async () => {
  const { pool } = makePool({
    planRuns: [],
    schedGames: [],
    failCode: "08000", // generic connection error
  });
  const svc = new GamePlanRunCleanupService({ pool });

  await assert.rejects(
    () => svc.reconcileNaturalEndStuckRuns(new Date()),
    /pg-error 08000/,
  );
});

test("scenario 8: multi-hall — hver hall reconciles uavhengig", async () => {
  const now = new Date("2026-05-14T08:30:00Z");
  const oldEnd = "2026-05-14T07:00:00Z"; // > 30s

  const { pool } = makePool({
    planRuns: [
      planRun({ id: "run-A", hall_id: "hall-A", status: "running" }),
      planRun({ id: "run-B", hall_id: "hall-B", status: "running" }),
      planRun({ id: "run-C", hall_id: "hall-C", status: "paused" }), // ikke stuck
    ],
    schedGames: [
      schedGame({
        id: "sched-A",
        plan_run_id: "run-A",
        status: "completed",
        actual_end_time: oldEnd,
      }),
      schedGame({
        id: "sched-B",
        plan_run_id: "run-B",
        status: "completed",
        actual_end_time: oldEnd,
      }),
      // run-C er paused → blokkerer reconcile selv om sched er completed
      schedGame({
        id: "sched-C",
        plan_run_id: "run-C",
        status: "completed",
        actual_end_time: oldEnd,
      }),
    ],
    now,
  });
  const svc = new GamePlanRunCleanupService({ pool });

  const result = await svc.reconcileNaturalEndStuckRuns(now);

  assert.equal(result.cleanedCount, 2);
  const hallIds = new Set(result.closedRuns.map((r) => r.hallId));
  assert.ok(hallIds.has("hall-A"));
  assert.ok(hallIds.has("hall-B"));
  assert.ok(!hallIds.has("hall-C"));
});

test("threshold er konfigurerbar via constructor option", async () => {
  const now = new Date("2026-05-14T08:30:00Z");
  // 5 sek siden — mindre enn default 30s threshold, men mer enn vår
  // custom 2 sek threshold.
  const recentEndedAt = new Date(now.getTime() - 5_000).toISOString();
  const { pool, calls } = makePool({
    planRuns: [planRun({ id: "run-cfg", status: "running" })],
    schedGames: [
      schedGame({
        id: "sched-cfg",
        plan_run_id: "run-cfg",
        status: "completed",
        actual_end_time: recentEndedAt,
      }),
    ],
    now,
  });
  const svc = new GamePlanRunCleanupService({
    pool,
    naturalEndStuckThresholdMs: 2_000, // 2 sek
  });

  const result = await svc.reconcileNaturalEndStuckRuns(now);

  assert.equal(result.cleanedCount, 1);
  assert.equal(Number(calls[0]!.params[0]), 2_000);
});

test("threshold tvinges til minimum 1 sek (ingen degenerert 0/negativ)", async () => {
  const { pool, calls } = makePool({ planRuns: [], schedGames: [] });
  const svc = new GamePlanRunCleanupService({
    pool,
    naturalEndStuckThresholdMs: 0, // bevisst degenerert
  });

  await svc.reconcileNaturalEndStuckRuns(new Date());

  assert.equal(
    Number(calls[0]!.params[0]),
    1_000,
    "0 ms threshold skal floores til 1000 ms",
  );
});

test("audit-feil → cleanup-kall ikke blokkert (samme pattern som cleanupAllStale)", async () => {
  const now = new Date("2026-05-14T08:30:00Z");
  const { pool } = makePool({
    planRuns: [planRun({ id: "run-af", status: "running" })],
    schedGames: [
      schedGame({
        id: "sched-af",
        plan_run_id: "run-af",
        status: "completed",
        actual_end_time: "2026-05-14T07:00:00Z",
      }),
    ],
    now,
  });
  const failingAudit = {
    async record() {
      throw new Error("audit-store-down");
    },
  };
  const svc = new GamePlanRunCleanupService({
    pool,
    auditLogService: failingAudit as unknown as never,
  });

  const result = await svc.reconcileNaturalEndStuckRuns(now);
  // Cleanup-status returneres uansett — audit-feil er fire-and-forget.
  assert.equal(result.cleanedCount, 1);
  await new Promise((r) => setImmediate(r));
});
