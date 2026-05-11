/**
 * ADR-0022 Lag 1 tests: Game1AutoResumePausedService.
 *
 * Dekker:
 *   - tick: 0 kandidater → 0 auto-resumed
 *   - tick: kandidat med stale heartbeat → auto-resume kjøres + audit skrives
 *   - tick: kandidat med fersk heartbeat → SKIP (master regnes som aktiv)
 *   - tick: kandidat uten heartbeat (NULL) → auto-resume kjøres
 *   - tick: race-condition (master fortsatte allerede) → ingen audit skrives
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1AutoResumePausedService,
  type Game1AutoResumeCandidate,
} from "./Game1AutoResumePausedService.js";
import { AuditLogService, InMemoryAuditLogStore } from "../compliance/AuditLogService.js";

interface MockQuery {
  text: string;
  values?: unknown[];
}

class MockClient {
  public queries: MockQuery[] = [];
  /** Per-call rowCount-returner; default 1. */
  public rowCounts: number[] = [];
  private callIdx = 0;

  query(text: string, values?: unknown[]): Promise<{ rowCount: number; rows: unknown[] }> {
    this.queries.push({ text, values });
    const rc = this.rowCounts[this.callIdx] ?? 1;
    this.callIdx += 1;
    return Promise.resolve({ rowCount: rc, rows: [] });
  }
  release(): void {
    /* no-op */
  }
}

class MockPool {
  public selectRows: Array<Record<string, unknown>> = [];
  public clientFactory: () => MockClient = () => new MockClient();
  public lastClient: MockClient | null = null;

  query(_text: string, _values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    return Promise.resolve({ rows: this.selectRows });
  }
  connect(): Promise<MockClient> {
    this.lastClient = this.clientFactory();
    return Promise.resolve(this.lastClient);
  }
}

function makeService(opts: {
  selectRows: Array<Record<string, unknown>>;
  clock?: () => Date;
  heartbeatTimeoutMs?: number;
  clientRowCounts?: number[];
}) {
  const pool = new MockPool();
  pool.selectRows = opts.selectRows;
  pool.clientFactory = () => {
    const c = new MockClient();
    c.rowCounts = opts.clientRowCounts ?? [1, 1, 1, 1];
    return c;
  };
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const auditedEvents: string[] = [];
  const originalRecord = audit.record.bind(audit);
  audit.record = async (input) => {
    auditedEvents.push(input.action);
    await originalRecord(input);
  };

  const broadcasts: Array<{ scheduledGameId: string }> = [];
  const svc = new Game1AutoResumePausedService({
    pool: pool as unknown as import("pg").Pool,
    auditLogService: audit,
    clock: opts.clock ?? (() => new Date("2026-05-12T22:00:00Z")),
    heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? 90_000,
    onAutoResume: (input) => broadcasts.push(input),
  });

  return { svc, pool, audit, auditedEvents, broadcasts };
}

test("tick: 0 kandidater → 0 auto-resumed", async () => {
  const { svc } = makeService({ selectRows: [] });
  const result = await svc.tick();
  assert.equal(result.candidatesFound, 0);
  assert.equal(result.autoResumed, 0);
  assert.equal(result.skippedMasterActive, 0);
  assert.equal(result.errors, 0);
});

test("tick: kandidat uten heartbeat → auto-resume + audit", async () => {
  const now = new Date("2026-05-12T22:00:00Z");
  const eligible = new Date("2026-05-12T21:59:00Z"); // 60s ago
  const { svc, auditedEvents, broadcasts } = makeService({
    selectRows: [
      {
        scheduled_game_id: "sg-1",
        hall_id: "hall-a",
        plan_run_id: "run-1",
        paused_at_phase: 2,
        auto_resume_eligible_at: eligible,
        master_last_seen_at: null,
      } satisfies Record<string, unknown>,
    ],
    clock: () => now,
  });
  const result = await svc.tick();
  assert.equal(result.candidatesFound, 1);
  assert.equal(result.autoResumed, 1);
  assert.equal(result.skippedMasterActive, 0);
  assert.equal(result.errors, 0);
  assert.deepEqual(auditedEvents, ["spill1.engine.auto_resume"]);
  assert.deepEqual(broadcasts, [{ scheduledGameId: "sg-1", pausedAtPhase: 2 }]);
});

