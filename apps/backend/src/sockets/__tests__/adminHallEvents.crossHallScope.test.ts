/**
 * SEC-P0-001 (Bølge 2A — 2026-04-28): Cross-hall control bypass via
 * Socket.IO admin namespace.
 *
 * BEFORE THE FIX:
 *   `requireAuthenticatedAdmin` only checked `ROOM_CONTROL_WRITE`, which is
 *   granted to both ADMIN and HALL_OPERATOR. There was no
 *   `assertUserHallScope` on `admin:room-ready`, `admin:pause-game`,
 *   `admin:resume-game`, `admin:force-end`, or `admin:hall-balance`. A
 *   logged-in HALL_OPERATOR for hall A could connect, log in, and emit
 *   `admin:pause-game` / `admin:force-end` with a `roomCode` belonging to
 *   hall B. The engine state-mutated in the wrong hall mid-round.
 *
 *   In a 4-hall pilot, a single rogue or compromised hall-operator account
 *   could grief every other hall (refund-storm, broken audit trails,
 *   compliance risk).
 *
 * THE FIX (apps/backend/src/sockets/adminHallEvents.ts):
 *   - `admin:login` now stores `user.hallId` on `socket.data.adminUser`.
 *   - All five hall-touching events resolve `targetHallId` from the
 *     room snapshot (or payload, for `admin:hall-balance`) and call
 *     `assertUserHallScope({ role, hallId }, targetHallId)` before any
 *     engine.mutate / wallet-read.
 *   - ADMIN / SUPPORT pass through (global scope by definition).
 *   - HALL_OPERATOR with `hallId === null` is fail-closed (FORBIDDEN).
 *   - HALL_OPERATOR for the wrong hall is fail-closed (FORBIDDEN).
 *
 * THESE TESTS verify:
 *   1. HALL_OPERATOR(hall-a) cannot pause a room in hall-b.
 *   2. HALL_OPERATOR(hall-a) cannot resume a room in hall-b.
 *   3. HALL_OPERATOR(hall-a) cannot force-end a room in hall-b.
 *   4. HALL_OPERATOR(hall-a) cannot signal room-ready for a room in hall-b.
 *   5. HALL_OPERATOR(hall-a) cannot read hall-balance for hall-b.
 *   6. HALL_OPERATOR(hall-a) CAN do all of the above for their own hall (positive control).
 *   7. ADMIN can act on any hall (global scope, sanity check).
 *   8. HALL_OPERATOR with no hall assigned is fail-closed (FORBIDDEN).
 *   9. Engine state is NOT mutated when scope check fails (no side effects).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createAdminHallHandlers } from "../adminHallEvents.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { PlatformService, HallDefinition } from "../../platform/PlatformService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
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
  const calls = {
    pauseGame: [] as Array<{ roomCode: string; message?: string }>,
    resumeGame: [] as string[],
    endGame: [] as Array<{ roomCode: string; reason?: string }>,
  };
  return {
    __rooms: rooms,
    __calls: calls,
    getRoomSnapshot: (code: string) => {
      const r = rooms.find((x) => x.code === code.toUpperCase());
      if (!r) throw new Error(`unknown room ${code}`);
      return {
        code: r.code,
        hallId: r.hallId,
        hostPlayerId: "host-1",
        gameSlug: "bingo",
        createdAt: "2026-04-28T00:00:00Z",
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
  } as unknown as BingoEngine & { __rooms: FakeRoom[]; __calls: typeof calls };
}

function makePlatformStub(opts: {
  users: Record<string, {
    id: string;
    email: string;
    displayName: string;
    role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER";
    hallId?: string | null;
  }>;
  knownHallIds?: string[];
}) {
  const knownHallIds = new Set(opts.knownHallIds ?? ["hall-a", "hall-b"]);
  return {
    getUserFromAccessToken: async (token: string) => {
      const u = opts.users[token];
      if (!u) throw new Error("invalid access token");
      return {
        ...u,
        walletId: `w-${u.id}`,
        kycStatus: "VERIFIED" as const,
        createdAt: "",
        updatedAt: "",
        balance: 0,
        hallId: u.hallId ?? null,
      };
    },
    getHall: async (hallId: string): Promise<HallDefinition> => {
      if (!knownHallIds.has(hallId)) throw new Error(`unknown hall ${hallId}`);
      return {
        id: hallId, slug: hallId, name: `Hall ${hallId}`, region: "test", address: "test",
        isActive: true, clientVariant: "web" as const, tvToken: `tv-${hallId}`,
        createdAt: "", updatedAt: "",
      } as HallDefinition;
    },
  } as unknown as PlatformService;
}

function makeWalletStub(balancesByAccountId: Record<string, number> = {}) {
  return {
    getBalance: async (accountId: string): Promise<number> => {
      const balance = balancesByAccountId[accountId];
      if (balance === undefined) {
        const err = new Error("ACCOUNT_NOT_FOUND");
        (err as unknown as { code: string }).code = "ACCOUNT_NOT_FOUND";
        throw err;
      }
      return balance;
    },
  } as unknown as WalletAdapter;
}

/**
 * 4-hall pilot fixture: hall-a + hall-b each with one running room.
 * Operator-A is scoped to hall-a; operator-B is scoped to hall-b. ADMIN
 * has no hall assignment (global scope).
 */
