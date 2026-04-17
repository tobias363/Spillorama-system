import test from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker, CircuitBreakerOpenError } from "./CircuitBreaker.js";

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
