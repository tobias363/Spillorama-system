/**
 * BIN-623: integrasjonstester for admin-close-day-router.
 *
 * Dekker begge endepunkter:
 *   GET  /api/admin/games/:id/close-day-summary
 *   POST /api/admin/games/:id/close-day
 *
 * Testene bygger en stub-CloseDayService rundt et in-memory Map —
 * samme pattern som adminGameManagement.test.ts + adminHallGroups.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminCloseDayRouter } from "../adminCloseDay.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  CloseDayService,
  CloseDayEntry,
  CloseDaySummary,
} from "../../admin/CloseDayService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
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
const operatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    closes: Array<{ gameManagementId: string; closeDate: string; closedBy: string }>;
    summaries: Array<{ gameManagementId: string; closeDate: string }>;
  };
  entries: Map<string, CloseDayEntry>;
  close: () => Promise<void>;
}

function makeSummary(
  gameId: string,
  closeDate: string,
  overrides: Partial<CloseDaySummary> = {}
): CloseDaySummary {
  return {
    gameManagementId: gameId,
    closeDate,
    alreadyClosed: overrides.alreadyClosed ?? false,
    closedAt: overrides.closedAt ?? null,
    closedBy: overrides.closedBy ?? null,
    totalSold: overrides.totalSold ?? 10,
    totalEarning: overrides.totalEarning ?? 10000,
    ticketsSold: overrides.ticketsSold ?? 10,
    winnersCount: overrides.winnersCount ?? 0,
    payoutsTotal: overrides.payoutsTotal ?? 0,
    jackpotsTotal: overrides.jackpotsTotal ?? 0,
    capturedAt: overrides.capturedAt ?? "2026-04-20T12:00:00.000Z",
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seedClosed: CloseDayEntry[] = [],
  knownGames: string[] = ["gm-1", "gm-2"]
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const entries = new Map<string, CloseDayEntry>();
  // Key: `${gameId}::${closeDate}`
  const entriesByKey = new Map<string, CloseDayEntry>();
  for (const e of seedClosed) {
    entries.set(e.id, e);
    entriesByKey.set(`${e.gameManagementId}::${e.closeDate}`, e);
  }

  const closes: Ctx["spies"]["closes"] = [];
  const summaries: Ctx["spies"]["summaries"] = [];
  let idCounter = entries.size;

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const closeDayService = {
    async summary(gameId: string, closeDate: string): Promise<CloseDaySummary> {
      summaries.push({ gameManagementId: gameId, closeDate });
      if (!knownGames.includes(gameId)) {
        throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      }
      const existing = entriesByKey.get(`${gameId}::${closeDate}`);
      if (existing) {
        return makeSummary(gameId, closeDate, {
          alreadyClosed: true,
          closedAt: existing.closedAt,
          closedBy: existing.closedBy,
        });
      }
      return makeSummary(gameId, closeDate);
    },
    async close(input: {
      gameManagementId: string;
      closeDate: string;
      closedBy: string;
    }): Promise<CloseDayEntry> {
      closes.push({ ...input });
      if (!knownGames.includes(input.gameManagementId)) {
        throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      }
      const key = `${input.gameManagementId}::${input.closeDate}`;
      if (entriesByKey.has(key)) {
        throw new DomainError(
          "CLOSE_DAY_ALREADY_CLOSED",
          `Dagen ${input.closeDate} er allerede lukket for dette spillet.`
        );
      }
      idCounter += 1;
      const id = `cd-${idCounter}`;
      const closedAt = "2026-04-20T12:00:00.000Z";
      const summary = makeSummary(input.gameManagementId, input.closeDate, {
        alreadyClosed: true,
        closedAt,
        closedBy: input.closedBy,
      });
      const entry: CloseDayEntry = {
        id,
        gameManagementId: input.gameManagementId,
        closeDate: input.closeDate,
        closedBy: input.closedBy,
        closedAt,
        summary,
      };
      entries.set(id, entry);
      entriesByKey.set(key, entry);
      return entry;
    },
  } as unknown as CloseDayService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminCloseDayRouter({
      platformService,
      auditLogService,
      closeDayService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    spies: { auditStore, closes, summaries },
    entries,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function req(
  ctx: Ctx,
  method: "GET" | "POST",
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
  };
}

// ── GET /api/admin/games/:id/close-day-summary ────────────────────────────

test("BIN-623 router: GET summary uten token → 401", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "GET", "/api/admin/games/gm-1/close-day-summary?closeDate=2026-04-20");
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: GET summary som PLAYER → 403 FORBIDDEN", async () => {
  const ctx = await startServer({ "t-player": playerUser });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/games/gm-1/close-day-summary?closeDate=2026-04-20",
      "t-player"
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: GET summary som ADMIN returnerer live-snapshot", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/games/gm-1/close-day-summary?closeDate=2026-04-20",
      "t-admin"
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.alreadyClosed, false);
    assert.equal(res.body.data.totalSold, 10);
    assert.equal(ctx.spies.summaries.length, 1);
    assert.deepEqual(ctx.spies.summaries[0], {
      gameManagementId: "gm-1",
      closeDate: "2026-04-20",
    });
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: GET summary som HALL_OPERATOR tillatt (GAME_MGMT_READ)", async () => {
  const ctx = await startServer({ "t-op": operatorUser });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/games/gm-1/close-day-summary?closeDate=2026-04-20",
      "t-op"
    );
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: GET summary som SUPPORT tillatt", async () => {
  const ctx = await startServer({ "t-sup": supportUser });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/games/gm-1/close-day-summary?closeDate=2026-04-20",
      "t-sup"
    );
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: GET summary for ukjent game → 404", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/games/gm-missing/close-day-summary?closeDate=2026-04-20",
      "t-admin"
    );
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "GAME_MANAGEMENT_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: GET summary uten closeDate-query bruker dagens dato (UTC)", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/games/gm-1/close-day-summary",
      "t-admin"
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.summaries.length, 1);
    // Default er YYYY-MM-DD i UTC — sjekk format.
    assert.match(ctx.spies.summaries[0]!.closeDate, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: GET summary flagger alreadyClosed=true når dagen allerede er lukket", async () => {
  const seeded: CloseDayEntry = {
    id: "cd-1",
    gameManagementId: "gm-1",
    closeDate: "2026-04-20",
    closedBy: "admin-1",
    closedAt: "2026-04-20T23:00:00.000Z",
    summary: makeSummary("gm-1", "2026-04-20", {
      alreadyClosed: true,
      closedBy: "admin-1",
      closedAt: "2026-04-20T23:00:00.000Z",
    }),
  };
  const ctx = await startServer({ "t-admin": adminUser }, [seeded]);
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/games/gm-1/close-day-summary?closeDate=2026-04-20",
      "t-admin"
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.alreadyClosed, true);
    assert.equal(res.body.data.closedBy, "admin-1");
  } finally {
    await ctx.close();
  }
});

// ── POST /api/admin/games/:id/close-day ───────────────────────────────────

test("BIN-623 router: POST close-day uten token → 401", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", undefined, {
      closeDate: "2026-04-20",
    });
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: POST close-day som SUPPORT → 403 (kun GAME_MGMT_WRITE)", async () => {
  const ctx = await startServer({ "t-sup": supportUser });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/games/gm-1/close-day",
      "t-sup",
      { closeDate: "2026-04-20" }
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: POST close-day som PLAYER → 403", async () => {
  const ctx = await startServer({ "t-pl": playerUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-pl", {
      closeDate: "2026-04-20",
    });
    assert.equal(res.status, 403);
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: POST close-day som ADMIN lykkes og skriver audit-log", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      closeDate: "2026-04-20",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.closeDate, "2026-04-20");
    assert.equal(res.body.data.closedBy, "admin-1");
    assert.equal(res.body.data.gameManagementId, "gm-1");

    // Audit-log er fire-and-forget — gi microtask-tid for å flushes.
    await new Promise((r) => setImmediate(r));
    const events: PersistedAuditEvent[] = await ctx.spies.auditStore.list();
    assert.equal(events.length, 1);
    const ev = events[0]!;
    assert.equal(ev.action, "admin.game.close-day");
    assert.equal(ev.resource, "game_management");
    assert.equal(ev.resourceId, "gm-1");
    assert.equal(ev.actorId, "admin-1");
    assert.equal(ev.actorType, "ADMIN");
    const details = ev.details as Record<string, unknown>;
    assert.equal(details.closeDate, "2026-04-20");
    assert.ok(details.closeDayLogId, "closeDayLogId i audit-details");
    assert.ok(details.summary, "summary-snapshot i audit-details");
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: POST close-day som HALL_OPERATOR lykkes (GAME_MGMT_WRITE)", async () => {
  const ctx = await startServer({ "t-op": operatorUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-op", {
      closeDate: "2026-04-20",
    });
    assert.equal(res.status, 200);
    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.actorType, "HALL_OPERATOR");
    assert.equal(events[0]!.actorId, "op-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: POST close-day på allerede-lukket dag → 409 CLOSE_DAY_ALREADY_CLOSED", async () => {
  const seeded: CloseDayEntry = {
    id: "cd-1",
    gameManagementId: "gm-1",
    closeDate: "2026-04-20",
    closedBy: "admin-1",
    closedAt: "2026-04-20T23:00:00.000Z",
    summary: makeSummary("gm-1", "2026-04-20", { alreadyClosed: true }),
  };
  const ctx = await startServer({ "t-admin": adminUser }, [seeded]);
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      closeDate: "2026-04-20",
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "CLOSE_DAY_ALREADY_CLOSED");

    // Ingen audit-log på konflikten — vi logger kun vellykket lukking.
    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    assert.equal(events.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: POST close-day for ukjent spill → 404", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-missing/close-day", "t-admin", {
      closeDate: "2026-04-20",
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "GAME_MANAGEMENT_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: POST close-day uten closeDate-body bruker dagens dato", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {});
    assert.equal(res.status, 200);
    assert.match(res.body.data.closeDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(ctx.spies.closes.length, 1);
    assert.match(ctx.spies.closes[0]!.closeDate, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    await ctx.close();
  }
});

test("BIN-623 router: POST close-day med tom body (null) håndteres", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    // Send faktisk en tom body-request — default body parsing gir {}.
    const res = await fetch(`${ctx.baseUrl}/api/admin/games/gm-1/close-day`, {
      method: "POST",
      headers: { authorization: "Bearer t-admin" },
    });
    assert.equal(res.status, 200, `got ${res.status}: ${await res.text()}`);
  } finally {
    await ctx.close();
  }
});
