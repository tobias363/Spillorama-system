import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DrawSchedulerLock } from "../DrawSchedulerLock.js";

describe("DrawSchedulerLock", () => {
  it("acquires and releases a lock for a single room", async () => {
    const lock = new DrawSchedulerLock();
    let executed = false;

    const result = await lock.withLock("ROOM1", async () => {
      executed = true;
      return 42;
    });

    assert.equal(result, 42);
    assert.equal(executed, true);
    assert.equal(lock.isLocked("ROOM1"), false);
    assert.equal(lock.acquireCount, 1);
  });

  it("returns null when the lock is already held", async () => {
    const lock = new DrawSchedulerLock();

    // Acquire manually so we can test contention.
    assert.equal(lock.tryAcquire("ROOM1"), true);

    const result = await lock.withLock("ROOM1", async () => {
      return "should not run";
    });

    assert.equal(result, null);
    // Release manually.
    lock.release("ROOM1");
  });

  it("allows independent locks for different rooms", async () => {
    const lock = new DrawSchedulerLock();
    const results: string[] = [];

    assert.equal(lock.tryAcquire("ROOM1"), true);

    // ROOM2 should not be blocked by ROOM1.
    const result = await lock.withLock("ROOM2", async () => {
      results.push("ROOM2");
      return "ok";
    });

    assert.equal(result, "ok");
    assert.deepEqual(results, ["ROOM2"]);

    lock.release("ROOM1");
  });

  it("force-releases a timed-out lock and allows re-acquire", async () => {
    let nowMs = 1000;
    const timeouts: Array<{ room: string; elapsed: number }> = [];

    const lock = new DrawSchedulerLock({
      defaultTimeoutMs: 5_000,
      now: () => nowMs,
      onTimeout: (room, elapsed) => {
        timeouts.push({ room, elapsed });
      },
    });

    // Acquire at t=1000.
    assert.equal(lock.tryAcquire("ROOM1"), true);
    assert.equal(lock.isLocked("ROOM1"), true);

    // At t=3000 (2s later) — lock is still valid.
    nowMs = 3_000;
    assert.equal(lock.tryAcquire("ROOM1"), false);
    assert.equal(timeouts.length, 0);

    // At t=7000 (6s later, > 5s timeout) — lock should be force-released.
    nowMs = 7_000;
    assert.equal(lock.tryAcquire("ROOM1"), true);
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0]!.room, "ROOM1");
    assert.equal(timeouts[0]!.elapsed, 6_000);
    assert.equal(lock.timeoutCount, 1);

    lock.release("ROOM1");
  });

  it("force-releases via withLock when previous holder timed out", async () => {
    let nowMs = 0;
    const timeouts: string[] = [];

    const lock = new DrawSchedulerLock({
      defaultTimeoutMs: 3_000,
      now: () => nowMs,
      onTimeout: (room) => timeouts.push(room),
    });

    // Simulate a hung lock — acquired but never released.
    lock.tryAcquire("STUCK");

    // Advance past timeout.
    nowMs = 4_000;

    let innerRan = false;
    const result = await lock.withLock("STUCK", async () => {
      innerRan = true;
      return "recovered";
    });

    assert.equal(result, "recovered");
    assert.equal(innerRan, true);
    assert.deepEqual(timeouts, ["STUCK"]);
    assert.equal(lock.isLocked("STUCK"), false);
  });

  it("respects custom timeout per call", async () => {
    let nowMs = 0;

    const lock = new DrawSchedulerLock({
      defaultTimeoutMs: 10_000,
      now: () => nowMs,
    });

    lock.tryAcquire("ROOM1");
    nowMs = 2_000;

    // Default timeout (10s) — should still be locked.
    assert.equal(lock.tryAcquire("ROOM1"), false);

    // Custom timeout (1s) — should force-release.
    assert.equal(lock.tryAcquire("ROOM1", 1_000), true);

    lock.release("ROOM1");
  });

  it("cleans up locks for rooms that no longer exist", () => {
    const lock = new DrawSchedulerLock();

    lock.tryAcquire("ACTIVE");
    lock.tryAcquire("DEAD1");
    lock.tryAcquire("DEAD2");

    assert.equal(lock.heldLockCount, 3);

    lock.cleanup(new Set(["ACTIVE"]));

    assert.equal(lock.heldLockCount, 1);
    assert.equal(lock.isLocked("ACTIVE"), true);
    assert.equal(lock.isLocked("DEAD1"), false);
    assert.equal(lock.isLocked("DEAD2"), false);

    lock.release("ACTIVE");
  });

  it("releaseAll clears every held lock", () => {
    const lock = new DrawSchedulerLock();

    lock.tryAcquire("R1");
    lock.tryAcquire("R2");
    lock.tryAcquire("R3");

    assert.equal(lock.heldLockCount, 3);

    lock.releaseAll();

    assert.equal(lock.heldLockCount, 0);
    assert.equal(lock.isLocked("R1"), false);
  });

  it("tracks acquire and timeout metrics correctly", async () => {
    let nowMs = 0;
    const lock = new DrawSchedulerLock({
      defaultTimeoutMs: 100,
      now: () => nowMs,
    });

    assert.equal(lock.acquireCount, 0);
    assert.equal(lock.timeoutCount, 0);

    // 3 normal acquires.
    await lock.withLock("R1", async () => {});
    await lock.withLock("R2", async () => {});
    await lock.withLock("R3", async () => {});

    assert.equal(lock.acquireCount, 3);
    assert.equal(lock.timeoutCount, 0);

    // 1 acquire that will timeout.
    lock.tryAcquire("STUCK");
    nowMs = 200;
    lock.tryAcquire("STUCK"); // force-release + re-acquire

    assert.equal(lock.acquireCount, 5); // 3 + original STUCK + re-acquire
    assert.equal(lock.timeoutCount, 1);

    lock.release("STUCK");
  });

  it("handles work that throws — lock is still released", async () => {
    const lock = new DrawSchedulerLock();

    await assert.rejects(
      async () => {
        await lock.withLock("ROOM1", async () => {
          throw new Error("boom");
        });
      },
      { message: "boom" },
    );

    // Lock must be released even though work threw.
    assert.equal(lock.isLocked("ROOM1"), false);
    assert.equal(lock.acquireCount, 1);
  });
});
