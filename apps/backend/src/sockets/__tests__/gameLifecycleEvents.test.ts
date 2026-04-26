/**
 * Bølge D coverage: socket-event `game:start` + `game:end`.
 *
 * Dekker:
 *   - game:start happy path videresender til engine.startGame
 *   - game:start uten ticketsPerPlayer bruker default = min(hallLimit, autoRoundTicketsPerPlayer)
 *   - game:start TICKETS_ABOVE_HALL_LIMIT når over hall.maxTicketsPerPlayer
 *   - game:start INVALID_TICKETS_PER_PLAYER ved utenfor 1-30 range
 *   - game:start kaller disarmAllPlayers + clearDisplayTicketCache i success-path
 *   - game:start engine.startGame kaster → ack failure
 *   - game:end happy path videresender reason
 *   - game:end uten reason: undefined sendes til engine
 *   - game:end engine.endGame kaster → ack failure
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Socket } from "socket.io";
import { registerGameLifecycleEvents } from "../gameEvents/gameLifecycleEvents.js";
import type { SocketContext } from "../gameEvents/context.js";
import type { GameEventsDeps, BingoSchedulerSettings } from "../gameEvents/deps.js";
import type { RoomSnapshot } from "../../game/types.js";
import { DomainError } from "../../game/BingoEngine.js";

interface MockSocket extends EventEmitter {
  id: string;
}

function makeSocket(): MockSocket {
  const ee = new EventEmitter() as MockSocket;
  ee.id = "socket-1";
  return ee;
}

interface CtxOptions {
  startGameThrows?: Error;
  endGameThrows?: Error;
  hallMaxTicketsPerPlayer?: number;
  autoRoundTicketsPerPlayer?: number;
  configuredEntryFee?: number;
  variantInfo?: { gameType: string; config: unknown };
}

function makeCtx(opts: CtxOptions = {}): {
  ctx: SocketContext;
  socket: MockSocket;
  startGameCalls: Array<{ ticketsPerPlayer: number; entryFee: number }>;
  endGameCalls: Array<{ reason?: string }>;
  disarmAllCalls: string[];
  clearCacheCalls: string[];
  emitRoomUpdateCalls: string[];
} {
  const socket = makeSocket();
  const startGameCalls: Array<{ ticketsPerPlayer: number; entryFee: number }> = [];
  const endGameCalls: Array<{ reason?: string }> = [];
  const disarmAllCalls: string[] = [];
  const clearCacheCalls: string[] = [];
  const emitRoomUpdateCalls: string[] = [];

  const settings: BingoSchedulerSettings = {
    autoRoundStartEnabled: false,
    autoRoundStartIntervalMs: 0,
    autoRoundMinPlayers: 1,
    autoRoundTicketsPerPlayer: opts.autoRoundTicketsPerPlayer ?? 4,
    autoRoundEntryFee: 10,
    payoutPercent: 70,
    autoDrawEnabled: false,
    autoDrawIntervalMs: 0,
  };

  const engine = {
    async startGame(input: { ticketsPerPlayer: number; entryFee: number }) {
      if (opts.startGameThrows) throw opts.startGameThrows;
      startGameCalls.push({
        ticketsPerPlayer: input.ticketsPerPlayer,
        entryFee: input.entryFee,
      });
    },
    async endGame(input: { reason?: string }) {
      if (opts.endGameThrows) throw opts.endGameThrows;
      endGameCalls.push({ reason: input.reason });
    },
  };

  const deps = {
    runtimeBingoSettings: settings,
    emitRoomUpdate: async (roomCode: string) => {
      emitRoomUpdateCalls.push(roomCode);
      return { snapshot: { roomCode } } as unknown as RoomSnapshot;
    },
    getRoomConfiguredEntryFee: () => opts.configuredEntryFee ?? 50,
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: 4 }),
    getArmedPlayerSelections: () => ({}),
    disarmAllPlayers: (roomCode: string) => disarmAllCalls.push(roomCode),
    clearDisplayTicketCache: (roomCode: string) => clearCacheCalls.push(roomCode),
    resolveBingoHallGameConfigForRoom: async () => ({
      hallId: "hall-1",
      maxTicketsPerPlayer: opts.hallMaxTicketsPerPlayer ?? 6,
    }),
    getVariantConfig: opts.variantInfo ? () => opts.variantInfo : undefined,
    getPreRoundTicketsByPlayerId: undefined,
  } as unknown as GameEventsDeps;

  const ctx = {
    socket: socket as unknown as Socket,
    engine: engine as unknown as SocketContext["engine"],
    deps,
    ackSuccess<T>(cb: (r: { ok: boolean; data: T }) => void, data: T) {
      cb({ ok: true, data });
    },
    ackFailure<T>(cb: (r: { ok: boolean; error: { code: string; message: string } }) => void, err: unknown) {
      const pub = err instanceof DomainError
        ? { code: err.code, message: err.message }
        : { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) };
      cb({ ok: false, error: pub } as never);
    },
    rateLimited<P, R>(
      _name: string,
      handler: (payload: P, cb: (response: unknown) => void) => Promise<void>,
    ): (payload: P, cb: (response: unknown) => void) => void {
      return (payload, cb) => {
        handler(payload, cb).catch((err) => {
          cb({ ok: false, error: { code: "INTERNAL_ERROR", message: String(err) } });
        });
      };
    },
    requireAuthenticatedPlayerAction: async (payload: { roomCode?: string; playerId?: string }) => ({
      roomCode: (payload?.roomCode ?? "ROOM1").toUpperCase(),
      playerId: payload?.playerId ?? "p1",
    }),
  } as unknown as SocketContext;

  return {
    ctx,
    socket,
    startGameCalls,
    endGameCalls,
    disarmAllCalls,
    clearCacheCalls,
    emitRoomUpdateCalls,
  };
}

function invoke(socket: MockSocket, event: string, payload: Record<string, unknown>): Promise<{ response: { ok: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: unknown) => {
      resolve({ response: response as { ok: boolean; data?: unknown; error?: { code: string; message: string } } });
    });
  });
}

// ── game:start ────────────────────────────────────────────────────────────

test("game:start — happy path videresender ticketsPerPlayer + entryFee til engine", async () => {
  const { ctx, socket, startGameCalls } = makeCtx();
  registerGameLifecycleEvents(ctx);

  const { response } = await invoke(socket, "game:start", {
    roomCode: "ROOM1",
    ticketsPerPlayer: 3,
    entryFee: 25,
  });
  assert.equal(response.ok, true);
  assert.equal(startGameCalls.length, 1);
  assert.equal(startGameCalls[0].ticketsPerPlayer, 3);
  assert.equal(startGameCalls[0].entryFee, 25);
});

test("game:start — uten entryFee bruker getRoomConfiguredEntryFee", async () => {
  const { ctx, socket, startGameCalls } = makeCtx({ configuredEntryFee: 100 });
  registerGameLifecycleEvents(ctx);

  await invoke(socket, "game:start", { roomCode: "ROOM1", ticketsPerPlayer: 2 });
  assert.equal(startGameCalls[0].entryFee, 100);
});

test("game:start — uten ticketsPerPlayer bruker min(hallLimit, autoRound)", async () => {
  const { ctx, socket, startGameCalls } = makeCtx({
    hallMaxTicketsPerPlayer: 6,
    autoRoundTicketsPerPlayer: 4,
  });
  registerGameLifecycleEvents(ctx);

  await invoke(socket, "game:start", { roomCode: "ROOM1" });
  assert.equal(startGameCalls[0].ticketsPerPlayer, 4, "min(6, 4) = 4");
});

test("game:start — uten ticketsPerPlayer + lav hallLimit bruker hallLimit", async () => {
  const { ctx, socket, startGameCalls } = makeCtx({
    hallMaxTicketsPerPlayer: 2,
    autoRoundTicketsPerPlayer: 4,
  });
  registerGameLifecycleEvents(ctx);

  await invoke(socket, "game:start", { roomCode: "ROOM1" });
  assert.equal(startGameCalls[0].ticketsPerPlayer, 2, "min(2, 4) = 2");
});

test("game:start — ticketsPerPlayer over hall-grense gir TICKETS_ABOVE_HALL_LIMIT", async () => {
  const { ctx, socket, startGameCalls } = makeCtx({ hallMaxTicketsPerPlayer: 4 });
  registerGameLifecycleEvents(ctx);

  const { response } = await invoke(socket, "game:start", {
    roomCode: "ROOM1",
    ticketsPerPlayer: 10, // over 4
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "TICKETS_ABOVE_HALL_LIMIT");
  assert.equal(startGameCalls.length, 0, "engine.startGame skal ikke kalles");
});

test("game:start — ticketsPerPlayer = 0 → INVALID_TICKETS_PER_PLAYER (utenfor 1-30 range)", async () => {
  const { ctx, socket } = makeCtx();
  registerGameLifecycleEvents(ctx);

  const { response } = await invoke(socket, "game:start", {
    roomCode: "ROOM1",
    ticketsPerPlayer: 0,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_TICKETS_PER_PLAYER");
});

test("game:start — ticketsPerPlayer = 31 → INVALID_TICKETS_PER_PLAYER", async () => {
  const { ctx, socket } = makeCtx();
  registerGameLifecycleEvents(ctx);

  const { response } = await invoke(socket, "game:start", {
    roomCode: "ROOM1",
    ticketsPerPlayer: 31,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_TICKETS_PER_PLAYER");
});

test("game:start — happy path kaller disarmAllPlayers + clearDisplayTicketCache + emitRoomUpdate", async () => {
  const { ctx, socket, disarmAllCalls, clearCacheCalls, emitRoomUpdateCalls } = makeCtx();
  registerGameLifecycleEvents(ctx);

  await invoke(socket, "game:start", { roomCode: "ROOM1", ticketsPerPlayer: 3 });
  assert.equal(disarmAllCalls.length, 1);
  assert.equal(disarmAllCalls[0], "ROOM1");
  assert.equal(clearCacheCalls.length, 1);
  assert.equal(clearCacheCalls[0], "ROOM1");
  assert.equal(emitRoomUpdateCalls.length, 1);
});

test("game:start — engine.startGame kaster → disarm/clear/emit IKKE kalles", async () => {
  const { ctx, socket, disarmAllCalls, clearCacheCalls, emitRoomUpdateCalls } = makeCtx({
    startGameThrows: new DomainError("ROOM_NOT_FOUND", "Rom finnes ikke."),
  });
  registerGameLifecycleEvents(ctx);

  const { response } = await invoke(socket, "game:start", { roomCode: "ROOM1", ticketsPerPlayer: 3 });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "ROOM_NOT_FOUND");
  assert.equal(disarmAllCalls.length, 0, "ikke disarm ved feil");
  assert.equal(clearCacheCalls.length, 0, "ikke clear-cache ved feil");
  assert.equal(emitRoomUpdateCalls.length, 0);
});

// ── game:end ──────────────────────────────────────────────────────────────

test("game:end — happy path videresender reason til engine.endGame", async () => {
  const { ctx, socket, endGameCalls } = makeCtx();
  registerGameLifecycleEvents(ctx);

  const { response } = await invoke(socket, "game:end", {
    roomCode: "ROOM1",
    reason: "ADMIN_TERMINATED",
  });
  assert.equal(response.ok, true);
  assert.equal(endGameCalls.length, 1);
  assert.equal(endGameCalls[0].reason, "ADMIN_TERMINATED");
});

test("game:end — uten reason sender undefined til engine", async () => {
  const { ctx, socket, endGameCalls } = makeCtx();
  registerGameLifecycleEvents(ctx);

  await invoke(socket, "game:end", { roomCode: "ROOM1" });
  assert.equal(endGameCalls.length, 1);
  assert.equal(endGameCalls[0].reason, undefined);
});

test("game:end — engine.endGame kaster → ack failure", async () => {
  const { ctx, socket } = makeCtx({
    endGameThrows: new DomainError("GAME_NOT_RUNNING", "Ingen aktiv runde."),
  });
  registerGameLifecycleEvents(ctx);

  const { response } = await invoke(socket, "game:end", { roomCode: "ROOM1" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "GAME_NOT_RUNNING");
});

test("game:end — happy path returnerer snapshot", async () => {
  const { ctx, socket, emitRoomUpdateCalls } = makeCtx();
  registerGameLifecycleEvents(ctx);

  const { response } = await invoke(socket, "game:end", { roomCode: "ROOM1" });
  assert.equal(response.ok, true);
  assert.equal(emitRoomUpdateCalls.length, 1);
  assert.equal(emitRoomUpdateCalls[0], "ROOM1");
});
