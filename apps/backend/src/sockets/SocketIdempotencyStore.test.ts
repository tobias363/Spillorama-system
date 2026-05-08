/**
 * BIN-813 R5: Unit-tests for SocketIdempotencyStore.
 *
 * Dekker:
 *   - claim() første gang returnerer null (handler skal kjøre)
 *   - claim() andre gang etter store() returnerer cached resultat
 *   - claim() på in-flight key returnerer IDEMPOTENCY_IN_FLIGHT
 *   - release() frigir in-flight slot
 *   - release() rører ikke ferdig-lagret entry
 *   - TTL-expiry slipper request gjennom på nytt
 *
 * Tester kjører mot InMemorySocketIdempotencyStore. Redis-implementasjonen
 * verifiseres med samme kontrakt-tester via en mocked redis-instans.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemorySocketIdempotencyStore,
  RedisSocketIdempotencyStore,
  type SocketIdempotencyStore,
} from "./SocketIdempotencyStore.js";

// ── In-memory contract tests ────────────────────────────────────────────────

test("InMemory: claim() returns null on first call (handler should run)", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const result = await store.claim("test-key-1");
  assert.equal(result, null, "first claim should return null");
});

test("InMemory: claim() returns cached result after store()", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const cached = { result: { ok: true, data: { foo: "bar" } } };
  await store.claim("test-key-2"); // reserve
  await store.store("test-key-2", cached);
  const second = await store.claim("test-key-2");
  assert.deepEqual(second, cached, "second claim should return cached");
});

test("InMemory: claim() on in-flight key returns IDEMPOTENCY_IN_FLIGHT", async () => {
  const store = new InMemorySocketIdempotencyStore();
  await store.claim("test-key-3"); // first claim reserves
  const second = await store.claim("test-key-3"); // second sees in-flight
  assert.notEqual(second, null);
  assert.equal((second!.result as { ok: boolean }).ok, false);
  const err = (second!.result as { error: { code: string } }).error;
  assert.equal(err.code, "IDEMPOTENCY_IN_FLIGHT");
});

test("InMemory: release() frees in-flight slot, next claim returns null", async () => {
  const store = new InMemorySocketIdempotencyStore();
  await store.claim("test-key-4"); // reserve
  await store.release("test-key-4");
  const second = await store.claim("test-key-4");
  assert.equal(second, null, "after release, next claim should be fresh");
});

test("InMemory: release() does NOT touch a stored result", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const cached = { result: { ok: true, data: { foo: "bar" } } };
  await store.claim("test-key-5");
  await store.store("test-key-5", cached);
  await store.release("test-key-5"); // should be no-op
  const third = await store.claim("test-key-5");
  assert.deepEqual(third, cached, "stored result should survive release()");
});

test("InMemory: store() with TTL=0 expires immediately on lookup", async () => {
  const store = new InMemorySocketIdempotencyStore();
  await store.claim("test-key-6");
  await store.store("test-key-6", { result: { ok: true, data: 1 } }, 0);
  // TTL=0 means expiresAt = now+0 = now. By the time we lookup again it
  // should have expired (next ms tick).
  await new Promise((r) => setTimeout(r, 5));
  const after = await store.claim("test-key-6");
  assert.equal(after, null, "expired entry should be gone");
});

test("InMemory: separate keys are isolated", async () => {
  const store = new InMemorySocketIdempotencyStore();
  await store.claim("key-A");
  await store.store("key-A", { result: { ok: true, data: "A" } });
  const b = await store.claim("key-B");
  assert.equal(b, null, "key-B claim is independent of key-A");
});

// ── RedisSocketIdempotencyStore contract tests via mock ───────────────────

interface MockRedis {
  data: Map<string, { value: string; expiresAt: number }>;
  set: (
    key: string,
    value: string,
    ...args: (string | number)[]
  ) => Promise<"OK" | null>;
  get: (key: string) => Promise<string | null>;
  eval: (
    script: string,
    numKeys: number,
    ...args: string[]
  ) => Promise<number>;
}

function makeMockRedis(): MockRedis {
  const data = new Map<string, { value: string; expiresAt: number }>();
  const isExpired = (e: { expiresAt: number }) => e.expiresAt <= Date.now();
  const cleanIfExpired = (key: string) => {
    const e = data.get(key);
    if (e && isExpired(e)) data.delete(key);
  };

  return {
    data,
    async set(key, value, ...args) {
      cleanIfExpired(key);
      // Parse "EX <seconds> NX" pattern (the only one we use).
      let ex = 0;
      let nx = false;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "EX" && typeof args[i + 1] === "number") {
          ex = args[i + 1] as number;
          i++;
        } else if (args[i] === "NX") {
          nx = true;
        }
      }
      if (nx && data.has(key)) {
        return null;
      }
      data.set(key, {
        value: String(value),
        expiresAt: Date.now() + ex * 1000,
      });
      return "OK";
    },
    async get(key) {
      cleanIfExpired(key);
      const e = data.get(key);
      return e ? e.value : null;
    },
    async eval(_script, _numKeys, ...args) {
      // Vår eval-bruk er release()-Lua: hvis verdi == argv[1] → del, ellers 0.
      const key = args[0];
      const expectedVal = args[1];
      cleanIfExpired(key);
      const e = data.get(key);
      if (e && e.value === expectedVal) {
        data.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

test("Redis: claim() first time reserves and returns null", async () => {
  const mock = makeMockRedis();
  const store = new RedisSocketIdempotencyStore({
    redis: mock as unknown as import("ioredis").Redis,
  });
  const r = await store.claim("redis-key-1");
  assert.equal(r, null);
  // The marker should now exist in mock.data.
  assert.ok(mock.data.has("socket-idem:redis-key-1"));
});

test("Redis: claim() after store() returns cached result", async () => {
  const mock = makeMockRedis();
  const store = new RedisSocketIdempotencyStore({
    redis: mock as unknown as import("ioredis").Redis,
  });
  const payload = { result: { ok: true, data: { foo: "bar" } } };
  await store.claim("redis-key-2");
  await store.store("redis-key-2", payload);
  const r = await store.claim("redis-key-2");
  assert.deepEqual(r, payload);
});

test("Redis: claim() in-flight returns IDEMPOTENCY_IN_FLIGHT", async () => {
  const mock = makeMockRedis();
  const store = new RedisSocketIdempotencyStore({
    redis: mock as unknown as import("ioredis").Redis,
  });
  await store.claim("redis-key-3");
  const r = await store.claim("redis-key-3");
  assert.notEqual(r, null);
  const err = (r!.result as { error: { code: string } }).error;
  assert.equal(err.code, "IDEMPOTENCY_IN_FLIGHT");
});

test("Redis: release() removes in-flight marker only", async () => {
  const mock = makeMockRedis();
  const store = new RedisSocketIdempotencyStore({
    redis: mock as unknown as import("ioredis").Redis,
  });
  await store.claim("redis-key-4");
  await store.release("redis-key-4");
  // Subsequent claim should be fresh.
  const r = await store.claim("redis-key-4");
  assert.equal(r, null);
});

test("Redis: release() leaves stored result intact", async () => {
  const mock = makeMockRedis();
  const store = new RedisSocketIdempotencyStore({
    redis: mock as unknown as import("ioredis").Redis,
  });
  const payload = { result: { ok: true, data: 42 } };
  await store.claim("redis-key-5");
  await store.store("redis-key-5", payload);
  await store.release("redis-key-5"); // should be no-op
  const r = await store.claim("redis-key-5");
  assert.deepEqual(r, payload, "stored result must survive release()");
});

test("Redis: store key uses prefix + given key", async () => {
  const mock = makeMockRedis();
  const store = new RedisSocketIdempotencyStore({
    redis: mock as unknown as import("ioredis").Redis,
    keyPrefix: "test-prefix:",
  });
  await store.claim("foo");
  assert.ok(mock.data.has("test-prefix:foo"));
});

// ── Concurrency contract: same-key parallel claims serialize ──────────────

test("InMemory: parallel claim() — only one wins, others see in-flight", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const [a, b, c] = await Promise.all([
    store.claim("concurrent-1"),
    store.claim("concurrent-1"),
    store.claim("concurrent-1"),
  ]);
  // Exactly one should win (return null).
  const winners = [a, b, c].filter((r) => r === null);
  assert.equal(winners.length, 1, "exactly one parallel claim should win");
});
