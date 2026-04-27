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
  CloseManyInput,
  CloseManyResult,
  CloseRecurringResult,
  RecurringPatternEntry,
  UpdateDateInput,
  DeleteDateInput,
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
    closeManys: CloseManyInput[];
    updates: UpdateDateInput[];
    deletes: DeleteDateInput[];
    lists: string[];
    /** REQ-116: spies for nye recurring-endepunkt. */
    recurringDeletes: Array<{ gameManagementId: string; patternId: string; deletedBy: string }>;
    recurringLists: string[];
  };
  entries: Map<string, CloseDayEntry>;
  patterns: Map<string, RecurringPatternEntry>;
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
  const closeManys: Ctx["spies"]["closeManys"] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const deletes: Ctx["spies"]["deletes"] = [];
  const lists: Ctx["spies"]["lists"] = [];
  const recurringDeletes: Ctx["spies"]["recurringDeletes"] = [];
  const recurringLists: Ctx["spies"]["recurringLists"] = [];
  /** REQ-116: in-memory recurring-pattern-store. */
  const patterns = new Map<string, RecurringPatternEntry>();
  let idCounter = entries.size;
  let patternCounter = 0;

  function makeEntry(
    gameId: string,
    closeDate: string,
    closedBy: string,
    startTime: string | null,
    endTime: string | null,
    notes: string | null
  ): CloseDayEntry {
    idCounter += 1;
    const id = `cd-${idCounter}`;
    const closedAt = "2026-04-20T12:00:00.000Z";
    const summary = makeSummary(gameId, closeDate, {
      alreadyClosed: true,
      closedAt,
      closedBy,
    });
    const entry: CloseDayEntry = {
      id,
      gameManagementId: gameId,
      closeDate,
      closedBy,
      closedAt,
      startTime,
      endTime,
      notes,
      recurringPatternId: null,
      summary,
    };
    entries.set(id, entry);
    entriesByKey.set(`${gameId}::${closeDate}`, entry);
    return entry;
  }

  function planConsecutive(
    startDate: string,
    endDate: string,
    startTime: string,
    endTime: string
  ): Array<{ closeDate: string; startTime: string; endTime: string }> {
    const startMs = Date.parse(`${startDate}T00:00:00Z`);
    const endMs = Date.parse(`${endDate}T00:00:00Z`);
    const dayMs = 86400000;
    const dates: string[] = [];
    for (let t = startMs; t <= endMs; t += dayMs) {
      const d = new Date(t);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      dates.push(`${y}-${m}-${day}`);
    }
    return dates.map((date, i) => {
      if (dates.length === 1) return { closeDate: date, startTime, endTime };
      if (i === 0) return { closeDate: date, startTime, endTime: "23:59" };
      if (i === dates.length - 1)
        return { closeDate: date, startTime: "00:00", endTime };
      return { closeDate: date, startTime: "00:00", endTime: "23:59" };
    });
  }

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
      startTime?: string | null;
      endTime?: string | null;
      notes?: string | null;
    }): Promise<CloseDayEntry> {
      closes.push({
        gameManagementId: input.gameManagementId,
        closeDate: input.closeDate,
        closedBy: input.closedBy,
      });
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
      return makeEntry(
        input.gameManagementId,
        input.closeDate,
        input.closedBy,
        input.startTime ?? null,
        input.endTime ?? null,
        input.notes ?? null
      );
    },
    async closeMany(
      input: CloseManyInput
    ): Promise<CloseManyResult | CloseRecurringResult> {
      closeManys.push(input);
      if (!knownGames.includes(input.gameManagementId)) {
        throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      }
      type Plan = { closeDate: string; startTime: string | null; endTime: string | null };
      let plan: Plan[] = [];
      const notes = (input as { notes?: string | null }).notes ?? null;
      let recurringPatternId: string | null = null;
      let recurringPattern: RecurringPatternEntry | null = null;

      switch (input.mode) {
        case "single":
          plan = [
            {
              closeDate: input.closeDate,
              startTime: input.startTime ?? null,
              endTime: input.endTime ?? null,
            },
          ];
          break;
        case "consecutive":
          plan = planConsecutive(
            input.startDate,
            input.endDate,
            input.startTime,
            input.endTime
          );
          break;
        case "random": {
          const defaultStart = input.startTime ?? null;
          const defaultEnd = input.endTime ?? null;
          plan = input.closeDates.map((cd) => {
            if (typeof cd === "string") {
              return {
                closeDate: cd,
                startTime: defaultStart,
                endTime: defaultEnd,
              };
            }
            return {
              closeDate: cd.closeDate,
              startTime: cd.startTime ?? defaultStart,
              endTime: cd.endTime ?? defaultEnd,
            };
          });
          plan.sort((a, b) => a.closeDate.localeCompare(b.closeDate));
          break;
        }
        case "recurring": {
          // REQ-116: forenklet expansion-stub for router-tests. Vi
          // verifiserer kun at router-laget bygger riktig CloseManyInput
          // og kaller service-laget; ekte expansion testes i CloseDayService.test.ts.
          patternCounter += 1;
          recurringPatternId = `pat-${patternCounter}`;
          const startDate = input.startDate ?? "2026-04-25";
          const endDate = input.endDate ?? "2026-04-30";
          recurringPattern = {
            id: recurringPatternId,
            gameManagementId: input.gameManagementId,
            pattern: input.pattern,
            startDate,
            endDate,
            maxOccurrences: input.maxOccurrences ?? 365,
            startTime: input.startTime ?? null,
            endTime: input.endTime ?? null,
            notes: input.notes ?? null,
            createdBy: input.closedBy,
            createdAt: "2026-04-25T08:00:00.000Z",
            deletedAt: null,
            deletedBy: null,
          };
          patterns.set(recurringPatternId, recurringPattern);
          // I stuben bygger vi 1 expansion-dato (startDate) — det holder
          // for router-roundtrip-tester. Ekte expansion testes i service-tester.
          plan = [
            {
              closeDate: startDate,
              startTime: input.startTime ?? null,
              endTime: input.endTime ?? null,
            },
          ];
          break;
        }
      }
      const baseResult: CloseManyResult = {
        entries: [],
        createdDates: [],
        skippedDates: [],
      };
      for (const item of plan) {
        const key = `${input.gameManagementId}::${item.closeDate}`;
        const existing = entriesByKey.get(key);
        if (existing) {
          baseResult.entries.push(existing);
          baseResult.skippedDates.push(item.closeDate);
          continue;
        }
        const e = makeEntry(
          input.gameManagementId,
          item.closeDate,
          input.closedBy,
          item.startTime,
          item.endTime,
          notes
        );
        // REQ-116: stamp pattern-id på child-entry hvis recurring
        if (recurringPatternId) {
          e.recurringPatternId = recurringPatternId;
        }
        baseResult.entries.push(e);
        baseResult.createdDates.push(item.closeDate);
      }
      if (recurringPattern) {
        const recResult: CloseRecurringResult = {
          ...baseResult,
          pattern: recurringPattern,
          expandedCount: plan.length,
        };
        return recResult;
      }
      return baseResult;
    },
    async listRecurringPatterns(gameId: string): Promise<RecurringPatternEntry[]> {
      recurringLists.push(gameId);
      const out: RecurringPatternEntry[] = [];
      for (const p of patterns.values()) {
        if (p.gameManagementId === gameId && p.deletedAt === null) {
          out.push(p);
        }
      }
      return out;
    },
    async deleteRecurringPattern(input: {
      gameManagementId: string;
      patternId: string;
      deletedBy: string;
    }): Promise<{ pattern: RecurringPatternEntry; deletedChildCount: number }> {
      recurringDeletes.push(input);
      const target = patterns.get(input.patternId);
      if (!target || target.gameManagementId !== input.gameManagementId) {
        throw new DomainError(
          "CLOSE_DAY_RECURRING_NOT_FOUND",
          "not found"
        );
      }
      if (target.deletedAt === null) {
        target.deletedAt = "2026-04-26T08:00:00.000Z";
        target.deletedBy = input.deletedBy;
      }
      // Hard-slett child-rader
      let deletedChildCount = 0;
      for (const e of [...entries.values()]) {
        if (
          e.gameManagementId === input.gameManagementId &&
          e.recurringPatternId === input.patternId
        ) {
          entries.delete(e.id);
          entriesByKey.delete(`${e.gameManagementId}::${e.closeDate}`);
          deletedChildCount += 1;
        }
      }
      return { pattern: target, deletedChildCount };
    },
    async updateDate(input: UpdateDateInput): Promise<CloseDayEntry> {
      updates.push(input);
      if (!knownGames.includes(input.gameManagementId)) {
        throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      }
      const key = `${input.gameManagementId}::${input.closeDate}`;
      const existing = entriesByKey.get(key);
      if (!existing) {
        throw new DomainError("CLOSE_DAY_NOT_FOUND", "not found");
      }
      const updated: CloseDayEntry = {
        ...existing,
        startTime:
          input.startTime !== undefined ? input.startTime : existing.startTime,
        endTime: input.endTime !== undefined ? input.endTime : existing.endTime,
        notes: input.notes !== undefined ? input.notes : existing.notes,
      };
      entries.set(updated.id, updated);
      entriesByKey.set(key, updated);
      return updated;
    },
    async deleteDate(input: DeleteDateInput): Promise<CloseDayEntry> {
      deletes.push(input);
      if (!knownGames.includes(input.gameManagementId)) {
        throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      }
      const key = `${input.gameManagementId}::${input.closeDate}`;
      const existing = entriesByKey.get(key);
      if (!existing) {
        throw new DomainError("CLOSE_DAY_NOT_FOUND", "not found");
      }
      entries.delete(existing.id);
      entriesByKey.delete(key);
      return existing;
    },
    async listForGame(gameId: string): Promise<CloseDayEntry[]> {
      lists.push(gameId);
      if (!knownGames.includes(gameId)) return [];
      const out: CloseDayEntry[] = [];
      for (const e of entries.values()) {
        if (e.gameManagementId === gameId) out.push(e);
      }
      out.sort((a, b) => a.closeDate.localeCompare(b.closeDate));
      return out;
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
    spies: {
      auditStore,
      closes,
      summaries,
      closeManys,
      updates,
      deletes,
      lists,
      recurringDeletes,
      recurringLists,
    },
    entries,
    patterns,
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
    startTime: null,
    endTime: null,
    notes: null,
    recurringPatternId: null,
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
    startTime: null,
    endTime: null,
    notes: null,
    recurringPatternId: null,
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

// ── BIN-700: POST close-day mode=consecutive | mode=random ───────────────

test("BIN-700 router: POST consecutive lukker date-range med legacy-tids-vinduer", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "consecutive",
      startDate: "2026-12-23",
      endDate: "2026-12-25",
      startTime: "18:00",
      endTime: "10:00",
      notes: "Jul",
    });
    assert.equal(res.status, 200, `got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.mode, "consecutive");
    assert.equal(res.body.data.entries.length, 3);
    assert.deepEqual(res.body.data.createdDates, [
      "2026-12-23",
      "2026-12-24",
      "2026-12-25",
    ]);
    assert.deepEqual(res.body.data.skippedDates, []);
    // Verifiser tids-vinduer per legacy:10166-10186
    const e23 = res.body.data.entries[0];
    const e24 = res.body.data.entries[1];
    const e25 = res.body.data.entries[2];
    assert.equal(e23.startTime, "18:00");
    assert.equal(e23.endTime, "23:59");
    assert.equal(e24.startTime, "00:00");
    assert.equal(e24.endTime, "23:59");
    assert.equal(e25.startTime, "00:00");
    assert.equal(e25.endTime, "10:00");

    // Audit-log: én entry per ny dato
    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    assert.equal(events.length, 3);
    for (const ev of events) {
      assert.equal(ev.action, "admin.game.close-day");
      const details = ev.details as Record<string, unknown>;
      assert.equal(details.mode, "consecutive");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: POST random lukker liste av frittstående datoer", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "random",
      closeDates: ["2026-12-25", "2026-04-01", "2026-05-17"],
    });
    assert.equal(res.status, 200, `got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.data.entries.length, 3);
    assert.deepEqual(res.body.data.createdDates, [
      "2026-04-01",
      "2026-05-17",
      "2026-12-25",
    ]);
    // 3 audit-log entries — én per dato
    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    assert.equal(events.length, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: POST consecutive er idempotent på re-run", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    // Første runde: 3 nye
    const a = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "consecutive",
      startDate: "2026-12-23",
      endDate: "2026-12-25",
      startTime: "00:00",
      endTime: "23:59",
    });
    assert.equal(a.status, 200);
    assert.equal(a.body.data.createdDates.length, 3);

    // Andre runde: alle skipped
    const b = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "consecutive",
      startDate: "2026-12-23",
      endDate: "2026-12-25",
      startTime: "00:00",
      endTime: "23:59",
    });
    assert.equal(b.status, 200);
    assert.deepEqual(b.body.data.createdDates, []);
    assert.deepEqual(b.body.data.skippedDates, [
      "2026-12-23",
      "2026-12-24",
      "2026-12-25",
    ]);
    assert.equal(b.body.data.entries.length, 3);

    // Audit-log: 3 fra første runde, 0 fra andre.
    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    assert.equal(events.length, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: POST consecutive uten startDate/endDate → 400", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "consecutive",
      startTime: "00:00",
      endTime: "23:59",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: POST random uten closeDates-array → 400", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "random",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: POST med ukjent mode → 400", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "weekly",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── BIN-700: PUT /api/admin/games/:id/close-day/:closeDate ─────────────

test("BIN-700 router: PUT close-day/:closeDate uten token → 401", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "PUT" as "POST",
      "/api/admin/games/gm-1/close-day/2026-04-20",
      undefined,
      { startTime: "08:00" }
    );
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: PUT close-day/:closeDate som SUPPORT → 403", async () => {
  const seeded: CloseDayEntry = {
    id: "cd-1",
    gameManagementId: "gm-1",
    closeDate: "2026-04-20",
    closedBy: "admin-1",
    closedAt: "2026-04-20T23:00:00.000Z",
    startTime: "00:00",
    endTime: "23:59",
    notes: null,
    recurringPatternId: null,
    summary: makeSummary("gm-1", "2026-04-20", { alreadyClosed: true }),
  };
  const ctx = await startServer({ "t-sup": supportUser }, [seeded]);
  try {
    const res = await req(
      ctx,
      "PUT" as "POST",
      "/api/admin/games/gm-1/close-day/2026-04-20",
      "t-sup",
      { startTime: "08:00" }
    );
    assert.equal(res.status, 403);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: PUT close-day oppdaterer kun spesifikk dato", async () => {
  const seeded: CloseDayEntry[] = [
    {
      id: "cd-23",
      gameManagementId: "gm-1",
      closeDate: "2026-12-23",
      closedBy: "admin-1",
      closedAt: "2026-04-20T12:00:00.000Z",
      startTime: "00:00",
      endTime: "23:59",
      notes: null,
      recurringPatternId: null,
      summary: makeSummary("gm-1", "2026-12-23"),
    },
    {
      id: "cd-24",
      gameManagementId: "gm-1",
      closeDate: "2026-12-24",
      closedBy: "admin-1",
      closedAt: "2026-04-20T12:00:00.000Z",
      startTime: "00:00",
      endTime: "23:59",
      notes: null,
      recurringPatternId: null,
      summary: makeSummary("gm-1", "2026-12-24"),
    },
  ];
  const ctx = await startServer({ "t-admin": adminUser }, seeded);
  try {
    const res = await req(
      ctx,
      "PUT" as "POST",
      "/api/admin/games/gm-1/close-day/2026-12-24",
      "t-admin",
      { startTime: "08:00", endTime: "20:00", notes: "redusert" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.startTime, "08:00");
    assert.equal(res.body.data.endTime, "20:00");
    assert.equal(res.body.data.notes, "redusert");

    // Verifiser at 12-23 ikke ble endret
    const e23 = ctx.entries.get("cd-23");
    assert.equal(e23?.startTime, "00:00");
    assert.equal(e23?.endTime, "23:59");

    // Audit-log
    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "admin.game.close-day.update");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: PUT close-day på ikke-eksisterende rad → 404", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "PUT" as "POST",
      "/api/admin/games/gm-1/close-day/2026-04-20",
      "t-admin",
      { startTime: "08:00" }
    );
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "CLOSE_DAY_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── BIN-700: DELETE /api/admin/games/:id/close-day/:closeDate ─────────

test("BIN-700 router: DELETE close-day/:closeDate uten token → 401", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/admin/games/gm-1/close-day/2026-04-20`,
      { method: "DELETE" }
    );
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: DELETE close-day/:closeDate fjerner kun spesifikk dato", async () => {
  const seeded: CloseDayEntry[] = [
    {
      id: "cd-23",
      gameManagementId: "gm-1",
      closeDate: "2026-12-23",
      closedBy: "admin-1",
      closedAt: "2026-04-20T12:00:00.000Z",
      startTime: null,
      endTime: null,
      notes: null,
      recurringPatternId: null,
      summary: makeSummary("gm-1", "2026-12-23"),
    },
    {
      id: "cd-24",
      gameManagementId: "gm-1",
      closeDate: "2026-12-24",
      closedBy: "admin-1",
      closedAt: "2026-04-20T12:00:00.000Z",
      startTime: null,
      endTime: null,
      notes: null,
      recurringPatternId: null,
      summary: makeSummary("gm-1", "2026-12-24"),
    },
  ];
  const ctx = await startServer({ "t-admin": adminUser }, seeded);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/admin/games/gm-1/close-day/2026-12-24`,
      {
        method: "DELETE",
        headers: { authorization: "Bearer t-admin" },
      }
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { closeDate: string } };
    assert.equal(body.ok, true);
    assert.equal(body.data.closeDate, "2026-12-24");

    // 12-23 fortsatt der
    assert.ok(ctx.entries.has("cd-23"));
    // 12-24 fjernet
    assert.ok(!ctx.entries.has("cd-24"));

    // Audit-log: én delete-event med slettet-rad-info i details
    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "admin.game.close-day.delete");
    const details = events[0]!.details as Record<string, unknown>;
    assert.equal(details.closeDate, "2026-12-24");
    assert.ok(details.summary, "summary-snapshot bevares for audit");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: DELETE close-day på ikke-eksisterende rad → 404", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/admin/games/gm-1/close-day/2026-04-20`,
      {
        method: "DELETE",
        headers: { authorization: "Bearer t-admin" },
      }
    );
    assert.equal(res.status, 404);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: DELETE close-day som SUPPORT → 403", async () => {
  const ctx = await startServer({ "t-sup": supportUser });
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/admin/games/gm-1/close-day/2026-04-20`,
      {
        method: "DELETE",
        headers: { authorization: "Bearer t-sup" },
      }
    );
    assert.equal(res.status, 403);
  } finally {
    await ctx.close();
  }
});

// ── BIN-700: GET /api/admin/games/:id/close-day (list) ────────────────

test("BIN-700 router: GET /close-day lister alle lukkinger sortert ascending", async () => {
  const seeded: CloseDayEntry[] = [
    {
      id: "cd-2",
      gameManagementId: "gm-1",
      closeDate: "2026-12-25",
      closedBy: "admin-1",
      closedAt: "2026-04-20T12:00:00.000Z",
      startTime: null,
      endTime: null,
      notes: null,
      recurringPatternId: null,
      summary: makeSummary("gm-1", "2026-12-25"),
    },
    {
      id: "cd-1",
      gameManagementId: "gm-1",
      closeDate: "2026-04-01",
      closedBy: "admin-1",
      closedAt: "2026-04-20T12:00:00.000Z",
      startTime: null,
      endTime: null,
      notes: null,
      recurringPatternId: null,
      summary: makeSummary("gm-1", "2026-04-01"),
    },
  ];
  const ctx = await startServer({ "t-admin": adminUser }, seeded);
  try {
    const res = await req(ctx, "GET", "/api/admin/games/gm-1/close-day", "t-admin");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.entries.length, 2);
    assert.deepEqual(
      res.body.data.entries.map((e: { closeDate: string }) => e.closeDate),
      ["2026-04-01", "2026-12-25"]
    );
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: GET /close-day uten token → 401", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "GET", "/api/admin/games/gm-1/close-day");
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: GET /close-day som PLAYER → 403", async () => {
  const ctx = await startServer({ "t-pl": playerUser });
  try {
    const res = await req(ctx, "GET", "/api/admin/games/gm-1/close-day", "t-pl");
    assert.equal(res.status, 403);
  } finally {
    await ctx.close();
  }
});

// ── BIN-700: backwards-compat ─────────────────────────────────────────

test("BIN-700 router: legacy POST shape (uten mode) fortsatt fungerer som single", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      closeDate: "2026-04-20",
    });
    assert.equal(res.status, 200);
    // Legacy response shape: ingen "mode" key, bare entry-felter
    assert.equal(res.body.data.closeDate, "2026-04-20");
    assert.equal(res.body.data.gameManagementId, "gm-1");
    assert.ok(!("mode" in res.body.data), "single-mode beholder gammel response-shape");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 router: POST mode=single tillater notes + tids-vindu", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "single",
      closeDate: "2026-04-20",
      startTime: "09:00",
      endTime: "17:00",
      notes: "redusert dag",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.startTime, "09:00");
    assert.equal(res.body.data.endTime, "17:00");
    assert.equal(res.body.data.notes, "redusert dag");

    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    assert.equal(events.length, 1);
    const details = events[0]!.details as Record<string, unknown>;
    assert.equal(details.mode, "single");
    assert.equal(details.startTime, "09:00");
    assert.equal(details.notes, "redusert dag");
  } finally {
    await ctx.close();
  }
});

// ── REQ-116: Recurring patterns — router-tester ─────────────────────────

test("REQ-116 router: POST mode=recurring lager pattern + child-rad + audit-events", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/games/gm-1/close-day",
      "t-admin",
      {
        mode: "recurring",
        pattern: { type: "weekly", daysOfWeek: [1] },
        startDate: "2026-04-20",
        endDate: "2026-04-26",
        notes: "Mandagsstengt",
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.mode, "recurring");
    assert.ok(res.body.data.pattern, "pattern-objekt returnert");
    assert.equal(res.body.data.pattern.pattern.type, "weekly");
    assert.equal(res.body.data.expandedCount, 1);

    // Audit-log: 1 recurring.create + 1 close-day per child-rad
    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    assert.equal(events.length, 2);
    const recCreate = events.find(
      (e) => e.action === "admin.game.close-day.recurring.create"
    );
    const childCreate = events.find((e) => e.action === "admin.game.close-day");
    assert.ok(recCreate, "recurring.create-event finnes");
    assert.ok(childCreate, "child close-day-event finnes");
    const recDetails = recCreate!.details as Record<string, unknown>;
    assert.equal(recDetails.expandedCount, 1);
    assert.equal(recDetails.createdCount, 1);
    assert.ok(typeof recDetails.patternId === "string");
  } finally {
    await ctx.close();
  }
});

test("REQ-116 router: POST mode=recurring som SUPPORT → 403", async () => {
  const ctx = await startServer({ "t-sup": supportUser });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/games/gm-1/close-day",
      "t-sup",
      {
        mode: "recurring",
        pattern: { type: "daily" },
      }
    );
    assert.equal(res.status, 403);
  } finally {
    await ctx.close();
  }
});

test("REQ-116 router: POST mode=recurring uten pattern → 400", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/games/gm-1/close-day",
      "t-admin",
      {
        mode: "recurring",
      }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("REQ-116 router: GET /close-day/recurring lister kun aktive patterns", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    // Opprett 2 patterns
    await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "recurring",
      pattern: { type: "weekly", daysOfWeek: [1] },
      startDate: "2026-04-20",
      endDate: "2026-04-26",
    });
    await req(ctx, "POST", "/api/admin/games/gm-1/close-day", "t-admin", {
      mode: "recurring",
      pattern: { type: "yearly", month: 12, day: 25 },
      startDate: "2026-12-01",
      endDate: "2026-12-31",
    });
    const res = await req(
      ctx,
      "GET",
      "/api/admin/games/gm-1/close-day/recurring",
      "t-admin"
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.patterns.length, 2);
    assert.equal(ctx.spies.recurringLists.length, 1);
  } finally {
    await ctx.close();
  }
});

test("REQ-116 router: GET /close-day/recurring uten token → 401", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/admin/games/gm-1/close-day/recurring`
    );
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test("REQ-116 router: GET /close-day/recurring som PLAYER → 403", async () => {
  const ctx = await startServer({ "t-pl": playerUser });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/games/gm-1/close-day/recurring",
      "t-pl"
    );
    assert.equal(res.status, 403);
  } finally {
    await ctx.close();
  }
});

