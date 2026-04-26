/**
 * BIN-761: tester for WalletOutboxRepo.
 *
 * Vi mocker pg-pool/client og asserter mot de utstedte SQL-statementene.
 * Mål: verifisere at `enqueue` bruker passed-in PoolClient (samme tx som
 * ledger), at `claimNextBatch` bruker SKIP LOCKED + atomisk attempts++,
 * og at `markFailed` velger 'dead_letter' ved >= MAX_ATTEMPTS.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { WalletOutboxRepo, WALLET_OUTBOX_MAX_ATTEMPTS } from "./WalletOutboxRepo.js";

// ── Pool/Client mocks ───────────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

function makeFakePool(rowsForSelect: unknown[] = []) {
  const calls: QueryCall[] = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      // Returner mock-rader når UPDATE...RETURNING-mønsteret detekteres.
      if (sql.includes("RETURNING")) {
        return { rows: rowsForSelect };
      }
      return { rows: [] };
    },
  };
  return { pool, calls };
}

function makeFakeClient() {
  const calls: QueryCall[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  return { client, calls };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("BIN-761 repo: enqueue bruker passed-in client (samme tx som ledger)", async () => {
  const { pool } = makeFakePool();
  const { client, calls } = makeFakeClient();
  // `as never` for Pool — vi bruker bare pool i constructor.
  const repo = new WalletOutboxRepo({ pool: pool as never, schema: "public" });

  // pool.query skal IKKE kalles — kun client.query (samme tx)
  await repo.enqueue(client as never, {
    operationId: "tx-uuid-123",
    accountId: "acc-1",
    eventType: "wallet.credit",
    payload: { amount: 100, type: "PRIZE" },
  });

  assert.equal(calls.length, 1, "skal kalle client.query én gang");
  const c = calls[0];
  assert.match(c.sql, /INSERT INTO "public"\."wallet_outbox"/);
  assert.match(c.sql, /\$4::jsonb/);
  assert.equal(c.params[0], "tx-uuid-123");
  assert.equal(c.params[1], "acc-1");
  assert.equal(c.params[2], "wallet.credit");
  // Payload serialiseres til JSON-string
  assert.equal(typeof c.params[3], "string");
  const payload = JSON.parse(c.params[3] as string);
  assert.deepEqual(payload, { amount: 100, type: "PRIZE" });
});

test("BIN-761 repo: enqueue avviser uten operationId/accountId/eventType", async () => {
  const { pool } = makeFakePool();
  const { client } = makeFakeClient();
  const repo = new WalletOutboxRepo({ pool: pool as never, schema: "public" });

  await assert.rejects(
    () =>
      repo.enqueue(client as never, {
        operationId: "",
        accountId: "acc-1",
        eventType: "wallet.credit",
        payload: {},
      }),
    /påkrevd/,
  );
});

test("BIN-761 repo: claimNextBatch bruker FOR UPDATE SKIP LOCKED + atomisk increment", async () => {
  const mockRow = {
    id: 42,
    operation_id: "op-1",
    account_id: "acc-1",
    event_type: "wallet.credit",
    payload: { amount: 50 },
    status: "pending",
    attempts: 1,
    last_attempt_at: new Date(),
    last_error: null,
    created_at: new Date(),
    processed_at: null,
  };
  const { pool, calls } = makeFakePool([mockRow]);
  const repo = new WalletOutboxRepo({ pool: pool as never, schema: "public" });

  const rows = await repo.claimNextBatch(50);
  assert.equal(calls.length, 1);
  const sql = calls[0].sql;
  assert.match(sql, /FOR UPDATE SKIP LOCKED/, "MÅ bruke SKIP LOCKED for trygg multi-worker-poll");
  assert.match(sql, /attempts = o\.attempts \+ 1/, "atomisk attempts-increment");
  assert.match(sql, /last_attempt_at = now\(\)/);
  assert.equal(calls[0].params[0], 50);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 42);
  assert.equal(rows[0].operationId, "op-1");
  assert.equal(rows[0].attempts, 1);
});

test("BIN-761 repo: markProcessed setter status + processed_at", async () => {
  const { pool, calls } = makeFakePool();
  const repo = new WalletOutboxRepo({ pool: pool as never, schema: "public" });

  await repo.markProcessed([1, 2, 3]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SET status = 'processed'/);
  assert.match(calls[0].sql, /processed_at = now\(\)/);
  assert.match(calls[0].sql, /last_error = NULL/);
  assert.deepEqual(calls[0].params, [[1, 2, 3]]);
});

test("BIN-761 repo: markProcessed med tom liste short-circuiter (ingen DB-call)", async () => {
  const { pool, calls } = makeFakePool();
  const repo = new WalletOutboxRepo({ pool: pool as never, schema: "public" });

  await repo.markProcessed([]);
  assert.equal(calls.length, 0);
});

test("BIN-761 repo: markFailed velger 'dead_letter' ved attempts >= MAX", async () => {
  const { pool, calls } = makeFakePool();
  const repo = new WalletOutboxRepo({ pool: pool as never, schema: "public" });

  await repo.markFailed(99, "boom", WALLET_OUTBOX_MAX_ATTEMPTS);
  assert.equal(calls.length, 1);
  // params[1] er status — etter MAX: 'dead_letter'
  assert.equal(calls[0].params[1], "dead_letter");
});

test("BIN-761 repo: markFailed beholder 'pending' når attempts < MAX", async () => {
  const { pool, calls } = makeFakePool();
  const repo = new WalletOutboxRepo({ pool: pool as never, schema: "public" });

  await repo.markFailed(99, "boom", 1);
  assert.equal(calls[0].params[1], "pending");
});

test("BIN-761 repo: markFailed truncater error-strings over 4000 tegn", async () => {
  const { pool, calls } = makeFakePool();
  const repo = new WalletOutboxRepo({ pool: pool as never, schema: "public" });

  const huge = "x".repeat(5000);
  await repo.markFailed(99, huge, 1);
  const errParam = calls[0].params[2] as string;
  assert.equal(errParam.length, 4000, "skal trunkere til 4000 tegn");
});

test("BIN-761 repo: ugyldig schema-navn avvises i constructor", () => {
  const { pool } = makeFakePool();
  assert.throws(
    () => new WalletOutboxRepo({ pool: pool as never, schema: "evil; DROP TABLE x;" }),
    /ugyldig schema-navn/,
  );
});

test("BIN-761 repo: claimNextBatch med limit <= 0 kaster", async () => {
  const { pool } = makeFakePool();
  const repo = new WalletOutboxRepo({ pool: pool as never, schema: "public" });

  await assert.rejects(() => repo.claimNextBatch(0), /positivt heltall/);
  await assert.rejects(() => repo.claimNextBatch(-5), /positivt heltall/);
});
