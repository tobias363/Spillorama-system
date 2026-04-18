/**
 * BIN-587 B2.2: integrasjonstester for admin-players KYC-moderasjon.
 *
 * Full express round-trip med stub av PlatformService, AuditLogService
 * og EmailService.
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
import type { BankIdKycAdapter } from "../../adapters/BankIdKycAdapter.js";
import { DomainError } from "../../game/BingoEngine.js";

function makeUser(overrides: Partial<AppUser> & { id: string }): AppUser {
  return {
    id: overrides.id,
    email: overrides.email ?? `${overrides.id}@test.no`,
    displayName: overrides.displayName ?? overrides.id,
    walletId: overrides.walletId ?? `wallet-${overrides.id}`,
    role: overrides.role ?? "PLAYER",
    hallId: overrides.hallId ?? null,
    kycStatus: overrides.kycStatus ?? "PENDING",
    birthDate: overrides.birthDate ?? "1990-01-01",
    complianceData: overrides.complianceData,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
  };
}

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    sentEmails: Array<{ to: string; template: string; context: Record<string, unknown> }>;
    approves: Array<{ userId: string; actorId: string }>;
    rejects: Array<{ userId: string; actorId: string; reason: string }>;
    resubmits: Array<{ userId: string; actorId: string }>;
    overrides: Array<{ userId: string; actorId: string; status: KycStatus; reason: string }>;
    softDeletes: string[];
    restores: string[];
    reverifies: Array<{ userId: string; actorId: string }>;
    bulkImports: Array<{ rowCount: number }>;
    hallStatusSets: Array<{ userId: string; hallId: string; isActive: boolean; reason: string | null; actorId: string }>;
    bankIdSessions: Array<{ userId: string }>;
  };
  usersById: Map<string, AppUser>;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seedUsers: AppUser[] = [],
  opts?: { withBankId?: boolean }
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const sentEmails: Ctx["spies"]["sentEmails"] = [];
  const approves: Ctx["spies"]["approves"] = [];
  const rejects: Ctx["spies"]["rejects"] = [];
  const resubmits: Ctx["spies"]["resubmits"] = [];
  const overrides: Ctx["spies"]["overrides"] = [];
  const softDeletes: string[] = [];
  const restores: string[] = [];
  const reverifies: Ctx["spies"]["reverifies"] = [];
  const bulkImports: Ctx["spies"]["bulkImports"] = [];
  const hallStatusSets: Ctx["spies"]["hallStatusSets"] = [];
  const bankIdSessions: Ctx["spies"]["bankIdSessions"] = [];
  const hallStatusByUser = new Map<string, Array<{ hallId: string; isActive: boolean; reason: string | null; updatedBy: string | null; updatedAt: string; createdAt: string }>>();

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
    async listUsersByKycStatus(status: KycStatus): Promise<AppUser[]> {
      return [...usersById.values()].filter((u) => u.kycStatus === status);
    },
    async approveKycAsAdmin({ userId, actorId }: { userId: string; actorId: string }) {
      approves.push({ userId, actorId });
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      const updated: AppUser = { ...u, kycStatus: "VERIFIED" };
      usersById.set(userId, updated);
      return updated;
    },
    async rejectKycAsAdmin({ userId, actorId, reason }: { userId: string; actorId: string; reason: string }) {
      rejects.push({ userId, actorId, reason });
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      const updated: AppUser = {
        ...u,
        kycStatus: "REJECTED",
        complianceData: { ...(u.complianceData ?? {}), kycRejectionReason: reason },
      };
      usersById.set(userId, updated);
      return updated;
    },
    async resubmitKycAsAdmin({ userId, actorId }: { userId: string; actorId: string }) {
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      if (u.kycStatus !== "REJECTED") {
        throw new DomainError("KYC_NOT_REJECTED", "only rejected can resubmit");
      }
      resubmits.push({ userId, actorId });
      const updated: AppUser = { ...u, kycStatus: "UNVERIFIED" };
      usersById.set(userId, updated);
      return updated;
    },
    async overrideKycStatusAsAdmin({ userId, actorId, status, reason }: { userId: string; actorId: string; status: KycStatus; reason: string }) {
      overrides.push({ userId, actorId, status, reason });
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      const updated: AppUser = { ...u, kycStatus: status };
      usersById.set(userId, updated);
      return updated;
    },
    // ── B2.3 stubs ─────────────────────────────────────────────────────────
    async listPlayerHallStatus(userId: string) {
      return hallStatusByUser.get(userId) ?? [];
    },
    async setPlayerHallStatus({ userId, hallId, isActive, reason, actorId }: {
      userId: string; hallId: string; isActive: boolean; reason: string | null; actorId: string;
    }) {
      hallStatusSets.push({ userId, hallId, isActive, reason, actorId });
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      const row = {
        hallId, isActive, reason, updatedBy: actorId,
        updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      };
      const list = hallStatusByUser.get(userId) ?? [];
      const existing = list.findIndex((r) => r.hallId === hallId);
      if (existing >= 0) list[existing] = row;
      else list.push(row);
      hallStatusByUser.set(userId, list);
      return row;
    },
    async softDeletePlayer(userId: string) {
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      softDeletes.push(userId);
    },
    async restorePlayer(userId: string) {
      restores.push(userId);
    },
    async resetKycForReverify({ userId, actorId }: { userId: string; actorId: string }) {
      reverifies.push({ userId, actorId });
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      const updated: AppUser = { ...u, kycStatus: "UNVERIFIED" };
      usersById.set(userId, updated);
      return updated;
    },
    async bulkImportPlayers(rows: Array<Record<string, unknown>>) {
      bulkImports.push({ rowCount: rows.length });
      const errors: Array<{ row: number; email: string | null; error: string }> = [];
      let imported = 0;
      let skipped = 0;
      const importedEmails: string[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i] as Record<string, string> | undefined;
        const email = r?.email?.trim() ?? "";
        if (!email || !r?.displayName || !r?.surname || !r?.birthDate) {
          skipped += 1;
          errors.push({ row: i + 1, email: email || null, error: "missing-field" });
          continue;
        }
        imported += 1;
        importedEmails.push(email);
      }
      return { imported, skipped, errors, importedEmails };
    },
    async listPlayersForExport(filter: { kycStatus?: KycStatus; hallId?: string; includeDeleted?: boolean; limit?: number }) {
      return [...usersById.values()].filter((u) => {
        if (u.role !== "PLAYER") return false;
        if (filter.kycStatus && u.kycStatus !== filter.kycStatus) return false;
        if (filter.hallId && u.hallId !== filter.hallId) return false;
        return true;
      });
    },
    async searchPlayers({ query, limit, includeDeleted }: { query: string; limit?: number; includeDeleted?: boolean }) {
      if (query.length < 2) throw new DomainError("INVALID_INPUT", "query må være minst 2 tegn.");
      const lower = query.toLowerCase();
      let matches = [...usersById.values()].filter((u) => {
        if (u.role !== "PLAYER") return false;
        const haystack = [u.email, u.displayName, u.surname ?? "", u.phone ?? ""].join(" ").toLowerCase();
        return haystack.includes(lower);
      });
      if (!includeDeleted) {
        matches = matches.filter((u) => !(u as unknown as { deletedAt?: string | null }).deletedAt);
      }
      if (limit) matches = matches.slice(0, limit);
      return matches;
    },
  } as unknown as PlatformService;

  const bankIdAdapter: BankIdKycAdapter | null = opts?.withBankId
    ? ({
        createAuthSession(userId: string) {
          bankIdSessions.push({ userId });
          return { sessionId: `bankid-${userId}-${Date.now()}`, authUrl: `https://bankid.test/auth?u=${userId}` };
        },
      } as unknown as BankIdKycAdapter)
    : null;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminPlayersRouter({
      platformService,
      auditLogService,
      emailService,
      bankIdAdapter,
      webBaseUrl: "https://test.example",
      supportEmail: "support@test.example",
    })
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: {
      auditStore, sentEmails, approves, rejects, resubmits, overrides,
      softDeletes, restores, reverifies, bulkImports, hallStatusSets, bankIdSessions,
    },
    usersById,
    close: () => new Promise((resolve) => server.close(() => resolve())),
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

async function waitForAudit(store: InMemoryAuditLogStore, action: string): Promise<PersistedAuditEvent | null> {
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
  id: "admin-1", email: "admin@test.no", displayName: "Admin",
  walletId: "w-admin", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = { ...adminUser, id: "op-1", role: "HALL_OPERATOR", hallId: "hall-a" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

// ── Tests ─────────────────────────────────────────────────────────────────

test("BIN-587 B2.2: GET /api/admin/players/pending — ADMIN ser kun PENDING-spillere", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [
      makeUser({ id: "p-1", kycStatus: "PENDING" }),
      makeUser({ id: "p-2", kycStatus: "PENDING" }),
      makeUser({ id: "p-3", kycStatus: "VERIFIED" }),
      makeUser({ id: "p-4", kycStatus: "REJECTED" }),
    ]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/pending", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
    assert.deepEqual(res.json.data.players.map((p: { id: string }) => p.id).sort(), ["p-1", "p-2"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: GET /api/admin/players/rejected — SUPPORT kan se rejected", async () => {
  const ctx = await startServer(
    { "sup-tok": supportUser },
    [
      makeUser({ id: "p-1", kycStatus: "REJECTED" }),
      makeUser({ id: "p-2", kycStatus: "PENDING" }),
    ]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/rejected", "sup-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.players[0].id, "p-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: HALL_OPERATOR får FORBIDDEN på KYC-list", async () => {
  const ctx = await startServer({ "op-tok": operatorUser }, []);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/pending", "op-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: PLAYER får FORBIDDEN på KYC-list", async () => {
  const ctx = await startServer({ "pl-tok": playerUser }, []);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/pending", "pl-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: POST approve setter VERIFIED, logger audit, sender kyc-approved-e-post", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", kycStatus: "PENDING", email: "alice@test.no" })]
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/approve", "admin-tok", {
      note: "godkjent manuelt etter dokumentsjekk",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.kycStatus, "VERIFIED");
    assert.deepEqual(ctx.spies.approves, [{ userId: "p-1", actorId: "admin-1" }]);

    const event = await waitForAudit(ctx.spies.auditStore, "player.kyc.approve");
    assert.ok(event, "forventet audit-event player.kyc.approve");
    assert.equal(event!.actorId, "admin-1");
    assert.equal(event!.actorType, "ADMIN");
    assert.equal(event!.resource, "user");
    assert.equal(event!.resourceId, "p-1");
    assert.equal(event!.details.newStatus, "VERIFIED");
    assert.equal(event!.details.note, "godkjent manuelt etter dokumentsjekk");

    // Vent på fire-and-forget e-post
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ctx.spies.sentEmails.length, 1);
    assert.equal(ctx.spies.sentEmails[0]!.template, "kyc-approved");
    assert.equal(ctx.spies.sentEmails[0]!.to, "alice@test.no");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: POST reject krever reason", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", kycStatus: "PENDING" })]
  );
  try {
    const noReason = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/reject", "admin-tok", {});
    assert.equal(noReason.status, 400);
    assert.equal(noReason.json.error.code, "INVALID_INPUT");
    assert.equal(ctx.spies.rejects.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: POST reject setter REJECTED + audit med reason + kyc-rejected-e-post", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", kycStatus: "PENDING", email: "bob@test.no" })]
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/reject", "admin-tok", {
      reason: "Ugyldig fødselsnummer",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.kycStatus, "REJECTED");
    assert.deepEqual(ctx.spies.rejects, [
      { userId: "p-1", actorId: "admin-1", reason: "Ugyldig fødselsnummer" },
    ]);

    const event = await waitForAudit(ctx.spies.auditStore, "player.kyc.reject");
    assert.ok(event);
    assert.equal(event!.details.reason, "Ugyldig fødselsnummer");
    assert.equal(event!.details.newStatus, "REJECTED");

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ctx.spies.sentEmails.length, 1);
    assert.equal(ctx.spies.sentEmails[0]!.template, "kyc-rejected");
    assert.equal(ctx.spies.sentEmails[0]!.context.reason, "Ugyldig fødselsnummer");
    assert.ok((ctx.spies.sentEmails[0]!.context.resubmitLink as string).startsWith("https://test.example/"));
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: POST resubmit går kun fra REJECTED → UNVERIFIED", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [
      makeUser({ id: "p-rej", kycStatus: "REJECTED" }),
      makeUser({ id: "p-pen", kycStatus: "PENDING" }),
    ]
  );
  try {
    const ok = await req(ctx.baseUrl, "POST", "/api/admin/players/p-rej/resubmit", "admin-tok");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.kycStatus, "UNVERIFIED");

    const bad = await req(ctx.baseUrl, "POST", "/api/admin/players/p-pen/resubmit", "admin-tok");
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "KYC_NOT_REJECTED");

    const event = await waitForAudit(ctx.spies.auditStore, "player.kyc.resubmit");
    assert.ok(event);
    assert.equal(event!.resourceId, "p-rej");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: GET /api/admin/players/:id returnerer detalj inkl. complianceData", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", kycStatus: "PENDING", complianceData: { notes: "fnr-variant" } })]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/p-1", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "p-1");
    assert.deepEqual(res.json.data.complianceData, { notes: "fnr-variant" });
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: GET /api/admin/players/:id/audit returnerer log-events for spiller", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", kycStatus: "PENDING" })]
  );
  try {
    // Trigger en approve for å generere audit-event
    await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/approve", "admin-tok");
    await new Promise((r) => setTimeout(r, 20));
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/p-1/audit", "admin-tok");
    assert.equal(res.status, 200);
    assert.ok(res.json.data.count >= 1);
    assert.equal(res.json.data.events[0].action, "player.kyc.approve");
    assert.equal(res.json.data.events[0].resourceId, "p-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: PUT kyc-status — SUPPORT får FORBIDDEN (kun ADMIN)", async () => {
  const ctx = await startServer(
    { "sup-tok": supportUser },
    [makeUser({ id: "p-1", kycStatus: "PENDING" })]
  );
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/players/p-1/kyc-status", "sup-tok", {
      status: "VERIFIED",
      reason: "manual override",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.spies.overrides.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: PUT kyc-status — ADMIN kan overstyre", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", kycStatus: "REJECTED" })]
  );
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/players/p-1/kyc-status", "admin-tok", {
      status: "VERIFIED",
      reason: "compliance-review OK etter manuell dok-sjekk",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.kycStatus, "VERIFIED");
    assert.equal(ctx.spies.overrides.length, 1);
    assert.equal(ctx.spies.overrides[0]!.status, "VERIFIED");

    const event = await waitForAudit(ctx.spies.auditStore, "player.kyc.override");
    assert.ok(event);
    assert.equal(event!.details.newStatus, "VERIFIED");
    assert.equal(event!.details.reason, "compliance-review OK etter manuell dok-sjekk");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.2: PUT kyc-status krever gyldig status-verdi", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1", kycStatus: "PENDING" })]
  );
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/players/p-1/kyc-status", "admin-tok", {
      status: "NONSENSE",
      reason: "test",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── B2.3 — Lifecycle ─────────────────────────────────────────────────────

test("BIN-587 B2.3: GET hall-status returnerer status-liste", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1" })]
  );
  try {
    // Sett en status først
    await req(ctx.baseUrl, "PUT", "/api/admin/players/p-1/hall-status", "admin-tok", {
      hallId: "hall-a", isActive: false, reason: "problemspiller",
    });
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/p-1/hall-status", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.statuses[0].hallId, "hall-a");
    assert.equal(res.json.data.statuses[0].isActive, false);
    assert.equal(res.json.data.statuses[0].reason, "problemspiller");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: PUT hall-status krever PLAYER_LIFECYCLE_WRITE — HALL_OPERATOR får FORBIDDEN", async () => {
  const ctx = await startServer(
    { "op-tok": operatorUser },
    [makeUser({ id: "p-1" })]
  );
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/players/p-1/hall-status", "op-tok", {
      hallId: "hall-a", isActive: false,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.spies.hallStatusSets.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: PUT hall-status validerer isActive som boolean", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1" })]
  );
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/players/p-1/hall-status", "admin-tok", {
      hallId: "hall-a", isActive: "yes" as unknown as boolean,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: PUT hall-status logger audit med { hallId, isActive, reason }", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1" })]
  );
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/players/p-1/hall-status", "admin-tok", {
      hallId: "hall-a", isActive: false, reason: "kaoslogg",
    });
    assert.equal(res.status, 200);
    const event = await waitForAudit(ctx.spies.auditStore, "player.hall_status.set");
    assert.ok(event);
    assert.equal(event!.details.hallId, "hall-a");
    assert.equal(event!.details.isActive, false);
    assert.equal(event!.details.reason, "kaoslogg");
    assert.equal(event!.resourceId, "p-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: POST soft-delete krever PLAYER_LIFECYCLE_WRITE", async () => {
  const ctx = await startServer(
    { "op-tok": operatorUser, "admin-tok": adminUser },
    [makeUser({ id: "p-1" })]
  );
  try {
    const bad = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/soft-delete", "op-tok");
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "FORBIDDEN");
    assert.equal(ctx.spies.softDeletes.length, 0);

    const ok = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/soft-delete", "admin-tok", {
      reason: "Konto-sletting etter forespørsel",
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ctx.spies.softDeletes, ["p-1"]);

    const event = await waitForAudit(ctx.spies.auditStore, "player.soft_delete");
    assert.ok(event);
    assert.equal(event!.details.reason, "Konto-sletting etter forespørsel");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: POST restore reverses soft-delete + audit", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1" })]
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/restore", "admin-tok");
    assert.equal(res.status, 200);
    assert.deepEqual(ctx.spies.restores, ["p-1"]);
    const event = await waitForAudit(ctx.spies.auditStore, "player.restore");
    assert.ok(event);
    assert.equal(event!.resourceId, "p-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: POST bankid-reverify uten bankIdAdapter returnerer { session: null }", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1" })],
    { withBankId: false }
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/bankid-reverify", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.bankIdConfigured, false);
    assert.equal(res.json.data.bankIdSession, null);
    assert.equal(ctx.spies.reverifies.length, 1);
    assert.equal(ctx.spies.bankIdSessions.length, 0);

    const event = await waitForAudit(ctx.spies.auditStore, "player.bankid.reverify");
    assert.ok(event);
    assert.equal(event!.details.bankIdConfigured, false);
    assert.equal(event!.details.sessionIssued, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: POST bankid-reverify med bankIdAdapter utsteder ny sesjon", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "p-1" })],
    { withBankId: true }
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/p-1/bankid-reverify", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.bankIdConfigured, true);
    assert.ok(res.json.data.bankIdSession);
    assert.ok((res.json.data.bankIdSession.authUrl as string).includes("bankid.test"));
    assert.equal(ctx.spies.reverifies[0]!.userId, "p-1");
    assert.equal(ctx.spies.bankIdSessions[0]!.userId, "p-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: POST bulk-import aksepterer rows-array + returnerer summary", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, []);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/bulk-import", "admin-tok", {
      rows: [
        { email: "a@test.no", displayName: "Alice", surname: "A", birthDate: "1990-01-01" },
        { email: "b@test.no", displayName: "Bob", surname: "B", birthDate: "1985-05-05" },
        { email: "", displayName: "No email", surname: "X", birthDate: "1990-01-01" }, // invalid
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.imported, 2);
    assert.equal(res.json.data.skipped, 1);
    assert.equal(res.json.data.errors.length, 1);
    assert.equal(ctx.spies.bulkImports[0]!.rowCount, 3);

    const event = await waitForAudit(ctx.spies.auditStore, "player.bulk_import");
    assert.ok(event);
    assert.equal(event!.details.imported, 2);
    assert.equal(event!.details.skipped, 1);
    assert.equal(event!.details.totalRows, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: POST bulk-import aksepterer CSV-string", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, []);
  try {
    const csv = [
      "email,displayName,surname,birthDate",
      "c@test.no,Carol,C,1991-02-03",
      "d@test.no,Dan,D,1992-04-05",
    ].join("\n");
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/bulk-import", "admin-tok", { csv });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.imported, 2);
    assert.equal(res.json.data.skipped, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: POST bulk-import avviser over 1000 rader", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, []);
  try {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      email: `u${i}@test.no`, displayName: `U${i}`, surname: "X", birthDate: "1990-01-01",
    }));
    const res = await req(ctx.baseUrl, "POST", "/api/admin/players/bulk-import", "admin-tok", { rows });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: GET search returnerer match på email", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [
      makeUser({ id: "p-1", email: "alice@example.com", displayName: "Alice" }),
      makeUser({ id: "p-2", email: "bob@example.com", displayName: "Bob" }),
    ]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/search?query=alice", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.players[0].id, "p-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: GET search krever query-param", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, []);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/search", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.3: GET export.csv returnerer CSV med Content-Type + BOM", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [
      makeUser({ id: "p-1", email: "a@test.no", displayName: "Alice", kycStatus: "VERIFIED" }),
      makeUser({ id: "p-2", email: "b@test.no", displayName: "Bob", kycStatus: "VERIFIED" }),
    ]
  );
  try {
    const res = await fetch(`${ctx.baseUrl}/api/admin/players/export.csv`, {
      headers: { Authorization: "Bearer admin-tok" },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type")?.includes("text/csv"));
    assert.ok(res.headers.get("content-disposition")?.includes("players-export-"));
    // Les bytes for BOM-sjekk (undici's text() kan strippe BOM-marker).
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf[0], 0xef);
    assert.equal(buf[1], 0xbb);
    assert.equal(buf[2], 0xbf);
    const body = buf.toString("utf8");
    assert.ok(body.includes("email"));
    assert.ok(body.includes("a@test.no"));
    assert.ok(body.includes("b@test.no"));
  } finally {
    await ctx.close();
  }
});
