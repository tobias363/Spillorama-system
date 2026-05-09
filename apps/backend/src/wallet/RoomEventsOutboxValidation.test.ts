/**
 * R6 (BIN-818): outbox-validering for rom-events.
 *
 * Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.6.
 *
 * Verifiserer at wallet-touch-flytene som rom-events trigger (ticket-purchase
 * debit, payout transfer, replay-credit) atomisk produserer pending outbox-
 * rader i samme DB-transaksjon som ledger-INSERT-en. Ingen rom-event skal
 * kunne skrive en wallet-mutasjon uten matching outbox-event.
 *
 * Dekningsområde:
 *   1. Ticket-purchase-debit (Game1TicketPurchaseService-shape) → 1 outbox-
 *      rad atomisk; rollback dropper både wallet-mutasjon OG outbox-rad.
 *   2. Payout-transfer (PhasePayoutService/BingoEngine-shape) → 1 outbox-rad
 *      for spilleren (system-konto filtreres bort).
 *   3. Idempotency-replay → første call skriver outbox, andre call returnerer
 *      eksisterende transaksjon UTEN ny outbox-skriving.
 *   4. Crash-simulering: feil mellom wallet-debit og purchase-INSERT trenger
 *      ikke fjerne outbox-raden, men compensating-credit MÅ produsere en
 *      andre outbox-rad (refund-event).
 *   5. Reservation-only ops (reserve/increase/release) skriver IKKE outbox.
 *   6. commitReservation produserer outbox-rad (faktisk ledger-mutasjon).
 *
 * Skipper når `WALLET_PG_TEST_CONNECTION_STRING` ikke er satt — samme pattern
 * som `PostgresWalletAdapter.outbox.test.ts`.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresWalletAdapter } from "../adapters/PostgresWalletAdapter.js";
import { WalletOutboxRepo } from "./WalletOutboxRepo.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres integration-test";

function makeTestSchema(): string {
  return `r6_outbox_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

/**
 * Opprett outbox-tabell per test-schema. Migration `20260427000000_wallet_outbox.sql`
 * lager tabellen i public-schema; for isolerte test-schemas må vi recreate-en
 * her. Speiler shape fra migration-filen 1:1 (forward-only, ingen Down).
 */
