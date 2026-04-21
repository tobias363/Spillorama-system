/**
 * GAME1_SCHEDULE PR 5: unit-tester for Game1RecoveryService.
 *
 * Testene bruker en stub-pool som matcher mot SQL-fragment og returnerer
 * preset rader. Mønsteret følger Game1MasterControlService.test.ts så
 * det er lett å lese begge sammen.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1RecoveryService } from "./Game1RecoveryService.js";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
}

interface StubClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    connect: () => Promise<StubClient>;
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const activeResponses = responses.slice();

  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < activeResponses.length; i++) {
      const r = activeResponses[i]!;
      if (r.match(sql)) {
        activeResponses.splice(i, 1);
        return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };

  return {
    pool: {
      connect: async (): Promise<StubClient> => ({
        query,
        release: () => undefined,
      }),
      query,
    },
    queries,
  };
}

function scheduledRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "running",
    master_hall_id: "hall-master",
    group_hall_id: "grp-1",
    scheduled_end_time: new Date("2026-04-20T18:00:00Z"),
    ...overrides,
  };
}

// ── Konstruksjon ────────────────────────────────────────────────────────────

test("PR5 recovery: konstruksjon feiler på ugyldig schema", () => {
  const { pool } = createStubPool();
  assert.throws(
    () =>
      new Game1RecoveryService({
        pool: pool as never,
        schema: "drop-table;",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

test("PR5 recovery: konstruksjon feiler på ugyldig maxRunningWindowMs", () => {
  const { pool } = createStubPool();
  assert.throws(
    () =>
      new Game1RecoveryService({
        pool: pool as never,
        maxRunningWindowMs: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

// ── Tom tabell ──────────────────────────────────────────────────────────────

test("PR5 recovery: tom tabell → inspected=0, cancelled=0, preserved=0", async () => {
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [],
    },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(Date.parse("2026-04-21T12:00:00Z"));
  assert.deepEqual(result, {
    inspected: 0,
    cancelled: 0,
    preserved: 0,
    failures: [],
    cancelledGameIds: [],
    preservedGameIds: [],
  });
});

// ── Overdue cancel ─────────────────────────────────────────────────────────

test("PR5 recovery: running-rad > 2h over scheduled_end_time auto-kanselleres", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  // scheduled_end_time=2026-04-20T18:00Z → 18 timer tilbake i tid, langt over 2h-vinduet.
  const overdueRow = scheduledRow({
    id: "g-overdue",
    status: "running",
    scheduled_end_time: new Date("2026-04-20T18:00:00Z"),
  });
  const { pool, queries } = createStubPool([
    {
      match: (sql) =>
        sql.includes("SELECT id, status, master_hall_id, group_hall_id, scheduled_end_time"),
      rows: [overdueRow],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [{ id: "g-overdue", status: "cancelled" }],
    },
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
      rows: [
        { hall_id: "hall-1", is_ready: true, excluded_from_game: false },
        { hall_id: "hall-2", is_ready: false, excluded_from_game: false },
      ],
    },
    {
      match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
      rows: [],
    },
    { match: (sql) => sql.trim() === "COMMIT", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.inspected, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(result.preserved, 0);
  assert.deepEqual(result.cancelledGameIds, ["g-overdue"]);
  assert.equal(result.failures.length, 0);

  // Verifiser at UPDATE ble kjørt med crash_recovery_cancelled-stop-reason
  const updateQuery = queries.find((q) =>
    q.sql.includes("SET status          = 'cancelled'"),
  );
  assert.ok(updateQuery, "UPDATE må være sendt");

  // Verifiser at INSERT INTO master_audit fikk action='stop' + metadata
  const auditQuery = queries.find((q) =>
    q.sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
  );
  assert.ok(auditQuery, "audit INSERT må være sendt");
  const metadataParam = auditQuery!.params[5] as string;
  const metadata = JSON.parse(metadataParam);
  assert.equal(metadata.reason, "crash_recovery_cancelled");
  assert.equal(metadata.priorStatus, "running");
  assert.equal(typeof metadata.autoCancelledAt, "string");
  assert.equal(metadata.autoCancelledAtMs, nowMs);

  // Verifiser at snapshot parametere
  const snapshotParam = auditQuery!.params[4] as string;
  const snapshot = JSON.parse(snapshotParam);
  assert.equal(snapshot["hall-1"].isReady, true);
  assert.equal(snapshot["hall-2"].isReady, false);
});

// ── Overdue paused ─────────────────────────────────────────────────────────

test("PR5 recovery: paused-rad > 2h over scheduled_end_time kanselleres også", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const overdueRow = scheduledRow({
    id: "g-paused",
    status: "paused",
    scheduled_end_time: new Date("2026-04-21T09:00:00Z"), // 3h før now
  });
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [overdueRow],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [{ id: "g-paused", status: "cancelled" }],
    },
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
      rows: [],
    },
    {
      match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
      rows: [],
    },
    { match: (sql) => sql.trim() === "COMMIT", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.cancelled, 1);
  assert.deepEqual(result.cancelledGameIds, ["g-paused"]);
});

// ── Innenfor vinduet (preserved) ────────────────────────────────────────────

test("PR5 recovery: running-rad innenfor 2h-vinduet rørs ikke", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  // scheduled_end_time akkurat 1h siden → innenfor 2h-vinduet
  const recentRow = scheduledRow({
    id: "g-recent",
    status: "running",
    scheduled_end_time: new Date("2026-04-21T11:00:00Z"),
  });
  const { pool, queries } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [recentRow],
    },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.inspected, 1);
  assert.equal(result.cancelled, 0);
  assert.equal(result.preserved, 1);
  assert.deepEqual(result.preservedGameIds, ["g-recent"]);

  // Ingen UPDATE skal ha blitt sendt
  assert.ok(
    !queries.some((q) => q.sql.includes("SET status          = 'cancelled'")),
    "UPDATE må ikke sendes for rad innenfor vinduet",
  );
});

test("PR5 recovery: paused-rad innenfor vinduet rørs ikke", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const pausedRow = scheduledRow({
    id: "g-paused-ok",
    status: "paused",
    scheduled_end_time: new Date("2026-04-21T13:00:00Z"), // 1h i framtiden
  });
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [pausedRow],
    },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.preserved, 1);
  assert.deepEqual(result.preservedGameIds, ["g-paused-ok"]);
});

// ── Blandet sett ────────────────────────────────────────────────────────────

test("PR5 recovery: blandet sett — overdue cancel + recent preserve i samme pass", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const overdue = scheduledRow({
    id: "g-overdue",
    status: "running",
    scheduled_end_time: new Date("2026-04-20T01:00:00Z"),
  });
  const recent = scheduledRow({
    id: "g-recent",
    status: "running",
    scheduled_end_time: new Date("2026-04-21T11:30:00Z"),
  });
  // Responsene må dekke full recovery-cycle for overdue + simpel SELECT for recent.
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [overdue, recent],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [{ id: "g-overdue", status: "cancelled" }],
    },
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
      rows: [],
    },
    {
      match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
      rows: [],
    },
    { match: (sql) => sql.trim() === "COMMIT", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.inspected, 2);
  assert.equal(result.cancelled, 1);
  assert.equal(result.preserved, 1);
  assert.deepEqual(result.cancelledGameIds, ["g-overdue"]);
  assert.deepEqual(result.preservedGameIds, ["g-recent"]);
});

// ── Feil i en rad stopper ikke resten ──────────────────────────────────────

test("PR5 recovery: feil i én rad stopper ikke resten", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const bad = scheduledRow({
    id: "g-bad",
    status: "running",
    scheduled_end_time: new Date("2026-04-20T01:00:00Z"),
  });
  const good = scheduledRow({
    id: "g-good",
    status: "paused",
    scheduled_end_time: new Date("2026-04-20T02:00:00Z"),
  });

  // Konstruér en pool der første overdue-UPDATE kaster, men den andre lykkes.
  const queries: RecordedQuery[] = [];
  let updateCallCount = 0;
  const poolLike = {
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.trim() === "BEGIN") return { rows: [], rowCount: 0 };
        if (sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\"")) {
          updateCallCount += 1;
          if (updateCallCount === 1) {
            throw new Error("simulated DB error on first UPDATE");
          }
          return {
            rows: [{ id: params[0], status: "cancelled" }],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM \"public\".\"app_game1_hall_ready_status\"")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\"")) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    }),
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("FROM \"public\".\"app_game1_scheduled_games\"")) {
        return { rows: [bad, good], rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const service = Game1RecoveryService.forTesting(poolLike as never);
  const result = await service.runRecoveryPass(nowMs);

  assert.equal(result.inspected, 2);
  assert.equal(result.cancelled, 1, "good-rad skal kanselleres selv om bad feiler");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]!.gameId, "g-bad");
  assert.deepEqual(result.cancelledGameIds, ["g-good"]);
});

// ── Race: en annen prosess har flyttet raden mellom SELECT og UPDATE ───────

test("PR5 recovery: UPDATE returnerer 0 rader → rollback, ingen feil", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const raced = scheduledRow({
    id: "g-raced",
    status: "running",
    scheduled_end_time: new Date("2026-04-20T01:00:00Z"),
  });
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [raced],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [], // 0 rader returnert — race
    },
    { match: (sql) => sql.trim() === "ROLLBACK", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.cancelled, 0, "raced rad skal ikke telles som cancelled");
  assert.equal(result.failures.length, 0, "ingen feil ved race");
});
