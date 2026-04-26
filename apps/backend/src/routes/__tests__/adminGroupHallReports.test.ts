/**
 * REQ-143: integrasjonstester for admin group-of-hall reports.
 *
 * Dekker:
 *   1) ADMIN ser alle grupper og kan aggregere over alle medlemshaller.
 *   2) HALL_OPERATOR scopet til grupper hvor egen hall er medlem.
 *   3) Single-hall-gruppe fallback returnerer normalt aggregat.
 *   4) Manglende eller ugyldig groupId → riktig feil.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGroupHallReportsRouter } from "../adminGroupHallReports.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  HallAccountReportService,
  DailyHallReportRow,
  MonthlyHallReportRow,
  HallAccountBalance,
} from "../../compliance/HallAccountReportService.js";
import type { HallGroup, HallGroupService } from "../../admin/HallGroupService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "a@test.no", displayName: "Admin",
  walletId: "w-a", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const operatorAlpha: PublicAppUser = {
  ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a",
};
const operatorOutside: PublicAppUser = {
  ...adminUser, id: "op-x", role: "HALL_OPERATOR", hallId: "hall-x",
};
const operatorNoHall: PublicAppUser = {
  ...adminUser, id: "op-no", role: "HALL_OPERATOR", hallId: null,
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function makeGroup(
  id: string,
  name: string,
  hallIds: string[],
): HallGroup {
  return {
    id,
    legacyGroupHallId: null,
    name,
    status: "active",
    tvId: null,
    productIds: [],
    members: hallIds.map((hallId, idx) => ({
      hallId,
      hallName: `Hall ${hallId}`,
      hallStatus: "active",
      addedAt: `2026-01-${String(idx + 1).padStart(2, "0")}T00:00:00Z`,
    })),
    extra: {},
    createdBy: "admin-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
  };
}

interface Ctx {
  baseUrl: string;
  spies: {
    dailyCalls: Array<{ hallId: string; dateFrom: string; dateTo: string }>;
    listFilter: Array<Record<string, unknown>>;
  };
  close: () => Promise<void>;
}

interface ServerOptions {
  users: Record<string, PublicAppUser>;
  groups: HallGroup[];
  /** Per-hall daily-rader. Default: én rad per hall med konstant beløp. */
  dailyByHall?: Record<string, DailyHallReportRow[]>;
  /** Per-hall monthly. */
  monthlyByHall?: Record<string, MonthlyHallReportRow>;
  /** Per-hall balance. */
  balanceByHall?: Record<string, HallAccountBalance>;
  /** Tving feil for én hall (test feil-håndtering). */
  failHallId?: string;
}

