/**
 * Unified pipeline refactor — Fase 0b (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §5.1).
 *
 * Property-based invariant: total wallet-saldo er ALLTID >= 0 etter
 * en hvilken som helst sekvens av wallet-ops på `InMemoryWalletPort`.
 *
 * Hvorfor:
 *   - Wallet-bug-mønsteret denne uken (#677, #682) skyldes at en
 *     fix-flyt skrev til ledger eller audit MEN ikke håndterte
 *     wallet-feil korrekt → noen flyter kunne ende opp med negativ
 *     saldo (dobbel-debit eller manglende rollback).
 *   - DB-CHECK constraint enforcer ikke-negativ saldo, men i kode-
 *     pipelinen er det tryggere å fange feilen i wallet-laget før den
 *     blir til DB-feil.
 *   - InMemoryWalletPort er kontraktuell — hvis property-en holder
 *     der, har vi en baseline for at PayoutService (Fase 1) ikke kan
 *     introdusere logiske bugs som lekker forbi adapter-wrappers.
 *
 * Test-strategi:
 *   - Generer en sekvens av tilfeldige ops (seed/credit/debit/reserve/
 *     commit/release).
 *   - Kjør sekvensen med best-effort feilfanging (forventede feil som
 *     INSUFFICIENT_FUNDS er tillatt; uventede feil throws).
 *   - Etter hver op + ved slutten: assert balance.total >= 0.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { InMemoryWalletPort } from "../../ports/inMemory/InMemoryWalletPort.js";
import type { WalletPort } from "../../ports/WalletPort.js";
import { WalletError } from "../../adapters/WalletAdapter.js";

type WalletOp =
  | { kind: "seed"; depositCents: number; winningsCents: number }
  | { kind: "credit"; amountCents: number; targetSide: "deposit" | "winnings"; key: string }
  | { kind: "debit"; amountCents: number; key: string }
  | { kind: "reserve"; amountCents: number; key: string; roomCode: string }
  | { kind: "commit"; key: string; reason: string }
  | { kind: "release"; key: string };

const opArb = fc.oneof(
  fc.record({
    kind: fc.constant("seed" as const),
    depositCents: fc.integer({ min: 0, max: 1_000_000 }),
    winningsCents: fc.integer({ min: 0, max: 1_000_000 }),
  }),
  fc.record({
    kind: fc.constant("credit" as const),
    amountCents: fc.integer({ min: 1, max: 100_000 }),
    targetSide: fc.constantFrom("deposit" as const, "winnings" as const),
    key: fc.string({ minLength: 4, maxLength: 16 }),
  }),
  fc.record({
    kind: fc.constant("debit" as const),
    amountCents: fc.integer({ min: 1, max: 100_000 }),
    key: fc.string({ minLength: 4, maxLength: 16 }),
  }),
  fc.record({
    kind: fc.constant("reserve" as const),
    amountCents: fc.integer({ min: 1, max: 100_000 }),
    key: fc.string({ minLength: 4, maxLength: 16 }),
    roomCode: fc.constantFrom("ROOM-A", "ROOM-B"),
  }),
  fc.record({
    kind: fc.constant("commit" as const),
    key: fc.string({ minLength: 4, maxLength: 16 }),
    reason: fc.constantFrom("test-commit", "buy-tickets"),
  }),
  fc.record({
    kind: fc.constant("release" as const),
    key: fc.string({ minLength: 4, maxLength: 16 }),
  }),
);

async function runOp(
  port: InMemoryWalletPort,
  walletId: string,
  reservationByKey: Map<string, string>,
  op: WalletOp,
): Promise<void> {
  switch (op.kind) {
    case "seed":
      port.seed(walletId, op.depositCents, op.winningsCents);
      return;

    case "credit":
      await (port as WalletPort).credit({
        walletId,
        amountCents: op.amountCents,
        reason: "fc-credit",
        idempotencyKey: `credit:${op.key}`,
        targetSide: op.targetSide,
      });
      return;

    case "debit":
      try {
        await (port as WalletPort).debit({
          walletId,
          amountCents: op.amountCents,
          reason: "fc-debit",
          idempotencyKey: `debit:${op.key}`,
        });
      } catch (err) {
        if (err instanceof WalletError && err.code === "INSUFFICIENT_FUNDS") return;
        throw err;
      }
      return;

    case "reserve":
      try {
        const r = await (port as WalletPort).reserve({
          walletId,
          amountCents: op.amountCents,
          idempotencyKey: `reserve:${op.key}`,
          roomCode: op.roomCode,
        });
        reservationByKey.set(op.key, r.id);
      } catch (err) {
        if (err instanceof WalletError && (err.code === "INSUFFICIENT_FUNDS" || err.code === "IDEMPOTENCY_MISMATCH")) {
          return;
        }
        throw err;
      }
      return;

    case "commit": {
      const reservationId = reservationByKey.get(op.key);
      if (!reservationId) return;
      try {
        await (port as WalletPort).commitReservation({
          reservationId,
          toAccountId: "house-test",
          reason: op.reason,
          idempotencyKey: `commit:${op.key}`,
        });
      } catch (err) {
        if (err instanceof WalletError) {
          // Allowed: RESERVATION_ALREADY_COMMITTED (re-commit), INVALID_STATE
          // (already released), RESERVATION_NOT_FOUND (random-key collision).
          return;
        }
        throw err;
      }
      return;
    }

    case "release": {
      const reservationId = reservationByKey.get(op.key);
      if (!reservationId) return;
      try {
        await (port as WalletPort).releaseReservation(reservationId);
      } catch (err) {
        if (err instanceof WalletError) return;
        throw err;
      }
      return;
    }
  }
}

test("invariant: wallet balance never negative after any sequence of ops", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 30 }), async (ops) => {
      const port = new InMemoryWalletPort();
      const walletId = "wallet-fc-1";
      const reservationByKey = new Map<string, string>();

      for (const op of ops) {
        await runOp(port, walletId, reservationByKey, op);
        // Per-step assertion: total >= 0 etter hver op.
        const balance = await port.getBalance(walletId);
        assert.ok(
          balance.total >= 0,
          `Negative balance after ${op.kind}: total=${balance.total}, deposit=${balance.deposit}, winnings=${balance.winnings}`,
        );
        assert.ok(balance.deposit >= 0, `Negative deposit-side: ${balance.deposit}`);
        assert.ok(balance.winnings >= 0, `Negative winnings-side: ${balance.winnings}`);
      }

      // Slutt-assertion: total = deposit + winnings (selvfølgelig, men en
      // explicit-check fanger evt. drift hvis getBalance noensinne skulle
      // returnere out-of-sync verdier). Vi bruker cents-snittet for å unngå
      // floating-point-akkumulering — getBalance returnerer kroner.
      const finalCents = port.getBalanceCents(walletId);
      assert.equal(
        finalCents.totalCents,
        finalCents.depositCents + finalCents.winningsCents,
        "Total skal være eksakt sum av deposit + winnings (i øre).",
      );
    }),
    { numRuns: 100 },
  );
});

test("invariant: idempotent credit/debit returnerer samme tx, treffer balance kun én gang", async () => {
  const port = new InMemoryWalletPort();
  const walletId = "wallet-idempotent";
  port.seed(walletId, 100_000); // 1000 NOK

  // Credit 5 ganger med samme key → kun 1 økning.
  for (let i = 0; i < 5; i++) {
    await port.credit({
      walletId,
      amountCents: 50_000,
      reason: "duplicate-credit",
      idempotencyKey: "credit:dupe-1",
      targetSide: "deposit",
    });
  }
  let balance = await port.getBalance(walletId);
  assert.equal(balance.total, 1500, "Total etter 5x dupe-credit skal være 1000 + 500 = 1500 NOK");

  // Debit 3 ganger med samme key → kun 1 nedgang.
  for (let i = 0; i < 3; i++) {
    await port.debit({
      walletId,
      amountCents: 30_000,
      reason: "duplicate-debit",
      idempotencyKey: "debit:dupe-1",
    });
  }
  balance = await port.getBalance(walletId);
  assert.equal(balance.total, 1200, "Total etter 3x dupe-debit skal være 1500 - 300 = 1200 NOK");
});

test("invariant: reserve + commit reduserer balance eksakt én gang", async () => {
  const port = new InMemoryWalletPort();
  const walletId = "wallet-commit-once";
  port.seed(walletId, 100_000); // 1000 NOK

  const r = await port.reserve({
    walletId,
    amountCents: 50_000,
    idempotencyKey: "reserve:commit-once",
    roomCode: "ROOM-1",
  });
  // Balance er fortsatt 1000 NOK før commit (reservation reduserer kun
  // tilgjengelig saldo, ikke total).
  let balance = await port.getBalance(walletId);
  assert.equal(balance.total, 1000);

  await port.commitReservation({
    reservationId: r.id,
    toAccountId: "house-test",
    reason: "first-commit",
    idempotencyKey: "commit:once",
  });
  balance = await port.getBalance(walletId);
  assert.equal(balance.total, 500, "Etter commit skal saldo være 500 NOK");

  // Re-commit med samme idempotency-key → samme tx returneres, ingen
  // dobbel-debit.
  await port.commitReservation({
    reservationId: r.id,
    toAccountId: "house-test",
    reason: "second-commit",
    idempotencyKey: "commit:once",
  });
  balance = await port.getBalance(walletId);
  assert.equal(balance.total, 500, "Re-commit skal ikke trekke igjen");
});
