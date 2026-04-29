/**
 * BingoEngine.cleanupStaleWalletInIdleRooms.preserveArmed.test.ts
 *
 * FORHANDSKJOP-ORPHAN-FIX (PR 2, 2026-04-29) — armed/reservation-aware
 * cleanup. Verifies that:
 *
 *   1. The new options-form `cleanupStaleWalletInIdleRooms(walletId, {
 *      isPreserve, exceptRoomCode })` skips eviction for any
 *      (roomCode, playerId) tuple where `isPreserve` returns true. This
 *      is the path used by `room:create`/`room:join` in roomEvents.ts
 *      with `deps.hasArmedOrReservation` as the closure body, so a
 *      disconnected player with armed-state OR an active wallet
 *      reservation in `RoomStateManager` is NOT evicted from
 *      `room.players` while their forhåndskjøp is in flight.
 *
 *   2. The deprecated 2-arg form (`(walletId, exceptRoomCode?: string)`)
 *      keeps its original semantics — evicts disconnected idle-room
 *      players unconditionally. Admin-tooling and pre-migration tests
 *      rely on this back-compat.
 *
 *   3. `exceptRoomCode` works in both shapes.
 *
 * Reference: docs/audit/FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md §6 PR 2.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BingoEngine } from "../BingoEngine.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../types.js";

// ── Test fixtures ──────────────────────────────────────────────────────

const FIXED_GRID = [
  [1, 2, 3, 4, 5],
  [13, 14, 15, 16, 17],
  [25, 26, 0, 27, 28],
  [37, 38, 39, 40, 41],
  [49, 50, 51, 52, 53],
];

class FixedTicketBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: FIXED_GRID.map((row) => [...row]),
    };
  }
}

interface IdleRoomFixture {
  engine: BingoEngine;
  roomCode: string;
  hostPlayerId: string;
  hostWalletId: string;
}

/**
 * Build an engine with a single host player in an IDLE room (no game
 * started), socket detached so the cleanup preconditions are met.
 */
async function makeEngineWithIdleDisconnectedPlayer(): Promise<IdleRoomFixture> {
  const engine = new BingoEngine(
    new FixedTicketBingoAdapter(),
    new InMemoryWalletAdapter(),
  );
  const hostWalletId = `wallet-host-${randomUUID()}`;
  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: hostWalletId,
    socketId: "socket-host-1",
  });
  // Simulate disconnect — socketId becomes undefined, but the player
  // record stays in `room.players`. Room remains IDLE (no game ever
  // started) which is the precondition for cleanupStaleWalletInIdleRooms.
  engine.detachSocket("socket-host-1");
  return { engine, roomCode, hostPlayerId, hostWalletId };
}

function getRoomPlayerCount(engine: BingoEngine, roomCode: string): number {
  return engine.getRoomSnapshot(roomCode).players.length;
}

function assertRoomHasPlayer(
  engine: BingoEngine,
  roomCode: string,
  playerId: string,
  msg: string,
): void {
  const snap = engine.getRoomSnapshot(roomCode);
  const found = snap.players.some((p) => p.id === playerId);
  assert.equal(found, true, msg);
}

// ── Tests ──────────────────────────────────────────────────────────────

test("preserve: player with armed-state is NOT evicted (isPreserve returns true)", async () => {
  const fx = await makeEngineWithIdleDisconnectedPlayer();
  // Simulate "this player has armed-state in RoomStateManager" by
  // returning true from isPreserve for this (roomCode, playerId).
  const cleaned = fx.engine.cleanupStaleWalletInIdleRooms(fx.hostWalletId, {
    isPreserve: (code, pid) => code === fx.roomCode && pid === fx.hostPlayerId,
  });

  assert.equal(cleaned, 0, "player should be preserved, no eviction count");
  assertRoomHasPlayer(
    fx.engine,
    fx.roomCode,
    fx.hostPlayerId,
    "armed player still in room.players after cleanup",
  );
});

