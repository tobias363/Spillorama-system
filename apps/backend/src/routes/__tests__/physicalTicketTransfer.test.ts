/**
 * BIN-583 B3.7 Alt B: router-integrasjonstester for batch cross-hall transfer.
 *
 * Dekker RBAC (kun ADMIN), atomisk rollback hvis SOLD/VOIDED, audit-logging.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPhysicalTicketsRouter } from "../adminPhysicalTickets.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  PhysicalTicketService,
  PhysicalTicketBatchTransfer,
} from "../../compliance/PhysicalTicketService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "a@test.no", displayName: "Admin",
  walletId: "w-a", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const operatorA: PublicAppUser = { ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" };
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  spies: {
    transferCalls: Array<{ batchId: string; toHallId: string; reason: string; actorUserId: string }>;
    listCalls: string[];
  };
  close: () => Promise<void>;
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  transferBehavior?: (input: Record<string, unknown>) => PhysicalTicketBatchTransfer | Promise<PhysicalTicketBatchTransfer>;
  transfers?: PhysicalTicketBatchTransfer[];
}): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const spies: Ctx["spies"] = { transferCalls: [], listCalls: [] };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
  } as unknown as PlatformService;

  const defaultTransfer = (input: Record<string, unknown>): PhysicalTicketBatchTransfer => ({
    id: "tr-1",
    batchId: String(input.batchId),
    fromHallId: "hall-a",
    toHallId: String(input.toHallId),
    reason: String(input.reason),
    transferredBy: String(input.actorUserId),
    transferredAt: "2026-01-01T00:00:00Z",
    ticketCountAtTransfer: 100,
  });

  const physicalTicketService = {
    // Minimale stubs for B4a-endepunkter som routeren også bruker
    async listBatches() { return []; },
    async getBatch() { throw new DomainError("NOT_FOUND", "x"); },
    async getBatchTickets() { return { tickets: [], totalSold: 0, totalUnsold: 0, totalVoided: 0 }; },
    async createBatch() { throw new DomainError("NOT_IMPLEMENTED", "x"); },
    async updateBatch() { throw new DomainError("NOT_IMPLEMENTED", "x"); },
    async deleteBatch() { /* ok */ },
    async generateBatchTickets() { return { batchId: "b-1", generated: 0, firstUniqueId: "1", lastUniqueId: "1" }; },
    async assignGameToBatch() { throw new DomainError("NOT_IMPLEMENTED", "x"); },
    async listSoldTicketsForGame() { return []; },
    async voidAllSoldTicketsForGame() { return { voided: 0 }; },
    async getLastRegisteredUniqueId() { return { hallId: "x", lastUniqueId: null, maxRangeEnd: null }; },
    // B3.7 spies:
    async transferBatchToHall(input: Record<string, unknown>) {
      spies.transferCalls.push(input as { batchId: string; toHallId: string; reason: string; actorUserId: string });
      const behavior = opts.transferBehavior ?? defaultTransfer;
      return behavior(input);
    },
    async listTransfers(batchId: string) {
      spies.listCalls.push(batchId);
      return opts.transfers ?? [];
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
    auditStore, spies,
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

async function waitAudit(store: InMemoryAuditLogStore, action: string): Promise<unknown> {
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

test("B3.7: kun ADMIN kan transfer-batch — HALL_OPERATOR + SUPPORT blokkert", async () => {
  const ctx = await startServer({ users: { "op-tok": operatorA, "sup-tok": supportUser } });
  try {
    for (const token of ["op-tok", "sup-tok"]) {
      const res = await req(
        ctx.baseUrl,
        "POST",
        "/api/admin/physical-tickets/batches/b-1/transfer-hall",
        token,
        { toHallId: "hall-b", reason: "misprint" }
      );
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "FORBIDDEN");
    }
    assert.equal(ctx.spies.transferCalls.length, 0, "service skal ikke kalles hvis RBAC-avvist");
  } finally { await ctx.close(); }
});

test("B3.7: ADMIN transfer-batch success + audit logger fromHallId+toHallId+count", async () => {
  const ctx = await startServer({ users: { "admin-tok": adminUser } });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/batches/b-1/transfer-hall",
      "admin-tok",
      { toHallId: "hall-b", reason: "misprinted batch" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.batchId, "b-1");
    assert.equal(res.json.data.fromHallId, "hall-a");
    assert.equal(res.json.data.toHallId, "hall-b");
    assert.equal(ctx.spies.transferCalls.length, 1);
    assert.equal(ctx.spies.transferCalls[0]!.actorUserId, "admin-1");

    const audit = await waitAudit(ctx.auditStore, "physical_ticket.batch.transfer_hall") as { details: Record<string, unknown> };
    assert.ok(audit);
    assert.equal(audit.details.fromHallId, "hall-a");
    assert.equal(audit.details.toHallId, "hall-b");
    assert.equal(audit.details.reason, "misprinted batch");
    assert.equal(audit.details.ticketCountAtTransfer, 100);
  } finally { await ctx.close(); }
});

test("B3.7: transfer-batch krever toHallId + reason", async () => {
  const ctx = await startServer({ users: { "admin-tok": adminUser } });
  try {
    const noHall = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/batches/b-1/transfer-hall",
      "admin-tok",
      { reason: "misprint" }
    );
    assert.equal(noHall.status, 400);
    assert.equal(noHall.json.error.code, "INVALID_INPUT");

    const noReason = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/batches/b-1/transfer-hall",
      "admin-tok",
      { toHallId: "hall-b" }
    );
    assert.equal(noReason.status, 400);
    assert.equal(noReason.json.error.code, "INVALID_INPUT");
  } finally { await ctx.close(); }
});

test("B3.7: transfer-batch avviser hvis service kaster BATCH_NOT_TRANSFERABLE", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    transferBehavior: () => {
      throw new DomainError("BATCH_NOT_TRANSFERABLE", "Batch inneholder SOLD billetter.");
    },
  });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/physical-tickets/batches/b-1/transfer-hall",
      "admin-tok",
      { toHallId: "hall-b", reason: "misprint" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "BATCH_NOT_TRANSFERABLE");
  } finally { await ctx.close(); }
});

test("B3.7: GET transfers returnerer historikk", async () => {
  const transfers: PhysicalTicketBatchTransfer[] = [
    {
      id: "tr-1", batchId: "b-1",
      fromHallId: "hall-a", toHallId: "hall-b",
      reason: "misprint",
      transferredBy: "admin-1",
      transferredAt: "2026-04-19T10:00:00Z",
      ticketCountAtTransfer: 50,
    },
  ];
  const ctx = await startServer({ users: { "admin-tok": adminUser }, transfers });
  try {
    const res = await req(
      ctx.baseUrl, "GET", "/api/admin/physical-tickets/batches/b-1/transfers", "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.batchId, "b-1");
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.transfers[0].reason, "misprint");
    assert.deepEqual(ctx.spies.listCalls, ["b-1"]);
  } finally { await ctx.close(); }
});
