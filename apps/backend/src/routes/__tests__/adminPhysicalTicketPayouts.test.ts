/**
 * PT4 — integrasjonstester for adminPhysicalTicketPayouts-router.
 *
 * Dekker alle 5 endepunkter + RBAC + hall-scope + status-koder (200/403/404/409):
 *   GET  /api/admin/physical-ticket-payouts/pending?gameId=&userId=
 *   POST /api/admin/physical-ticket-payouts/:id/verify
 *   POST /api/admin/physical-ticket-payouts/:id/admin-approve
 *   POST /api/admin/physical-ticket-payouts/:id/confirm-payout
 *   POST /api/admin/physical-ticket-payouts/:id/reject
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPhysicalTicketPayoutsRouter } from "../adminPhysicalTicketPayouts.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  PhysicalTicketPayoutService,
  PhysicalTicketPendingPayout,
} from "../../compliance/PhysicalTicketPayoutService.js";
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
    verified: Array<{ pendingPayoutId: string; scannedTicketId: string; userId: string }>;
    approved: Array<{ pendingPayoutId: string; adminUserId: string }>;
    confirmed: Array<{ pendingPayoutId: string; userId: string }>;
    rejected: Array<{ pendingPayoutId: string; userId: string; reason: string }>;
  };
  pendings: Map<string, PhysicalTicketPendingPayout>;
  close: () => Promise<void>;
}

function makePending(overrides: Partial<PhysicalTicketPendingPayout> & {
  id: string;
  hallId: string;
}): PhysicalTicketPendingPayout {
  return {
    id: overrides.id,
    ticketId: overrides.ticketId ?? "100-1001",
    hallId: overrides.hallId,
    scheduledGameId: overrides.scheduledGameId ?? "game-1",
    patternPhase: overrides.patternPhase ?? "row_1",
    expectedPayoutCents: overrides.expectedPayoutCents ?? 10_000,
    responsibleUserId: overrides.responsibleUserId ?? "op-a",
    color: overrides.color ?? "small",
    detectedAt: overrides.detectedAt ?? "2026-04-22T10:00:00Z",
    verifiedAt: overrides.verifiedAt ?? null,
    verifiedByUserId: overrides.verifiedByUserId ?? null,
    paidOutAt: overrides.paidOutAt ?? null,
    paidOutByUserId: overrides.paidOutByUserId ?? null,
    adminApprovalRequired: overrides.adminApprovalRequired ?? false,
    adminApprovedAt: overrides.adminApprovedAt ?? null,
    adminApprovedByUserId: overrides.adminApprovedByUserId ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
    rejectedByUserId: overrides.rejectedByUserId ?? null,
    rejectedReason: overrides.rejectedReason ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: PhysicalTicketPendingPayout[] = [],
  behaviour: {
    verifyFail?: DomainError;
    approveFail?: DomainError;
    confirmFail?: DomainError;
    rejectFail?: DomainError;
  } = {},
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const pendings = new Map<string, PhysicalTicketPendingPayout>();
  for (const p of seed) pendings.set(p.id, p);

  const verified: Array<{ pendingPayoutId: string; scannedTicketId: string; userId: string }> = [];
  const approved: Array<{ pendingPayoutId: string; adminUserId: string }> = [];
  const confirmed: Array<{ pendingPayoutId: string; userId: string }> = [];
  const rejected: Array<{ pendingPayoutId: string; userId: string; reason: string }> = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const physicalTicketPayoutService = {
    async listPendingForGame(gameId: string) {
      return [...pendings.values()].filter((p) =>
        p.scheduledGameId === gameId
        && p.paidOutAt === null
        && p.rejectedAt === null);
    },
    async listPendingForUser(userId: string) {
      return [...pendings.values()].filter((p) =>
        p.responsibleUserId === userId
        && p.paidOutAt === null
        && p.rejectedAt === null);
    },
    async getById(id: string) {
      return pendings.get(id) ?? null;
    },
    async verifyWin(input: { pendingPayoutId: string; scannedTicketId: string; userId: string }) {
      verified.push(input);
      if (behaviour.verifyFail) throw behaviour.verifyFail;
      const p = pendings.get(input.pendingPayoutId);
      if (!p) throw new DomainError("PENDING_PAYOUT_NOT_FOUND", "not found");
      if (p.paidOutAt) throw new DomainError("ALREADY_PAID_OUT", "paid");
      if (p.rejectedAt) throw new DomainError("ALREADY_REJECTED", "rejected");
      if (input.scannedTicketId !== p.ticketId) {
        throw new DomainError("TICKET_SCAN_MISMATCH", "scan mismatch");
      }
      pendings.set(p.id, {
        ...p,
        verifiedAt: new Date().toISOString(),
        verifiedByUserId: input.userId,
      });
      return {
        pendingPayoutId: p.id,
        ticketId: p.ticketId,
        pattern: p.patternPhase,
        color: p.color,
        expectedPayoutCents: p.expectedPayoutCents,
        needsAdminApproval: p.adminApprovalRequired,
      };
    },
    async adminApprove(input: { pendingPayoutId: string; adminUserId: string }) {
      approved.push(input);
      if (behaviour.approveFail) throw behaviour.approveFail;
      const p = pendings.get(input.pendingPayoutId);
      if (!p) throw new DomainError("PENDING_PAYOUT_NOT_FOUND", "not found");
      if (!p.adminApprovalRequired) {
        throw new DomainError("ADMIN_APPROVAL_NOT_REQUIRED", "not required");
      }
      const updated = {
        ...p,
        adminApprovedAt: new Date().toISOString(),
        adminApprovedByUserId: input.adminUserId,
      };
      pendings.set(p.id, updated);
      return updated;
    },
    async confirmPayout(input: { pendingPayoutId: string; userId: string }) {
      confirmed.push(input);
      if (behaviour.confirmFail) throw behaviour.confirmFail;
      const p = pendings.get(input.pendingPayoutId);
      if (!p) throw new DomainError("PENDING_PAYOUT_NOT_FOUND", "not found");
      if (p.paidOutAt) throw new DomainError("ALREADY_PAID_OUT", "paid");
      if (p.rejectedAt) throw new DomainError("ALREADY_REJECTED", "rejected");
      if (!p.verifiedAt) throw new DomainError("NOT_VERIFIED", "not verified");
      if (p.adminApprovalRequired && !p.adminApprovedAt) {
        throw new DomainError("ADMIN_APPROVAL_REQUIRED", "admin required");
      }
      const now = new Date().toISOString();
      pendings.set(p.id, {
        ...p,
        paidOutAt: now,
        paidOutByUserId: input.userId,
      });
      return {
        pendingPayoutId: p.id,
        ticketId: p.ticketId,
        paidOutAmountCents: p.expectedPayoutCents,
        paidOutAt: now,
      };
    },
    async rejectWin(input: { pendingPayoutId: string; userId: string; reason: string }) {
      rejected.push(input);
      if (behaviour.rejectFail) throw behaviour.rejectFail;
      const p = pendings.get(input.pendingPayoutId);
      if (!p) throw new DomainError("PENDING_PAYOUT_NOT_FOUND", "not found");
      if (p.paidOutAt) throw new DomainError("ALREADY_PAID_OUT", "paid");
      if (p.rejectedAt) throw new DomainError("ALREADY_REJECTED", "rejected");
      const now = new Date().toISOString();
      pendings.set(p.id, {
        ...p,
        rejectedAt: now,
        rejectedByUserId: input.userId,
        rejectedReason: input.reason,
      });
      return { pendingPayoutId: p.id, rejectedAt: now };
    },
  } as unknown as PhysicalTicketPayoutService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminPhysicalTicketPayoutsRouter({
      platformService,
      auditLogService,
      physicalTicketPayoutService,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, verified, approved, confirmed, rejected },
    pendings,
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

test("PT4 route: PLAYER får 403 FORBIDDEN på alle endepunkter", async () => {
  const ctx = await startServer({ tok: playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/physical-ticket-payouts/pending?gameId=game-1", "tok");
    assert.equal(get.status, 403);
    const verify = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/verify", "tok", {
      scannedTicketId: "100-1001",
    });
    assert.equal(verify.status, 403);
  } finally {
    await ctx.close();
  }
});

test("PT4 route: ingen token → 403 UNAUTHORIZED", async () => {
  const ctx = await startServer({ adm: adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-ticket-payouts/pending?gameId=game-1");
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("PT4 route: SUPPORT blokkeres fra verify (PHYSICAL_TICKET_WRITE kreves)", async () => {
  const pending = makePending({ id: "pp-1", hallId: "hall-a" });
  const ctx = await startServer({ tok: supportUser }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/verify", "tok", {
      scannedTicketId: "100-1001",
    });
    assert.equal(res.status, 403);
  } finally {
    await ctx.close();
  }
});

// ── GET /pending ─────────────────────────────────────────────────────────

test("PT4 route GET: HALL_OPERATOR filtreres til egen hall", async () => {
  const hallA = makePending({ id: "pp-a", hallId: "hall-a", responsibleUserId: "op-a" });
  const hallB = makePending({ id: "pp-b", hallId: "hall-b", responsibleUserId: "op-b" });
  const ctx = await startServer({ tok: operatorA }, [hallA, hallB]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-ticket-payouts/pending?gameId=game-1", "tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.pending.length, 1);
    assert.equal(res.json.data.pending[0].id, "pp-a");
  } finally {
    await ctx.close();
  }
});

test("PT4 route GET: ADMIN ser alle haller", async () => {
  const hallA = makePending({ id: "pp-a", hallId: "hall-a" });
  const hallB = makePending({ id: "pp-b", hallId: "hall-b" });
  const ctx = await startServer({ tok: adminUser }, [hallA, hallB]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-ticket-payouts/pending?gameId=game-1", "tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.pending.length, 2);
  } finally {
    await ctx.close();
  }
});

test("PT4 route GET: gameId OG userId → intersect", async () => {
  const a = makePending({
    id: "pp-a",
    hallId: "hall-a",
    responsibleUserId: "op-a",
    scheduledGameId: "game-1",
  });
  const b = makePending({
    id: "pp-b",
    hallId: "hall-a",
    responsibleUserId: "op-b",
    scheduledGameId: "game-1",
  });
  const ctx = await startServer({ tok: adminUser }, [a, b]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/physical-ticket-payouts/pending?gameId=game-1&userId=op-a",
      "tok",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.pending.length, 1);
    assert.equal(res.json.data.pending[0].id, "pp-a");
  } finally {
    await ctx.close();
  }
});

test("PT4 route GET: uten gameId eller userId → 400", async () => {
  const ctx = await startServer({ tok: adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/physical-ticket-payouts/pending", "tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── POST /verify ─────────────────────────────────────────────────────────

test("PT4 route verify: HALL_OPERATOR happy path — 200 + audit", async () => {
  const pending = makePending({ id: "pp-1", hallId: "hall-a" });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/verify", "tok", {
      scannedTicketId: "100-1001",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.ticketId, "100-1001");
    assert.equal(res.json.data.needsAdminApproval, false);

    const audit = await waitForAudit(ctx.spies.auditStore, "physical_ticket.verified");
    assert.ok(audit);
    assert.equal(audit!.actorId, "op-a");
    assert.equal(audit!.resource, "physical_ticket_pending_payout");
  } finally {
    await ctx.close();
  }
});

test("PT4 route verify: scan-mismatch → 409 TICKET_SCAN_MISMATCH", async () => {
  const pending = makePending({ id: "pp-1", hallId: "hall-a", ticketId: "100-1001" });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/verify", "tok", {
      scannedTicketId: "WRONG-ID",
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "TICKET_SCAN_MISMATCH");
  } finally {
    await ctx.close();
  }
});

test("PT4 route verify: HALL_OPERATOR blokkeres fra annen hall — 403", async () => {
  const pending = makePending({ id: "pp-1", hallId: "hall-b" });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/verify", "tok", {
      scannedTicketId: "100-1001",
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
    // Service skal IKKE kalles (hall-scope filtreres før).
    assert.equal(ctx.spies.verified.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PT4 route verify: ukjent pending → 404", async () => {
  const ctx = await startServer({ tok: adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/ukjent/verify", "tok", {
      scannedTicketId: "100-1001",
    });
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, "PENDING_PAYOUT_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("PT4 route verify: tom scannedTicketId → 400", async () => {
  const pending = makePending({ id: "pp-1", hallId: "hall-a" });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/verify", "tok", {
      scannedTicketId: "",
    });
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── POST /admin-approve ──────────────────────────────────────────────────

test("PT4 route approve: ADMIN happy path for admin-required pending — 200", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-a",
    adminApprovalRequired: true,
    verifiedAt: "2026-04-22T10:00:00Z",
  });
  const ctx = await startServer({ tok: adminUser }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/admin-approve", "tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(res.json.data.adminApprovedAt);
    assert.equal(res.json.data.adminApprovedByUserId, "admin-1");

    const audit = await waitForAudit(ctx.spies.auditStore, "physical_ticket.admin_approved");
    assert.ok(audit);
  } finally {
    await ctx.close();
  }
});

test("PT4 route approve: HALL_OPERATOR blokkeres fra admin-approve — 403", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-a",
    adminApprovalRequired: true,
  });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/admin-approve", "tok");
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PT4 route approve: på pending uten admin-required → 409", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-a",
    adminApprovalRequired: false,
  });
  const ctx = await startServer({ tok: adminUser }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/admin-approve", "tok");
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "ADMIN_APPROVAL_NOT_REQUIRED");
  } finally {
    await ctx.close();
  }
});

// ── POST /confirm-payout ─────────────────────────────────────────────────

test("PT4 route confirm: HALL_OPERATOR happy path etter verify — 200 + audit", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-a",
    verifiedAt: "2026-04-22T10:00:00Z",
    verifiedByUserId: "op-a",
  });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/confirm-payout", "tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.paidOutAmountCents, 10_000);

    const audit = await waitForAudit(ctx.spies.auditStore, "physical_ticket.payout");
    assert.ok(audit);
    assert.equal(audit!.actorId, "op-a");
    assert.equal((audit!.details as { amountCents: number }).amountCents, 10_000);
  } finally {
    await ctx.close();
  }
});

test("PT4 route confirm: uten verify → 409 NOT_VERIFIED", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-a",
    verifiedAt: null,
  });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/confirm-payout", "tok");
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "NOT_VERIFIED");
  } finally {
    await ctx.close();
  }
});

test("PT4 route confirm: admin-required uten approval → 409 ADMIN_APPROVAL_REQUIRED", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-a",
    adminApprovalRequired: true,
    verifiedAt: "2026-04-22T10:00:00Z",
  });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/confirm-payout", "tok");
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "ADMIN_APPROVAL_REQUIRED");
  } finally {
    await ctx.close();
  }
});

test("PT4 route confirm: HALL_OPERATOR annen hall → 403", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-b",
    verifiedAt: "2026-04-22T10:00:00Z",
  });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/confirm-payout", "tok");
    assert.equal(res.status, 403);
  } finally {
    await ctx.close();
  }
});

// ── POST /reject ─────────────────────────────────────────────────────────

test("PT4 route reject: HALL_OPERATOR happy path — 200 + audit", async () => {
  const pending = makePending({ id: "pp-1", hallId: "hall-a" });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/reject", "tok", {
      reason: "Bong ikke frembrakt.",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(res.json.data.rejectedAt);

    const audit = await waitForAudit(ctx.spies.auditStore, "physical_ticket.rejected");
    assert.ok(audit);
    assert.equal((audit!.details as { reason: string }).reason, "Bong ikke frembrakt.");
  } finally {
    await ctx.close();
  }
});

test("PT4 route reject: tom reason → 400", async () => {
  const pending = makePending({ id: "pp-1", hallId: "hall-a" });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/reject", "tok", {
      reason: "",
    });
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

test("PT4 route reject: dobbel reject → 409 ALREADY_REJECTED", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-a",
    rejectedAt: "2026-04-22T10:00:00Z",
    rejectedByUserId: "op-a",
    rejectedReason: "tidligere",
  });
  const ctx = await startServer({ tok: operatorA }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/reject", "tok", {
      reason: "andre",
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "ALREADY_REJECTED");
  } finally {
    await ctx.close();
  }
});

test("PT4 route: SUPPORT kan IKKE verify/confirm/reject (PHYSICAL_TICKET_WRITE kreves)", async () => {
  const pending = makePending({ id: "pp-1", hallId: "hall-a" });
  const ctx = await startServer({ tok: supportUser }, [pending]);
  try {
    const verify = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/verify", "tok", {
      scannedTicketId: "100-1001",
    });
    assert.equal(verify.status, 403);
    const confirm = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/confirm-payout", "tok");
    assert.equal(confirm.status, 403);
    const reject = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/reject", "tok", {
      reason: "x",
    });
    assert.equal(reject.status, 403);
  } finally {
    await ctx.close();
  }
});

// ── ADMIN-full-flyt med hall-b ──────────────────────────────────────────

test("PT4 route: ADMIN kan admin-approve i annen hall uten hall-scope-blokk", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-b",
    adminApprovalRequired: true,
    verifiedAt: "2026-04-22T10:00:00Z",
  });
  const ctx = await startServer({ tok: adminUser }, [pending]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/admin-approve", "tok");
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

// ── Full flyt (verify → admin-approve → confirm) for admin-required ─────

test("PT4 route: admin-required full-flyt verify + admin-approve + confirm-payout", async () => {
  const pending = makePending({
    id: "pp-1",
    hallId: "hall-a",
    adminApprovalRequired: true,
    expectedPayoutCents: 600_000,
  });
  const ctx = await startServer({ ophA: operatorA, admin: adminUser }, [pending]);
  try {
    // Steg 1: Bingovert scanner og verifiserer.
    const verify = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/verify", "ophA", {
      scannedTicketId: "100-1001",
    });
    assert.equal(verify.status, 200);
    assert.equal(verify.json.data.needsAdminApproval, true);

    // Steg 2: Bingovert prøver confirm → 409 ADMIN_APPROVAL_REQUIRED.
    const confirmEarly = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/confirm-payout", "ophA");
    assert.equal(confirmEarly.status, 409);
    assert.equal(confirmEarly.json.error.code, "ADMIN_APPROVAL_REQUIRED");

    // Steg 3: ADMIN godkjenner.
    const approve = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/admin-approve", "admin");
    assert.equal(approve.status, 200);

    // Steg 4: Bingovert bekrefter utbetaling.
    const confirm = await req(ctx.baseUrl, "POST", "/api/admin/physical-ticket-payouts/pp-1/confirm-payout", "ophA");
    assert.equal(confirm.status, 200);
    assert.equal(confirm.json.data.paidOutAmountCents, 600_000);
  } finally {
    await ctx.close();
  }
});
