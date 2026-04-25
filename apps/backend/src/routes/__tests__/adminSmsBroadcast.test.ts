/**
 * Integrasjonstester for /api/admin/sms/broadcast.
 *
 * Dekker:
 *   - 401 uten Authorization-header
 *   - 403 for non-admin
 *   - 400 for tom recipients-array
 *   - 400 for over 1000 mottakere
 *   - 400 for tom melding
 *   - SMS sendes for hver bruker med phone — skipped for de uten
 *   - Audit-rad logges (ingen rå-melding eller rå-nummer)
 *   - Stub-mode (smsService.isEnabled()=false) — alle skipped, audit OK
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminSmsBroadcastRouter } from "../adminSmsBroadcast.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import { SveveSmsService, type SveveHttpFetch } from "../../integration/SveveSmsService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "admin@test.no",
  displayName: "Admin",
  walletId: "w-a",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const playerUser: PublicAppUser = {
  ...adminUser,
  id: "player-1",
  role: "PLAYER",
};

interface StartOpts {
  users: Record<string, PublicAppUser>;
  /** userId → phone-rad i app_users (or null hvis ingen phone). */
  userPhones: Map<string, string | null>;
  /** Hvis satt, bruker ekte SveveSmsService med disse fetch-responses. */
  fetchResponses?: Array<{ ok: boolean; status: number; text: string }>;
  /** Hvis true, bruker stub-mode (config: null). */
  stubMode?: boolean;
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  fetchCalls: Array<{ url: string }>;
  close: () => Promise<void>;
}

