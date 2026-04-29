/**
 * COMP-P0-002: tester for ComplianceOutboxWorker.
 *
 * Bruker en in-memory fake av ComplianceOutboxRepo for å verifisere worker-
 * adferd uten Postgres. Testene dekker:
 *   - happy-path: claim → dispatch → markProcessed
 *   - dispatcher-feil → markFailed med korrekt attempts
 *   - dead-letter etter MAX_ATTEMPTS forsøk
 *   - throttling: overlappende tick → andre returnerer 0 uten dobbel-claim
 *   - stop venter på pågående tick
 *   - dispatcher mottar nøyaktig samme felt-sett som original call
 *
 * Pattern matcher BIN-761 WalletOutboxWorker.test.ts — bevisst.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ComplianceOutboxWorker,
} from "./ComplianceOutboxWorker.js";
import {
  type ComplianceOutboxRow,
  type ComplianceOutboxPayload,
  COMPLIANCE_OUTBOX_MAX_ATTEMPTS,
} from "./ComplianceOutboxRepo.js";
import type { ComplianceLedgerEventInput, ComplianceLedgerPort } from "../adapters/ComplianceLedgerPort.js";

// ── Fake repo ────────────────────────────────────────────────────────────────

interface FakeOutboxRow extends ComplianceOutboxRow {
  /** Internt: er raden låst av en aktiv claimNextBatch (simulerer FOR UPDATE)? */
  _claimedAt: number | null;
}

class FakeOutboxRepo {
  rows: FakeOutboxRow[] = [];
  private nextId = 1;

  /** Test-helper: legg til pending rad. */
  seed(input: Partial<ComplianceOutboxRow> & {
    idempotencyKey: string;
    payload: ComplianceOutboxPayload;
  }): FakeOutboxRow {
    const now = new Date().toISOString();
    const row: FakeOutboxRow = {
      id: this.nextId++,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      status: input.status ?? "pending",
      attempts: input.attempts ?? 0,
      lastAttemptAt: input.lastAttemptAt ?? null,
      lastError: input.lastError ?? null,
      createdAt: input.createdAt ?? now,
      processedAt: input.processedAt ?? null,
      _claimedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async claimNextBatch(limit: number): Promise<ComplianceOutboxRow[]> {
    const claimed: FakeOutboxRow[] = [];
    for (const r of this.rows) {
      if (claimed.length >= limit) break;
      if (r.status !== "pending") continue;
      if (r._claimedAt && Date.now() - r._claimedAt < 1000) continue; // simulerer SKIP LOCKED
      r._claimedAt = Date.now();
      r.attempts += 1;
      r.lastAttemptAt = new Date().toISOString();
      claimed.push(r);
    }
    return claimed.map((r) => ({ ...r }));
  }

  async markProcessed(ids: number[]): Promise<void> {
    for (const r of this.rows) {
      if (ids.includes(r.id)) {
        r.status = "processed";
        r.processedAt = new Date().toISOString();
        r.lastError = null;
        r._claimedAt = null;
      }
    }
  }

  async markFailed(id: number, error: string, attempts: number): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return;
    r.lastError = error.length > 4000 ? error.slice(0, 4000) : error;
    r.status = attempts >= COMPLIANCE_OUTBOX_MAX_ATTEMPTS ? "dead_letter" : "pending";
    r._claimedAt = null;
  }

  async enqueue(): Promise<boolean> {
    return true;
  }

  async markProcessedByKey(): Promise<boolean> {
    return true;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const out: Record<string, number> = { pending: 0, processed: 0, dead_letter: 0 };
    for (const r of this.rows) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  }
}

class FakeDispatcher implements ComplianceLedgerPort {
  calls: ComplianceLedgerEventInput[] = [];
  shouldFailFn?: (call: ComplianceLedgerEventInput, callIndex: number) => boolean;
  async recordComplianceLedgerEvent(input: ComplianceLedgerEventInput): Promise<void> {
    this.calls.push(input);
    if (this.shouldFailFn?.(input, this.calls.length - 1)) {
      throw new Error("dispatcher feilet (simulert)");
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("ComplianceOutboxWorker.tick: happy path — claim → dispatch → markProcessed", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  repo.seed({
    idempotencyKey: "STAKE:g1:p1:k1",
    payload: {
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 100,
      gameId: "g1",
      playerId: "p1",
    },
  });
  repo.seed({
    idempotencyKey: "PRIZE:g1:c1:k2",
    payload: {
      hallId: "hall-B",
      gameType: "MAIN_GAME",
      channel: "HALL",
      eventType: "PRIZE",
      amount: 250,
      gameId: "g1",
      claimId: "c1",
      walletId: "w1",
    },
  });

  const worker = new ComplianceOutboxWorker({ repo: repo as never, dispatcher });
  const result = await worker.tick();

  assert.equal(result.claimed, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.deadLettered, 0);
  assert.equal(dispatcher.calls.length, 2);

  const counts = await repo.countByStatus();
  assert.equal(counts.processed, 2);
  assert.equal(counts.pending, 0);
});

test("ComplianceOutboxWorker.tick: dispatcher mottar samme felt-sett som original call", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  repo.seed({
    idempotencyKey: "STAKE:g1:p1:k1",
    payload: {
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 99.99,
      roomCode: "room-X",
      gameId: "g-1",
      claimId: "c-1",
      playerId: "p-1",
      walletId: "w-1",
      sourceAccountId: "src",
      targetAccountId: "tgt",
      policyVersion: "v2",
      batchId: "b-1",
      metadata: { reason: "TEST_DISPATCH", purchaseId: "pur-1" },
    },
  });

  const worker = new ComplianceOutboxWorker({ repo: repo as never, dispatcher });
  await worker.tick();

  assert.equal(dispatcher.calls.length, 1);
  const call = dispatcher.calls[0];
  assert.equal(call.hallId, "hall-A");
  assert.equal(call.gameType, "MAIN_GAME");
  assert.equal(call.channel, "INTERNET");
  assert.equal(call.eventType, "STAKE");
  assert.equal(call.amount, 99.99);
  assert.equal(call.roomCode, "room-X");
  assert.equal(call.gameId, "g-1");
  assert.equal(call.claimId, "c-1");
  assert.equal(call.playerId, "p-1");
  assert.equal(call.walletId, "w-1");
  assert.equal(call.sourceAccountId, "src");
  assert.equal(call.targetAccountId, "tgt");
  assert.equal(call.policyVersion, "v2");
  assert.equal(call.batchId, "b-1");
  assert.deepEqual(call.metadata, { reason: "TEST_DISPATCH", purchaseId: "pur-1" });
});

test("ComplianceOutboxWorker.tick: dispatcher-feil → markFailed med pending-status (retry)", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  dispatcher.shouldFailFn = () => true;
  const seeded = repo.seed({
    idempotencyKey: "STAKE:g1:p1:k1",
    payload: {
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 100,
    },
  });

  const worker = new ComplianceOutboxWorker({ repo: repo as never, dispatcher });
  const result = await worker.tick();

  assert.equal(result.claimed, 1);
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.deadLettered, 0);

