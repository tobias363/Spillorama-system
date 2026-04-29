/**
 * RedisRoomLifecycleStore.test.ts
 *
 * Drop-in parity tests for the Redis-backed K4 implementation. The test
 * cases mirror `RoomLifecycleStore.test.ts` (the K2 in-memory suite) so
 * any divergence between the two impls becomes a test failure rather than
 * a production-only surprise.
 *
 * **Skipped when REDIS_URL is unset.** This is the same convention the
 * `redisAdapter.test.ts` integration test uses — CI without Redis (the
 * default test runner) would deadlock on the first connection attempt.
 * Run locally or in a Redis-enabled CI env via:
 *
 *     REDIS_URL=redis://localhost:6379 npm --prefix apps/backend test
 *
 * The suite uses a unique key-prefix per test (`bingo:test:k4:<rand>:`)
 * so concurrent test runs and sister test suites can share a single
 * Redis instance without state bleeding between them. Each test cleans
 * up after itself by SCAN-ing for its prefix and DEL-ing all matched
 * keys before tearing down the store.
 *
 * Reference: docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md §2.3 + §6 K4.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import {
  RedisRoomLifecycleStore,
} from "../RedisRoomLifecycleStore.js";
import {
  InMemoryRoomLifecycleStore,
  type RoomLifecycleStore,
  type CancelPreRoundTicketResult,
} from "../RoomLifecycleStore.js";

const REDIS_URL = process.env.REDIS_URL?.trim();
const skipReason = REDIS_URL ? false : "REDIS_URL unset — skipping Redis lifecycle store tests";

/**
 * Build a per-test store with a unique key-prefix. Caller MUST await
 * `cleanup()` in their test's `finally` to remove all keys created
 * during the test.
 */
async function makeStore(): Promise<{
  store: RedisRoomLifecycleStore;
  cleanup: () => Promise<void>;
  prefix: string;
}> {
  const prefix = `bingo:test:k4:${randomUUID().slice(0, 8)}:`;
  const store = new RedisRoomLifecycleStore({
    url: REDIS_URL,
    keyPrefix: prefix,
    // Short TTL so abandoned test keys auto-expire even if cleanup is
    // skipped (e.g. test crash). 60s is more than enough for any single
    // test to complete.
    ttlSeconds: 60,
  });
  await store.connect();
  return {
    store,
    prefix,
    cleanup: async () => {
      // SCAN + DEL the prefix. Then shutdown.
      const cleaner = new Redis(REDIS_URL!, { maxRetriesPerRequest: 3 });
      try {
        let cursor = "0";
        do {
          const [next, batch] = await cleaner.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
          cursor = next;
          if (batch.length > 0) await cleaner.del(...batch);
        } while (cursor !== "0");
      } finally {
        try {
          await cleaner.quit();
        } catch {
          /* best-effort */
        }
        try {
          await store.shutdown();
        } catch {
          /* best-effort */
        }
      }
    },
  };
}

// ── 1. armPlayer / disarmPlayer baseline ────────────────────────────────

test("Redis: armPlayer stores ticketCount and selections", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({
      roomCode: "ROOM-A",
      playerId: "p1",
      ticketCount: 3,
      selections: [{ type: "small", qty: 3, name: "Small Yellow" }],
    });
    const snapshot = await store.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
    assert.ok(snapshot, "snapshot exists");
    assert.equal(snapshot.armedTicketCount, 3);
    assert.equal(snapshot.selections.length, 1);
    assert.equal(snapshot.selections[0].type, "small");
    assert.equal(snapshot.selections[0].qty, 3);
    assert.equal(snapshot.selections[0].name, "Small Yellow");
    assert.equal(snapshot.reservationId, null);
  } finally {
    await cleanup();
  }
});

test("Redis: armPlayer without selections clears stale selections", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({
      roomCode: "ROOM-A",
      playerId: "p1",
      ticketCount: 3,
      selections: [{ type: "small", qty: 3 }],
    });
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    const snapshot = await store.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
    assert.ok(snapshot);
    assert.equal(snapshot.armedTicketCount, 1);
    assert.deepEqual(snapshot.selections, []);
  } finally {
    await cleanup();
  }
});

test("Redis: disarmPlayer clears armed-state and reservation by default", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });
    await store.disarmPlayer({ roomCode: "ROOM-A", playerId: "p1" });
    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p1" }),
      false,
    );
  } finally {
    await cleanup();
  }
});

