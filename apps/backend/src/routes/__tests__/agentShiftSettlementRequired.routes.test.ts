/**
 * P0-2 (REGULATORISK — pengespillforskriften): integrasjonstester for
 * settlement-required-enforcement i shift-termination.
 *
 * Pengespillforskriften krever at agenten må fullføre Settlement Report
 * (POST /api/agent/shift/close-day) FØR skiftet kan termineres. Tre routes
 * konkurrerer om termination-flow:
 *   - POST /api/agent/shift/end          (legacy)
 *   - POST /api/agent/shift/logout       (Gap #9 — checkbox-flagg)
 *   - POST /api/agent/shift/close-day    (settlement-flyt — egen router)
 *
 * Disse testene verifiserer at /shift/end og /shift/logout fail-closed når
 * settlement-rad mangler, og lar termination passere når settlement finnes.
 *
 * Audit-event `agent.shift.terminate_blocked_no_settlement` skrives ved
 * blokkering (Lotteritilsynet-bevis).
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
import type { AgentSettlement } from "../../agent/AgentSettlementStore.js";
import type { AgentSettlementService } from "../../agent/AgentSettlementService.js";
import { DomainError } from "../../errors/DomainError.js";

/**
 * Minimal stub av AgentSettlementService — kun `getSettlementByShiftId` er
 * brukt av P0-2-enforcement. Returnerer settlement eller null avhengig av
 * seedet state. Andre metoder kaster (skal ikke kalles fra route-laget).
 */
class StubSettlementService {
  private readonly settlementsByShiftId = new Map<string, AgentSettlement>();

  seed(shiftId: string): void {
    // Minimum-shape — vi sjekker bare at noe finnes, ikke field-by-field.
    this.settlementsByShiftId.set(shiftId, {
      id: `settle-${shiftId}`,
      shiftId,
      agentUserId: "ag-1",
      hallId: "hall-a",
      businessDate: "2026-05-01",
      dailyBalanceAtStart: 0,
      dailyBalanceAtEnd: 0,
      reportedCashCount: 0,
      dailyBalanceDifference: 0,
      settlementToDropSafe: 0,
      withdrawFromTotalBalance: 0,
      totalDropSafe: 0,
      shiftCashInTotal: 0,
      shiftCashOutTotal: 0,
      shiftCardInTotal: 0,
      shiftCardOutTotal: 0,
      settlementNote: null,
      closedByUserId: "ag-1",
      isForced: false,
      editedByUserId: null,
      editedAt: null,
      editReason: null,
      otherData: {},
      machineBreakdown: [],
      bilagReceipt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as AgentSettlement);
  }

  async getSettlementByShiftId(shiftId: string): Promise<AgentSettlement | null> {
    return this.settlementsByShiftId.get(shiftId) ?? null;
  }
}

async function startServer(opts: { withSettlementService: boolean }) {
  const store = new InMemoryAgentStore();
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tokenToUser = new Map<string, PublicAppUser>();
  const passwordsByUserId = new Map<string, string>();
  const settlementStub = new StubSettlementService();

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
  });

  const app = express();
  app.use(express.json());
  // Conditional injection: med eller uten settlement-service for å verifisere
  // begge code-paths (legacy-modus uten enforcement vs prod-modus med).
  const routerDeps: Parameters<typeof createAgentRouter>[0] = {
    platformService, agentService, agentShiftService, auditLogService,
  };
  if (opts.withSettlementService) {
    routerDeps.agentSettlementService =
      settlementStub as unknown as AgentSettlementService;
  }
  app.use(createAgentRouter(routerDeps));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store, auditStore, settlementStub, passwordsByUserId, tokenToUser,
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
  const startRes = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/start", token, { hallId: "hall-a" });
  const shiftId = startRes.json.data.id;
  return { token, userId, shiftId };
}

// ── /shift/logout enforcement ─────────────────────────────────────────────

test("P0-2: POST /shift/logout uten settlement → 400 SETTLEMENT_REQUIRED_BEFORE_LOGOUT", async () => {
  const ctx = await startServer({ withSettlementService: true });
  try {
    const { token } = await seedAndLogin(ctx);
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {});
    assert.equal(res.status, 400, "skal returnere 400 ved manglende settlement");
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.code, "SETTLEMENT_REQUIRED_BEFORE_LOGOUT");
    assert.match(res.json.error.message, /Settlement|close-day/i);
  } finally { await ctx.close(); }
});

test("P0-2: POST /shift/logout med settlement → 200 OK", async () => {
  const ctx = await startServer({ withSettlementService: true });
  try {
    const { token, shiftId } = await seedAndLogin(ctx);
    ctx.settlementStub.seed(shiftId);
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {});
    assert.equal(res.status, 200, "skal passere når settlement finnes");
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.shift.isActive, false);
  } finally { await ctx.close(); }
});

