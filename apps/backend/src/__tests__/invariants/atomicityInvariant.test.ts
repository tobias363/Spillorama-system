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

// ── Fase 1 atomicity-tester (med PayoutService) ──────────────────────────────
//
// Disse testene bruker PayoutService for å verifisere atomicity-kontrakten:
//   - Wallet-feil kaster PayoutWalletCreditError → caller forventes å rolle
//     tilbake outer-tx, slik at compliance/audit ikke blir til halv-skrevet
//     state.
//   - Multi-winner: hvis credit feiler på vinner #2 av 3, har vinner #1
//     allerede fått credit. Det er en bevisst del av kontrakten — outer-tx
//     er det som garanterer atomicity. PayoutService selv lager ikke ny tx.

import {
  PayoutService,
  PayoutWalletCreditError,
} from "../../services/PayoutService.js";

test("invariant: PayoutService — wallet-feil på første vinner → ingen partial state (compliance + audit tomme)", async () => {
  // Strategi: mock wallet.credit til å feile umiddelbart. Verifisér at
  // PayoutService kaster før compliance.recordEvent skrives, slik at det
  // ikke etterlates "wallet OK + compliance OK + wallet failed på neste"-
  // state.
  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  const audit = new InMemoryAuditPort();
  const keys = new DefaultIdempotencyKeyPort();

  // Override wallet.credit → kast WalletError ved første kall.
  wallet.credit = async () => {
    throw new WalletError("INVALID_INPUT", "simulert wallet-feil");
  };

  const service = new PayoutService({ wallet, compliance, audit, keys });

  await assert.rejects(
    () =>
      service.payoutPhase({
        gameId: "game-rollback",
        phaseId: "phase-1",
        phaseName: "1 Rad",
        winners: [
          { walletId: "wallet-1", playerId: "player-1", hallId: "hall-1", claimId: "claim-1" },
        ],
        totalPrizeCents: 10_000,
        actorHallId: "hall-1",
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      }),
    (err: unknown) => err instanceof PayoutWalletCreditError,
  );

  // Verifisér: ingen compliance-entries (vi kastet før step 2).
  assert.equal(compliance.count(), 0, "compliance skal være tom etter rollback");
  // Verifisér: ingen audit-entries (vi kastet før step 4).
  assert.equal(audit.count(), 0, "audit skal være tom etter rollback");
});

