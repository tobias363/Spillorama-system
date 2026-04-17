/**
 * BIN-515: Admin hall-event socket handlers — unit tests.
 *
 * Drives createAdminHallHandlers directly with fake socket + io shims.
 * Covers: auth gate, role gate, roomCode validation, room-ready
 * broadcast, pause/resume wrapping, force-end wrapping, plus the
 * broadcast fan-out to both the room-code and the hall display room.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createAdminHallHandlers } from "../adminHallEvents.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { PlatformService } from "../../platform/PlatformService.js";
import type { Server } from "socket.io";

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

class FakeSocket {
  data: Record<string, unknown> = {};
  joined = new Set<string>();
  emitted: Array<{ event: string; payload: unknown }> = [];
  private handlers = new Map<string, (payload: unknown, ack?: (r: AckResponse<unknown>) => void) => Promise<void> | void>();
  on(event: string, handler: (payload: unknown, ack?: (r: AckResponse<unknown>) => void) => Promise<void> | void): this {
    this.handlers.set(event, handler);
    return this;
  }
  join(room: string): this { this.joined.add(room); return this; }
  emit(event: string, payload: unknown): boolean { this.emitted.push({ event, payload }); return true; }
  async fire<T>(event: string, payload: unknown = {}): Promise<AckResponse<T>> {
    const handler = this.handlers.get(event);
    if (!handler) throw new Error(`no handler for ${event}`);
    return new Promise<AckResponse<T>>((resolve) => {
      const ack = (r: AckResponse<T>) => resolve(r);
      void handler(payload, ack as (r: AckResponse<unknown>) => void);
    });
  }
}

class FakeIo {
  readonly emitsByRoom: Array<{ room: string; event: string; payload: unknown }> = [];
  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.emitsByRoom.push({ room, event, payload });
        return true;
      },
    };
  }
}

interface FakeRoom {
  code: string;
  hallId: string;
  gameStatus: "RUNNING" | "WAITING" | "ENDED" | "PAUSED";
  isPaused?: boolean;
}

function makeEngineStub(rooms: FakeRoom[]) {
  const calls = { pauseGame: [] as Array<{ roomCode: string; message?: string }>,
                  resumeGame: [] as string[],
                  endGame: [] as Array<{ roomCode: string; reason?: string }> };
  return {
    __rooms: rooms,
    __calls: calls,
    getRoomSnapshot: (code: string) => {
      const r = rooms.find((x) => x.code === code.toUpperCase());
      if (!r) throw new Error(`unknown room ${code}`);
      return {
        code: r.code, hallId: r.hallId, hostPlayerId: "host-1",
        gameSlug: "bingo",
        createdAt: "2026-04-18T00:00:00Z",
        players: [],
        gameHistory: [],
        currentGame: r.gameStatus === "ENDED" ? undefined : {
          id: "game-1",
          status: r.gameStatus === "PAUSED" ? "RUNNING" : r.gameStatus,
          drawnNumbers: [],
          isPaused: r.isPaused ?? false,
        } as unknown,
      };
    },
    pauseGame: (code: string, message?: string) => {
      calls.pauseGame.push({ roomCode: code, message });
      const r = rooms.find((x) => x.code === code.toUpperCase());
      if (!r) throw new Error(`unknown room ${code}`);
      r.isPaused = true;
    },
    resumeGame: (code: string) => {
      calls.resumeGame.push(code);
      const r = rooms.find((x) => x.code === code.toUpperCase());
      if (!r) throw new Error(`unknown room ${code}`);
      r.isPaused = false;
    },
    endGame: async (input: { roomCode: string; actorPlayerId: string; reason?: string }) => {
      calls.endGame.push({ roomCode: input.roomCode, reason: input.reason });
      const r = rooms.find((x) => x.code === input.roomCode.toUpperCase());
      if (!r) throw new Error(`unknown room ${input.roomCode}`);
      r.gameStatus = "ENDED";
    },
    listRoomSummaries: () => rooms.map((r) => ({ code: r.code, hallId: r.hallId, gameStatus: r.gameStatus, gameSlug: "bingo", playerCount: 0, hostPlayerId: "host-1" })),
  } as unknown as BingoEngine & { __rooms: FakeRoom[]; __calls: typeof calls };
}

function makePlatformStub(opts: { users: Record<string, { id: string; email: string; displayName: string; role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER" }> }) {
  return {
    getUserFromAccessToken: async (token: string) => {
      const u = opts.users[token];
      if (!u) throw new Error("invalid access token");
      return { ...u, walletId: `w-${u.id}`, kycStatus: "VERIFIED" as const, createdAt: "", updatedAt: "", balance: 0 };
    },
  } as unknown as PlatformService;
}

// ── Shared wiring ──────────────────────────────────────────────────────────

function setup(opts: {
  rooms?: FakeRoom[];
  users?: Parameters<typeof makePlatformStub>[0]["users"];
} = {}) {
  const rooms = opts.rooms ?? [{ code: "ROOM-A", hallId: "hall-a", gameStatus: "RUNNING" as const }];
  const users = opts.users ?? {
    "admin-token": { id: "u-admin", email: "a@x.no", displayName: "Admin", role: "ADMIN" as const },
    "operator-token": { id: "u-op", email: "op@x.no", displayName: "Ops", role: "HALL_OPERATOR" as const },
    "player-token": { id: "u-pl", email: "pl@x.no", displayName: "Player", role: "PLAYER" as const },
  };
  const engine = makeEngineStub(rooms);
  const platform = makePlatformStub({ users });
  const io = new FakeIo();
  const emitRoomUpdateCalls: string[] = [];
  const register = createAdminHallHandlers({
    engine,
    platformService: platform,
    io: io as unknown as Server,
    emitRoomUpdate: async (code) => {
      emitRoomUpdateCalls.push(code);
      return { roomCode: code } as unknown as Awaited<ReturnType<Parameters<typeof createAdminHallHandlers>[0]["emitRoomUpdate"]>>;
    },
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);
  return { engine, platform, io, sock, emitRoomUpdateCalls };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("admin:login accepts a valid token and reports the role's room-control capability", async () => {
  const { sock } = setup();
  const r = await sock.fire<{ userId: string; role: string; canControlRooms: boolean }>(
    "admin:login", { accessToken: "admin-token" },
  );
  assert.equal(r.ok, true);
  assert.equal(r.data?.role, "ADMIN");
  assert.equal(r.data?.canControlRooms, true);
});

test("admin:login rejects missing token", async () => {
  const { sock } = setup();
  const r = await sock.fire("admin:login", {});
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "MISSING_TOKEN");
});

test("admin:login rejects unknown token", async () => {
  const { sock } = setup();
  const r = await sock.fire("admin:login", { accessToken: "nope" });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "UNAUTHORIZED");
});

test("admin:pause-game fails NOT_AUTHENTICATED before login", async () => {
  const { sock } = setup();
  const r = await sock.fire("admin:pause-game", { roomCode: "ROOM-A" });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "NOT_AUTHENTICATED");
});

test("admin:pause-game fails FORBIDDEN for PLAYER role", async () => {
  const { sock } = setup();
  const login = await sock.fire("admin:login", { accessToken: "player-token" });
  assert.equal(login.ok, true);
  const r = await sock.fire("admin:pause-game", { roomCode: "ROOM-A" });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "FORBIDDEN");
});

test("admin:room-ready broadcasts to the room-code and hall display room", async () => {
  const { sock, io } = setup({ rooms: [{ code: "ROOM-A", hallId: "hall-a", gameStatus: "WAITING" }] });
  await sock.fire("admin:login", { accessToken: "operator-token" });
  const r = await sock.fire<{ kind: string; roomCode: string; hallId: string | null; countdownSeconds?: number }>(
    "admin:room-ready", { roomCode: "room-a", countdownSeconds: 15, message: "Starter snart" },
  );
  assert.equal(r.ok, true);
  assert.equal(r.data?.kind, "room-ready");
  assert.equal(r.data?.roomCode, "ROOM-A");
  assert.equal(r.data?.hallId, "hall-a");
  assert.equal(r.data?.countdownSeconds, 15);
  // Fan-out: one emit to the room-code, one to the hall display room.
  const events = io.emitsByRoom.filter((e) => e.event === "admin:hall-event");
  assert.equal(events.length, 2);
  const rooms = new Set(events.map((e) => e.room));
  assert.ok(rooms.has("ROOM-A"));
  assert.ok(rooms.has("hall:hall-a:display"));
});

test("admin:room-ready clamps countdownSeconds and rejects unknown rooms", async () => {
  const { sock } = setup();
  await sock.fire("admin:login", { accessToken: "admin-token" });
  const clamped = await sock.fire<{ countdownSeconds?: number }>(
    "admin:room-ready", { roomCode: "ROOM-A", countdownSeconds: 99999 },
  );
  assert.equal(clamped.ok, true);
  assert.equal(clamped.data?.countdownSeconds, 300);
  const missing = await sock.fire("admin:room-ready", { roomCode: "GHOST" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error?.code, "ROOM_NOT_FOUND");
});

test("admin:pause-game + admin:resume-game drive the engine and emit room:update", async () => {
  const { sock, engine, emitRoomUpdateCalls } = setup();
  await sock.fire("admin:login", { accessToken: "admin-token" });
  const paused = await sock.fire("admin:pause-game", { roomCode: "ROOM-A", message: "Teknisk feil" });
  assert.equal(paused.ok, true);
  const calls = (engine as unknown as { __calls: { pauseGame: Array<{ roomCode: string; message?: string }>; resumeGame: string[]; endGame: Array<{ roomCode: string; reason?: string }> } }).__calls;
  assert.equal(calls.pauseGame.length, 1);
  assert.equal(calls.pauseGame[0].message, "Teknisk feil");
  assert.equal(emitRoomUpdateCalls[0], "ROOM-A");

  const resumed = await sock.fire("admin:resume-game", { roomCode: "ROOM-A" });
  assert.equal(resumed.ok, true);
  assert.deepEqual(calls.resumeGame, ["ROOM-A"]);
  assert.equal(emitRoomUpdateCalls[1], "ROOM-A");
});

test("admin:force-end delegates to engine.endGame with the room's host as actor", async () => {
  const { sock, engine } = setup();
  await sock.fire("admin:login", { accessToken: "admin-token" });
  const r = await sock.fire("admin:force-end", { roomCode: "ROOM-A", reason: "Strømbrudd" });
  assert.equal(r.ok, true);
  const calls = (engine as unknown as { __calls: { endGame: Array<{ roomCode: string; reason?: string }> } }).__calls;
  assert.equal(calls.endGame.length, 1);
  assert.equal(calls.endGame[0].reason, "Strømbrudd");
});

test("admin:pause-game rejects missing roomCode", async () => {
  const { sock } = setup();
  await sock.fire("admin:login", { accessToken: "admin-token" });
  const r = await sock.fire("admin:pause-game", {});
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "INVALID_INPUT");
});

test("admin:force-end defaults reason to FORCE_END_ADMIN when omitted", async () => {
  const { sock, engine } = setup();
  await sock.fire("admin:login", { accessToken: "admin-token" });
  await sock.fire("admin:force-end", { roomCode: "ROOM-A" });
  const calls = (engine as unknown as { __calls: { endGame: Array<{ reason?: string }> } }).__calls;
  assert.equal(calls.endGame[0].reason, "FORCE_END_ADMIN");
});
