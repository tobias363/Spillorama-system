/**
 * Unified pipeline refactor — Fase 0b (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §5.1).
 *
 * Invariant: payout-flow rollback etterlater ingen partial state.
 *
 * MERK (Fase 0): denne testen kan ikke fullt verifiseres før Fase 1 lander
 * `PayoutService`. Vi skriver et test-skall som dokumenterer kontrakten,
 * og en proxy-test som verifiserer at portene har de byggeklossene som
 * gjør atomicity mulig (idempotency, fail-fast credit, audit-batching).
 *
 * Hvorfor:
 *   - 12+ compliance-call-sites har "soft-fail-after-wallet"-mønster
 *     (wallet succeeds, compliance fails, retry duplicates compliance).
 *   - PayoutService-kontrakten i §3.5: ALLE writes (wallet credits,
 *     compliance ledger, audit log, gameStore phase-mark) i ÉN tx —
 *     enten alle commit eller alle rollback.
 *   - Med atomicity garantert er retry-mønsteret trygt:
 *       - Hvis retry kommer FØR commit → ingen state ble skrevet.
 *       - Hvis retry kommer ETTER commit → idempotency-keys hindrer
 *         dobbel-write.
 *
 * Status:
 *   - 1 PASSING test: portene støtter atomicity-mønsteret.
 *   - 1 PENDING test (`test.todo`): full PayoutService-rollback krever Fase 1.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryWalletPort } from "../../ports/inMemory/InMemoryWalletPort.js";
import { InMemoryCompliancePort } from "../../ports/inMemory/InMemoryCompliancePort.js";
import { InMemoryAuditPort } from "../../ports/inMemory/InMemoryAuditPort.js";
import { DefaultIdempotencyKeyPort } from "../../ports/IdempotencyKeyPort.js";
import { WalletError } from "../../adapters/WalletAdapter.js";
import type { ComplianceEvent } from "../../ports/CompliancePort.js";

test("invariant: portene støtter atomicity-mønsteret (idempotency + fail-fast credit)", async () => {
  // Vi simulerer payout-stegene IKKE i en transaksjon (som er Fase 1-jobben),
  // men verifiserer at hvert steg er reversibelt eller idempotent på en
  // måte som muliggjør atomic-wrapping.

  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  const audit = new InMemoryAuditPort();
  const keys = new DefaultIdempotencyKeyPort();

  wallet.seed("wallet-1", 0);
  const phaseId = "phase-1";
  const gameId = "game-1";
  const playerId = "player-1";
  const payoutKey = keys.forPayout(gameId, phaseId, playerId);
  const complianceKey = keys.forCompliance("PRIZE", gameId, null, playerId);

  // Step 1: wallet credit. Lykkes.
  const tx = await wallet.credit({
    walletId: "wallet-1",
    amountCents: 10_000,
    reason: "phase-payout",
    idempotencyKey: payoutKey,
    targetSide: "winnings",
  });
  assert.equal(tx.amount, 100);

  // Step 2: compliance.recordEvent. Lykkes.
  const event: ComplianceEvent = {
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType: "PRIZE",
    amount: 100,
    gameId,
    playerId,
    walletId: "wallet-1",
  };
  await compliance.recordEvent(event, complianceKey);

  // Step 3: audit.log. Lykkes (fire-and-forget — kan ikke kaste).
  await audit.log({
    actorId: null,
    actorType: "SYSTEM",
    action: "game.payout.phase",
    resource: "game",
    resourceId: gameId,
    details: { playerId, amount: 100 },
  });

  // Verifiser baseline state.
  assert.equal((await wallet.getBalance("wallet-1")).winnings, 100);
  assert.equal(compliance.count(), 1);
  assert.equal(audit.count(), 1);

  // Hvis vi nå retry hele payout-operasjonen (e.g. fordi ingen committet
  // én transaksjon i en faktisk produksjons-flyt), skal alle 3 portene
  // være idempotente:
  await wallet.credit({
    walletId: "wallet-1",
    amountCents: 10_000,
    reason: "phase-payout",
    idempotencyKey: payoutKey,
    targetSide: "winnings",
  });
  await compliance.recordEvent(event, complianceKey);
  await audit.log({
    actorId: null,
    actorType: "SYSTEM",
    action: "game.payout.phase",
    resource: "game",
    resourceId: gameId,
    details: { playerId, amount: 100, retry: true },
  });

  // Verifisér: wallet og compliance er idempotente, audit er ikke
  // (fire-and-forget — hver retry skaper en ny rad). Dette er en bevisst
  // design-decision: audit-events er en historikk-strøm der duplikater
  // kan tolereres av konsumenter, mens wallet/compliance MÅ være eksakt
  // én skrive per logiske event.
  assert.equal((await wallet.getBalance("wallet-1")).winnings, 100, "Idempotent credit treffer kun én gang");
  assert.equal(compliance.count(), 1, "Idempotent compliance treffer kun én gang");
  assert.equal(audit.count(), 2, "Audit logger en rad per kall (ikke idempotent — fire-and-forget)");
});

test("invariant: wallet INSUFFICIENT_FUNDS kaster fail-fast (caller kan rolle tilbake compliance/audit)", async () => {
  // Denne testen viser at wallet-laget gir caller en mulighet til å
  // detektere feil FØR compliance/audit skrives. Det er forutsetningen
  // for "wrap alt i én transaksjon" (Fase 1 PayoutService).
  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  wallet.seed("wallet-thin", 0); // ingen funds

  // Forsøk debit som vil feile.
  await assert.rejects(
    () =>
      wallet.debit({
        walletId: "wallet-thin",
        amountCents: 5000,
        reason: "should-fail",
        idempotencyKey: "debit:fail-1",
      }),
    (err: unknown) => err instanceof WalletError && err.code === "INSUFFICIENT_FUNDS",
  );

  // Verifiser at wallet IKKE er endret (ingen partial state).
  const balance = await wallet.getBalance("wallet-thin");
  assert.equal(balance.total, 0);

  // Compliance er heller ikke endret (caller hadde aldri muligheten til å
  // skrive — wallet kastet før).
  assert.equal(compliance.count(), 0);
});

// PENDING (Fase 1): full PayoutService-rollback. Når PayoutService
// eksisterer kan vi mocke walletPort.credit til å feile ETTER at
// compliance.recordEvent har lykkes, og verifisere at PayoutService
// ruller tilbake compliance via tx.ROLLBACK.
test.todo(
  "invariant: PayoutService rollback fjerner alle ledger-entries og audit-entries (Fase 1)",
);
