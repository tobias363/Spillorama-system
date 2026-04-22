// PR-W3 wallet-split: integrasjons-test for PostgresWalletAdapter.transfer
// med nye `targetSide`-option. Kjører KUN når
// `WALLET_PG_TEST_CONNECTION_STRING` er satt (opt-in i `npm test`).
//
// Hva denne dekker:
//   * transfer med targetSide='winnings' lander CREDIT på winnings_balance
//   * default (ingen targetSide) lander fortsatt på deposit_balance
//   * wallet_entries.account_side settes riktig per row
//   * system-konto som mottaker: targetSide='winnings' ignoreres (deposit)
//   * split på begge tx-rader (fromTx+toTx) reflekterer fordelingen

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresWalletAdapter } from "./PostgresWalletAdapter.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres integration-test";

function makeTestSchema(): string {
  return `wallet_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

// ── targetSide='winnings' krediterer winnings_balance ───────────────────────

test(
  "postgres transfer targetSide='winnings': CREDIT lander på winnings_balance",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      await adapter.createAccount({ accountId: "house-source", initialBalance: 2000 });
      await adapter.createAccount({ accountId: "player-alpha", initialBalance: 100 });

      const result = await adapter.transfer(
        "house-source",
        "player-alpha",
        500,
        "Spill 1 prize",
        { targetSide: "winnings" }
      );

      const balances = await adapter.getBothBalances("player-alpha");
      assert.equal(balances.deposit, 100, "deposit uendret — winnings-target");
      assert.equal(balances.winnings, 500, "winnings +500");
      assert.equal(balances.total, 600);

      // Verifiser wallet_entries: CREDIT-entry på winnings-siden.
      const { rows } = await cleanupPool.query<{
        account_side: string;
        side: string;
        amount: string;
      }>(
        `SELECT account_side, side, amount
         FROM "${schema}"."wallet_entries"
         WHERE transaction_id = $1`,
        [result.toTx.id]
      );
      assert.equal(rows.length, 1, "én CREDIT-entry på mottaker-siden");
      assert.equal(rows[0]!.account_side, "winnings");
      assert.equal(rows[0]!.side, "CREDIT");
      assert.equal(Number(rows[0]!.amount), 500);

      // toTx.split reflekterer winnings.
      assert.deepEqual(result.toTx.split, { fromDeposit: 0, fromWinnings: 500 });
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  }
);

// ── default (ingen targetSide) bakoverkompat ────────────────────────────────

test(
  "postgres transfer default (ingen targetSide): CREDIT lander på deposit_balance",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      await adapter.createAccount({ accountId: "from-acct", initialBalance: 1000 });
      await adapter.createAccount({ accountId: "to-acct", initialBalance: 0 });

      const result = await adapter.transfer("from-acct", "to-acct", 250, "refund");

      const balances = await adapter.getBothBalances("to-acct");
      assert.equal(balances.deposit, 250);
      assert.equal(balances.winnings, 0, "winnings uendret — default target");

      const { rows } = await cleanupPool.query<{
        account_side: string;
        side: string;
      }>(
        `SELECT account_side, side FROM "${schema}"."wallet_entries"
         WHERE transaction_id = $1`,
        [result.toTx.id]
      );
      assert.equal(rows[0]!.account_side, "deposit");
      assert.equal(rows[0]!.side, "CREDIT");
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  }
);

// ── avsender winnings-first fortsatt virker ─────────────────────────────────

test(
  "postgres transfer targetSide='winnings': avsender bruker winnings-first på sin side",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      // Avsender har både deposit (fra initialBalance) og winnings.
      await adapter.createAccount({ accountId: "mixed-sender", initialBalance: 200 });
      await adapter.credit("mixed-sender", 100, "prior payout", { to: "winnings" });
      // Pre-transfer: deposit=200, winnings=100, total=300
      await adapter.createAccount({ accountId: "receiver", initialBalance: 0 });

      const result = await adapter.transfer(
        "mixed-sender",
        "receiver",
        150,
        "pass-through",
        { targetSide: "winnings" }
      );

      // Avsender: winnings tømt (100), deposit trukket 50.
      const senderBalances = await adapter.getBothBalances("mixed-sender");
      assert.equal(senderBalances.winnings, 0, "avsender winnings tømt");
      assert.equal(senderBalances.deposit, 150, "avsender deposit redusert 50");
      assert.deepEqual(result.fromTx.split, { fromWinnings: 100, fromDeposit: 50 });

      // Mottaker: ALT på winnings.
      const receiverBalances = await adapter.getBothBalances("receiver");
      assert.equal(receiverBalances.winnings, 150);
      assert.equal(receiverBalances.deposit, 0);

      // wallet_entries for avsender: to DEBIT-entries (winnings + deposit).
      const { rows: fromEntries } = await cleanupPool.query<{
        account_side: string;
        side: string;
        amount: string;
      }>(
        `SELECT account_side, side, amount FROM "${schema}"."wallet_entries"
         WHERE transaction_id = $1
         ORDER BY account_side`,
        [result.fromTx.id]
      );
      assert.equal(fromEntries.length, 2, "to DEBIT-entries for split-avsender");
      const byFromSide = new Map(fromEntries.map((r) => [r.account_side, r]));
      assert.equal(Number(byFromSide.get("winnings")!.amount), 100);
      assert.equal(Number(byFromSide.get("deposit")!.amount), 50);
      assert.equal(byFromSide.get("winnings")!.side, "DEBIT");
      assert.equal(byFromSide.get("deposit")!.side, "DEBIT");

      // wallet_entries for mottaker: én CREDIT på winnings.
      const { rows: toEntries } = await cleanupPool.query<{
        account_side: string;
        side: string;
        amount: string;
      }>(
        `SELECT account_side, side, amount FROM "${schema}"."wallet_entries"
         WHERE transaction_id = $1`,
        [result.toTx.id]
      );
      assert.equal(toEntries.length, 1);
      assert.equal(toEntries[0]!.account_side, "winnings");
      assert.equal(Number(toEntries[0]!.amount), 150);
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  }
);

// ── idempotencyKey med targetSide ───────────────────────────────────────────

test(
  "postgres transfer idempotencyKey: gjentatt payout med targetSide='winnings' gir samme tx",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      await adapter.createAccount({ accountId: "src", initialBalance: 1000 });
      await adapter.createAccount({ accountId: "dst", initialBalance: 0 });

      const r1 = await adapter.transfer("src", "dst", 200, "prize", {
        idempotencyKey: "retry-1",
        targetSide: "winnings",
      });
      const r2 = await adapter.transfer("src", "dst", 200, "prize", {
        idempotencyKey: "retry-1",
        targetSide: "winnings",
      });

      assert.equal(r1.fromTx.id, r2.fromTx.id, "samme fromTx returneres");

      // Saldo skal kun trekkes én gang.
      const balances = await adapter.getBothBalances("dst");
      assert.equal(balances.winnings, 200, "winnings kun +200 (ikke 400)");
      assert.equal(balances.deposit, 0);
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  }
);