// ── /shift/end enforcement ────────────────────────────────────────────────

test("P0-2: POST /shift/end uten settlement → 400 SETTLEMENT_REQUIRED_BEFORE_LOGOUT", async () => {
  const ctx = await startServer({ withSettlementService: true });
  try {
    const { token } = await seedAndLogin(ctx);
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/end", token);
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.code, "SETTLEMENT_REQUIRED_BEFORE_LOGOUT");
  } finally { await ctx.close(); }
});

test("P0-2: POST /shift/end med settlement → 200 OK", async () => {
  const ctx = await startServer({ withSettlementService: true });
  try {
    const { token, shiftId } = await seedAndLogin(ctx);
    ctx.settlementStub.seed(shiftId);
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/end", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.isActive, false);
  } finally { await ctx.close(); }
});

// ── Audit-event-bevis ─────────────────────────────────────────────────────

test("P0-2: blokkert /shift/logout skriver agent.shift.terminate_blocked_no_settlement", async () => {
  const ctx = await startServer({ withSettlementService: true });
  try {
    const { token, userId, shiftId } = await seedAndLogin(ctx);
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {});
    assert.equal(res.status, 400);

    // Audit-skriving er fire-and-forget — gi event-loopen et tick.
    await new Promise((r) => setImmediate(r));

    const logs = await ctx.auditStore.list({ limit: 50 });
    const blockEvent = logs.find(
      (l) => l.action === "agent.shift.terminate_blocked_no_settlement"
    );
    assert.ok(blockEvent, "audit-event for blokkering må skrives");
    assert.equal(blockEvent.actorId, userId);
    assert.equal(blockEvent.actorType, "AGENT");
    assert.equal(blockEvent.resource, "shift");
    assert.equal(blockEvent.resourceId, shiftId);
    assert.equal(
      (blockEvent.details as { attemptedRoute?: string })?.attemptedRoute,
      "POST /api/agent/shift/logout"
    );
  } finally { await ctx.close(); }
});

test("P0-2: blokkert /shift/end skriver audit-event med korrekt attemptedRoute", async () => {
  const ctx = await startServer({ withSettlementService: true });
  try {
    const { token } = await seedAndLogin(ctx);
    await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/end", token);
    await new Promise((r) => setImmediate(r));
    const logs = await ctx.auditStore.list({ limit: 50 });
    const blockEvent = logs.find(
      (l) => l.action === "agent.shift.terminate_blocked_no_settlement"
        && (l.details as { attemptedRoute?: string })?.attemptedRoute === "POST /api/agent/shift/end"
    );
    assert.ok(blockEvent, "audit-event for /shift/end-blokkering må skrives");
  } finally { await ctx.close(); }
});

// ── Backwards-compat: legacy-modus uten settlement-service ────────────────

test("P0-2: uten agentSettlementService injisert (legacy) — /shift/logout passerer (ingen enforcement)", async () => {
  const ctx = await startServer({ withSettlementService: false });
  try {
    const { token } = await seedAndLogin(ctx);
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {});
    assert.equal(res.status, 200, "uten service injisert skal route passere som før");
    assert.equal(res.json.data.shift.isActive, false);
  } finally { await ctx.close(); }
});

test("P0-2: uten agentSettlementService injisert (legacy) — /shift/end passerer", async () => {
  const ctx = await startServer({ withSettlementService: false });
  try {
    const { token } = await seedAndLogin(ctx);
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/end", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.isActive, false);
  } finally { await ctx.close(); }
});

// ── No-active-shift fortsatt fungerer som før ─────────────────────────────

test("P0-2: /shift/logout uten aktiv shift — fortsatt 400 NO_ACTIVE_SHIFT (ikke settlement-feil)", async () => {
  const ctx = await startServer({ withSettlementService: true });
  try {
    const userId = "ag-1";
    const email = "ag@x.no";
    const password = "passwordpass123";
    ctx.store.seedAgent({ userId, email, displayName: "Agent", surname: "Test" });
    ctx.passwordsByUserId.set(userId, password);
    const login = await reqJson(ctx.baseUrl, "POST", "/api/agent/auth/login", undefined, { email, password });
    const token = login.json.data.accessToken;
    const res = await reqJson(ctx.baseUrl, "POST", "/api/agent/shift/logout", token, {});
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "NO_ACTIVE_SHIFT",
      "NO_ACTIVE_SHIFT må sjekkes FØR settlement-enforcement");
  } finally { await ctx.close(); }
});
