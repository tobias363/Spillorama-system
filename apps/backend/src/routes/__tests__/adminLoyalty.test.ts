/**
 * BIN-700: integrasjonstester for admin-loyalty-router.
 *
 * Dekker alle 9 endepunkter (tier CRUD + player-state + award + override).
 * Stub-service med in-memory Map + spy-collector. Mønster matcher
 * adminLeaderboardTiers.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminLoyaltyRouter } from "../adminLoyalty.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  LoyaltyService,
  LoyaltyTier,
  LoyaltyPlayerState,
  LoyaltyEvent,
  AwardLoyaltyPointsInput,
  OverrideLoyaltyTierInput,
  CreateLoyaltyTierInput,
  UpdateLoyaltyTierInput,
  ListLoyaltyTierFilter,
  AwardResult,
} from "../../compliance/LoyaltyService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "a@test.no",
  displayName: "Admin",
  walletId: "w-a",
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

function makeTier(overrides: Partial<LoyaltyTier> & { id: string }): LoyaltyTier {
  return {
    id: overrides.id,
    name: overrides.name ?? "Bronze",
    rank: overrides.rank ?? 1,
    minPoints: overrides.minPoints ?? 0,
    maxPoints: overrides.maxPoints ?? null,
    benefits: overrides.benefits ?? {},
    active: overrides.active ?? true,
    createdByUserId: overrides.createdByUserId ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-29T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-29T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    awardCalls: AwardLoyaltyPointsInput[];
    overrideCalls: OverrideLoyaltyTierInput[];
  };
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: { tiers?: LoyaltyTier[]; states?: LoyaltyPlayerState[] } = {}
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tiers = new Map<string, LoyaltyTier>();
  for (const t of seed.tiers ?? []) tiers.set(t.id, t);
  const states = new Map<string, LoyaltyPlayerState>();
  for (const s of seed.states ?? []) states.set(s.userId, s);
  const awardCalls: AwardLoyaltyPointsInput[] = [];
  const overrideCalls: OverrideLoyaltyTierInput[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = tiers.size;
  const loyaltyService = {
    async listTiers(filter: ListLoyaltyTierFilter = {}) {
      let list = [...tiers.values()].filter((t) => !t.deletedAt);
      if (filter.active !== undefined) list = list.filter((t) => t.active === filter.active);
      list.sort((a, b) => a.rank - b.rank);
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async getTier(id: string) {
      const t = tiers.get(id);
      if (!t) throw new DomainError("LOYALTY_TIER_NOT_FOUND", "not found");
      return t;
    },
    async createTier(input: CreateLoyaltyTierInput) {
      for (const t of tiers.values()) {
        if (!t.deletedAt && (t.name === input.name || t.rank === input.rank)) {
          throw new DomainError("LOYALTY_TIER_DUPLICATE", "dup");
        }
      }
      idCounter += 1;
      const id = `t-${idCounter}`;
      const next = makeTier({
        id,
        name: input.name,
        rank: input.rank,
        minPoints: input.minPoints ?? 0,
        maxPoints: input.maxPoints ?? null,
        benefits: input.benefits ?? {},
        active: input.active ?? true,
        createdByUserId: input.createdByUserId,
      });
      tiers.set(id, next);
      return next;
    },
    async updateTier(id: string, update: UpdateLoyaltyTierInput) {
      const t = tiers.get(id);
      if (!t) throw new DomainError("LOYALTY_TIER_NOT_FOUND", "not found");
      if (t.deletedAt) throw new DomainError("LOYALTY_TIER_DELETED", "deleted");
      const next = { ...t, ...update, updatedAt: new Date().toISOString() };
      tiers.set(id, next as LoyaltyTier);
      return next as LoyaltyTier;
    },
    async removeTier(id: string, opts: { hard?: boolean } = {}) {
      const t = tiers.get(id);
      if (!t) throw new DomainError("LOYALTY_TIER_NOT_FOUND", "not found");
      if (t.deletedAt) throw new DomainError("LOYALTY_TIER_DELETED", "already deleted");
      if (opts.hard) {
        tiers.delete(id);
        return { softDeleted: false };
      }
      tiers.set(id, { ...t, deletedAt: new Date().toISOString(), active: false });
      return { softDeleted: true };
    },
    async getPlayerState(userId: string) {
      return (
        states.get(userId) ?? {
          userId,
          currentTier: null,
          lifetimePoints: 0,
          monthPoints: 0,
          monthKey: null,
          tierLocked: false,
          lastUpdatedAt: "2026-04-29T10:00:00Z",
          createdAt: "2026-04-29T10:00:00Z",
        }
      );
    },
    async listPlayerEvents(userId: string) {
      // Returner tom liste — events er dekket i service-test.
      return [] as LoyaltyEvent[];
    },
    async listPlayerStates(opts: { tierId?: string; limit?: number; offset?: number } = {}) {
      let list = [...states.values()];
      if (opts.tierId) list = list.filter((s) => s.currentTier?.id === opts.tierId);
      const total = list.length;
      return { players: list.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50)), total };
    },
    async awardPoints(input: AwardLoyaltyPointsInput): Promise<AwardResult> {
      awardCalls.push(input);
      const existing = states.get(input.userId);
      const newLifetime = Math.max(0, (existing?.lifetimePoints ?? 0) + input.pointsDelta);
      const newState: LoyaltyPlayerState = {
        userId: input.userId,
        currentTier: existing?.currentTier ?? null,
        lifetimePoints: newLifetime,
        monthPoints: Math.max(0, (existing?.monthPoints ?? 0) + input.pointsDelta),
        monthKey: "2026-04",
        tierLocked: existing?.tierLocked ?? false,
        lastUpdatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      states.set(input.userId, newState);
      return {
        state: newState,
        event: {
          id: `e-${awardCalls.length}`,
          userId: input.userId,
          eventType: "admin_award",
          pointsDelta: input.pointsDelta,
          metadata: { reason: input.reason },
          createdByUserId: input.createdByUserId,
          createdAt: new Date().toISOString(),
        },
        tierChanged: false,
      };
    },
    async overrideTier(input: OverrideLoyaltyTierInput) {
      overrideCalls.push(input);
      const tier = input.tierId ? tiers.get(input.tierId) ?? null : null;
      const existing = states.get(input.userId);
      const newState: LoyaltyPlayerState = {
        userId: input.userId,
        currentTier: tier,
        lifetimePoints: existing?.lifetimePoints ?? 0,
        monthPoints: existing?.monthPoints ?? 0,
        monthKey: existing?.monthKey ?? "2026-04",
        tierLocked: input.tierId !== null,
        lastUpdatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      states.set(input.userId, newState);
      return newState;
    },
  } as unknown as LoyaltyService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminLoyaltyRouter({ platformService, auditLogService, loyaltyService })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, awardCalls, overrideCalls },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
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

// ── RBAC ────────────────────────────────────────────────────────────────────

test("BIN-700 route: PLAYER blokkert fra alle endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/loyalty/tiers", "pl-tok");
    assert.equal(list.status, 400);
    assert.equal(list.json.error.code, "FORBIDDEN");
    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/loyalty/tiers",
      "pl-tok",
      { name: "B", rank: 1 }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer(
    { "sup-tok": supportUser },
    { tiers: [makeTier({ id: "t-1" })] }
  );
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/loyalty/tiers", "sup-tok");
    assert.equal(list.status, 200);
    assert.equal(list.json.data.count, 1);

    const detail = await req(ctx.baseUrl, "GET", "/api/admin/loyalty/tiers/t-1", "sup-tok");
    assert.equal(detail.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/loyalty/tiers",
      "sup-tok",
      { name: "Silver", rank: 2 }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: HALL_OPERATOR kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/loyalty/tiers", "op-tok");
    assert.equal(list.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/loyalty/tiers",
      "op-tok",
      { name: "Silver", rank: 2 }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── Tier CRUD ──────────────────────────────────────────────────────────────

test("BIN-700 route: POST /tiers oppretter + auditerer", async () => {
  const ctx = await startServer({ "ad-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/loyalty/tiers",
      "ad-tok",
      { name: "Bronze", rank: 1, minPoints: 0, maxPoints: 500 }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "Bronze");
    assert.equal(res.json.data.rank, 1);

    const audit = await waitForAudit(ctx.spies.auditStore, "admin.loyalty.tier.create");
    assert.ok(audit, "audit event mangler");
    assert.equal(audit!.resource, "loyalty_tier");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: PATCH /tiers/:id oppdaterer + auditerer", async () => {
  const ctx = await startServer(
    { "ad-tok": adminUser },
    { tiers: [makeTier({ id: "t-1" })] }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/loyalty/tiers/t-1",
      "ad-tok",
      { minPoints: 100 }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.minPoints, 100);

    const audit = await waitForAudit(ctx.spies.auditStore, "admin.loyalty.tier.update");
    assert.ok(audit);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: DELETE /tiers/:id soft-delete default", async () => {
  const ctx = await startServer(
    { "ad-tok": adminUser },
    { tiers: [makeTier({ id: "t-1" })] }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/loyalty/tiers/t-1",
      "ad-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);

    const audit = await waitForAudit(ctx.spies.auditStore, "admin.loyalty.tier.delete");
    assert.ok(audit);
    assert.equal(audit!.details.softDeleted, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: POST /tiers avviser uten rank", async () => {
  const ctx = await startServer({ "ad-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/loyalty/tiers",
      "ad-tok",
      { name: "Bronze" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── Player state + award ───────────────────────────────────────────────────

test("BIN-700 route: GET /players/:userId returnerer state + events", async () => {
  const ctx = await startServer({ "ad-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/loyalty/players/u-42",
      "ad-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.state.userId, "u-42");
    assert.ok(Array.isArray(res.json.data.events));
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: POST /players/:userId/award krever pointsDelta + reason", async () => {
  const ctx = await startServer({ "ad-tok": adminUser });
  try {
    const missing = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/loyalty/players/u-1/award",
      "ad-tok",
      { reason: "Bursdag" }
    );
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, "INVALID_INPUT");

    const missingReason = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/loyalty/players/u-1/award",
      "ad-tok",
      { pointsDelta: 100 }
    );
    assert.equal(missingReason.status, 400);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: POST /players/:userId/award oppdaterer state + auditerer", async () => {
  const ctx = await startServer({ "ad-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/loyalty/players/u-42/award",
      "ad-tok",
      { pointsDelta: 250, reason: "Bursdagsbonus" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.state.lifetimePoints, 250);
    assert.equal(res.json.data.event.eventType, "admin_award");
    assert.equal(res.json.data.tierChanged, false);
    assert.equal(ctx.spies.awardCalls.length, 1);
    assert.equal(ctx.spies.awardCalls[0]!.pointsDelta, 250);

    const audit = await waitForAudit(ctx.spies.auditStore, "admin.loyalty.points.award");
    assert.ok(audit);
    assert.equal(audit!.details.pointsDelta, 250);
    assert.equal(audit!.details.reason, "Bursdagsbonus");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: PATCH /players/:userId/tier setter override + auditerer", async () => {
  const ctx = await startServer(
    { "ad-tok": adminUser },
    { tiers: [makeTier({ id: "t-gold", name: "Gold", rank: 3 })] }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/loyalty/players/u-42/tier",
      "ad-tok",
      { tierId: "t-gold", reason: "VIP-program" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.tierLocked, true);
    assert.equal(res.json.data.currentTier?.id, "t-gold");
    assert.equal(ctx.spies.overrideCalls.length, 1);

    const audit = await waitForAudit(ctx.spies.auditStore, "admin.loyalty.tier.override");
    assert.ok(audit);
    assert.equal(audit!.details.tierId, "t-gold");
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: PATCH /players/:userId/tier tillater null (fjern override)", async () => {
  const ctx = await startServer({ "ad-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/loyalty/players/u-42/tier",
      "ad-tok",
      { tierId: null, reason: "Auto-reassign" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.tierLocked, false);
    assert.equal(res.json.data.currentTier, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-700 route: GET /players list med tier-filter", async () => {
  const ctx = await startServer(
    { "ad-tok": adminUser },
    {
      states: [
        {
          userId: "u-1",
          currentTier: makeTier({ id: "t-1" }),
          lifetimePoints: 500,
          monthPoints: 50,
          monthKey: "2026-04",
          tierLocked: false,
          lastUpdatedAt: "2026-04-29T10:00:00Z",
          createdAt: "2026-04-29T10:00:00Z",
        },
      ],
    }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/loyalty/players?tierId=t-1",
      "ad-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.total, 1);
    assert.equal(res.json.data.players[0].userId, "u-1");
  } finally {
    await ctx.close();
  }
});