test("tick: master har fersk heartbeat → SKIP (ingen resume)", async () => {
  const now = new Date("2026-05-12T22:00:00Z");
  const eligible = new Date("2026-05-12T21:59:00Z");
  const freshHeartbeat = new Date("2026-05-12T21:59:30Z"); // 30s ago — fresh
  const { svc, auditedEvents, broadcasts } = makeService({
    selectRows: [
      {
        scheduled_game_id: "sg-1",
        hall_id: "hall-a",
        plan_run_id: "run-1",
        paused_at_phase: 2,
        auto_resume_eligible_at: eligible,
        master_last_seen_at: freshHeartbeat,
      } satisfies Record<string, unknown>,
    ],
    clock: () => now,
    heartbeatTimeoutMs: 90_000,
  });
  const result = await svc.tick();
  assert.equal(result.candidatesFound, 1);
  assert.equal(result.autoResumed, 0);
  assert.equal(result.skippedMasterActive, 1);
  assert.equal(result.errors, 0);
  assert.deepEqual(auditedEvents, []);
  assert.deepEqual(broadcasts, []);
});

test("tick: master heartbeat stale (eldre enn terskel) → auto-resume", async () => {
  const now = new Date("2026-05-12T22:00:00Z");
  const eligible = new Date("2026-05-12T21:59:00Z");
  const staleHeartbeat = new Date("2026-05-12T21:55:00Z"); // 5 min ago — stale
  const { svc, auditedEvents } = makeService({
    selectRows: [
      {
        scheduled_game_id: "sg-stale",
        hall_id: "hall-a",
        plan_run_id: "run-1",
        paused_at_phase: 1,
        auto_resume_eligible_at: eligible,
        master_last_seen_at: staleHeartbeat,
      } satisfies Record<string, unknown>,
    ],
    clock: () => now,
    heartbeatTimeoutMs: 90_000,
  });
  const result = await svc.tick();
  assert.equal(result.autoResumed, 1);
  assert.equal(result.skippedMasterActive, 0);
  assert.deepEqual(auditedEvents, ["spill1.engine.auto_resume"]);
});

test("tick: race med master manuell resume (rowCount=0) → ingen audit", async () => {
  const now = new Date("2026-05-12T22:00:00Z");
  const eligible = new Date("2026-05-12T21:59:00Z");
  const { svc, auditedEvents, broadcasts } = makeService({
    selectRows: [
      {
        scheduled_game_id: "sg-1",
        hall_id: "hall-a",
        plan_run_id: "run-1",
        paused_at_phase: 2,
        auto_resume_eligible_at: eligible,
        master_last_seen_at: null,
      } satisfies Record<string, unknown>,
    ],
    clock: () => now,
    // BEGIN=ok, UPDATE game_state=0 rows (race), UPDATE scheduled=ok, COMMIT=ok
    clientRowCounts: [1, 0, 1, 1],
  });
  const result = await svc.tick();
  assert.equal(result.autoResumed, 1); // success counted (transaction OK)
  // Men ingen audit skrives når UPDATE rowCount=0 (master fortsatte allerede).
  assert.deepEqual(auditedEvents, []);
  assert.deepEqual(broadcasts, []);
});

test("tick: kandidat-query feiler → errors økes, ikke kaster", async () => {
  const pool = new MockPool();
  pool.query = () => Promise.reject(new Error("DB down"));
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const svc = new Game1AutoResumePausedService({
    pool: pool as unknown as import("pg").Pool,
    auditLogService: audit,
  });
  const result = await svc.tick();
  assert.equal(result.errors, 1);
  assert.equal(result.autoResumed, 0);
});

// Type-validation: Game1AutoResumeCandidate-shape eksporteres riktig
test("Game1AutoResumeCandidate-shape inkluderer hallId, planRunId, pausedAtPhase", () => {
  const c: Game1AutoResumeCandidate = {
    scheduledGameId: "sg-1",
    hallId: "hall-a",
    planRunId: null,
    pausedAtPhase: 3,
    autoResumeEligibleAt: new Date(),
    masterLastSeenAt: null,
  };
  assert.equal(c.scheduledGameId, "sg-1");
});
