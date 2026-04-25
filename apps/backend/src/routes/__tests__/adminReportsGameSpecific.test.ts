/**
 * GAP #28: integrasjonstester for /api/admin/reports/games/:gameSlug/details.
 *
 * Dekker:
 *   - RBAC (DAILY_REPORT_READ kreves; PLAYER + AGENT blokkert).
 *   - HALL_OPERATOR auto-scope til egen hall.
 *   - HALL_OPERATOR blokkert fra annen hall.
 *   - Slug-validering: bingo/rocket/monsterbingo/spillorama OK; themebingo
 *     og game4 → INVALID_INPUT med BIN-496-melding.
 *   - Default-vindu (siste 7d) når from/to ikke sendt.
 *   - Ugyldig vindu (from > to) → INVALID_INPUT.
 *   - Response shape: rows + totals + channelBreakdown + gameSpecific + category.
 *   - format=csv → text/csv content-type + Content-Disposition.
 *   - Tom hall / ingen entries → null-aggregat.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminReportsGameSpecificRouter } from "../adminReportsGameSpecific.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
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
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };
const agentUser: PublicAppUser = { ...adminUser, id: "ag-1", role: "AGENT", hallId: "hall-a" };

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

function entry(opts: {
  id: string;
  hallId: string;
  gameId?: string;
  type: "STAKE" | "PRIZE";
  amount: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): ComplianceLedgerEntry {
  const createdAt = opts.createdAt ?? new Date().toISOString();
  return {
    id: opts.id,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    hallId: opts.hallId,
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: opts.type,
    amount: opts.amount,
    currency: "NOK",
    gameId: opts.gameId,
    metadata: opts.metadata,
  };
}

interface Ctx {
  baseUrl: string;
  spies: {
    listComplianceLedgerEntries: Array<unknown>;
  };
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: {
    entries?: ComplianceLedgerEntry[];
    halls?: HallDefinition[];
  },
): Promise<Ctx> {
  const spies: Ctx["spies"] = { listComplianceLedgerEntries: [] };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
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
  app.use(createAdminReportsGameSpecificRouter({ platformService, engine }));
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
async function reqJson(baseUrl: string, path: string, token?: string): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}

async function reqText(baseUrl: string, path: string, token?: string): Promise<{ status: number; text: string; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

// ── RBAC ────────────────────────────────────────────────────────────────────

test("GAP-28 route: PLAYER + AGENT blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser, "ag-tok": agentUser });
  try {
    for (const token of ["pl-tok", "ag-tok"]) {
      const r = await reqJson(ctx.baseUrl, "/api/admin/reports/games/bingo/details", token);
      assert.equal(r.status, 400);
      assert.equal(r.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("GAP-28 route: ADMIN + SUPPORT + HALL_OPERATOR kan lese", async () => {
  const ctx = await startServer({
    "admin-tok": adminUser,
    "sup-tok": supportUser,
    "op-a-tok": operatorA,
  });
  try {
    for (const token of ["admin-tok", "sup-tok", "op-a-tok"]) {
      const r = await reqJson(ctx.baseUrl, "/api/admin/reports/games/bingo/details", token);
      assert.equal(r.status, 200, `role for ${token} ga ${r.status}`);
    }
  } finally {
    await ctx.close();
  }
});

test("GAP-28 route: uten token → 400 UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const r = await reqJson(ctx.baseUrl, "/api/admin/reports/games/bingo/details");
    assert.equal(r.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── HALL_OPERATOR scope ────────────────────────────────────────────────────

test("GAP-28 route: HALL_OPERATOR auto-scopes til egen hall", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const r = await reqJson(ctx.baseUrl, "/api/admin/reports/games/bingo/details", "op-a-tok");
    assert.equal(r.status, 200);
    const ledgerCall = ctx.spies.listComplianceLedgerEntries[0] as { hallId: string };
    assert.equal(ledgerCall.hallId, "hall-a");
    assert.equal(r.json.data.filters.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("GAP-28 route: HALL_OPERATOR blokkert fra annen hall", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const r = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/games/bingo/details?hallId=hall-b",
      "op-a-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── Slug-validering ────────────────────────────────────────────────────────

test("GAP-28 route: ukjent slug → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await reqJson(ctx.baseUrl, "/api/admin/reports/games/foo/details", "admin-tok");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
    assert.match(r.json.error.message, /Ukjent game-slug/);
  } finally {
    await ctx.close();
  }
});

test("GAP-28 route: themebingo (deprecated game4) → INVALID_INPUT med BIN-496-melding", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r1 = await reqJson(ctx.baseUrl, "/api/admin/reports/games/themebingo/details", "admin-tok");
    assert.equal(r1.status, 400);
    assert.match(r1.json.error.message, /BIN-496/);
    const r2 = await reqJson(ctx.baseUrl, "/api/admin/reports/games/game4/details", "admin-tok");
    assert.equal(r2.status, 400);
    assert.match(r2.json.error.message, /BIN-496/);
  } finally {
    await ctx.close();
  }
});

test("GAP-28 route: alle gyldige slugs returnerer 200", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    for (const slug of ["bingo", "rocket", "monsterbingo", "spillorama"]) {
      const r = await reqJson(ctx.baseUrl, `/api/admin/reports/games/${slug}/details`, "admin-tok");
      assert.equal(r.status, 200, `slug ${slug} ga ${r.status}`);
      assert.equal(r.json.data.slug, slug);
    }
  } finally {
    await ctx.close();
  }
});

// ── Default-vindu + ugyldig vindu ──────────────────────────────────────────

test("GAP-28 route: default-vindu er siste 7d", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await reqJson(ctx.baseUrl, "/api/admin/reports/games/bingo/details", "admin-tok");
    assert.equal(r.status, 200);
    const ledgerCall = ctx.spies.listComplianceLedgerEntries[0] as { dateFrom: string; dateTo: string };
    const fromMs = Date.parse(ledgerCall.dateFrom);
    const toMs = Date.parse(ledgerCall.dateTo);
    const diffDays = (toMs - fromMs) / (24 * 3600 * 1000);
    // Innenfor [6.5, 7.5] dager — runder rundt 7.
    assert.ok(diffDays > 6.5 && diffDays < 7.5, `diffDays=${diffDays}`);
  } finally {
    await ctx.close();
  }
});

test("GAP-28 route: from > to → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/games/bingo/details?from=2026-04-20&to=2026-04-18",
      "admin-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── Response-shape ─────────────────────────────────────────────────────────

test("GAP-28 route: response inneholder rows + totals + channelBreakdown + gameSpecific", async () => {
  const entries = [
    entry({ id: "e1", hallId: "hall-a", gameId: "g1", type: "STAKE", amount: 50,
      createdAt: "2026-04-18T18:00:00Z", metadata: { gameSlug: "bingo", subGameKind: "wheel" } }),
    entry({ id: "e2", hallId: "hall-a", gameId: "g1", type: "PRIZE", amount: 20,
      createdAt: "2026-04-18T18:30:00Z", metadata: { gameSlug: "bingo" } }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { entries });
  try {
    const r = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/games/bingo/details?from=2026-04-18&to=2026-04-18",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    const data = r.json.data;
    assert.equal(data.slug, "bingo");
    assert.equal(data.category, "Hovedspill");
    assert.ok(Array.isArray(data.rows));
    assert.ok(typeof data.totals === "object");
    assert.ok(typeof data.channelBreakdown === "object");
    assert.ok(typeof data.gameSpecific === "object");
    assert.equal(data.gameSpecific.slug, "bingo");
    assert.equal(data.gameSpecific.specifics.subGameKindBreakdown.wheel, 1);
    assert.equal(data.totals.totalStakes, 50);
    assert.equal(data.totals.totalPrizes, 20);
  } finally {
    await ctx.close();
  }
});

test("GAP-28 route: tom hall → 200 med null-aggregater", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    halls: [hall("hall-empty", "Empty")],
    entries: [],
  });
  try {
    const r = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/games/bingo/details?hallId=hall-empty",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.data.totals.totalStakes, 0);
    assert.equal(r.json.data.rows.length, 0);
  } finally {
    await ctx.close();
  }
});

test("GAP-28 route: spillorama-slug returnerer category=Databingo", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/games/spillorama/details",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.data.category, "Databingo");
  } finally {
    await ctx.close();
  }
});

// ── CSV-export ─────────────────────────────────────────────────────────────

test("GAP-28 route: format=csv returnerer text/csv attachment", async () => {
  const entries = [
    entry({ id: "e1", hallId: "hall-a", gameId: "g1", type: "STAKE", amount: 50,
      createdAt: "2026-04-18T18:00:00Z", metadata: { gameSlug: "bingo" } }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { entries });
  try {
    const r = await reqText(
      ctx.baseUrl,
      "/api/admin/reports/games/bingo/details?from=2026-04-18&to=2026-04-18&format=csv",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(
      r.headers.get("content-disposition") ?? "",
      /attachment; filename="report-bingo-2026-04-18\.csv"/,
    );
    assert.match(r.text, /section,hall_id,hall_name/);
    assert.match(r.text, /game_specific/);
  } finally {
    await ctx.close();
  }
});

test("GAP-28 route: format=csv også for spillorama", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await reqText(
      ctx.baseUrl,
      "/api/admin/reports/games/spillorama/details?from=2026-04-18&to=2026-04-18&format=csv",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.match(
      r.headers.get("content-disposition") ?? "",
      /report-spillorama-2026-04-18\.csv/,
    );
  } finally {
    await ctx.close();
  }
});
