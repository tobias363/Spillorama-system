/**
 * BIN-647: integrasjonstester for admin subgame-drill-down-router.
 *
 * Dekker RBAC (DAILY_REPORT_READ), hall-scope (HALL_OPERATOR),
 * cursor-paginering, not-found parent, og response-shape.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminReportsSubgameDrillDownRouter } from "../adminReportsSubgameDrillDown.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
  ScheduleSlot,
  ScheduleLogEntry,
  HallDefinition,
} from "../../platform/PlatformService.js";
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

interface Ctx {
  baseUrl: string;
  spies: {
    listSubGameChildren: Array<string>;
    listScheduleLogForSlots: Array<unknown>;
    listComplianceLedgerEntries: Array<unknown>;
  };
  close: () => Promise<void>;
}

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
    tvToken: `tv-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function entry(
  id: string,
  gameId: string,
  hallId: string,
  type: "STAKE" | "PRIZE",
  amount: number,
  walletId = "w1",
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
    walletId,
  };
}

async function startServer(users: Record<string, PublicAppUser>, opts?: {
  parent?: ScheduleSlot | null;
  children?: ScheduleSlot[];
  scheduleLogs?: ScheduleLogEntry[];
  entries?: ComplianceLedgerEntry[];
  halls?: HallDefinition[];
}): Promise<Ctx> {
  const spies: Ctx["spies"] = {
    listSubGameChildren: [],
    listScheduleLogForSlots: [],
    listComplianceLedgerEntries: [],
  };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
    async getScheduleSlotById(id: string) {
      if (!opts?.parent) return null;
      if (opts.parent.id !== id) return null;
      return opts.parent;
    },
    async listSubGameChildren(parentId: string) {
      spies.listSubGameChildren.push(parentId);
      return opts?.children ?? [];
    },
    async listScheduleLogForSlots(input: unknown) {
      spies.listScheduleLogForSlots.push(input);
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

  const app = express();
  app.use(express.json());
  app.use(createAdminReportsSubgameDrillDownRouter({ platformService, engine }));
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

test("BIN-647: PLAYER + AGENT blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser, "ag-tok": agentUser });
  try {
    for (const token of ["pl-tok", "ag-tok"]) {
      const r = await req(ctx.baseUrl, "/api/admin/reports/subgame-drill-down?parentId=parent-1", token);
      assert.equal(r.status, 400);
      assert.equal(r.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-647: ADMIN + SUPPORT + HALL_OPERATOR kan lese", async () => {
  const parent = slot("parent-1", null, "hall-a", null);
  const ctx = await startServer(
    {
      "admin-tok": adminUser,
      "sup-tok": supportUser,
      "op-a-tok": operatorA,
    },
    { parent, children: [] },
  );
  try {
    for (const token of ["admin-tok", "sup-tok", "op-a-tok"]) {
      const r = await req(ctx.baseUrl, "/api/admin/reports/subgame-drill-down?parentId=parent-1", token);
      assert.equal(r.status, 200, `role for ${token} ga ${r.status}: ${JSON.stringify(r.json)}`);
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-647: HALL_OPERATOR blokkert fra annen hall sin parent", async () => {
  const parent = slot("parent-1", null, "hall-b", null); // operator A er i hall-a
  const ctx = await startServer({ "op-a-tok": operatorA }, { parent });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/subgame-drill-down?parentId=parent-1", "op-a-tok");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-647: parentId uten parent-row → SCHEDULE_SLOT_NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, { parent: null });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/subgame-drill-down?parentId=nope", "admin-tok");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "SCHEDULE_SLOT_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-647: parentId tom/manglende → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/subgame-drill-down", "admin-tok");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── Aggregat ────────────────────────────────────────────────────────────────

test("BIN-647: returnerer items + totals for alle sub-games", async () => {
  const parent = slot("parent-1", null, "hall-a", null);
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
    entry("s1", "gs-1", "hall-a", "STAKE", 100, "w1"),
    entry("s2", "gs-1", "hall-a", "STAKE", 200, "w2"),
    entry("p1", "gs-1", "hall-a", "PRIZE", 50, "w1"),
    entry("s3", "gs-2", "hall-a", "STAKE", 400, "w3"),
  ];
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { parent, children, scheduleLogs: logs, entries },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/subgame-drill-down?parentId=parent-1&from=2026-04-18T00:00:00Z&to=2026-04-19T00:00:00Z",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.data.items.length, 2);
    assert.equal(r.json.data.parentId, "parent-1");
    assert.equal(r.json.data.totals.revenue, 700);
    assert.equal(r.json.data.totals.totalWinnings, 50);
    assert.equal(r.json.data.totals.netProfit, 650);
    assert.equal(r.json.data.totals.players, 3);
    assert.equal(r.json.data.nextCursor, null);
    // Viderekobles til engine med korrekt hallId-scope.
    const call = ctx.spies.listComplianceLedgerEntries[0] as { hallId: string };
    assert.equal(call.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-647: cursor-paginering returnerer nextCursor og neste side", async () => {
  const parent = slot("parent-1", null, "hall-a", null);
  const children = Array.from({ length: 5 }, (_, i) =>
    slot(`sg-${i + 1}`, "parent-1", "hall-a", i + 1),
  );
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { parent, children, scheduleLogs: [], entries: [] },
  );
  try {
    const p1 = await req(
      ctx.baseUrl,
      "/api/admin/reports/subgame-drill-down?parentId=parent-1&limit=2",
      "admin-tok",
    );
    assert.equal(p1.status, 200);
    assert.equal(p1.json.data.items.length, 2);
    assert.ok(p1.json.data.nextCursor);
    assert.deepEqual(
      p1.json.data.items.map((i: { subGameId: string }) => i.subGameId),
      ["sg-1", "sg-2"],
    );

    const p2 = await req(
      ctx.baseUrl,
      `/api/admin/reports/subgame-drill-down?parentId=parent-1&limit=2&cursor=${encodeURIComponent(p1.json.data.nextCursor)}`,
      "admin-tok",
    );
    assert.equal(p2.status, 200);
    assert.deepEqual(
      p2.json.data.items.map((i: { subGameId: string }) => i.subGameId),
      ["sg-3", "sg-4"],
    );

    const p3 = await req(
      ctx.baseUrl,
      `/api/admin/reports/subgame-drill-down?parentId=parent-1&limit=2&cursor=${encodeURIComponent(p2.json.data.nextCursor)}`,
      "admin-tok",
    );
    assert.equal(p3.status, 200);
    assert.equal(p3.json.data.items.length, 1);
    assert.equal(p3.json.data.nextCursor, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-647: ugyldig from/to returnerer INVALID_INPUT", async () => {
  const parent = slot("parent-1", null, "hall-a", null);
  const ctx = await startServer({ "admin-tok": adminUser }, { parent, children: [] });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/subgame-drill-down?parentId=parent-1&from=ikke-iso",
      "admin-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-647: ingen children → tom items, totals = 0", async () => {
  const parent = slot("parent-1", null, "hall-a", null);
  const ctx = await startServer({ "admin-tok": adminUser }, { parent, children: [] });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/subgame-drill-down?parentId=parent-1",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.items, []);
    assert.equal(r.json.data.totals.revenue, 0);
    assert.equal(r.json.data.nextCursor, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-647: default-vindu er siste 7 dager når from/to mangler", async () => {
  const parent = slot("parent-1", null, "hall-a", null);
  const ctx = await startServer({ "admin-tok": adminUser }, { parent, children: [] });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/subgame-drill-down?parentId=parent-1",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    const fromMs = Date.parse(r.json.data.from);
    const toMs = Date.parse(r.json.data.to);
    const span = toMs - fromMs;
    const expected = 7 * 24 * 60 * 60 * 1000;
    // Toleranse: ±1 sekund
    assert.ok(Math.abs(span - expected) < 1000, `span ${span} should be ~7d`);
  } finally {
    await ctx.close();
  }
});

test("BIN-647: listSubGameChildren + listScheduleLogForSlots kalles med parent/slots", async () => {
  const parent = slot("parent-1", null, "hall-a", null);
  const children = [slot("sg-1", "parent-1", "hall-a", 1)];
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { parent, children, scheduleLogs: [], entries: [] },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/subgame-drill-down?parentId=parent-1",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.deepEqual(ctx.spies.listSubGameChildren, ["parent-1"]);
    assert.equal(ctx.spies.listScheduleLogForSlots.length, 1);
    const call = ctx.spies.listScheduleLogForSlots[0] as { scheduleSlotIds: string[] };
    assert.deepEqual(call.scheduleSlotIds, ["sg-1"]);
  } finally {
    await ctx.close();
  }
});
