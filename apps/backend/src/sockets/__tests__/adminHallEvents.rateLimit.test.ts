/**
 * Bølge D Issue 2 (MEDIUM) — 2026-04-25:
 *   Admin-namespace rate-limiting. `admin:*`-events kan misbrukes av en
 *   admin-bug eller misbruks-account til å flomme system. Pilot-policy:
 *   10/s per admin-socket + per admin user.id.
 *
 * Tester her verifiserer:
 *   - admin:pause-game over rate-limit returnerer ack med RATE_LIMITED
 *     og prosesserer IKKE eventet (engine.pauseGame ikke kalt).
 *   - admin:resume-game og admin:room-ready respekterer samme limit.
 *   - Når ingen rate-limiter er injisert (test-default) → ingen rate-limit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createAdminHallHandlers } from "../adminHallEvents.js";
import { SocketRateLimiter } from "../../middleware/socketRateLimit.js";
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
  id: string;
  data: Record<string, unknown> = {};
  joined = new Set<string>();
  emitted: Array<{ event: string; payload: unknown }> = [];
  private handlers = new Map<string, (payload: unknown, ack?: (r: AckResponse<unknown>) => void) => Promise<void> | void>();
  constructor(id = `s-${Math.random().toString(36).slice(2, 8)}`) {
    this.id = id;
  }
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
  to(_room: string) {
    return { emit: (_event: string, _payload: unknown) => true };
  }
}

interface FakeRoom {
  code: string;
  hallId: string;
  gameStatus: "RUNNING" | "WAITING";
  isPaused?: boolean;
}

function makeEngineStub(rooms: FakeRoom[]) {
  const calls = {
    pauseGame: [] as Array<{ roomCode: string; message?: string }>,
    resumeGame: [] as string[],
  };
  return {
    __calls: calls,
    getRoomSnapshot: (code: string) => {
      const r = rooms.find((x) => x.code === code.toUpperCase());
      if (!r) throw new Error(`unknown room ${code}`);
      return {
        code: r.code, hallId: r.hallId, hostPlayerId: "host-1",
        gameSlug: "bingo", createdAt: "2026-04-25T00:00:00Z",
        players: [], gameHistory: [],
        currentGame: { id: "g1", status: "RUNNING", drawnNumbers: [], isPaused: r.isPaused ?? false } as unknown,
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
  } as unknown as BingoEngine & { __calls: typeof calls };
}

function makePlatformStub() {
  return {
    getUserFromAccessToken: async (token: string) => {
      if (token !== "admin-token") throw new Error("invalid access token");
      return {
        id: "u-admin", email: "a@x.no", displayName: "Admin",
        role: "ADMIN" as const, walletId: "w-u-admin",
        kycStatus: "VERIFIED" as const, createdAt: "", updatedAt: "", balance: 0,
      };
    },
    getHall: async (hallId: string): Promise<HallDefinition> => ({
      id: hallId, slug: hallId, name: `Hall ${hallId}`, region: "test", address: "test",
      isActive: true, clientVariant: "web" as const, tvToken: `tv-${hallId}`,
      createdAt: "", updatedAt: "",
    }) as HallDefinition,
  } as unknown as PlatformService;
}

function setup(opts: {
  rateLimits?: Record<string, { windowMs: number; maxEvents: number }>;
  socketId?: string;
} = {}) {
  const rooms: FakeRoom[] = [{ code: "ROOM-A", hallId: "hall-a", gameStatus: "RUNNING" }];
  const engine = makeEngineStub(rooms);
  const platform = makePlatformStub();
  const io = new FakeIo();
  const walletAdapter = {} as WalletAdapter;
  const rateLimiter = opts.rateLimits ? new SocketRateLimiter(opts.rateLimits) : null;
  const register = createAdminHallHandlers({
    engine,
    platformService: platform,
    io: io as unknown as Server,
    walletAdapter,
    emitRoomUpdate: async (code) => ({ roomCode: code } as never),
    socketRateLimiter: rateLimiter ?? undefined,
  });
  const sock = new FakeSocket(opts.socketId);
  register(sock as unknown as Parameters<typeof register>[0]);
  return { engine, sock, rateLimiter };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("Bølge D Issue 2: admin:pause-game over rate-limit → RATE_LIMITED + engine NOT called", async () => {
  const { engine, sock } = setup({
    rateLimits: { "admin:pause-game": { windowMs: 10_000, maxEvents: 1 } },
  });

  // Login first
  const login = await sock.fire("admin:login", { accessToken: "admin-token" });
  assert.equal(login.ok, true);

  // First pause goes through
  const r1 = await sock.fire("admin:pause-game", { roomCode: "ROOM-A" });
  assert.equal(r1.ok, true);
  assert.equal((engine as unknown as { __calls: { pauseGame: unknown[] } }).__calls.pauseGame.length, 1);

  // Second pause is rate-limited
  const r2 = await sock.fire("admin:pause-game", { roomCode: "ROOM-A" });
  assert.equal(r2.ok, false, "2nd pause skal avvises av rate-limit");
  assert.equal(r2.error?.code, "RATE_LIMITED");
  // Engine was NOT called for the rate-limited event
  assert.equal(
    (engine as unknown as { __calls: { pauseGame: unknown[] } }).__calls.pauseGame.length,
    1,
    "engine.pauseGame skal IKKE kalles for rate-limited event",
  );
});

test("Bølge D Issue 2: admin:resume-game respekterer rate-limit", async () => {
  const { engine, sock } = setup({
    rateLimits: { "admin:resume-game": { windowMs: 10_000, maxEvents: 1 } },
  });
  await sock.fire("admin:login", { accessToken: "admin-token" });

  const r1 = await sock.fire("admin:resume-game", { roomCode: "ROOM-A" });
  assert.equal(r1.ok, true);

  const r2 = await sock.fire("admin:resume-game", { roomCode: "ROOM-A" });
  assert.equal(r2.ok, false);
  assert.equal(r2.error?.code, "RATE_LIMITED");
  assert.equal(
    (engine as unknown as { __calls: { resumeGame: unknown[] } }).__calls.resumeGame.length,
    1,
  );
});

test("Bølge D Issue 2: admin:login rate-limited før platformService-kall", async () => {
  const { sock } = setup({
    rateLimits: { "admin:login": { windowMs: 10_000, maxEvents: 1 } },
  });

  const r1 = await sock.fire("admin:login", { accessToken: "admin-token" });
  assert.equal(r1.ok, true);

  // Second login is rate-limited (won't even hit platformService.getUserFromAccessToken)
  const r2 = await sock.fire("admin:login", { accessToken: "admin-token" });
  assert.equal(r2.ok, false);
  assert.equal(r2.error?.code, "RATE_LIMITED");
});

test("Bølge D Issue 2: uten rate-limiter (test-default) → ingen rate-limit kicker inn", async () => {
  const { engine, sock, rateLimiter } = setup({});
  assert.equal(rateLimiter, null, "test starter UTEN rate-limiter");
  await sock.fire("admin:login", { accessToken: "admin-token" });

  // Send 10 pause events — alle skal gå igjennom uten rate-limit.
  for (let i = 0; i < 10; i++) {
    const r = await sock.fire("admin:pause-game", { roomCode: "ROOM-A" });
    assert.equal(r.ok, true, `pause #${i} skal passere uten limiter`);
  }
  assert.equal(
    (engine as unknown as { __calls: { pauseGame: unknown[] } }).__calls.pauseGame.length,
    10,
  );
});

test("Bølge D Issue 2: rate-limit per admin user.id overlever reconnect (BIN-247-mønster)", async () => {
  // Samme rate-limiter, to socket-instanser, samme admin-user → user.id-bucket
  // hindrer bypass via reconnect.
  const rateLimiter = new SocketRateLimiter({
    "admin:pause-game": { windowMs: 10_000, maxEvents: 1 },
  });
  const sharedDeps = (sockId: string) => {
    const rooms: FakeRoom[] = [{ code: "ROOM-A", hallId: "hall-a", gameStatus: "RUNNING" }];
    const engine = makeEngineStub(rooms);
    const platform = makePlatformStub();
    const io = new FakeIo();
    const register = createAdminHallHandlers({
      engine,
      platformService: platform,
      io: io as unknown as Server,
      walletAdapter: {} as WalletAdapter,
      emitRoomUpdate: async (code) => ({ roomCode: code } as never),
      socketRateLimiter: rateLimiter,
    });
    const sock = new FakeSocket(sockId);
    register(sock as unknown as Parameters<typeof register>[0]);
    return { engine, sock };
  };

  const a = sharedDeps("sock-a");
  await a.sock.fire("admin:login", { accessToken: "admin-token" });
  const r1 = await a.sock.fire("admin:pause-game", { roomCode: "ROOM-A" });
  assert.equal(r1.ok, true);

  // Reconnect-simulering: ny socket-instans, samme admin-user.
  const b = sharedDeps("sock-b");
  await b.sock.fire("admin:login", { accessToken: "admin-token" });
  const r2 = await b.sock.fire("admin:pause-game", { roomCode: "ROOM-A" });
  assert.equal(r2.ok, false, "reconnect skal IKKE bypass-e rate-limit (user.id-bucket)");
  assert.equal(r2.error?.code, "RATE_LIMITED");
});
