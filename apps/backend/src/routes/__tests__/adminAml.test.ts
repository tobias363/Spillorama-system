/**
 * BIN-587 B3-aml: integrasjonstester for admin-AML-router.
 *
 * Full express round-trip med stub av AmlService (in-memory),
 * PlatformService (in-memory users) og AuditLogService (InMemory-store).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminAmlRouter } from "../adminAml.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  AmlService,
  AmlRedFlag,
  AmlRule,
  AmlRuleInput,
  AmlReviewOutcome,
  AmlSeverity,
  AmlFlagStatus,
} from "../../compliance/AmlService.js";
import type { PlatformService, PublicAppUser, AppUser } from "../../platform/PlatformService.js";
import type { PaymentRequest } from "../../payments/PaymentRequestService.js";
import { DomainError } from "../../game/BingoEngine.js";

function makeUser(overrides: Partial<AppUser> & { id: string }): AppUser {
  return {
    id: overrides.id,
    email: overrides.email ?? `${overrides.id}@test.no`,
    displayName: overrides.displayName ?? overrides.id,
    walletId: overrides.walletId ?? `w-${overrides.id}`,
    role: overrides.role ?? "PLAYER",
    hallId: overrides.hallId ?? null,
    kycStatus: overrides.kycStatus ?? "VERIFIED",
    birthDate: overrides.birthDate ?? "1990-01-01",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
  };
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

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    upsertCalls: Array<{ rules: AmlRuleInput[] }>;
    createCalls: Array<{ userId: string; severity: AmlSeverity; reason: string; openedBy: string | null }>;
    reviewCalls: Array<{ flagId: string; reviewerId: string; outcome: AmlReviewOutcome; note: string }>;
    scanCalls: string[];
    txQueries: Array<{ userId: string; minAmountCents?: number }>;
  };
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: { seedUsers?: AppUser[]; seedFlags?: AmlRedFlag[]; seedRules?: AmlRule[] }
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const usersById = new Map<string, AppUser>();
  for (const u of opts?.seedUsers ?? []) usersById.set(u.id, u);
  const flagsById = new Map<string, AmlRedFlag>();
  for (const f of opts?.seedFlags ?? []) flagsById.set(f.id, f);
  const rulesBySlug = new Map<string, AmlRule>();
  for (const r of opts?.seedRules ?? []) rulesBySlug.set(r.slug, r);

  const upsertCalls: Ctx["spies"]["upsertCalls"] = [];
  const createCalls: Ctx["spies"]["createCalls"] = [];
  const reviewCalls: Ctx["spies"]["reviewCalls"] = [];
  const scanCalls: string[] = [];
  const txQueries: Ctx["spies"]["txQueries"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(id: string): Promise<AppUser> {
      const u = usersById.get(id);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
  } as unknown as PlatformService;

  const amlService = {
    async listRules(): Promise<AmlRule[]> {
      return [...rulesBySlug.values()];
    },
    async upsertRules(rules: AmlRuleInput[]): Promise<AmlRule[]> {
      upsertCalls.push({ rules });
      const now = new Date().toISOString();
      for (const r of rules) {
        const existing = rulesBySlug.get(r.slug);
        rulesBySlug.set(r.slug, {
          id: existing?.id ?? `rule-${r.slug}`,
          slug: r.slug,
          label: r.label,
          severity: r.severity,
          thresholdAmountCents: r.thresholdAmountCents ?? null,
          windowDays: r.windowDays ?? null,
          description: r.description ?? null,
          isActive: r.isActive ?? true,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
      }
      return [...rulesBySlug.values()];
    },
    async listRedFlags(filter: { status?: AmlFlagStatus; severity?: AmlSeverity; userId?: string; limit?: number }): Promise<AmlRedFlag[]> {
      let list = [...flagsById.values()];
      if (filter.status) list = list.filter((f) => f.status === filter.status);
      if (filter.severity) list = list.filter((f) => f.severity === filter.severity);
      if (filter.userId) list = list.filter((f) => f.userId === filter.userId);
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async getRedFlag(id: string): Promise<AmlRedFlag> {
      const f = flagsById.get(id);
      if (!f) throw new DomainError("AML_FLAG_NOT_FOUND", "not found");
      return f;
    },
    async listFlagsForUser(userId: string): Promise<AmlRedFlag[]> {
      return [...flagsById.values()].filter((f) => f.userId === userId);
    },
    async createRedFlag(input: { userId: string; severity: AmlSeverity; reason: string; ruleSlug?: string; openedBy: string | null }): Promise<AmlRedFlag> {
      createCalls.push({ userId: input.userId, severity: input.severity, reason: input.reason, openedBy: input.openedBy });
      const id = `flag-${flagsById.size + 1}`;
      const now = new Date().toISOString();
      const flag: AmlRedFlag = {
        id, userId: input.userId, ruleSlug: input.ruleSlug ?? "manual",
        severity: input.severity, status: "OPEN", reason: input.reason,
        transactionId: null, details: null, openedBy: input.openedBy,
        reviewedBy: null, reviewedAt: null, reviewOutcome: null, reviewNote: null,
        createdAt: now, updatedAt: now,
      };
      flagsById.set(id, flag);
      return flag;
    },
    async reviewRedFlag(input: { flagId: string; reviewerId: string; outcome: AmlReviewOutcome; note: string }): Promise<AmlRedFlag> {
      reviewCalls.push(input);
      const f = flagsById.get(input.flagId);
      if (!f) throw new DomainError("AML_FLAG_NOT_FOUND", "not found");
      if (f.status !== "OPEN") throw new DomainError("AML_FLAG_ALREADY_REVIEWED", "already done");
      const updated: AmlRedFlag = {
        ...f, status: input.outcome, reviewOutcome: input.outcome,
        reviewedBy: input.reviewerId, reviewedAt: new Date().toISOString(),
        reviewNote: input.note, updatedAt: new Date().toISOString(),
      };
      flagsById.set(input.flagId, updated);
      return updated;
    },
    async listTransactionsForReview(input: { userId: string; minAmountCents?: number }): Promise<PaymentRequest[]> {
      txQueries.push({ userId: input.userId, minAmountCents: input.minAmountCents });
      return [];
    },
    async scanNow(actorId: string) {
      scanCalls.push(actorId);
      return { scanned: 0, flagsCreated: 0, ruleSlugsEvaluated: [] };
    },
  } as unknown as AmlService;

  const app = express();
  app.use(express.json());
  app.use(createAdminAmlRouter({ platformService, auditLogService, amlService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, upsertCalls, createCalls, reviewCalls, scanCalls, txQueries },
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

// ── Tests ─────────────────────────────────────────────────────────────────

test("BIN-587 B3-aml: GET red-flags — ADMIN har tilgang, HALL_OPERATOR + PLAYER blokkert", async () => {
  const ctx = await startServer({ "admin-tok": adminUser, "op-tok": operatorUser, "pl-tok": playerUser });
  try {
    const ok = await req(ctx.baseUrl, "GET", "/api/admin/aml/red-flags", "admin-tok");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.count, 0);

    const blocked1 = await req(ctx.baseUrl, "GET", "/api/admin/aml/red-flags", "op-tok");
    assert.equal(blocked1.status, 400);
    assert.equal(blocked1.json.error.code, "FORBIDDEN");

    const blocked2 = await req(ctx.baseUrl, "GET", "/api/admin/aml/red-flags", "pl-tok");
    assert.equal(blocked2.status, 400);
    assert.equal(blocked2.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: PUT rules — ADMIN only (SUPPORT blokkert via USER_ROLE_WRITE-guard)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser, "sup-tok": supportUser });
  try {
    const asSupport = await req(ctx.baseUrl, "PUT", "/api/admin/aml/red-flag-rules", "sup-tok", {
      rules: [{ slug: "high-stake", label: "High stake", severity: "HIGH" }],
    });
    assert.equal(asSupport.status, 400);
    assert.equal(asSupport.json.error.code, "FORBIDDEN");

    const asAdmin = await req(ctx.baseUrl, "PUT", "/api/admin/aml/red-flag-rules", "admin-tok", {
      rules: [{ slug: "high-stake", label: "High stake", severity: "HIGH", thresholdAmountCents: 100000 }],
    });
    assert.equal(asAdmin.status, 200);
    assert.equal(ctx.spies.upsertCalls.length, 1);

    const event = await waitForAudit(ctx.spies.auditStore, "aml.rules.upsert");
    assert.ok(event);
    assert.equal(event!.actorType, "ADMIN");
    assert.deepEqual(event!.details.slugs, ["high-stake"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: POST red-flag (manuell) — SUPPORT kan flagge, audit logger reason + severity", async () => {
  const ctx = await startServer(
    { "sup-tok": supportUser },
    { seedUsers: [makeUser({ id: "p-1" })] }
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/aml/red-flags", "sup-tok", {
      userId: "p-1",
      severity: "HIGH",
      reason: "Mistenkelig mønster — samme IP 5 forskjellige spillere",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.severity, "HIGH");
    assert.equal(res.json.data.userId, "p-1");
    assert.equal(res.json.data.status, "OPEN");
    assert.equal(ctx.spies.createCalls.length, 1);
    assert.equal(ctx.spies.createCalls[0]!.openedBy, "sup-1");

    const event = await waitForAudit(ctx.spies.auditStore, "aml.flag.create");
    assert.ok(event);
    assert.equal(event!.actorType, "SUPPORT");
    assert.equal(event!.details.severity, "HIGH");
    assert.equal(event!.details.userId, "p-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: POST red-flag validerer severity", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { seedUsers: [makeUser({ id: "p-1" })] }
  );
  try {
    const bad = await req(ctx.baseUrl, "POST", "/api/admin/aml/red-flags", "admin-tok", {
      userId: "p-1", severity: "SUPER-DUPER", reason: "x",
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: POST red-flag avviser ukjent userId", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/aml/red-flags", "admin-tok", {
      userId: "ghost", severity: "LOW", reason: "test",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "USER_NOT_FOUND");
    assert.equal(ctx.spies.createCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: POST review — outcome + note + audit", async () => {
  const seedFlag: AmlRedFlag = {
    id: "flag-1", userId: "p-1", ruleSlug: "manual", severity: "HIGH",
    status: "OPEN", reason: "test", transactionId: null, details: null,
    openedBy: "admin-1", reviewedBy: null, reviewedAt: null,
    reviewOutcome: null, reviewNote: null,
    createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z",
  };
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { seedFlags: [seedFlag], seedUsers: [makeUser({ id: "p-1" })] }
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/aml/red-flags/flag-1/review", "admin-tok", {
      outcome: "DISMISSED",
      note: "Verifisert at det var samme familie på samme internett-kobling",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "DISMISSED");
    assert.equal(res.json.data.reviewOutcome, "DISMISSED");
    assert.equal(ctx.spies.reviewCalls[0]!.outcome, "DISMISSED");

    const event = await waitForAudit(ctx.spies.auditStore, "aml.flag.review");
    assert.ok(event);
    assert.equal(event!.details.outcome, "DISMISSED");
    assert.equal(event!.resourceId, "flag-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: POST review krever outcome + note", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const noOutcome = await req(ctx.baseUrl, "POST", "/api/admin/aml/red-flags/flag-1/review", "admin-tok", {
      note: "hei",
    });
    assert.equal(noOutcome.status, 400);
    assert.equal(noOutcome.json.error.code, "INVALID_INPUT");

    const badOutcome = await req(ctx.baseUrl, "POST", "/api/admin/aml/red-flags/flag-1/review", "admin-tok", {
      outcome: "NONSENSE", note: "hei",
    });
    assert.equal(badOutcome.status, 400);
    assert.equal(badOutcome.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: GET /api/admin/players/:id/aml-flags — per-player flags", async () => {
  const flag: AmlRedFlag = {
    id: "flag-1", userId: "p-1", ruleSlug: "manual", severity: "MEDIUM",
    status: "OPEN", reason: "test", transactionId: null, details: null,
    openedBy: null, reviewedBy: null, reviewedAt: null,
    reviewOutcome: null, reviewNote: null,
    createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z",
  };
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { seedFlags: [flag], seedUsers: [makeUser({ id: "p-1" })] }
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/p-1/aml-flags", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.flags[0].id, "flag-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: GET /api/admin/players/:id/aml-flags krever eksisterende bruker", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/players/ghost/aml-flags", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "USER_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: GET /api/admin/aml/transactions videresender filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/aml/transactions?userId=p-1&minAmountCents=500000",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.txQueries.length, 1);
    assert.equal(ctx.spies.txQueries[0]!.userId, "p-1");
    assert.equal(ctx.spies.txQueries[0]!.minAmountCents, 500000);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: POST /scan returnerer stub-resultat + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/aml/scan", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.stubbed, true);
    assert.equal(res.json.data.scanned, 0);
    assert.equal(res.json.data.flagsCreated, 0);
    assert.equal(ctx.spies.scanCalls.length, 1);
    assert.equal(ctx.spies.scanCalls[0], "admin-1");

    const event = await waitForAudit(ctx.spies.auditStore, "aml.scan.run");
    assert.ok(event);
    assert.equal(event!.details.stubbed, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: GET rules — SUPPORT har tilgang (read)", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/aml/red-flag-rules", "sup-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-aml: /scan krever PLAYER_AML_WRITE — HALL_OPERATOR blokkert", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/aml/scan", "op-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});
