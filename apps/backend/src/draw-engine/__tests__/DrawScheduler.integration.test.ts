/**
 * DrawScheduler integration tests (BIN-156).
 *
 * These tests exercise the full DrawScheduler with all subsystems
 * (lock, watchdog, error tracker) working together — unlike the unit
 * tests which test each module in isolation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DrawScheduler, type SchedulerSettings, type RoomSummary } from "../DrawScheduler.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Shared helpers ──────────────────────────────────────────────

function defaultSettings(): SchedulerSettings {
  return {
    autoRoundStartEnabled: true,
    autoRoundStartIntervalMs: 30_000,
    autoRoundMinPlayers: 1,
    autoDrawEnabled: true,
    autoDrawIntervalMs: 2_000,
  };
}

function createTestScheduler(opts: {
  summaries?: RoomSummary[];
  settings?: Partial<SchedulerSettings>;
  snapshot?: Record<string, { currentGame?: { status: string }; hostPlayerId: string; players: Array<{ walletId: string }> }>;
  onAutoStart?: (roomCode: string, hostPlayerId: string) => Promise<{ firstDrawAtMs: number | null }>;
  onAutoDraw?: (roomCode: string, hostPlayerId: string) => Promise<{ roundEnded: boolean }>;
  lockTimeoutMs?: number;
  watchdogIntervalMs?: number;
  watchdogStuckMultiplier?: number;
  fixedDrawIntervalMs?: number;
}) {
  const events: Array<{ type: string; room: string; host?: string; ts?: number }> = [];
  const settings = { ...defaultSettings(), ...opts.settings };
  const summaries = opts.summaries ?? [];

  const scheduler = new DrawScheduler({
    tickIntervalMs: 100_000, // won't auto-tick in tests
    lockTimeoutMs: opts.lockTimeoutMs ?? 5_000,
    watchdogIntervalMs: opts.watchdogIntervalMs ?? 5_000,
    watchdogStuckMultiplier: opts.watchdogStuckMultiplier ?? 3,
    fixedDrawIntervalMs: opts.fixedDrawIntervalMs ?? settings.autoDrawIntervalMs,
    getSettings: () => settings,
    listRoomSummaries: () => summaries,
    getRoomSnapshot: (roomCode) => {
      if (opts.snapshot?.[roomCode]) return opts.snapshot[roomCode]!;
      const summary = summaries.find((s) => s.code === roomCode);
      return {
        currentGame: summary?.gameStatus === "RUNNING" ? { status: "RUNNING" } : undefined,
        hostPlayerId: summary?.hostPlayerId ?? "host-1",
        players: [{ walletId: "w1" }],
      };
    },
    getAllRoomCodes: () => summaries.map((s) => s.code),
    onAutoStart: opts.onAutoStart ?? (async (room, host) => {
      events.push({ type: "start", room, host });
      return { firstDrawAtMs: Date.now() };
    }),
    onAutoDraw: opts.onAutoDraw ?? (async (room, host) => {
      events.push({ type: "draw", room, host });
      return { roundEnded: false };
    }),
  });

  return { scheduler, events, settings, summaries };
}

function mkSummary(overrides: Partial<RoomSummary> & { code: string }): RoomSummary {
  return {
    hallId: "h1",
    hostPlayerId: "host-1",
    playerCount: 2,
    createdAt: "2026-01-01",
    gameStatus: "NONE",
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe("DrawScheduler integration", () => {

  // ── 1. Lock timeout recovery during tick ──────────────────────

  it("lock timeout recovery: tick force-releases a stale lock and processes the room", async () => {
    const summaries: RoomSummary[] = [
      mkSummary({ code: "HUNG", hallId: "h1", gameStatus: "RUNNING" }),
      mkSummary({ code: "OK", hallId: "h2", gameStatus: "RUNNING" }),
    ];

    let fakeNow = 1_000_000;
    const draws: string[] = [];

    const { scheduler } = createTestScheduler({
      summaries,
      lockTimeoutMs: 100, // very low timeout
      onAutoDraw: async (room) => {
        draws.push(room);
        return { roundEnded: false };
      },
    });

    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      // Simulate a lock that was left held (e.g. previous tick crashed or
      // the promise was abandoned). The lock's acquiredAt = fakeNow.
      scheduler.lock.tryAcquire("HUNG");
      assert.ok(scheduler.lock.isLocked("HUNG"), "HUNG lock should be held");

      // Both rooms have draws due.
      scheduler.lastAutoDrawAtByRoom.set("HUNG", fakeNow - 3_000);
      scheduler.lastAutoDrawAtByRoom.set("OK", fakeNow - 3_000);

      // Tick while lock is fresh: HUNG cannot be acquired (lock held),
      // so only OK gets a draw.
      await scheduler.tick();

      assert.ok(draws.includes("OK"), "OK room should have drawn");
      assert.ok(!draws.includes("HUNG"), "HUNG should be skipped — lock still held");
      assert.ok(scheduler.lock.isLocked("HUNG"), "HUNG lock should still be held");

      // Advance time past both the lock timeout (100ms) AND the draw interval
      // (2000ms), so a new draw is due for both rooms on the next tick.
      fakeNow += 3_000;
      draws.length = 0;

      // HUNG still has no anchor (it was skipped), so fallback relative timing
      // applies: set lastAutoDrawAt to make it due.
      scheduler.lastAutoDrawAtByRoom.set("HUNG", fakeNow - 3_000);

      // Second tick: the stale lock for HUNG is force-released via timeout,
      // allowing withLock to re-acquire it. Both rooms draw.
      await scheduler.tick();

      assert.ok(draws.includes("HUNG"), "HUNG room should draw after lock timeout recovery");

      // The lock's timeout counter should have incremented.
      assert.ok(scheduler.lock.timeoutCount >= 1, "Lock timeout should have been recorded");
    } finally {
      Date.now = origDateNow;
    }
  });

  // ── 2. Watchdog detects stuck room and force-releases lock ────

  it("watchdog detects stuck room and force-releases its lock", () => {
    const summaries: RoomSummary[] = [
      mkSummary({ code: "STUCK", hallId: "h1", gameStatus: "RUNNING" }),
    ];

    let fakeNow = 1_000_000;
    const stuckEvents: Array<{ room: string; elapsed: number }> = [];

    const scheduler = new DrawScheduler({
      tickIntervalMs: 100_000,
      lockTimeoutMs: 5_000,
      watchdogIntervalMs: 5_000,
      watchdogStuckMultiplier: 3,
      fixedDrawIntervalMs: 2_000,
      getSettings: () => defaultSettings(),
      listRoomSummaries: () => summaries,
      getRoomSnapshot: (roomCode) => ({
        currentGame: { status: "RUNNING" },
        hostPlayerId: "host-1",
        players: [{ walletId: "w1" }],
      }),
      getAllRoomCodes: () => summaries.map((s) => s.code),
      onAutoStart: async () => ({ firstDrawAtMs: null }),
      onAutoDraw: async () => ({ roundEnded: false }),
    });

    // Override watchdog's now() by re-creating it with an injectable clock.
    // Instead, we use the scheduler's maps directly and call check().

    // Simulate: lock acquired for STUCK room, and lastDrawAt is very stale.
    scheduler.lock.tryAcquire("STUCK");
    scheduler.lastAutoDrawAtByRoom.set("STUCK", fakeNow - 20_000); // 20s ago

    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      // The watchdog's stuck threshold is drawIntervalMs * multiplier = 2000 * 3 = 6000ms.
      // 20_000ms ago exceeds that threshold.
      scheduler.watchdog.check();

      // Verify lock was force-released.
      assert.equal(scheduler.lock.isLocked("STUCK"), false, "Lock should be force-released");

      // Verify watchdog metrics.
      const metrics = scheduler.watchdog.metrics;
      assert.equal(metrics.stuckDetectionCount, 1, "Should detect 1 stuck room");
      assert.deepEqual(metrics.currentStuckRoomCodes, ["STUCK"]);
    } finally {
      Date.now = origDateNow;
    }
  });

  // ── 3. Error classification across multiple rooms ─────────────

  it("error classification: PERMANENT, TRANSIENT, and success across 3 rooms", async () => {
    const summaries: RoomSummary[] = [
      mkSummary({ code: "PERM", hallId: "h1", gameStatus: "RUNNING" }),
      mkSummary({ code: "TRANS", hallId: "h2", gameStatus: "RUNNING" }),
      mkSummary({ code: "GOOD", hallId: "h3", gameStatus: "RUNNING" }),
    ];

    const draws: string[] = [];

    const { scheduler } = createTestScheduler({
      summaries,
      onAutoDraw: async (room) => {
        if (room === "PERM") throw new DomainError("NO_MORE_NUMBERS", "No more numbers");
        if (room === "TRANS") throw new DomainError("WALLET_ERROR", "Wallet unavailable");
        draws.push(room);
        return { roundEnded: false };
      },
    });

    let fakeNow = 1_000_000;
    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      // All three rooms have draws due.
      for (const code of ["PERM", "TRANS", "GOOD"]) {
        scheduler.lastAutoDrawAtByRoom.set(code, fakeNow - 3_000);
      }

      await scheduler.tick();

      // Verify the successful room still drew.
      assert.deepEqual(draws, ["GOOD"], "Only GOOD room should have drawn");

      // Verify aggregate error counts.
      const metrics = scheduler.errorTracker.metrics;
      assert.equal(metrics.permanent, 1, "Should have 1 permanent error");
      assert.equal(metrics.transient, 1, "Should have 1 transient error");
      assert.equal(metrics.fatal, 0, "Should have 0 fatal errors");

      // Verify per-room breakdown.
      const permRoom = metrics.byRoom.get("PERM");
      assert.ok(permRoom, "PERM room should have error entry");
      assert.equal(permRoom!.permanent, 1);
      assert.equal(permRoom!.transient, 0);

      const transRoom = metrics.byRoom.get("TRANS");
      assert.ok(transRoom, "TRANS room should have error entry");
      assert.equal(transRoom!.transient, 1);
      assert.equal(transRoom!.permanent, 0);

      // GOOD room should NOT have an error entry.
      assert.equal(metrics.byRoom.has("GOOD"), false, "GOOD room should have no errors");
    } finally {
      Date.now = origDateNow;
    }
  });

  // ── 4. Full round lifecycle ───────────────────────────────────

  it("full round lifecycle: auto-start -> draws -> round ends -> next round scheduled", async () => {
    const INTERVAL = 2_000;
    const DRAWS_BEFORE_END = 5;

    const summaries: RoomSummary[] = [
      mkSummary({ code: "R1", hallId: "h1", playerCount: 3, gameStatus: "NONE" }),
    ];

    let fakeNow = 1_000_000;
    let drawCount = 0;
    const lifecycle: string[] = [];

    const { scheduler } = createTestScheduler({
      summaries,
      settings: { autoDrawIntervalMs: INTERVAL, autoRoundStartIntervalMs: 30_000 },
      onAutoStart: async (room) => {
        lifecycle.push("start");
        // After start, game transitions to RUNNING.
        summaries[0] = { ...summaries[0]!, gameStatus: "RUNNING" };
        return { firstDrawAtMs: Date.now() };
      },
      onAutoDraw: async (room) => {
        drawCount++;
        lifecycle.push(`draw-${drawCount}`);
        const roundEnded = drawCount >= DRAWS_BEFORE_END;
        if (roundEnded) {
          // After round ends, game transitions back to NONE.
          summaries[0] = { ...summaries[0]!, gameStatus: "NONE" };
        }
        return { roundEnded };
      },
    });

    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      // Set next auto-start to past so it triggers immediately.
      scheduler.nextAutoStartAtByRoom.set("R1", fakeNow - 1_000);

      // Tick 1: triggers auto-start (which also anchors cadence with count=0).
      await scheduler.tick();
      assert.equal(lifecycle[0], "start", "First lifecycle event should be start");

      const anchor = scheduler.drawAnchorByRoom.get("R1");
      assert.ok(anchor, "Anchor should be set after auto-start");

      // Ticks 2 through 6: each advances to the next draw time.
      for (let i = 0; i < DRAWS_BEFORE_END; i++) {
        fakeNow = anchor!.anchor + (anchor!.count + 1 + i) * INTERVAL;
        await scheduler.tick();
      }

      // Verify all draws fired.
      assert.equal(drawCount, DRAWS_BEFORE_END, `Should have ${DRAWS_BEFORE_END} draws`);
      assert.equal(lifecycle[lifecycle.length - 1], `draw-${DRAWS_BEFORE_END}`);

      // Verify next round is scheduled.
      const nextStart = scheduler.nextAutoStartAtByRoom.get("R1");
      assert.ok(nextStart, "Next round should be scheduled");
      assert.ok(nextStart! > fakeNow, "Next round should be in the future");
    } finally {
      Date.now = origDateNow;
    }
  });

  // ── 5. Settings change mid-operation ──────────────────────────

  it("settings change mid-operation: disable autoDraw clears state, re-enable resumes", async () => {
    const INTERVAL = 2_000;
    const summaries: RoomSummary[] = [
      mkSummary({ code: "R1", hallId: "h1", gameStatus: "RUNNING" }),
    ];

    let fakeNow = 1_000_000;
    const draws: string[] = [];

    const { scheduler, settings } = createTestScheduler({
      summaries,
      settings: { autoDrawIntervalMs: INTERVAL },
      onAutoDraw: async (room) => {
        draws.push(room);
        return { roundEnded: false };
      },
    });

    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      // Prime state: set anchor and last draw so a draw is due.
      scheduler.drawAnchorByRoom.set("R1", { anchor: fakeNow - 10_000, count: 3 });
      scheduler.lastAutoDrawAtByRoom.set("R1", fakeNow - 3_000);

      // Tick: should draw.
      await scheduler.tick();
      assert.equal(draws.length, 1, "Should have drawn once");

      // Disable autoDraw via settings change.
      const prevSettings = { ...settings };
      settings.autoDrawEnabled = false;
      scheduler.syncAfterSettingsChange(prevSettings);

      // Verify state is cleared.
      assert.equal(scheduler.lastAutoDrawAtByRoom.size, 0, "lastAutoDrawAt should be cleared");
      assert.equal(scheduler.drawAnchorByRoom.size, 0, "drawAnchors should be cleared");

      // Tick while disabled: should NOT draw.
      draws.length = 0;
      await scheduler.tick();
      assert.equal(draws.length, 0, "Should not draw when autoDraw disabled");

      // Re-enable autoDraw.
      const prevSettings2 = { ...settings };
      settings.autoDrawEnabled = true;
      scheduler.syncAfterSettingsChange(prevSettings2);

      // Maps should be cleared when re-enabled (fresh start).
      assert.equal(scheduler.lastAutoDrawAtByRoom.size, 0, "lastAutoDrawAt should be cleared on re-enable");
      assert.equal(scheduler.drawAnchorByRoom.size, 0, "drawAnchors should be cleared on re-enable");

      // Set up state for a new draw (fallback path since no anchor).
      scheduler.lastAutoDrawAtByRoom.set("R1", fakeNow - 3_000);

      // Tick: should draw again via fallback relative timing.
      await scheduler.tick();
      assert.equal(draws.length, 1, "Should resume drawing after re-enable");

      // After fallback draw, an anchor should be established.
      assert.ok(scheduler.drawAnchorByRoom.has("R1"), "Anchor should be established after fallback draw");
    } finally {
      Date.now = origDateNow;
    }
  });

  // ── 6. Concurrent room cleanup ────────────────────────────────

  it("cleanup removes all state for inactive rooms across all subsystems", () => {
    const summaries: RoomSummary[] = [
      mkSummary({ code: "A", hallId: "h1" }),
    ];

    const { scheduler } = createTestScheduler({ summaries });

    // Populate state for rooms A, B, C.
    for (const code of ["A", "B", "C"]) {
      scheduler.nextAutoStartAtByRoom.set(code, 1000);
      scheduler.lastAutoDrawAtByRoom.set(code, 2000);
      scheduler.drawAnchorByRoom.set(code, { anchor: 1000, count: 5 });
      scheduler.lock.tryAcquire(code);
      // Record an error for each room.
      scheduler.errorTracker.record(code, {
        category: "TRANSIENT",
        shouldRetry: true,
        logLevel: "warn",
        reason: "test",
      });
    }

    // Cleanup: only A is active.
    scheduler.cleanup(new Set(["A"]));

    // A should survive.
    assert.ok(scheduler.nextAutoStartAtByRoom.has("A"), "A nextAutoStart should remain");
    assert.ok(scheduler.lastAutoDrawAtByRoom.has("A"), "A lastAutoDraw should remain");
    assert.ok(scheduler.drawAnchorByRoom.has("A"), "A drawAnchor should remain");
    assert.ok(scheduler.lock.isLocked("A"), "A lock should remain");
    assert.ok(scheduler.errorTracker.metrics.byRoom.has("A"), "A error entry should remain");

    // B and C should be removed from all maps.
    for (const code of ["B", "C"]) {
      assert.ok(!scheduler.nextAutoStartAtByRoom.has(code), `${code} nextAutoStart should be removed`);
      assert.ok(!scheduler.lastAutoDrawAtByRoom.has(code), `${code} lastAutoDraw should be removed`);
      assert.ok(!scheduler.drawAnchorByRoom.has(code), `${code} drawAnchor should be removed`);
      assert.ok(!scheduler.lock.isLocked(code), `${code} lock should be removed`);
      assert.ok(!scheduler.errorTracker.metrics.byRoom.has(code), `${code} error entry should be removed`);
    }

    // Release A lock for cleanup.
    scheduler.lock.release("A");
  });

  // ── 7. 500 draws soak test ────────────────────────────────────

  it("500 draws soak: all callbacks fire, no errors, correct tickCount", async () => {
    const INTERVAL = 2_000;
    const DRAW_COUNT = 500;
    const summaries: RoomSummary[] = [
      mkSummary({ code: "R1", hallId: "h1", gameStatus: "RUNNING" }),
    ];

    let fakeNow = 1_000_000;
    let drawsFired = 0;

    const { scheduler } = createTestScheduler({
      summaries,
      settings: { autoDrawIntervalMs: INTERVAL },
      onAutoDraw: async () => {
        drawsFired++;
        return { roundEnded: false };
      },
    });

    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      // Set anchor: first ball was just drawn (count=0).
      const anchorTime = fakeNow;
      scheduler.drawAnchorByRoom.set("R1", { anchor: anchorTime, count: 0 });
      scheduler.lastAutoDrawAtByRoom.set("R1", anchorTime);

      for (let i = 0; i < DRAW_COUNT; i++) {
        // Advance to the exact next draw time.
        fakeNow = anchorTime + (i + 1) * INTERVAL;
        await scheduler.tick();
      }

      // Verify all draws fired.
      assert.equal(drawsFired, DRAW_COUNT, `Expected ${DRAW_COUNT} draws but got ${drawsFired}`);

      // Verify no errors in the error tracker.
      const metrics = scheduler.errorTracker.metrics;
      assert.equal(metrics.permanent, 0, "No permanent errors expected");
      assert.equal(metrics.transient, 0, "No transient errors expected");
      assert.equal(metrics.fatal, 0, "No fatal errors expected");

      // Verify healthSummary shows correct tickCount.
      const health = scheduler.healthSummary();
      assert.equal(health.tickCount, DRAW_COUNT, `tickCount should be ${DRAW_COUNT}`);
    } finally {
      Date.now = origDateNow;
    }
  });
});
