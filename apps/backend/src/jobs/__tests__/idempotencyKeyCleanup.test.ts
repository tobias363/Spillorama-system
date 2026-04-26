/**
 * BIN-767 — tester for `idempotency-key-cleanup` cron-job.
 *
 * Dekker (3 krevde + utvidelser for casino-grade-kvalitet):
 *   1. Cleanup kjører — gamle nøkler nullsettes, recent rad slipper unna
 *   2. Idempotent re-run — andre kjøring samme dag er no-op (date-key)
 *   3. Tabell-mangler-feil (42P01) → soft-no-op
 *
 * Bruker en in-memory Pool-mock som etterligner PostgreSQL ctid-batch-
 * pattern. Vi simulerer ikke ekte SQL — vi verifiserer at jobben kaller
 * pool.query med riktige parametre og oppfører seg riktig på respons.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { createIdempotencyKeyCleanupJob } from "../idempotencyKeyCleanup.js";

interface FakeRow {
  id: string;
  idempotency_key: string | null;
  created_at: Date;
}

interface FakePoolState {
  rows: FakeRow[];
  queries: Array<{ sql: string; params: unknown[] }>;
  failNext?: { code?: string; message: string };
}

/**
 * Bygger en Pool-mock som tolker UPDATE-spørringen vår: NULL-er
 * `idempotency_key` på opptil `LIMIT $2` rader hvor `idempotency_key IS NOT NULL`
 * og `created_at < now() - $1 * INTERVAL '1 day'`.
 *
 * Returnerer rowCount som matcher antall rader som faktisk ble oppdatert.
 */
function makePool(initial: FakeRow[]): { pool: Pool; state: FakePoolState } {
  const state: FakePoolState = {
    rows: [...initial],
    queries: [],
  };

  const pool = {
    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: unknown[] = []
    ): Promise<QueryResult<T>> {
      state.queries.push({ sql, params });

      if (state.failNext) {
        const err = new Error(state.failNext.message) as Error & { code?: string };
        err.code = state.failNext.code;
        state.failNext = undefined;
        throw err;
      }

      // Tolk UPDATE-with-CTE. params: [retentionDays, batchSize].
      const retentionDays = params[0] as number;
      const batchSize = params[1] as number;
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      const targets: FakeRow[] = [];
      for (const row of state.rows) {
        if (targets.length >= batchSize) break;
        if (row.idempotency_key !== null && row.created_at.getTime() < cutoff) {
          targets.push(row);
        }
      }
      for (const t of targets) {
        t.idempotency_key = null;
      }
      return {
        rows: [],
        rowCount: targets.length,
        command: "UPDATE",
        oid: 0,
        fields: [],
      } as unknown as QueryResult<T>;
    },
  } as unknown as Pool;

  return { pool, state };
}

function makeRow(id: string, ageDays: number, key: string | null): FakeRow {
  return {
    id,
    idempotency_key: key,
    created_at: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000),
  };
}

// ── Test 1: Cleanup kjører + slipper recent ───────────────────────────────

test("idempotency-key-cleanup: NULL-er gamle nøkler, lar ferske stå", async () => {
  const { pool, state } = makePool([
    makeRow("old-1", 100, "key-1"), // > 90 dager → skal nulles
    makeRow("old-2", 95, "key-2"), // > 90 dager → skal nulles
    makeRow("recent", 5, "key-3"), // < 90 dager → skal IKKE nulles
    makeRow("already-null", 100, null), // null fra før → skal hoppes over
  ]);

  const job = createIdempotencyKeyCleanupJob({
    pool,
    schema: "public",
    retentionDays: 90,
    batchSize: 1000,
    alwaysRun: true,
  });

  const result = await job(Date.now());

  assert.equal(result.itemsProcessed, 2, "skal nullsette de 2 gamle radene");
  assert.match(result.note ?? "", /pruned=2/);
  assert.match(result.note ?? "", /retentionDays=90/);

  // Verifiser at recent fortsatt har sin nøkkel
  const recent = state.rows.find((r) => r.id === "recent");
  assert.equal(recent?.idempotency_key, "key-3", "recent rad skal beholde key");
  // Og at de gamle er nullet
  const old1 = state.rows.find((r) => r.id === "old-1");
  const old2 = state.rows.find((r) => r.id === "old-2");
  assert.equal(old1?.idempotency_key, null);
  assert.equal(old2?.idempotency_key, null);
});

