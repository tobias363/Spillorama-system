/**
 * BIN-498: Hall TV-display socket handlers — unit tests.
 *
 * Drives the createAdminDisplayHandlers factory directly with a fake socket
 * + io shim so the test runs without spinning up a real Socket.IO server.
 * Covers: token rejection, login → subscribe binding, hall isolation,
 * state-snapshot shape.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createAdminDisplayHandlers } from "../adminDisplayEvents.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { PlatformService } from "../../platform/PlatformService.js";
import type { Server } from "socket.io";

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ── Fake socket that captures handlers + emits ─────────────────────────────

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

  /** Test helper: invoke an event and return the ack response. */
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

// ── Stubs for the engine + platformService surface we exercise ────────────

function makeEngineStub(rooms: Array<{ code: string; hallId: string; gameStatus: "RUNNING" | "WAITING" | "ENDED" }>) {
  return {
    listRoomSummaries: () => rooms.map((r) => ({ code: r.code, hallId: r.hallId, gameStatus: r.gameStatus, gameSlug: "bingo", playerCount: 0, hostPlayerId: "p" })),
    getRoomSnapshot: (code: string) => {
      const r = rooms.find((x) => x.code === code);
      if (!r) throw new Error("unknown room");
      return {
        code: r.code,
        hallId: r.hallId,
        hostPlayerId: "p",
        gameSlug: "bingo",
        createdAt: "2026-04-18T00:00:00Z",
        players: [],
        gameHistory: [],
        currentGame: r.gameStatus === "ENDED"
          ? undefined
          : { id: "game-1", status: r.gameStatus, drawnNumbers: [3, 7, 12] } as unknown,
      };
    },
  } as unknown as BingoEngine;
}

