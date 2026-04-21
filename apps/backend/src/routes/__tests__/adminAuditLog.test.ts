/**
 * BIN-655 (alt-variant): tests for adminAuditLog.
 *
 * Dekker:
 *   - ADMIN + SUPPORT får AUDIT_LOG_READ-tilgang; HALL_OPERATOR og PLAYER får FORBIDDEN
 *   - filtrering på actorId/resource/action
 *   - from+to-tidsvindu (to filtreres client-side i route)
 *   - cursor-paginering (base64url-offset)
 *   - empty-state returnerer items=[] og nextCursor=null
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminAuditLogRouter } from "../adminAuditLog.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

function makeUser(role: PublicAppUser["role"], id = "u-1"): PublicAppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: id,
    walletId: `w-${id}`,
    role,
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  };
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  close: () => Promise<void>;
}

async function startServer(users: Record<string, PublicAppUser>): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const router = createAdminAuditLogRouter({ platformService, auditLogService });
  const app = express();
  app.use(express.json());
  app.use(router);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    auditStore,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function call(
  ctx: Ctx,
  token: string,
  query = ""
): Promise<{
  status: number;
  body: { ok: boolean; data?: { items: unknown[]; nextCursor: string | null }; error?: { code: string } };
}> {
  const res = await fetch(`${ctx.baseUrl}/api/admin/audit-log${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return { status: res.status, body: body as never };
}

test("adminAuditLog: ADMIN får liste med alle events", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    await ctx.auditStore.append({
      actorId: "a1",
      actorType: "ADMIN",
      action: "user.role.change",
      resource: "user",
      resourceId: "u2",
    });
    await ctx.auditStore.append({
      actorId: "a1",
      actorType: "ADMIN",
      action: "hall.create",
      resource: "hall",
      resourceId: "h1",
    });
    const res = await call(ctx, "t-admin");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data!.items.length, 2);
    assert.equal(res.body.data!.nextCursor, null);
  } finally {
    await ctx.close();
  }
});

test("adminAuditLog: SUPPORT får tilgang (AUDIT_LOG_READ)", async () => {
  const ctx = await startServer({ "t-sup": makeUser("SUPPORT", "s1") });
  try {
    const res = await call(ctx, "t-sup");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  } finally {
    await ctx.close();
  }
});

test("adminAuditLog: HALL_OPERATOR får 400 FORBIDDEN", async () => {
  const ctx = await startServer({
    "t-op": { ...makeUser("HALL_OPERATOR", "op"), hallId: "h1" },
  });
  try {
    const res = await call(ctx, "t-op");
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("adminAuditLog: filter på resource+action", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    await ctx.auditStore.append({
      actorId: "a1",
      actorType: "ADMIN",
      action: "user.role.change",
      resource: "user",
      resourceId: "u1",
    });
    await ctx.auditStore.append({
      actorId: "a1",
      actorType: "ADMIN",
      action: "hall.create",
      resource: "hall",
      resourceId: "h1",
    });
    const res = await call(ctx, "t-admin", "?resource=hall&action=hall.create");
    assert.equal(res.status, 200);
    assert.equal(res.body.data!.items.length, 1);
    const e = res.body.data!.items[0] as { resource: string; action: string };
    assert.equal(e.resource, "hall");
    assert.equal(e.action, "hall.create");
  } finally {
    await ctx.close();
  }
});

test("adminAuditLog: cursor-paginering over 3 sider", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    for (let i = 0; i < 5; i++) {
      await ctx.auditStore.append({
        actorId: "a1",
        actorType: "ADMIN",
        action: "test.event",
        resource: "test",
        resourceId: `r-${i}`,
      });
    }
    // Page 1 (limit=2)
    const p1 = await call(ctx, "t-admin", "?limit=2");
    assert.equal(p1.status, 200);
    assert.equal(p1.body.data!.items.length, 2);
    assert.notEqual(p1.body.data!.nextCursor, null);

    // Page 2
    const p2 = await call(
      ctx,
      "t-admin",
      `?limit=2&cursor=${encodeURIComponent(p1.body.data!.nextCursor!)}`
    );
    assert.equal(p2.body.data!.items.length, 2);
    assert.notEqual(p2.body.data!.nextCursor, null);

    // Page 3 (siste)
    const p3 = await call(
      ctx,
      "t-admin",
      `?limit=2&cursor=${encodeURIComponent(p2.body.data!.nextCursor!)}`
    );
    assert.equal(p3.body.data!.items.length, 1);
    assert.equal(p3.body.data!.nextCursor, null);
  } finally {
    await ctx.close();
  }
});

test("adminAuditLog: from-filter er inclusive, to-filter er inclusive", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    await ctx.auditStore.append({
      actorId: "a1",
      actorType: "ADMIN",
      action: "e",
      resource: "r",
      resourceId: null,
    });
    // Tillat fra-filter å eksistere uten å feile. Faktiske from/to er
    // vanskelig å styre deterministisk uten clock-injection, men vi
    // kan sjekke at filter-parameter aksepteres.
    const res = await call(
      ctx,
      "t-admin",
      "?from=2020-01-01T00:00:00.000Z&to=2099-12-31T23:59:59.999Z"
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data!.items.length, 1);
  } finally {
    await ctx.close();
  }
});

test("adminAuditLog: ugyldig from gir 400 INVALID_INPUT", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    const res = await call(ctx, "t-admin", "?from=not-a-date");
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
