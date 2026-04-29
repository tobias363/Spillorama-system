/**
 * PT2+PT3+PT5 — integrasjonstester for adminAgentTicketRanges-router.
 *
 * Dekker alle 6 endepunkter + RBAC + hall-scope + status-koder (200/403/409):
 *   POST /api/admin/physical-tickets/ranges/register              (PT2)
 *   POST /api/admin/physical-tickets/ranges/:id/close             (PT2)
 *   GET  /api/admin/physical-tickets/ranges?agentId=&hallId=      (PT2)
 *   POST /api/admin/physical-tickets/ranges/:id/record-batch-sale (PT3)
 *   POST /api/admin/physical-tickets/ranges/:id/handover          (PT5)
 *   POST /api/admin/physical-tickets/ranges/:id/extend            (PT5)
 *
 * Bygger en stub-AgentTicketRangeService rundt et in-memory Map — samme
 * mønster som adminHallGroups.test.ts / adminStaticTickets.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminAgentTicketRangesRouter } from "../adminAgentTicketRanges.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  AgentTicketRangeService,
  AgentTicketRange,
  RegisterRangeInput,
  RegisterRangeResult,
  RecordBatchSaleInput,
  RecordBatchSaleResult,
  HandoverRangeInput,
  HandoverRangeResult,
  ExtendRangeInput,
  ExtendRangeResult,
} from "../../compliance/AgentTicketRangeService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

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
const operatorA: PublicAppUser = {
  ...adminUser,
  id: "op-a",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const operatorB: PublicAppUser = {
  ...adminUser,
  id: "op-b",
  role: "HALL_OPERATOR",
  hallId: "hall-b",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    registers: RegisterRangeInput[];
    closes: Array<{ id: string; userId: string }>;
    batchSales: RecordBatchSaleInput[];
    handovers: HandoverRangeInput[];
    extends: ExtendRangeInput[];
  };
  ranges: Map<string, AgentTicketRange>;
  close: () => Promise<void>;
}

function makeRange(overrides: Partial<AgentTicketRange> & { id: string; agentId: string; hallId: string }): AgentTicketRange {
  return {
    id: overrides.id,
    agentId: overrides.agentId,
    hallId: overrides.hallId,
    ticketColor: overrides.ticketColor ?? "small",
    initialSerial: overrides.initialSerial ?? "100",
    finalSerial: overrides.finalSerial ?? "91",
    serials: overrides.serials ?? ["100", "99", "98", "97", "96", "95", "94", "93", "92", "91"],
    currentTopSerial: overrides.currentTopSerial ?? "100",
    nextAvailableIndex: overrides.nextAvailableIndex ?? 0,
    registeredAt: overrides.registeredAt ?? "2026-04-22T10:00:00Z",
    closedAt: overrides.closedAt ?? null,
    handoverFromRangeId: overrides.handoverFromRangeId ?? null,
    handedOffToRangeId: overrides.handedOffToRangeId ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: AgentTicketRange[] = [],
  behaviour: {
    registerFail?: DomainError;
    closeFail?: DomainError;
    batchSaleFail?: DomainError;
    batchSaleResult?: Partial<RecordBatchSaleResult>;
    handoverFail?: DomainError;
    handoverResult?: Partial<HandoverRangeResult>;
    extendFail?: DomainError;
    extendResult?: Partial<ExtendRangeResult>;
  } = {},
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const ranges = new Map<string, AgentTicketRange>();
  for (const r of seed) ranges.set(r.id, r);

  const registers: RegisterRangeInput[] = [];
  const closes: Array<{ id: string; userId: string }> = [];
  const batchSales: RecordBatchSaleInput[] = [];
  const handovers: HandoverRangeInput[] = [];
  const extendOps: ExtendRangeInput[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = ranges.size;
  const agentTicketRangeService = {
    async registerRange(input: RegisterRangeInput): Promise<RegisterRangeResult> {
      registers.push(input);
      if (behaviour.registerFail) {
        throw behaviour.registerFail;
      }
      idCounter += 1;
      const id = `range-${idCounter}`;
      const serials: string[] = [];
      // Generer mock-serials DESC fra firstScannedSerial (antatt numerisk).
      const top = parseInt(input.firstScannedSerial, 10);
      for (let i = 0; i < input.count; i += 1) {
        serials.push(String(top - i));
      }
      const r = makeRange({
        id,
        agentId: input.agentId,
        hallId: input.hallId,
        ticketColor: input.ticketColor,
        initialSerial: serials[0]!,
        finalSerial: serials[serials.length - 1]!,
        serials,
        currentTopSerial: serials[0]!,
      });
      ranges.set(id, r);
      return {
        rangeId: id,
        initialTopSerial: r.initialSerial,
        finalSerial: r.finalSerial,
        reservedCount: serials.length,
      };
    },
    async closeRange(rangeId: string, userId: string) {
      closes.push({ id: rangeId, userId });
      if (behaviour.closeFail) {
        throw behaviour.closeFail;
      }
      const r = ranges.get(rangeId);
      if (!r) throw new DomainError("RANGE_NOT_FOUND", "not found");
      if (r.agentId !== userId)
        throw new DomainError("FORBIDDEN", "not owner");
      if (r.closedAt) throw new DomainError("RANGE_ALREADY_CLOSED", "closed");
      const updated = { ...r, closedAt: new Date().toISOString() };
      ranges.set(rangeId, updated);
      return { rangeId, closedAt: updated.closedAt! };
    },
    async getRangeById(rangeId: string) {
      return ranges.get(rangeId) ?? null;
    },
    async listActiveRangesByAgent(agentId: string) {
      return [...ranges.values()].filter((r) => r.agentId === agentId && !r.closedAt);
    },
    async listActiveRangesByHall(hallId: string) {
      return [...ranges.values()].filter((r) => r.hallId === hallId && !r.closedAt);
    },
    async recordBatchSale(input: RecordBatchSaleInput): Promise<RecordBatchSaleResult> {
      batchSales.push(input);
      if (behaviour.batchSaleFail) {
        throw behaviour.batchSaleFail;
      }
      const r = ranges.get(input.rangeId);
      if (!r) throw new DomainError("RANGE_NOT_FOUND", "not found");
      // Emulere oppdatering: flytt top, marker bonger solgt. Returner default
      // eller overstyrbart resultat.
      const previousTopSerial = r.currentTopSerial ?? r.initialSerial;
      // Sett currentTop til newTopSerial.
      ranges.set(r.id, { ...r, currentTopSerial: input.newTopSerial });
      const soldSerials = ["100", "99", "98", "97", "96"]; // default 5-sold
      return {
        rangeId: r.id,
        soldSerials,
        soldCount: soldSerials.length,
        scheduledGameId: input.scheduledGameId ?? "sched-default",
        gameStartTime: "2026-04-22T12:00:00.000Z",
        newTopSerial: input.newTopSerial,
        previousTopSerial,
        ...behaviour.batchSaleResult,
      };
    },
    async handoverRange(input: HandoverRangeInput): Promise<HandoverRangeResult> {
      handovers.push(input);
      if (behaviour.handoverFail) {
        throw behaviour.handoverFail;
      }
      const r = ranges.get(input.fromRangeId);
      if (!r) throw new DomainError("RANGE_NOT_FOUND", "not found");
      idCounter += 1;
      const newRangeId = `range-${idCounter}`;
      const newRange = makeRange({
        id: newRangeId,
        agentId: input.toUserId,
        hallId: r.hallId,
        ticketColor: r.ticketColor,
        initialSerial: r.currentTopSerial ?? r.initialSerial,
        finalSerial: r.finalSerial,
        currentTopSerial: r.currentTopSerial ?? r.initialSerial,
        handoverFromRangeId: r.id,
      });
      ranges.set(newRangeId, newRange);
      ranges.set(r.id, {
        ...r,
        closedAt: new Date().toISOString(),
        handedOffToRangeId: newRangeId,
      });
      return {
        newRangeId,
        fromRangeId: input.fromRangeId,
        unsoldCount: 3,
        soldPendingCount: 2,
        handoverAt: new Date().toISOString(),
        fromUserId: r.agentId,
        toUserId: input.toUserId,
        hallId: r.hallId,
        ticketColor: r.ticketColor,
        newInitialSerial: newRange.initialSerial,
        newFinalSerial: newRange.finalSerial,
        ...behaviour.handoverResult,
      };
    },
    async extendRange(input: ExtendRangeInput): Promise<ExtendRangeResult> {
      extendOps.push(input);
      if (behaviour.extendFail) {
        throw behaviour.extendFail;
      }
      const r = ranges.get(input.rangeId);
      if (!r) throw new DomainError("RANGE_NOT_FOUND", "not found");
      const newSerials: string[] = [];
      const bottom = parseInt(r.finalSerial, 10);
      for (let i = 1; i <= input.additionalCount; i += 1) {
        newSerials.push(String(bottom - i));
      }
      const newFinalSerial = newSerials[newSerials.length - 1]!;
      ranges.set(r.id, {
        ...r,
        serials: [...r.serials, ...newSerials],
        finalSerial: newFinalSerial,
      });
      return {
        rangeId: r.id,
        addedCount: input.additionalCount,
        newFinalSerial,
        newTopOfAddedSerial: newSerials[0]!,
        newSerials,
        totalSerialsAfter: r.serials.length + newSerials.length,
        ...behaviour.extendResult,
      };
    },
  } as unknown as AgentTicketRangeService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminAgentTicketRangesRouter({
      platformService,
      auditLogService,
      agentTicketRangeService,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: {
      auditStore,
      registers,
      closes,
      batchSales,
      handovers,
      extends: extendOps,
    },
    ranges,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
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

// ── RBAC ─────────────────────────────────────────────────────────────────

test("PT2 route: PLAYER får 403 FORBIDDEN på alle endepunkter", async () => {
  const ctx = await startServer({ tok: playerUser });
  try {
    const post = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/ranges/register", "tok", {
      agentId: "pl-1",
      hallId: "hall-a",
      ticketColor: "small",
      firstScannedSerial: "100",
      count: 1,
    });
    assert.equal(post.status, 403);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const get = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/ranges?hallId=hall-a", "tok");
    assert.equal(get.status, 403);
  } finally {
    await ctx.close();
  }
});

test("PT2 route: SUPPORT blokkeres fra PHYSICAL_TICKET_WRITE", async () => {
  const ctx = await startServer({ tok: supportUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/ranges?hallId=hall-a", "tok");
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: ingen token → 403 UNAUTHORIZED", async () => {
  const ctx = await startServer({ adm: adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/ranges/register", undefined, {
      agentId: "op-a",
      hallId: "hall-a",
      ticketColor: "small",
      firstScannedSerial: "100",
      count: 1,
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

// ── registerRange ────────────────────────────────────────────────────────

test("PT2 route: HALL_OPERATOR kan registrere i egen hall — 200", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/register",
      "op-a-tok",
      {
        agentId: "op-a",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 10,
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(res.json.data.rangeId);
    assert.equal(res.json.data.reservedCount, 10);
    assert.equal(res.json.data.initialTopSerial, "100");
    assert.equal(res.json.data.finalSerial, "91");

    // Audit ble skrevet.
    const audit = await waitForAudit(ctx.spies.auditStore, "physical_ticket.range_registered");
    assert.ok(audit);
    assert.equal(audit!.actorId, "op-a");
    assert.equal(audit!.resource, "agent_ticket_range");
    assert.equal((audit!.details as { hallId: string }).hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: HALL_OPERATOR blokkeres fra annen hall — 403", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/register",
      "op-a-tok",
      {
        agentId: "op-a",
        hallId: "hall-b", // feil hall for op-a
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 10,
      },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
    // Service skal IKKE ha blitt kalt.
    assert.equal(ctx.spies.registers.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PT2 route: HALL_OPERATOR kan ikke registrere på annen agent — 403", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/register",
      "op-a-tok",
      {
        agentId: "someone-else",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 10,
      },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: ADMIN kan registrere på vegne av bingovert i annen hall — 200", async () => {
  const ctx = await startServer({ "adm-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/register",
      "adm-tok",
      {
        agentId: "op-b",
        hallId: "hall-b",
        ticketColor: "large",
        firstScannedSerial: "200",
        count: 5,
      },
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.registers.length, 1);
    assert.equal(ctx.spies.registers[0]!.agentId, "op-b");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: TICKET_WRONG_HALL → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [],
    {
      registerFail: new DomainError(
        "TICKET_WRONG_HALL",
        "Bong '100' tilhører ikke hall 'hall-a'.",
      ),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/register",
      "adm-tok",
      {
        agentId: "op-a",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 10,
      },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "TICKET_WRONG_HALL");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: TICKET_WRONG_COLOR → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [],
    {
      registerFail: new DomainError("TICKET_WRONG_COLOR", "farge mismatch"),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/register",
      "adm-tok",
      {
        agentId: "op-a",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 10,
      },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "TICKET_WRONG_COLOR");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: INSUFFICIENT_INVENTORY → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [],
    {
      registerFail: new DomainError(
        "INSUFFICIENT_INVENTORY",
        "for få bonger",
      ),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/register",
      "adm-tok",
      {
        agentId: "op-a",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 1000,
      },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "INSUFFICIENT_INVENTORY");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: INVALID_INPUT (manglende felt) → 400", async () => {
  const ctx = await startServer({ "adm-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/register",
      "adm-tok",
      {
        agentId: "op-a",
        // mangler hallId
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 10,
      },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: ugyldig ticketColor → 400", async () => {
  const ctx = await startServer({ "adm-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/register",
      "adm-tok",
      {
        agentId: "op-a",
        hallId: "hall-a",
        ticketColor: "rainbow",
        firstScannedSerial: "100",
        count: 10,
      },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── closeRange ────────────────────────────────────────────────────────────

test("PT2 route: HALL_OPERATOR kan lukke egen range — 200", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/close",
      "op-a-tok",
      {},
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.rangeId, "r1");
    assert.ok(res.json.data.closedAt);

    const audit = await waitForAudit(ctx.spies.auditStore, "physical_ticket.range_closed");
    assert.ok(audit);
    assert.equal(audit!.actorId, "op-a");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: HALL_OPERATOR får 403 på range i annen hall", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-b", hallId: "hall-b" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/close",
      "op-a-tok",
      {},
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: RANGE_NOT_FOUND → 409", async () => {
  const ctx = await startServer({ "adm-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/nope/close",
      "adm-tok",
      {},
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "RANGE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: ADMIN kan lukke på vegne av bingovert", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-b", hallId: "hall-b" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/close",
      "adm-tok",
      {},
    );
    assert.equal(res.status, 200);
    // Service kalt med userId = range-eieren (op-b), ikke ADMIN-id.
    assert.equal(ctx.spies.closes[0]!.userId, "op-b");
  } finally {
    await ctx.close();
  }
});

// ── list ─────────────────────────────────────────────────────────────────

test("PT2 route: GET ranges?agentId= returnerer åpne ranges", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [
      makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" }),
      makeRange({ id: "r2", agentId: "op-a", hallId: "hall-b" }),
    ],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/physical-tickets/ranges?agentId=op-a",
      "adm-tok",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ranges.length, 2);
  } finally {
    await ctx.close();
  }
});

test("PT2 route: GET ranges?hallId= som HALL_OPERATOR kan kun egen hall", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const ok = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/physical-tickets/ranges?hallId=hall-a",
      "op-a-tok",
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.ranges.length, 1);

    const blocked = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/physical-tickets/ranges?hallId=hall-b",
      "op-a-tok",
    );
    assert.equal(blocked.status, 403);
  } finally {
    await ctx.close();
  }
});

test("PT2 route: GET ranges uten params — HALL_OPERATOR scoped automatisk", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [
      makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" }),
      makeRange({ id: "r2", agentId: "op-b", hallId: "hall-b" }),
    ],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/physical-tickets/ranges",
      "op-a-tok",
    );
    assert.equal(res.status, 200);
    // Automatisk scope til hall-a.
    assert.equal(res.json.data.ranges.length, 1);
    assert.equal(res.json.data.ranges[0].id, "r1");
  } finally {
    await ctx.close();
  }
});

test("PT2 route: GET ranges uten params som ADMIN → 400 (må spesifisere)", async () => {
  const ctx = await startServer({ "adm-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/physical-tickets/ranges",
      "adm-tok",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PT3 — recordBatchSale route
// ══════════════════════════════════════════════════════════════════════════

test("PT3 route: PLAYER får 403 på record-batch-sale", async () => {
  const ctx = await startServer(
    { tok: playerUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "tok",
      { newTopSerial: "95" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.spies.batchSales.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PT3 route: SUPPORT blokkeres fra record-batch-sale", async () => {
  const ctx = await startServer(
    { tok: supportUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "tok",
      { newTopSerial: "95" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PT3 route: ingen token → 403 UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      undefined,
      { newTopSerial: "95" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("PT3 route: HALL_OPERATOR kan registrere batch-salg i egen hall — 200", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "op-a-tok",
      { newTopSerial: "95" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.soldCount, 5);
    assert.equal(res.json.data.newTopSerial, "95");
    assert.equal(res.json.data.previousTopSerial, "100");
    assert.ok(res.json.data.scheduledGameId);
    assert.ok(res.json.data.gameStartTime);

    assert.equal(ctx.spies.batchSales.length, 1);
    assert.equal(ctx.spies.batchSales[0]!.userId, "op-a");
    assert.equal(ctx.spies.batchSales[0]!.adminOverride, false);

    // Audit-log skrevet.
    const audit = await waitForAudit(ctx.spies.auditStore, "physical_ticket.batch_sold");
    assert.ok(audit);
    assert.equal(audit!.actorId, "op-a");
    assert.equal(audit!.resource, "agent_ticket_range");
    assert.equal(audit!.resourceId, "r1");
    const details = audit!.details as {
      rangeId: string;
      soldCount: number;
      fromSerial: string;
      toSerial: string;
      hallId: string;
      scheduledGameId: string;
    };
    assert.equal(details.rangeId, "r1");
    assert.equal(details.soldCount, 5);
    assert.equal(details.hallId, "hall-a");
    assert.ok(details.scheduledGameId);
    assert.equal(details.fromSerial, "100");
    assert.equal(details.toSerial, "96");
  } finally {
    await ctx.close();
  }
});

test("PT3 route: HALL_OPERATOR blokkeres fra annen hall — 403", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-b", hallId: "hall-b" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "op-a-tok",
      { newTopSerial: "95" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
    // Service skal IKKE ha blitt kalt.
    assert.equal(ctx.spies.batchSales.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PT3 route: ADMIN kan registrere batch-salg på vegne av bingovert — 200", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-b", hallId: "hall-b" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "adm-tok",
      { newTopSerial: "95" },
    );
    assert.equal(res.status, 200);
    // Service kalt med effectiveUserId = range-eieren + adminOverride=true.
    assert.equal(ctx.spies.batchSales[0]!.userId, "op-b");
    assert.equal(ctx.spies.batchSales[0]!.adminOverride, true);

    const audit = await waitForAudit(ctx.spies.auditStore, "physical_ticket.batch_sold");
    assert.ok(audit);
    assert.equal(audit!.actorId, "admin-1"); // actor = admin, ikke bingovert
    assert.equal((audit!.details as { onBehalf: boolean }).onBehalf, true);
  } finally {
    await ctx.close();
  }
});

test("PT3 route: RANGE_NOT_FOUND → 409", async () => {
  const ctx = await startServer({ "adm-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/nope/record-batch-sale",
      "adm-tok",
      { newTopSerial: "95" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "RANGE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("PT3 route: NO_TICKETS_SOLD → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
    {
      batchSaleFail: new DomainError(
        "NO_TICKETS_SOLD",
        "newTop er lik current.",
      ),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "adm-tok",
      { newTopSerial: "100" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "NO_TICKETS_SOLD");
  } finally {
    await ctx.close();
  }
});

test("PT3 route: INVALID_NEW_TOP → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
    {
      batchSaleFail: new DomainError(
        "INVALID_NEW_TOP",
        "newTop er høyere.",
      ),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "adm-tok",
      { newTopSerial: "200" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "INVALID_NEW_TOP");
  } finally {
    await ctx.close();
  }
});

test("PT3 route: SERIAL_NOT_IN_RANGE → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
    {
      batchSaleFail: new DomainError(
        "SERIAL_NOT_IN_RANGE",
        "ikke i range.",
      ),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "adm-tok",
      { newTopSerial: "1" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "SERIAL_NOT_IN_RANGE");
  } finally {
    await ctx.close();
  }
});

test("PT3 route: RANGE_ALREADY_CLOSED → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({
      id: "r1",
      agentId: "op-a",
      hallId: "hall-a",
      closedAt: "2026-04-22T11:00:00Z",
    })],
    {
      batchSaleFail: new DomainError("RANGE_ALREADY_CLOSED", "lukket"),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "adm-tok",
      { newTopSerial: "95" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "RANGE_ALREADY_CLOSED");
  } finally {
    await ctx.close();
  }
});

test("PT3 route: NO_UPCOMING_GAME_FOR_HALL → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
    {
      batchSaleFail: new DomainError(
        "NO_UPCOMING_GAME_FOR_HALL",
        "ingen planlagt spill.",
      ),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "adm-tok",
      { newTopSerial: "95" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "NO_UPCOMING_GAME_FOR_HALL");
  } finally {
    await ctx.close();
  }
});

test("PT3 route: manglende newTopSerial → 400 INVALID_INPUT", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "adm-tok",
      {}, // tom body
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
    // Service skal IKKE ha blitt kalt.
    assert.equal(ctx.spies.batchSales.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PT3 route: eksplisitt scheduledGameId videresendes til service", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/record-batch-sale",
      "op-a-tok",
      { newTopSerial: "95", scheduledGameId: "sched-explicit" },
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.batchSales[0]!.scheduledGameId, "sched-explicit");
    assert.equal(res.json.data.scheduledGameId, "sched-explicit");
  } finally {
    await ctx.close();
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PT5 — handover
// ══════════════════════════════════════════════════════════════════════════

test("PT5 route handover: HALL_OPERATOR eier kan utføre handover — 200", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/handover",
      "op-a-tok",
      { toUserId: "op-a-successor" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(res.json.data.newRangeId);
    assert.equal(res.json.data.fromRangeId, "r1");
    assert.equal(res.json.data.toUserId, "op-a-successor");
    assert.equal(res.json.data.unsoldCount, 3);
    assert.equal(res.json.data.soldPendingCount, 2);

    assert.equal(ctx.spies.handovers.length, 1);
    assert.equal(ctx.spies.handovers[0]!.fromRangeId, "r1");
    assert.equal(ctx.spies.handovers[0]!.toUserId, "op-a-successor");
    assert.equal(ctx.spies.handovers[0]!.performedByUserId, "op-a");
    assert.equal(ctx.spies.handovers[0]!.adminOverride, false);

    // Audit-log skrevet.
    const audit = await waitForAudit(
      ctx.spies.auditStore,
      "physical_ticket.range_handover",
    );
    assert.ok(audit);
    assert.equal(audit!.actorId, "op-a");
    assert.equal(audit!.resource, "agent_ticket_range");
    assert.equal(audit!.resourceId, res.json.data.newRangeId);
    const details = audit!.details as {
      fromRangeId: string;
      newRangeId: string;
      fromUserId: string;
      toUserId: string;
      hallId: string;
      unsoldCount: number;
      soldPendingCount: number;
    };
    assert.equal(details.fromRangeId, "r1");
    assert.equal(details.fromUserId, "op-a");
    assert.equal(details.toUserId, "op-a-successor");
    assert.equal(details.hallId, "hall-a");
    assert.equal(details.unsoldCount, 3);
    assert.equal(details.soldPendingCount, 2);
  } finally {
    await ctx.close();
  }
});

test("PT5 route handover: HALL_OPERATOR blokkeres fra annen hall — 403", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-b", hallId: "hall-b" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/handover",
      "op-a-tok",
      { toUserId: "someone" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.spies.handovers.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PT5 route handover: ADMIN kan utføre handover på vegne av bingovert — 200", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-b", hallId: "hall-b" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/handover",
      "adm-tok",
      { toUserId: "op-b-successor" },
    );
    assert.equal(res.status, 200);
    // Service kalt med performedByUserId = range-eier + adminOverride=true.
    assert.equal(ctx.spies.handovers[0]!.performedByUserId, "op-b");
    assert.equal(ctx.spies.handovers[0]!.adminOverride, true);

    const audit = await waitForAudit(
      ctx.spies.auditStore,
      "physical_ticket.range_handover",
    );
    assert.ok(audit);
    assert.equal(audit!.actorId, "admin-1");
    assert.equal((audit!.details as { onBehalf: boolean }).onBehalf, true);
  } finally {
    await ctx.close();
  }
});

test("PT5 route handover: PLAYER får 403 FORBIDDEN", async () => {
  const ctx = await startServer({ tok: playerUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/handover",
      "tok",
      { toUserId: "someone" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PT5 route handover: RANGE_NOT_FOUND → 409", async () => {
  const ctx = await startServer({ "adm-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/nope/handover",
      "adm-tok",
      { toUserId: "someone" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "RANGE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("PT5 route handover: manglende toUserId → 400 INVALID_INPUT", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/handover",
      "adm-tok",
      {}, // tom body
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
    assert.equal(ctx.spies.handovers.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PT5 route handover: HANDOVER_SAME_USER → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
    {
      handoverFail: new DomainError(
        "HANDOVER_SAME_USER",
        "Kan ikke overføre til seg selv.",
      ),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/handover",
      "adm-tok",
      { toUserId: "op-a" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "HANDOVER_SAME_USER");
  } finally {
    await ctx.close();
  }
});

test("PT5 route handover: TARGET_USER_NOT_IN_HALL → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
    {
      handoverFail: new DomainError(
        "TARGET_USER_NOT_IN_HALL",
        "Bruker i annen hall.",
      ),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/handover",
      "adm-tok",
      { toUserId: "someone-else" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "TARGET_USER_NOT_IN_HALL");
  } finally {
    await ctx.close();
  }
});

test("PT5 route handover: RANGE_ALREADY_CLOSED → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({
      id: "r1",
      agentId: "op-a",
      hallId: "hall-a",
      closedAt: "2026-04-22T11:00:00Z",
    })],
    {
      handoverFail: new DomainError("RANGE_ALREADY_CLOSED", "lukket"),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/handover",
      "adm-tok",
      { toUserId: "someone" },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "RANGE_ALREADY_CLOSED");
  } finally {
    await ctx.close();
  }
});

test("PT5 route handover: ingen token → 403 UNAUTHORIZED", async () => {
  const ctx = await startServer({ adm: adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/handover",
      undefined,
      { toUserId: "someone" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PT5 — extend
// ══════════════════════════════════════════════════════════════════════════

test("PT5 route extend: HALL_OPERATOR eier kan utvide — 200", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/extend",
      "op-a-tok",
      { additionalCount: 5 },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.addedCount, 5);
    assert.ok(res.json.data.newFinalSerial);
    assert.equal(res.json.data.newSerials.length, 5);

    assert.equal(ctx.spies.extends.length, 1);
    assert.equal(ctx.spies.extends[0]!.rangeId, "r1");
    assert.equal(ctx.spies.extends[0]!.additionalCount, 5);
    assert.equal(ctx.spies.extends[0]!.performedByUserId, "op-a");
    assert.equal(ctx.spies.extends[0]!.adminOverride, false);

    // Audit-log skrevet.
    const audit = await waitForAudit(
      ctx.spies.auditStore,
      "physical_ticket.range_extended",
    );
    assert.ok(audit);
    assert.equal(audit!.actorId, "op-a");
    assert.equal(audit!.resource, "agent_ticket_range");
    assert.equal(audit!.resourceId, "r1");
    const details = audit!.details as {
      addedCount: number;
      hallId: string;
      agentId: string;
      ticketColor: string;
    };
    assert.equal(details.addedCount, 5);
    assert.equal(details.hallId, "hall-a");
    assert.equal(details.agentId, "op-a");
    assert.equal(details.ticketColor, "small");
  } finally {
    await ctx.close();
  }
});

test("PT5 route extend: HALL_OPERATOR blokkeres fra annen hall — 403", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    [makeRange({ id: "r1", agentId: "op-b", hallId: "hall-b" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/extend",
      "op-a-tok",
      { additionalCount: 5 },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.spies.extends.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PT5 route extend: ADMIN kan utvide på vegne av bingovert — 200", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-b", hallId: "hall-b" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/extend",
      "adm-tok",
      { additionalCount: 3 },
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.extends[0]!.performedByUserId, "op-b");
    assert.equal(ctx.spies.extends[0]!.adminOverride, true);
  } finally {
    await ctx.close();
  }
});

test("PT5 route extend: PLAYER får 403 FORBIDDEN", async () => {
  const ctx = await startServer({ tok: playerUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/extend",
      "tok",
      { additionalCount: 5 },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PT5 route extend: RANGE_NOT_FOUND → 409", async () => {
  const ctx = await startServer({ "adm-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/nope/extend",
      "adm-tok",
      { additionalCount: 5 },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "RANGE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("PT5 route extend: manglende additionalCount → 400 INVALID_INPUT", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/extend",
      "adm-tok",
      {}, // tom body
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
    assert.equal(ctx.spies.extends.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PT5 route extend: negativ additionalCount → 400 INVALID_INPUT", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/extend",
      "adm-tok",
      { additionalCount: -1 },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("PT5 route extend: INSUFFICIENT_INVENTORY → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({ id: "r1", agentId: "op-a", hallId: "hall-a" })],
    {
      extendFail: new DomainError(
        "INSUFFICIENT_INVENTORY",
        "Ikke nok bonger.",
      ),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/extend",
      "adm-tok",
      { additionalCount: 100 },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "INSUFFICIENT_INVENTORY");
  } finally {
    await ctx.close();
  }
});

test("PT5 route extend: RANGE_ALREADY_CLOSED → 409", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    [makeRange({
      id: "r1",
      agentId: "op-a",
      hallId: "hall-a",
      closedAt: "2026-04-22T11:00:00Z",
    })],
    {
      extendFail: new DomainError("RANGE_ALREADY_CLOSED", "lukket"),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/extend",
      "adm-tok",
      { additionalCount: 5 },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "RANGE_ALREADY_CLOSED");
  } finally {
    await ctx.close();
  }
});

test("PT5 route extend: ingen token → 403 UNAUTHORIZED", async () => {
  const ctx = await startServer({ adm: adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/ranges/r1/extend",
      undefined,
      { additionalCount: 5 },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});
