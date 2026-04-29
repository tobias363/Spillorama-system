/**
 * BIN-677: integrasjonstester for admin-settings-router.
 *
 * Dekker begge endepunkter:
 *   GET   /api/admin/settings
 *   PATCH /api/admin/settings
 *
 * Testene bygger en stub-SettingsService rundt et in-memory Map — samme
 * mønster som adminLeaderboardTiers.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminSettingsRouter } from "../adminSettings.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  SettingsService,
  SystemSetting,
  UpdateSystemSettingPatch,
} from "../../admin/SettingsService.js";
import { SYSTEM_SETTING_REGISTRY } from "../../admin/SettingsService.js";
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
  spies: {
    auditStore: InMemoryAuditLogStore;
    patches: Array<{ patches: UpdateSystemSettingPatch[]; actorUserId: string | null }>;
  };
  stored: Map<string, unknown>;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: Record<string, unknown> = {}
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const stored = new Map<string, unknown>(Object.entries(seed));
  const patches: Ctx["spies"]["patches"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  function buildList(): SystemSetting[] {
    return SYSTEM_SETTING_REGISTRY.map((def) => {
      if (stored.has(def.key)) {
        return {
          key: def.key,
          value: stored.get(def.key),
          category: def.category,
          description: def.description,
          type: def.type,
          isDefault: false,
          updatedByUserId: "admin-1",
          updatedAt: "2026-04-20T10:00:00Z",
        };
      }
      return {
        key: def.key,
        value: def.defaultValue,
        category: def.category,
        description: def.description,
        type: def.type,
        isDefault: true,
        updatedByUserId: null,
        updatedAt: null,
      };
    });
  }

  const settingsService = {
    async list(): Promise<SystemSetting[]> {
      return buildList();
    },
    async get(key: string): Promise<SystemSetting> {
      const def = SYSTEM_SETTING_REGISTRY.find((d) => d.key === key);
      if (!def) throw new DomainError("SETTING_UNKNOWN", "not in registry");
      if (stored.has(key)) {
        return {
          key: def.key,
          value: stored.get(key),
          category: def.category,
          description: def.description,
          type: def.type,
          isDefault: false,
          updatedByUserId: "admin-1",
          updatedAt: "2026-04-20T10:00:00Z",
        };
      }
      return {
        key: def.key,
        value: def.defaultValue,
        category: def.category,
        description: def.description,
        type: def.type,
        isDefault: true,
        updatedByUserId: null,
        updatedAt: null,
      };
    },
    async patch(
      patchList: UpdateSystemSettingPatch[],
      actorUserId: string | null
    ): Promise<SystemSetting[]> {
      if (!Array.isArray(patchList) || patchList.length === 0) {
        throw new DomainError("INVALID_INPUT", "empty");
      }
      for (const p of patchList) {
        const def = SYSTEM_SETTING_REGISTRY.find((d) => d.key === p.key);
        if (!def) {
          throw new DomainError("SETTING_UNKNOWN", `unknown ${p.key}`);
        }
        // Type-sjekk (matcher faktisk service).
        if (def.type === "string" && typeof p.value !== "string") {
          throw new DomainError("INVALID_INPUT", "wrong type");
        }
        if (def.type === "number" && typeof p.value !== "number") {
          throw new DomainError("INVALID_INPUT", "wrong type");
        }
        if (def.type === "boolean" && typeof p.value !== "boolean") {
          throw new DomainError("INVALID_INPUT", "wrong type");
        }
      }
      patches.push({ patches: patchList, actorUserId });
      for (const p of patchList) stored.set(p.key, p.value);
      return buildList();
    },
  } as unknown as SettingsService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminSettingsRouter({
      platformService,
      auditLogService,
      settingsService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, patches },
    stored,
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
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

test("BIN-677 settings route: PLAYER blokkert fra alle endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/settings", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const patch = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/settings",
      "pl-tok",
      { "system.timezone": "UTC" }
    );
    assert.equal(patch.status, 400);
    assert.equal(patch.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 settings route: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    const list = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/settings",
      "sup-tok"
    );
    assert.equal(list.status, 200);

    const patch = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/settings",
      "sup-tok",
      { "system.timezone": "UTC" }
    );
    assert.equal(patch.status, 400);
    assert.equal(patch.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 settings route: HALL_OPERATOR kan READ men ikke WRITE (ADMIN-only)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/settings", "op-tok");
    assert.equal(list.status, 200);

    const patch = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/settings",
      "op-tok",
      { "system.timezone": "UTC" }
    );
    assert.equal(patch.status, 400);
    assert.equal(patch.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 settings route: uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/settings");
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  } finally {
    await ctx.close();
  }
});

// ── GET list ────────────────────────────────────────────────────────────────

test("BIN-677 settings route: GET list returnerer alle registry-nøkler med default", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/settings",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(
      res.json.data.settings.length,
      SYSTEM_SETTING_REGISTRY.length,
      "alle registry-nøkler returneres"
    );
    assert.equal(res.json.data.count, SYSTEM_SETTING_REGISTRY.length);
    // Alle skal være isDefault=true siden ingen er lagret.
    for (const s of res.json.data.settings) {
      assert.equal(s.isDefault, true);
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-677 settings route: GET list returnerer lagrede verdier med isDefault=false", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { "system.timezone": "UTC" }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/settings",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    const tz = res.json.data.settings.find(
      (s: { key: string }) => s.key === "system.timezone"
    );
    assert.equal(tz.value, "UTC");
    assert.equal(tz.isDefault, false);
    assert.equal(tz.updatedByUserId, "admin-1");
  } finally {
    await ctx.close();
  }
});

// ── PATCH ───────────────────────────────────────────────────────────────────

test("BIN-677 settings route: PATCH med flat objekt-form lagrer verdien", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/settings",
      "admin-tok",
      { "system.timezone": "UTC" }
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.patches.length, 1);
    assert.equal(ctx.spies.patches[0]!.patches[0]!.key, "system.timezone");
    assert.equal(ctx.spies.patches[0]!.patches[0]!.value, "UTC");
    assert.equal(ctx.spies.patches[0]!.actorUserId, "admin-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 settings route: PATCH med patches-array-form støttes", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/settings",
      "admin-tok",
      {
        patches: [
          { key: "system.timezone", value: "UTC" },
          { key: "system.currency", value: "EUR" },
        ],
      }
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.patches.length, 1);
    assert.equal(ctx.spies.patches[0]!.patches.length, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-677 settings route: PATCH skriver AuditLog admin.settings.update", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/settings",
      "admin-tok",
      { "system.timezone": "UTC" }
    );
    assert.equal(res.status, 200);
    const event = await waitForAudit(
      ctx.spies.auditStore,
      "admin.settings.update"
    );
    assert.ok(event, "audit-hendelse må logges");
    assert.equal(event!.actorId, "admin-1");
    assert.equal(event!.actorType, "ADMIN");
    assert.equal(event!.resource, "system_settings");
    assert.deepEqual(
      (event!.details as { changedKeys: string[] }).changedKeys,
      ["system.timezone"]
    );
  } finally {
    await ctx.close();
  }
});

test("BIN-677 settings route: PATCH med ukjent key returnerer feil", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/settings",
      "admin-tok",
      { "totally.fake.key": "x" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SETTING_UNKNOWN");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 settings route: PATCH med feil type avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/settings",
      "admin-tok",
      { "system.timezone": 42 }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 settings route: PATCH med tomt objekt avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/settings",
      "admin-tok",
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
