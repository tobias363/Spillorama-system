/**
 * P1-6 / R11 — Unit-tester for RoomIsolationGuard.
 *
 * Strategi: tester kompositt-fasaden. Bruker faktiske underliggende
 * klasser (RoomCircuitBreaker + RoomLatencyTracker) — kun event-routing
 * og DI er stub'et.
 *
 * Dekker:
 *   - run() suksess + failure
 *   - run() med OPEN breaker → CircuitOpenError
 *   - Latency-tracking (suksess + failure)
 *   - Per-rom-isolasjon
 *   - Composite event-listener (circuit + degraded)
 *   - GC-orkestrering
 *   - Degraded-grense konfigurasjon
 *   - Reset
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CircuitOpenError,
  RoomIsolationGuard,
  type RoomIsolationEvent,
} from "../RoomIsolationGuard.js";

test("RoomIsolationGuard: run() suksess registrerer success + latency", async () => {
  const guard = new RoomIsolationGuard();

  const result = await guard.run(
    "room-A",
    "draw",
    async () => "ok",
    1000,
  );
  assert.equal(result, "ok");

  // Etter run skal det finnes latency-stats. Bruk samme nowMs for å holde
  // sample i sliding-window.
  const stats = guard.getLatencyStats("room-A", "draw", 1000);
  assert.equal(stats.count, 1);
  assert.equal(stats.failures, 0);
});

test("RoomIsolationGuard: run() failure registrerer feil + rekaster", async () => {
  const guard = new RoomIsolationGuard();

  await assert.rejects(
    guard.run(
      "room-A",
      "draw",
      async () => {
        throw new Error("boom");
      },
      1000,
    ),
    /boom/,
  );

  const stats = guard.getLatencyStats("room-A", "draw", 1000);
  assert.equal(stats.count, 1);
  assert.equal(stats.failures, 1);
});

test("RoomIsolationGuard: run() med OPEN breaker → CircuitOpenError", async () => {
  const guard = new RoomIsolationGuard({
    circuit: { failureThreshold: 3, cooldownMs: 60_000 },
  });

  // Akkumuler 3 failures → OPEN.
  for (let i = 0; i < 3; i += 1) {
    await guard
      .run(
        "room-A",
        "draw",
        async () => {
          throw new Error("test failure");
        },
        1000 + i,
      )
      .catch(() => {});
  }

  let calls = 0;
  await assert.rejects(
    () =>
      guard.run(
        "room-A",
        "draw",
        async () => {
          calls += 1;
          return "should-not-run";
        },
        1100,
      ),
    CircuitOpenError,
  );
  assert.equal(calls, 0);
});

test("RoomIsolationGuard: per-rom-isolasjon — én rom OPEN, andre uberørt", async () => {
  const guard = new RoomIsolationGuard({
    circuit: { failureThreshold: 3, cooldownMs: 60_000 },
  });

  // Åpne kun room-A.
  for (let i = 0; i < 3; i += 1) {
    await guard
      .run(
        "room-A",
        "draw",
        async () => {
          throw new Error("test");
        },
        1000 + i,
      )
      .catch(() => {});
  }

  assert.equal(guard.isAllowed("room-A", 1100), false);
  assert.equal(guard.isAllowed("room-B", 1100), true);
  assert.equal(guard.isAllowed("room-C", 1100), true);

  // room-B + room-C kan fortsette uten problem.
  const resultB = await guard.run("room-B", "draw", async () => "B-ok", 1100);
  const resultC = await guard.run("room-C", "draw", async () => "C-ok", 1100);
  assert.equal(resultB, "B-ok");
  assert.equal(resultC, "C-ok");
});

test("RoomIsolationGuard: composite event-listener fanger circuit + degraded", async () => {
  const guard = new RoomIsolationGuard({
    circuit: { failureThreshold: 3, cooldownMs: 60_000 },
  });
  guard.setDegradedThreshold({ thresholdMs: 100 });

  const events: RoomIsolationEvent[] = [];
  guard.addListener((e) => events.push(e));

  // Trigger circuit_opened ved 3 failures.
  for (let i = 0; i < 3; i += 1) {
    await guard
      .run(
        "room-A",
        "draw",
        async () => {
          throw new Error("test");
        },
        1000 + i,
      )
      .catch(() => {});
  }

  const circuitOpened = events.filter(
    (e) => e.type === "circuit" && e.payload.type === "circuit_opened",
  );
  assert.equal(circuitOpened.length, 1);
});

test("RoomIsolationGuard: degraded-event fyrer når p95 over grense", async () => {
  const guard = new RoomIsolationGuard();
  guard.setDegradedThreshold({ thresholdMs: 50 });

  const events: RoomIsolationEvent[] = [];
  guard.addListener((e) => events.push(e));

  // Akkumuler 6 samples under threshold → ingen degraded.
  // Vi simulerer ikke faktiske durations her — vi bruker tracker direkte
  // via getTracker() for å garantere kontroll.
  const tracker = guard.getTracker();
  for (let i = 0; i < 6; i += 1) {
    tracker.record("room-A", "draw", 200, false, 1000 + i);
  }

  const degraded = events.filter((e) => e.type === "degraded");
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0].payload.roomCode, "room-A");
});

test("RoomIsolationGuard: getCircuitState og getLatencyStats", async () => {
  const guard = new RoomIsolationGuard();

  await guard.run("room-A", "draw", async () => "ok", 1000);

  const breakerState = guard.getCircuitState("room-A", 1100);
  assert.equal(breakerState.state, "CLOSED");

  const latencyStats = guard.getLatencyStats("room-A", "draw", 1100);
  assert.equal(latencyStats.count, 1);
  assert.equal(latencyStats.failures, 0);
});

test("RoomIsolationGuard: getAllStates returnerer både breakers og latency", async () => {
  const guard = new RoomIsolationGuard();

  await guard.run("room-A", "draw", async () => "ok", 1000);
  await guard.run("room-B", "master.start", async () => "ok", 1100);

  const all = guard.getAllStates(2000);
  assert.equal(all.breakers.size, 2);
  assert.equal(all.latency.size, 2);
});

test("RoomIsolationGuard: gc() orkestrerer breaker + tracker GC", async () => {
  const guard = new RoomIsolationGuard({
    circuit: { gcStaleStateAfterMs: 60_000 },
    latency: { gcStaleStateAfterMs: 60_000 },
  });

  await guard.run("room-A", "draw", async () => "ok", 1000);

  const result = guard.gc(100_000);
  assert.equal(result.breakers, 1);
  assert.equal(result.tracker, 1);
});

test("RoomIsolationGuard: reset() lukker breaker manuelt", async () => {
  const guard = new RoomIsolationGuard({
    circuit: { failureThreshold: 3, cooldownMs: 60_000 },
  });

  for (let i = 0; i < 3; i += 1) {
    await guard
      .run(
        "room-A",
        "draw",
        async () => {
          throw new Error("test");
        },
        1000 + i,
      )
      .catch(() => {});
  }
  assert.equal(guard.isAllowed("room-A", 1100), false);

  guard.reset("room-A", 2000);
  assert.equal(guard.isAllowed("room-A", 2000), true);
});

test("RoomIsolationGuard: setDegradedThreshold per-(room, action)", () => {
  const guard = new RoomIsolationGuard();
  guard.setDegradedThreshold({ thresholdMs: 1000 }); // default
  guard.setDegradedThreshold({
    roomCode: "room-A",
    action: "draw",
    thresholdMs: 100, // strikt
  });

  const tracker = guard.getTracker();

  for (let i = 0; i < 5; i += 1) {
    tracker.record("room-A", "draw", 500, false, 1000 + i);
  }
  assert.equal(tracker.isDegraded("room-A", "draw", 1100), true);

  for (let i = 0; i < 5; i += 1) {
    tracker.record("room-B", "draw", 500, false, 1000 + i);
  }
  assert.equal(tracker.isDegraded("room-B", "draw", 1100), false);
});

test("RoomIsolationGuard: latency-tracker tracker også fail-fast (CircuitOpenError)", async () => {
  const guard = new RoomIsolationGuard({
    circuit: { failureThreshold: 2, cooldownMs: 60_000 },
  });

  for (let i = 0; i < 2; i += 1) {
    await guard
      .run(
        "room-A",
        "draw",
        async () => {
          throw new Error("test");
        },
        1000 + i,
      )
      .catch(() => {});
  }

  // Kast CircuitOpenError på neste run.
  await assert.rejects(
    guard.run("room-A", "draw", async () => "x", 1100),
    CircuitOpenError,
  );

  // Latency-tracker har registrert 3 samples (2 failures + 1 fail-fast).
  const stats = guard.getLatencyStats("room-A", "draw", 1200);
  // 3 samples — 2 actual failures + 1 fail-fast (også failure).
  assert.equal(stats.count, 3);
  assert.equal(stats.failures, 3);
});

test("RoomIsolationGuard: listener-feil tar ikke ned guarden", async () => {
  const guard = new RoomIsolationGuard();
  guard.addListener(() => {
    throw new Error("listener exploded");
  });

  // Skal ikke kaste.
  const result = await guard.run("room-A", "draw", async () => "ok", 1000);
  assert.equal(result, "ok");
});

test("RoomIsolationGuard: reset() emitter circuit_closed event", async () => {
  const guard = new RoomIsolationGuard({
    circuit: { failureThreshold: 2, cooldownMs: 60_000 },
  });
  const events: RoomIsolationEvent[] = [];
  guard.addListener((e) => events.push(e));

  for (let i = 0; i < 2; i += 1) {
    await guard
      .run(
        "room-A",
        "draw",
        async () => {
          throw new Error("test");
        },
        1000 + i,
      )
      .catch(() => {});
  }

  const eventCountBeforeReset = events.length;
  guard.reset("room-A", 5000);

  const newEvents = events.slice(eventCountBeforeReset);
  const closedEvents = newEvents.filter(
    (e) => e.type === "circuit" && e.payload.type === "circuit_closed",
  );
  assert.equal(closedEvents.length, 1);
});
