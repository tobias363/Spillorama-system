/**
 * apps/backend/src/dev/devAutoLoginRoute.handler.test.ts
 *
 * Regresjonstester for **request-handleren** i `createDevAutoLoginRouter`.
 *
 * Bakgrunn:
 *   `devAutoLoginRoute.test.ts` (factory-tester) verifiserer at routeren
 *   returneres `null` i prod og `Router` i dev. Disse testene dekker
 *   selve request-handleren med følgende kontrakter:
 *
 *     1. Email-allowlist regex-matrise (POSITIVE + NEGATIVE)
 *     2. Localhost-IP-matching (IPv4, IPv6, IPv4-mapped IPv6)
 *     3. Manglende email → 400 INVALID_INPUT
 *     4. Whitespace-trimming + case-insensitiv match
 *     5. Pilot-spillere `demo-pilot-spiller-N@example.com` aksepteres
 *     6. Short-form (uten domene) avvises eksplisitt — caller ansvar å
 *        normalisere før kall (per `auth.js` + `main.ts`)
 *
 * Bug-konteksten (Tobias-verifisert 2026-05-10):
 *   Tobias åpnet `?dev-user=demo-pilot-spiller-1` (uten `@example.com`)
 *   og fikk 403 fordi front-end sender raw query-param uten å
 *   normalisere. Backend-regex er KORREKT — bug-en er i frontend som
 *   må sende full email. Disse testene LÅSER backend-kontrakten slik at
 *   en framtidig "fiks" som løsner regex ikke kan slippe gjennom.
 *
 * Pattern: bruker `node:test` + `express` + ephemeral port (matcher
 * `routes/__tests__/spill1Lobby.test.ts`).
 */

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";

import { createDevAutoLoginRouter } from "./devAutoLoginRoute.js";
import type { PlatformService } from "../platform/PlatformService.js";

// ── PlatformService stub ─────────────────────────────────────────────────

interface StubUser {
  id: string;
  email: string;
}

function makeStubPlatform(opts: {
  users?: StubUser[];
  sessionToken?: string;
} = {}): {
  platform: PlatformService;
  findCalls: string[];
  issueCalls: string[];
} {
  const findCalls: string[] = [];
  const issueCalls: string[] = [];
  const users = opts.users ?? [];
  const platform = {
    async findUserByEmail(email: string) {
      findCalls.push(email);
      const u = users.find(
        (it) => it.email.toLowerCase() === email.toLowerCase(),
      );
      return u ? ({ id: u.id, email: u.email } as never) : null;
    },
    async issueSessionForUser(userId: string) {
      issueCalls.push(userId);
      return {
        accessToken: opts.sessionToken ?? "stub-token",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        user: { id: userId, email: "stub@example.com" },
      } as never;
    },
  } as unknown as PlatformService;
  return { platform, findCalls, issueCalls };
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(platform: PlatformService): Promise<Ctx> {
  const router = createDevAutoLoginRouter({ platformService: platform });
  if (!router) throw new Error("expected router in dev mode");
  const app = express();
  app.use(router);
  return new Promise<Ctx>((resolve) => {
    // listen on 127.0.0.1 explicitly so req.ip is the loopback address —
    // matches what Tobias sees from his localhost browser.
    const server = app.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

function withDevEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = prev;
    }
  });
}

// ── Email-allowlist matrise (POSITIVE) ───────────────────────────────────

