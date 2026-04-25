/**
 * TASK HS: integrasjonstester for scan-rutene + hall-status-endepunktet.
 *
 * Dekker:
 *   POST /api/admin/game1/games/:gameId/halls/:hallId/scan-start
 *     - 200 + AuditLog hall.scan.start
 *     - Broadcaster game1:hall-status-update til group:<groupId>
 *     - FORBIDDEN for rolle uten hall-scope
 *   POST /api/admin/game1/games/:gameId/halls/:hallId/scan-final
 *     - 200 + AuditLog hall.scan.final
 *     - Broadcaster game1:hall-status-update
 *     - INVALID_SCAN_RANGE propageres til route-svar
 *   GET  /api/admin/game1/games/:gameId/hall-status
 *     - Returnerer liste med farge-kode + spiller-count per hall
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
  HallStatusForGame,
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
const agentUser: PublicAppUser = {
  ...adminUser,
  id: "ag-1",
  role: "AGENT",
  hallId: "hall-a",
};
const agentOtherHall: PublicAppUser = {
  ...adminUser,
  id: "ag-2",
  role: "AGENT",
  hallId: "hall-x",
};

interface EmittedSocketEvent {
  room: string | null;
  event: string;
  payload: unknown;
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  emitted: EmittedSocketEvent[];
  startScanCalls: Array<{
    gameId: string;
    hallId: string;
    ticketId: string;
  }>;
  finalScanCalls: Array<{
    gameId: string;
    hallId: string;
    ticketId: string;
  }>;
  hallStatusCalls: string[];
  close: () => Promise<void>;
}

function defaultReadyRow(
  overrides: Partial<HallReadyStatusRow> = {}
): HallReadyStatusRow {
  return {
    gameId: "g1",
    hallId: "hall-a",
    isReady: false,
    readyAt: null,
    readyByUserId: null,
    digitalTicketsSold: 0,
    physicalTicketsSold: 0,
    excludedFromGame: false,
    excludedReason: null,
    createdAt: "",
    updatedAt: "",
    startTicketId: null,
    startScannedAt: null,
    finalScanTicketId: null,
    finalScannedAt: null,
    ...overrides,
  };
}

function defaultHallStatus(
  overrides: Partial<HallStatusForGame> = {}
): HallStatusForGame {
  return {
    hallId: "hall-a",
    playerCount: 0,
    startScanDone: true,
    finalScanDone: true,
    readyConfirmed: false,
    excludedFromGame: false,
    excludedReason: null,
    color: "red",
    soldCount: 0,
    startTicketId: null,
    finalScanTicketId: null,
    digitalTicketsSold: 0,
    physicalTicketsSold: 0,
    ...overrides,
  };
}

interface StartOpts {
  users?: Record<string, PublicAppUser>;
  recordStartScanImpl?: (input: {
    gameId: string;
    hallId: string;
    ticketId: string;
  }) => Promise<HallReadyStatusRow>;
  recordFinalScanImpl?: (input: {
    gameId: string;
    hallId: string;
    ticketId: string;
  }) => Promise<HallReadyStatusRow>;
  getHallStatusImpl?: (gameId: string) => Promise<HallStatusForGame[]>;
  getGameGroupIdImpl?: (gameId: string) => Promise<string>;
  halls?: Record<string, { id: string; name: string }>;
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const users: Record<string, PublicAppUser> = opts.users ?? {
    "t-admin": adminUser,
    "t-agent": agentUser,
    "t-agent-x": agentOtherHall,
  };
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const emitted: EmittedSocketEvent[] = [];
  const startScanCalls: Ctx["startScanCalls"] = [];
  const finalScanCalls: Ctx["finalScanCalls"] = [];
  const hallStatusCalls: string[] = [];

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
    async recordStartScan(input: {
      gameId: string;
      hallId: string;
      ticketId: string;
    }) {
      startScanCalls.push(input);
      if (opts.recordStartScanImpl) return opts.recordStartScanImpl(input);
      return defaultReadyRow({
        gameId: input.gameId,
        hallId: input.hallId,
        startTicketId: input.ticketId,
        startScannedAt: "2026-04-24T10:00:00.000Z",
      });
    },
    async recordFinalScan(input: {
      gameId: string;
      hallId: string;
      ticketId: string;
    }) {
      finalScanCalls.push(input);
      if (opts.recordFinalScanImpl) return opts.recordFinalScanImpl(input);
      return defaultReadyRow({
        gameId: input.gameId,
        hallId: input.hallId,
        startTicketId: "100",
        finalScanTicketId: input.ticketId,
        finalScannedAt: "2026-04-24T11:00:00.000Z",
        physicalTicketsSold: 23,
      });
    },
    async getHallStatusForGame(gameId: string) {
      hallStatusCalls.push(gameId);
      if (opts.getHallStatusImpl) return opts.getHallStatusImpl(gameId);
      return [defaultHallStatus({ hallId: "hall-a" })];
    },
    async getGameGroupId(gameId: string) {
      if (opts.getGameGroupIdImpl) return opts.getGameGroupIdImpl(gameId);
      return "grp-1";
    },
    // Dummy-implementasjoner for ikke-relevante metoder
    async markReady() {
      return defaultReadyRow();
    },
    async unmarkReady() {
      return defaultReadyRow();
    },
    async getReadyStatusForGame() {
      return [defaultReadyRow()];
    },
    async allParticipatingHallsReady() {
      return true;
    },
    async assertPurchaseOpenForHall() {
      /* noop */
    },
  } as unknown as Game1HallReadyService;

  const io = {
    emit: (event: string, payload: unknown) => {
      emitted.push({ room: null, event, payload });
    },
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
    // TASK HS: broadcastHallStatusUpdate rører også /admin-game1-namespacet.
    of: (_nsp: string) => ({
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          emitted.push({ room: `adminGame1:${room}`, event, payload });
        },
      }),
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
    emitted,
    startScanCalls,
    finalScanCalls,
    hallStatusCalls,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function req(
  ctx: Ctx,
  method: "GET" | "POST",
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

// ── scan-start ──────────────────────────────────────────────────────────────

test("scan-start: AGENT i hall-a lagrer start-scan + broadcaster hall-status", async () => {
  const ctx = await startServer({
    halls: { "hall-a": { id: "hall-a", name: "Hall A" } },
    getHallStatusImpl: async () => [
      defaultHallStatus({
        hallId: "hall-a",
        playerCount: 0,
        startScanDone: true,
        color: "red",
      }),
    ],
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/games/g1/halls/hall-a/scan-start",
      "t-agent",
      { ticketId: "12345" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.startTicketId, "12345");
    assert.equal(ctx.startScanCalls.length, 1);
    assert.equal(ctx.startScanCalls[0]!.ticketId, "12345");

    // Broadcast til group-room
    const groupBroadcast = ctx.emitted.find(
      (e) => e.event === "game1:hall-status-update" && e.room === "group:grp-1"
    );
    assert.ok(groupBroadcast, "forventet game1:hall-status-update broadcast");

    // AuditLog
    const entries = await ctx.auditStore.list({ limit: 10 });
    const scanEntry = entries.find((e) => e.action === "hall.scan.start");
    assert.ok(scanEntry, "forventet audit-entry hall.scan.start");
  } finally {
    await ctx.close();
  }
});

test("scan-start: AGENT i annen hall → FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/games/g1/halls/hall-a/scan-start",
      "t-agent-x",
      { ticketId: "12345" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
    assert.equal(ctx.startScanCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("scan-start: tomt ticketId → VALIDATION_FAILED", async () => {
  const ctx = await startServer();
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/games/g1/halls/hall-a/scan-start",
      "t-agent",
      { ticketId: "" }
    );
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── scan-final ──────────────────────────────────────────────────────────────

test("scan-final: ADMIN lagrer slutt-scan + broadcaster", async () => {
  const ctx = await startServer({
    halls: { "hall-a": { id: "hall-a", name: "Hall A" } },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/games/g1/halls/hall-a/scan-final",
      "t-admin",
      { ticketId: "123" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.finalScanTicketId, "123");
    assert.equal(res.body.data.physicalTicketsSold, 23);

    const groupBroadcast = ctx.emitted.find(
      (e) => e.event === "game1:hall-status-update" && e.room === "group:grp-1"
    );
    assert.ok(groupBroadcast, "forventet hall-status broadcast");

    const entries = await ctx.auditStore.list({ limit: 10 });
    const finalEntry = entries.find((e) => e.action === "hall.scan.final");
    assert.ok(finalEntry, "forventet audit-entry hall.scan.final");
  } finally {
    await ctx.close();
  }
});

test("scan-final: INVALID_SCAN_RANGE propageres som feil", async () => {
  const ctx = await startServer({
    recordFinalScanImpl: async () => {
      throw new DomainError(
        "INVALID_SCAN_RANGE",
        "Slutt-scan (50) må være >= start-scan (100)."
      );
    },
  });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/game1/games/g1/halls/hall-a/scan-final",
      "t-admin",
      { ticketId: "50" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_SCAN_RANGE");
  } finally {
    await ctx.close();
  }
});

// ── hall-status GET ─────────────────────────────────────────────────────────

test("hall-status: returnerer liste med farge-kode per hall", async () => {
  const ctx = await startServer({
    halls: {
      "hall-1": { id: "hall-1", name: "Hall 1" },
      "hall-2": { id: "hall-2", name: "Hall 2" },
      "hall-3": { id: "hall-3", name: "Hall 3" },
    },
    getHallStatusImpl: async () => [
      defaultHallStatus({ hallId: "hall-1", color: "red", playerCount: 0 }),
      defaultHallStatus({
        hallId: "hall-2",
        color: "orange",
        playerCount: 5,
        startScanDone: true,
        finalScanDone: false,
        physicalTicketsSold: 5,
      }),
      defaultHallStatus({
        hallId: "hall-3",
        color: "green",
        playerCount: 12,
        readyConfirmed: true,
        soldCount: 12,
        physicalTicketsSold: 12,
      }),
    ],
  });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/game1/games/g1/hall-status",
      "t-admin"
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.halls.length, 3);
    const byHall = new Map<string, any>(
      res.body.data.halls.map((h: any) => [h.hallId, h])
    );
    assert.equal(byHall.get("hall-1")!.color, "red");
    assert.equal(byHall.get("hall-2")!.color, "orange");
    assert.equal(byHall.get("hall-3")!.color, "green");
    assert.equal(byHall.get("hall-3")!.soldCount, 12);
    assert.equal(byHall.get("hall-1")!.hallName, "Hall 1");
  } finally {
    await ctx.close();
  }
});

test("hall-status: uten token → UNAUTHORIZED", async () => {
  const ctx = await startServer();
  try {
    const res = await req(ctx, "GET", "/api/admin/game1/games/g1/hall-status");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});
