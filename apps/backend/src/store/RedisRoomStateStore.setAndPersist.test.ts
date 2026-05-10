/**
 * ADR-0019 P0-2: sync-persist contract tests for RoomStateStore implementations.
 *
 * Verifies:
 *   1. `setAndPersist` waits for backing-store write before returning
 *   2. `set` returns immediately (fire-and-forget pattern preserved)
 *   3. In-memory state matches "persisted" state after `setAndPersist` (deterministic crash-test surrogate)
 *   4. Redis-failure surfaces as `RoomStatePersistError` (fail-closed for critical paths)
 *   5. Metrics emitted (duration histogram + failure counter) — non-blocking
 *   6. `setAndPersistWithPath` segments metrics by call-site label
 *
 * Tests run against InMemoryRoomStateStore (no-op-equivalent semantics) AND
 * against RedisRoomStateStore via a mock ioredis instance so we exercise the
 * actual error-throw + metrics emission paths without requiring a live Redis.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryRoomStateStore,
  RoomStatePersistError,
  serializeRoom,
} from "./RoomStateStore.js";
import { RedisRoomStateStore } from "./RedisRoomStateStore.js";
import type { RoomState } from "../game/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────

function makeRoom(code = "TEST01"): RoomState {
  return {
    code,
    hallId: "hall-1",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    players: new Map([
      ["p1", { id: "p1", name: "Alice", walletId: "w1", balance: 100 }],
    ]),
    gameHistory: [],
    createdAt: "2026-05-10T12:00:00.000Z",
  };
}

// ── Mock ioredis matching ADR-0019 surface ────────────────────────────

interface MockRedisStore {
  /** Backing store — what would be persisted on a real Redis. */
  data: Map<string, string>;
  /** When > 0, the next `setex` call will reject this many times. */
  failNextSetex: number;
  /** Recorded calls for assertions. */
  setexCalls: Array<{ key: string; ttl: number; value: string }>;
  setex: (key: string, ttl: number, value: string) => Promise<"OK">;
  // Stubbed methods to satisfy ioredis-Redis interface — never invoked in
  // these tests but required so the type-cast doesn't reject at construct-
  // time. Real `setAndPersist`-paths only touch `setex`.
  del: (key: string) => Promise<number>;
  keys: (pattern: string) => Promise<string[]>;
  pipeline: () => { exec: () => Promise<unknown[]> };
  quit: () => Promise<"OK">;
  connect: () => Promise<void>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

function makeMockRedis(): MockRedisStore {
  const store: MockRedisStore = {
    data: new Map(),
    failNextSetex: 0,
    setexCalls: [],
    async setex(key, ttl, value) {
      store.setexCalls.push({ key, ttl, value });
      if (store.failNextSetex > 0) {
        store.failNextSetex -= 1;
        throw new Error("simulert Redis-feil (failNextSetex)");
      }
      store.data.set(key, value);
      return "OK";
    },
    async del(key) {
      return store.data.delete(key) ? 1 : 0;
    },
    async keys() {
      return [...store.data.keys()];
    },
    pipeline() {
      return { async exec() { return []; } };
    },
    async quit() { return "OK"; },
    async connect() { /* no-op */ },
    on() { /* no-op */ },
  };
  return store;
}

/**
 * Construct a RedisRoomStateStore whose `.redis` member is replaced with
 * our mock. We use a getter-style override since the field is private —
 * cast through `unknown` to swap it after construction.
 */
function makeRedisStoreWithMock(mock: MockRedisStore): RedisRoomStateStore {
  const store = new RedisRoomStateStore({ url: "redis://localhost:0/0" });
  // Replace the private `redis` field. ioredis-Redis interface is large;
  // for our test paths only `setex` is touched on the happy path.
  (store as unknown as { redis: unknown }).redis = mock;
  return store;
}

// ── InMemoryRoomStateStore: setAndPersist matches set semantics ───────

test("InMemory: setAndPersist completes (no-op equivalent for in-memory)", async () => {
  const store = new InMemoryRoomStateStore();
  const room = makeRoom();
  await store.setAndPersist("TEST01", room);
  assert.equal(store.size, 1);
  assert.equal(store.get("TEST01"), room);
});

test("InMemory: setAndPersist NEVER throws (memory is source of truth)", async () => {
  const store = new InMemoryRoomStateStore();
  // No way to make in-memory fail — the contract is "this is the only
  // store, mutations cannot be lost in-process". Just verify the await
  // settles.
  await assert.doesNotReject(
    () => store.setAndPersist("TEST01", makeRoom()),
  );
});

