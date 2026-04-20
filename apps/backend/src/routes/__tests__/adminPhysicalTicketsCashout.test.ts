/**
 * BIN-640: integrasjonstester for single-ticket cashout-endepunkt.
 *
 *   POST /api/admin/physical-tickets/:uniqueId/cashout
 *   GET  /api/admin/physical-tickets/:uniqueId/cashout
 *
 * Dekker:
 *   - RBAC (ADMIN + HALL_OPERATOR, ikke SUPPORT/PLAYER/AGENT)
 *   - Hall-scope: HALL_OPERATOR begrenset til egen hall
 *   - Input-validering: payoutCents > 0, uniqueId må finnes
 *   - Status-sjekk: PHYSICAL_TICKET_NOT_CASHABLE hvis status != SOLD
 *   - Idempotens: forsøk 2 → 400 ALREADY_CASHED_OUT
 *   - Audit-log: `admin.physical_ticket.cashout` skrives
 *   - GET returnerer status uten mutasjon
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
  PhysicalTicket,
  PhysicalTicketCashout,
  PhysicalTicketCashoutResult,
  RecordCashoutInput,
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
    // BIN-698: win-data defaults
    numbersJson: "numbersJson" in overrides ? overrides.numbersJson! : null,
    patternWon: "patternWon" in overrides ? overrides.patternWon! : null,
    wonAmountCents: "wonAmountCents" in overrides ? overrides.wonAmountCents! : null,
    evaluatedAt: "evaluatedAt" in overrides ? overrides.evaluatedAt! : null,
    isWinningDistributed: overrides.isWinningDistributed ?? false,
    winningDistributedAt:
      "winningDistributedAt" in overrides ? overrides.winningDistributedAt! : null,
  };
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  cashouts: Map<string, PhysicalTicketCashout>;
  recordCalls: RecordCashoutInput[];
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: { tickets?: PhysicalTicket[]; cashouts?: PhysicalTicketCashout[] }
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tickets = new Map<string, PhysicalTicket>();
  for (const t of opts?.tickets ?? []) tickets.set(t.uniqueId, t);
  const cashouts = new Map<string, PhysicalTicketCashout>();
  for (const c of opts?.cashouts ?? []) cashouts.set(c.ticketUniqueId, c);
  const recordCalls: RecordCashoutInput[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const physicalTicketService = {
    async findByUniqueId(uniqueId: string) {
      return tickets.get(uniqueId.trim()) ?? null;
    },
    async findCashoutByUniqueId(uniqueId: string) {
      return cashouts.get(uniqueId.trim()) ?? null;
    },
    async recordCashout(input: RecordCashoutInput): Promise<PhysicalTicketCashoutResult> {
      recordCalls.push(input);
      const ticket = tickets.get(input.uniqueId.trim());
      if (!ticket) throw new DomainError("PHYSICAL_TICKET_NOT_FOUND", "not found");
      if (ticket.status !== "SOLD") {
        throw new DomainError(
          "PHYSICAL_TICKET_NOT_CASHABLE",
          `Billetten har status ${ticket.status} — kun SOLD kan utbetales.`
        );
      }
      if (cashouts.has(ticket.uniqueId)) {
        throw new DomainError("ALREADY_CASHED_OUT", "Billetten er allerede utbetalt.");
      }
      const cashout: PhysicalTicketCashout = {
        id: `ptcash-${cashouts.size + 1}`,
        ticketUniqueId: ticket.uniqueId,
        hallId: ticket.hallId,
        gameId: ticket.assignedGameId,
        payoutCents: input.payoutCents,
        paidBy: input.paidBy,
        paidAt: "2026-04-20T12:00:00Z",
        notes: input.notes ?? null,
        otherData: input.otherData ?? {},
      };
      cashouts.set(ticket.uniqueId, cashout);
      return { cashout, ticket };
    },
  } as unknown as PhysicalTicketService;

  const app = express();
  app.use(express.json());
  app.use(createAdminPhysicalTicketsRouter({
    platformService, auditLogService, physicalTicketService,
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auditStore,
    cashouts,
    recordCalls,
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

test("BIN-640: POST cashout — SUPPORT blokkert (PHYSICAL_TICKET_WRITE)", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "sup-tok", {
      payoutCents: 5000,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctx.recordCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — PLAYER blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "pl-tok", {
      payoutCents: 5000,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — ADMIN happy path oppretter cashout + skriver audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a", assignedGameId: "game-42" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", {
      payoutCents: 50000,
      notes: "Full House",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.cashout.ticketUniqueId, "100");
    assert.equal(res.json.data.cashout.payoutCents, 50000);
    assert.equal(res.json.data.cashout.hallId, "hall-a");
    assert.equal(res.json.data.cashout.gameId, "game-42");
    assert.equal(res.json.data.cashout.paidBy, "admin-1");
    assert.equal(res.json.data.cashout.notes, "Full House");
    assert.equal(res.json.data.ticket.uniqueId, "100");

    // Service-spy
    assert.equal(ctx.recordCalls.length, 1);
    assert.equal(ctx.recordCalls[0]!.payoutCents, 50000);
    assert.equal(ctx.recordCalls[0]!.paidBy, "admin-1");
    assert.equal(ctx.recordCalls[0]!.notes, "Full House");

    // Audit
    const event = await waitForAudit(ctx.auditStore, "admin.physical_ticket.cashout");
    assert.ok(event, "audit-event skrevet");
    assert.equal(event!.actorType, "ADMIN");
    assert.equal(event!.actorId, "admin-1");
    assert.equal(event!.resource, "physical_ticket");
    assert.equal(event!.resourceId, "100");
    assert.equal(event!.details.uniqueId, "100");
    assert.equal(event!.details.payoutCents, 50000);
    assert.equal(event!.details.gameId, "game-42");
    assert.equal(event!.details.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — HALL_OPERATOR kan utbetale egen halls billett", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "op-a-tok", {
      payoutCents: 5000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.cashout.paidBy, "op-a");
    const event = await waitForAudit(ctx.auditStore, "admin.physical_ticket.cashout");
    assert.ok(event);
    assert.equal(event!.actorType, "HALL_OPERATOR");
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — HALL_OPERATOR blokkert fra annen halls billett", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA }, {
    tickets: [makeTicket({ uniqueId: "200", hallId: "hall-b" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/200/cashout", "op-a-tok", {
      payoutCents: 5000,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    // recordCashout skal ikke ha blitt kalt (pre-check fanger scope)
    assert.equal(ctx.recordCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — ukjent unique-id gir PHYSICAL_TICKET_NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/ghost/cashout", "admin-tok", {
      payoutCents: 5000,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — UNSOLD billett gir PHYSICAL_TICKET_NOT_CASHABLE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a", status: "UNSOLD" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", {
      payoutCents: 5000,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_NOT_CASHABLE");
    assert.equal(ctx.recordCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — VOIDED billett gir PHYSICAL_TICKET_NOT_CASHABLE", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a", status: "VOIDED" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", {
      payoutCents: 5000,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_NOT_CASHABLE");
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — idempotent andre-forsøk gir ALREADY_CASHED_OUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    // Første cashout — success
    const first = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", {
      payoutCents: 5000,
    });
    assert.equal(first.status, 200);
    assert.equal(ctx.cashouts.size, 1);

    // Andre forsøk — idempotens-avvisning
    const second = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", {
      payoutCents: 5000,
    });
    assert.equal(second.status, 400);
    assert.equal(second.json.error.code, "ALREADY_CASHED_OUT");
    // cashouts-map uendret
    assert.equal(ctx.cashouts.size, 1);
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — payoutCents ≤ 0 avvises med INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    const zero = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", {
      payoutCents: 0,
    });
    assert.equal(zero.status, 400);
    assert.equal(zero.json.error.code, "INVALID_INPUT");

    const negative = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", {
      payoutCents: -100,
    });
    assert.equal(negative.status, 400);
    assert.equal(negative.json.error.code, "INVALID_INPUT");

    assert.equal(ctx.recordCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — manglende payoutCents avvises med INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", {});
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — array-payload (ikke objekt) avvises med INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    // Sender array — lovlig JSON men ikke record-objekt.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", [1, 2, 3] as any);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-640: POST cashout — payoutCents må være heltall (desimaltall avvises)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-tickets/100/cashout", "admin-tok", {
      payoutCents: 50.5,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── GET-variant ──────────────────────────────────────────────────────────

test("BIN-640: GET cashout — returnerer status=cashedOut=false når ikke utbetalt", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/100/cashout", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.uniqueId, "100");
    assert.equal(res.json.data.status, "SOLD");
    assert.equal(res.json.data.cashedOut, false);
    assert.equal(res.json.data.cashout, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-640: GET cashout — returnerer cashout-detaljer når utbetalt", async () => {
  const cashout: PhysicalTicketCashout = {
    id: "ptcash-1",
    ticketUniqueId: "100",
    hallId: "hall-a",
    gameId: "game-42",
    payoutCents: 5000,
    paidBy: "admin-1",
    paidAt: "2026-04-20T12:00:00Z",
    notes: null,
    otherData: {},
  };
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
    cashouts: [cashout],
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/100/cashout", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.cashedOut, true);
    assert.equal(res.json.data.cashout.id, "ptcash-1");
    assert.equal(res.json.data.cashout.payoutCents, 5000);
  } finally {
    await ctx.close();
  }
});

test("BIN-640: GET cashout — HALL_OPERATOR scope-avvist for annen hall", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA }, {
    tickets: [makeTicket({ uniqueId: "200", hallId: "hall-b" })],
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/200/cashout", "op-a-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-640: GET cashout — ukjent unique-id gir PHYSICAL_TICKET_NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/ghost/cashout", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-640: GET cashout — read-only, ingen AuditLog skrevet", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, {
    tickets: [makeTicket({ uniqueId: "100", hallId: "hall-a" })],
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-tickets/100/cashout", "admin-tok");
    assert.equal(res.status, 200);
    // Gi bakgrunnsevent sjans til å lande selv om vi ikke forventer en
    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    const hit = events.find((e) => e.action === "admin.physical_ticket.cashout");
    assert.equal(hit, undefined, "GET skal ikke skrive audit");
  } finally {
    await ctx.close();
  }
});
