/**
 * Integrasjonstester for agent-context-router (Agent-portal skeleton).
 *
 * Dekker GET /api/agent/context:
 *   - AGENT med tildelt hall → returnerer primærhall + agent-data
 *   - AGENT uten agent_profile → null halls (fail-open)
 *   - HALL_OPERATOR → tom assignedHalls (skeleton) + agent-meta
 *   - ADMIN/SUPPORT/PLAYER → FORBIDDEN
 *   - Ugyldig token → UNAUTHORIZED
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentContextRouter } from "../agentContext.js";
import { AgentService } from "../../agent/AgentService.js";
import { InMemoryAgentStore } from "../../agent/AgentStore.js";
import type {
  PublicAppUser,
  UserRole,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
  tokens: Map<string, PublicAppUser>;
  halls: Map<string, { id: string; name: string; slug: string; region: string }>;
  store: InMemoryAgentStore;
  seedUser(
    id: string,
    role: UserRole,
    token?: string
  ): { token: string };
  seedHall(id: string, name: string, slug?: string, region?: string): void;
}

async function startServer(): Promise<Ctx> {
  const store = new InMemoryAgentStore();
  const tokens = new Map<string, PublicAppUser>();
  const halls = new Map<string, { id: string; name: string; slug: string; region: string }>();

  const stubPlatform = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = tokens.get(token);
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getHall(hallId: string) {
      const h = halls.get(hallId);
      if (!h) throw new DomainError("HALL_NOT_FOUND", `hall ${hallId} not found`);
      return h;
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore: store });

  const app = express();
  app.use(express.json());
  app.use(
    createAgentContextRouter({
      platformService,
      agentService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    tokens,
    halls,
    store,
    seedUser(id, role, token = `tok-${id}`) {
      const u: PublicAppUser = {
        id,
        email: `${id}@x.no`,
        displayName: id,
        walletId: `wallet-${id}`,
        role,
        hallId: null,
        kycStatus: "VERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        balance: 0,
      };
      tokens.set(token, u);
      return { token };
    },
    seedHall(id, name, slug = id, region = "oslo") {
      halls.set(id, { id, name, slug, region });
    },
  };
}

async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response
  }
  return { status: res.status, json };
}

// ═══════════════════════════════════════════════════════════════════════════

test("GET /api/agent/context — AGENT med tildelt hall returnerer primærhall + agent-data", async () => {
  const ctx = await startServer();
  try {
    const { token } = ctx.seedUser("a1", "AGENT");
    ctx.seedHall("hall-a", "Hall A", "hall-a", "oslo");
    ctx.store.seedAgent({ userId: "a1", email: "a1@x.no", displayName: "a1" });
    await ctx.store.assignHall({ userId: "a1", hallId: "hall-a", isPrimary: true });

    const res = await req(ctx.baseUrl, "GET", "/api/agent/context", token);
    assert.equal(res.status, 200);
    const data = (res.json as { data: Record<string, unknown> }).data;
    assert.equal((data.agent as { userId: string }).userId, "a1");
    assert.equal((data.agent as { role: string }).role, "AGENT");
    assert.equal((data.hall as { id: string }).id, "hall-a");
    assert.equal((data.hall as { name: string }).name, "Hall A");
    const caps = data.capabilities as { canApprovePlayers: boolean };
    assert.equal(caps.canApprovePlayers, true);
    const assigned = data.assignedHalls as Array<{ id: string; isPrimary: boolean }>;
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0]!.id, "hall-a");
    assert.equal(assigned[0]!.isPrimary, true);
  } finally {
    await ctx.close();
  }
});

test("GET /api/agent/context — AGENT uten agent_profile fail-open med null hall", async () => {
  const ctx = await startServer();
  try {
    // Opprett AGENT-user UTEN å seede agent_profile i store.
    const { token } = ctx.seedUser("a2", "AGENT");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/context", token);
    assert.equal(res.status, 200);
    const data = (res.json as { data: Record<string, unknown> }).data;
    assert.equal(data.hall, null);
    assert.deepEqual(data.assignedHalls, []);
    assert.equal((data.agent as { role: string }).role, "AGENT");
  } finally {
    await ctx.close();
  }
});

test("GET /api/agent/context — HALL_OPERATOR returnerer tom assignedHalls + agent-meta", async () => {
  const ctx = await startServer();
  try {
    const { token } = ctx.seedUser("h1", "HALL_OPERATOR");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/context", token);
    assert.equal(res.status, 200);
    const data = (res.json as { data: Record<string, unknown> }).data;
    assert.equal((data.agent as { role: string }).role, "HALL_OPERATOR");
    // HALL_OPERATOR har ingen agent_profile-row — skeleton-endepunkt returnerer
    // tom assignedHalls inntil hall-assignment-wiring kommer i oppfølger-PR.
    assert.deepEqual(data.assignedHalls, []);
    const caps = data.capabilities as { canApprovePlayers: boolean };
    assert.equal(caps.canApprovePlayers, true);
  } finally {
    await ctx.close();
  }
});

// Merk: apiFailure returnerer HTTP 400 for alle DomainErrors og legger
// error-koden i body.error.code. Vi asserter på koden, ikke status-koden,
// for å matche resten av backend-test-harness-mønsteret.
function errorCode(json: unknown): string | undefined {
  return (json as { error?: { code?: string } })?.error?.code;
}

test("GET /api/agent/context — ADMIN får FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const { token } = ctx.seedUser("adm1", "ADMIN");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/context", token);
    assert.equal(res.status, 400);
    assert.equal(errorCode(res.json), "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /api/agent/context — SUPPORT får FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const { token } = ctx.seedUser("sup1", "SUPPORT");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/context", token);
    assert.equal(res.status, 400);
    assert.equal(errorCode(res.json), "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /api/agent/context — PLAYER får FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const { token } = ctx.seedUser("p1", "PLAYER");
    const res = await req(ctx.baseUrl, "GET", "/api/agent/context", token);
    assert.equal(res.status, 400);
    assert.equal(errorCode(res.json), "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /api/agent/context — ugyldig token → UNAUTHORIZED", async () => {
  const ctx = await startServer();
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/context", "invalid-token");
    assert.equal(res.status, 400);
    assert.equal(errorCode(res.json), "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("GET /api/agent/context — uten Authorization-header → UNAUTHORIZED", async () => {
  const ctx = await startServer();
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/context");
    assert.equal(res.status, 400);
    assert.equal(errorCode(res.json), "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});
