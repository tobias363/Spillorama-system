/**
 * K1-D route-tester for agentSettlement-router:
 *   1. PUT /api/admin/shifts/:shiftId/settlement aksepterer businessDate
 *      og persister + audit-logger.
 *   2. PUT avviser ugyldig businessDate-format med INVALID_INPUT.
 *   3. GET /api/admin/shifts/settlements list-respons inkluderer hallName +
 *      agentDisplayName per rad (resolved fra platform).
 *   4. GET /api/admin/shifts/:shiftId/settlement detail-respons inkluderer
 *      hallName + agentDisplayName.
 *   5. GET /api/agent/shift/:shiftId/settlement (agent-self) også beriket.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentSettlementRouter } from "../agentSettlement.js";
import { AgentService } from "../../agent/AgentService.js";
import { AgentShiftService } from "../../agent/AgentShiftService.js";
import { AgentTransactionService } from "../../agent/AgentTransactionService.js";
import { AgentSettlementService } from "../../agent/AgentSettlementService.js";
import { InMemoryAgentStore } from "../../agent/AgentStore.js";
import { InMemoryAgentTransactionStore } from "../../agent/AgentTransactionStore.js";
import { InMemoryAgentSettlementStore } from "../../agent/AgentSettlementStore.js";
import { InMemoryHallCashLedger } from "../../agent/HallCashLedger.js";
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
  HallDefinition,
  UserRole,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
  store: InMemoryAgentStore;
  settlements: InMemoryAgentSettlementStore;
  auditStore: InMemoryAuditLogStore;
  service: AgentSettlementService;
  seedAgent(id: string, hallId: string, displayName: string, hallName: string, token?: string): Promise<{ shiftId: string; token: string }>;
  seedAdmin(token: string): void;
}

async function startServer(): Promise<Ctx> {
  const store = new InMemoryAgentStore();
  const txStore = new InMemoryAgentTransactionStore();
  const settlements = new InMemoryAgentSettlementStore();
  const hallCash = new InMemoryHallCashLedger();
  const wallet = new InMemoryWalletAdapter(0);
  const physicalRead = new InMemoryPhysicalTicketReadPort();
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const tokens = new Map<string, PublicAppUser>();
  const usersById = new Map<string, AppUser>();
  const hallsById = new Map<string, HallDefinition>();

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
      throw new Error("not used");
    },
    async softDeletePlayer(): Promise<void> {},
    async isPlayerActiveInHall(): Promise<boolean> { return false; },
    async searchPlayersInHall(): Promise<AppUser[]> { return []; },
    async getHall(hallId: string): Promise<HallDefinition> {
      const h = hallsById.get(hallId);
      if (!h) throw new DomainError("HALL_NOT_FOUND", "not found");
      return h;
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({ agentStore: store, agentService });
  const txService = new AgentTransactionService({
    platformService,
    walletAdapter: wallet,
    physicalTicketService: { async markSold(input: { uniqueId: string }) {
      physicalRead.setStatus(input.uniqueId, "SOLD");
      return { uniqueId: input.uniqueId };
    } } as never,
    physicalTicketReadPort: physicalRead,
    ticketPurchasePort: new NotImplementedTicketPurchasePort(),
    agentService,
    agentShiftService,
    agentStore: store,
    transactionStore: txStore,
  });
  void txService;
  const settlementService = new AgentSettlementService({
    platformService,
    agentService,
    agentShiftService,
    agentStore: store,
    transactionStore: txStore,
    settlementStore: settlements,
    hallCashLedger: hallCash,
  });

  const app = express();
  app.use(express.json());
  app.use(createAgentSettlementRouter({
    platformService,
    agentService,
    agentSettlementService: settlementService,
    auditLogService,
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store, settlements, auditStore, service: settlementService,
    async seedAgent(id, hallId, displayName, hallName, token = `tok-${id}`) {
      store.seedAgent({ userId: id, email: `${id}@x.no`, displayName });
      await wallet.ensureAccount(`wallet-${id}`);
      const u: AppUser = {
        id, email: `${id}@x.no`, displayName,
        walletId: `wallet-${id}`, role: "AGENT", hallId: null,
        kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
      };
      usersById.set(id, u);
      tokens.set(token, { ...u, balance: 0 });
      hallsById.set(hallId, {
        id: hallId, slug: hallId, name: hallName, region: "NO",
        address: "", isActive: true, clientVariant: "web",
        tvToken: `tv-${hallId}`, createdAt: "", updatedAt: "",
      });
      await store.assignHall({ userId: id, hallId, isPrimary: true });
      const shift = await store.insertShift({ userId: id, hallId });
      hallCash.seedHallBalance(hallId, 0, 0);
      return { shiftId: shift.id, token };
    },
    seedAdmin(token: string) {
      const id = `admin-${Math.random().toString(36).slice(2, 6)}`;
      const u: PublicAppUser = {
        id, email: `${id}@x.no`, displayName: "Admin User",
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

test("K1-D PUT /admin/shifts/:shiftId/settlement aksepterer businessDate-edit", async () => {
  const ctx = await startServer();
  try {
    ctx.seedAdmin("admin-tok");
    const { token } = await ctx.seedAgent("a1", "hall-a", "Nsongka Thomas", "Game of Hall");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 0,
    });
    const settlement = (await ctx.settlements.list({ limit: 10 }))[0]!;
    const targetDate = "2026-04-25";
    const res = await req(
      ctx.baseUrl, "PUT",
      `/api/admin/shifts/${settlement.shiftId}/settlement`,
      "admin-tok",
      { reason: "Korrigerer dato — drifts-dag før midnatt", businessDate: targetDate }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.businessDate, targetDate);
    assert.equal(res.json.data.editReason, "Korrigerer dato — drifts-dag før midnatt");
    // Audit-event registrert
    await new Promise((r) => setTimeout(r, 30));
    const events = await ctx.auditStore.list();
    const editEvent = events.find((e) => e.action === "agent.settlement.edit");
    assert.ok(editEvent, "skal logge agent.settlement.edit");
    const details = editEvent!.details as { fields?: string[] };
    assert.ok(Array.isArray(details.fields) && details.fields.includes("businessDate"));
  } finally { await ctx.close(); }
});

test("K1-D PUT avviser ugyldig businessDate-format med INVALID_INPUT", async () => {
  const ctx = await startServer();
  try {
    ctx.seedAdmin("admin-tok");
    const { token } = await ctx.seedAgent("a1", "hall-a", "Test Agent", "Hall A");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 0,
    });
    const settlement = (await ctx.settlements.list({ limit: 10 }))[0]!;
    const res = await req(
      ctx.baseUrl, "PUT",
      `/api/admin/shifts/${settlement.shiftId}/settlement`,
      "admin-tok",
      { reason: "test", businessDate: "ikke-en-dato" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
    assert.match(String(res.json.error.message), /businessDate/);
  } finally { await ctx.close(); }
});

test("K1-D GET /admin/shifts/settlements beriker hver rad med hallName + agentDisplayName", async () => {
  const ctx = await startServer();
  try {
    ctx.seedAdmin("admin-tok");
    const { token } = await ctx.seedAgent("a1", "hall-a", "Nsongka Thomas", "Game of Hall");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 0,
    });
    const res = await req(
      ctx.baseUrl, "GET", "/api/admin/shifts/settlements",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    const list = res.json.data.settlements;
    assert.equal(list.length, 1);
    assert.equal(list[0].hallName, "Game of Hall");
    assert.equal(list[0].agentDisplayName, "Nsongka Thomas");
    // Originale ID-felter fortsatt med
    assert.equal(list[0].hallId, "hall-a");
    assert.equal(list[0].agentUserId, "a1");
  } finally { await ctx.close(); }
});

test("K1-D GET /admin/shifts/:shiftId/settlement (detail) beriket med navn", async () => {
  const ctx = await startServer();
  try {
    ctx.seedAdmin("admin-tok");
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a", "Bingo Manager", "Hamar 100");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 0,
    });
    const res = await req(
      ctx.baseUrl, "GET",
      `/api/admin/shifts/${shiftId}/settlement`,
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallName, "Hamar 100");
    assert.equal(res.json.data.agentDisplayName, "Bingo Manager");
  } finally { await ctx.close(); }
});

test("K1-D GET /agent/shift/:shiftId/settlement (agent-self) også beriket", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a", "Self Agent", "Self Hall");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 0,
    });
    const res = await req(
      ctx.baseUrl, "GET",
      `/api/agent/shift/${shiftId}/settlement`,
      token
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallName, "Self Hall");
    assert.equal(res.json.data.agentDisplayName, "Self Agent");
  } finally { await ctx.close(); }
});