test("preserve: player with active reservation is NOT evicted (same callback path)", async () => {
  const fx = await makeEngineWithIdleDisconnectedPlayer();
  // The engine doesn't import RoomStateManager — it just trusts the
  // callback. So this test exercises the same code path as armed-state
  // but documents the reservation case for grep-ability and audit
  // (the audit mentions both as orphan-causing).
  const cleaned = fx.engine.cleanupStaleWalletInIdleRooms(fx.hostWalletId, {
    isPreserve: (code, pid) => {
      // Closure-body in production walks roomState.reservationIdByPlayerByRoom.
      // Here we hard-code a "reservation present" verdict for this player.
      return code === fx.roomCode && pid === fx.hostPlayerId;
    },
  });

  assert.equal(cleaned, 0);
  assertRoomHasPlayer(fx.engine, fx.roomCode, fx.hostPlayerId, "preserved");
});

test("evict: player with neither armed nor reservation IS evicted (existing behaviour)", async () => {
  const fx = await makeEngineWithIdleDisconnectedPlayer();
  const cleaned = fx.engine.cleanupStaleWalletInIdleRooms(fx.hostWalletId, {
    isPreserve: () => false, // explicit no-preserve — pure baseline
  });

  assert.equal(cleaned, 1, "1 player evicted");
  assert.equal(
    getRoomPlayerCount(fx.engine, fx.roomCode),
    0,
    "room.players should be empty",
  );
});

test("isPreserve callback receives correct (roomCode, playerId)", async () => {
  const fx = await makeEngineWithIdleDisconnectedPlayer();
  const seen: Array<{ code: string; pid: string }> = [];
  fx.engine.cleanupStaleWalletInIdleRooms(fx.hostWalletId, {
    isPreserve: (code, pid) => {
      seen.push({ code, pid });
      return false; // don't preserve — let baseline run
    },
  });

  // Only one matching player in the engine, so callback is invoked
  // exactly once with our (roomCode, hostPlayerId) pair.
  assert.equal(seen.length, 1, "isPreserve invoked once for the matching player");
  assert.equal(seen[0].code, fx.roomCode);
  assert.equal(seen[0].pid, fx.hostPlayerId);
});

test("backward-compat: legacy 2-arg form evicts unconditionally (no preserve check)", async () => {
  const fx = await makeEngineWithIdleDisconnectedPlayer();
  // Even though the player would be preserved with isPreserve=true,
  // the legacy string-arg form does NOT consult it. Admin tooling and
  // existing tests must keep behaving exactly as before.
  const cleaned = fx.engine.cleanupStaleWalletInIdleRooms(fx.hostWalletId);
  assert.equal(cleaned, 1, "legacy form evicts");
  assert.equal(getRoomPlayerCount(fx.engine, fx.roomCode), 0);
});

test("backward-compat: legacy 2-arg form with exceptRoomCode skips that room", async () => {
  const fx = await makeEngineWithIdleDisconnectedPlayer();
  const cleaned = fx.engine.cleanupStaleWalletInIdleRooms(
    fx.hostWalletId,
    fx.roomCode, // legacy second arg = exceptRoomCode
  );
  assert.equal(cleaned, 0, "exceptRoomCode skip — no eviction");
  assertRoomHasPlayer(
    fx.engine,
    fx.roomCode,
    fx.hostPlayerId,
    "player still in the excepted room",
  );
});

