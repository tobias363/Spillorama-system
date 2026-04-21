/**
 * GAME1_SCHEDULE PR 2: integrasjonstester for admin-game1-ready-router.
 *
 * Dekker:
 *   POST /api/admin/game1/halls/:hallId/ready
 *   POST /api/admin/game1/halls/:hallId/unready
 *   GET  /api/admin/game1/games/:gameId/ready-status
 *
 * Verifiserer:
 *   - Auth + permission-krav (UNAUTHORIZED / FORBIDDEN)
 *   - Hall-scope for HALL_OPERATOR/AGENT
 *   - Happy path → 200 + AuditLog
 *   - Validation: ukjent game, hall ikke deltar, status ≠ purchase_open
 *   - GET returnerer alle deltakende haller + allReady-flagg
 *   - Socket-broadcast skjer via io-stub når injectet
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGame1ReadyRouter } from "../adminGame1Ready.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  Game1HallReadyService,
  HallReadyStatusRow,
} from "../../game/Game1HallReadyService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "a@test.no",
  displayName: "Admin",
  walletId: "w-a",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const operatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const operatorOtherHall: PublicAppUser = {
  ...adminUser,
  id: "op-2",
  role: "HALL_OPERATOR",
  hallId: "hall-x",
};
const agentUser: PublicAppUser = {
  ...adminUser,
  id: "ag-1",
  role: "AGENT",
  hallId: "hall-a",
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface EmittedSocketEvent {
  room: string | null;
  event: string;
  payload: unknown;
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  serviceCalls: {
    markReady: Array<Parameters<Game1HallReadyService["markReady"]>[0]>;
    unmarkReady: Array<Parameters<Game1HallReadyService["unmarkReady"]>[0]>;
    getReadyStatus: string[];
    allReady: string[];
    assertPurchaseOpen: Array<[string, string]>;
  };
  emitted: EmittedSocketEvent[];
  close: () => Promise<void>;
}

function defaultStatus(overrides: Partial<HallReadyStatusRow> = {}): HallReadyStatusRow {
  return {
    gameId: overrides.gameId ?? "g1",
    hallId: overrides.hallId ?? "hall-a",
    isReady: overrides.isReady ?? true,
    readyAt: overrides.readyAt ?? "2026-04-21T10:00:00.000Z",
    readyByUserId: overrides.readyByUserId ?? "op-1",
    digitalTicketsSold: overrides.digitalTicketsSold ?? 5,
    physicalTicketsSold: overrides.physicalTicketsSold ?? 3,
    excludedFromGame: overrides.excludedFromGame ?? false,
    excludedReason: overrides.excludedReason ?? null,
    createdAt: overrides.createdAt ?? "2026-04-21T09:50:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-21T10:00:00.000Z",
  };
}

interface StartOpts {
  users?: Record<string, PublicAppUser>;
  markReadyImpl?: (
    input: Parameters<Game1HallReadyService["markReady"]>[0]
  ) => Promise<HallReadyStatusRow>;
  unmarkReadyImpl?: (
    input: Parameters<Game1HallReadyService["unmarkReady"]>[0]
  ) => Promise<HallReadyStatusRow>;
  getStatusImpl?: (gameId: string) => Promise<HallReadyStatusRow[]>;
  allReadyImpl?: (gameId: string) => Promise<boolean>;
  halls?: Record<string, { id: string; name: string }>;
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const users: Record<string, PublicAppUser> = opts.users ?? {
    "t-admin": adminUser,
  };
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const serviceCalls: Ctx["serviceCalls"] = {
    markReady: [],
    unmarkReady: [],
    getReadyStatus: [],
    allReady: [],
    assertPurchaseOpen: [],
  };
  const emitted: EmittedSocketEvent[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getHall(hallId: string) {
      const h = opts.halls?.[hallId];
      if (h) return { ...h, isActive: true } as unknown as Awaited<ReturnType<PlatformService["getHall"]>>;
      throw new DomainError("HALL_NOT_FOUND", "nope");
    },
  } as unknown as PlatformService;

  const hallReadyService = {
    async markReady(input: Parameters<Game1HallReadyService["markReady"]>[0]) {
      serviceCalls.markReady.push(input);
      if (opts.markReadyImpl) return opts.markReadyImpl(input);
      return defaultStatus({ hallId: input.hallId, gameId: input.gameId });
    },
    async unmarkReady(input: Parameters<Game1HallReadyService["unmarkReady"]>[0]) {
      serviceCalls.unmarkReady.push(input);
      if (opts.unmarkReadyImpl) return opts.unmarkReadyImpl(input);
      return defaultStatus({
        hallId: input.hallId,
        gameId: input.gameId,
        isReady: false,
        readyAt: null,
      });
    },
    async getReadyStatusForGame(gameId: string) {
      serviceCalls.getReadyStatus.push(gameId);
      if (opts.getStatusImpl) return opts.getStatusImpl(gameId);
      return [defaultStatus({ gameId, hallId: "hall-a" })];
    },
    async allParticipatingHallsReady(gameId: string) {
      serviceCalls.allReady.push(gameId);
      if (opts.allReadyImpl) return opts.allReadyImpl(gameId);
      return true;
    },
    async assertPurchaseOpenForHall(gameId: string, hallId: string) {
      serviceCalls.assertPurchaseOpen.push([gameId, hallId]);
    },
  } as unknown as Game1HallReadyService;

  // Minimal socket-server-stub som fanger emits.
  const io = {
    emit: (event: string, payload: unknown) => {
      emitted.push({ room: null, event, payload });
    },
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  } as unknown as import("socket.io").Server;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGame1ReadyRouter({
      platformService,
      auditLogService,
      hallReadyService,
      io,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    auditStore,
    serviceCalls,
    emitted,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function req(
  ctx: Ctx,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ── POST /halls/:hallId/ready ───────────────────────────────────────────────

test("PR2 router: POST ready uten token → UNAUTHORIZED", async () => {
  const ctx = await startServer();
  try {
    const res = await req(ctx, "POST", "/api/admin/game1/halls/hall-a/ready");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST ready som PLAYER → FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-pl": playerUser } });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/ready",
      "t-pl",
      { gameId: "g1" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST ready som SUPPORT → FORBIDDEN (ikke drift-rolle)", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/ready",
      "t-sup",
      { gameId: "g1" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST ready som HALL_OPERATOR på annen hall → FORBIDDEN", async () => {
  const ctx = await startServer({
    users: { "t-op2": operatorOtherHall },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/ready",
      "t-op2",
      { gameId: "g1" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST ready som ADMIN happy path → 200 + AuditLog + socket-emit", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    halls: { "hall-a": { id: "hall-a", name: "Hall Alpha" } },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/ready",
      "t-admin",
      { gameId: "g1", digitalTicketsSold: 5 }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.isReady, true);
    assert.equal(res.body.data.hallName, "Hall Alpha");
    assert.equal(res.body.data.allReady, true);
    assert.equal(res.body.data.gameId, "g1");

    // Service-kall
    assert.equal(ctx.serviceCalls.markReady.length, 1);
    assert.equal(ctx.serviceCalls.markReady[0]!.hallId, "hall-a");
    assert.equal(ctx.serviceCalls.markReady[0]!.digitalTicketsSold, 5);

    // AuditLog
    const audits = await ctx.auditStore.list({});
    assert.ok(audits.find((a) => a.action === "hall.sales.closed"));

    // Socket-broadcast
    const event = ctx.emitted.find((e) => e.event === "game1:ready-status-update");
    assert.ok(event, "forventet socket-emit");
    assert.deepEqual(event!.room, null); // global emit først
    const displayEmit = ctx.emitted.find(
      (e) => e.room === "hall:hall-a:display"
    );
    assert.ok(displayEmit, "forventet display-emit for hall");
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST ready som HALL_OPERATOR egen hall → 200", async () => {
  const ctx = await startServer({
    users: { "t-op": operatorUser },
    halls: { "hall-a": { id: "hall-a", name: "Hall A" } },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/ready",
      "t-op",
      { gameId: "g1" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.isReady, true);
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST ready som AGENT egen hall → 200", async () => {
  const ctx = await startServer({
    users: { "t-ag": agentUser },
    halls: { "hall-a": { id: "hall-a", name: "Hall A" } },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/ready",
      "t-ag",
      { gameId: "g1" }
    );
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST ready med ukjent game → GAME_NOT_FOUND", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    markReadyImpl: async () => {
      throw new DomainError("GAME_NOT_FOUND", "nope");
    },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/ready",
      "t-admin",
      { gameId: "ghost" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "GAME_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST ready med status feil → GAME_NOT_READY_ELIGIBLE", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    markReadyImpl: async () => {
      throw new DomainError(
        "GAME_NOT_READY_ELIGIBLE",
        "spillet er i feil status"
      );
    },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/ready",
      "t-admin",
      { gameId: "g1" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "GAME_NOT_READY_ELIGIBLE");
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST ready uten gameId i body → INVALID_INPUT", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/ready",
      "t-admin",
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── POST /halls/:hallId/unready ─────────────────────────────────────────────

test("PR2 router: POST unready som HALL_OPERATOR egen hall happy path → 200 + AuditLog", async () => {
  const ctx = await startServer({
    users: { "t-op": operatorUser },
    halls: { "hall-a": { id: "hall-a", name: "Hall A" } },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/unready",
      "t-op",
      { gameId: "g1" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.isReady, false);
    const audits = await ctx.auditStore.list({});
    assert.ok(audits.find((a) => a.action === "hall.sales.reopened"));
  } finally {
    await ctx.close();
  }
});

test("PR2 router: POST unready avviser hvis ingen rad finnes", async () => {
  const ctx = await startServer({
    users: { "t-op": operatorUser },
    unmarkReadyImpl: async () => {
      throw new DomainError("READY_STATUS_NOT_FOUND", "not found");
    },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/halls/hall-a/unready",
      "t-op",
      { gameId: "g1" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "READY_STATUS_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── GET /games/:gameId/ready-status ─────────────────────────────────────────

test("PR2 router: GET ready-status som ADMIN → 200 + halls-array", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    halls: {
      "hall-a": { id: "hall-a", name: "Hall Alpha" },
      "hall-b": { id: "hall-b", name: "Hall Beta" },
    },
    getStatusImpl: async (gameId) => [
      defaultStatus({ gameId, hallId: "hall-a", isReady: true }),
      defaultStatus({ gameId, hallId: "hall-b", isReady: false }),
    ],
    allReadyImpl: async () => false,
  });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/game1/games/g1/ready-status",
      "t-admin"
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.gameId, "g1");
    assert.equal(res.body.data.halls.length, 2);
    assert.equal(res.body.data.allReady, false);
    const byHall = new Map<string, any>(
      res.body.data.halls.map((h: any) => [h.hallId, h])
    );
    assert.equal(byHall.get("hall-a").hallName, "Hall Alpha");
    assert.equal(byHall.get("hall-a").isReady, true);
    assert.equal(byHall.get("hall-b").isReady, false);
  } finally {
    await ctx.close();
  }
});

test("PR2 router: GET ready-status som SUPPORT → 200 (GAME1_GAME_READ)", async () => {
  const ctx = await startServer({
    users: { "t-sup": supportUser },
    halls: { "hall-a": { id: "hall-a", name: "Hall A" } },
  });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/game1/games/g1/ready-status",
      "t-sup"
    );
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("PR2 router: GET ready-status som PLAYER → FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-pl": playerUser } });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/game1/games/g1/ready-status",
      "t-pl"
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});
