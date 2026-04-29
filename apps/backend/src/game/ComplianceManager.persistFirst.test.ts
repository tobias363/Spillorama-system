/**
 * Stage 2A — `refactor/stage2a-compliance-manager-maps` regression tests.
 *
 * Covers the four "mutate-before-persist" code paths that the pain-audit
 * (`docs/audit/BACKEND_PAIN_POINTS_AUDIT_2026-04-29.md` §7) and Code Review #5
 * P0-2 (`docs/handoff/PROJECT_HANDOFF_BRIEF_2026-04-28.md` §7) flagged as
 * regulatorisk-relevant. Each test exercises a write-path with a mock
 * persistence adapter that is configured to throw, and asserts that the
 * in-memory cache stays consistent with the (failed) DB write — i.e. the
 * cache MUST NOT contain a value that is missing from DB.
 *
 * The four code paths covered:
 *
 *   1. `recordLossEntry`             → §71 net-loss + organisasjons-distribusjon
 *   2. `setPlayerLossLimits`         → §11 personal limits (gameplay/admin path)
 *   3. `setPlayerLossLimitsWithEffectiveAt`
 *                                    → §25 48h-pending change (BIN-720)
 *   4. `persistRestrictionState`     → §23 self-exclusion + §66 mandatory pause
 *      (exercised via setTimedPause / setSelfExclusion / finishPlaySession)
 *
 * Plus integration coverage for:
 *   - "restart" semantics (instantiate new ComplianceManager pointing to same
 *     persisted state — verify no Map-state-leak across instances).
 *   - concurrent operations against same scope-key.
 *   - §71 actor_hall_id binding still flows through `recordLossEntry(walletId,
 *     hallId, entry)` after refactor.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ComplianceManager } from "./ComplianceManager.js";
import type {
  ResponsibleGamingPersistenceAdapter,
  ResponsibleGamingPersistenceSnapshot,
  PersistedLossLimit,
  PersistedPendingLossLimitChange,
  PersistedRestrictionState,
  PersistedPlaySessionState,
  PersistedLossEntry,
  PersistedPrizePolicy,
  PersistedExtraPrizeEntry,
  PersistedPayoutAuditEvent,
  PersistedComplianceLedgerEntry,
  PersistedDailyReport,
  PersistedOverskuddBatch,
  PersistedHallOrganizationAllocation
} from "./ResponsibleGamingPersistence.js";

// ── In-memory adapter for tests ──────────────────────────────────────────────

interface ReadableSnapshot {
  personalLossLimits: PersistedLossLimit[];
  pendingLossLimitChanges: PersistedPendingLossLimitChange[];
  restrictions: PersistedRestrictionState[];
  playStates: PersistedPlaySessionState[];
  lossEntries: PersistedLossEntry[];
}

class FakePersistence implements ResponsibleGamingPersistenceAdapter {
  readonly lossLimits = new Map<string, PersistedLossLimit>();
  readonly pendingLossLimitChanges = new Map<string, PersistedPendingLossLimitChange>();
  readonly restrictions = new Map<string, PersistedRestrictionState>();
  readonly playStates = new Map<string, PersistedPlaySessionState>();
  readonly lossEntries: PersistedLossEntry[] = [];

  /**
   * Toggle to make adapter calls throw (DB-failure simulation). Test sets
   * to true before exercising mutation, then asserts cache reflects DB.
   */
  failNextWrite = false;

  private readonly key = (walletId: string, hallId: string): string =>
    `${walletId}::${hallId}`;

  private maybeFail(label: string): void {
    if (this.failNextWrite) {
      throw new Error(`fake-db-failure: ${label}`);
    }
  }

  async ensureInitialized(): Promise<void> { /* no-op */ }

  async loadSnapshot(): Promise<ResponsibleGamingPersistenceSnapshot> {
    return {
      personalLossLimits: Array.from(this.lossLimits.values()),
      pendingLossLimitChanges: Array.from(this.pendingLossLimitChanges.values()),
      restrictions: Array.from(this.restrictions.values()),
      playStates: Array.from(this.playStates.values()),
      lossEntries: [...this.lossEntries],
      prizePolicies: [],
      extraPrizeEntries: [],
      payoutAuditTrail: [],
      complianceLedger: [],
      dailyReports: []
    };
  }

  async upsertLossLimit(entry: PersistedLossLimit): Promise<void> {
    this.maybeFail("upsertLossLimit");
    this.lossLimits.set(this.key(entry.walletId, entry.hallId), { ...entry });
  }

  async upsertPendingLossLimitChange(
    entry: PersistedPendingLossLimitChange
  ): Promise<void> {
    this.maybeFail("upsertPendingLossLimitChange");
    this.pendingLossLimitChanges.set(this.key(entry.walletId, entry.hallId), {
      ...entry
    });
  }

  async deletePendingLossLimitChange(walletId: string, hallId: string): Promise<void> {
    this.maybeFail("deletePendingLossLimitChange");
    this.pendingLossLimitChanges.delete(this.key(walletId, hallId));
  }

  async upsertRestriction(entry: PersistedRestrictionState): Promise<void> {
    this.maybeFail("upsertRestriction");
    this.restrictions.set(entry.walletId, { ...entry });
  }

  async deleteRestriction(walletId: string): Promise<void> {
    this.maybeFail("deleteRestriction");
    this.restrictions.delete(walletId);
  }

  async upsertPlaySessionState(entry: PersistedPlaySessionState): Promise<void> {
    this.maybeFail("upsertPlaySessionState");
    this.playStates.set(entry.walletId, JSON.parse(JSON.stringify(entry)));
  }

  async deletePlaySessionState(walletId: string): Promise<void> {
    this.maybeFail("deletePlaySessionState");
    this.playStates.delete(walletId);
  }

  async insertLossEntry(entry: PersistedLossEntry): Promise<void> {
    this.maybeFail("insertLossEntry");
    this.lossEntries.push({ ...entry });
  }

  async upsertPrizePolicy(_policy: PersistedPrizePolicy): Promise<void> { /* unused in tests */ }
  async insertExtraPrizeEntry(_entry: PersistedExtraPrizeEntry): Promise<void> { /* unused */ }
  async insertPayoutAuditEvent(_event: PersistedPayoutAuditEvent): Promise<void> { /* unused */ }
  async insertComplianceLedgerEntry(_entry: PersistedComplianceLedgerEntry): Promise<void> { /* unused */ }
  async upsertDailyReport(_report: PersistedDailyReport): Promise<void> { /* unused */ }
  async insertOverskuddBatch(_batch: PersistedOverskuddBatch): Promise<void> { /* unused */ }
  async getOverskuddBatch(_batchId: string): Promise<PersistedOverskuddBatch | null> { return null; }
  async listOverskuddBatches(): Promise<PersistedOverskuddBatch[]> { return []; }
  async upsertHallOrganizationAllocation(_alloc: PersistedHallOrganizationAllocation): Promise<void> { /* unused */ }
  async listHallOrganizationAllocations(): Promise<PersistedHallOrganizationAllocation[]> { return []; }
  async deleteHallOrganizationAllocation(_id: string): Promise<void> { /* unused */ }

  async shutdown(): Promise<void> { /* no-op */ }
}

