/**
 * BIN-622: integrasjonstester for admin-game-management-router.
 *
 * Dekker alle 6 endepunkter:
 *   GET    /api/admin/game-management
 *   GET    /api/admin/game-management/:typeId/:id
 *   POST   /api/admin/game-management
 *   PATCH  /api/admin/game-management/:id
 *   POST   /api/admin/game-management/:id/repeat
 *   DELETE /api/admin/game-management/:id
 *
 * Testene bygger en stub-GameManagementService rundt et in-memory Map,
 * på samme pattern som adminVouchers.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGameManagementRouter } from "../adminGameManagement.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  GameManagementService,
  GameManagement,
  CreateGameManagementInput,
  UpdateGameManagementInput,
  RepeatGameManagementInput,
  ListGameManagementFilter,
} from "../../admin/GameManagementService.js";
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
    creates: GameManagement[];
    updates: Array<{ id: string; changed: string[] }>;
    removes: Array<{ id: string; hard: boolean }>;
    repeats: Array<RepeatGameManagementInput>;
  };
  games: Map<string, GameManagement>;
  close: () => Promise<void>;
}

function makeGame(overrides: Partial<GameManagement> & { id: string; gameTypeId: string }): GameManagement {
  return {
    id: overrides.id,
    gameTypeId: overrides.gameTypeId,
    parentId: overrides.parentId ?? null,
    name: overrides.name ?? `Game ${overrides.id}`,
    ticketType: overrides.ticketType ?? "Large",
    ticketPrice: overrides.ticketPrice ?? 1000,
    startDate: overrides.startDate ?? "2026-05-01T10:00:00Z",
    endDate: overrides.endDate ?? null,
    status: overrides.status ?? "active",
    totalSold: overrides.totalSold ?? 0,
    totalEarning: overrides.totalEarning ?? 0,
    config: overrides.config ?? {},
    repeatedFromId: overrides.repeatedFromId ?? null,
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: GameManagement[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const games = new Map<string, GameManagement>();
  for (const g of seed) games.set(g.id, g);

  const creates: GameManagement[] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const removes: Ctx["spies"]["removes"] = [];
  const repeats: RepeatGameManagementInput[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = games.size;
  const gameManagementService = {
    async list(filter: ListGameManagementFilter = {}) {
      let list = [...games.values()].filter((g) => !g.deletedAt);
      if (filter.gameTypeId) list = list.filter((g) => g.gameTypeId === filter.gameTypeId);
      if (filter.status) list = list.filter((g) => g.status === filter.status);
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const g = games.get(id);
      if (!g) throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      return g;
    },
    async create(input: CreateGameManagementInput) {
      idCounter += 1;
      const id = `gm-${idCounter}`;
      const g = makeGame({
        id,
        gameTypeId: input.gameTypeId,
        parentId: input.parentId ?? null,
        name: input.name,
        ticketType: input.ticketType ?? null,
        ticketPrice: input.ticketPrice ?? 0,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        status: input.status ?? "inactive",
        config: input.config ?? {},
        repeatedFromId: input.repeatedFromId ?? null,
        createdBy: input.createdBy,
      });
      games.set(id, g);
      creates.push(g);
      return g;
    },
    async update(id: string, update: UpdateGameManagementInput) {
      const g = games.get(id);
      if (!g) throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      updates.push({ id, changed: Object.keys(update) });
      const next: GameManagement = { ...g };
      if (update.name !== undefined) next.name = update.name;
      if (update.ticketType !== undefined) next.ticketType = update.ticketType;
      if (update.ticketPrice !== undefined) next.ticketPrice = update.ticketPrice;
      if (update.startDate !== undefined) next.startDate = update.startDate;
      if (update.endDate !== undefined) next.endDate = update.endDate;
      if (update.status !== undefined) next.status = update.status;
      if (update.parentId !== undefined) next.parentId = update.parentId;
      if (update.config !== undefined) next.config = update.config;
      if (update.totalSold !== undefined) next.totalSold = update.totalSold;
      if (update.totalEarning !== undefined) next.totalEarning = update.totalEarning;
      next.updatedAt = new Date().toISOString();
      games.set(id, next);
      return next;
    },
    async remove(id: string, options: { hard?: boolean } = {}) {
      const g = games.get(id);
      if (!g) throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      removes.push({ id, hard: Boolean(options.hard) });
      const canHard =
        options.hard &&
        g.totalSold === 0 &&
        g.totalEarning === 0 &&
        (g.status === "inactive" || g.status === "active");
      if (canHard) {
        games.delete(id);
        return { softDeleted: false };
      }
      games.set(id, {
        ...g,
        deletedAt: new Date().toISOString(),
        status: "inactive",
      });
      return { softDeleted: true };
    },
    async repeat(input: RepeatGameManagementInput) {
      const source = games.get(input.sourceId);
      if (!source) throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      repeats.push(input);

      // Idempotency: re-use eksisterende rad hvis samme token
      if (input.repeatToken) {
        for (const g of games.values()) {
          if (
            g.repeatedFromId === input.sourceId &&
            g.createdBy === input.createdBy &&
            (g.config as Record<string, unknown>).repeatToken === input.repeatToken &&
            !g.deletedAt
          ) {
            return g;
          }
        }
      }

      idCounter += 1;
      const id = `gm-${idCounter}`;
      const config = { ...source.config } as Record<string, unknown>;
      if (input.repeatToken) config.repeatToken = input.repeatToken;
      const next = makeGame({
        id,
        gameTypeId: source.gameTypeId,
        parentId: source.parentId,
        name:
          typeof input.name === "string" && input.name.trim()
            ? input.name.trim()
            : `${source.name} (repeat)`,
        ticketType: source.ticketType,
        ticketPrice: source.ticketPrice,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        status: "inactive",
        totalSold: 0,
        totalEarning: 0,
        config,
        repeatedFromId: source.id,
        createdBy: input.createdBy,
      });
      games.set(id, next);
      return next;
    },
  } as unknown as GameManagementService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGameManagementRouter({
      platformService,
      auditLogService,
      gameManagementService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, creates, updates, removes, repeats },
    games,
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

test("BIN-622: PLAYER blokkert fra alle game-management-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/game-management", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(ctx.baseUrl, "POST", "/api/admin/game-management", "pl-tok", {
      gameTypeId: "bingo",
      name: "Test",
      startDate: "2026-05-01T10:00:00Z",
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-622: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo" }),
  ]);
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/game-management", "sup-tok");
    assert.equal(list.status, 200);

    const detail = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-management/bingo/gm-1",
      "sup-tok"
    );
    assert.equal(detail.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/game-management", "sup-tok", {
      gameTypeId: "bingo",
      name: "Test",
      startDate: "2026-05-01T10:00:00Z",
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const del = await req(ctx.baseUrl, "DELETE", "/api/admin/game-management/gm-1", "sup-tok");
    assert.equal(del.status, 400);
    assert.equal(del.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-622: HALL_OPERATOR kan både READ og WRITE", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/game-management", "op-tok");
    assert.equal(list.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/game-management", "op-tok", {
      gameTypeId: "bingo",
      name: "Hall-local game",
      startDate: "2026-05-01T10:00:00Z",
    });
    assert.equal(post.status, 200);
    assert.equal(post.json.data.name, "Hall-local game");
  } finally {
    await ctx.close();
  }
});

// ── GET list ─────────────────────────────────────────────────────────────────

test("BIN-622: GET list returnerer alle games uten filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo" }),
    makeGame({ id: "gm-2", gameTypeId: "rocket" }),
    makeGame({ id: "gm-3", gameTypeId: "bingo", status: "closed" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/game-management", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 3);
    assert.equal(res.json.data.games.length, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-622: GET list med gameTypeId-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo" }),
    makeGame({ id: "gm-2", gameTypeId: "rocket" }),
    makeGame({ id: "gm-3", gameTypeId: "bingo", status: "closed" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-management?gameTypeId=bingo",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
    for (const g of res.json.data.games) {
      assert.equal(g.gameTypeId, "bingo");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-622: GET list med status-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo", status: "active" }),
    makeGame({ id: "gm-2", gameTypeId: "bingo", status: "running" }),
    makeGame({ id: "gm-3", gameTypeId: "bingo", status: "closed" }),
  ]);
  try {
    const active = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-management?status=active",
      "admin-tok"
    );
    assert.equal(active.json.data.count, 1);
    const running = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-management?status=running",
      "admin-tok"
    );
    assert.equal(running.json.data.count, 1);
  } finally {
    await ctx.close();
  }
});

test("BIN-622: GET list med ugyldig status → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-management?status=banana",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-622: GET list eksponerer ikke deletedAt i wire-shape", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/game-management", "admin-tok");
    assert.equal(res.status, 200);
    const row = res.json.data.games[0];
    assert.ok(row);
    assert.equal(row.deletedAt, undefined);
    // Men de andre feltene skal være der:
    assert.equal(row.id, "gm-1");
    assert.equal(row.gameTypeId, "bingo");
    assert.ok(row.createdAt);
    assert.ok(row.updatedAt);
  } finally {
    await ctx.close();
  }
});

// ── GET detail (typeId + id) ─────────────────────────────────────────────────

test("BIN-622: GET detail returnerer full rad", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo", name: "Morning game" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-management/bingo/gm-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "gm-1");
    assert.equal(res.json.data.name, "Morning game");
    assert.equal(res.json.data.gameTypeId, "bingo");
  } finally {
    await ctx.close();
  }
});

test("BIN-622: GET detail med feil typeId → NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-management/rocket/gm-1",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_MANAGEMENT_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-622: GET detail ukjent id → NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/game-management/bingo/gm-999",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_MANAGEMENT_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── POST create ──────────────────────────────────────────────────────────────

test("BIN-622: POST oppretter rad + audit admin.game_management.created", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/game-management", "admin-tok", {
      gameTypeId: "bingo",
      name: "Friday Night Bingo",
      ticketType: "Large",
      ticketPrice: 1500,
      startDate: "2026-05-15T18:00:00Z",
      endDate: "2026-05-15T20:00:00Z",
      status: "active",
      config: { prizeTiers: [{ name: "line", percent: 30 }] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "Friday Night Bingo");
    assert.equal(res.json.data.gameTypeId, "bingo");
    assert.equal(res.json.data.ticketPrice, 1500);
    assert.equal(ctx.spies.creates.length, 1);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.game_management.created");
    assert.ok(event);
    assert.equal(event!.actorType, "ADMIN");
    assert.equal(event!.resource, "game_management");
    assert.equal(event!.details.gameTypeId, "bingo");
    assert.equal(event!.details.ticketPrice, 1500);
  } finally {
    await ctx.close();
  }
});

test("BIN-622: POST validerer required fields", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    // Tomt body
    const r1 = await req(ctx.baseUrl, "POST", "/api/admin/game-management", "admin-tok", {});
    assert.equal(r1.status, 400);
    assert.equal(r1.json.error.code, "INVALID_INPUT");

    // Mangler name
    const r2 = await req(ctx.baseUrl, "POST", "/api/admin/game-management", "admin-tok", {
      gameTypeId: "bingo",
    });
    assert.equal(r2.status, 400);

    // Mangler startDate
    const r3 = await req(ctx.baseUrl, "POST", "/api/admin/game-management", "admin-tok", {
      gameTypeId: "bingo",
      name: "Test",
    });
    assert.equal(r3.status, 400);
  } finally {
    await ctx.close();
  }
});

test("BIN-622: POST avviser config som array", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/game-management", "admin-tok", {
      gameTypeId: "bingo",
      name: "Test",
      startDate: "2026-05-01T10:00:00Z",
      config: ["invalid"],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── PATCH update ─────────────────────────────────────────────────────────────

test("BIN-622: PATCH endrer felter + audit changed-liste", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo", name: "Old", status: "active" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "PATCH", "/api/admin/game-management/gm-1", "admin-tok", {
      name: "New name",
      status: "running",
      ticketPrice: 2000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "New name");
    assert.equal(res.json.data.status, "running");

    assert.deepEqual(
      ctx.spies.updates[0]!.changed.sort(),
      ["name", "status", "ticketPrice"]
    );

    const event = await waitForAudit(ctx.spies.auditStore, "admin.game_management.updated");
    assert.ok(event);
    assert.deepEqual(
      (event!.details.changed as string[]).sort(),
      ["name", "status", "ticketPrice"]
    );
    assert.equal(event!.details.newStatus, "running");
  } finally {
    await ctx.close();
  }
});

test("BIN-622: PATCH ukjent id → NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "PATCH", "/api/admin/game-management/gm-xx", "admin-tok", {
      name: "X",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_MANAGEMENT_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-622: PATCH kan oppdatere config-objektet", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo", config: { a: 1 } }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "PATCH", "/api/admin/game-management/gm-1", "admin-tok", {
      config: { b: 2, nested: { deep: "value" } },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data.config, { b: 2, nested: { deep: "value" } });
  } finally {
    await ctx.close();
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────

test("BIN-622: DELETE soft-delete default + audit admin.game_management.soft_deleted", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo", status: "running", totalSold: 10 }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/game-management/gm-1", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.game_management.soft_deleted");
    assert.ok(event);
    assert.equal(event!.details.softDeleted, true);
    assert.equal(event!.details.totalSold, 10);
  } finally {
    await ctx.close();
  }
});

test("BIN-622: DELETE ?hard=true for ubrukt rad + audit admin.game_management.deleted", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({
      id: "gm-1",
      gameTypeId: "bingo",
      status: "inactive",
      totalSold: 0,
      totalEarning: 0,
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/game-management/gm-1?hard=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, false);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.game_management.deleted");
    assert.ok(event);
    assert.equal(event!.details.softDeleted, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-622: DELETE ?hard=true men har sold → fallback til soft-delete", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({
      id: "gm-1",
      gameTypeId: "bingo",
      status: "running",
      totalSold: 5,
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/game-management/gm-1?hard=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    // Har solgte billetter → service faller tilbake til soft
    assert.equal(res.json.data.softDeleted, true);
  } finally {
    await ctx.close();
  }
});

// ── POST repeat ──────────────────────────────────────────────────────────────

test("BIN-622: POST repeat kopierer rad + audit admin.game_management.repeated", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({
      id: "gm-1",
      gameTypeId: "bingo",
      name: "Original",
      ticketPrice: 1500,
      ticketType: "Large",
      config: { prizeTiers: [{ name: "line", percent: 30 }] },
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-management/gm-1/repeat",
      "admin-tok",
      {
        startDate: "2026-06-01T18:00:00Z",
        endDate: "2026-06-01T20:00:00Z",
      }
    );
    assert.equal(res.status, 200);
    assert.notEqual(res.json.data.id, "gm-1");
    assert.equal(res.json.data.name, "Original (repeat)");
    assert.equal(res.json.data.ticketPrice, 1500);
    assert.equal(res.json.data.ticketType, "Large");
    assert.equal(res.json.data.status, "inactive");
    assert.equal(res.json.data.startDate, "2026-06-01T18:00:00Z");
    assert.equal(res.json.data.repeatedFromId, "gm-1");
    assert.deepEqual(res.json.data.config, {
      prizeTiers: [{ name: "line", percent: 30 }],
    });

    const event = await waitForAudit(ctx.spies.auditStore, "admin.game_management.repeated");
    assert.ok(event);
    assert.equal(event!.details.sourceId, "gm-1");
    assert.equal(event!.details.newName, "Original (repeat)");
    assert.equal(event!.details.repeatTokenPresent, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-622: POST repeat med eksplisitt name-override", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo", name: "Original" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-management/gm-1/repeat",
      "admin-tok",
      {
        startDate: "2026-06-01T18:00:00Z",
        name: "Custom name",
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "Custom name");
  } finally {
    await ctx.close();
  }
});

test("BIN-622: POST repeat idempotent — samme repeatToken returnerer samme rad", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo", name: "Original" }),
  ]);
  try {
    const r1 = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-management/gm-1/repeat",
      "admin-tok",
      {
        startDate: "2026-06-01T18:00:00Z",
        repeatToken: "tok-abc-123",
      }
    );
    assert.equal(r1.status, 200);
    const firstId = r1.json.data.id;

    const r2 = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-management/gm-1/repeat",
      "admin-tok",
      {
        startDate: "2026-06-01T18:00:00Z",
        repeatToken: "tok-abc-123",
      }
    );
    assert.equal(r2.status, 200);
    assert.equal(r2.json.data.id, firstId, "same repeatToken should return same id");

    // Ulik token → ny rad
    const r3 = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-management/gm-1/repeat",
      "admin-tok",
      {
        startDate: "2026-06-01T18:00:00Z",
        repeatToken: "tok-different",
      }
    );
    assert.equal(r3.status, 200);
    assert.notEqual(r3.json.data.id, firstId);
  } finally {
    await ctx.close();
  }
});

test("BIN-622: POST repeat ukjent sourceId → NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-management/gm-xx/repeat",
      "admin-tok",
      { startDate: "2026-06-01T18:00:00Z" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_MANAGEMENT_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-622: POST repeat mangler startDate → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGame({ id: "gm-1", gameTypeId: "bingo" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/game-management/gm-1/repeat",
      "admin-tok",
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