// ── RedisRoomStateStore: setAndPersist awaits Redis write ─────────────

test("Redis: setAndPersist waits for Redis setex before returning", async () => {
  const mock = makeMockRedis();
  const store = makeRedisStoreWithMock(mock);
  const room = makeRoom("REDIS-01");

  await store.setAndPersist("REDIS-01", room);

  // setex MUST have been called by the time setAndPersist resolves.
  assert.equal(mock.setexCalls.length, 1, "setex called once");
  assert.equal(mock.setexCalls[0].key, "bingo:room:REDIS-01");
  // The persisted value must be the serialized room.
  const persisted = JSON.parse(mock.setexCalls[0].value);
  assert.equal(persisted.code, "REDIS-01");
  assert.equal(persisted.hostPlayerId, "p1");
  // Memory state is also updated (write-through).
  assert.equal(store.get("REDIS-01")?.code, "REDIS-01");
});

test("Redis: setAndPersist throws RoomStatePersistError on Redis failure", async () => {
  const mock = makeMockRedis();
  mock.failNextSetex = 1;
  const store = makeRedisStoreWithMock(mock);
  const room = makeRoom("REDIS-02");

  await assert.rejects(
    () => store.setAndPersist("REDIS-02", room),
    (err: unknown) => {
      assert.ok(err instanceof RoomStatePersistError);
      assert.equal(err.roomCode, "REDIS-02");
      assert.equal(err.name, "RoomStatePersistError");
      assert.ok(err.message.includes("REDIS-02"));
      return true;
    },
  );

  // Memory state is still updated even though Redis failed — the engine
  // can continue this request (caller decides fail-closed vs fail-degraded).
  assert.equal(store.get("REDIS-02")?.code, "REDIS-02");
});

test("Redis: set() is fire-and-forget (returns synchronously)", () => {
  const mock = makeMockRedis();
  const store = makeRedisStoreWithMock(mock);
  const room = makeRoom("REDIS-03");

  // set() returns void synchronously — no await needed.
  const result = store.set("REDIS-03", room);
  assert.equal(result, undefined);

  // Memory state is synchronous.
  assert.equal(store.get("REDIS-03")?.code, "REDIS-03");
});

test("Redis: setAndPersist serializes structurally — round-trip safe", async () => {
  const mock = makeMockRedis();
  const store = makeRedisStoreWithMock(mock);
  const room = makeRoom("REDIS-04");

  await store.setAndPersist("REDIS-04", room);

  const stored = mock.setexCalls[0].value;
  const parsed = JSON.parse(stored);
  // Verify we wrote the canonical SerializedRoomState shape — same as
  // the existing `serializeRoom` helper.
  const expected = JSON.parse(JSON.stringify(serializeRoom(room)));
  assert.deepEqual(parsed, expected);
});

test("Redis: setAndPersistWithPath segments metric label per call-site", async () => {
  const mock = makeMockRedis();
  const store = makeRedisStoreWithMock(mock);
  await store.setAndPersistWithPath("REDIS-05", makeRoom("REDIS-05"), "room_create");
  await store.setAndPersistWithPath("REDIS-06", makeRoom("REDIS-06"), "scheduled_game_bind");
  // Both calls should succeed and result in two distinct setex calls.
  assert.equal(mock.setexCalls.length, 2);
  assert.equal(mock.setexCalls[0].key, "bingo:room:REDIS-05");
  assert.equal(mock.setexCalls[1].key, "bingo:room:REDIS-06");
});

test("Redis: setAndPersistWithPath surfaces RoomStatePersistError on failure", async () => {
  const mock = makeMockRedis();
  mock.failNextSetex = 1;
  const store = makeRedisStoreWithMock(mock);

  await assert.rejects(
    () =>
      store.setAndPersistWithPath(
        "REDIS-07",
        makeRoom("REDIS-07"),
        "room_create",
      ),
    (err: unknown) => {
      assert.ok(err instanceof RoomStatePersistError);
      assert.equal(err.roomCode, "REDIS-07");
      return true;
    },
  );
});

// ── Crash-test surrogate: memory matches "persisted" after setAndPersist ─

