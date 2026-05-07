/**
 * Fase 2 (2026-05-07): integrasjonstester for admin-game-plans-router.
 *
 * Dekker alle 6 endepunkter:
 *   GET    /api/admin/game-plans
 *   GET    /api/admin/game-plans/:id
 *   POST   /api/admin/game-plans
 *   PUT    /api/admin/game-plans/:id
 *   DELETE /api/admin/game-plans/:id
 *   PUT    /api/admin/game-plans/:id/items
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGamePlansRouter } from "../adminGamePlans.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { GamePlanService } from "../../game/GamePlanService.js";
import type {
  CreateGamePlanInput,
  GamePlan,
  GamePlanWithItems,
  ListGamePlanFilter,
  SetGamePlanItemsInput,
  UpdateGamePlanInput,
} from "../../game/gamePlan.types.js";
import type { GameCatalogEntry } from "../../game/gameCatalog.types.js";
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
  plans: Map<string, GamePlan>;
  itemsByPlan: Map<string, SetGamePlanItemsInput[]>;
  catalog: Map<string, GameCatalogEntry>;
  close: () => Promise<void>;
}

function makeCatalogEntry(id: string, slug: string): GameCatalogEntry {
  return {
    id,
    slug,
    displayName: slug,
    description: null,
    rules: {},
    ticketColors: ["gul"],
    ticketPricesCents: { gul: 1000 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000 },
    },
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    createdByUserId: "admin-1",
  };
}

function makePlan(
  overrides: Partial<GamePlan> & { id: string; name: string; hallId: string | null },
): GamePlan {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? null,
    hallId: overrides.hallId,
    groupOfHallsId: overrides.groupOfHallsId ?? null,
    weekdays: overrides.weekdays ?? ["mon", "tue"],
    startTime: overrides.startTime ?? "11:00",
    endTime: overrides.endTime ?? "21:00",
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? "2026-05-07T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-05-07T10:00:00Z",
    createdByUserId: overrides.createdByUserId ?? "admin-1",
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seedPlans: GamePlan[] = [],
  seedCatalog: GameCatalogEntry[] = [],
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const plans = new Map<string, GamePlan>();
  const itemsByPlan = new Map<string, SetGamePlanItemsInput[]>();
  for (const p of seedPlans) plans.set(p.id, p);
  const catalog = new Map<string, GameCatalogEntry>();
  for (const c of seedCatalog) catalog.set(c.id, c);

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = plans.size;
  const planService = {
    async list(filter: ListGamePlanFilter = {}) {
      let list = [...plans.values()];
      if (filter.hallId !== undefined) {
        list = list.filter((p) => p.hallId === filter.hallId);
      }
      if (filter.groupOfHallsId !== undefined) {
        list = list.filter((p) => p.groupOfHallsId === filter.groupOfHallsId);
      }
      if (filter.isActive !== undefined) {
        list = list.filter((p) => p.isActive === filter.isActive);
      }
      return list;
    },
    async getById(id: string): Promise<GamePlanWithItems | null> {
      const p = plans.get(id);
      if (!p) return null;
      const items = (itemsByPlan.get(id) ?? []).map((it, idx) => {
        const entry = catalog.get(it.gameCatalogId);
        if (!entry) {
          throw new DomainError(
            "GAME_CATALOG_NOT_FOUND",
            `catalog ${it.gameCatalogId} mangler`,
          );
        }
        return {
          id: `item-${id}-${idx}`,
          planId: id,
          position: idx + 1,
          gameCatalogId: it.gameCatalogId,
          bonusGameOverride: it.bonusGameOverride ?? null,
          notes: it.notes ?? null,
          createdAt: "2026-05-07T10:00:00Z",
          catalogEntry: entry,
        };
      });
      return { ...p, items };
    },
    async create(input: CreateGamePlanInput): Promise<GamePlanWithItems> {
      // Replikér service-XOR-validering.
      const hallId = input.hallId ?? null;
      const groupId = input.groupOfHallsId ?? null;
      if ((hallId && groupId) || (!hallId && !groupId)) {
        throw new DomainError(
          "INVALID_INPUT",
          "Plan må bindes til ENTEN hallId ELLER groupOfHallsId.",
        );
      }
      idCounter += 1;
      const id = `plan-${idCounter}`;
      const next = makePlan({
        id,
        name: input.name,
        description: input.description ?? null,
        hallId,
        groupOfHallsId: groupId,
        weekdays: input.weekdays,
        startTime: input.startTime,
        endTime: input.endTime,
        isActive: input.isActive ?? true,
        createdByUserId: input.createdByUserId,
      });
      plans.set(id, next);
      itemsByPlan.set(id, []);
      return { ...next, items: [] };
    },
    async update(id: string, patch: UpdateGamePlanInput): Promise<GamePlanWithItems> {
      const existing = plans.get(id);
      if (!existing) {
        throw new DomainError("GAME_PLAN_NOT_FOUND", "ikke funnet");
      }
      const next: GamePlan = { ...existing };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.description !== undefined) next.description = patch.description;
      if (patch.hallId !== undefined) next.hallId = patch.hallId;
      if (patch.groupOfHallsId !== undefined) {
        next.groupOfHallsId = patch.groupOfHallsId;
      }
      if (patch.weekdays !== undefined) next.weekdays = patch.weekdays;
      if (patch.startTime !== undefined) next.startTime = patch.startTime;
      if (patch.endTime !== undefined) next.endTime = patch.endTime;
      if (patch.isActive !== undefined) next.isActive = patch.isActive;
      next.updatedAt = new Date().toISOString();
      plans.set(id, next);
      // XOR re-validering.
      if (
        (next.hallId && next.groupOfHallsId) ||
        (!next.hallId && !next.groupOfHallsId)
      ) {
        throw new DomainError(
          "INVALID_INPUT",
          "Plan må bindes til ENTEN hallId ELLER groupOfHallsId.",
        );
      }
      const items = itemsByPlan.get(id) ?? [];
      const expandedItems = items.map((it, idx) => {
        const entry = catalog.get(it.gameCatalogId);
        if (!entry) throw new DomainError("GAME_CATALOG_NOT_FOUND", "");
        return {
          id: `item-${id}-${idx}`,
          planId: id,
          position: idx + 1,
          gameCatalogId: it.gameCatalogId,
          bonusGameOverride: it.bonusGameOverride ?? null,
          notes: it.notes ?? null,
          createdAt: "2026-05-07T10:00:00Z",
          catalogEntry: entry,
        };
      });
      return { ...next, items: expandedItems };
    },
    async deactivate(id: string) {
      const p = plans.get(id);
      if (!p) throw new DomainError("GAME_PLAN_NOT_FOUND", "ikke funnet");
      if (!p.isActive) return;
      plans.set(id, { ...p, isActive: false });
    },
    async setItems(
      planId: string,
      items: SetGamePlanItemsInput[],
    ): Promise<GamePlanWithItems> {
      const p = plans.get(planId);
      if (!p) throw new DomainError("GAME_PLAN_NOT_FOUND", "ikke funnet");
      // Replikér catalog-eksistens-sjekk.
      for (const it of items) {
        const entry = catalog.get(it.gameCatalogId);
        if (!entry) {
          throw new DomainError(
            "GAME_CATALOG_NOT_FOUND",
            `catalog ${it.gameCatalogId} mangler`,
          );
        }
        if (!entry.isActive) {
          throw new DomainError(
            "GAME_CATALOG_INACTIVE",
            `catalog ${it.gameCatalogId} er deaktivert`,
          );
        }
      }
      itemsByPlan.set(planId, items);
      return (await planService.getById(planId)) as GamePlanWithItems;
    },
    setAuditLogService() {},
  } as unknown as GamePlanService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGamePlansRouter({
      platformService,
      auditLogService,
      planService,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    plans,
    itemsByPlan,
    catalog,
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

test("Fase 2 plans: PLAYER blokkert overalt", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/game-plans", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("Fase 2 plans: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer(
    { "sup-tok": supportUser },
    [makePlan({ id: "plan-1", name: "Plan 1", hallId: "hall-a" })],
  );
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/game-plans", "sup-tok");
    assert.equal(list.status, 200);
    assert.equal(list.json.data.count, 1);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-plans",
      "sup-tok",
      {
        name: "Plan 2",
        hallId: "hall-b",
        weekdays: ["mon"],
        startTime: "11:00",
        endTime: "21:00",
      },
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("Fase 2 plans: HALL_OPERATOR auto-scopes til egen hall i list", async () => {
  const ctx = await startServer(
    { "op-tok": operatorUser },
    [
      makePlan({ id: "plan-a", name: "Plan A", hallId: "hall-a" }),
      makePlan({ id: "plan-b", name: "Plan B", hallId: "hall-b" }),
    ],
  );
  try {
    // operatorUser.hallId === "hall-a"
    const list = await req(ctx.baseUrl, "GET", "/api/admin/game-plans", "op-tok");
    assert.equal(list.status, 200);
    assert.equal(list.json.data.count, 1);
    assert.equal(list.json.data.plans[0].hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("Fase 2 plans: HALL_OPERATOR cross-hall-list avvises", async () => {
  const ctx = await startServer(
    { "op-tok": operatorUser },
    [makePlan({ id: "plan-b", name: "Plan B", hallId: "hall-b" })],
  );
  try {
    const list = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-plans?hallId=hall-b",
      "op-tok",
    );
    // resolveHallScopeFilter kaster FORBIDDEN
    assert.equal(list.status, 400);
    assert.equal(list.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── happy-path ──────────────────────────────────────────────────────────

test("Fase 2 plans: ADMIN kan opprette en plan", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-plans",
      "admin-tok",
      {
        name: "Hverdager",
        hallId: "hall-a",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startTime: "11:00",
        endTime: "21:00",
      },
    );
    assert.equal(post.status, 200);
    assert.equal(post.json.data.name, "Hverdager");
    assert.equal(post.json.data.hallId, "hall-a");
    assert.deepEqual(post.json.data.items, []);
  } finally {
    await ctx.close();
  }
});

test("Fase 2 plans: hall + group XOR-validering avviser begge", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-plans",
      "admin-tok",
      {
        name: "Plan",
        hallId: "hall-a",
        groupOfHallsId: "g-1",
        weekdays: ["mon"],
        startTime: "11:00",
        endTime: "21:00",
      },
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("Fase 2 plans: PUT oppdaterer plan-meta", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makePlan({ id: "plan-1", name: "Old", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/game-plans/plan-1",
      "admin-tok",
      { name: "New" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "New");
  } finally {
    await ctx.close();
  }
});

test("Fase 2 plans: PUT /items REPLACES sekvensen atomisk", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makePlan({ id: "plan-1", name: "P", hallId: "hall-a" })],
    [
      makeCatalogEntry("cat-1", "jackpot"),
      makeCatalogEntry("cat-2", "innsatsen"),
    ],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/game-plans/plan-1/items",
      "admin-tok",
      {
        items: [
          { gameCatalogId: "cat-1" },
          { gameCatalogId: "cat-2" },
          { gameCatalogId: "cat-2" }, // duplikat tillatt
        ],
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.items.length, 3);
    assert.equal(res.json.data.items[0].gameCatalogId, "cat-1");
    assert.equal(res.json.data.items[2].gameCatalogId, "cat-2");
    // Verifiser positions.
    assert.equal(res.json.data.items[0].position, 1);
    assert.equal(res.json.data.items[2].position, 3);
  } finally {
    await ctx.close();
  }
});

test("Fase 2 plans: PUT /items med ukjent catalog-id avvises", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makePlan({ id: "plan-1", name: "P", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/game-plans/plan-1/items",
      "admin-tok",
      { items: [{ gameCatalogId: "missing" }] },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_CATALOG_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("Fase 2 plans: DELETE soft-deactivates", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makePlan({ id: "plan-1", name: "P", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/game-plans/plan-1",
      "admin-tok",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.deactivated, true);
    assert.equal(ctx.plans.get("plan-1")?.isActive, false);
  } finally {
    await ctx.close();
  }
});

test("Fase 2 plans: GET ukjent id gir GAME_PLAN_NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-plans/missing",
      "admin-tok",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_PLAN_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── Tolkning A (2026-05-07): per-item bonus-override ────────────────────

test("Tolkning A plans: PUT /items godtar og forwarder bonusGameOverride", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makePlan({ id: "plan-1", name: "P", hallId: "hall-a" })],
    [makeCatalogEntry("cat-bingo", "bingo")],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/game-plans/plan-1/items",
      "admin-tok",
      {
        items: [
          { gameCatalogId: "cat-bingo", bonusGameOverride: "wheel_of_fortune" },
          { gameCatalogId: "cat-bingo", bonusGameOverride: null },
          { gameCatalogId: "cat-bingo" },
        ],
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.items.length, 3);
    assert.equal(res.json.ok, true);
  } finally {
    await ctx.close();
  }
});

test("Tolkning A plans: PUT /items avviser bonusGameOverride som ikke er streng/null", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makePlan({ id: "plan-1", name: "P", hallId: "hall-a" })],
    [makeCatalogEntry("cat-bingo", "bingo")],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/game-plans/plan-1/items",
      "admin-tok",
      {
        items: [
          {
            gameCatalogId: "cat-bingo",
            bonusGameOverride: 42,
          },
        ],
      },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