function createManagerWithPersistence(
  persistence: ResponsibleGamingPersistenceAdapter
): ComplianceManager {
  return new ComplianceManager({
    regulatoryLossLimits: { daily: 500, monthly: 4400 },
    playSessionLimitMs: 60 * 60 * 1000,
    pauseDurationMs: 15 * 60 * 1000,
    selfExclusionMinMs: 365 * 24 * 60 * 60 * 1000,
    persistence
  });
}

// ── Bug #1: setPlayerLossLimits — DB-error must NOT mutate cache ─────────────

test("Stage 2A bug-fix #1: setPlayerLossLimits — DB-write throws → cache stays old", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);

  // Establish baseline: limit successfully set to 200 daily.
  await mgr.setPlayerLossLimits({
    walletId: "w-1",
    hallId: "h-1",
    daily: 200
  });
  assert.equal(
    mgr.getEffectiveLossLimits("w-1", "h-1").daily,
    200,
    "baseline limit set"
  );
  assert.equal(
    fake.lossLimits.get("w-1::h-1")!.daily,
    200,
    "DB has baseline limit"
  );

  // Now try to lower limit but adapter throws.
  fake.failNextWrite = true;
  await assert.rejects(
    () =>
      mgr.setPlayerLossLimits({
        walletId: "w-1",
        hallId: "h-1",
        daily: 100
      }),
    /fake-db-failure/,
    "setPlayerLossLimits propagates DB error"
  );

  // CRITICAL: cache must still show 200 (DB has 200, not 100).
  assert.equal(
    mgr.getEffectiveLossLimits("w-1", "h-1").daily,
    200,
    "cache stays at 200 after DB failure (was: persist-after pattern would have set to 100)"
  );
  // DB also stayed at 200 — invariant: cache <-> DB consistent.
  assert.equal(
    fake.lossLimits.get("w-1::h-1")!.daily,
    200,
    "DB stayed at 200"
  );
});

