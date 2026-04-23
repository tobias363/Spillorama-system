/**
 * BIN-628 integrasjonstester for admin track-spending-router.
 *
 * Full express round-trip med:
 *   - Stub av PlatformService (token-til-bruker-map + halls-liste)
 *   - Stub av BingoEngine.listComplianceLedgerEntries (kontrollert ledger)
 *   - InMemoryAuditLogStore for å asserte audit-events
 *   - Konfigurerbar `getDataAgeMs` for å trigge fail-closed-sti
 *
 * Dekker regulatoriske hard-krav fra BIN-628:
 *   - Permission-guard: PLAYER/PLAYER-role blokkert, HALL_OPERATOR scoped.
 *   - Fail-closed 503: STALE_DATA, DB_ERROR
 *   - AuditLog: `admin.track_spending.viewed` logges med rowCount/hallId
 *   - Per-hall limits synlige i respons
 *   - Ingen mandatorisk pause-felt
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminTrackSpendingRouter } from "../adminTrackSpending.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type { PlatformService, PublicAppUser, HallDefinition } from "../../platform/PlatformService.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

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
const operatorA: PublicAppUser = {
  ...adminUser,
  id: "op-a",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const operatorB: PublicAppUser = {
  ...adminUser,
  id: "op-b",
  role: "HALL_OPERATOR",
  hallId: "hall-b",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

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
  o: Partial<ComplianceLedgerEntry> &
    Pick<ComplianceLedgerEntry, "id" | "hallId" | "eventType" | "amount" | "createdAt">,
): ComplianceLedgerEntry {
  return {
    currency: "NOK",
    createdAtMs: Date.parse(o.createdAt),
    gameType: "MAIN_GAME",
    channel: "HALL",
    ...o,
  } as ComplianceLedgerEntry;
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  ledgerCalls: Array<{ hallId?: string; dateFrom?: string; dateTo?: string }>;
  close: () => Promise<void>;
}

interface ServerOpts {
  users: Record<string, PublicAppUser>;
  halls?: HallDefinition[];
  entries?: ComplianceLedgerEntry[];
  /** Hvis satt, kaster PlatformService.listHalls den gitte feilen. */
  listHallsError?: Error;
  /** Hvis satt, kaster engine.listComplianceLedgerEntries. */
  ledgerError?: Error;
  /** Styrt dataAgeMs for fail-closed-tester. Default 0. */
  dataAgeMs?: number;
}

