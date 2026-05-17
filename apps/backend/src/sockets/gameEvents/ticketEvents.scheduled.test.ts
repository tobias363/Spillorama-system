/**
 * 2026-05-17 GoH 4x80 follow-up:
 *
 * Scheduled Spill 1 stores round/ticket state in Game1DrawEngineService + DB,
 * while `ticket:mark` historically called legacy BingoEngine.markNumber().
 * That made every live player mark fail with GAME_NOT_RUNNING even though
 * scheduled draw/pattern evaluation completed server-side.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Socket } from "socket.io";
import { registerTicketEvents } from "./ticketEvents.js";
import type { SocketContext } from "./context.js";
import type { GameEventsDeps } from "./deps.js";
import type { AckResponse } from "./types.js";
import type { RoomSnapshot } from "../../game/types.js";
import { DomainError } from "../../errors/DomainError.js";

interface MockSocket extends EventEmitter {
  id: string;
  data: { user?: { walletId?: string } };
}

function makeSocket(): MockSocket {
  const socket = new EventEmitter() as MockSocket;
  socket.id = "socket-1";
  socket.data = { user: { walletId: "wallet-1" } };
  return socket;
}

function legacySnapshot(): RoomSnapshot {
  return {
    code: "ROOM-LEGACY",
    hallId: "hall-1",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    createdAt: new Date("2026-05-17T10:00:00.000Z").toISOString(),
    players: [{ id: "p1", name: "Player 1", walletId: "wallet-1", balance: 0 }],
    gameHistory: [],
  } as unknown as RoomSnapshot;
}

function makeContext(opts: {
  authoritativeSnapshot: RoomSnapshot;
  validateScheduledGame1TicketMark?: (input: {
    roomCode: string;
    playerId: string;
    number: number;
  }) => Promise<boolean>;
  markNumber?: () => Promise<void>;
}): { socket: MockSocket; markCalls: { count: number }; register: () => void } {
  const socket = makeSocket();
  const markCalls = { count: 0 };
  const engine = {
    markNumber: async () => {
      markCalls.count += 1;
      await opts.markNumber?.();
    },
  };
  const deps = {
    validateScheduledGame1TicketMark: opts.validateScheduledGame1TicketMark,
  } as unknown as GameEventsDeps;

  const ctx = {
    socket: socket as unknown as Socket,
    deps,
    engine,
    io: {} as SocketContext["io"],
    platformService: {} as SocketContext["platformService"],
    logger: {
      child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as unknown as SocketContext["logger"],
    ackSuccess: <T>(callback: (response: AckResponse<T>) => void, data: T) => {
      callback({ ok: true, data });
    },
    ackFailure: <T>(callback: (response: AckResponse<T>) => void, error: unknown) => {
      callback({
        ok: false,
        error: {
          code: (error as { code?: string }).code ?? "UNKNOWN",
          message: (error as Error).message ?? "",
        },
      });
    },
    appendChatMessage: () => {},
    setLuckyNumber: () => {},
    getAuthenticatedSocketUser: async () =>
      ({ id: "u1", walletId: "wallet-1", role: "USER" }) as unknown as Awaited<
        ReturnType<SocketContext["getAuthenticatedSocketUser"]>
      >,
    assertUserCanActAsPlayer: () => {},
    assertUserCanAccessRoom: () => {},
    rateLimited: <P, R>(
      _event: string,
      handler: (payload: P, callback: (response: AckResponse<R>) => void) => Promise<void>,
    ) => {
      return (payload: P, callback: (response: AckResponse<R>) => void) => {
        void handler(payload, callback);
      };
    },
    requireAuthenticatedPlayerAction: async () => ({
      roomCode: opts.authoritativeSnapshot.code,
      playerId: "p1",
    }),
    resolveIdentityFromPayload: async () => ({
      playerName: "Player 1",
      walletId: "wallet-1",
      hallId: "hall-1",
    }),
  } as unknown as SocketContext;

  return {
    socket,
    markCalls,
    register: () => registerTicketEvents(ctx),
  };
}

function fireMark(socket: MockSocket, number: number): Promise<AckResponse<{ number: number; playerId: string }>> {
  return new Promise((resolve) => {
    socket.emit(
      "ticket:mark",
      {
        roomCode: "BINGO_DEMO_PILOT_GOH",
        accessToken: "token",
        playerId: "p1",
        number,
      },
      resolve,
    );
  });
}

test("scheduled Spill 1 ticket:mark validates DB-backed snapshot and skips legacy BingoEngine", async () => {
  const setup = makeContext({
    authoritativeSnapshot: {
      ...legacySnapshot(),
      code: "BINGO_DEMO_PILOT_GOH",
    },
    validateScheduledGame1TicketMark: async () => true,
  });
  setup.register();
  const markedEvents: unknown[] = [];
  setup.socket.on("ticket:marked", (payload) => markedEvents.push(payload));

  const ack = await fireMark(setup.socket, 39);

  assert.equal(ack.ok, true);
  assert.deepEqual(ack.data, { number: 39, playerId: "p1" });
  assert.equal(setup.markCalls.count, 0, "scheduled path must not call legacy BingoEngine.markNumber");
  assert.deepEqual(markedEvents, [
    { roomCode: "BINGO_DEMO_PILOT_GOH", playerId: "p1", number: 39 },
  ]);
});

test("scheduled Spill 1 ticket:mark rejects undrawn numbers without falling back to legacy", async () => {
  const setup = makeContext({
    authoritativeSnapshot: legacySnapshot(),
    validateScheduledGame1TicketMark: async () => {
      throw new DomainError("NUMBER_NOT_DRAWN", "Tallet er ikke trukket ennå.");
    },
  });
  setup.register();

  const ack = await fireMark(setup.socket, 40);

  assert.equal(ack.ok, false);
  assert.equal(ack.error?.code, "NUMBER_NOT_DRAWN");
  assert.equal(setup.markCalls.count, 0, "scheduled validation errors must not fall back");
});

test("non-scheduled ticket:mark keeps legacy BingoEngine path", async () => {
  const setup = makeContext({ authoritativeSnapshot: legacySnapshot() });
  setup.register();

  const ack = await fireMark(setup.socket, 39);

  assert.equal(ack.ok, true);
  assert.equal(setup.markCalls.count, 1);
});
