/**
 * BIN-638: integrasjonstester for admin-physical-tickets-games-in-hall-router.
 *
 * Dekker:
 *   - RBAC (DAILY_REPORT_READ): ADMIN + SUPPORT + HALL_OPERATOR OK; PLAYER
 *     forbudt; manglende token → UNAUTHORIZED.
 *   - hallId er påkrevd → 400 hvis mangler.
 *   - HALL_OPERATOR hall-scope: fremmed hallId → FORBIDDEN, service aldri
 *     kalt.
 *   - Query-param propagering (hallId / from / to / limit) til service.
 *   - Input-validering: ugyldig ISO + from > to → 400.
 *   - Multi-row response survives round-trip.
 *   - Service-feil surfaces via apiFailure.
 *
 * Bruker stub PhysicalTicketsGamesInHallService (spy) så vi kan asserte på
 * argumentene route-laget sender til service-laget.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPhysicalTicketsGamesInHallRouter } from "../adminPhysicalTicketsGamesInHall.js";
import type {
  PhysicalTicketsGamesInHallService,
  GamesInHallFilter,
  GamesInHallResult,
} from "../../admin/PhysicalTicketsGamesInHall.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

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

function emptyResult(hallId: string, now: Date): GamesInHallResult {
  return {
    generatedAt: now.toISOString(),
    hallId,
    from: null,
    to: null,
    rows: [],
    totals: {
      sold: 0,
      pendingCashoutCount: 0,
      ticketsInPlay: 0,
      cashedOut: 0,
      totalRevenueCents: 0,
      rowCount: 0,
    },
  };
}

interface Ctx {
  baseUrl: string;
  calls: GamesInHallFilter[];
  close: () => Promise<void>;
}

interface ServerOpts {
  users: Record<string, PublicAppUser>;
  response?: GamesInHallResult;
  serviceError?: Error;
}

async function startServer(opts: ServerOpts): Promise<Ctx> {
  const calls: GamesInHallFilter[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const physicalTicketsGamesInHallService = {
    async gamesInHall(filter: GamesInHallFilter): Promise<GamesInHallResult> {
      calls.push({ ...filter });
      if (opts.serviceError) throw opts.serviceError;
      return (
        opts.response ?? emptyResult(filter.hallId, new Date("2026-04-20T12:00:00Z"))
      );
    },
  } as unknown as PhysicalTicketsGamesInHallService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminPhysicalTicketsGamesInHallRouter({
      platformService,
      physicalTicketsGamesInHallService,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
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

test("BIN-638 route: PLAYER blokkert (FORBIDDEN)", async () => {
  const ctx = await startServer({ users: { "pl-tok": playerUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a",
      "pl-tok",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.calls.length, 0, "service må ikke kalles ved auth-feil");
  } finally {
    await ctx.close();
  }
});

test("BIN-638 route: manglende token → UNAUTHORIZED", async () => {
  const ctx = await startServer({ users: {} });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-638 route: ADMIN får 200 + tomt aggregat", async () => {
  const ctx = await startServer({ users: { adm: adminUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a",
      "adm",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.hallId, "hall-a");
    assert.deepEqual(res.json.data.rows, []);
    assert.equal(res.json.data.totals.rowCount, 0);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0]!.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-638 route: SUPPORT får 200 (read-tilgang)", async () => {
  const ctx = await startServer({ users: { sup: supportUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a",
      "sup",
    );
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

// ── hallId-påkrevd ────────────────────────────────────────────────────────

test("BIN-638 route: manglende hallId → 400 INVALID_INPUT", async () => {
  const ctx = await startServer({ users: { adm: adminUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall",
      "adm",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(ctx.calls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-638 route: tom hallId-streng → 400", async () => {
  const ctx = await startServer({ users: { adm: adminUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=",
      "adm",
    );
    assert.equal(res.status, 400);
    assert.equal(ctx.calls.length, 0);
  } finally {
    await ctx.close();
  }
});

// ── Hall-scope ────────────────────────────────────────────────────────────

test("BIN-638 route: HALL_OPERATOR med egen hall → OK", async () => {
  const ctx = await startServer({ users: { "op-a": operatorA } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a",
      "op-a",
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.calls[0]!.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-638 route: HALL_OPERATOR med fremmed hallId → FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "op-a": operatorA, "op-b": operatorB } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-b",
      "op-a",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.calls.length, 0, "service må ikke kalles ved auth-feil");
  } finally {
    await ctx.close();
  }
});

test("BIN-638 route: ADMIN med eksplisitt hallId → service får hallen", async () => {
  const ctx = await startServer({ users: { adm: adminUser } });
  try {
    await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-x",
      "adm",
    );
    assert.equal(ctx.calls[0]!.hallId, "hall-x");
  } finally {
    await ctx.close();
  }
});

// ── Query-propagering ─────────────────────────────────────────────────────

test("BIN-638 route: from/to-ISO propageres til service", async () => {
  const ctx = await startServer({ users: { adm: adminUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a&from=2026-04-01T00%3A00%3A00Z&to=2026-04-20T23%3A59%3A59Z",
      "adm",
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.calls[0]!.from, "2026-04-01T00:00:00.000Z");
    assert.equal(ctx.calls[0]!.to, "2026-04-20T23:59:59.000Z");
  } finally {
    await ctx.close();
  }
});

test("BIN-638 route: limit-query-param propageres", async () => {
  const ctx = await startServer({ users: { adm: adminUser } });
  try {
    await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a&limit=50",
      "adm",
    );
    assert.equal(ctx.calls[0]!.limit, 50);
  } finally {
    await ctx.close();
  }
});

// ── Input-validering ──────────────────────────────────────────────────────

test("BIN-638 route: ugyldig 'from' → 400", async () => {
  const ctx = await startServer({ users: { adm: adminUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a&from=not-a-date",
      "adm",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(ctx.calls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-638 route: from > to → 400", async () => {
  const ctx = await startServer({ users: { adm: adminUser } });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a&from=2026-04-20T00%3A00%3A00Z&to=2026-04-01T00%3A00%3A00Z",
      "adm",
    );
    assert.equal(res.status, 400);
    assert.equal(ctx.calls.length, 0);
  } finally {
    await ctx.close();
  }
});

// ── Response-shape ────────────────────────────────────────────────────────

test("BIN-638 route: multi-row response survives round-trip", async () => {
  const ctx = await startServer({
    users: { adm: adminUser },
    response: {
      generatedAt: "2026-04-20T12:00:00.000Z",
      hallId: "hall-a",
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-20T23:59:59.000Z",
      rows: [
        {
          gameId: "g1",
          name: "Kvelds-game",
          status: "ACTIVE",
          sold: 6,
          pendingCashoutCount: 5,
          ticketsInPlay: 5,
          cashedOut: 1,
          totalRevenueCents: 30000,
        },
        {
          gameId: null,
          name: null,
          status: null,
          sold: 3,
          pendingCashoutCount: 0,
          ticketsInPlay: 0,
          cashedOut: 3,
          totalRevenueCents: 15000,
        },
      ],
      totals: {
        sold: 9,
        pendingCashoutCount: 5,
        ticketsInPlay: 5,
        cashedOut: 4,
        totalRevenueCents: 45000,
        rowCount: 2,
      },
    },
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a&from=2026-04-01T00%3A00%3A00Z&to=2026-04-20T23%3A59%3A59Z",
      "adm",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallId, "hall-a");
    assert.equal(res.json.data.rows.length, 2);
    assert.equal(res.json.data.rows[0].gameId, "g1");
    assert.equal(res.json.data.rows[0].name, "Kvelds-game");
    assert.equal(res.json.data.rows[0].status, "ACTIVE");
    assert.equal(res.json.data.rows[0].ticketsInPlay, 5);
    assert.equal(res.json.data.rows[0].pendingCashoutCount, 5);
    assert.equal(res.json.data.rows[1].gameId, null);
    assert.equal(res.json.data.totals.sold, 9);
    assert.equal(res.json.data.totals.cashedOut, 4);
  } finally {
    await ctx.close();
  }
});

test("BIN-638 route: service-feil → error-svar fra apiFailure", async () => {
  const ctx = await startServer({
    users: { adm: adminUser },
    serviceError: new Error("db outage simulated"),
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/physical-tickets/games/in-hall?hallId=hall-a",
      "adm",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.ok(res.json.error, "error-body forventet");
  } finally {
    await ctx.close();
  }
});
