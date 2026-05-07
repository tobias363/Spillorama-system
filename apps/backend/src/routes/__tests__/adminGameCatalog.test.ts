/**
 * Fase 2 (2026-05-07): integrasjonstester for admin-game-catalog-router.
 *
 * Dekker alle 5 endepunkter:
 *   GET    /api/admin/game-catalog
 *   GET    /api/admin/game-catalog/:id
 *   POST   /api/admin/game-catalog
 *   PUT    /api/admin/game-catalog/:id
 *   DELETE /api/admin/game-catalog/:id
 *
 * Mønsteret matcher adminGameTypes.test.ts: stub-service rundt et
 * in-memory Map.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGameCatalogRouter } from "../adminGameCatalog.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { GameCatalogService } from "../../game/GameCatalogService.js";
import type {
  CreateGameCatalogInput,
  GameCatalogEntry,
  ListGameCatalogFilter,
  UpdateGameCatalogInput,
} from "../../game/gameCatalog.types.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

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
  entries: Map<string, GameCatalogEntry>;
  close: () => Promise<void>;
}

function makeEntry(
  overrides: Partial<GameCatalogEntry> & {
    id: string;
    slug: string;
    displayName: string;
  },
): GameCatalogEntry {
  return {
    id: overrides.id,
    slug: overrides.slug,
    displayName: overrides.displayName,
    description: overrides.description ?? null,
    rules: overrides.rules ?? {},
    ticketColors: overrides.ticketColors ?? ["gul", "hvit"],
    ticketPricesCents: overrides.ticketPricesCents ?? { gul: 1000, hvit: 500 },
    prizesCents: overrides.prizesCents ?? {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 50000 },
    },
    bonusGameSlug: overrides.bonusGameSlug ?? null,
    bonusGameEnabled: overrides.bonusGameEnabled ?? false,
    requiresJackpotSetup: overrides.requiresJackpotSetup ?? false,
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt ?? "2026-05-07T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-05-07T10:00:00Z",
    createdByUserId: overrides.createdByUserId ?? "admin-1",
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: GameCatalogEntry[] = [],
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const entries = new Map<string, GameCatalogEntry>();
  for (const e of seed) entries.set(e.id, e);

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = entries.size;
  const catalogService = {
    async list(filter: ListGameCatalogFilter = {}) {
      let list = [...entries.values()];
      if (filter.isActive !== undefined) {
        list = list.filter((e) => e.isActive === filter.isActive);
      }
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async getById(id: string) {
      return entries.get(id) ?? null;
    },
    async getBySlug(slug: string) {
      for (const e of entries.values()) if (e.slug === slug) return e;
      return null;
    },
    async create(input: CreateGameCatalogInput) {
      // Replikér service-validering: sjekk slug uniqueness.
      for (const e of entries.values()) {
        if (e.slug === input.slug) {
          throw new DomainError(
            "GAME_CATALOG_DUPLICATE",
            `slug ${input.slug} finnes`,
          );
        }
      }
      idCounter += 1;
      const id = `cat-${idCounter}`;
      const next = makeEntry({
        id,
        slug: input.slug,
        displayName: input.displayName,
        description: input.description ?? null,
        rules: input.rules ?? {},
        ticketColors: input.ticketColors ?? ["gul", "hvit"],
        ticketPricesCents:
          input.ticketPricesCents ?? { gul: 1000, hvit: 500 },
        prizesCents: input.prizesCents,
        bonusGameSlug: input.bonusGameSlug ?? null,
        bonusGameEnabled: input.bonusGameEnabled ?? false,
        requiresJackpotSetup: input.requiresJackpotSetup ?? false,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        createdByUserId: input.createdByUserId,
      });
      entries.set(id, next);
      return next;
    },
    async update(id: string, patch: UpdateGameCatalogInput) {
      const existing = entries.get(id);
      if (!existing) {
        throw new DomainError("GAME_CATALOG_NOT_FOUND", "ikke funnet");
      }
      const next: GameCatalogEntry = { ...existing };
      if (patch.slug !== undefined) next.slug = patch.slug;
      if (patch.displayName !== undefined) next.displayName = patch.displayName;
      if (patch.description !== undefined) next.description = patch.description;
      if (patch.rules !== undefined) next.rules = patch.rules;
      if (patch.ticketColors !== undefined) next.ticketColors = patch.ticketColors;
      if (patch.ticketPricesCents !== undefined) {
        next.ticketPricesCents = patch.ticketPricesCents;
      }
      if (patch.prizesCents !== undefined) next.prizesCents = patch.prizesCents;
      if (patch.bonusGameSlug !== undefined) next.bonusGameSlug = patch.bonusGameSlug;
      if (patch.bonusGameEnabled !== undefined) {
        next.bonusGameEnabled = patch.bonusGameEnabled;
      }
      if (patch.requiresJackpotSetup !== undefined) {
        next.requiresJackpotSetup = patch.requiresJackpotSetup;
      }
      if (patch.isActive !== undefined) next.isActive = patch.isActive;
      if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
      next.updatedAt = new Date().toISOString();
      entries.set(id, next);
      return next;
    },
    async deactivate(id: string) {
      const e = entries.get(id);
      if (!e) {
        throw new DomainError("GAME_CATALOG_NOT_FOUND", "ikke funnet");
      }
      if (!e.isActive) return; // idempotent
      entries.set(id, { ...e, isActive: false });
    },
    setAuditLogService() {},
  } as unknown as GameCatalogService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGameCatalogRouter({
      platformService,
      auditLogService,
      catalogService,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    entries,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; json: any }> {
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

// ── RBAC ────────────────────────────────────────────────────────────────

test("Fase 2: PLAYER blokkert fra alle game-catalog-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/game-catalog", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-catalog",
      "pl-tok",
      {
        slug: "jackpot",
        displayName: "Jackpot",
        prizesCents: { rad1: 10000, rad2: 10000, rad3: 10000, rad4: 10000, bingo: { gul: 200000 } },
      },
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("Fase 2: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, [
    makeEntry({ id: "cat-1", slug: "jackpot", displayName: "Jackpot" }),
  ]);
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/game-catalog", "sup-tok");
    assert.equal(list.status, 200);
    assert.equal(list.json.data.count, 1);

    const detail = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-catalog/cat-1",
      "sup-tok",
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.slug, "jackpot");

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-catalog",
      "sup-tok",
      {
        slug: "innsatsen",
        displayName: "Innsatsen",
        prizesCents: { rad1: 10000, rad2: 10000, rad3: 10000, rad4: 10000, bingo: { gul: 200000 } },
      },
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const del = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/game-catalog/cat-1",
      "sup-tok",
    );
    assert.equal(del.status, 400);
    assert.equal(del.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("Fase 2: HALL_OPERATOR kan READ men IKKE WRITE (ADMIN-only)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser }, [
    makeEntry({ id: "cat-1", slug: "jackpot", displayName: "Jackpot" }),
  ]);
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/game-catalog", "op-tok");
    assert.equal(list.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-catalog",
      "op-tok",
      {
        slug: "innsatsen",
        displayName: "Innsatsen",
        prizesCents: { rad1: 10000, rad2: 10000, rad3: 10000, rad4: 10000, bingo: { gul: 200000 } },
      },
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── happy path ──────────────────────────────────────────────────────────

test("Fase 2: ADMIN kan opprette en katalog-entry", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-catalog",
      "admin-tok",
      {
        slug: "jackpot",
        displayName: "Jackpot",
        ticketColors: ["gul", "hvit", "lilla"],
        ticketPricesCents: { gul: 1000, hvit: 500, lilla: 2000 },
        prizesCents: {
          rad1: 10000,
          rad2: 10000,
          rad3: 10000,
          rad4: 10000,
          bingo: { gul: 200000, hvit: 50000, lilla: 500000 },
        },
        bonusGameEnabled: true,
        bonusGameSlug: "wheel_of_fortune",
        requiresJackpotSetup: true,
      },
    );
    assert.equal(post.status, 200);
    assert.equal(post.json.data.slug, "jackpot");
    assert.equal(post.json.data.bonusGameSlug, "wheel_of_fortune");
    assert.equal(post.json.data.requiresJackpotSetup, true);
    assert.deepEqual(post.json.data.ticketColors, ["gul", "hvit", "lilla"]);
  } finally {
    await ctx.close();
  }
});

test("Fase 2: GET list med isActive=false viser kun deaktiverte", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeEntry({ id: "cat-1", slug: "jackpot", displayName: "Jackpot", isActive: true }),
    makeEntry({ id: "cat-2", slug: "old", displayName: "Old", isActive: false }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-catalog?isActive=false",
      "admin-tok",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.entries[0].slug, "old");
  } finally {
    await ctx.close();
  }
});

test("Fase 2: PUT oppdaterer eksisterende entry", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeEntry({ id: "cat-1", slug: "jackpot", displayName: "Jackpot" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/game-catalog/cat-1",
      "admin-tok",
      { displayName: "Jackpot 2.0" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.displayName, "Jackpot 2.0");
    assert.equal(res.json.data.slug, "jackpot");
  } finally {
    await ctx.close();
  }
});

test("Fase 2: DELETE soft-deactivates", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeEntry({ id: "cat-1", slug: "jackpot", displayName: "Jackpot" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/game-catalog/cat-1",
      "admin-tok",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.deactivated, true);
    assert.equal(ctx.entries.get("cat-1")?.isActive, false);
  } finally {
    await ctx.close();
  }
});

// ── validering ──────────────────────────────────────────────────────────

test("Fase 2: POST uten prizesCents avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-catalog",
      "admin-tok",
      { slug: "jackpot", displayName: "Jackpot" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("Fase 2: GET ukjent id gir GAME_CATALOG_NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-catalog/missing",
      "admin-tok",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_CATALOG_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});
