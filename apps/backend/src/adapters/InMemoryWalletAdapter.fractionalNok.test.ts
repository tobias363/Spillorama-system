/**
 * PR #513 §1.1 (KRITISK pilot-blokker, 2026-04-25):
 * Wallet-reservasjon må støtte fractional NOK uten trunkering.
 *
 * Bakgrunn:
 *   `app_wallet_reservations.amount_cents` var BIGINT som trunkerte 12.50
 *   til 12 ved INSERT. roomEvents.ts beregner `deltaKr = deltaWeighted * entryFee`
 *   hvor entryFee kan være desimal. Migrasjon `20260425000000_wallet_reservations_numeric.sql`
 *   bytter typen til NUMERIC(20,6) for å matche resten av wallet-skjemaet.
 *
 * Disse testene dekker InMemory-adapteren (alltid `number`, ingen DB-typing).
 * Postgres-paritet ligger i `PostgresWalletAdapter.reservation.test.ts` som
 * skipper uten ekte PG.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryWalletAdapter } from "./InMemoryWalletAdapter.js";

test("PR #513 §1.1 reserve: bevarer fractional NOK (12.50 kr per brett)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "wallet-frac-1", initialBalance: 100 });

  // 1 brett × 12.50 kr — vanlig prising for "small bingo"-bonger.
  const reservation = await adapter.reserve!("wallet-frac-1", 12.5, {
    idempotencyKey: "arm-FRAC-p1-1",
    roomCode: "FRAC",
  });

  assert.equal(reservation.amount, 12.5, "fractional amount må ikke trunkeres");
  assert.equal(
    await adapter.getAvailableBalance!("wallet-frac-1"),
    87.5,
    "available skal være 100 - 12.50 = 87.50",
  );
});

test("PR #513 §1.1 reserve: aggregat av flere fractional reservasjoner", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "wallet-frac-2", initialBalance: 100 });

  // 3 small + 2 medium med ulike priser = brutto 78.25 kr.
  await adapter.reserve!("wallet-frac-2", 12.5, { idempotencyKey: "k1", roomCode: "R1" });
  await adapter.reserve!("wallet-frac-2", 25.75, { idempotencyKey: "k2", roomCode: "R1" });
  await adapter.reserve!("wallet-frac-2", 40.0, { idempotencyKey: "k3", roomCode: "R1" });

  const available = await adapter.getAvailableBalance!("wallet-frac-2");
  // 100 - (12.5 + 25.75 + 40) = 21.75
  assert.equal(available, 21.75, "fractional aggregat må stemme");
});

test("PR #513 §1.1 increaseReservation: fractional delta bevares", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "wallet-frac-3", initialBalance: 100 });

  const r = await adapter.reserve!("wallet-frac-3", 12.5, {
    idempotencyKey: "k1",
    roomCode: "R1",
  });
  await adapter.increaseReservation!(r.id, 7.25);
  const list = await adapter.listActiveReservations!("wallet-frac-3");
  assert.equal(list.length, 1);
  assert.equal(list[0].amount, 19.75, "12.5 + 7.25 = 19.75 (ingen trunkering)");
});

test("PR #513 §1.1 commitReservation: fractional beløp bevares i transfer", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "wallet-frac-4", initialBalance: 100 });
  await adapter.createAccount({ accountId: "house-frac", initialBalance: 0 });

  const r = await adapter.reserve!("wallet-frac-4", 37.5, {
    idempotencyKey: "k1",
    roomCode: "R1",
  });
  const transfer = await adapter.commitReservation!(r.id, "house-frac", "buy-in");

  assert.equal(transfer.fromTx.amount, 37.5);
  assert.equal(transfer.toTx.amount, 37.5);
  assert.equal(await adapter.getBalance("wallet-frac-4"), 62.5);
});