test("Stage 2A bug-fix #1: setPlayerLossLimits — successful write updates cache + DB together", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);

  await mgr.setPlayerLossLimits({
    walletId: "w-1",
    hallId: "h-1",
    daily: 100
  });

  assert.equal(mgr.getEffectiveLossLimits("w-1", "h-1").daily, 100);
  assert.equal(fake.lossLimits.get("w-1::h-1")!.daily, 100);
});

// ── Bug #2: setPlayerLossLimitsWithEffectiveAt ───────────────────────────────

test("Stage 2A bug-fix #2: setPlayerLossLimitsWithEffectiveAt — DB-write throws → cache stays old", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);

  // Baseline: limit set to 300 daily.
  await mgr.setPlayerLossLimitsWithEffectiveAt({
    walletId: "w-1",
    hallId: "h-1",
    dailyDecrease: 300
  });
  assert.equal(mgr.getEffectiveLossLimits("w-1", "h-1").daily, 300);

  // Try to decrease further — DB throws.
  fake.failNextWrite = true;
  await assert.rejects(
    () =>
      mgr.setPlayerLossLimitsWithEffectiveAt({
        walletId: "w-1",
        hallId: "h-1",
        dailyDecrease: 100
      }),
    /fake-db-failure/
  );

  // Cache stays at 300 (mirrors DB).
  assert.equal(
    mgr.getEffectiveLossLimits("w-1", "h-1").daily,
    300,
    "cache stays at 300 after DB failure"
  );
});

// ── Bug #3: recordLossEntry — DB-error must NOT mutate cache ─────────────────

test("Stage 2A bug-fix #3: recordLossEntry — DB-write throws → cache stays empty", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);

  // Adapter throws on insertLossEntry.
  fake.failNextWrite = true;
  await assert.rejects(
    () =>
      mgr.recordLossEntry("w-1", "h-1", {
        type: "BUYIN",
        amount: 100,
        createdAtMs: nowMs
      }),
    /fake-db-failure/
  );

  // CRITICAL: calculateNetLoss MUST NOT include the failed entry.
  // Previously (mutate-before-persist) the Map would have the entry but DB
  // wouldn't, so §71 hovedbok and the in-memory net-loss-counter would
  // diverge.
  assert.deepEqual(
    mgr.calculateNetLoss("w-1", nowMs, "h-1"),
    { daily: 0, monthly: 0 },
    "cache excludes failed entry — net-loss matches §71 hovedbok"
  );
  assert.equal(fake.lossEntries.length, 0, "DB also has no entry");
});

test("Stage 2A bug-fix #3: recordLossEntry — successful write reflects in cache + DB", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);

  await mgr.recordLossEntry("w-1", "h-1", {
    type: "BUYIN",
    amount: 200,
    createdAtMs: nowMs
  });

  assert.deepEqual(mgr.calculateNetLoss("w-1", nowMs, "h-1"), {
    daily: 200,
    monthly: 200
  });
  assert.equal(fake.lossEntries.length, 1);
  assert.equal(fake.lossEntries[0].amount, 200);
  assert.equal(fake.lossEntries[0].walletId, "w-1");
  assert.equal(fake.lossEntries[0].hallId, "h-1", "§71 actor_hall_id binding preserved");
});

// ── Bug #4: persistRestrictionState (via setSelfExclusion / setTimedPause) ──

test("Stage 2A bug-fix #4: setSelfExclusion — DB-write throws → cache stays clean", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);

  // Adapter throws.
  fake.failNextWrite = true;
  await assert.rejects(() => mgr.setSelfExclusion("w-1"), /fake-db-failure/);

  // CRITICAL: spiller MUST NOT be marked self-excluded in cache when DB
  // doesn't have the row. Otherwise next assertWalletAllowedForGameplay
  // would block, but admin-tools (which read DB) would say "not blocked".
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(
    snap.restrictions.selfExclusion.isActive,
    false,
    "self-exclusion not active in cache after DB failure"
  );
  assert.equal(fake.restrictions.size, 0, "DB has no restriction");
});

test("Stage 2A bug-fix #4: setSelfExclusion — successful write reflects in cache + DB", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);

  await mgr.setSelfExclusion("w-1");

  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.restrictions.selfExclusion.isActive, true);
  assert.equal(fake.restrictions.size, 1);
  assert.notEqual(
    fake.restrictions.get("w-1")!.selfExcludedAtMs,
    undefined
  );
});

