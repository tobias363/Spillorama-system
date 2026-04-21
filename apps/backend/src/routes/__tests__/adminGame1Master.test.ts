/**
 * GAME1_SCHEDULE PR 3: integrasjonstester for admin-game1-master-router.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGame1MasterRouter } from "../adminGame1Master.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type { Game1MasterControlService } from "../../game/Game1MasterControlService.js";
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
const masterOperator: PublicAppUser = {
  ...adminUser,
  id: "op-m",
  role: "HALL_OPERATOR",
  hallId: "hall-master",
};
const agentAtMaster: PublicAppUser = {
  ...adminUser,
  id: "ag-m",
  role: "AGENT",
  hallId: "hall-master",
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
    startGame: Array<Parameters<Game1MasterControlService["startGame"]>[0]>;
    excludeHall: Array<Parameters<Game1MasterControlService["excludeHall"]>[0]>;
    includeHall: Array<Parameters<Game1MasterControlService["includeHall"]>[0]>;
    pauseGame: Array<Parameters<Game1MasterControlService["pauseGame"]>[0]>;
    resumeGame: Array<Parameters<Game1MasterControlService["resumeGame"]>[0]>;
    stopGame: Array<Parameters<Game1MasterControlService["stopGame"]>[0]>;
    getGameDetail: string[];
  };
  emitted: EmittedSocketEvent[];
  close: () => Promise<void>;
}

const defaultDetail: Awaited<ReturnType<Game1MasterControlService["getGameDetail"]>> = {
  game: {
    id: "g1",
    status: "ready_to_start",
    scheduledStartTime: "2026-04-21T10:00:00.000Z",
    scheduledEndTime: "2026-04-21T11:00:00.000Z",
    actualStartTime: null,
    actualEndTime: null,
    masterHallId: "hall-master",
    groupHallId: "grp-1",
    participatingHallIds: ["hall-master", "hall-2"],
    subGameName: "Jackpot",
    customGameName: null,
    startedByUserId: null,
    stoppedByUserId: null,
    stopReason: null,
  },
  halls: [
    {
      hallId: "hall-master",
      isReady: true,
      readyAt: "2026-04-21T09:55:00.000Z",
      readyByUserId: "u-m",
      digitalTicketsSold: 10,
      physicalTicketsSold: 5,
      excludedFromGame: false,
      excludedReason: null,
    },
    {
      hallId: "hall-2",
      isReady: true,
      readyAt: "2026-04-21T09:58:00.000Z",
      readyByUserId: "u-2",
      digitalTicketsSold: 7,
      physicalTicketsSold: 3,
      excludedFromGame: false,
      excludedReason: null,
    },
  ],
  auditRecent: [
    {
      id: "a1",
      action: "start",
      actorUserId: "u-m",
      actorHallId: "hall-master",
      metadata: {},
      createdAt: "2026-04-21T10:00:00.000Z",
    },
  ],
};

interface StartOpts {
  users?: Record<string, PublicAppUser>;
  startImpl?: Game1MasterControlService["startGame"];
  excludeImpl?: Game1MasterControlService["excludeHall"];
  includeImpl?: Game1MasterControlService["includeHall"];
  pauseImpl?: Game1MasterControlService["pauseGame"];
  resumeImpl?: Game1MasterControlService["resumeGame"];
  stopImpl?: Game1MasterControlService["stopGame"];
  detailImpl?: Game1MasterControlService["getGameDetail"];
  halls?: Record<string, { id: string; name: string }>;
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const users: Record<string, PublicAppUser> = opts.users ?? {
    "t-admin": adminUser,
  };
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const serviceCalls: Ctx["serviceCalls"] = {
    startGame: [],
    excludeHall: [],
    includeHall: [],
    pauseGame: [],
    resumeGame: [],
    stopGame: [],
    getGameDetail: [],
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
      if (h)
        return { ...h, isActive: true } as unknown as Awaited<
          ReturnType<PlatformService["getHall"]>
        >;
      throw new DomainError("HALL_NOT_FOUND", "nope");
    },
  } as unknown as PlatformService;

  const defaultOkResult = {
    gameId: "g1",
    status: "running",
    actualStartTime: "2026-04-21T10:00:00.000Z",
    actualEndTime: null,
    auditId: "audit-1",
  };

  const masterControlService = {
    async startGame(input: Parameters<Game1MasterControlService["startGame"]>[0]) {
      serviceCalls.startGame.push(input);
      if (opts.startImpl) return opts.startImpl(input);
      return { ...defaultOkResult };
    },
    async excludeHall(
      input: Parameters<Game1MasterControlService["excludeHall"]>[0]
    ) {
      serviceCalls.excludeHall.push(input);
      if (opts.excludeImpl) return opts.excludeImpl(input);
      return { ...defaultOkResult, status: "purchase_open", auditId: "audit-ex" };
    },
    async includeHall(
      input: Parameters<Game1MasterControlService["includeHall"]>[0]
    ) {
      serviceCalls.includeHall.push(input);
      if (opts.includeImpl) return opts.includeImpl(input);
      return { ...defaultOkResult, status: "purchase_open", auditId: "audit-in" };
    },
    async pauseGame(input: Parameters<Game1MasterControlService["pauseGame"]>[0]) {
      serviceCalls.pauseGame.push(input);
      if (opts.pauseImpl) return opts.pauseImpl(input);
      return { ...defaultOkResult, status: "paused", auditId: "audit-p" };
    },
    async resumeGame(
      input: Parameters<Game1MasterControlService["resumeGame"]>[0]
    ) {
      serviceCalls.resumeGame.push(input);
      if (opts.resumeImpl) return opts.resumeImpl(input);
      return { ...defaultOkResult, status: "running", auditId: "audit-r" };
    },
    async stopGame(input: Parameters<Game1MasterControlService["stopGame"]>[0]) {
      serviceCalls.stopGame.push(input);
      if (opts.stopImpl) return opts.stopImpl(input);
      return {
        ...defaultOkResult,
        status: "cancelled",
        actualEndTime: "2026-04-21T10:30:00.000Z",
        auditId: "audit-s",
      };
    },
    async getGameDetail(gameId: string) {
      serviceCalls.getGameDetail.push(gameId);
      if (opts.detailImpl) return opts.detailImpl(gameId);
      return defaultDetail;
    },
  } as unknown as Game1MasterControlService;

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
    createAdminGame1MasterRouter({
      platformService,
      auditLogService,
      masterControlService,
      io,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    auditStore,
    serviceCalls,
    emitted,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function post(ctx: Ctx, path: string, token: string, body: unknown): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function get(ctx: Ctx, path: string, token: string): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── POST /start ─────────────────────────────────────────────────────────────

test("POST /start — ADMIN happy path → 200 + audit-id + socket-broadcast", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    halls: { "hall-master": { id: "hall-master", name: "Master Hall" } },
  });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/start", "t-admin", {
      confirmExcludedHalls: ["hall-3"],
    });
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { ok: boolean; data: { auditId: string } };
    assert.equal(payload.ok, true);
    assert.equal(payload.data.auditId, "audit-1");
    assert.equal(ctx.serviceCalls.startGame.length, 1);
    assert.deepEqual(ctx.serviceCalls.startGame[0]!.confirmExcludedHalls, ["hall-3"]);
    assert.equal(ctx.serviceCalls.startGame[0]!.actor.role, "ADMIN");
    const globalEmit = ctx.emitted.find((e) => e.room === null);
    assert.ok(globalEmit);
    assert.equal(globalEmit!.event, "game1:master-action");
    const groupEmit = ctx.emitted.find((e) => e.room === "group:grp-1");
    assert.ok(groupEmit);
  } finally {
    await ctx.close();
  }
});

test("POST /start — HALL_OPERATOR ved master-hall aksepteres", async () => {
  const ctx = await startServer({
    users: { "t-op": masterOperator },
  });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/start", "t-op", {});
    assert.equal(res.status, 200);
    assert.equal(ctx.serviceCalls.startGame[0]!.actor.hallId, "hall-master");
  } finally {
    await ctx.close();
  }
});

test("POST /start — AGENT ved master-hall aksepteres", async () => {
  const ctx = await startServer({
    users: { "t-ag": agentAtMaster },
  });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/start", "t-ag", {});
    assert.equal(res.status, 200);
    assert.equal(ctx.serviceCalls.startGame[0]!.actor.role, "AGENT");
  } finally {
    await ctx.close();
  }
});

test("POST /start — SUPPORT avvises med 400 FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/start", "t-sup", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "FORBIDDEN");
    assert.equal(ctx.serviceCalls.startGame.length, 0);
  } finally {
    await ctx.close();
  }
});

test("POST /start — PLAYER avvises med 400 FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-pl": playerUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/start", "t-pl", {});
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

test("POST /start — DomainError fra service propageres som 400 + error.code", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    startImpl: async () => {
      throw new DomainError("HALLS_NOT_READY", "ikke klare");
    },
  });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/start", "t-admin", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "HALLS_NOT_READY");
  } finally {
    await ctx.close();
  }
});

// ── POST /exclude-hall ──────────────────────────────────────────────────────

test("POST /exclude-hall — happy path → 200 + service-kall", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/exclude-hall", "t-admin", {
      hallId: "hall-2",
      reason: "Tekniske problemer",
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.serviceCalls.excludeHall.length, 1);
    assert.equal(ctx.serviceCalls.excludeHall[0]!.hallId, "hall-2");
    assert.equal(ctx.serviceCalls.excludeHall[0]!.reason, "Tekniske problemer");
  } finally {
    await ctx.close();
  }
});

test("POST /exclude-hall — mangler reason → 400 INVALID_INPUT", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/exclude-hall", "t-admin", {
      hallId: "hall-2",
    });
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── POST /include-hall ──────────────────────────────────────────────────────

test("POST /include-hall — happy path → 200", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/include-hall", "t-admin", {
      hallId: "hall-2",
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.serviceCalls.includeHall.length, 1);
  } finally {
    await ctx.close();
  }
});

// ── POST /pause ─────────────────────────────────────────────────────────────

test("POST /pause — happy path", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/pause", "t-admin", {
      reason: "short break",
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.serviceCalls.pauseGame.length, 1);
    assert.equal(ctx.serviceCalls.pauseGame[0]!.reason, "short break");
  } finally {
    await ctx.close();
  }
});

test("POST /pause — tom body aksepteres", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/pause", "t-admin", {});
    assert.equal(res.status, 200);
    assert.equal(ctx.serviceCalls.pauseGame[0]!.reason, undefined);
  } finally {
    await ctx.close();
  }
});

// ── POST /resume ────────────────────────────────────────────────────────────

test("POST /resume — happy path", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/resume", "t-admin", {});
    assert.equal(res.status, 200);
    assert.equal(ctx.serviceCalls.resumeGame.length, 1);
  } finally {
    await ctx.close();
  }
});

// ── POST /stop ──────────────────────────────────────────────────────────────

test("POST /stop — happy path med reason", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/stop", "t-admin", {
      reason: "Strøm brudd",
    });
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { data: { status: string } };
    assert.equal(payload.data.status, "cancelled");
    assert.equal(ctx.serviceCalls.stopGame.length, 1);
    assert.equal(ctx.serviceCalls.stopGame[0]!.reason, "Strøm brudd");
  } finally {
    await ctx.close();
  }
});

test("POST /stop — mangler reason → 400 INVALID_INPUT", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/stop", "t-admin", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── GET /:gameId ────────────────────────────────────────────────────────────

test("GET /:gameId — happy path returnerer game + halls + audit + allReady", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    halls: {
      "hall-master": { id: "hall-master", name: "Master Hall" },
      "hall-2": { id: "hall-2", name: "Hall Two" },
    },
  });
  try {
    const res = await get(ctx, "/api/admin/game1/games/g1", "t-admin");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: {
        game: { id: string; status: string };
        halls: Array<{ hallId: string; hallName: string; isReady: boolean }>;
        allReady: boolean;
        auditRecent: Array<{ action: string }>;
      };
    };
    assert.equal(payload.data.game.id, "g1");
    assert.equal(payload.data.game.status, "ready_to_start");
    assert.equal(payload.data.halls.length, 2);
    assert.equal(payload.data.halls[0]!.hallName, "Master Hall");
    assert.equal(payload.data.halls[1]!.hallName, "Hall Two");
    assert.equal(payload.data.allReady, true);
    assert.equal(payload.data.auditRecent.length, 1);
    assert.equal(payload.data.auditRecent[0]!.action, "start");
  } finally {
    await ctx.close();
  }
});

test("GET /:gameId — SUPPORT aksepteres (read-only)", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await get(ctx, "/api/admin/game1/games/g1", "t-sup");
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("GET /:gameId — allReady=false når en hall ikke er klar", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    detailImpl: async () => ({
      ...defaultDetail,
      halls: [
        { ...defaultDetail.halls[0]!, isReady: true },
        { ...defaultDetail.halls[1]!, isReady: false },
      ],
    }),
  });
  try {
    const res = await get(ctx, "/api/admin/game1/games/g1", "t-admin");
    const payload = (await res.json()) as { data: { allReady: boolean } };
    assert.equal(payload.data.allReady, false);
  } finally {
    await ctx.close();
  }
});

test("GET /:gameId — allReady=true ignorerer ekskluderte haller", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    detailImpl: async () => ({
      ...defaultDetail,
      halls: [
        { ...defaultDetail.halls[0]!, isReady: true },
        {
          ...defaultDetail.halls[1]!,
          isReady: false,
          excludedFromGame: true,
          excludedReason: "tech failure",
        },
      ],
    }),
  });
  try {
    const res = await get(ctx, "/api/admin/game1/games/g1", "t-admin");
    const payload = (await res.json()) as { data: { allReady: boolean } };
    assert.equal(payload.data.allReady, true);
  } finally {
    await ctx.close();
  }
});

test("GET /:gameId — PLAYER avvises med FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-pl": playerUser } });
  try {
    const res = await get(ctx, "/api/admin/game1/games/g1", "t-pl");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /:gameId — ukjent game propageres som 400 GAME_NOT_FOUND", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    detailImpl: async () => {
      throw new DomainError("GAME_NOT_FOUND", "nope");
    },
  });
  try {
    const res = await get(ctx, "/api/admin/game1/games/g1", "t-admin");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "GAME_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("POST /start — HALL_OPERATOR uten hallId avvises FORBIDDEN", async () => {
  const noHallOp: PublicAppUser = { ...masterOperator, hallId: null };
  const ctx = await startServer({ users: { "t-nh": noHallOp } });
  try {
    const res = await post(ctx, "/api/admin/game1/games/g1/start", "t-nh", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});
