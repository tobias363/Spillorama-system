/**
 * BIN-761: tester for WalletOutboxWorker.
 *
 * Bruker en in-memory fake av WalletOutboxRepo for å verifisere worker-
 * adferd uten Postgres. Testene dekker:
 *   - happy-path: claim → dispatch → markProcessed
 *   - dispatcher-feil → markFailed med korrekt attempts
 *   - dead-letter etter MAX_ATTEMPTS forsøk
 *   - concurrency: to "workere" mot samme fake får ikke samme rad (FOR
 *     UPDATE SKIP LOCKED simulering)
 *   - throttling: overlappende tick → andre returnerer 0 uten dobbel-claim
 *   - stop venter på pågående tick
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  WalletOutboxWorker,
  type WalletOutboxDispatcher,
} from "./WalletOutboxWorker.js";
import {
  type WalletOutboxRepo,
  type WalletOutboxRow,
  WALLET_OUTBOX_MAX_ATTEMPTS,
} from "./WalletOutboxRepo.js";

// ── Fake repo ────────────────────────────────────────────────────────────────

interface FakeOutboxRow extends WalletOutboxRow {
  /** Internt: er raden låst av en aktiv claimNextBatch (simulerer FOR UPDATE)? */
  _claimedAt: number | null;
}

/**
 * In-memory fake av WalletOutboxRepo. Implementerer FOR UPDATE SKIP LOCKED
 * via en `_claimedAt`-flag — concurrent claim-batches får disjoint rader.
 *
 * Vi `new`-er ikke faktisk WalletOutboxRepo; isteden returnerer vi et objekt
 * som har samme metodenavn worker bruker, og caster til repo-typen.
 */
class FakeOutboxRepo {
  rows: FakeOutboxRow[] = [];
  private nextId = 1;

  /** Test-helper: legg til pending rad. */
  seed(input: Partial<WalletOutboxRow> & Pick<WalletOutboxRow, "operationId">): FakeOutboxRow {
    const now = new Date().toISOString();
    const row: FakeOutboxRow = {
      id: this.nextId++,
      operationId: input.operationId,
      accountId: input.accountId ?? "acc-test",
      eventType: input.eventType ?? "wallet.credit",
      payload: input.payload ?? {},
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

  // Pretender vi er WalletOutboxRepo for worker-en.
  async claimNextBatch(limit: number): Promise<WalletOutboxRow[]> {
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
    // Returner kopier (worker skal ikke kunne mutere internt state).
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
    r.status = attempts >= WALLET_OUTBOX_MAX_ATTEMPTS ? "dead_letter" : "pending";
    r._claimedAt = null;
  }

  countByStatus(): Record<string, number> {
    const out: Record<string, number> = { pending: 0, processed: 0, dead_letter: 0 };
    for (const r of this.rows) out[r.status]++;
    return out;
  }
}

function asRepo(fake: FakeOutboxRepo): WalletOutboxRepo {
  return fake as unknown as WalletOutboxRepo;
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("BIN-761 worker happy-path: tick claimer + dispatcher + markProcessed", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-1" });
  fake.seed({ operationId: "op-2" });

  const dispatched: string[] = [];
  const dispatcher: WalletOutboxDispatcher = (row) => {
    dispatched.push(row.operationId);
  };
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000, // disable auto-tick
  });

  const result = await worker.tick();
  assert.equal(result.claimed, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.deadLettered, 0);

  assert.deepEqual(dispatched.sort(), ["op-1", "op-2"]);
  const counts = fake.countByStatus();
  assert.equal(counts.processed, 2);
  assert.equal(counts.pending, 0);
});

test("BIN-761 worker: dispatcher kaster → markFailed, attempts < MAX → tilbake pending", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-fail" });

  const dispatcher: WalletOutboxDispatcher = () => {
    throw new Error("simulated socket failure");
  };
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  const result = await worker.tick();
  assert.equal(result.claimed, 1);
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.deadLettered, 0);

  // Etter første feil: attempts=1, status='pending' igjen.
  assert.equal(fake.rows[0].attempts, 1);
  assert.equal(fake.rows[0].status, "pending");
  assert.equal(fake.rows[0].lastError, "simulated socket failure");
});