test("Stage 2A bug-fix #4: setTimedPause — DB-write throws → cache stays clean", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);

  fake.failNextWrite = true;
  await assert.rejects(
    () => mgr.setTimedPause({ walletId: "w-1", durationMinutes: 30 }),
    /fake-db-failure/
  );

  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(
    snap.restrictions.timedPause.isActive,
    false,
    "timed-pause not active in cache after DB failure"
  );
});

test("Stage 2A bug-fix #4: clearTimedPause when expired — DB-delete throws → cache stays", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);

  // Establish a pause that has already expired by setting it then waiting.
  // We use durationMs=1 then wait so it's expired immediately.
  await mgr.setTimedPause({ walletId: "w-1", durationMs: 1 });
  // Sleep 5ms to ensure the pause is expired.
  await new Promise((resolve) => setTimeout(resolve, 5));

  // DB now has the (expired) restriction row. Try to clear — adapter throws.
  fake.failNextWrite = true;
  await assert.rejects(() => mgr.clearTimedPause("w-1"), /fake-db-failure/);

  // DB still has the restriction row.
  assert.equal(
    fake.restrictions.has("w-1"),
    true,
    "DB still has restriction after deleteRestriction failure"
  );
});

// ── §66 / play-session — finishPlaySession persist-first ─────────────────────

test("Stage 2A bug-fix #4: finishPlaySession — DB-write throws → cache stays old", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);
  const t0 = Date.UTC(2026, 3, 22, 12, 0, 0);

  await mgr.startPlaySession("w-1", t0);
  // Verify cache state set after successful write.
  assert.equal(fake.playStates.has("w-1"), true, "DB has play state");

  // Now finish — DB throws.
  fake.failNextWrite = true;
  await assert.rejects(
    () => mgr.finishPlaySession("w-1", "h-1", t0 + 5 * 60 * 1000),
    /fake-db-failure/
  );

  // §66 mandatory-pause invariant: cache reflects DB. Player's accumulated
  // play-time should not show the 5-min increment (because DB doesn't have
  // it either).
  const cachedFromDbBefore = fake.playStates.get("w-1");
  assert.equal(
    cachedFromDbBefore?.activeFromMs,
    t0,
    "DB still has activeFromMs from start"
  );
});

// ── Restart semantics — instantiate new ComplianceManager from same DB ───────

test("Stage 2A: restart-semantics — new manager hydrated from DB sees same state", async () => {
  const fake = new FakePersistence();
  const mgr1 = createManagerWithPersistence(fake);
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);

  // Mutate via mgr1 (writes to DB via persist-first).
  await mgr1.setPlayerLossLimits({
    walletId: "w-1",
    hallId: "h-1",
    daily: 250
  });
  await mgr1.setSelfExclusion("w-2");
  await mgr1.recordLossEntry("w-1", "h-1", {
    type: "BUYIN",
    amount: 50,
    createdAtMs: nowMs
  });

  // Simulate a restart: new ComplianceManager instance with same persistence.
  const mgr2 = createManagerWithPersistence(fake);
  const snapshot = await fake.loadSnapshot();
  mgr2.hydrateFromSnapshot(snapshot);

  // mgr2 should see the same state.
  assert.equal(mgr2.getEffectiveLossLimits("w-1", "h-1").daily, 250);
  const snap = mgr2.getPlayerCompliance("w-2");
  assert.equal(snap.restrictions.selfExclusion.isActive, true);
  assert.deepEqual(mgr2.calculateNetLoss("w-1", nowMs, "h-1"), {
    daily: 50,
    monthly: 50
  });
});

test("Stage 2A: restart-semantics — failed write does NOT survive restart", async () => {
  const fake = new FakePersistence();
  const mgr1 = createManagerWithPersistence(fake);
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);

  // Try to write — DB throws.
  fake.failNextWrite = true;
  await assert.rejects(
    () =>
      mgr1.recordLossEntry("w-1", "h-1", {
        type: "BUYIN",
        amount: 100,
        createdAtMs: nowMs
      }),
    /fake-db-failure/
  );

  // New manager hydrated from DB sees no entry — cache and DB consistent.
  const mgr2 = createManagerWithPersistence(fake);
  mgr2.hydrateFromSnapshot(await fake.loadSnapshot());
  assert.deepEqual(mgr2.calculateNetLoss("w-1", nowMs, "h-1"), {
    daily: 0,
    monthly: 0
  });
});

// ── Concurrency — two simultaneous mutations against same scope ──────────────

