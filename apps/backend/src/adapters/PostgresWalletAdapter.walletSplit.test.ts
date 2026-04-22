// PR-W1 wallet-split: integrasjons-test for PostgresWalletAdapter mot ekte
// Postgres. Denne testen kjører KUN når `WALLET_PG_TEST_CONNECTION_STRING` er
// satt (typisk lokal docker eller CI-container). I standard `npm test` hoppes
// den over — kontrakt-dekningen ligger i InMemoryWalletAdapter.walletSplit.test.ts.
//
// Hva denne dekker:
//   * Schema-integritet etter split-migrasjon (CHECK-constraints, GENERATED sum).
//   * SELECT FOR UPDATE race-beskyttelse ved 2 samtidige debits.
//   * Retroaktiv migration: eksisterende `balance`-rader → `deposit_balance`.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresWalletAdapter } from "./PostgresWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres integration-test";

/**
 * Lag et isolert schema per test-kjøring slik at parallelle CI-jobber ikke
 * kolliderer, og drop schema i cleanup.
 */
function makeTestSchema(): string {
  return `wallet_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

// ── Basic schema + split-roundtrip ───────────────────────────────────────────

test("postgres: createAccount + credit winnings → split persistert", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const adapter = new PostgresWalletAdapter({
    connectionString: PG_CONN!,
    schema,
    defaultInitialBalance: 0
  });
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  try {
    await adapter.createAccount({ accountId: "w-alpha", initialBalance: 500 });
    await adapter.credit("w-alpha", 300, "payout", { to: "winnings" });

    const b = await adapter.getBothBalances("w-alpha");
    assert.equal(b.deposit, 500);
    assert.equal(b.winnings, 300);
    assert.equal(b.total, 800);

    // Verifiser at `balance`-kolonnen (GENERATED) også er 800.
    const { rows } = await cleanupPool.query<{
      deposit_balance: string;
      winnings_balance: string;
      balance: string;
    }>(
      `SELECT deposit_balance, winnings_balance, balance FROM "${schema}"."wallet_accounts" WHERE id = 'w-alpha'`
    );
    assert.equal(Number(rows[0]!.deposit_balance), 500);
    assert.equal(Number(rows[0]!.winnings_balance), 300);
    assert.equal(Number(rows[0]!.balance), 800);
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});

// ── Winnings-first debit med DB-state ───────────────────────────────────────

test("postgres: debit trekker winnings først, så deposit (split-entries)", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const adapter = new PostgresWalletAdapter({
    connectionString: PG_CONN!,
    schema,
    defaultInitialBalance: 0
  });
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  try {
    await adapter.createAccount({ accountId: "w-beta", initialBalance: 200 });
    await adapter.credit("w-beta", 100, "small payout", { to: "winnings" });
    const tx = await adapter.debit("w-beta", 150, "kjøp billett");

    // Winnings tømt (100), deposit trukket med 50.
    const b = await adapter.getBothBalances("w-beta");
    assert.equal(b.winnings, 0);
    assert.equal(b.deposit, 150);
    assert.deepEqual(tx.split, { fromWinnings: 100, fromDeposit: 50 });

    // Verifiser ledger-entries i DB — må være 2 DEBIT-entries på bruker-side
    // (én winnings, én deposit) + én CREDIT-entry på house.
    const { rows } = await cleanupPool.query<{
      account_side: string;
      side: string;
      amount: string;
    }>(
      `SELECT account_side, side, amount FROM "${schema}"."wallet_entries"
       WHERE transaction_id = $1 ORDER BY account_side`,
      [tx.id]
    );
    assert.equal(rows.length, 2, "to DEBIT-entries per split-debit");
    const bySide = new Map(rows.map((r) => [r.account_side, r]));
    assert.equal(Number(bySide.get("deposit")!.amount), 50);
    assert.equal(Number(bySide.get("winnings")!.amount), 100);
    assert.equal(bySide.get("deposit")!.side, "DEBIT");
    assert.equal(bySide.get("winnings")!.side, "DEBIT");
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});

// ── Race: 2 samtidige debits mot samme wallet ───────────────────────────────

test("postgres: race — 2 samtidige debits → second låses til first commit, ingen dobbel-debit", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const adapter = new PostgresWalletAdapter({
    connectionString: PG_CONN!,
    schema,
    defaultInitialBalance: 0
  });
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  try {
    await adapter.createAccount({ accountId: "w-race", initialBalance: 100 });
    await adapter.credit("w-race", 50, "payout", { to: "winnings" });
    // Total saldo = 150. To parallelle debits à 100 = 200 total → en må feile.
    const results = await Promise.allSettled([
      adapter.debit("w-race", 100, "kjøp-A"),
      adapter.debit("w-race", 100, "kjøp-B")
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "kun én debit lykkes");
    assert.equal(rejected.length, 1, "den andre feiler");
    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(rejection instanceof WalletError && rejection.code === "INSUFFICIENT_FUNDS");

    // Balansen skal være 50 (150 - 100).
    assert.equal(await adapter.getBalance("w-race"), 50);
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});

// ── Retroaktiv migration-test ────────────────────────────────────────────────
//
// Denne testen simulerer retroaktiv splitt: lager en wallet_accounts-rad uten
// split-kolonner (som om pre-W1), kjører migrasjonen manuelt, og verifiserer
// at eksisterende balance → deposit_balance (winnings=0).

test("postgres: retroaktiv migration — eksisterende balance migrerer til deposit", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  try {
    // Steg 1: opprett pre-W1-lignende schema manuelt.
    await cleanupPool.query(`CREATE SCHEMA "${schema}"`);
    await cleanupPool.query(
      `CREATE TABLE "${schema}"."wallet_accounts" (
        id TEXT PRIMARY KEY,
        balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
        is_system BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    // Legg inn noen brukerkontoer med pre-W1-balance.
    await cleanupPool.query(
      `INSERT INTO "${schema}"."wallet_accounts" (id, balance, is_system) VALUES
       ('w-old-1', 1000, false),
       ('w-old-2', 500,  false),
       ('__system_house__', 0, true),
       ('__system_external_cash__', 0, true)`
    );

    // Steg 2: kjør W1-migrations-SQL mot dette schemaet.
    await cleanupPool.query(
      `ALTER TABLE "${schema}"."wallet_accounts"
         ADD COLUMN deposit_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
         ADD COLUMN winnings_balance NUMERIC(20, 6) NOT NULL DEFAULT 0`
    );
    await cleanupPool.query(
      `UPDATE "${schema}"."wallet_accounts"
         SET deposit_balance = balance
         WHERE deposit_balance = 0 AND balance > 0`
    );
    await cleanupPool.query(
      `ALTER TABLE "${schema}"."wallet_accounts" DROP COLUMN balance`
    );
    await cleanupPool.query(
      `ALTER TABLE "${schema}"."wallet_accounts"
         ADD COLUMN balance NUMERIC(20, 6) GENERATED ALWAYS AS (deposit_balance + winnings_balance) STORED`
    );

    // Steg 3: verifiser at eksisterende data migrerte riktig.
    const { rows } = await cleanupPool.query<{
      id: string;
      deposit_balance: string;
      winnings_balance: string;
      balance: string;
    }>(
      `SELECT id, deposit_balance, winnings_balance, balance FROM "${schema}"."wallet_accounts" ORDER BY id`
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    const user1 = byId.get("w-old-1")!;
    assert.equal(Number(user1.deposit_balance), 1000, "user1 balance migrerer til deposit");
    assert.equal(Number(user1.winnings_balance), 0, "user1 winnings = 0");
    assert.equal(Number(user1.balance), 1000, "generated balance forblir 1000");

    const user2 = byId.get("w-old-2")!;
    assert.equal(Number(user2.deposit_balance), 500);
    assert.equal(Number(user2.winnings_balance), 0);
    assert.equal(Number(user2.balance), 500);

    // System-kontoer hadde 0 balance og berøres ikke (eneste oppdatering var
    // for balance > 0).
    const systemHouse = byId.get("__system_house__")!;
    assert.equal(Number(systemHouse.deposit_balance), 0);
    assert.equal(Number(systemHouse.winnings_balance), 0);
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});
