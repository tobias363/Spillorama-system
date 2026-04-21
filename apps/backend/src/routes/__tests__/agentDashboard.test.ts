/**
 * Integrasjonstester for agent-dashboard-router.
 *
 * Dekker 3 endepunkter:
 *   - GET /api/agent/dashboard           — shift + counts + recent txs
 *   - GET /api/agent/players             — spillere i agentens hall
 *   - GET /api/agent/players/:id/export.csv — CSV-eksport per spiller
 *
 * RBAC-kontroll: kun AGENT-rollen. ADMIN/HALL_OPERATOR/SUPPORT får
 * FORBIDDEN selv om de ellers har AGENT_TX_READ-permission (disse rollene
 * skal bruke /api/admin/players).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentDashboardRouter } from "../agentDashboard.js";
import { AgentService } from "../../agent/AgentService.js";
import { AgentShiftService } from "../../agent/AgentShiftService.js";
import { InMemoryAgentStore } from "../../agent/AgentStore.js";
import { InMemoryAgentTransactionStore } from "../../agent/AgentTransactionStore.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  PublicAppUser,
  AppUser,
  UserRole,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
  store: InMemoryAgentStore;
  txs: InMemoryAgentTransactionStore;
  auditStore: InMemoryAuditLogStore;
  tokens: Map<string, PublicAppUser>;
  playerHalls: Map<string, Set<string>>;
  usersById: Map<string, AppUser>;
  seedAgent(id: string, hallId: string, token?: string): Promise<{ shiftId: string; token: string }>;
  seedAgentNoShift(id: string, hallId: string, token?: string): Promise<{ token: string }>;
  seedPlayer(id: string, hallId: string, displayName?: string): Promise<void>;
  seedAdmin(token: string): void;
}

async function startServer(): Promise<Ctx> {
  const store = new InMemoryAgentStore();
  const txs = new InMemoryAgentTransactionStore();
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tokens = new Map<string, PublicAppUser>();
  const playerHalls = new Map<string, Set<string>>();
  const usersById = new Map<string, AppUser>();

  const stubPlatform = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = tokens.get(token);
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(userId: string): Promise<AppUser> {
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
    async isPlayerActiveInHall(userId: string, hallId: string): Promise<boolean> {
      return playerHalls.get(userId)?.has(hallId) ?? false;
    },
    async searchPlayersInHall(input: {
      query: string;
      hallId: string;
      limit?: number;
    }): Promise<AppUser[]> {
      const lower = input.query.toLowerCase();
      const out: AppUser[] = [];
      for (const [userId, hallSet] of playerHalls.entries()) {
        if (!hallSet.has(input.hallId)) continue;
        const u = usersById.get(userId);
        if (!u || u.role !== "PLAYER") continue;
        if (
          u.displayName.toLowerCase().includes(lower) ||
          u.email.toLowerCase().includes(lower)
        ) {
          out.push(u);
        }
      }
      return out.slice(0, input.limit ?? 20);
    },
    async listPlayersForExport(filter: {
      kycStatus?: string;
      hallId?: string;
      limit?: number;
    }): Promise<AppUser[]> {
      const out: AppUser[] = [];
      for (const [userId, hallSet] of playerHalls.entries()) {
        if (filter.hallId && !hallSet.has(filter.hallId)) continue;
        const u = usersById.get(userId);
        if (!u || u.role !== "PLAYER") continue;
        out.push(u);
      }
      return out.slice(0, filter.limit ?? 500);
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({ agentStore: store, agentService });

  const app = express();
  app.use(express.json());
  app.use(
    createAgentDashboardRouter({
      platformService,
      agentService,
      agentShiftService,
      agentTransactionStore: txs,
      auditLogService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store,
    txs,
    auditStore,
    tokens,
    playerHalls,
    usersById,
    async seedAgent(id, hallId, token = `tok-${id}`) {
      store.seedAgent({ userId: id, email: `${id}@x.no`, displayName: id });
      const u: AppUser = {
        id,
        email: `${id}@x.no`,
        displayName: id,
        walletId: `wallet-${id}`,
        role: "AGENT",
        hallId: null,
        kycStatus: "UNVERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      usersById.set(id, u);
      tokens.set(token, { ...u, balance: 0 });
      await store.assignHall({ userId: id, hallId, isPrimary: true });
      const shift = await store.insertShift({ userId: id, hallId });
      return { shiftId: shift.id, token };
    },
    async seedAgentNoShift(id, hallId, token = `tok-${id}`) {
      store.seedAgent({ userId: id, email: `${id}@x.no`, displayName: id });
      const u: AppUser = {
        id,
        email: `${id}@x.no`,
        displayName: id,
        walletId: `wallet-${id}`,
        role: "AGENT",
        hallId: null,
        kycStatus: "UNVERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      usersById.set(id, u);
      tokens.set(token, { ...u, balance: 0 });
      await store.assignHall({ userId: id, hallId, isPrimary: true });
      return { token };
    },
    async seedPlayer(id, hallId, displayName = `Player ${id}`) {
      usersById.set(id, {
        id,
        email: `${id}@test.no`,
        displayName,
        walletId: `wallet-${id}`,
        role: "PLAYER",
        hallId: null,
        kycStatus: "VERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const set = playerHalls.get(id) ?? new Set<string>();
      set.add(hallId);
      playerHalls.set(id, set);
    },
    seedAdmin(token: string) {
      const id = `admin-${Math.random().toString(36).slice(2, 6)}`;
      const u: PublicAppUser = {
        id,
        email: `${id}@x.no`,
        displayName: "Admin",
        walletId: `wallet-${id}`,
        role: "ADMIN" as UserRole,
        hallId: null,
        kycStatus: "VERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        balance: 0,
      };
      tokens.set(token, u);
    },
  };
}

async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string
): Promise<{ status: number; json: unknown; text: string; contentType: string | null }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // CSV-responses er ikke JSON — la stå som text.
  }
  return {
    status: res.status,
    json,
    text,
    contentType: res.headers.get("content-type"),
  };
}

// ═══════════════════════════════════════════════════════════════════════════

test("GET /dashboard — returnerer shift + counts for agent med aktiv shift", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    await ctx.seedPlayer("p2", "hall-a");
    await ctx.seedPlayer("p3", "hall-b");

    // Legg til et par transaksjoner i shiften.
    await ctx.txs.insert({
      id: "tx1",
      shiftId,
      agentUserId: "a1",
      playerUserId: "p1",
      hallId: "hall-a",
      actionType: "CASH_IN",
      walletDirection: "CREDIT",
      paymentMethod: "CASH",
      amount: 100,
      previousBalance: 0,
      afterBalance: 100,
    });
    await ctx.txs.insert({
      id: "tx2",
      shiftId,
      agentUserId: "a1",
      playerUserId: "p1",
      hallId: "hall-a",
      actionType: "CASH_OUT",
      walletDirection: "DEBIT",
      paymentMethod: "CASH",
      amount: 30,
      previousBalance: 100,
      afterBalance: 70,
    });

    const res = await req(ctx.baseUrl, "GET", "/api/agent/dashboard", token);
    assert.equal(res.status, 200);
    const data = (res.json as { data: Record<string, unknown> }).data;
    assert.equal((data.agent as { userId: string }).userId, "a1");
    assert.ok(data.shift, "skal ha aktiv shift");
    assert.equal((data.shift as { hallId: string }).hallId, "hall-a");
    const counts = data.counts as {
      transactionsToday: number;
      playersInHall: number | null;
      activeShiftsInHall: number | null;
    };
    assert.equal(counts.transactionsToday, 2);
    assert.equal(counts.playersInHall, 2, "kun p1+p2 i hall-a");
    assert.equal(counts.activeShiftsInHall, 1);
    const recent = data.recentTransactions as Array<{ id: string }>;
    assert.equal(recent.length, 2);
  } finally {
    await ctx.close();
  }
});

test("GET /dashboard — returnerer null shift + 0 counts når agent ikke har aktiv shift", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgentNoShift("a2", "hall-a");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/dashboard", token);
    assert.equal(res.status, 200);
    const data = (res.json as { data: Record<string, unknown> }).data;
    assert.equal(data.shift, null);
    const counts = data.counts as { transactionsToday: number };
    assert.equal(counts.transactionsToday, 0);
  } finally {
    await ctx.close();
  }
});

test("GET /dashboard — ADMIN får FORBIDDEN (kun AGENT-flate)", async () => {
  const ctx = await startServer();
  try {
    ctx.seedAdmin("tok-admin");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/dashboard", "tok-admin");
    assert.equal(res.status, 400);
    assert.equal((res.json as { error?: { code?: string } }).error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /dashboard — mangler token → UNAUTHORIZED", async () => {
  const ctx = await startServer();
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/dashboard");
    assert.equal(res.status, 400);
    assert.equal((res.json as { error?: { code?: string } }).error?.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("GET /players — lister spillere i agentens hall", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", "Alice");
    await ctx.seedPlayer("p2", "hall-a", "Bob");
    await ctx.seedPlayer("p3", "hall-b", "Carol");

    const res = await req(ctx.baseUrl, "GET", "/api/agent/players", token);
    assert.equal(res.status, 200);
    const data = (res.json as { data: Record<string, unknown> }).data;
    assert.equal(data.hallId, "hall-a");
    const players = data.players as Array<{ id: string }>;
    assert.equal(players.length, 2);
    const ids = new Set(players.map((p) => p.id));
    assert.ok(ids.has("p1") && ids.has("p2"));
    assert.ok(!ids.has("p3"), "p3 er i annen hall");
  } finally {
    await ctx.close();
  }
});

test("GET /players?query=Alice — søk matcher i hall", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", "Alice");
    await ctx.seedPlayer("p2", "hall-a", "Bob");

    const res = await req(ctx.baseUrl, "GET", "/api/agent/players?query=Alice", token);
    assert.equal(res.status, 200);
    const data = (res.json as { data: Record<string, unknown> }).data;
    const players = data.players as Array<{ id: string; displayName: string }>;
    assert.equal(players.length, 1);
    assert.equal(players[0]!.id, "p1");
  } finally {
    await ctx.close();
  }
});

test("GET /players — NO_ACTIVE_SHIFT når agent ikke har aktiv shift", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgentNoShift("a1", "hall-a");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/players", token);
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "NO_ACTIVE_SHIFT"
    );
  } finally {
    await ctx.close();
  }
});

test("GET /players/:id/export.csv — returnerer CSV med summary + transactions + audit", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", "Alice");
    await ctx.txs.insert({
      id: "tx-cash1",
      shiftId,
      agentUserId: "a1",
      playerUserId: "p1",
      hallId: "hall-a",
      actionType: "CASH_IN",
      walletDirection: "CREDIT",
      paymentMethod: "CASH",
      amount: 250,
      previousBalance: 0,
      afterBalance: 250,
    });

    const res = await req(ctx.baseUrl, "GET", "/api/agent/players/p1/export.csv", token);
    assert.equal(res.status, 200);
    assert.ok(res.contentType?.startsWith("text/csv"), `content-type was ${res.contentType}`);
    // Summary-seksjon skal inneholde playerId og eksport-metadata
    assert.match(res.text, /playerId.*p1/);
    assert.match(res.text, /displayName.*Alice/);
    assert.match(res.text, /transactionCount.*1/);
    // Transaksjons-tabellen skal inneholde CASH_IN
    assert.match(res.text, /tx-cash1.*CASH_IN/);

    // Audit: agent.player.export event skrevet
    const events = await ctx.auditStore.list({ action: "agent.player.export", limit: 10 });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.resourceId, "p1");
    assert.equal(events[0]!.actorId, "a1");
  } finally {
    await ctx.close();
  }
});

test("GET /players/:id/export.csv — PLAYER_NOT_AT_HALL når spiller ikke er i hall", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p-other", "hall-b", "Outsider");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/players/p-other/export.csv", token);
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "PLAYER_NOT_AT_HALL"
    );
  } finally {
    await ctx.close();
  }
});
