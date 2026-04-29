/**
 * COMP-P0-002: tester for ComplianceOutboxRepo.
 *
 * Vi mocker pg-pool og asserter mot de utstedte SQL-statementene.
 * Mål: verifisere at:
 *   - `enqueue` bruker `ON CONFLICT (idempotency_key) DO NOTHING` og
 *     returnerer `true` når raden ble inserted, `false` ellers.
 *   - `claimNextBatch` bruker SKIP LOCKED + atomisk attempts++.
 *   - `markFailed` velger 'dead_letter' ved >= MAX_ATTEMPTS.
 *   - `markProcessedByKey` bare oppdaterer pending-rader (no-op for
 *     processed/dead-letter).
 *
 * Pattern matcher BIN-761 WalletOutboxRepo.test.ts — bevisst.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ComplianceOutboxRepo,
  COMPLIANCE_OUTBOX_MAX_ATTEMPTS,
} from "./ComplianceOutboxRepo.js";

// ── Pool mock ───────────────────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

function makeFakePool(opts: {
  rowsForSelect?: unknown[];
  rowCountByPattern?: Record<string, number>;
} = {}) {
  const calls: QueryCall[] = [];
  const rowsForSelect = opts.rowsForSelect ?? [];
  const rowCountByPattern = opts.rowCountByPattern ?? {};
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      // Match by SQL substring → custom rowCount + rows
      let rowCount: number | undefined;
      for (const [pattern, count] of Object.entries(rowCountByPattern)) {
        if (sql.includes(pattern)) {
          rowCount = count;
          break;
        }
      }
      if (sql.includes("RETURNING")) {
        return {
          rows: rowsForSelect,
          rowCount: rowCount ?? rowsForSelect.length,
        };
      }
      return { rows: [], rowCount: rowCount ?? 0 };
    },
  };
  return { pool, calls };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("ComplianceOutboxRepo: konstruktør validerer schema-navn", () => {
  const { pool } = makeFakePool();
  assert.throws(
    () => new ComplianceOutboxRepo({ pool: pool as never, schema: "bad-schema!" }),
    /ugyldig schema-navn/,
  );
  // Gyldige navn skal fungere
  const r1 = new ComplianceOutboxRepo({ pool: pool as never, schema: "public" });
  assert.ok(r1);
  const r2 = new ComplianceOutboxRepo({ pool: pool as never, schema: "_alt_schema_42" });
  assert.ok(r2);
});

test("ComplianceOutboxRepo.enqueue: bruker ON CONFLICT DO NOTHING med idempotency-key", async () => {
  const { pool, calls } = makeFakePool({
    rowsForSelect: [{ id: 1 }],
  });
  const repo = new ComplianceOutboxRepo({ pool: pool as never });

  const result = await repo.enqueue({
    idempotencyKey: "STAKE:game-1:player-2:abc123",
    payload: {
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 100,
      gameId: "game-1",
      playerId: "player-2",
    },
  });

  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO/);
  assert.match(calls[0].sql, /app_compliance_outbox/);
  assert.match(calls[0].sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(calls[0].sql, /RETURNING id/);
  // Param-rekkefølge: [idempotencyKey, JSON-payload]
  assert.equal(calls[0].params[0], "STAKE:game-1:player-2:abc123");
  // Andre param er JSON.stringify av payload
  const parsed = JSON.parse(calls[0].params[1] as string);
  assert.equal(parsed.hallId, "hall-A");
  assert.equal(parsed.eventType, "STAKE");
  assert.equal(parsed.amount, 100);
});

test("ComplianceOutboxRepo.enqueue: returnerer false ved ON CONFLICT (rad fantes)", async () => {
  const { pool } = makeFakePool({
    rowsForSelect: [], // ingen rad returnert → conflict
    rowCountByPattern: { "INSERT INTO": 0 },
  });
  const repo = new ComplianceOutboxRepo({ pool: pool as never });

  const result = await repo.enqueue({
    idempotencyKey: "STAKE:dup:key",
    payload: {
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 50,
    },
  });

  assert.equal(result, false, "skal returnere false når INSERT ble no-op pga ON CONFLICT");
});

test("ComplianceOutboxRepo.enqueue: kaster ved tom idempotency-key eller payload", async () => {
  const { pool } = makeFakePool();
  const repo = new ComplianceOutboxRepo({ pool: pool as never });

  await assert.rejects(
    () => repo.enqueue({
      idempotencyKey: "",
      payload: { hallId: "h", gameType: "MAIN_GAME", channel: "HALL", eventType: "STAKE", amount: 1 },
    }),
    /idempotencyKey er påkrevd/,
  );

  await assert.rejects(
    () => repo.enqueue({
      idempotencyKey: "   ",
      payload: { hallId: "h", gameType: "MAIN_GAME", channel: "HALL", eventType: "STAKE", amount: 1 },
    }),
    /idempotencyKey er påkrevd/,
  );

  await assert.rejects(
    () => repo.enqueue({
      idempotencyKey: "valid",
      payload: null as never,
    }),
    /payload er påkrevd/,
  );
});

test("ComplianceOutboxRepo.claimNextBatch: bruker FOR UPDATE SKIP LOCKED + atomisk attempts++", async () => {
  const { pool, calls } = makeFakePool({
    rowsForSelect: [
      {
        id: 42,
        idempotency_key: "STAKE:g1:p1:abc",
        payload: {
          hallId: "hall-A",
          gameType: "MAIN_GAME",
          channel: "INTERNET",
          eventType: "STAKE",
          amount: 100,
        },
        status: "pending",
        attempts: 1,
        last_attempt_at: new Date(),
        last_error: null,
        created_at: new Date(),
        processed_at: null,
      },
    ],
  });
  const repo = new ComplianceOutboxRepo({ pool: pool as never });

  const rows = await repo.claimNextBatch(50);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 42);
  assert.equal(rows[0].idempotencyKey, "STAKE:g1:p1:abc");
  assert.equal(rows[0].payload.hallId, "hall-A");
  assert.equal(rows[0].attempts, 1);

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[0].sql, /attempts = o\.attempts \+ 1/);
  assert.match(calls[0].sql, /last_attempt_at = now\(\)/);
  assert.match(calls[0].sql, /WHERE status = 'pending'/);
  assert.equal(calls[0].params[0], 50);
});

test("ComplianceOutboxRepo.claimNextBatch: validerer limit", async () => {
  const { pool } = makeFakePool();
  const repo = new ComplianceOutboxRepo({ pool: pool as never });
  await assert.rejects(() => repo.claimNextBatch(0), /limit må være positivt/);
  await assert.rejects(() => repo.claimNextBatch(-1), /limit må være positivt/);
  await assert.rejects(() => repo.claimNextBatch(1.5), /limit må være positivt/);
});

test("ComplianceOutboxRepo.markProcessed: oppdaterer alle gitte ids", async () => {
  const { pool, calls } = makeFakePool();
  const repo = new ComplianceOutboxRepo({ pool: pool as never });

  await repo.markProcessed([1, 2, 3]);

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SET status = 'processed'/);
  assert.match(calls[0].sql, /processed_at = now\(\)/);
  assert.match(calls[0].sql, /last_error = NULL/);
  assert.match(calls[0].sql, /id = ANY\(\$1::bigint\[\]\)/);
  assert.deepEqual(calls[0].params[0], [1, 2, 3]);
});

test("ComplianceOutboxRepo.markProcessed: tom array → no-op", async () => {
  const { pool, calls } = makeFakePool();
  const repo = new ComplianceOutboxRepo({ pool: pool as never });
  await repo.markProcessed([]);
  assert.equal(calls.length, 0, "ingen DB-call ved tom liste");
});

test("ComplianceOutboxRepo.markFailed: dead_letter ved attempts >= MAX_ATTEMPTS", async () => {
  const { pool, calls } = makeFakePool();
  const repo = new ComplianceOutboxRepo({ pool: pool as never });

  // 4. forsøk → fortsatt pending
  await repo.markFailed(1, "dispatcher feilet", COMPLIANCE_OUTBOX_MAX_ATTEMPTS - 1);
  assert.equal(calls[0].params[1], "pending");

  // 5. forsøk → dead_letter
  await repo.markFailed(2, "dispatcher feilet", COMPLIANCE_OUTBOX_MAX_ATTEMPTS);
  assert.equal(calls[1].params[1], "dead_letter");

  // 6. forsøk → fortsatt dead_letter
  await repo.markFailed(3, "dispatcher feilet", COMPLIANCE_OUTBOX_MAX_ATTEMPTS + 1);
  assert.equal(calls[2].params[1], "dead_letter");
});

test("ComplianceOutboxRepo.markFailed: trunkerer feilmelding > 4000 tegn", async () => {
  const { pool, calls } = makeFakePool();
  const repo = new ComplianceOutboxRepo({ pool: pool as never });
  const longError = "X".repeat(5000);
  await repo.markFailed(1, longError, 1);
  assert.equal((calls[0].params[2] as string).length, 4000);
});

test("ComplianceOutboxRepo.markProcessedByKey: oppdaterer kun pending-rader", async () => {
  const { pool, calls } = makeFakePool({
    rowCountByPattern: { "WHERE idempotency_key": 1 },
  });
  const repo = new ComplianceOutboxRepo({ pool: pool as never });

  const updated = await repo.markProcessedByKey("STAKE:g1:p1:abc");
  assert.equal(updated, true);
  assert.match(calls[0].sql, /SET status = 'processed'/);
  assert.match(calls[0].sql, /AND status = 'pending'/);
  assert.equal(calls[0].params[0], "STAKE:g1:p1:abc");
});

test("ComplianceOutboxRepo.markProcessedByKey: returnerer false når rad ikke matcher", async () => {
  const { pool } = makeFakePool({
    rowCountByPattern: { "WHERE idempotency_key": 0 },
  });
  const repo = new ComplianceOutboxRepo({ pool: pool as never });
  const updated = await repo.markProcessedByKey("nonexistent");
  assert.equal(updated, false, "no-op når raden ikke fantes eller allerede var processed");
});

test("ComplianceOutboxRepo: parser jsonb fra string fallback (defensive mot pg-driver-quirks)", async () => {
  const { pool } = makeFakePool({
    rowsForSelect: [
      {
        id: 1,
        idempotency_key: "K",
        payload: JSON.stringify({
          hallId: "hall-X",
          gameType: "DATABINGO",
          channel: "INTERNET",
          eventType: "PRIZE",
          amount: 250,
        }),
        status: "pending",
        attempts: 1,
        last_attempt_at: null,
        last_error: null,
        created_at: new Date(),
        processed_at: null,
      },
    ],
  });
  const repo = new ComplianceOutboxRepo({ pool: pool as never });
  const rows = await repo.claimNextBatch(1);
  assert.equal(rows[0].payload.hallId, "hall-X");
  assert.equal(rows[0].payload.eventType, "PRIZE");
  assert.equal(rows[0].payload.amount, 250);
});
