/**
 * ADR-0020 / P1-3 — RedisHealthMetrics tests.
 *
 * Verifies counter behaviour:
 *   - Failure increments totalFailures + consecutiveFailures
 *   - Success resets consecutiveFailures to 0
 *   - Snapshot returns deterministic shape
 *   - Error-clamping limits stored message length
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetRedisMetricsForTests,
  getRedisMetricsSnapshot,
  getRedisOperationCounter,
  recordRedisFailure,
  recordRedisSuccess,
} from "../RedisHealthMetrics.js";

test.beforeEach(() => {
  __resetRedisMetricsForTests();
});

test("recordRedisFailure increments counters", () => {
  recordRedisFailure("persist", new Error("connection timeout"), 1_000);

  const snapshot = getRedisOperationCounter("persist");
  assert.equal(snapshot.totalFailures, 1);
  assert.equal(snapshot.consecutiveFailures, 1);
  assert.equal(snapshot.totalSuccesses, 0);
  assert.equal(snapshot.lastFailureMs, 1_000);
  assert.equal(snapshot.lastSuccessMs, null);
  assert.match(snapshot.lastError ?? "", /connection timeout/);
});

test("recordRedisSuccess resets consecutiveFailures", () => {
  recordRedisFailure("persist", new Error("err1"), 1_000);
  recordRedisFailure("persist", new Error("err2"), 2_000);
  recordRedisFailure("persist", new Error("err3"), 3_000);

  let snapshot = getRedisOperationCounter("persist");
  assert.equal(snapshot.consecutiveFailures, 3);

  recordRedisSuccess("persist", 4_000);

  snapshot = getRedisOperationCounter("persist");
  assert.equal(snapshot.consecutiveFailures, 0);
  assert.equal(snapshot.totalSuccesses, 1);
  assert.equal(snapshot.totalFailures, 3);
  assert.equal(snapshot.lastSuccessMs, 4_000);
});

test("counters are isolated per operation", () => {
  recordRedisFailure("persist", new Error("p1"), 100);
  recordRedisFailure("lock_acquire", new Error("l1"), 200);
  recordRedisSuccess("persist", 300);

  const persist = getRedisOperationCounter("persist");
  const lockAcquire = getRedisOperationCounter("lock_acquire");
  const lockRelease = getRedisOperationCounter("lock_release");

  assert.equal(persist.consecutiveFailures, 0);
  assert.equal(persist.totalSuccesses, 1);
  assert.equal(lockAcquire.consecutiveFailures, 1);
  assert.equal(lockAcquire.totalSuccesses, 0);
  assert.equal(lockRelease.totalFailures, 0);
});

test("getRedisMetricsSnapshot returns all 4 operations", () => {
  const snapshot = getRedisMetricsSnapshot();
  assert.equal(snapshot.length, 4);
  const operations = snapshot.map((s) => s.operation).sort();
  assert.deepEqual(operations, ["lock_acquire", "lock_release", "persist", "ping"]);
});

test("error message is clamped to 200 chars", () => {
  const longError = new Error("x".repeat(500));
  recordRedisFailure("persist", longError, 1_000);

  const snapshot = getRedisOperationCounter("persist");
  assert.ok(snapshot.lastError !== null);
  assert.ok(snapshot.lastError.length <= 203, `lastError length is ${snapshot.lastError.length}`);
  assert.ok(snapshot.lastError.endsWith("..."));
});

test("non-Error objects are stringified", () => {
  recordRedisFailure("persist", { code: "ECONNRESET", op: "set" }, 1_000);

  const snapshot = getRedisOperationCounter("persist");
  assert.match(snapshot.lastError ?? "", /ECONNRESET/);
});

test("null/undefined error becomes (unknown)", () => {
  recordRedisFailure("persist", null, 1_000);

  const snapshot = getRedisOperationCounter("persist");
  assert.equal(snapshot.lastError, "(unknown)");
});

test("__resetRedisMetricsForTests clears all state", () => {
  recordRedisFailure("persist", new Error("err"), 1_000);
  recordRedisSuccess("persist", 2_000);
  recordRedisFailure("ping", new Error("ping err"), 3_000);

  __resetRedisMetricsForTests();

  const persist = getRedisOperationCounter("persist");
  const ping = getRedisOperationCounter("ping");

  assert.equal(persist.totalFailures, 0);
  assert.equal(persist.totalSuccesses, 0);
  assert.equal(persist.lastError, null);
  assert.equal(ping.totalFailures, 0);
});