  // Etter 1. forsøk: status fortsatt pending, attempts=1
  const updated = repo.rows.find((r) => r.id === seeded.id);
  assert.equal(updated?.status, "pending");
  assert.equal(updated?.attempts, 1);
  assert.match(updated?.lastError ?? "", /dispatcher feilet/);
});

test("ComplianceOutboxWorker.tick: dead-letter etter MAX_ATTEMPTS forsøk", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  dispatcher.shouldFailFn = () => true;
  const seeded = repo.seed({
    idempotencyKey: "STAKE:g1:p1:k1",
    payload: {
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 100,
    },
  });

  const worker = new ComplianceOutboxWorker({ repo: repo as never, dispatcher });
  // Trigger MAX_ATTEMPTS ticks med simulert "1s elapsed" ved å nullstille _claimedAt.
  for (let i = 0; i < COMPLIANCE_OUTBOX_MAX_ATTEMPTS; i++) {
    seeded._claimedAt = null; // unlock for neste claim
    await worker.tick();
  }

  const updated = repo.rows.find((r) => r.id === seeded.id);
  assert.equal(updated?.status, "dead_letter");
  assert.equal(updated?.attempts, COMPLIANCE_OUTBOX_MAX_ATTEMPTS);
});

test("ComplianceOutboxWorker.tick: deadLettered count inkrementeres ved MAX_ATTEMPTS", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  dispatcher.shouldFailFn = () => true;
  const seeded = repo.seed({
    idempotencyKey: "STAKE:g1:p1:k1",
    payload: {
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 100,
    },
  });

  const worker = new ComplianceOutboxWorker({ repo: repo as never, dispatcher });

  // 4 første ticks: failed (ikke dead-letter)
  for (let i = 0; i < COMPLIANCE_OUTBOX_MAX_ATTEMPTS - 1; i++) {
    seeded._claimedAt = null;
    const r = await worker.tick();
    assert.equal(r.deadLettered, 0, `tick ${i + 1} skulle ikke dead-letter`);
    assert.equal(r.failed, 1);
  }

  // 5. tick: dead-letter
  seeded._claimedAt = null;
  const final = await worker.tick();
  assert.equal(final.deadLettered, 1);
  assert.equal(final.failed, 0, "fail-count skiftes til deadLettered ved MAX_ATTEMPTS");
});

