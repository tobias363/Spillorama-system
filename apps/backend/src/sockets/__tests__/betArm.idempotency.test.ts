/**
 * BIN-813 R5: Integration test verifying that `bet:arm` deduplicates
 * via `clientRequestId`. Setup mirrorer claimEvents.idempotency.test.ts:
 * minimalt mock-rigg som registrerer registerRoomEvents og emitter
 * `bet:arm` flere ganger med samme `clientRequestId`. Påser at engine-
 * sideeffekter (disarmPlayer/armPlayer) kalles KUN ÉN GANG ved replay.
 *
 * Bruker `armed: false` (disarm)-pathen siden den krever færre dep-mocks
 * enn arm-pathen. Dedupe-logikken er event-navn-basert og uavhengig av
 * payload-shape, så `armed: false`-replay-dedupe beviser at wrapper-en
 * også vil blokkere `armed: true`-replays.
 *
 * Akseptanse-test (mandate §5 R5):
 *   1. Same clientRequestId 3x → handler runs ÉN gang.
 *   2. Same payload uten clientRequestId 3x → handler runs 3 ganger
 *      (legacy-fallback uendret).
 *   3. Tre ulike clientRequestIds → handler runs 3 ganger.
 *   4. Hvis socketIdempotencyStore mangler i deps → handler runs 3
 *      ganger (test-harness backward-compat).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Server, Socket } from "socket.io";
import { registerRoomEvents } from "../gameEvents/roomEvents.js";
import type { SocketContext } from "../gameEvents/context.js";
import type { GameEventsDeps } from "../gameEvents/deps.js";
import type { RoomSnapshot } from "../../game/types.js";
import { InMemorySocketIdempotencyStore } from "../SocketIdempotencyStore.js";

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
  getDisarmCalls: () => number;
  getEmitRoomUpdateCalls: () => number;
  registerHandler: () => void;
}

/**
 * Build a minimal SocketContext + GameEventsDeps that lets `bet:arm`
 * (disarm path) execute through the registered handler. We mock only what
 * the disarm branch touches:
 *   - releasePreRoundReservation (no-op via missing walletAdapter)
 *   - disarmPlayer (counted)
 *   - getWalletIdForPlayer (returns null → skips refreshPlayerBalancesForWallet)
 *   - emitRoomUpdate (counted)
 *
 * Everything else is left undefined — TS wouldn't allow that with
 * `GameEventsDeps`, so we use `as unknown as GameEventsDeps` after building
 * the keys we know the disarm path reads.
 */
function setup(opts: { withIdempotency?: boolean } = {}): TestSetup {
  const socket = makeSocket();
  let disarmCalls = 0;
  let emitRoomUpdateCalls = 0;

  const snapshot = {
    code: "ROOM-1",
    hallId: "hall-1",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    createdAt: new Date().toISOString(),
    players: [{ id: "p1", name: "P", walletId: "wallet-1", balance: 0 }],
    currentGame: undefined,
    gameHistory: [],
  } as unknown as RoomSnapshot;

  const engine = {
    getRoomSnapshot: () => snapshot,
    refreshPlayerBalancesForWallet: async () => {},
  };

  const io = {
    to: () => ({
      emit: () => {},
    }),
  } as unknown as Server;

  const deps = {
    emitRoomUpdate: async () => {
      emitRoomUpdateCalls++;
      return snapshot;
    },
    buildRoomUpdatePayload: (s: RoomSnapshot) => s,
    enforceSingleRoomPerHall: false,
    getPrimaryRoomForHall: () => null,
    findPlayerInRoomByWallet: () => null,
    armPlayer: () => {},
    disarmPlayer: () => {
      disarmCalls++;
    },
    getArmedPlayerSelections: () => ({}),
    getArmedPlayerIds: () => [],
    getArmedPlayerTicketCounts: () => ({}),
    getRoomConfiguredEntryFee: () => 0,
    getWalletIdForPlayer: () => null,
    getReservationId: () => null,
    clearReservationId: () => {},
    getVariantConfig: () => null,
    cancelPreRoundTicket: undefined,
    walletAdapter: undefined,
    getLossStateSnapshot: undefined,
    emitWalletLossState: undefined,
    roomConfiguredEntryFeeByRoom: new Map<string, number>(),
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
      ) => Promise<void> | void,
    ) => {
      return (
        p: P,
        cb: (r: { ok: boolean; data?: R; error?: { code: string; message: string } }) => void,
      ) => {
        const result = handler(p, cb);
        if (result instanceof Promise) {
          // Surface unhandled rejections so tests fail loudly rather than
          // silently passing on a bug in the wrapped handler.
          result.catch((err) => {
            // eslint-disable-next-line no-console
            console.error("rateLimited handler rejected:", err);
            throw err;
          });
        }
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
    getDisarmCalls: () => disarmCalls,
    getEmitRoomUpdateCalls: () => emitRoomUpdateCalls,
    registerHandler: () => registerRoomEvents(ctx),
  };
}

function fireBetArm(
  socket: MockSocket,
  payload: { roomCode: string; armed: boolean; clientRequestId?: string },
): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    socket.emit("bet:arm", payload, resolve);
  });
}