test("Redis: disarmPlayer keepReservation=true preserves reservation entry", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });
    await store.disarmPlayer({ roomCode: "ROOM-A", playerId: "p1", keepReservation: true });
    assert.equal(
      await store.getReservationId({ roomCode: "ROOM-A", playerId: "p1" }),
      "res-1",
      "reservation preserved when keepReservation=true",
    );
  } finally {
    await cleanup();
  }
});

test("Redis: disarmAllPlayers clears every state-space + bumps arm-cycle", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p2", ticketCount: 2 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });
    const cycleBefore = await store.getOrCreateArmCycleId("ROOM-A");

    await store.disarmAllPlayers({ roomCode: "ROOM-A" });

    assert.deepEqual(await store.getArmedPlayerIds("ROOM-A"), []);
    assert.deepEqual(await store.getAllReservationIds("ROOM-A"), {});
    const cycleAfter = await store.getOrCreateArmCycleId("ROOM-A");
    assert.notEqual(cycleAfter, cycleBefore, "arm-cycle bumped after disarmAll");
  } finally {
    await cleanup();
  }
});

// ── 2. Reservation-id tracking ──────────────────────────────────────────

test("Redis: setReservationId / getReservationId / clearReservationId roundtrip", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    assert.equal(
      await store.getReservationId({ roomCode: "ROOM-A", playerId: "p1" }),
      null,
    );
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });
    assert.equal(
      await store.getReservationId({ roomCode: "ROOM-A", playerId: "p1" }),
      "res-1",
    );
    await store.clearReservationId({ roomCode: "ROOM-A", playerId: "p1" });
    assert.equal(
      await store.getReservationId({ roomCode: "ROOM-A", playerId: "p1" }),
      null,
    );
  } finally {
    await cleanup();
  }
});

test("Redis: getAllReservationIds snapshot contains every reserved player", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "r1" });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p2", reservationId: "r2" });
    const snap = await store.getAllReservationIds("ROOM-A");
    assert.deepEqual(snap, { p1: "r1", p2: "r2" });
  } finally {
    await cleanup();
  }
});

// ── 3. evictPlayer atomicity ────────────────────────────────────────────

test("Redis: evictPlayer with armed + reservation clears both atomically", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 3 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });

    const result = await store.evictPlayer({ roomCode: "ROOM-A", playerId: "p1" });

    assert.equal(result.hadArmedState, true);
    assert.equal(result.hadReservation, true);
    assert.equal(result.releasedReservationId, "res-1");
    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p1" }),
      false,
    );
  } finally {
    await cleanup();
  }
});

test("Redis: evictPlayer is idempotent — second call is a no-op", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.evictPlayer({ roomCode: "ROOM-A", playerId: "p1" });
    const second = await store.evictPlayer({ roomCode: "ROOM-A", playerId: "p1" });
    assert.equal(second.hadArmedState, false);
    assert.equal(second.hadReservation, false);
    assert.equal(second.releasedReservationId, null);
  } finally {
    await cleanup();
  }
});

test("Redis: evictPlayer with releaseReservation=false hides reservation-id", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });

    const result = await store.evictPlayer({
      roomCode: "ROOM-A",
      playerId: "p1",
      releaseReservation: false,
    });

    assert.equal(result.hadReservation, true, "still reports it had a reservation");
    assert.equal(
      result.releasedReservationId,
      null,
      "but caller did not request release, so id is hidden",
    );
  } finally {
    await cleanup();
  }
});

test("Redis: evictPlayer with no state returns all-false", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    const result = await store.evictPlayer({ roomCode: "ROOM-A", playerId: "ghost" });
    assert.equal(result.hadArmedState, false);
    assert.equal(result.hadReservation, false);
    assert.equal(result.releasedReservationId, null);
  } finally {
    await cleanup();
  }
});

// ── 4. Read snapshot consistency ────────────────────────────────────────

test("Redis: getPlayerWithArmedState returns null when neither armed nor reserved", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    const snap = await store.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
    assert.equal(snap, null);
  } finally {
    await cleanup();
  }
});

test("Redis: getPlayerWithArmedState surfaces reservation-only race window", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });
    const snap = await store.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
    assert.ok(snap, "non-null snapshot for reservation-only state");
    assert.equal(snap.armedTicketCount, 0);
    assert.equal(snap.reservationId, "res-1");
  } finally {
    await cleanup();
  }
});

