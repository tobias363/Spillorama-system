/**
 * P1-6 / R11 — Unit-tester for RoomLatencyTracker.
 *
 * Strategi: pure data-tracker, klokken injiseres for deterministiske
 * tester. Ingen DB, ingen async.
 *
 * Dekker:
 *   - record() + getStats() — basic flow
 *   - p50/p95/p99-beregning (NIST linear interpolation)
 *   - Sliding-window — eldre samples filtreres
 *   - Per-(room, action)-partisjonering
 *   - Bounded buffer (maxSamplesPerKey)
 *   - GC av stale state
 *   - Degraded-event på CLOSED → DEGRADED
 *   - Per-room-action-threshold-override
 *   - Failure-tracking
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  RoomLatencyTracker,
  type DegradedEvent,
} from "../RoomLatencyTracker.js";

test("RoomLatencyTracker: record + getStats — basic", () => {
  const tracker = new RoomLatencyTracker();

  tracker.record("room-A", "draw", 100, false, 1000);
  tracker.record("room-A", "draw", 200, false, 1100);
  tracker.record("room-A", "draw", 300, false, 1200);

  const stats = tracker.getStats("room-A", "draw", 1300);
  assert.equal(stats.count, 3);
  assert.equal(stats.failures, 0);
  assert.equal(stats.minMs, 100);
  assert.equal(stats.maxMs, 300);
  assert.equal(stats.meanMs, 200);
});

test("RoomLatencyTracker: p50/p95/p99 — NIST linear interpolation", () => {
  const tracker = new RoomLatencyTracker();

  // Samples: 100, 200, 300, ..., 1000 (10 stk)
  for (let i = 1; i <= 10; i += 1) {
    tracker.record("room-A", "draw", i * 100, false, 1000 + i);
  }

  const stats = tracker.getStats("room-A", "draw", 1100);
  assert.equal(stats.count, 10);

  // Sortert: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
  // p50 = rank 4.5 → 500*0.5 + 600*0.5 = 550
  // p95 = rank 8.55 → 900*0.45 + 1000*0.55 = 955
  // p99 = rank 8.91 → 900*0.09 + 1000*0.91 = 991
  assert.equal(stats.p50Ms, 550);
  assert.equal(stats.p95Ms, 955);
  assert.equal(stats.p99Ms, 991);
});

test("RoomLatencyTracker: sliding-window filter — gamle samples droppes", () => {
  const tracker = new RoomLatencyTracker({ windowMs: 60_000 });

  // Sample i 1000 → ikke i window ved 100_000.
  tracker.record("room-A", "draw", 50, false, 1000);
  tracker.record("room-A", "draw", 100, false, 50_000);
  tracker.record("room-A", "draw", 200, false, 95_000);

  const stats = tracker.getStats("room-A", "draw", 100_000);
  // Window = [40_000, 100_000]. 1000 og 50_000 er utenfor.
  // 50_000 er utenfor (cutoff = 100_000-60_000 = 40_000, 50_000 >= 40_000 = inni)
  // Faktisk: 1000 < 40_000 → out. 50_000 >= 40_000 → in. 95_000 >= 40_000 → in.
  assert.equal(stats.count, 2);
  assert.equal(stats.minMs, 100);
  assert.equal(stats.maxMs, 200);
});

test("RoomLatencyTracker: per-(room, action)-partisjonering", () => {
  const tracker = new RoomLatencyTracker();

  tracker.record("room-A", "draw", 100, false, 1000);
  tracker.record("room-A", "draw", 200, false, 1100);
  tracker.record("room-A", "master.start", 5000, false, 1200);
  tracker.record("room-B", "draw", 50, false, 1300);

  assert.equal(tracker.getStats("room-A", "draw", 2000).count, 2);
  assert.equal(tracker.getStats("room-A", "master.start", 2000).count, 1);
  assert.equal(tracker.getStats("room-B", "draw", 2000).count, 1);
  assert.equal(tracker.getStats("room-B", "master.start", 2000).count, 0);
});

test("RoomLatencyTracker: bounded buffer (maxSamplesPerKey)", () => {
  const tracker = new RoomLatencyTracker({ maxSamplesPerKey: 5 });

  // Push 10 samples — eldste 5 skal droppes.
  for (let i = 0; i < 10; i += 1) {
    tracker.record("room-A", "draw", i * 100, false, 1000 + i);
  }

  const stats = tracker.getStats("room-A", "draw", 2000);
  assert.equal(stats.count, 5);
  // De siste 5: 500, 600, 700, 800, 900
  assert.equal(stats.minMs, 500);
  assert.equal(stats.maxMs, 900);
});

test("RoomLatencyTracker: failure-tracking", () => {
  const tracker = new RoomLatencyTracker();

  tracker.record("room-A", "draw", 100, false, 1000);
  tracker.record("room-A", "draw", 200, true, 1100);
  tracker.record("room-A", "draw", 300, true, 1200);
  tracker.record("room-A", "draw", 400, false, 1300);

  const stats = tracker.getStats("room-A", "draw", 2000);
  assert.equal(stats.count, 4);
  assert.equal(stats.failures, 2);
});

test("RoomLatencyTracker: tomt resultat for ukjente keys", () => {
  const tracker = new RoomLatencyTracker();
  const stats = tracker.getStats("never-seen", "never-action", 1000);
  assert.equal(stats.count, 0);
  assert.equal(stats.p50Ms, null);
  assert.equal(stats.p95Ms, null);
  assert.equal(stats.minMs, null);
});

test("RoomLatencyTracker: gc() dropper stale state", () => {
  const tracker = new RoomLatencyTracker({ gcStaleStateAfterMs: 60_000 });

  tracker.record("room-A", "draw", 100, false, 1000);
  tracker.record("room-B", "draw", 100, false, 90_000);

  // GC ved 100_000 — room-A er stale (lastTouch=1000, 100_000-1000 > 60_000)
  const dropped = tracker.gc(100_000);
  assert.equal(dropped, 1);
  assert.equal(tracker.size(), 1);
});

test("RoomLatencyTracker: degraded-event på CLOSED → DEGRADED", () => {
  const tracker = new RoomLatencyTracker();
  tracker.setDegradedThresholdDefault(1000);

  const events: DegradedEvent[] = [];
  tracker.addDegradedListener((e) => events.push(e));

  // Akkumuler < 5 samples → ingen alert (for få samples).
  for (let i = 0; i < 4; i += 1) {
    tracker.record("room-A", "draw", 5000, false, 1000 + i);
  }
  assert.equal(events.length, 0);

  // 5+ samples → degraded fyrer.
  tracker.record("room-A", "draw", 5000, false, 1004);
  assert.equal(events.length, 1);
  assert.equal(events[0].roomCode, "room-A");
  assert.equal(events[0].action, "draw");
  assert.ok(events[0].p95Ms > 1000);
});

test("RoomLatencyTracker: degraded-event fyrer ikke ved DEGRADED → DEGRADED", () => {
  const tracker = new RoomLatencyTracker();
  tracker.setDegradedThresholdDefault(1000);
  const events: DegradedEvent[] = [];
  tracker.addDegradedListener((e) => events.push(e));

  // 5 samples > threshold.
  for (let i = 0; i < 5; i += 1) {
    tracker.record("room-A", "draw", 5000, false, 1000 + i);
  }
  assert.equal(events.length, 1);

  // Mer treigt → ingen ny alert.
  for (let i = 0; i < 5; i += 1) {
    tracker.record("room-A", "draw", 6000, false, 1100 + i);
  }
  assert.equal(events.length, 1); // Fortsatt 1.
});

test("RoomLatencyTracker: per-(room, action)-threshold override", () => {
  const tracker = new RoomLatencyTracker();
  tracker.setDegradedThresholdDefault(10_000); // høy default
  tracker.setDegradedThreshold("room-A", "draw", 100); // strikt for room-A

  const events: DegradedEvent[] = [];
  tracker.addDegradedListener((e) => events.push(e));

  // 500ms i room-A — over 100ms-threshold → degraded.
  for (let i = 0; i < 5; i += 1) {
    tracker.record("room-A", "draw", 500, false, 1000 + i);
  }
  assert.equal(events.length, 1);

  // Samme verdier i room-B — under default 10_000ms → ikke degraded.
  for (let i = 0; i < 5; i += 1) {
    tracker.record("room-B", "draw", 500, false, 1000 + i);
  }
  assert.equal(events.length, 1); // fortsatt kun room-A.
});

test("RoomLatencyTracker: isDegraded() returnerer korrekt state", () => {
  const tracker = new RoomLatencyTracker();
  tracker.setDegradedThresholdDefault(1000);

  // Friskt rom.
  for (let i = 0; i < 10; i += 1) {
    tracker.record("room-A", "draw", 500, false, 1000 + i);
  }
  assert.equal(tracker.isDegraded("room-A", "draw", 2000), false);

  // Treigt rom.
  for (let i = 0; i < 10; i += 1) {
    tracker.record("room-B", "draw", 5000, false, 1000 + i);
  }
  assert.equal(tracker.isDegraded("room-B", "draw", 2000), true);
});

test("RoomLatencyTracker: getAllStats returnerer alle (room, action)-keys", () => {
  const tracker = new RoomLatencyTracker();
  tracker.record("room-A", "draw", 100, false, 1000);
  tracker.record("room-A", "master.start", 200, false, 1000);
  tracker.record("room-B", "draw", 100, false, 1000);

  const all = tracker.getAllStats(2000);
  assert.equal(all.size, 3);
});

test("RoomLatencyTracker: totalSampleCount sum over alle keys", () => {
  const tracker = new RoomLatencyTracker();
  for (let i = 0; i < 10; i += 1) tracker.record("room-A", "draw", 100, false, 1000 + i);
  for (let i = 0; i < 5; i += 1) tracker.record("room-B", "draw", 100, false, 1000 + i);

  assert.equal(tracker.totalSampleCount(), 15);
});

test("RoomLatencyTracker: invalid config kaster", () => {
  assert.throws(() => new RoomLatencyTracker({ windowMs: 0 }));
  assert.throws(() => new RoomLatencyTracker({ maxSamplesPerKey: 0 }));
});

test("RoomLatencyTracker: setDegradedThreshold validation", () => {
  const tracker = new RoomLatencyTracker();
  assert.throws(() => tracker.setDegradedThresholdDefault(0));
  assert.throws(() => tracker.setDegradedThresholdDefault(-1));
  assert.throws(() => tracker.setDegradedThreshold("room-A", "draw", 0));
});

test("RoomLatencyTracker: percentile på single sample", () => {
  const tracker = new RoomLatencyTracker();
  tracker.record("room-A", "draw", 500, false, 1000);

  const stats = tracker.getStats("room-A", "draw", 2000);
  assert.equal(stats.count, 1);
  assert.equal(stats.p50Ms, 500);
  assert.equal(stats.p95Ms, 500);
  assert.equal(stats.p99Ms, 500);
});

test("RoomLatencyTracker: listener-feil tar ikke ned trackeren (fail-soft)", () => {
  const tracker = new RoomLatencyTracker();
  tracker.setDegradedThresholdDefault(1);
  tracker.addDegradedListener(() => {
    throw new Error("listener exploded");
  });

  // Skal ikke kaste.
  for (let i = 0; i < 10; i += 1) {
    tracker.record("room-A", "draw", 1000, false, 1000 + i);
  }

  assert.equal(tracker.isDegraded("room-A", "draw", 2000), true);
});

test("RoomLatencyTracker: meanMs er korrekt beregnet", () => {
  const tracker = new RoomLatencyTracker();
  tracker.record("room-A", "draw", 100, false, 1000);
  tracker.record("room-A", "draw", 200, false, 1010);
  tracker.record("room-A", "draw", 300, false, 1020);

  const stats = tracker.getStats("room-A", "draw", 2000);
  assert.equal(stats.meanMs, 200);
});

test("RoomLatencyTracker: gc() rydder også degraded-tracking", () => {
  const tracker = new RoomLatencyTracker({ gcStaleStateAfterMs: 1000 });
  tracker.setDegradedThresholdDefault(1);

  for (let i = 0; i < 10; i += 1) {
    tracker.record("room-A", "draw", 1000, false, 1000 + i);
  }
  assert.equal(tracker.isDegraded("room-A", "draw", 1100), true);

  // GC ved 100_000 — room-A er stale.
  const dropped = tracker.gc(100_000);
  assert.equal(dropped, 1);
  assert.equal(tracker.size(), 0);
});