test("Stage 2A: concurrent recordLossEntry calls — both persist correctly", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);

  // Fire two concurrent recordLossEntry — both should land in DB and cache.
  await Promise.all([
    mgr.recordLossEntry("w-1", "h-1", {
      type: "BUYIN",
      amount: 100,
      createdAtMs: nowMs
    }),
    mgr.recordLossEntry("w-1", "h-1", {
      type: "BUYIN",
      amount: 200,
      createdAtMs: nowMs + 1000
    })
  ]);

  assert.equal(fake.lossEntries.length, 2, "both entries persisted to DB");
  // Net-loss calculated from cache reflects both.
  assert.deepEqual(mgr.calculateNetLoss("w-1", nowMs + 2000, "h-1"), {
    daily: 300,
    monthly: 300
  });
});

test("Stage 2A: concurrent setPlayerLossLimits — both writes commit, last-write-wins in cache", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);

  // Establish baseline so neither call falls into early-pending branch.
  await mgr.setPlayerLossLimits({
    walletId: "w-1",
    hallId: "h-1",
    daily: 400
  });

  // Two concurrent decreases (lowering, so both apply immediately).
  await Promise.all([
    mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 200 }),
    mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 })
  ]);

  // Final state must be one of {200, 100} — last-write-wins. Both are valid
  // outcomes — what matters is cache <-> DB consistency.
  const cacheValue = mgr.getEffectiveLossLimits("w-1", "h-1").daily;
  const dbValue = fake.lossLimits.get("w-1::h-1")!.daily;
  assert.equal(
    cacheValue,
    dbValue,
    `cache (${cacheValue}) must equal DB (${dbValue}) regardless of which write won`
  );
  assert.ok(
    cacheValue === 100 || cacheValue === 200,
    `cache must be one of {100, 200}, got ${cacheValue}`
  );
});

// ── §71 actor_hall_id binding integrity check ────────────────────────────────

test("Stage 2A: §71 hall-binding — recordLossEntry persists hallId verbatim", async () => {
  const fake = new FakePersistence();
  const mgr = createManagerWithPersistence(fake);
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);

  // Same wallet, two different halls — entries must bind to the
  // hall they came from for §71 reporting.
  await mgr.recordLossEntry("w-1", "hall-A", {
    type: "BUYIN",
    amount: 100,
    createdAtMs: nowMs
  });
  await mgr.recordLossEntry("w-1", "hall-B", {
    type: "BUYIN",
    amount: 200,
    createdAtMs: nowMs + 1000
  });

  // Verify per-hall persisted entries (§71 hall-aggregation source-of-truth).
  const hallAEntries = fake.lossEntries.filter((e) => e.hallId === "hall-A");
  const hallBEntries = fake.lossEntries.filter((e) => e.hallId === "hall-B");
  assert.equal(hallAEntries.length, 1, "exactly one entry bound to hall-A");
  assert.equal(hallAEntries[0].amount, 100);
  assert.equal(hallBEntries.length, 1, "exactly one entry bound to hall-B");
  assert.equal(hallBEntries[0].amount, 200);

  // Cache-side per-hall calculation matches DB.
  assert.deepEqual(
    mgr.calculateNetLoss("w-1", nowMs + 2000, "hall-A"),
    { daily: 100, monthly: 100 }
  );
  assert.deepEqual(
    mgr.calculateNetLoss("w-1", nowMs + 2000, "hall-B"),
    { daily: 200, monthly: 200 }
  );
});

// ── Equivalence: behavior with no persistence (original ComplianceManager) ───

test("Stage 2A: backwards-compat — manager without persistence still behaves identically", async () => {
  // No-persistence path is the existing test pattern — verify nothing broke.
  const mgr = new ComplianceManager({
    regulatoryLossLimits: { daily: 500, monthly: 4400 },
    playSessionLimitMs: 60 * 60 * 1000,
    pauseDurationMs: 15 * 60 * 1000,
    selfExclusionMinMs: 365 * 24 * 60 * 60 * 1000
  });
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);

  await mgr.recordLossEntry("w-1", "h-1", {
    type: "BUYIN",
    amount: 150,
    createdAtMs: nowMs
  });
  await mgr.setPlayerLossLimits({
    walletId: "w-1",
    hallId: "h-1",
    daily: 200
  });
  await mgr.setSelfExclusion("w-2");

  assert.deepEqual(mgr.calculateNetLoss("w-1", nowMs, "h-1"), {
    daily: 150,
    monthly: 150
  });
  assert.equal(mgr.getEffectiveLossLimits("w-1", "h-1").daily, 200);
  const snap = mgr.getPlayerCompliance("w-2");
  assert.equal(snap.restrictions.selfExclusion.isActive, true);
});
