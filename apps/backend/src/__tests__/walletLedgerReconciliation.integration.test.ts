/**
 * G9 — Integration test for wallet vs ledger reconciliation against
 * a real Postgres instance.
 *
 * Skip-graceful: hopper over hvis WALLET_PG_TEST_CONNECTION_STRING ikke
 * er satt. Lokal dev-stack:
 *   WALLET_PG_TEST_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
 *     LOG_LEVEL=warn npm --prefix apps/backend test
 *
 * Setup pattern matcher `WalletAuditVerifier.test.ts`: hver test bruker
 * sitt eget tilfeldig-genererte schema, seeder rader, kjører reconcile
 * og dropper schema etterpå.
 *
 * Vi seeder direkte (ingen wallet-adapter) for å holde testen hermetisk
 * og uten avhengighet til full app-stack.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import {
  classifyLedgerEvent,
  classifyWalletTransaction,
  isoToOsloDate,
  reconcile,
  type LedgerReconcileEvent,
  type WalletReconcileEvent,
} from "../../scripts/lib/walletLedgerReconciliation.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over G9 reconciliation integrasjons-test";

function makeTestSchema(): string {
  return `g9_recon_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

/**
 * Setup minimal schema som speiler det reelle (kun kolonnene vi trenger).
 *
 * Vi NULLstiller hash-chain-felter siden vi ikke seeder via PostgresWalletAdapter
 * (som er den eneste loven for hash-chain). Det er greit fordi
 * WalletAuditVerifier kjører i et separat script og denne testen
 * verifiserer kun reconciliation-logikken.
 */
async function setupSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`
    CREATE TABLE "${schema}"."wallet_accounts" (
      id            TEXT PRIMARY KEY,
      balance       NUMERIC(20, 6) NOT NULL DEFAULT 0,
      is_system     BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE "${schema}"."wallet_transactions" (
      id                 TEXT PRIMARY KEY,
      operation_id       TEXT NOT NULL,
      account_id         TEXT NOT NULL REFERENCES "${schema}"."wallet_accounts"(id),
      transaction_type   TEXT NOT NULL,
      amount             NUMERIC(20, 6) NOT NULL,
      reason             TEXT NOT NULL,
      related_account_id TEXT NULL,
      idempotency_key    TEXT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE "${schema}"."app_rg_compliance_ledger" (
      id                TEXT PRIMARY KEY,
      created_at        TIMESTAMPTZ NOT NULL,
      created_at_ms     BIGINT NOT NULL,
      hall_id           TEXT NOT NULL,
      game_type         TEXT NOT NULL,
      channel           TEXT NOT NULL,
      event_type        TEXT NOT NULL,
      amount            NUMERIC(12, 2) NOT NULL,
      currency          TEXT NOT NULL,
      room_code         TEXT NULL,
      game_id           TEXT NULL,
      claim_id          TEXT NULL,
      player_id         TEXT NULL,
      wallet_id         TEXT NULL,
      source_account_id TEXT NULL,
      target_account_id TEXT NULL,
      policy_version    TEXT NULL,
      batch_id          TEXT NULL,
      metadata_json     JSONB NULL
    )
  `);
}

interface SeedTxArgs {
  id: string;
  accountId: string;
  type: string;
  amount: number;
  reason: string;
  idempotencyKey: string | null;
  createdAt: string;
}

interface SeedLedgerArgs {
  id: string;
  walletId: string | null;
  hallId: string;
  gameType: string;
  channel: string;
  eventType: string;
  amount: number;
  createdAt: string;
}

async function seedAccount(
  pool: Pool,
  schema: string,
  id: string,
  isSystem = false,
): Promise<void> {
  await pool.query(
    `INSERT INTO "${schema}"."wallet_accounts" (id, balance, is_system) VALUES ($1, 0, $2)`,
    [id, isSystem],
  );
}

