import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DrawScheduler, type SchedulerSettings, type RoomSummary } from "../DrawScheduler.js";

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
  onRoomRescheduled?: (roomCode: string) => Promise<void> | void;
}) {
  const events: Array<{ type: string; room: string; host?: string }> = [];
  const settings = { ...defaultSettings(), ...opts.settings };
  const summaries = opts.summaries ?? [];

  const scheduler = new DrawScheduler({
    tickIntervalMs: 100_000, // won't auto-tick in tests
    lockTimeoutMs: 5_000,
    fixedDrawIntervalMs: settings.autoDrawIntervalMs,
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
    onRoomRescheduled: opts.onRoomRescheduled,
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

describe("DrawScheduler", () => {
  it("tick processes auto-start when conditions are met", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "NONE" },
    ];
    const { scheduler, events } = createTestScheduler({ summaries });

    // Set next round to now (past).
    scheduler.nextAutoStartAtByRoom.set("R1", Date.now() - 1000);

    await scheduler.tick();

    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "start");
    assert.equal(events[0]!.room, "R1");
  });

  it("tick does not start when game is already RUNNING", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];
    const { scheduler, events } = createTestScheduler({ summaries });
    scheduler.nextAutoStartAtByRoom.set("R1", Date.now() - 1000);

    await scheduler.tick();

    // No start event — but processAutoDraw should have been called.
    const starts = events.filter((e) => e.type === "start");
    assert.equal(starts.length, 0);
  });

  it("tick processes auto-draw for RUNNING rooms", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];
    const { scheduler, events } = createTestScheduler({ summaries });

    // Prime lastAutoDrawAt to allow a draw.
    scheduler.lastAutoDrawAtByRoom.set("R1", Date.now() - 3_000);

    await scheduler.tick();

    const draws = events.filter((e) => e.type === "draw");
    assert.equal(draws.length, 1);
    assert.equal(draws[0]!.room, "R1");
  });

  it("rate-limits draws within interval", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];
    const { scheduler, events } = createTestScheduler({ summaries });

    // Last draw was very recent.
    scheduler.lastAutoDrawAtByRoom.set("R1", Date.now() - 100);

    await scheduler.tick();

    const draws = events.filter((e) => e.type === "draw");
    assert.equal(draws.length, 0);
  });

  it("does not start when not enough players", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 0, createdAt: "2026-01-01", gameStatus: "NONE" },
    ];
    const { scheduler, events } = createTestScheduler({
      summaries,
      settings: { autoRoundMinPlayers: 1 },
    });
    scheduler.nextAutoStartAtByRoom.set("R1", Date.now() - 1000);

    await scheduler.tick();

    assert.equal(events.length, 0);
  });

  it("does not start when autoRoundStartEnabled is false", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 5, createdAt: "2026-01-01", gameStatus: "NONE" },
    ];
    const { scheduler, events } = createTestScheduler({
      summaries,
      settings: { autoRoundStartEnabled: false },
    });

    await scheduler.tick();

    assert.equal(events.length, 0);
  });

  it("setNextRoundForRoom stores correct time", () => {
    const { scheduler } = createTestScheduler({});
    const now = 100_000;
    const result = scheduler.setNextRoundForRoom("R1", now);

    assert.equal(result, 100_000 + 30_000);
    assert.equal(scheduler.nextAutoStartAtByRoom.get("R1"), 130_000);
  });

  it("schedules next round when onAutoDraw reports roundEnded", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];
    const { scheduler } = createTestScheduler({
      summaries,
      onAutoDraw: async () => ({ roundEnded: true }),
    });

    scheduler.lastAutoDrawAtByRoom.set("R1", Date.now() - 3_000);
    await scheduler.tick();

    // Next round should be scheduled ~30s from now.
    const next = scheduler.nextAutoStartAtByRoom.get("R1");
    assert.ok(next);
    assert.ok(next > Date.now() + 25_000);
  });

  it("calls onRoomRescheduled when onAutoDraw reports roundEnded", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];
    const reschedules: string[] = [];
    const { scheduler } = createTestScheduler({
      summaries,
      onAutoDraw: async () => ({ roundEnded: true }),
      onRoomRescheduled: async (roomCode) => {
        reschedules.push(roomCode);
      },
    });

    scheduler.lastAutoDrawAtByRoom.set("R1", Date.now() - 3_000);
    await scheduler.tick();

    assert.deepEqual(reschedules, ["R1"]);
  });

  it("calls onRoomRescheduled when auto-start is due but not enough players", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 0, createdAt: "2026-01-01", gameStatus: "NONE" },
    ];
    const reschedules: string[] = [];
    const { scheduler } = createTestScheduler({
      summaries,
      settings: { autoRoundMinPlayers: 1 },
      onRoomRescheduled: async (roomCode) => {
        reschedules.push(roomCode);
      },
    });

    scheduler.nextAutoStartAtByRoom.set("R1", Date.now() - 1000);
    await scheduler.tick();

    assert.deepEqual(reschedules, ["R1"]);
  });

  it("cleanup removes stale rooms", () => {
    const { scheduler } = createTestScheduler({});
    scheduler.nextAutoStartAtByRoom.set("ALIVE", 1);
    scheduler.nextAutoStartAtByRoom.set("DEAD", 2);
    scheduler.lastAutoDrawAtByRoom.set("ALIVE", 1);
    scheduler.lastAutoDrawAtByRoom.set("DEAD", 2);

    scheduler.cleanup(new Set(["ALIVE"]));

    assert.ok(scheduler.nextAutoStartAtByRoom.has("ALIVE"));
    assert.ok(!scheduler.nextAutoStartAtByRoom.has("DEAD"));
    assert.ok(scheduler.lastAutoDrawAtByRoom.has("ALIVE"));
    assert.ok(!scheduler.lastAutoDrawAtByRoom.has("DEAD"));
  });

  it("releaseRoom cleans up all state for a room", () => {
    const { scheduler } = createTestScheduler({});
    scheduler.nextAutoStartAtByRoom.set("R1", 1);
    scheduler.lastAutoDrawAtByRoom.set("R1", 1);
    scheduler.lock.tryAcquire("R1");

    scheduler.releaseRoom("R1");

    assert.ok(!scheduler.nextAutoStartAtByRoom.has("R1"));
    assert.ok(!scheduler.lastAutoDrawAtByRoom.has("R1"));
    assert.equal(scheduler.lock.isLocked("R1"), false);
  });

  it("syncAfterSettingsChange clears maps when features disabled", () => {
    const { scheduler, settings } = createTestScheduler({});
    scheduler.nextAutoStartAtByRoom.set("R1", 1000);
    scheduler.lastAutoDrawAtByRoom.set("R1", 2000);

    const prev = { ...settings };
    settings.autoRoundStartEnabled = false;
    settings.autoDrawEnabled = false;
    scheduler.syncAfterSettingsChange(prev);

    assert.equal(scheduler.nextAutoStartAtByRoom.size, 0);
    assert.equal(scheduler.lastAutoDrawAtByRoom.size, 0);
  });

  it("healthSummary returns structured metrics", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];
    const { scheduler } = createTestScheduler({ summaries });
    scheduler.lastAutoDrawAtByRoom.set("R1", Date.now() - 3_000);

    await scheduler.tick();

    const health = scheduler.healthSummary();
    assert.ok("drawWatchdog" in health);
    assert.ok("schedulerLock" in health);
    assert.ok("drawErrors" in health);
    assert.ok("tickCount" in health);
    assert.equal(health.tickCount, 1);
  });

  it("healthSummary(true) returns per-room detailed data", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
      { code: "R2", hallId: "h2", hostPlayerId: "host-2", playerCount: 3, createdAt: "2026-01-01", gameStatus: "NONE" },
    ];
    const { scheduler } = createTestScheduler({ summaries });

    // Set up timing state for both rooms.
    const now = Date.now();
    scheduler.lastAutoDrawAtByRoom.set("R1", now - 1_000);
    scheduler.nextAutoStartAtByRoom.set("R1", now + 25_000);
    scheduler.nextAutoStartAtByRoom.set("R2", now + 30_000);

    // Lock R1 to verify isLocked reporting.
    scheduler.lock.tryAcquire("R1");

    const detailed = scheduler.healthSummary(true);

    // Should include base fields.
    assert.ok("drawWatchdog" in detailed);
    assert.ok("schedulerLock" in detailed);
    assert.ok("drawErrors" in detailed);
    assert.ok("tickCount" in detailed);

    // Should include detailed fields.
    assert.equal(detailed.activeRooms, 2);
    assert.ok(Array.isArray(detailed.rooms));

    const rooms = detailed.rooms as Array<{
      roomCode: string;
      lastDrawAt: string | null;
      nextAutoStartAt: string | null;
      isLocked: boolean;
    }>;
    assert.equal(rooms.length, 2);

    const r1 = rooms.find((r) => r.roomCode === "R1");
    const r2 = rooms.find((r) => r.roomCode === "R2");
    assert.ok(r1);
    assert.ok(r2);

    // R1: has lastDrawAt, nextAutoStartAt, and is locked.
    assert.ok(r1.lastDrawAt !== null);
    assert.ok(r1.nextAutoStartAt !== null);
    assert.equal(r1.isLocked, true);

    // R2: no lastDrawAt, has nextAutoStartAt, not locked.
    assert.equal(r2.lastDrawAt, null);
    assert.ok(r2.nextAutoStartAt !== null);
    assert.equal(r2.isLocked, false);

    // Release the lock for cleanup.
    scheduler.lock.release("R1");
  });

  it("healthSummary(false) does NOT include per-room data", () => {
    const { scheduler } = createTestScheduler({});
    scheduler.lastAutoDrawAtByRoom.set("R1", Date.now());

    const summary = scheduler.healthSummary(false);

    assert.ok(!("activeRooms" in summary));
    assert.ok(!("rooms" in summary));
  });

  it("healthSummary() without argument does NOT include per-room data", () => {
    const { scheduler } = createTestScheduler({});
    scheduler.lastAutoDrawAtByRoom.set("R1", Date.now());

    const summary = scheduler.healthSummary();

    assert.ok(!("activeRooms" in summary));
    assert.ok(!("rooms" in summary));
  });

  it("detailed healthSummary does not expose sensitive data", async () => {
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];
    const { scheduler } = createTestScheduler({ summaries });
    scheduler.lastAutoDrawAtByRoom.set("R1", Date.now() - 1_000);
    scheduler.nextAutoStartAtByRoom.set("R1", Date.now() + 25_000);

    const detailed = scheduler.healthSummary(true);
    const json = JSON.stringify(detailed);

    // Must not contain sensitive fields.
    assert.ok(!json.includes("drawnNumbers"));
    assert.ok(!json.includes("playerIds"));
    assert.ok(!json.includes("walletId"));
    assert.ok(!json.includes("hostPlayerId"));
  });

  it("errors in one room do not block others", async () => {
    const summaries: RoomSummary[] = [
      { code: "BAD", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
      { code: "GOOD", hallId: "h2", hostPlayerId: "host-2", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];
    const draws: string[] = [];
    const { scheduler } = createTestScheduler({
      summaries,
      onAutoDraw: async (room) => {
        if (room === "BAD") throw new Error("crash");
        draws.push(room);
        return { roundEnded: false };
      },
    });
    scheduler.lastAutoDrawAtByRoom.set("BAD", Date.now() - 3_000);
    scheduler.lastAutoDrawAtByRoom.set("GOOD", Date.now() - 3_000);

    await scheduler.tick();

    assert.deepEqual(draws, ["GOOD"]);
    assert.equal(scheduler.errorTracker.metrics.fatal, 1);
  });

  it("start/stop lifecycle", () => {
    const { scheduler } = createTestScheduler({});

    assert.equal(scheduler.isRunning, false);
    scheduler.start();
    assert.equal(scheduler.isRunning, true);
    assert.equal(scheduler.watchdog.isRunning, true);

    scheduler.stop();
    assert.equal(scheduler.isRunning, false);
    assert.equal(scheduler.watchdog.isRunning, false);
  });
});

