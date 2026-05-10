/**
 * ADR-0019 / P0-1 (2026-05-10): tester for `RoomStateVersionStore`.
 *
 * Verifiserer:
 *   1. `next()` returnerer monotonic økende verdier per rom-code
 *   2. `current()` returnerer sist incrementede verdi uten å incremente
 *   3. Counter er per-rom (uavhengig telling)
 *   4. In-memory implementasjon støtter test-helpers `_set` / `_clear`
 *   5. Cold-start: `current()` på ukjent rom returnerer 0, `next()` returnerer 1
 *   6. Konkurrente kall returnerer unike verdier (atomic mot Map-mutex)
 *   7. Redis-backed implementasjon overlever restart (sjekkes ved å bygge ny
 *      instans mot samme Redis-state — kan ikke direkte simuleres uten Redis,
 *      så vi tester INCR-semantikken via en mock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryRoomStateVersionStore,
  RedisRoomStateVersionStore,
} from "./RoomStateVersionStore.js";

// ── InMemory contract tests ────────────────────────────────────────────────

test("InMemory: next() returns 1 on first call for a new room", async () => {
  const store = new InMemoryRoomStateVersionStore();
  assert.equal(await store.next("ROOM-A"), 1);
});

test("InMemory: next() returns monotonically increasing values for the same room", async () => {
  const store = new InMemoryRoomStateVersionStore();
  assert.equal(await store.next("ROOM-A"), 1);
  assert.equal(await store.next("ROOM-A"), 2);
  assert.equal(await store.next("ROOM-A"), 3);
  assert.equal(await store.next("ROOM-A"), 4);
});

test("InMemory: counters are independent per room", async () => {
  const store = new InMemoryRoomStateVersionStore();
  assert.equal(await store.next("ROOM-A"), 1);
  assert.equal(await store.next("ROOM-B"), 1);
  assert.equal(await store.next("ROOM-A"), 2);
  assert.equal(await store.next("ROOM-B"), 2);
  assert.equal(await store.next("ROOM-C"), 1);
});

test("InMemory: current() returns 0 for a room that has never emitted", async () => {
  const store = new InMemoryRoomStateVersionStore();
  assert.equal(await store.current("ROOM-NEW"), 0);
});

test("InMemory: current() returns the last incremented value without incrementing", async () => {
  const store = new InMemoryRoomStateVersionStore();
  await store.next("ROOM-A"); // → 1
  await store.next("ROOM-A"); // → 2
  assert.equal(await store.current("ROOM-A"), 2);
  assert.equal(await store.current("ROOM-A"), 2); // still 2 after second peek
  assert.equal(await store.next("ROOM-A"), 3); // next() then increments
  assert.equal(await store.current("ROOM-A"), 3);
});

test("InMemory: _set helper lets tests force a counter value", async () => {
  const store = new InMemoryRoomStateVersionStore();
  store._set("ROOM-A", 100);
  assert.equal(await store.current("ROOM-A"), 100);
  assert.equal(await store.next("ROOM-A"), 101);
});

test("InMemory: _clear resets all counters", async () => {
  const store = new InMemoryRoomStateVersionStore();
  await store.next("ROOM-A");
  await store.next("ROOM-B");
  store._clear();
  assert.equal(await store.current("ROOM-A"), 0);
  assert.equal(await store.next("ROOM-A"), 1);
});

test("InMemory: concurrent next() calls yield unique monotonic values (Promise.all)", async () => {
  const store = new InMemoryRoomStateVersionStore();
  const promises = Array.from({ length: 50 }, () => store.next("ROOM-A"));
  const results = await Promise.all(promises);
  // Each result is unique
  assert.equal(new Set(results).size, 50, "all 50 results should be unique");
  // Result set is exactly 1..50
  assert.deepEqual(
    [...results].sort((a, b) => a - b),
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
});

// ── Redis-backed implementation (mocked) ────────────────────────────────────
//
// Vi tester Redis-pathen via en MOCK ioredis-klient. Det er trygt fordi
// kontraktens kritiske invariant (atomic INCR) er garantert av Redis selv;
// vi trenger bare verifisere at wrapperen sender riktige kommandoer og
// håndterer feil/edge-cases riktig.

function createMockRedis() {
  const state = new Map<string, number>();
  return {
    state,
    async incr(key: string): Promise<number> {
      const next = (state.get(key) ?? 0) + 1;
      state.set(key, next);
      return next;
    },
    async get(key: string): Promise<string | null> {
      const v = state.get(key);
      return v === undefined ? null : String(v);
    },
  };
}

test("Redis: next() uses Redis INCR and returns 1 on first call", async () => {
  const mock = createMockRedis();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new RedisRoomStateVersionStore({ redis: mock as any });
  assert.equal(await store.next("ROOM-A"), 1);
  assert.equal(mock.state.get("room-state-version:ROOM-A"), 1);
});

test("Redis: next() returns monotonically increasing values", async () => {
  const mock = createMockRedis();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new RedisRoomStateVersionStore({ redis: mock as any });
  assert.equal(await store.next("ROOM-A"), 1);
  assert.equal(await store.next("ROOM-A"), 2);
  assert.equal(await store.next("ROOM-A"), 3);
});

test("Redis: current() returns 0 when key does not exist in Redis", async () => {
  const mock = createMockRedis();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new RedisRoomStateVersionStore({ redis: mock as any });
  assert.equal(await store.current("ROOM-NEW"), 0);
});

test("Redis: current() reads from Redis without incrementing", async () => {
  const mock = createMockRedis();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new RedisRoomStateVersionStore({ redis: mock as any });
  await store.next("ROOM-A"); // → 1
  await store.next("ROOM-A"); // → 2
  assert.equal(await store.current("ROOM-A"), 2);
  assert.equal(await store.current("ROOM-A"), 2);
  assert.equal(mock.state.get("room-state-version:ROOM-A"), 2); // never incremented
});

test("Redis: survives instance restart by sharing Redis state", async () => {
  // Simulerer at to backend-instanser (eller restart av samme instans)
  // bruker samme Redis. Counter må fortsette monotonically.
  const mock = createMockRedis();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store1 = new RedisRoomStateVersionStore({ redis: mock as any });
  assert.equal(await store1.next("ROOM-A"), 1);
  assert.equal(await store1.next("ROOM-A"), 2);

  // Ny store-instans mot samme Redis (simulerer restart eller ny node)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store2 = new RedisRoomStateVersionStore({ redis: mock as any });
  // current() ser den eksisterende state-en
  assert.equal(await store2.current("ROOM-A"), 2);
  // next() fortsetter monotonically
  assert.equal(await store2.next("ROOM-A"), 3);
  // Begge store-instanser ser samme state via Redis
  assert.equal(await store1.current("ROOM-A"), 3);
});

test("Redis: uses configurable keyPrefix", async () => {
  const mock = createMockRedis();
  const store = new RedisRoomStateVersionStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: mock as any,
    keyPrefix: "custom-prefix:",
  });
  await store.next("ROOM-A");
  assert.equal(mock.state.get("custom-prefix:ROOM-A"), 1);
  assert.equal(mock.state.get("room-state-version:ROOM-A"), undefined);
});

test("Redis: current() handles non-numeric stored value gracefully (returns 0)", async () => {
  // Defense-in-depth: corruption / wrong-typed key returns 0 so we don't
  // crash the request flow.
  const mockRedis = {
    async get(_key: string): Promise<string | null> {
      return "not-a-number";
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new RedisRoomStateVersionStore({ redis: mockRedis as any });
  assert.equal(await store.current("ROOM-A"), 0);
});

test("Redis: next() throws when INCR returns invalid value", async () => {
  // Defense-in-depth: hvis Redis returnerer noe absurd som negative eller
  // ikke-heltall, kaster vi for å hindre caller fra å bruke ugyldig version.
  const mockRedis = {
    async incr(_key: string): Promise<number> {
      return -5;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new RedisRoomStateVersionStore({ redis: mockRedis as any });
  await assert.rejects(() => store.next("ROOM-A"), /INCR.*invalid.*-5/);
});
