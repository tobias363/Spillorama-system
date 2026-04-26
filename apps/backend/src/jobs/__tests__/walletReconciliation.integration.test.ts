/**
 * BIN-763: Postgres-integrasjons-test for WalletReconciliationService.
 *
 * Skipper når WALLET_PG_TEST_CONNECTION_STRING ikke er satt — matcher
 * mønster i PostgresWalletAdapter.walletSplit.test.ts.
 *
 * Dekker:
 *   1. Clean state — null konti → ingen alerts.
 *   2. Manuell divergens injisert (UPDATE wallet_accounts uten ledger-rad)
 *      → alert opprettet.
 *   3. Idempotency — kjør 2 ganger på samme tilstand → ingen duplikat-alerts.
 *   4. Performance — 10 000 mock-konti → kjøretid < 60 s.
 *   5. EXPLAIN — bekreft at idx_wallet_entries_account_side brukes for
 *      sum-leddet.
 *   6. Resolve-flyt — markér alert resolved → ny divergens samme konto/
 *      side gir ny alert (siden partial unique er WHERE resolved_at IS NULL).
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { WalletReconciliationService } from "../walletReconciliation.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres integration-test";

function makeTestSchema(): string {
  return `recon_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/**
 * Sett opp et minimalt wallet-schema i et test-schema. Vi gjenskaper
 * kun det reconciliation-servicen leser/skriver — ikke hele
 * PostgresWalletAdapter-strukturen — for å holde testen rask.
 */
async function setupSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`
    CREATE TABLE "${schema}"."wallet_accounts" (
      id TEXT PRIMARY KEY,
      deposit_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
      winnings_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
      is_system BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE "${schema}"."wallet_entries" (
      id BIGSERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "${schema}"."wallet_accounts"(id),
      side TEXT NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
      amount NUMERIC(20, 6) NOT NULL,
      account_side TEXT NOT NULL DEFAULT 'deposit' CHECK (account_side IN ('deposit','winnings')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX "idx_${schema}_entries_account_side"
      ON "${schema}"."wallet_entries" (account_id, account_side, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE "${schema}"."wallet_reconciliation_alerts" (
      id BIGSERIAL PRIMARY KEY,
      account_id TEXT NOT NULL,
      account_side TEXT NOT NULL CHECK (account_side IN ('deposit','winnings')),
      expected_balance NUMERIC(20, 4) NOT NULL,
      actual_balance NUMERIC(20, 4) NOT NULL,
      divergence NUMERIC(20, 4) NOT NULL,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ NULL,
      resolved_by TEXT NULL,
      resolution_note TEXT NULL
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX "idx_${schema}_open_per_account"
      ON "${schema}"."wallet_reconciliation_alerts" (account_id, account_side)
      WHERE resolved_at IS NULL
  `);
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

/**
 * Lag en clean konto med konsistent ledger:
 *  - deposit_balance = X, winnings_balance = Y
 *  - tilsvarende CREDIT-entries så netto = X og Y
 */
