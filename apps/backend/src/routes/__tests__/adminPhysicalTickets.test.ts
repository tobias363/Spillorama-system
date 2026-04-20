/**
 * BIN-587 B4a: integrasjonstester for admin-physical-tickets-router.
 *
 * Dekker RBAC (ADMIN + HALL_OPERATOR, ikke SUPPORT/PLAYER), hall-scope
 * (HALL_OPERATOR begrenset til egen hall), audit-logging, batch state-
 * maskin, delete-avvisning hvis SOLD.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPhysicalTicketsRouter } from "../adminPhysicalTickets.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  PhysicalTicketService,
  PhysicalTicketBatch,
  PhysicalTicket,
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
const operatorB: PublicAppUser = { ...adminUser, id: "op-b", role: "HALL_OPERATOR", hallId: "hall-b" };
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    createCalls: Array<{ hallId: string; batchName: string; rangeStart: number; rangeEnd: number }>;
    updateCalls: Array<{ id: string; changed: string[] }>;
    deleteCalls: string[];
    generateCalls: string[];
    assignCalls: Array<{ batchId: string; gameId: string }>;
    voidCalls: Array<{ gameId: string; reason: string }>;
  };
  batches: Map<string, PhysicalTicketBatch>;
  close: () => Promise<void>;
}

function makeBatch(overrides: Partial<PhysicalTicketBatch> & { id: string; hallId: string }): PhysicalTicketBatch {
  return {
    id: overrides.id,
    hallId: overrides.hallId,
    batchName: overrides.batchName ?? `batch-${overrides.id}`,
    rangeStart: overrides.rangeStart ?? 1,
    rangeEnd: overrides.rangeEnd ?? 100,
    defaultPriceCents: overrides.defaultPriceCents ?? 5000,
    gameSlug: overrides.gameSlug ?? null,
    assignedGameId: overrides.assignedGameId ?? null,
    status: overrides.status ?? "DRAFT",
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: { seedBatches?: PhysicalTicketBatch[]; seedTickets?: PhysicalTicket[] }
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const batches = new Map<string, PhysicalTicketBatch>();
  for (const b of opts?.seedBatches ?? []) batches.set(b.id, b);
  const tickets = opts?.seedTickets ?? [];

  const createCalls: Ctx["spies"]["createCalls"] = [];
  const updateCalls: Ctx["spies"]["updateCalls"] = [];
  const deleteCalls: string[] = [];
  const generateCalls: string[] = [];
  const assignCalls: Ctx["spies"]["assignCalls"] = [];
  const voidCalls: Ctx["spies"]["voidCalls"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const physicalTicketService = {
    async listBatches(filter: { hallId?: string; limit?: number }) {
      let list = [...batches.values()];
      if (filter.hallId) list = list.filter((b) => b.hallId === filter.hallId);
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async getBatch(id: string) {
      const b = batches.get(id);
      if (!b) throw new DomainError("PHYSICAL_BATCH_NOT_FOUND", "not found");
      return b;
    },
    async createBatch(input: { hallId: string; batchName: string; rangeStart: number; rangeEnd: number; defaultPriceCents: number; createdBy: string; gameSlug?: string | null; assignedGameId?: string | null }) {
      createCalls.push({ hallId: input.hallId, batchName: input.batchName, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd });
      const id = `b-${batches.size + 1}`;
      const b = makeBatch({
        id, hallId: input.hallId, batchName: input.batchName,
        rangeStart: input.rangeStart, rangeEnd: input.rangeEnd,
        defaultPriceCents: input.defaultPriceCents,
        gameSlug: input.gameSlug ?? null, assignedGameId: input.assignedGameId ?? null,
        createdBy: input.createdBy,
      });
      batches.set(id, b);
      return b;
    },
    async updateBatch(id: string, update: Record<string, unknown>) {
      const b = batches.get(id);
      if (!b) throw new DomainError("PHYSICAL_BATCH_NOT_FOUND", "not found");
      updateCalls.push({ id, changed: Object.keys(update) });
      const updated = { ...b };
      if (typeof update.batchName === "string") updated.batchName = update.batchName;
      if (typeof update.defaultPriceCents === "number") updated.defaultPriceCents = update.defaultPriceCents;
      if (update.assignedGameId !== undefined) updated.assignedGameId = update.assignedGameId as string | null;
      if (typeof update.status === "string") updated.status = update.status as PhysicalTicketBatch["status"];
      batches.set(id, updated);
      return updated;
    },
    async deleteBatch(id: string) {
      const b = batches.get(id);
      if (!b) throw new DomainError("PHYSICAL_BATCH_NOT_FOUND", "not found");
      deleteCalls.push(id);
      batches.delete(id);
    },
    async generateTickets(batchId: string) {
      const b = batches.get(batchId);
      if (!b) throw new DomainError("PHYSICAL_BATCH_NOT_FOUND", "not found");
      generateCalls.push(batchId);
      batches.set(batchId, { ...b, status: "ACTIVE" });
      return {
        batchId,
        generated: b.rangeEnd - b.rangeStart + 1,
        firstUniqueId: String(b.rangeStart),
        lastUniqueId: String(b.rangeEnd),
      };
    },
    async assignBatchToGame(batchId: string, gameId: string) {
      const b = batches.get(batchId);
      if (!b) throw new DomainError("PHYSICAL_BATCH_NOT_FOUND", "not found");
      assignCalls.push({ batchId, gameId });
      const updated = { ...b, assignedGameId: gameId };
      batches.set(batchId, updated);
      return updated;
    },
    async listSoldTicketsForGame(gameId: string) {
      return tickets.filter((t) => t.assignedGameId === gameId && t.status === "SOLD");
    },
    async voidAllSoldTicketsForGame(input: { gameId: string; reason: string; actorId: string }) {
      voidCalls.push({ gameId: input.gameId, reason: input.reason });
      return { voided: 2 };
    },
    async getLastRegisteredUniqueId(hallId: string) {
      return { hallId, lastUniqueId: null, maxRangeEnd: null };
    },
  } as unknown as PhysicalTicketService;

  const app = express();
  app.use(express.json());
  app.use(createAdminPhysicalTicketsRouter({ platformService, auditLogService, physicalTicketService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, createCalls, updateCalls, deleteCalls, generateCalls, assignCalls, voidCalls },
    batches,
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

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-587 B4a: SUPPORT + PLAYER blokkert fra alle physical-ticket-endepunkter", async () => {
  const ctx = await startServer({ "sup-tok": supportUser, "pl-tok": playerUser });
  try {
    for (const token of ["sup-tok", "pl-tok"]) {
      const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/batches", token);
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: HALL_OPERATOR (hall-a) kan liste og opprette batch i Hall A", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/batches", "op-a-tok");
    assert.equal(list.status, 200);
    assert.equal(list.json.data.count, 0);

    const create = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/batches", "op-a-tok", {
      hallId: "hall-a",
      batchName: "Q2-start",
      rangeStart: 1,
      rangeEnd: 100,
      defaultPriceCents: 5000,
    });
    assert.equal(create.status, 200);
    assert.equal(create.json.data.hallId, "hall-a");
    assert.equal(ctx.spies.createCalls[0]!.hallId, "hall-a");

    const event = await waitForAudit(ctx.spies.auditStore, "physical_ticket.batch.create");
    assert.ok(event);
    assert.equal(event!.actorType, "HALL_OPERATOR");
    assert.equal(event!.details.rangeSize, 100);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: HALL_OPERATOR (hall-a) kan IKKE opprette batch i Hall B (hall-scope)", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/batches", "op-a-tok", {
      hallId: "hall-b",
      batchName: "x",
      rangeStart: 1,
      rangeEnd: 10,
      defaultPriceCents: 100,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.spies.createCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: HALL_OPERATOR list filtreres automatisk til egen hall", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    { seedBatches: [
      makeBatch({ id: "b-a", hallId: "hall-a" }),
      makeBatch({ id: "b-b", hallId: "hall-b" }),
    ] }
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/batches", "op-a-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.batches[0].hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: HALL_OPERATOR kan IKKE se batch-detalj i annen hall", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    { seedBatches: [makeBatch({ id: "b-b", hallId: "hall-b" })] }
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/batches/b-b", "op-a-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: ADMIN kan se batches på tvers av haller", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { seedBatches: [
      makeBatch({ id: "b-a", hallId: "hall-a" }),
      makeBatch({ id: "b-b", hallId: "hall-b" }),
    ] }
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/batches", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: PUT batch krever hall-scope + audit logger changed-felter", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA, "op-b-tok": operatorB },
    { seedBatches: [makeBatch({ id: "b-a", hallId: "hall-a" })] }
  );
  try {
    // operatør-B kan ikke endre operatør-A sin batch
    const blocked = await req(ctx.baseUrl, "PUT", "/api/admin/physical-tickets/batches/b-a", "op-b-tok", {
      defaultPriceCents: 10000,
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.json.error.code, "FORBIDDEN");

    // operatør-A kan
    const ok = await req(ctx.baseUrl, "PUT", "/api/admin/physical-tickets/batches/b-a", "op-a-tok", {
      defaultPriceCents: 10000,
      status: "ACTIVE",
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ctx.spies.updateCalls[0]!.changed.sort(), ["defaultPriceCents", "status"]);

    const event = await waitForAudit(ctx.spies.auditStore, "physical_ticket.batch.update");
    assert.ok(event);
    assert.deepEqual((event!.details.changed as string[]).sort(), ["defaultPriceCents", "status"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: DELETE batch logger audit + hall-scope enforce", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    { seedBatches: [makeBatch({ id: "b-a", hallId: "hall-a" })] }
  );
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/physical-tickets/batches/b-a", "op-a-tok");
    assert.equal(res.status, 200);
    assert.deepEqual(ctx.spies.deleteCalls, ["b-a"]);
    const event = await waitForAudit(ctx.spies.auditStore, "physical_ticket.batch.delete");
    assert.ok(event);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: POST generate går DRAFT → ACTIVE + audit logger counts", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { seedBatches: [makeBatch({ id: "b-1", hallId: "hall-a", rangeStart: 1, rangeEnd: 10 })] }
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/batches/b-1/generate", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.generated, 10);
    assert.equal(res.json.data.firstUniqueId, "1");
    assert.equal(res.json.data.lastUniqueId, "10");
    assert.deepEqual(ctx.spies.generateCalls, ["b-1"]);

    const event = await waitForAudit(ctx.spies.auditStore, "physical_ticket.batch.generate");
    assert.ok(event);
    assert.equal(event!.details.generated, 10);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: POST assign-game krever gameId + audit", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { seedBatches: [makeBatch({ id: "b-1", hallId: "hall-a" })] }
  );
  try {
    const missing = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/batches/b-1/assign-game", "admin-tok", {});
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, "INVALID_INPUT");

    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/batches/b-1/assign-game", "admin-tok", {
      gameId: "game-42",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.assignedGameId, "game-42");
    assert.deepEqual(ctx.spies.assignCalls[0], { batchId: "b-1", gameId: "game-42" });

    const event = await waitForAudit(ctx.spies.auditStore, "physical_ticket.batch.assign_game");
    assert.ok(event);
    assert.equal(event!.details.gameId, "game-42");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: GET games/:gameId/sold returnerer solgte billetter", async () => {
  const soldTicket: PhysicalTicket = {
    id: "t-1", batchId: "b-1", uniqueId: "42", hallId: "hall-a",
    status: "SOLD", priceCents: 5000, assignedGameId: "game-1",
    soldAt: "2026-04-18T12:00:00Z", soldBy: "agent-1",
    buyerUserId: "player-1", voidedAt: null, voidedBy: null, voidedReason: null,
    createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T12:00:00Z",
    // BIN-698: win-data defaults (ikke stemplet)
    numbersJson: null, patternWon: null, wonAmountCents: null,
    evaluatedAt: null, isWinningDistributed: false, winningDistributedAt: null,
  };
  const ctx = await startServer({ "admin-tok": adminUser }, { seedTickets: [soldTicket] });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/games/game-1/sold", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.tickets[0].uniqueId, "42");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: DELETE games/:gameId/sold krever reason + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const missingReason = await req(ctx.baseUrl, "DELETE", "/api/admin/physical-tickets/games/game-1/sold", "admin-tok", {});
    assert.equal(missingReason.status, 400);
    assert.equal(missingReason.json.error.code, "INVALID_INPUT");

    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/physical-tickets/games/game-1/sold", "admin-tok", {
      reason: "Spill kansellert pga teknisk feil",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.voided, 2);
    assert.equal(ctx.spies.voidCalls[0]!.reason, "Spill kansellert pga teknisk feil");

    const event = await waitForAudit(ctx.spies.auditStore, "physical_ticket.game.void_all");
    assert.ok(event);
    assert.equal(event!.details.voided, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: GET last-registered-id krever hallId + hall-scope", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const missing = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/last-registered-id", "op-a-tok");
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, "INVALID_INPUT");

    // Hall B — annen hall, blokkert
    const wrongHall = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/last-registered-id?hallId=hall-b", "op-a-tok");
    assert.equal(wrongHall.status, 400);
    assert.equal(wrongHall.json.error.code, "FORBIDDEN");

    // Egen hall — OK
    const ok = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/last-registered-id?hallId=hall-a", "op-a-tok");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4a: POST batches validerer required fields", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const noBody = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/batches", "admin-tok", null);
    assert.equal(noBody.status, 400);

    const missing = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/batches", "admin-tok", {
      hallId: "hall-a",
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