async function startServer(opts: ServerOptions): Promise<Ctx> {
  const spies: Ctx["spies"] = { dailyCalls: [], listFilter: [] };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
  } as unknown as PlatformService;

  const hallGroupService = {
    async list(filter: { hallId?: string }) {
      spies.listFilter.push({ ...filter });
      if (filter.hallId) {
        return opts.groups.filter((g) =>
          g.members.some((m) => m.hallId === filter.hallId),
        );
      }
      return opts.groups;
    },
    async get(id: string) {
      const g = opts.groups.find((x) => x.id === id);
      if (!g) throw new DomainError("HALL_GROUP_NOT_FOUND", "Hall-gruppe finnes ikke.");
      return g;
    },
  } as unknown as HallGroupService;

  const reportService = {
    async getDailyReport(input: { hallId: string; dateFrom: string; dateTo: string }) {
      spies.dailyCalls.push({
        hallId: input.hallId, dateFrom: input.dateFrom, dateTo: input.dateTo,
      });
      if (opts.failHallId === input.hallId) {
        throw new DomainError("INTERNAL_ERROR", "simulert feil");
      }
      const fixture = opts.dailyByHall?.[input.hallId];
      if (fixture !== undefined) return fixture;
      // Default: én rad med 100 NOK omsetning + 40 NOK utbetalt
      return [
        {
          date: "2026-04-20",
          gameType: "ALL",
          ticketsSoldCents: 10000,
          winningsPaidCents: 4000,
          netRevenueCents: 6000,
          cashInCents: 8000,
          cashOutCents: 2000,
          cardInCents: 3000,
          cardOutCents: 0,
        },
      ];
    },
    async getMonthlyReport(input: { hallId: string; year: number; month: number }) {
      const fixture = opts.monthlyByHall?.[input.hallId];
      if (fixture !== undefined) return fixture;
      return {
        month: `${input.year}-${String(input.month).padStart(2, "0")}`,
        ticketsSoldCents: 100000,
        winningsPaidCents: 40000,
        netRevenueCents: 60000,
        cashInCents: 80000,
        cashOutCents: 20000,
        cardInCents: 30000,
        cardOutCents: 0,
        manualAdjustmentCents: -1000,
      };
    },
    async getAccountBalance(input: { hallId: string }) {
      const fixture = opts.balanceByHall?.[input.hallId];
      if (fixture !== undefined) return fixture;
      return {
        hallId: input.hallId,
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
  } as unknown as HallAccountReportService;

  const app = express();
  app.use(express.json());
  app.use(createAdminGroupHallReportsRouter({
    platformService, hallGroupService, reportService,
  }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, method: string, path: string, token?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Tests ────────────────────────────────────────────────────────────────

test("REQ-143: ADMIN ser alle grupper i listen + kan aggregere på tvers av haller", async () => {
  const groupAlpha = makeGroup("grp-alpha", "Alpha GoH", ["hall-a", "hall-b"]);
  const groupBeta = makeGroup("grp-beta", "Beta GoH", ["hall-c"]);
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    groups: [groupAlpha, groupBeta],
  });
  try {
    // Listing (ingen scope-filter for ADMIN)
    const list = await req(ctx.baseUrl, "GET", "/api/admin/reports/groups", "admin-tok");
    assert.equal(list.status, 200);
    assert.equal(list.json.data.count, 2);
    assert.equal(list.json.data.groups[0].id, "grp-alpha");
    assert.equal(list.json.data.groups[0].memberCount, 2);
    assert.equal(list.json.data.groups[1].id, "grp-beta");
    // ADMIN bør IKKE få hallId-filter pålagt
    assert.equal(ctx.spies.listFilter[0]?.hallId, undefined);

    // Daily aggregat over to haller skal summere beløpene
    const daily = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-alpha/daily?dateFrom=2026-04-01&dateTo=2026-04-30",
      "admin-tok",
    );
    assert.equal(daily.status, 200);
    assert.equal(daily.json.data.groupId, "grp-alpha");
    assert.equal(daily.json.data.hallIds.length, 2);
    assert.equal(daily.json.data.rows.length, 1);
    // To haller × 10000 stake = 20000
    assert.equal(daily.json.data.rows[0].ticketsSoldCents, 20000);
    assert.equal(daily.json.data.rows[0].winningsPaidCents, 8000);
    assert.equal(daily.json.data.rows[0].contributingHallCount, 2);
    // Service bør ha blitt kalt for begge haller
    assert.equal(ctx.spies.dailyCalls.length, 2);
    const calledHalls = ctx.spies.dailyCalls.map((c) => c.hallId).sort();
    assert.deepEqual(calledHalls, ["hall-a", "hall-b"]);
  } finally { await ctx.close(); }
});

test("REQ-143: HALL_OPERATOR scopet til grupper hvor egen hall er medlem", async () => {
  const groupOwnHall = makeGroup("grp-own", "Egen GoH", ["hall-a", "hall-b"]);
  const groupOtherHall = makeGroup("grp-other", "Annen GoH", ["hall-c"]);
  const ctx = await startServer({
    users: {
      "op-a-tok": operatorAlpha,
      "op-x-tok": operatorOutside,
      "op-no-tok": operatorNoHall,
    },
    groups: [groupOwnHall, groupOtherHall],
  });
  try {
    // operatorAlpha (hall-a) ser kun grp-own i listen
    const listOwn = await req(ctx.baseUrl, "GET", "/api/admin/reports/groups", "op-a-tok");
    assert.equal(listOwn.status, 200);
    assert.equal(listOwn.json.data.count, 1);
    assert.equal(listOwn.json.data.groups[0].id, "grp-own");
    // hallId-filter skal være satt til hall-a
    assert.equal(ctx.spies.listFilter[0]?.hallId, "hall-a");

    // Daily mot egen gruppe → 200
    const ownDaily = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-own/daily?dateFrom=2026-04-01&dateTo=2026-04-30",
      "op-a-tok",
    );
    assert.equal(ownDaily.status, 200);

    // Daily mot annen gruppe → FORBIDDEN
    const otherDaily = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-other/daily?dateFrom=2026-04-01&dateTo=2026-04-30",
      "op-a-tok",
    );
    assert.equal(otherDaily.status, 400);
    assert.equal(otherDaily.json.error.code, "FORBIDDEN");

    // Operator med hallId som ikke er medlem (operatorOutside.hallId=hall-x)
    // ber om grp-own → FORBIDDEN
    const outsideDaily = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-own/daily?dateFrom=2026-04-01&dateTo=2026-04-30",
      "op-x-tok",
    );
    assert.equal(outsideDaily.status, 400);
    assert.equal(outsideDaily.json.error.code, "FORBIDDEN");

    // PLAYER + AGENT-rolle ekskludert via RBAC ovenfor; her dekker vi
    // operator-uten-tildelt-hall (FORBIDDEN på listing)
    const noHallList = await req(ctx.baseUrl, "GET", "/api/admin/reports/groups", "op-no-tok");
    assert.equal(noHallList.status, 400);
    assert.equal(noHallList.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("REQ-143: single-hall-gruppe fallback returnerer aggregat med contributingHallCount=1", async () => {
  const singleHallGroup = makeGroup("grp-mono", "Mono GoH", ["hall-a"]);
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    groups: [singleHallGroup],
  });
  try {
    const daily = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-mono/daily?dateFrom=2026-04-01&dateTo=2026-04-30",
      "admin-tok",
    );
    assert.equal(daily.status, 200);
    assert.equal(daily.json.data.hallIds.length, 1);
    assert.equal(daily.json.data.rows.length, 1);
    // Ingen aggregering — ren passthrough fra service
    assert.equal(daily.json.data.rows[0].ticketsSoldCents, 10000);
    assert.equal(daily.json.data.rows[0].contributingHallCount, 1);

    // Monthly skal også fungere på single-hall
    const monthly = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-mono/monthly?year=2026&month=4",
      "admin-tok",
    );
    assert.equal(monthly.status, 200);
    assert.equal(monthly.json.data.month, "2026-04");
    assert.equal(monthly.json.data.contributingHallCount, 1);

    // Account-balance på single-hall = 1× hall-balansen
    const balance = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-mono/account-balance",
      "admin-tok",
    );
    assert.equal(balance.status, 200);
    assert.equal(balance.json.data.groupId, "grp-mono");
    assert.equal(balance.json.data.hallCashBalance, 5000);
    assert.deepEqual(balance.json.data.hallIds, ["hall-a"]);
  } finally { await ctx.close(); }
});

