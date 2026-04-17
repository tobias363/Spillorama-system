import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DrawSchedulerLock } from "../DrawSchedulerLock.js";
import { DrawWatchdog, type WatchdogRoomState } from "../DrawWatchdog.js";

function createTestWatchdog(opts: {
  rooms: WatchdogRoomState[];
  nowMs?: number;
  drawIntervalMs?: number;
  stuckThresholdMultiplier?: number;
  schedulerLock?: DrawSchedulerLock;
}) {
  let nowMs = opts.nowMs ?? 10_000;
  const stuckAlerts: Array<{ room: string; elapsed: number }> = [];

  const watchdog = new DrawWatchdog({
    checkIntervalMs: 100_000, // won't auto-tick in tests
    drawIntervalMs: opts.drawIntervalMs ?? 2_000,
    stuckThresholdMultiplier: opts.stuckThresholdMultiplier ?? 3,
    now: () => nowMs,
    getRoomStates: () => opts.rooms,
    onStuckRoom: (room, elapsed) => stuckAlerts.push({ room, elapsed }),
    schedulerLock: opts.schedulerLock,
  });

  return {
    watchdog,
    stuckAlerts,
    setNow: (ms: number) => { nowMs = ms; },
    setRooms: (rooms: WatchdogRoomState[]) => { opts.rooms = rooms; },
  };
}

