// BIN-766 wallet casino-grade review: multi-currency-readiness.
//
// Postgres-integrasjon: bekrefter at currency-kolonnen finnes på alle tre
// wallet-tabellene med default 'NOK', og at CHECK-constraint blokkerer
// cross-currency-mismatch (forsøk på å skrive non-NOK).
//
// Kjører kun når WALLET_PG_TEST_CONNECTION_STRING er satt — i standard
// `npm test` hopper vi over og dekkes av kontrakt-tester i
// InMemoryWalletAdapter.currency.test.ts.

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
  return `wallet_currency_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

test(
  "postgres BIN-766: nye kontoer + tx-er har currency='NOK' som default",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      await adapter.createAccount({ accountId: "w-cur-1", initialBalance: 500 });
      await adapter.topUp("w-cur-1", 200, "Topup test");

      // Verifiser at currency-kolonnen er populated og defaulter til NOK.
      const accRows = await cleanupPool.query<{ currency: string }>(
        `SELECT currency FROM "${schema}"."wallet_accounts" WHERE id = 'w-cur-1'`
      );
      assert.equal(accRows.rows[0]?.currency, "NOK", "account.currency = NOK");

      const txRows = await cleanupPool.query<{ currency: string }>(
        `SELECT currency FROM "${schema}"."wallet_transactions" WHERE account_id = 'w-cur-1' ORDER BY created_at`
      );
      assert.ok(txRows.rows.length >= 1, "minst én tx skal være registrert");
      for (const row of txRows.rows) {
        assert.equal(row.currency, "NOK", "alle tx-er skal være NOK");
      }

      const entryRows = await cleanupPool.query<{ currency: string }>(
        `SELECT currency FROM "${schema}"."wallet_entries" WHERE account_id = 'w-cur-1'`
      );
      assert.ok(entryRows.rows.length >= 1, "minst én entry skal finnes");
      for (const row of entryRows.rows) {
        assert.equal(row.currency, "NOK", "alle entries skal være NOK");
      }
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  }
);

test(
  "postgres BIN-766: CHECK-constraint blokkerer non-NOK insert (cross-currency-mismatch)",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      // Bootstrap schema + tabeller
      await adapter.createAccount({ accountId: "w-cur-2", initialBalance: 100 });

      // Forsøk å sette currency='EUR' på wallet_accounts → må feile.
      let accountsBlocked = false;
      try {
        await cleanupPool.query(
          `UPDATE "${schema}"."wallet_accounts" SET currency = 'EUR' WHERE id = 'w-cur-2'`
        );
      } catch (err: unknown) {
        accountsBlocked = true;
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err);
        assert.match(msg, /check|constraint/, "CHECK-violation skal bli kastet");
      }
      assert.ok(accountsBlocked, "wallet_accounts CHECK skal blokkere EUR");

      // Forsøk å sette currency='SEK' på wallet_transactions → må feile.
      let txsBlocked = false;
      try {
        await cleanupPool.query(
          `UPDATE "${schema}"."wallet_transactions" SET currency = 'SEK' WHERE account_id = 'w-cur-2'`
        );
      } catch (err: unknown) {
        txsBlocked = true;
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err);
        assert.match(msg, /check|constraint/);
      }
      assert.ok(txsBlocked, "wallet_transactions CHECK skal blokkere SEK");

      // Forsøk å sette currency='USD' på wallet_entries → må feile.
      let entriesBlocked = false;
      try {
        await cleanupPool.query(
          `UPDATE "${schema}"."wallet_entries" SET currency = 'USD' WHERE account_id = 'w-cur-2'`
        );
      } catch (err: unknown) {
        entriesBlocked = true;
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err);
        assert.match(msg, /check|constraint/);
      }
      assert.ok(entriesBlocked, "wallet_entries CHECK skal blokkere USD");
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  }
);
