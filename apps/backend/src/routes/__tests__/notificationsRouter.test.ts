/**
 * BIN-FCM: integration-tests for /api/notifications* og
 * /api/admin/notifications/broadcast.
 *
 * Bruker samme oppsett som playersRouter.test.ts — in-memory Fake-services
 * injisert via router-deps, ingen DB-container.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createNotificationsRouter } from "../notifications.js";
import { createAdminNotificationsRouter } from "../adminNotifications.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { FcmPushService } from "../../notifications/FcmPushService.js";
import type { NotificationPayload, SendResult, StoredNotification, UserDevice } from "../../notifications/types.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

function makeUser(overrides: Partial<PublicAppUser> = {}): PublicAppUser {
  return {
    id: "user-alice",
    email: "alice@test.no",
    displayName: "Alice",
    walletId: "wallet-alice",
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 1000,
    ...overrides,
  };
}

// ── Fakes ───────────────────────────────────────────────────────────────────

interface FakePushServiceState {
  devices: UserDevice[];
  notifications: StoredNotification[];
  broadcasts: Array<{ userIds: string[]; payload: NotificationPayload }>;
}

function makeFakePushService(): { service: FcmPushService; state: FakePushServiceState } {
  const state: FakePushServiceState = { devices: [], notifications: [], broadcasts: [] };
  let nextId = 1;
  const service: Partial<FcmPushService> = {
    async registerDevice(input) {
      const existing = state.devices.find((d) => d.firebaseToken === input.firebaseToken);
      const now = new Date().toISOString();
      if (existing) {
        existing.userId = input.userId;
        existing.deviceType = input.deviceType;
        existing.deviceLabel = input.deviceLabel ?? null;
        existing.isActive = true;
        existing.lastSeenAt = now;
        existing.updatedAt = now;
        return existing;
      }
      const device: UserDevice = {
        id: `dev-${nextId++}`,
        userId: input.userId,
        firebaseToken: input.firebaseToken,
        deviceType: input.deviceType,
        deviceLabel: input.deviceLabel ?? null,
        isActive: true,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      };
      state.devices.push(device);
      return device;
    },
    async unregisterDevice(token) {
      const d = state.devices.find((x) => x.firebaseToken === token && x.isActive);
      if (!d) return false;
      d.isActive = false;
      return true;
    },
    async unregisterDeviceById(id, userId) {
      const d = state.devices.find((x) => x.id === id && x.userId === userId && x.isActive);
      if (!d) return false;
      d.isActive = false;
      return true;
    },
    async listDevicesForUser(userId, opts) {
      const includeInactive = opts?.includeInactive === true;
      return state.devices
        .filter((d) => d.userId === userId && (includeInactive || d.isActive));
    },
    async listForUser(userId, opts) {
      const limit = opts?.limit ?? 50;
      const offset = opts?.offset ?? 0;
      const unreadOnly = opts?.unreadOnly ?? false;
      return state.notifications
        .filter((n) => n.userId === userId && (!unreadOnly || n.readAt === null))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(offset, offset + limit);
    },
    async markAsRead(id, userId) {
      const n = state.notifications.find((x) => x.id === id && x.userId === userId && x.readAt === null);
      if (!n) return false;
      n.readAt = new Date().toISOString();
      return true;
    },
    async markAllAsReadForUser(userId) {
      let count = 0;
      for (const n of state.notifications) {
        if (n.userId === userId && n.readAt === null) {
          n.readAt = new Date().toISOString();
          count += 1;
        }
      }
      return count;
    },
    async countUnreadForUser(userId) {
      return state.notifications.filter((n) => n.userId === userId && n.readAt === null).length;
    },
    async sendBulk(userIds, payload): Promise<SendResult> {
      state.broadcasts.push({ userIds, payload });
      const items = userIds.map((userId) => {
        const notification: StoredNotification = {
          id: `notif-${nextId++}`,
          userId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          data: payload.data ?? {},
          status: "sent",
          fcmMessageId: `fake-${nextId}`,
          errorMessage: null,
          sentAt: new Date().toISOString(),
          deliveredAt: null,
          readAt: null,
          createdAt: new Date().toISOString(),
        };
        state.notifications.push(notification);
        return {
          userId,
          notificationId: notification.id,
          status: "sent" as const,
          fcmMessageId: notification.fcmMessageId,
          errorMessage: null,
        };
      });
      return { sent: items.length, failed: 0, skipped: 0, items };
    },
    async sendToUser(userId, payload) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return service.sendBulk!([userId], payload);
    },
  };
  return { service: service as FcmPushService, state };
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

interface Ctx {
  baseUrl: string;
  state: FakePushServiceState;
  auditStore: InMemoryAuditLogStore;
  close: () => Promise<void>;
}

interface StartOpts {
  user?: PublicAppUser;
  adminUser?: PublicAppUser;
  hallPlayers?: Map<string, string[]>; // hallId → user-ids
  allPlayers?: string[];
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const userMap = new Map<string, PublicAppUser>();
  if (opts.user) userMap.set("player-token", opts.user);
  if (opts.adminUser) userMap.set("admin-token", opts.adminUser);

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const user = userMap.get(token);
      if (!user) throw new DomainError("UNAUTHORIZED", "bad token");
      return user;
    },
  } as unknown as PlatformService;

  const { service, state } = makeFakePushService();

  // Fake Pool for admin broadcast — only hall/all queries hit it.
  const fakePool = {
    async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
      if (/hall_id\s*=\s*\$1/.test(sql)) {
        const [hallId] = params as [string];
        const ids = opts.hallPlayers?.get(hallId) ?? [];
        return { rows: ids.map((id) => ({ id })) as unknown as T[], rowCount: ids.length };
      }
      if (/role\s*=\s*'PLAYER'\s+AND\s+deleted_at\s+IS\s+NULL\s*$/m.test(sql.trim())
        || /WHERE role = 'PLAYER'/.test(sql)) {
        const ids = opts.allPlayers ?? [];
        return { rows: ids.map((id) => ({ id })) as unknown as T[], rowCount: ids.length };
      }
      throw new Error(`notificationsRouter.test FakePool: unhandled SQL: ${sql.slice(0, 120)}`);
    },
  };

  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const app = express();
  app.use(express.json());
  app.use(createNotificationsRouter({ platformService, fcmPushService: service }));
  app.use(createAdminNotificationsRouter({
    platformService,
    fcmPushService: service,
    auditLogService,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: fakePool as any,
    schema: "public",
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state,
    auditStore,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(url: string, method: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("BIN-FCM: GET /api/notifications krever auth", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    const res = await req(`${ctx.baseUrl}/api/notifications`, "GET");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: GET /api/notifications returnerer spillerens varsler", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    // Seed to varsler via broadcast.
    await req(`${ctx.baseUrl}/api/notifications`, "GET", "player-token");
    ctx.state.notifications.push(
      {
        id: "n-1", userId: "user-alice", type: "bonus", title: "Hei", body: "Bonus!",
        data: {}, status: "sent", fcmMessageId: null, errorMessage: null,
        sentAt: "2026-04-23T10:00:00Z", deliveredAt: null, readAt: null,
        createdAt: "2026-04-23T10:00:00Z",
      },
      {
        id: "n-2", userId: "other-user", type: "bonus", title: "Ikke min", body: "x",
        data: {}, status: "sent", fcmMessageId: null, errorMessage: null,
        sentAt: "2026-04-23T11:00:00Z", deliveredAt: null, readAt: null,
        createdAt: "2026-04-23T11:00:00Z",
      },
    );
    const res = await req(`${ctx.baseUrl}/api/notifications`, "GET", "player-token");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 1);
    assert.equal(res.json.data[0].title, "Hei");
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: GET /api/notifications/unread/count returnerer ulest-tall", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    ctx.state.notifications.push(
      {
        id: "a", userId: "user-alice", type: "bonus", title: "1", body: "x",
        data: {}, status: "sent", fcmMessageId: null, errorMessage: null,
        sentAt: null, deliveredAt: null, readAt: null, createdAt: "2026-04-23T10:00:00Z",
      },
      {
        id: "b", userId: "user-alice", type: "bonus", title: "2", body: "x",
        data: {}, status: "sent", fcmMessageId: null, errorMessage: null,
        sentAt: null, deliveredAt: null, readAt: "2026-04-23T10:05:00Z", createdAt: "2026-04-23T09:00:00Z",
      },
    );
    const res = await req(`${ctx.baseUrl}/api/notifications/unread/count`, "GET", "player-token");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { count: 1 });
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: POST /api/notifications/:id/read markerer varsel som lest", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    ctx.state.notifications.push({
      id: "n-42", userId: "user-alice", type: "bonus", title: "1", body: "x",
      data: {}, status: "sent", fcmMessageId: null, errorMessage: null,
      sentAt: null, deliveredAt: null, readAt: null, createdAt: "2026-04-23T10:00:00Z",
    });
    const res = await req(`${ctx.baseUrl}/api/notifications/n-42/read`, "POST", "player-token");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { ok: true, updated: true });
    // Second call: already read.
    const res2 = await req(`${ctx.baseUrl}/api/notifications/n-42/read`, "POST", "player-token");
    assert.equal(res2.json.data.updated, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: POST /api/notifications/device registrerer FCM-token", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    const res = await req(`${ctx.baseUrl}/api/notifications/device`, "POST", "player-token", {
      firebaseToken: "tok-xyz",
      deviceType: "ios",
      deviceLabel: "iPhone 16",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.firebaseToken, "tok-xyz");
    assert.equal(res.json.data.deviceType, "ios");
    assert.equal(ctx.state.devices.length, 1);
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: POST /api/notifications/device avviser ugyldig deviceType", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    const res = await req(`${ctx.baseUrl}/api/notifications/device`, "POST", "player-token", {
      firebaseToken: "tok",
      deviceType: "desktop",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: DELETE /api/notifications/device via token", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    await req(`${ctx.baseUrl}/api/notifications/device`, "POST", "player-token", {
      firebaseToken: "tok",
      deviceType: "android",
    });
    const res = await req(`${ctx.baseUrl}/api/notifications/device`, "DELETE", "player-token", {
      firebaseToken: "tok",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { ok: true, updated: true });
    assert.equal(ctx.state.devices[0].isActive, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: DELETE /api/notifications/device/:id scoped til bruker", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    const reg = await req(`${ctx.baseUrl}/api/notifications/device`, "POST", "player-token", {
      firebaseToken: "tok",
      deviceType: "ios",
    });
    const id = reg.json.data.id;
    const res = await req(`${ctx.baseUrl}/api/notifications/device/${id}`, "DELETE", "player-token");
    assert.equal(res.status, 200);
    assert.equal(ctx.state.devices[0].isActive, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: GET /api/notifications/devices returnerer aktive devices", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    await req(`${ctx.baseUrl}/api/notifications/device`, "POST", "player-token", {
      firebaseToken: "active-tok",
      deviceType: "ios",
    });
    await req(`${ctx.baseUrl}/api/notifications/device`, "POST", "player-token", {
      firebaseToken: "stale-tok",
      deviceType: "android",
    });
    await req(`${ctx.baseUrl}/api/notifications/device`, "DELETE", "player-token", {
      firebaseToken: "stale-tok",
    });
    const res = await req(`${ctx.baseUrl}/api/notifications/devices`, "GET", "player-token");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 1);
    assert.equal(res.json.data[0].firebaseToken, "active-tok");
  } finally {
    await ctx.close();
  }
});

// ── Admin broadcast ────────────────────────────────────────────────────────

test("BIN-FCM: POST /api/admin/notifications/broadcast krever admin-rolle", async () => {
  const ctx = await startServer({ user: makeUser() });
  try {
    const res = await req(
      `${ctx.baseUrl}/api/admin/notifications/broadcast`,
      "POST",
      "player-token",
      { type: "admin-broadcast", title: "x", body: "y", userIds: ["u"] },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: broadcast til spesifikke userIds", async () => {
  const ctx = await startServer({
    user: makeUser(),
    adminUser: makeUser({ id: "admin-1", role: "ADMIN" }),
  });
  try {
    const res = await req(
      `${ctx.baseUrl}/api/admin/notifications/broadcast`,
      "POST",
      "admin-token",
      {
        type: "admin-broadcast",
        title: "Vedlikehold",
        body: "22:00-23:00 nede",
        userIds: ["u1", "u2", "u3"],
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.targets, 3);
    assert.equal(ctx.state.broadcasts.length, 1);
    assert.deepEqual(ctx.state.broadcasts[0].userIds, ["u1", "u2", "u3"]);
    // Audit-event skrevet.
    await new Promise((r) => setTimeout(r, 20));
    const events = await ctx.auditStore.list();
    const hit = events.find((e) => e.action === "notification.broadcast");
    assert.ok(hit, "forventet audit-event notification.broadcast");
    assert.equal(hit!.details.targets, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: broadcast til hall resolverer via pool", async () => {
  const hallPlayers = new Map<string, string[]>([
    ["hall-1", ["u1", "u2"]],
  ]);
  const ctx = await startServer({
    user: makeUser(),
    adminUser: makeUser({ id: "admin-1", role: "ADMIN" }),
    hallPlayers,
  });
  try {
    const res = await req(
      `${ctx.baseUrl}/api/admin/notifications/broadcast`,
      "POST",
      "admin-token",
      {
        type: "admin-broadcast",
        title: "Hall-beskjed",
        body: "Se info",
        hallId: "hall-1",
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.targets, 2);
    assert.deepEqual(ctx.state.broadcasts[0].userIds, ["u1", "u2"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: broadcast all=true krever confirm=true", async () => {
  const ctx = await startServer({
    user: makeUser(),
    adminUser: makeUser({ id: "admin-1", role: "ADMIN" }),
    allPlayers: ["u1", "u2", "u3"],
  });
  try {
    const res1 = await req(
      `${ctx.baseUrl}/api/admin/notifications/broadcast`,
      "POST",
      "admin-token",
      { type: "admin-broadcast", title: "x", body: "y", all: true },
    );
    assert.equal(res1.status, 400);
    assert.equal(res1.json.error.code, "CONFIRMATION_REQUIRED");

    const res2 = await req(
      `${ctx.baseUrl}/api/admin/notifications/broadcast`,
      "POST",
      "admin-token",
      { type: "admin-broadcast", title: "x", body: "y", all: true, confirm: true },
    );
    assert.equal(res2.status, 200);
    assert.equal(res2.json.data.targets, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: broadcast avviser ugyldig notification-type", async () => {
  const ctx = await startServer({
    user: makeUser(),
    adminUser: makeUser({ id: "admin-1", role: "ADMIN" }),
  });
  try {
    const res = await req(
      `${ctx.baseUrl}/api/admin/notifications/broadcast`,
      "POST",
      "admin-token",
      { type: "bogus", title: "x", body: "y", userIds: ["u"] },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-FCM: broadcast uten scope gir INVALID_INPUT", async () => {
  const ctx = await startServer({
    user: makeUser(),
    adminUser: makeUser({ id: "admin-1", role: "ADMIN" }),
  });
  try {
    const res = await req(
      `${ctx.baseUrl}/api/admin/notifications/broadcast`,
      "POST",
      "admin-token",
      { type: "admin-broadcast", title: "x", body: "y" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