async function startServer(opts: ServerOpts): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const ledgerCalls: Ctx["ledgerCalls"] = [];
  const halls = opts.halls ?? [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async listHalls(_options?: { includeInactive?: boolean }): Promise<HallDefinition[]> {
      if (opts.listHallsError) throw opts.listHallsError;
      return halls;
    },
  } as unknown as PlatformService;

  const engine = {
    listComplianceLedgerEntries(input?: {
      hallId?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
    }): ComplianceLedgerEntry[] {
      if (opts.ledgerError) throw opts.ledgerError;
      ledgerCalls.push({ hallId: input?.hallId, dateFrom: input?.dateFrom, dateTo: input?.dateTo });
      return opts.entries ?? [];
    },
  } as unknown as BingoEngine;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminTrackSpendingRouter({
      platformService,
      auditLogService,
      engine,
      regulatoryLimits: { daily: 900, monthly: 4400 },
      hallOverrides: [{ hallId: "hall-special", dailyLimit: 500, monthlyLimit: 2000 }],
      getDataAgeMs: () => opts.dataAgeMs ?? 0,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auditStore,
    ledgerCalls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function reqJson(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForAudit(
  store: InMemoryAuditLogStore,
  action: string,
): Promise<PersistedAuditEvent | null> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await store.list();
    const hit = events.find((e) => e.action === action);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── Permission-guard ────────────────────────────────────────────────────────

test("BIN-628 route: PLAYER blokkert (FORBIDDEN)", async () => {
  const ctx = await startServer({
    users: { "pl-tok": playerUser },
    halls: [hall("hall-a", "Alpha")],
  });
  try {
    const res = await reqJson(ctx.baseUrl, "GET", "/api/admin/track-spending", "pl-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: missing token → UNAUTHORIZED", async () => {
  const ctx = await startServer({ users: {}, halls: [] });
  try {
    const res = await reqJson(ctx.baseUrl, "GET", "/api/admin/track-spending");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: ADMIN + SUPPORT har tilgang", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser, "sup-tok": supportUser },
    halls: [hall("hall-a", "Alpha")],
    entries: [],
  });
  try {
    const asAdmin = await reqJson(ctx.baseUrl, "GET", "/api/admin/track-spending", "admin-tok");
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.json.ok, true);

    const asSupport = await reqJson(ctx.baseUrl, "GET", "/api/admin/track-spending", "sup-tok");
    assert.equal(asSupport.status, 200);
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: HALL_OPERATOR uten hallId → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "op-tok": operatorA },
    halls: [hall("hall-a", "Alpha")],
  });
  try {
    const res = await reqJson(ctx.baseUrl, "GET", "/api/admin/track-spending", "op-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: HALL_OPERATOR blokkert fra annen hall", async () => {
  const ctx = await startServer({
    users: { "op-b-tok": operatorB },
    halls: [hall("hall-a", "Alpha"), hall("hall-b", "Beta")],
  });
  try {
    // op-b prøver å se hall-a
    const res = await reqJson(
      ctx.baseUrl,
      "GET",
      "/api/admin/track-spending?hallId=hall-a",
      "op-b-tok",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: HALL_OPERATOR tillatt å se egen hall", async () => {
  const ctx = await startServer({
    users: { "op-a-tok": operatorA },
    halls: [hall("hall-a", "Alpha"), hall("hall-b", "Beta")],
    entries: [],
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "GET",
      "/api/admin/track-spending?hallId=hall-a",
      "op-a-tok",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

// ── Responsform + limits ────────────────────────────────────────────────────

test("BIN-628 route: aggregat inkluderer per-hall limits med source", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    halls: [hall("hall-a", "Alpha"), hall("hall-special", "Special")],
    entries: [
      entry({
        id: "s1",
        hallId: "hall-a",
        eventType: "STAKE",
        amount: 100,
        walletId: "w1",
        createdAt: "2026-04-18T10:00:00.000Z",
      }),
    ],
  });
  try {
    const from = "2026-04-18T00:00:00.000Z";
    const to = "2026-04-19T00:00:00.000Z";
    const res = await reqJson(
      ctx.baseUrl,
      "GET",
      `/api/admin/track-spending?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      "admin-tok",
    );
    assert.equal(res.status, 200);
    const rows = res.json.data.rows as Array<{ hallId: string; limits: { source: string; dailyLimit: number; monthlyLimit: number } }>;
    const alpha = rows.find((r) => r.hallId === "hall-a");
    assert.equal(alpha?.limits.source, "regulatory");
    assert.equal(alpha?.limits.dailyLimit, 900);
    assert.equal(alpha?.limits.monthlyLimit, 4400);

    const special = rows.find((r) => r.hallId === "hall-special");
    assert.equal(special?.limits.source, "hall_override");
    assert.equal(special?.limits.dailyLimit, 500);
    assert.equal(special?.limits.monthlyLimit, 2000);

    // Ingen mandatorisk pause-felt
    for (const row of rows) {
      assert.equal(Object.prototype.hasOwnProperty.call(row, "mandatoryPause"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(row.limits, "mandatoryPause"), false);
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: aggregat returnerer totals + dataFreshness", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    halls: [hall("hall-a", "Alpha")],
    entries: [
      entry({
        id: "s1",
        hallId: "hall-a",
        eventType: "STAKE",
        amount: 100,
        walletId: "w1",
        createdAt: "2026-04-18T10:00:00.000Z",
      }),
      entry({
        id: "p1",
        hallId: "hall-a",
        eventType: "PRIZE",
        amount: 40,
        walletId: "w1",
        createdAt: "2026-04-18T10:05:00.000Z",
      }),
    ],
    dataAgeMs: 30_000,
  });
  try {
    const from = "2026-04-18T00:00:00.000Z";
    const to = "2026-04-19T00:00:00.000Z";
    const res = await reqJson(
      ctx.baseUrl,
      "GET",
      `/api/admin/track-spending?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      "admin-tok",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.totals.totalStake, 100);
    assert.equal(res.json.data.totals.totalPrize, 40);
    assert.equal(res.json.data.totals.netSpend, 60);
    assert.equal(res.json.data.dataFreshness.staleMs, 30_000);
    assert.equal(res.json.data.dataFreshness.maxAllowedStaleMs, 15 * 60 * 1000);
  } finally {
    await ctx.close();
  }
});

// ── Fail-closed ─────────────────────────────────────────────────────────────

test("BIN-628 route: stale data → 503 STALE_DATA", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    halls: [hall("hall-a", "Alpha")],
    entries: [],
    dataAgeMs: 20 * 60 * 1000, // 20 min > 15 min limit
  });
  try {
    const res = await reqJson(ctx.baseUrl, "GET", "/api/admin/track-spending", "admin-tok");
    assert.equal(res.status, 503, "regulatorisk fail-closed må være 503");
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.code, "TRACK_SPENDING_STALE_DATA");
    assert.equal(res.json.error.staleMs, 20 * 60 * 1000);
    assert.equal(res.json.error.maxAllowedStaleMs, 15 * 60 * 1000);
    // Må være eksplisitt melding, ikke tom data
    assert.ok(typeof res.json.error.message === "string" && res.json.error.message.length > 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: DB-feil på listHalls → 503 DB_ERROR", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    halls: [],
    listHallsError: new Error("db-down"),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "GET", "/api/admin/track-spending", "admin-tok");
    assert.equal(res.status, 503);
    assert.equal(res.json.error.code, "TRACK_SPENDING_DB_ERROR");
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: engine-feil → 503 DB_ERROR", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    halls: [hall("hall-a", "Alpha")],
    ledgerError: new Error("ledger-down"),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "GET", "/api/admin/track-spending", "admin-tok");
    assert.equal(res.status, 503);
    assert.equal(res.json.error.code, "TRACK_SPENDING_DB_ERROR");
  } finally {
    await ctx.close();
  }
});

// ── AuditLog ────────────────────────────────────────────────────────────────

test("BIN-628 route: aggregat-visning logger admin.track_spending.viewed", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    halls: [hall("hall-a", "Alpha")],
    entries: [
      entry({
        id: "s1",
        hallId: "hall-a",
        eventType: "STAKE",
        amount: 100,
        walletId: "w1",
        createdAt: "2026-04-18T10:00:00.000Z",
      }),
    ],
  });
  try {
    const from = "2026-04-18T00:00:00.000Z";
    const to = "2026-04-19T00:00:00.000Z";
    const res = await reqJson(
      ctx.baseUrl,
      "GET",
      `/api/admin/track-spending?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&hallId=hall-a`,
      "admin-tok",
    );
    assert.equal(res.status, 200);
    const event = await waitForAudit(ctx.auditStore, "admin.track_spending.viewed");
    assert.ok(event, "audit-event må være skrevet");
    assert.equal(event!.actorId, "admin-1");
    assert.equal(event!.actorType, "ADMIN");
    assert.equal(event!.resource, "track_spending");
    assert.equal(event!.resourceId, "hall-a");
    assert.equal((event!.details as { hallId: string | null }).hallId, "hall-a");
    assert.equal((event!.details as { from: string }).from, from);
    assert.equal((event!.details as { to: string }).to, to);
    assert.equal((event!.details as { rowCount: number }).rowCount, 1);
    assert.equal((event!.details as { totalUniquePlayers: number }).totalUniquePlayers, 1);
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: stale-data-visning logger IKKE audit (fail-closed)", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    halls: [hall("hall-a", "Alpha")],
    entries: [],
    dataAgeMs: 20 * 60 * 1000,
  });
  try {
    const res = await reqJson(ctx.baseUrl, "GET", "/api/admin/track-spending", "admin-tok");
    assert.equal(res.status, 503);
    // Gi audit en liten sjanse til å skrive (fire-and-forget)
    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    assert.equal(
      events.length,
      0,
      "audit skal ikke logge når responsen er fail-closed — admin så ikke data",
    );
  } finally {
    await ctx.close();
  }
});

