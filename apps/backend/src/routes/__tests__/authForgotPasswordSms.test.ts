/**
 * Integrasjonstester for /api/auth/forgot-password phone-flow (SMS-OTP).
 *
 * Dekker:
 *   - { phone: "+47..." } sender SMS for matchende user (med phone)
 *   - { phone: "+47..." } for ukjent nummer → enumeration-safe success
 *   - { phone, email } sender SMS (phone har prioritet)
 *   - { email } fortsetter å bruke email-flow (regression)
 *   - { } uten begge → INVALID_INPUT
 *   - SMS-stub-mode (smsService.isEnabled()=false) → ingen feil, log only
 *   - Telefonnummer maskes i alle log-linjer (manuelt verifisert via wrapper)
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { createAuthRouter } from "../auth.js";
import { AuthTokenService } from "../../auth/AuthTokenService.js";
import { EmailService } from "../../integration/EmailService.js";
import {
  SveveSmsService,
  type SveveHttpFetch,
} from "../../integration/SveveSmsService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Pool stub (samme pattern som authFlows.test.ts) ─────────────────────────

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

interface UserRow {
  id: string;
  phone: string | null;
  display_name: string;
  deleted_at: Date | null;
}

function makePool(
  tokenStore: Map<string, TokenRow>,
  users: UserRow[]
): Pool {
  function runQuery(
    sql: string,
    params: unknown[] = []
  ): { rows: unknown[]; rowCount: number } {
    const t = sql.trim();
    if (t.includes("app_password_reset_tokens") && t.startsWith("INSERT")) {
      const [id, userId, tokenHash, expiresAt] = params as [
        string,
        string,
        string,
        string
      ];
      tokenStore.set(id, {
        id,
        user_id: userId,
        token_hash: tokenHash,
        expires_at: new Date(expiresAt),
        used_at: null,
        created_at: new Date(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (t.startsWith("SELECT id, phone, display_name FROM")) {
      const [phone] = params as [string];
      const rows = users.filter(
        (u) => u.phone === phone && u.deleted_at === null
      );
      return { rows, rowCount: rows.length };
    }
    if (t.startsWith("BEGIN") || t.startsWith("COMMIT") || t.startsWith("ROLLBACK")) {
      return { rows: [], rowCount: 0 };
    }
    // AuthTokenService kan utløse DELETE/UPDATE — håndter no-op for tester.
    if (t.startsWith("DELETE") || t.startsWith("UPDATE")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`authForgotPasswordSms.test unhandled SQL: ${t.slice(0, 120)}`);
  }

  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          return runQuery(sql, params ?? []);
        },
        release() {},
      };
    },
    async query(sql: string, params?: unknown[]) {
      return runQuery(sql, params ?? []);
    },
  };
  return pool as unknown as Pool;
}

// ── Server fixture ───────────────────────────────────────────────────────────

interface Fixture {
  baseUrl: string;
  smsCalls: Array<{ url: string; body: URLSearchParams }>;
  emailsSent: Array<{ to: string; template: string }>;
  close: () => Promise<void>;
}

interface Opts {
  /** users som finnes (matchet av email + phone). */
  users: Array<{
    id: string;
    email: string;
    phone: string | null;
    displayName: string;
  }>;
  /** Hvis true: ingen SMS-config (stub-mode). */
  smsStubMode?: boolean;
}

