/**
 * K1-A RBAC follow-up: tester for hall-scope-guard på jackpot-admin-GET-
 * endpoints i adminGame1Master-router.
 *
 * Dekker:
 *  - GET /jackpot-state/:hallGroupId — HALL_OPERATOR i medlemshall → 200
 *  - GET /jackpot-state/:hallGroupId — HALL_OPERATOR ikke-medlem → 400
 *    med code="FORBIDDEN_HALL_SCOPE"
 *  - GET /jackpot-state/:hallGroupId — HALL_OPERATOR uten hallId → 400
 *    FORBIDDEN_HALL_SCOPE (fail-closed)
 *  - GET /jackpot-state/:hallGroupId — ADMIN → 200 uten medlemskap
 *  - GET /jackpot-state/:hallGroupId — SUPPORT → 200 uten medlemskap
 *  - GET /jackpot-state/:hallGroupId — AGENT i medlemshall → 200
 *  - GET /:gameId — HALL_OPERATOR ikke-medlem → 200 men jackpot=null
 *    (soft-fail bevarer øvrig payload)
 *  - GET /:gameId — HALL_OPERATOR i medlemshall → 200 med jackpot
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Pool, QueryResult } from "pg";
import { createAdminGame1MasterRouter } from "../adminGame1Master.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type { Game1MasterControlService } from "../../game/Game1MasterControlService.js";
import { Game1JackpotStateService } from "../../game/Game1JackpotStateService.js";
import { DomainError } from "../../game/BingoEngine.js";

// ─── Test users ──────────────────────────────────────────────────────────────

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
const operatorAtHallA: PublicAppUser = {
  ...adminUser,
  id: "op-A",
  role: "HALL_OPERATOR",
  hallId: "hall-A",
};
const operatorAtHallB: PublicAppUser = {
  ...adminUser,
  id: "op-B",
  role: "HALL_OPERATOR",
  hallId: "hall-B",
};
const operatorNoHall: PublicAppUser = {
  ...adminUser,
  id: "op-x",
  role: "HALL_OPERATOR",
  hallId: null,
};
const agentAtHallA: PublicAppUser = {
  ...adminUser,
  id: "ag-A",
  role: "AGENT",
  hallId: "hall-A",
};

// ─── Pool mock matching the pattern from Game1JackpotStateService.test.ts ────

interface QueryCall {
  text: string;
  params: unknown[];
}

interface PoolMockOptions {
  responses?: QueryResult<Record<string, unknown>>[];
}

function makePoolMock(opts: PoolMockOptions = {}): {
  pool: Pool;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  let idx = 0;
  const pool = {
    query: async (
      text: string,
      params: unknown[] = []
    ): Promise<QueryResult<Record<string, unknown>>> => {
      calls.push({ text, params });
      const response = opts.responses?.[idx];
      idx += 1;
      return (
        response ?? ({ rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>)
      );
    },
  } as unknown as Pool;
  return { pool, calls };
}

/**
 * Build a list of pool responses for the routes under test.
 *
 * For HALL_OPERATOR / AGENT we expect two queries to land on the pool:
 *   1) isHallInGroup → SELECT EXISTS(...) — answered with `{exists}`
 *   2) getStateForGroup → SELECT ... — answered with the state row
 *
 * For ADMIN / SUPPORT the scope-helper short-circuits, so only
 * getStateForGroup hits the pool. Pass `skipMembership=true` so the
 * state-row lands at response[0].
 */
function buildJackpotResponses(opts: {
  isHallInGroup: boolean;
  skipMembership?: boolean;
  state?: {
    hallGroupId: string;
    currentAmountCents: number;
  };
}): QueryResult<Record<string, unknown>>[] {
  const isHallInGroupResponse = {
    rows: [{ exists: opts.isHallInGroup }],
    rowCount: 1,
  } as unknown as QueryResult<Record<string, unknown>>;
  const stateResponse = {
    rows: [
      {
        hall_group_id: opts.state?.hallGroupId ?? "grp-1",
        current_amount_cents: String(opts.state?.currentAmountCents ?? 200_000),
        last_accumulation_date: "2026-04-26",
        max_cap_cents: "3000000",
        daily_increment_cents: "400000",
        draw_thresholds_json: [50, 55, 56, 57],
        updated_at: new Date("2026-04-26T10:00:00Z"),
      },
    ],
    rowCount: 1,
  } as unknown as QueryResult<Record<string, unknown>>;
  return opts.skipMembership
    ? [stateResponse]
    : [isHallInGroupResponse, stateResponse];
}

// ─── Default game-detail fixture ─────────────────────────────────────────────