// ── Drift-correction (absolute-time anchor) tests ────────────────

describe("DrawScheduler drift-correction", () => {
  it("100 consecutive draws accumulate <50ms drift with anchor-based timing", async () => {
    const INTERVAL = 2_000;
    const DRAW_COUNT = 100;
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];

    const drawTimestamps: number[] = [];
    let fakeNow = 1_000_000;

    const { scheduler } = createTestScheduler({
      summaries,
      onAutoDraw: async () => {
        drawTimestamps.push(fakeNow);
        return { roundEnded: false };
      },
    });

    // Set anchor as if round just started and the first ball was just drawn.
    const anchorTime = fakeNow;
    scheduler.drawAnchorByRoom.set("R1", { anchor: anchorTime, count: 0 });
    scheduler.lastAutoDrawAtByRoom.set("R1", anchorTime);

    // Stub Date.now to return fakeNow (for lock re-checks inside processAutoDraw).
    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      for (let i = 0; i < DRAW_COUNT; i++) {
        // Advance time to exactly when the next draw should happen, plus a small
        // simulated execution jitter (0-8ms).
        const expectedDrawAt = anchorTime + (i + 1) * INTERVAL; // count starts at 0
        const jitter = Math.floor(Math.random() * 9); // 0-8ms jitter
        fakeNow = expectedDrawAt + jitter;

        await scheduler.tick();
      }

      assert.equal(drawTimestamps.length, DRAW_COUNT, `Expected ${DRAW_COUNT} draws but got ${drawTimestamps.length}`);

      // Verify cumulative drift: each draw should have happened at approximately
      // anchor + (drawIndex + 1) * interval.
      // Because we use anchor-based timing, the draws are grid-aligned regardless of jitter.
      let maxDrift = 0;
      for (let i = 0; i < drawTimestamps.length; i++) {
        const expectedAt = anchorTime + (i + 1) * INTERVAL;
        const drift = Math.abs(drawTimestamps[i]! - expectedAt);
        if (drift > maxDrift) maxDrift = drift;
      }

      // With anchor-based timing, worst-case drift equals our max jitter (8ms),
      // not the accumulated jitter over all draws.
      assert.ok(maxDrift < 50, `Max drift was ${maxDrift}ms, expected <50ms`);
    } finally {
      Date.now = origDateNow;
    }
  });

  it("first draw after round start uses anchor correctly (no extra gap)", async () => {
    const INTERVAL = 2_000;
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "NONE" },
    ];

    let fakeNow = 1_000_000;
    const drawTimestamps: number[] = [];

      const { scheduler, settings } = createTestScheduler({
        summaries,
        settings: { autoDrawIntervalMs: INTERVAL },
        onAutoStart: async () => {
          // Simulate: onAutoStart draws the first ball.
          return { firstDrawAtMs: Date.now() };
        },
        onAutoDraw: async () => {
          drawTimestamps.push(fakeNow);
          return { roundEnded: false };
        },
      });

    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      // Trigger auto-start.
      scheduler.nextAutoStartAtByRoom.set("R1", fakeNow - 1000);
      await scheduler.tick();

      // After auto-start, an anchor should exist with count=0 (anchor = first draw time).
      const anchor = scheduler.drawAnchorByRoom.get("R1");
      assert.ok(anchor, "Anchor should be set after auto-start");
      assert.equal(anchor!.count, 0, "Count should be 0 (next draw is anchor + interval)");

      // Now the room is RUNNING for subsequent ticks.
      summaries[0] = { ...summaries[0]!, gameStatus: "RUNNING" };

      // Advance to exactly anchor + interval (second draw).
      fakeNow = anchor!.anchor + INTERVAL;
      await scheduler.tick();

      assert.equal(drawTimestamps.length, 1, "Should have drawn exactly once");
      assert.equal(drawTimestamps[0], fakeNow, "Draw should happen at the absolute scheduled time");

      // Verify there's no extra gap — the draw should happen at anchor + interval.
      const expectedAt = anchor!.anchor + INTERVAL;
      assert.equal(drawTimestamps[0], expectedAt, "Draw time should match absolute schedule");
    } finally {
      Date.now = origDateNow;
    }
  });

  it("cleanup removes anchor state for inactive rooms", () => {
    const { scheduler } = createTestScheduler({});
    scheduler.drawAnchorByRoom.set("ALIVE", { anchor: 1000, count: 5 });
    scheduler.drawAnchorByRoom.set("DEAD", { anchor: 2000, count: 3 });
    scheduler.nextAutoStartAtByRoom.set("ALIVE", 1);
    scheduler.lastAutoDrawAtByRoom.set("ALIVE", 1);

    scheduler.cleanup(new Set(["ALIVE"]));

    assert.ok(scheduler.drawAnchorByRoom.has("ALIVE"), "ALIVE anchor should remain");
    assert.ok(!scheduler.drawAnchorByRoom.has("DEAD"), "DEAD anchor should be removed");
  });

  it("releaseRoom removes anchor state", () => {
    const { scheduler } = createTestScheduler({});
    scheduler.drawAnchorByRoom.set("R1", { anchor: 1000, count: 5 });
    scheduler.nextAutoStartAtByRoom.set("R1", 1);
    scheduler.lastAutoDrawAtByRoom.set("R1", 1);

    scheduler.releaseRoom("R1");

    assert.ok(!scheduler.drawAnchorByRoom.has("R1"), "Anchor should be removed after releaseRoom");
  });

  it("missing anchor falls back to relative timing gracefully", async () => {
    const INTERVAL = 2_000;
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];

    let fakeNow = 1_000_000;
    const drawTimestamps: number[] = [];

    const { scheduler } = createTestScheduler({
      summaries,
      settings: { autoDrawIntervalMs: INTERVAL },
      onAutoDraw: async () => {
        drawTimestamps.push(fakeNow);
        return { roundEnded: false };
      },
    });

    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      // No anchor set — simulate a room that was RUNNING before the upgrade.
      // Only set lastAutoDrawAtByRoom (old-style).
      scheduler.lastAutoDrawAtByRoom.set("R1", fakeNow - INTERVAL - 100);

      await scheduler.tick();

      // Should draw using fallback relative timing.
      assert.equal(drawTimestamps.length, 1, "Should draw via fallback path");

      // After the fallback draw, an anchor should now be established.
      const anchor = scheduler.drawAnchorByRoom.get("R1");
      assert.ok(anchor, "Anchor should be established after fallback draw");
      assert.equal(anchor!.count, 0, "New anchor starts at count 0");
    } finally {
      Date.now = origDateNow;
    }
  });

  it("does not burst-draw when ticks are missed (re-anchors instead)", async () => {
    const INTERVAL = 2_000;
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];

    let fakeNow = 1_000_000;
    const drawTimestamps: number[] = [];

    const { scheduler } = createTestScheduler({
      summaries,
      settings: { autoDrawIntervalMs: INTERVAL },
      onAutoDraw: async () => {
        drawTimestamps.push(fakeNow);
        return { roundEnded: false };
      },
    });

    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      const anchorTime = fakeNow;
      scheduler.drawAnchorByRoom.set("R1", { anchor: anchorTime, count: 0 });
      scheduler.lastAutoDrawAtByRoom.set("R1", anchorTime);

      // Skip ahead 10 intervals (simulating a long GC pause or stall).
      fakeNow = anchorTime + 11 * INTERVAL;
      await scheduler.tick();

      // Should only draw ONCE, not 10 times.
      assert.equal(drawTimestamps.length, 1, "Should draw only once after missed intervals");

      // The anchor should be re-set to now.
      const newAnchor = scheduler.drawAnchorByRoom.get("R1");
      assert.ok(newAnchor, "Anchor should exist after re-anchor");
      assert.equal(newAnchor!.anchor, fakeNow, "Anchor should be reset to current time");
      assert.equal(newAnchor!.count, 0, "Count should reset to 0 after re-anchor");
    } finally {
      Date.now = origDateNow;
    }
  });

  it("syncAfterSettingsChange clears anchors when autoDrawEnabled toggled off", () => {
    const { scheduler, settings } = createTestScheduler({});
    scheduler.drawAnchorByRoom.set("R1", { anchor: 1000, count: 5 });
    scheduler.lastAutoDrawAtByRoom.set("R1", 2000);

    const prev = { ...settings };
    settings.autoDrawEnabled = false;
    scheduler.syncAfterSettingsChange(prev);

    assert.equal(scheduler.drawAnchorByRoom.size, 0, "Anchors should be cleared when autoDraw disabled");
    assert.equal(scheduler.lastAutoDrawAtByRoom.size, 0, "lastAutoDrawAt should be cleared");
  });

  it("syncAfterSettingsChange clears anchors when autoDrawEnabled toggled back on", () => {
    const { scheduler, settings } = createTestScheduler({
      settings: { autoDrawEnabled: false },
    });
    scheduler.drawAnchorByRoom.set("R1", { anchor: 1000, count: 5 });
    scheduler.lastAutoDrawAtByRoom.set("R1", 2000);

    const prev = { ...settings };
    settings.autoDrawEnabled = true;
    scheduler.syncAfterSettingsChange(prev);

    assert.equal(scheduler.drawAnchorByRoom.size, 0, "Anchors should be cleared when autoDraw re-enabled");
    assert.equal(scheduler.lastAutoDrawAtByRoom.size, 0, "lastAutoDrawAt should be cleared");
  });

  it("watchdog still works — lastAutoDrawAtByRoom is updated on each draw", async () => {
    const INTERVAL = 2_000;
    const summaries: RoomSummary[] = [
      { code: "R1", hallId: "h1", hostPlayerId: "host-1", playerCount: 2, createdAt: "2026-01-01", gameStatus: "RUNNING" },
    ];

    let fakeNow = 1_000_000;

    const { scheduler } = createTestScheduler({
      summaries,
      settings: { autoDrawIntervalMs: INTERVAL },
      onAutoDraw: async () => ({ roundEnded: false }),
    });

    const origDateNow = Date.now;
    Date.now = () => fakeNow;

    try {
      const anchorTime = fakeNow;
      scheduler.drawAnchorByRoom.set("R1", { anchor: anchorTime, count: 0 });
      scheduler.lastAutoDrawAtByRoom.set("R1", anchorTime);

      // Advance to next draw time.
      fakeNow = anchorTime + INTERVAL;
      await scheduler.tick();

      const lastDraw = scheduler.lastAutoDrawAtByRoom.get("R1");
      assert.ok(lastDraw !== undefined, "lastAutoDrawAtByRoom should be set");
      assert.equal(lastDraw, fakeNow, "lastAutoDrawAtByRoom should be updated to current time");
    } finally {
      Date.now = origDateNow;
    }
  });
});
