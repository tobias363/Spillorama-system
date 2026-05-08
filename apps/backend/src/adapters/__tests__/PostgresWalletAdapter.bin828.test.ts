/**
 * BIN-828 unit test: verify that PostgresWalletAdapter.initializeSchema()
 * does NOT include CREATE TABLE wallet_accounts (or other wallet tables)
 * in its DDL.
 *
 * Bakgrunn: Backend runtime-init opprettet wallet_accounts FØR migrate
 * kjørte. Da migrate kjørte etterpå, feilet
 * `INSERT INTO wallet_accounts (id, balance, is_system) VALUES (...)`
 * (fra `20260413000001_initial_schema.sql`) fordi `balance` var
 * GENERATED ALWAYS AS (...) STORED etter
 * `20260606000000_wallet_split_deposit_winnings.sql`.
 *
 * Fix-strategi (per Linear-issue): fjern wallet_accounts/transactions/
 * entries/reservations CREATE TABLE fra `initializeSchema`. Migrations
 * er nå eneste sannhetskilde for skjemaet. I prod kjører
 * `render.yaml buildCommand` migrate FØR backend startCommand, så
 * tabellene eksisterer alltid før initializeSchema kalles.
 *
 * Denne testen bruker en mock PoolClient og kaller `initializeSchema`
 * direkte (via prototype + bind, samme mønster som `bootDdl.test.ts`).
 * Vi recorder alle queries og asserter at INGEN inneholder
 * `CREATE TABLE wallet_accounts/transactions/entries/reservations`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";

interface QueryRecord {
  text: string;
  values?: readonly unknown[];
}

class MockClient {
  public queries: QueryRecord[] = [];

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ text, values });
    // Mock-responses for the queries we know `initializeSchema` runs.
    if (text.includes("SELECT EXISTS")) {
      // pg_constraint lookup — pretend constraint already exists so we
      // skip the ADD CONSTRAINT branch (production no-op path).
      return {
        rows: [{ exists: true } as unknown as T],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    /* noop */
  }
}

class MockPool {
  public client = new MockClient();

  async connect(): Promise<PoolClient> {
    return this.client as unknown as PoolClient;
  }
}

async function runInitializeSchemaWithMock(): Promise<MockClient> {
  const { PostgresWalletAdapter } = await import("../PostgresWalletAdapter.js");
  // Construct adapter with a stub pool — we need to bypass the constructor's
  // requirement of either `pool` or `connectionString`.
  const pool = new MockPool();
  const adapter = new PostgresWalletAdapter({
    pool: pool as unknown as Pool,
    schema: "public",
    defaultInitialBalance: 0,
  });
  // Reach into private `initializeSchema` via prototype — same approach as
  // `bootDdl.test.ts` for testing private DDL paths.
  const initializeSchema = (
    PostgresWalletAdapter.prototype as unknown as {
      initializeSchema: (this: unknown) => Promise<void>;
    }
  ).initializeSchema;
  await initializeSchema.call(adapter);
  return pool.client;
}

test("BIN-828: initializeSchema does NOT issue CREATE TABLE wallet_accounts", async () => {
  const client = await runInitializeSchemaWithMock();
  for (const q of client.queries) {
    // wallet_accounts has been removed from runtime-init — migrations own
    // the schema. The duplicate CREATE TABLE caused a conflict with
    // `INSERT INTO wallet_accounts (..., balance, ...)` in
    // `20260413000001_initial_schema.sql` after the `balance` column was
    // converted to GENERATED in `20260606000000_*.sql`.
    assert.doesNotMatch(
      q.text,
      /CREATE TABLE\s+(IF NOT EXISTS\s+)?["\w.]*wallet_accounts/i,
      `BIN-828: initializeSchema må IKKE inneholde CREATE TABLE wallet_accounts. Fant query: ${q.text.slice(0, 200)}`
    );
  }
});

test("BIN-828: initializeSchema does NOT issue CREATE TABLE wallet_transactions", async () => {
  const client = await runInitializeSchemaWithMock();
  for (const q of client.queries) {
    assert.doesNotMatch(
      q.text,
      /CREATE TABLE\s+(IF NOT EXISTS\s+)?["\w.]*wallet_transactions/i,
      `BIN-828: initializeSchema må IKKE inneholde CREATE TABLE wallet_transactions. Fant: ${q.text.slice(0, 200)}`
    );
  }
});

test("BIN-828: initializeSchema does NOT issue CREATE TABLE wallet_entries", async () => {
  const client = await runInitializeSchemaWithMock();
  for (const q of client.queries) {
    assert.doesNotMatch(
      q.text,
      /CREATE TABLE\s+(IF NOT EXISTS\s+)?["\w.]*wallet_entries/i,
      `BIN-828: initializeSchema må IKKE inneholde CREATE TABLE wallet_entries. Fant: ${q.text.slice(0, 200)}`
    );
  }
});

test("BIN-828: initializeSchema does NOT issue CREATE TABLE app_wallet_reservations", async () => {
  const client = await runInitializeSchemaWithMock();
  for (const q of client.queries) {
    assert.doesNotMatch(
      q.text,
      /CREATE TABLE\s+(IF NOT EXISTS\s+)?["\w.]*app_wallet_reservations/i,
      `BIN-828: initializeSchema må IKKE inneholde CREATE TABLE app_wallet_reservations. Fant: ${q.text.slice(0, 200)}`
    );
  }
});

test("BIN-828: initializeSchema beholder defensiv ALTER TABLE for currency-kolonnen (idempotent på prod-DB)", async () => {
  const client = await runInitializeSchemaWithMock();
  // Defensiv ALTER er fortsatt på plass — ADD COLUMN IF NOT EXISTS er
  // idempotent og no-op når migrasjon allerede har lagt til kolonnen.
  const hasCurrencyAlter = client.queries.some((q) =>
    /ALTER TABLE\s+["\w.]*wallet_accounts.*ADD COLUMN IF NOT EXISTS currency/is.test(q.text)
  );
  assert.ok(
    hasCurrencyAlter,
    "ALTER TABLE wallet_accounts ADD COLUMN IF NOT EXISTS currency skal være beholdt som idempotent defensiv operasjon"
  );
});

test("BIN-828: initializeSchema kjører fortsatt insertSystemAccountIfMissing for __system_house__ + __system_external_cash__", async () => {
  const client = await runInitializeSchemaWithMock();
  const houseInsert = client.queries.find((q) =>
    q.text.includes("INSERT INTO") &&
    q.text.includes("wallet_accounts") &&
    q.values?.[0] === "__system_house__"
  );
  assert.ok(
    houseInsert,
    "INSERT for __system_house__ skal være beholdt — runtime-init av system-kontoer er ikke schema-DDL"
  );
  const externalInsert = client.queries.find((q) =>
    q.text.includes("INSERT INTO") &&
    q.text.includes("wallet_accounts") &&
    q.values?.[0] === "__system_external_cash__"
  );
  assert.ok(
    externalInsert,
    "INSERT for __system_external_cash__ skal være beholdt"
  );
});