test("invariant: PayoutService — wallet-feil på SISTE vinner kaster, men tidligere wallet-credits er allerede committed (caller-tx-ansvar)", async () => {
  // Strategi: tre vinnere. Wallet.credit feiler kun på den 3. (siste).
  // Verifisér: vinner #1 og #2 fikk credit + ingen compliance/audit
  // skrives fordi step 2-4 kommer etter ALLE step 1 wallet-credits.
  //
  // Dette dokumenterer at PayoutService's atomicity-kontrakt er:
  //   - Step 1 (wallet) er sekvensiell. Hvis én feiler, er noen credits
  //     allerede committed på wallet-laget.
  //   - Step 2-4 (compliance/audit) kjøres KUN hvis alle wallet-credits
  //     lykkes.
  //   - For full atomicity må caller wrappe alt i en outer-tx slik at
  //     wallet-credits også ruller tilbake.
  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  const audit = new InMemoryAuditPort();
  const keys = new DefaultIdempotencyKeyPort();
  wallet.seed("wallet-A", 0);
  wallet.seed("wallet-B", 0);
  wallet.seed("wallet-C", 0);

  // Override wallet.credit til å feile på 3. kall.
  let callCount = 0;
  const originalCredit = wallet.credit.bind(wallet);
  wallet.credit = async (input) => {
    callCount++;
    if (callCount === 3) {
      throw new WalletError("INVALID_INPUT", "feilet på 3. vinner");
    }
    return originalCredit(input);
  };

  const service = new PayoutService({ wallet, compliance, audit, keys });

  await assert.rejects(
    () =>
      service.payoutPhase({
        gameId: "game-partial-fail",
        phaseId: "phase-1",
        phaseName: "1 Rad",
        winners: [
          { walletId: "wallet-A", playerId: "p-A", hallId: "h", claimId: "claim-A" },
          { walletId: "wallet-B", playerId: "p-B", hallId: "h", claimId: "claim-B" },
          { walletId: "wallet-C", playerId: "p-C", hallId: "h", claimId: "claim-C" },
        ],
        totalPrizeCents: 30_000,
        actorHallId: "h",
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      }),
    (err: unknown) => err instanceof PayoutWalletCreditError,
  );

  // Wallet-balance verifisering: A + B fikk credit (deres credits ble
  // committed i InMemoryWalletPort før credit #3 feilet). C fikk ikke.
  // I prod ville en outer-tx rolle tilbake ALLE credits, men det er
  // caller-ansvar — InMemoryWalletPort har ikke tx-semantics.
  const balA = await wallet.getBalance("wallet-A");
  const balB = await wallet.getBalance("wallet-B");
  const balC = await wallet.getBalance("wallet-C");
  assert.equal(balA.winnings, 100, "Wallet A fikk credit før failure");
  assert.equal(balB.winnings, 100, "Wallet B fikk credit før failure");
  assert.equal(balC.winnings, 0, "Wallet C fikk IKKE credit (kastet under)");

  // Compliance og audit skal være tomme — step 2-4 ble aldri nådd fordi
  // step 1 kastet på vinner #3.
  assert.equal(
    compliance.count(),
    0,
    "compliance skal være tom — vi nådde aldri step 2",
  );
  assert.equal(
    audit.count(),
    0,
    "audit skal være tom — vi nådde aldri step 4",
  );
});

test("invariant: PayoutService — soft-fail på compliance påvirker IKKE wallet eller audit", async () => {
  // Strategi: wallet og audit er ok, men compliance.recordEvent kaster.
  // PayoutService logger advarsel og fortsetter (soft-fail-policy).
  // Verifisér: wallet committed, audit logget, compliance er fortsatt 0.
  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  const audit = new InMemoryAuditPort();
  const keys = new DefaultIdempotencyKeyPort();
  wallet.seed("wallet-1", 0);

  // Override compliance.recordEvent til å kaste.
  compliance.recordEvent = async () => {
    throw new Error("simulert compliance-feil (DB-utilgjengelig)");
  };

  const service = new PayoutService({ wallet, compliance, audit, keys });

  // Skal IKKE kaste — compliance-feil er soft-fail.
  const result = await service.payoutPhase({
    gameId: "game-soft-fail",
    phaseId: "phase-1",
    phaseName: "1 Rad",
    winners: [
      { walletId: "wallet-1", playerId: "p", hallId: "h", claimId: "c" },
    ],
    totalPrizeCents: 10_000,
    actorHallId: "h",
    isFixedPrize: true,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  // Wallet committed.
  assert.equal((await wallet.getBalance("wallet-1")).winnings, 100);
  // Audit logget (kjøres etter compliance i sekvens, men compliance kastet
  // ikke videre — den ble fanget og logget som warning).
  assert.equal(audit.count(), 1, "Audit skal logges selv om compliance feilet");
  // Result reflekterer credit.
  assert.equal(result.prizePerWinnerCents, 10_000);
  assert.notEqual(result.winnerRecords[0]!.walletTxId, null);
});

// PENDING (Fase 4 — outer-tx GameOrchestrator): når PayoutService kalles
// gjennom GameOrchestrator's transaction-wrapper, kan vi verifisere FULL
// atomicity (wallet credits + compliance + audit ruller tilbake sammen ved
// hvilken som helst feil). Det krever PostgresWalletPort + tx-context og
// kan ikke testes på InMemory-nivå.
test.todo(
  "invariant: PayoutService innenfor outer-tx ruller tilbake ALLE writes ved hvilken som helst step-feil (Fase 4)",
);
