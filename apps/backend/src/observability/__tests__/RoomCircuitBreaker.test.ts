/**
 * P1-6 / R11 — Unit-tester for RoomCircuitBreaker.
 *
 * Strategi: pure state-machine, klokken injiseres slik at testene er
 * deterministiske. Ingen DB, ingen async I/O, ingen ekte timers.
 *
 * Dekker:
 *   - State-machine: CLOSED → OPEN → HALF_OPEN → CLOSED
 *   - Threshold-trigger (5 failures innen 60s)
 *   - Window-reset (failures > 60s gamle resettes)
 *   - Cooldown-respektering (HALF_OPEN først etter cooldownMs)
 *   - HALF_OPEN failure → tilbake til OPEN
 *   - **Per-rom-isolasjon:** én rom OPEN → andre rom forblir CLOSED
 *   - Manuell reset
 *   - GC av stale state
 *   - Event-emitting (CircuitOpenError + listener-events)
 *   - guard() med async fn (success + failure paths)
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CircuitOpenError,
  RoomCircuitBreaker,
  type CircuitBreakerEvent,
} from "../RoomCircuitBreaker.js";

test("RoomCircuitBreaker: starter i CLOSED state", () => {
  const breaker = new RoomCircuitBreaker();
  const snap = breaker.getStateSnapshot("room-A", 1000);
  assert.equal(snap.state, "CLOSED");
  assert.equal(snap.consecutiveFailures, 0);
  assert.equal(snap.openedAtMs, null);
});

test("RoomCircuitBreaker: 5 sammenhengende failures → OPEN", () => {
  const breaker = new RoomCircuitBreaker({
    failureThreshold: 5,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
  });
  const events: CircuitBreakerEvent[] = [];
  breaker.addListener((e) => events.push(e));

  // 4 failures — fortsatt CLOSED.
  for (let i = 0; i < 4; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i * 1000);
    assert.equal(breaker.getStateSnapshot("room-A", 1000 + i * 1000).state, "CLOSED");
  }

  // 5. failure → OPEN.
  breaker.recordFailure("room-A", "draw failed", 5000);
  const snap = breaker.getStateSnapshot("room-A", 5000);
  assert.equal(snap.state, "OPEN");
  assert.equal(snap.consecutiveFailures, 5);
  assert.equal(snap.openedAtMs, 5000);
  assert.equal(snap.totalOpens, 1);

  // Sjekk at vi fikk circuit_opened event.
  const openedEvents = events.filter((e) => e.type === "circuit_opened");
  assert.equal(openedEvents.length, 1);
  assert.equal(openedEvents[0].roomCode, "room-A");
  assert.equal(openedEvents[0].consecutiveFailures, 5);
});

test("RoomCircuitBreaker: failures utenfor window resettes", () => {
  const breaker = new RoomCircuitBreaker({
    failureThreshold: 5,
    failureWindowMs: 60_000,
  });

  // 3 failures i timestamp 1000..3000.
  breaker.recordFailure("room-A", "test", 1000);
  breaker.recordFailure("room-A", "test", 2000);
  breaker.recordFailure("room-A", "test", 3000);
  assert.equal(breaker.getStateSnapshot("room-A", 3000).consecutiveFailures, 3);

  // 4. failure 70 sekunder senere — window har resatt.
  breaker.recordFailure("room-A", "test", 73_000);
  assert.equal(breaker.getStateSnapshot("room-A", 73_000).consecutiveFailures, 1);
  assert.equal(breaker.getStateSnapshot("room-A", 73_000).state, "CLOSED");
});

test("RoomCircuitBreaker: success resetter telleren i CLOSED", () => {
  const breaker = new RoomCircuitBreaker({ failureThreshold: 5 });

  for (let i = 0; i < 4; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i * 100);
  }
  assert.equal(breaker.getStateSnapshot("room-A", 1400).consecutiveFailures, 4);

  breaker.recordSuccess("room-A", 1500);
  assert.equal(breaker.getStateSnapshot("room-A", 1500).consecutiveFailures, 0);
  assert.equal(breaker.getStateSnapshot("room-A", 1500).state, "CLOSED");
});

test("RoomCircuitBreaker: cooldown — OPEN → HALF_OPEN etter cooldownMs", () => {
  const breaker = new RoomCircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 30_000,
  });

  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i * 100);
  }
  assert.equal(breaker.getStateSnapshot("room-A", 1300).state, "OPEN");

  // Litt senere — fortsatt OPEN.
  assert.equal(breaker.getStateSnapshot("room-A", 20_000).state, "OPEN");

  // Etter cooldown — HALF_OPEN.
  const snap = breaker.getStateSnapshot("room-A", 31_500);
  assert.equal(snap.state, "HALF_OPEN");
});

test("RoomCircuitBreaker: HALF_OPEN success → CLOSED", () => {
  const breaker = new RoomCircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 30_000,
    successThresholdHalfOpen: 1,
  });
  const events: CircuitBreakerEvent[] = [];
  breaker.addListener((e) => events.push(e));

  // Åpne breakeren.
  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i * 100);
  }

  // Trigge HALF_OPEN.
  assert.equal(breaker.getStateSnapshot("room-A", 31_500).state, "HALF_OPEN");

  // Probe success → CLOSED.
  breaker.recordSuccess("room-A", 32_000);
  const snap = breaker.getStateSnapshot("room-A", 32_500);
  assert.equal(snap.state, "CLOSED");
  assert.equal(snap.consecutiveFailures, 0);
  assert.equal(snap.openedAtMs, null);

  const closedEvents = events.filter((e) => e.type === "circuit_closed");
  assert.equal(closedEvents.length, 1);
});

test("RoomCircuitBreaker: HALF_OPEN failure → tilbake til OPEN", () => {
  const breaker = new RoomCircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  const events: CircuitBreakerEvent[] = [];
  breaker.addListener((e) => events.push(e));

  // Åpne breakeren.
  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i * 100);
  }

  // Trigger HALF_OPEN.
  breaker.getStateSnapshot("room-A", 31_500);

  // Probe fail → tilbake til OPEN.
  breaker.recordFailure("room-A", "still broken", 32_000);
  const snap = breaker.getStateSnapshot("room-A", 32_000);
  assert.equal(snap.state, "OPEN");
  assert.equal(snap.openedAtMs, 32_000);
  assert.equal(snap.totalOpens, 2); // En til open-transition.

  const openedEvents = events.filter((e) => e.type === "circuit_opened");
  assert.equal(openedEvents.length, 2);
  assert.match(openedEvents[1].reason, /HALF_OPEN probe failed/);
});

test("RoomCircuitBreaker: per-rom-isolasjon — én rom OPEN, andre forblir CLOSED", () => {
  const breaker = new RoomCircuitBreaker({ failureThreshold: 3 });

  // Åpne kun room-A.
  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i * 100);
  }

  // room-B og room-C er IKKE påvirket.
  for (let i = 0; i < 2; i += 1) {
    breaker.recordFailure("room-B", "test", 1000 + i * 100);
    breaker.recordSuccess("room-C", 1000 + i * 100);
  }

  assert.equal(breaker.getStateSnapshot("room-A", 1500).state, "OPEN");
  assert.equal(breaker.getStateSnapshot("room-B", 1500).state, "CLOSED");
  assert.equal(breaker.getStateSnapshot("room-C", 1500).state, "CLOSED");
  assert.equal(breaker.getStateSnapshot("room-B", 1500).consecutiveFailures, 2);
});

test("RoomCircuitBreaker: guard() kjører fn når CLOSED", async () => {
  const breaker = new RoomCircuitBreaker();
  let calls = 0;
  const result = await breaker.guard("room-A", async () => {
    calls += 1;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("RoomCircuitBreaker: guard() registrerer success automatisk", async () => {
  const breaker = new RoomCircuitBreaker({ failureThreshold: 5 });

  // Akkumuler 4 failures.
  for (let i = 0; i < 4; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i);
  }
  assert.equal(breaker.getStateSnapshot("room-A", 1100).consecutiveFailures, 4);

  // En guard()-success → telleren resettes.
  await breaker.guard("room-A", async () => "ok", 1200);
  assert.equal(breaker.getStateSnapshot("room-A", 1200).consecutiveFailures, 0);
});

test("RoomCircuitBreaker: guard() registrerer failure og rekaster", async () => {
  const breaker = new RoomCircuitBreaker({ failureThreshold: 3 });

  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(
      breaker.guard(
        "room-A",
        async () => {
          throw new Error("boom");
        },
        1000 + i * 10,
      ),
      /boom/,
    );
  }

  assert.equal(breaker.getStateSnapshot("room-A", 1100).consecutiveFailures, 2);
});

test("RoomCircuitBreaker: guard() kaster CircuitOpenError når OPEN", async () => {
  const breaker = new RoomCircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 30_000,
  });

  // Åpne breakeren.
  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i * 10);
  }

  // Påfølgende guard()-kall feiler umiddelbart.
  let calls = 0;
  await assert.rejects(
    async () => {
      await breaker.guard(
        "room-A",
        async () => {
          calls += 1;
          return "should-not-execute";
        },
        1100,
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof CircuitOpenError);
      assert.equal((err as CircuitOpenError).roomCode, "room-A");
      assert.ok((err as CircuitOpenError).retryAfterMs > 0);
      return true;
    },
  );
  assert.equal(calls, 0); // fn ble IKKE kjørt.
});

test("RoomCircuitBreaker: guard() i HALF_OPEN slipper gjennom én probe", async () => {
  const breaker = new RoomCircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 30_000,
    successThresholdHalfOpen: 1,
  });

  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i * 10);
  }

  // Etter cooldown: HALF_OPEN.
  // En guard()-success → CLOSED.
  let calls = 0;
  const result = await breaker.guard(
    "room-A",
    async () => {
      calls += 1;
      return "recovered";
    },
    32_000,
  );
  assert.equal(result, "recovered");
  assert.equal(calls, 1);
  assert.equal(breaker.getStateSnapshot("room-A", 32_000).state, "CLOSED");
});

test("RoomCircuitBreaker: manuell reset() lukker breaker", () => {
  const breaker = new RoomCircuitBreaker({ failureThreshold: 3 });
  const events: CircuitBreakerEvent[] = [];
  breaker.addListener((e) => events.push(e));

  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i);
  }
  assert.equal(breaker.getStateSnapshot("room-A", 1100).state, "OPEN");

  breaker.reset("room-A", 2000);
  const snap = breaker.getStateSnapshot("room-A", 2000);
  assert.equal(snap.state, "CLOSED");
  assert.equal(snap.consecutiveFailures, 0);
  assert.equal(snap.openedAtMs, null);

  const closedEvents = events.filter((e) => e.type === "circuit_closed");
  assert.equal(closedEvents.length, 1);
});

test("RoomCircuitBreaker: reset() på ukjent rom er no-op", () => {
  const breaker = new RoomCircuitBreaker();
  // Skal ikke kaste.
  breaker.reset("never-touched-room", 1000);
  assert.equal(breaker.size(), 0);
});

test("RoomCircuitBreaker: gc() dropper stale CLOSED-state", () => {
  const breaker = new RoomCircuitBreaker({
    gcStaleStateAfterMs: 60_000,
  });

  breaker.recordSuccess("room-A", 1000);
  breaker.recordSuccess("room-B", 90_000);

  // GC ved 100_000 — room-A er stale (lastTouch=1000, 100_000-1000 > 60_000).
  const dropped = breaker.gc(100_000);
  assert.equal(dropped, 1);
  assert.equal(breaker.size(), 1);
  assert.equal(breaker.getStateSnapshot("room-B", 100_000).state, "CLOSED");
});

test("RoomCircuitBreaker: gc() dropper IKKE OPEN-state selv om stale", () => {
  const breaker = new RoomCircuitBreaker({
    failureThreshold: 3,
    gcStaleStateAfterMs: 60_000,
  });

  // Åpne breaker for room-A.
  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i);
  }

  // GC ved 100_000 — room-A skal ikke droppes selv om stale.
  const dropped = breaker.gc(100_000);
  assert.equal(dropped, 0);
  assert.equal(breaker.size(), 1);
});

test("RoomCircuitBreaker: getAllStates returnerer alle rom", () => {
  const breaker = new RoomCircuitBreaker();
  breaker.recordSuccess("room-A", 1000);
  breaker.recordFailure("room-B", "test", 1000);
  breaker.recordSuccess("room-C", 1000);

  const all = breaker.getAllStates(2000);
  assert.equal(all.size, 3);
  assert.ok(all.has("room-A"));
  assert.ok(all.has("room-B"));
  assert.ok(all.has("room-C"));
});

test("RoomCircuitBreaker: isAllowed() reflekterer breaker-state", () => {
  const breaker = new RoomCircuitBreaker({ failureThreshold: 3 });

  assert.equal(breaker.isAllowed("room-A", 1000), true);

  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i);
  }
  assert.equal(breaker.isAllowed("room-A", 1100), false);
});

test("RoomCircuitBreaker: listener-feil tar ikke ned breakeren (fail-soft)", () => {
  const breaker = new RoomCircuitBreaker({ failureThreshold: 3 });
  breaker.addListener(() => {
    throw new Error("listener exploded");
  });

  // Skal ikke kaste.
  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i);
  }
  assert.equal(breaker.getStateSnapshot("room-A", 1100).state, "OPEN");
});

test("RoomCircuitBreaker: invalid config kaster", () => {
  assert.throws(() => new RoomCircuitBreaker({ failureThreshold: 0 }));
  assert.throws(() => new RoomCircuitBreaker({ failureWindowMs: 0 }));
  assert.throws(() => new RoomCircuitBreaker({ cooldownMs: 0 }));
});

test("RoomCircuitBreaker: call_rejected event fyrer ved guard mens OPEN", async () => {
  const breaker = new RoomCircuitBreaker({ failureThreshold: 2 });
  const events: CircuitBreakerEvent[] = [];
  breaker.addListener((e) => events.push(e));

  breaker.recordFailure("room-A", "test", 1000);
  breaker.recordFailure("room-A", "test", 1100);

  await assert.rejects(
    breaker.guard("room-A", async () => "x", 1200),
    CircuitOpenError,
  );

  const rejectedEvents = events.filter((e) => e.type === "call_rejected");
  assert.equal(rejectedEvents.length, 1);
  assert.equal(rejectedEvents[0].roomCode, "room-A");
});

test("RoomCircuitBreaker: HALF_OPEN-event fyrer ved cooldown-overgang", () => {
  const breaker = new RoomCircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  const events: CircuitBreakerEvent[] = [];
  breaker.addListener((e) => events.push(e));

  for (let i = 0; i < 3; i += 1) {
    breaker.recordFailure("room-A", "test", 1000 + i);
  }

  // Trigger overgang ved å lese state.
  breaker.getStateSnapshot("room-A", 31_500);

  const halfOpenEvents = events.filter((e) => e.type === "circuit_half_open");
  assert.equal(halfOpenEvents.length, 1);
});