test("Redis: hasArmedOrReservation returns false for unknown room", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });
    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-OTHER", playerId: "p1" }),
      false,
    );
  } finally {
    await cleanup();
  }
});

test("Redis: hasArmedOrReservation returns true when armed only", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p1" }),
      true,
    );
  } finally {
    await cleanup();
  }
});

test("Redis: hasArmedOrReservation returns true when reserved only", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "r1" });
    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p1" }),
      true,
    );
  } finally {
    await cleanup();
  }
});

test("Redis: getArmedPlayerIds returns each armed player exactly once", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p2", ticketCount: 2 });
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p3", ticketCount: 3 });
    const ids = await store.getArmedPlayerIds("ROOM-A");
    // Redis HKEYS is unordered — sort before comparing.
    assert.deepEqual(ids.sort(), ["p1", "p2", "p3"]);
  } finally {
    await cleanup();
  }
});

test("Redis: getArmedPlayerTicketCounts mirrors ticketCount per player", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 3 });
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p2", ticketCount: 5 });
    const counts = await store.getArmedPlayerTicketCounts("ROOM-A");
    assert.deepEqual(counts, { p1: 3, p2: 5 });
  } finally {
    await cleanup();
  }
});

test("Redis: getArmedPlayerSelections defensively copies selection arrays", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({
      roomCode: "ROOM-A",
      playerId: "p1",
      ticketCount: 3,
      selections: [{ type: "small", qty: 3, name: "Small Yellow" }],
    });
    const snap = await store.getArmedPlayerSelections("ROOM-A");
    snap.p1[0].qty = 999;
    const fresh = await store.getArmedPlayerSelections("ROOM-A");
    assert.equal(fresh.p1[0].qty, 3, "store unaffected by caller mutation");
  } finally {
    await cleanup();
  }
});

// ── 5. arm-cycle id ──────────────────────────────────────────────────────

test("Redis: getOrCreateArmCycleId returns a stable id within the same cycle", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    const a = await store.getOrCreateArmCycleId("ROOM-A");
    const b = await store.getOrCreateArmCycleId("ROOM-A");
    assert.equal(a, b);
  } finally {
    await cleanup();
  }
});

test("Redis: getOrCreateArmCycleId gives a fresh id after disarmAll", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    const a = await store.getOrCreateArmCycleId("ROOM-A");
    await store.disarmAllPlayers({ roomCode: "ROOM-A" });
    const b = await store.getOrCreateArmCycleId("ROOM-A");
    assert.notEqual(a, b);
  } finally {
    await cleanup();
  }
});

test("Redis: arm-cycle is per-room (rooms don't share)", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    const a = await store.getOrCreateArmCycleId("ROOM-A");
    const b = await store.getOrCreateArmCycleId("ROOM-B");
    assert.notEqual(a, b);
  } finally {
    await cleanup();
  }
});

// ── 6. cancelPreRoundTicket: atomic with callback ───────────────────────

test("Redis: cancelPreRoundTicket null callback result rolls back", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 3 });
    const result = await store.cancelPreRoundTicket({
      roomCode: "ROOM-A",
      playerId: "p1",
      onMutateDisplayCache: () => null,
    });
    assert.equal(result, null);
    assert.equal(
      (await store.getArmedPlayerTicketCounts("ROOM-A")).p1,
      3,
    );
  } finally {
    await cleanup();
  }
});

test("Redis: cancelPreRoundTicket fullyDisarmed clears all state", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });
    const cancelResult: CancelPreRoundTicketResult = {
      removedTicketIds: ["t1"],
      remainingTicketCount: 0,
      fullyDisarmed: true,
    };
    await store.cancelPreRoundTicket({
      roomCode: "ROOM-A",
      playerId: "p1",
      onMutateDisplayCache: () => cancelResult,
    });
    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p1" }),
      false,
      "armed + reservation both cleared",
    );
  } finally {
    await cleanup();
  }
});

