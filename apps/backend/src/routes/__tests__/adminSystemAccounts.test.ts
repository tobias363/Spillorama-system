/**
 * PR-B (2026-05-07): integrasjonstester for admin-system-accounts-router.
 *
 * Dekker:
 *   - POST: ADMIN oppretter, returnerer apiKey
 *   - POST avvist for AGENT (USER_ROLE_WRITE = ADMIN-only)
 *   - POST avvist for HALL_OPERATOR
 *   - GET list (uten api_key_hash)
 *   - DELETE revoke (med reason)
 *   - DELETE krever non-empty reason
 *   - End-to-end: opprett key → bruk den mot en faux admin-route → 200
 *
 * Bruker in-memory PlatformService og SystemAccountService — ingen Postgres.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { createAdminSystemAccountsRouter } from "../adminSystemAccounts.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import { SystemAccountService, isSystemAccountKey } from "../../auth/SystemAccountService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../../platform/AdminAccessPolicy.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../../util/httpHelpers.js";

// ── Test-fixtures ─────────────────────────────────────────────────────────

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "admin@test.no",
  displayName: "Admin",
  walletId: "w-admin",
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
const agentUser: PublicAppUser = {
  ...adminUser,
  id: "agent-1",
  role: "AGENT",
  hallId: "hall-a",
};

// ── In-memory pg.Pool (mirror SystemAccountService.test) ──────────────────

interface Row {
  id: string;
  name: string;
  description: string | null;
  api_key_hash: string;
  permissions_json: unknown;
  hall_scope_json: unknown;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
  last_used_ip: string | null;
  created_by_user_id: string | null;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  revoke_reason: string | null;
}

interface Store {
  rows: Map<string, Row>;
}

function runQuery(
  store: Store,
  sql: string,
  params: unknown[] = []
): { rows: Row[]; rowCount: number } {
  const trimmed = sql.trim();
  if (trimmed.startsWith("INSERT")) {
    const [id, name, description, apiKeyHash, permissionsJson, hallScopeJson, createdBy] =
      params as [string, string, string | null, string, string, string | null, string];
    for (const row of store.rows.values()) {
      if (row.name === name) {
        const err = new Error("duplicate key value") as Error & { code?: string };
        err.code = "23505";
        throw err;
      }
    }
    const now = new Date();
    const row: Row = {
      id,
      name,
      description: description ?? null,
      api_key_hash: apiKeyHash,
      permissions_json: JSON.parse(permissionsJson),
      hall_scope_json: hallScopeJson === null ? null : JSON.parse(hallScopeJson),
      is_active: true,
      created_at: now,
      updated_at: now,
      last_used_at: null,
      last_used_ip: null,
      created_by_user_id: createdBy ?? null,
      revoked_at: null,
      revoked_by_user_id: null,
      revoke_reason: null,
    };
    store.rows.set(id, row);
    return { rows: [row], rowCount: 1 };
  }
  if (trimmed.startsWith("SELECT")) {
    if (sql.includes("WHERE revoked_at IS NULL AND is_active = TRUE")) {
      const active = [...store.rows.values()].filter(
        (r) => r.revoked_at === null && r.is_active === true
      );
      return { rows: active, rowCount: active.length };
    }
    if (sql.includes("WHERE revoked_at IS NULL")) {
      const live = [...store.rows.values()].filter((r) => r.revoked_at === null);
      live.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return { rows: live, rowCount: live.length };
    }
    const all = [...store.rows.values()];
    all.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return { rows: all, rowCount: all.length };
  }
  if (trimmed.startsWith("UPDATE")) {
    if (sql.includes("SET last_used_at = now()")) {
      const [id, ip] = params as [string, string | null];
      const row = store.rows.get(id);
      if (row) {
        row.last_used_at = new Date();
        row.last_used_ip = ip ?? null;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("SET revoked_at = now()")) {
      const [id, byUserId, reason] = params as [string, string, string];
      const row = store.rows.get(id);
      if (row && row.revoked_at === null) {
        row.revoked_at = new Date();
        row.revoked_by_user_id = byUserId;
        row.revoke_reason = reason;
        row.updated_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  }
  throw new Error(`unhandled SQL: ${trimmed.slice(0, 120)}`);
}

function makePool(store: Store): Pool {
  const pool = {
    async query(sql: string, params?: unknown[]) {
      return runQuery(store, sql, params ?? []);
    },
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          return runQuery(store, sql, params ?? []);
        },
        release() {
          /* noop */
        },
      };
    },
  };
  return pool as unknown as Pool;
}

// ── Test server harness ───────────────────────────────────────────────────

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  systemAccountService: SystemAccountService;
  store: Store;
  close: () => Promise<void>;
}

