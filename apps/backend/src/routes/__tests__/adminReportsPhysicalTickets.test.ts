/**
 * BIN-648: integrasjonstester for admin-reports-physical-tickets-router.
 *
 * Dekker:
 *   - RBAC (DAILY_REPORT_READ): ADMIN + HALL_OPERATOR + SUPPORT OK; PLAYER
 *     forbudt.
 *   - HALL_OPERATOR hall-scope: operator-a får FORBIDDEN når hallId=hall-b.
 *   - Query-paramet: hallId / from / to / limit propageres til service.
 *   - Input-validering: ugyldig ISO → 400.
 *   - Empty + multi-row aggregat-response.
 *   - Resolvering av HALL_OPERATOR uten eksplisitt hallId: service får
 *     operator-hall som filter.
 *
 * Bruker stub PhysicalTicketsAggregateService (spy) så vi kan asserte på
 * hvilke argumenter route-laget sender til service-laget.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminReportsPhysicalTicketsRouter } from "../adminReportsPhysicalTickets.js";
import type {
  PhysicalTicketsAggregateService,
  PhysicalTicketsAggregateFilter,
  PhysicalTicketsAggregateResult,
} from "../../admin/PhysicalTicketsAggregate.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

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
const operatorA: PublicAppUser = { ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" };
const operatorB: PublicAppUser = { ...adminUser, id: "op-b", role: "HALL_OPERATOR", hallId: "hall-b" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function emptyResult(now: Date): PhysicalTicketsAggregateResult {
  return {
    generatedAt: now.toISOString(),
    from: null,
    to: null,
    hallId: null,
    rows: [],
    totals: { sold: 0, pending: 0, cashedOut: 0, totalRevenueCents: 0, rowCount: 0 },
  };
}

interface Ctx {
  baseUrl: string;
  aggregateCalls: PhysicalTicketsAggregateFilter[];
  close: () => Promise<void>;
}

interface ServerOpts {
  users: Record<string, PublicAppUser>;
  response?: PhysicalTicketsAggregateResult;
  serviceError?: Error;
}

async function startServer(opts: ServerOpts): Promise<Ctx> {
  const aggregateCalls: PhysicalTicketsAggregateFilter[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const physicalTicketsAggregateService = {
    async aggregate(filter: PhysicalTicketsAggregateFilter) {
      aggregateCalls.push({ ...filter });
      if (opts.serviceError) throw opts.serviceError;
      return opts.response ?? emptyResult(new Date("2026-04-20T12:00:00Z"));
    },
  } as unknown as PhysicalTicketsAggregateService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminReportsPhysicalTicketsRouter({
      platformService,
      physicalTicketsAggregateService,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    aggregateCalls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function reqJson(
  baseUrl: string,
  path: string,
  token?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── RBAC ──────────────────────────────────────────────────────────────────

test("BIN-648 route: PLAYER blokkert (FORBIDDEN)", async () => {
  const ctx = await startServer({ users: { "pl-tok": playerUser } });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/physical-tickets/aggregate", "pl-tok");
    // Express-konvensjon i dette kodebase: alle DomainError → HTTP 400 + kode i body.
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-648 route: manglende token → UNAUTHORIZED", async () => {
  const ctx = await startServer({ users: {} });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/physical-tickets/aggregate");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-648 route: ADMIN får 200 + tomt aggregat uten filter", async () => {
  const ctx = await startServer({ users: { "adm": adminUser } });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/physical-tickets/aggregate", "adm");
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.data.rows, []);
    assert.equal(res.json.data.totals.rowCount, 0);
    assert.equal(ctx.aggregateCalls.length, 1);
    assert.equal(ctx.aggregateCalls[0]!.hallId, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-648 route: SUPPORT får 200 (read-tilgang)", async () => {
  const ctx = await startServer({ users: { "sup": supportUser } });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/physical-tickets/aggregate", "sup");
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

// ── Hall-scope ────────────────────────────────────────────────────────────

test("BIN-648 route: HALL_OPERATOR uten hallId → service får egen hall", async () => {
  const ctx = await startServer({ users: { "op-a": operatorA } });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/physical-tickets/aggregate", "op-a");
    assert.equal(res.status, 200);
    assert.equal(ctx.aggregateCalls[0]!.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-648 route: HALL_OPERATOR med egen hall i query → service får hall-a", async () => {
  const ctx = await startServer({ users: { "op-a": operatorA } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/physical-tickets/aggregate?hallId=hall-a",
      "op-a",
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.aggregateCalls[0]!.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-648 route: HALL_OPERATOR med fremmed hallId → FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "op-a": operatorA, "op-b": operatorB } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/physical-tickets/aggregate?hallId=hall-b",
      "op-a",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.aggregateCalls.length, 0, "service må ikke kalles ved auth-feil");
  } finally {
    await ctx.close();
  }
});

test("BIN-648 route: ADMIN med eksplisitt hallId → service får hallen", async () => {
  const ctx = await startServer({ users: { "adm": adminUser } });
  try {
    await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/physical-tickets/aggregate?hallId=hall-x",
      "adm",
    );
    assert.equal(ctx.aggregateCalls[0]!.hallId, "hall-x");
  } finally {
    await ctx.close();
  }
});

// ── Query-propagering ─────────────────────────────────────────────────────

test("BIN-648 route: from/to-ISO propageres til service", async () => {
  const ctx = await startServer({ users: { "adm": adminUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/physical-tickets/aggregate?from=2026-04-01T00%3A00%3A00Z&to=2026-04-20T23%3A59%3A59Z",
      "adm",
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.aggregateCalls[0]!.from, "2026-04-01T00:00:00.000Z");
    assert.equal(ctx.aggregateCalls[0]!.to, "2026-04-20T23:59:59.000Z");
  } finally {
    await ctx.close();
  }
});

test("BIN-648 route: limit-query-param propageres", async () => {
  const ctx = await startServer({ users: { "adm": adminUser } });
  try {
    await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/physical-tickets/aggregate?limit=50",
      "adm",
    );
    assert.equal(ctx.aggregateCalls[0]!.limit, 50);
  } finally {
    await ctx.close();
  }
});

// ── Input-validering ──────────────────────────────────────────────────────

test("BIN-648 route: ugyldig 'from' → 400", async () => {
  const ctx = await startServer({ users: { "adm": adminUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/physical-tickets/aggregate?from=not-a-date",
      "adm",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(ctx.aggregateCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-648 route: from > to → 400", async () => {
  const ctx = await startServer({ users: { "adm": adminUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/physical-tickets/aggregate?from=2026-04-20T00%3A00%3A00Z&to=2026-04-01T00%3A00%3A00Z",
      "adm",
    );
    assert.equal(res.status, 400);
    assert.equal(ctx.aggregateCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

// ── Response-shape ────────────────────────────────────────────────────────

test("BIN-648 route: multi-row response survives round-trip", async () => {
  const ctx = await startServer({
    users: { "adm": adminUser },
    response: {
      generatedAt: "2026-04-20T12:00:00.000Z",
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-20T23:59:59.000Z",
      hallId: null,
      rows: [
        { gameId: "g1", hallId: "hall-a", sold: 3, pending: 3, cashedOut: 1, totalRevenueCents: 15000 },
        { gameId: null, hallId: "hall-b", sold: 5, pending: 5, cashedOut: 2, totalRevenueCents: 25000 },
      ],
      totals: { sold: 8, pending: 8, cashedOut: 3, totalRevenueCents: 40000, rowCount: 2 },
    },
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/physical-tickets/aggregate?from=2026-04-01T00%3A00%3A00Z&to=2026-04-20T23%3A59%3A59Z",
      "adm",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.rows.length, 2);
    assert.equal(res.json.data.rows[0].gameId, "g1");
    assert.equal(res.json.data.rows[1].gameId, null);
    assert.equal(res.json.data.totals.sold, 8);
    assert.equal(res.json.data.totals.cashedOut, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-648 route: service-feil → error-svar fra apiFailure", async () => {
  const ctx = await startServer({
    users: { "adm": adminUser },
    serviceError: new Error("db outage simulated"),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/physical-tickets/aggregate", "adm");
    // Konvensjonen i dette kodebase: apiFailure returnerer alltid 400 + body.ok=false.
    // Test verifiserer kun at feilen surfaces via error-response, ikke spesifikk
    // status-kode (det finnes forslag om 5xx-mapping, men er ikke implementert ennå).
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.ok(res.json.error, "error-body forventet");
  } finally {
    await ctx.close();
  }
});