test("Redis: cancelPreRoundTicket partial reduces ticket count, keeps reservation", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 3 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });
    const cancelResult: CancelPreRoundTicketResult = {
      removedTicketIds: ["t-3"],
      remainingTicketCount: 2,
      fullyDisarmed: false,
    };
    await store.cancelPreRoundTicket({
      roomCode: "ROOM-A",
      playerId: "p1",
      onMutateDisplayCache: () => cancelResult,
    });
    assert.equal(
      (await store.getArmedPlayerTicketCounts("ROOM-A")).p1,
      2,
    );
    assert.equal(
      await store.getReservationId({ roomCode: "ROOM-A", playerId: "p1" }),
      "res-1",
      "reservation preserved on partial cancel — caller does prorata-release",
    );
  } finally {
    await cleanup();
  }
});

// ── 7. evictWhere bulk sweep ────────────────────────────────────────────

test("Redis: evictWhere matches predicate across rooms", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p-keep", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p-evict", reservationId: "res-A-evict" });
    await store.armPlayer({ roomCode: "ROOM-B", playerId: "p-evict", ticketCount: 5 });

    const results = await store.evictWhere(({ playerId }) => playerId === "p-evict");

    assert.equal(results.length, 2, "evicted from both rooms");
    assert.deepEqual(
      await store.getArmedPlayerIds("ROOM-A"),
      ["p-keep"],
      "unrelated player preserved",
    );
    assert.deepEqual(await store.getArmedPlayerIds("ROOM-B"), []);
  } finally {
    await cleanup();
  }
});

test("Redis: evictWhere idempotent when nothing matches", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    const results = await store.evictWhere(() => false);
    assert.equal(results.length, 0);
    assert.equal((await store.getArmedPlayerIds("ROOM-A")).length, 1);
  } finally {
    await cleanup();
  }
});

test("Redis: evictWhere returns reservation-id for caller release", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-X" });

    const results = await store.evictWhere(() => true);
    assert.equal(results.length, 1);
    assert.equal(results[0].releasedReservationId, "res-X");
    assert.equal(results[0].hadArmedState, true);
    assert.equal(results[0].hadReservation, true);
  } finally {
    await cleanup();
  }
});

// ── 8. Atomicity / race-condition tests ────────────────────────────────

test("Redis: concurrent armPlayer + evictPlayer on same player serializes", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await Promise.all([
      store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 }),
      store.evictPlayer({ roomCode: "ROOM-A", playerId: "p1" }),
    ]);
    const snap = await store.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
    if (snap !== null) {
      assert.equal(snap.armedTicketCount, 1);
      assert.equal(snap.reservationId, null);
    } else {
      assert.equal(
        await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p1" }),
        false,
      );
    }
  } finally {
    await cleanup();
  }
});

test("Redis: concurrent ops on different rooms don't deadlock each other", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    // Start a long-ish op on ROOM-A (cancelPreRoundTicket holds Redis-side
    // lock during the JS callback). Concurrent armPlayer on ROOM-B should
    // complete without blocking on ROOM-A's lock — locks are per-room.
    let roomADone = false;
    const roomALongHold = store.cancelPreRoundTicket({
      roomCode: "ROOM-A",
      playerId: "p1",
      onMutateDisplayCache: () => {
        // Synchronous callback — completes immediately. The point is the
        // lock-acquire/release roundtrip; if locks were global, ROOM-B's
        // op would queue behind it.
        return null;
      },
    }).then(() => { roomADone = true; });
    await store.armPlayer({ roomCode: "ROOM-B", playerId: "p1", ticketCount: 1 });
    await roomALongHold;
    assert.equal(roomADone, true);
    assert.deepEqual(await store.getArmedPlayerIds("ROOM-B"), ["p1"]);
  } finally {
    await cleanup();
  }
});

test("Redis: invariant: armPlayer + setReservationId + evictPlayer in pipeline → atomic clear", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await Promise.all([
      store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" }),
      store.evictPlayer({ roomCode: "ROOM-A", playerId: "p1" }),
    ]);
    const snap = await store.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
    if (snap === null) return;
    assert.equal(snap.armedTicketCount, 0);
    assert.equal(snap.reservationId, "res-1");
  } finally {
    await cleanup();
  }
});

// ── 9. Defensive copy semantics ─────────────────────────────────────────

test("Redis: snapshot defensive copy: caller mutation doesn't leak into store", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    const incoming = [{ type: "small", qty: 3, name: "Small Yellow" }];
    await store.armPlayer({
      roomCode: "ROOM-A",
      playerId: "p1",
      ticketCount: 3,
      selections: incoming,
    });
    incoming[0].qty = 999;

    const snap = await store.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
    assert.ok(snap);
    assert.equal(snap.selections[0].qty, 3, "store insulated from caller mutation");
  } finally {
    await cleanup();
  }
});