async function startServer(users: Record<string, PublicAppUser>): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const store: Store = { rows: new Map() };
  const systemAccountService = SystemAccountService.forTesting(makePool(store));

  const platformService = {
    async getUserFromAccessToken(token: string) {
      // PR-B: rute sa_-tokens via systemAccountService (matcher prod-flyt).
      if (token.startsWith("sa_")) {
        const verified = await systemAccountService.verify(token);
        if (!verified) throw new DomainError("UNAUTHORIZED", "bad sa-key");
        const hallId =
          verified.hallScope && verified.hallScope.length > 0 ? verified.hallScope[0]! : null;
        return {
          id: verified.id,
          email: `${verified.name}@system-account.local`,
          displayName: verified.name,
          walletId: `wallet-${verified.id}`,
          role: "ADMIN" as const,
          hallId,
          kycStatus: "VERIFIED" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          balance: 0,
          _systemAccount: {
            accountId: verified.id,
            accountName: verified.name,
            permissions: verified.permissions,
            hallScope: verified.hallScope,
          },
        };
      }
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminSystemAccountsRouter({
      platformService,
      systemAccountService,
      auditLogService,
    })
  );

  // Faux endepunkt for end-to-end-test: hvis caller har permission
  // GAME1_MASTER_WRITE → 200, ellers FORBIDDEN. Bruker object-form av
  // assertAdminPermission slik at SystemAccount-whitelist håndheves.
  app.post("/api/admin/test/protected", async (req, res) => {
    try {
      const token = getAccessTokenFromRequest(req);
      const user = await platformService.getUserFromAccessToken(token);
      assertAdminPermission(user, "GAME1_MASTER_WRITE" as AdminPermission);
      apiSuccess(res, { ok: true, callerName: user.displayName });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    auditStore,
    systemAccountService,
    store,
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

// ── Tests ─────────────────────────────────────────────────────────────────

test("PR-B: POST oppretter system-account som ADMIN, returnerer apiKey én gang", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "pilot-ops",
        description: "Tobias AI-flyt for pilot-test",
        permissions: ["GAME1_MASTER_WRITE", "ROOM_CONTROL_WRITE"],
        hallScope: null,
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const data = body.data as {
      id: string;
      name: string;
      apiKey: string;
      permissions: string[];
      hallScope: unknown;
    };
    assert.equal(data.name, "pilot-ops");
    assert.match(data.apiKey, /^sa_[0-9a-f]{32}$/, "apiKey skal være sa_<32hex>");
    assert.deepEqual(data.permissions, ["GAME1_MASTER_WRITE", "ROOM_CONTROL_WRITE"]);
    assert.equal(data.hallScope, null);
    // Audit
    const audit = await waitForAudit(ctx.auditStore, "system_account.create");
    assert.ok(audit);
    assert.equal(audit!.actorId, "admin-1");
    assert.equal(audit!.actorType, "ADMIN");
  } finally {
    await ctx.close();
  }
});

test("PR-B: POST avvist for AGENT (USER_ROLE_WRITE er ADMIN-only)", async () => {
  const ctx = await startServer({ "tok-agent": agentUser });
  try {
    const { status, body } = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-agent"),
      body: JSON.stringify({
        name: "should-fail",
        permissions: ["GAME1_MASTER_WRITE"],
      }),
    });
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    const error = body.error as { code: string };
    assert.equal(error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PR-B: POST avvist for HALL_OPERATOR + SUPPORT (USER_ROLE_WRITE = ADMIN-only)", async () => {
  const ctx = await startServer({
    "tok-op": operatorUser,
    "tok-sup": supportUser,
  });
  try {
    const opRes = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-op"),
      body: JSON.stringify({ name: "x", permissions: ["GAME1_MASTER_WRITE"] }),
    });
    assert.equal(opRes.status, 400);
    const supRes = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-sup"),
      body: JSON.stringify({ name: "x", permissions: ["GAME1_MASTER_WRITE"] }),
    });
    assert.equal(supRes.status, 400);
  } finally {
    await ctx.close();
  }
});

test("PR-B: POST avviser ugyldig permission-string", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "bad-perm",
        permissions: ["NOT_A_REAL_PERMISSION"],
      }),
    });
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    const error = body.error as { code: string };
    assert.equal(error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("PR-B: POST avviser tom hallScope-array", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status } = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "empty-scope",
        permissions: ["GAME1_MASTER_WRITE"],
        hallScope: [],
      }),
    });
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

test("PR-B: GET list returnerer system-accounts uten api_key_hash", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    // Opprett to keys
    await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "key-a",
        permissions: ["GAME1_MASTER_WRITE"],
      }),
    });
    await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "key-b",
        permissions: ["ROOM_CONTROL_WRITE"],
        hallScope: ["hall-a"],
      }),
    });
    // List
    const { status, body } = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      headers: authHeaders("tok-admin"),
    });
    assert.equal(status, 200);
    const data = body.data as { accounts: Array<Record<string, unknown>> };
    assert.equal(data.accounts.length, 2);
    for (const account of data.accounts) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(account, "apiKey"),
        "apiKey skal ikke finnes i list"
      );
      assert.ok(
        !Object.prototype.hasOwnProperty.call(account, "api_key_hash"),
        "api_key_hash skal ikke finnes i list"
      );
      assert.ok(
        !Object.prototype.hasOwnProperty.call(account, "apiKeyHash"),
        "apiKeyHash skal ikke finnes i list"
      );
    }
  } finally {
    await ctx.close();
  }
});

