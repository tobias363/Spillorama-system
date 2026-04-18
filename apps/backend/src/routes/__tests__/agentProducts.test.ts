/**
 * BIN-583 B3.6: router-integrasjonstester for agentProducts.
 *
 * Mocker AgentService, AgentShiftService, ProductService, AgentProductSaleService
 * for å teste RBAC + hall-scope + cart-flyt + audit.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentProductsRouter } from "../agentProducts.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type { AgentService } from "../../agent/AgentService.js";
import type { AgentShiftService } from "../../agent/AgentShiftService.js";
import type { ProductService } from "../../agent/ProductService.js";
import type {
  AgentProductSaleService,
  ProductCart,
  ProductSale,
} from "../../agent/AgentProductSaleService.js";
import { DomainError } from "../../game/BingoEngine.js";

const agentUser: PublicAppUser = {
  id: "ag-1", email: "a@test.no", displayName: "Agent",
  walletId: "w-a", role: "AGENT", hallId: "hall-a",
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const adminUser: PublicAppUser = { ...agentUser, id: "admin-1", role: "ADMIN", hallId: null };
const playerUser: PublicAppUser = { ...agentUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  spies: {
    createCart: Array<Record<string, unknown>>;
    finalize: Array<Record<string, unknown>>;
    cancel: string[];
  };
  close: () => Promise<void>;
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  currentShift?: { id: string; hallId: string } | null;
}): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const spies: Ctx["spies"] = { createCart: [], finalize: [], cancel: [] };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
  } as unknown as PlatformService;

  const agentService = {
    async requireActiveAgent() { /* ok */ },
  } as unknown as AgentService;

  const agentShiftService = {
    async getCurrentShift() {
      return opts.currentShift === undefined ? { id: "shift-1", hallId: "hall-a" } : opts.currentShift;
    },
  } as unknown as AgentShiftService;

  const productService = {
    async listHallProducts(hallId: string) {
      return [{
        hallId, productId: "p-1", isActive: true, addedAt: "2026-01-01T00:00:00Z", addedBy: null,
        product: { id: "p-1", name: "Cola", description: null, priceCents: 2500, categoryId: null, status: "ACTIVE" as const, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      }];
    },
  } as unknown as ProductService;

  function makeCart(overrides: Partial<ProductCart> = {}): ProductCart {
    return {
      id: "cart-1", orderId: "ORD-1", agentUserId: "ag-1",
      hallId: "hall-a", shiftId: "shift-1", userType: "PHYSICAL",
      userId: null, username: null, totalCents: 5000,
      status: "CART_CREATED", lines: [
        { productId: "p-1", productName: "Cola", quantity: 2, unitPriceCents: 2500, lineTotalCents: 5000 },
      ],
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  const saleService = {
    async createCart(input: unknown) {
      spies.createCart.push(input as Record<string, unknown>);
      return makeCart();
    },
    async getCart(cartId: string) {
      if (cartId === "cart-other-agent") return makeCart({ id: "cart-other-agent", agentUserId: "ag-2" });
      if (cartId === "cart-placed") return makeCart({ status: "ORDER_PLACED" });
      return makeCart({ id: cartId });
    },
    async finalizeSale(input: unknown) {
      spies.finalize.push(input as Record<string, unknown>);
      const sale: ProductSale = {
        id: "sale-1", cartId: "cart-1", orderId: "ORD-1",
        hallId: "hall-a", shiftId: "shift-1", agentUserId: "ag-1",
        playerUserId: null, paymentMethod: "CASH", totalCents: 5000,
        walletTxId: null, agentTxId: "agenttx-1",
        createdAt: "2026-01-01T00:00:00Z",
      };
      return { sale, cart: makeCart({ status: "ORDER_PLACED" }) };
    },
    async cancelCart(cartId: string) {
      spies.cancel.push(cartId);
      return makeCart({ id: cartId, status: "CANCELLED" });
    },
    async listSalesForShift() { return []; },
  } as unknown as AgentProductSaleService;

  const app = express();
  app.use(express.json());
  app.use(createAgentProductsRouter({
    platformService,
    auditLogService,
    agentService,
    agentShiftService,
    productService,
    productSaleService: saleService,
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

test("B3.6: PLAYER blokkert fra agent-product-endepunkter", async () => {
  const ctx = await startServer({ users: { "pl-tok": playerUser } });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/agent/products", "pl-tok");
    assert.equal(list.status, 400);
    assert.equal(list.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("B3.6: ADMIN kan IKKE opprette cart (kun AGENT)", async () => {
  const ctx = await startServer({ users: { "admin-tok": adminUser } });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/products/carts", "admin-tok", {
      userType: "PHYSICAL", lines: [{ productId: "p-1", quantity: 1 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("B3.6: AGENT uten aktiv shift får NO_ACTIVE_SHIFT", async () => {
  const ctx = await startServer({
    users: { "ag-tok": agentUser },
    currentShift: null,
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/products", "ag-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "NO_ACTIVE_SHIFT");
  } finally { await ctx.close(); }
});

test("B3.6: AGENT lister hall-produkter (scoped til shift.hallId)", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/products", "ag-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallId, "hall-a");
    assert.equal(res.json.data.count, 1);
  } finally { await ctx.close(); }
});

test("B3.6: AGENT oppretter cart + audit med hallId+shiftId+totalCents", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/products/carts", "ag-tok", {
      userType: "PHYSICAL",
      lines: [{ productId: "p-1", quantity: 2 }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "cart-1");
    assert.equal(ctx.spies.createCart.length, 1);
    assert.equal(ctx.spies.createCart[0]!.agentUserId, "ag-1");

    const audit = await waitAudit(ctx.auditStore, "agent.product.cart.create") as { details: Record<string, unknown>; actorType: string };
    assert.ok(audit);
    assert.equal(audit.actorType, "AGENT");
    assert.equal(audit.details.hallId, "hall-a");
    assert.equal(audit.details.shiftId, "shift-1");
  } finally { await ctx.close(); }
});

test("B3.6: GET cart 403 for annen agents cart", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/products/carts/cart-other-agent", "ag-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("B3.6: POST finalize krever alle felter + audit logger paymentMethod", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const missing = await req(ctx.baseUrl, "POST", "/api/agent/products/carts/cart-1/finalize", "ag-tok", {});
    assert.equal(missing.status, 400);

    const ok = await req(ctx.baseUrl, "POST", "/api/agent/products/carts/cart-1/finalize", "ag-tok", {
      paymentMethod: "CASH",
      expectedTotalCents: 5000,
      clientRequestId: "req-1",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.sale.paymentMethod, "CASH");

    const audit = await waitAudit(ctx.auditStore, "agent.product.sale.finalize") as { details: Record<string, unknown> };
    assert.ok(audit);
    assert.equal(audit.details.paymentMethod, "CASH");
    assert.equal(audit.details.totalCents, 5000);
  } finally { await ctx.close(); }
});

test("B3.6: finalize avviser ugyldig paymentMethod", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/products/carts/cart-1/finalize", "ag-tok", {
      paymentMethod: "BITCOIN",
      expectedTotalCents: 5000,
      clientRequestId: "req-1",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally { await ctx.close(); }
});

test("B3.6: POST cancel + audit", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/products/carts/cart-1/cancel", "ag-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "CANCELLED");
    assert.deepEqual(ctx.spies.cancel, ["cart-1"]);
    const audit = await waitAudit(ctx.auditStore, "agent.product.cart.cancel");
    assert.ok(audit);
  } finally { await ctx.close(); }
});

test("B3.6: GET sales/current-shift tom uten aktiv shift", async () => {
  const ctx = await startServer({
    users: { "ag-tok": agentUser },
    currentShift: null,
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/products/sales/current-shift", "ag-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.shiftId, null);
    assert.equal(res.json.data.count, 0);
  } finally { await ctx.close(); }
});

test("B3.6: finalize validerer userType-input", async () => {
  const ctx = await startServer({ users: { "ag-tok": agentUser } });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/products/carts", "ag-tok", {
      userType: "INVALID",
      lines: [{ productId: "p-1", quantity: 1 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally { await ctx.close(); }
});
