/**
 * BIN-583 B3.8: integrasjonstester for admin hall-reports-router.
 *
 * Dekker RBAC, hall-scope for HALL_OPERATOR, audit for manual-entry,
 * daily/monthly aggregation, og admin shift-cashouts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminHallReportsRouter } from "../adminHallReports.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  HallAccountReportService,
  ManualAdjustment,
} from "../../compliance/HallAccountReportService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "a@test.no", displayName: "Admin",
  walletId: "w-a", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorA: PublicAppUser = { ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" };
const operatorB: PublicAppUser = { ...adminUser, id: "op-b", role: "HALL_OPERATOR", hallId: "hall-b" };
const agentUser: PublicAppUser = { ...adminUser, id: "ag-1", role: "AGENT", hallId: "hall-a" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  spies: {
    manualEntries: Array<Record<string, unknown>>;
    dailyCalls: Array<Record<string, unknown>>;
  };
  close: () => Promise<void>;
}

async function startServer(users: Record<string, PublicAppUser>): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const spies: Ctx["spies"] = { manualEntries: [], dailyCalls: [] };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
  } as unknown as PlatformService;

  const reportService = {
    async getDailyReport(input: Record<string, unknown>) {
      spies.dailyCalls.push(input);
      return [
        {
          date: "2026-04-20", gameType: "BINGO_80",
          ticketsSoldCents: 100000, winningsPaidCents: 50000, netRevenueCents: 50000,
          cashInCents: 80000, cashOutCents: 20000, cardInCents: 30000, cardOutCents: 0,
        },
      ];
    },
    async getMonthlyReport() {
      return {
        month: "2026-04",
        ticketsSoldCents: 3000000, winningsPaidCents: 1500000, netRevenueCents: 1500000,
        cashInCents: 2400000, cashOutCents: 600000, cardInCents: 900000, cardOutCents: 0,
        manualAdjustmentCents: -50000,
      };
    },
    async getAccountBalance() {
      return {
        hallId: "hall-a",
        hallCashBalance: 5000,
        dropsafeBalance: 10000,
        periodTotalCashInCents: 100000,
        periodTotalCashOutCents: 25000,
        periodTotalCardInCents: 40000,
        periodTotalCardOutCents: 0,
        periodSellingByCustomerNumberCents: 5000,
        periodManualAdjustmentCents: 0,
        periodNetCashFlowCents: 75000,
      };
    },
    async addManualAdjustment(input: Record<string, unknown>): Promise<ManualAdjustment> {
      spies.manualEntries.push(input);
      return {
        id: "adj-1",
        hallId: String(input.hallId),
        amountCents: Number(input.amountCents),
        category: input.category as ManualAdjustment["category"],
        businessDate: String(input.businessDate),
        note: String(input.note),
        createdBy: String(input.createdBy),
        createdAt: "2026-04-21T10:00:00Z",
      };
    },
    async listManualAdjustments() {
      return [{
        id: "adj-1", hallId: "hall-a", amountCents: 10000, category: "BANK_DEPOSIT" as const,
        businessDate: "2026-04-20", note: "Bank-innskudd",
        createdBy: "admin-1", createdAt: "2026-04-21T10:00:00Z",
      }];
    },
    async listPhysicalCashoutsForShift() {
      return {
        rows: [{
          agentTxId: "tx-1", shiftId: "shift-1", agentUserId: "ag-1",
          playerUserId: "pl-1", hallId: "hall-a", ticketUniqueId: "T-100",
          amountCents: 5000, paymentMethod: "CASH" as const,
          createdAt: "2026-04-21T10:00:00Z",
        }],
        total: 1, totalAmountCents: 5000,
      };
    },
    async getPhysicalCashoutSummaryForShift(shiftId: string) {
      return {
        shiftId, winCount: 2, totalAmountCents: 10000,
        byPaymentMethod: { CASH: 10000 },
      };
    },
  } as unknown as HallAccountReportService;

  const app = express();
  app.use(express.json());
  app.use(createAdminHallReportsRouter({ platformService, auditLogService, reportService }));
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

test("B3.8: PLAYER + AGENT blokkert fra admin hall-reports", async () => {
  const ctx = await startServer({ "pl-tok": playerUser, "ag-tok": agentUser });
  try {
    for (const token of ["pl-tok", "ag-tok"]) {
      const res = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-a/daily?dateFrom=2026-04-01&dateTo=2026-04-30", token);
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "FORBIDDEN");
    }
  } finally { await ctx.close(); }
});

test("B3.8: SUPPORT kan lese rapporter men ikke manual-entry", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    const read = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-a/daily?dateFrom=2026-04-01&dateTo=2026-04-30", "sup-tok");
    assert.equal(read.status, 200);

    const write = await req(ctx.baseUrl, "POST", "/api/admin/reports/halls/hall-a/account/manual-entry", "sup-tok", {
      amountCents: 10000, category: "BANK_DEPOSIT",
      businessDate: "2026-04-20", note: "Bank-innskudd",
    });
    // DAILY_REPORT_RUN = ADMIN + HALL_OPERATOR, SUPPORT ekskludert
    assert.equal(write.status, 400);
    assert.equal(write.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("B3.8 + BIN-591: HALL_OPERATOR begrenset til egen hall", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const ok = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-a/daily?dateFrom=2026-04-01&dateTo=2026-04-30", "op-a-tok");
    assert.equal(ok.status, 200);

    const cross = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-b/daily?dateFrom=2026-04-01&dateTo=2026-04-30", "op-a-tok");
    assert.equal(cross.status, 400);
    assert.equal(cross.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("B3.8: GET daily returnerer rows + passer dateFrom/dateTo til service", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-a/daily?dateFrom=2026-04-01&dateTo=2026-04-30&gameType=BINGO_80", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.rows[0].gameType, "BINGO_80");
    assert.equal(ctx.spies.dailyCalls[0]!.dateFrom, "2026-04-01");
    assert.equal(ctx.spies.dailyCalls[0]!.gameType, "BINGO_80");
  } finally { await ctx.close(); }
});

test("B3.8: GET monthly validerer year+month", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const noYear = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-a/monthly?month=4", "admin-tok");
    assert.equal(noYear.status, 400);

    const badMonth = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-a/monthly?year=2026&month=13", "admin-tok");
    assert.equal(badMonth.status, 400);

    const ok = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-a/monthly?year=2026&month=4", "admin-tok");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.month, "2026-04");
    assert.equal(ok.json.data.netRevenueCents, 1500000);
  } finally { await ctx.close(); }
});

test("B3.8: GET account-balance returnerer periodNetCashFlowCents", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-a/account-balance", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallCashBalance, 5000);
    assert.equal(res.json.data.periodNetCashFlowCents, 75000);
  } finally { await ctx.close(); }
});

test("B3.8: POST manual-entry audit logger details", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const ok = await req(ctx.baseUrl, "POST", "/api/admin/reports/halls/hall-a/account/manual-entry", "admin-tok", {
      amountCents: 10000, category: "BANK_DEPOSIT",
      businessDate: "2026-04-20", note: "Bank-innskudd fra kunde",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.amountCents, 10000);
    assert.equal(ctx.spies.manualEntries.length, 1);
    assert.equal(ctx.spies.manualEntries[0]!.createdBy, "admin-1");

    const audit = await waitAudit(ctx.auditStore, "admin.hall.manual_entry.create") as { details: Record<string, unknown> };
    assert.ok(audit);
    assert.equal(audit.details.amountCents, 10000);
    assert.equal(audit.details.category, "BANK_DEPOSIT");
  } finally { await ctx.close(); }
});

test("B3.8: POST manual-entry krever amountCents ≠ 0", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const zero = await req(ctx.baseUrl, "POST", "/api/admin/reports/halls/hall-a/account/manual-entry", "admin-tok", {
      amountCents: 0, category: "CORRECTION",
      businessDate: "2026-04-20", note: "Test",
    });
    assert.equal(zero.status, 400);
    assert.equal(zero.json.error.code, "INVALID_INPUT");
  } finally { await ctx.close(); }
});

test("B3.8: GET manual-entries returnerer historikk", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/reports/halls/hall-a/manual-entries", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.rows[0].category, "BANK_DEPOSIT");
  } finally { await ctx.close(); }
});

test("B3.8: admin GET shift-cashouts returnerer paginert liste", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/shifts/shift-1/physical-cashouts", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.shiftId, "shift-1");
    assert.equal(res.json.data.total, 1);
  } finally { await ctx.close(); }
});

test("B3.8: admin GET shift-cashouts/summary", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/shifts/shift-1/physical-cashouts/summary", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.winCount, 2);
    assert.equal(res.json.data.totalAmountCents, 10000);
  } finally { await ctx.close(); }
});

test("B3.8: HALL_OPERATOR egen hall kan POST manual-entry + audit", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/reports/halls/hall-a/account/manual-entry", "op-a-tok", {
      amountCents: -5000, category: "CORRECTION",
      businessDate: "2026-04-20", note: "Feilregistrering",
    });
    assert.equal(res.status, 200);
    const audit = await waitAudit(ctx.auditStore, "admin.hall.manual_entry.create") as { actorType: string };
    assert.ok(audit);
    assert.equal(audit.actorType, "HALL_OPERATOR");
  } finally { await ctx.close(); }
});

test("B3.8: HALL_OPERATOR annen hall blokkert for POST manual-entry", async () => {
  const ctx = await startServer({ "op-b-tok": operatorB });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/reports/halls/hall-a/account/manual-entry", "op-b-tok", {
      amountCents: 10000, category: "BANK_DEPOSIT",
      businessDate: "2026-04-20", note: "Test",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});
