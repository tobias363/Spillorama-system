/**
 * BIN-813 R5: Integration test verifying that `claim:submit` deduplicates
 * via `clientRequestId`. Setup mirrorer claimEvents.test.ts men inkluderer
 * `socketIdempotencyStore` i deps slik at wrapper-en aktiveres.
 *
 * Akseptanse-test: simulér 3 identiske `claim:submit` med samme
 * `clientRequestId` → engine.submitClaim kalles KUN én gang, alle 3 acks
 * får samme `snapshot`-data, og `pattern:won` emittes KUN én gang.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Server, Socket } from "socket.io";
import { registerClaimEvents } from "../gameEvents/claimEvents.js";
import type { SocketContext } from "../gameEvents/context.js";
import type { GameEventsDeps } from "../gameEvents/deps.js";
import type { ClaimRecord, RoomSnapshot } from "../../game/types.js";
import { InMemorySocketIdempotencyStore } from "../SocketIdempotencyStore.js";

interface CapturedEmit {
  channel: "room" | "socket";
  room?: string;
  event: string;
  payload: unknown;
}

interface MockSocket extends EventEmitter {
  id: string;
  data: { user?: { walletId?: string } };
}

function makeSocket(walletId = "wallet-1"): MockSocket {
  const ee = new EventEmitter() as MockSocket;
  ee.id = "socket-1";
  ee.data = { user: { walletId } };
  return ee;
}

interface TestSetup {
  socket: MockSocket;
  ioEmits: CapturedEmit[];
  getSubmitClaimCalls: () => number;
  registerHandler: () => void;
}

function setup(opts: { gameSlug?: string; valid?: boolean; withIdempotency?: boolean } = {}): TestSetup {
  const socket = makeSocket();
  const ioEmits: CapturedEmit[] = [];
  let submitClaimCalls = 0;
  const gameSlug = opts.gameSlug ?? "bingo";
  const valid = opts.valid ?? true;

  const snapshot = {
    code: "ROOM-1",
    hallId: "hall-1",
    hostPlayerId: "p1",
    gameSlug,
    createdAt: new Date().toISOString(),
    players: [{ id: "p1", name: "P", walletId: "wallet-1", balance: 0 }],
    currentGame: {
      id: "game-1",
      status: "RUNNING",
      patternResults: valid
        ? [
            {
              patternId: "p-bingo",
              patternName: "Bingo",
              claimType: "BINGO",
              isWon: true,
              winnerId: "p1",
              wonAtDraw: 3,
              payoutAmount: 100,
              claimId: "claim-1",
            },
          ]
        : [],
    },
    gameHistory: [],
  } as unknown as RoomSnapshot;

  const engine = {
    submitClaim: async () => {
      submitClaimCalls++;
      return {
        id: "claim-1",
        playerId: "p1",
        type: "BINGO",
        valid,
        payoutAmount: valid ? 100 : undefined,
        createdAt: new Date().toISOString(),
      } as ClaimRecord;
    },
    activateMiniGame: () => null,
    activateJackpot: () => null,
    getRoomSnapshot: () => snapshot,
  };

  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        ioEmits.push({ channel: "room", room, event, payload });
      },
    }),
  } as unknown as Server;

  const deps = {
    emitRoomUpdate: async () => snapshot,
    socketIdempotencyStore: opts.withIdempotency
      ? new InMemorySocketIdempotencyStore()
      : undefined,
  } as unknown as GameEventsDeps;

  const ctx: SocketContext = {
    socket: socket as unknown as Socket,
    engine: engine as unknown as SocketContext["engine"],
    io,
    deps,
    platformService: {} as SocketContext["platformService"],
    logger: {
      child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as unknown as SocketContext["logger"],
    ackSuccess: <T>(cb: (r: { ok: true; data: T }) => void, data: T) => {
      cb({ ok: true, data });
    },
    ackFailure: <T>(
      cb: (r: { ok: false; error: { code: string; message: string } }) => void,
      error: unknown,
    ) => {
      cb({
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
      handler: (
        p: P,
        cb: (r: { ok: boolean; data?: R; error?: { code: string; message: string } }) => void,
      ) => Promise<void>,
    ) => {
      return (
        p: P,
        cb: (r: { ok: boolean; data?: R; error?: { code: string; message: string } }) => void,
      ) => {
        void handler(p, cb);
      };
    },
    requireAuthenticatedPlayerAction: async () => ({ roomCode: "ROOM-1", playerId: "p1" }),
    resolveIdentityFromPayload: async () => ({
      playerName: "P",
      walletId: "wallet-1",
      hallId: "hall-1",
    }),
  } as unknown as SocketContext;

  return {
    socket,
    ioEmits,
    getSubmitClaimCalls: () => submitClaimCalls,
    registerHandler: () => registerClaimEvents(ctx),
  };
}

function fireClaim(
  socket: MockSocket,
  payload: { roomCode: string; type: "BINGO" | "LINE"; clientRequestId?: string },
): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    socket.emit("claim:submit", payload, resolve);
  });
}

test("claim:submit dedupes 3 identical reconnect-replay events", async () => {
  const env = setup({ withIdempotency: true });
  env.registerHandler();

  const acks: unknown[] = [];
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  // Simulate reconnect-replay: 3 identical events fired sequentially.
  for (let i = 0; i < 3; i++) {
    acks.push(await fireClaim(env.socket, { roomCode: "ROOM-1", type: "BINGO", clientRequestId: uuid }));
    await new Promise<void>((r) => setImmediate(r));
  }

  // CRITICAL: engine.submitClaim must be called EXACTLY ONCE.
  assert.equal(env.getSubmitClaimCalls(), 1, "engine.submitClaim called exactly once");

  // CRITICAL: pattern:won emitted EXACTLY ONCE.
  const patternWonEmits = env.ioEmits.filter((e) => e.event === "pattern:won");
  assert.equal(patternWonEmits.length, 1, "pattern:won emitted exactly once");

  // All 3 acks should have been received.
  assert.equal(acks.length, 3, "all 3 callers got ack");

  // Acks should be identical (cached).
  assert.deepEqual(acks[0], acks[1], "ack 2 matches ack 1");
  assert.deepEqual(acks[1], acks[2], "ack 3 matches ack 2");
});

test("claim:submit without clientRequestId — handler runs every time (legacy)", async () => {
  const env = setup({ withIdempotency: true, valid: false });
  env.registerHandler();

  const acks: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    acks.push(await fireClaim(env.socket, { roomCode: "ROOM-1", type: "BINGO" }));
    await new Promise<void>((r) => setImmediate(r));
  }

  assert.equal(env.getSubmitClaimCalls(), 3, "without clientRequestId, handler runs every time");
  assert.equal(acks.length, 3);
});

test("claim:submit without idempotency-store in deps — handler runs every time", async () => {
  const env = setup({ withIdempotency: false, valid: false });
  env.registerHandler();

  const acks: unknown[] = [];
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  for (let i = 0; i < 3; i++) {
    acks.push(
      await fireClaim(env.socket, { roomCode: "ROOM-1", type: "BINGO", clientRequestId: uuid }),
    );
    await new Promise<void>((r) => setImmediate(r));
  }

  // Even with clientRequestId, no dedupe happens because deps.socketIdempotencyStore
  // is undefined → wrapper not applied.
  assert.equal(env.getSubmitClaimCalls(), 3, "no store → no dedupe");
});

test("claim:submit with different clientRequestIds — handler runs each time", async () => {
  const env = setup({ withIdempotency: true });
  env.registerHandler();

  const acks: unknown[] = [];
  const uuids = [
    "550e8400-e29b-41d4-a716-446655440000",
    "660e8400-e29b-41d4-a716-446655440001",
    "770e8400-e29b-41d4-a716-446655440002",
  ];
  for (const u of uuids) {
    acks.push(await fireClaim(env.socket, { roomCode: "ROOM-1", type: "BINGO", clientRequestId: u }));
    await new Promise<void>((r) => setImmediate(r));
  }
  assert.equal(env.getSubmitClaimCalls(), 3, "different clientRequestIds → 3 handler runs");
});