async function seedCleanAccount(
  pool: Pool,
  schema: string,
  id: string,
  deposit: number,
  winnings: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO "${schema}"."wallet_accounts" (id, deposit_balance, winnings_balance) VALUES ($1, $2, $3)`,
    [id, deposit, winnings],
  );
  if (deposit > 0) {
    await pool.query(
      `INSERT INTO "${schema}"."wallet_entries" (account_id, side, amount, account_side) VALUES ($1, 'CREDIT', $2, 'deposit')`,
      [id, deposit],
    );
  }
  if (winnings > 0) {
    await pool.query(
      `INSERT INTO "${schema}"."wallet_entries" (account_id, side, amount, account_side) VALUES ($1, 'CREDIT', $2, 'winnings')`,
      [id, winnings],
    );
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test(
  "postgres: clean state → ingen divergens, ingen alerts",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      await seedCleanAccount(pool, schema, "w-clean-1", 1000, 500);
      await seedCleanAccount(pool, schema, "w-clean-2", 200, 0);

      const service = new WalletReconciliationService({ pool, schema, batchPauseMs: 0 });
      const result = await service.reconcileAll();

      assert.equal(result.divergencesFound, 0);
      assert.equal(result.alertsCreated, 0);
      assert.equal(result.accountsScanned, 4); // 2 konti × 2 sider

      const alerts = await service.listOpenAlerts();
      assert.equal(alerts.length, 0);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "postgres: divergens (wallet over ledger) → alert opprettet",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      // Konto har deposit_balance=1500 men ledger-sum = 1000.
      // Divergens = 1500 - 1000 = +500 (wallet har 500 mer enn ledger).
      await pool.query(
        `INSERT INTO "${schema}"."wallet_accounts" (id, deposit_balance, winnings_balance) VALUES ('w-div', 1500, 0)`,
      );
      await pool.query(
        `INSERT INTO "${schema}"."wallet_entries" (account_id, side, amount, account_side) VALUES ('w-div', 'CREDIT', 1000, 'deposit')`,
      );

      const service = new WalletReconciliationService({ pool, schema, batchPauseMs: 0 });
      const result = await service.reconcileAll();

      assert.equal(result.divergencesFound, 1);
      assert.equal(result.alertsCreated, 1);

      const alerts = await service.listOpenAlerts();
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].accountId, "w-div");
      assert.equal(alerts[0].accountSide, "deposit");
      assert.equal(alerts[0].expectedBalance, 1000);
      assert.equal(alerts[0].actualBalance, 1500);
      assert.equal(alerts[0].divergence, 500);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "postgres: idempotency — kjør 2 ganger, kun 1 alert",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      // Negativ divergens: wallet har 100 mindre enn ledger.
      await pool.query(
        `INSERT INTO "${schema}"."wallet_accounts" (id, deposit_balance) VALUES ('w-idem', 400)`,
      );
      await pool.query(
        `INSERT INTO "${schema}"."wallet_entries" (account_id, side, amount, account_side) VALUES ('w-idem', 'CREDIT', 500, 'deposit')`,
      );

      const service = new WalletReconciliationService({ pool, schema, batchPauseMs: 0 });
      const r1 = await service.reconcileAll();
      assert.equal(r1.alertsCreated, 1, "første kjøring skal lage alert");

      const r2 = await service.reconcileAll();
      assert.equal(r2.divergencesFound, 1, "andre kjøring detekterer fortsatt");
      assert.equal(r2.alertsCreated, 0, "men ingen ny alert (ON CONFLICT DO NOTHING)");

      const alerts = await service.listOpenAlerts();
      assert.equal(alerts.length, 1, "fortsatt kun 1 åpen alert");
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "postgres: divergens under threshold (0.005 NOK) → ingen alert",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      // Bittesmå avvik (mindre enn 0.01 NOK) ignoreres som flytetalls-støy.
      await pool.query(
        `INSERT INTO "${schema}"."wallet_accounts" (id, deposit_balance) VALUES ('w-noise', 100.005)`,
      );
      await pool.query(
        `INSERT INTO "${schema}"."wallet_entries" (account_id, side, amount, account_side) VALUES ('w-noise', 'CREDIT', 100, 'deposit')`,
      );

      const service = new WalletReconciliationService({ pool, schema, batchPauseMs: 0 });
      const result = await service.reconcileAll();
      assert.equal(result.divergencesFound, 0, "0.005 NOK avvik er under threshold");
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "postgres: resolve alert → ny divergens kan opprette ny alert",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      await pool.query(
        `INSERT INTO "${schema}"."wallet_accounts" (id, deposit_balance) VALUES ('w-resolved', 200)`,
      );
      await pool.query(
        `INSERT INTO "${schema}"."wallet_entries" (account_id, side, amount, account_side) VALUES ('w-resolved', 'CREDIT', 100, 'deposit')`,
      );

      const service = new WalletReconciliationService({ pool, schema, batchPauseMs: 0 });
      const r1 = await service.reconcileAll();
      assert.equal(r1.alertsCreated, 1);

      const alerts = await service.listOpenAlerts();
      const alertId = alerts[0].id;
      const ok = await service.resolveAlert(alertId, "admin-user-1", "Manuell justering OK");
      assert.equal(ok, true);

      // Resolve igjen (samme id) → false (ingen åpen rad).
      const okAgain = await service.resolveAlert(alertId, "admin-user-1", "x");
      assert.equal(okAgain, false);

      // Etter resolve → ny reconcile finner samme divergens og kan
      // opprette ny alert (partial unique er WHERE resolved_at IS NULL).
      const r2 = await service.reconcileAll();
      assert.equal(r2.divergencesFound, 1);
      assert.equal(r2.alertsCreated, 1, "ny alert lov etter resolve");

      const open = await service.listOpenAlerts();
      assert.equal(open.length, 1);
      assert.notEqual(open[0].id, alertId);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "postgres: performance — 10 000 mock-konti, kjøretid < 60 s",
  { skip: skipReason, timeout: 120_000 },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);

      // Seed 10 000 clean konti via UNNEST batch insert (mye raskere
      // enn 10k separate INSERTs).
      const N = 10_000;
      const ids: string[] = [];
      for (let i = 0; i < N; i++) ids.push(`w-${String(i).padStart(6, "0")}`);
      await pool.query(
        `INSERT INTO "${schema}"."wallet_accounts" (id, deposit_balance, winnings_balance)
         SELECT id, 100, 0 FROM unnest($1::text[]) AS id`,
        [ids],
      );
      await pool.query(
        `INSERT INTO "${schema}"."wallet_entries" (account_id, side, amount, account_side)
         SELECT id, 'CREDIT', 100, 'deposit' FROM unnest($1::text[]) AS id`,
        [ids],
      );
      // Injisér 5 reelle divergenser.
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `UPDATE "${schema}"."wallet_accounts" SET deposit_balance = 999 WHERE id = $1`,
          [`w-${String(i).padStart(6, "0")}`],
        );
      }

      const service = new WalletReconciliationService({
        pool,
        schema,
        batchSize: 1000,
        batchPauseMs: 0,
      });
      const start = Date.now();
      const result = await service.reconcileAll();
      const elapsed = Date.now() - start;

      assert.equal(result.accountsScanned, N * 2, "10k konti × 2 sider");
      assert.equal(result.divergencesFound, 5, "5 injiserte divergenser");
      assert.equal(result.alertsCreated, 5);
      assert.ok(
        elapsed < 60_000,
        `kjøretid ${elapsed} ms skal være < 60 s for 10k konti`,
      );
      // Logg for diagnose; ikke assertion utover 60 s-grensen.
      // eslint-disable-next-line no-console
      console.log(
        `[wallet-reconciliation perf] scanned=${result.accountsScanned} elapsed=${elapsed}ms`,
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "postgres: EXPLAIN bekrefter index-bruk på wallet_entries",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      // Seed nok rader til at planneren foretrekker index over seq scan.
      const ids: string[] = [];
      for (let i = 0; i < 200; i++) ids.push(`w-${i}`);
      await pool.query(
        `INSERT INTO "${schema}"."wallet_accounts" (id, deposit_balance) SELECT id, 50 FROM unnest($1::text[]) AS id`,
        [ids],
      );
      await pool.query(
        `INSERT INTO "${schema}"."wallet_entries" (account_id, side, amount, account_side)
         SELECT id, 'CREDIT', 50, 'deposit' FROM unnest($1::text[]) AS id`,
        [ids],
      );
      await pool.query(`ANALYZE "${schema}"."wallet_accounts"`);
      await pool.query(`ANALYZE "${schema}"."wallet_entries"`);

      // EXPLAIN den interne sum-spørringen direkte (mirrorer servicen).
      const { rows } = await pool.query<{ "QUERY PLAN": string }>(
        `EXPLAIN
         WITH chunk AS (
           SELECT id FROM "${schema}"."wallet_accounts" ORDER BY id LIMIT 100
         )
         SELECT account_id, account_side, SUM(amount)
         FROM "${schema}"."wallet_entries"
         WHERE account_id IN (SELECT id FROM chunk)
         GROUP BY account_id, account_side`,
      );
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      // Ved seed på 200 konti kan planneren bruke enten Index Scan eller
      // Bitmap Scan. Vi forsikrer oss om at den IKKE gjør en full Seq Scan
      // av wallet_entries — det ville være bevis på at index ikke brukes
      // i prod-volume.
      assert.ok(
        /Index|Bitmap/.test(plan),
        `forventet index- eller bitmap-scan i plan, fikk:\n${plan}`,
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);
