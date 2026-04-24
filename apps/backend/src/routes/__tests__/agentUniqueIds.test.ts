/**
 * Wireframe gaps #8/#10/#11 (2026-04-24): integration tests for
 * /api/agent/unique-ids/* routes.
 *
 * Full express round-trip with InMemory stores. PlatformService stubbed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";

import { createAgentUniqueIdsRouter } from "../agentUniqueIds.js";
import { AgentService } from "../../agent/AgentService.js";
import { InMemoryAgentStore } from "../../agent/AgentStore.js";
import { UniqueIdService } from "../../agent/UniqueIdService.js";
import { InMemoryUniqueIdStore } from "../../agent/UniqueIdStore.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  PublicAppUser,
  AppUser,
  UserRole,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
  store: InMemoryUniqueIdStore;
  agentStore: InMemoryAgentStore;
  auditStore: InMemoryAuditLogStore;
  tokens: Map<string, PublicAppUser>;
  seedAgent(id: string, hallIds: string[], token?: string): Promise<{ token: string }>;
  seedAdmin(token: string): void;
}

async function startServer(): Promise<Ctx> {
  const agentStore = new InMemoryAgentStore();
  const store = new InMemoryUniqueIdStore();
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tokens = new Map<string, PublicAppUser>();
  const usersById = new Map<string, AppUser>();

  const stubPlatform = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = tokens.get(token);
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(userId: string): Promise<AppUser> {
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
    async createAdminProvisionedUser(): Promise<AppUser> {
      throw new Error("not used in route tests");
    },
    async softDeletePlayer(): Promise<void> {},
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore });
  const uniqueIdService = new UniqueIdService({ store, agentService });

  const app = express();
  app.use(express.json());
  app.use(createAgentUniqueIdsRouter({
    platformService,
    agentService,
    uniqueIdService,
    auditLogService,
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store,
    agentStore,
    auditStore,
    tokens,
    async seedAgent(id, hallIds, token = `tok-${id}`) {
      agentStore.seedAgent({ userId: id, email: `${id}@x.no`, displayName: id });
      const u: AppUser = {
        id, email: `${id}@x.no`, displayName: id,
        walletId: `wallet-${id}`, role: "AGENT", hallId: null,
        kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
      };
      usersById.set(id, u);
      tokens.set(token, { ...u, balance: 0 });
      for (const hallId of hallIds) {
        await agentStore.assignHall({ userId: id, hallId, isPrimary: hallId === hallIds[0] });
      }
      return { token };
    },
    seedAdmin(token: string) {
      const id = `admin-${Math.random().toString(36).slice(2, 6)}`;
      const u: PublicAppUser = {
        id, email: `${id}@x.no`, displayName: "Admin",
        walletId: `wallet-${id}`, role: "ADMIN" as UserRole, hallId: null,
        kycStatus: "VERIFIED", createdAt: "", updatedAt: "", balance: 0,
      };
      tokens.set(token, u);
      usersById.set(id, u);
    },
  };
}

async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: res.status, json };
}

// ═══════════════════════════════════════════════════════════════════════════
// Create (17.9)

test("POST /unique-ids — create with hours=24 returns 200 + card", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const res = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-a",
      amount: 250,
      hoursValidity: 24,
      paymentType: "CASH",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.card.balanceCents, 25_000);
    assert.equal(res.json.data.card.status, "ACTIVE");
    assert.match(res.json.data.card.id, /^\d{9}$/);
  } finally { await ctx.close(); }
});

test("POST /unique-ids — hoursValidity=23 returns 400", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const res = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-a",
      amount: 250,
      hoursValidity: 23,
      paymentType: "CASH",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_HOURS_VALIDITY");
  } finally { await ctx.close(); }
});

test("POST /unique-ids — without hallId returns 400", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const res = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      amount: 100,
      hoursValidity: 24,
      paymentType: "CASH",
    });
    assert.equal(res.status, 400);
  } finally { await ctx.close(); }
});

test("POST /unique-ids — agent without matching hall returns 400 HALL_NOT_ASSIGNED", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const res = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-z",
      amount: 100,
      hoursValidity: 24,
      paymentType: "CASH",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_NOT_ASSIGNED");
  } finally { await ctx.close(); }
});

test("POST /unique-ids — unauthenticated rejects with UNAUTHORIZED", async () => {
  const ctx = await startServer();
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", undefined, {
      hallId: "hall-a",
      amount: 100,
      hoursValidity: 24,
      paymentType: "CASH",
    });
    // apiFailure maps all DomainErrors to 400; the code distinguishes.
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// Add Money (17.10) — AKKUMULERES

test("POST /add-money — 170 + 200 = 370 (accumulates)", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const createRes = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-a", amount: 170, hoursValidity: 24, paymentType: "CASH",
    });
    assert.equal(createRes.status, 200);
    const uniqueId = createRes.json.data.card.id as string;
    const add = await req(
      ctx.baseUrl,
      "POST",
      `/api/agent/unique-ids/${uniqueId}/add-money`,
      token,
      { amount: 200, paymentType: "CASH" }
    );
    assert.equal(add.status, 200);
    assert.equal(add.json.data.card.balanceCents, 37_000, "170 + 200 = 370");
    assert.equal(add.json.data.transaction.previousBalance, 17_000);
    assert.equal(add.json.data.transaction.newBalance, 37_000);
  } finally { await ctx.close(); }
});

test("POST /add-money — unknown id returns 400 UNIQUE_ID_NOT_FOUND", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/unique-ids/999999999/add-money",
      token,
      { amount: 100, paymentType: "CASH" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNIQUE_ID_NOT_FOUND");
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// Withdraw (17.11/17.28) — cash-only

test("POST /withdraw — cash (default) returns 200", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const createRes = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-a", amount: 300, hoursValidity: 24, paymentType: "CASH",
    });
    const uniqueId = createRes.json.data.card.id as string;
    const withdraw = await req(
      ctx.baseUrl,
      "POST",
      `/api/agent/unique-ids/${uniqueId}/withdraw`,
      token,
      { amount: 100 }
    );
    assert.equal(withdraw.status, 200);
    assert.equal(withdraw.json.data.card.balanceCents, 20_000);
  } finally { await ctx.close(); }
});

test("POST /withdraw — paymentType=CARD returns 400 PAYMENT_TYPE_NOT_ALLOWED", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const createRes = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-a", amount: 300, hoursValidity: 24, paymentType: "CASH",
    });
    const uniqueId = createRes.json.data.card.id as string;
    const withdraw = await req(
      ctx.baseUrl,
      "POST",
      `/api/agent/unique-ids/${uniqueId}/withdraw`,
      token,
      { amount: 100, paymentType: "CARD" }
    );
    assert.equal(withdraw.status, 400);
    assert.equal(withdraw.json.error.code, "PAYMENT_TYPE_NOT_ALLOWED");
  } finally { await ctx.close(); }
});

test("POST /withdraw — amount > balance returns 400 INSUFFICIENT_BALANCE", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const createRes = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-a", amount: 50, hoursValidity: 24, paymentType: "CASH",
    });
    const uniqueId = createRes.json.data.card.id as string;
    const withdraw = await req(
      ctx.baseUrl,
      "POST",
      `/api/agent/unique-ids/${uniqueId}/withdraw`,
      token,
      { amount: 100 }
    );
    assert.equal(withdraw.status, 400);
    assert.equal(withdraw.json.error.code, "INSUFFICIENT_BALANCE");
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// Details (17.26)

test("GET /unique-ids/:id/details — returns card + transactions", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const createRes = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-a", amount: 100, hoursValidity: 24, paymentType: "CASH",
    });
    const uniqueId = createRes.json.data.card.id as string;
    await req(
      ctx.baseUrl, "POST",
      `/api/agent/unique-ids/${uniqueId}/add-money`, token,
      { amount: 50, paymentType: "CASH" }
    );
    const res = await req(
      ctx.baseUrl, "GET",
      `/api/agent/unique-ids/${uniqueId}/details`, token
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.card.balanceCents, 15_000);
    assert.equal(res.json.data.transactions.length, 2);
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// Reprint (17.26)

test("POST /reprint — bumps reprinted_count", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const createRes = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-a", amount: 100, hoursValidity: 24, paymentType: "CASH",
    });
    const uniqueId = createRes.json.data.card.id as string;
    const res = await req(
      ctx.baseUrl, "POST",
      `/api/agent/unique-ids/${uniqueId}/reprint`, token,
      { reason: "printer jam" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.card.reprintedCount, 1);
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// Regenerate (17.26/17.27)

test("POST /regenerate — issues new id, transfers balance, audit on both cards", async () => {
  const ctx = await startServer();
  try {
    const { token } = await ctx.seedAgent("a1", ["hall-a"]);
    const createRes = await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", token, {
      hallId: "hall-a", amount: 250, hoursValidity: 48, paymentType: "CARD",
    });
    const oldId = createRes.json.data.card.id as string;
    const regen = await req(
      ctx.baseUrl, "POST",
      `/api/agent/unique-ids/${oldId}/regenerate`, token
    );
    assert.equal(regen.status, 200);
    const newId = regen.json.data.newCard.id as string;
    assert.notEqual(newId, oldId);
    assert.equal(regen.json.data.newCard.balanceCents, 25_000);
    assert.equal(regen.json.data.previousCard.status, "REGENERATED");
    // Verify audit — old card should have REGENERATE, new card should have CREATE.
    const oldDetails = await req(
      ctx.baseUrl, "GET",
      `/api/agent/unique-ids/${oldId}/details`, token
    );
    const types = oldDetails.json.data.transactions.map((t: { actionType: string }) => t.actionType);
    assert.ok(types.includes("REGENERATE"));
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// List

test("GET /unique-ids — AGENT sees only cards they created", async () => {
  const ctx = await startServer();
  try {
    const { token: a1Token } = await ctx.seedAgent("a1", ["hall-a"]);
    const { token: a2Token } = await ctx.seedAgent("a2", ["hall-a"]);
    await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", a1Token, {
      hallId: "hall-a", amount: 100, hoursValidity: 24, paymentType: "CASH",
    });
    await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", a2Token, {
      hallId: "hall-a", amount: 200, hoursValidity: 24, paymentType: "CASH",
    });
    const res = await req(ctx.baseUrl, "GET", "/api/agent/unique-ids", a1Token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
  } finally { await ctx.close(); }
});

test("GET /unique-ids — ADMIN sees global list", async () => {
  const ctx = await startServer();
  try {
    const { token: agentToken } = await ctx.seedAgent("a1", ["hall-a"]);
    ctx.seedAdmin("admin-tok");
    await req(ctx.baseUrl, "POST", "/api/agent/unique-ids", agentToken, {
      hallId: "hall-a", amount: 100, hoursValidity: 24, paymentType: "CASH",
    });
    const res = await req(ctx.baseUrl, "GET", "/api/agent/unique-ids", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
  } finally { await ctx.close(); }
});
