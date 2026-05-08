/**
 * Test-only helper to bootstrap the wallet schema for Postgres integration
 * tests that use a fresh `test_<uuid>` schema and don't run node-pg-migrate.
 *
 * BIN-828 (2026-05-08): wallet_accounts/transactions/entries/reservations
 * CREATE TABLE-statementene ble flyttet ut av `PostgresWalletAdapter.
 * initializeSchema()` for å unngå at backend-startup-DDL kolliderte med
 * node-pg-migrate sin INSERT i `20260413000001_initial_schema.sql`. I
 * production løses dette ved at `render.yaml` `buildCommand` kjører
 * migrate FØR backend starter (`npm run migrate && npm run start`).
 *
 * Tester med fersk schema må kalle `bootstrapWalletSchemaForTests` før de
 * lager en `PostgresWalletAdapter` så tabellene eksisterer.
 *
 * IKKE BRUK I PRODUKSJON. Speiler skjemaet etter at alle wallet-relaterte
 * migrasjoner har kjørt:
 *   - 20260413000001_initial_schema.sql        (CREATE TABLE wallet_*)
 *   - 20260606000000_wallet_split_deposit_winnings.sql (split + GENERATED)
 *   - 20260724100000_wallet_reservations.sql + 20260425000000_*_numeric.sql
 *   - 20260926000000_wallet_currency_readiness.sql      (currency NOK-only)
 *
 * Hvis nye wallet-migrasjoner legges til, må denne helperen oppdateres
 * tilsvarende (eller tester må byttes til å kjøre node-pg-migrate
 * programatisk — out of scope for BIN-828).
 */

import type { Pool, PoolClient } from "pg";

export interface BootstrapWalletSchemaOptions {
  /** Schema-name to bootstrap. Must already exist (or use createSchema=true). */
  schema: string;
  /** Create the schema first. Default true (typical for fresh test schemas). */
  createSchema?: boolean;
}

/**
 * Bootstrap wallet_accounts/transactions/entries/reservations in the given
 * schema. Idempotent: re-running on an already-bootstrapped schema is safe
 * (CREATE TABLE IF NOT EXISTS, ALTER ... IF NOT EXISTS, etc.).
 *
 * Speiler `migrations/20260413000001_initial_schema.sql` + relevant
 * follow-up migrations. Kjøres innenfor en transaksjon for atomicitet.
 */
export async function bootstrapWalletSchemaForTests(
  pool: Pool,
  options: BootstrapWalletSchemaOptions
): Promise<void> {
  const { schema, createSchema = true } = options;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (createSchema) {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    }
    await runWalletSchemaDdl(client, schema);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The actual DDL run inside a transaction. Exported separately so tests can
 * exercise it against an existing client/transaction (rare).
 */
export async function runWalletSchemaDdl(
  client: PoolClient,
  schema: string
): Promise<void> {
  const accountsTable = `"${schema}"."wallet_accounts"`;
  const transactionsTable = `"${schema}"."wallet_transactions"`;
  const entriesTable = `"${schema}"."wallet_entries"`;
  const reservationsTable = `"${schema}"."app_wallet_reservations"`;

  // wallet_accounts — endelig skjema etter wallet-split (PR-W1) + currency.
  // `balance` er GENERATED ALWAYS AS (deposit + winnings) STORED.
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${accountsTable} (
      id TEXT PRIMARY KEY,
      deposit_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
      winnings_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
      balance NUMERIC(20, 6) GENERATED ALWAYS AS (deposit_balance + winnings_balance) STORED,
      is_system BOOLEAN NOT NULL DEFAULT false,
      currency TEXT NOT NULL DEFAULT 'NOK',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT wallet_accounts_system_no_winnings
        CHECK (is_system = false OR winnings_balance = 0),
      CONSTRAINT wallet_accounts_nonneg_deposit_nonsystem
        CHECK (is_system = true OR deposit_balance >= 0),
      CONSTRAINT wallet_accounts_nonneg_winnings_nonsystem
        CHECK (is_system = true OR winnings_balance >= 0),
      CONSTRAINT wallet_accounts_currency_nok_only
        CHECK (currency = 'NOK')
    )`
  );

  // wallet_transactions
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${transactionsTable} (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES ${accountsTable}(id),
      transaction_type TEXT NOT NULL,
      amount NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
      reason TEXT NOT NULL,
      related_account_id TEXT NULL,
      idempotency_key TEXT NULL,
      currency TEXT NOT NULL DEFAULT 'NOK',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT wallet_transactions_currency_nok_only
        CHECK (currency = 'NOK')
    )`
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency_key
     ON ${transactionsTable} (idempotency_key) WHERE idempotency_key IS NOT NULL`
  );

  // wallet_entries — inkluderer account_side (PR-W1), currency (BIN-766) og
  // hash-chain (BIN-764).
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${entriesTable} (
      id BIGSERIAL PRIMARY KEY,
      operation_id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES ${accountsTable}(id),
      side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
      amount NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
      transaction_id TEXT NULL REFERENCES ${transactionsTable}(id),
      account_side TEXT NOT NULL DEFAULT 'deposit'
        CHECK (account_side IN ('deposit', 'winnings')),
      currency TEXT NOT NULL DEFAULT 'NOK',
      entry_hash TEXT NULL,
      previous_entry_hash TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT wallet_entries_currency_nok_only
        CHECK (currency = 'NOK')
    )`
  );

  // app_wallet_reservations (PR #513 §1.1) — pgcrypto kreves for gen_random_uuid().
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${reservationsTable} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_id TEXT NOT NULL,
      amount_cents NUMERIC(20, 6) NOT NULL CHECK (amount_cents > 0),
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'released', 'committed', 'expired')),
      room_code TEXT NOT NULL,
      game_session_id TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      released_at TIMESTAMPTZ NULL,
      committed_at TIMESTAMPTZ NULL,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
    )`
  );

  // wallet_outbox (BIN-761) — speiler `migrations/20260427000000_wallet_outbox.sql`.
  // PostgresWalletAdapter trenger denne for outbox-enqueue ved hver ledger-write.
  const outboxTable = `"${schema}"."wallet_outbox"`;
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${outboxTable} (
      id              BIGSERIAL PRIMARY KEY,
      operation_id    TEXT NOT NULL,
      account_id      TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      payload         JSONB NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processed', 'dead_letter')),
      attempts        INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_attempt_at TIMESTAMPTZ NULL,
      last_error      TEXT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at    TIMESTAMPTZ NULL
    )`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_wallet_outbox_pending
      ON ${outboxTable} (status, created_at) WHERE status = 'pending'`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_wallet_outbox_dead
      ON ${outboxTable} (status) WHERE status = 'dead_letter'`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_wallet_outbox_operation
      ON ${outboxTable} (operation_id)`
  );
}
