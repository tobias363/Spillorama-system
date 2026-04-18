/**
 * BIN-587 B5/B6: integrasjonstester for admin-users + schedule-bulk router.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminUsersRouter } from "../adminUsers.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import { EmailService } from "../../integration/EmailService.js";
import type { AuthTokenService } from "../../auth/AuthTokenService.js";
import type {
  PlatformService,
  PublicAppUser,
  AppUser,
  UserRole,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "a@test.no", displayName: "Admin",
  walletId: "w-a", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = { ...adminUser, id: "op-1", role: "HALL_OPERATOR", hallId: "hall-a" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function makeUser(overrides: Partial<AppUser> & { id: string; role: UserRole }): AppUser {
  return {
    id: overrides.id,
    email: overrides.email ?? `${overrides.id}@test.no`,
    displayName: overrides.displayName ?? overrides.id,
    walletId: overrides.walletId ?? `w-${overrides.id}`,
    role: overrides.role,
    hallId: overrides.hallId ?? null,
    surname: overrides.surname,
    phone: overrides.phone,
    kycStatus: overrides.kycStatus ?? "VERIFIED",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
  };
}

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    created: Array<{ email: string; role: UserRole }>;
    updated: Array<{ id: string; input: Record<string, unknown> }>;
    deleted: string[];
    resetTokens: Array<{ userId: string; token: string }>;
    scheduleCreated: Array<{ hallId: string; gameType: string }>;
    scheduleDeleted: string[];
  };
  usersById: Map<string, AppUser>;
  scheduleSlots: Array<{ id: string; hallId: string; dayOfWeek: number | null; gameType: string }>;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seedAppUsers: AppUser[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const usersById = new Map<string, AppUser>();
  for (const u of seedAppUsers) usersById.set(u.id, u);

  const created: Ctx["spies"]["created"] = [];
  const updated: Ctx["spies"]["updated"] = [];
  const deleted: string[] = [];
  const resetTokens: Ctx["spies"]["resetTokens"] = [];
  const scheduleCreated: Ctx["spies"]["scheduleCreated"] = [];
  const scheduleDeleted: string[] = [];
  const scheduleSlots: Ctx["scheduleSlots"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(id: string): Promise<AppUser> {
      const u = usersById.get(id);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
    async listAdminUsers(options?: { role?: UserRole; includeDeleted?: boolean; limit?: number }) {
      let list = [...usersById.values()].filter((u) => u.role !== "PLAYER");
      if (options?.role) list = list.filter((u) => u.role === options.role);
      return list;
    },
    async createAdminUser(input: { email: string; password: string; displayName: string; surname: string; role: UserRole; phone?: string; hallId?: string | null }) {
      if (input.role === "PLAYER") throw new DomainError("INVALID_INPUT", "not for players");
      created.push({ email: input.email, role: input.role });
      const id = `u-${usersById.size + 1}`;
      const user = makeUser({
        id, email: input.email, role: input.role,
        displayName: input.displayName, surname: input.surname,
        phone: input.phone, hallId: input.hallId ?? null,
      });
      usersById.set(id, user);
      return user;
    },
    async updateProfile(id: string, input: Record<string, unknown>) {
      const u = usersById.get(id);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      updated.push({ id, input });
      const next = { ...u, ...input };
      usersById.set(id, next);
      return next;
    },
    async softDeleteAdminUser(id: string) {
      const u = usersById.get(id);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      if (u.role === "PLAYER") throw new DomainError("INVALID_INPUT", "not for players");
      deleted.push(id);
    },
    async listScheduleSlots(_hallId: string) {
      return [...scheduleSlots];
    },
    async createScheduleSlot(hallId: string, input: { gameType: string; displayName: string; startTime: string; dayOfWeek?: number | null }) {
      scheduleCreated.push({ hallId, gameType: input.gameType });
      const slot = {
        id: `slot-${scheduleSlots.length + 1}`,
        hallId,
        gameType: input.gameType,
        displayName: input.displayName,
        startTime: input.startTime,
        dayOfWeek: input.dayOfWeek ?? null,
        prizeDescription: "",
        maxTickets: 30,
        isActive: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      scheduleSlots.push(slot);
      return slot;
    },
    async deleteScheduleSlot(slotId: string) {
      scheduleDeleted.push(slotId);
      const idx = scheduleSlots.findIndex((s) => s.id === slotId);
      if (idx >= 0) scheduleSlots.splice(idx, 1);
    },
  } as unknown as PlatformService;

  const emailService = new EmailService({
    transporter: { async sendMail() { return { messageId: "stub" }; } },
  });

  const authTokenService = {
    async createToken(_kind: "password-reset" | "email-verify", userId: string) {
      const token = `tok-${userId}-${Date.now()}`;
      resetTokens.push({ userId, token });
      return { token, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    },
  } as unknown as AuthTokenService;

  const app = express();
  app.use(express.json());
  app.use(createAdminUsersRouter({
    platformService,
    auditLogService,
    authTokenService,
    emailService,
    webBaseUrl: "https://test.example",
    supportEmail: "support@test.example",
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: {
      auditStore, created, updated, deleted, resetTokens,
      scheduleCreated, scheduleDeleted,
    },
    usersById,
    scheduleSlots,
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

async function waitForAudit(store: InMemoryAuditLogStore, action: string): Promise<PersistedAuditEvent | null> {
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

test("BIN-587 B6: SUPPORT + HALL_OPERATOR + PLAYER blokkert fra admin users-endepunkter", async () => {
  const ctx = await startServer({
    "sup-tok": supportUser, "op-tok": operatorUser, "pl-tok": playerUser,
  });
  try {
    for (const token of ["sup-tok", "op-tok", "pl-tok"]) {
      const res = await req(ctx.baseUrl, "GET", "/api/admin/users", token);
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: GET /api/admin/users filtrerer ut PLAYER-rollen", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [
      makeUser({ id: "u-admin", role: "ADMIN" }),
      makeUser({ id: "u-player", role: "PLAYER" }),
      makeUser({ id: "u-support", role: "SUPPORT" }),
    ]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/users", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
    const roles = res.json.data.users.map((u: { role: string }) => u.role).sort();
    assert.deepEqual(roles, ["ADMIN", "SUPPORT"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: GET /api/admin/users?role=SUPPORT filtrer", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [
      makeUser({ id: "u-admin", role: "ADMIN" }),
      makeUser({ id: "u-support", role: "SUPPORT" }),
    ]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/users?role=SUPPORT", "admin-tok");
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.users[0].role, "SUPPORT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: POST users oppretter + audit logger emailDomain", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/users", "admin-tok", {
      email: "newadmin@test.no",
      password: "SuperSecret12345!",
      displayName: "New Admin",
      surname: "Nyhansen",
      role: "ADMIN",
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.created[0]!.role, "ADMIN");

    const event = await waitForAudit(ctx.spies.auditStore, "admin.user.create");
    assert.ok(event);
    assert.equal(event!.details.role, "ADMIN");
    assert.equal(event!.details.emailDomain, "test.no");
    const serialized = JSON.stringify(event!.details);
    assert.ok(!serialized.includes("newadmin@test.no"));
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: POST users avviser PLAYER-rolle", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/users", "admin-tok", {
      email: "x@t.no", password: "x", displayName: "x", surname: "x", role: "PLAYER",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: GET /api/admin/users/:id avviser PLAYER", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "u-player", role: "PLAYER" })]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/users/u-player", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: PUT user oppdaterer felter + audit", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "u-sup", role: "SUPPORT" })]
  );
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/users/u-sup", "admin-tok", {
      displayName: "Ny Navn",
      phone: "+4712345678",
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.updated[0]!.input.displayName, "Ny Navn");

    const event = await waitForAudit(ctx.spies.auditStore, "admin.user.update");
    assert.ok(event);
    assert.deepEqual((event!.details.changed as string[]).sort(), ["displayName", "phone"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: DELETE user soft-delete + audit", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "u-op", role: "HALL_OPERATOR", hallId: "hall-a" })]
  );
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/users/u-op", "admin-tok");
    assert.equal(res.status, 200);
    assert.deepEqual(ctx.spies.deleted, ["u-op"]);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.user.soft_delete");
    assert.ok(event);
    assert.equal(event!.details.role, "HALL_OPERATOR");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: DELETE avviser PLAYER", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "u-player", role: "PLAYER" })]
  );
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/users/u-player", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: POST reset-password genererer token + audit", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "u-sup", role: "SUPPORT" })]
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/users/u-sup/reset-password", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.initiated, true);
    assert.equal(ctx.spies.resetTokens[0]!.userId, "u-sup");

    const event = await waitForAudit(ctx.spies.auditStore, "admin.user.reset_password_initiated");
    assert.ok(event);
    assert.equal(event!.details.targetRole, "SUPPORT");
    assert.equal(event!.resourceId, "u-sup");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: POST reset-password avviser PLAYER", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeUser({ id: "u-pl", role: "PLAYER" })]
  );
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/users/u-pl/reset-password", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
    assert.equal(ctx.spies.resetTokens.length, 0);
  } finally {
    await ctx.close();
  }
});

// ── Schedule bulk tests ──────────────────────────────────────────────────

test("BIN-587 B6: POST schedule/bulk oppretter slots + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/halls/hall-a/schedule/bulk", "admin-tok", {
      slots: [
        { gameType: "DATABINGO", displayName: "Morgen", startTime: "10:00", dayOfWeek: 1 },
        { gameType: "DATABINGO", displayName: "Ettermiddag", startTime: "15:00", dayOfWeek: 1 },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.created, 2);
    assert.equal(res.json.data.errors.length, 0);
    assert.equal(ctx.spies.scheduleCreated.length, 2);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.schedule.bulk_upsert");
    assert.ok(event);
    assert.equal(event!.details.created, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: POST schedule/bulk med replaceDayOfWeek sletter eksisterende", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  // Seed eksisterende slot på samme dag
  ctx.scheduleSlots.push({
    id: "old-slot-1", hallId: "hall-a", dayOfWeek: 1, gameType: "OLD",
  } as unknown as typeof ctx.scheduleSlots[number]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/halls/hall-a/schedule/bulk", "admin-tok", {
      replaceDayOfWeek: 1,
      slots: [
        { gameType: "DATABINGO", displayName: "Ny", startTime: "10:00", dayOfWeek: 1 },
      ],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(ctx.spies.scheduleDeleted, ["old-slot-1"]);
    assert.equal(res.json.data.created, 1);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: POST schedule/bulk samler feil per-slot", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/halls/hall-a/schedule/bulk", "admin-tok", {
      slots: [
        { gameType: "DATABINGO", displayName: "OK", startTime: "10:00", dayOfWeek: 1 },
        { gameType: "DATABINGO" }, // mangler displayName + startTime
        "not-an-object",
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.created, 1);
    assert.equal(res.json.data.errors.length, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: POST schedule/bulk avviser > 200 slots", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const slots = Array.from({ length: 201 }, (_, i) => ({
      gameType: "G", displayName: `S${i}`, startTime: "10:00",
    }));
    const res = await req(ctx.baseUrl, "POST", "/api/admin/halls/hall-a/schedule/bulk", "admin-tok", { slots });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: DELETE schedule/bulk?dayOfWeek sletter alle på dagen", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  ctx.scheduleSlots.push(
    { id: "s1", hallId: "hall-a", dayOfWeek: 2, gameType: "A" } as unknown as typeof ctx.scheduleSlots[number],
    { id: "s2", hallId: "hall-a", dayOfWeek: 2, gameType: "B" } as unknown as typeof ctx.scheduleSlots[number],
    { id: "s3", hallId: "hall-a", dayOfWeek: 3, gameType: "C" } as unknown as typeof ctx.scheduleSlots[number],
  );
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/halls/hall-a/schedule/bulk?dayOfWeek=2", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.deleted, 2);
    assert.deepEqual(ctx.spies.scheduleDeleted.sort(), ["s1", "s2"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: DELETE schedule/bulk krever dayOfWeek 0-6", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const noParam = await req(ctx.baseUrl, "DELETE", "/api/admin/halls/hall-a/schedule/bulk", "admin-tok");
    assert.equal(noParam.status, 400);

    const outOfRange = await req(ctx.baseUrl, "DELETE", "/api/admin/halls/hall-a/schedule/bulk?dayOfWeek=7", "admin-tok");
    assert.equal(outOfRange.status, 400);
    assert.equal(outOfRange.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B6: schedule/bulk krever HALL_WRITE — HALL_OPERATOR + SUPPORT blokkert", async () => {
  const ctx = await startServer({
    "op-tok": operatorUser, "sup-tok": supportUser,
  });
  try {
    for (const token of ["op-tok", "sup-tok"]) {
      const res = await req(
        ctx.baseUrl,
        "POST",
        "/api/admin/halls/hall-a/schedule/bulk",
        token,
        { slots: [] }
      );
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});
