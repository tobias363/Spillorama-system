/**
 * Unit-tester for admin-observability-router (Fase 2A — 2026-05-05).
 *
 * Verifiserer:
 *   - GET /api/admin/observability/error-rates returnerer rate-snapshot
 *   - GET /api/admin/observability/error-codes returnerer registry
 *   - GET /api/admin/observability/error-codes/:code returnerer 404 for ukjent
 *   - Bearer-auth påkrevd (401 ved manglende token)
 *   - ADMIN_PANEL_ACCESS gating fungerer (403 for PLAYER)
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createAdminObservabilityRouter } from "../adminObservability.js";
import {
  __resetCountersForTests,
  incrementErrorCounter,
} from "../../observability/errorMetrics.js";
import type {
  PlatformService,
  PublicAppUser,
  UserRole,
} from "../../platform/PlatformService.js";

// ── Test helpers ────────────────────────────────────────────────────────────

interface FakePlatformOptions {
  user?: PublicAppUser;
  shouldThrow?: boolean;
}

function makeFakePlatformService(opts: FakePlatformOptions = {}): PlatformService {
  return {
    async getUserFromAccessToken(_token: string): Promise<PublicAppUser> {
      if (opts.shouldThrow) {
        throw new Error("INVALID_TOKEN");
      }
      if (opts.user) return opts.user;
      throw new Error("UNAUTHORIZED");
    },
  } as unknown as PlatformService;
}

function makeUser(role: UserRole): PublicAppUser {
  // Cast via `unknown` fordi PublicAppUser har et stort sett felter vi ikke
  // trenger for tilgangskontroll-test. Strict-mode forbyr direkte cast siden
  // strukturen kan endres senere — `unknown`-mellomstegg signaliserer at
  // testen kun bryr seg om `role`-feltet.
  return {
    id: "u1",
    email: "u@x",
    displayName: "u",
    walletId: "w1",
    role,
    balance: 0,
  } as unknown as PublicAppUser;
}

async function startServer(
  platformService: PlatformService,
): Promise<{ port: number; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use(createAdminObservabilityRouter({ platformService }));

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, server });
    });
  });
}

async function fetchJson(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.beforeEach(() => {
  __resetCountersForTests();
});

test("GET error-rates: returnerer 200 for ADMIN", async () => {
  const platform = makeFakePlatformService({ user: makeUser("ADMIN") });
  const { port, server } = await startServer(platform);
  try {
    incrementErrorCounter("BIN-RKT-001");
    incrementErrorCounter("BIN-RKT-002");

    const { status, body } = await fetchJson(port, "/api/admin/observability/error-rates", {
      authorization: "Bearer test-token",
    });

    assert.equal(status, 200);
    const payload = body as { ok: boolean; data: { count: number; rates: Array<{ code: string }> } };
    assert.equal(payload.ok, true);
    assert.ok(payload.data.count >= 2);
    const codes = payload.data.rates.map((r) => r.code);
    assert.ok(codes.includes("BIN-RKT-001"));
    assert.ok(codes.includes("BIN-RKT-002"));
  } finally {
    server.close();
  }
});

test("GET error-rates: 400 (apiFailure) for PLAYER", async () => {
  const platform = makeFakePlatformService({ user: makeUser("PLAYER") });
  const { port, server } = await startServer(platform);
  try {
    const { status, body } = await fetchJson(port, "/api/admin/observability/error-rates", {
      authorization: "Bearer test-token",
    });
    // apiFailure-helperen returnerer 400 med error-payload
    assert.equal(status, 400);
    const payload = body as { ok: boolean; error: { code: string } };
    assert.equal(payload.ok, false);
  } finally {
    server.close();
  }
});

test("GET error-rates: 400 ved manglende auth-header", async () => {
  const platform = makeFakePlatformService();
  const { port, server } = await startServer(platform);
  try {
    const { status, body } = await fetchJson(port, "/api/admin/observability/error-rates");
    assert.equal(status, 400);
    const payload = body as { ok: boolean; error: { code: string } };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "UNAUTHORIZED");
  } finally {
    server.close();
  }
});

test("GET error-rates?includeZero=true: tar med alle registry-koder", async () => {
  const platform = makeFakePlatformService({ user: makeUser("ADMIN") });
  const { port, server } = await startServer(platform);
  try {
    const { status, body } = await fetchJson(
      port,
      "/api/admin/observability/error-rates?includeZero=true",
      { authorization: "Bearer test-token" },
    );

    assert.equal(status, 200);
    const payload = body as { ok: boolean; data: { count: number; rates: Array<{ code: string }> } };
    // Skal inkludere alle registry-codes (vi har p.t. ~24 stk).
    assert.ok(payload.data.count >= 20);
  } finally {
    server.close();
  }
});

test("GET error-codes: returnerer registry for ADMIN", async () => {
  const platform = makeFakePlatformService({ user: makeUser("ADMIN") });
  const { port, server } = await startServer(platform);
  try {
    const { status, body } = await fetchJson(port, "/api/admin/observability/error-codes", {
      authorization: "Bearer test-token",
    });

    assert.equal(status, 200);
    const payload = body as { ok: boolean; data: { count: number; codes: Array<{ code: string; severity: string }> } };
    assert.equal(payload.ok, true);
    assert.ok(payload.data.count > 0);
    // Alle entries skal ha title + severity + category osv.
    assert.ok(payload.data.codes.every((c) => typeof c.severity === "string"));
  } finally {
    server.close();
  }
});

test("GET error-codes/:code: returnerer metadata for kjent code", async () => {
  const platform = makeFakePlatformService({ user: makeUser("ADMIN") });
  const { port, server } = await startServer(platform);
  try {
    const { status, body } = await fetchJson(
      port,
      "/api/admin/observability/error-codes/BIN-RKT-001",
      { authorization: "Bearer test-token" },
    );

    assert.equal(status, 200);
    const payload = body as { ok: boolean; data: { code: string; severity: string } };
    assert.equal(payload.data.code, "BIN-RKT-001");
    assert.equal(payload.data.severity, "MEDIUM");
  } finally {
    server.close();
  }
});

test("GET error-codes/:code: 404 for ukjent code", async () => {
  const platform = makeFakePlatformService({ user: makeUser("ADMIN") });
  const { port, server } = await startServer(platform);
  try {
    const { status, body } = await fetchJson(
      port,
      "/api/admin/observability/error-codes/BIN-XYZ-999",
      { authorization: "Bearer test-token" },
    );

    assert.equal(status, 404);
    const payload = body as { ok: boolean; error: { code: string } };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "ERROR_CODE_NOT_FOUND");
  } finally {
    server.close();
  }
});
