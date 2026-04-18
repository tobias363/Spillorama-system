/**
 * BIN-583 B3.4: integrasjonstester for agentMetronia-router.
 *
 * 8 endepunkter — happy + RBAC + AGENT-self-only.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentMetroniaRouter } from "../agentMetronia.js";
import { AgentService } from "../../agent/AgentService.js";
import { AgentShiftService } from "../../agent/AgentShiftService.js";
import { MetroniaTicketService } from "../../agent/MetroniaTicketService.js";
import { InMemoryAgentStore } from "../../agent/AgentStore.js";
import { InMemoryAgentTransactionStore } from "../../agent/AgentTransactionStore.js";
import { InMemoryMachineTicketStore } from "../../agent/MachineTicketStore.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import { StubMetroniaApiClient } from "../../integration/metronia/StubMetroniaApiClient.js";
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
  metronia: StubMetroniaApiClient;
  auditStore: InMemoryAuditLogStore;
  tokens: Map<string, PublicAppUser>;
  seedAgent(id: string, hallId: string, token?: string): Promise<{ token: string }>;
  seedPlayer(id: string, hallId: string, balanceNok?: number): Promise<void>;
  seedAdmin(token: string): void;
}

async function startServer(): Promise<Ctx> {
  const store = new InMemoryAgentStore();
  const txStore = new InMemoryAgentTransactionStore();
  const ticketStore = new InMemoryMachineTicketStore();
  const wallet = new InMemoryWalletAdapter(0);
  const metronia = new StubMetroniaApiClient();
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const tokens = new Map<string, PublicAppUser>();
  const usersById = new Map<string, AppUser>();
  const playerHalls = new Map<string, Set<string>>();

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
    async createAdminProvisionedUser(): Promise<AppUser> { throw new Error("not used"); },
    async softDeletePlayer(): Promise<void> {},
    async isPlayerActiveInHall(userId: string, hallId: string): Promise<boolean> {
      return playerHalls.get(userId)?.has(hallId) ?? false;
    },
    async searchPlayersInHall(): Promise<AppUser[]> { return []; },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({ agentStore: store, agentService });
  const metroniaService = new MetroniaTicketService({
    platformService,
    walletAdapter: wallet,
    agentService,
    agentShiftService,
    transactionStore: txStore,
    machineTicketStore: ticketStore,
    metroniaClient: metronia,
  });

  const app = express();
  app.use(express.json());
  app.use(createAgentMetroniaRouter({
    platformService,
    agentService,
    metroniaTicketService: metroniaService,
    auditLogService,
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    metronia, auditStore, tokens,
    async seedAgent(id, hallId, token = `tok-${id}`) {
      store.seedAgent({ userId: id, email: `${id}@x.no`, displayName: id });
      await wallet.ensureAccount(`wallet-${id}`);
      const u: AppUser = {
        id, email: `${id}@x.no`, displayName: id,
        walletId: `wallet-${id}`, role: "AGENT", hallId: null,
        kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
      };
      usersById.set(id, u);
      tokens.set(token, { ...u, balance: 0 });
      await store.assignHall({ userId: id, hallId, isPrimary: true });
      await store.insertShift({ userId: id, hallId });
      return { token };
    },
    async seedPlayer(id, hallId, balanceNok = 0) {
      const walletId = `wallet-${id}`;
      await wallet.ensureAccount(walletId);
      if (balanceNok > 0) await wallet.credit(walletId, balanceNok, "seed");
      usersById.set(id, {
        id, email: `${id}@test.no`, displayName: `Player ${id}`,
        walletId, role: "PLAYER", hallId: null,
        kycStatus: "VERIFIED", createdAt: "", updatedAt: "",
      });
      const set = playerHalls.get(id) ?? new Set<string>();
      set.add(hallId);
      playerHalls.set(id, set);
    },
    seedAdmin(token: string) {
      const id = `admin-${Math.random().toString(36).slice(2, 6)}`;
      const u: PublicAppUser = {
        id, email: `${id}@x.no`, displayName: "Admin",
        walletId: `wallet-${id}`, role: "ADMIN" as UserRole, hallId: null,
        kycStatus: "VERIFIED", createdAt: "", updatedAt: "", balance: 0,
      };
      tokens.set(token, u);
      usersById.set(id, u);
    },
  };
}

async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: res.status, json };
}

// ═══════════════════════════════════════════════════════════════════════════

test("POST /metronia/register-ticket — happy + audit", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const res = await req(ctx.baseUrl, "POST", "/api/agent/metronia/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.machineName, "METRONIA");
    assert.equal(res.json.data.initialAmountCents, 10000);
    await new Promise((r) => setTimeout(r, 30));
    const events = await ctx.auditStore.list();
    assert.ok(events.find((e) => e.action === "agent.metronia.create"));
  } finally { await ctx.close(); }
});

test("POST /metronia/topup — happy + tilstand opprettholdt", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const create = await req(ctx.baseUrl, "POST", "/api/agent/metronia/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    const top = await req(ctx.baseUrl, "POST", "/api/agent/metronia/topup", token, {
      ticketNumber: create.json.data.ticketNumber,
      amountNok: 50, clientRequestId: "r-2",
    });
    assert.equal(top.status, 200);
    assert.equal(top.json.data.totalTopupCents, 5000);
  } finally { await ctx.close(); }
});

test("POST /metronia/payout — close + credit player", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const create = await req(ctx.baseUrl, "POST", "/api/agent/metronia/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    ctx.metronia.setBalance(create.json.data.ticketNumber, 4500);
    const close = await req(ctx.baseUrl, "POST", "/api/agent/metronia/payout", token, {
      ticketNumber: create.json.data.ticketNumber, clientRequestId: "r-c",
    });
    assert.equal(close.status, 200);
    assert.equal(close.json.data.payoutCents, 4500);
    assert.equal(close.json.data.isClosed, true);
  } finally { await ctx.close(); }
});

test("POST /metronia/void — innen vindu refunderer fullt", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const create = await req(ctx.baseUrl, "POST", "/api/agent/metronia/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    const voided = await req(ctx.baseUrl, "POST", "/api/agent/metronia/void", token, {
      ticketNumber: create.json.data.ticketNumber,
      reason: "Feil amount",
    });
    assert.equal(voided.status, 200);
    assert.ok(voided.json.data.voidAt);
  } finally { await ctx.close(); }
});

test("POST /metronia/void uten reason → INVALID_INPUT", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/metronia/void", token, {
      ticketNumber: "any", reason: "",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally { await ctx.close(); }
});

test("GET /metronia/ticket/:ticketNumber — agent ser egen", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const create = await req(ctx.baseUrl, "POST", "/api/agent/metronia/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    const get = await req(ctx.baseUrl, "GET",
      `/api/agent/metronia/ticket/${create.json.data.ticketNumber}`, token);
    assert.equal(get.status, 200);
    assert.equal(get.json.data.id, create.json.data.id);
  } finally { await ctx.close(); }
});

test("GET /metronia/daily-sales — aggregat for shift", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    await req(ctx.baseUrl, "POST", "/api/agent/metronia/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    const sales = await req(ctx.baseUrl, "GET", "/api/agent/metronia/daily-sales", token);
    assert.equal(sales.status, 200);
    assert.equal(sales.json.data.ticketCount, 1);
    assert.equal(sales.json.data.totalCreatedNok, 100);
  } finally { await ctx.close(); }
});

test("GET /admin/metronia/hall-summary/:hallId — ADMIN", async () => {
  const ctx = await startServer();
  try {
    const { token: tokA } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    await req(ctx.baseUrl, "POST", "/api/agent/metronia/register-ticket", tokA, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    ctx.seedAdmin("admin-tok");
    const res = await req(ctx.baseUrl, "GET", "/api/admin/metronia/hall-summary/hall-a", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallId, "hall-a");
    assert.equal(res.json.data.ticketCount, 1);
  } finally { await ctx.close(); }
});

test("GET /admin/metronia/daily-report — ADMIN ser per-hall + totals", async () => {
  const ctx = await startServer();
  try {
    const { token: tokA } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    await req(ctx.baseUrl, "POST", "/api/agent/metronia/register-ticket", tokA, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    ctx.seedAdmin("admin-tok");
    const res = await req(ctx.baseUrl, "GET", "/api/admin/metronia/daily-report", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.totals.ticketCount, 1);
    assert.equal(res.json.data.perHall.length, 1);
  } finally { await ctx.close(); }
});

test("RBAC: PLAYER får 400 FORBIDDEN på register-ticket", async () => {
  const ctx = await startServer();
  try {
    ctx.tokens.set("pl-tok", {
      id: "pl-1", email: "pl@x.no", displayName: "Pl",
      walletId: "w-pl", role: "PLAYER", hallId: null,
      kycStatus: "VERIFIED", createdAt: "", updatedAt: "", balance: 0,
    });
    const res = await req(ctx.baseUrl, "POST", "/api/agent/metronia/register-ticket", "pl-tok", {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("RBAC: AGENT får 400 FORBIDDEN på admin-daily-report", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    const res = await req(ctx.baseUrl, "GET", "/api/admin/metronia/daily-report", token);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});
