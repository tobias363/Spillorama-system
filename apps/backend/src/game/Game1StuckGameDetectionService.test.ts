/**
 * ADR-0022 Lag 2 tests: Game1StuckGameDetectionService.
 *
 * Dekker:
 *   - tick: 0 kandidater → 0 auto-ended
 *   - tick: STUCK_NO_DRAWS-kandidat → auto-end med riktig audit
 *   - tick: SCHEDULED_END_EXCEEDED-kandidat → auto-end med riktig audit
 *   - tick: kandidat-query feiler → errors økes, ikke kaster
 *   - tick: engine.stopGame feiler → DB-cancel beholdes, audit fortsatt skrevet
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1StuckGameDetectionService,
  type Game1EngineStopPort,
} from "./Game1StuckGameDetectionService.js";
import { AuditLogService, InMemoryAuditLogStore } from "../compliance/AuditLogService.js";

class MockClient {
  public queries: Array<{ text: string; values?: unknown[] }> = [];
  public rowCounts: number[] = [];
  private idx = 0;
  query(text: string, values?: unknown[]): Promise<{ rowCount: number; rows: unknown[] }> {
    this.queries.push({ text, values });
    const rc = this.rowCounts[this.idx] ?? 1;
    this.idx += 1;
    return Promise.resolve({ rowCount: rc, rows: [] });
  }
  release(): void {
    /* no-op */
  }
}

class MockPool {
  public selectRows: Array<Record<string, unknown>> = [];
  public clientFactory: () => MockClient = () => new MockClient();
  query(_t: string, _v?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    return Promise.resolve({ rows: this.selectRows });
  }
  connect(): Promise<MockClient> {
    return Promise.resolve(this.clientFactory());
  }
}

interface MockEnginePort extends Game1EngineStopPort {
  stopCalls: Array<{ id: string; reason: string }>;
  destroyCalls: string[];
  stopShouldThrow: boolean;
}

function makeMockEngine(): MockEnginePort {
  const port = {
    stopCalls: [] as Array<{ id: string; reason: string }>,
    destroyCalls: [] as string[],
    stopShouldThrow: false,
    async stopGame(scheduledGameId: string, reason: string) {
      this.stopCalls.push({ id: scheduledGameId, reason });
      if (this.stopShouldThrow) throw new Error("engine.stopGame failed");
    },
    async destroyRoomForScheduledGameSafe(scheduledGameId: string) {
      this.destroyCalls.push(scheduledGameId);
    },
  };
  return port;
}

function makeService(opts: {
  selectRows: Array<Record<string, unknown>>;
  clientRowCounts?: number[];
  stopShouldThrow?: boolean;
  clock?: () => Date;
}) {
  const pool = new MockPool();
  pool.selectRows = opts.selectRows;
  pool.clientFactory = () => {
    const c = new MockClient();
    c.rowCounts = opts.clientRowCounts ?? [1, 1, 1, 1];
    return c;
  };
  const engine = makeMockEngine();
  engine.stopShouldThrow = opts.stopShouldThrow ?? false;
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const auditedEvents: string[] = [];
  const original = audit.record.bind(audit);
  audit.record = async (input) => {
    auditedEvents.push(input.action);
    await original(input);
  };

  const broadcasts: Array<{ scheduledGameId: string; reason: string }> = [];
  const svc = new Game1StuckGameDetectionService({
    pool: pool as unknown as import("pg").Pool,
    auditLogService: audit,
    engineStop: engine,
    clock: opts.clock ?? (() => new Date("2026-05-12T22:00:00Z")),
    onAutoEnd: (input) => broadcasts.push(input),
  });

  return { svc, pool, engine, audit, auditedEvents, broadcasts };
}

test("tick: 0 kandidater → 0 auto-ended", async () => {
  const { svc } = makeService({ selectRows: [] });
  const result = await svc.tick();
  assert.equal(result.candidatesFound, 0);
  assert.equal(result.autoEnded, 0);
  assert.equal(result.errors, 0);
});

