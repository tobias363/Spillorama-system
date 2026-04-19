/**
 * BIN-627: integrasjonstester for admin-patterns-router.
 *
 * Dekker alle 6 endepunkter:
 *   GET    /api/admin/patterns
 *   GET    /api/admin/patterns/dynamic-menu
 *   GET    /api/admin/patterns/:id
 *   POST   /api/admin/patterns
 *   PATCH  /api/admin/patterns/:id
 *   DELETE /api/admin/patterns/:id
 *
 * Testene bygger en stub-PatternService rundt et in-memory Map,
 * på samme pattern som adminGameManagement.test.ts (BIN-622).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPatternsRouter } from "../adminPatterns.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  PatternService,
  Pattern,
  CreatePatternInput,
  UpdatePatternInput,
  ListPatternFilter,
  PatternDynamicMenuResponse,
} from "../../admin/PatternService.js";
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
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    creates: Pattern[];
    updates: Array<{ id: string; changed: string[] }>;
    removes: Array<{ id: string; hard: boolean }>;
  };
  patterns: Map<string, Pattern>;
  close: () => Promise<void>;
}

function makePattern(
  overrides: Partial<Pattern> & { id: string; gameTypeId: string }
): Pattern {
  return {
    id: overrides.id,
    gameTypeId: overrides.gameTypeId,
    gameName: overrides.gameName ?? "Game3",
    patternNumber: overrides.patternNumber ?? `num-${overrides.id}`,
    name: overrides.name ?? `Pattern ${overrides.id}`,
    mask: overrides.mask ?? 31,
    claimType: overrides.claimType ?? "BINGO",
    prizePercent: overrides.prizePercent ?? 0,
    orderIndex: overrides.orderIndex ?? 0,
    design: overrides.design ?? 0,
    status: overrides.status ?? "active",
    isWoF: overrides.isWoF ?? false,
    isTchest: overrides.isTchest ?? false,
    isMys: overrides.isMys ?? false,
    isRowPr: overrides.isRowPr ?? false,
    rowPercentage: overrides.rowPercentage ?? 0,
    isJackpot: overrides.isJackpot ?? false,
    isGameTypeExtra: overrides.isGameTypeExtra ?? false,
    isLuckyBonus: overrides.isLuckyBonus ?? false,
    patternPlace: overrides.patternPlace ?? null,
    extra: overrides.extra ?? {},
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: Pattern[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const patterns = new Map<string, Pattern>();
  for (const p of seed) patterns.set(p.id, p);

  const creates: Pattern[] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const removes: Ctx["spies"]["removes"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = patterns.size;
  const patternService = {
    async list(filter: ListPatternFilter = {}) {
      let list = [...patterns.values()].filter((p) => !p.deletedAt);
      if (filter.gameTypeId) list = list.filter((p) => p.gameTypeId === filter.gameTypeId);
      if (filter.status) list = list.filter((p) => p.status === filter.status);
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const p = patterns.get(id);
      if (!p) throw new DomainError("PATTERN_NOT_FOUND", "not found");
      return p;
    },
    async create(input: CreatePatternInput) {
      if (input.mask < 0 || input.mask >= 0x2000000) {
        throw new DomainError("INVALID_INPUT", "mask out of range");
      }
      // Duplicate-check (unik navn per gameType).
      for (const p of patterns.values()) {
        if (
          !p.deletedAt &&
          p.gameTypeId === input.gameTypeId &&
          p.name === input.name
        ) {
          throw new DomainError(
            "PATTERN_DUPLICATE_NAME",
            "duplicate"
          );
        }
      }
      idCounter += 1;
      const id = `pat-${idCounter}`;
      const next = makePattern({
        id,
        gameTypeId: input.gameTypeId,
        gameName: input.gameName ?? "Game3",
        patternNumber: input.patternNumber ?? `num-${id}`,
        name: input.name,
        mask: input.mask,
        claimType: input.claimType ?? "BINGO",
        prizePercent: input.prizePercent ?? 0,
        orderIndex: input.orderIndex ?? 0,
        design: input.design ?? 0,
        status: input.status ?? "active",
        isWoF: input.isWoF ?? false,
        isTchest: input.isTchest ?? false,
        isMys: input.isMys ?? false,
        isRowPr: input.isRowPr ?? false,
        rowPercentage: input.rowPercentage ?? 0,
        isJackpot: input.isJackpot ?? false,
        isGameTypeExtra: input.isGameTypeExtra ?? false,
        isLuckyBonus: input.isLuckyBonus ?? false,
        patternPlace: input.patternPlace ?? null,
        extra: input.extra ?? {},
        createdBy: input.createdBy,
      });
      patterns.set(id, next);
      creates.push(next);
      return next;
    },
    async update(id: string, update: UpdatePatternInput) {
      const p = patterns.get(id);
      if (!p) throw new DomainError("PATTERN_NOT_FOUND", "not found");
      if (p.deletedAt) throw new DomainError("PATTERN_DELETED", "deleted");
      updates.push({ id, changed: Object.keys(update) });
      const next: Pattern = { ...p };
      if (update.gameName !== undefined) next.gameName = update.gameName;
      if (update.patternNumber !== undefined) next.patternNumber = update.patternNumber;
      if (update.name !== undefined) next.name = update.name;
      if (update.mask !== undefined) {
        if (update.mask < 0 || update.mask >= 0x2000000) {
          throw new DomainError("INVALID_INPUT", "mask out of range");
        }
        next.mask = update.mask;
      }
      if (update.claimType !== undefined) next.claimType = update.claimType;
      if (update.prizePercent !== undefined) next.prizePercent = update.prizePercent;
      if (update.orderIndex !== undefined) next.orderIndex = update.orderIndex;
      if (update.design !== undefined) next.design = update.design;
      if (update.status !== undefined) next.status = update.status;
      if (update.isWoF !== undefined) next.isWoF = update.isWoF;
      if (update.isTchest !== undefined) next.isTchest = update.isTchest;
      if (update.isMys !== undefined) next.isMys = update.isMys;
      if (update.isRowPr !== undefined) next.isRowPr = update.isRowPr;
      if (update.rowPercentage !== undefined) next.rowPercentage = update.rowPercentage;
      if (update.isJackpot !== undefined) next.isJackpot = update.isJackpot;
      if (update.isGameTypeExtra !== undefined) next.isGameTypeExtra = update.isGameTypeExtra;
      if (update.isLuckyBonus !== undefined) next.isLuckyBonus = update.isLuckyBonus;
      if (update.patternPlace !== undefined) next.patternPlace = update.patternPlace;
      if (update.extra !== undefined) next.extra = update.extra;
      next.updatedAt = new Date().toISOString();
      patterns.set(id, next);
      return next;
    },
    async remove(id: string, options: { hard?: boolean } = {}) {
      const p = patterns.get(id);
      if (!p) throw new DomainError("PATTERN_NOT_FOUND", "not found");
      if (p.deletedAt) throw new DomainError("PATTERN_DELETED", "already deleted");
      removes.push({ id, hard: Boolean(options.hard) });
      if (options.hard) {
        patterns.delete(id);
        return { softDeleted: false };
      }
      patterns.set(id, {
        ...p,
        deletedAt: new Date().toISOString(),
        status: "inactive",
      });
      return { softDeleted: true };
    },
    async dynamicMenu(gameTypeId?: string): Promise<PatternDynamicMenuResponse> {
      let list = [...patterns.values()].filter((p) => !p.deletedAt);
      if (gameTypeId) list = list.filter((p) => p.gameTypeId === gameTypeId);
      list.sort((a, b) => {
        const sa = a.status === "active" ? 0 : 1;
        const sb = b.status === "active" ? 0 : 1;
        if (sa !== sb) return sa - sb;
        if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
        return a.name.localeCompare(b.name);
      });
      return {
        gameTypeId: gameTypeId ?? null,
        entries: list.map((p) => ({
          id: p.id,
          name: p.name,
          patternNumber: p.patternNumber,
          mask: p.mask,
          orderIndex: p.orderIndex,
          status: p.status,
          claimType: p.claimType,
          design: p.design,
        })),
        count: list.length,
      };
    },
  } as unknown as PatternService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminPatternsRouter({
      platformService,
      auditLogService,
      patternService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, creates, updates, removes },
    patterns,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForAudit(
  store: InMemoryAuditLogStore,
  action: string
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

// ── RBAC tests ───────────────────────────────────────────────────────────────

test("BIN-627: PLAYER blokkert fra alle pattern-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/patterns", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "pl-tok", {
      gameTypeId: "game_3",
      name: "Test",
      mask: 31,
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const menu = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns/dynamic-menu",
      "pl-tok"
    );
    assert.equal(menu.status, 400);
    assert.equal(menu.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3" }),
  ]);
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/patterns", "sup-tok");
    assert.equal(list.status, 200);

    const detail = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns/pat-1",
      "sup-tok"
    );
    assert.equal(detail.status, 200);

    const menu = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns/dynamic-menu",
      "sup-tok"
    );
    assert.equal(menu.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "sup-tok", {
      gameTypeId: "game_3",
      name: "Nope",
      mask: 31,
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const del = await req(ctx.baseUrl, "DELETE", "/api/admin/patterns/pat-1", "sup-tok");
    assert.equal(del.status, 400);
    assert.equal(del.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: HALL_OPERATOR kan både READ og WRITE", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/patterns", "op-tok");
    assert.equal(list.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "op-tok", {
      gameTypeId: "game_3",
      name: "Hall-local pattern",
      mask: 31,
    });
    assert.equal(post.status, 200);
    assert.equal(post.json.data.name, "Hall-local pattern");
  } finally {
    await ctx.close();
  }
});

// ── GET list ─────────────────────────────────────────────────────────────────

test("BIN-627: GET list returnerer alle patterns uten filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_1" }),
    makePattern({ id: "pat-2", gameTypeId: "game_3" }),
    makePattern({ id: "pat-3", gameTypeId: "game_3", status: "inactive" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/patterns", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 3);
    assert.equal(res.json.data.patterns.length, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-627: GET list med gameTypeId-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_1" }),
    makePattern({ id: "pat-2", gameTypeId: "game_3" }),
    makePattern({ id: "pat-3", gameTypeId: "game_3" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns?gameTypeId=game_3",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
    for (const p of res.json.data.patterns) {
      assert.equal(p.gameTypeId, "game_3");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-627: GET list med status-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3", status: "active" }),
    makePattern({ id: "pat-2", gameTypeId: "game_3", status: "inactive" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns?status=active",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.patterns[0].id, "pat-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: GET list avviser ugyldig status", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns?status=deleted",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: GET list skjuler deletedAt fra wire-shape", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/patterns", "admin-tok");
    assert.equal(res.status, 200);
    for (const p of res.json.data.patterns) {
      assert.equal("deletedAt" in p, false, "deletedAt skulle ikke eksponeres");
    }
  } finally {
    await ctx.close();
  }
});

// ── GET detail ───────────────────────────────────────────────────────────────

test("BIN-627: GET detail returnerer enkelt mønster", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3", name: "Line top" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns/pat-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "pat-1");
    assert.equal(res.json.data.name, "Line top");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: GET detail 400 når id ikke finnes", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns/nope",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PATTERN_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── GET dynamic-menu ─────────────────────────────────────────────────────────

test("BIN-627: GET dynamic-menu returnerer ordnet liste", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3", orderIndex: 2, name: "B" }),
    makePattern({ id: "pat-2", gameTypeId: "game_3", orderIndex: 1, name: "A" }),
    makePattern({
      id: "pat-3",
      gameTypeId: "game_3",
      orderIndex: 0,
      status: "inactive",
      name: "Inactive",
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns/dynamic-menu?gameTypeId=game_3",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 3);
    // Aktive først etter orderIndex, så inaktive.
    assert.equal(res.json.data.entries[0].id, "pat-2"); // active, order=1
    assert.equal(res.json.data.entries[1].id, "pat-1"); // active, order=2
    assert.equal(res.json.data.entries[2].id, "pat-3"); // inactive
    assert.equal(res.json.data.gameTypeId, "game_3");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: GET dynamic-menu uten gameTypeId returnerer alt", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_1" }),
    makePattern({ id: "pat-2", gameTypeId: "game_3" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/patterns/dynamic-menu",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
    assert.equal(res.json.data.gameTypeId, null);
  } finally {
    await ctx.close();
  }
});

// ── POST create ──────────────────────────────────────────────────────────────

test("BIN-627: POST create oppretter mønster med gyldig mask", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "admin-tok", {
      gameTypeId: "game_3",
      name: "Top row",
      mask: 31, // bits 0-4
      claimType: "LINE",
      prizePercent: 10,
      orderIndex: 1,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "Top row");
    assert.equal(res.json.data.mask, 31);
    assert.equal(res.json.data.claimType, "LINE");
    assert.equal(ctx.spies.creates.length, 1);

    const audit = await waitForAudit(ctx.spies.auditStore, "admin.pattern.created");
    assert.ok(audit, "audit-event skulle være skrevet");
    assert.equal(audit.resource, "pattern");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: POST create avviser mask over 2^25", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "admin-tok", {
      gameTypeId: "game_3",
      name: "Overflow",
      mask: 0x2000000, // 2^25 = 33554432
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: POST create avviser negativ mask", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "admin-tok", {
      gameTypeId: "game_3",
      name: "Neg",
      mask: -1,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: POST create avviser non-integer mask", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "admin-tok", {
      gameTypeId: "game_3",
      name: "Float",
      mask: 3.5,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: POST create avviser manglende mask", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "admin-tok", {
      gameTypeId: "game_3",
      name: "NoMask",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: POST create avviser duplikat-navn", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3", name: "Existing" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "admin-tok", {
      gameTypeId: "game_3",
      name: "Existing",
      mask: 31,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PATTERN_DUPLICATE_NAME");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: POST create avviser ugyldig claimType", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "admin-tok", {
      gameTypeId: "game_3",
      name: "Bad",
      mask: 31,
      claimType: "COVERALL",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: POST create aksepterer mask = 0 (tom mønster)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "admin-tok", {
      gameTypeId: "game_3",
      name: "Empty",
      mask: 0,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.mask, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-627: POST create aksepterer mask = 2^25 - 1 (full house)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/patterns", "admin-tok", {
      gameTypeId: "game_3",
      name: "Full House",
      mask: 33554431, // 0x1FFFFFF
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.mask, 33554431);
  } finally {
    await ctx.close();
  }
});

// ── PATCH update ─────────────────────────────────────────────────────────────

test("BIN-627: PATCH update endrer mask", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3", mask: 31 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/patterns/pat-1",
      "admin-tok",
      { mask: 992 } // bits 5-9 (row 1)
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.mask, 992);
    assert.equal(ctx.spies.updates.length, 1);
    assert.ok(ctx.spies.updates[0]!.changed.includes("mask"));

    const audit = await waitForAudit(ctx.spies.auditStore, "admin.pattern.updated");
    assert.ok(audit, "audit-event skulle være skrevet");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: PATCH update avviser mask over grensen", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3", mask: 31 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/patterns/pat-1",
      "admin-tok",
      { mask: 33554432 }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: PATCH update endrer status og orderIndex", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3", status: "active", orderIndex: 1 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/patterns/pat-1",
      "admin-tok",
      { status: "inactive", orderIndex: 99 }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "inactive");
    assert.equal(res.json.data.orderIndex, 99);
  } finally {
    await ctx.close();
  }
});

test("BIN-627: PATCH update 400 når id ikke finnes", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/patterns/nope",
      "admin-tok",
      { name: "X" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PATTERN_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────

test("BIN-627: DELETE soft-deleter mønster default", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/patterns/pat-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);
    assert.equal(ctx.spies.removes.length, 1);
    assert.equal(ctx.spies.removes[0]!.hard, false);

    const audit = await waitForAudit(
      ctx.spies.auditStore,
      "admin.pattern.soft_deleted"
    );
    assert.ok(audit, "soft-delete audit skulle være skrevet");

    // Pattern skal fortsatt være i mappen, med deletedAt satt.
    const stored = ctx.patterns.get("pat-1");
    assert.ok(stored?.deletedAt, "deletedAt skulle være satt");
  } finally {
    await ctx.close();
  }
});

test("BIN-627: DELETE?hard=true utfører hard-delete", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makePattern({ id: "pat-1", gameTypeId: "game_3" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/patterns/pat-1?hard=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, false);
    assert.equal(ctx.spies.removes[0]!.hard, true);

    const audit = await waitForAudit(ctx.spies.auditStore, "admin.pattern.deleted");
    assert.ok(audit, "hard-delete audit skulle være skrevet");

    // Pattern skal være fjernet helt.
    assert.equal(ctx.patterns.has("pat-1"), false);
  } finally {
    await ctx.close();
  }
});

test("BIN-627: DELETE 400 når id ikke finnes", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/patterns/nope",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PATTERN_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});
