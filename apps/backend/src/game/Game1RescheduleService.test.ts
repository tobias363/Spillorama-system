/**
 * Game1RescheduleService — unit-tester for runtime-justering av
 * `app_game1_scheduled_games.scheduled_start_time` (+ valgfri end-time).
 *
 * Stub-pool-mønsteret matcher `Game1HallReadyService.test.ts` slik at alle
 * Game1-services testes konsistent uten DB.
 *
 * Dekker:
 *   - Happy path: status='scheduled', kun start endres → UPDATE + before/after-snapshot
 *   - Happy path: status='purchase_open', både start og end endres
 *   - Reject: GAME_NOT_FOUND når raden ikke finnes
 *   - Reject: RESCHEDULE_NOT_ALLOWED når status='running'
 *   - Reject: RESCHEDULE_NOT_ALLOWED når status='completed'
 *   - Reject: INVALID_INPUT når newStart < now - 60s
 *   - Reject: INVALID_INPUT når newEnd ≤ newStart
 *   - Reject: INVALID_INPUT når newEnd > now + 24h
 *   - Reject: INVALID_INPUT når reason er tomt
 *   - Reject: RESCHEDULE_NOT_ALLOWED når UPDATE returnerer 0 rader (race)
 *   - SQL-form: UPDATE-query bruker COALESCE for partial end-update
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../errors/DomainError.js";
import { Game1RescheduleService } from "./Game1RescheduleService.js";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  return {
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        for (let i = 0; i < queue.length; i++) {
          const r = queue[i]!;
          if (r.match(sql)) {
            queue.splice(i, 1);
            return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
          }
        }
        return { rows: [], rowCount: 0 };
      },
    },
    queries,
  };
}

function selectRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "scheduled",
    scheduled_start_time: "2026-05-08T10:00:00.000Z",
    scheduled_end_time: "2026-05-08T11:00:00.000Z",
    ...overrides,
  };
}

function updatedRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    scheduled_start_time: "2026-05-08T12:00:00.000Z",
    scheduled_end_time: "2026-05-08T11:00:00.000Z",
    status: "scheduled",
    ...overrides,
  };
}

const NOW_MS = Date.parse("2026-05-07T11:00:00.000Z");

// ── Happy path ─────────────────────────────────────────────────────────────

test("reschedule happy path — kun start endres på scheduled-game", async () => {
  const newStart = new Date("2026-05-08T12:00:00.000Z");
  const { pool, queries } = createStubPool([
    {
      match: (s) =>
        s.includes("SELECT id, status, scheduled_start_time, scheduled_end_time"),
      rows: [selectRow()],
    },
    {
      match: (s) => s.includes("UPDATE") && s.includes("RETURNING"),
      rows: [
        updatedRow({
          scheduled_start_time: newStart.toISOString(),
          scheduled_end_time: "2026-05-08T11:00:00.000Z",
        }),
      ],
    },
  ]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  const result = await svc.reschedule({
    gameId: "g1",
    newStartTime: newStart,
    newEndTime: undefined,
    reason: "Pilot-justering",
    nowMs: NOW_MS,
  });
  assert.equal(result.status, "scheduled");
  assert.equal(result.oldStartTime, "2026-05-08T10:00:00.000Z");
  assert.equal(result.newStartTime, newStart.toISOString());
  // end er uendret (COALESCE behold eksisterende)
  assert.equal(result.oldEndTime, "2026-05-08T11:00:00.000Z");
  assert.equal(result.newEndTime, "2026-05-08T11:00:00.000Z");

  // SQL-form: UPDATE skal ha COALESCE på end-time så partial-update virker.
  const updateSql = queries.find((q) => q.sql.includes("UPDATE"))?.sql ?? "";
  assert.ok(
    updateSql.includes("COALESCE($3::timestamptz, scheduled_end_time)"),
    "UPDATE må bruke COALESCE for end-time slik at undefined behold eksisterende verdi"
  );
  // Andre param skal være newStart ISO; tredje må være null når end ikke sendt.
  const updateParams =
    queries.find((q) => q.sql.includes("UPDATE"))?.params ?? [];
  assert.equal(updateParams[1], newStart.toISOString());
  assert.equal(updateParams[2], null);
});

test("reschedule happy path — purchase_open + både start og end endres", async () => {
  const newStart = new Date("2026-05-07T12:00:00.000Z");
  const newEnd = new Date("2026-05-07T13:30:00.000Z");
  const { pool, queries } = createStubPool([
    {
      match: (s) => s.includes("SELECT id, status"),
      rows: [
        selectRow({
          status: "purchase_open",
          scheduled_start_time: "2026-05-07T11:30:00.000Z",
          scheduled_end_time: "2026-05-07T12:30:00.000Z",
        }),
      ],
    },
    {
      match: (s) => s.includes("UPDATE"),
      rows: [
        updatedRow({
          status: "purchase_open",
          scheduled_start_time: newStart.toISOString(),
          scheduled_end_time: newEnd.toISOString(),
        }),
      ],
    },
  ]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  const result = await svc.reschedule({
    gameId: "g1",
    newStartTime: newStart,
    newEndTime: newEnd,
    reason: "Forleng spillvindu",
    nowMs: NOW_MS,
  });
  assert.equal(result.status, "purchase_open");
  assert.equal(result.newStartTime, newStart.toISOString());
  assert.equal(result.newEndTime, newEnd.toISOString());

  const updateParams =
    queries.find((q) => q.sql.includes("UPDATE"))?.params ?? [];
  assert.equal(updateParams[2], newEnd.toISOString());
});

// ── Reject paths ───────────────────────────────────────────────────────────

test("reschedule kaster GAME_NOT_FOUND når rad ikke finnes", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.includes("SELECT id, status"), rows: [] },
  ]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.reschedule({
        gameId: "ghost",
        newStartTime: new Date(NOW_MS + 60_000),
        newEndTime: undefined,
        reason: "test",
        nowMs: NOW_MS,
      }),
    (err) => err instanceof DomainError && err.code === "GAME_NOT_FOUND"
  );
});

test("reschedule kaster RESCHEDULE_NOT_ALLOWED når status='running'", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("SELECT id, status"),
      rows: [selectRow({ status: "running" })],
    },
  ]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.reschedule({
        gameId: "g1",
        newStartTime: new Date(NOW_MS + 60_000),
        newEndTime: undefined,
        reason: "test",
        nowMs: NOW_MS,
      }),
    (err) => err instanceof DomainError && err.code === "RESCHEDULE_NOT_ALLOWED"
  );
});

test("reschedule kaster RESCHEDULE_NOT_ALLOWED når status='completed'", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("SELECT id, status"),
      rows: [selectRow({ status: "completed" })],
    },
  ]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.reschedule({
        gameId: "g1",
        newStartTime: new Date(NOW_MS + 60_000),
        newEndTime: undefined,
        reason: "test",
        nowMs: NOW_MS,
      }),
    (err) => err instanceof DomainError && err.code === "RESCHEDULE_NOT_ALLOWED"
  );
});

test("reschedule kaster INVALID_INPUT når newStart < now - 60s", async () => {
  const { pool } = createStubPool([]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.reschedule({
        gameId: "g1",
        // 5 minutter i fortiden — utenfor 60s-slack.
        newStartTime: new Date(NOW_MS - 5 * 60 * 1000),
        newEndTime: undefined,
        reason: "test",
        nowMs: NOW_MS,
      }),
    (err) =>
      err instanceof DomainError &&
      err.code === "INVALID_INPUT" &&
      /fortiden/i.test(err.message)
  );
});

test("reschedule godtar newStart innenfor 60s-slack i fortiden (klokke-skew)", async () => {
  const newStart = new Date(NOW_MS - 30 * 1000); // 30s i fortiden
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("SELECT id, status"),
      rows: [selectRow()],
    },
    {
      match: (s) => s.includes("UPDATE"),
      rows: [
        updatedRow({
          scheduled_start_time: newStart.toISOString(),
        }),
      ],
    },
  ]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  const result = await svc.reschedule({
    gameId: "g1",
    newStartTime: newStart,
    newEndTime: undefined,
    reason: "test",
    nowMs: NOW_MS,
  });
  assert.equal(result.newStartTime, newStart.toISOString());
});

test("reschedule kaster INVALID_INPUT når newEnd ≤ newStart", async () => {
  const newStart = new Date(NOW_MS + 60_000);
  const newEnd = new Date(NOW_MS + 60_000); // lik
  const { pool } = createStubPool([]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.reschedule({
        gameId: "g1",
        newStartTime: newStart,
        newEndTime: newEnd,
        reason: "test",
        nowMs: NOW_MS,
      }),
    (err) =>
      err instanceof DomainError &&
      err.code === "INVALID_INPUT" &&
      /etter scheduledStartTime/i.test(err.message)
  );
});

test("reschedule kaster INVALID_INPUT når newEnd > now + 24h", async () => {
  const newStart = new Date(NOW_MS + 60_000);
  const newEnd = new Date(NOW_MS + 25 * 60 * 60 * 1000); // 25h fram
  const { pool } = createStubPool([]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.reschedule({
        gameId: "g1",
        newStartTime: newStart,
        newEndTime: newEnd,
        reason: "test",
        nowMs: NOW_MS,
      }),
    (err) =>
      err instanceof DomainError &&
      err.code === "INVALID_INPUT" &&
      /24 timer/i.test(err.message)
  );
});

test("reschedule kaster INVALID_INPUT når reason er tomt", async () => {
  const { pool } = createStubPool([]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.reschedule({
        gameId: "g1",
        newStartTime: new Date(NOW_MS + 60_000),
        newEndTime: undefined,
        reason: "   ",
        nowMs: NOW_MS,
      }),
    (err) =>
      err instanceof DomainError &&
      err.code === "INVALID_INPUT" &&
      /reason/i.test(err.message)
  );
});

test("reschedule kaster INVALID_INPUT når reason > 500 tegn", async () => {
  const { pool } = createStubPool([]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  const longReason = "a".repeat(501);
  await assert.rejects(
    () =>
      svc.reschedule({
        gameId: "g1",
        newStartTime: new Date(NOW_MS + 60_000),
        newEndTime: undefined,
        reason: longReason,
        nowMs: NOW_MS,
      }),
    (err) =>
      err instanceof DomainError &&
      err.code === "INVALID_INPUT" &&
      /500/.test(err.message)
  );
});

test("reschedule kaster RESCHEDULE_NOT_ALLOWED når UPDATE returnerer 0 rader (race)", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("SELECT id, status"),
      rows: [selectRow()],
    },
    {
      // UPDATE returnerer ingenting — race der status flippes mellom SELECT og UPDATE.
      match: (s) => s.includes("UPDATE"),
      rows: [],
      rowCount: 0,
    },
  ]);
  const svc = Game1RescheduleService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.reschedule({
        gameId: "g1",
        newStartTime: new Date(NOW_MS + 60_000),
        newEndTime: undefined,
        reason: "test",
        nowMs: NOW_MS,
      }),
    (err) => err instanceof DomainError && err.code === "RESCHEDULE_NOT_ALLOWED"
  );
});
