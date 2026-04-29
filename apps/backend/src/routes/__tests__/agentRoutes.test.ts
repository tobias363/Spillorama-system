/**
 * BIN-583 B3.1: integrasjonstester for agent-router + adminAgents-router.
 *
 * Full express round-trip med stub av PlatformService. AgentService +
 * AgentShiftService er reelle instanser bak InMemoryAgentStore slik at
 * domene-logikken testes faktisk (hall-membership, shift-unique,
 * self-service-whitelist).
 *
 * Dekker 3 router-grupper:
 *   - agent-auth (login/logout/me/PUT me/change-password/change-avatar/update-language)
 *   - agent-shift (start/end/current/history)
 *   - admin-agents (list/POST/GET/:id/PUT/:id/DELETE/:id)
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentRouter } from "../agent.js";
import { createAdminAgentsRouter } from "../adminAgents.js";
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
import { DomainError } from "../../errors/DomainError.js";

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
  store: InMemoryAgentStore;
  auditStore: InMemoryAuditLogStore;
  // Test-hooks
  registerToken(token: string, user: PublicAppUser): void;
  registerPassword(userId: string, password: string): void;
  revokeToken(token: string): void;
  setPasswordChange(cb: (userId: string, newPassword: string) => void): void;
  softDeletedIds: string[];
  createdUsers: Array<{ email: string; role: UserRole; displayName: string }>;
}

async function startServer(initialSetup?: (ctx: {
  store: InMemoryAgentStore;
  registerToken: (token: string, user: PublicAppUser) => void;
  registerPassword: (userId: string, password: string) => void;
  seedAgentUser: (u: AppUser & { password?: string }) => void;
}) => Promise<void> | void): Promise<Ctx> {
  const store = new InMemoryAgentStore();
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tokenToUser = new Map<string, PublicAppUser>();
  const passwordsByUserId = new Map<string, string>();
  const softDeletedIds: string[] = [];
  const createdUsers: Array<{ email: string; role: UserRole; displayName: string }> = [];
  let passwordChangeHook: ((userId: string, pw: string) => void) | null = null;
  let nextUserId = 100;

  function seedAgentUser(u: AppUser & { password?: string }): void {
    store.seedAgent({
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
      surname: u.surname ?? "",
      phone: u.phone,
      language: "nb",
      agentStatus: "active",
    });
    if (u.password) passwordsByUserId.set(u.id, u.password);
  }

  const stubPlatform = {
    async login(input: { email: string; password: string }): Promise<SessionInfo> {
      const lower = input.email.toLowerCase();
      // Search known tokens + seeded agents in store
      for (const user of tokenToUser.values()) {
        if (user.email.toLowerCase() === lower) {
          const expectedPw = passwordsByUserId.get(user.id);
          if (!expectedPw || expectedPw !== input.password) {
            throw new DomainError("INVALID_CREDENTIALS", "Ugyldig e-post eller passord.");
          }
          const accessToken = `tok-${Math.random().toString(36).slice(2)}`;
          tokenToUser.set(accessToken, user);
          return {
            accessToken,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            user,
          };
        }
      }
      // Check store for agent email (set via createAgent)
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
        return {
          accessToken,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          user: publicUser,
        };
      }
      throw new DomainError("INVALID_CREDENTIALS", "Ugyldig e-post eller passord.");
    },
    async logout(token: string): Promise<void> {
      tokenToUser.delete(token);
    },
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const user = tokenToUser.get(token);
      if (!user) throw new DomainError("UNAUTHORIZED", "Ugyldig token.");
      return user;
    },
    async createAdminProvisionedUser(input: {
      email: string;
      password: string;
      displayName: string;
      surname: string;
      role: UserRole;
      phone?: string;
    }): Promise<AppUser> {
      const id = `user-${nextUserId++}`;
      createdUsers.push({ email: input.email, role: input.role, displayName: input.displayName });
      passwordsByUserId.set(id, input.password);
      store.seedAgent({
        userId: id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        phone: input.phone,
      });
      return {
        id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        phone: input.phone,
        walletId: `wallet-${id}`,
        role: input.role,
        hallId: null,
        kycStatus: "UNVERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async setUserPassword(userId: string, newPassword: string): Promise<void> {
      passwordsByUserId.set(userId, newPassword);
      passwordChangeHook?.(userId, newPassword);
    },
    async softDeletePlayer(userId: string): Promise<void> {
      softDeletedIds.push(userId);
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({ agentStore: store, agentService });

  if (initialSetup) {
    await initialSetup({
      store,
      registerToken: (token, user) => tokenToUser.set(token, user),
      registerPassword: (userId, pw) => passwordsByUserId.set(userId, pw),
      seedAgentUser,
    });
  }

  const app = express();
  app.use(express.json());
  app.use(createAgentRouter({ platformService, agentService, agentShiftService, auditLogService }));
  app.use(createAdminAgentsRouter({ platformService, agentService, agentShiftService, auditLogService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store,
    auditStore,
    registerToken: (token, user) => tokenToUser.set(token, user),
    registerPassword: (userId, pw) => passwordsByUserId.set(userId, pw),
    revokeToken: (token) => tokenToUser.delete(token),
    setPasswordChange: (cb) => { passwordChangeHook = cb; },
    softDeletedIds,
    createdUsers,
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

function publicAgentUser(overrides: Partial<PublicAppUser> & { id: string; email: string }): PublicAppUser {
  return {
    displayName: overrides.displayName ?? overrides.id,
    walletId: overrides.walletId ?? `wallet-${overrides.id}`,
    role: "AGENT",
    hallId: null,
    kycStatus: "UNVERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT AUTH
// ═══════════════════════════════════════════════════════════════════════════

test("POST /api/agent/auth/login — suksess med gyldig agent", async () => {
  const ctx = await startServer(async ({ registerToken, registerPassword, seedAgentUser }) => {
    void registerToken; void registerPassword;
    const u: AppUser = {
      id: "agent-1", email: "a@b.no", displayName: "Agent",
      walletId: "w", role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    };
    seedAgentUser({ ...u, password: "hunter2hunter2" });
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/auth/login", undefined, {
      email: "a@b.no", password: "hunter2hunter2",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(res.json.data.accessToken);
    assert.equal(res.json.data.user.role, "AGENT");
    assert.equal(res.json.data.agent.agentStatus, "active");
  } finally { await ctx.close(); }
});

test("POST /api/agent/auth/login — 400 for feil passord", async () => {
  const ctx = await startServer(async ({ seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "", password: "goodpassword123",
    });
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/auth/login", undefined, {
      email: "a@b.no", password: "wrongpass",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.code, "INVALID_CREDENTIALS");
  } finally { await ctx.close(); }
});

test("POST /api/agent/auth/login — 400 når agent_status=inactive", async () => {
  const ctx = await startServer(async ({ seedAgentUser, store }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "", password: "hunter2hunter2",
    });
    await store.updateAgentProfile("agent-1", { agentStatus: "inactive" });
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/auth/login", undefined, {
      email: "a@b.no", password: "hunter2hunter2",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "ACCOUNT_INACTIVE");
  } finally { await ctx.close(); }
});

test("GET /api/agent/auth/me — returnerer profil", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "Agent", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/auth/me", "t1");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.email, "a@b.no");
    assert.equal(res.json.data.role, "AGENT");
  } finally { await ctx.close(); }
});

test("GET /api/agent/auth/me — 400 uten token", async () => {
  const ctx = await startServer();
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/auth/me");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally { await ctx.close(); }
});

test("PUT /api/agent/auth/me — oppdaterer displayName", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "Old", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/agent/auth/me", "t1", {
      displayName: "New Name",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.displayName, "New Name");
  } finally { await ctx.close(); }
});

test("PUT /api/agent/auth/me — avviser hallIds i body", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/agent/auth/me", "t1", {
      hallIds: ["hall-a"],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("POST /api/agent/auth/change-password — krever gammelt passord", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "", password: "oldpass123",
    });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const okRes = await req(ctx.baseUrl, "POST", "/api/agent/auth/change-password", "t1", {
      oldPassword: "oldpass123", newPassword: "newpass1234",
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.json.data.changed, true);

    const failRes = await req(ctx.baseUrl, "POST", "/api/agent/auth/change-password", "t1", {
      oldPassword: "wrongold", newPassword: "xx",
    });
    assert.equal(failRes.status, 400);
    assert.equal(failRes.json.error.code, "INVALID_CREDENTIALS");
  } finally { await ctx.close(); }
});

test("POST /api/agent/auth/change-avatar — avviser ugyldig filnavn", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const ok = await req(ctx.baseUrl, "POST", "/api/agent/auth/change-avatar", "t1", {
      avatarFilename: "avatar-001.png",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.avatarFilename, "avatar-001.png");

    const fail = await req(ctx.baseUrl, "POST", "/api/agent/auth/change-avatar", "t1", {
      avatarFilename: "../etc/passwd",
    });
    assert.equal(fail.status, 400);
    assert.equal(fail.json.error.code, "INVALID_AVATAR_FILENAME");
  } finally { await ctx.close(); }
});

test("POST /api/agent/auth/update-language — whitelistede språk", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const ok = await req(ctx.baseUrl, "POST", "/api/agent/auth/update-language", "t1", {
      language: "en",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.language, "en");

    const fail = await req(ctx.baseUrl, "POST", "/api/agent/auth/update-language", "t1", {
      language: "klingon",
    });
    assert.equal(fail.status, 400);
    assert.equal(fail.json.error.code, "INVALID_LANGUAGE");
  } finally { await ctx.close(); }
});

test("POST /api/agent/auth/logout — invaliderer token", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const logout = await req(ctx.baseUrl, "POST", "/api/agent/auth/logout", "t1");
    assert.equal(logout.status, 200);
    assert.equal(logout.json.data.loggedOut, true);

    const after = await req(ctx.baseUrl, "GET", "/api/agent/auth/me", "t1");
    assert.equal(after.status, 400);
    assert.equal(after.json.error.code, "UNAUTHORIZED");
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENT SHIFT
// ═══════════════════════════════════════════════════════════════════════════

test("POST /api/agent/shift/start — happy path", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "agent-1", hallId: "hall-a", isPrimary: true });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/start", "t1", { hallId: "hall-a" });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.isActive, true);
    assert.equal(res.json.data.hallId, "hall-a");
  } finally { await ctx.close(); }
});

test("POST /api/agent/shift/start — HALL_NOT_ASSIGNED", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/start", "t1", { hallId: "hall-z" });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_NOT_ASSIGNED");
  } finally { await ctx.close(); }
});

test("POST /api/agent/shift/start — avviser når aktiv shift finnes", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "agent-1", hallId: "hall-a" });
    await store.insertShift({ userId: "agent-1", hallId: "hall-a" });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/start", "t1", { hallId: "hall-a" });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SHIFT_ALREADY_ACTIVE");
  } finally { await ctx.close(); }
});

test("POST /api/agent/shift/end + GET /current + /history", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "agent-1", hallId: "hall-a" });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    await req(ctx.baseUrl, "POST", "/api/agent/shift/start", "t1", { hallId: "hall-a" });
    const current = await req(ctx.baseUrl, "GET", "/api/agent/shift/current", "t1");
    assert.equal(current.status, 200);
    assert.ok(current.json.data.shift);
    assert.equal(current.json.data.shift.isActive, true);

    const end = await req(ctx.baseUrl, "POST", "/api/agent/shift/end", "t1");
    assert.equal(end.status, 200);
    assert.equal(end.json.data.isActive, false);

    const afterCurrent = await req(ctx.baseUrl, "GET", "/api/agent/shift/current", "t1");
    assert.equal(afterCurrent.json.data.shift, null);

    const history = await req(ctx.baseUrl, "GET", "/api/agent/shift/history?limit=10", "t1");
    assert.equal(history.status, 200);
    assert.equal(history.json.data.shifts.length, 1);
  } finally { await ctx.close(); }
});

test("POST /api/agent/shift/end — NO_ACTIVE_SHIFT", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "agent-1", email: "a@b.no", displayName: "A", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    registerToken("t1", publicAgentUser({ id: "agent-1", email: "a@b.no" }));
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/shift/end", "t1");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "NO_ACTIVE_SHIFT");
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN AGENTS
// ═══════════════════════════════════════════════════════════════════════════

const adminUser: PublicAppUser = {
  id: "admin-1", email: "admin@x.no", displayName: "Admin",
  walletId: "w-admin", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const operatorUser: PublicAppUser = { ...adminUser, id: "op-1", email: "op@x.no", role: "HALL_OPERATOR", hallId: "hall-a" };
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", email: "sup@x.no", role: "SUPPORT" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", email: "pl@x.no", role: "PLAYER" };

test("GET /api/admin/agents — ADMIN lister alle", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "a1", email: "a1@x.no", displayName: "Agent 1", walletId: "w1",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
    });
    seedAgentUser({
      id: "a2", email: "a2@x.no", displayName: "Agent 2", walletId: "w2",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
    });
    registerToken("admin-tok", adminUser);
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/agents", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.agents.length, 2);
  } finally { await ctx.close(); }
});

test("GET /api/admin/agents — PLAYER får 400 FORBIDDEN", async () => {
  const ctx = await startServer(async ({ registerToken }) => {
    registerToken("pl-tok", playerUser);
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/agents", "pl-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("GET /api/admin/agents — HALL_OPERATOR filtrerer til egen hall", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "a1", email: "a1@x.no", displayName: "A1 in-hall", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
    });
    seedAgentUser({
      id: "a2", email: "a2@x.no", displayName: "A2 other-hall", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "a1", hallId: "hall-a" });
    await store.assignHall({ userId: "a2", hallId: "hall-b" });
    registerToken("op-tok", operatorUser);
  });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/agents", "op-tok");
    assert.equal(res.status, 200);
    const ids = res.json.data.agents.map((a: { userId: string }) => a.userId).sort();
    assert.deepEqual(ids, ["a1"]);
  } finally { await ctx.close(); }
});

test("POST /api/admin/agents — ADMIN oppretter ny agent", async () => {
  const ctx = await startServer(async ({ registerToken }) => {
    registerToken("admin-tok", adminUser);
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/agents", "admin-tok", {
      email: "new-agent@x.no",
      password: "passwordpass123",
      displayName: "New Agent",
      surname: "Doe",
      hallIds: ["hall-a", "hall-b"],
      primaryHallId: "hall-a",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.email, "new-agent@x.no");
    assert.equal(res.json.data.halls.length, 2);
    const created = ctx.createdUsers.find((u) => u.email === "new-agent@x.no");
    assert.ok(created);
    assert.equal(created?.role, "AGENT");
  } finally { await ctx.close(); }
});

test("POST /api/admin/agents — HALL_OPERATOR må bruke egen hall", async () => {
  const ctx = await startServer(async ({ registerToken }) => {
    registerToken("op-tok", operatorUser);
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/agents", "op-tok", {
      email: "x@x.no", password: "passwordpass123",
      displayName: "X", surname: "Y",
      hallIds: ["hall-z"],  // not op's hall
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("PUT /api/admin/agents/:id — endrer hallIds", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "a1", email: "a1@x.no", displayName: "A1", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "a1", hallId: "hall-a", isPrimary: true });
    registerToken("admin-tok", adminUser);
  });
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/agents/a1", "admin-tok", {
      hallIds: ["hall-a", "hall-b"],
      primaryHallId: "hall-b",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.halls.length, 2);
    assert.equal(res.json.data.halls.find((h: { isPrimary: boolean }) => h.isPrimary).hallId, "hall-b");
  } finally { await ctx.close(); }
});

test("DELETE /api/admin/agents/:id — blokkerer med aktiv shift", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "a1", email: "a1@x.no", displayName: "A1", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "a1", hallId: "hall-a" });
    await store.insertShift({ userId: "a1", hallId: "hall-a" });
    registerToken("admin-tok", adminUser);
  });
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/agents/a1", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "AGENT_HAS_ACTIVE_SHIFT");
  } finally { await ctx.close(); }
});

test("DELETE /api/admin/agents/:id — soft-delete når ingen aktiv shift", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "a1", email: "a1@x.no", displayName: "A1", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
    });
    registerToken("admin-tok", adminUser);
  });
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/agents/a1", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.deleted, true);
    assert.deepEqual(ctx.softDeletedIds, ["a1"]);
    const after = await ctx.store.getAgentById("a1");
    assert.equal(after?.agentStatus, "inactive");
  } finally { await ctx.close(); }
});

test("DELETE /api/admin/agents/:id — SUPPORT får 400 FORBIDDEN (kun ADMIN)", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "a1", email: "a1@x.no", displayName: "A1", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
    });
    registerToken("sup-tok", supportUser);
  });
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/agents/a1", "sup-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("audit log inneholder agent.login + agent.shift.start/end", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "a1", email: "a1@x.no", displayName: "A1", walletId: "w",
      role: "AGENT", hallId: null, kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
      password: "passwordpass123",
    });
    await store.assignHall({ userId: "a1", hallId: "hall-a" });
    // Pre-register publicUser in the token-store so login returns it:
    registerToken("tmp", publicAgentUser({ id: "a1", email: "a1@x.no" }));
  });
  try {
    const login = await req(ctx.baseUrl, "POST", "/api/agent/auth/login", undefined, {
      email: "a1@x.no", password: "passwordpass123",
    });
    assert.equal(login.status, 200);
    const token = login.json.data.accessToken;
    await req(ctx.baseUrl, "POST", "/api/agent/shift/start", token, { hallId: "hall-a" });
    await req(ctx.baseUrl, "POST", "/api/agent/shift/end", token);
    // Fire-and-forget may need a tick to flush:
    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    const actions = events.map((e) => e.action);
    assert.ok(actions.includes("agent.login"));
    assert.ok(actions.includes("agent.shift.start"));
    assert.ok(actions.includes("agent.shift.end"));
    // Actor type skal være AGENT på disse eventene:
    const shiftStart = events.find((e) => e.action === "agent.shift.start");
    assert.equal(shiftStart?.actorType, "AGENT");
  } finally { await ctx.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PR #522 hotfix Issue 3 — Admin force-close route
// ═══════════════════════════════════════════════════════════════════════════

test("POST /api/admin/agents/:id/shift/force-close — ADMIN lukker stuck shift", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "stuck-agent", email: "stuck@x.no", displayName: "Stuck",
      walletId: "w", role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "stuck-agent", hallId: "hall-a" });
    await store.insertShift({ userId: "stuck-agent", hallId: "hall-a" });
    registerToken("admin-tok", adminUser);
  });
  try {
    const res = await req(
      ctx.baseUrl, "POST",
      "/api/admin/agents/stuck-agent/shift/force-close",
      "admin-tok",
      { reason: "Agent crashed; ops cleanup" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.forceClosed, true);
    assert.equal(res.json.data.shift.isActive, false);
    // Shift skal være lukket og logoutNotes skal inneholde force-close-prefix.
    const shift = await ctx.store.getActiveShiftForUser("stuck-agent");
    assert.equal(shift, null, "shift skal ikke lenger være aktiv");
  } finally { await ctx.close(); }
});

test("POST /api/admin/agents/:id/shift/force-close — uten reason → 400", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "stuck-agent", email: "stuck@x.no", displayName: "Stuck",
      walletId: "w", role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "stuck-agent", hallId: "hall-a" });
    await store.insertShift({ userId: "stuck-agent", hallId: "hall-a" });
    registerToken("admin-tok", adminUser);
  });
  try {
    const res = await req(
      ctx.baseUrl, "POST",
      "/api/admin/agents/stuck-agent/shift/force-close",
      "admin-tok",
      {},
    );
    assert.equal(res.status, 400);
  } finally { await ctx.close(); }
});

test("POST /api/admin/agents/:id/shift/force-close — uten aktiv shift → NO_ACTIVE_SHIFT", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser }) => {
    seedAgentUser({
      id: "no-shift-agent", email: "ns@x.no", displayName: "NS",
      walletId: "w", role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    registerToken("admin-tok", adminUser);
  });
  try {
    const res = await req(
      ctx.baseUrl, "POST",
      "/api/admin/agents/no-shift-agent/shift/force-close",
      "admin-tok",
      { reason: "test" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "NO_ACTIVE_SHIFT");
  } finally { await ctx.close(); }
});

test("POST /api/admin/agents/:id/shift/force-close — SUPPORT får 400 FORBIDDEN", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "stuck-agent", email: "stuck@x.no", displayName: "Stuck",
      walletId: "w", role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "stuck-agent", hallId: "hall-a" });
    await store.insertShift({ userId: "stuck-agent", hallId: "hall-a" });
    registerToken("sup-tok", supportUser);
  });
  try {
    const res = await req(
      ctx.baseUrl, "POST",
      "/api/admin/agents/stuck-agent/shift/force-close",
      "sup-tok",
      { reason: "support cleanup" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("POST /api/admin/agents/:id/shift/force-close — HALL_OPERATOR får 400 FORBIDDEN", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "stuck-agent", email: "stuck@x.no", displayName: "Stuck",
      walletId: "w", role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "stuck-agent", hallId: "hall-a" });
    await store.insertShift({ userId: "stuck-agent", hallId: "hall-a" });
    registerToken("op-tok", operatorUser);
  });
  try {
    const res = await req(
      ctx.baseUrl, "POST",
      "/api/admin/agents/stuck-agent/shift/force-close",
      "op-tok",
      { reason: "ops" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally { await ctx.close(); }
});

test("POST /api/admin/agents/:id/shift/force-close — audit-event admin.agent.shift.force_close skrevet", async () => {
  const ctx = await startServer(async ({ registerToken, seedAgentUser, store }) => {
    seedAgentUser({
      id: "stuck-agent", email: "stuck@x.no", displayName: "Stuck",
      walletId: "w", role: "AGENT", hallId: null, kycStatus: "UNVERIFIED",
      createdAt: "", updatedAt: "",
    });
    await store.assignHall({ userId: "stuck-agent", hallId: "hall-a" });
    await store.insertShift({ userId: "stuck-agent", hallId: "hall-a" });
    registerToken("admin-tok", adminUser);
  });
  try {
    const res = await req(
      ctx.baseUrl, "POST",
      "/api/admin/agents/stuck-agent/shift/force-close",
      "admin-tok",
      { reason: "Agent system crash; manual cleanup" },
    );
    assert.equal(res.status, 200);
    // Fire-and-forget audit; vent på flush.
    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    const evt = events.find((e) => e.action === "admin.agent.shift.force_close");
    assert.ok(evt, "audit-event admin.agent.shift.force_close skal skrives");
    assert.equal(evt?.actorId, "admin-1");
    assert.equal(evt?.actorType, "ADMIN");
    assert.equal(evt?.resource, "shift");
    assert.equal(
      (evt?.details as { reason?: string })?.reason,
      "Agent system crash; manual cleanup",
    );
    assert.equal(
      (evt?.details as { targetAgentId?: string })?.targetAgentId,
      "stuck-agent",
    );
  } finally { await ctx.close(); }
});
