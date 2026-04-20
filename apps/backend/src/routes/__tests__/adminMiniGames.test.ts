/**
 * BIN-679: integrasjonstester for admin-mini-games-router.
 *
 * Dekker alle 8 endepunkter (GET + PUT per gameType × 4 spill):
 *   GET/PUT /api/admin/mini-games/wheel
 *   GET/PUT /api/admin/mini-games/chest
 *   GET/PUT /api/admin/mini-games/mystery
 *   GET/PUT /api/admin/mini-games/colordraft
 *
 * Testene bygger en stub-MiniGamesConfigService rundt et in-memory Map —
 * samme mønster som adminLeaderboardTiers.test.ts og adminSubGames.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminMiniGamesRouter } from "../adminMiniGames.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  MiniGamesConfigService,
  MiniGameConfig,
  MiniGameType,
  UpdateMiniGameConfigInput,
} from "../../admin/MiniGamesConfigService.js";
import { MINI_GAME_TYPES } from "../../admin/MiniGamesConfigService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
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
    updates: Array<{ gameType: MiniGameType; input: UpdateMiniGameConfigInput }>;
  };
  configs: Map<MiniGameType, MiniGameConfig>;
  close: () => Promise<void>;
}

function makeConfig(
  gameType: MiniGameType,
  overrides: Partial<MiniGameConfig> = {},
): MiniGameConfig {
  return {
    id: overrides.id ?? `cfg-${gameType}`,
    gameType,
    config: overrides.config ?? {},
    active: overrides.active ?? true,
    updatedByUserId: overrides.updatedByUserId ?? null,
    createdAt: overrides.createdAt ?? "2026-04-20T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-20T10:00:00Z",
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: Partial<Record<MiniGameType, MiniGameConfig>> = {},
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const configs = new Map<MiniGameType, MiniGameConfig>();
  for (const gt of MINI_GAME_TYPES) {
    if (seed[gt]) {
      configs.set(gt, seed[gt] as MiniGameConfig);
    }
  }

  const updates: Ctx["spies"]["updates"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const miniGamesConfigService = {
    async get(gameType: MiniGameType) {
      const existing = configs.get(gameType);
      if (existing) return existing;
      // Default (matches service-impl buildDefault).
      return {
        id: `default-${gameType}`,
        gameType,
        config: {},
        active: true,
        updatedByUserId: null,
        createdAt: "2026-04-20T10:00:00Z",
        updatedAt: "2026-04-20T10:00:00Z",
      };
    },
    async update(gameType: MiniGameType, input: UpdateMiniGameConfigInput) {
      updates.push({ gameType, input });
      const existing =
        configs.get(gameType) ?? makeConfig(gameType, { id: `cfg-${gameType}` });
      const next: MiniGameConfig = { ...existing };
      if (input.config !== undefined) next.config = input.config;
      if (input.active !== undefined) next.active = input.active;
      next.updatedByUserId = input.updatedByUserId;
      next.updatedAt = new Date().toISOString();
      configs.set(gameType, next);
      return next;
    },
    async listAll() {
      return MINI_GAME_TYPES.map(
        (gt) =>
          configs.get(gt) ?? {
            id: `default-${gt}`,
            gameType: gt,
            config: {},
            active: true,
            updatedByUserId: null,
            createdAt: "2026-04-20T10:00:00Z",
            updatedAt: "2026-04-20T10:00:00Z",
          },
      );
    },
  } as unknown as MiniGamesConfigService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminMiniGamesRouter({
      platformService,
      auditLogService,
      miniGamesConfigService,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, updates },
    configs,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
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
  action: string,
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

test("BIN-679 route: unauthenticated blokkert fra alle mini-game-endepunkter", async () => {
  const ctx = await startServer({});
  try {
    for (const gt of MINI_GAME_TYPES) {
      const get = await req(ctx.baseUrl, "GET", `/api/admin/mini-games/${gt}`);
      assert.equal(get.status, 400, `GET ${gt} uten token`);
      assert.ok(get.json?.error);
      const put = await req(
        ctx.baseUrl,
        "PUT",
        `/api/admin/mini-games/${gt}`,
        undefined,
        { config: {} },
      );
      assert.equal(put.status, 400, `PUT ${gt} uten token`);
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: PLAYER blokkert fra alle mini-game-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    for (const gt of MINI_GAME_TYPES) {
      const get = await req(
        ctx.baseUrl,
        "GET",
        `/api/admin/mini-games/${gt}`,
        "pl-tok",
      );
      assert.equal(get.status, 400);
      assert.equal(get.json.error.code, "FORBIDDEN");

      const put = await req(
        ctx.baseUrl,
        "PUT",
        `/api/admin/mini-games/${gt}`,
        "pl-tok",
        { config: {} },
      );
      assert.equal(put.status, 400);
      assert.equal(put.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    for (const gt of MINI_GAME_TYPES) {
      const get = await req(
        ctx.baseUrl,
        "GET",
        `/api/admin/mini-games/${gt}`,
        "sup-tok",
      );
      assert.equal(get.status, 200, `GET ${gt} SUPPORT`);
      assert.equal(get.json.data.gameType, gt);

      const put = await req(
        ctx.baseUrl,
        "PUT",
        `/api/admin/mini-games/${gt}`,
        "sup-tok",
        { config: { foo: 1 } },
      );
      assert.equal(put.status, 400, `PUT ${gt} SUPPORT`);
      assert.equal(put.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: HALL_OPERATOR kan READ men IKKE WRITE (ADMIN-only)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    for (const gt of MINI_GAME_TYPES) {
      const get = await req(
        ctx.baseUrl,
        "GET",
        `/api/admin/mini-games/${gt}`,
        "op-tok",
      );
      assert.equal(get.status, 200);

      const put = await req(
        ctx.baseUrl,
        "PUT",
        `/api/admin/mini-games/${gt}`,
        "op-tok",
        { config: { foo: 1 } },
      );
      assert.equal(put.status, 400);
      assert.equal(put.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: ADMIN kan både READ og WRITE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    for (const gt of MINI_GAME_TYPES) {
      const put = await req(
        ctx.baseUrl,
        "PUT",
        `/api/admin/mini-games/${gt}`,
        "admin-tok",
        { config: { segments: [{ label: "test", prizeAmount: 10 }] } },
      );
      assert.equal(put.status, 200, `PUT ${gt} ADMIN`);
      assert.equal(put.json.data.gameType, gt);
      assert.deepEqual(put.json.data.config, {
        segments: [{ label: "test", prizeAmount: 10 }],
      });

      const get = await req(
        ctx.baseUrl,
        "GET",
        `/api/admin/mini-games/${gt}`,
        "admin-tok",
      );
      assert.equal(get.status, 200);
      assert.deepEqual(get.json.data.config, {
        segments: [{ label: "test", prizeAmount: 10 }],
      });
    }
  } finally {
    await ctx.close();
  }
});

// ── GET: defaults når ingen rad finnes ──────────────────────────────────────

test("BIN-679 route: GET returnerer default (empty config, active=true) hvis ingen rad", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    for (const gt of MINI_GAME_TYPES) {
      const get = await req(
        ctx.baseUrl,
        "GET",
        `/api/admin/mini-games/${gt}`,
        "admin-tok",
      );
      assert.equal(get.status, 200);
      assert.equal(get.json.data.gameType, gt);
      assert.deepEqual(get.json.data.config, {});
      assert.equal(get.json.data.active, true);
      assert.equal(get.json.data.updatedByUserId, null);
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: GET returnerer seeded config når raden finnes", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    wheel: makeConfig("wheel", {
      id: "seed-wheel",
      config: { segments: [{ label: "seed", prizeAmount: 5 }] },
      active: false,
      updatedByUserId: "prev-admin",
    }),
  });
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/mini-games/wheel",
      "admin-tok",
    );
    assert.equal(get.status, 200);
    assert.equal(get.json.data.id, "seed-wheel");
    assert.equal(get.json.data.active, false);
    assert.equal(get.json.data.updatedByUserId, "prev-admin");
    assert.equal(get.json.data.config.segments[0].label, "seed");
  } finally {
    await ctx.close();
  }
});

// ── PUT: payload-validering ─────────────────────────────────────────────────

test("BIN-679 route: PUT avviser non-object body", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    // Express parses raw numbers/arrays as valid JSON but ikke som object.
    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/mini-games/wheel",
      "admin-tok",
      [1, 2, 3],
    );
    assert.equal(put.status, 400);
    assert.equal(put.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: PUT avviser config som array", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/mini-games/chest",
      "admin-tok",
      { config: [1, 2, 3] },
    );
    assert.equal(put.status, 400);
    assert.equal(put.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: PUT avviser config som streng", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/mini-games/mystery",
      "admin-tok",
      { config: "stringly-typed" },
    );
    assert.equal(put.status, 400);
    assert.equal(put.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: PUT avviser active som streng", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/mini-games/colordraft",
      "admin-tok",
      { active: "true" },
    );
    assert.equal(put.status, 400);
    assert.equal(put.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: PUT aksepterer tom body (ingen endring)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/mini-games/wheel",
      "admin-tok",
      {},
    );
    assert.equal(put.status, 200);
    assert.equal(put.json.data.gameType, "wheel");
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: PUT støtter kun config uten active", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/mini-games/wheel",
      "admin-tok",
      { config: { segments: [] } },
    );
    assert.equal(put.status, 200);
    assert.deepEqual(put.json.data.config, { segments: [] });
    assert.equal(put.json.data.active, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: PUT støtter kun active uten config", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    wheel: makeConfig("wheel", {
      id: "seed-wheel",
      config: { segments: [{ label: "keep-me", prizeAmount: 7 }] },
      active: true,
    }),
  });
  try {
    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/mini-games/wheel",
      "admin-tok",
      { active: false },
    );
    assert.equal(put.status, 200);
    assert.equal(put.json.data.active, false);
    // Config skal være uendret siden den ikke ble sendt.
    assert.equal(put.json.data.config.segments[0].label, "keep-me");
  } finally {
    await ctx.close();
  }
});

// ── Audit-log ───────────────────────────────────────────────────────────────

test("BIN-679 route: PUT skriver audit-entry per spill-type", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    for (const gt of MINI_GAME_TYPES) {
      await req(
        ctx.baseUrl,
        "PUT",
        `/api/admin/mini-games/${gt}`,
        "admin-tok",
        { config: { marker: gt } },
      );
      const audit = await waitForAudit(
        ctx.spies.auditStore,
        `admin.mini_games.${gt}.update`,
      );
      assert.ok(audit, `audit for ${gt}`);
      assert.equal(audit!.actorId, "admin-1");
      assert.equal(audit!.actorType, "ADMIN");
      assert.equal(audit!.resource, "mini_game_config");
      assert.equal(audit!.details.gameType, gt);
      assert.ok(Array.isArray(audit!.details.changed));
      assert.ok(
        (audit!.details.changed as string[]).includes("config"),
        "changed inkluderer config",
      );
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-679 route: audit-details loggfører active-endring separat", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    await req(ctx.baseUrl, "PUT", "/api/admin/mini-games/chest", "admin-tok", {
      active: false,
    });
    const audit = await waitForAudit(
      ctx.spies.auditStore,
      "admin.mini_games.chest.update",
    );
    assert.ok(audit);
    assert.equal(audit!.details.active, false);
    assert.deepEqual(audit!.details.changed, ["active"]);
  } finally {
    await ctx.close();
  }
});

// ── Ukjent gameType — router har ikke path, så 404 ─────────────────────────

test("BIN-679 route: ukjent game-type returnerer 404 (path finnes ikke)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/admin/mini-games/unknown`, {
      method: "GET",
      headers: { Authorization: "Bearer admin-tok" },
    });
    assert.equal(res.status, 404);
  } finally {
    await ctx.close();
  }
});

// ── Service-feil propageres ─────────────────────────────────────────────────

test("BIN-679 route: service-DomainError propageres som apiFailure", async () => {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const platformService = {
    async getUserFromAccessToken() {
      return adminUser;
    },
  } as unknown as PlatformService;
  const miniGamesConfigService = {
    async get() {
      throw new DomainError("DB_DOWN", "simulert feil");
    },
    async update() {
      throw new DomainError("DB_DOWN", "simulert feil");
    },
    async listAll() {
      return [];
    },
  } as unknown as MiniGamesConfigService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminMiniGamesRouter({
      platformService,
      auditLogService,
      miniGamesConfigService,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  try {
    const get = await fetch(
      `http://127.0.0.1:${port}/api/admin/mini-games/wheel`,
      { headers: { Authorization: "Bearer admin-tok" } },
    );
    assert.equal(get.status, 400);
    const body: unknown = await get.json();
    assert.ok(
      body &&
        typeof body === "object" &&
        "error" in body &&
        (body as { error: { code: string } }).error.code === "DB_DOWN",
    );
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
});