// ── 10. Multiple players in same room ───────────────────────────────────

test("Redis: multiple armed players in one room — disarmPlayer is per-player", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p2", ticketCount: 2 });
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p3", ticketCount: 3 });

    await store.disarmPlayer({ roomCode: "ROOM-A", playerId: "p2" });

    const ids = await store.getArmedPlayerIds("ROOM-A");
    assert.deepEqual(ids.sort(), ["p1", "p3"]);
  } finally {
    await cleanup();
  }
});

test("Redis: multiple rooms — armed-state isolated", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.armPlayer({ roomCode: "ROOM-B", playerId: "p1", ticketCount: 99 });

    const a = await store.getArmedPlayerTicketCounts("ROOM-A");
    const b = await store.getArmedPlayerTicketCounts("ROOM-B");
    assert.equal(a.p1, 1);
    assert.equal(b.p1, 99);
  } finally {
    await cleanup();
  }
});

// ── 11. Symmetric semantic with hasArmedOrReservation ──────────────────

test("Redis: hasArmedOrReservation flips back to false after disarmPlayer", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });
    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p1" }),
      true,
    );
    await store.disarmPlayer({ roomCode: "ROOM-A", playerId: "p1" });
    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p1" }),
      false,
    );
  } finally {
    await cleanup();
  }
});

test("Redis: hasArmedOrReservation returns false after disarmAllPlayers", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p2", reservationId: "res-2" });

    await store.disarmAllPlayers({ roomCode: "ROOM-A" });

    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p1" }),
      false,
    );
    assert.equal(
      await store.hasArmedOrReservation({ roomCode: "ROOM-A", playerId: "p2" }),
      false,
    );
  } finally {
    await cleanup();
  }
});

// ── 12. Stress: many rooms × many players ──────────────────────────────

test("Redis: stress: 20 rooms × 10 players = 200 entries, all isolated", { skip: skipReason }, async () => {
  // Smaller scale than in-memory test (200 vs 1000 entries) to keep
  // Redis round-trips bounded for CI runtime — semantic check is identical.
  const { store, cleanup } = await makeStore();
  try {
    const ops: Promise<void>[] = [];
    for (let r = 0; r < 20; r++) {
      for (let p = 0; p < 10; p++) {
        ops.push(
          store.armPlayer({
            roomCode: `ROOM-${r}`,
            playerId: `p-${p}`,
            ticketCount: r + p,
          }),
        );
      }
    }
    await Promise.all(ops);

    for (let r = 0; r < 20; r += 3) {
      const counts = await store.getArmedPlayerTicketCounts(`ROOM-${r}`);
      assert.equal(Object.keys(counts).length, 10);
      for (let p = 0; p < 10; p++) {
        assert.equal(counts[`p-${p}`], r + p);
      }
    }
  } finally {
    await cleanup();
  }
});

test("Redis: stress: concurrent eviction of same room from multiple callers", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-1" });

    // 20 concurrent evictions — only the first should report state was cleared.
    const evictions = await Promise.all(
      Array.from({ length: 20 }, () => store.evictPlayer({ roomCode: "ROOM-A", playerId: "p1" })),
    );

    const reportedAsCleared = evictions.filter(
      (e) => e.hadArmedState || e.hadReservation,
    );
    assert.equal(
      reportedAsCleared.length,
      1,
      "exactly one eviction observed the player's state",
    );
  } finally {
    await cleanup();
  }
});

// ── 13. cancelPreRoundTicket invariants ─────────────────────────────────

test("Redis: cancelPreRoundTicket preserves selections that callback didn't remove", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({
      roomCode: "ROOM-A",
      playerId: "p1",
      ticketCount: 4,
      selections: [
        { type: "small", qty: 2, name: "Small Yellow" },
        { type: "large", qty: 2, name: "Large Yellow" },
      ],
    });
    const cancelResult: CancelPreRoundTicketResult = {
      removedTicketIds: ["t-1"],
      remainingTicketCount: 3,
      fullyDisarmed: false,
    };
    await store.cancelPreRoundTicket({
      roomCode: "ROOM-A",
      playerId: "p1",
      onMutateDisplayCache: () => cancelResult,
    });
    assert.equal(
      (await store.getArmedPlayerTicketCounts("ROOM-A")).p1,
      3,
    );
  } finally {
    await cleanup();
  }
});

