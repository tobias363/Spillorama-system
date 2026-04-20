/**
 * BIN-639: integrasjonstester for bulk reward-all-endepunkt.
 *
 *   POST /api/admin/physical-tickets/reward-all
 *
 * Dekker:
 *   - RBAC (ADMIN + HALL_OPERATOR OK, SUPPORT/PLAYER blokkert)
 *   - Hall-scope: HALL_OPERATOR begrenset til egen hall
 *   - Input-validering: rewards må være array, uniqueId påkrevd, amountCents > 0
 *   - Happy-path med miks av rewarded / skipped
 *   - Tom rewards-array = OK med 0 rewarded
 *   - Audit-log: per-ticket `admin.physical_ticket.reward` + bulk
 *     `admin.physical_ticket.reward_all`
 *   - Duplisert uniqueId i payload avvises
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPhysicalTicketsRewardAllRouter } from "../adminPhysicalTicketsRewardAll.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  PhysicalTicketService,
  PhysicalTicket,
  RewardAllInput,
  RewardAllResult,
} from "../../compliance/PhysicalTicketService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "admin@test.no", displayName: "Admin",
  walletId: "w-admin", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const operatorA: PublicAppUser = { ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" };
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function makeTicket(overrides: Partial<PhysicalTicket> & { uniqueId: string; hallId: string }): PhysicalTicket {
  return {
    id: overrides.id ?? `t-${overrides.uniqueId}`,
    batchId: overrides.batchId ?? "batch-1",
    uniqueId: overrides.uniqueId,
    hallId: overrides.hallId,
    status: overrides.status ?? "SOLD",
    priceCents: overrides.priceCents ?? 5000,
    assignedGameId: overrides.assignedGameId ?? "game-42",
    soldAt: overrides.soldAt ?? "2026-04-20T10:00:00Z",
    soldBy: overrides.soldBy ?? "agent-1",
    buyerUserId: overrides.buyerUserId ?? null,
    voidedAt: overrides.voidedAt ?? null,
    voidedBy: overrides.voidedBy ?? null,
    voidedReason: overrides.voidedReason ?? null,
    createdAt: overrides.createdAt ?? "2026-04-20T08:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-20T10:00:00Z",
    numbersJson: "numbersJson" in overrides ? overrides.numbersJson! : null,
    patternWon: "patternWon" in overrides ? overrides.patternWon! : null,
    wonAmountCents: "wonAmountCents" in overrides ? overrides.wonAmountCents! : null,
    evaluatedAt: "evaluatedAt" in overrides ? overrides.evaluatedAt! : null,
    isWinningDistributed: overrides.isWinningDistributed ?? false,
    winningDistributedAt:
      "winningDistributedAt" in overrides ? overrides.winningDistributedAt! : null,
  };
}

/**
 * Makes a stamped winner ticket (evaluated_at + pattern_won set).
 */