test("REQ-116 router: DELETE /close-day/recurring/:patternId fjerner pattern + child-rader", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const createRes = await req(
      ctx,
      "POST",
      "/api/admin/games/gm-1/close-day",
      "t-admin",
      {
        mode: "recurring",
        pattern: { type: "weekly", daysOfWeek: [1] },
        startDate: "2026-04-20",
        endDate: "2026-04-26",
      }
    );
    const patternId = createRes.body.data.pattern.id as string;
    assert.ok(patternId);
    assert.equal(ctx.entries.size, 1, "1 child-rad opprettet");

    const delRes = await fetch(
      `${ctx.baseUrl}/api/admin/games/gm-1/close-day/recurring/${patternId}`,
      {
        method: "DELETE",
        headers: { authorization: "Bearer t-admin" },
      }
    );
    assert.equal(delRes.status, 200);
    const body = (await delRes.json()) as {
      ok: boolean;
      data: { pattern: { deletedAt: string | null }; deletedChildCount: number };
    };
    assert.equal(body.ok, true);
    assert.notEqual(body.data.pattern.deletedAt, null);
    assert.equal(body.data.deletedChildCount, 1);
    assert.equal(ctx.entries.size, 0, "child-rader hard-slettet");

    // Audit-log: skal ha en recurring.delete-event
    await new Promise((r) => setImmediate(r));
    const events = await ctx.spies.auditStore.list();
    const delEvent = events.find(
      (e) => e.action === "admin.game.close-day.recurring.delete"
    );
    assert.ok(delEvent, "delete-event registrert");
    const delDetails = delEvent!.details as Record<string, unknown>;
    assert.equal(delDetails.patternId, patternId);
    assert.equal(delDetails.deletedChildCount, 1);
  } finally {
    await ctx.close();
  }
});

