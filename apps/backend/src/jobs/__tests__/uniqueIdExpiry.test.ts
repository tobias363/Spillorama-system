/**
 * Pilot-blokker K1A follow-up — tests for the unique-id expiry cron job.
 *
 * Covers:
 *   1. Expired ACTIVE cards → flipped to EXPIRED
 *   2. Date-key guard prevents double-run same day
 *   3. Hour-gate skips runs before runAtHourLocal
 *   4. 42P01 (table missing) → soft-no-op
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { createUniqueIdExpiryJob } from "../uniqueIdExpiry.js";

interface FakePoolCall {
  sql: string;
  params: unknown[];
}

function makePool(returnRowCount: number, opts?: { failCode?: string }): {
  pool: Pool;
  calls: FakePoolCall[];
} {
  const calls: FakePoolCall[] = [];
  const pool = {
    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: unknown[] = [],
    ): Promise<QueryResult<T>> {
      calls.push({ sql, params });
      if (opts?.failCode) {
        const err = new Error(`pg-error ${opts.failCode}`) as Error & { code: string };
        err.code = opts.failCode;
        throw err;
      }
      return {
        rows: [],
        rowCount: returnRowCount,
        command: "UPDATE",
        oid: 0,
        fields: [],
      } as unknown as QueryResult<T>;
    },
  } as unknown as Pool;
  return { pool, calls };
}

test("unique-id expiry: marks expired ACTIVE cards", async () => {
  const { pool, calls } = makePool(3);
  const job = createUniqueIdExpiryJob({ pool, schema: "public", alwaysRun: true });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 3);
  assert.match(result.note ?? "", /expired=3/);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /UPDATE.*app_unique_ids/);
  assert.match(calls[0]!.sql, /SET status = 'EXPIRED'/);
  assert.match(calls[0]!.sql, /status = 'ACTIVE'/);
  assert.match(calls[0]!.sql, /expiry_date < now\(\)/);
});

test("unique-id expiry: date-key guard skips second run same day", async () => {
  const { pool, calls } = makePool(2);
  // alwaysRun=false → triggers date-key guard.
  const job = createUniqueIdExpiryJob({
    pool,
    schema: "public",
    runAtHourLocal: 0, // any hour qualifies
  });
  const t1 = new Date("2026-05-01T05:00:00Z").getTime();
  const r1 = await job(t1);
  assert.equal(r1.itemsProcessed, 2);
  // Second tick same calendar day → no-op
  const t2 = new Date("2026-05-01T18:00:00Z").getTime();
  const r2 = await job(t2);
  assert.equal(r2.itemsProcessed, 0);
  assert.equal(r2.note, "already ran today");
  assert.equal(calls.length, 1, "second run must not hit DB");
});

test("unique-id expiry: hour-gate skips before runAtHourLocal", async () => {
  const { pool, calls } = makePool(0);
  const job = createUniqueIdExpiryJob({ pool, schema: "public", runAtHourLocal: 23 });
  // Pick an early-morning local time to ensure hour < 23 in any reasonable TZ.
  const earlyMorning = new Date();
  earlyMorning.setHours(2, 0, 0, 0);
  const result = await job(earlyMorning.getTime());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /waiting for/);
  assert.equal(calls.length, 0, "hour-gate must skip DB hit");
});

test("unique-id expiry: 42P01 table-missing → soft no-op", async () => {
  const { pool } = makePool(0, { failCode: "42P01" });
  const job = createUniqueIdExpiryJob({ pool, schema: "public", alwaysRun: true });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /table\/columns missing/);
});

test("unique-id expiry: unrelated DB error rethrows", async () => {
  const { pool } = makePool(0, { failCode: "08000" }); // connection_exception
  const job = createUniqueIdExpiryJob({ pool, schema: "public", alwaysRun: true });
  await assert.rejects(() => job(Date.now()), /pg-error 08000/);
});