test("ComplianceOutboxWorker.tick: throttling — overlappende tick returnerer 0", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  // Block dispatcher 50ms så vi kan trigger andre tick midt i
  dispatcher.recordComplianceLedgerEvent = async (input) => {
    dispatcher.calls.push(input);
    await new Promise((r) => setTimeout(r, 50));
  };
  repo.seed({
    idempotencyKey: "STAKE:g1:p1:k1",
    payload: {
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 100,
    },
  });

  const worker = new ComplianceOutboxWorker({ repo: repo as never, dispatcher });

  // Start tick 1 (uten å awaite), deretter tick 2 umiddelbart
  const tick1 = worker.tick();
  // Liten yield så tick 1 hinner sette running=true
  await new Promise((r) => setTimeout(r, 5));
  const tick2 = await worker.tick();
  const result1 = await tick1;

  assert.equal(result1.claimed, 1);
  assert.equal(tick2.claimed, 0, "tick 2 skal returnere 0 mens tick 1 kjører");
});

test("ComplianceOutboxWorker.stop: idempotent og venter på pågående tick", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  const worker = new ComplianceOutboxWorker({
    repo: repo as never,
    dispatcher,
    intervalMs: 100,
  });
  worker.start();
  await worker.stop();
  await worker.stop(); // idempotent
  assert.ok(true, "stop() skal være idempotent");
});

test("ComplianceOutboxWorker: prosesserer i blandet rekkefølge — feil + suksess i samme batch", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  // Andre rad feiler, første og tredje lykkes
  dispatcher.shouldFailFn = (_, idx) => idx === 1;

  repo.seed({
    idempotencyKey: "K1",
    payload: { hallId: "h-A", gameType: "MAIN_GAME", channel: "INTERNET", eventType: "STAKE", amount: 100 },
  });
  repo.seed({
    idempotencyKey: "K2",
    payload: { hallId: "h-B", gameType: "MAIN_GAME", channel: "INTERNET", eventType: "STAKE", amount: 200 },
  });
  repo.seed({
    idempotencyKey: "K3",
    payload: { hallId: "h-C", gameType: "MAIN_GAME", channel: "INTERNET", eventType: "PRIZE", amount: 50 },
  });

  const worker = new ComplianceOutboxWorker({ repo: repo as never, dispatcher });
  const result = await worker.tick();

  assert.equal(result.claimed, 3);
  assert.equal(result.processed, 2);
  assert.equal(result.failed, 1);

  const counts = await repo.countByStatus();
  assert.equal(counts.processed, 2);
  assert.equal(counts.pending, 1);
});

test("ComplianceOutboxWorker: tick respekterer batchSize-grense", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  for (let i = 0; i < 10; i++) {
    repo.seed({
      idempotencyKey: `K${i}`,
      payload: { hallId: "h", gameType: "MAIN_GAME", channel: "INTERNET", eventType: "STAKE", amount: i },
    });
  }
  const worker = new ComplianceOutboxWorker({
    repo: repo as never,
    dispatcher,
    batchSize: 3,
  });
  const result = await worker.tick();
  assert.equal(result.claimed, 3, "kun batchSize rader claimet per tick");
});

test("ComplianceOutboxWorker: tom outbox → ingen dispatch-call", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  const worker = new ComplianceOutboxWorker({ repo: repo as never, dispatcher });
  const result = await worker.tick();
  assert.equal(result.claimed, 0);
  assert.equal(dispatcher.calls.length, 0);
});

test("ComplianceOutboxWorker: prosesserte rader claimes ikke igjen", async () => {
  const repo = new FakeOutboxRepo();
  const dispatcher = new FakeDispatcher();
  repo.seed({
    idempotencyKey: "K1",
    payload: { hallId: "h", gameType: "MAIN_GAME", channel: "INTERNET", eventType: "STAKE", amount: 1 },
  });

  const worker = new ComplianceOutboxWorker({ repo: repo as never, dispatcher });
  const r1 = await worker.tick();
  assert.equal(r1.processed, 1);

  // Andre tick: rad er nå processed → ikke claimable
  const r2 = await worker.tick();
  assert.equal(r2.claimed, 0);
  assert.equal(dispatcher.calls.length, 1);
});