test("bet:arm dedupes 3 identical reconnect-replay events", async () => {
  const env = setup({ withIdempotency: true });
  env.registerHandler();

  const acks: unknown[] = [];
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  for (let i = 0; i < 3; i++) {
    acks.push(
      await fireBetArm(env.socket, { roomCode: "ROOM-1", armed: false, clientRequestId: uuid }),
    );
    await new Promise<void>((r) => setImmediate(r));
  }

  // CRITICAL: disarmPlayer side-effect must run EXACTLY ONCE.
  assert.equal(env.getDisarmCalls(), 1, "disarmPlayer called exactly once across 3 replays");

  // CRITICAL: emitRoomUpdate (room broadcast) must run EXACTLY ONCE.
  assert.equal(env.getEmitRoomUpdateCalls(), 1, "emitRoomUpdate called exactly once");

  // All 3 acks should be returned (cached on retries 2 and 3).
  assert.equal(acks.length, 3, "all 3 callers got ack");
  assert.deepEqual(acks[0], acks[1], "ack 2 matches ack 1");
  assert.deepEqual(acks[1], acks[2], "ack 3 matches ack 2");
});

test("bet:arm without clientRequestId — handler runs every time (legacy)", async () => {
  const env = setup({ withIdempotency: true });
  env.registerHandler();

  for (let i = 0; i < 3; i++) {
    await fireBetArm(env.socket, { roomCode: "ROOM-1", armed: false });
    await new Promise<void>((r) => setImmediate(r));
  }

  assert.equal(
    env.getDisarmCalls(),
    3,
    "without clientRequestId, handler runs every time (legacy fallback)",
  );
});

test("bet:arm with different clientRequestIds — handler runs each time", async () => {
  const env = setup({ withIdempotency: true });
  env.registerHandler();

  const uuids = [
    "550e8400-e29b-41d4-a716-446655440000",
    "660e8400-e29b-41d4-a716-446655440001",
    "770e8400-e29b-41d4-a716-446655440002",
  ];
  for (const u of uuids) {
    await fireBetArm(env.socket, { roomCode: "ROOM-1", armed: false, clientRequestId: u });
    await new Promise<void>((r) => setImmediate(r));
  }

  assert.equal(env.getDisarmCalls(), 3, "different clientRequestIds → 3 handler runs");
});

test("bet:arm without idempotency-store in deps — handler runs every time", async () => {
  const env = setup({ withIdempotency: false });
  env.registerHandler();

  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  for (let i = 0; i < 3; i++) {
    await fireBetArm(env.socket, { roomCode: "ROOM-1", armed: false, clientRequestId: uuid });
    await new Promise<void>((r) => setImmediate(r));
  }

  // No store → wrapper skipped, handler runs every time. Test-harness
  // backward-compat: existing tests that omit `socketIdempotencyStore`
  // from deps continue to work.
  assert.equal(env.getDisarmCalls(), 3, "no store → no dedupe");
});

// ── Redis-failure scenario (fail-soft semantics) ─────────────────────────

test("bet:arm with failing idempotency store — handler runs (fail-soft)", async () => {
  /**
   * Documented decision: when `store.claim()` throws (Redis nede),
   * `withSocketIdempotency` logs and runs the handler WITHOUT dedupe.
   * Wallet-laget (BIN-761→764) er fortsatt idempotent som defense-in-depth,
   * så double-spend forblir umulig selv med Redis-utfall.
   *
   * Alternatively kunne vi fail-closed (avvise alle requests når Redis er
   * nede), men det ville ta ned hele live-rommet på en transient Redis-glitch.
   * Pilot-prioritering: tilgjengelighet > strict idempotency på socket-laget.
   */
  const failingStore = {
    claim: async () => {
      throw new Error("Redis connection lost");
    },
    store: async () => {},
    release: async () => {},
  };
  const socket = makeSocket();
  let disarmCalls = 0;

  const snapshot = {
    code: "ROOM-1",
    hallId: "hall-1",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    createdAt: new Date().toISOString(),
    players: [],
    currentGame: undefined,
    gameHistory: [],
  } as unknown as RoomSnapshot;

  const engine = {
    getRoomSnapshot: () => snapshot,
    refreshPlayerBalancesForWallet: async () => {},
  };
  const io = { to: () => ({ emit: () => {} }) } as unknown as Server;
  const deps = {
    emitRoomUpdate: async () => snapshot,
    buildRoomUpdatePayload: (s: RoomSnapshot) => s,
    enforceSingleRoomPerHall: false,
    getPrimaryRoomForHall: () => null,
    findPlayerInRoomByWallet: () => null,
    armPlayer: () => {},
    disarmPlayer: () => {
      disarmCalls++;
    },
    getArmedPlayerSelections: () => ({}),
    getArmedPlayerIds: () => [],
    getArmedPlayerTicketCounts: () => ({}),
    getRoomConfiguredEntryFee: () => 0,
    getWalletIdForPlayer: () => null,
    getReservationId: () => null,
    clearReservationId: () => {},
    getVariantConfig: () => null,
    walletAdapter: undefined,
    getLossStateSnapshot: undefined,
    emitWalletLossState: undefined,
    roomConfiguredEntryFeeByRoom: new Map<string, number>(),
    socketIdempotencyStore: failingStore,
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
      ) => Promise<void> | void,
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

  registerRoomEvents(ctx);

  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  for (let i = 0; i < 3; i++) {
    await fireBetArm(socket, { roomCode: "ROOM-1", armed: false, clientRequestId: uuid });
    await new Promise<void>((r) => setImmediate(r));
  }

  // Store kaster → wrapper kjører handler uten dedupe → handler kalt 3 ganger.
  // Wallet-laget (deterministisk reservation-id) er fortsatt idempotent.
  assert.equal(disarmCalls, 3, "fail-soft: handler runs every time when store throws");
});
