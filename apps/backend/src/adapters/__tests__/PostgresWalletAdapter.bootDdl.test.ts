/**
 * PostgresWalletAdapter.bootDdl.test.ts
 *
 * DB-P0-001 unit test: verify the boot-time DDL idempotency fix.
 *
 * Before the fix, `initializeSchema()` ran `DROP CONSTRAINT IF EXISTS X`
 * + `ADD CONSTRAINT X CHECK (...)` on every cold-boot — which on a
 * populated wallet table would acquire an EXCLUSIVE lock and freeze
 * wallet writes for minutes during the validation scan.
 *
 * The fix replaces that DROP+ADD pair with a `pg_constraint` lookup:
 *   * If the constraint exists (production case after migration), do nothing.
 *   * If absent (test schema first-boot), ADD it (instant on empty table).
 *
 * This test verifies the helper behavior using a mock PoolClient — we can
 * confirm the SELECT-EXISTS query is fired AND that ADD CONSTRAINT is
 * skipped when the existence check returns true.
 *
 * Note: full integration of the wallet adapter against a real DB is
 * covered by `PostgresWalletAdapter.currency.test.ts` and others — this
 * test only exercises the new branching logic in isolation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";

/**
 * Minimal PoolClient mock that records every query() call. We reach into
 * the adapter via prototype + bind so we don't need to spin up a Pool.
 */
class MockClient {
  public queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  public existsResult = false;

  async query<T extends Record<string, unknown> = { exists: boolean }>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[] }> {
    this.queries.push({ text, values });
    if (text.includes("SELECT EXISTS")) {
      return {
        rows: [
          { exists: this.existsResult } as unknown as T,
        ],
      };
    }
    return { rows: [] };
  }
}

/**
 * Reach into the adapter prototype to invoke the private helper without
 * needing an instance with a real Pool. This is a unit test — we
 * intentionally test the implementation detail.
 */
async function callEnsureCheckConstraint(
  schema: string,
  client: MockClient,
  table: string,
  constraintName: string,
  expr: string
): Promise<void> {
  const { PostgresWalletAdapter } = await import(
    "../PostgresWalletAdapter.js"
  );
  // The helper is private — we access it via prototype + bind a fake `this`.
  const fakeThis = { schema };
  const helper = (PostgresWalletAdapter.prototype as unknown as {
    ensureCheckConstraint: (
      this: { schema: string },
      c: PoolClient,
      t: string,
      n: string,
      e: string
    ) => Promise<void>;
  }).ensureCheckConstraint;
  await helper.call(fakeThis, client as unknown as PoolClient, table, constraintName, expr);
}

test("ensureCheckConstraint: skips ADD when constraint already exists", async () => {
  const client = new MockClient();
  client.existsResult = true; // constraint already in pg_constraint

  await callEnsureCheckConstraint(
    "public",
    client,
    "wallet_accounts",
    "wallet_accounts_currency_nok_only",
    "currency = 'NOK'"
  );

  // Should run exactly ONE query — the existence check.
  assert.equal(client.queries.length, 1, "expected only the existence check");
  assert.match(client.queries[0]!.text, /SELECT EXISTS/);
  assert.deepEqual(client.queries[0]!.values, [
    "wallet_accounts_currency_nok_only",
    "wallet_accounts",
    "public",
  ]);
});

test("ensureCheckConstraint: ADDs when constraint is absent", async () => {
  const client = new MockClient();
  client.existsResult = false; // empty pg_constraint → first-boot path

  await callEnsureCheckConstraint(
    "public",
    client,
    "wallet_entries",
    "wallet_entries_currency_nok_only",
    "currency = 'NOK'"
  );

  // Two queries: existence check + ADD CONSTRAINT.
  assert.equal(client.queries.length, 2);
  assert.match(client.queries[0]!.text, /SELECT EXISTS/);
  assert.match(client.queries[1]!.text, /ALTER TABLE/);
  assert.match(client.queries[1]!.text, /ADD CONSTRAINT wallet_entries_currency_nok_only/);
  assert.match(client.queries[1]!.text, /CHECK \(currency = 'NOK'\)/);
});

test("ensureCheckConstraint: NEVER emits DROP CONSTRAINT (avoids EXCLUSIVE-lock churn)", async () => {
  const client = new MockClient();
  client.existsResult = false;
  await callEnsureCheckConstraint(
    "public",
    client,
    "wallet_transactions",
    "wallet_transactions_currency_nok_only",
    "currency = 'NOK'"
  );
  for (const q of client.queries) {
    assert.doesNotMatch(
      q.text,
      /DROP CONSTRAINT/,
      "ensureCheckConstraint must not run DROP CONSTRAINT — that's the old DDL pattern we're replacing"
    );
  }
});

test("ensureCheckConstraint: scopes existence check to the configured schema", async () => {
  const client = new MockClient();
  client.existsResult = true;
  await callEnsureCheckConstraint(
    "test_isolated_schema",
    client,
    "wallet_accounts",
    "wallet_accounts_currency_nok_only",
    "currency = 'NOK'"
  );
  assert.deepEqual(
    client.queries[0]!.values,
    [
      "wallet_accounts_currency_nok_only",
      "wallet_accounts",
      "test_isolated_schema",
    ],
    "schema-name must be passed as bind-param so two test schemas don't see each other's constraints"
  );
});
