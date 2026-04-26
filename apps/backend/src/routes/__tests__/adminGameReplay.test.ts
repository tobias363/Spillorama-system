/**
 * LOW-1: Integrasjonstester for admin-game-replay-router.
 *
 * Dekker:
 *   - happy-path: ADMIN får 200 + replay-payload + audit-rad logget
 *   - RBAC-fail: PLAYER får 403 (mangler både GAME1_GAME_READ og PLAYER_KYC_READ)
 *   - RBAC-fail: HALL_OPERATOR får 403 (mangler PLAYER_KYC_READ)
 *   - GAME_NOT_FOUND: ukjent gameId → ApiFailure med code GAME_NOT_FOUND
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGameReplayRouter } from "../adminGameReplay.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type { Game1ReplayService, Game1ReplayResult } from "../../game/Game1ReplayService.js";
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
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const hallOperator: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "h-1",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

const sampleReplay: Game1ReplayResult = {
  meta: {
    scheduledGameId: "g1",
    status: "completed",
    scheduledStartTime: "2026-04-26T10:00:00.000Z",
    scheduledEndTime: "2026-04-26T11:00:00.000Z",
    actualStartTime: "2026-04-26T10:01:00.000Z",
    actualEndTime: "2026-04-26T10:50:00.000Z",
    masterHallId: "h-m",
    groupHallId: "grp",
    participatingHallIds: ["h-m"],
    excludedHallIds: [],
    subGameName: "Jackpot",
    customGameName: null,
    startedByUserId: "u",
    stoppedByUserId: null,
    stopReason: null,
    eventCount: 3,
    generatedAt: "2026-04-26T10:50:01.000Z",
  },
  events: [
    {
      sequence: 100,
      type: "room_created",
      timestamp: "2026-04-26T10:00:00.000Z",
      actor: { kind: "system", userId: null, role: null, hallId: null },
      data: { scheduledGameId: "g1" },
    },
    {
      sequence: 200,
      type: "tickets_purchased",
      timestamp: "2026-04-26T10:05:00.000Z",
      actor: { kind: "user", userId: "u-pl", role: "PLAYER", hallId: "h-m" },
      data: { email: "a***@b.no", displayName: "Alice S***" },
    },
    {
      sequence: 300,
      type: "game_ended",
      timestamp: "2026-04-26T10:50:00.000Z",
      actor: { kind: "system", userId: null, role: null, hallId: null },
      data: { status: "completed" },
    },
  ],
};

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  replayCalls: string[];
  close: () => Promise<void>;
}

interface StartOpts {
  users?: Record<string, PublicAppUser>;
  replayImpl?: Game1ReplayService["getReplay"];
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const users: Record<string, PublicAppUser> = opts.users ?? {
    "t-admin": adminUser,
  };
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const replayCalls: string[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const replayService = {
    async getReplay(gameId: string) {
      replayCalls.push(gameId);
      if (opts.replayImpl) return opts.replayImpl(gameId);
      return sampleReplay;
    },
  } as unknown as Game1ReplayService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGameReplayRouter({
      platformService,
      auditLogService,
      replayService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    auditStore,
    replayCalls,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function get(ctx: Ctx, path: string, token: string): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── Test 1: Happy-path ─────────────────────────────────────────────────────

test("GET /replay — ADMIN happy path → 200 + audit-rad logget", async () => {
  const ctx = await startServer({ users: { "t-admin": adminUser } });
  try {
    const res = await get(ctx, "/api/admin/games/g1/replay", "t-admin");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      ok: boolean;
      data: Game1ReplayResult;
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.data.meta.scheduledGameId, "g1");
    assert.equal(payload.data.events.length, 3);
    assert.equal(ctx.replayCalls.length, 1);
    assert.equal(ctx.replayCalls[0], "g1");

    // Audit-rad må være skrevet (fire-and-forget men sync i in-memory).
    // Gi event-loop én tick for å la promise resolve.
    await new Promise((r) => setImmediate(r));
    const events = await ctx.auditStore.list({ limit: 10 });
    const replayEvent = events.find((e) => e.action === "admin.game.replay.read");
    assert.ok(replayEvent, "admin.game.replay.read audit-rad mangler");
    assert.equal(replayEvent!.actorId, "admin-1");
    assert.equal(replayEvent!.resourceId, "g1");
  } finally {
    await ctx.close();
  }
});

test("GET /replay — SUPPORT happy path → 200 (har begge permissions)", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await get(ctx, "/api/admin/games/g1/replay", "t-sup");
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

// ── Test 2: RBAC — PLAYER mangler begge permissions ────────────────────────

test("GET /replay — PLAYER → 400 FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-pl": playerUser } });
  try {
    const res = await get(ctx, "/api/admin/games/g1/replay", "t-pl");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "FORBIDDEN");
    // Service skal IKKE være kalt — RBAC blokkerer før det.
    assert.equal(ctx.replayCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

// ── Test 3: RBAC — HALL_OPERATOR mangler PLAYER_KYC_READ ───────────────────

test("GET /replay — HALL_OPERATOR → 400 FORBIDDEN (mangler PLAYER_KYC_READ)", async () => {
  const ctx = await startServer({ users: { "t-op": hallOperator } });
  try {
    const res = await get(ctx, "/api/admin/games/g1/replay", "t-op");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "FORBIDDEN");
    // HALL_OPERATOR har GAME1_GAME_READ men ikke PLAYER_KYC_READ.
    // Forbiddent skal logges som audit-rad.
    await new Promise((r) => setImmediate(r));
    const events = await ctx.auditStore.list({ limit: 10 });
    const forbidden = events.find((e) => e.action === "admin.game.replay.forbidden");
    assert.ok(forbidden, "forbidden audit-rad mangler");
  } finally {
    await ctx.close();
  }
});

// ── Test 4: GAME_NOT_FOUND ─────────────────────────────────────────────────

test("GET /replay — ukjent gameId → GAME_NOT_FOUND", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    replayImpl: async () => {
      const err = new Error("not found") as Error & { code?: string };
      err.code = "GAME_NOT_FOUND";
      throw err;
    },
  });
  try {
    const res = await get(ctx, "/api/admin/games/missing/replay", "t-admin");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "GAME_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── Test 5: Mangler Authorization → UNAUTHORIZED ───────────────────────────

test("GET /replay — uten Bearer token → UNAUTHORIZED", async () => {
  const ctx = await startServer({ users: {} });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/admin/games/g1/replay`);
    assert.equal(res.status, 400);
    const payload = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});