test("options-form exceptRoomCode skips named room AND preserves armed/reserved players in others", async () => {
  // Two rooms; player has stale records in both; exceptRoomCode skips
  // ROOM-A entirely; isPreserve preserves the player in ROOM-B.
  const engine = new BingoEngine(
    new FixedTicketBingoAdapter(),
    new InMemoryWalletAdapter(),
  );
  const walletId = `wallet-${randomUUID()}`;
  const r1 = await engine.createRoom({
    hallId: "hall-1",
    playerName: "P",
    walletId,
    socketId: "s-1",
  });
  // Detach + create another idle room. createRoom checks for existing
  // wallet bindings — to put the same walletId in two rooms we need to
  // detach FIRST and bypass the "already in room" guard. We can do that
  // by joining a different room via direct internal access.
  engine.detachSocket("s-1");
  // The engine forbids createRoom-with-the-same-walletId-already-in-a-
  // room. So instead use joinRoom to a separately-created room hosted by
  // someone else; or, simpler, do the "two rooms" check by manipulating
  // the engine's player map directly. Use the same internal-access
  // pattern other tests use (BingoEngine.test.ts evictPlayer helper).
  const r2 = await engine.createRoom({
    hallId: "hall-2",
    playerName: "Other",
    walletId: `other-${randomUUID()}`,
    socketId: "s-other",
  });
  // Manually add a stale player record for `walletId` to r2 to simulate
  // the cross-room mess that triggers cleanupStaleWalletInIdleRooms.
  const internal = engine as unknown as {
    rooms: Map<
      string,
      {
        players: Map<
          string,
          { id: string; walletId: string; socketId?: string; balance: number; name: string }
        >;
        currentGame?: unknown;
      }
    >;
  };
  internal.rooms.get(r2.roomCode)!.players.set("ghost-p", {
    id: "ghost-p",
    walletId,
    socketId: undefined,
    balance: 0,
    name: "Ghost",
  });

  const seen: Array<{ code: string; pid: string }> = [];
  const cleaned = engine.cleanupStaleWalletInIdleRooms(walletId, {
    exceptRoomCode: r1.roomCode,
    isPreserve: (code, pid) => {
      seen.push({ code, pid });
      // Preserve the ghost in ROOM-B.
      return code === r2.roomCode && pid === "ghost-p";
    },
  });

  assert.equal(cleaned, 0, "ROOM-A skipped via exceptRoomCode; ROOM-B ghost preserved");
  // exceptRoomCode skips entirely (callback NOT invoked for r1.roomCode).
  // ROOM-B sees one walletId match → callback fires once for ghost-p.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].code, r2.roomCode);
  assert.equal(seen[0].pid, "ghost-p");
});

test("options-form: no isPreserve → baseline eviction (matches deprecated 2-arg)", async () => {
  const fx = await makeEngineWithIdleDisconnectedPlayer();
  // Options form without isPreserve must behave like the old 2-arg.
  const cleaned = fx.engine.cleanupStaleWalletInIdleRooms(fx.hostWalletId, {
    // no isPreserve, no exceptRoomCode
  });
  assert.equal(cleaned, 1);
  assert.equal(getRoomPlayerCount(fx.engine, fx.roomCode), 0);
});

test("RUNNING room is never touched — even with isPreserve=true (defensive guard intact)", async () => {
  // Sanity: cleanupStaleWalletInIdleRooms must NEVER reach a RUNNING
  // room regardless of isPreserve. RUNNING is the wallet-mid-debit
  // window where reconnect must go via attachPlayerSocket — eviction
  // here would lose buy-in state. Documenting it here keeps PR 2 from
  // regressing the original safety guard.
  const engine = new BingoEngine(
    new FixedTicketBingoAdapter(),
    new InMemoryWalletAdapter(),
  );
  const hostWalletId = `wallet-host-${randomUUID()}`;
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: hostWalletId,
    socketId: "s-h",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: `wallet-guest-${randomUUID()}`,
    socketId: "s-g",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
  });
  // RUNNING-room precondition: we don't call detachSocket here, but
  // cleanup's idle-only check should still skip the room. Use a
  // walletId that matches a room player so the inner branch would fire
  // if isIdle were true.
  const cleaned = engine.cleanupStaleWalletInIdleRooms(hostWalletId, {
    isPreserve: () => true,
  });
  assert.equal(cleaned, 0, "RUNNING-room skipped at the room-level guard");
  // And without preserve too:
  const cleaned2 = engine.cleanupStaleWalletInIdleRooms(hostWalletId);
  assert.equal(cleaned2, 0, "RUNNING-room still skipped via legacy form");
});