function setup4HallPilot() {
  const rooms: FakeRoom[] = [
    { code: "ROOM-A", hallId: "hall-a", gameStatus: "RUNNING" as const },
    { code: "ROOM-B", hallId: "hall-b", gameStatus: "RUNNING" as const },
  ];
  const users = {
    "admin-token": {
      id: "u-admin", email: "admin@x.no", displayName: "Admin",
      role: "ADMIN" as const,
      // ADMIN typically has no hallId; passes through scope check.
      hallId: null,
    },
    "operator-a-token": {
      id: "u-op-a", email: "op-a@x.no", displayName: "Operator-A",
      role: "HALL_OPERATOR" as const, hallId: "hall-a",
    },
    "operator-b-token": {
      id: "u-op-b", email: "op-b@x.no", displayName: "Operator-B",
      role: "HALL_OPERATOR" as const, hallId: "hall-b",
    },
    "operator-unassigned-token": {
      id: "u-op-x", email: "op-x@x.no", displayName: "Unassigned-Op",
      role: "HALL_OPERATOR" as const, hallId: null,
    },
  };
  const engine = makeEngineStub(rooms);
  const platform = makePlatformStub({ users });
  const walletAdapter = makeWalletStub({
    "house-hall-a-databingo-internet": 5000,
    "house-hall-b-databingo-internet": 7500,
  });
  const io = new FakeIo();
  const emitRoomUpdateCalls: string[] = [];
  const register = createAdminHallHandlers({
    engine,
    platformService: platform,
    io: io as unknown as Server,
    walletAdapter,
    emitRoomUpdate: async (code) => {
      emitRoomUpdateCalls.push(code);
      return { roomCode: code } as unknown as Awaited<ReturnType<Parameters<typeof createAdminHallHandlers>[0]["emitRoomUpdate"]>>;
    },
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);
  return { engine, sock, io, emitRoomUpdateCalls };
}

// ── Cross-hall control attempt: pause-game ───────────────────────────────────

test("SEC-P0-001: HALL_OPERATOR(hall-a) cannot admin:pause-game ROOM-B (hall-b) — FORBIDDEN", async () => {
  const { engine, sock, emitRoomUpdateCalls } = setup4HallPilot();
  const login = await sock.fire("admin:login", { accessToken: "operator-a-token" });
  assert.equal(login.ok, true, "operator-a login should succeed");

  const r = await sock.fire("admin:pause-game", {
    roomCode: "ROOM-B",
    message: "rogue-pause-attempt",
  });

  assert.equal(r.ok, false, "cross-hall pause MUST be denied");
  assert.equal(r.error?.code, "FORBIDDEN", "structured FORBIDDEN code so client can react");

  // SIDE-EFFECT CHECK: engine.pauseGame must NOT have been called, and
  // emitRoomUpdate must NOT have been triggered. Otherwise the bug is
  // half-fixed: scope-check rejected the response but the state already
  // mutated.
  const calls = (engine as unknown as { __calls: { pauseGame: Array<unknown> } }).__calls;
  assert.equal(calls.pauseGame.length, 0, "engine.pauseGame MUST NOT be called when scope-check fails");
  assert.equal(emitRoomUpdateCalls.length, 0, "emitRoomUpdate MUST NOT be called when scope-check fails");

  // Sanity: ROOM-B must still be running (not paused).
  const roomB = (engine as unknown as { __rooms: FakeRoom[] }).__rooms.find((r) => r.code === "ROOM-B")!;
  assert.equal(roomB.isPaused ?? false, false, "ROOM-B must remain unpaused");
});

// ── Cross-hall: resume-game ──────────────────────────────────────────────────

test("SEC-P0-001: HALL_OPERATOR(hall-a) cannot admin:resume-game ROOM-B — FORBIDDEN", async () => {
  const { engine, sock, emitRoomUpdateCalls } = setup4HallPilot();
  await sock.fire("admin:login", { accessToken: "operator-a-token" });

  const r = await sock.fire("admin:resume-game", { roomCode: "ROOM-B" });

  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "FORBIDDEN");
  const calls = (engine as unknown as { __calls: { resumeGame: string[] } }).__calls;
  assert.equal(calls.resumeGame.length, 0, "engine.resumeGame MUST NOT be called");
  assert.equal(emitRoomUpdateCalls.length, 0);
});

