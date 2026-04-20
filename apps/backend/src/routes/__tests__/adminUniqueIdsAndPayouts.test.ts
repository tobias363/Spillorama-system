/**
 * BIN-587 B4b: integrasjonstester for unique-ids + payout drill-down.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminUniqueIdsAndPayoutsRouter } from "../adminUniqueIdsAndPayouts.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  PhysicalTicketService,
  PhysicalTicket,
  PhysicalTicketStatus,
} from "../../compliance/PhysicalTicketService.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { PlatformService, PublicAppUser, AppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "a@test.no", displayName: "Admin",
  walletId: "w-a", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const operatorA: PublicAppUser = { ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" };
const operatorB: PublicAppUser = { ...adminUser, id: "op-b", role: "HALL_OPERATOR", hallId: "hall-b" };
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function makeTicket(overrides: Partial<PhysicalTicket> & { id: string; uniqueId: string; hallId: string }): PhysicalTicket {
  return {
    id: overrides.id,
    batchId: overrides.batchId ?? "batch-1",
    uniqueId: overrides.uniqueId,
    hallId: overrides.hallId,
    status: overrides.status ?? "UNSOLD",
    priceCents: overrides.priceCents ?? null,
    assignedGameId: overrides.assignedGameId ?? null,
    soldAt: overrides.soldAt ?? null,
    soldBy: overrides.soldBy ?? null,
    buyerUserId: overrides.buyerUserId ?? null,
    voidedAt: overrides.voidedAt ?? null,
    voidedBy: overrides.voidedBy ?? null,
    voidedReason: overrides.voidedReason ?? null,
    createdAt: overrides.createdAt ?? "2026-04-18T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-18T00:00:00Z",
  };
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: { tickets?: PhysicalTicket[]; appUsers?: AppUser[] }
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tickets = opts?.tickets ?? [];
  const appUsers = new Map<string, AppUser>();
  for (const u of opts?.appUsers ?? []) appUsers.set(u.id, u);

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(id: string) {
      const u = appUsers.get(id);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
  } as unknown as PlatformService;

  const physicalTicketService = {
    async listUniqueIds(filter: { hallId?: string; status?: PhysicalTicketStatus; limit?: number }) {
      let list = tickets;
      if (filter.hallId) list = list.filter((t) => t.hallId === filter.hallId);
      if (filter.status) list = list.filter((t) => t.status === filter.status);
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async findByUniqueId(uniqueId: string) {
      return tickets.find((t) => t.uniqueId === uniqueId.trim()) ?? null;
    },
    async listSoldTicketsForGame(gameId: string, filter?: { hallId?: string; limit?: number }) {
      let list = tickets.filter((t) => t.assignedGameId === gameId && t.status === "SOLD");
      if (filter?.hallId) list = list.filter((t) => t.hallId === filter.hallId);
      if (filter?.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async listUniqueIdsInRange(filter: {
      hallId?: string;
      uniqueIdStart?: number;
      uniqueIdEnd?: number;
      createdFrom?: string;
      createdTo?: string;
      status?: PhysicalTicketStatus;
      limit?: number;
      offset?: number;
    }) {
      if (
        filter.uniqueIdStart !== undefined &&
        filter.uniqueIdEnd !== undefined &&
        filter.uniqueIdEnd < filter.uniqueIdStart
      ) {
        throw new DomainError("INVALID_INPUT", "uniqueIdEnd må være ≥ uniqueIdStart.");
      }
      let list = tickets;
      if (filter.hallId) list = list.filter((t) => t.hallId === filter.hallId);
      if (filter.status) list = list.filter((t) => t.status === filter.status);
      if (filter.uniqueIdStart !== undefined || filter.uniqueIdEnd !== undefined) {
        list = list.filter((t) => /^[0-9]+$/.test(t.uniqueId));
      }
      if (filter.uniqueIdStart !== undefined) {
        const s = filter.uniqueIdStart;
        list = list.filter((t) => Number(t.uniqueId) >= s);
      }
      if (filter.uniqueIdEnd !== undefined) {
        const e = filter.uniqueIdEnd;
        list = list.filter((t) => Number(t.uniqueId) <= e);
      }
      if (filter.createdFrom) {
        list = list.filter((t) => t.createdAt >= filter.createdFrom!);
      }
      if (filter.createdTo) {
        list = list.filter((t) => t.createdAt <= filter.createdTo!);
      }
      list = [...list].sort((a, b) => Number(a.uniqueId) - Number(b.uniqueId));
      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 200;
      return list.slice(offset, offset + limit);
    },
  } as unknown as PhysicalTicketService;

  const engine = {
    generateTopPlayers(input: { startDate: string; endDate: string; hallId?: string; limit: number }) {
      return {
        startDate: input.startDate,
        endDate: input.endDate,
        generatedAt: new Date().toISOString(),
        limit: input.limit,
        rows: [
          { playerId: "player-big", totalStakes: 50000, totalPrizes: 30000, net: 20000, gameCount: 12 },
          { playerId: "player-small", totalStakes: 5000, totalPrizes: 0, net: 5000, gameCount: 3 },
        ],
      };
    },
    generateGameSessions(_input: { startDate: string; endDate: string; hallId?: string; limit: number }) {
      return {
        startDate: _input.startDate,
        endDate: _input.endDate,
        generatedAt: new Date().toISOString(),
        rows: [
          {
            gameId: "game-42",
            hallId: _input.hallId ?? "hall-a",
            gameType: "DATABINGO" as const,
            firstEventAt: "2026-04-18T12:00:00Z",
            lastEventAt: "2026-04-18T13:00:00Z",
            totalStakes: 20000, totalPrizes: 15000, net: 5000, playerCount: 8,
          },
        ],
      };
    },
  } as unknown as BingoEngine;

  const app = express();
  app.use(express.json());
  app.use(createAdminUniqueIdsAndPayoutsRouter({
    platformService, auditLogService, physicalTicketService, engine,
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Unique-IDs tests ─────────────────────────────────────────────────────

test("BIN-587 B4b: GET unique-ids RBAC — PLAYER + SUPPORT blokkert", async () => {
  const ctx = await startServer({ "sup-tok": supportUser, "pl-tok": playerUser });
  try {
    for (const token of ["sup-tok", "pl-tok"]) {
      const res = await req(ctx.baseUrl, "GET", "/api/admin/unique-ids", token);
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET unique-ids HALL_OPERATOR filtrert til egen hall", async () => {
  const tickets = [
    makeTicket({ id: "t-a1", uniqueId: "100", hallId: "hall-a" }),
    makeTicket({ id: "t-b1", uniqueId: "200", hallId: "hall-b" }),
  ];
  const ctx = await startServer({ "op-a-tok": operatorA }, { tickets });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/unique-ids", "op-a-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.tickets[0].uniqueId, "100");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: POST check returnerer sellable for UNSOLD", async () => {
  const tickets = [makeTicket({ id: "t-1", uniqueId: "42", hallId: "hall-a", status: "UNSOLD" })];
  const ctx = await startServer({ "admin-tok": adminUser }, { tickets });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/unique-ids/check", "admin-tok", {
      uniqueId: "42",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.exists, true);
    assert.equal(res.json.data.sellable, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: POST check returnerer exists=false for ukjent", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/unique-ids/check", "admin-tok", {
      uniqueId: "ghost",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.exists, false);
    assert.equal(res.json.data.sellable, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: POST check returnerer sellable=false for SOLD", async () => {
  const tickets = [makeTicket({ id: "t-1", uniqueId: "99", hallId: "hall-a", status: "SOLD" })];
  const ctx = await startServer({ "admin-tok": adminUser }, { tickets });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/unique-ids/check", "admin-tok", {
      uniqueId: "99",
    });
    assert.equal(res.json.data.exists, true);
    assert.equal(res.json.data.sellable, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET /:uniqueId hall-scope — HALL_OPERATOR kan ikke se annen halls billett", async () => {
  const tickets = [makeTicket({ id: "t-b1", uniqueId: "200", hallId: "hall-b" })];
  const ctx = await startServer({ "op-a-tok": operatorA }, { tickets });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/unique-ids/200", "op-a-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET /:uniqueId returnerer 400 + PHYSICAL_TICKET_NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/unique-ids/nonexistent", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET /:uniqueId/transactions bygger audit-trail fra ticket-events", async () => {
  const tickets = [
    makeTicket({
      id: "t-1", uniqueId: "123", hallId: "hall-a", status: "SOLD",
      soldAt: "2026-04-18T10:00:00Z", soldBy: "agent-1",
      buyerUserId: "player-1", priceCents: 5000,
      assignedGameId: "game-42",
    }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { tickets });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/unique-ids/123/transactions", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.uniqueId, "123");
    assert.equal(res.json.data.currentStatus, "SOLD");
    assert.equal(res.json.data.events.length, 2);
    assert.equal(res.json.data.events[0].event, "CREATED");
    assert.equal(res.json.data.events[1].event, "SOLD");
    assert.equal(res.json.data.events[1].actor, "agent-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET /:uniqueId/transactions med VOIDED-billett inkluderer void-event", async () => {
  const tickets = [
    makeTicket({
      id: "t-v", uniqueId: "v-100", hallId: "hall-a", status: "VOIDED",
      soldAt: "2026-04-18T10:00:00Z", soldBy: "agent-1",
      voidedAt: "2026-04-18T14:00:00Z", voidedBy: "admin-1",
      voidedReason: "Spill kansellert",
    }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { tickets });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/unique-ids/v-100/transactions", "admin-tok");
    assert.equal(res.status, 200);
    const events = res.json.data.events;
    assert.equal(events.length, 3);
    assert.equal(events[events.length - 1].event, "VOIDED");
    assert.equal(events[events.length - 1].details.reason, "Spill kansellert");
  } finally {
    await ctx.close();
  }
});

// ── Payout drill-down tests ──────────────────────────────────────────────

test("BIN-587 B4b: GET payouts/by-player returnerer summary for spilleren", async () => {
  const appUsers = [{
    id: "player-big", email: "p@test.no", displayName: "P",
    walletId: "w-p", role: "PLAYER" as const, hallId: null,
    kycStatus: "VERIFIED" as const,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  }];
  const ctx = await startServer({ "admin-tok": adminUser }, { appUsers });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/payouts/by-player/player-big?startDate=2026-04-01&endDate=2026-04-30",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.playerId, "player-big");
    assert.equal(res.json.data.summary.totalStakes, 50000);
    assert.equal(res.json.data.summary.totalPrizes, 30000);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET payouts/by-player — ukjent spiller gir USER_NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/payouts/by-player/ghost?startDate=2026-04-01&endDate=2026-04-30",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "USER_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET payouts/by-player returnerer null-summary for spiller uten aktivitet", async () => {
  const appUsers = [{
    id: "unknown-player", email: "u@test.no", displayName: "U",
    walletId: "w-u", role: "PLAYER" as const, hallId: null,
    kycStatus: "VERIFIED" as const,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  }];
  const ctx = await startServer({ "admin-tok": adminUser }, { appUsers });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/payouts/by-player/unknown-player?startDate=2026-04-01&endDate=2026-04-30",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.summary.totalStakes, 0);
    assert.equal(res.json.data.summary.gameCount, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET payouts/by-game/:gameId/tickets kombinerer physical + session-summary", async () => {
  const tickets = [
    makeTicket({
      id: "t-g1", uniqueId: "777", hallId: "hall-a",
      status: "SOLD", assignedGameId: "game-42",
      soldAt: "2026-04-18T12:00:00Z", priceCents: 5000,
    }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { tickets });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/payouts/by-game/game-42/tickets",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.gameId, "game-42");
    assert.equal(res.json.data.physicalTicketCount, 1);
    assert.ok(res.json.data.sessionSummary);
    assert.equal(res.json.data.sessionSummary.gameId, "game-42");
    assert.equal(res.json.data.sessionSummary.totalStakes, 20000);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: payouts-endepunkter krever PAYOUT_AUDIT_READ — PLAYER blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/payouts/by-game/any/tickets",
      "pl-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: payouts HALL_OPERATOR tvunget til egen hall via resolveHallScopeFilter", async () => {
  const tickets = [
    makeTicket({ id: "t-a", uniqueId: "1", hallId: "hall-a", status: "SOLD", assignedGameId: "game-42" }),
    makeTicket({ id: "t-b", uniqueId: "2", hallId: "hall-b", status: "SOLD", assignedGameId: "game-42" }),
  ];
  const ctx = await startServer({ "op-a-tok": operatorA, "op-b-tok": operatorB }, { tickets });
  try {
    // op-a ser bare sine egne
    const opA = await req(ctx.baseUrl, "GET", "/api/admin/payouts/by-game/game-42/tickets", "op-a-tok");
    assert.equal(opA.status, 200);
    assert.equal(opA.json.data.physicalTicketCount, 1);
    // op-a kan ikke override til hall-b via query-param
    const bypass = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/payouts/by-game/game-42/tickets?hallId=hall-b",
      "op-a-tok"
    );
    assert.equal(bypass.status, 400);
    assert.equal(bypass.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── BIN-649: unique-tickets range report ─────────────────────────────────

test("BIN-649: GET /reports/unique-tickets/range RBAC — PLAYER blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/reports/unique-tickets/range", "pl-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-649: GET /reports/unique-tickets/range SUPPORT kan lese (DAILY_REPORT_READ)", async () => {
  const tickets = [
    makeTicket({ id: "t-1", uniqueId: "100", hallId: "hall-a" }),
    makeTicket({ id: "t-2", uniqueId: "200", hallId: "hall-b" }),
  ];
  const ctx = await startServer({ "sup-tok": supportUser }, { tickets });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/reports/unique-tickets/range", "sup-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-649: GET /reports/unique-tickets/range filtrerer på uniqueIdStart/uniqueIdEnd", async () => {
  const tickets = [
    makeTicket({ id: "t-1", uniqueId: "50",  hallId: "hall-a" }),
    makeTicket({ id: "t-2", uniqueId: "100", hallId: "hall-a" }),
    makeTicket({ id: "t-3", uniqueId: "150", hallId: "hall-a" }),
    makeTicket({ id: "t-4", uniqueId: "200", hallId: "hall-a" }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { tickets });
  try {
    const res = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/unique-tickets/range?uniqueIdStart=100&uniqueIdEnd=150",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
    assert.deepEqual(
      (res.json.data.rows as Array<{ uniqueId: string }>).map((r) => r.uniqueId),
      ["100", "150"]
    );
    assert.equal(res.json.data.uniqueIdStart, 100);
    assert.equal(res.json.data.uniqueIdEnd, 150);
  } finally {
    await ctx.close();
  }
});

test("BIN-649: GET /reports/unique-tickets/range avviser reversert range (400 INVALID_INPUT)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/unique-tickets/range?uniqueIdStart=500&uniqueIdEnd=100",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-649: GET /reports/unique-tickets/range avviser ugyldig ISO-dato på from", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/unique-tickets/range?from=i-morgen",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-649: GET /reports/unique-tickets/range filtrerer på status", async () => {
  const tickets = [
    makeTicket({ id: "t-1", uniqueId: "1", hallId: "hall-a", status: "UNSOLD" }),
    makeTicket({ id: "t-2", uniqueId: "2", hallId: "hall-a", status: "SOLD" }),
    makeTicket({ id: "t-3", uniqueId: "3", hallId: "hall-a", status: "VOIDED" }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { tickets });
  try {
    const res = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/unique-tickets/range?status=SOLD",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.rows[0].uniqueId, "2");
    assert.equal(res.json.data.status, "SOLD");
  } finally {
    await ctx.close();
  }
});

test("BIN-649: GET /reports/unique-tickets/range HALL_OPERATOR scope-låst til egen hall", async () => {
  const tickets = [
    makeTicket({ id: "t-a", uniqueId: "10", hallId: "hall-a" }),
    makeTicket({ id: "t-b", uniqueId: "20", hallId: "hall-b" }),
  ];
  const ctx = await startServer({ "op-a-tok": operatorA }, { tickets });
  try {
    // Ingen hallId oppgitt → auto-scopet til hall-a
    const res = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/unique-tickets/range",
      "op-a-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.rows[0].hallId, "hall-a");
    assert.equal(res.json.data.hallId, "hall-a");
    // Forsøk på å overstyre til hall-b blokkeres
    const bypass = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/unique-tickets/range?hallId=hall-b",
      "op-a-tok"
    );
    assert.equal(bypass.status, 400);
    assert.equal(bypass.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-649: GET /reports/unique-tickets/range respekterer limit + offset", async () => {
  const tickets = [
    makeTicket({ id: "t-1", uniqueId: "1", hallId: "hall-a" }),
    makeTicket({ id: "t-2", uniqueId: "2", hallId: "hall-a" }),
    makeTicket({ id: "t-3", uniqueId: "3", hallId: "hall-a" }),
    makeTicket({ id: "t-4", uniqueId: "4", hallId: "hall-a" }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { tickets });
  try {
    const page1 = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/unique-tickets/range?limit=2&offset=0",
      "admin-tok"
    );
    assert.equal(page1.status, 200);
    assert.equal(page1.json.data.count, 2);
    assert.deepEqual(
      (page1.json.data.rows as Array<{ uniqueId: string }>).map((r) => r.uniqueId),
      ["1", "2"]
    );
    const page2 = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/unique-tickets/range?limit=2&offset=2",
      "admin-tok"
    );
    assert.equal(page2.status, 200);
    assert.deepEqual(
      (page2.json.data.rows as Array<{ uniqueId: string }>).map((r) => r.uniqueId),
      ["3", "4"]
    );
    assert.equal(page2.json.data.offset, 2);
    assert.equal(page2.json.data.limit, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-649: GET /reports/unique-tickets/range read-only — ingen AuditLog", async () => {
  const tickets = [makeTicket({ id: "t-1", uniqueId: "1", hallId: "hall-a" })];
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const appUsers = new Map<string, AppUser>();
  const platformService = {
    async getUserFromAccessToken(token: string) {
      if (token !== "admin-tok") throw new DomainError("UNAUTHORIZED", "bad");
      return adminUser;
    },
    async getUserById(id: string) {
      const u = appUsers.get(id);
      if (!u) throw new DomainError("USER_NOT_FOUND", "nf");
      return u;
    },
  } as unknown as PlatformService;
  const physicalTicketService = {
    async listUniqueIdsInRange() { return tickets; },
  } as unknown as PhysicalTicketService;
  const engine = {} as unknown as BingoEngine;
  const app = express();
  app.use(express.json());
  app.use(createAdminUniqueIdsAndPayoutsRouter({
    platformService, auditLogService, physicalTicketService, engine,
  }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/reports/unique-tickets/range`, {
      headers: { Authorization: "Bearer admin-tok" },
    });
    assert.equal(res.status, 200);
    // Read-only endepunkt skal ikke skrive AuditLog
    const entries = await auditStore.list({ limit: 10 });
    assert.equal(entries.length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