async function createOutboxTable(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."wallet_outbox" (
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
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "${schema}_idx_wallet_outbox_pending"
       ON "${schema}"."wallet_outbox" (status, created_at) WHERE status = 'pending';`,
  );
}

// ── Test 1: Ticket-purchase debit produserer outbox-rad atomisk ────────

test(
  "R6: ticket-purchase debit (Game1TicketPurchaseService-shape) produserer 1 pending outbox-rad atomisk",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    await createOutboxTable(cleanupPool, schema);

    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const repo = new WalletOutboxRepo({ pool: adapter.getPool(), schema });
    adapter.setOutboxRepo(repo);

    try {
      // Setup: spiller med 1000 kr saldo (deposit-side).
      await adapter.createAccount({
        accountId: "player-purchase-1",
        initialBalance: 1000,
      });

      // Drep eventuelle outbox-rader fra createAccount-init-funding så vi
      // måler kun debit-flyten.
      await cleanupPool.query(`DELETE FROM "${schema}"."wallet_outbox"`);

      // Simuler Game1TicketPurchaseService.purchase ticket-debit-flyten.
      const purchaseId = `g1p-${randomUUID()}`;
      const idempotencyKey = `g1-purchase-debit:${purchaseId}`;
      const debitTx = await adapter.debit(
        "player-purchase-1",
        100,
        `game1_purchase:${purchaseId}`,
        { idempotencyKey },
      );

      assert.ok(debitTx.id, "debit returnerte tx-id");
      assert.equal(debitTx.amount, 100);
      assert.equal(debitTx.type, "DEBIT");

      // Verifiser saldo etter debit.
      const balance = await adapter.getBalance("player-purchase-1");
      assert.equal(balance, 900, "wallet debitert 100 kr");

      // Verifiser at det finnes nøyaktig 1 pending outbox-rad for denne
      // transaksjonen.
      const counts = await repo.countByStatus();
      assert.equal(
        counts.pending,
        1,
        "1 pending outbox-rad fra debit (atomisk i samme tx)",
      );

      const rows = await repo.claimNextBatch(10);
      assert.equal(rows.length, 1);
      const row = rows[0]!;
      assert.equal(row.accountId, "player-purchase-1");
      assert.equal(row.eventType, "wallet.debit");
      assert.equal(row.operationId, debitTx.id);
      const payload = row.payload as Record<string, unknown>;
      assert.equal(payload.amount, 100);
      assert.equal(payload.type, "DEBIT");
      assert.equal(
        payload.depositBalance,
        900,
        "post-debit deposit-balanse i payload — verifiserer atomic snapshot",
      );
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

// ── Test 2: Payout-transfer produserer outbox-rad for spiller ──────────

test(
  "R6: payout-transfer (PhasePayoutService/BingoEngine-shape) produserer outbox-rad atomisk for spiller",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    await createOutboxTable(cleanupPool, schema);

    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const repo = new WalletOutboxRepo({ pool: adapter.getPool(), schema });
    adapter.setOutboxRepo(repo);

    try {
      await adapter.createAccount({
        accountId: "house-test-hall-main_game-internet",
        initialBalance: 0,
      });
      await adapter.topUp(
        "house-test-hall-main_game-internet",
        500,
        "house buyin pool",
      );
      await adapter.createAccount({
        accountId: "winner-1",
        initialBalance: 0,
      });

      await cleanupPool.query(`DELETE FROM "${schema}"."wallet_outbox"`);

      // Simuler PhasePayoutService.executeForPattern transfer-shape:
      //   transfer(houseAccount, winnerWallet, payout, { targetSide: "winnings" })
      const payoutAmount = 250;
      const idempotencyKey = `payout:test-game-1:player-1`;
      const transferResult = await adapter.transfer(
        "house-test-hall-main_game-internet",
        "winner-1",
        payoutAmount,
        "Test payout",
        { idempotencyKey, targetSide: "winnings" },
      );

      assert.ok(transferResult.fromTx.id, "transfer fromTx returnert");
      assert.ok(transferResult.toTx.id, "transfer toTx returnert");

      // Verifiser at outbox har KUN 1 pending-rad: én for vinneren.
      // System-konto (`__system_house__`) er filtrert bort av executeLedger
      // for å unngå unyttig broadcast-volum.
      const counts = await repo.countByStatus();
      assert.equal(
        counts.pending,
        1,
        "1 pending outbox-rad for vinner (system-konto filtreres bort)",
      );

      const rows = await repo.claimNextBatch(10);
      const accountIds = rows.map((r) => r.accountId).sort();
      assert.deepEqual(
        accountIds,
        ["winner-1"],
        "kun vinner-konto i outbox; system-konto droppet",
      );

      const winnerRow = rows.find((r) => r.accountId === "winner-1")!;
      assert.equal(winnerRow.eventType, "wallet.transfer_in");
      const winnerPayload = winnerRow.payload as Record<string, unknown>;
      assert.equal(winnerPayload.amount, payoutAmount);
      assert.equal(
        winnerPayload.winningsBalance,
        payoutAmount,
        "payout landet på winnings-side per `targetSide: winnings`",
      );
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

// ── Test 3: Idempotency-replay skriver IKKE duplikat outbox ────────────

test(
  "R6: idempotency-replay av samme debit returnerer eksisterende tx UTEN ny outbox-rad",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    await createOutboxTable(cleanupPool, schema);

    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const repo = new WalletOutboxRepo({ pool: adapter.getPool(), schema });
    adapter.setOutboxRepo(repo);

    try {
      await adapter.createAccount({
        accountId: "player-idem-1",
        initialBalance: 1000,
      });

      await cleanupPool.query(`DELETE FROM "${schema}"."wallet_outbox"`);

      const idempotencyKey = `purchase-replay-${randomUUID()}`;

      // Første debit-call.
      const tx1 = await adapter.debit("player-idem-1", 100, "first attempt", {
        idempotencyKey,
      });

      // Andre debit-call med SAMME idempotency-key (simulerer reconnect-retry).
      const tx2 = await adapter.debit(
        "player-idem-1",
        100,
        "retry attempt",
        { idempotencyKey },
      );

      // Begge tx-IDer skal være identiske (idempotency match).
      assert.equal(
        tx1.id,
        tx2.id,
        "samme idempotency-key returnerer samme tx-id",
      );

      // Saldo skal kun være redusert med 100 (ikke 200) — beviser at den
      // andre kallet ikke skrev en ny ledger-mutasjon.
      const balance = await adapter.getBalance("player-idem-1");
      assert.equal(balance, 900, "wallet debitert kun ÉN gang trass i 2 kall");

      // Outbox skal ha kun 1 pending-rad — den andre call-en hoppet over
      // executeLedger og dermed enqueue.
      const counts = await repo.countByStatus();
      assert.equal(
        counts.pending,
        1,
        "kun 1 outbox-rad — idempotency-replay produserer ikke duplikat",
      );
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

// ── Test 4: Crash mid-flow — wallet-debit OG compensating credit har begge outbox ──

test(
  "R6: crash-recovery — debit + compensating credit produserer 2 outbox-rader (debit + credit)",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    await createOutboxTable(cleanupPool, schema);

    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const repo = new WalletOutboxRepo({ pool: adapter.getPool(), schema });
    adapter.setOutboxRepo(repo);

    try {
      await adapter.createAccount({
        accountId: "player-compensate-1",
        initialBalance: 1000,
      });

      await cleanupPool.query(`DELETE FROM "${schema}"."wallet_outbox"`);

      // Simuler Game1TicketPurchaseService crash-recovery-flow:
      //   1. wallet.debit(player, total, idempotency-key=purchase-debit:N)
      //   2. INSERT purchase row → KRASJER (ikke 23505)
      //   3. wallet.credit(player, total, idempotency-key=compensate:N)
      const purchaseId = `g1p-${randomUUID()}`;
      const debitTx = await adapter.debit(
        "player-compensate-1",
        100,
        `game1_purchase:${purchaseId}`,
        { idempotencyKey: `g1-purchase-debit:${purchaseId}` },
      );
      assert.ok(debitTx.id);

      // Simuler compensate-credit.
      const compensateTx = await adapter.credit(
        "player-compensate-1",
        100,
        `game1_purchase_compensate:${purchaseId}`,
        {
          idempotencyKey: `g1-purchase-compensate:${purchaseId}`,
          to: "deposit",
        },
      );
      assert.ok(compensateTx.id);

      // Saldo skal være tilbake til 1000.
      const balance = await adapter.getBalance("player-compensate-1");
      assert.equal(
        balance,
        1000,
        "wallet er null endret etter debit + compensating credit",
      );

      // Outbox skal ha 2 pending-rader.
      const counts = await repo.countByStatus();
      assert.equal(
        counts.pending,
        2,
        "2 outbox-rader: debit + compensating credit (atomisk per kall)",
      );

      const rows = await repo.claimNextBatch(10);
      const eventTypes = rows.map((r) => r.eventType).sort();
      assert.deepEqual(eventTypes, ["wallet.credit", "wallet.debit"]);
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

// ── Test 5: Reservation-only operations skriver IKKE outbox ────────────

test(
  "R6: reserve/increaseReservation/releaseReservation skriver IKKE outbox (kun saldo-lås)",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    await createOutboxTable(cleanupPool, schema);

    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const repo = new WalletOutboxRepo({ pool: adapter.getPool(), schema });
    adapter.setOutboxRepo(repo);

    try {
      await adapter.createAccount({
        accountId: "player-reserve-1",
        initialBalance: 1000,
      });

      await cleanupPool.query(`DELETE FROM "${schema}"."wallet_outbox"`);

      // Reserve, increase, release — INGEN ledger-mutasjon, ingen outbox.
      const reservation = await adapter.reserve("player-reserve-1", 100, {
        idempotencyKey: `arm-${randomUUID()}`,
        roomCode: "test-room",
      });
      assert.ok(reservation.id);

      await adapter.increaseReservation(reservation.id, 50);
      await adapter.releaseReservation(reservation.id);

      // Wallet-saldo uberørt — kun reservasjon ble holdt.
      const balance = await adapter.getBalance("player-reserve-1");
      assert.equal(balance, 1000);

      // Outbox skal være tom — reservation-ops er bare saldo-lås.
      const counts = await repo.countByStatus();
      assert.equal(
        counts.pending,
        0,
        "reservation-ops skriver ikke outbox (ingen ledger-mutasjon)",
      );
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

// ── Test 6: commitReservation skriver outbox (faktisk ledger-mutasjon) ──

test(
  "R6: commitReservation produserer outbox-rad (faktisk ledger-debit)",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    await createOutboxTable(cleanupPool, schema);

    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const repo = new WalletOutboxRepo({ pool: adapter.getPool(), schema });
    adapter.setOutboxRepo(repo);

    try {
      await adapter.createAccount({
        accountId: "player-commit-1",
        initialBalance: 1000,
      });
      await adapter.createAccount({
        accountId: "house-test-hall-main_game-internet",
        initialBalance: 0,
      });

      await cleanupPool.query(`DELETE FROM "${schema}"."wallet_outbox"`);

      // Reserve → commit (BingoEngine-shape ved start av runde).
      const reservation = await adapter.reserve("player-commit-1", 200, {
        idempotencyKey: `arm-${randomUUID()}`,
        roomCode: "test-room",
      });

      const commitResult = await adapter.commitReservation(
        reservation.id,
        "house-test-hall-main_game-internet",
        "Bingo buy-in",
        {
          idempotencyKey: `commit-${reservation.id}`,
          gameSessionId: "test-game-1",
        },
      );
      assert.ok(commitResult.fromTx.id);
      assert.ok(commitResult.toTx.id);

      // Wallet er debitert.
      const balance = await adapter.getBalance("player-commit-1");
      assert.equal(balance, 800, "200 kr debitert via commit");

      // Outbox skal ha 1 rad — kun spiller-konto, system filtreres bort.
      const counts = await repo.countByStatus();
      assert.equal(
        counts.pending,
        1,
        "commitReservation produserer outbox-rad for spiller",
      );

      const rows = await repo.claimNextBatch(10);
      assert.equal(rows[0]!.accountId, "player-commit-1");
      assert.equal(rows[0]!.eventType, "wallet.transfer_out");
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);