// ── Transactions-endepunkt ──────────────────────────────────────────────────

test("BIN-628 route: transactions-endepunkt returnerer filtrerte events", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    halls: [hall("hall-a", "Alpha"), hall("hall-b", "Beta")],
    entries: [
      entry({
        id: "s1",
        hallId: "hall-a",
        eventType: "STAKE",
        amount: 100,
        walletId: "w1",
        playerId: "p1",
        createdAt: "2026-04-18T10:00:00.000Z",
      }),
      entry({
        id: "s2",
        hallId: "hall-b",
        eventType: "STAKE",
        amount: 50,
        walletId: "w2",
        playerId: "p2",
        createdAt: "2026-04-18T11:00:00.000Z",
      }),
    ],
  });
  try {
    const from = "2026-04-18T00:00:00.000Z";
    const to = "2026-04-19T00:00:00.000Z";
    const res = await reqJson(
      ctx.baseUrl,
      "GET",
      `/api/admin/track-spending/transactions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&playerId=p1`,
      "admin-tok",
    );
    assert.equal(res.status, 200);
    const txs = res.json.data.transactions as Array<{ id: string; playerId: string | null }>;
    assert.equal(txs.length, 1);
    assert.equal(txs[0]!.id, "s1");
    assert.equal(txs[0]!.playerId, "p1");

    const audit = await waitForAudit(
      ctx.auditStore,
      "admin.track_spending.transactions_viewed",
    );
    assert.ok(audit);
    assert.equal(audit!.resourceId, "p1");
    assert.equal((audit!.details as { transactionCount: number }).transactionCount, 1);
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: transactions fail-closed ved stale data", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    halls: [hall("hall-a", "Alpha")],
    entries: [],
    dataAgeMs: 16 * 60 * 1000,
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "GET",
      "/api/admin/track-spending/transactions",
      "admin-tok",
    );
    assert.equal(res.status, 503);
    assert.equal(res.json.error.code, "TRACK_SPENDING_STALE_DATA");
  } finally {
    await ctx.close();
  }
});

test("BIN-628 route: transactions krever hallId for HALL_OPERATOR", async () => {
  const ctx = await startServer({
    users: { "op-tok": operatorA },
    halls: [hall("hall-a", "Alpha")],
    entries: [],
  });
  try {
    const noHall = await reqJson(
      ctx.baseUrl,
      "GET",
      "/api/admin/track-spending/transactions",
      "op-tok",
    );
    assert.equal(noHall.status, 400);
    assert.equal(noHall.json.error.code, "INVALID_INPUT");

    const ok = await reqJson(
      ctx.baseUrl,
      "GET",
      "/api/admin/track-spending/transactions?hallId=hall-a",
      "op-tok",
    );
    assert.equal(ok.status, 200);
  } finally {
    await ctx.close();
  }
});