// ── Cross-hall: force-end ────────────────────────────────────────────────────

test("SEC-P0-001: HALL_OPERATOR(hall-a) cannot admin:force-end ROOM-B — FORBIDDEN", async () => {
  const { engine, sock, emitRoomUpdateCalls } = setup4HallPilot();
  await sock.fire("admin:login", { accessToken: "operator-a-token" });

  const r = await sock.fire("admin:force-end", {
    roomCode: "ROOM-B",
    reason: "rogue-force-end",
  });

  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "FORBIDDEN");

  const calls = (engine as unknown as { __calls: { endGame: Array<unknown> } }).__calls;
  assert.equal(calls.endGame.length, 0, "engine.endGame MUST NOT be called");
  assert.equal(emitRoomUpdateCalls.length, 0);

  // Sanity: ROOM-B must still be RUNNING.
  const roomB = (engine as unknown as { __rooms: FakeRoom[] }).__rooms.find((r) => r.code === "ROOM-B")!;
  assert.equal(roomB.gameStatus, "RUNNING", "ROOM-B must remain RUNNING");
});

// ── Cross-hall: room-ready ───────────────────────────────────────────────────

test("SEC-P0-001: HALL_OPERATOR(hall-a) cannot admin:room-ready ROOM-B — FORBIDDEN", async () => {
  const { sock, io } = setup4HallPilot();
  await sock.fire("admin:login", { accessToken: "operator-a-token" });

  const r = await sock.fire("admin:room-ready", { roomCode: "ROOM-B" });

  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "FORBIDDEN");
  const events = io.emitsByRoom.filter((e) => e.event === "admin:hall-event");
  assert.equal(events.length, 0, "no broadcast should happen for cross-hall room-ready");
});

// ── Cross-hall: hall-balance read ────────────────────────────────────────────

test("SEC-P0-001: HALL_OPERATOR(hall-a) cannot admin:hall-balance hall-b — FORBIDDEN", async () => {
  const { sock } = setup4HallPilot();
  await sock.fire("admin:login", { accessToken: "operator-a-token" });

  const r = await sock.fire("admin:hall-balance", { hallId: "hall-b" });

  assert.equal(r.ok, false, "cross-hall balance read MUST be denied");
  assert.equal(r.error?.code, "FORBIDDEN");
});

// ── Positive control: same-hall actions still work ───────────────────────────

test("SEC-P0-001: HALL_OPERATOR(hall-a) CAN admin:pause-game ROOM-A (own hall)", async () => {
  const { engine, sock } = setup4HallPilot();
  await sock.fire("admin:login", { accessToken: "operator-a-token" });

  const r = await sock.fire("admin:pause-game", {
    roomCode: "ROOM-A",
    message: "Teknisk feil",
  });

  assert.equal(r.ok, true, "same-hall pause must succeed");
  const calls = (engine as unknown as { __calls: { pauseGame: Array<{ roomCode: string }> } }).__calls;
  assert.equal(calls.pauseGame.length, 1);
  assert.equal(calls.pauseGame[0].roomCode, "ROOM-A");
});

