/**
 * Role Management — integrasjonstester for admin-agent-permissions-router.
 *
 * Dekker begge endepunkter:
 *   GET /api/admin/agents/:agentId/permissions
 *   PUT /api/admin/agents/:agentId/permissions
 *
 * RBAC-sjekk: GET er ADMIN + SUPPORT, PUT er ADMIN-only.
 * In-memory PlatformService / AgentService / AgentPermissionService — ingen
 * Postgres eller DNS-oppslag.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminAgentPermissionsRouter } from "../adminAgentPermissions.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  AgentPermissionService,
  ModulePermission,
  SetModulePermissionInput,
} from "../../platform/AgentPermissionService.js";
import { AGENT_PERMISSION_MODULES } from "../../platform/AgentPermissionService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type { AgentService } from "../../agent/AgentService.js";
import type { AgentProfile } from "../../agent/AgentStore.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "admin@test.no",
  displayName: "Admin",
  walletId: "w-admin",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function makeAgentProfile(userId: string): AgentProfile {
  return {
    userId,
    email: `${userId}@test.no`,
    displayName: userId,
    surname: null,
    phone: null,
    role: "AGENT",
    agentStatus: "active",
    language: "nb",
    avatarFilename: null,
    parentUserId: null,
    halls: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  stored: Map<string, ModulePermission[]>;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  existingAgentIds: string[] = ["agent-1"]
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const stored = new Map<string, ModulePermission[]>();

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const agentService = {
    async getById(userId: string): Promise<AgentProfile> {
      if (!existingAgentIds.includes(userId)) {
        throw new DomainError("AGENT_NOT_FOUND", "Agenten finnes ikke.");
      }
      return makeAgentProfile(userId);
    },
  } as unknown as AgentService;

  const agentPermissionService = {
    async getPermissions(agentId: string): Promise<ModulePermission[]> {
      const existing = stored.get(agentId);
      if (existing) return existing.map((p) => ({ ...p }));
      // Samme default-regel som service-laget.
      return AGENT_PERMISSION_MODULES.map((module) => {
        if (module === "player") {
          return {
            module,
            canCreate: true,
            canEdit: true,
            canView: true,
            canDelete: true,
            canBlockUnblock: true,
            updatedAt: null,
            updatedBy: null,
          };
        }
        return {
          module,
          canCreate: false,
          canEdit: false,
          canView: false,
          canDelete: false,
          canBlockUnblock: false,
          updatedAt: null,
          updatedBy: null,
        };
      });
    },
    async setPermissions(
      agentId: string,
      inputs: SetModulePermissionInput[],
      adminUserId: string
    ): Promise<ModulePermission[]> {
      // Grunnleggende validering (match service-laget).
      if (!adminUserId.trim()) {
        throw new DomainError("INVALID_INPUT", "adminUserId er påkrevd.");
      }
      const seen = new Set<string>();
      for (const i of inputs) {
        if (!AGENT_PERMISSION_MODULES.includes(i.module)) {
          throw new DomainError("INVALID_INPUT", `ukjent modul ${i.module}`);
        }
        if (seen.has(i.module)) {
          throw new DomainError("INVALID_INPUT", `dupe ${i.module}`);
        }
        seen.add(i.module);
      }
      const next: ModulePermission[] = [];
      for (const m of AGENT_PERMISSION_MODULES) {
        const input = inputs.find((i) => i.module === m);
        if (input) {
          next.push({
            module: m,
            canCreate: input.canCreate ?? false,
            canEdit: input.canEdit ?? false,
            canView: input.canView ?? false,
            canDelete: input.canDelete ?? false,
            canBlockUnblock:
              m === "player" ? input.canBlockUnblock ?? false : false,
            updatedAt: new Date().toISOString(),
            updatedBy: adminUserId,
          });
        } else if (m === "player") {
          next.push({
            module: "player",
            canCreate: true,
            canEdit: true,
            canView: true,
            canDelete: true,
            canBlockUnblock: true,
            updatedAt: null,
            updatedBy: null,
          });
        } else {
          next.push({
            module: m,
            canCreate: false,
            canEdit: false,
            canView: false,
            canDelete: false,
            canBlockUnblock: false,
            updatedAt: null,
            updatedBy: null,
          });
        }
      }
      stored.set(agentId, next);
      return next.map((p) => ({ ...p }));
    },
  } as unknown as AgentPermissionService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminAgentPermissionsRouter({
      platformService,
      agentService,
      agentPermissionService,
      auditLogService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    auditStore,
    stored,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function jsonFetch(
  url: string,
  init: RequestInit
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, init);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

async function waitForAudit(
  store: InMemoryAuditLogStore,
  action: string
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

// ── GET endpoint tests ──────────────────────────────────────────────────────

test("GET returns full 15-module matrix for ADMIN", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      { headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const data = body.data as { agentId: string; permissions: ModulePermission[] };
    assert.equal(data.agentId, "agent-1");
    assert.equal(data.permissions.length, AGENT_PERMISSION_MODULES.length);
  } finally {
    await ctx.close();
  }
});

test("GET accessible by SUPPORT (AGENT_PERMISSION_READ)", async () => {
  const ctx = await startServer({ "tok-sup": supportUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      { headers: authHeaders("tok-sup") }
    );
    assert.equal(status, 200);
  } finally {
    await ctx.close();
  }
});

test("GET forbidden for HALL_OPERATOR", async () => {
  const ctx = await startServer({ "tok-op": operatorUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      { headers: authHeaders("tok-op") }
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

test("GET forbidden for PLAYER", async () => {
  const ctx = await startServer({ "tok-pl": playerUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      { headers: authHeaders("tok-pl") }
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

test("GET returns 404 for unknown agent", async () => {
  const ctx = await startServer({ "tok-admin": adminUser }, []);
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/ghost/permissions`,
      { headers: authHeaders("tok-admin") }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  } finally {
    await ctx.close();
  }
});

// ── PUT endpoint tests ──────────────────────────────────────────────────────

test("PUT updates full matrix for ADMIN", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const permissions = AGENT_PERMISSION_MODULES.map((module) => ({
      module,
      canCreate: true,
      canEdit: true,
      canView: true,
      canDelete: false,
      canBlockUnblock: module === "player",
    }));
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ permissions }),
      }
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const data = body.data as { permissions: ModulePermission[] };
    assert.equal(data.permissions.length, AGENT_PERMISSION_MODULES.length);
    // Alle skal være lagret.
    const stored = ctx.stored.get("agent-1");
    assert.ok(stored);
    const schedule = stored!.find((p) => p.module === "schedule");
    assert.equal(schedule!.canCreate, true);
    assert.equal(schedule!.canDelete, false);
  } finally {
    await ctx.close();
  }
});

test("PUT forbidden for SUPPORT (AGENT_PERMISSION_WRITE is ADMIN-only)", async () => {
  const ctx = await startServer({ "tok-sup": supportUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      {
        method: "PUT",
        headers: authHeaders("tok-sup"),
        body: JSON.stringify({ permissions: [] }),
      }
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

test("PUT forbidden for HALL_OPERATOR", async () => {
  const ctx = await startServer({ "tok-op": operatorUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      {
        method: "PUT",
        headers: authHeaders("tok-op"),
        body: JSON.stringify({ permissions: [] }),
      }
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

test("PUT rejects non-array permissions", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ permissions: "not-array" }),
      }
    );
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  } finally {
    await ctx.close();
  }
});

test("PUT rejects malformed entry (not object)", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ permissions: ["not-object"] }),
      }
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

test("PUT writes audit event with diff", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/agent-1/permissions`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({
          permissions: [
            { module: "schedule", canCreate: true, canView: true },
          ],
        }),
      }
    );
    const audit = await waitForAudit(ctx.auditStore, "agent.permissions.update");
    assert.ok(audit, "audit event må være logget");
    assert.equal(audit!.actorId, "admin-1");
    assert.equal(audit!.actorType, "ADMIN");
    assert.equal(audit!.resource, "agent");
    assert.equal(audit!.resourceId, "agent-1");
    const details = audit!.details as { diff: unknown[]; modulesChanged: number };
    assert.ok(Array.isArray(details.diff), "diff må være array");
    // schedule endret fra default-false til true for canCreate + canView
    const scheduleDiff = (details.diff as Array<{ module: string }>).find(
      (d) => d.module === "schedule"
    );
    assert.ok(scheduleDiff, "schedule-modulen må være med i diff");
  } finally {
    await ctx.close();
  }
});

test("PUT returns 404 for unknown agent", async () => {
  const ctx = await startServer({ "tok-admin": adminUser }, []);
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/agents/ghost/permissions`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ permissions: [] }),
      }
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});
