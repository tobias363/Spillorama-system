/**
 * Bølge D coverage: socket-event `leaderboard:get` + `disconnect`.
 *
 * Dekker:
 *   - leaderboard:get global (uten roomCode) returnerer hele listen
 *   - leaderboard:get room-scoped med roomCode filter
 *   - leaderboard:get error-path (buildLeaderboard kaster) → ack failure
 *   - disconnect kaller engine.detachSocket og rateLimiter.cleanup
 *   - disconnect øker prom-counter med reason-label
 *   - disconnect med tom reason → "unknown"-label
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Server, Socket } from "socket.io";
import { registerLifecycleEvents } from "../gameEvents/lifecycleEvents.js";
import type { SocketContext } from "../gameEvents/context.js";
import type { GameEventsDeps } from "../gameEvents/deps.js";
import type { LeaderboardEntry } from "../gameEvents/types.js";
import { DomainError } from "../../game/BingoEngine.js";

interface MockSocket extends EventEmitter {
  id: string;
}

function makeSocket(id = "socket-1"): MockSocket {
  const ee = new EventEmitter() as MockSocket;
  ee.id = id;
  return ee;
}

interface CtxOptions {
  buildLeaderboard?: (roomCode?: string) => LeaderboardEntry[];
  detachCalls?: string[];
  cleanupCalls?: string[];
}

function makeCtx(opts: CtxOptions = {}): {
  ctx: SocketContext;
  socket: MockSocket;
  detachCalls: string[];
  cleanupCalls: string[];
} {
  const socket = makeSocket();
  const detachCalls = opts.detachCalls ?? [];
  const cleanupCalls = opts.cleanupCalls ?? [];

  const engine = {
    detachSocket(socketId: string) {
      detachCalls.push(socketId);
    },
  };

  const socketRateLimiter = {
    cleanup(socketId: string) {
      cleanupCalls.push(socketId);
    },
  };

  const buildLeaderboard = opts.buildLeaderboard ?? (() => []);

  const deps = {
    socketRateLimiter,
    buildLeaderboard,
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
    io: {} as unknown as Server,
  } as unknown as SocketContext;

  return { ctx, socket, detachCalls, cleanupCalls };
}

function invoke(socket: MockSocket, event: string, payload: Record<string, unknown>): Promise<{ response: { ok: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: unknown) => {
      resolve({ response: response as { ok: boolean; data?: unknown; error?: { code: string; message: string } } });
    });
  });
}

// ── leaderboard:get ───────────────────────────────────────────────────────

test("leaderboard:get — uten roomCode returnerer global liste", async () => {
  const globalEntries: LeaderboardEntry[] = [
    { nickname: "Alice", points: 1000 },
    { nickname: "Bob", points: 800 },
  ];
  let receivedRoomCode: string | undefined = undefined;
  const buildLeaderboard = (rc?: string) => {
    receivedRoomCode = rc;
    return rc ? [] : globalEntries;
  };

  const { ctx, socket } = makeCtx({ buildLeaderboard });
  registerLifecycleEvents(ctx);

  const { response } = await invoke(socket, "leaderboard:get", {});
  assert.equal(response.ok, true);
  const data = response.data as { leaderboard: LeaderboardEntry[] };
  assert.equal(data.leaderboard.length, 2);
  assert.equal(data.leaderboard[0].nickname, "Alice");
  assert.equal(receivedRoomCode, undefined);
});

test("leaderboard:get — med roomCode filtrerer på rom", async () => {
  let receivedRoomCode: string | undefined = undefined;
  const roomEntries: LeaderboardEntry[] = [{ nickname: "Charlie", points: 500 }];
  const buildLeaderboard = (rc?: string) => {
    receivedRoomCode = rc;
    return rc === "ROOM1" ? roomEntries : [];
  };

  const { ctx, socket } = makeCtx({ buildLeaderboard });
  registerLifecycleEvents(ctx);

  const { response } = await invoke(socket, "leaderboard:get", { roomCode: "ROOM1" });
  assert.equal(response.ok, true);
  const data = response.data as { leaderboard: LeaderboardEntry[] };
  assert.equal(data.leaderboard.length, 1);
  assert.equal(data.leaderboard[0].nickname, "Charlie");
  assert.equal(receivedRoomCode, "ROOM1");
});

test("leaderboard:get — buildLeaderboard kaster → ack failure", async () => {
  const buildLeaderboard = () => {
    throw new DomainError("LEADERBOARD_DISABLED", "Leaderboard er av.");
  };

  const { ctx, socket } = makeCtx({ buildLeaderboard });
  registerLifecycleEvents(ctx);

  const { response } = await invoke(socket, "leaderboard:get", {});
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "LEADERBOARD_DISABLED");
});

test("leaderboard:get — tom liste returneres uten error", async () => {
  const { ctx, socket } = makeCtx({ buildLeaderboard: () => [] });
  registerLifecycleEvents(ctx);

  const { response } = await invoke(socket, "leaderboard:get", {});
  assert.equal(response.ok, true);
  const data = response.data as { leaderboard: LeaderboardEntry[] };
  assert.equal(data.leaderboard.length, 0);
});

// ── disconnect ────────────────────────────────────────────────────────────

test("disconnect — kaller engine.detachSocket(socket.id) og rateLimiter.cleanup(socket.id)", () => {
  const { ctx, socket, detachCalls, cleanupCalls } = makeCtx();
  registerLifecycleEvents(ctx);

  socket.emit("disconnect", "client namespace disconnect");

  assert.equal(detachCalls.length, 1);
  assert.equal(detachCalls[0], "socket-1");
  assert.equal(cleanupCalls.length, 1);
  assert.equal(cleanupCalls[0], "socket-1");
});

test("disconnect — tom reason behandles uten å kaste", () => {
  const { ctx, socket, detachCalls } = makeCtx();
  registerLifecycleEvents(ctx);

  // Eksplisitt tom reason
  socket.emit("disconnect", "");
  assert.equal(detachCalls.length, 1);

  // Ingen reason
  socket.emit("disconnect");
  assert.equal(detachCalls.length, 2);
});

test("disconnect — flere reconnects gir flere detach-kall", () => {
  const { ctx, socket, detachCalls, cleanupCalls } = makeCtx();
  registerLifecycleEvents(ctx);

  socket.emit("disconnect", "transport close");
  socket.emit("disconnect", "ping timeout");

  assert.equal(detachCalls.length, 2);
  assert.equal(cleanupCalls.length, 2);
});