test("REQ-116 router: DELETE /close-day/recurring/:patternId på ikke-eksisterende → 404", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/admin/games/gm-1/close-day/recurring/missing-id`,
      {
        method: "DELETE",
        headers: { authorization: "Bearer t-admin" },
      }
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "CLOSE_DAY_RECURRING_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("REQ-116 router: DELETE /close-day/recurring som SUPPORT → 403", async () => {
  const ctx = await startServer({ "t-sup": supportUser });
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/admin/games/gm-1/close-day/recurring/any-id`,
      {
        method: "DELETE",
        headers: { authorization: "Bearer t-sup" },
      }
    );
    assert.equal(res.status, 403);
  } finally {
    await ctx.close();
  }
});

test("REQ-116 router: POST recurring med yearly-pattern + alle valgfrie felter", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/games/gm-1/close-day",
      "t-admin",
      {
        mode: "recurring",
        pattern: { type: "yearly", month: 5, day: 17 },
        startDate: "2026-01-01",
        endDate: "2028-12-31",
        startTime: "00:00",
        endTime: "23:59",
        notes: "Grunnlovsdag",
        maxOccurrences: 10,
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.mode, "recurring");
    assert.equal(res.body.data.pattern.pattern.type, "yearly");
    assert.equal(res.body.data.pattern.pattern.month, 5);
    assert.equal(res.body.data.pattern.pattern.day, 17);
    assert.equal(res.body.data.pattern.notes, "Grunnlovsdag");
    assert.equal(res.body.data.pattern.maxOccurrences, 10);
  } finally {
    await ctx.close();
  }
});
