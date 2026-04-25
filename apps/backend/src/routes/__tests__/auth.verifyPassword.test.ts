/**
 * GAP #35 — integration-test for `/api/auth/verify-password`-endepunktet.
 *
 * Dekker:
 *   - happy-path: korrekt passord → 200 med { verifyToken, expiresAt }
 *   - feil passord → 401 INVALID_CREDENTIALS
 *   - manglende password-felt → INVALID_INPUT
 *   - manglende access-token → UNAUTHORIZED
 *   - VerifyTokenService ikke wired → 501 VERIFY_TOKEN_NOT_CONFIGURED
 *   - utstedt token er ekte (kan brukes mot middleware)
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAuthRouter } from "../auth.js";
import { VerifyTokenService } from "../../auth/VerifyTokenService.js";
import { DomainError } from "../../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
import type { AuthTokenService } from "../../auth/AuthTokenService.js";
import type { EmailService } from "../../integration/EmailService.js";

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
  } as PublicAppUser;
}

interface Ctx {
  baseUrl: string;
  verifyTokenService?: VerifyTokenService;
  platformVerifyResults: Record<string, boolean>;
  close: () => Promise<void>;
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  // userId → password → boolean (om passordet er gyldig)
  passwordCheck?: (userId: string, password: string) => boolean;
  withVerifyService?: boolean;
}): Promise<Ctx> {
  const verifyTokenService = opts.withVerifyService === false
    ? undefined
    : new VerifyTokenService();

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async verifyUserPassword(userId: string, password: string) {
      const fn = opts.passwordCheck ?? (() => false);
      return fn(userId, password);
    },
  } as unknown as PlatformService;

  const walletAdapterStub = {} as WalletAdapter;
  const authTokenServiceStub = {} as AuthTokenService;
  const emailServiceStub = {} as EmailService;

  const router = createAuthRouter({
    platformService,
    walletAdapter: walletAdapterStub,
    bankIdAdapter: null,
    authTokenService: authTokenServiceStub,
    verifyTokenService,
    emailService: emailServiceStub,
    webBaseUrl: "http://localhost",
    supportEmail: "support@test.no",
  });

  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    verifyTokenService,
    platformVerifyResults: {},
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

async function postVerifyPassword(
  ctx: Ctx,
  options: { authToken?: string; password?: string }
): Promise<{ status: number; body: { ok: boolean; data?: { verifyToken?: string; expiresAt?: string }; error?: { code: string } } }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;
  const res = await fetch(`${ctx.baseUrl}/api/auth/verify-password`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.password !== undefined ? { password: options.password } : {}),
  });
  return { status: res.status, body: (await res.json()) as never };
}

test("GAP #35: korrekt passord → 200 med verifyToken + expiresAt", async () => {
  const ctx = await startServer({
    users: { "tok-1": makeUser("PLAYER", "u-1") },
    passwordCheck: (uid, pwd) => uid === "u-1" && pwd === "rett-passord-123",
  });
  try {
    const res = await postVerifyPassword(ctx, {
      authToken: "tok-1",
      password: "rett-passord-123",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data?.verifyToken);
    assert.ok(res.body.data?.expiresAt);
    // Tokenet er gyldig mot service.
    const validated = ctx.verifyTokenService!.validate(res.body.data!.verifyToken!);
    assert.equal(validated.userId, "u-1");
  } finally {
    await ctx.close();
  }
});

test("GAP #35: feil passord → 401 INVALID_CREDENTIALS", async () => {
  const ctx = await startServer({
    users: { "tok-1": makeUser("PLAYER", "u-1") },
    passwordCheck: () => false,
  });
  try {
    const res = await postVerifyPassword(ctx, {
      authToken: "tok-1",
      password: "feil-passord",
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "INVALID_CREDENTIALS");
  } finally {
    await ctx.close();
  }
});

test("GAP #35: tomt password-felt → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "tok-1": makeUser("PLAYER", "u-1") },
  });
  try {
    const res = await postVerifyPassword(ctx, {
      authToken: "tok-1",
      password: "",
    });
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP #35: manglende access-token → UNAUTHORIZED", async () => {
  const ctx = await startServer({ users: {} });
  try {
    const res = await postVerifyPassword(ctx, { password: "noe" });
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("GAP #35: VerifyTokenService ikke wired → 501 VERIFY_TOKEN_NOT_CONFIGURED", async () => {
  const ctx = await startServer({
    users: { "tok-1": makeUser("PLAYER", "u-1") },
    passwordCheck: () => true,
    withVerifyService: false,
  });
  try {
    const res = await postVerifyPassword(ctx, {
      authToken: "tok-1",
      password: "anything",
    });
    assert.equal(res.status, 501);
    assert.equal(res.body.error?.code, "VERIFY_TOKEN_NOT_CONFIGURED");
  } finally {
    await ctx.close();
  }
});
