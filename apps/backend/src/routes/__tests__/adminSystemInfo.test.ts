/**
 * BIN-678: tests for adminSystemInfo.
 *
 * Dekker:
 *   - GET /api/admin/system/info returnerer forventet shape
 *   - SETTINGS_READ gir ADMIN + HALL_OPERATOR + SUPPORT tilgang
 *   - PLAYER-rolle får 400 FORBIDDEN
 *   - uptime regnes fra injisert startTime via injisert now-funksjon
 *   - overrides er deterministiske (ingen git/process/env-leak)
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminSystemInfoRouter } from "../adminSystemInfo.js";
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

async function startServer(users: Record<string, PublicAppUser>): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const router = createAdminSystemInfoRouter({
    platformService,
    overrides: {
      version: "1.2.3",
      buildSha: "abc1234",
      buildTime: "2026-04-20T10:00:00.000Z",
      nodeVersion: "v22.0.0",
      env: "test",
      startTimeMs: 1000000,
      now: () => 1000000 + 42_000, // 42 seconds later
      features: { feature_a: true, feature_b: false },
    },
  });

  const app = express();
  app.use(express.json());
  app.use(router);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function call(
  baseUrl: string,
  token: string
): Promise<{ status: number; body: { ok: boolean; data?: unknown; error?: { code: string } } }> {
  const res = await fetch(`${baseUrl}/api/admin/system/info`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return { status: res.status, body: body as never };
}

test("adminSystemInfo: ADMIN får full snapshot", async () => {
  const ctx = await startServer({ "tok-admin": makeUser("ADMIN") });
  try {
    const res = await call(ctx.baseUrl, "tok-admin");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const data = res.body.data as {
      version: string;
      buildSha: string;
      buildTime: string;
      nodeVersion: string;
      env: string;
      uptime: number;
      features: Record<string, boolean>;
    };
    assert.equal(data.version, "1.2.3");
    assert.equal(data.buildSha, "abc1234");
    assert.equal(data.buildTime, "2026-04-20T10:00:00.000Z");
    assert.equal(data.nodeVersion, "v22.0.0");
    assert.equal(data.env, "test");
    assert.equal(data.uptime, 42);
    assert.deepEqual(data.features, { feature_a: true, feature_b: false });
  } finally {
    await ctx.close();
  }
});

test("adminSystemInfo: HALL_OPERATOR får tilgang (SETTINGS_READ)", async () => {
  const ctx = await startServer({
    "tok-op": { ...makeUser("HALL_OPERATOR", "op"), hallId: "h1" },
  });
  try {
    const res = await call(ctx.baseUrl, "tok-op");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  } finally {
    await ctx.close();
  }
});

test("adminSystemInfo: SUPPORT får tilgang (SETTINGS_READ)", async () => {
  const ctx = await startServer({ "tok-sup": makeUser("SUPPORT", "sup") });
  try {
    const res = await call(ctx.baseUrl, "tok-sup");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  } finally {
    await ctx.close();
  }
});

test("adminSystemInfo: PLAYER får 400 FORBIDDEN", async () => {
  const ctx = await startServer({ "tok-pl": makeUser("PLAYER", "pl") });
  try {
    const res = await call(ctx.baseUrl, "tok-pl");
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("adminSystemInfo: manglende token gir 400 UNAUTHORIZED", async () => {
  const ctx = await startServer({ "tok-admin": makeUser("ADMIN") });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/admin/system/info`);
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});
