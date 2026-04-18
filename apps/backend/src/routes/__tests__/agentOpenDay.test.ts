/**
 * BIN-583 B3.8: integrasjonstester for agent open-day + cashout-router.
 *
 * Mocker AgentService, AgentShiftService, AgentOpenDayService, HallAccountReportService
 * for å teste RBAC + open-day-valideringer + audit + cashout-pagination.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentOpenDayRouter } from "../agentOpenDay.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type { AgentService } from "../../agent/AgentService.js";
import type { AgentShiftService } from "../../agent/AgentShiftService.js";
import type { AgentOpenDayService, OpenDayResult, DailyBalanceSnapshot } from "../../agent/AgentOpenDayService.js";
import type { HallAccountReportService } from "../../compliance/HallAccountReportService.js";
import { DomainError } from "../../game/BingoEngine.js";

const agentUser: PublicAppUser = {
  id: "ag-1", email: "a@test.no", displayName: "Agent",
  walletId: "w-a", role: "AGENT", hallId: "hall-a",
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const adminUser: PublicAppUser = { ...agentUser, id: "admin-1", role: "ADMIN", hallId: null };
const playerUser: PublicAppUser = { ...agentUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  spies: {
    openDay: Array<{ agentUserId: string; amount: number; notes?: string }>;
    cashoutCalls: string[];
  };
  close: () => Promise<void>;
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  currentShift?: { id: string; hallId: string } | null;
  openDayBehavior?: (input: Record<string, unknown>) => OpenDayResult | Promise<OpenDayResult>;
  balanceSnapshot?: DailyBalanceSnapshot;
}): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const spies: Ctx["spies"] = { openDay: [], cashoutCalls: [] };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
  } as unknown as PlatformService;

  const agentService = {
    async requireActiveAgent() { /* ok */ },
  } as unknown as AgentService;

  const agentShiftService = {
    async getCurrentShift() {
      return opts.currentShift === undefined ? { id: "shift-1", hallId: "hall-a" } : opts.currentShift;
    },
  } as unknown as AgentShiftService;

  const defaultOpenDay = (input: Record<string, unknown>): OpenDayResult => {
    const amount = Number(input.amount);
    return {
      shiftId: "shift-1",
      hallId: "hall-a",
      amount,
      dailyBalance: amount,
      hallCashBalanceAfter: 10000 - amount,
      transferTxId: "tr-1",
    };
  };

  const openDayService = {
    async openDay(input: { agentUserId: string; amount: number; notes?: string }) {
      spies.openDay.push(input);
      const behavior = opts.openDayBehavior ?? defaultOpenDay;
      return behavior(input as unknown as Record<string, unknown>);
    },
    async getDailyBalance() {
      return opts.balanceSnapshot ?? {
        shiftId: "shift-1",
        hallId: "hall-a",
        dailyBalance: 500,
        hallCashBalance: 9500,
        previousSettlementPending: false,
        dayOpened: true,
      };
    },
  } as unknown as AgentOpenDayService;

  const reportService = {
    async listPhysicalCashoutsForShift(input: { shiftId: string }) {
      spies.cashoutCalls.push(input.shiftId);
      return {
        rows: [{
          agentTxId: "tx-1", shiftId: input.shiftId, agentUserId: "ag-1",
          playerUserId: "pl-1", hallId: "hall-a", ticketUniqueId: "T-100",
          amountCents: 5000, paymentMethod: "CASH" as const,
          createdAt: "2026-04-21T10:00:00Z",
        }],
        total: 1,
        totalAmountCents: 5000,
      };
    },
    async getPhysicalCashoutSummaryForShift(shiftId: string) {
      spies.cashoutCalls.push(shiftId);
      return {
        shiftId, winCount: 3, totalAmountCents: 15000,
        byPaymentMethod: { CASH: 10000, CARD: 5000 },
      };
    },
  } as unknown as HallAccountReportService;

  const app = express();
  app.use(express.json());
  app.use(createAgentOpenDayRouter({
    platformService, auditLogService, agentService, agentShiftService,
    openDayService, reportService,
  }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auditStore, spies,
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

async function waitAudit(store: InMemoryAuditLogStore, action: string): Promise<unknown> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await store.list();
    const hit = events.find((e) => e.action === action);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("B3.8: PLAYER blokkert fra open-day + cashout-endepunkter", async () => {
  const ctx = await startServer({ users: { "pl-tok": playerUser } });
  try {
    for (const path of [
      "/api/agent/shift/open-day",
      "/api/agent/shift/daily-balance",
      "/api/agent/shift/physical-cashouts",
      "/api/agent/shift/physical-cashouts/summary",
    ]) {
      const method = path.endsWith("open-day") ? "POST" : "GET";
      const res = await req(ctx.baseUrl, method, path, "pl-tok", method === "POST" ? { amount: 100 } : undefined);
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "FORBIDDEN");
    }
  } finally { await ctx.close(); }
});

test("B3.8: ADMIN kan IKKE åpne dagen (kun AGENT)", async () => {
  const ctx = await startServer({ users: { "admin-tok": adminUser } });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/open-day", "admin-tok", { amount: 100 });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("B3.8: AGENT åpner dagen + audit logger amount + dailyBalance", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/open-day", "ag-tok", {
      amount: 500, notes: "Start dag",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.amount, 500);
    assert.equal(res.json.data.dailyBalance, 500);
    assert.equal(ctx.spies.openDay.length, 1);
    assert.equal(ctx.spies.openDay[0]!.notes, "Start dag");

    const audit = await waitAudit(ctx.auditStore, "agent.shift.open_day") as { actorType: string; details: Record<string, unknown> };
    assert.ok(audit);
    assert.equal(audit.actorType, "AGENT");
    assert.equal(audit.details.amount, 500);
    assert.equal(audit.details.hallId, "hall-a");
  } finally { await ctx.close(); }
});

