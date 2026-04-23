/**
 * Agent IJ — integrasjonstester for admin-game1-pots-router.
 *
 * Dekker alle 5 endepunktene:
 *   GET    /api/admin/halls/:hallId/game1-pots
 *   GET    /api/admin/halls/:hallId/game1-pots/:potKey
 *   POST   /api/admin/halls/:hallId/game1-pots              (init)
 *   PATCH  /api/admin/halls/:hallId/game1-pots/:potKey/config
 *   POST   /api/admin/halls/:hallId/game1-pots/:potKey/reset
 *
 * Stubber Game1PotService med in-memory Map (samme pattern som
 * adminSchedules.test.ts).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGame1PotsRouter } from "../adminGame1Pots.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  Game1PotService,
  PotConfig,
  PotRow,
  GetOrInitPotInput,
  UpdateConfigInput,
  ResetPotInput,
} from "../../game/pot/Game1PotService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
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
const hallAOperator: PublicAppUser = {
  ...adminUser,
  id: "op-a",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const hallBOperator: PublicAppUser = {
  ...adminUser,
  id: "op-b",
  role: "HALL_OPERATOR",
  hallId: "hall-b",
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function innsatsenConfig(overrides: Partial<PotConfig> = {}): PotConfig {
  return {
    seedAmountCents: 500_00,
    dailyBoostCents: 0,
    salePercentBps: 2000,
    maxAmountCents: null,
    winRule: { kind: "phase_at_or_before_draw", phase: 5, drawThreshold: 58 },
    ticketColors: [],
    potType: "innsatsen",
    drawThresholdLower: 56,
    targetAmountCents: 2000_00,
    ...overrides,
  };
}

function makePotRow(overrides: Partial<PotRow> = {}): PotRow {
  return {
    id: overrides.id ?? "pot-1",
    hallId: overrides.hallId ?? "hall-a",
    potKey: overrides.potKey ?? "innsatsen",
    displayName: overrides.displayName ?? "Innsatsen",
    currentAmountCents: overrides.currentAmountCents ?? 500_00,
    config: overrides.config ?? innsatsenConfig(),
    lastDailyBoostDate: overrides.lastDailyBoostDate ?? null,
    lastResetAt: overrides.lastResetAt ?? null,
    lastResetReason: overrides.lastResetReason ?? null,
    createdAt: overrides.createdAt ?? "2026-04-22T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-22T10:00:00Z",
  };
}

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    inits: GetOrInitPotInput[];
    updates: UpdateConfigInput[];
    resets: ResetPotInput[];
  };
  entries: Map<string, PotRow>;
  close: () => Promise<void>;
}

function potsKey(hallId: string, potKey: string): string {
  return `${hallId}::${potKey}`;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: PotRow[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const entries = new Map<string, PotRow>();
  for (const p of seed) entries.set(potsKey(p.hallId, p.potKey), p);

  const inits: GetOrInitPotInput[] = [];
  const updates: UpdateConfigInput[] = [];
  const resets: ResetPotInput[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const potService = {
    async listPotsForHall(hallId: string): Promise<PotRow[]> {
      return Array.from(entries.values()).filter((p) => p.hallId === hallId);
    },
    async loadPot(hallId: string, potKey: string): Promise<PotRow | null> {
      return entries.get(potsKey(hallId, potKey)) ?? null;
    },
    async getOrInitPot(input: GetOrInitPotInput): Promise<PotRow> {
      inits.push(input);
      const key = potsKey(input.hallId, input.potKey);
      const existing = entries.get(key);
      if (existing) return existing;
      const row = makePotRow({
        id: `pot-${entries.size + 1}`,
        hallId: input.hallId,
        potKey: input.potKey,
        displayName: input.displayName,
        currentAmountCents: input.config.seedAmountCents,
        config: input.config,
      });
      entries.set(key, row);
      return row;
    },
    async updateConfig(input: UpdateConfigInput): Promise<PotRow> {
      updates.push(input);
      const key = potsKey(input.hallId, input.potKey);
      const existing = entries.get(key);
      if (!existing) {
        throw new DomainError("POT_NOT_FOUND", "Pot ikke funnet");
      }
      const updated: PotRow = { ...existing, config: input.config };
      entries.set(key, updated);
      return updated;
    },
    async resetPot(input: ResetPotInput) {
      resets.push(input);
      const key = potsKey(input.hallId, input.potKey);
      const existing = entries.get(key);
      if (!existing) {
        throw new DomainError("POT_NOT_FOUND", "Pot ikke funnet");
      }
      const updated: PotRow = {
        ...existing,
        currentAmountCents: existing.config.seedAmountCents,
      };
      entries.set(key, updated);
      return {
        newBalanceCents: existing.config.seedAmountCents,
        eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
      };
    },
  } as unknown as Game1PotService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGame1PotsRouter({
      platformService,
      auditLogService,
      potService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    spies: { auditStore, inits, updates, resets },
    entries,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function req(
  ctx: Ctx,
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// ── Read: list ─────────────────────────────────────────────────────────

test("GET list — ADMIN ser alle pot-er i hallen", async () => {
  const ctx = await startServer(
    { "admin-token": adminUser },
    [makePotRow({ id: "p1", potKey: "innsatsen" }), makePotRow({ id: "p2", potKey: "jackpott" })]
  );
  try {
    const res = await req(ctx, "GET", "/api/admin/halls/hall-a/game1-pots", "admin-token");
    assert.equal(res.status, 200);
    const body = res.json as { data: { pots: PotRow[]; count: number } };
    assert.equal(body.data.count, 2);
  } finally {
    await ctx.close();
  }
});

test("GET list — PLAYER blokkeres med FORBIDDEN", async () => {
  const ctx = await startServer({ "player-token": playerUser });
  try {
    const res = await req(ctx, "GET", "/api/admin/halls/hall-a/game1-pots", "player-token");
    assert.equal(res.status, 400);
    const body = res.json as { error?: { code?: string } };
    assert.equal(body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET list — HALL_OPERATOR for annen hall blokkeres med FORBIDDEN", async () => {
  const ctx = await startServer({ "op-b-token": hallBOperator });
  try {
    const res = await req(ctx, "GET", "/api/admin/halls/hall-a/game1-pots", "op-b-token");
    assert.equal(res.status, 400);
    const body = res.json as { error?: { code?: string } };
    assert.equal(body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── Read: detail ───────────────────────────────────────────────────────

test("GET detail — SUPPORT kan lese pot-detalj", async () => {
  const ctx = await startServer(
    { "sup-token": supportUser },
    [makePotRow({ id: "p1", potKey: "innsatsen" })]
  );
  try {
    const res = await req(ctx, "GET", "/api/admin/halls/hall-a/game1-pots/innsatsen", "sup-token");
    assert.equal(res.status, 200);
    const body = res.json as { data: PotRow };
    assert.equal(body.data.potKey, "innsatsen");
  } finally {
    await ctx.close();
  }
});

test("GET detail — 400 når pot ikke finnes", async () => {
  const ctx = await startServer({ "admin-token": adminUser });
  try {
    const res = await req(ctx, "GET", "/api/admin/halls/hall-a/game1-pots/missing", "admin-token");
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── Create/init ────────────────────────────────────────────────────────

test("POST init — ADMIN kan opprette ny pot", async () => {
  const ctx = await startServer({ "admin-token": adminUser });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/halls/hall-a/game1-pots",
      "admin-token",
      {
        potKey: "innsatsen",
        displayName: "Innsatsen",
        config: innsatsenConfig(),
      }
    );
    assert.equal(res.status, 200);
    const body = res.json as { data: PotRow };
    assert.equal(body.data.potKey, "innsatsen");
    assert.equal(body.data.config.potType, "innsatsen");
    assert.equal(body.data.config.drawThresholdLower, 56);
    assert.equal(body.data.config.targetAmountCents, 2000_00);
    assert.equal(ctx.spies.inits.length, 1);
    // Audit-entry
    const events = await ctx.spies.auditStore.list({
      action: "admin.game1_pot.init",
    });
    assert.equal(events.length, 1);
  } finally {
    await ctx.close();
  }
});

test("POST init — HALL_OPERATOR kan opprette pot i egen hall", async () => {
  const ctx = await startServer({ "op-a-token": hallAOperator });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/halls/hall-a/game1-pots",
      "op-a-token",
      {
        potKey: "innsatsen",
        displayName: "Innsatsen",
        config: innsatsenConfig(),
      }
    );
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("POST init — payload uten potKey → 400", async () => {
  const ctx = await startServer({ "admin-token": adminUser });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/halls/hall-a/game1-pots",
      "admin-token",
      { displayName: "x", config: innsatsenConfig() }
    );
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── Update config ──────────────────────────────────────────────────────

test("PATCH config — oppdaterer drawThreshold", async () => {
  const ctx = await startServer(
    { "admin-token": adminUser },
    [makePotRow({ id: "p1", potKey: "innsatsen" })]
  );
  try {
    const newCfg = innsatsenConfig({
      winRule: { kind: "phase_at_or_before_draw", phase: 5, drawThreshold: 60 },
    });
    const res = await req(
      ctx,
      "PATCH",
      "/api/admin/halls/hall-a/game1-pots/innsatsen/config",
      "admin-token",
      { config: newCfg }
    );
    assert.equal(res.status, 200);
    const body = res.json as { data: PotRow };
    assert.equal(
      (body.data.config.winRule as { drawThreshold: number }).drawThreshold,
      60
    );
    assert.equal(ctx.spies.updates.length, 1);
    const events = await ctx.spies.auditStore.list({
      action: "admin.game1_pot.config_update",
    });
    assert.equal(events.length, 1);
  } finally {
    await ctx.close();
  }
});

test("PATCH config — drawThreshold > 75 → 400", async () => {
  const ctx = await startServer(
    { "admin-token": adminUser },
    [makePotRow({ id: "p1", potKey: "innsatsen" })]
  );
  try {
    const res = await req(
      ctx,
      "PATCH",
      "/api/admin/halls/hall-a/game1-pots/innsatsen/config",
      "admin-token",
      {
        config: innsatsenConfig({
          winRule: { kind: "phase_at_or_before_draw", phase: 5, drawThreshold: 76 },
        }),
      }
    );
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── Reset ──────────────────────────────────────────────────────────────

test("POST reset — med reason kjører reset og skriver audit", async () => {
  const ctx = await startServer(
    { "admin-token": adminUser },
    [makePotRow({ id: "p1", potKey: "innsatsen", currentAmountCents: 9999_00 })]
  );
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/halls/hall-a/game1-pots/innsatsen/reset",
      "admin-token",
      { reason: "manuell admin-rydd" }
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.resets.length, 1);
    assert.equal(ctx.spies.resets[0]!.reason, "manuell admin-rydd");
    assert.equal(ctx.spies.resets[0]!.actorUserId, "admin-1");
    const events = await ctx.spies.auditStore.list({
      action: "admin.game1_pot.reset",
    });
    assert.equal(events.length, 1);
  } finally {
    await ctx.close();
  }
});

test("POST reset — tom reason → 400", async () => {
  const ctx = await startServer(
    { "admin-token": adminUser },
    [makePotRow({ id: "p1", potKey: "innsatsen" })]
  );
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/halls/hall-a/game1-pots/innsatsen/reset",
      "admin-token",
      {}
    );
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

test("POST reset — SUPPORT-rolle blokkeres (ikke WRITE-permission)", async () => {
  const ctx = await startServer(
    { "sup-token": supportUser },
    [makePotRow({ id: "p1", potKey: "innsatsen" })]
  );
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/halls/hall-a/game1-pots/innsatsen/reset",
      "sup-token",
      { reason: "test" }
    );
    assert.equal(res.status, 400);
    const body = res.json as { error?: { code?: string } };
    assert.equal(body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});