function makePlatformStub(halls: Array<{ id: string; name: string; tvUrl?: string | null }>) {
  return {
    getHall: async (idOrSlug: string) => {
      const h = halls.find((x) => x.id === idOrSlug);
      if (!h) throw new Error(`unknown hall ${idOrSlug}`);
      return {
        id: h.id,
        slug: h.id,
        name: h.name,
        region: "NO",
        address: "",
        isActive: true,
        clientVariant: "unity" as const,
        tvUrl: h.tvUrl ?? undefined,
        createdAt: "2026-04-18T00:00:00Z",
        updatedAt: "2026-04-18T00:00:00Z",
      };
    },
  } as unknown as PlatformService;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("BIN-498 login: rejects missing token", async () => {
  const io = new FakeIo();
  const register = createAdminDisplayHandlers({
    engine: makeEngineStub([]),
    platformService: makePlatformStub([]),
    io: io as unknown as Server,
    screensaverConfig: { enabled: true, timeoutMs: 300000, imageRotationMs: 10000 },
    validateDisplayToken: async () => ({ hallId: "hall-1" }),
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);
  const result = await sock.fire("admin-display:login", {});
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "MISSING_TOKEN");
});

test("BIN-498 login: rejects invalid token", async () => {
  const io = new FakeIo();
  const register = createAdminDisplayHandlers({
    engine: makeEngineStub([]),
    platformService: makePlatformStub([]),
    io: io as unknown as Server,
    screensaverConfig: { enabled: true, timeoutMs: 300000, imageRotationMs: 10000 },
    validateDisplayToken: async () => { throw new Error("token mismatch"); },
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);
  const result = await sock.fire("admin-display:login", { token: "bad-token" });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "UNAUTHORIZED");
});

test("BIN-498 login → subscribe: socket joins display + active room", async () => {
  const io = new FakeIo();
  const engine = makeEngineStub([{ code: "ROOM-A", hallId: "hall-A", gameStatus: "RUNNING" }]);
  const platform = makePlatformStub([{ id: "hall-A", name: "Hall A", tvUrl: "https://promo.example/hall-a" }]);
  const register = createAdminDisplayHandlers({
    engine, platformService: platform, io: io as unknown as Server,
    screensaverConfig: { enabled: true, timeoutMs: 300000, imageRotationMs: 10000 },
    validateDisplayToken: async () => ({ hallId: "hall-A" }),
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);

  const login = await sock.fire<{ hallId: string }>("admin-display:login", { token: "anything" });
  assert.ok(login.ok);
  assert.equal(login.data?.hallId, "hall-A");

  const sub = await sock.fire<{ hallId: string; tvUrl: string | null; activeRoom: { code: string } | null }>("admin-display:subscribe", {});
  assert.ok(sub.ok, `subscribe failed: ${sub.error?.message}`);
  assert.equal(sub.data?.hallId, "hall-A");
  assert.equal(sub.data?.tvUrl, "https://promo.example/hall-a");
  assert.equal(sub.data?.activeRoom?.code, "ROOM-A");

  // Verify the socket joined the right rooms.
  assert.ok(sock.joined.has("hall:hall-A:display"), "must join hall display room");
  assert.ok(sock.joined.has("ROOM-A"), "must join active game room");
});

test("BIN-498 subscribe: rejects when not logged in", async () => {
  const io = new FakeIo();
  const register = createAdminDisplayHandlers({
    engine: makeEngineStub([]),
    platformService: makePlatformStub([{ id: "hall-1", name: "Hall 1" }]),
    io: io as unknown as Server,
    screensaverConfig: { enabled: true, timeoutMs: 300000, imageRotationMs: 10000 },
    validateDisplayToken: async () => ({ hallId: "hall-1" }),
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);
  const sub = await sock.fire("admin-display:subscribe", {});
  assert.equal(sub.ok, false);
  assert.equal(sub.error?.code, "NOT_LOGGED_IN");
});

test("BIN-498 hall-isolation: a socket logged in for hall-A never joins hall-B's display room", async () => {
  const io = new FakeIo();
  const engine = makeEngineStub([
    { code: "ROOM-A", hallId: "hall-A", gameStatus: "RUNNING" },
    { code: "ROOM-B", hallId: "hall-B", gameStatus: "RUNNING" },
  ]);
  const platform = makePlatformStub([
    { id: "hall-A", name: "Hall A" },
    { id: "hall-B", name: "Hall B" },
  ]);
  const register = createAdminDisplayHandlers({
    engine, platformService: platform, io: io as unknown as Server,
    screensaverConfig: { enabled: true, timeoutMs: 300000, imageRotationMs: 10000 },
    validateDisplayToken: async () => ({ hallId: "hall-A" }), // bound to A
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);

  await sock.fire("admin-display:login", { token: "anything" });
  await sock.fire("admin-display:subscribe", {});

  assert.ok(sock.joined.has("hall:hall-A:display"));
  assert.ok(sock.joined.has("ROOM-A"));
  assert.ok(!sock.joined.has("hall:hall-B:display"), "must NOT join other hall's display room");
  assert.ok(!sock.joined.has("ROOM-B"), "must NOT join other hall's game room");
});

test("BIN-585: admin-display:screensaver returns configured values without requiring login", async () => {
  // Hall-display TV fetches this before admin-display:login to know how
  // long to wait before dimming — so no auth gate.
  const io = new FakeIo();
  const register = createAdminDisplayHandlers({
    engine: makeEngineStub([]),
    platformService: makePlatformStub([]),
    io: io as unknown as Server,
    screensaverConfig: { enabled: true, timeoutMs: 123456, imageRotationMs: 7890 },
    validateDisplayToken: async () => ({ hallId: "hall-1" }),
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);
  const r = await sock.fire<{ enabled: boolean; timeoutMs: number; imageRotationMs: number }>(
    "admin-display:screensaver", {},
  );
  assert.equal(r.ok, true, `admin-display:screensaver failed: ${r.error?.message}`);
  assert.equal(r.data?.enabled, true);
  assert.equal(r.data?.timeoutMs, 123456);
  assert.equal(r.data?.imageRotationMs, 7890);
});

test("BIN-585: admin-display:screensaver reflects disabled config", async () => {
  const io = new FakeIo();
  const register = createAdminDisplayHandlers({
    engine: makeEngineStub([]),
    platformService: makePlatformStub([]),
    io: io as unknown as Server,
    screensaverConfig: { enabled: false, timeoutMs: 0, imageRotationMs: 10000 },
    validateDisplayToken: async () => ({ hallId: "hall-1" }),
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);
  const r = await sock.fire<{ enabled: boolean; timeoutMs: number }>(
    "admin-display:screensaver", {},
  );
  assert.equal(r.ok, true);
  assert.equal(r.data?.enabled, false);
});

test("BIN-585: legacy ScreenSaver alias dispatches to admin-display:screensaver via alias-map", async () => {
  // The alias is registered in legacyEventAliases.ts — here we verify the
  // canonical handler exists on the socket, which is what the alias
  // re-dispatch looks up via socket.listeners("admin-display:screensaver").
  const io = new FakeIo();
  const register = createAdminDisplayHandlers({
    engine: makeEngineStub([]),
    platformService: makePlatformStub([]),
    io: io as unknown as Server,
    screensaverConfig: { enabled: true, timeoutMs: 300000, imageRotationMs: 10000 },
    validateDisplayToken: async () => ({ hallId: "hall-1" }),
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);
  const r = await sock.fire<{ enabled: boolean }>("admin-display:screensaver", {});
  assert.ok(r.ok, "canonical handler must exist for alias to dispatch to");
});

test("BIN-498 state: returns fresh snapshot on demand", async () => {
  const io = new FakeIo();
  const engine = makeEngineStub([{ code: "ROOM-X", hallId: "hall-X", gameStatus: "RUNNING" }]);
  const platform = makePlatformStub([{ id: "hall-X", name: "Hall X", tvUrl: null }]);
  const register = createAdminDisplayHandlers({
    engine, platformService: platform, io: io as unknown as Server,
    screensaverConfig: { enabled: true, timeoutMs: 300000, imageRotationMs: 10000 },
    validateDisplayToken: async () => ({ hallId: "hall-X" }),
  });
  const sock = new FakeSocket();
  register(sock as unknown as Parameters<typeof register>[0]);

  await sock.fire("admin-display:login", { token: "anything" });
  const state = await sock.fire<{ activeRoom: { code: string; gameStatus: string; currentGame?: { drawnNumbers: number[] } } | null }>(
    "admin-display:state", {},
  );
  assert.ok(state.ok);
  assert.equal(state.data?.activeRoom?.code, "ROOM-X");
  assert.equal(state.data?.activeRoom?.gameStatus, "RUNNING");
  assert.deepEqual(state.data?.activeRoom?.currentGame?.drawnNumbers, [3, 7, 12]);
});