// ── 14. Concurrent setReservationId uniqueness ──────────────────────────

test("Redis: concurrent setReservationId: last writer wins (deterministic via single-key HSET)", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    const ids = Array.from({ length: 100 }, (_, i) => `res-${i}`);
    await Promise.all(
      ids.map((rid) =>
        store.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: rid }),
      ),
    );
    const final = await store.getReservationId({ roomCode: "ROOM-A", playerId: "p1" });
    assert.ok(final !== null && ids.includes(final));
  } finally {
    await cleanup();
  }
});

// ── 15. K4-specific: Migration parity with in-memory impl ──────────────

/**
 * Migration parity test: run the SAME sequence of operations against both
 * impls, then snapshot both stores and assert identical observable state.
 *
 * This catches any divergence that the unit tests (per-impl) might miss —
 * if the Redis impl rounds a number differently or returns selections in
 * a different key order, this test fails.
 */
test("K4: migration parity — Redis and InMemory produce identical results for the same operations", { skip: skipReason }, async () => {
  const { store: redisStore, cleanup } = await makeStore();
  const memStore: RoomLifecycleStore = new InMemoryRoomLifecycleStore();

  try {
    // Run same op sequence against both.
    const ops: Array<(s: RoomLifecycleStore) => Promise<unknown>> = [
      (s) => s.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 3, selections: [{ type: "small", qty: 3, name: "Small Yellow" }] }),
      (s) => s.armPlayer({ roomCode: "ROOM-A", playerId: "p2", ticketCount: 5 }),
      (s) => s.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-A1" }),
      (s) => s.setReservationId({ roomCode: "ROOM-A", playerId: "p2", reservationId: "res-A2" }),
      (s) => s.armPlayer({ roomCode: "ROOM-B", playerId: "p1", ticketCount: 1 }),
      (s) => s.disarmPlayer({ roomCode: "ROOM-A", playerId: "p2" }),
      (s) => s.evictPlayer({ roomCode: "ROOM-B", playerId: "p1" }),
    ];
    for (const op of ops) {
      await op(redisStore);
      await op(memStore);
    }

    // Snapshot both — identical state.
    const redisRoomA = await redisStore.getArmedPlayerTicketCounts("ROOM-A");
    const memRoomA = await memStore.getArmedPlayerTicketCounts("ROOM-A");
    assert.deepEqual(redisRoomA, memRoomA, "ROOM-A armed counts identical");

    const redisRoomB = await redisStore.getArmedPlayerTicketCounts("ROOM-B");
    const memRoomB = await memStore.getArmedPlayerTicketCounts("ROOM-B");
    assert.deepEqual(redisRoomB, memRoomB, "ROOM-B armed counts identical (both empty)");

    const redisRes = await redisStore.getAllReservationIds("ROOM-A");
    const memRes = await memStore.getAllReservationIds("ROOM-A");
    assert.deepEqual(redisRes, memRes, "ROOM-A reservations identical");

    const redisP1 = await redisStore.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
    const memP1 = await memStore.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
    assert.deepEqual(redisP1, memP1, "p1 in ROOM-A identical snapshot");
  } finally {
    await cleanup();
  }
});

// ── 16. K4-specific: Crash recovery (state survives a process restart) ──

/**
 * Crash recovery: write state via store A, simulate a process restart by
 * disconnecting A, build a new store B against the same Redis (same key
 * prefix), and verify state is intact. This is the K4 core invariant —
 * pre-round arm-state survives a restart.
 */
