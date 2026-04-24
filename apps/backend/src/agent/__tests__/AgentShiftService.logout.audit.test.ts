/**
 * Wireframe Gap #9 (PDF 17.6): AgentShiftService.logout — audit-integrasjon via router.
 *
 * Dekker at `agent.shift.logout`-audit-entry inneholder:
 *   - actorType=AGENT, action=agent.shift.logout
 *   - details: flagg + counts + hasLogoutNotes
 *
 * Test-scoper kun via router (integrasjon), siden service-laget selv ikke
 * logger (router-laget eier audit-hook).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentRouter } from "../../routes/agent.js";
import { AgentService } from "../AgentService.js";
import { AgentShiftService } from "../AgentShiftService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
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
} from "../ports/ShiftLogoutPorts.js";

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
      const lower = input.email.toLowerCase();
      const agent = await store.getAgentByEmail(lower);
      if (agent) {
        const expectedPw = passwordsByUserId.get(agent.userId);
        if (!expectedPw || expectedPw !== input.password) {
          throw new DomainError("INVALID_CREDENTIALS", "Ugyldig e-post eller passord.");
        }
        const accessToken = `tok-${Math.random().toString(36).slice(2)}`;
        const publicUser: PublicAppUser = {
          id: agent.userId,
          email: agent.email,
          displayName: agent.displayName,
          walletId: `wallet-${agent.userId}`,
          role: "AGENT",
          hallId: null,
          kycStatus: "UNVERIFIED",
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
          balance: 0,
        };
        tokenToUser.set(accessToken, publicUser);
        return { accessToken, expiresAt: "", user: publicUser };
      }
      throw new DomainError("INVALID_CREDENTIALS", "Ugyldig e-post eller passord.");
    },
    async logout(token: string): Promise<void> { tokenToUser.delete(token); },
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const user = tokenToUser.get(token);
      if (!user) throw new DomainError("UNAUTHORIZED", "Ugyldig token.");
      return user;
    },
    async createAdminProvisionedUser(input: {
      email: string; password: string; displayName: string; surname: string; role: UserRole;
    }): Promise<AppUser> {
      const id = `agent-${Math.random().toString(36).slice(2, 8)}`;
      passwordsByUserId.set(id, input.password);
      store.seedAgent({
        userId: id, email: input.email, displayName: input.displayName,
        surname: input.surname,
      });
      return {
        id, email: input.email, displayName: input.displayName, surname: input.surname,
        walletId: `wallet-${id}`, role: input.role, hallId: null, kycStatus: "UNVERIFIED",
        createdAt: "", updatedAt: "",
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
    store,
    auditStore,
    pendingPayoutPort,
    ticketRangePort,
    passwordsByUserId,
    tokenToUser,
  };
}

async function req(baseUrl: string, method: string, path: string, token?: string, body?: unknown) {
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

async function loginAndStartShift(
  ctx: { baseUrl: string; store: InMemoryAgentStore; passwordsByUserId: Map<string, string> },
  userId = "a1",
  email = "a1@x.no",
  password = "passwordpass123",
  hallId = "hall-a"
) {
  ctx.store.seedAgent({ userId, email, displayName: "Agent", surname: "Test" });
  ctx.passwordsByUserId.set(userId, password);
  await ctx.store.assignHall({ userId, hallId });
  const login = await req(ctx.baseUrl, "POST", "/api/agent/auth/login", undefined, { email, password });
  const token = login.json.data.accessToken;
  await req(ctx.baseUrl, "POST", "/api/agent/shift/start", token, { hallId });
  return { token, userId, hallId };
}

test("agent.shift.logout audit inneholder flags + counts + hasLogoutNotes=false ved ingen notater", async () => {
  const ctx = await startServer();
  try {
    const { token, userId } = await loginAndStartShift(ctx);
    ctx.pendingPayoutPort.seed({
      id: "p1", ticketId: "tkt-1", hallId: "hall-a",
      scheduledGameId: "game-1", patternPhase: "row_1",
      expectedPayoutCents: 1000, color: "large",
      detectedAt: new Date().toISOString(), verifiedAt: null,
      adminApprovalRequired: false, responsibleUserId: userId,
      paidOutAt: null, rejectedAt: null, pendingForNextAgent: false,
    });

    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {
      distributeWinnings: true,
      transferRegisterTickets: false,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.shift.isActive, false);
    assert.equal(res.json.data.pendingCashoutsFlagged, 1);
    assert.equal(res.json.data.ticketRangesFlagged, 0);

    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    const logoutEvent = events.find((e) => e.action === "agent.shift.logout");
    assert.ok(logoutEvent, "agent.shift.logout audit-entry må eksistere");
    assert.equal(logoutEvent.actorType, "AGENT");
    assert.equal(logoutEvent.resource, "shift");
    assert.equal(logoutEvent.details?.distributeWinnings, true);
    assert.equal(logoutEvent.details?.transferRegisterTickets, false);
    assert.equal(logoutEvent.details?.pendingCashoutsFlagged, 1);
    assert.equal(logoutEvent.details?.ticketRangesFlagged, 0);
    assert.equal(logoutEvent.details?.hasLogoutNotes, false);
  } finally {
    await ctx.close();
  }
});

test("agent.shift.logout audit med begge flagg + notes logger hasLogoutNotes=true", async () => {
  const ctx = await startServer();
  try {
    const { token, userId } = await loginAndStartShift(ctx);
    ctx.ticketRangePort.seed({
      id: "r1", agentId: userId, hallId: "hall-a",
      closedAt: null, transferToNextAgent: false,
    });

    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {
      distributeWinnings: true,
      transferRegisterTickets: true,
      logoutNotes: "Overleverer til neste vakt med 1 range",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ticketRangesFlagged, 1);

    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    const logoutEvent = events.find((e) => e.action === "agent.shift.logout");
    assert.ok(logoutEvent);
    assert.equal(logoutEvent.details?.hasLogoutNotes, true);
    assert.equal(logoutEvent.details?.ticketRangesFlagged, 1);
  } finally {
    await ctx.close();
  }
});

test("backwards-compat: logout uten body fungerer = shift end med default-flagg", async () => {
  const ctx = await startServer();
  try {
    const { token } = await loginAndStartShift(ctx);
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/logout", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.shift.isActive, false);
    assert.equal(res.json.data.shift.distributedWinnings, false);
    assert.equal(res.json.data.shift.transferredRegisterTickets, false);
    assert.equal(res.json.data.pendingCashoutsFlagged, 0);
    assert.equal(res.json.data.ticketRangesFlagged, 0);

    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    const logoutEvent = events.find((e) => e.action === "agent.shift.logout");
    assert.ok(logoutEvent);
    assert.equal(logoutEvent.details?.distributeWinnings, false);
    assert.equal(logoutEvent.details?.transferRegisterTickets, false);
  } finally {
    await ctx.close();
  }
});
