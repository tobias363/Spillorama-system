/**
 * BIN-668: integrasjonstester for admin-leaderboard-tiers-router.
 *
 * Dekker alle 5 endepunkter:
 *   GET    /api/admin/leaderboard/tiers
 *   GET    /api/admin/leaderboard/tiers/:id
 *   POST   /api/admin/leaderboard/tiers
 *   PATCH  /api/admin/leaderboard/tiers/:id
 *   DELETE /api/admin/leaderboard/tiers/:id
 *
 * Testene bygger en stub-LeaderboardTierService rundt et in-memory Map —
 * samme mønster som adminGameTypes.test.ts + adminSubGames.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminLeaderboardTiersRouter } from "../adminLeaderboardTiers.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  LeaderboardTierService,
  LeaderboardTier,
  CreateLeaderboardTierInput,
  UpdateLeaderboardTierInput,
  ListLeaderboardTierFilter,
} from "../../admin/LeaderboardTierService.js";
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

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    creates: LeaderboardTier[];
    updates: Array<{ id: string; changed: string[] }>;
    removes: Array<{ id: string; hard: boolean }>;
  };
  tiers: Map<string, LeaderboardTier>;
  close: () => Promise<void>;
}

function makeTier(
  overrides: Partial<LeaderboardTier> & { id: string; place: number }
): LeaderboardTier {
  return {
    id: overrides.id,
    tierName: overrides.tierName ?? "default",
    place: overrides.place,
    points: overrides.points ?? 0,
    prizeAmount: overrides.prizeAmount ?? null,
    prizeDescription: overrides.prizeDescription ?? "",
    active: overrides.active ?? true,
    extra: overrides.extra ?? {},
    createdByUserId: overrides.createdByUserId ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-20T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-20T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: LeaderboardTier[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tiers = new Map<string, LeaderboardTier>();
  for (const t of seed) tiers.set(t.id, t);

  const creates: LeaderboardTier[] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const removes: Ctx["spies"]["removes"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = tiers.size;
  const leaderboardTierService = {
    async list(filter: ListLeaderboardTierFilter = {}) {
      let list = [...tiers.values()].filter((t) => !t.deletedAt);
      if (filter.tierName) list = list.filter((t) => t.tierName === filter.tierName);
      if (filter.active !== undefined) {
        list = list.filter((t) => t.active === filter.active);
      }
      list.sort((a, b) => {
        if (a.tierName !== b.tierName) return a.tierName.localeCompare(b.tierName);
        return a.place - b.place;
      });
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const t = tiers.get(id);
      if (!t) {
        throw new DomainError("LEADERBOARD_TIER_NOT_FOUND", "not found");
      }
      return t;
    },
    async create(input: CreateLeaderboardTierInput) {
      const tierName = input.tierName ?? "default";
      for (const t of tiers.values()) {
        if (
          !t.deletedAt &&
          t.tierName === tierName &&
          t.place === input.place
        ) {
          throw new DomainError(
            "LEADERBOARD_TIER_DUPLICATE",
            `duplicate (${tierName}, ${input.place})`
          );
        }
      }
      idCounter += 1;
      const id = `t-${idCounter}`;
      const next = makeTier({
        id,
        tierName,
        place: input.place,
        points: input.points ?? 0,
        prizeAmount: input.prizeAmount ?? null,
        prizeDescription: input.prizeDescription ?? "",
        active: input.active ?? true,
        extra: input.extra ?? {},
        createdByUserId: input.createdByUserId,
      });
      tiers.set(id, next);
      creates.push(next);
      return next;
    },
    async update(id: string, update: UpdateLeaderboardTierInput) {
      const t = tiers.get(id);
      if (!t) {
        throw new DomainError("LEADERBOARD_TIER_NOT_FOUND", "not found");
      }
      if (t.deletedAt) {
        throw new DomainError("LEADERBOARD_TIER_DELETED", "deleted");
      }
      updates.push({ id, changed: Object.keys(update) });
      const next: LeaderboardTier = { ...t };
      if (update.tierName !== undefined) next.tierName = update.tierName;
      if (update.place !== undefined) next.place = update.place;
      if (update.points !== undefined) next.points = update.points;
      if (update.prizeAmount !== undefined) next.prizeAmount = update.prizeAmount;
      if (update.prizeDescription !== undefined) {
        next.prizeDescription = update.prizeDescription;
      }
      if (update.active !== undefined) next.active = update.active;
      if (update.extra !== undefined) next.extra = update.extra;
      // Duplikat-sjekk for (tierName, place) når en av dem endres.
      if (update.tierName !== undefined || update.place !== undefined) {
        for (const other of tiers.values()) {
          if (
            other.id !== id &&
            !other.deletedAt &&
            other.tierName === next.tierName &&
            other.place === next.place
          ) {
            throw new DomainError(
              "LEADERBOARD_TIER_DUPLICATE",
              "duplicate after update"
            );
          }
        }
      }
      next.updatedAt = new Date().toISOString();
      tiers.set(id, next);
      return next;
    },
    async remove(id: string, options: { hard?: boolean } = {}) {
      const t = tiers.get(id);
      if (!t) {
        throw new DomainError("LEADERBOARD_TIER_NOT_FOUND", "not found");
      }
      if (t.deletedAt) {
        throw new DomainError("LEADERBOARD_TIER_DELETED", "already deleted");
      }
      removes.push({ id, hard: Boolean(options.hard) });
      if (options.hard) {
        tiers.delete(id);
        return { softDeleted: false };
      }
      tiers.set(id, {
        ...t,
        deletedAt: new Date().toISOString(),
        active: false,
      });
      return { softDeleted: true };
    },
    async count(): Promise<number> {
      return [...tiers.values()].filter((t) => !t.deletedAt).length;
    },
  } as unknown as LeaderboardTierService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminLeaderboardTiersRouter({
      platformService,
      auditLogService,
      leaderboardTierService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, creates, updates, removes },
    tiers,
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
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

// ── RBAC ─────────────────────────────────────────────────────────────────────

test("BIN-668 route: PLAYER blokkert fra alle tier-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers",
      "pl-tok"
    );
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/leaderboard/tiers",
      "pl-tok",
      { place: 1 }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, [
    makeTier({ id: "t-1", place: 1 }),
  ]);
  try {
    const list = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers",
      "sup-tok"
    );
    assert.equal(list.status, 200);

    const detail = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers/t-1",
      "sup-tok"
    );
    assert.equal(detail.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/leaderboard/tiers",
      "sup-tok",
      { place: 2 }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const patch = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/leaderboard/tiers/t-1",
      "sup-tok",
      { points: 10 }
    );
    assert.equal(patch.status, 400);
    assert.equal(patch.json.error.code, "FORBIDDEN");

    const del = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/leaderboard/tiers/t-1",
      "sup-tok"
    );
    assert.equal(del.status, 400);
    assert.equal(del.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: HALL_OPERATOR kan READ men IKKE WRITE (ADMIN-only)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser }, [
    makeTier({ id: "t-1", place: 1 }),
  ]);
  try {
    const list = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers",
      "op-tok"
    );
    assert.equal(list.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/leaderboard/tiers",
      "op-tok",
      { place: 2 }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: ADMIN kan både READ og WRITE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/leaderboard/tiers",
      "admin-tok",
      { place: 1, points: 100, prizeAmount: 500 }
    );
    assert.equal(post.status, 200);
    assert.equal(post.json.data.place, 1);
    assert.equal(post.json.data.points, 100);
    assert.equal(post.json.data.prizeAmount, 500);
    assert.equal(post.json.data.tierName, "default");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers"
    );
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  } finally {
    await ctx.close();
  }
});

// ── GET list ─────────────────────────────────────────────────────────────────

test("BIN-668 route: GET list returnerer alle (ikke-slettet) tiers uten filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", place: 1, points: 100 }),
    makeTier({ id: "t-2", place: 2, points: 50 }),
    makeTier({
      id: "t-3",
      tierName: "vip",
      place: 1,
      points: 500,
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 3);
    assert.equal(res.json.data.tiers.length, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: GET list med tierName-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", tierName: "default", place: 1 }),
    makeTier({ id: "t-2", tierName: "vip", place: 1 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers?tierName=vip",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.tiers[0].id, "t-2");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: GET list med active-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", place: 1, active: true }),
    makeTier({ id: "t-2", place: 2, active: false }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers?active=false",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.tiers[0].id, "t-2");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: GET list — wire-shape har ingen deletedAt", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", place: 1 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.ok(!("deletedAt" in res.json.data.tiers[0]));
  } finally {
    await ctx.close();
  }
});

// ── GET detail ──────────────────────────────────────────────────────────────

test("BIN-668 route: GET detail 404 på ukjent id", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers/missing",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "LEADERBOARD_TIER_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: GET detail returnerer full row", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({
      id: "t-1",
      place: 1,
      points: 200,
      prizeAmount: 1000,
      prizeDescription: "Gavekort",
      active: true,
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/leaderboard/tiers/t-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "t-1");
    assert.equal(res.json.data.place, 1);
    assert.equal(res.json.data.prizeAmount, 1000);
    assert.equal(res.json.data.prizeDescription, "Gavekort");
  } finally {
    await ctx.close();
  }
});

// ── POST ─────────────────────────────────────────────────────────────────────

test("BIN-668 route: POST oppretter tier + audit-log 'admin.leaderboard.tier.create'", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/leaderboard/tiers",
      "admin-tok",
      {
        tierName: "daily",
        place: 1,
        points: 100,
        prizeAmount: 500,
        prizeDescription: "Gavekort 500 kr",
        active: true,
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.tierName, "daily");
    assert.equal(res.json.data.place, 1);
    assert.equal(res.json.data.prizeAmount, 500);
    assert.equal(ctx.spies.creates.length, 1);

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.leaderboard.tier.create"
    );
    assert.ok(evt, "audit 'admin.leaderboard.tier.create' skal være skrevet");
    assert.equal(evt!.actorId, "admin-1");
    assert.equal(evt!.resource, "leaderboard_tier");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: POST uten place gir INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/leaderboard/tiers",
      "admin-tok",
      { points: 50 }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: POST avviser tom payload", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/leaderboard/tiers",
      "admin-tok",
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: POST duplikat (tierName, place) gir LEADERBOARD_TIER_DUPLICATE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", tierName: "default", place: 1 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/leaderboard/tiers",
      "admin-tok",
      { tierName: "default", place: 1, points: 99 }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "LEADERBOARD_TIER_DUPLICATE");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: POST med prizeAmount=null aksepteres (kun points)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/leaderboard/tiers",
      "admin-tok",
      { place: 5, points: 10, prizeAmount: null }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.prizeAmount, null);
    assert.equal(res.json.data.points, 10);
  } finally {
    await ctx.close();
  }
});

// ── PATCH ────────────────────────────────────────────────────────────────────

test("BIN-668 route: PATCH oppdaterer felter + audit 'admin.leaderboard.tier.update'", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", place: 1, points: 100 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/leaderboard/tiers/t-1",
      "admin-tok",
      { points: 150, prizeAmount: 250 }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.points, 150);
    assert.equal(res.json.data.prizeAmount, 250);
    assert.equal(ctx.spies.updates.length, 1);
    assert.deepEqual(
      ctx.spies.updates[0]!.changed.sort(),
      ["points", "prizeAmount"]
    );

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.leaderboard.tier.update"
    );
    assert.ok(evt);
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: PATCH ukjent id gir NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/leaderboard/tiers/missing",
      "admin-tok",
      { points: 50 }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "LEADERBOARD_TIER_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: PATCH avviser ikke-objekt payload (array)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", place: 1 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/leaderboard/tiers/t-1",
      "admin-tok",
      ["not", "object"]
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: PATCH med active=false deaktiverer uten å slette", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", place: 1, active: true }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/leaderboard/tiers/t-1",
      "admin-tok",
      { active: false }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.active, false);
    // Raden er fortsatt i mapen — ingen soft-delete.
    const still = ctx.tiers.get("t-1");
    assert.ok(still);
    assert.equal(still!.deletedAt, null);
  } finally {
    await ctx.close();
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────

test("BIN-668 route: DELETE default er soft-delete + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", place: 1 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/leaderboard/tiers/t-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);
    assert.equal(ctx.spies.removes[0]!.hard, false);

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.leaderboard.tier.delete"
    );
    assert.ok(evt);
    assert.equal(evt!.details?.softDeleted, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: DELETE ?hard=true gjør hard-delete", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeTier({ id: "t-1", place: 1 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/leaderboard/tiers/t-1?hard=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, false);
    assert.equal(ctx.spies.removes[0]!.hard, true);
    assert.equal(ctx.tiers.has("t-1"), false);

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.leaderboard.tier.delete"
    );
    assert.ok(evt);
    assert.equal(evt!.details?.softDeleted, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-668 route: DELETE ukjent id gir NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/leaderboard/tiers/missing",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "LEADERBOARD_TIER_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});
