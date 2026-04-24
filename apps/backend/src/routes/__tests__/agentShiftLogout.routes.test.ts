/**
 * Wireframe Gap #9 (PDF 17.6): Integrasjonstester for shift-logout-routes.
 *
 * Dekker:
 *   - POST /api/agent/shift/logout med/uten flagg
 *   - GET /api/agent/shift/pending-cashouts uten aktiv skift
 *   - GET /api/agent/shift/pending-cashouts med seedede rader
 *   - Backwards-compat: POST /api/agent/shift/end fortsatt fungerer
 *   - POST /api/agent/shift/logout feiler når ingen aktiv shift
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentRouter } from "../agent.js";
import { AgentService } from "../../agent/AgentService.js";
import { AgentShiftService } from "../../agent/AgentShiftService.js";
import { InMemoryAgentStore } from "../../agent/AgentStore.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  PublicAppUser,
  AppUser,
  SessionInfo,
  UserRole,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";
import {
  InMemoryShiftPendingPayoutPort,
  InMemoryShiftTicketRangePort,
} from "../../agent/ports/ShiftLogoutPorts.js";

async function startServer() {
  const store = new InMemoryAgentStore();
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const pendingPayoutPort = new InMemoryShiftPendingPayoutPort();
  const ticketRangePort = new InMemoryShiftTicketRangePort();
  const tokenToUser = new Map<string, PublicAppUser>();
  const passwordsByUserId = new Map<string, string>();

  const stubPlatform = {
    async login(input: { email: string; password: string }): Promise<SessionInfo> {
      const agent = await store.getAgentByEmail(input.email);
      if (agent) {
        const expectedPw = passwordsByUserId.get(agent.userId);
        if (!expectedPw || expectedPw !== input.password) {
          throw new DomainError("INVALID_CREDENTIALS", "Ugyldig e-post eller passord.");
        }
        const accessToken = `tok-${Math.random().toString(36).slice(2)}`;
        const publicUser: PublicAppUser = {
          id: agent.userId, email: agent.email, displayName: agent.displayName,
          walletId: `wallet-${agent.userId}`, role: "AGENT",
          hallId: null, kycStatus: "UNVERIFIED",
          createdAt: agent.createdAt, updatedAt: agent.updatedAt,
          balance: 0,
        };
        tokenToUser.set(accessToken, publicUser);
        return { accessToken, expiresAt: "", user: publicUser };
      }
      throw new DomainError("INVALID_CREDENTIALS", "Ugyldig e-post eller passord.");
    },
    async logout(token: string): Promise<void> { tokenToUser.delete(token); },
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = tokenToUser.get(token);
      if (!u) throw new DomainError("UNAUTHORIZED", "Ugyldig token.");
      return u;
    },
    async createAdminProvisionedUser(i: {
      email: string; password: string; displayName: string; surname: string; role: UserRole;
    }): Promise<AppUser> {
      const id = `a-${Math.random().toString(36).slice(2, 8)}`;
      passwordsByUserId.set(id, i.password);
      store.seedAgent({
        userId: id, email: i.email, displayName: i.displayName, surname: i.surname,
      });
      return {
        id, email: i.email, displayName: i.displayName, surname: i.surname,
        walletId: `wallet-${id}`, role: i.role, hallId: null,
        kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
      };
    },
    async setUserPassword(userId: string, pw: string): Promise<void> {
      passwordsByUserId.set(userId, pw);
    },
    async softDeletePlayer(): Promise<void> {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({
    agentStore: store,
    agentService,
    pendingPayoutPort,
    ticketRangePort,
  });

  const app = express();
  app.use(express.json());
  app.use(createAgentRouter({ platformService, agentService, agentShiftService, auditLogService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store, auditStore, pendingPayoutPort, ticketRangePort,
    passwordsByUserId, tokenToUser,
  };
}

async function reqJson(baseUrl: string, method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: res.status, json };
}

async function seedAndLogin(ctx: Awaited<ReturnType<typeof startServer>>) {
  const userId = "ag-1";
  const email = "ag@x.no";
  const password = "passwordpass123";
  ctx.store.seedAgent({ userId, email, displayName: "Agent", surname: "Test" });
  ctx.passwordsByUserId.set(userId, password);
  await ctx.store.assignHall({ userId, hallId: "hall-a" });
  const login = await reqJson(ctx.baseUrl, "POST", "/api/agent/auth/login", undefined, { email, password });
  const token = login.json.data.accessToken;
  await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/start", token, { hallId: "hall-a" });
  return { token, userId };
}

test("POST /api/agent/shift/logout — med distributeWinnings flagger pending rader", async () => {
  const ctx = await startServer();
  try {
    const { token, userId } = await seedAndLogin(ctx);
    ctx.pendingPayoutPort.seed({
      id: "p1", ticketId: "tkt-1", hallId: "hall-a",
      scheduledGameId: "game-1", patternPhase: "row_1",
      expectedPayoutCents: 5000, color: "small",
      detectedAt: new Date().toISOString(), verifiedAt: null,
      adminApprovalRequired: false, responsibleUserId: userId,
      paidOutAt: null, rejectedAt: null, pendingForNextAgent: false,
    });

    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {
      distributeWinnings: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.pendingCashoutsFlagged, 1);
    assert.equal(res.json.data.shift.distributedWinnings, true);
    const snap = ctx.pendingPayoutPort.snapshot();
    assert.equal(snap[0]?.pendingForNextAgent, true);
  } finally { await ctx.close(); }
});

test("POST /api/agent/shift/logout — med transferRegisterTickets flagger åpne ranges", async () => {
  const ctx = await startServer();
  try {
    const { token, userId } = await seedAndLogin(ctx);
    ctx.ticketRangePort.seed({
      id: "r1", agentId: userId, hallId: "hall-a",
      closedAt: null, transferToNextAgent: false,
    });

    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {
      transferRegisterTickets: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ticketRangesFlagged, 1);
    assert.equal(res.json.data.shift.transferredRegisterTickets, true);
    const snap = ctx.ticketRangePort.snapshot();
    assert.equal(snap[0]?.transferToNextAgent, true);
  } finally { await ctx.close(); }
});

test("POST /api/agent/shift/logout — backwards-compat uten body fungerer", async () => {
  const ctx = await startServer();
  try {
    const { token } = await seedAndLogin(ctx);
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/logout", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.shift.isActive, false);
    assert.equal(res.json.data.pendingCashoutsFlagged, 0);
    assert.equal(res.json.data.ticketRangesFlagged, 0);
  } finally { await ctx.close(); }
});

test("POST /api/agent/shift/logout — NO_ACTIVE_SHIFT uten aktiv shift", async () => {
  const ctx = await startServer();
  try {
    const userId = "ag-1";
    const email = "ag@x.no";
    const password = "passwordpass123";
    ctx.store.seedAgent({ userId, email, displayName: "Agent", surname: "Test" });
    ctx.passwordsByUserId.set(userId, password);
    const login = await reqJson(ctx.baseUrl, "POST", "/api/agent/auth/login", undefined, { email, password });
    const token = login.json.data.accessToken;
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {
      distributeWinnings: true,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "NO_ACTIVE_SHIFT");
  } finally { await ctx.close(); }
});

test("GET /api/agent/shift/pending-cashouts — liste pending cashouts for logout-modalen", async () => {
  const ctx = await startServer();
  try {
    const { token, userId } = await seedAndLogin(ctx);
    ctx.pendingPayoutPort.seed({
      id: "p-newest", ticketId: "t1", hallId: "hall-a",
      scheduledGameId: "g1", patternPhase: "row_1",
      expectedPayoutCents: 10000, color: "large",
      detectedAt: "2026-04-24T12:00:00.000Z", verifiedAt: null,
      adminApprovalRequired: false, responsibleUserId: userId,
      paidOutAt: null, rejectedAt: null, pendingForNextAgent: false,
    });
    ctx.pendingPayoutPort.seed({
      id: "p-older", ticketId: "t2", hallId: "hall-a",
      scheduledGameId: "g1", patternPhase: "row_2",
      expectedPayoutCents: 20000, color: "large",
      detectedAt: "2026-04-24T10:00:00.000Z", verifiedAt: null,
      adminApprovalRequired: false, responsibleUserId: userId,
      paidOutAt: null, rejectedAt: null, pendingForNextAgent: false,
    });
    ctx.pendingPayoutPort.seed({
      id: "p-other-agent", ticketId: "t3", hallId: "hall-a",
      scheduledGameId: "g1", patternPhase: "row_3",
      expectedPayoutCents: 30000, color: "large",
      detectedAt: new Date().toISOString(), verifiedAt: null,
      adminApprovalRequired: false, responsibleUserId: "other-agent",
      paidOutAt: null, rejectedAt: null, pendingForNextAgent: false,
    });

    const res = await reqJson(ctx.baseUrl, "GET", "/api/agent/shift/pending-cashouts", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2, "må kun returnere egne pending (2, ikke 3)");
    const items = res.json.data.pendingCashouts as Array<{ id: string }>;
    assert.equal(items[0]!.id, "p-newest", "sortert DESC på detectedAt");
    assert.equal(items[1]!.id, "p-older");
  } finally { await ctx.close(); }
});

test("GET /api/agent/shift/pending-cashouts — tom liste uten pending", async () => {
  const ctx = await startServer();
  try {
    const { token } = await seedAndLogin(ctx);
    const res = await reqJson(ctx.baseUrl, "GET", "/api/agent/shift/pending-cashouts", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 0);
    assert.deepEqual(res.json.data.pendingCashouts, []);
  } finally { await ctx.close(); }
});

test("backwards-compat: POST /api/agent/shift/end fortsatt fungerer", async () => {
  const ctx = await startServer();
  try {
    const { token } = await seedAndLogin(ctx);
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/end", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.isActive, false);
    // distributedWinnings/transferredRegisterTickets skal være false ved rent /end.
    assert.equal(res.json.data.distributedWinnings, false);
    assert.equal(res.json.data.transferredRegisterTickets, false);
  } finally { await ctx.close(); }
});
