/**
 * BIN-587 B2.1: integrasjonstester for password-reset + email-verify flows.
 *
 * Full express round-trip med stub av PlatformService, AuthTokenService
 * (in-memory via forTesting) og EmailService (transport-stub).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { createAuthRouter } from "../auth.js";
import { AuthTokenService } from "../../auth/AuthTokenService.js";
import { EmailService } from "../../integration/EmailService.js";
import type {
  PlatformService,
  PublicAppUser,
  AppUser,
} from "../../platform/PlatformService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Minimal Pool-stub for AuthTokenService (samme mønster som
//    AuthTokenService.test.ts) ─────────────────────────────────────────────

interface Row {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}
type Kind = "password-reset" | "email-verify";
interface Store {
  "password-reset": Map<string, Row>;
  "email-verify": Map<string, Row>;
}

function detectKind(sql: string): Kind {
  if (sql.includes("app_password_reset_tokens")) return "password-reset";
  if (sql.includes("app_email_verify_tokens")) return "email-verify";
  throw new Error(`cannot detect kind from SQL`);
}

function runQuery(store: Store, sql: string, params: unknown[] = []): { rows: Row[]; rowCount: number } {
  const t = sql.trim();
  if (t.startsWith("INSERT")) {
    const kind = detectKind(sql);
    const [id, userId, tokenHash, expiresAt] = params as [string, string, string, string];
    store[kind].set(id, {
      id, user_id: userId, token_hash: tokenHash,
      expires_at: new Date(expiresAt), used_at: null, created_at: new Date(),
    });
    return { rows: [], rowCount: 1 };
  }
  if (t.startsWith("SELECT")) {
    const kind = detectKind(sql);
    const [tokenHash] = params as [string];
    const hit = [...store[kind].values()].find((r) => r.token_hash === tokenHash);
    return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
  }
  if (t.startsWith("UPDATE")) {
    const kind = detectKind(sql);
    if (sql.includes("WHERE user_id = $1")) {
      const [userId] = params as [string];
      let n = 0;
      for (const r of store[kind].values()) {
        if (r.user_id === userId && r.used_at === null) { r.used_at = new Date(); n++; }
      }
      return { rows: [], rowCount: n };
    }
    if (sql.includes("WHERE id = $1")) {
      const [id] = params as [string];
      const r = store[kind].get(id);
      if (r && r.used_at === null) { r.used_at = new Date(); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }
  }
  if (t.startsWith("BEGIN") || t.startsWith("COMMIT") || t.startsWith("ROLLBACK")) {
    return { rows: [], rowCount: 0 };
  }
  throw new Error(`unhandled SQL: ${t.slice(0, 120)}`);
}

function makePool(store: Store): Pool {
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
        release() {},
      };
    },
    async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
  };
  return pool as unknown as Pool;
}

// ── Platform + email stubs ───────────────────────────────────────────────

function makeUser(id: string, email: string): AppUser & { balance: number } {
  return {
    id, email, displayName: "Test " + id, walletId: `wallet-${id}`,
    role: "PLAYER", hallId: null, kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  };
}

interface TestContext {
  baseUrl: string;
  store: Store;
  spies: {
    sentEmails: Array<{ to: string; template: string; context: Record<string, unknown> }>;
    passwordsSet: Array<{ userId: string; newPassword: string }>;
    emailsVerified: string[];
  };
  close: () => Promise<void>;
}

async function startServer(users: Record<string, AppUser & { balance: number }>): Promise<TestContext> {
  const store: Store = { "password-reset": new Map(), "email-verify": new Map() };
  const authTokenService = AuthTokenService.forTesting(makePool(store));
  const sentEmails: TestContext["spies"]["sentEmails"] = [];
  const passwordsSet: TestContext["spies"]["passwordsSet"] = [];
  const emailsVerified: string[] = [];

  const emailService = new EmailService({
    transporter: {
      async sendMail(m) {
        return { messageId: `stub-${Date.now()}` };
      },
    },
  });
  // Kapre sendTemplate-kall via en wrapper som logger context.
  const origSendTemplate = emailService.sendTemplate.bind(emailService);
  emailService.sendTemplate = async (input) => {
    sentEmails.push({
      to: input.to,
      template: input.template,
      context: input.context as Record<string, unknown>,
    });
    return origSendTemplate(input);
  };

  const platformService = {
    async findUserByEmail(email: string): Promise<AppUser | null> {
      return users[email.toLowerCase().trim()] ?? null;
    },
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = Object.values(users).find((x) => x.id === token);
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u as PublicAppUser;
    },
    async setPassword(userId: string, newPassword: string) {
      passwordsSet.push({ userId, newPassword });
    },
    async markEmailVerified(userId: string) {
      emailsVerified.push(userId);
    },
    // Stubs for resten av routeren (ikke testet her, men må finnes).
    async register() { throw new Error("n/a"); },
    async login() { throw new Error("n/a"); },
    async logout() {},
    async refreshSession() { throw new Error("n/a"); },
    async updateProfile() { throw new Error("n/a"); },
    async changePassword() {},
    async deleteAccount() {},
    async submitKycVerification() {},
  } as unknown as PlatformService;

  const walletAdapter = {
    async listTransactions() { return []; },
  } as unknown as WalletAdapter;

  const app = express();
  app.use(express.json());
  app.use(
    createAuthRouter({
      platformService,
      walletAdapter,
      bankIdAdapter: null,
      authTokenService,
      emailService,
      webBaseUrl: "https://test.example/",
      supportEmail: "support@test.example",
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    store,
    spies: { sentEmails, passwordsSet, emailsVerified },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function post(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function get(url: string): Promise<{ status: number; json: any }> {
  const res = await fetch(url);
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Forgot-password tests ────────────────────────────────────────────────

test("BIN-587 B2.1: forgot-password happy path sender reset-lenke", async () => {
  const users = { "alice@test.no": makeUser("user-alice", "alice@test.no") };
  const ctx = await startServer(users);
  try {
    const res = await post(`${ctx.baseUrl}/api/auth/forgot-password`, { email: "alice@test.no" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { sent: true });
    assert.equal(ctx.spies.sentEmails.length, 1);
    assert.equal(ctx.spies.sentEmails[0]!.template, "reset-password");
    assert.equal(ctx.spies.sentEmails[0]!.to, "alice@test.no");
    const context = ctx.spies.sentEmails[0]!.context;
    assert.ok(typeof context.resetLink === "string");
    assert.ok((context.resetLink as string).startsWith("https://test.example/reset-password/"));
    assert.equal(context.supportEmail, "support@test.example");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: forgot-password er enumeration-safe for ukjent e-post", async () => {
  const users = {};
  const ctx = await startServer(users);
  try {
    const res = await post(`${ctx.baseUrl}/api/auth/forgot-password`, { email: "ghost@test.no" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { sent: true });
    assert.equal(ctx.spies.sentEmails.length, 0); // ingen e-post sendt
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: forgot-password krever email-felt", async () => {
  const ctx = await startServer({});
  try {
    const res = await post(`${ctx.baseUrl}/api/auth/forgot-password`, {});
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── Reset-password tests ─────────────────────────────────────────────────

test("BIN-587 B2.1: reset-password full flyt: forgot → validate → sett nytt passord", async () => {
  const users = { "alice@test.no": makeUser("user-alice", "alice@test.no") };
  const ctx = await startServer(users);
  try {
    await post(`${ctx.baseUrl}/api/auth/forgot-password`, { email: "alice@test.no" });
    const resetLink = ctx.spies.sentEmails[0]!.context.resetLink as string;
    // Token er base64url-enkodet i URL; strip prefix.
    const token = decodeURIComponent(resetLink.split("/").pop()!);

    // Validate-step
    const validateRes = await get(`${ctx.baseUrl}/api/auth/reset-password/${encodeURIComponent(token)}`);
    assert.equal(validateRes.status, 200);
    assert.equal(validateRes.json.data.valid, true);
    assert.equal(validateRes.json.data.userId, "user-alice");

    // Sett nytt passord
    const resetRes = await post(
      `${ctx.baseUrl}/api/auth/reset-password/${encodeURIComponent(token)}`,
      { newPassword: "NyttLangtPassord2026!" }
    );
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.json.data.reset, true);
    assert.equal(ctx.spies.passwordsSet.length, 1);
    assert.equal(ctx.spies.passwordsSet[0]!.userId, "user-alice");

    // Tokenet er nå brukt — andre forsøk skal feile
    const reuseRes = await post(
      `${ctx.baseUrl}/api/auth/reset-password/${encodeURIComponent(token)}`,
      { newPassword: "AnnetPassord2026!" }
    );
    assert.equal(reuseRes.status, 400);
    assert.equal(reuseRes.json.error.code, "TOKEN_ALREADY_USED");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: reset-password avviser ukjent token", async () => {
  const ctx = await startServer({});
  try {
    const res = await post(`${ctx.baseUrl}/api/auth/reset-password/bogus-token-xyz`, {
      newPassword: "passord1234!",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_TOKEN");
  } finally {
    await ctx.close();
  }
});

// ── Verify-email tests ───────────────────────────────────────────────────

test("BIN-587 B2.1: verify-email consumer token + kaller markEmailVerified", async () => {
  const users = { "alice@test.no": makeUser("user-alice", "alice@test.no") };
  const ctx = await startServer(users);
  try {
    // Opprett et email-verify-token direkte (det er ingen forgot-equivalent
    // for verify-email — den utstedes typisk under registrering).
    const authTokenService = AuthTokenService.forTesting(makePool(ctx.store));
    const { token } = await authTokenService.createToken("email-verify", "user-alice");

    const res = await post(
      `${ctx.baseUrl}/api/auth/verify-email/${encodeURIComponent(token)}`,
      {}
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.verified, true);
    assert.deepEqual(ctx.spies.emailsVerified, ["user-alice"]);

    // Andre forsøk avvises
    const reuseRes = await post(
      `${ctx.baseUrl}/api/auth/verify-email/${encodeURIComponent(token)}`,
      {}
    );
    assert.equal(reuseRes.status, 400);
    assert.equal(reuseRes.json.error.code, "TOKEN_ALREADY_USED");
  } finally {
    await ctx.close();
  }
});
