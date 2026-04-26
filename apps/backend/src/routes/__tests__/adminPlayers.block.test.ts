/**
 * REQ-097/098: integrasjonstester for admin block/unblock-flyt.
 *
 * Tester:
 *   1) Happy-path block: POST /api/admin/players/:id/block setter
 *      blocked_until i ProfileSettingsService, audit-event
 *      `admin.player.block`, e-post `account-blocked` enqueued.
 *   2) RBAC: HALL_OPERATOR får FORBIDDEN på block. PLAYER også.
 *   3) Idempotent: dobbelt-block overskriver, ingen 409. Unblock når
 *      ikke blokkert er en no-op (200 OK + audit).
 *   4) Unblock: clearer blocked_until + audit.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPlayersRouter } from "../adminPlayers.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import { EmailService } from "../../integration/EmailService.js";
import type {
  PlatformService,
  PublicAppUser,
  AppUser,
  KycStatus,
} from "../../platform/PlatformService.js";
import type { ProfileSettingsService } from "../../compliance/ProfileSettingsService.js";
import { DomainError } from "../../game/BingoEngine.js";

function makeUser(overrides: Partial<AppUser> & { id: string }): AppUser {
  return {
    id: overrides.id,
    email: overrides.email ?? `${overrides.id}@test.no`,
    displayName: overrides.displayName ?? overrides.id,
    surname: overrides.surname,
    phone: overrides.phone,
    walletId: overrides.walletId ?? `wallet-${overrides.id}`,
    role: overrides.role ?? "PLAYER",
    hallId: overrides.hallId ?? null,
    kycStatus: (overrides.kycStatus as KycStatus | undefined) ?? "VERIFIED",
    birthDate: overrides.birthDate ?? "1990-01-01",
    complianceData: overrides.complianceData,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
  };
}

interface BlockCall {
  userId: string;
  actorId: string;
  durationDays: number | "permanent";
  reason: string;
}
interface UnblockCall {
  userId: string;
  actorId: string;
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  sentEmails: Array<{ to: string; template: string; context: Record<string, unknown> }>;
  blocks: BlockCall[];
  unblocks: UnblockCall[];
  blockedState: Map<string, { blockedUntilIso: string | null; reason: string | null }>;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seedUsers: AppUser[] = [],
  opts?: { withProfileSettings?: boolean }
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const sentEmails: Ctx["sentEmails"] = [];
  const blocks: BlockCall[] = [];
  const unblocks: UnblockCall[] = [];
  const blockedState = new Map<string, { blockedUntilIso: string | null; reason: string | null }>();
  const usersById = new Map<string, AppUser>();
  for (const u of seedUsers) usersById.set(u.id, u);

  const emailService = new EmailService({
    transporter: { async sendMail() { return { messageId: "stub" }; } },
  });
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
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(userId: string): Promise<AppUser> {
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
  } as unknown as PlatformService;

  const profileSettingsService: ProfileSettingsService | undefined = opts?.withProfileSettings === false
    ? undefined
    : ({
        async adminBlock(input: {
          userId: string;
          actor: { actorId: string; type: string };
          durationDays: number | "permanent";
          reason: string;
        }) {
          // Replikér valideringer for å fange dem i route-laget også.
          if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
            throw new DomainError("INVALID_INPUT", "reason er påkrevd.");
          }
          if (input.durationDays !== "permanent") {
            if (!Number.isFinite(input.durationDays) || input.durationDays <= 0) {
              throw new DomainError(
                "INVALID_INPUT",
                'durationDays må være et positivt heltall eller "permanent".'
              );
            }
          }
          blocks.push({
            userId: input.userId,
            actorId: input.actor.actorId,
            durationDays: input.durationDays,
            reason: input.reason,
          });
          let untilIso: string;
          if (input.durationDays === "permanent") {
            untilIso = "9999-12-31T23:59:59.000Z";
          } else {
            const days = Math.floor(input.durationDays as number);
            untilIso = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
          }
          blockedState.set(input.userId, { blockedUntilIso: untilIso, reason: input.reason });
          // Skriv audit slik at vi kan verifisere mot den.
          await auditLogService.record({
            actorId: input.actor.actorId,
            actorType: input.actor.type as "ADMIN",
            action: "admin.player.block",
            resource: "user",
            resourceId: input.userId,
            details: {
              targetUserId: input.userId,
              durationDays: input.durationDays,
              reason: input.reason,
              blockedUntil: untilIso,
            },
            ipAddress: null,
            userAgent: null,
          });
          return {
            userId: input.userId,
            walletId: `wallet-${input.userId}`,
            language: "nb-NO" as const,
            hallId: null,
            lossLimits: {
              daily: 900,
              monthly: 4400,
              regulatory: { daily: 900, monthly: 4400 },
            },
            pendingLossLimits: {},
            block: {
              blockedUntil: untilIso,
              reason: input.reason,
              selfExcludedUntil: null,
            },
            pause: { pausedUntil: null },
          };
        },
        async adminUnblock(input: {
          userId: string;
          actor: { actorId: string; type: string };
        }) {
          unblocks.push({ userId: input.userId, actorId: input.actor.actorId });
          const prev = blockedState.get(input.userId) ?? null;
          blockedState.delete(input.userId);
          await auditLogService.record({
            actorId: input.actor.actorId,
            actorType: input.actor.type as "ADMIN",
            action: "admin.player.unblock",
            resource: "user",
            resourceId: input.userId,
            details: {
              targetUserId: input.userId,
              previousBlockedUntil: prev?.blockedUntilIso ?? null,
              previousReason: prev?.reason ?? null,
            },
            ipAddress: null,
            userAgent: null,
          });
          return {
            userId: input.userId,
            walletId: `wallet-${input.userId}`,
            language: "nb-NO" as const,
            hallId: null,
            lossLimits: {
              daily: 900,
              monthly: 4400,
              regulatory: { daily: 900, monthly: 4400 },
            },
            pendingLossLimits: {},
            block: { blockedUntil: null, reason: null, selfExcludedUntil: null },
            pause: { pausedUntil: null },
          };
        },
      } as unknown as ProfileSettingsService);

  const app = express();
  app.use(express.json());
  app.use(
    createAdminPlayersRouter({
      platformService,
      auditLogService,
      emailService,
      bankIdAdapter: null,
      webBaseUrl: "https://test.example",
      supportEmail: "support@test.example",
      profileSettingsService,
    })
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auditStore,
    sentEmails,
    blocks,
    unblocks,
    blockedState,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
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
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

// ── Tests ─────────────────────────────────────────────────────────────────

test("REQ-097: POST block — happy-path, default permanent, audit + e-post", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", email: "alice@test.no" })]
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/block", "admin-tok", {
      reason: "Mistanke om hvitvasking",
    });
    assert.equal(res.status, 200, `body: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.data.userId, "p-1");
    assert.equal(res.json.data.durationDays, "permanent");
    assert.equal(res.json.data.reason, "Mistanke om hvitvasking");
    assert.ok(res.json.data.blockedUntil, "blockedUntil skal være satt");

    // Service ble kalt med riktige args
    assert.equal(ctx.blocks.length, 1);
    assert.equal(ctx.blocks[0]!.userId, "p-1");
    assert.equal(ctx.blocks[0]!.actorId, "admin-1");
    assert.equal(ctx.blocks[0]!.durationDays, "permanent");
    assert.equal(ctx.blocks[0]!.reason, "Mistanke om hvitvasking");

    // Audit-event finnes
    const event = await waitForAudit(ctx.auditStore, "admin.player.block");
    assert.ok(event, "forventet audit-event admin.player.block");
    assert.equal(event!.actorId, "admin-1");
    assert.equal(event!.actorType, "ADMIN");
    assert.equal(event!.resource, "user");
    assert.equal(event!.resourceId, "p-1");
    assert.equal(event!.details.reason, "Mistanke om hvitvasking");
    assert.equal(event!.details.durationDays, "permanent");

    // Norsk e-post sendt fire-and-forget
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(ctx.sentEmails.length, 1);
    assert.equal(ctx.sentEmails[0]!.template, "account-blocked");
    assert.equal(ctx.sentEmails[0]!.to, "alice@test.no");
    assert.equal(
      ctx.sentEmails[0]!.context.reason,
      "Mistanke om hvitvasking"
    );
    assert.equal(
      ctx.sentEmails[0]!.context.blockedUntilHuman,
      "permanent inntil opphevet av support"
    );
  } finally {
    await ctx.close();
  }
});

test("REQ-097: POST block med durationDays=30 setter tidsbegrenset blokk + dato i e-post", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", email: "bob@test.no" })]
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/block", "admin-tok", {
      reason: "Brudd på vilkår",
      durationDays: 30,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.durationDays, 30);
    assert.ok(res.json.data.blockedUntil);
    // blockedUntil må ligge ca 30 dager fram
    const untilMs = new Date(res.json.data.blockedUntil).getTime();
    const expectedMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(untilMs - expectedMs) < 60_000, "30 dager fram (innen 1 min slack)");

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(ctx.sentEmails.length, 1);
    // E-post skal NOT inneholde "permanent"-strengen
    assert.notEqual(
      ctx.sentEmails[0]!.context.blockedUntilHuman,
      "permanent inntil opphevet av support"
    );
    // Norsk format: DD.MM.YYYY kl. HH:mm
    const human = ctx.sentEmails[0]!.context.blockedUntilHuman as string;
    assert.match(human, /^\d{2}\.\d{2}\.\d{4} kl\. \d{2}:\d{2}$/);
  } finally {
    await ctx.close();
  }
});

test("REQ-097/098: RBAC — HALL_OPERATOR og PLAYER får FORBIDDEN på block/unblock; SUPPORT slipper inn", async () => {
  const ctx = await startServer(
    {
      "admin-tok": adminUser,
      "sup-tok": supportUser,
      "op-tok": operatorUser,
      "pl-tok": playerUser,
    },
    [makeUser({ id: "p-1" })]
  );
  try {
    // HALL_OPERATOR — block
    const opBlock = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/block", "op-tok", {
      reason: "irrelevant",
    });
    assert.equal(opBlock.status, 400);
    assert.equal(opBlock.json.error.code, "FORBIDDEN");
    assert.equal(ctx.blocks.length, 0);

    // PLAYER — block
    const playerBlock = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/block", "pl-tok", {
      reason: "irrelevant",
    });
    assert.equal(playerBlock.status, 400);
    assert.equal(playerBlock.json.error.code, "FORBIDDEN");

    // PLAYER — unblock
    const playerUnblock = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/unblock", "pl-tok", {});
    assert.equal(playerUnblock.status, 400);
    assert.equal(playerUnblock.json.error.code, "FORBIDDEN");

    // SUPPORT slipper inn (PLAYER_KYC_MODERATE inkluderer SUPPORT)
    const supBlock = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/block", "sup-tok", {
      reason: "Support-eskalering — rapportert av annen spiller",
      durationDays: 7,
    });
    assert.equal(supBlock.status, 200, `body: ${JSON.stringify(supBlock.json)}`);
    assert.equal(ctx.blocks.length, 1);
    assert.equal(ctx.blocks[0]!.actorId, "sup-1");
  } finally {
    await ctx.close();
  }
});

test("REQ-097/098: Idempotent — dobbelt-block overskriver, unblock fjerner blokk + audit", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", email: "carol@test.no" })]
  );
  try {
    // Første block: 7 dager
    const first = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/block", "admin-tok", {
      reason: "Første grunn — pågående utredning",
      durationDays: 7,
    });
    assert.equal(first.status, 200);
    const firstUntil = first.json.data.blockedUntil;

    // Andre block: 30 dager (skal overskrive)
    const second = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/block", "admin-tok", {
      reason: "Andre grunn — bekreftet brudd",
      durationDays: 30,
    });
    assert.equal(second.status, 200);
    assert.notEqual(second.json.data.blockedUntil, firstUntil);
    assert.equal(ctx.blocks.length, 2);
    assert.equal(ctx.blocks[1]!.reason, "Andre grunn — bekreftet brudd");

    // Unblock — clearer state
    const unblock = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/unblock", "admin-tok", {});
    assert.equal(unblock.status, 200);
    assert.equal(unblock.json.data.blockedUntil, null);
    assert.equal(ctx.unblocks.length, 1);

    // Idempotent unblock — no-op men fortsatt 200 + audit
    const unblock2 = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/unblock", "admin-tok", {});
    assert.equal(unblock2.status, 200);
    assert.equal(ctx.unblocks.length, 2);

    const events = await ctx.auditStore.list();
    const blockEvents = events.filter((e) => e.action === "admin.player.block");
    const unblockEvents = events.filter((e) => e.action === "admin.player.unblock");
    assert.equal(blockEvents.length, 2);
    assert.equal(unblockEvents.length, 2);
  } finally {
    await ctx.close();
  }
});
