/**
 * PDF 17 §17.29-§17.32: integrasjonstester for agent history-lists.
 *
 * Dekker:
 *   - RBAC: PLAYER blokkert; AGENT må ha shift; HALL_OPERATOR uten hall
 *     blokkert; ADMIN ser globalt.
 *   - /api/agent/orders/history — payment-filter + agent-scope.
 *   - /api/agent/orders/:id — hall-scope-håndhevelse + AGENT-egen-sale-only.
 *   - /api/agent/sold-tickets — physical-flow + tom liste for terminal/web.
 *   - /api/agent/winnings-history — alias mot static-ticket-paid-out-data.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentHistoryListsRouter } from "../agentHistoryLists.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type { AgentService } from "../../agent/AgentService.js";
import type { AgentShiftService } from "../../agent/AgentShiftService.js";
import type {
  AgentProductSaleService,
  ProductCart,
  ProductSale,
} from "../../agent/AgentProductSaleService.js";
import type {
  StaticTicket,
  StaticTicketService,
} from "../../compliance/StaticTicketService.js";
import { DomainError } from "../../game/BingoEngine.js";

const baseUser: PublicAppUser = {
  id: "u-1",
  email: "x@x.no",
  displayName: "X",
  walletId: "w",
  role: "AGENT",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const agentUser: PublicAppUser = { ...baseUser, id: "ag-1", role: "AGENT" };
const otherAgent: PublicAppUser = { ...baseUser, id: "ag-2", role: "AGENT" };
const hallOperator: PublicAppUser = {
  ...baseUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const adminUser: PublicAppUser = { ...baseUser, id: "adm-1", role: "ADMIN" };
const playerUser: PublicAppUser = { ...baseUser, id: "pl-1", role: "PLAYER" };

function sale(overrides: Partial<ProductSale> = {}): ProductSale {
  return {
    id: overrides.id ?? "sale-1",
    cartId: overrides.cartId ?? "cart-1",
    orderId: overrides.orderId ?? "ORD-AAA-100",
    hallId: overrides.hallId ?? "hall-a",
    shiftId: overrides.shiftId ?? "s-1",
    agentUserId: overrides.agentUserId ?? "ag-1",
    playerUserId: overrides.playerUserId ?? null,
    paymentMethod: overrides.paymentMethod ?? "CASH",
    totalCents: overrides.totalCents ?? 7500,
    walletTxId: overrides.walletTxId ?? null,
    agentTxId: overrides.agentTxId ?? "atx-1",
    createdAt: overrides.createdAt ?? "2026-04-10T12:00:00.000Z",
  };
}

function cart(overrides: Partial<ProductCart> = {}): ProductCart {
  return {
    id: overrides.id ?? "cart-1",
    orderId: overrides.orderId ?? "ORD-AAA-100",
    agentUserId: overrides.agentUserId ?? "ag-1",
    hallId: overrides.hallId ?? "hall-a",
    shiftId: overrides.shiftId ?? "s-1",
    userType: overrides.userType ?? "PHYSICAL",
    userId: overrides.userId ?? null,
    username: overrides.username ?? null,
    totalCents: overrides.totalCents ?? 7500,
    status: overrides.status ?? "ORDER_PLACED",
    lines: overrides.lines ?? [
      {
        productId: "prod-1",
        productName: "Kaffe",
        quantity: 1,
        unitPriceCents: 2500,
        lineTotalCents: 2500,
      },
      {
        productId: "prod-2",
        productName: "Sjokolade",
        quantity: 2,
        unitPriceCents: 2500,
        lineTotalCents: 5000,
      },
    ],
    createdAt: overrides.createdAt ?? "2026-04-10T11:55:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-10T12:00:00.000Z",
  };
}

function ticket(overrides: Partial<StaticTicket> = {}): StaticTicket {
  return {
    id: overrides.id ?? "t-1",
    hallId: overrides.hallId ?? "hall-a",
    ticketSerial: overrides.ticketSerial ?? "01-1001",
    ticketColor: overrides.ticketColor ?? "small",
    ticketType: overrides.ticketType ?? "small_yellow",
    cardMatrix: Array.from({ length: 25 }, (_, i) => i + 1),
    isPurchased: overrides.isPurchased ?? true,
    purchasedAt: overrides.purchasedAt ?? "2026-04-10T10:00:00.000Z",
    importedAt: "2026-03-01T00:00:00.000Z",
    soldByUserId: "ag-1",
    soldFromRangeId: "r-1",
    responsibleUserId: "ag-1",
    soldToScheduledGameId: null,
    reservedByRangeId: null,
    paidOutAt: overrides.paidOutAt ?? null,
    paidOutAmountCents: overrides.paidOutAmountCents ?? null,
    paidOutByUserId: overrides.paidOutByUserId ?? null,
  };
}

interface Spy {
  listSalesArgs: unknown[];
  getSaleArgs: unknown[];
  listSoldArgs: unknown[];
  listPaidOutArgs: unknown[];
}

interface Ctx {
  baseUrl: string;
  spy: Spy;
  close: () => Promise<void>;
}

interface ServerOpts {
  shift?: { id: string; hallId: string } | null;
  sales?: { sales: ProductSale[]; total: number };
  saleDetail?: { sale: ProductSale; cart: ProductCart } | null;
  soldTickets?: StaticTicket[];
  paidOutTickets?: StaticTicket[];
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: ServerOpts,
): Promise<Ctx> {
  const spy: Spy = {
    listSalesArgs: [],
    getSaleArgs: [],
    listSoldArgs: [],
    listPaidOutArgs: [],
  };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
  } as unknown as PlatformService;

  const agentService = {
    async requireActiveAgent() {
      return undefined;
    },
  } as unknown as AgentService;

  const agentShiftService = {
    async getCurrentShift() {
      return opts?.shift ?? null;
    },
  } as unknown as AgentShiftService;

  const productSaleService = {
    async listSalesForAgent(arg: unknown) {
      spy.listSalesArgs.push(arg);
      return opts?.sales ?? { sales: [], total: 0 };
    },
    async getSaleWithLines(saleId: string) {
      spy.getSaleArgs.push(saleId);
      return opts?.saleDetail ?? null;
    },
  } as unknown as AgentProductSaleService;

  const staticTicketService = {
    async listSoldInRange(arg: unknown) {
      spy.listSoldArgs.push(arg);
      return opts?.soldTickets ?? [];
    },
    async listPaidOutInRange(arg: unknown) {
      spy.listPaidOutArgs.push(arg);
      return opts?.paidOutTickets ?? [];
    },
  } as unknown as StaticTicketService;

  const app = express();
  app.use(express.json());
  app.use(
    createAgentHistoryListsRouter({
      platformService,
      agentService,
      agentShiftService,
      productSaleService,
      staticTicketService,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spy,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function req(
  baseUrl: string,
  path: string,
  token?: string,
): Promise<{
  status: number;
  json: { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } };
}> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const parsed = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: unknown;
    error?: { code?: string; message?: string };
  };
  return { status: res.status, json: parsed };
}

// ── PDF 17 §17.29: /api/agent/orders/history ──────────────────────────────

test("orders/history: PLAYER blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const r = await req(ctx.baseUrl, "/api/agent/orders/history", "pl-tok");
    assert.equal(r.json.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("orders/history: AGENT uten shift → SHIFT_NOT_ACTIVE", async () => {
  const ctx = await startServer({ "ag-tok": agentUser }, { shift: null });
  try {
    const r = await req(ctx.baseUrl, "/api/agent/orders/history", "ag-tok");
    assert.equal(r.json.error?.code, "SHIFT_NOT_ACTIVE");
  } finally {
    await ctx.close();
  }
});

test("orders/history: AGENT auto-scopes til egen agent-id og hall", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    {
      shift: { id: "s-1", hallId: "hall-a" },
      sales: { sales: [sale()], total: 1 },
    },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/orders/history?from=2026-04-01&to=2026-04-30",
      "ag-tok",
    );
    assert.equal(r.status, 200);
    const data = r.json.data as {
      sales: unknown[];
      total: number;
      hallId: string | null;
    };
    assert.equal(data.total, 1);
    assert.equal(data.hallId, "hall-a");
    const call = ctx.spy.listSalesArgs[0] as {
      hallId?: string;
      agentUserId?: string;
    };
    assert.equal(call.hallId, "hall-a");
    assert.equal(call.agentUserId, "ag-1");
  } finally {
    await ctx.close();
  }
});

test("orders/history: AGENT kan ikke overstyre hallId", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    { shift: { id: "s-1", hallId: "hall-a" } },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/orders/history?hallId=hall-b",
      "ag-tok",
    );
    assert.equal(r.json.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("orders/history: paymentType-alias mappes til CASH/CARD/CUSTOMER_NUMBER", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    { shift: { id: "s-1", hallId: "hall-a" } },
  );
  try {
    const r1 = await req(
      ctx.baseUrl,
      "/api/agent/orders/history?paymentType=Cash&from=2026-04-01&to=2026-04-30",
      "ag-tok",
    );
    assert.equal(r1.status, 200);
    const call1 = ctx.spy.listSalesArgs[0] as { paymentMethod?: string };
    assert.equal(call1.paymentMethod, "CASH");

    const r2 = await req(
      ctx.baseUrl,
      "/api/agent/orders/history?paymentType=Kort&from=2026-04-01&to=2026-04-30",
      "ag-tok",
    );
    assert.equal(r2.status, 200);
    const call2 = ctx.spy.listSalesArgs[1] as { paymentMethod?: string };
    assert.equal(call2.paymentMethod, "CARD");

    const r3 = await req(
      ctx.baseUrl,
      "/api/agent/orders/history?paymentType=invalid",
      "ag-tok",
    );
    assert.equal(r3.json.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("orders/history: HALL_OPERATOR ser alle agenters salg i hallen", async () => {
  const ctx = await startServer(
    { "op-tok": hallOperator },
    { sales: { sales: [sale(), sale({ id: "sale-2", agentUserId: "ag-2" })], total: 2 } },
  );
  try {
    const r = await req(ctx.baseUrl, "/api/agent/orders/history", "op-tok");
    assert.equal(r.status, 200);
    const call = ctx.spy.listSalesArgs[0] as {
      hallId?: string;
      agentUserId?: string;
    };
    assert.equal(call.hallId, "hall-a");
    // Hall-operator sender ikke agentUserId med mindre eksplisitt query.
    assert.equal(call.agentUserId, undefined);
  } finally {
    await ctx.close();
  }
});

test("orders/history: ugyldig vindu → INVALID_INPUT", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    { shift: { id: "s-1", hallId: "hall-a" } },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/orders/history?from=2026-05-01&to=2026-04-01",
      "ag-tok",
    );
    assert.equal(r.json.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── PDF 17 §17.30: /api/agent/orders/:id ──────────────────────────────────

test("orders/:id: NOT_FOUND når sale mangler", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    { saleDetail: null },
  );
  try {
    const r = await req(ctx.baseUrl, "/api/agent/orders/missing", "adm-tok");
    assert.equal(r.json.error?.code, "NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("orders/:id: AGENT må eie salget — andres salg → FORBIDDEN", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    {
      shift: { id: "s-1", hallId: "hall-a" },
      saleDetail: {
        sale: sale({ agentUserId: "ag-2" }),
        cart: cart({ agentUserId: "ag-2" }),
      },
    },
  );
  try {
    const r = await req(ctx.baseUrl, "/api/agent/orders/sale-1", "ag-tok");
    assert.equal(r.json.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("orders/:id: HALL_OPERATOR fra annen hall → FORBIDDEN", async () => {
  const ctx = await startServer(
    { "op-tok": hallOperator },
    { saleDetail: { sale: sale({ hallId: "hall-b" }), cart: cart({ hallId: "hall-b" }) } },
  );
  try {
    const r = await req(ctx.baseUrl, "/api/agent/orders/sale-1", "op-tok");
    assert.equal(r.json.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("orders/:id: AGENT eget salg returnerer cart + sale", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    {
      shift: { id: "s-1", hallId: "hall-a" },
      saleDetail: { sale: sale(), cart: cart() },
    },
  );
  try {
    const r = await req(ctx.baseUrl, "/api/agent/orders/sale-1", "ag-tok");
    assert.equal(r.status, 200);
    const data = r.json.data as { sale: { id: string }; cart: { id: string; lines: unknown[] } };
    assert.equal(data.sale.id, "sale-1");
    assert.equal(data.cart.lines.length, 2);
  } finally {
    await ctx.close();
  }
});

// ── PDF 17 §17.31: /api/agent/sold-tickets ────────────────────────────────

test("sold-tickets: AGENT med shift får physical-tickets scoped til hall", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    {
      shift: { id: "s-1", hallId: "hall-a" },
      soldTickets: [
        ticket({ ticketSerial: "01-1001", purchasedAt: "2026-04-10T08:00:00.000Z" }),
        ticket({ ticketSerial: "01-1002", purchasedAt: "2026-04-12T09:00:00.000Z" }),
      ],
    },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/sold-tickets?from=2026-04-01&to=2026-04-30",
      "ag-tok",
    );
    assert.equal(r.status, 200);
    const data = r.json.data as {
      rows: Array<{ ticketId: string; soldType: string }>;
      total: number;
      hallId: string | null;
      type: string;
    };
    assert.equal(data.total, 2);
    assert.equal(data.hallId, "hall-a");
    assert.equal(data.type, "physical");
    assert.equal(data.rows[0]?.soldType, "physical");
  } finally {
    await ctx.close();
  }
});

test("sold-tickets: type=terminal returnerer tom liste (gap)", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    {
      shift: { id: "s-1", hallId: "hall-a" },
      soldTickets: [ticket()],
    },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/sold-tickets?type=terminal",
      "ag-tok",
    );
    assert.equal(r.status, 200);
    const data = r.json.data as { rows: unknown[]; total: number; type: string };
    assert.equal(data.total, 0);
    assert.equal(data.type, "terminal");
    // Verifiser at vi IKKE kalte service for terminal-flow.
    assert.equal(ctx.spy.listSoldArgs.length, 0);
  } finally {
    await ctx.close();
  }
});

test("sold-tickets: ADMIN kan filtrere på hallId og se alle haller", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    {
      soldTickets: [
        ticket({ ticketSerial: "01-1001", hallId: "hall-a" }),
        ticket({ ticketSerial: "02-2002", hallId: "hall-b" }),
      ],
    },
  );
  try {
    const r1 = await req(
      ctx.baseUrl,
      "/api/agent/sold-tickets?hallId=hall-a&from=2026-04-01&to=2026-04-30",
      "adm-tok",
    );
    assert.equal(r1.status, 200);
    const call = ctx.spy.listSoldArgs[0] as { hallId?: string };
    assert.equal(call.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("sold-tickets: ugyldig type → INVALID_INPUT", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    { shift: { id: "s-1", hallId: "hall-a" } },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/sold-tickets?type=hocuspocus",
      "ag-tok",
    );
    assert.equal(r.json.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── PDF 17 §17.32 alias: /api/agent/winnings-history ──────────────────────

test("winnings-history: alias gir samme rows som past-winning canonical", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    {
      shift: { id: "s-1", hallId: "hall-a" },
      paidOutTickets: [
        ticket({
          ticketSerial: "W-100",
          paidOutAt: "2026-04-10T15:00:00.000Z",
          paidOutAmountCents: 50_000,
        }),
      ],
    },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/winnings-history?from=2026-04-01&to=2026-04-30",
      "ag-tok",
    );
    assert.equal(r.status, 200);
    const data = r.json.data as {
      rows: Array<{ ticketId: string; priceCents: number | null }>;
      hallId: string | null;
    };
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0]?.ticketId, "W-100");
    assert.equal(data.rows[0]?.priceCents, 50_000);
    assert.equal(data.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("winnings-history: AGENT uten shift → SHIFT_NOT_ACTIVE", async () => {
  const ctx = await startServer({ "ag-tok": agentUser }, { shift: null });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/winnings-history",
      "ag-tok",
    );
    assert.equal(r.json.error?.code, "SHIFT_NOT_ACTIVE");
  } finally {
    await ctx.close();
  }
});

// Accidental cross-agent reference — bruk 'otherAgent' for typescript
// strict-mode (unngår "unused"-varsel hvis vi senere fjerner test).
void otherAgent;