test("BIN-761 worker: dead_letter etter MAX_ATTEMPTS forsøk", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-dead" });

  const dispatcher: WalletOutboxDispatcher = () => {
    throw new Error("permanent failure");
  };
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  // Kjør tick MAX_ATTEMPTS ganger.
  for (let i = 0; i < WALLET_OUTBOX_MAX_ATTEMPTS; i++) {
    // Reset _claimedAt mellom ticks så fake repo lar oss claime samme rad
    // (i ekte DB ville den allerede vært frigitt etter status='pending').
    fake.rows[0]._claimedAt = null;
    await worker.tick();
  }

  const counts = fake.countByStatus();
  assert.equal(counts.dead_letter, 1, "rad skal være dead_letter etter 5 forsøk");
  assert.equal(counts.pending, 0);
  assert.equal(fake.rows[0].attempts, WALLET_OUTBOX_MAX_ATTEMPTS);
});

test("BIN-761 worker: concurrency — to ticks samtidig deler ikke rader (SKIP LOCKED-sim)", async () => {
  const fake = new FakeOutboxRepo();
  for (let i = 0; i < 10; i++) {
    fake.seed({ operationId: `op-${i}` });
  }

  const dispatched: string[] = [];
  const dispatcher: WalletOutboxDispatcher = async (row) => {
    // Sleep så de to tickene faktisk overlapper i tid.
    await new Promise((r) => setTimeout(r, 10));
    dispatched.push(row.operationId);
  };

  const workerA = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
    batchSize: 5,
  });
  const workerB = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
    batchSize: 5,
  });

  const [a, b] = await Promise.all([workerA.tick(), workerB.tick()]);
  // Begge skal til sammen ha claimet alle 10 rader, ingen overlapp.
  assert.equal(a.claimed + b.claimed, 10, "alle 10 rader skal være claimet på tvers");
  assert.equal(dispatched.length, 10);
  assert.equal(new Set(dispatched).size, 10, "ingen duplikater — operationId skal være unike");
  assert.equal(fake.countByStatus().processed, 10);
});

test("BIN-761 worker: stop() er idempotent og resolveer", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-stop" });

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    intervalMs: 10_000,
  });
  worker.start();
  await worker.stop();
  await worker.stop(); // andre kall skal ikke kaste
  // Etter stop skal tick() short-circuite (stopping=true).
  const result = await worker.tick();
  assert.equal(result.claimed, 0);
});

test("BIN-761 worker: setDispatcher byter ut transport runtime", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-swap" });

  const calls: string[] = [];
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher: (row) => {
      calls.push(`first:${row.operationId}`);
    },
    intervalMs: 10_000,
  });
  worker.setDispatcher((row) => {
    calls.push(`second:${row.operationId}`);
  });

  await worker.tick();
  assert.deepEqual(calls, ["second:op-swap"]);
});

test("BIN-761 worker: tom kø — tick returnerer 0/0/0/0 uten å kaste", async () => {
  const fake = new FakeOutboxRepo();
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    intervalMs: 10_000,
  });
  const result = await worker.tick();
  assert.deepEqual(result, { claimed: 0, processed: 0, failed: 0, deadLettered: 0 });
});

test("BIN-761 worker: throttling — overlappende ticks returnerer 0 i andre", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-throttle" });

  let inDispatch = false;
  const dispatcher: WalletOutboxDispatcher = async () => {
    inDispatch = true;
    await new Promise((r) => setTimeout(r, 30));
    inDispatch = false;
  };
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  // Start to ticks samtidig på SAMME worker — andre må throttle.
  const [a, b] = await Promise.all([worker.tick(), worker.tick()]);
  assert.equal(a.claimed + b.claimed, 1, "kun én tick får claime — throttle");
  assert.equal(inDispatch, false, "dispatcher skal være ferdig når Promise.all resolveer");
});
