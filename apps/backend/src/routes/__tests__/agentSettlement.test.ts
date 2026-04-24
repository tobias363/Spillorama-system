/**
 * BIN-583 B3.3: integrasjonstester for agent + admin settlement-router.
 *
 * 9 endepunkter + edge cases (PDF binary, admin force, AGENT-only-self).
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
  txService: AgentTransactionService;
  settlements: InMemoryAgentSettlementStore;
  hallCash: InMemoryHallCashLedger;
  auditStore: InMemoryAuditLogStore;
  tokens: Map<string, PublicAppUser>;
  seedAgent(id: string, hallId: string, token?: string): Promise<{ shiftId: string; token: string }>;
  seedPlayer(id: string, hallId: string, balance?: number): Promise<void>;
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
    async createAdminProvisionedUser(): Promise<AppUser> {
      throw new Error("not used");
    },
    async softDeletePlayer(): Promise<void> {},
    async isPlayerActiveInHall(userId: string, hallId: string): Promise<boolean> {
      return playerHalls.get(userId)?.has(hallId) ?? false;
    },
    async searchPlayersInHall(): Promise<AppUser[]> { return []; },
    async getHall(hallId: string): Promise<HallDefinition> {
      return {
        id: hallId, slug: hallId, name: `Hall ${hallId}`, region: "NO", address: "",
        isActive: true, clientVariant: "web", tvToken: `tv-${hallId}`, createdAt: "", updatedAt: "",
      };
    },
  };

  const physicalMark = {
    async markSold(input: { uniqueId: string }) {
      physicalRead.setStatus(input.uniqueId, "SOLD");
      return { uniqueId: input.uniqueId };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({ agentStore: store, agentService });
  const txService = new AgentTransactionService({
    platformService,
    walletAdapter: wallet,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    physicalTicketService: physicalMark as any,
    physicalTicketReadPort: physicalRead,
    ticketPurchasePort: new NotImplementedTicketPurchasePort(),
    agentService,
    agentShiftService,
    agentStore: store,
    transactionStore: txStore,
  });
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
    store, txService, settlements, hallCash, auditStore, tokens,
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
      hallCash.seedHallBalance(hallId, 0, 0);
      return { shiftId: shift.id, token };
    },
    async seedPlayer(id, hallId, balance = 0) {
      const walletId = `wallet-${id}`;
      await wallet.ensureAccount(walletId);
      if (balance > 0) await wallet.credit(walletId, balance, "seed");
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
): Promise<{ status: number; json: any; bodyBytes?: Uint8Array; contentType?: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get("content-type") ?? undefined;
  if (contentType?.startsWith("application/pdf")) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, json: null, bodyBytes: bytes, contentType };
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: res.status, json, contentType };
}

// ═══════════════════════════════════════════════════════════════════════════

test("POST /shift/control-daily-balance — agent kontrollerer egen kasse", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    await ctx.txService.cashIn({
      agentUserId: "a1", playerUserId: "p1", amount: 200,
      paymentMethod: "CASH", clientRequestId: "r-1",
    });
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/control-daily-balance", token, {
      reportedDailyBalance: 200, reportedTotalCashBalance: 200,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.diff, 0);
    assert.equal(res.json.data.severity, "OK");
  } finally { await ctx.close(); }
});

test("POST /shift/close-day — happy + audit log", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    await ctx.txService.cashIn({
      agentUserId: "a1", playerUserId: "p1", amount: 100,
      paymentMethod: "CASH", clientRequestId: "r-1",
    });
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 100,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.shiftId, shiftId);
    assert.equal(res.json.data.dailyBalanceDifference, 0);
    await new Promise((r) => setTimeout(r, 30));
    const events = await ctx.auditStore.list();
    assert.ok(events.find((e) => e.action === "agent.settlement.close"));
  } finally { await ctx.close(); }
});

test("POST /shift/close-day — diff i NOTE-spennet uten note → DIFF_NOTE_REQUIRED", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    await ctx.txService.cashIn({
      agentUserId: "a1", playerUserId: "p1", amount: 20000,
      paymentMethod: "CASH", clientRequestId: "r-1",
    });
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 20600, // diff 600 (3%) → NOTE_REQUIRED
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "DIFF_NOTE_REQUIRED");
  } finally { await ctx.close(); }
});

test("POST /shift/close-day — diff > FORCE krever ADMIN", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    await ctx.txService.cashIn({
      agentUserId: "a1", playerUserId: "p1", amount: 20000,
      paymentMethod: "CASH", clientRequestId: "r-1",
    });
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 18500, // diff -1500 → FORCE
      settlementNote: "stor diff",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "ADMIN_FORCE_REQUIRED");
  } finally { await ctx.close(); }
});

test("GET /shift/settlement-date — returnerer expected dato", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/shift/settlement-date", token);
    assert.equal(res.status, 200);
    assert.ok(typeof res.json.data.expectedBusinessDate === "string");
    assert.equal(res.json.data.hasPendingPreviousDay, false);
  } finally { await ctx.close(); }
});

test("GET /shift/:shiftId/settlement — agent ser egen", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await ctx.seedPlayer("p1", "hall-a");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, { reportedCashCount: 0 });
    const res = await req(ctx.baseUrl, "GET", `/api/agent/shift/${shiftId}/settlement`, token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.shiftId, shiftId);
  } finally { await ctx.close(); }
});

test("GET /shift/:shiftId/settlement — agent får 400 FORBIDDEN for andre agents shift", async () => {
  const ctx = await startServer();
  try {
    const { token: tokA, shiftId: shiftA } = await ctx.seedAgent("a1", "hall-a", "tok-a1");
    const { token: tokB } = await ctx.seedAgent("a2", "hall-a", "tok-a2");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", tokA, { reportedCashCount: 0 });
    const res = await req(ctx.baseUrl, "GET", `/api/agent/shift/${shiftA}/settlement`, tokB);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("GET /shift/:shiftId/settlement.pdf — returnerer PDF binary", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, { reportedCashCount: 0 });
    const res = await req(ctx.baseUrl, "GET", `/api/agent/shift/${shiftId}/settlement.pdf`, token);
    assert.equal(res.status, 200);
    assert.equal(res.contentType?.startsWith("application/pdf"), true);
    assert.ok(res.bodyBytes && res.bodyBytes.length > 100);
    // PDF magic bytes "%PDF"
    assert.equal(res.bodyBytes![0], 0x25);
    assert.equal(res.bodyBytes![1], 0x50);
    assert.equal(res.bodyBytes![2], 0x44);
    assert.equal(res.bodyBytes![3], 0x46);
  } finally { await ctx.close(); }
});

test("GET /admin/shifts/settlements — ADMIN lister", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, { reportedCashCount: 0 });
    ctx.seedAdmin("admin-tok");
    const res = await req(ctx.baseUrl, "GET", "/api/admin/shifts/settlements", "admin-tok");
    assert.equal(res.status, 200);
    assert.ok(res.json.data.settlements.length >= 1);
  } finally { await ctx.close(); }
});

test("GET /admin/shifts/settlements — AGENT får 400 FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    const res = await req(ctx.baseUrl, "GET", "/api/admin/shifts/settlements", token);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("PUT /admin/shifts/:shiftId/settlement — admin editerer + audit", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, { reportedCashCount: 0 });
    ctx.seedAdmin("admin-tok");
    const res = await req(ctx.baseUrl, "PUT", `/api/admin/shifts/${shiftId}/settlement`, "admin-tok", {
      reason: "Korrigert etter avstemning",
      settlementNote: "Bekreftet manuelt",
      reportedCashCount: 50,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.editReason, "Korrigert etter avstemning");
    assert.equal(res.json.data.reportedCashCount, 50);
  } finally { await ctx.close(); }
});

test("PUT /admin/shifts/:shiftId/settlement — AGENT får 400 FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, { reportedCashCount: 0 });
    const res = await req(ctx.baseUrl, "PUT", `/api/admin/shifts/${shiftId}/settlement`, token, {
      reason: "test", settlementNote: "x",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// K1: MACHINE BREAKDOWN + BILAG RECEIPT
// ═══════════════════════════════════════════════════════════════════════════

test("K1 POST /shift/close-day — med 15-rad breakdown + bilag", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 0,
      machineBreakdown: {
        rows: {
          metronia: { in_cents: 481000, out_cents: 174800 },
          ok_bingo: { in_cents: 362000, out_cents: 162500 },
          franco: { in_cents: 477000, out_cents: 184800 },
          rekvisita: { in_cents: 2500, out_cents: 0 },
          servering: { in_cents: 26000, out_cents: 0 },
          bank: { in_cents: 81400, out_cents: 81400 },
        },
        ending_opptall_kassie_cents: 461300,
        innskudd_drop_safe_cents: 0,
        difference_in_shifts_cents: 0,
      },
      bilagReceipt: {
        mime: "application/pdf",
        filename: "bilag-2026-04-23.pdf",
        dataUrl: "data:application/pdf;base64,JVBERi0xLjQ=",
        sizeBytes: 1024,
        uploadedAt: "2026-04-23T10:00:00.000Z",
        uploadedByUserId: "a1",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.machineBreakdown.rows.metronia.in_cents, 481000);
    assert.equal(res.json.data.bilagReceipt.mime, "application/pdf");
    assert.equal(res.json.data.bilagReceipt.filename, "bilag-2026-04-23.pdf");
  } finally { await ctx.close(); }
});

test("K1 POST /shift/close-day — ugyldig breakdown gir INVALID_INPUT", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 0,
      machineBreakdown: { rows: { metronia: { in_cents: -100, out_cents: 0 } } },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally { await ctx.close(); }
});

test("K1 POST /settlements/:id/receipt — agent laster opp bilag på egen", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", "hall-a");
    const cd = await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, { reportedCashCount: 0 });
    const settlementId = cd.json.data.id;
    const up = await req(ctx.baseUrl, "POST", `/api/agent/settlements/${settlementId}/receipt`, token, {
      receipt: {
        mime: "image/jpeg",
        filename: "receipt.jpg",
        dataUrl: "data:image/jpeg;base64,/9j/4AAQ=",
        sizeBytes: 2000,
        uploadedAt: "2026-04-23T11:00:00Z",
        uploadedByUserId: "a1",
      },
    });
    assert.equal(up.status, 200);
    assert.equal(up.json.data.bilagReceipt.filename, "receipt.jpg");
    await new Promise((r) => setTimeout(r, 30));
    const events = await ctx.auditStore.list();
    assert.ok(events.find((e) => e.action === "agent.settlement.bilag-uploaded"));
  } finally { await ctx.close(); }
});

test("K1 POST /settlements/:id/receipt — agent kan IKKE laste opp på andre agents", async () => {
  const ctx = await startServer();
  try {
    const { token: tokA } = await ctx.seedAgent("a1", "hall-a", "tok-a1");
    const { token: tokB } = await ctx.seedAgent("a2", "hall-a", "tok-a2");
    const cd = await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", tokA, { reportedCashCount: 0 });
    const settlementId = cd.json.data.id;
    const up = await req(ctx.baseUrl, "POST", `/api/agent/settlements/${settlementId}/receipt`, tokB, {
      receipt: {
        mime: "application/pdf",
        filename: "x.pdf",
        dataUrl: "data:application/pdf;base64,AAAA",
        sizeBytes: 100,
        uploadedAt: "2026-04-23T10:00:00Z",
        uploadedByUserId: "a2",
      },
    });
    assert.equal(up.status, 400);
    assert.equal(up.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("K1 PUT /admin/shifts/:shiftId/settlement — admin oppdaterer breakdown", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, { reportedCashCount: 0 });
    ctx.seedAdmin("admin-tok");
    const res = await req(ctx.baseUrl, "PUT", `/api/admin/shifts/${shiftId}/settlement`, "admin-tok", {
      reason: "Korrigert breakdown etter avstemning",
      machineBreakdown: {
        rows: { metronia: { in_cents: 10000, out_cents: 5000 } },
        ending_opptall_kassie_cents: 5000,
        innskudd_drop_safe_cents: 0,
        difference_in_shifts_cents: 0,
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.machineBreakdown.rows.metronia.in_cents, 10000);
  } finally { await ctx.close(); }
});

test("K1 GET /shift/:shiftId/settlement — returnerer breakdown + bilag-felter", async () => {
  const ctx = await startServer();
  try {
    const { token, shiftId } = await ctx.seedAgent("a1", "hall-a");
    await req(ctx.baseUrl, "POST", "/api/agent/shift/close-day", token, {
      reportedCashCount: 0,
      machineBreakdown: {
        rows: { bank: { in_cents: 81400, out_cents: 81400 } },
        ending_opptall_kassie_cents: 0,
        innskudd_drop_safe_cents: 0,
        difference_in_shifts_cents: 0,
      },
    });
    const res = await req(ctx.baseUrl, "GET", `/api/agent/shift/${shiftId}/settlement`, token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.machineBreakdown.rows.bank.in_cents, 81400);
    assert.equal(res.json.data.bilagReceipt, null);
  } finally { await ctx.close(); }
});