async function seedTransaction(
  pool: Pool,
  schema: string,
  args: SeedTxArgs,
): Promise<void> {
  await pool.query(
    `INSERT INTO "${schema}"."wallet_transactions"
       (id, operation_id, account_id, transaction_type, amount, reason, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      args.id,
      `op-${args.id}`,
      args.accountId,
      args.type,
      args.amount,
      args.reason,
      args.idempotencyKey,
      args.createdAt,
    ],
  );
}

async function seedLedgerEntry(
  pool: Pool,
  schema: string,
  args: SeedLedgerArgs,
): Promise<void> {
  const ms = new Date(args.createdAt).getTime();
  await pool.query(
    `INSERT INTO "${schema}"."app_rg_compliance_ledger"
       (id, created_at, created_at_ms, hall_id, game_type, channel, event_type,
        amount, currency, wallet_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NOK', $9)`,
    [
      args.id,
      args.createdAt,
      ms,
      args.hallId,
      args.gameType,
      args.channel,
      args.eventType,
      args.amount,
      args.walletId,
    ],
  );
}

/**
 * Mini-versjon av fetchWalletEvents fra CLI (gjenbrukes ikke direkte
 * fordi CLI-versjonen exporterer ikke). Speiler SQL og normalisering.
 */
async function fetchWallet(
  pool: Pool,
  schema: string,
): Promise<WalletReconcileEvent[]> {
  const { rows } = await pool.query<{
    id: string;
    account_id: string;
    transaction_type: string;
    amount: string;
    reason: string;
    idempotency_key: string | null;
    created_at: Date;
  }>(
    `SELECT t.id, t.account_id, t.transaction_type, t.amount::text AS amount,
            t.reason, t.idempotency_key, t.created_at
       FROM "${schema}"."wallet_transactions" t
       JOIN "${schema}"."wallet_accounts" a ON a.id = t.account_id
      WHERE a.is_system = false
      ORDER BY t.created_at ASC`,
  );
  const out: WalletReconcileEvent[] = [];
  for (const row of rows) {
    const side = classifyWalletTransaction(
      row.transaction_type,
      row.reason ?? "",
      row.idempotency_key,
    );
    if (!side) continue;
    const iso = row.created_at.toISOString();
    out.push({
      transactionId: row.id,
      accountId: row.account_id,
      businessDate: isoToOsloDate(iso),
      amountNok: Number(row.amount),
      side,
      transactionType: row.transaction_type,
      reason: row.reason ?? "",
      createdAt: iso,
    });
  }
  return out;
}

async function fetchLedger(
  pool: Pool,
  schema: string,
): Promise<LedgerReconcileEvent[]> {
  const { rows } = await pool.query<{
    id: string;
    wallet_id: string | null;
    hall_id: string;
    game_type: string;
    event_type: string;
    amount: string;
    created_at: Date;
  }>(
    `SELECT id, wallet_id, hall_id, game_type, event_type, amount::text AS amount, created_at
       FROM "${schema}"."app_rg_compliance_ledger"
      WHERE wallet_id IS NOT NULL
      ORDER BY created_at ASC`,
  );
  const out: LedgerReconcileEvent[] = [];
  for (const row of rows) {
    const side = classifyLedgerEvent(row.event_type);
    if (!side) continue;
    if (!row.wallet_id) continue;
    const iso = row.created_at.toISOString();
    out.push({
      id: row.id,
      walletId: row.wallet_id,
      businessDate: isoToOsloDate(iso),
      hallId: row.hall_id,
      gameType: row.game_type,
      amountNok: Number(row.amount),
      side,
      eventType: row.event_type,
      createdAt: iso,
    });
  }
  return out;
}

// ── Test 1: identisk wallet og ledger → reconciled ──────────────────────────

test(
  "G9: ekte DB — identisk wallet og ledger gir isReconciled=true",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      await seedAccount(pool, schema, "__house__", true);
      await seedAccount(pool, schema, "wallet-spiller-1", false);

      await seedTransaction(pool, schema, {
        id: "tx-1",
        accountId: "wallet-spiller-1",
        type: "DEBIT",
        amount: 50,
        reason: "game1_purchase",
        idempotencyKey: "game1-purchase:client-1:debit",
        createdAt: "2026-08-15T12:00:00.000Z",
      });

      await seedLedgerEntry(pool, schema, {
        id: "lg-1",
        walletId: "wallet-spiller-1",
        hallId: "demo-hall-001",
        gameType: "MAIN_GAME",
        channel: "INTERNET",
        eventType: "STAKE",
        amount: 50,
        createdAt: "2026-08-15T12:00:00.000Z",
      });

      const walletEvents = await fetchWallet(pool, schema);
      const ledgerEvents = await fetchLedger(pool, schema);

      const result = reconcile({
        fromDate: "2026-08-01",
        toDate: "2026-08-31",
        hallFilter: null,
        walletEvents,
        ledgerEvents,
      });

      assert.equal(result.isReconciled, true);
      assert.equal(result.walletTotals.stakeAmountNok, 50);
      assert.equal(result.ledgerTotals.stakeAmountNok, 50);
      assert.equal(result.walletOnlyBuckets.length, 0);
      assert.equal(result.ledgerOnlyBuckets.length, 0);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

// ── Test 2: wallet-only bucket → divergens ──────────────────────────────────

test(
  "G9: ekte DB — wallet-debit uten ledger-event flagger walletOnly",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      await seedAccount(pool, schema, "wallet-spiller-1", false);

      await seedTransaction(pool, schema, {
        id: "tx-orphan",
        accountId: "wallet-spiller-1",
        type: "DEBIT",
        amount: 75,
        reason: "game1_purchase",
        idempotencyKey: "game1-purchase:orphan:debit",
        createdAt: "2026-08-15T12:00:00.000Z",
      });

      const walletEvents = await fetchWallet(pool, schema);
      const ledgerEvents = await fetchLedger(pool, schema);

      const result = reconcile({
        fromDate: "2026-08-01",
        toDate: "2026-08-31",
        hallFilter: null,
        walletEvents,
        ledgerEvents,
      });

      assert.equal(result.isReconciled, false);
      assert.equal(result.walletOnlyBuckets.length, 1);
      assert.equal(result.walletOnlyBuckets[0].walletId, "wallet-spiller-1");
      assert.equal(result.walletOnlyBuckets[0].totalAmountNok, 75);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

// ── Test 3: ledger-only → phantom-rapport ───────────────────────────────────

test(
  "G9: ekte DB — ledger-event uten wallet-tx flagger ledgerOnly (phantom)",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      await seedAccount(pool, schema, "wallet-spiller-1", false);

      await seedLedgerEntry(pool, schema, {
        id: "lg-phantom",
        walletId: "wallet-spiller-1",
        hallId: "demo-hall-001",
        gameType: "MAIN_GAME",
        channel: "INTERNET",
        eventType: "PRIZE",
        amount: 200,
        createdAt: "2026-08-15T12:00:00.000Z",
      });

      const walletEvents = await fetchWallet(pool, schema);
      const ledgerEvents = await fetchLedger(pool, schema);

      const result = reconcile({
        fromDate: "2026-08-01",
        toDate: "2026-08-31",
        hallFilter: null,
        walletEvents,
        ledgerEvents,
      });

      assert.equal(result.isReconciled, false);
      assert.equal(result.ledgerOnlyBuckets.length, 1);
      assert.equal(result.ledgerOnlyBuckets[0].walletId, "wallet-spiller-1");
      assert.equal(result.ledgerOnlyBuckets[0].totalAmountNok, 200);
      assert.equal(result.ledgerOnlyBuckets[0].side, "PRIZE");
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

// ── Test 4: amount-mismatch ─────────────────────────────────────────────────

test(
  "G9: ekte DB — beløps-mismatch detekteres",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      await seedAccount(pool, schema, "wallet-spiller-1", false);

      await seedTransaction(pool, schema, {
        id: "tx-mismatch",
        accountId: "wallet-spiller-1",
        type: "DEBIT",
        amount: 50,
        reason: "game1_purchase",
        idempotencyKey: "game1-purchase:mm:debit",
        createdAt: "2026-08-15T12:00:00.000Z",
      });

      await seedLedgerEntry(pool, schema, {
        id: "lg-mismatch",
        walletId: "wallet-spiller-1",
        hallId: "demo-hall-001",
        gameType: "MAIN_GAME",
        channel: "INTERNET",
        eventType: "STAKE",
        amount: 30,
        createdAt: "2026-08-15T12:00:00.000Z",
      });

      const walletEvents = await fetchWallet(pool, schema);
      const ledgerEvents = await fetchLedger(pool, schema);

      const result = reconcile({
        fromDate: "2026-08-01",
        toDate: "2026-08-31",
        hallFilter: null,
        walletEvents,
        ledgerEvents,
      });

      assert.equal(result.isReconciled, false);
      assert.equal(result.amountMismatches.length, 1);
      assert.equal(result.amountMismatches[0].walletAmountNok, 50);
      assert.equal(result.amountMismatches[0].ledgerAmountNok, 30);
      assert.equal(result.amountMismatches[0].diffNok, 20);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

// ── Test 5: TOPUP og system-konti excluderes ────────────────────────────────

test(
  "G9: ekte DB — TOPUP og system-konti excluderes fra reconciliation",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      await seedAccount(pool, schema, "__house__", true);
      await seedAccount(pool, schema, "wallet-spiller-1", false);

      await seedTransaction(pool, schema, {
        id: "tx-topup",
        accountId: "wallet-spiller-1",
        type: "TOPUP",
        amount: 1000,
        reason: "Initial wallet funding",
        idempotencyKey: null,
        createdAt: "2026-08-15T10:00:00.000Z",
      });

      await seedTransaction(pool, schema, {
        id: "tx-system",
        accountId: "__house__",
        type: "DEBIT",
        amount: 500,
        reason: "g1-phase-payout",
        idempotencyKey: "g1-phase-game1-row1-claim1",
        createdAt: "2026-08-15T11:00:00.000Z",
      });

      const walletEvents = await fetchWallet(pool, schema);
      const ledgerEvents = await fetchLedger(pool, schema);

      assert.equal(walletEvents.length, 0);

      const result = reconcile({
        fromDate: "2026-08-01",
        toDate: "2026-08-31",
        hallFilter: null,
        walletEvents,
        ledgerEvents,
      });
      assert.equal(result.isReconciled, true);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

// ── Test 6: hall-filter respekteres ─────────────────────────────────────────

test(
  "G9: ekte DB — hall-filter på ledger reduserer scope",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      await seedAccount(pool, schema, "wallet-spiller-1", false);

      await seedLedgerEntry(pool, schema, {
        id: "lg-hall-A",
        walletId: "wallet-spiller-1",
        hallId: "demo-hall-001",
        gameType: "MAIN_GAME",
        channel: "INTERNET",
        eventType: "STAKE",
        amount: 50,
        createdAt: "2026-08-15T12:00:00.000Z",
      });
      await seedLedgerEntry(pool, schema, {
        id: "lg-hall-B",
        walletId: "wallet-spiller-1",
        hallId: "demo-hall-002",
        gameType: "MAIN_GAME",
        channel: "INTERNET",
        eventType: "STAKE",
        amount: 100,
        createdAt: "2026-08-15T13:00:00.000Z",
      });

      const allLedger = await fetchLedger(pool, schema);
      assert.equal(allLedger.length, 2);

      const { rows: filtered } = await pool.query<{
        id: string;
        wallet_id: string;
        hall_id: string;
        game_type: string;
        event_type: string;
        amount: string;
        created_at: Date;
      }>(
        `SELECT id, wallet_id, hall_id, game_type, event_type, amount::text AS amount, created_at
           FROM "${schema}"."app_rg_compliance_ledger"
          WHERE wallet_id IS NOT NULL AND hall_id = $1`,
        ["demo-hall-001"],
      );
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].hall_id, "demo-hall-001");
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

// ── Test 7: reconciliation idempotent — flere kjøringer gir samme resultat ─

test(
  "G9: ekte DB — idempotent kjøring (read-only sjekk)",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const pool = new Pool({ connectionString: PG_CONN });
    try {
      await setupSchema(pool, schema);
      await seedAccount(pool, schema, "wallet-spiller-1", false);
      await seedTransaction(pool, schema, {
        id: "tx-1",
        accountId: "wallet-spiller-1",
        type: "DEBIT",
        amount: 50,
        reason: "game1_purchase",
        idempotencyKey: "game1-purchase:c:debit",
        createdAt: "2026-08-15T12:00:00.000Z",
      });
      await seedLedgerEntry(pool, schema, {
        id: "lg-1",
        walletId: "wallet-spiller-1",
        hallId: "demo-hall-001",
        gameType: "MAIN_GAME",
        channel: "INTERNET",
        eventType: "STAKE",
        amount: 50,
        createdAt: "2026-08-15T12:00:00.000Z",
      });

      const w1 = await fetchWallet(pool, schema);
      const l1 = await fetchLedger(pool, schema);
      const r1 = reconcile({
        fromDate: "2026-08-01",
        toDate: "2026-08-31",
        hallFilter: null,
        walletEvents: w1,
        ledgerEvents: l1,
      });

      const w2 = await fetchWallet(pool, schema);
      const l2 = await fetchLedger(pool, schema);
      const r2 = reconcile({
        fromDate: "2026-08-01",
        toDate: "2026-08-31",
        hallFilter: null,
        walletEvents: w2,
        ledgerEvents: l2,
      });

      assert.equal(w1.length, w2.length);
      assert.equal(l1.length, l2.length);
      assert.deepEqual(r1, r2);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);