test("tick: STUCK_NO_DRAWS-kandidat → auto-end + audit + engine.stopGame", async () => {
  const lastDrawn = new Date("2026-05-12T21:50:00Z"); // 10 min ago
  const { svc, engine, auditedEvents, broadcasts } = makeService({
    selectRows: [
      {
        scheduled_game_id: "sg-stuck",
        hall_id: "hall-a",
        plan_run_id: "run-1",
        status: "running",
        last_drawn_at: lastDrawn,
        scheduled_end_time: null,
        reason: "STUCK_NO_DRAWS",
      } satisfies Record<string, unknown>,
    ],
  });
  const result = await svc.tick();
  assert.equal(result.candidatesFound, 1);
  assert.equal(result.autoEnded, 1);
  assert.equal(result.errors, 0);
  assert.deepEqual(auditedEvents, ["spill1.engine.auto_end_stuck"]);
  assert.equal(engine.stopCalls.length, 1);
  assert.equal(engine.stopCalls[0]?.id, "sg-stuck");
  assert.deepEqual(broadcasts, [
    { scheduledGameId: "sg-stuck", reason: "STUCK_NO_DRAWS" },
  ]);
});

test("tick: SCHEDULED_END_EXCEEDED-kandidat → auto-end med riktig reason", async () => {
  const scheduledEnd = new Date("2026-05-12T21:00:00Z"); // 1h ago
  const { svc, auditedEvents, broadcasts } = makeService({
    selectRows: [
      {
        scheduled_game_id: "sg-late",
        hall_id: "hall-b",
        plan_run_id: "run-2",
        status: "paused",
        last_drawn_at: null,
        scheduled_end_time: scheduledEnd,
        reason: "SCHEDULED_END_EXCEEDED",
      } satisfies Record<string, unknown>,
    ],
  });
  const result = await svc.tick();
  assert.equal(result.autoEnded, 1);
  assert.deepEqual(auditedEvents, ["spill1.engine.auto_end_stuck"]);
  assert.deepEqual(broadcasts, [
    { scheduledGameId: "sg-late", reason: "SCHEDULED_END_EXCEEDED" },
  ]);
});

test("tick: kandidat-query feiler → errors økes, kaster ikke", async () => {
  const pool = new MockPool();
  pool.query = () => Promise.reject(new Error("DB down"));
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const svc = new Game1StuckGameDetectionService({
    pool: pool as unknown as import("pg").Pool,
    auditLogService: audit,
    engineStop: makeMockEngine(),
  });
  const result = await svc.tick();
  assert.equal(result.errors, 1);
  assert.equal(result.autoEnded, 0);
});

test("tick: engine.stopGame kaster → DB-cancel beholdes + audit fortsatt skrevet", async () => {
  const { svc, engine, auditedEvents } = makeService({
    selectRows: [
      {
        scheduled_game_id: "sg-1",
        hall_id: "hall-a",
        plan_run_id: "run-1",
        status: "running",
        last_drawn_at: new Date("2026-05-12T21:50:00Z"),
        scheduled_end_time: null,
        reason: "STUCK_NO_DRAWS",
      } satisfies Record<string, unknown>,
    ],
    stopShouldThrow: true,
  });
  const result = await svc.tick();
  // DB-cancel + audit må fortsatt skrives selv om engine kaster (regulatorisk:
  // stuck-runde må stoppes uansett).
  assert.equal(result.autoEnded, 1);
  assert.equal(result.errors, 0);
  assert.deepEqual(auditedEvents, ["spill1.engine.auto_end_stuck"]);
  assert.equal(engine.stopCalls.length, 1); // forsøkt
});

test("tick: race-condition (rad allerede cancelled) → ingen audit", async () => {
  const { svc, engine, auditedEvents } = makeService({
    selectRows: [
      {
        scheduled_game_id: "sg-race",
        hall_id: "hall-a",
        plan_run_id: "run-1",
        status: "running",
        last_drawn_at: new Date("2026-05-12T21:50:00Z"),
        scheduled_end_time: null,
        reason: "STUCK_NO_DRAWS",
      } satisfies Record<string, unknown>,
    ],
    // BEGIN, UPDATE sg (0 rows = race), UPDATE gs, COMMIT
    clientRowCounts: [1, 0, 1, 1],
  });
  const result = await svc.tick();
  assert.equal(result.autoEnded, 1); // transaction OK
  // Men ingen audit + ingen engine-call (master allerede stoppet).
  assert.deepEqual(auditedEvents, []);
  assert.equal(engine.stopCalls.length, 0);
});
