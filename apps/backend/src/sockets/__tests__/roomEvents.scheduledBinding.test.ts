import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Server, Socket } from "socket.io";
import { registerRoomEvents } from "../gameEvents/roomEvents.js";
import type { SocketContext } from "../gameEvents/context.js";
import type { GameEventsDeps } from "../gameEvents/deps.js";
import type { RoomSnapshot } from "../../game/types.js";
import { DomainError } from "../../errors/DomainError.js";

interface MockSocket extends EventEmitter {
  id: string;
  joinedRooms: string[];
  join(room: string): void;
}

function makeSocket(): MockSocket {
  const socket = new EventEmitter() as MockSocket;
  socket.id = "socket-1";
  socket.joinedRooms = [];
  socket.join = (room: string) => {
    socket.joinedRooms.push(room);
  };
  return socket;
}

function makeSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "BINGO_HALL-1",
    hallId: "hall-1",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    scheduledGameId: "sg-1",
    createdAt: new Date(0).toISOString(),
    players: [{ id: "p1", name: "Player", walletId: "wallet-1", balance: 0 }],
    gameHistory: [],
    ...overrides,
  };
}

function makeCtx(snapshot: RoomSnapshot): {
  socket: MockSocket;
  attachCalls: Array<{ roomCode: string; playerId: string; socketId: string }>;
  authoritativeCalls: string[];
} {
  const socket = makeSocket();
  const attachCalls: Array<{ roomCode: string; playerId: string; socketId: string }> = [];
  const authoritativeCalls: string[] = [];

  const engine = {
    getRoomSnapshot: () => snapshot,
    attachPlayerSocket: (roomCode: string, playerId: string, socketId: string) => {
      attachCalls.push({ roomCode, playerId, socketId });
    },
  };

  const deps = {
    emitRoomUpdate: async () => snapshot,
    buildRoomUpdatePayload: (roomSnapshot: RoomSnapshot) => ({ ...roomSnapshot }),
    enforceSingleRoomPerHall: false,
    getPrimaryRoomForHall: () => null,
    findPlayerInRoomByWallet: () => null,
    roomConfiguredEntryFeeByRoom: new Map<string, number>(),
    getAuthoritativeRoomSnapshot: async (roomCode: string) => {
      authoritativeCalls.push(roomCode);
      return snapshot;
    },
  } as unknown as GameEventsDeps;

  const ctx = {
    socket: socket as unknown as Socket,
    engine: engine as unknown as SocketContext["engine"],
    io: { to: () => ({ emit: () => {} }) } as unknown as Server,
    deps,
    platformService: {} as SocketContext["platformService"],
    logger: {
      child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as unknown as SocketContext["logger"],
    ackSuccess<T>(cb: (r: { ok: true; data: T }) => void, data: T) {
      cb({ ok: true, data });
    },
    ackFailure<T>(
      cb: (r: { ok: false; error: { code: string; message: string } }) => void,
      err: unknown,
    ) {
      const error = err instanceof DomainError
        ? { code: err.code, message: err.message }
        : { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) };
      cb({ ok: false, error } as never);
    },
    rateLimited<P>(
      _event: string,
      handler: (payload: P, cb: (response: unknown) => void) => Promise<void>,
    ) {
      return (payload: P, cb: (response: unknown) => void) => {
        handler(payload, cb).catch((err) => {
          cb({ ok: false, error: { code: "INTERNAL_ERROR", message: String(err) } });
        });
      };
    },
    getAuthenticatedSocketUser: async () => ({ id: "u1", walletId: "wallet-1" }),
    assertUserCanAccessRoom: () => {},
    requireAuthenticatedPlayerAction: async (payload: { roomCode?: string }) => ({
      roomCode: (payload.roomCode ?? "BINGO_HALL-1").toUpperCase(),
      playerId: "p1",
    }),
    resolveIdentityFromPayload: async () => ({
      playerName: "Player",
      walletId: "wallet-1",
      hallId: "hall-1",
    }),
    assertUserCanActAsPlayer: () => {},
    appendChatMessage: () => {},
    setLuckyNumber: () => {},
  } as unknown as SocketContext;

  registerRoomEvents(ctx);
  return { socket, attachCalls, authoritativeCalls };
}

function invoke(
  socket: MockSocket,
  event: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: unknown) => {
      resolve(response as { ok: boolean; data?: unknown; error?: { code: string; message: string } });
    });
  });
}

test("room:state rejects scheduled Spill 1 room without scheduledGameId", async () => {
  const { socket, authoritativeCalls } = makeCtx(makeSnapshot());

  const response = await invoke(socket, "room:state", { roomCode: "BINGO_HALL-1" });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "SCHEDULED_GAME_REQUIRED");
  assert.deepEqual(authoritativeCalls, [], "must reject before authoritative snapshot lookup");
});

test("room:state rejects scheduled Spill 1 room when scheduledGameId mismatches", async () => {
  const { socket, authoritativeCalls } = makeCtx(makeSnapshot());

  const response = await invoke(socket, "room:state", {
    roomCode: "BINGO_HALL-1",
    scheduledGameId: "sg-other",
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "SCHEDULED_GAME_MISMATCH");
  assert.deepEqual(authoritativeCalls, [], "must reject before authoritative snapshot lookup");
});

test("room:state allows scheduled Spill 1 room when scheduledGameId matches", async () => {
  const { socket, authoritativeCalls } = makeCtx(makeSnapshot());

  const response = await invoke(socket, "room:state", {
    roomCode: "BINGO_HALL-1",
    scheduledGameId: "sg-1",
  });

  assert.equal(response.ok, true);
  assert.deepEqual(authoritativeCalls, ["BINGO_HALL-1"]);
});

test("room:resume rejects scheduled Spill 1 mismatch before socket attach", async () => {
  const { socket, attachCalls } = makeCtx(makeSnapshot());

  const response = await invoke(socket, "room:resume", {
    roomCode: "BINGO_HALL-1",
    scheduledGameId: "sg-other",
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "SCHEDULED_GAME_MISMATCH");
  assert.deepEqual(attachCalls, []);
});

test("room:resume allows scheduled Spill 1 room when scheduledGameId matches", async () => {
  const { socket, attachCalls } = makeCtx(makeSnapshot());

  const response = await invoke(socket, "room:resume", {
    roomCode: "BINGO_HALL-1",
    scheduledGameId: "sg-1",
  });

  assert.equal(response.ok, true);
  assert.deepEqual(attachCalls, [
    { roomCode: "BINGO_HALL-1", playerId: "p1", socketId: "socket-1" },
  ]);
});
