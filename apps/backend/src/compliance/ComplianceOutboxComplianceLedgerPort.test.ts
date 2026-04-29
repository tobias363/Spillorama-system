/**
 * COMP-P0-002: tester for ComplianceOutboxComplianceLedgerPort decorator.
 *
 * Verifiserer at decoratoren:
 *   - Skriver til outbox FØR inline dispatch (atomisk-ekvivalent garanti).
 *   - Når inline dispatch lykkes → markerer rad processed.
 *   - Når inline dispatch feiler → lar rad bli pending (worker retry-er).
 *   - Når outbox-write feiler → faller tilbake til ren inline dispatch.
 *   - Idempotent: samme key → enqueue-no-op + skipper inline dispatch
 *     (allerede enqueued, garanti for eventual delivery via worker).
 *   - Aldri kaster (matcher fire-and-forget-kontrakten).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ComplianceOutboxComplianceLedgerPort } from "./ComplianceOutboxComplianceLedgerPort.js";
import type {
  ComplianceOutboxEntry,
} from "./ComplianceOutboxRepo.js";
import type {
  ComplianceLedgerEventInput,
  ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";

// ── Fake outbox-repo (only methods decorator uses) ───────────────────────────

class FakeOutboxRepo {
  enqueueCalls: ComplianceOutboxEntry[] = [];
  enqueueShouldFail = false;
  enqueueShouldReturnFalse = false;
  markProcessedByKeyCalls: string[] = [];
  markProcessedByKeyShouldFail = false;

  async enqueue(entry: ComplianceOutboxEntry): Promise<boolean> {
    this.enqueueCalls.push(entry);
    if (this.enqueueShouldFail) throw new Error("DB nede (simulert)");
    return !this.enqueueShouldReturnFalse;
  }

  async markProcessedByKey(key: string): Promise<boolean> {
    this.markProcessedByKeyCalls.push(key);
    if (this.markProcessedByKeyShouldFail) throw new Error("markProcessedByKey feilet");
    return true;
  }
}

class FakeInnerPort implements ComplianceLedgerPort {
  calls: ComplianceLedgerEventInput[] = [];
  shouldFail = false;
  async recordComplianceLedgerEvent(input: ComplianceLedgerEventInput): Promise<void> {
    this.calls.push(input);
    if (this.shouldFail) throw new Error("inner-port feilet");
  }
}

const SAMPLE_INPUT: ComplianceLedgerEventInput = {
  hallId: "hall-A",
  gameType: "MAIN_GAME",
  channel: "INTERNET",
  eventType: "STAKE",
  amount: 100,
  gameId: "game-1",
  playerId: "player-2",
  metadata: { reason: "TEST" },
};

// ── Tests ────────────────────────────────────────────────────────────────────

test("decorator: happy path — outbox.enqueue → inner dispatch → markProcessedByKey", async () => {
  const repo = new FakeOutboxRepo();
  const inner = new FakeInnerPort();
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  await port.recordComplianceLedgerEvent(SAMPLE_INPUT);

  assert.equal(repo.enqueueCalls.length, 1, "outbox.enqueue kalt");
  assert.equal(inner.calls.length, 1, "inner.recordComplianceLedgerEvent kalt");
  assert.equal(repo.markProcessedByKeyCalls.length, 1, "markProcessedByKey kalt");

  // Idempotency-key skal være deterministisk basert på input
  const key = repo.enqueueCalls[0].idempotencyKey;
  assert.match(key, /^STAKE:game-1:player-2:/);

  // Inner mottar nøyaktig samme input
  assert.deepEqual(inner.calls[0], SAMPLE_INPUT);

  // markProcessedByKey bruker samme key
  assert.equal(repo.markProcessedByKeyCalls[0], key);
});

test("decorator: idempotent — samme input → samme key", async () => {
  const repo = new FakeOutboxRepo();
  const inner = new FakeInnerPort();
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  await port.recordComplianceLedgerEvent(SAMPLE_INPUT);
  await port.recordComplianceLedgerEvent(SAMPLE_INPUT);

  assert.equal(repo.enqueueCalls.length, 2);
  assert.equal(
    repo.enqueueCalls[0].idempotencyKey,
    repo.enqueueCalls[1].idempotencyKey,
    "samme input → samme idempotency-key",
  );
});

test("decorator: distinkte amounts → distinkte keys (forhindrer kollisjon)", async () => {
  const repo = new FakeOutboxRepo();
  const inner = new FakeInnerPort();
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  await port.recordComplianceLedgerEvent({ ...SAMPLE_INPUT, amount: 100 });
  await port.recordComplianceLedgerEvent({ ...SAMPLE_INPUT, amount: 200 });

  assert.notEqual(
    repo.enqueueCalls[0].idempotencyKey,
    repo.enqueueCalls[1].idempotencyKey,
    "ulik amount skal gi ulik key (via fallbackDiscriminator)",
  );
});

test("decorator: distinkte hallId → distinkte keys", async () => {
  const repo = new FakeOutboxRepo();
  const inner = new FakeInnerPort();
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  await port.recordComplianceLedgerEvent({ ...SAMPLE_INPUT, hallId: "hall-A" });
  await port.recordComplianceLedgerEvent({ ...SAMPLE_INPUT, hallId: "hall-B" });

  assert.notEqual(
    repo.enqueueCalls[0].idempotencyKey,
    repo.enqueueCalls[1].idempotencyKey,
    "ulik hallId skal gi ulik key",
  );
});

test("decorator: outbox-write feiler → faller tilbake til inline dispatch (ingen kasting)", async () => {
  const repo = new FakeOutboxRepo();
  repo.enqueueShouldFail = true;
  const inner = new FakeInnerPort();
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  // Skal IKKE kaste (matcher fire-and-forget-kontrakten)
  await assert.doesNotReject(() => port.recordComplianceLedgerEvent(SAMPLE_INPUT));

  // Inline dispatch fortsatt forsøkt (fallback-mønster)
  assert.equal(inner.calls.length, 1, "inline dispatch fortsatt forsøkt etter outbox-feil");
});

test("decorator: outbox-write OK + inline dispatch feiler → outbox forblir pending (worker retry-er)", async () => {
  const repo = new FakeOutboxRepo();
  const inner = new FakeInnerPort();
  inner.shouldFail = true;
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  // Skal IKKE kaste — soft-fail på inline dispatch
  await assert.doesNotReject(() => port.recordComplianceLedgerEvent(SAMPLE_INPUT));

  assert.equal(repo.enqueueCalls.length, 1, "outbox-rad enqueued");
  assert.equal(inner.calls.length, 1, "inline dispatch ble forsøkt");
  assert.equal(
    repo.markProcessedByKeyCalls.length,
    0,
    "markProcessedByKey IKKE kalt (worker retry-er)",
  );
});

test("decorator: outbox-rad fantes allerede (ON CONFLICT) → hopper over inline dispatch", async () => {
  const repo = new FakeOutboxRepo();
  repo.enqueueShouldReturnFalse = true; // simuler ON CONFLICT DO NOTHING
  const inner = new FakeInnerPort();
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  await port.recordComplianceLedgerEvent(SAMPLE_INPUT);

  assert.equal(repo.enqueueCalls.length, 1);
  assert.equal(
    inner.calls.length,
    0,
    "inline dispatch SKAL hoppes over når outbox-rad allerede fantes (eventual delivery garantert via worker)",
  );
});

test("decorator: outbox-write OK + inner OK + markProcessedByKey feiler → ingen kasting", async () => {
  const repo = new FakeOutboxRepo();
  repo.markProcessedByKeyShouldFail = true;
  const inner = new FakeInnerPort();
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  // Skal IKKE kaste — markProcessed-feil er ufarlig (worker redispatch-er,
  // §71-tabellens egen UNIQUE-constraint forhindrer duplisering).
  await assert.doesNotReject(() => port.recordComplianceLedgerEvent(SAMPLE_INPUT));

  assert.equal(inner.calls.length, 1);
});

test("decorator: alle felt i input bevares i payload", async () => {
  const repo = new FakeOutboxRepo();
  const inner = new FakeInnerPort();
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  const fullInput: ComplianceLedgerEventInput = {
    hallId: "hall-X",
    gameType: "DATABINGO",
    channel: "HALL",
    eventType: "PRIZE",
    amount: 250.5,
    roomCode: "room-1",
    gameId: "game-X",
    claimId: "claim-Y",
    playerId: "player-Z",
    walletId: "wallet-W",
    sourceAccountId: "src",
    targetAccountId: "tgt",
    policyVersion: "v3",
    batchId: "batch-1",
    metadata: { reason: "FULL_TEST", arbitrary: { nested: true } },
  };

  await port.recordComplianceLedgerEvent(fullInput);

  const payload = repo.enqueueCalls[0].payload;
  assert.equal(payload.hallId, fullInput.hallId);
  assert.equal(payload.gameType, fullInput.gameType);
  assert.equal(payload.channel, fullInput.channel);
  assert.equal(payload.eventType, fullInput.eventType);
  assert.equal(payload.amount, fullInput.amount);
  assert.equal(payload.roomCode, fullInput.roomCode);
  assert.equal(payload.gameId, fullInput.gameId);
  assert.equal(payload.claimId, fullInput.claimId);
  assert.equal(payload.playerId, fullInput.playerId);
  assert.equal(payload.walletId, fullInput.walletId);
  assert.equal(payload.sourceAccountId, fullInput.sourceAccountId);
  assert.equal(payload.targetAccountId, fullInput.targetAccountId);
  assert.equal(payload.policyVersion, fullInput.policyVersion);
  assert.equal(payload.batchId, fullInput.batchId);
  assert.deepEqual(payload.metadata, fullInput.metadata);
});

test("decorator: outbox enqueue skjer FØR inline dispatch (rekkefølge-test)", async () => {
  const repo = new FakeOutboxRepo();
  const inner = new FakeInnerPort();
  const callOrder: string[] = [];

  const originalEnqueue = repo.enqueue.bind(repo);
  repo.enqueue = async (entry) => {
    callOrder.push("enqueue");
    return await originalEnqueue(entry);
  };
  const originalRecord = inner.recordComplianceLedgerEvent.bind(inner);
  inner.recordComplianceLedgerEvent = async (input) => {
    callOrder.push("inner-dispatch");
    return await originalRecord(input);
  };

  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  await port.recordComplianceLedgerEvent(SAMPLE_INPUT);

  assert.deepEqual(
    callOrder,
    ["enqueue", "inner-dispatch"],
    "outbox-enqueue MÅ skje FØR inline dispatch — kjernen i atomicitets-garantien",
  );
});

test("decorator: outbox-feil + inner-feil → ingen kasting (defensive double-fail)", async () => {
  const repo = new FakeOutboxRepo();
  repo.enqueueShouldFail = true;
  const inner = new FakeInnerPort();
  inner.shouldFail = true;
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  // Selv ved double-fail skal vi IKKE kaste (caller kompenserer ikke
  // committed wallet-tx på vegne av compliance-write).
  await assert.doesNotReject(() => port.recordComplianceLedgerEvent(SAMPLE_INPUT));
});

test("decorator: PRIZE-event med claimId — key inkluderer claimId, ikke playerId", async () => {
  const repo = new FakeOutboxRepo();
  const inner = new FakeInnerPort();
  const port = new ComplianceOutboxComplianceLedgerPort({
    outboxRepo: repo as never,
    inner,
  });

  await port.recordComplianceLedgerEvent({
    hallId: "hall-A",
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "PRIZE",
    amount: 250,
    gameId: "game-1",
    claimId: "claim-X",
    playerId: "player-Y",
  });

  // makeComplianceLedgerIdempotencyKey prioriterer claimId over playerId.
  const key = repo.enqueueCalls[0].idempotencyKey;
  assert.match(key, /PRIZE:game-1:claim-X:/);
});

test("decorator: matcher fire-and-forget-kontrakten — alle feilbaner kaster aldri", async () => {
  // Tester at uansett feilkombinasjon kaster decoratoren aldri.
  for (const enqueueFail of [false, true]) {
    for (const enqueueReturnFalse of [false, true]) {
      for (const innerFail of [false, true]) {
        for (const markFail of [false, true]) {
          const repo = new FakeOutboxRepo();
          repo.enqueueShouldFail = enqueueFail;
          repo.enqueueShouldReturnFalse = enqueueReturnFalse;
          repo.markProcessedByKeyShouldFail = markFail;
          const inner = new FakeInnerPort();
          inner.shouldFail = innerFail;
          const port = new ComplianceOutboxComplianceLedgerPort({
            outboxRepo: repo as never,
            inner,
          });
          await assert.doesNotReject(
            () => port.recordComplianceLedgerEvent(SAMPLE_INPUT),
            `kombinasjon enqueueFail=${enqueueFail} enqueueReturnFalse=${enqueueReturnFalse} innerFail=${innerFail} markFail=${markFail} kastet`,
          );
        }
      }
    }
  }
});