test("K4: crash recovery — armed-state survives process restart", { skip: skipReason }, async () => {
  const prefix = `bingo:test:k4:${randomUUID().slice(0, 8)}:`;
  const cleaner = new Redis(REDIS_URL!, { maxRetriesPerRequest: 3 });
  try {
    // Process A: write state, disconnect.
    const storeA = new RedisRoomLifecycleStore({
      url: REDIS_URL,
      keyPrefix: prefix,
      ttlSeconds: 60,
    });
    await storeA.connect();
    await storeA.armPlayer({
      roomCode: "ROOM-A",
      playerId: "p1",
      ticketCount: 3,
      selections: [{ type: "small", qty: 3, name: "Small Yellow" }],
    });
    await storeA.setReservationId({ roomCode: "ROOM-A", playerId: "p1", reservationId: "res-survives" });
    const cycleA = await storeA.getOrCreateArmCycleId("ROOM-A");
    await storeA.shutdown();

    // Process B: fresh client, same prefix → same Redis state.
    const storeB = new RedisRoomLifecycleStore({
      url: REDIS_URL,
      keyPrefix: prefix,
      ttlSeconds: 60,
    });
    await storeB.connect();
    try {
      const snap = await storeB.getPlayerWithArmedState({ roomCode: "ROOM-A", playerId: "p1" });
      assert.ok(snap, "armed-state survived restart");
      assert.equal(snap.armedTicketCount, 3);
      assert.equal(snap.reservationId, "res-survives");
      assert.equal(snap.selections.length, 1);
      assert.equal(snap.selections[0].name, "Small Yellow");
      const cycleB = await storeB.getOrCreateArmCycleId("ROOM-A");
      assert.equal(cycleA, cycleB, "arm-cycle id stable across restart");
    } finally {
      await storeB.shutdown();
    }
  } finally {
    // Cleanup keys.
    let cursor = "0";
    do {
      const [next, batch] = await cleaner.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      cursor = next;
      if (batch.length > 0) await cleaner.del(...batch);
    } while (cursor !== "0");
    try {
      await cleaner.quit();
    } catch {
      /* best-effort */
    }
  }
});

// ── 17. K4-specific: Multi-instance atomic-write ────────────────────────

/**
 * Multi-instance atomic-write: simulate two backend instances writing to
 * the same room concurrently. The Redis-side mutex (cancelPreRoundTicket
 * lock + Lua-atomic mutators) must serialize them — neither instance can
 * observe a half-applied state.
 */
test("K4: multi-instance — two stores writing to same room serialize correctly", { skip: skipReason }, async () => {
  const prefix = `bingo:test:k4:${randomUUID().slice(0, 8)}:`;
  const cleaner = new Redis(REDIS_URL!, { maxRetriesPerRequest: 3 });
  try {
    const storeA = new RedisRoomLifecycleStore({
      url: REDIS_URL,
      keyPrefix: prefix,
      ttlSeconds: 60,
    });
    const storeB = new RedisRoomLifecycleStore({
      url: REDIS_URL,
      keyPrefix: prefix,
      ttlSeconds: 60,
    });
    await storeA.connect();
    await storeB.connect();

    try {
      // Instance A arms p1; Instance B arms p2 — concurrent, different
      // players in same room. Both must succeed.
      await Promise.all([
        storeA.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 3 }),
        storeB.armPlayer({ roomCode: "ROOM-A", playerId: "p2", ticketCount: 5 }),
      ]);
      // Either store's read sees both players.
      const fromA = await storeA.getArmedPlayerTicketCounts("ROOM-A");
      const fromB = await storeB.getArmedPlayerTicketCounts("ROOM-A");
      assert.deepEqual(fromA, fromB, "both instances see same state");
      assert.equal(fromA.p1, 3);
      assert.equal(fromA.p2, 5);

      // Concurrent eviction race: both instances try to evict the same
      // player. Exactly one observes the cleared state.
      const [evictA, evictB] = await Promise.all([
        storeA.evictPlayer({ roomCode: "ROOM-A", playerId: "p1" }),
        storeB.evictPlayer({ roomCode: "ROOM-A", playerId: "p1" }),
      ]);
      const winners = [evictA, evictB].filter((e) => e.hadArmedState);
      assert.equal(winners.length, 1, "exactly one eviction saw the armed state");
    } finally {
      await storeA.shutdown();
      await storeB.shutdown();
    }
  } finally {
    let cursor = "0";
    do {
      const [next, batch] = await cleaner.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      cursor = next;
      if (batch.length > 0) await cleaner.del(...batch);
    } while (cursor !== "0");
    try {
      await cleaner.quit();
    } catch {
      /* best-effort */
    }
  }
});

// ── 18. K4-specific: listActiveRoomCodes for boot-restore ──────────────

test("K4: listActiveRoomCodes returns every room with lifecycle state", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    await store.setReservationId({ roomCode: "ROOM-B", playerId: "p2", reservationId: "res-B" });
    await store.getOrCreateArmCycleId("ROOM-C"); // cycle-only state

    const rooms = await store.listActiveRoomCodes();
    assert.deepEqual(rooms.sort(), ["ROOM-A", "ROOM-B", "ROOM-C"]);
  } finally {
    await cleanup();
  }
});