const defaultDetail: Awaited<ReturnType<Game1MasterControlService["getGameDetail"]>> = {
  game: {
    id: "g1",
    status: "ready_to_start",
    scheduledStartTime: "2026-04-26T10:00:00.000Z",
    scheduledEndTime: "2026-04-26T11:00:00.000Z",
    actualStartTime: null,
    actualEndTime: null,
    masterHallId: "hall-A",
    groupHallId: "grp-1",
    participatingHallIds: ["hall-A", "hall-B"],
    subGameName: "Jackpot",
    customGameName: null,
    startedByUserId: null,
    stoppedByUserId: null,
    stopReason: null,
  },
  halls: [
    {
      hallId: "hall-A",
      isReady: true,
      readyAt: "2026-04-26T09:55:00.000Z",
      readyByUserId: "u-A",
      digitalTicketsSold: 10,
      physicalTicketsSold: 5,
      excludedFromGame: false,
      excludedReason: null,
    },
  ],
  auditRecent: [],
};

// ─── Test server ─────────────────────────────────────────────────────────────

interface Ctx {
  baseUrl: string;
  poolCalls: QueryCall[];
  close: () => Promise<void>;
}

interface StartOpts {
  users: Record<string, PublicAppUser>;
  poolResponses: QueryResult<Record<string, unknown>>[];
}