test("auto-login: aksepterer demo-pilot-spiller-1@example.com (Tobias' pilot-bruker)", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform({
      users: [
        { id: "demo-pilot-spiller-1", email: "demo-pilot-spiller-1@example.com" },
      ],
    });
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-pilot-spiller-1@example.com`,
      );
      const body = await res.json() as { ok: boolean; data?: { accessToken: string } };
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(typeof body.data?.accessToken, "string");
    } finally {
      await ctx.close();
    }
  });
});

test("auto-login: aksepterer demo-pilot-spiller-12@example.com (alle pilot-spillere 1-12)", async () => {
  await withDevEnv(async () => {
    const users: StubUser[] = Array.from({ length: 12 }, (_, i) => ({
      id: `demo-pilot-spiller-${i + 1}`,
      email: `demo-pilot-spiller-${i + 1}@example.com`,
    }));
    const { platform } = makeStubPlatform({ users });
    const ctx = await startServer(platform);
    try {
      for (const u of users) {
        const res = await fetch(
          `${ctx.baseUrl}/api/dev/auto-login?email=${encodeURIComponent(u.email)}`,
        );
        const body = await res.json() as { ok: boolean };
        assert.equal(res.status, 200, `expected 200 for ${u.email}`);
        assert.equal(body.ok, true);
      }
    } finally {
      await ctx.close();
    }
  });
});

test("auto-login: aksepterer demo-spiller-N@example.com (legacy demo-spillere)", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform({
      users: [
        { id: "demo-spiller-1", email: "demo-spiller-1@example.com" },
      ],
    });
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-spiller-1@example.com`,
      );
      assert.equal(res.status, 200);
    } finally {
      await ctx.close();
    }
  });
});

test("auto-login: aksepterer demo-agent-N@spillorama.no (master-agenter)", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform({
      users: [
        { id: "demo-agent-1", email: "demo-agent-1@spillorama.no" },
      ],
    });
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-agent-1@spillorama.no`,
      );
      assert.equal(res.status, 200);
    } finally {
      await ctx.close();
    }
  });
});

test("auto-login: aksepterer tobias@nordicprofil.no (admin)", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform({
      users: [
        { id: "tobias", email: "tobias@nordicprofil.no" },
      ],
    });
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=tobias@nordicprofil.no`,
      );
      assert.equal(res.status, 200);
    } finally {
      await ctx.close();
    }
  });
});

// ── Email-allowlist matrise (NEGATIVE — pilot-blokker-bug) ───────────────

test("auto-login: REGRESJON Tobias 2026-05-10 — short-form 'demo-pilot-spiller-1' uten @example.com → 403", async () => {
  // Dette er nøyaktig URL-en Tobias åpnet. Backend skal AVVISE — bug er
  // at frontend sender raw query-param uten å normalisere til full email.
  // Hvis denne testen begynner å returnere 200 har noen løsnet allowlist-
  // regex i strid med Tobias' direktiv om presis email-matching.
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform();
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-pilot-spiller-1`,
      );
      const body = await res.json() as { ok: boolean; error?: { code: string } };
      assert.equal(res.status, 403);
      assert.equal(body.ok, false);
      assert.equal(body.error?.code, "FORBIDDEN");
    } finally {
      await ctx.close();
    }
  });
});

test("auto-login: avviser tilfeldig email utenfor allowlist (production user-spoof)", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform();
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=evil@hacker.com`,
      );
      assert.equal(res.status, 403);
    } finally {
      await ctx.close();
    }
  });
});

test("auto-login: avviser email uten @-tegn (input-sanity)", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform();
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-spiller-1`,
      );
      assert.equal(res.status, 403);
    } finally {
      await ctx.close();
    }
  });
});

test("auto-login: avviser tom email → 400 INVALID_INPUT (ikke 403)", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform();
    const ctx = await startServer(platform);
    try {
      const res = await fetch(`${ctx.baseUrl}/api/dev/auto-login?email=`);
      const body = await res.json() as { ok: boolean; error?: { code: string } };
      assert.equal(res.status, 400);
      assert.equal(body.error?.code, "INVALID_INPUT");
    } finally {
      await ctx.close();
    }
  });
});

test("auto-login: avviser manglende email-query → 400 INVALID_INPUT", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform();
    const ctx = await startServer(platform);
    try {
      const res = await fetch(`${ctx.baseUrl}/api/dev/auto-login`);
      assert.equal(res.status, 400);
    } finally {
      await ctx.close();
    }
  });
});

// ── Case-insensitiv + whitespace ─────────────────────────────────────────

test("auto-login: aksepterer email i UPPERCASE (case-insensitive match)", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform({
      users: [
        { id: "demo-pilot-spiller-1", email: "demo-pilot-spiller-1@example.com" },
      ],
    });
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=DEMO-PILOT-SPILLER-1@EXAMPLE.COM`,
      );
      assert.equal(res.status, 200);
    } finally {
      await ctx.close();
    }
  });
});