test("SEC-P0-001: HALL_OPERATOR(hall-a) CAN admin:hall-balance hall-a (own hall)", async () => {
  const { sock } = setup4HallPilot();
  await sock.fire("admin:login", { accessToken: "operator-a-token" });

  const r = await sock.fire<{ hallId: string; totalBalance: number }>(
    "admin:hall-balance",
    { hallId: "hall-a" },
  );

  assert.equal(r.ok, true, "same-hall balance read must succeed");
  assert.equal(r.data?.hallId, "hall-a");
  // hall-a has only databingo-internet funded with 5000 in fixture.
  assert.equal(r.data?.totalBalance, 5000);
});

// ── ADMIN global scope: positive control ─────────────────────────────────────

test("SEC-P0-001: ADMIN can pause any hall (global scope)", async () => {
  const { engine, sock } = setup4HallPilot();
  await sock.fire("admin:login", { accessToken: "admin-token" });

  const pauseA = await sock.fire("admin:pause-game", { roomCode: "ROOM-A" });
  const pauseB = await sock.fire("admin:pause-game", { roomCode: "ROOM-B" });
  assert.equal(pauseA.ok, true);
  assert.equal(pauseB.ok, true);

  const calls = (engine as unknown as { __calls: { pauseGame: Array<{ roomCode: string }> } }).__calls;
  assert.equal(calls.pauseGame.length, 2);
});

test("SEC-P0-001: ADMIN can read any hall-balance (global scope)", async () => {
  const { sock } = setup4HallPilot();
  await sock.fire("admin:login", { accessToken: "admin-token" });

  const a = await sock.fire<{ totalBalance: number }>("admin:hall-balance", { hallId: "hall-a" });
  const b = await sock.fire<{ totalBalance: number }>("admin:hall-balance", { hallId: "hall-b" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.data?.totalBalance, 5000);
  assert.equal(b.data?.totalBalance, 7500);
});

// ── Fail-closed for unassigned operator ──────────────────────────────────────

test("SEC-P0-001: HALL_OPERATOR with no hall assigned is fail-closed for ANY hall", async () => {
  const { engine, sock } = setup4HallPilot();
  const login = await sock.fire("admin:login", { accessToken: "operator-unassigned-token" });
  assert.equal(login.ok, true, "login itself is allowed; the gate is on per-event");

  // Pause own hall (which is null) — must still fail because targetHallId
  // is hall-a/hall-b, not null.
  const r1 = await sock.fire("admin:pause-game", { roomCode: "ROOM-A" });
  assert.equal(r1.ok, false);
  assert.equal(r1.error?.code, "FORBIDDEN");

  const r2 = await sock.fire("admin:pause-game", { roomCode: "ROOM-B" });
  assert.equal(r2.ok, false);
  assert.equal(r2.error?.code, "FORBIDDEN");

  const r3 = await sock.fire("admin:hall-balance", { hallId: "hall-a" });
  assert.equal(r3.ok, false);
  assert.equal(r3.error?.code, "FORBIDDEN");

  const calls = (engine as unknown as { __calls: { pauseGame: Array<unknown> } }).__calls;
  assert.equal(calls.pauseGame.length, 0, "no engine state-mutation under fail-closed");
});

// ── Symmetric: operator-B cannot touch hall-a ────────────────────────────────

test("SEC-P0-001: HALL_OPERATOR(hall-b) cannot force-end ROOM-A — symmetric proof", async () => {
  const { engine, sock } = setup4HallPilot();
  await sock.fire("admin:login", { accessToken: "operator-b-token" });

  const r = await sock.fire("admin:force-end", { roomCode: "ROOM-A" });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "FORBIDDEN");

  const calls = (engine as unknown as { __calls: { endGame: Array<unknown> } }).__calls;
  assert.equal(calls.endGame.length, 0);
});