async function startServer(opts: StartOpts): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getHall(hallId: string) {
      return { id: hallId, name: hallId, isActive: true } as unknown as Awaited<
        ReturnType<PlatformService["getHall"]>
      >;
    },
  } as unknown as PlatformService;

  const masterControlService = {
    async getGameDetail(_gameId: string) {
      return defaultDetail;
    },
  } as unknown as Game1MasterControlService;

  const { pool, calls } = makePoolMock({ responses: opts.poolResponses });
  const jackpotStateService = new Game1JackpotStateService({ pool });

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGame1MasterRouter({
      platformService,
      auditLogService,
      masterControlService,
      jackpotStateService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    poolCalls: calls,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function getJson(
  ctx: Ctx,
  path: string,
  token: string
): Promise<{ status: number; body: { ok: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: res.status,
    body: (await res.json()) as { ok: boolean; data?: unknown; error?: { code: string; message: string } },
  };
}

// ─── GET /jackpot-state/:hallGroupId tests ──────────────────────────────────

test("GET /jackpot-state/:hallGroupId — HALL_OPERATOR (medlem) → 200 + jackpot", async () => {
  const ctx = await startServer({
    users: { "t-op-a": operatorAtHallA },
    poolResponses: buildJackpotResponses({
      isHallInGroup: true,
      state: { hallGroupId: "grp-1", currentAmountCents: 600_000 },
    }),
  });
  try {
    const { status, body } = await getJson(
      ctx,
      "/api/admin/game1/jackpot-state/grp-1",
      "t-op-a"
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const data = body.data as {
      jackpot: { hallGroupId: string; currentAmountCents: number } | null;
    };
    assert.ok(data.jackpot, "jackpot skal være satt");
    assert.equal(data.jackpot!.hallGroupId, "grp-1");
    assert.equal(data.jackpot!.currentAmountCents, 600_000);
    // Verifiser at pool fikk isHallInGroup-call før getStateForGroup-call.
    const memberQuery = ctx.poolCalls.find((c) =>
      c.text.includes("app_hall_group_members")
    );
    assert.ok(memberQuery, "isHallInGroup-call skal være sendt");
    assert.deepEqual(memberQuery!.params, ["grp-1", "hall-A"]);
  } finally {
    await ctx.close();
  }
});

test("GET /jackpot-state/:hallGroupId — HALL_OPERATOR (ikke-medlem) → 400 FORBIDDEN_HALL_SCOPE", async () => {
  const ctx = await startServer({
    users: { "t-op-b": operatorAtHallB },
    poolResponses: buildJackpotResponses({ isHallInGroup: false }),
  });
  try {
    const { status, body } = await getJson(
      ctx,
      "/api/admin/game1/jackpot-state/grp-1",
      "t-op-b"
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, "FORBIDDEN_HALL_SCOPE");
    assert.equal(body.error?.message, "Du har ikke tilgang til denne hallen.");
  } finally {
    await ctx.close();
  }
});

test("GET /jackpot-state/:hallGroupId — HALL_OPERATOR uten hallId → 400 FORBIDDEN_HALL_SCOPE", async () => {
  const ctx = await startServer({
    users: { "t-op-x": operatorNoHall },
    // No pool responses needed — we should fail before isHallInGroup is called.
    poolResponses: [],
  });
  try {
    const { status, body } = await getJson(
      ctx,
      "/api/admin/game1/jackpot-state/grp-1",
      "t-op-x"
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, "FORBIDDEN_HALL_SCOPE");
    // Pool skal IKKE ha fått en isHallInGroup-call (fail-fast på null hallId).
    const memberQuery = ctx.poolCalls.find((c) =>
      c.text.includes("app_hall_group_members")
    );
    assert.equal(memberQuery, undefined);
  } finally {
    await ctx.close();
  }
});

test("GET /jackpot-state/:hallGroupId — ADMIN → 200 uavhengig av hall-medlemskap", async () => {
  const ctx = await startServer({
    users: { "t-admin": adminUser },
    poolResponses: buildJackpotResponses({
      // ADMIN bypasser scope-sjekken, så pool får kun getStateForGroup.
      skipMembership: true,
      isHallInGroup: false,
      state: { hallGroupId: "grp-1", currentAmountCents: 200_000 },
    }),
  });
  try {
    const { status, body } = await getJson(
      ctx,
      "/api/admin/game1/jackpot-state/grp-1",
      "t-admin"
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const data = body.data as { jackpot: { hallGroupId: string } | null };
    assert.ok(data.jackpot);
    assert.equal(data.jackpot!.hallGroupId, "grp-1");
    // ADMIN må ikke trigge isHallInGroup-query.
    const memberQuery = ctx.poolCalls.find((c) =>
      c.text.includes("app_hall_group_members")
    );
    assert.equal(memberQuery, undefined, "ADMIN skal ikke bli scope-sjekket");
  } finally {
    await ctx.close();
  }
});

test("GET /jackpot-state/:hallGroupId — SUPPORT → 200 uavhengig av hall-medlemskap", async () => {
  const ctx = await startServer({
    users: { "t-sup": supportUser },
    poolResponses: buildJackpotResponses({
      // SUPPORT bypasser scope-sjekken, så pool får kun getStateForGroup.
      skipMembership: true,
      isHallInGroup: false,
      state: { hallGroupId: "grp-1", currentAmountCents: 200_000 },
    }),
  });
  try {
    const { status, body } = await getJson(
      ctx,
      "/api/admin/game1/jackpot-state/grp-1",
      "t-sup"
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const memberQuery = ctx.poolCalls.find((c) =>
      c.text.includes("app_hall_group_members")
    );
    assert.equal(memberQuery, undefined, "SUPPORT skal ikke bli scope-sjekket");
  } finally {
    await ctx.close();
  }
});

test("GET /jackpot-state/:hallGroupId — AGENT (medlem) → 200", async () => {
  const ctx = await startServer({
    users: { "t-ag": agentAtHallA },
    poolResponses: buildJackpotResponses({
      isHallInGroup: true,
      state: { hallGroupId: "grp-1", currentAmountCents: 200_000 },
    }),
  });
  try {
    const { status, body } = await getJson(
      ctx,
      "/api/admin/game1/jackpot-state/grp-1",
      "t-ag"
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  } finally {
    await ctx.close();
  }
});

// ─── GET /:gameId inline-jackpot soft-fail tests ────────────────────────────

test("GET /:gameId — HALL_OPERATOR (ikke-medlem) → 200 men jackpot=null (soft-fail)", async () => {
  const ctx = await startServer({
    users: { "t-op-b": operatorAtHallB },
    poolResponses: buildJackpotResponses({ isHallInGroup: false }),
  });
  try {
    const { status, body } = await getJson(
      ctx,
      "/api/admin/game1/games/g1",
      "t-op-b"
    );
    // Hele detail-payloaden skal serveres, men jackpot er null.
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const data = body.data as {
      game: unknown;
      jackpot: unknown;
    };
    assert.ok(data.game, "game-detail skal serveres");
    assert.equal(data.jackpot, null, "jackpot skal være null ved scope-brudd");
  } finally {
    await ctx.close();
  }
});

test("GET /:gameId — HALL_OPERATOR (medlem) → 200 med jackpot fylt", async () => {
  const ctx = await startServer({
    users: { "t-op-a": operatorAtHallA },
    poolResponses: buildJackpotResponses({
      isHallInGroup: true,
      state: { hallGroupId: "grp-1", currentAmountCents: 1_200_000 },
    }),
  });
  try {
    const { status, body } = await getJson(
      ctx,
      "/api/admin/game1/games/g1",
      "t-op-a"
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const data = body.data as {
      jackpot: { currentAmountCents: number } | null;
    };
    assert.ok(data.jackpot, "jackpot skal være satt for medlem");
    assert.equal(data.jackpot!.currentAmountCents, 1_200_000);
  } finally {
    await ctx.close();
  }
});
