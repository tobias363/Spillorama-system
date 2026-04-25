/**
 * GAP #35 — middleware-tester for requireVerifyToken.
 *
 * Dekker:
 *   - manglende X-Verify-Token-header → 403 VERIFY_TOKEN_REQUIRED
 *   - ukjent token → 403 VERIFY_TOKEN_INVALID
 *   - utløpt token → 403 VERIFY_TOKEN_EXPIRED
 *   - bruk av token → 403 VERIFY_TOKEN_ALREADY_USED ved replay
 *   - token bundet til feil bruker → 403 VERIFY_TOKEN_USER_MISMATCH
 *   - happy-path: handler kalles, token konsumeres
 *   - access-token-fail → 401 (UNAUTHORIZED) før verify-token brennes
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { VerifyTokenService } from "../auth/VerifyTokenService.js";
import { requireVerifyToken } from "./verifyToken.js";
import { DomainError } from "../game/BingoEngine.js";

interface Ctx {
  baseUrl: string;
  svc: VerifyTokenService;
  close: () => Promise<void>;
}

async function startServer(opts: {
  authenticatedUserIdResolver?: (token: string) => Promise<string>;
}): Promise<Ctx> {
  const svc = new VerifyTokenService();

  const app = express();
  app.use(express.json());
  app.post(
    "/protected",
    requireVerifyToken({
      verifyTokenService: svc,
      getAuthenticatedUserId: async (req) => {
        const auth = req.headers.authorization;
        if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
          throw new DomainError("UNAUTHORIZED", "Mangler Authorization");
        }
        const token = auth.slice("Bearer ".length).trim();
        const resolver = opts.authenticatedUserIdResolver ?? (async (t) => `user-${t}`);
        return resolver(token);
      },
    }),
    (_req, res) => {
      res.json({ ok: true, data: { ran: true } });
    }
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    svc,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function postProtected(
  ctx: Ctx,
  options: { authToken?: string; verifyToken?: string }
): Promise<{ status: number; body: { ok: boolean; data?: unknown; error?: { code: string } } }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;
  if (options.verifyToken) headers["X-Verify-Token"] = options.verifyToken;
  const res = await fetch(`${ctx.baseUrl}/protected`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const body = await res.json();
  return { status: res.status, body: body as never };
}

test("GAP #35: mangler verify-token-header → 403 VERIFY_TOKEN_REQUIRED", async () => {
  const ctx = await startServer({});
  try {
    const res = await postProtected(ctx, { authToken: "user-1-access" });
    assert.equal(res.status, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "VERIFY_TOKEN_REQUIRED");
  } finally {
    await ctx.close();
  }
});

test("GAP #35: ukjent verify-token → 403 VERIFY_TOKEN_INVALID", async () => {
  const ctx = await startServer({});
  try {
    const res = await postProtected(ctx, {
      authToken: "user-1-access",
      verifyToken: "totally-bogus",
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error?.code, "VERIFY_TOKEN_INVALID");
  } finally {
    await ctx.close();
  }
});

test("GAP #35: utløpt verify-token → 403 VERIFY_TOKEN_EXPIRED", async () => {
  const ctx = await startServer({});
  try {
    // Lag en utløpt service-instans direkte og bruk for utstedelse.
    let nowMs = 1_000;
    const expiredSvc = new VerifyTokenService({ ttlMs: 100, now: () => nowMs });
    const { token } = expiredSvc.create("user-bingo-1-access");
    nowMs += 1_000;
    // Vi kan ikke direkte stille klokken på serverens svc. I stedet —
    // siden serverens svc er separat instans — registrer tokenet via en
    // ny test som monterer expiredSvc:
    const app = express();
    app.use(express.json());
    app.post(
      "/x",
      requireVerifyToken({
        verifyTokenService: expiredSvc,
        getAuthenticatedUserId: async () => "user-bingo-1-access",
      }),
      (_req, res) => res.json({ ok: true, data: {} })
    );
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const addr = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/x`, {
      method: "POST",
      headers: {
        Authorization: "Bearer user-bingo-1-access",
        "X-Verify-Token": token,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    assert.equal(res.status, 403);
    assert.equal(body.error?.code, "VERIFY_TOKEN_EXPIRED");
    await new Promise<void>((r) => server.close(() => r()));
  } finally {
    await ctx.close();
  }
});

test("GAP #35: user-mismatch → 403 VERIFY_TOKEN_USER_MISMATCH", async () => {
  // Resolver-token lyver: 'token-A' resolves til 'user-A', men verify-token
  // utstedt for 'user-B'. Skal feile uten å konsumere.
  const ctx = await startServer({
    authenticatedUserIdResolver: async (t) => `mapped-${t}`,
  });
  try {
    const { token: verifyToken } = ctx.svc.create("a-different-user");
    const res = await postProtected(ctx, {
      authToken: "alice", // resolver gir userId="mapped-alice"
      verifyToken,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error?.code, "VERIFY_TOKEN_USER_MISMATCH");
    // Tokenet skal IKKE være konsumert (validate ikke consume).
    const validated = ctx.svc.validate(verifyToken);
    assert.equal(validated.userId, "a-different-user", "token forblir gyldig etter user-mismatch");
  } finally {
    await ctx.close();
  }
});

test("GAP #35: happy-path → handler kalles, token konsumeres", async () => {
  const ctx = await startServer({
    authenticatedUserIdResolver: async (_t) => "user-1",
  });
  try {
    const { token: verifyToken } = ctx.svc.create("user-1");
    const res = await postProtected(ctx, {
      authToken: "anything",
      verifyToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.data, { ran: true });

    // Replay → ALREADY_USED.
    const replay = await postProtected(ctx, {
      authToken: "anything",
      verifyToken,
    });
    assert.equal(replay.status, 403);
    assert.equal(replay.body.error?.code, "VERIFY_TOKEN_ALREADY_USED");
  } finally {
    await ctx.close();
  }
});

test("GAP #35: access-token-fail → 401, verify-token forblir gyldig", async () => {
  const ctx = await startServer({});
  try {
    const { token: verifyToken } = ctx.svc.create("user-1");
    // Ingen Authorization-header → resolver kaster UNAUTHORIZED.
    const res = await postProtected(ctx, { verifyToken });
    assert.equal(res.status, 401);
    assert.equal(res.body.error?.code, "UNAUTHORIZED");
    // Token forblir gyldig — vi brente det ikke på UNAUTHORIZED-feil.
    const validated = ctx.svc.validate(verifyToken);
    assert.equal(validated.userId, "user-1");
  } finally {
    await ctx.close();
  }
});
