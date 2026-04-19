/**
 * BIN-583 B3.5: integrasjonstester for agentOkBingo-router.
 *
 * 9 endepunkter — happy + RBAC + open-day-spesifikk.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentOkBingoRouter } from "../agentOkBingo.js";
import { AgentService } from "../../agent/AgentService.js";
import { AgentShiftService } from "../../agent/AgentShiftService.js";
import { OkBingoTicketService, DEFAULT_BINGO_ROOM_ID } from "../../agent/OkBingoTicketService.js";
import { InMemoryAgentStore } from "../../agent/AgentStore.js";
import { InMemoryAgentTransactionStore } from "../../agent/AgentTransactionStore.js";
import { InMemoryMachineTicketStore } from "../../agent/MachineTicketStore.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import { StubOkBingoApiClient } from "../../integration/okbingo/StubOkBingoApiClient.js";
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
  okbingo: StubOkBingoApiClient;
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
  const okbingo = new StubOkBingoApiClient();
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
  const okBingoService = new OkBingoTicketService({
    platformService,
    walletAdapter: wallet,
    agentService,
    agentShiftService,
    transactionStore: txStore,
    machineTicketStore: ticketStore,
    okBingoClient: okbingo,
  });

  const app = express();
  app.use(express.json());
  app.use(createAgentOkBingoRouter({
    platformService,
    agentService,
    okBingoTicketService: okBingoService,
    auditLogService,
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    okbingo, auditStore, tokens,
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

test("POST /okbingo/register-ticket — happy + audit + roomId default 247", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const res = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.machineName, "OK_BINGO");
    assert.equal(res.json.data.roomId, String(DEFAULT_BINGO_ROOM_ID));
    await new Promise((r) => setTimeout(r, 30));
    const events = await ctx.auditStore.list();
    assert.ok(events.find((e) => e.action === "agent.okbingo.create"));
  } finally { await ctx.close(); }
});

test("POST /okbingo/topup", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const create = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    const top = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/topup", token, {
      ticketNumber: create.json.data.ticketNumber,
      amountNok: 50, clientRequestId: "r-2",
    });
    assert.equal(top.status, 200);
    assert.equal(top.json.data.totalTopupCents, 5000);
  } finally { await ctx.close(); }
});

test("POST /okbingo/payout", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const create = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    ctx.okbingo.setBalance(create.json.data.ticketNumber, 4500);
    const close = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/payout", token, {
      ticketNumber: create.json.data.ticketNumber, clientRequestId: "r-c",
    });
    assert.equal(close.status, 200);
    assert.equal(close.json.data.payoutCents, 4500);
  } finally { await ctx.close(); }
});

test("POST /okbingo/void", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const create = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    const voided = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/void", token, {
      ticketNumber: create.json.data.ticketNumber, reason: "Test cancellation",
    });
    assert.equal(voided.status, 200);
    assert.ok(voided.json.data.voidAt);
  } finally { await ctx.close(); }
});

test("POST /okbingo/open-day — sender signal til 247", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/open-day", token, {});
    assert.equal(res.status, 200);
    assert.equal(res.json.data.opened, true);
    assert.equal(res.json.data.roomId, DEFAULT_BINGO_ROOM_ID);
    assert.equal(ctx.okbingo.isDayOpened(DEFAULT_BINGO_ROOM_ID), true);
  } finally { await ctx.close(); }
});

test("GET /okbingo/ticket/:ticketNumber — agent ser egen", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    const create = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    const get = await req(ctx.baseUrl, "GET",
      `/api/agent/okbingo/ticket/${create.json.data.ticketNumber}`, token);
    assert.equal(get.status, 200);
    assert.equal(get.json.data.id, create.json.data.id);
  } finally { await ctx.close(); }
});

test("GET /okbingo/daily-sales", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    await req(ctx.baseUrl, "POST", "/api/agent/okbingo/register-ticket", token, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    const sales = await req(ctx.baseUrl, "GET", "/api/agent/okbingo/daily-sales", token);
    assert.equal(sales.status, 200);
    assert.equal(sales.json.data.ticketCount, 1);
  } finally { await ctx.close(); }
});

test("GET /admin/okbingo/hall-summary/:hallId", async () => {
  const ctx = await startServer();
  try {
    const { token: tokA } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    await req(ctx.baseUrl, "POST", "/api/agent/okbingo/register-ticket", tokA, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    ctx.seedAdmin("admin-tok");
    const res = await req(ctx.baseUrl, "GET", "/api/admin/okbingo/hall-summary/hall-a", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ticketCount, 1);
  } finally { await ctx.close(); }
});

test("GET /admin/okbingo/daily-report", async () => {
  const ctx = await startServer();
  try {
    const { token: tokA } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 500);
    await req(ctx.baseUrl, "POST", "/api/agent/okbingo/register-ticket", tokA, {
      playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    });
    ctx.seedAdmin("admin-tok");
    const res = await req(ctx.baseUrl, "GET", "/api/admin/okbingo/daily-report", "admin-tok");
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
    const res = await req(ctx.baseUrl, "POST", "/api/agent/okbingo/register-ticket", "pl-tok", {
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
    const res = await req(ctx.baseUrl, "GET", "/api/admin/okbingo/daily-report", token);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});
