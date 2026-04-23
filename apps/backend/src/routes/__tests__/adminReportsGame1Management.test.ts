/**
 * BIN-BOT-01: integrasjonstester for /api/admin/reports/game1.
 *
 * Dekker:
 *   - RBAC (DAILY_REPORT_READ kreves; PLAYER + AGENT blokkert).
 *   - HALL_OPERATOR auto-scope til egen hall.
 *   - Filter-parametere (hallId, groupOfHallId, type, q, from/to).
 *   - Response-shape: rows + totals + from/to/type.
 *   - Default-vindu (siste 7d) når ikke sendt.
 *   - Ugyldig vindu → INVALID_INPUT.
 *   - type=bot akseptert uten å krasje (returnerer tom-aggregat).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminReportsGame1ManagementRouter } from "../adminReportsGame1Management.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
  ScheduleSlot,
  ScheduleLogEntry,
  HallDefinition,
} from "../../platform/PlatformService.js";
import type { HallGroupService, HallGroup } from "../../admin/HallGroupService.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "a@test.no",
  displayName: "Admin",
  walletId: "w-a",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorA: PublicAppUser = { ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" };
const operatorB: PublicAppUser = { ...adminUser, id: "op-b", role: "HALL_OPERATOR", hallId: "hall-b" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };
const agentUser: PublicAppUser = { ...adminUser, id: "ag-1", role: "AGENT", hallId: "hall-a" };

function slot(id: string, parentId: string | null, hallId: string, seq: number | null): ScheduleSlot {
  return {
    id,
    hallId,
    gameType: "standard",
    displayName: `Slot ${id}`,
    dayOfWeek: null,
    startTime: "18:00",
    prizeDescription: "",
    maxTickets: 30,
    isActive: true,
    sortOrder: 0,
    variantConfig: { gameMode: "standard" },
    parentScheduleId: parentId,
    subGameSequence: seq,
    subGameNumber: seq ? `CH_${seq}_x_G2` : null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

function hall(id: string, name: string): HallDefinition {
  return {
    id,
    slug: id,
    name,
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "web",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function group(id: string, name: string, hallIds: string[]): HallGroup {
  return {
    id,
    legacyGroupHallId: `GH_${id}`,
    name,
    status: "active",
    tvId: null,
    productIds: [],
    members: hallIds.map((hallId) => ({
      hallId,
      hallName: `Hall ${hallId}`,
      hallStatus: "active",
      addedAt: "2026-01-01T00:00:00.000Z",
    })),
    extra: {},
    createdBy: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function entry(
  id: string,
  gameId: string,
  hallId: string,
  type: "STAKE" | "PRIZE",
  amount: number,
  metadata?: Record<string, unknown>,
): ComplianceLedgerEntry {
  const createdAt = "2026-04-18T18:00:00.000Z";
  return {
    id,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    hallId,
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: type,
    amount,
    currency: "NOK",
    gameId,
    metadata,
  };
}

interface Ctx {
  baseUrl: string;
  spies: {
    listAllSubGameChildren: Array<unknown>;
    listScheduleLogInRange: Array<unknown>;
    listComplianceLedgerEntries: Array<unknown>;
    hallGroupServiceList: Array<unknown>;
  };
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: {
    children?: ScheduleSlot[];
    scheduleLogs?: ScheduleLogEntry[];
    entries?: ComplianceLedgerEntry[];
    halls?: HallDefinition[];
    hallGroups?: HallGroup[];
  },
): Promise<Ctx> {
  const spies: Ctx["spies"] = {
    listAllSubGameChildren: [],
    listScheduleLogInRange: [],
    listComplianceLedgerEntries: [],
    hallGroupServiceList: [],
  };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
    async listAllSubGameChildren(input: unknown) {
      spies.listAllSubGameChildren.push(input);
      return opts?.children ?? [];
    },
    async listScheduleLogInRange(input: unknown) {
      spies.listScheduleLogInRange.push(input);
      return opts?.scheduleLogs ?? [];
    },
    async listHalls() {
      return opts?.halls ?? [hall("hall-a", "Alpha"), hall("hall-b", "Beta")];
    },
  } as unknown as PlatformService;

  const engine = {
    listComplianceLedgerEntries(input: unknown) {
      spies.listComplianceLedgerEntries.push(input);
      return opts?.entries ?? [];
    },
  } as unknown as BingoEngine;

  const hallGroupService = {
    async list(input: unknown) {
      spies.hallGroupServiceList.push(input);
      return (
        opts?.hallGroups ?? [
          group("grp-1", "Group North", ["hall-a"]),
          group("grp-2", "Group South", ["hall-b"]),
        ]
      );
    },
  } as unknown as HallGroupService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminReportsGame1ManagementRouter({
      platformService,
      engine,
      hallGroupService,
    }),
  );
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
async function req(baseUrl: string, path: string, token?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── RBAC ────────────────────────────────────────────────────────────────────

test("BIN-BOT-01: PLAYER + AGENT blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser, "ag-tok": agentUser });
  try {
    for (const token of ["pl-tok", "ag-tok"]) {
      const r = await req(ctx.baseUrl, "/api/admin/reports/game1", token);
      assert.equal(r.status, 400);
      assert.equal(r.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-BOT-01: ADMIN + SUPPORT + HALL_OPERATOR kan lese", async () => {
  const ctx = await startServer({
    "admin-tok": adminUser,
    "sup-tok": supportUser,
    "op-a-tok": operatorA,
  });
  try {
    for (const token of ["admin-tok", "sup-tok", "op-a-tok"]) {
      const r = await req(ctx.baseUrl, "/api/admin/reports/game1", token);
      assert.equal(r.status, 200, `role for ${token} ga ${r.status}: ${JSON.stringify(r.json)}`);
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-BOT-01: uten token → 400 UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/game1");
    assert.equal(r.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── HALL_OPERATOR scope ─────────────────────────────────────────────────────

test("BIN-BOT-01: HALL_OPERATOR auto-scopes til egen hall", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    // Ingen hallId i URL — operator-A skal likevel tvinges til hall-a.
    const r = await req(ctx.baseUrl, "/api/admin/reports/game1", "op-a-tok");
    assert.equal(r.status, 200);
    const call = ctx.spies.listAllSubGameChildren[0] as { hallId: string };
    assert.equal(call.hallId, "hall-a");
    const ledgerCall = ctx.spies.listComplianceLedgerEntries[0] as { hallId: string };
    assert.equal(ledgerCall.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-BOT-01: HALL_OPERATOR blokkert fra annen hall", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/game1?hallId=hall-b", "op-a-tok");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── Response shape ──────────────────────────────────────────────────────────

test("BIN-BOT-01: returnerer rows + totals i response", async () => {
  const children = [
    slot("sg-1", "parent-1", "hall-a", 1),
    slot("sg-2", "parent-1", "hall-a", 2),
  ];
  const logs: ScheduleLogEntry[] = [
    {
      id: "l1", hallId: "hall-a", scheduleSlotId: "sg-1", gameSessionId: "gs-1",
      startedAt: "2026-04-18T18:00:00.000Z", endedAt: null, playerCount: null,
      totalPayout: null, notes: null, createdAt: "2026-04-18T18:00:00.000Z",
    },
    {
      id: "l2", hallId: "hall-a", scheduleSlotId: "sg-2", gameSessionId: "gs-2",
      startedAt: "2026-04-18T19:00:00.000Z", endedAt: null, playerCount: null,
      totalPayout: null, notes: null, createdAt: "2026-04-18T19:00:00.000Z",
    },
  ];
  const entries = [
    entry("s1", "gs-1", "hall-a", "STAKE", 100),
    entry("s2", "gs-1", "hall-a", "STAKE", 200),
    entry("p1", "gs-1", "hall-a", "PRIZE", 50),
    entry("s3", "gs-2", "hall-a", "STAKE", 400),
    entry("p2", "gs-2", "hall-a", "PRIZE", 250),
  ];
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { children, scheduleLogs: logs, entries },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/game1?from=2026-04-18&to=2026-04-19",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.data.rows.length, 2);
    // OMS total = 100 + 200 + 400 = 700
    // UTD total = 50 + 250 = 300
    // RES total = 700 - 300 = 400
    assert.equal(r.json.data.totals.oms, 700);
    assert.equal(r.json.data.totals.utd, 300);
    assert.equal(r.json.data.totals.res, 400);
    // Payout% = 300/700 * 100 ≈ 42.86
    assert.equal(r.json.data.totals.payoutPct, 42.86);
    assert.equal(r.json.data.type, "player");
    assert.equal(typeof r.json.data.generatedAt, "string");
  } finally {
    await ctx.close();
  }
});

test("BIN-BOT-01: q-filter matcher subGameNumber", async () => {
  const children = [
    slot("sg-north", "parent-1", "hall-a", 1),
    slot("sg-south", "parent-1", "hall-a", 2),
  ];
  // Override subGameNumber
  children[0]!.subGameNumber = "NORTH_2024_01";
  children[1]!.subGameNumber = "SOUTH_2024_01";
  const ctx = await startServer({ "admin-tok": adminUser }, { children });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/game1?from=2026-04-18&to=2026-04-19&q=NORTH",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.data.rows.length, 1);
    assert.equal(r.json.data.rows[0].subGameNumber, "NORTH_2024_01");
  } finally {
    await ctx.close();
  }
});

test("BIN-BOT-01: type=bot aksepteres og krasjer ikke", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/game1?type=bot",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.data.type, "bot");
    assert.equal(r.json.data.totals.oms, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-BOT-01: type=bogus defaulter til player", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/game1?type=bogus",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.data.type, "player");
  } finally {
    await ctx.close();
  }
});

test("BIN-BOT-01: groupOfHallId-filter", async () => {
  const children = [
    slot("sg-a", "parent-1", "hall-a", 1),
    slot("sg-b", "parent-2", "hall-b", 1),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { children });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/game1?groupOfHallId=grp-1&from=2026-04-18&to=2026-04-19",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.data.rows.length, 1);
    assert.equal(r.json.data.rows[0].hallId, "hall-a");
    assert.equal(r.json.data.rows[0].groupOfHallId, "grp-1");
    assert.equal(r.json.data.rows[0].groupOfHallName, "Group North");
  } finally {
    await ctx.close();
  }
});

// ── Input validation ────────────────────────────────────────────────────────

test("BIN-BOT-01: from > to → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/game1?from=2026-04-20&to=2026-04-18",
      "admin-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-BOT-01: ugyldig from-format → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/game1?from=bogus-date",
      "admin-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-BOT-01: default-vindu når from/to mangler", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/game1", "admin-tok");
    assert.equal(r.status, 200);
    // Default = siste 7 dager ending now; shape-check.
    assert.ok(typeof r.json.data.from === "string");
    assert.ok(typeof r.json.data.to === "string");
    assert.ok(Date.parse(r.json.data.to) > Date.parse(r.json.data.from));
  } finally {
    await ctx.close();
  }
});