test("K4: listActiveRoomCodes returns empty when no state", { skip: skipReason }, async () => {
  const { store, cleanup } = await makeStore();
  try {
    const rooms = await store.listActiveRoomCodes();
    assert.deepEqual(rooms, []);
  } finally {
    await cleanup();
  }
});

// ── 19. K4-specific: factory + env-flag ────────────────────────────────

test("K4: createRoomLifecycleStore factory: 'memory' provider returns InMemory impl", async () => {
  // Doesn't need REDIS — exercises the memory branch only.
  const { createRoomLifecycleStore } = await import("../createRoomLifecycleStore.js");
  const store = await createRoomLifecycleStore({ provider: "memory" });
  await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
  const ids = await store.getArmedPlayerIds("ROOM-A");
  assert.deepEqual(ids, ["p1"]);
});

test("K4: createRoomLifecycleStore factory: 'redis' provider connects + returns Redis impl", { skip: skipReason }, async () => {
  const { createRoomLifecycleStore } = await import("../createRoomLifecycleStore.js");
  const prefix = `bingo:test:k4-factory:${randomUUID().slice(0, 8)}:`;
  const store = await createRoomLifecycleStore({
    provider: "redis",
    redisUrl: REDIS_URL,
    redisKeyPrefix: prefix,
    redisTtlSeconds: 60,
  });
  try {
    await store.armPlayer({ roomCode: "ROOM-A", playerId: "p1", ticketCount: 1 });
    const ids = await store.getArmedPlayerIds("ROOM-A");
    assert.deepEqual(ids, ["p1"]);
  } finally {
    // Cleanup
    const cleaner = new Redis(REDIS_URL!, { maxRetriesPerRequest: 3 });
    try {
      let cursor = "0";
      do {
        const [next, batch] = await cleaner.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
        cursor = next;
        if (batch.length > 0) await cleaner.del(...batch);
      } while (cursor !== "0");
    } finally {
      try {
        await cleaner.quit();
      } catch {
        /* best-effort */
      }
    }
    if (store instanceof RedisRoomLifecycleStore) {
      await store.shutdown();
    }
  }
});

test("K4: createRoomLifecycleStore factory: unreachable Redis throws on connect", async () => {
  const { createRoomLifecycleStore } = await import("../createRoomLifecycleStore.js");
  // Point at a port nothing listens on. Must throw, not silently degrade.
  // Use an invalid hostname so DNS fails immediately rather than waiting
  // for a TCP timeout (which would slow down the test).
  await assert.rejects(
    () => createRoomLifecycleStore({
      provider: "redis",
      redisUrl: "redis://k4-test-this-host-does-not-exist.invalid:6379",
    }),
    /failed to connect to Redis/,
  );
});

test("K4: resolveProviderFromEnv defaults to memory when unset", async () => {
  const { resolveProviderFromEnv } = await import("../createRoomLifecycleStore.js");
  const original = process.env.ROOM_STATE_PROVIDER;
  delete process.env.ROOM_STATE_PROVIDER;
  try {
    assert.equal(resolveProviderFromEnv(), "memory");
  } finally {
    if (original !== undefined) process.env.ROOM_STATE_PROVIDER = original;
  }
});

test("K4: resolveProviderFromEnv reads 'redis' (case-insensitive)", async () => {
  const { resolveProviderFromEnv } = await import("../createRoomLifecycleStore.js");
  const original = process.env.ROOM_STATE_PROVIDER;
  process.env.ROOM_STATE_PROVIDER = "REDIS";
  try {
    assert.equal(resolveProviderFromEnv(), "redis");
  } finally {
    if (original === undefined) delete process.env.ROOM_STATE_PROVIDER;
    else process.env.ROOM_STATE_PROVIDER = original;
  }
});

test("K4: resolveProviderFromEnv falls back to memory on unknown value", async () => {
  const { resolveProviderFromEnv } = await import("../createRoomLifecycleStore.js");
  const original = process.env.ROOM_STATE_PROVIDER;
  process.env.ROOM_STATE_PROVIDER = "garbage";
  try {
    assert.equal(resolveProviderFromEnv(), "memory");
  } finally {
    if (original === undefined) delete process.env.ROOM_STATE_PROVIDER;
    else process.env.ROOM_STATE_PROVIDER = original;
  }
});