function winnerTicket(uniqueId: string, hallId: string, opts?: Partial<PhysicalTicket>): PhysicalTicket {
  return makeTicket({
    uniqueId,
    hallId,
    evaluatedAt: "2026-04-20T11:00:00Z",
    patternWon: "row_1",
    numbersJson: Array.from({ length: 25 }, (_, i) => i),
    ...opts,
  });
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  rewardAllCalls: RewardAllInput[];
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: { tickets?: PhysicalTicket[]; simulateResult?: (input: RewardAllInput) => RewardAllResult }
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tickets = new Map<string, PhysicalTicket>();
  for (const t of opts?.tickets ?? []) tickets.set(t.uniqueId, t);
  const rewardAllCalls: RewardAllInput[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const distributed = new Set<string>();
  const cashoutIdCounter = { n: 0 };

  const defaultSimulate = (input: RewardAllInput): RewardAllResult => {
    const details: RewardAllResult["details"] = [];
    let rewardedCount = 0;
    let totalPayoutCents = 0;
    let skippedCount = 0;
    for (const r of input.rewards) {
      const ticket = tickets.get(r.uniqueId);
      if (!ticket) {
        details.push({ uniqueId: r.uniqueId, status: "ticket_not_found" });
        skippedCount++;
        continue;
      }
      if (ticket.assignedGameId !== input.gameId) {
        details.push({ uniqueId: r.uniqueId, status: "skipped_wrong_game", hallId: ticket.hallId });
        skippedCount++;
        continue;
      }
      if (ticket.evaluatedAt === null) {
        details.push({ uniqueId: r.uniqueId, status: "skipped_not_stamped", hallId: ticket.hallId });
        skippedCount++;
        continue;
      }
      if (ticket.patternWon === null) {
        details.push({ uniqueId: r.uniqueId, status: "skipped_not_won", hallId: ticket.hallId });
        skippedCount++;
        continue;
      }
      if (ticket.isWinningDistributed || distributed.has(r.uniqueId)) {
        details.push({ uniqueId: r.uniqueId, status: "skipped_already_distributed", hallId: ticket.hallId });
        skippedCount++;
        continue;
      }
      distributed.add(r.uniqueId);
      cashoutIdCounter.n++;
      details.push({
        uniqueId: r.uniqueId,
        status: "rewarded",
        amountCents: r.amountCents,
        cashoutId: `ptcash-${cashoutIdCounter.n}`,
        hallId: ticket.hallId,
      });
      rewardedCount++;
      totalPayoutCents += r.amountCents;
    }
    return { rewardedCount, totalPayoutCents, skippedCount, details };
  };

  const simulate = opts?.simulateResult ?? defaultSimulate;

  const physicalTicketService = {
    async findByUniqueId(uniqueId: string) {
      return tickets.get(uniqueId.trim()) ?? null;
    },
    async rewardAll(input: RewardAllInput): Promise<RewardAllResult> {
      rewardAllCalls.push(input);
      return simulate(input);
    },
  } as unknown as PhysicalTicketService;

  const app = express();
  app.use(express.json());
  app.use(createAdminPhysicalTicketsRewardAllRouter({
    platformService, auditLogService, physicalTicketService,
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auditStore,
    rewardAllCalls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForAudit(
  store: InMemoryAuditLogStore,
  action: string,
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

async function listAudits(
  store: InMemoryAuditLogStore,
  action: string,
): Promise<PersistedAuditEvent[]> {
  // Gi bulk + per-ticket audit-events sjans til å lande
  await new Promise((r) => setTimeout(r, 30));
  const events = await store.list();
  return events.filter((e) => e.action === action);
}

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-639: POST reward-all — SUPPORT blokkert (PHYSICAL_TICKET_WRITE)", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "sup-tok", {
      gameId: "game-42",
      rewards: [{ uniqueId: "100", amountCents: 5000 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.rewardAllCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — PLAYER blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "pl-tok", {
      gameId: "game-42",
      rewards: [],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — ADMIN happy path med 3 tickets (2 rewarded, 1 skipped)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [
      winnerTicket("100", "hall-a"),
      makeTicket({
        uniqueId: "101", hallId: "hall-a",
        evaluatedAt: null,  // ikke-stemplet
      }),
      winnerTicket("102", "hall-a", { patternWon: "full_house" }),
    ],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [
        { uniqueId: "100", amountCents: 5000 },
        { uniqueId: "101", amountCents: 5000 },
        { uniqueId: "102", amountCents: 50000 },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.rewardedCount, 2);
    assert.equal(res.json.data.skippedCount, 1);
    assert.equal(res.json.data.totalPayoutCents, 55000);
    assert.equal(res.json.data.details.length, 3);
    assert.equal(res.json.data.details[0].status, "rewarded");
    assert.equal(res.json.data.details[1].status, "skipped_not_stamped");
    assert.equal(res.json.data.details[2].status, "rewarded");

    // Per-ticket audit for 2 rewarded
    const perTicketEvents = await listAudits(ctx.auditStore, "admin.physical_ticket.reward");
    assert.equal(perTicketEvents.length, 2);
    const uniqueIds = perTicketEvents.map((e) => e.resourceId).sort();
    assert.deepEqual(uniqueIds, ["100", "102"]);
    assert.equal(perTicketEvents[0]!.actorType, "ADMIN");
    assert.equal(perTicketEvents[0]!.details.gameId, "game-42");
    assert.ok(perTicketEvents[0]!.details.cashoutId);

    // Bulk audit-event
    const bulkEvent = await waitForAudit(ctx.auditStore, "admin.physical_ticket.reward_all");
    assert.ok(bulkEvent);
    assert.equal(bulkEvent!.resource, "game");
    assert.equal(bulkEvent!.resourceId, "game-42");
    assert.equal(bulkEvent!.details.rewardedCount, 2);
    assert.equal(bulkEvent!.details.skippedCount, 1);
    assert.equal(bulkEvent!.details.totalPayoutCents, 55000);
    assert.equal(bulkEvent!.details.actor, "admin-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — HALL_OPERATOR kan utbetale egen halls billetter", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA }, {
    tickets: [winnerTicket("100", "hall-a")],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "op-a-tok", {
      gameId: "game-42",
      rewards: [{ uniqueId: "100", amountCents: 5000 }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.rewardedCount, 1);
    const bulk = await waitForAudit(ctx.auditStore, "admin.physical_ticket.reward_all");
    assert.ok(bulk);
    assert.equal(bulk!.actorType, "HALL_OPERATOR");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — HALL_OPERATOR blokkert fra annen halls billett", async () => {
  // op-a sender ticket som tilhører hall-b
  const ctx = await startServer({ "op-a-tok": operatorA }, {
    tickets: [winnerTicket("200", "hall-b")],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "op-a-tok", {
      gameId: "game-42",
      rewards: [{ uniqueId: "200", amountCents: 5000 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    // rewardAll skal ikke ha blitt kalt (pre-sjekk fanger scope)
    assert.equal(ctx.rewardAllCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — tom rewards-array returnerer OK med 0 rewarded", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.rewardedCount, 0);
    assert.equal(res.json.data.skippedCount, 0);
    assert.equal(res.json.data.totalPayoutCents, 0);
    assert.equal(res.json.data.details.length, 0);
    // Bulk-event skal fortsatt skrives (spor også "no-op"-distribusjoner)
    const bulk = await waitForAudit(ctx.auditStore, "admin.physical_ticket.reward_all");
    assert.ok(bulk);
    assert.equal(bulk!.details.rewardedCount, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — manglende gameId gir INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      rewards: [],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — rewards må være array", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: "not-an-array",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — reward-entry uten uniqueId avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [{ amountCents: 5000 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — reward-entry med amountCents ≤ 0 avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [{ uniqueId: "100", amountCents: 0 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");

    const negative = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [{ uniqueId: "100", amountCents: -100 }],
    });
    assert.equal(negative.status, 400);
    assert.equal(negative.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — duplisert uniqueId i payload avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [
        { uniqueId: "100", amountCents: 5000 },
        { uniqueId: "100", amountCents: 10000 },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
    assert.match(res.json.error.message, /duplisert/);
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — array-payload (ikke objekt) avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", [1, 2, 3] as any);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — idempotens: andre kall skipper alle", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [
      winnerTicket("100", "hall-a"),
      winnerTicket("101", "hall-a", { patternWon: "full_house" }),
    ],
  });
  try {
    const first = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [
        { uniqueId: "100", amountCents: 5000 },
        { uniqueId: "101", amountCents: 50000 },
      ],
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.data.rewardedCount, 2);

    const second = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [
        { uniqueId: "100", amountCents: 5000 },
        { uniqueId: "101", amountCents: 50000 },
      ],
    });
    assert.equal(second.status, 200);
    assert.equal(second.json.data.rewardedCount, 0);
    assert.equal(second.json.data.skippedCount, 2);
    assert.equal(second.json.data.details[0].status, "skipped_already_distributed");
    assert.equal(second.json.data.details[1].status, "skipped_already_distributed");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — per-ticket audit inneholder hallId + cashoutId", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [winnerTicket("100", "hall-a", { patternWon: "full_house" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [{ uniqueId: "100", amountCents: 50000 }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.rewardedCount, 1);

    const perTicketEvents = await listAudits(ctx.auditStore, "admin.physical_ticket.reward");
    assert.equal(perTicketEvents.length, 1);
    const ev = perTicketEvents[0]!;
    assert.equal(ev.resource, "physical_ticket");
    assert.equal(ev.resourceId, "100");
    assert.equal(ev.details.uniqueId, "100");
    assert.equal(ev.details.gameId, "game-42");
    assert.equal(ev.details.hallId, "hall-a");
    assert.equal(ev.details.payoutCents, 50000);
    assert.ok(ev.details.cashoutId);
    assert.equal(ev.details.actor, "admin-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-639: POST reward-all — skippede tickets IKKE skriver per-ticket audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [
      makeTicket({ uniqueId: "100", hallId: "hall-a", evaluatedAt: null }),  // ikke-stemplet
    ],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/reward-all", "admin-tok", {
      gameId: "game-42",
      rewards: [{ uniqueId: "100", amountCents: 5000 }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.skippedCount, 1);
    const perTicketEvents = await listAudits(ctx.auditStore, "admin.physical_ticket.reward");
    assert.equal(perTicketEvents.length, 0);
    // Men bulk-event skrives uansett
    const bulk = await waitForAudit(ctx.auditStore, "admin.physical_ticket.reward_all");
    assert.ok(bulk);
    assert.equal(bulk!.details.skippedCount, 1);
  } finally {
    await ctx.close();
  }
});
