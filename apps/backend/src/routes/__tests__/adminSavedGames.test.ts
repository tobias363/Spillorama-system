/**
 * BIN-624: integrasjonstester for admin-saved-games-router.
 *
 * Dekker alle 6 endepunkter:
 *   GET    /api/admin/saved-games
 *   GET    /api/admin/saved-games/:id
 *   POST   /api/admin/saved-games
 *   PATCH  /api/admin/saved-games/:id
 *   DELETE /api/admin/saved-games/:id
 *   POST   /api/admin/saved-games/:id/load-to-game
 *
 * Testene bygger en stub-SavedGameService rundt et in-memory Map — samme
 * mønster som adminSubGames.test.ts / adminGameTypes.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminSavedGamesRouter } from "../adminSavedGames.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  SavedGameService,
  SavedGame,
  CreateSavedGameInput,
  UpdateSavedGameInput,
  ListSavedGameFilter,
  SavedGameLoadPayload,
  SavedGameApplyPayload,
} from "../../admin/SavedGameService.js";
import type {
  DailyScheduleService,
  DailySchedule,
  UpdateDailyScheduleInput,
} from "../../admin/DailyScheduleService.js";
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
    creates: SavedGame[];
    updates: Array<{ id: string; changed: string[] }>;
    removes: Array<{ id: string; hard: boolean }>;
    loads: Array<{ id: string }>;
    applies: Array<{ savedGameId: string }>;
    scheduleUpdates: Array<{ id: string; changed: string[] }>;
  };
  savedGames: Map<string, SavedGame>;
  schedules: Map<string, DailySchedule>;
  close: () => Promise<void>;
}

function makeDailySchedule(
  overrides: Partial<DailySchedule> & { id: string }
): DailySchedule {
  return {
    id: overrides.id,
    name: overrides.name ?? `Plan ${overrides.id}`,
    gameManagementId: overrides.gameManagementId ?? null,
    hallId: overrides.hallId ?? null,
    hallIds: overrides.hallIds ?? {},
    weekDays: overrides.weekDays ?? 0,
    day: overrides.day ?? null,
    startDate: overrides.startDate ?? "2026-05-01T10:00:00Z",
    endDate: overrides.endDate ?? null,
    startTime: overrides.startTime ?? "",
    endTime: overrides.endTime ?? "",
    status: overrides.status ?? "active",
    stopGame: overrides.stopGame ?? false,
    specialGame: overrides.specialGame ?? false,
    isSavedGame: overrides.isSavedGame ?? false,
    isAdminSavedGame: overrides.isAdminSavedGame ?? false,
    innsatsenSales: overrides.innsatsenSales ?? 0,
    subgames: overrides.subgames ?? [],
    otherData: overrides.otherData ?? {},
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

function makeSavedGame(
  overrides: Partial<SavedGame> & {
    id: string;
    gameTypeId: string;
    name: string;
  }
): SavedGame {
  return {
    id: overrides.id,
    gameTypeId: overrides.gameTypeId,
    name: overrides.name,
    isAdminSave: overrides.isAdminSave ?? true,
    config: overrides.config ?? {},
    status: overrides.status ?? "active",
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: SavedGame[] = [],
  scheduleSeed: DailySchedule[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const savedGames = new Map<string, SavedGame>();
  for (const g of seed) savedGames.set(g.id, g);
  const schedules = new Map<string, DailySchedule>();
  for (const s of scheduleSeed) schedules.set(s.id, s);

  const creates: SavedGame[] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const removes: Ctx["spies"]["removes"] = [];
  const loads: Ctx["spies"]["loads"] = [];
  const applies: Ctx["spies"]["applies"] = [];
  const scheduleUpdates: Ctx["spies"]["scheduleUpdates"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = savedGames.size;
  const savedGameService = {
    async list(filter: ListSavedGameFilter = {}) {
      let list = [...savedGames.values()].filter((g) => !g.deletedAt);
      if (filter.gameTypeId) {
        list = list.filter((g) => g.gameTypeId === filter.gameTypeId);
      }
      if (filter.status) list = list.filter((g) => g.status === filter.status);
      if (filter.createdBy) {
        list = list.filter((g) => g.createdBy === filter.createdBy);
      }
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const g = savedGames.get(id);
      if (!g) throw new DomainError("SAVED_GAME_NOT_FOUND", "not found");
      return g;
    },
    async create(input: CreateSavedGameInput) {
      for (const g of savedGames.values()) {
        if (
          !g.deletedAt &&
          g.gameTypeId === input.gameTypeId &&
          g.name === input.name
        ) {
          throw new DomainError(
            "SAVED_GAME_DUPLICATE",
            `duplicate ${input.gameTypeId}/${input.name}`
          );
        }
      }
      idCounter += 1;
      const id = `sg-${idCounter}`;
      const next = makeSavedGame({
        id,
        gameTypeId: input.gameTypeId,
        name: input.name,
        isAdminSave: input.isAdminSave ?? true,
        config: input.config ?? {},
        status: input.status ?? "active",
        createdBy: input.createdBy,
      });
      savedGames.set(id, next);
      creates.push(next);
      return next;
    },
    async update(id: string, update: UpdateSavedGameInput) {
      const existing = savedGames.get(id);
      if (!existing) {
        throw new DomainError("SAVED_GAME_NOT_FOUND", "not found");
      }
      if (existing.deletedAt) {
        throw new DomainError("SAVED_GAME_DELETED", "deleted");
      }
      if (Object.keys(update).length === 0) {
        throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
      }
      const changed = Object.keys(update);
      const next: SavedGame = {
        ...existing,
        ...(update.name !== undefined ? { name: update.name } : {}),
        ...(update.isAdminSave !== undefined
          ? { isAdminSave: update.isAdminSave }
          : {}),
        ...(update.config !== undefined ? { config: update.config } : {}),
        ...(update.status !== undefined ? { status: update.status } : {}),
        updatedAt: "2026-04-15T11:00:00Z",
      };
      savedGames.set(id, next);
      updates.push({ id, changed });
      return next;
    },
    async remove(id: string, options: { hard?: boolean } = {}) {
      const existing = savedGames.get(id);
      if (!existing) {
        throw new DomainError("SAVED_GAME_NOT_FOUND", "not found");
      }
      if (existing.deletedAt) {
        throw new DomainError("SAVED_GAME_DELETED", "deleted");
      }
      const hard = options.hard === true;
      removes.push({ id, hard });
      if (hard) {
        savedGames.delete(id);
        return { softDeleted: false };
      }
      savedGames.set(id, {
        ...existing,
        status: "inactive",
        deletedAt: "2026-04-15T12:00:00Z",
      });
      return { softDeleted: true };
    },
    async loadToGame(id: string): Promise<SavedGameLoadPayload> {
      const existing = savedGames.get(id);
      if (!existing) {
        throw new DomainError("SAVED_GAME_NOT_FOUND", "not found");
      }
      if (existing.deletedAt) {
        throw new DomainError("SAVED_GAME_DELETED", "deleted");
      }
      if (existing.status !== "active") {
        throw new DomainError("SAVED_GAME_INACTIVE", "inactive");
      }
      loads.push({ id });
      return {
        savedGameId: existing.id,
        gameTypeId: existing.gameTypeId,
        name: existing.name,
        config: JSON.parse(JSON.stringify(existing.config)),
      };
    },
    async applyToSchedule(id: string): Promise<SavedGameApplyPayload> {
      const existing = savedGames.get(id);
      if (!existing) {
        throw new DomainError("SAVED_GAME_NOT_FOUND", "not found");
      }
      if (existing.deletedAt) {
        throw new DomainError("SAVED_GAME_DELETED", "deleted");
      }
      if (existing.status !== "active") {
        throw new DomainError("SAVED_GAME_INACTIVE", "inactive");
      }
      applies.push({ savedGameId: id });
      return {
        savedGameId: existing.id,
        gameTypeId: existing.gameTypeId,
        name: existing.name,
        config: JSON.parse(JSON.stringify(existing.config)),
      };
    },
  } as unknown as SavedGameService;

  const dailyScheduleService = {
    async get(id: string): Promise<DailySchedule> {
      const r = schedules.get(id);
      if (!r) throw new DomainError("DAILY_SCHEDULE_NOT_FOUND", "not found");
      return r;
    },
    async update(
      id: string,
      update: UpdateDailyScheduleInput
    ): Promise<DailySchedule> {
      const r = schedules.get(id);
      if (!r) throw new DomainError("DAILY_SCHEDULE_NOT_FOUND", "not found");
      scheduleUpdates.push({ id, changed: Object.keys(update) });
      const next: DailySchedule = { ...r };
      if (update.subgames !== undefined) next.subgames = update.subgames;
      if (update.otherData !== undefined) next.otherData = update.otherData;
      if (update.isSavedGame !== undefined) next.isSavedGame = update.isSavedGame;
      next.updatedAt = "2026-04-15T11:00:00Z";
      schedules.set(id, next);
      return next;
    },
  } as unknown as DailyScheduleService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminSavedGamesRouter({
      platformService,
      auditLogService,
      savedGameService,
      dailyScheduleService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    spies: {
      auditStore,
      creates,
      updates,
      removes,
      loads,
      applies,
      scheduleUpdates,
    },
    savedGames,
    schedules,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function jsonFetch(
  url: string,
  init: RequestInit
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, init);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
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

// ── Tests ───────────────────────────────────────────────────────────────────

test("BIN-624 router: GET list returns all saved games (ADMIN)", async () => {
  const seed = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Mal A" }),
    makeSavedGame({ id: "sg-2", gameTypeId: "game_3", name: "Mal B" }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games`,
      { headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const data = body.data as { savedGames: unknown[]; count: number };
    assert.equal(data.count, 2);
    assert.equal(data.savedGames.length, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: GET list filters by gameType query param", async () => {
  const seed = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Mal A" }),
    makeSavedGame({ id: "sg-2", gameTypeId: "game_3", name: "Mal B" }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games?gameType=game_1`,
      { headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 200);
    const data = body.data as { savedGames: SavedGame[]; count: number };
    assert.equal(data.count, 1);
    assert.equal(data.savedGames[0]!.gameTypeId, "game_1");
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: GET list accessible by SUPPORT (read-only)", async () => {
  const seed = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Mal A" }),
  ];
  const ctx = await startServer({ "tok-sup": supportUser }, seed);
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games`,
      { headers: authHeaders("tok-sup") }
    );
    assert.equal(status, 200);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: GET list forbidden for PLAYER", async () => {
  const ctx = await startServer({ "tok-pl": playerUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games`,
      { headers: authHeaders("tok-pl") }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    const err = body.error as { code: string };
    assert.equal(err.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: GET detail returns the row", async () => {
  const seed = [
    makeSavedGame({
      id: "sg-1",
      gameTypeId: "game_1",
      name: "Mal A",
      config: { ticketPrice: 10 },
    }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1`,
      { headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 200);
    const data = body.data as SavedGame;
    assert.equal(data.id, "sg-1");
    assert.equal(data.name, "Mal A");
    assert.deepEqual(data.config, { ticketPrice: 10 });
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: GET detail returns 400 for unknown id", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/does-not-exist`,
      { headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST creates + writes audit event", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games`,
      {
        method: "POST",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({
          gameTypeId: "game_1",
          name: "Ny mal",
          config: { ticketPrice: 10, halls: ["h-1"] },
        }),
      }
    );
    assert.equal(status, 200);
    const data = body.data as SavedGame;
    assert.equal(data.name, "Ny mal");
    assert.equal(data.gameTypeId, "game_1");
    assert.deepEqual(data.config, { ticketPrice: 10, halls: ["h-1"] });
    assert.equal(data.isAdminSave, true);
    assert.equal(ctx.spies.creates.length, 1);
    const created = await waitForAudit(
      ctx.spies.auditStore,
      "admin.saved_game.created"
    );
    assert.ok(created, "audit event missing");
    assert.equal(created!.resourceId, data.id);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST by HALL_OPERATOR succeeds (SAVED_GAME_WRITE includes operator)", async () => {
  const ctx = await startServer({ "tok-op": operatorUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games`,
      {
        method: "POST",
        headers: authHeaders("tok-op"),
        body: JSON.stringify({
          gameTypeId: "game_1",
          name: "Operator mal",
        }),
      }
    );
    assert.equal(status, 200);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST by SUPPORT forbidden (read-only role)", async () => {
  const ctx = await startServer({ "tok-sup": supportUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games`,
      {
        method: "POST",
        headers: authHeaders("tok-sup"),
        body: JSON.stringify({ gameTypeId: "game_1", name: "Forbidden" }),
      }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    const err = body.error as { code: string };
    assert.equal(err.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST returns 400 on missing name", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games`,
      {
        method: "POST",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ gameTypeId: "game_1" }),
      }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST rejects config that is an array", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games`,
      {
        method: "POST",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({
          gameTypeId: "game_1",
          name: "Bad",
          config: [1, 2, 3],
        }),
      }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST returns 400 on duplicate name for same gameType", async () => {
  const seed = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Mal A" }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games`,
      {
        method: "POST",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ gameTypeId: "game_1", name: "Mal A" }),
      }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: PATCH updates name + writes audit event", async () => {
  const seed = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Før" }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1`,
      {
        method: "PATCH",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ name: "Etter" }),
      }
    );
    assert.equal(status, 200);
    const data = body.data as SavedGame;
    assert.equal(data.name, "Etter");
    const updated = await waitForAudit(
      ctx.spies.auditStore,
      "admin.saved_game.updated"
    );
    assert.ok(updated, "audit event missing");
    assert.deepEqual(
      (updated!.details as { changed: string[] }).changed,
      ["name"]
    );
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: PATCH with empty body returns 400 (service rejects)", async () => {
  const seed = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Før" }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1`,
      {
        method: "PATCH",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({}),
      }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: DELETE default soft-deletes + writes audit event", async () => {
  const seed = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Mal A" }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1`,
      { method: "DELETE", headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 200);
    assert.deepEqual(body.data, { softDeleted: true });
    assert.equal(ctx.spies.removes[0]!.hard, false);
    const deleted = await waitForAudit(
      ctx.spies.auditStore,
      "admin.saved_game.soft_deleted"
    );
    assert.ok(deleted, "soft_deleted audit event missing");
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: DELETE ?hard=true hard-deletes + emits 'deleted' event", async () => {
  const seed = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Mal A" }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1?hard=true`,
      { method: "DELETE", headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 200);
    assert.deepEqual(body.data, { softDeleted: false });
    assert.equal(ctx.spies.removes[0]!.hard, true);
    const deleted = await waitForAudit(
      ctx.spies.auditStore,
      "admin.saved_game.deleted"
    );
    assert.ok(deleted, "hard delete audit event missing");
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST /load-to-game returns config payload + audit event", async () => {
  const seed = [
    makeSavedGame({
      id: "sg-1",
      gameTypeId: "game_1",
      name: "Mal A",
      config: { ticketPrice: 10, halls: ["h-1"] },
      status: "active",
    }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1/load-to-game`,
      { method: "POST", headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 200);
    const data = body.data as SavedGameLoadPayload;
    assert.equal(data.savedGameId, "sg-1");
    assert.equal(data.gameTypeId, "game_1");
    assert.equal(data.name, "Mal A");
    assert.deepEqual(data.config, { ticketPrice: 10, halls: ["h-1"] });
    assert.equal(ctx.spies.loads.length, 1);
    const loaded = await waitForAudit(
      ctx.spies.auditStore,
      "admin.saved_game.loaded_to_game"
    );
    assert.ok(loaded, "loaded_to_game audit event missing");
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST /load-to-game rejects inactive SavedGame", async () => {
  const seed = [
    makeSavedGame({
      id: "sg-1",
      gameTypeId: "game_1",
      name: "Mal A",
      status: "inactive",
    }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1/load-to-game`,
      { method: "POST", headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST /load-to-game forbidden for SUPPORT", async () => {
  const seed = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Mal A" }),
  ];
  const ctx = await startServer({ "tok-sup": supportUser }, seed);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1/load-to-game`,
      { method: "POST", headers: authHeaders("tok-sup") }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    const err = body.error as { code: string };
    assert.equal(err.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── apply-to-schedule (BIN-624 ↔ BIN-626) ───────────────────────────────────

test("BIN-624 router: POST /apply-to-schedule overskriver schedule + audit applied_to_schedule", async () => {
  const seedSaved = [
    makeSavedGame({
      id: "sg-1",
      gameTypeId: "game_1",
      name: "Lørdag-mal",
      config: {
        subgames: [{ index: 0, ticketPrice: 700 }],
        otherData: { mood: "festlig" },
      },
    }),
  ];
  const seedSched = [
    makeDailySchedule({
      id: "ds-1",
      hallId: "hall-a",
      subgames: [{ index: 0, ticketPrice: 100 }],
    }),
  ];
  const ctx = await startServer(
    { "tok-admin": adminUser },
    seedSaved,
    seedSched
  );
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1/apply-to-schedule`,
      {
        method: "POST",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ scheduleId: "ds-1" }),
      }
    );
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    const data = body.data as { schedule: DailySchedule };
    assert.equal(data.schedule.id, "ds-1");
    assert.deepEqual(data.schedule.subgames, [
      { index: 0, ticketPrice: 700 },
    ]);
    assert.deepEqual(data.schedule.otherData, { mood: "festlig" });
    assert.equal(data.schedule.isSavedGame, true);

    assert.equal(ctx.spies.applies.length, 1);
    assert.equal(ctx.spies.scheduleUpdates.length, 1);
    const event = await waitForAudit(
      ctx.spies.auditStore,
      "admin.saved_game.applied_to_schedule"
    );
    assert.ok(event, "audit-event mangler");
    assert.equal(
      (event!.details as { savedGameId: string }).savedGameId,
      "sg-1"
    );
    assert.equal(
      (event!.details as { dailyScheduleId: string }).dailyScheduleId,
      "ds-1"
    );
  } finally {
    await ctx.close();
  }
});

test("BIN-624 router: POST /apply-to-schedule returnerer 400 for ukjent schedule-id", async () => {
  const seedSaved = [
    makeSavedGame({ id: "sg-1", gameTypeId: "game_1", name: "Mal A" }),
  ];
  const ctx = await startServer({ "tok-admin": adminUser }, seedSaved, []);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/saved-games/sg-1/apply-to-schedule`,
      {
        method: "POST",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ scheduleId: "missing" }),
      }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    const err = body.error as { code: string };
    assert.equal(err.code, "DAILY_SCHEDULE_NOT_FOUND");
    // ScheduleUpdates skal ikke ha skjedd
    assert.equal(ctx.spies.scheduleUpdates.length, 0);
  } finally {
    await ctx.close();
  }
});
