/**
 * Tobias 2026-04-27 (pilot-test feedback): tests for
 * `RoomStartPreFlightValidator`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, QueryResult } from "pg";
import { DomainError } from "./BingoEngine.js";
import { RoomStartPreFlightValidator } from "./RoomStartPreFlightValidator.js";

interface FakeQueryCall {
  sql: string;
  params: readonly unknown[] | undefined;
}

interface FakePoolOptions {
  responses: Array<{
    matches: (sql: string, params: readonly unknown[]) => boolean;
    rows: unknown[];
    throwError?: Error;
  }>;
}

function makeFakePool(opts: FakePoolOptions): { pool: Pool; calls: FakeQueryCall[] } {
  const calls: FakeQueryCall[] = [];
  const pool = {
    async query(sql: string, params?: readonly unknown[]): Promise<QueryResult> {
      calls.push({ sql, params });
      const handler = opts.responses.find((r) => r.matches(sql, params ?? []));
      if (!handler) {
        throw new Error(`Unexpected SQL in test: ${sql.slice(0, 80)}…`);
      }
      if (handler.throwError) {
        throw handler.throwError;
      }
      return {
        rows: handler.rows as unknown[],
        rowCount: handler.rows.length,
        command: "",
        oid: 0,
        fields: [],
      } as unknown as QueryResult;
    },
  } as unknown as Pool;
  return { pool, calls };
}

const isGroupLookupSQL = (sql: string): boolean =>
  /app_hall_groups.*INNER JOIN.*app_hall_group_members/s.test(sql);

const isScheduleLookupSQL = (sql: string): boolean =>
  /FROM .*app_daily_schedules/s.test(sql);

test("step 1 — hall is member of active group → passes step 1", async () => {
  const { pool } = makeFakePool({
    responses: [
      { matches: isGroupLookupSQL, rows: [{ id: "grp-1" }] },
      { matches: isScheduleLookupSQL, rows: [{ "?column?": 1 }] },
    ],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await v.validate("hall-1");
});

test("step 1 — hall has NO active group memberships → throws HALL_NOT_IN_GROUP", async () => {
  const { pool } = makeFakePool({
    responses: [{ matches: isGroupLookupSQL, rows: [] }],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await assert.rejects(
    () => v.validate("hall-orphan"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "expected DomainError");
      assert.equal((err as DomainError).code, "HALL_NOT_IN_GROUP");
      return true;
    },
  );
});

test("step 1 — SQL filters by deleted_at IS NULL + status='active'", async () => {
  const { pool, calls } = makeFakePool({
    responses: [{ matches: isGroupLookupSQL, rows: [] }],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await assert.rejects(
    () => v.validate("hall-1"),
    (err: unknown) => (err as DomainError).code === "HALL_NOT_IN_GROUP",
  );
  assert.equal(calls.length, 1, "expected 1 query");
  const sql = calls[0]!.sql;
  assert.match(sql, /g\.deleted_at IS NULL/);
  assert.match(sql, /g\.status = 'active'/);
});

test("step 2 — schedule exists → passes", async () => {
  const { pool } = makeFakePool({
    responses: [
      { matches: isGroupLookupSQL, rows: [{ id: "grp-1" }] },
      { matches: isScheduleLookupSQL, rows: [{ "?column?": 1 }] },
    ],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await v.validate("hall-1");
});

test("step 2 — uses hallIds JSON array matcher", async () => {
  const { pool, calls } = makeFakePool({
    responses: [
      { matches: isGroupLookupSQL, rows: [{ id: "grp-1" }] },
      { matches: isScheduleLookupSQL, rows: [{ "?column?": 1 }] },
    ],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await v.validate("hall-1");
  const scheduleCall = calls.find((c) => isScheduleLookupSQL(c.sql))!;
  assert.match(scheduleCall.sql, /jsonb_build_object\('hallIds'/);
});

test("step 2 — uses groupHallIds matcher with multiple group ids", async () => {
  const { pool, calls } = makeFakePool({
    responses: [
      { matches: isGroupLookupSQL, rows: [{ id: "grp-1" }, { id: "grp-2" }] },
      { matches: isScheduleLookupSQL, rows: [{ "?column?": 1 }] },
    ],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await v.validate("hall-1");
  const scheduleCall = calls.find((c) => isScheduleLookupSQL(c.sql))!;
  assert.deepEqual(scheduleCall.params, ["hall-1", "grp-1", "grp-2"]);
  assert.match(scheduleCall.sql, /jsonb_build_object\('groupHallIds'/);
});

test("step 2 — no active schedule → throws NO_SCHEDULE_FOR_HALL_GROUP", async () => {
  const { pool, calls } = makeFakePool({
    responses: [
      { matches: isGroupLookupSQL, rows: [{ id: "grp-1" }] },
      { matches: isScheduleLookupSQL, rows: [] },
    ],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await assert.rejects(
    () => v.validate("hall-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "NO_SCHEDULE_FOR_HALL_GROUP");
      return true;
    },
  );
  const scheduleCall = calls.find((c) => isScheduleLookupSQL(c.sql))!;
  assert.match(scheduleCall.sql, /deleted_at IS NULL/);
  assert.match(scheduleCall.sql, /status = 'active'/);
});

test("empty hallId → throws INVALID_INPUT", async () => {
  const { pool } = makeFakePool({ responses: [] });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await assert.rejects(
    () => v.validate(""),
    (err: unknown) => (err as DomainError).code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => v.validate("   "),
    (err: unknown) => (err as DomainError).code === "INVALID_INPUT",
  );
});

test("DB error during step 1 → fail-closed with PRE_FLIGHT_DB_ERROR", async () => {
  const { pool } = makeFakePool({
    responses: [
      {
        matches: isGroupLookupSQL,
        rows: [],
        throwError: new Error("connection refused"),
      },
    ],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await assert.rejects(
    () => v.validate("hall-1"),
    (err: unknown) => (err as DomainError).code === "PRE_FLIGHT_DB_ERROR",
  );
});

test("DB error during step 2 → fail-closed with PRE_FLIGHT_DB_ERROR", async () => {
  const { pool } = makeFakePool({
    responses: [
      { matches: isGroupLookupSQL, rows: [{ id: "grp-1" }] },
      {
        matches: isScheduleLookupSQL,
        rows: [],
        throwError: new Error("query timeout"),
      },
    ],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await assert.rejects(
    () => v.validate("hall-1"),
    (err: unknown) => (err as DomainError).code === "PRE_FLIGHT_DB_ERROR",
  );
});

test("hallId is trimmed before query", async () => {
  const { pool, calls } = makeFakePool({
    responses: [
      { matches: isGroupLookupSQL, rows: [{ id: "grp-1" }] },
      { matches: isScheduleLookupSQL, rows: [{ "?column?": 1 }] },
    ],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool);
  await v.validate("  hall-1  ");
  const groupCall = calls.find((c) => isGroupLookupSQL(c.sql))!;
  assert.deepEqual(groupCall.params, ["hall-1"]);
});

test("custom schema is reflected in SQL", async () => {
  const { pool, calls } = makeFakePool({
    responses: [
      { matches: () => true, rows: [{ id: "grp-1" }] },
      { matches: () => true, rows: [{ "?column?": 1 }] },
    ],
  });
  const v = RoomStartPreFlightValidator.forTesting(pool, "spillorama");
  await v.validate("hall-1");
  assert.match(calls[0]!.sql, /"spillorama"\."app_hall_groups"/);
  assert.match(calls[0]!.sql, /"spillorama"\."app_hall_group_members"/);
  assert.match(calls[1]!.sql, /"spillorama"\."app_daily_schedules"/);
});