test("REQ-143: ukjent groupId → HALL_GROUP_NOT_FOUND, manglende dateFrom → INVALID_INPUT", async () => {
  const grp = makeGroup("grp-x", "X GoH", ["hall-a"]);
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    groups: [grp],
  });
  try {
    // Ukjent group
    const notFound = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-doesnotexist/daily?dateFrom=2026-04-01&dateTo=2026-04-30",
      "admin-tok",
    );
    assert.equal(notFound.status, 400);
    assert.equal(notFound.json.error.code, "HALL_GROUP_NOT_FOUND");

    // Mangler dateFrom
    const noDate = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-x/daily?dateTo=2026-04-30",
      "admin-tok",
    );
    assert.equal(noDate.status, 400);
    assert.equal(noDate.json.error.code, "INVALID_INPUT");

    // Mangler year for monthly
    const noYear = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-x/monthly?month=4",
      "admin-tok",
    );
    assert.equal(noYear.status, 400);
    assert.equal(noYear.json.error.code, "INVALID_INPUT");

    // PLAYER blokkert via RBAC
    const ctx2 = await startServer({
      users: { "pl-tok": playerUser },
      groups: [grp],
    });
    try {
      const player = await req(ctx2.baseUrl, "GET", "/api/admin/reports/groups", "pl-tok");
      assert.equal(player.status, 400);
      assert.equal(player.json.error.code, "FORBIDDEN");
    } finally { await ctx2.close(); }
  } finally { await ctx.close(); }
});

test("REQ-143: én hall som feiler ekskluderes fra aggregat (graceful degradation)", async () => {
  const grp = makeGroup("grp-mixed", "Mixed GoH", ["hall-good", "hall-bad"]);
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    groups: [grp],
    failHallId: "hall-bad",
  });
  try {
    const daily = await req(
      ctx.baseUrl, "GET",
      "/api/admin/reports/groups/grp-mixed/daily?dateFrom=2026-04-01&dateTo=2026-04-30",
      "admin-tok",
    );
    assert.equal(daily.status, 200);
    // Kun hall-good bidrar — aggregat skal ha én hall
    assert.equal(daily.json.data.rows[0].contributingHallCount, 1);
    assert.equal(daily.json.data.rows[0].ticketsSoldCents, 10000);
  } finally { await ctx.close(); }
});