// ── Test 2: Idempotent re-run ─────────────────────────────────────────────

test("idempotency-key-cleanup: re-run samme dag → no-op (date-key)", async () => {
  const { pool, state } = makePool([
    makeRow("old-1", 100, "key-1"),
    makeRow("old-2", 100, "key-2"),
  ]);

  const job = createIdempotencyKeyCleanupJob({
    pool,
    schema: "public",
    retentionDays: 90,
    batchSize: 1000,
    runAtHourLocal: 0, // tillat kjøring til enhver tid
  });

  const morningMs = new Date("2026-04-26T05:00:00").getTime();
  const r1 = await job(morningMs);
  assert.equal(r1.itemsProcessed, 2, "første kall skal prune begge");

  const queriesAfterFirst = state.queries.length;

  // Andre kall samme dag — skal være no-op via lastRunDateKey
  const laterMs = new Date("2026-04-26T08:00:00").getTime();
  const r2 = await job(laterMs);
  assert.equal(r2.itemsProcessed, 0);
  assert.match(r2.note ?? "", /already ran today/);
  // Ingen ny SQL-kall
  assert.equal(
    state.queries.length,
    queriesAfterFirst,
    "andre kall skal ikke gjøre SQL-spørringer"
  );
});

// ── Test 3: Tabell mangler → soft-no-op ───────────────────────────────────

test("idempotency-key-cleanup: 42P01 fra Postgres → soft no-op", async () => {
  const { pool, state } = makePool([makeRow("any", 100, "key")]);
  state.failNext = {
    code: "42P01",
    message: 'relation "wallet_transactions" does not exist',
  };

  const job = createIdempotencyKeyCleanupJob({
    pool,
    schema: "public",
    retentionDays: 90,
    alwaysRun: true,
  });

  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /tabell mangler/i);
});

// ── Bonus: batch-loop fungerer ────────────────────────────────────────────

test("idempotency-key-cleanup: batch-loop håndterer flere iterasjoner", async () => {
  // 25 gamle rader, batchSize 10 → 3 iterasjoner (10 + 10 + 5)
  const rows: FakeRow[] = [];
  for (let i = 0; i < 25; i++) {
    rows.push(makeRow(`old-${i}`, 100, `key-${i}`));
  }
  const { pool, state } = makePool(rows);

  const job = createIdempotencyKeyCleanupJob({
    pool,
    schema: "public",
    retentionDays: 90,
    batchSize: 10,
    alwaysRun: true,
  });

  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 25);
  assert.match(result.note ?? "", /pruned=25/);
  assert.match(result.note ?? "", /batches=3/);
  // Alle skal være null nå
  for (const row of state.rows) {
    assert.equal(row.idempotency_key, null);
  }
});

// ── Bonus: før runAtHour → waiting-note ───────────────────────────────────

test("idempotency-key-cleanup: før runAtHour → waiting-note, ingen SQL", async () => {
  const { pool, state } = makePool([makeRow("old", 100, "k")]);
  const job = createIdempotencyKeyCleanupJob({
    pool,
    schema: "public",
    retentionDays: 90,
    runAtHourLocal: 4,
  });

  // Klokka er 02:00 — før 04:00
  const tooEarlyMs = new Date("2026-04-26T02:00:00").getTime();
  const result = await job(tooEarlyMs);
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /waiting for 04:00/);
  assert.equal(state.queries.length, 0, "ingen SQL skal kjøres før runAtHour");
});

// ── Bonus: ikke-42P01 feil propageres ─────────────────────────────────────

test("idempotency-key-cleanup: ikke-42P01 feil propageres", async () => {
  const { pool, state } = makePool([makeRow("old", 100, "k")]);
  state.failNext = {
    code: "23505",
    message: "unexpected catastrophe",
  };

  const job = createIdempotencyKeyCleanupJob({
    pool,
    schema: "public",
    retentionDays: 90,
    alwaysRun: true,
  });

  await assert.rejects(() => job(Date.now()), /unexpected catastrophe/);
});
