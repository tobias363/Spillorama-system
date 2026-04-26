import test from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker, CircuitBreakerOpenError, type CircuitState } from "./CircuitBreaker.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("starts in CLOSED state", () => {
  const cb = new CircuitBreaker({ threshold: 3 });
  assert.equal(cb.state, "CLOSED");
  cb.assertClosed(); // should not throw
});

test("stays CLOSED below threshold", () => {
  const cb = new CircuitBreaker({ threshold: 3 });
  cb.onFailure();
  cb.onFailure();
  assert.equal(cb.state, "CLOSED");
  cb.assertClosed(); // should not throw
});

test("opens after threshold consecutive failures", () => {
  const cb = new CircuitBreaker({ threshold: 3, resetMs: 60_000 });
  cb.onFailure();
  cb.onFailure();
  cb.onFailure();
  assert.equal(cb.state, "OPEN");
  assert.throws(() => cb.assertClosed(), CircuitBreakerOpenError);
});

test("success resets failure counter", () => {
  const cb = new CircuitBreaker({ threshold: 3 });
  cb.onFailure();
  cb.onFailure();
  cb.onSuccess(); // reset
  cb.onFailure();
  cb.onFailure();
  assert.equal(cb.state, "CLOSED"); // only 2 consecutive, not 3
});

test("transitions to HALF_OPEN after reset period", () => {
  const cb = new CircuitBreaker({ threshold: 1, resetMs: 10 });
  cb.onFailure(); // opens immediately
  assert.equal(cb.state, "OPEN");

  // Wait for reset
  const start = Date.now();
  while (Date.now() - start < 15) { /* busy wait */ }

  assert.equal(cb.state, "HALF_OPEN");
  cb.assertClosed(); // should not throw (probe allowed)
  assert.equal(cb.state, "CLOSED"); // auto-reset on probe
});

test("metrics returns correct counts", () => {
  const cb = new CircuitBreaker({ threshold: 2, name: "test-api" });
  cb.onSuccess();
  cb.onFailure();
  cb.onFailure(); // opens
  try { cb.assertClosed(); } catch { /* expected */ }

  const m = cb.metrics();
  assert.equal(m.name, "test-api");
  assert.equal(m.state, "OPEN");
  assert.equal(m.totalSuccesses, 1);
  assert.equal(m.totalFailures, 2);
  assert.equal(m.totalRejections, 1);
  assert.equal(m.consecutiveFailures, 2);
});

// ── HIGH-8 execute() tests ─────────────────────────────────────────────────

test("HIGH-8 execute(): 3 consecutive failures → OPEN", async () => {
  const cb = new CircuitBreaker({ threshold: 3, resetMs: 60_000 });
  const fail = () => Promise.reject(new Error("db down"));

  for (let i = 0; i < 3; i++) {
    await assert.rejects(cb.execute(fail), /db down/);
  }

  assert.equal(cb.state, "OPEN");
  // Subsequent call fails fast with CircuitBreakerOpenError, not "db down".
  await assert.rejects(cb.execute(fail), CircuitBreakerOpenError);
});

test("HIGH-8 execute(): fail-fast under OPEN — fn never invoked", async () => {
  const cb = new CircuitBreaker({ threshold: 2, resetMs: 60_000 });
  const fail = () => Promise.reject(new Error("db down"));

  await assert.rejects(cb.execute(fail));
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.state, "OPEN");

  let called = false;
  const probe = async () => {
    called = true;
    return "ok";
  };
  await assert.rejects(cb.execute(probe), CircuitBreakerOpenError);
  assert.equal(called, false, "OPEN must short-circuit before calling fn");

  // Total rejections counter should reflect the rejected probe.
  assert.equal(cb.metrics().totalRejections, 1);
});

test("HIGH-8 execute(): HALF_OPEN probe success → CLOSED", async () => {
  const cb = new CircuitBreaker({ threshold: 2, resetMs: 20 });
  const fail = () => Promise.reject(new Error("db down"));

  await assert.rejects(cb.execute(fail));
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.state, "OPEN");

  await wait(25);
  assert.equal(cb.state, "HALF_OPEN");

  const result = await cb.execute(async () => "recovered");
  assert.equal(result, "recovered");
  assert.equal(cb.state, "CLOSED");

  // Closed again — failure counter reset.
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.state, "CLOSED", "1 failure after recovery does not re-open");
});

test("HIGH-8 execute(): HALF_OPEN probe failure → OPEN immediately", async () => {
  const cb = new CircuitBreaker({ threshold: 3, resetMs: 20 });
  const fail = () => Promise.reject(new Error("db down"));

  for (let i = 0; i < 3; i++) {
    await assert.rejects(cb.execute(fail));
  }
  assert.equal(cb.state, "OPEN");

  await wait(25);
  assert.equal(cb.state, "HALF_OPEN");

  // Single failed probe must re-open without needing 3 more failures.
  await assert.rejects(cb.execute(fail), /db down/);
  assert.equal(cb.state, "OPEN");

  // Subsequent calls still rejected even though we only saw ONE
  // post-probe failure.
  await assert.rejects(cb.execute(fail), CircuitBreakerOpenError);
});

test("HIGH-8 execute(): success in CLOSED resets consecutive failures", async () => {
  const cb = new CircuitBreaker({ threshold: 3, resetMs: 60_000 });
  const fail = () => Promise.reject(new Error("transient"));

  await assert.rejects(cb.execute(fail));
  await assert.rejects(cb.execute(fail));
  await cb.execute(async () => "recovered");
  // Counter is back to zero.
  await assert.rejects(cb.execute(fail));
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.state, "CLOSED", "only 2 consecutive failures since reset");

  // One more failure should open.
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.state, "OPEN");
});

test("HIGH-8 execute(): onStateChange fires on transitions", async () => {
  const observed: CircuitState[] = [];
  const cb = new CircuitBreaker({
    threshold: 2,
    resetMs: 20,
    onStateChange: (state) => observed.push(state),
  });
  // Constructor emits initial CLOSED.
  assert.deepEqual(observed, ["CLOSED"]);

  const fail = () => Promise.reject(new Error("x"));
  await assert.rejects(cb.execute(fail));
  await assert.rejects(cb.execute(fail));
  assert.equal(observed.at(-1), "OPEN");

  await wait(25);
  await cb.execute(async () => "ok"); // probe success → HALF_OPEN then CLOSED
  // Observer should have logged HALF_OPEN before going to CLOSED.
  assert.ok(observed.includes("HALF_OPEN"));
  assert.equal(observed.at(-1), "CLOSED");
});

test("HIGH-8 execute(): concurrent HALF_OPEN admits exactly one probe", async () => {
  const cb = new CircuitBreaker({ threshold: 1, resetMs: 10 });
  await assert.rejects(cb.execute(() => Promise.reject(new Error("x"))));
  assert.equal(cb.state, "OPEN");
  await wait(15);
  assert.equal(cb.state, "HALF_OPEN");

  let probeStarted = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });

  const slowProbe = async () => {
    probeStarted++;
    await released;
    return "ok";
  };

  // First call enters as the probe.
  const probePromise = cb.execute(slowProbe);
  // Yield to event loop so the breaker has marked probe in-flight.
  await wait(0);
  // Second concurrent call should be rejected (only one probe at a time).
  await assert.rejects(cb.execute(async () => "second"), CircuitBreakerOpenError);
  assert.equal(probeStarted, 1, "only one probe ever started");

  release();
  assert.equal(await probePromise, "ok");
  assert.equal(cb.state, "CLOSED");
});
