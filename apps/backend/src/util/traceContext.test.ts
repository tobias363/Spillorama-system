/**
 * MED-1: Trace-context unit tests.
 *
 * These cover the three properties that matter for the bug we're fixing
 * (logger-loss across async boundaries):
 *   1. Context propagates across `await` and `setImmediate` (the async
 *      DB-call case).
 *   2. Concurrent runs do NOT bleed into each other (two simultaneous
 *      requests must get distinct traceIds).
 *   3. `setTraceField` enriches the live context downstream.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  getTraceContext,
  newTraceId,
  runWithTraceContext,
  setTraceField,
} from "./traceContext.js";

test("traceContext is undefined outside runWithTraceContext", () => {
  assert.equal(getTraceContext(), undefined);
});

test("traceContext propagates across await and microtasks (async DB-call case)", async () => {
  const traceId = newTraceId();
  await runWithTraceContext({ traceId, requestId: traceId }, async () => {
    // Initial frame
    assert.equal(getTraceContext()?.traceId, traceId);

    // Across an await — simulates an async DB query / fetch
    await Promise.resolve();
    assert.equal(getTraceContext()?.traceId, traceId);

    // Across a setImmediate — simulates a deferred callback (e.g. a
    // pino-transport flush hook or socket-ack scheduled later).
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(getTraceContext()?.traceId, traceId);

    // Across a setTimeout — simulates a debounce/retry path.
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    assert.equal(getTraceContext()?.traceId, traceId);
  });

  // After the run completes, the context is gone again.
  assert.equal(getTraceContext(), undefined);
});

test("concurrent runs have isolated traceIds (no cross-request bleed)", async () => {
  const idA = newTraceId();
  const idB = newTraceId();
  assert.notEqual(idA, idB);

  // Kick off two scopes simultaneously and let them interleave awaits.
  // If ALS context bled across, one of them would observe the other's id.
  const observedA: string[] = [];
  const observedB: string[] = [];

  const runA = runWithTraceContext({ traceId: idA }, async () => {
    observedA.push(getTraceContext()!.traceId);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    observedA.push(getTraceContext()!.traceId);
    await Promise.resolve();
    observedA.push(getTraceContext()!.traceId);
  });

  const runB = runWithTraceContext({ traceId: idB }, async () => {
    observedB.push(getTraceContext()!.traceId);
    await Promise.resolve();
    observedB.push(getTraceContext()!.traceId);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    observedB.push(getTraceContext()!.traceId);
  });

  await Promise.all([runA, runB]);

  // Each run only ever saw its own id.
  assert.deepEqual(observedA, [idA, idA, idA]);
  assert.deepEqual(observedB, [idB, idB, idB]);
});

test("setTraceField enriches the live context for downstream calls", async () => {
  const traceId = newTraceId();
  await runWithTraceContext({ traceId }, async () => {
    assert.equal(getTraceContext()?.userId, undefined);
    setTraceField("userId", "user-123");
    setTraceField("roomCode", "BINGO-42");

    // Across an await — enriched fields persist.
    await Promise.resolve();
    assert.equal(getTraceContext()?.traceId, traceId);
    assert.equal(getTraceContext()?.userId, "user-123");
    assert.equal(getTraceContext()?.roomCode, "BINGO-42");
  });
});

test("newTraceId produces unique values", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) ids.add(newTraceId());
  assert.equal(ids.size, 1000, "expected 1000 unique trace-ids");
});