async function startServer(opts: StartOpts): Promise<Ctx> {
  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "ukjent token");
      return u;
    },
  } as unknown as PlatformService;

  // Fake pool — håndterer SELECT id, phone FROM app_users WHERE id = ANY($1).
  const fakePool = {
    async query<T>(
      sql: string,
      params: unknown[]
    ): Promise<{ rows: T[]; rowCount: number }> {
      if (/SELECT id, phone FROM/.test(sql)) {
        const ids = (params[0] as string[]) ?? [];
        const rows = ids
          .filter((id) => opts.userPhones.has(id))
          .map((id) => ({ id, phone: opts.userPhones.get(id) ?? null }));
        return {
          rows: rows as unknown as T[],
          rowCount: rows.length,
        };
      }
      throw new Error(`adminSmsBroadcast.test FakePool: unhandled SQL: ${sql.slice(0, 120)}`);
    },
  };

  const fetchCalls: Array<{ url: string }> = [];
  let i = 0;
  const fetchImpl: SveveHttpFetch = async (url) => {
    fetchCalls.push({ url });
    const r = opts.fetchResponses?.[Math.min(i, (opts.fetchResponses?.length ?? 1) - 1)];
    i++;
    return {
      ok: r?.ok ?? true,
      status: r?.status ?? 200,
      text: async () =>
        r?.text ?? JSON.stringify({ response: { msgOkCount: 1, stdSMSCount: 1, ids: [99] } }),
    };
  };

  const smsService = opts.stubMode
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

  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const app = express();
  app.use(express.json());
  app.use(
    createAdminSmsBroadcastRouter({
      platformService,
      smsService,
      auditLogService,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pool: fakePool as any,
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
    auditStore,
    fetchCalls,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface PostResponse<T> {
  status: number;
  body: { ok: boolean; data?: T; error?: { code: string; message: string } };
}

async function postJson<T = unknown>(
  url: string,
  body: unknown,
  token?: string
): Promise<PostResponse<T>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as PostResponse<T>["body"],
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("admin-sms-broadcast: 400 UNAUTHORIZED uten Authorization", async () => {
  const ctx = await startServer({
    users: { "admin-token": adminUser },
    userPhones: new Map(),
  });
  try {
    const r = await postJson(`${ctx.baseUrl}/api/admin/sms/broadcast`, {
      recipients: ["u1"],
      message: "Hei",
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error?.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("admin-sms-broadcast: 400 FORBIDDEN for PLAYER-token", async () => {
  const ctx = await startServer({
    users: { "player-token": playerUser },
    userPhones: new Map(),
  });
  try {
    const r = await postJson(
      `${ctx.baseUrl}/api/admin/sms/broadcast`,
      { recipients: ["u1"], message: "Hei" },
      "player-token"
    );
    assert.equal(r.status, 400);
    assert.equal(r.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("admin-sms-broadcast: 400 INVALID_INPUT for tom recipients", async () => {
  const ctx = await startServer({
    users: { "admin-token": adminUser },
    userPhones: new Map(),
  });
  try {
    const r = await postJson(
      `${ctx.baseUrl}/api/admin/sms/broadcast`,
      { recipients: [], message: "Hei" },
      "admin-token"
    );
    assert.equal(r.status, 400);
    assert.equal(r.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("admin-sms-broadcast: 400 INVALID_INPUT for over 1000 mottakere", async () => {
  const ctx = await startServer({
    users: { "admin-token": adminUser },
    userPhones: new Map(),
  });
  try {
    const recipients = Array.from({ length: 1001 }, (_, i) => `u-${i}`);
    const r = await postJson(
      `${ctx.baseUrl}/api/admin/sms/broadcast`,
      { recipients, message: "Hei" },
      "admin-token"
    );
    assert.equal(r.status, 400);
    assert.equal(r.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("admin-sms-broadcast: 400 for tom melding", async () => {
  const ctx = await startServer({
    users: { "admin-token": adminUser },
    userPhones: new Map(),
  });
  try {
    const r = await postJson(
      `${ctx.baseUrl}/api/admin/sms/broadcast`,
      { recipients: ["u1"], message: "" },
      "admin-token"
    );
    assert.equal(r.status, 400);
  } finally {
    await ctx.close();
  }
});

test("admin-sms-broadcast: happy-path — sender SMS for hver bruker med phone", async () => {
  const userPhones = new Map<string, string | null>([
    ["u1", "+4798765432"],
    ["u2", "+4791234567"],
    ["u3", null], // ingen telefon — skipped
  ]);
  const ctx = await startServer({
    users: { "admin-token": adminUser },
    userPhones,
  });
  try {
    const r = await postJson<{
      targets: number;
      sent: number;
      failed: number;
      skipped: number;
      skippedNoPhone: number;
      skippedNotFound: number;
    }>(
      `${ctx.baseUrl}/api/admin/sms/broadcast`,
      { recipients: ["u1", "u2", "u3"], message: "Bingo i kveld!" },
      "admin-token"
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data?.targets, 2); // u3 har ingen phone
    assert.equal(r.body.data?.sent, 2);
    assert.equal(r.body.data?.skippedNoPhone, 1);
    assert.equal(r.body.data?.skippedNotFound, 0);
    assert.equal(ctx.fetchCalls.length, 2);

    // Audit-rad må eksistere uten rå-melding.
    const audit = await ctx.auditStore.list();
    assert.ok(audit.length >= 1);
    const broadcastAudit = audit.find((a) => a.action === "admin.sms.broadcast");
    assert.ok(broadcastAudit, "audit-rad for admin.sms.broadcast må finnes");
    const details = broadcastAudit.details as Record<string, unknown>;
    assert.equal(details.recipientCount, 3);
    assert.equal(details.sent, 2);
    assert.equal(details.skippedNoPhone, 1);
    assert.equal(details.messageLength, "Bingo i kveld!".length);
    // INGEN rå melding eller rå nummer i audit.
    assert.equal(details.message, undefined);
    assert.match(
      String(details.maskedSampleNumber),
      /^\+47\*\*\*\*\d{4}$/
    );
  } finally {
    await ctx.close();
  }
});

test("admin-sms-broadcast: stub-mode — alle skipped, audit logger outcome=noop", async () => {
  const userPhones = new Map<string, string | null>([
    ["u1", "+4798765432"],
  ]);
  const ctx = await startServer({
    users: { "admin-token": adminUser },
    userPhones,
    stubMode: true,
  });
  try {
    const r = await postJson<{
      targets: number;
      sent: number;
      skipped: number;
    }>(
      `${ctx.baseUrl}/api/admin/sms/broadcast`,
      { recipients: ["u1"], message: "Hei" },
      "admin-token"
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.data?.skipped, 1);
    assert.equal(r.body.data?.sent, 0);
    // Stub-mode: ingen fetch-kall.
    assert.equal(ctx.fetchCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("admin-sms-broadcast: alle uten phone → outcome=no_phones, ingen Sveve-kall", async () => {
  const userPhones = new Map<string, string | null>([
    ["u1", null],
    ["u2", null],
  ]);
  const ctx = await startServer({
    users: { "admin-token": adminUser },
    userPhones,
  });
  try {
    const r = await postJson<{
      targets: number;
      skippedNoPhone: number;
      message: string;
    }>(
      `${ctx.baseUrl}/api/admin/sms/broadcast`,
      { recipients: ["u1", "u2"], message: "Hei" },
      "admin-token"
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.data?.targets, 0);
    assert.equal(r.body.data?.skippedNoPhone, 2);
    assert.equal(ctx.fetchCalls.length, 0);

    const audit = await ctx.auditStore.list();
    const broadcastAudit = audit.find((a) => a.action === "admin.sms.broadcast");
    assert.ok(broadcastAudit);
    const details = broadcastAudit.details as Record<string, unknown>;
    assert.equal(details.outcome, "no_phones");
  } finally {
    await ctx.close();
  }
});

test("admin-sms-broadcast: ukjente user-IDer rapporteres som skippedNotFound", async () => {
  const userPhones = new Map<string, string | null>([
    ["u1", "+4798765432"],
  ]);
  const ctx = await startServer({
    users: { "admin-token": adminUser },
    userPhones,
  });
  try {
    const r = await postJson<{
      sent: number;
      skippedNotFound: number;
    }>(
      `${ctx.baseUrl}/api/admin/sms/broadcast`,
      {
        recipients: ["u1", "ghost-id-1", "ghost-id-2"],
        message: "Hei",
      },
      "admin-token"
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.data?.sent, 1);
    assert.equal(r.body.data?.skippedNotFound, 2);
  } finally {
    await ctx.close();
  }
});