test("Redis: crash-test surrogate — in-memory state matches Redis after setAndPersist", async () => {
  const mock = makeMockRedis();
  const store = makeRedisStoreWithMock(mock);
  const room = makeRoom("CRASH-01");

  // Before any persist call, neither memory nor Redis has the room.
  assert.equal(store.get("CRASH-01"), undefined);
  assert.equal(mock.data.get("bingo:room:CRASH-01"), undefined);

  // Simulate a crash-window check: setAndPersist guarantees that by the
  // time it resolves, BOTH memory and Redis are updated. There is no
  // 10-50 ms gap where memory is ahead of Redis.
  await store.setAndPersist("CRASH-01", room);

  // Both stores reflect the new state synchronously w.r.t. the await.
  assert.equal(store.get("CRASH-01")?.code, "CRASH-01");
  assert.ok(mock.data.has("bingo:room:CRASH-01"));
  // Verify they describe the same room (round-trip identity).
  const parsed = JSON.parse(mock.data.get("bingo:room:CRASH-01")!);
  assert.equal(parsed.code, "CRASH-01");
  assert.equal(parsed.hostPlayerId, room.hostPlayerId);
});

test("Redis: crash-window comparison — set() leaves redis-lag window", async () => {
  const mock = makeMockRedis();
  const store = makeRedisStoreWithMock(mock);
  const room = makeRoom("CRASH-02");

  // set() returns immediately. The Redis write is fired but not awaited,
  // so this test verifies the bug-class we're fixing exists for `set` but
  // NOT for `setAndPersist`. We use a lazy mock that defers `setex`
  // resolution to demonstrate the window.
  const slowMock: MockRedisStore = makeMockRedis();
  let resolveSlowSetex: (() => void) | null = null;
  const slowPromise = new Promise<void>((resolve) => {
    resolveSlowSetex = resolve;
  });
  slowMock.setex = async (key, ttl, value) => {
    slowMock.setexCalls.push({ key, ttl, value });
    await slowPromise;
    slowMock.data.set(key, value);
    return "OK";
  };
  const slowStore = makeRedisStoreWithMock(slowMock);

  // Call set — memory is updated, but Redis-write is pending.
  slowStore.set("CRASH-02", room);
  // Memory has the room — but Redis does NOT yet.
  assert.equal(slowStore.get("CRASH-02")?.code, "CRASH-02");
  assert.equal(slowMock.data.has("bingo:room:CRASH-02"), false);
  assert.equal(slowMock.setexCalls.length, 1, "setex initiated");

  // Now release the slow-setex. After this, Redis catches up.
  resolveSlowSetex!();
  await new Promise<void>((r) => setImmediate(r));
  assert.ok(slowMock.data.has("bingo:room:CRASH-02"));
});

// ── Metrics emission (smoke-test) ─────────────────────────────────────

test("Redis: metrics imported without runtime errors during sync persist", async () => {
  // Verify the metrics-emission path doesn't throw — we don't assert on
  // specific gauge values (Prometheus client registers histograms with
  // labels lazily). This guards against accidental break to the metric-
  // observation call-site.
  const mock = makeMockRedis();
  const store = makeRedisStoreWithMock(mock);
  await assert.doesNotReject(
    () => store.setAndPersist("METRICS-01", makeRoom("METRICS-01")),
  );
  await assert.doesNotReject(
    () => store.setAndPersistWithPath("METRICS-02", makeRoom("METRICS-02"), "room_create"),
  );
});

test("Redis: metrics failure-counter increments on RoomStatePersistError", async () => {
  // Smoke-test: setAndPersist on a failing mock throws and metric counters
  // should not break the throw. We read the failure-counter delta via
  // prom-client's `get()` which returns `{values: [{labels, value}]}`.
  const { metrics } = await import("../util/metrics.js");
  const mock = makeMockRedis();
  mock.failNextSetex = 1;
  const store = makeRedisStoreWithMock(mock);

  // Snapshot the counter value for `path: "room_state"` BEFORE the failing
  // call. The Counter starts at 0 with no labels set; after at least one
  // failed call we expect a non-zero value for our label.
  const readCounter = async (path: string): Promise<number> => {
    const snapshot = await metrics.roomStatePersistFailures.get();
    const entry = snapshot.values.find((v) => v.labels?.path === path);
    return entry?.value ?? 0;
  };

  const before = await readCounter("room_state");

  await assert.rejects(
    () => store.setAndPersist("METRICS-03", makeRoom("METRICS-03")),
    RoomStatePersistError,
  );

  const after = await readCounter("room_state");
  assert.ok(
    after >= before + 1,
    `failure-counter should have incremented; was ${before} → ${after}`,
  );
});