describe("DrawWatchdog", () => {
  it("does not flag healthy rooms", () => {
    const { watchdog, stuckAlerts } = createTestWatchdog({
      nowMs: 10_000,
      rooms: [
        { roomCode: "ROOM1", gameStatus: "RUNNING", lastDrawAt: 9_000 },
        { roomCode: "ROOM2", gameStatus: "RUNNING", lastDrawAt: 8_500 },
      ],
    });

    watchdog.check();

    assert.deepEqual(stuckAlerts, []);
    assert.deepEqual(watchdog.metrics.currentStuckRoomCodes, []);
    assert.equal(watchdog.metrics.checkCount, 1);
    assert.equal(watchdog.metrics.stuckDetectionCount, 0);
  });

  it("flags a room where last draw exceeds threshold", () => {
    // Threshold = 2000 * 3 = 6000ms.
    // Room last drew 8 seconds ago → stuck.
    const { watchdog, stuckAlerts } = createTestWatchdog({
      nowMs: 18_000,
      rooms: [
        { roomCode: "STUCK", gameStatus: "RUNNING", lastDrawAt: 10_000 },
        { roomCode: "OK", gameStatus: "RUNNING", lastDrawAt: 17_000 },
      ],
    });

    watchdog.check();

    assert.equal(stuckAlerts.length, 1);
    assert.equal(stuckAlerts[0]!.room, "STUCK");
    assert.equal(stuckAlerts[0]!.elapsed, 8_000);
    assert.deepEqual(watchdog.metrics.currentStuckRoomCodes, ["STUCK"]);
    assert.equal(watchdog.metrics.stuckDetectionCount, 1);
  });

  it("ignores rooms that are not RUNNING", () => {
    const { watchdog, stuckAlerts } = createTestWatchdog({
      nowMs: 100_000,
      rooms: [
        { roomCode: "WAITING", gameStatus: "WAITING", lastDrawAt: 1_000 },
        { roomCode: "ENDED", gameStatus: "ENDED", lastDrawAt: 2_000 },
      ],
    });

    watchdog.check();

    assert.deepEqual(stuckAlerts, []);
    assert.deepEqual(watchdog.metrics.currentStuckRoomCodes, []);
  });

  it("ignores rooms with no lastDrawAt (round just started)", () => {
    const { watchdog, stuckAlerts } = createTestWatchdog({
      nowMs: 50_000,
      rooms: [
        { roomCode: "NEW", gameStatus: "RUNNING", lastDrawAt: undefined },
      ],
    });

    watchdog.check();

    assert.deepEqual(stuckAlerts, []);
  });

  it("updates stuck list on each check (clears when recovered)", () => {
    const rooms: WatchdogRoomState[] = [
      { roomCode: "ROOM1", gameStatus: "RUNNING", lastDrawAt: 1_000 },
    ];
    const { watchdog, stuckAlerts, setNow } = createTestWatchdog({
      nowMs: 10_000,
      rooms,
    });

    // First check: stuck (10000 - 1000 = 9000 > 6000).
    watchdog.check();
    assert.deepEqual(watchdog.metrics.currentStuckRoomCodes, ["ROOM1"]);
    assert.equal(stuckAlerts.length, 1);

    // Simulate recovery: room drew recently.
    rooms[0]!.lastDrawAt = 11_000;
    setNow(12_000);
    watchdog.check();

    assert.deepEqual(watchdog.metrics.currentStuckRoomCodes, []);
    // stuckDetectionCount is cumulative — still 1.
    assert.equal(watchdog.metrics.stuckDetectionCount, 1);
  });

  it("force-releases scheduler lock for stuck rooms", () => {
    const lock = new DrawSchedulerLock();
    lock.tryAcquire("STUCK");

    assert.equal(lock.isLocked("STUCK"), true);

    const { watchdog } = createTestWatchdog({
      nowMs: 20_000,
      rooms: [
        { roomCode: "STUCK", gameStatus: "RUNNING", lastDrawAt: 5_000 },
      ],
      schedulerLock: lock,
    });

    watchdog.check();

    // Lock should have been force-released.
    assert.equal(lock.isLocked("STUCK"), false);
  });

  it("does not touch scheduler lock for non-stuck rooms", () => {
    const lock = new DrawSchedulerLock();
    lock.tryAcquire("HEALTHY");

    const { watchdog } = createTestWatchdog({
      nowMs: 10_000,
      rooms: [
        { roomCode: "HEALTHY", gameStatus: "RUNNING", lastDrawAt: 9_500 },
      ],
      schedulerLock: lock,
    });

    watchdog.check();

    // Lock should still be held.
    assert.equal(lock.isLocked("HEALTHY"), true);
    lock.release("HEALTHY");
  });

  it("respects custom threshold multiplier", () => {
    // 2000 * 5 = 10000ms threshold.
    const { watchdog, stuckAlerts } = createTestWatchdog({
      nowMs: 17_000,
      stuckThresholdMultiplier: 5,
      rooms: [
        { roomCode: "R1", gameStatus: "RUNNING", lastDrawAt: 10_000 }, // 7s < 10s → OK
      ],
    });

    watchdog.check();
    assert.deepEqual(stuckAlerts, []);

    // Not stuck at 7s, but stuck at 11s.
    const { watchdog: w2, stuckAlerts: a2 } = createTestWatchdog({
      nowMs: 21_000,
      stuckThresholdMultiplier: 5,
      rooms: [
        { roomCode: "R1", gameStatus: "RUNNING", lastDrawAt: 10_000 }, // 11s > 10s → stuck
      ],
    });

    w2.check();
    assert.equal(a2.length, 1);
  });

  it("detects multiple stuck rooms in a single check", () => {
    const { watchdog, stuckAlerts } = createTestWatchdog({
      nowMs: 30_000,
      rooms: [
        { roomCode: "A", gameStatus: "RUNNING", lastDrawAt: 10_000 }, // 20s → stuck
        { roomCode: "B", gameStatus: "RUNNING", lastDrawAt: 5_000 },  // 25s → stuck
        { roomCode: "C", gameStatus: "RUNNING", lastDrawAt: 29_000 }, // 1s → OK
      ],
    });

    watchdog.check();

    assert.equal(stuckAlerts.length, 2);
    assert.deepEqual(
      stuckAlerts.map((a) => a.room).sort(),
      ["A", "B"],
    );
    assert.deepEqual(
      watchdog.metrics.currentStuckRoomCodes.sort(),
      ["A", "B"],
    );
  });

  it("tracks metrics across multiple checks", () => {
    const rooms: WatchdogRoomState[] = [
      { roomCode: "R1", gameStatus: "RUNNING", lastDrawAt: 1_000 },
    ];
    const { watchdog, setNow } = createTestWatchdog({
      nowMs: 10_000,
      rooms,
    });

    watchdog.check(); // check 1: stuck
    setNow(20_000);
    watchdog.check(); // check 2: still stuck (new detection)
    rooms[0]!.lastDrawAt = 19_500;
    setNow(21_000);
    watchdog.check(); // check 3: recovered

    assert.equal(watchdog.metrics.checkCount, 3);
    assert.equal(watchdog.metrics.stuckDetectionCount, 2);
    assert.equal(watchdog.metrics.lastCheckAt, 21_000);
    assert.deepEqual(watchdog.metrics.currentStuckRoomCodes, []);
  });

  it("start/stop lifecycle is idempotent", () => {
    const { watchdog } = createTestWatchdog({
      rooms: [],
    });

    assert.equal(watchdog.isRunning, false);

    watchdog.start();
    assert.equal(watchdog.isRunning, true);

    watchdog.start(); // second call is no-op
    assert.equal(watchdog.isRunning, true);

    watchdog.stop();
    assert.equal(watchdog.isRunning, false);

    watchdog.stop(); // second stop is no-op
    assert.equal(watchdog.isRunning, false);
  });
});
