/**
 * BIN-620: integrasjonstester for admin-game-types-router.
 *
 * Dekker alle 5 endepunkter:
 *   GET    /api/admin/game-types
 *   GET    /api/admin/game-types/:id
 *   POST   /api/admin/game-types
 *   PATCH  /api/admin/game-types/:id
 *   DELETE /api/admin/game-types/:id
 *
 * Testene bygger en stub-GameTypeService rundt et in-memory Map — samme
 * mønster som adminPatterns.test.ts + adminHallGroups.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGameTypesRouter } from "../adminGameTypes.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  GameTypeService,
  GameType,
  CreateGameTypeInput,
  UpdateGameTypeInput,
  ListGameTypeFilter,
} from "../../admin/GameTypeService.js";
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
    creates: GameType[];
    updates: Array<{ id: string; changed: string[] }>;
    removes: Array<{ id: string; hard: boolean }>;
  };
  gameTypes: Map<string, GameType>;
  close: () => Promise<void>;
}

function makeGameType(
  overrides: Partial<GameType> & { id: string; typeSlug: string; name: string }
): GameType {
  return {
    id: overrides.id,
    typeSlug: overrides.typeSlug,
    name: overrides.name,
    photo: overrides.photo ?? "",
    pattern: overrides.pattern ?? false,
    gridRows: overrides.gridRows ?? 5,
    gridColumns: overrides.gridColumns ?? 5,
    rangeMin: overrides.rangeMin ?? null,
    rangeMax: overrides.rangeMax ?? null,
    totalNoTickets: overrides.totalNoTickets ?? null,
    userMaxTickets: overrides.userMaxTickets ?? null,
    luckyNumbers: overrides.luckyNumbers ?? [],
    status: overrides.status ?? "active",
    extra: overrides.extra ?? {},
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: GameType[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const gameTypes = new Map<string, GameType>();
  for (const g of seed) gameTypes.set(g.id, g);

  const creates: GameType[] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const removes: Ctx["spies"]["removes"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = gameTypes.size;
  const gameTypeService = {
    async list(filter: ListGameTypeFilter = {}) {
      let list = [...gameTypes.values()].filter((g) => !g.deletedAt);
      if (filter.status) list = list.filter((g) => g.status === filter.status);
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const g = gameTypes.get(id);
      if (!g) throw new DomainError("GAME_TYPE_NOT_FOUND", "not found");
      return g;
    },
    async getBySlug(slug: string) {
      for (const g of gameTypes.values()) {
        if (g.typeSlug === slug && !g.deletedAt) return g;
      }
      return null;
    },
    async create(input: CreateGameTypeInput) {
      for (const g of gameTypes.values()) {
        if (!g.deletedAt && (g.typeSlug === input.typeSlug || g.name === input.name)) {
          throw new DomainError(
            "GAME_TYPE_DUPLICATE",
            `duplicate ${input.typeSlug}/${input.name}`
          );
        }
      }
      idCounter += 1;
      const id = `gt-${idCounter}`;
      const next = makeGameType({
        id,
        typeSlug: input.typeSlug,
        name: input.name,
        photo: input.photo ?? "",
        pattern: input.pattern ?? false,
        gridRows: input.gridRows ?? 5,
        gridColumns: input.gridColumns ?? 5,
        rangeMin: input.rangeMin ?? null,
        rangeMax: input.rangeMax ?? null,
        totalNoTickets: input.totalNoTickets ?? null,
        userMaxTickets: input.userMaxTickets ?? null,
        luckyNumbers: input.luckyNumbers ?? [],
        status: input.status ?? "active",
        extra: input.extra ?? {},
        createdBy: input.createdBy,
      });
      gameTypes.set(id, next);
      creates.push(next);
      return next;
    },
    async update(id: string, update: UpdateGameTypeInput) {
      const g = gameTypes.get(id);
      if (!g) throw new DomainError("GAME_TYPE_NOT_FOUND", "not found");
      if (g.deletedAt) throw new DomainError("GAME_TYPE_DELETED", "deleted");
      updates.push({ id, changed: Object.keys(update) });
      const next: GameType = { ...g };
      if (update.typeSlug !== undefined) {
        for (const other of gameTypes.values()) {
          if (other.id !== id && !other.deletedAt && other.typeSlug === update.typeSlug) {
            throw new DomainError(
              "GAME_TYPE_DUPLICATE",
              `duplicate slug ${update.typeSlug}`
            );
          }
        }
        next.typeSlug = update.typeSlug;
      }
      if (update.name !== undefined) {
        for (const other of gameTypes.values()) {
          if (other.id !== id && !other.deletedAt && other.name === update.name) {
            throw new DomainError(
              "GAME_TYPE_DUPLICATE",
              `duplicate name ${update.name}`
            );
          }
        }
        next.name = update.name;
      }
      if (update.photo !== undefined) next.photo = update.photo;
      if (update.pattern !== undefined) next.pattern = update.pattern;
      if (update.gridRows !== undefined) next.gridRows = update.gridRows;
      if (update.gridColumns !== undefined) next.gridColumns = update.gridColumns;
      if (update.rangeMin !== undefined) next.rangeMin = update.rangeMin;
      if (update.rangeMax !== undefined) next.rangeMax = update.rangeMax;
      if (update.totalNoTickets !== undefined) next.totalNoTickets = update.totalNoTickets;
      if (update.userMaxTickets !== undefined) next.userMaxTickets = update.userMaxTickets;
      if (update.luckyNumbers !== undefined) next.luckyNumbers = update.luckyNumbers;
      if (update.status !== undefined) next.status = update.status;
      if (update.extra !== undefined) next.extra = update.extra;
      next.updatedAt = new Date().toISOString();
      gameTypes.set(id, next);
      return next;
    },
    async remove(id: string, options: { hard?: boolean } = {}) {
      const g = gameTypes.get(id);
      if (!g) throw new DomainError("GAME_TYPE_NOT_FOUND", "not found");
      if (g.deletedAt) throw new DomainError("GAME_TYPE_DELETED", "already deleted");
      removes.push({ id, hard: Boolean(options.hard) });
      if (options.hard) {
        gameTypes.delete(id);
        return { softDeleted: false };
      }
      gameTypes.set(id, {
        ...g,
        deletedAt: new Date().toISOString(),
        status: "inactive",
      });
      return { softDeleted: true };
    },
    async count(): Promise<number> {
      return [...gameTypes.values()].filter((g) => !g.deletedAt).length;
    },
  } as unknown as GameTypeService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGameTypesRouter({
      platformService,
      auditLogService,
      gameTypeService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, creates, updates, removes },
    gameTypes,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown
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

// ── RBAC ─────────────────────────────────────────────────────────────────────

test("BIN-620: PLAYER blokkert fra alle game-type-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/game-types", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-types",
      "pl-tok",
      { typeSlug: "game_1", name: "Game 1" }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-620: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "Game 1" }),
  ]);
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/game-types", "sup-tok");
    assert.equal(list.status, 200);

    const detail = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-types/gt-1",
      "sup-tok"
    );
    assert.equal(detail.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-types",
      "sup-tok",
      { typeSlug: "game_2", name: "Game 2" }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const patch = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/game-types/gt-1",
      "sup-tok",
      { name: "Blocked" }
    );
    assert.equal(patch.status, 400);
    assert.equal(patch.json.error.code, "FORBIDDEN");

    const del = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/game-types/gt-1",
      "sup-tok"
    );
    assert.equal(del.status, 400);
    assert.equal(del.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-620: HALL_OPERATOR kan READ men IKKE WRITE (ADMIN-only write)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "Game 1" }),
  ]);
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/game-types", "op-tok");
    assert.equal(list.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-types",
      "op-tok",
      { typeSlug: "game_2", name: "Game 2" }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-620: ADMIN kan både READ og WRITE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-types",
      "admin-tok",
      { typeSlug: "game_1", name: "Game 1", pattern: true }
    );
    assert.equal(post.status, 200);
    assert.equal(post.json.data.typeSlug, "game_1");
    assert.equal(post.json.data.pattern, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-620: uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/game-types");
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  } finally {
    await ctx.close();
  }
});

// ── GET list ─────────────────────────────────────────────────────────────────

test("BIN-620: GET list returnerer alle (ikke-slettet) GameTypes uten filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "Game 1" }),
    makeGameType({ id: "gt-2", typeSlug: "game_2", name: "Game 2" }),
    makeGameType({
      id: "gt-3",
      typeSlug: "game_3",
      name: "Game 3",
      status: "inactive",
    }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/game-types", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 3);
    assert.equal(res.json.data.gameTypes.length, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-620: GET list med status-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "G1", status: "active" }),
    makeGameType({ id: "gt-2", typeSlug: "game_2", name: "G2", status: "inactive" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-types?status=active",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.gameTypes[0].id, "gt-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-620: GET list — wire-shape har ingen deletedAt", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "G1" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/game-types", "admin-tok");
    assert.equal(res.status, 200);
    assert.ok(!("deletedAt" in res.json.data.gameTypes[0]));
  } finally {
    await ctx.close();
  }
});

// ── GET detail ──────────────────────────────────────────────────────────────

test("BIN-620: GET detail 404 på ukjent id", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-types/missing",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_TYPE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-620: GET detail returnerer full row", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGameType({
      id: "gt-1",
      typeSlug: "game_1",
      name: "Game 1",
      pattern: true,
      luckyNumbers: [5, 10],
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-types/gt-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "gt-1");
    assert.equal(res.json.data.typeSlug, "game_1");
    assert.equal(res.json.data.pattern, true);
    assert.deepEqual(res.json.data.luckyNumbers, [5, 10]);
  } finally {
    await ctx.close();
  }
});

// ── POST ─────────────────────────────────────────────────────────────────────

test("BIN-620: POST oppretter GameType + audit-log", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-types",
      "admin-tok",
      {
        typeSlug: "bingo",
        name: "Bingo 75",
        photo: "bingo.png",
        pattern: true,
        gridRows: 5,
        gridColumns: 5,
        rangeMin: 1,
        rangeMax: 75,
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.typeSlug, "bingo");
    assert.equal(res.json.data.pattern, true);
    assert.equal(res.json.data.rangeMax, 75);
    assert.equal(ctx.spies.creates.length, 1);

    const evt = await waitForAudit(ctx.spies.auditStore, "admin.game_type.created");
    assert.ok(evt, "audit-event 'admin.game_type.created' skal være skrevet");
    assert.equal(evt!.actorId, "admin-1");
    assert.equal(evt!.resource, "game_type");
  } finally {
    await ctx.close();
  }
});

test("BIN-620: POST avviser tom payload", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-types",
      "admin-tok",
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-620: POST duplikat slug gir GAME_TYPE_DUPLICATE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "G1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-types",
      "admin-tok",
      { typeSlug: "game_1", name: "Annen" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_TYPE_DUPLICATE");
  } finally {
    await ctx.close();
  }
});

// ── PATCH ────────────────────────────────────────────────────────────────────

test("BIN-620: PATCH oppdaterer felter + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "Game 1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/game-types/gt-1",
      "admin-tok",
      { name: "Oppdatert navn", pattern: true }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "Oppdatert navn");
    assert.equal(res.json.data.pattern, true);
    assert.equal(ctx.spies.updates.length, 1);
    assert.deepEqual(ctx.spies.updates[0]!.changed.sort(), ["name", "pattern"]);

    const evt = await waitForAudit(ctx.spies.auditStore, "admin.game_type.updated");
    assert.ok(evt);
  } finally {
    await ctx.close();
  }
});

test("BIN-620: PATCH ukjent id gir NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/game-types/missing",
      "admin-tok",
      { name: "Ny" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_TYPE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-620: PATCH avviser ikke-objekt payload", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "Game 1" }),
  ]);
  try {
    // Array er et JSON-parsebart ikke-objekt — router-laget skal avvise det.
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/game-types/gt-1",
      "admin-tok",
      ["not", "an", "object"]
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────

test("BIN-620: DELETE default er soft-delete + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "Game 1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/game-types/gt-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);
    assert.equal(ctx.spies.removes[0]!.hard, false);

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.game_type.soft_deleted"
    );
    assert.ok(evt);
  } finally {
    await ctx.close();
  }
});

test("BIN-620: DELETE ?hard=true gjør hard-delete", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGameType({ id: "gt-1", typeSlug: "game_1", name: "Game 1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/game-types/gt-1?hard=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, false);
    assert.equal(ctx.spies.removes[0]!.hard, true);

    const evt = await waitForAudit(ctx.spies.auditStore, "admin.game_type.deleted");
    assert.ok(evt);
  } finally {
    await ctx.close();
  }
});

test("BIN-620: DELETE ukjent id gir NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/game-types/missing",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_TYPE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});