test("PR-B: DELETE revoke skriver audit-event og avviser deretter keyen", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    // Opprett
    const create = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "to-revoke",
        permissions: ["GAME1_MASTER_WRITE"],
      }),
    });
    const { id, apiKey } = create.body.data as { id: string; apiKey: string };
    // Bekreft den virker først
    const before = await ctx.systemAccountService.verify(apiKey);
    assert.ok(before);
    // Revoke
    const revoke = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts/${id}`, {
      method: "DELETE",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({ reason: "compromise-test" }),
    });
    assert.equal(revoke.status, 200);
    const data = revoke.body.data as { revoked: boolean };
    assert.equal(data.revoked, true);
    // Audit
    const audit = await waitForAudit(ctx.auditStore, "system_account.revoke");
    assert.ok(audit);
    assert.equal(audit!.actorId, "admin-1");
    // Etter revoke er keyen død
    const after = await ctx.systemAccountService.verify(apiKey);
    assert.equal(after, null);
  } finally {
    await ctx.close();
  }
});

test("PR-B: DELETE krever non-empty reason", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const create = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "needs-reason",
        permissions: ["GAME1_MASTER_WRITE"],
      }),
    });
    const { id } = create.body.data as { id: string };
    const noReason = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts/${id}`, {
      method: "DELETE",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({ reason: "" }),
    });
    assert.equal(noReason.status, 400);
  } finally {
    await ctx.close();
  }
});

test("PR-B: end-to-end — opprett key → bruk mot annet admin-endpoint → 200", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    // Opprett key med riktig permission
    const create = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "e2e-test",
        permissions: ["GAME1_MASTER_WRITE"],
        hallScope: null,
      }),
    });
    const { apiKey } = create.body.data as { apiKey: string };
    // Bruk apiKey mot faux endepunkt som krever GAME1_MASTER_WRITE
    const useRes = await jsonFetch(`${ctx.baseUrl}/api/admin/test/protected`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({}),
    });
    assert.equal(useRes.status, 200);
    const data = useRes.body.data as { ok: boolean; callerName: string };
    assert.equal(data.ok, true);
    assert.equal(data.callerName, "e2e-test");
  } finally {
    await ctx.close();
  }
});

test("PR-B: end-to-end — key uten påkrevd permission → 403 FORBIDDEN", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    // Opprett key med en annen permission enn faux-endpoint trenger
    const create = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "limited-perms",
        // Mangler GAME1_MASTER_WRITE som faux-endpoint krever
        permissions: ["ROOM_CONTROL_WRITE"],
      }),
    });
    const { apiKey } = create.body.data as { apiKey: string };
    const useRes = await jsonFetch(`${ctx.baseUrl}/api/admin/test/protected`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({}),
    });
    assert.equal(useRes.status, 400);
    const error = useRes.body.error as { code: string };
    assert.equal(error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PR-B: end-to-end — revoked key avvises med UNAUTHORIZED", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const create = await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({
        name: "to-be-revoked",
        permissions: ["GAME1_MASTER_WRITE"],
      }),
    });
    const { id, apiKey } = create.body.data as { id: string; apiKey: string };
    // Revoke
    await jsonFetch(`${ctx.baseUrl}/api/admin/system-accounts/${id}`, {
      method: "DELETE",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({ reason: "test" }),
    });
    // Bruk revoked apiKey
    const useRes = await jsonFetch(`${ctx.baseUrl}/api/admin/test/protected`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({}),
    });
    assert.equal(useRes.status, 400);
    const error = useRes.body.error as { code: string };
    assert.equal(error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("PR-B: end-to-end — JWT-token (ikke sa_) fungerer som før (uendret JWT-flyt)", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    // Bruk vanlig JWT-token mot faux endepunkt — skal fungere fordi adminUser
    // har role=ADMIN og GAME1_MASTER_WRITE inkluderer ADMIN.
    const useRes = await jsonFetch(`${ctx.baseUrl}/api/admin/test/protected`, {
      method: "POST",
      headers: authHeaders("tok-admin"),
      body: JSON.stringify({}),
    });
    assert.equal(useRes.status, 200);
  } finally {
    await ctx.close();
  }
});

test("PR-B: isSystemAccountKey skiller sa_ fra andre tokens (via util)", () => {
  assert.equal(isSystemAccountKey("sa_abc"), true);
  assert.equal(isSystemAccountKey("eyJsomething"), false);
});
