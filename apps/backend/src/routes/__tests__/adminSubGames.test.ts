/**
 * BIN-621: integrasjonstester for admin-sub-games-router.
 *
 * Dekker alle 5 endepunkter:
 *   GET    /api/admin/sub-games
 *   GET    /api/admin/sub-games/:id
 *   POST   /api/admin/sub-games
 *   PATCH  /api/admin/sub-games/:id
 *   DELETE /api/admin/sub-games/:id
 *
 * Testene bygger en stub-SubGameService rundt et in-memory Map — samme
 * mønster som adminGameTypes.test.ts + adminPatterns.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminSubGamesRouter } from "../adminSubGames.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  SubGameService,
  SubGame,
  CreateSubGameInput,
  UpdateSubGameInput,
  ListSubGameFilter,
} from "../../admin/SubGameService.js";
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
    creates: SubGame[];
    updates: Array<{ id: string; changed: string[] }>;
    removes: Array<{ id: string; hard: boolean }>;
  };
  subGames: Map<string, SubGame>;
  close: () => Promise<void>;
}

function makeSubGame(
  overrides: Partial<SubGame> & {
    id: string;
    gameTypeId: string;
    name: string;
  }
): SubGame {
  return {
    id: overrides.id,
    gameTypeId: overrides.gameTypeId,
    gameName: overrides.gameName ?? overrides.name,
    name: overrides.name,
    subGameNumber: overrides.subGameNumber ?? `SG_${overrides.id}`,
    patternRows: overrides.patternRows ?? [],
    ticketColors: overrides.ticketColors ?? [],
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
  seed: SubGame[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const subGames = new Map<string, SubGame>();
  for (const g of seed) subGames.set(g.id, g);

  const creates: SubGame[] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const removes: Ctx["spies"]["removes"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = subGames.size;
  const subGameService = {
    async list(filter: ListSubGameFilter = {}) {
      let list = [...subGames.values()].filter((g) => !g.deletedAt);
      if (filter.gameTypeId) {
        list = list.filter((g) => g.gameTypeId === filter.gameTypeId);
      }
      if (filter.status) list = list.filter((g) => g.status === filter.status);
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const g = subGames.get(id);
      if (!g) throw new DomainError("SUB_GAME_NOT_FOUND", "not found");
      return g;
    },
    async create(input: CreateSubGameInput) {
      for (const g of subGames.values()) {
        if (
          !g.deletedAt &&
          g.gameTypeId === input.gameTypeId &&
          g.name === input.name
        ) {
          throw new DomainError(
            "SUB_GAME_DUPLICATE",
            `duplicate ${input.gameTypeId}/${input.name}`
          );
        }
      }
      idCounter += 1;
      const id = `sg-${idCounter}`;
      const next = makeSubGame({
        id,
        gameTypeId: input.gameTypeId,
        gameName: input.gameName ?? input.name,
        name: input.name,
        subGameNumber: input.subGameNumber ?? `SG_${id}`,
        patternRows: input.patternRows ?? [],
        ticketColors: input.ticketColors ?? [],
        status: input.status ?? "active",
        extra: input.extra ?? {},
        createdBy: input.createdBy,
      });
      subGames.set(id, next);
      creates.push(next);
      return next;
    },
    async update(id: string, update: UpdateSubGameInput) {
      const g = subGames.get(id);
      if (!g) throw new DomainError("SUB_GAME_NOT_FOUND", "not found");
      if (g.deletedAt) throw new DomainError("SUB_GAME_DELETED", "deleted");
      updates.push({ id, changed: Object.keys(update) });
      const next: SubGame = { ...g };
      if (update.gameName !== undefined) next.gameName = update.gameName;
      if (update.name !== undefined) {
        for (const other of subGames.values()) {
          if (
            other.id !== id &&
            !other.deletedAt &&
            other.gameTypeId === g.gameTypeId &&
            other.name === update.name
          ) {
            throw new DomainError(
              "SUB_GAME_DUPLICATE",
              `duplicate name ${update.name}`
            );
          }
        }
        next.name = update.name;
      }
      if (update.subGameNumber !== undefined) next.subGameNumber = update.subGameNumber;
      if (update.patternRows !== undefined) next.patternRows = update.patternRows;
      if (update.ticketColors !== undefined) next.ticketColors = update.ticketColors;
      if (update.status !== undefined) next.status = update.status;
      if (update.extra !== undefined) next.extra = update.extra;
      next.updatedAt = new Date().toISOString();
      subGames.set(id, next);
      return next;
    },
    async remove(id: string, options: { hard?: boolean } = {}) {
      const g = subGames.get(id);
      if (!g) throw new DomainError("SUB_GAME_NOT_FOUND", "not found");
      if (g.deletedAt) throw new DomainError("SUB_GAME_DELETED", "already deleted");
      removes.push({ id, hard: Boolean(options.hard) });
      if (options.hard) {
        subGames.delete(id);
        return { softDeleted: false };
      }
      subGames.set(id, {
        ...g,
        deletedAt: new Date().toISOString(),
        status: "inactive",
      });
      return { softDeleted: true };
    },
    async count(): Promise<number> {
      return [...subGames.values()].filter((g) => !g.deletedAt).length;
    },
  } as unknown as SubGameService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminSubGamesRouter({
      platformService,
      auditLogService,
      subGameService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, creates, updates, removes },
    subGames,
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

test("BIN-621: PLAYER blokkert fra alle sub-game-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/sub-games", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/sub-games",
      "pl-tok",
      { gameTypeId: "game_1", name: "Pattern 1" }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "Pattern 1" }),
  ]);
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/sub-games", "sup-tok");
    assert.equal(list.status, 200);

    const detail = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/sub-games/sg-1",
      "sup-tok"
    );
    assert.equal(detail.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/sub-games",
      "sup-tok",
      { gameTypeId: "game_1", name: "Pattern 2" }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const patch = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/sub-games/sg-1",
      "sup-tok",
      { name: "Blocked" }
    );
    assert.equal(patch.status, 400);
    assert.equal(patch.json.error.code, "FORBIDDEN");

    const del = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/sub-games/sg-1",
      "sup-tok"
    );
    assert.equal(del.status, 400);
    assert.equal(del.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: HALL_OPERATOR kan både READ og WRITE (samme som PATTERN_WRITE)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/sub-games", "op-tok");
    assert.equal(list.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/sub-games",
      "op-tok",
      { gameTypeId: "game_1", name: "Pattern 1" }
    );
    assert.equal(post.status, 200);
    assert.equal(post.json.data.name, "Pattern 1");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: ADMIN kan både READ og WRITE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/sub-games",
      "admin-tok",
      { gameTypeId: "game_1", name: "Pattern 1" }
    );
    assert.equal(post.status, 200);
    assert.equal(post.json.data.gameTypeId, "game_1");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/sub-games");
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  } finally {
    await ctx.close();
  }
});

// ── GET list ─────────────────────────────────────────────────────────────────

test("BIN-621: GET list returnerer alle (ikke-slettet) SubGames uten filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
    makeSubGame({ id: "sg-2", gameTypeId: "game_1", name: "P2" }),
    makeSubGame({
      id: "sg-3",
      gameTypeId: "game_3",
      name: "P3",
      status: "inactive",
    }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/sub-games", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 3);
    assert.equal(res.json.data.subGames.length, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-621: GET list med gameType-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
    makeSubGame({ id: "sg-2", gameTypeId: "game_3", name: "P2" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/sub-games?gameType=game_1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.subGames[0].gameTypeId, "game_1");
    assert.equal(res.json.data.subGames[0].name, "P1");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: GET list med gameTypeId-alias-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
    makeSubGame({ id: "sg-2", gameTypeId: "game_3", name: "P2" }),
  ]);
  try {
    // Alias-variant: gameTypeId= støttes sammen med gameType=
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/sub-games?gameTypeId=game_3",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.subGames[0].gameTypeId, "game_3");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: GET list med status-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1", status: "active" }),
    makeSubGame({ id: "sg-2", gameTypeId: "game_1", name: "P2", status: "inactive" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/sub-games?status=active",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.subGames[0].id, "sg-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: GET list — wire-shape har ingen deletedAt", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/sub-games", "admin-tok");
    assert.equal(res.status, 200);
    assert.ok(!("deletedAt" in res.json.data.subGames[0]));
  } finally {
    await ctx.close();
  }
});

// ── GET detail ──────────────────────────────────────────────────────────────

test("BIN-621: GET detail 404 på ukjent id", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/sub-games/missing",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SUB_GAME_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: GET detail returnerer full row", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({
      id: "sg-1",
      gameTypeId: "game_1",
      name: "Pattern 1",
      patternRows: [
        { patternId: "p-1", name: "Top" },
        { patternId: "p-2", name: "Diag" },
      ],
      ticketColors: ["Red", "Blue"],
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/sub-games/sg-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "sg-1");
    assert.equal(res.json.data.gameTypeId, "game_1");
    assert.equal(res.json.data.patternRows.length, 2);
    assert.deepEqual(res.json.data.ticketColors, ["Red", "Blue"]);
  } finally {
    await ctx.close();
  }
});

// ── POST ─────────────────────────────────────────────────────────────────────

test("BIN-621: POST oppretter SubGame + audit-log", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/sub-games",
      "admin-tok",
      {
        gameTypeId: "game_1",
        gameName: "Game1",
        name: "4-in-a-row",
        patternRows: [{ patternId: "p-1", name: "Top" }],
        ticketColors: ["Red", "Blue"],
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.gameTypeId, "game_1");
    assert.equal(res.json.data.name, "4-in-a-row");
    assert.equal(res.json.data.patternRows.length, 1);
    assert.deepEqual(res.json.data.ticketColors, ["Red", "Blue"]);
    assert.equal(ctx.spies.creates.length, 1);

    const evt = await waitForAudit(ctx.spies.auditStore, "admin.sub_game.created");
    assert.ok(evt, "audit-event 'admin.sub_game.created' skal være skrevet");
    assert.equal(evt!.actorId, "admin-1");
    assert.equal(evt!.resource, "sub_game");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: POST avviser tom payload", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/sub-games",
      "admin-tok",
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: POST duplikat (gameType+name) gir SUB_GAME_DUPLICATE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/sub-games",
      "admin-tok",
      { gameTypeId: "game_1", name: "P1" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SUB_GAME_DUPLICATE");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: POST avviser patternRows uten patternId", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/sub-games",
      "admin-tok",
      {
        gameTypeId: "game_1",
        name: "P1",
        patternRows: [{ name: "Only name" }],
      }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: POST avviser ticketColors som ikke-array", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/sub-games",
      "admin-tok",
      {
        gameTypeId: "game_1",
        name: "P1",
        ticketColors: "Red,Blue",
      }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── PATCH ────────────────────────────────────────────────────────────────────

test("BIN-621: PATCH oppdaterer felter + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/sub-games/sg-1",
      "admin-tok",
      { name: "Oppdatert", ticketColors: ["Red"] }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "Oppdatert");
    assert.deepEqual(res.json.data.ticketColors, ["Red"]);
    assert.equal(ctx.spies.updates.length, 1);
    assert.deepEqual(ctx.spies.updates[0]!.changed.sort(), ["name", "ticketColors"]);

    const evt = await waitForAudit(ctx.spies.auditStore, "admin.sub_game.updated");
    assert.ok(evt);
  } finally {
    await ctx.close();
  }
});

test("BIN-621: PATCH ukjent id gir NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/sub-games/missing",
      "admin-tok",
      { name: "Ny" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SUB_GAME_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: PATCH avviser ikke-objekt payload", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/sub-games/sg-1",
      "admin-tok",
      ["not", "an", "object"]
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-621: PATCH duplikat navn gir SUB_GAME_DUPLICATE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
    makeSubGame({ id: "sg-2", gameTypeId: "game_1", name: "P2" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/sub-games/sg-2",
      "admin-tok",
      { name: "P1" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SUB_GAME_DUPLICATE");
  } finally {
    await ctx.close();
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────

test("BIN-621: DELETE default er soft-delete + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/sub-games/sg-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);
    assert.equal(ctx.spies.removes[0]!.hard, false);

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.sub_game.soft_deleted"
    );
    assert.ok(evt);
  } finally {
    await ctx.close();
  }
});

test("BIN-621: DELETE ?hard=true gjør hard-delete", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeSubGame({ id: "sg-1", gameTypeId: "game_1", name: "P1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/sub-games/sg-1?hard=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, false);
    assert.equal(ctx.spies.removes[0]!.hard, true);

    const evt = await waitForAudit(ctx.spies.auditStore, "admin.sub_game.deleted");
    assert.ok(evt);
  } finally {
    await ctx.close();
  }
});

test("BIN-621: DELETE ukjent id gir NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/sub-games/missing",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SUB_GAME_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});