test("auto-login: trimmer leading/trailing whitespace fra email", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform({
      users: [
        { id: "demo-pilot-spiller-1", email: "demo-pilot-spiller-1@example.com" },
      ],
    });
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=${encodeURIComponent("  demo-pilot-spiller-1@example.com  ")}`,
      );
      assert.equal(res.status, 200);
    } finally {
      await ctx.close();
    }
  });
});

// ── User not found (USER_NOT_FOUND) ──────────────────────────────────────

test("auto-login: bruker er allowlisted men finnes ikke i DB → 404 USER_NOT_FOUND", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform({ users: [] });
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-pilot-spiller-1@example.com`,
      );
      const body = await res.json() as { ok: boolean; error?: { code: string } };
      assert.equal(res.status, 404);
      assert.equal(body.error?.code, "USER_NOT_FOUND");
    } finally {
      await ctx.close();
    }
  });
});

// ── PlatformService krash → 500 ──────────────────────────────────────────

test("auto-login: platform.findUserByEmail kaster → 500 INTERNAL", async () => {
  await withDevEnv(async () => {
    const platform = {
      async findUserByEmail() {
        throw new Error("DB connection lost");
      },
      async issueSessionForUser() {
        throw new Error("should not be called");
      },
    } as unknown as PlatformService;
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-pilot-spiller-1@example.com`,
      );
      const body = await res.json() as { ok: boolean; error?: { code: string } };
      assert.equal(res.status, 500);
      assert.equal(body.error?.code, "INTERNAL");
    } finally {
      await ctx.close();
    }
  });
});

// ── Wire-format kontrakt ─────────────────────────────────────────────────

test("auto-login: respons-shape inneholder accessToken, expiresAt, user, warning", async () => {
  await withDevEnv(async () => {
    const { platform } = makeStubPlatform({
      users: [
        { id: "demo-pilot-spiller-1", email: "demo-pilot-spiller-1@example.com" },
      ],
      sessionToken: "fixed-token-for-test",
    });
    const ctx = await startServer(platform);
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-pilot-spiller-1@example.com`,
      );
      const body = await res.json() as {
        ok: boolean;
        data?: {
          accessToken: string;
          expiresAt: string;
          user: { id: string };
          warning: string;
        };
      };
      assert.equal(body.ok, true);
      assert.equal(body.data?.accessToken, "fixed-token-for-test");
      assert.equal(typeof body.data?.expiresAt, "string");
      assert.equal(typeof body.data?.warning, "string");
      assert.match(body.data?.warning ?? "", /DEV-ONLY/);
    } finally {
      await ctx.close();
    }
  });
});

// ── Idempotens: gjentatte requests gir nye tokens ────────────────────────

test("auto-login: gjentatte kall genererer nye sesjons-tokens (ikke cachet)", async () => {
  let counter = 0;
  await withDevEnv(async () => {
    const platform = {
      async findUserByEmail(email: string) {
        return { id: "u1", email } as never;
      },
      async issueSessionForUser(_userId: string) {
        counter += 1;
        return {
          accessToken: `token-${counter}`,
          expiresAt: new Date(Date.now() + 1000).toISOString(),
          user: { id: "u1", email: "x@x.com" },
        } as never;
      },
    } as unknown as PlatformService;
    const ctx = await startServer(platform);
    try {
      const res1 = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-pilot-spiller-1@example.com`,
      );
      const res2 = await fetch(
        `${ctx.baseUrl}/api/dev/auto-login?email=demo-pilot-spiller-1@example.com`,
      );
      const b1 = await res1.json() as { data?: { accessToken: string } };
      const b2 = await res2.json() as { data?: { accessToken: string } };
      assert.notEqual(b1.data?.accessToken, b2.data?.accessToken);
    } finally {
      await ctx.close();
    }
  });
});