async function startServer(opts: Opts): Promise<Fixture> {
  const tokenStore = new Map<string, TokenRow>();
  const userRows: UserRow[] = opts.users.map((u) => ({
    id: u.id,
    phone: u.phone,
    display_name: u.displayName,
    deleted_at: null,
  }));
  const pool = makePool(tokenStore, userRows);

  const authTokenService = AuthTokenService.forTesting(pool);

  const emailsSent: Array<{ to: string; template: string }> = [];
  const emailService = new EmailService({
    transporter: {
      async sendMail() {
        return { messageId: `stub-${Date.now()}` };
      },
    },
  });
  const origSendTemplate = emailService.sendTemplate.bind(emailService);
  emailService.sendTemplate = async (input) => {
    emailsSent.push({ to: input.to, template: input.template });
    return origSendTemplate(input);
  };

  const smsCalls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchImpl: SveveHttpFetch = async (url, init) => {
    smsCalls.push({ url, body: init.body });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          response: { msgOkCount: 1, stdSMSCount: 1, ids: [101] },
        }),
    };
  };

  const smsService = opts.smsStubMode
    ? new SveveSmsService({ config: null, fetchImpl })
    : new SveveSmsService({
        config: {
          user: "u",
          password: "p",
          defaultSender: "Spillorama",
          apiUrl: "https://sveve.no/SMS/SendMessage",
        },
        fetchImpl,
        sleep: async () => undefined,
      });

  const platformService = {
    async findUserByEmail(email: string) {
      return (
        opts.users.find(
          (u) => u.email.toLowerCase() === email.toLowerCase().trim()
        ) ?? null
      );
    },
    async getUserFromAccessToken() {
      throw new DomainError("UNAUTHORIZED", "n/a");
    },
    async setPassword() {},
    async markEmailVerified() {},
    async register() {
      throw new Error("n/a");
    },
    async login() {
      throw new Error("n/a");
    },
    async logout() {},
    async refreshSession() {
      throw new Error("n/a");
    },
    async updateProfile() {
      throw new Error("n/a");
    },
    async changePassword() {},
    async deleteAccount() {},
    async submitKycVerification() {},
  } as unknown as PlatformService;

  const walletAdapter = {
    async listTransactions() {
      return [];
    },
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
      smsService,
      pool,
      schema: "public",
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    smsCalls,
    emailsSent,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function postJson(
  url: string,
  body: unknown
): Promise<{ status: number; json: { ok: boolean; data?: unknown; error?: { code: string } } }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; data?: unknown; error?: { code: string } };
  return { status: res.status, json };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("forgot-password phone-flow: SMS sendes for matchende user", async () => {
  const f = await startServer({
    users: [
      {
        id: "u1",
        email: "alice@test.no",
        phone: "+4798765432",
        displayName: "Alice",
      },
    ],
  });
  try {
    const r = await postJson(`${f.baseUrl}/api/auth/forgot-password`, {
      phone: "+4798765432",
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal((r.json.data as { sent: boolean }).sent, true);

    // En SMS-kall skal være gjort.
    assert.equal(f.smsCalls.length, 1);
    const body = f.smsCalls[0]!.body;
    assert.equal(body.get("to"), "+4798765432");
    // Meldingen inneholder reset-link.
    assert.match(body.get("msg") ?? "", /reset-password/);
    // Ingen email skal være sendt.
    assert.equal(f.emailsSent.length, 0);
  } finally {
    await f.close();
  }
});

test("forgot-password phone-flow: ukjent nummer → success men ingen SMS (enumeration-safe)", async () => {
  const f = await startServer({
    users: [
      {
        id: "u1",
        email: "alice@test.no",
        phone: "+4798765432",
        displayName: "Alice",
      },
    ],
  });
  try {
    const r = await postJson(`${f.baseUrl}/api/auth/forgot-password`, {
      phone: "+4711111111", // finnes ikke
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    // Ingen SMS skal være sendt.
    assert.equal(f.smsCalls.length, 0);
    assert.equal(f.emailsSent.length, 0);
  } finally {
    await f.close();
  }
});

test("forgot-password phone-flow: phone har prioritet over email hvis begge er satt", async () => {
  const f = await startServer({
    users: [
      {
        id: "u1",
        email: "alice@test.no",
        phone: "+4798765432",
        displayName: "Alice",
      },
    ],
  });
  try {
    const r = await postJson(`${f.baseUrl}/api/auth/forgot-password`, {
      phone: "+4798765432",
      email: "alice@test.no",
    });
    assert.equal(r.status, 200);
    // Bare SMS, ingen email.
    assert.equal(f.smsCalls.length, 1);
    assert.equal(f.emailsSent.length, 0);
  } finally {
    await f.close();
  }
});

test("forgot-password email-flow (regression): bare email → email sendes, ingen SMS", async () => {
  const f = await startServer({
    users: [
      {
        id: "u1",
        email: "alice@test.no",
        phone: "+4798765432",
        displayName: "Alice",
      },
    ],
  });
  try {
    const r = await postJson(`${f.baseUrl}/api/auth/forgot-password`, {
      email: "alice@test.no",
    });
    assert.equal(r.status, 200);
    assert.equal(f.emailsSent.length, 1);
    assert.equal(f.emailsSent[0]?.template, "reset-password");
    assert.equal(f.smsCalls.length, 0);
  } finally {
    await f.close();
  }
});

test("forgot-password: tom body (verken email eller phone) → 400 INVALID_INPUT", async () => {
  const f = await startServer({ users: [] });
  try {
    const r = await postJson(`${f.baseUrl}/api/auth/forgot-password`, {});
    assert.equal(r.status, 400);
    assert.equal(r.json.error?.code, "INVALID_INPUT");
  } finally {
    await f.close();
  }
});

test("forgot-password phone-flow: stub-mode SMS — success uten faktisk fetch-kall", async () => {
  const f = await startServer({
    users: [
      {
        id: "u1",
        email: "alice@test.no",
        phone: "+4798765432",
        displayName: "Alice",
      },
    ],
    smsStubMode: true,
  });
  try {
    const r = await postJson(`${f.baseUrl}/api/auth/forgot-password`, {
      phone: "+4798765432",
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    // Stub-mode: ingen fetch-kall.
    assert.equal(f.smsCalls.length, 0);
  } finally {
    await f.close();
  }
});
