import test from "node:test";
import assert from "node:assert/strict";
import { SocketRateLimiter } from "./socketRateLimit.js";

test("allows events within limit", () => {
  const limiter = new SocketRateLimiter({ "test:event": { windowMs: 10_000, maxEvents: 3 } });
  assert.equal(limiter.check("s1", "test:event", 1000), true);
  assert.equal(limiter.check("s1", "test:event", 2000), true);
  assert.equal(limiter.check("s1", "test:event", 3000), true);
});

test("blocks events exceeding limit", () => {
  const limiter = new SocketRateLimiter({ "test:event": { windowMs: 10_000, maxEvents: 2 } });
  assert.equal(limiter.check("s1", "test:event", 1000), true);
  assert.equal(limiter.check("s1", "test:event", 2000), true);
  assert.equal(limiter.check("s1", "test:event", 3000), false);
  assert.equal(limiter.check("s1", "test:event", 4000), false);
});

test("window slides — old events expire", () => {
  const limiter = new SocketRateLimiter({ "test:event": { windowMs: 5_000, maxEvents: 2 } });
  assert.equal(limiter.check("s1", "test:event", 1000), true);
  assert.equal(limiter.check("s1", "test:event", 2000), true);
  assert.equal(limiter.check("s1", "test:event", 3000), false);
  // After window slides past first event (1000 + 5000 = 6000)
  assert.equal(limiter.check("s1", "test:event", 6001), true);
});

test("different events have independent limits", () => {
  const limiter = new SocketRateLimiter({
    "event:a": { windowMs: 10_000, maxEvents: 1 },
    "event:b": { windowMs: 10_000, maxEvents: 1 },
  });
  assert.equal(limiter.check("s1", "event:a", 1000), true);
  assert.equal(limiter.check("s1", "event:a", 2000), false);
  // event:b is still available
  assert.equal(limiter.check("s1", "event:b", 2000), true);
  assert.equal(limiter.check("s1", "event:b", 3000), false);
});

test("different sockets have independent limits", () => {
  const limiter = new SocketRateLimiter({ "test:event": { windowMs: 10_000, maxEvents: 1 } });
  assert.equal(limiter.check("s1", "test:event", 1000), true);
  assert.equal(limiter.check("s1", "test:event", 2000), false);
  // s2 has its own limit
  assert.equal(limiter.check("s2", "test:event", 2000), true);
  assert.equal(limiter.check("s2", "test:event", 3000), false);
});

test("cleanup removes all entries for a socket", () => {
  const limiter = new SocketRateLimiter({ "test:event": { windowMs: 10_000, maxEvents: 1 } });
  limiter.check("s1", "test:event", 1000);
  limiter.check("s1", "test:event", 2000); // blocked
  assert.equal(limiter.bucketCount, 1);
  assert.equal(limiter.activeSocketCount, 1);

  limiter.cleanup("s1");
  assert.equal(limiter.bucketCount, 0);
  assert.equal(limiter.activeSocketCount, 0);

  // After cleanup, socket can send again
  assert.equal(limiter.check("s1", "test:event", 3000), true);
});

test("fallback limit applies to unknown events", () => {
  const limiter = new SocketRateLimiter({}, { windowMs: 10_000, maxEvents: 1 });
  assert.equal(limiter.check("s1", "unknown:event", 1000), true);
  assert.equal(limiter.check("s1", "unknown:event", 2000), false);
});