test("B3.8: open-day avviser amount ≤ 0", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    for (const amount of [0, -100]) {
      const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/open-day", "ag-tok", { amount });
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "INVALID_INPUT");
    }
  } finally { await ctx.close(); }
});

test("B3.8: open-day propagerer DAY_ALREADY_OPENED fra service", async () => {
  const ctx = await startServer({
    users: { "ag-tok": agentUser },
    openDayBehavior: () => {
      throw new DomainError("DAY_ALREADY_OPENED", "Allerede åpnet.");
    },
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/open-day", "ag-tok", { amount: 100 });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "DAY_ALREADY_OPENED");
  } finally { await ctx.close(); }
});

test("B3.8: open-day propagerer INSUFFICIENT_HALL_CASH", async () => {
  const ctx = await startServer({
    users: { "ag-tok": agentUser },
    openDayBehavior: () => {
      throw new DomainError("INSUFFICIENT_HALL_CASH", "Ikke nok.");
    },
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/open-day", "ag-tok", { amount: 100 });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INSUFFICIENT_HALL_CASH");
  } finally { await ctx.close(); }
});

test("B3.8: open-day propagerer PREVIOUS_SETTLEMENT_PENDING", async () => {
  const ctx = await startServer({
    users: { "ag-tok": agentUser },
    openDayBehavior: () => {
      throw new DomainError("PREVIOUS_SETTLEMENT_PENDING", "Forrige dag ikke lukket.");
    },
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/open-day", "ag-tok", { amount: 100 });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PREVIOUS_SETTLEMENT_PENDING");
  } finally { await ctx.close(); }
});

test("B3.8: GET daily-balance returnerer snapshot", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/shift/daily-balance", "ag-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.dailyBalance, 500);
    assert.equal(res.json.data.hallCashBalance, 9500);
    assert.equal(res.json.data.dayOpened, true);
  } finally { await ctx.close(); }
});

test("B3.8: cashouts uten aktiv shift returnerer tom liste", async () => {
  const ctx = await startServer({
    users: { "ag-tok": agentUser },
    currentShift: null,
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/shift/physical-cashouts", "ag-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.shiftId, null);
    assert.equal(res.json.data.total, 0);
  } finally { await ctx.close(); }
});

test("B3.8: cashouts returnerer paginert liste + total + totalAmountCents", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/shift/physical-cashouts?limit=50&offset=0", "ag-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.shiftId, "shift-1");
    assert.equal(res.json.data.total, 1);
    assert.equal(res.json.data.totalAmountCents, 5000);
    assert.equal(res.json.data.rows[0].ticketUniqueId, "T-100");
    assert.deepEqual(ctx.spies.cashoutCalls, ["shift-1"]);
  } finally { await ctx.close(); }
});

test("B3.8: cashout-summary aggregerer winCount og payment-breakdown", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/shift/physical-cashouts/summary", "ag-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.winCount, 3);
    assert.equal(res.json.data.totalAmountCents, 15000);
    assert.deepEqual(res.json.data.byPaymentMethod, { CASH: 10000, CARD: 5000 });
  } finally { await ctx.close(); }
});
