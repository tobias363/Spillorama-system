/**
 * BIN-650: integrasjonstester for admin red-flag categories report-router.
 *
 * Dekker RBAC (PLAYER_AML_READ: ADMIN + SUPPORT kan lese, HALL_OPERATOR +
 * PLAYER + AGENT blokkert), default-vindu, eksplisitt from/to, tom input,
 * response-shape + totals.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminReportsRedFlagCategoriesRouter } from "../adminReportsRedFlagCategories.js";
import type {
  AmlService,
  AmlCategoryCountRow,
  AggregateCategoryCountsInput,
} from "../../compliance/AmlService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "admin@test.no",
  displayName: "Admin",
  walletId: "w-admin",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };
const agentUser: PublicAppUser = {
  ...adminUser,
  id: "ag-1",
  role: "AGENT",
  hallId: "hall-a",
};

interface Ctx {
  baseUrl: string;
  spies: {
    aggregateCalls: AggregateCategoryCountsInput[];
  };
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: { rows?: AmlCategoryCountRow[] },
): Promise<Ctx> {
  const aggregateCalls: AggregateCategoryCountsInput[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const amlService = {
    async aggregateCategoryCounts(input: AggregateCategoryCountsInput): Promise<AmlCategoryCountRow[]> {
      aggregateCalls.push(input);
      return opts?.rows ?? [];
    },
  } as unknown as AmlService;

  const app = express();
  app.use(express.json());
  app.use(createAdminReportsRedFlagCategoriesRouter({ platformService, amlService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { aggregateCalls },
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

test("BIN-650: ADMIN + SUPPORT kan lese", async () => {
  const ctx = await startServer({ "admin-tok": adminUser, "sup-tok": supportUser });
  try {
    for (const token of ["admin-tok", "sup-tok"]) {
      const r = await req(ctx.baseUrl, "/api/admin/reports/red-flag/categories", token);
      assert.equal(r.status, 200, `role for ${token} ga ${r.status}: ${JSON.stringify(r.json)}`);
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-650: HALL_OPERATOR blokkert (AML er sentralisert, ikke hall-delegert)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/red-flag/categories", "op-tok");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-650: PLAYER + AGENT blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser, "ag-tok": agentUser });
  try {
    for (const token of ["pl-tok", "ag-tok"]) {
      const r = await req(ctx.baseUrl, "/api/admin/reports/red-flag/categories", token);
      assert.equal(r.status, 400);
      assert.equal(r.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-650: uten token → UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/red-flag/categories");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

// ── Aggregat ────────────────────────────────────────────────────────────────

test("BIN-650: returnerer categories + totals i wire-shape", async () => {
  const rows: AmlCategoryCountRow[] = [
    {
      slug: "high-amount",
      label: "High amount",
      severity: "HIGH",
      description: "Beløp over terskel",
      count: 5,
      openCount: 3,
    },
    {
      slug: "high-velocity",
      label: "High velocity",
      severity: "MEDIUM",
      description: "Mange transaksjoner på kort tid",
      count: 2,
      openCount: 2,
    },
    {
      slug: "manual",
      label: "manual",
      severity: "LOW",
      description: null,
      count: 1,
      openCount: 0,
    },
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, { rows });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/categories?from=2026-03-20T00:00:00Z&to=2026-04-20T00:00:00Z",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.data.from, "2026-03-20T00:00:00.000Z");
    assert.equal(r.json.data.to, "2026-04-20T00:00:00.000Z");
    assert.equal(r.json.data.categories.length, 3);
    assert.deepEqual(r.json.data.categories[0], {
      category: "high-amount",
      label: "High amount",
      description: "Beløp over terskel",
      severity: "HIGH",
      count: 5,
      openCount: 3,
    });
    assert.equal(r.json.data.totals.totalFlags, 8);
    assert.equal(r.json.data.totals.totalOpenFlags, 5);
    assert.equal(r.json.data.totals.categoryCount, 3);
    assert.ok(typeof r.json.data.generatedAt === "string");
    assert.equal(ctx.spies.aggregateCalls.length, 1);
    assert.equal(ctx.spies.aggregateCalls[0]!.from, "2026-03-20T00:00:00.000Z");
    assert.equal(ctx.spies.aggregateCalls[0]!.to, "2026-04-20T00:00:00.000Z");
  } finally {
    await ctx.close();
  }
});

test("BIN-650: tom input → tom categories + nullstilte totals", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, { rows: [] });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/categories",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.categories, []);
    assert.equal(r.json.data.totals.totalFlags, 0);
    assert.equal(r.json.data.totals.totalOpenFlags, 0);
    assert.equal(r.json.data.totals.categoryCount, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-650: default-vindu er siste 30 dager når from/to mangler", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/categories",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    const fromMs = Date.parse(r.json.data.from);
    const toMs = Date.parse(r.json.data.to);
    const span = toMs - fromMs;
    const expected = 30 * 24 * 60 * 60 * 1000;
    // Toleranse: ±1 sekund (CI jitter).
    assert.ok(Math.abs(span - expected) < 1000, `span ${span} skal være ~30d`);
  } finally {
    await ctx.close();
  }
});

test("BIN-650: ugyldig from → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/categories?from=ikke-iso",
      "admin-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-650: ugyldig to → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/categories?to=ikke-iso",
      "admin-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-650: from > to → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/categories?from=2026-04-20T00:00:00Z&to=2026-03-20T00:00:00Z",
      "admin-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-650: videresender from/to til AmlService.aggregateCategoryCounts", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/categories?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    assert.equal(ctx.spies.aggregateCalls.length, 1);
    assert.equal(ctx.spies.aggregateCalls[0]!.from, "2026-01-01T00:00:00.000Z");
    assert.equal(ctx.spies.aggregateCalls[0]!.to, "2026-02-01T00:00:00.000Z");
  } finally {
    await ctx.close();
  }
});
