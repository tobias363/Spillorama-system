/**
 * BIN-583 B3.2: integrasjonstester for agent-transactions-router.
 *
 * Full express round-trip med reelle AgentService/AgentShiftService/
 * AgentTransactionService bak InMemory-ports. PlatformService stubbes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentTransactionsRouter } from "../agentTransactions.js";
import { AgentService } from "../../agent/AgentService.js";
import { AgentShiftService } from "../../agent/AgentShiftService.js";
import { AgentTransactionService } from "../../agent/AgentTransactionService.js";
import { InMemoryAgentStore } from "../../agent/AgentStore.js";
import { InMemoryAgentTransactionStore } from "../../agent/AgentTransactionStore.js";
import { InMemoryPhysicalTicketReadPort } from "../../agent/ports/PhysicalTicketReadPort.js";
import { NotImplementedTicketPurchasePort } from "../../agent/ports/TicketPurchasePort.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
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
  wallet: InMemoryWalletAdapter;
  physicalRead: InMemoryPhysicalTicketReadPort;
  auditStore: InMemoryAuditLogStore;
  tokens: Map<string, PublicAppUser>;
  playerHalls: Map<string, Set<string>>;
  seedAgent(id: string, hallId: string, token?: string): Promise<{ shiftId: string; token: string }>;
  seedPlayer(id: string, hallId: string, initialBalance?: number): Promise<void>;
  seedAdmin(token: string): void;
}

async function startServer(): Promise<Ctx> {
  const store = new InMemoryAgentStore();
  const txs = new InMemoryAgentTransactionStore();
  const wallet = new InMemoryWalletAdapter(0);
  const physicalRead = new InMemoryPhysicalTicketReadPort();
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tokens = new Map<string, PublicAppUser>();
  const playerHalls = new Map<string, Set<string>>();
  const usersById = new Map<string, AppUser>();

  const physicalMark = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async markSold(input: { uniqueId: string; soldBy: string; buyerUserId?: string | null; priceCents?: number | null }): Promise<any> {
      physicalRead.setStatus(input.uniqueId, "SOLD");
      return { uniqueId: input.uniqueId };
    },
  };

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
    async createAdminProvisionedUser(): Promise<AppUser> {
      throw new Error("not used in route tests");
    },
    async softDeletePlayer(): Promise<void> {},
    async isPlayerActiveInHall(userId: string, hallId: string): Promise<boolean> {
      return playerHalls.get(userId)?.has(hallId) ?? false;
    },
    async searchPlayersInHall(input: { query: string; hallId: string; limit?: number }): Promise<AppUser[]> {
      const lower = input.query.toLowerCase();
      const out: AppUser[] = [];
      for (const [userId, hallSet] of playerHalls.entries()) {
        if (!hallSet.has(input.hallId)) continue;
        const u = usersById.get(userId);
        if (!u || u.role !== "PLAYER") continue;
        if (u.displayName.toLowerCase().startsWith(lower) || u.email.toLowerCase().startsWith(lower)) {
          out.push(u);
        }
      }
      return out.slice(0, input.limit ?? 20);
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const physicalTicketService = physicalMark as any;
  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({ agentStore: store, agentService });
  const agentTransactionService = new AgentTransactionService({
    platformService,
    walletAdapter: wallet,
    physicalTicketService,
    physicalTicketReadPort: physicalRead,
    ticketPurchasePort: new NotImplementedTicketPurchasePort(),
    agentService,
    agentShiftService,
    agentStore: store,
    transactionStore: txs,
  });

  const app = express();
  app.use(express.json());
  app.use(createAgentTransactionsRouter({
    platformService,
    agentService,
    agentTransactionService,
    auditLogService,
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store,
    txs,
    wallet,
    physicalRead,
    auditStore,
    tokens,
    playerHalls,
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
      const shift = await store.insertShift({ userId: id, hallId });
      return { shiftId: shift.id, token };
    },
    async seedPlayer(id, hallId, initialBalance = 0) {
      const walletId = `wallet-${id}`;
      await wallet.ensureAccount(walletId);
      if (initialBalance > 0) await wallet.credit(walletId, initialBalance, "seed");
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
  body?: unknown
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

test("POST /players/lookup — returnerer spillere i agentens hall", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p-alfa", "hall-a");
    await ctx.seedPlayer("p-bravo", "hall-b");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/players/lookup", token, { query: "player" });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.players.length, 1);
    assert.equal(res.json.data.players[0].id, "p-alfa");
  } finally { await ctx.close(); }
});

test("GET /players/:id/balance — returnerer saldo", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 300);
    const res = await req(ctx.baseUrl, "GET", "/api/agent/players/p1/balance", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.walletBalance, 300);
  } finally { await ctx.close(); }
});

test("POST /players/:id/cash-in (CASH) — oppdaterer wallet + shift", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/players/p1/cash-in", token, {
      amount: 200, paymentMethod: "CASH", clientRequestId: "r-1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.amount, 200);
    assert.equal(await ctx.wallet.getBalance("wallet-p1"), 200);
    const shift = await ctx.store.getShiftById(shiftId);
    assert.equal(shift?.totalCashIn, 200);
  } finally { await ctx.close(); }
});

test("POST /players/:id/cash-in — feiler for player utenfor hall", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-b");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/players/p1/cash-in", token, {
      amount: 50, paymentMethod: "CASH", clientRequestId: "r-1",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PLAYER_NOT_AT_HALL");
  } finally { await ctx.close(); }
});

test("POST /players/:id/cash-out — feiler ved INSUFFICIENT_DAILY_BALANCE", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 1000);
    const res = await req(ctx.baseUrl, "POST", "/api/agent/players/p1/cash-out", token, {
      amount: 100, paymentMethod: "CASH", clientRequestId: "r-1",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INSUFFICIENT_DAILY_BALANCE");
  } finally { await ctx.close(); }
});

test("POST /physical/sell — suksess (CASH) + audit log", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    ctx.physicalRead.seed({
      uniqueId: "T-100", batchId: "b1", hallId: "hall-a",
      status: "UNSOLD", priceCents: 5000, assignedGameId: null,
    });
    const res = await req(ctx.baseUrl, "POST", "/api/agent/physical/sell", token, {
      playerUserId: "p1", ticketUniqueId: "T-100",
      paymentMethod: "CASH", clientRequestId: "r-1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.actionType, "TICKET_SALE");
    assert.equal(res.json.data.amount, 50);
    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    assert.ok(events.find((e) => e.action === "agent.ticket.physical.sell"));
  } finally { await ctx.close(); }
});

test("POST /physical/sell/cancel — counter-tx innen 10-min vindu", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 100);
    ctx.physicalRead.seed({
      uniqueId: "T-200", batchId: "b1", hallId: "hall-a",
      status: "UNSOLD", priceCents: 3000, assignedGameId: null,
    });
    const sale = await req(ctx.baseUrl, "POST", "/api/agent/physical/sell", token, {
      playerUserId: "p1", ticketUniqueId: "T-200",
      paymentMethod: "WALLET", clientRequestId: "r-1",
    });
    assert.equal(sale.status, 200);
    assert.equal(await ctx.wallet.getBalance("wallet-p1"), 70);

    const cancel = await req(ctx.baseUrl, "POST", "/api/agent/physical/sell/cancel", token, {
      originalTxId: sale.json.data.id,
      reason: "customer cancelled",
    });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.json.data.actionType, "TICKET_CANCEL");
    assert.equal(await ctx.wallet.getBalance("wallet-p1"), 100);
  } finally { await ctx.close(); }
});

test("POST /tickets/register — NOT_IMPLEMENTED (port-stub)", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/tickets/register", token, {
      playerUserId: "p1", gameId: "g1", ticketCount: 2,
      pricePerTicketCents: 3000, clientRequestId: "r-1",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "NOT_IMPLEMENTED");
  } finally { await ctx.close(); }
});

test("GET /physical/inventory — filtrert til agentens hall", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    ctx.physicalRead.seed({
      uniqueId: "T-300", batchId: "b1", hallId: "hall-a",
      status: "UNSOLD", priceCents: 5000, assignedGameId: null,
    });
    ctx.physicalRead.seed({
      uniqueId: "T-301", batchId: "b1", hallId: "hall-a",
      status: "SOLD", priceCents: 5000, assignedGameId: null,
    });
    ctx.physicalRead.seed({
      uniqueId: "T-400", batchId: "b2", hallId: "hall-b",
      status: "UNSOLD", priceCents: 5000, assignedGameId: null,
    });
    const res = await req(ctx.baseUrl, "GET", "/api/agent/physical/inventory", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.tickets.length, 1);
    assert.equal(res.json.data.tickets[0].uniqueId, "T-300");
  } finally { await ctx.close(); }
});

test("GET /transactions/today — kun nåværende shifts tx-er", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    await req(ctx.baseUrl, "POST", "/api/agent/players/p1/cash-in", token, {
      amount: 100, paymentMethod: "CASH", clientRequestId: "r-1",
    });
    const res = await req(ctx.baseUrl, "GET", "/api/agent/transactions/today", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.transactions.length, 1);
    assert.equal(res.json.data.transactions[0].actionType, "CASH_IN");
  } finally { await ctx.close(); }
});

test("GET /transactions — AGENT ser kun egne, ikke andres", async () => {
  const ctx = await startServer();
  try {
    const { token: tokA } = await ctx.seedAgent("a1", "hall-a", "tok-a1");
    const { token: tokB } = await ctx.seedAgent("a2", "hall-a", "tok-a2");
    await ctx.seedPlayer("p1", "hall-a");
    await req(ctx.baseUrl, "POST", "/api/agent/players/p1/cash-in", tokA, {
      amount: 50, paymentMethod: "CARD", clientRequestId: "r-a",
    });
    // a2 ser kun sin egen (tom) logg
    const listB = await req(ctx.baseUrl, "GET", "/api/agent/transactions", tokB);
    assert.equal(listB.status, 200);
    assert.equal(listB.json.data.transactions.length, 0);
    // a1 ser sin egen
    const listA = await req(ctx.baseUrl, "GET", "/api/agent/transactions", tokA);
    assert.equal(listA.json.data.transactions.length, 1);
  } finally { await ctx.close(); }
});

test("GET /transactions/:id — AGENT får FORBIDDEN for andres tx", async () => {
  const ctx = await startServer();
  try {
    const { token: tokA } = await ctx.seedAgent("a1", "hall-a", "tok-a1");
    const { token: tokB } = await ctx.seedAgent("a2", "hall-a", "tok-a2");
    await ctx.seedPlayer("p1", "hall-a");
    const sale = await req(ctx.baseUrl, "POST", "/api/agent/players/p1/cash-in", tokA, {
      amount: 50, paymentMethod: "CARD", clientRequestId: "r-a",
    });
    const res = await req(ctx.baseUrl, "GET", `/api/agent/transactions/${sale.json.data.id}`, tokB);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("POST /players/:id/cash-in — uten token → UNAUTHORIZED", async () => {
  const ctx = await startServer();
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/players/p1/cash-in", undefined, {
      amount: 50, paymentMethod: "CASH", clientRequestId: "r-1",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally { await ctx.close(); }
});

test("POST /players/:id/cash-in — PLAYER-role får FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    ctx.tokens.set("player-tok", {
      id: "pl-1", email: "pl@x.no", displayName: "Pl",
      walletId: "w-pl", role: "PLAYER", hallId: null,
      kycStatus: "VERIFIED", createdAt: "", updatedAt: "", balance: 0,
    });
    const res = await req(ctx.baseUrl, "POST", "/api/agent/players/p1/cash-in", "player-tok", {
      amount: 50, paymentMethod: "CASH", clientRequestId: "r-1",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("POST /physical/sell/cancel — ADMIN kan force utover 10-min", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a", 100);
    ctx.physicalRead.seed({
      uniqueId: "T-500", batchId: "b1", hallId: "hall-a",
      status: "UNSOLD", priceCents: 3000, assignedGameId: null,
    });
    const sale = await req(ctx.baseUrl, "POST", "/api/agent/physical/sell", token, {
      playerUserId: "p1", ticketUniqueId: "T-500",
      paymentMethod: "WALLET", clientRequestId: "r-1",
    });
    // Alder den opp forbi vindu.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inMemRow = (ctx.txs as any).rows.find((r: { id: string }) => r.id === sale.json.data.id);
    inMemRow.createdAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();

    ctx.seedAdmin("admin-tok");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/physical/sell/cancel", "admin-tok", {
      originalTxId: sale.json.data.id,
      reason: "late refund approved",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.actionType, "TICKET_CANCEL");
  } finally { await ctx.close(); }
});
