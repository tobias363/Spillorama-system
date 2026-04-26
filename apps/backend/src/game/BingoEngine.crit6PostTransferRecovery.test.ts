/**
 * CRIT-6 K3 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26):
 *
 * Atomic-coordinator-task. Bygger videre på K2-B (state-mutasjon-rollback)
 * ved å verifisere at post-transfer audit-trail-feil:
 *   1. Ikke ruller tilbake state (pengene er tross alt allerede betalt).
 *   2. Markerer claim.auditTrailStatus = "degraded".
 *   3. Fyrer en strukturert recovery-event på `claimAuditTrailRecovery`-
 *      porten med komplett payload for replay.
 *   4. Lar de andre stegene fortsette uten å bli blokkert.
 *
 * **Hvorfor matters:** før K3 var et feilet audit-steg kun synlig som en
 * log-error. Det krevde manuell ops-rekonsiliering (les loggen → bygg
 * tilsvarende DB-rader manuelt). K3 introduserer en strukturert event
 * som kan ende i en recovery-queue → bakgrunns-job → automatisk replay.
 *
 * **Out-of-scope:** reell tx-atomicity (én outer DB-tx på tvers av wallet-
 * transfer + alle 5 services) krever større refactor — dokumentert i
 * `runPostTransferClaimAuditTrail`-JSDoc.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type {
  ClaimAuditTrailRecoveryPort,
  ClaimAuditTrailFailedEvent,
} from "../adapters/ClaimAuditTrailRecoveryPort.js";
import type { Ticket } from "./types.js";

// Fixed grid identical med BingoEngine.crit6Atomicity.test.ts.
class FixedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [13, 14, 15, 16, 17],
        [25, 26, 0, 27, 28],
        [37, 38, 39, 40, 41],
        [49, 50, 51, 52, 53],
      ],
    };
  }
}

const LINE_NUMBERS = [1, 2, 3, 4, 5];

class CapturingRecoveryPort implements ClaimAuditTrailRecoveryPort {
  events: ClaimAuditTrailFailedEvent[] = [];
  private _shouldThrow = false;

  failNextRecoveryCall(): void {
    this._shouldThrow = true;
  }

  async onAuditTrailStepFailed(
    event: ClaimAuditTrailFailedEvent
  ): Promise<void> {
    this.events.push(event);
    if (this._shouldThrow) {
      this._shouldThrow = false;
      throw new Error("Simulert recovery-port-feil for test");
    }
  }
}

function prioritizeDrawNumbers(
  engine: BingoEngine,
  roomCode: string,
  preferredNumbers: readonly number[]
): void {
  const internalRoomState = (
    engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }
  ).rooms.get(roomCode);
  const drawBag = internalRoomState?.currentGame?.drawBag;
  if (!drawBag || drawBag.length === 0) {
    return;
  }
  const prioritized = preferredNumbers.filter((value) => drawBag.includes(value));
  if (prioritized.length === 0) {
    return;
  }
  const remainder = drawBag.filter((value) => !prioritized.includes(value));
  internalRoomState!.currentGame!.drawBag = [...prioritized, ...remainder];
}

async function setupRoomReadyForLine(
  recovery: ClaimAuditTrailRecoveryPort
): Promise<{
  engine: BingoEngine;
  wallet: InMemoryWalletAdapter;
  roomCode: string;
  hostId: string;
}> {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketAdapter(), wallet, {
    minPlayersToStart: 1,
    minDrawIntervalMs: 0,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
    claimAuditTrailRecovery: recovery,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 100,
    payoutPercent: 80,
    armedPlayerIds: [playerId],
  });
  prioritizeDrawNumbers(engine, roomCode, LINE_NUMBERS);
  for (let i = 0; i < LINE_NUMBERS.length; i++) {
    const { number: drawn } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: playerId,
    });
    await engine.markNumber({ roomCode, playerId, number: drawn });
  }
  return { engine, wallet, roomCode, hostId: playerId };
}

// ── 1: complianceLossEntry-feil → degraded + recovery-event fyrt ──────────

test("CRIT-6 K3: compliance.recordLossEntry-feil → claim.auditTrailStatus=degraded + REGULATORY recovery-event", async () => {
  const recovery = new CapturingRecoveryPort();
  const { engine, roomCode, hostId } = await setupRoomReadyForLine(recovery);

  // Inject feil i compliance.recordLossEntry. compliance er protected, så vi
  // bruker as-cast for å nå metoden i test-konteksten.
  const compliance = (engine as unknown as { compliance: { recordLossEntry: (...args: unknown[]) => Promise<void> } }).compliance;
  const original = compliance.recordLossEntry.bind(compliance);
  let callCount = 0;
  compliance.recordLossEntry = async (...args: unknown[]): Promise<void> => {
    callCount++;
    // Første kall = BUYIN under startGame (ikke vår feil-target).
    // Andre+ kall = PAYOUT post-transfer = injiser feil.
    const entry = args[2] as { type: string };
    if (entry?.type === "PAYOUT") {
      throw new Error("Simulert compliance-feil for K3-test");
    }
    return original(...(args as Parameters<typeof original>));
  };

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });

  // Claim er valid, payoutAmount > 0 — pengene er betalt.
  assert.equal(claim.valid, true);
  assert.ok(claim.payoutAmount && claim.payoutAmount > 0);
  // CRIT-6 K3 hovedkrav: status=degraded når et steg feilet.
  assert.equal(claim.auditTrailStatus, "degraded");
  // Recovery-event fyrt med riktig step + REGULATORY severity.
  assert.equal(recovery.events.length, 1, "exact 1 recovery-event forventet");
  const event = recovery.events[0];
  assert.equal(event.step, "complianceLossEntry");
  assert.equal(event.severity, "REGULATORY");
  assert.equal(event.phase, "LINE");
  assert.equal(event.claimId, claim.id);
  assert.equal(event.payoutAmount, claim.payoutAmount);
  assert.ok(event.errorMessage.includes("compliance-feil"));
  assert.ok(event.failedAt, "failedAt skal være satt");

  // State er fortsatt mutert — pengene er betalt.
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot!.currentGame!.lineWinnerId, hostId);
  void callCount;
});

// ── 2: ledger.recordComplianceLedgerEvent-feil → degraded + REGULATORY ────

test("CRIT-6 K3: ledger.recordComplianceLedgerEvent-feil → REGULATORY recovery-event + andre steg fortsetter", async () => {
  const recovery = new CapturingRecoveryPort();
  const { engine, roomCode, hostId } = await setupRoomReadyForLine(recovery);

  const ledger = (engine as unknown as { ledger: { recordComplianceLedgerEvent: (...args: unknown[]) => Promise<void> } }).ledger;
  ledger.recordComplianceLedgerEvent = async (): Promise<void> => {
    throw new Error("Simulert ledger-feil for K3-test");
  };

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });

  assert.equal(claim.valid, true);
  assert.equal(claim.auditTrailStatus, "degraded");
  assert.equal(recovery.events.length, 1);
  const event = recovery.events[0];
  assert.equal(event.step, "complianceLedgerEvent");
  assert.equal(event.severity, "REGULATORY");
  // Payload skal inneholde alt en replay-job trenger for re-kall.
  assert.equal(event.payload.eventType, "PRIZE");
  assert.equal(event.payload.amount, claim.payoutAmount);
  assert.equal(event.payload.hallId, "hall-1");
  assert.ok(event.payload.gameId);
  assert.ok(event.payload.claimId);
});

// ── 3: payoutAudit.appendPayoutAuditEvent-feil → INTERNAL severity ────────

test("CRIT-6 K3: payoutAudit-feil → INTERNAL severity + andre steg fortsetter", async () => {
  const recovery = new CapturingRecoveryPort();
  const { engine, roomCode, hostId } = await setupRoomReadyForLine(recovery);

  const payoutAudit = (engine as unknown as { payoutAudit: { appendPayoutAuditEvent: (...args: unknown[]) => Promise<void> } }).payoutAudit;
  payoutAudit.appendPayoutAuditEvent = async (): Promise<void> => {
    throw new Error("Simulert payout-audit-feil");
  };

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });

  assert.equal(claim.valid, true);
  assert.equal(claim.auditTrailStatus, "degraded");
  assert.equal(recovery.events.length, 1);
  const event = recovery.events[0];
  assert.equal(event.step, "payoutAuditEvent");
  // Payout-audit er INTERNAL, ikke regulatorisk.
  assert.equal(event.severity, "INTERNAL");
  assert.equal(event.payload.kind, "CLAIM_PRIZE");
  assert.ok(Array.isArray(event.payload.txIds));
});

// ── 4: Multiple failures akkumuleres alle på recovery-port ────────────────

test("CRIT-6 K3: hvis BÅDE compliance og ledger feiler — begge events fyrt", async () => {
  const recovery = new CapturingRecoveryPort();
  const { engine, roomCode, hostId } = await setupRoomReadyForLine(recovery);

  const compliance = (engine as unknown as { compliance: { recordLossEntry: (...args: unknown[]) => Promise<void> } }).compliance;
  const original = compliance.recordLossEntry.bind(compliance);
  compliance.recordLossEntry = async (...args: unknown[]): Promise<void> => {
    const entry = args[2] as { type: string };
    if (entry?.type === "PAYOUT") {
      throw new Error("Simulert compliance-feil");
    }
    return original(...(args as Parameters<typeof original>));
  };

  const ledger = (engine as unknown as { ledger: { recordComplianceLedgerEvent: (...args: unknown[]) => Promise<void> } }).ledger;
  ledger.recordComplianceLedgerEvent = async (): Promise<void> => {
    throw new Error("Simulert ledger-feil");
  };

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });

  assert.equal(claim.valid, true);
  assert.equal(claim.auditTrailStatus, "degraded");
  // 2 events: én per feilende steg.
  assert.equal(recovery.events.length, 2);
  const stepNames = recovery.events.map((e) => e.step).sort();
  assert.deepEqual(stepNames, ["complianceLedgerEvent", "complianceLossEntry"]);
  // Begge er REGULATORY.
  for (const event of recovery.events) {
    assert.equal(event.severity, "REGULATORY");
  }
});

// ── 5: Recovery-port kaster — fail-soft, payout fortsatt OK ────────────────

test("CRIT-6 K3: hvis recovery-port selv kaster — engine fail-soft, claim fortsatt valid", async () => {
  const recovery = new CapturingRecoveryPort();
  const { engine, roomCode, hostId } = await setupRoomReadyForLine(recovery);

  const ledger = (engine as unknown as { ledger: { recordComplianceLedgerEvent: (...args: unknown[]) => Promise<void> } }).ledger;
  ledger.recordComplianceLedgerEvent = async (): Promise<void> => {
    throw new Error("Simulert ledger-feil");
  };

  // Recovery-port-en kaster også — engine MÅ ikke propagere.
  recovery.failNextRecoveryCall();

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });

  // Claim fortsatt valid — pengene er betalt.
  assert.equal(claim.valid, true);
  assert.ok(claim.payoutAmount && claim.payoutAmount > 0);
  // Status = degraded fordi audit-steget feilet (uavhengig av at recovery også feilet).
  assert.equal(claim.auditTrailStatus, "degraded");
  // Recovery-event fanget før den kastet (capture-listen er synlig).
  assert.equal(recovery.events.length, 1);
});

// ── 6: Happy path — status=complete, ingen recovery-events ────────────────

test("CRIT-6 K3: happy path — auditTrailStatus=complete + ingen recovery-events", async () => {
  const recovery = new CapturingRecoveryPort();
  const { engine, roomCode, hostId } = await setupRoomReadyForLine(recovery);

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });

  assert.equal(claim.valid, true);
  assert.equal(
    claim.auditTrailStatus,
    "complete",
    "ingen audit-feil → status skal være complete"
  );
  assert.equal(
    recovery.events.length,
    0,
    "ingen feil → ingen recovery-events"
  );
});

// ── 7: Backwards-compat — ad-hoc Spill 2/3 uten recovery-port wired ────────

test("CRIT-6 K3: BingoEngine uten claimAuditTrailRecovery-wire — feiler stille (log-only fallback)", async () => {
  // Ingen recovery-port wired = NoopClaimAuditTrailRecoveryPort default.
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketAdapter(), wallet, {
    minPlayersToStart: 1,
    minDrawIntervalMs: 0,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
    // claimAuditTrailRecovery utelatt — defaults til Noop.
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 100,
    payoutPercent: 80,
    armedPlayerIds: [playerId],
  });
  prioritizeDrawNumbers(engine, roomCode, LINE_NUMBERS);
  for (let i = 0; i < LINE_NUMBERS.length; i++) {
    const { number: drawn } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: playerId,
    });
    await engine.markNumber({ roomCode, playerId, number: drawn });
  }

  // Inject feil i ledger.
  const ledger = (engine as unknown as { ledger: { recordComplianceLedgerEvent: (...args: unknown[]) => Promise<void> } }).ledger;
  ledger.recordComplianceLedgerEvent = async (): Promise<void> => {
    throw new Error("Simulert ledger-feil uten recovery-port");
  };

  // Engine skal ikke kaste — Noop-port absorberer.
  const claim = await engine.submitClaim({
    roomCode,
    playerId,
    type: "LINE",
  });

  assert.equal(claim.valid, true);
  // Status er fortsatt "degraded" (en feil i et steg) — recovery-port-mangelen
  // skjuler ikke at audit-trailen er degradert, kun at det ikke finnes en
  // automatisk replay-route.
  assert.equal(claim.auditTrailStatus, "degraded");
});
