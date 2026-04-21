/**
 * GAME1_SCHEDULE PR 4a: integrasjonstester for game1-purchase-router.
 *
 * Dekker:
 *   POST /api/game1/purchase              (PLAYER + AGENT happy-path)
 *   POST /api/game1/purchase/:id/refund   (ADMIN-only)
 *   GET  /api/game1/purchase/game/:sgId   (hall-scope)
 *
 * Verifiserer:
 *   - Auth + permission (UNAUTHORIZED / FORBIDDEN).
 *   - PLAYER avvises hvis buyerUserId ≠ actor.id.
 *   - AGENT avvises hvis hallId ≠ actor.hallId eller feil paymentMethod.
 *   - Happy path returnerer 200 + data.
 *   - Service-feil → 400 { ok: false, error: {code, message} }.
 *   - Refund-endepunkt: kun ADMIN.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createGame1PurchaseRouter } from "../game1Purchase.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  Game1TicketPurchaseService,
  Game1TicketPurchaseResult,
  Game1TicketPurchaseRow,
  Game1TicketPurchaseInput,
  Game1RefundInput,
} from "../../game/Game1TicketPurchaseService.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseUser: PublicAppUser = {
  id: "u-base",
  email: "u@test.no",
  displayName: "U",
  walletId: "w-u",
  role: "PLAYER",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const adminUser: PublicAppUser = { ...baseUser, id: "admin-1", role: "ADMIN" };
const playerUser: PublicAppUser = { ...baseUser, id: "p1", role: "PLAYER" };
const agentUser: PublicAppUser = {
  ...baseUser,
  id: "a1",
  role: "AGENT",
  hallId: "hall-a",
};
const hallOperatorUser: PublicAppUser = {
  ...baseUser,
  id: "hop-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const supportUser: PublicAppUser = { ...baseUser, id: "sup-1", role: "SUPPORT" };

interface Ctx {
  baseUrl: string;
  purchaseCalls: Game1TicketPurchaseInput[];
  refundCalls: Game1RefundInput[];
  listCalls: string[];
  close: () => Promise<void>;
}

interface StartOpts {
  users?: Record<string, PublicAppUser>;
  purchaseImpl?: (
    input: Game1TicketPurchaseInput
  ) => Promise<Game1TicketPurchaseResult>;
  refundImpl?: (input: Game1RefundInput) => Promise<void>;
  listImpl?: (scheduledGameId: string) => Promise<Game1TicketPurchaseRow[]>;
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const users: Record<string, PublicAppUser> = opts.users ?? {
    "t-admin": adminUser,
    "t-player": playerUser,
    "t-agent": agentUser,
    "t-operator": hallOperatorUser,
    "t-support": supportUser,
  };
  const purchaseCalls: Game1TicketPurchaseInput[] = [];
  const refundCalls: Game1RefundInput[] = [];
  const listCalls: string[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const purchaseService = {
    async purchase(input: Game1TicketPurchaseInput) {
      purchaseCalls.push(input);
      if (opts.purchaseImpl) return opts.purchaseImpl(input);
      return {
        purchaseId: `g1p-mock-${purchaseCalls.length}`,
        totalAmountCents: input.ticketSpec.reduce(
          (sum, t) => sum + t.count * t.priceCentsEach,
          0
        ),
        alreadyExisted: false,
      };
    },
    async refundPurchase(input: Game1RefundInput) {
      refundCalls.push(input);
      if (opts.refundImpl) return opts.refundImpl(input);
    },
    async listPurchasesForGame(scheduledGameId: string) {
      listCalls.push(scheduledGameId);
      if (opts.listImpl) return opts.listImpl(scheduledGameId);
      return [];
    },
  } as unknown as Game1TicketPurchaseService;

  const app = express();
  app.use(express.json());
  app.use(
    createGame1PurchaseRouter({
      platformService,
      purchaseService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    purchaseCalls,
    refundCalls,
    listCalls,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function http(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, body: parsed };
}

// ── POST /api/game1/purchase ─────────────────────────────────────────────────

test("POST /api/game1/purchase krever auth → 400 UNAUTHORIZED uten token", async () => {
  const ctx = await startServer();
  try {
    const res = await http(ctx.baseUrl, "POST", "/api/game1/purchase", {
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "k",
    });
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("POST /api/game1/purchase PLAYER happy-path → 200 + purchaseId", async () => {
  const ctx = await startServer();
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase",
      {
        scheduledGameId: "g1",
        buyerUserId: "p1",
        hallId: "hall-a",
        ticketSpec: [
          { color: "yellow", size: "small", count: 2, priceCentsEach: 2000 },
        ],
        paymentMethod: "digital_wallet",
        idempotencyKey: "k-1",
      },
      "t-player"
    );
    assert.equal(res.status, 200);
    const body = res.body as {
      ok: boolean;
      data: { purchaseId: string; totalAmountCents: number };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data.totalAmountCents, 4000);
    assert.equal(ctx.purchaseCalls.length, 1);
    assert.equal(ctx.purchaseCalls[0]!.paymentMethod, "digital_wallet");
  } finally {
    await ctx.close();
  }
});

test("POST /api/game1/purchase PLAYER kan ikke kjøpe på annens vegne → FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase",
      {
        scheduledGameId: "g1",
        buyerUserId: "p2", // someone else
        hallId: "hall-a",
        ticketSpec: [
          { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
        ],
        paymentMethod: "digital_wallet",
        idempotencyKey: "k",
      },
      "t-player"
    );
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("POST /api/game1/purchase PLAYER kan ikke bruke cash_agent → FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase",
      {
        scheduledGameId: "g1",
        buyerUserId: "p1",
        hallId: "hall-a",
        ticketSpec: [
          { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
        ],
        paymentMethod: "cash_agent",
        idempotencyKey: "k",
      },
      "t-player"
    );
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("POST /api/game1/purchase AGENT happy-path cash_agent → 200", async () => {
  const ctx = await startServer();
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase",
      {
        scheduledGameId: "g1",
        buyerUserId: "p1",
        hallId: "hall-a",
        ticketSpec: [
          { color: "yellow", size: "small", count: 3, priceCentsEach: 2000 },
        ],
        paymentMethod: "cash_agent",
        idempotencyKey: "k",
      },
      "t-agent"
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.purchaseCalls.length, 1);
    assert.equal(ctx.purchaseCalls[0]!.agentUserId, "a1");
    assert.equal(ctx.purchaseCalls[0]!.paymentMethod, "cash_agent");
  } finally {
    await ctx.close();
  }
});

test("POST /api/game1/purchase AGENT avvises når hall ≠ user.hallId", async () => {
  const ctx = await startServer();
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase",
      {
        scheduledGameId: "g1",
        buyerUserId: "p1",
        hallId: "hall-x", // not agent's hall
        ticketSpec: [
          { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
        ],
        paymentMethod: "cash_agent",
        idempotencyKey: "k",
      },
      "t-agent"
    );
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("POST /api/game1/purchase HALL_OPERATOR har ikke tilgang (ikke i GAME1_PURCHASE_WRITE)", async () => {
  const ctx = await startServer();
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase",
      {
        scheduledGameId: "g1",
        buyerUserId: "p1",
        hallId: "hall-a",
        ticketSpec: [
          { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
        ],
        paymentMethod: "cash_agent",
        idempotencyKey: "k",
      },
      "t-operator"
    );
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("POST /api/game1/purchase service-feil → 400 med samme kode", async () => {
  const ctx = await startServer({
    purchaseImpl: async () => {
      throw new DomainError(
        "PURCHASE_CLOSED_FOR_GAME",
        "stengt"
      );
    },
  });
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase",
      {
        scheduledGameId: "g1",
        buyerUserId: "p1",
        hallId: "hall-a",
        ticketSpec: [
          { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
        ],
        paymentMethod: "digital_wallet",
        idempotencyKey: "k",
      },
      "t-player"
    );
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "PURCHASE_CLOSED_FOR_GAME");
  } finally {
    await ctx.close();
  }
});

test("POST /api/game1/purchase ugyldig ticketSpec → 400 INVALID_TICKET_SPEC", async () => {
  const ctx = await startServer();
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase",
      {
        scheduledGameId: "g1",
        buyerUserId: "p1",
        hallId: "hall-a",
        ticketSpec: [],
        paymentMethod: "digital_wallet",
        idempotencyKey: "k",
      },
      "t-player"
    );
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "INVALID_TICKET_SPEC");
  } finally {
    await ctx.close();
  }
});

// ── POST /api/game1/purchase/:id/refund ─────────────────────────────────────

test("POST /refund ADMIN-only → PLAYER får FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase/g1p-1/refund",
      { reason: "support" },
      "t-player"
    );
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("POST /refund ADMIN happy-path → 200 + service-kall", async () => {
  const ctx = await startServer();
  try {
    const res = await http(
      ctx.baseUrl,
      "POST",
      "/api/game1/purchase/g1p-abc/refund",
      { reason: "bingovert-feil" },
      "t-admin"
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.refundCalls.length, 1);
    assert.equal(ctx.refundCalls[0]!.purchaseId, "g1p-abc");
    assert.equal(ctx.refundCalls[0]!.reason, "bingovert-feil");
    assert.equal(ctx.refundCalls[0]!.refundedByUserId, "admin-1");
  } finally {
    await ctx.close();
  }
});

// ── GET /api/game1/purchase/game/:scheduledGameId ───────────────────────────

test("GET game purchases: AGENT ser kun egen hall", async () => {
  const purchases: Game1TicketPurchaseRow[] = [
    {
      id: "p-a",
      scheduledGameId: "g1",
      buyerUserId: "u-a",
      hallId: "hall-a",
      ticketSpec: [],
      totalAmountCents: 2000,
      paymentMethod: "cash_agent",
      agentUserId: "a1",
      idempotencyKey: "k-a",
      purchasedAt: "2026-04-21T10:00:00.000Z",
      refundedAt: null,
      refundReason: null,
      refundedByUserId: null,
      refundTransactionId: null,
    },
    {
      id: "p-b",
      scheduledGameId: "g1",
      buyerUserId: "u-b",
      hallId: "hall-b",
      ticketSpec: [],
      totalAmountCents: 2000,
      paymentMethod: "cash_agent",
      agentUserId: "a2",
      idempotencyKey: "k-b",
      purchasedAt: "2026-04-21T10:01:00.000Z",
      refundedAt: null,
      refundReason: null,
      refundedByUserId: null,
      refundTransactionId: null,
    },
  ];
  const ctx = await startServer({
    listImpl: async () => purchases,
  });
  try {
    const res = await http(
      ctx.baseUrl,
      "GET",
      "/api/game1/purchase/game/g1",
      undefined,
      "t-agent"
    );
    assert.equal(res.status, 200);
    const body = res.body as {
      ok: boolean;
      data: { purchases: Array<{ hallId: string; id: string }> };
    };
    assert.equal(body.data.purchases.length, 1);
    assert.equal(body.data.purchases[0]!.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("GET game purchases: ADMIN ser alle haller", async () => {
  const purchases: Game1TicketPurchaseRow[] = [
    {
      id: "p-a",
      scheduledGameId: "g1",
      buyerUserId: "u-a",
      hallId: "hall-a",
      ticketSpec: [],
      totalAmountCents: 2000,
      paymentMethod: "cash_agent",
      agentUserId: "a1",
      idempotencyKey: "k-a",
      purchasedAt: "2026-04-21T10:00:00.000Z",
      refundedAt: null,
      refundReason: null,
      refundedByUserId: null,
      refundTransactionId: null,
    },
    {
      id: "p-b",
      scheduledGameId: "g1",
      buyerUserId: "u-b",
      hallId: "hall-b",
      ticketSpec: [],
      totalAmountCents: 2000,
      paymentMethod: "digital_wallet",
      agentUserId: null,
      idempotencyKey: "k-b",
      purchasedAt: "2026-04-21T10:01:00.000Z",
      refundedAt: null,
      refundReason: null,
      refundedByUserId: null,
      refundTransactionId: null,
    },
  ];
  const ctx = await startServer({
    listImpl: async () => purchases,
  });
  try {
    const res = await http(
      ctx.baseUrl,
      "GET",
      "/api/game1/purchase/game/g1",
      undefined,
      "t-admin"
    );
    assert.equal(res.status, 200);
    const body = res.body as {
      ok: boolean;
      data: { purchases: Array<{ hallId: string }> };
    };
    assert.equal(body.data.purchases.length, 2);
  } finally {
    await ctx.close();
  }
});
