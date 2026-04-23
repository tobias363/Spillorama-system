/**
 * BIN-FCM: FcmPushService unit-tests.
 *
 * Bruker en FakePool som implementerer pg.Pool-surface med en in-memory
 * tabell-state. Det holder testene raske (ingen DB-container), og vi
 * slipper å mocke firebase-admin — vi sender inn en FcmTransporter-fake
 * direkte (mønster kopiert fra EmailService.test.ts).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  FcmPushService,
  type FcmMessage,
  type FcmSendResponse,
  type FcmTransporter,
} from "./FcmPushService.js";
import type { NotificationPayload } from "./types.js";

// ── FakePool ────────────────────────────────────────────────────────────────
//
// Minimalistisk mock som dekker SQL-ene FcmPushService skriver. Parser
// ikke SQL i sin helhet — matcher på nøkkelord + params-shape. Holder
// state i lokale Maps.

interface DeviceRow {
  id: string;
  user_id: string;
  firebase_token: string;
  device_type: string;
  device_label: string | null;
  is_active: boolean;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  status: string;
  fcm_message_id: string | null;
  error_message: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  created_at: Date;
}

class FakePool {
  devices = new Map<string, DeviceRow>();
  notifications = new Map<string, NotificationRow>();
  // Track queries for assertions.
  queries: Array<{ sql: string; params: unknown[] }> = [];

  async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });
    const s = sql.trim();

    // INSERT app_user_devices ON CONFLICT
    if (/INSERT INTO\s+"[^"]*"\."app_user_devices"/i.test(s)) {
      const [id, userId, token, deviceType, deviceLabel, now] = params as [
        string, string, string, string, string | null, Date,
      ];
      const existing = [...this.devices.values()].find((d) => d.firebase_token === token);
      if (existing) {
        existing.user_id = userId;
        existing.device_type = deviceType;
        existing.device_label = deviceLabel;
        existing.is_active = true;
        existing.last_seen_at = now;
        existing.updated_at = now;
        return { rows: [existing as unknown as T], rowCount: 1 };
      }
      const row: DeviceRow = {
        id, user_id: userId, firebase_token: token, device_type: deviceType,
        device_label: deviceLabel, is_active: true,
        last_seen_at: now, created_at: now, updated_at: now,
      };
      this.devices.set(id, row);
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    // UPDATE app_user_devices SET is_active=false WHERE firebase_token = $1 AND is_active = true
    if (/UPDATE\s+"[^"]*"\."app_user_devices"/i.test(s) && /firebase_token\s*=\s*\$1/.test(s)) {
      const [token] = params as [string];
      const d = [...this.devices.values()].find((x) => x.firebase_token === token && x.is_active);
      if (!d) return { rows: [], rowCount: 0 };
      d.is_active = false;
      d.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    // UPDATE app_user_devices WHERE id = $1 AND user_id = $2
    if (
      /UPDATE\s+"[^"]*"\."app_user_devices"/i.test(s) &&
      /id\s*=\s*\$1\s+AND\s+user_id\s*=\s*\$2/.test(s)
    ) {
      const [id, userId] = params as [string, string];
      const d = this.devices.get(id);
      if (!d || d.user_id !== userId || !d.is_active) return { rows: [], rowCount: 0 };
      d.is_active = false;
      d.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    // UPDATE app_user_devices SET last_seen_at = now() WHERE id = $1
    if (
      /UPDATE\s+"[^"]*"\."app_user_devices"/i.test(s) &&
      /last_seen_at\s*=\s*now\(\)/.test(s) &&
      /id\s*=\s*\$1/.test(s)
    ) {
      const [id] = params as [string];
      const d = this.devices.get(id);
      if (d) {
        d.last_seen_at = new Date();
        d.updated_at = new Date();
      }
      return { rows: [], rowCount: d ? 1 : 0 };
    }

    // SELECT ... FROM app_user_devices WHERE user_id = $1 [AND is_active = true]
    if (/SELECT[\s\S]*?FROM\s+"[^"]*"\."app_user_devices"/i.test(s) && /user_id\s*=\s*\$1/.test(s)) {
      const [userId] = params as [string];
      const filterActive = /AND\s+is_active\s*=\s*true/i.test(s);
      const rows = [...this.devices.values()]
        .filter((d) => d.user_id === userId && (!filterActive || d.is_active))
        .sort((a, b) => b.last_seen_at.getTime() - a.last_seen_at.getTime());
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }

    // INSERT app_notifications (pending)
    if (/INSERT INTO\s+"[^"]*"\."app_notifications"/i.test(s)) {
      const [id, userId, type, title, body, dataJson] = params as [
        string, string, string, string, string, string,
      ];
      const row: NotificationRow = {
        id, user_id: userId, type, title, body,
        data: JSON.parse(dataJson),
        status: "pending",
        fcm_message_id: null, error_message: null,
        sent_at: null, delivered_at: null, read_at: null,
        created_at: new Date(),
      };
      this.notifications.set(id, row);
      return { rows: [{ id } as unknown as T], rowCount: 1 };
    }

    // UPDATE app_notifications SET status='sent' ...
    if (
      /UPDATE\s+"[^"]*"\."app_notifications"/i.test(s) &&
      /status\s*=\s*'sent'/.test(s)
    ) {
      const [id, fcmMessageId] = params as [string, string | null];
      const n = this.notifications.get(id);
      if (n) {
        n.status = "sent";
        n.sent_at = new Date();
        n.fcm_message_id = fcmMessageId;
      }
      return { rows: [], rowCount: n ? 1 : 0 };
    }

    // UPDATE app_notifications SET status='failed' ...
    if (
      /UPDATE\s+"[^"]*"\."app_notifications"/i.test(s) &&
      /status\s*=\s*'failed'/.test(s)
    ) {
      const [id, errorMessage] = params as [string, string];
      const n = this.notifications.get(id);
      if (n) {
        n.status = "failed";
        n.error_message = errorMessage;
      }
      return { rows: [], rowCount: n ? 1 : 0 };
    }

    // UPDATE app_notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL
    if (
      /UPDATE\s+"[^"]*"\."app_notifications"/i.test(s) &&
      /read_at\s*=\s*now\(\)/.test(s) &&
      /id\s*=\s*\$1\s+AND\s+user_id\s*=\s*\$2/.test(s)
    ) {
      const [id, userId] = params as [string, string];
      const n = this.notifications.get(id);
      if (!n || n.user_id !== userId || n.read_at !== null) return { rows: [], rowCount: 0 };
      n.read_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    // UPDATE app_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL
    if (
      /UPDATE\s+"[^"]*"\."app_notifications"/i.test(s) &&
      /read_at\s*=\s*now\(\)/.test(s) &&
      /user_id\s*=\s*\$1\s+AND\s+read_at\s+IS\s+NULL/.test(s)
    ) {
      const [userId] = params as [string];
      let count = 0;
      for (const n of this.notifications.values()) {
        if (n.user_id === userId && n.read_at === null) {
          n.read_at = new Date();
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }

    // SELECT COUNT(*) FROM app_notifications ... unread — må komme FØR
    // generic-SELECT-branchen siden begge matcher "FROM app_notifications".
    if (/SELECT\s+COUNT/i.test(s) && /app_notifications/i.test(s)) {
      const [userId] = params as [string];
      const count = [...this.notifications.values()]
        .filter((n) => n.user_id === userId && n.read_at === null).length;
      return { rows: [{ c: String(count) } as unknown as T], rowCount: 1 };
    }

    // SELECT ... FROM app_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3
    if (/SELECT[\s\S]*?FROM\s+"[^"]*"\."app_notifications"/i.test(s) && /user_id\s*=\s*\$1/.test(s)) {
      const [userId, limit, offset] = params as [string, number, number];
      const unreadOnly = /AND\s+read_at\s+IS\s+NULL/.test(s);
      let rows = [...this.notifications.values()]
        .filter((n) => n.user_id === userId && (!unreadOnly || n.read_at === null))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      rows = rows.slice(offset, offset + limit);
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }

    throw new Error(`FakePool: unhandled SQL: ${s.slice(0, 160)}...`);
  }
}

function makeService(pool: FakePool, transporter?: FcmTransporter): FcmPushService {
  return new FcmPushService({
    pool: pool as unknown as Pool,
    schema: "public",
    config: transporter ? { credentials: { project_id: "test" }, projectId: "test" } : null,
    transporter,
    env: {},
  });
}

function createFakeTransporter(): {
  transporter: FcmTransporter;
  sent: FcmMessage[];
  setFailure(matcher: (msg: FcmMessage) => boolean, error: Error): void;
} {
  const sent: FcmMessage[] = [];
  let failMatcher: ((msg: FcmMessage) => boolean) | null = null;
  let failError: Error | null = null;
  const transporter: FcmTransporter = {
    async send(message: FcmMessage): Promise<FcmSendResponse> {
      if (failMatcher && failMatcher(message)) {
        throw failError ?? new Error("fake failure");
      }
      sent.push(message);
      return { messageId: `fake-${sent.length}` };
    },
  };
  return {
    transporter,
    sent,
    setFailure(matcher, error) {
      failMatcher = matcher;
      failError = error;
    },
  };
}

// ── isEnabled ───────────────────────────────────────────────────────────────

test("FcmPushService: disabled when no credentials", () => {
  const pool = new FakePool();
  const svc = makeService(pool);
  assert.equal(svc.isEnabled(), false);
});

test("FcmPushService: enabled when transporter supplied", () => {
  const pool = new FakePool();
  const { transporter } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  assert.equal(svc.isEnabled(), true);
});

// ── Device registration ────────────────────────────────────────────────────

test("FcmPushService: registerDevice creates new device row", async () => {
  const pool = new FakePool();
  const svc = makeService(pool);
  const device = await svc.registerDevice({
    userId: "user-1",
    firebaseToken: "tok-abc",
    deviceType: "ios",
    deviceLabel: "Kari's iPhone",
  });
  assert.equal(device.userId, "user-1");
  assert.equal(device.firebaseToken, "tok-abc");
  assert.equal(device.deviceType, "ios");
  assert.equal(device.isActive, true);
  assert.equal(pool.devices.size, 1);
});

test("FcmPushService: registerDevice dedups on firebase_token and updates user_id", async () => {
  const pool = new FakePool();
  const svc = makeService(pool);
  await svc.registerDevice({ userId: "user-1", firebaseToken: "shared-tok", deviceType: "android" });
  const d2 = await svc.registerDevice({ userId: "user-2", firebaseToken: "shared-tok", deviceType: "android" });
  assert.equal(pool.devices.size, 1, "samme token → ikke dupliser");
  assert.equal(d2.userId, "user-2", "siste registrator vinner");
});

test("FcmPushService: registerDevice rejects invalid deviceType", async () => {
  const pool = new FakePool();
  const svc = makeService(pool);
  await assert.rejects(
    svc.registerDevice({
      userId: "u", firebaseToken: "t",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deviceType: "desktop" as any,
    }),
    /deviceType/,
  );
});

test("FcmPushService: unregisterDevice flags is_active=false and preserves row", async () => {
  const pool = new FakePool();
  const svc = makeService(pool);
  await svc.registerDevice({ userId: "u", firebaseToken: "t1", deviceType: "ios" });
  const ok = await svc.unregisterDevice("t1");
  assert.equal(ok, true);
  const rows = [...pool.devices.values()];
  assert.equal(rows.length, 1, "rad er ikke slettet");
  assert.equal(rows[0].is_active, false);
  // Second unregister is a no-op.
  const ok2 = await svc.unregisterDevice("t1");
  assert.equal(ok2, false);
});

test("FcmPushService: listDevicesForUser filters inactive by default", async () => {
  const pool = new FakePool();
  const svc = makeService(pool);
  await svc.registerDevice({ userId: "u", firebaseToken: "t1", deviceType: "ios" });
  await svc.registerDevice({ userId: "u", firebaseToken: "t2", deviceType: "android" });
  await svc.unregisterDevice("t1");
  const active = await svc.listDevicesForUser("u");
  assert.equal(active.length, 1);
  assert.equal(active[0].firebaseToken, "t2");
  const all = await svc.listDevicesForUser("u", { includeInactive: true });
  assert.equal(all.length, 2);
});

test("FcmPushService: unregisterDeviceById is scoped to user_id", async () => {
  const pool = new FakePool();
  const svc = makeService(pool);
  const d1 = await svc.registerDevice({ userId: "user-a", firebaseToken: "ta", deviceType: "ios" });
  // Wrong user: should not disable.
  const result = await svc.unregisterDeviceById(d1.id, "user-b");
  assert.equal(result, false);
  assert.equal(pool.devices.get(d1.id)?.is_active, true);
  // Right user: works.
  const result2 = await svc.unregisterDeviceById(d1.id, "user-a");
  assert.equal(result2, true);
  assert.equal(pool.devices.get(d1.id)?.is_active, false);
});

// ── sendToUser / sendBulk ──────────────────────────────────────────────────

test("FcmPushService: sendToUser with no active devices marks notification as skipped", async () => {
  const pool = new FakePool();
  const { transporter, sent } = createFakeTransporter();
  const svc = makeService(pool, transporter);

  const result = await svc.sendToUser("no-devices-user", {
    type: "bonus",
    title: "Bonus",
    body: "Du har fått en bonus!",
  });
  assert.equal(result.skipped, 1);
  assert.equal(result.sent, 0);
  assert.equal(sent.length, 0, "ingen FCM-kall uten devices");
  // Raden skal finnes men være markert som failed/skipped.
  const rows = [...pool.notifications.values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "failed");
  assert.match(rows[0].error_message ?? "", /no active devices/);
});

test("FcmPushService: sendToUser fans out to all active devices", async () => {
  const pool = new FakePool();
  const { transporter, sent } = createFakeTransporter();
  const svc = makeService(pool, transporter);

  await svc.registerDevice({ userId: "u", firebaseToken: "t-phone", deviceType: "ios" });
  await svc.registerDevice({ userId: "u", firebaseToken: "t-tablet", deviceType: "ios" });
  await svc.registerDevice({ userId: "u", firebaseToken: "t-old", deviceType: "android" });
  await svc.unregisterDevice("t-old");

  const payload: NotificationPayload = {
    type: "game-start",
    title: "Spillet starter",
    body: "Om 5 min",
    data: { scheduledGameId: "game-1", minutesUntilStart: 5 },
  };
  const result = await svc.sendToUser("u", payload);

  assert.equal(result.sent, 1, "én notification-rad per bruker");
  assert.equal(sent.length, 2, "fan-out til to aktive devices");
  assert.ok(sent.some((m) => m.token === "t-phone"));
  assert.ok(sent.some((m) => m.token === "t-tablet"));
  assert.ok(sent.every((m) => m.notification.title === "Spillet starter"));
  // Data-payload stringifies JSON-values.
  assert.equal(sent[0].data?.scheduledGameId, "game-1");
  assert.equal(sent[0].data?.type, "game-start");

  // Notification-rad markert som sent.
  const rows = [...pool.notifications.values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "sent");
  assert.ok(rows[0].fcm_message_id?.startsWith("fake-"));
});

test("FcmPushService: sendBulk persists one notification per user", async () => {
  const pool = new FakePool();
  const { transporter, sent } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await svc.registerDevice({ userId: "u1", firebaseToken: "u1-tok", deviceType: "ios" });
  await svc.registerDevice({ userId: "u2", firebaseToken: "u2-tok", deviceType: "android" });
  await svc.registerDevice({ userId: "u3", firebaseToken: "u3-tok", deviceType: "web" });

  const result = await svc.sendBulk(["u1", "u2", "u3"], {
    type: "admin-broadcast",
    title: "Vedlikehold",
    body: "Systemet er nede 22:00-23:00",
  });

  assert.equal(result.sent, 3);
  assert.equal(sent.length, 3);
  assert.equal(pool.notifications.size, 3);
});

test("FcmPushService: sendBulk dedups userIds", async () => {
  const pool = new FakePool();
  const { transporter, sent } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await svc.registerDevice({ userId: "u", firebaseToken: "tok", deviceType: "ios" });

  const result = await svc.sendBulk(["u", "u", "u"], {
    type: "bonus",
    title: "x",
    body: "y",
  });
  assert.equal(result.sent, 1, "dupe user-id blir én send");
  assert.equal(sent.length, 1);
});

test("FcmPushService: FCM error marks notification as failed but doesn't throw", async () => {
  const pool = new FakePool();
  const { transporter, setFailure } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await svc.registerDevice({ userId: "u", firebaseToken: "tok-bad", deviceType: "ios" });
  setFailure(() => true, new Error("simulated FCM outage"));

  const result = await svc.sendToUser("u", { type: "bonus", title: "x", body: "y" });
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  const rows = [...pool.notifications.values()];
  assert.equal(rows[0].status, "failed");
  assert.match(rows[0].error_message ?? "", /FCM outage/);
});

test("FcmPushService: UNREGISTERED token auto-disables device", async () => {
  const pool = new FakePool();
  const { transporter, setFailure } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await svc.registerDevice({ userId: "u", firebaseToken: "tok-stale", deviceType: "ios" });
  // Simulate firebase-admin error format.
  const err = Object.assign(new Error("registration-token-not-registered"), {
    code: "messaging/registration-token-not-registered",
  });
  setFailure(() => true, err);

  await svc.sendToUser("u", { type: "bonus", title: "x", body: "y" });
  // Device should now be inactive.
  const devices = [...pool.devices.values()];
  assert.equal(devices[0].is_active, false);
});

test("FcmPushService: sendToUser in no-op mode (no transporter) records skipped", async () => {
  const pool = new FakePool();
  const svc = makeService(pool); // no transporter → disabled
  await svc.registerDevice({ userId: "u", firebaseToken: "tok", deviceType: "ios" });

  const result = await svc.sendToUser("u", { type: "bonus", title: "x", body: "y" });
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
  const rows = [...pool.notifications.values()];
  assert.equal(rows[0].status, "failed");
  assert.match(rows[0].error_message ?? "", /fcm disabled/);
});

test("FcmPushService: rejects invalid notification type", async () => {
  const pool = new FakePool();
  const { transporter } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await assert.rejects(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc.sendToUser("u", { type: "invalid-type" as any, title: "x", body: "y" }),
    /type må være/,
  );
});

test("FcmPushService: rejects missing title/body", async () => {
  const pool = new FakePool();
  const { transporter } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await assert.rejects(
    svc.sendToUser("u", { type: "bonus", title: "", body: "y" }),
    /title og body/,
  );
});

// ── Inbox ──────────────────────────────────────────────────────────────────

test("FcmPushService: listForUser returns newest first", async () => {
  const pool = new FakePool();
  const { transporter } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await svc.registerDevice({ userId: "u", firebaseToken: "tok", deviceType: "ios" });
  await svc.sendToUser("u", { type: "bonus", title: "first", body: "first" });
  await new Promise((r) => setTimeout(r, 5));
  await svc.sendToUser("u", { type: "bonus", title: "second", body: "second" });

  const items = await svc.listForUser("u");
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "second");
  assert.equal(items[1].title, "first");
});

test("FcmPushService: markAsRead sets read_at and is scoped to user", async () => {
  const pool = new FakePool();
  const { transporter } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await svc.registerDevice({ userId: "u", firebaseToken: "tok", deviceType: "ios" });
  await svc.sendToUser("u", { type: "bonus", title: "x", body: "y" });
  const [item] = await svc.listForUser("u");

  // Wrong user: no-op.
  const okWrong = await svc.markAsRead(item.id, "stranger");
  assert.equal(okWrong, false);

  const okRight = await svc.markAsRead(item.id, "u");
  assert.equal(okRight, true);

  // Second call: already read → no update.
  const okAgain = await svc.markAsRead(item.id, "u");
  assert.equal(okAgain, false);
});

test("FcmPushService: countUnreadForUser matches list filtered by unreadOnly", async () => {
  const pool = new FakePool();
  const { transporter } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await svc.registerDevice({ userId: "u", firebaseToken: "tok", deviceType: "ios" });
  await svc.sendToUser("u", { type: "bonus", title: "a", body: "a" });
  await svc.sendToUser("u", { type: "bonus", title: "b", body: "b" });
  await svc.sendToUser("u", { type: "bonus", title: "c", body: "c" });

  assert.equal(await svc.countUnreadForUser("u"), 3);
  const items = await svc.listForUser("u");
  await svc.markAsRead(items[0].id, "u");
  assert.equal(await svc.countUnreadForUser("u"), 2);
  const unreadList = await svc.listForUser("u", { unreadOnly: true });
  assert.equal(unreadList.length, 2);
});

test("FcmPushService: markAllAsReadForUser returns count of affected rows", async () => {
  const pool = new FakePool();
  const { transporter } = createFakeTransporter();
  const svc = makeService(pool, transporter);
  await svc.registerDevice({ userId: "u", firebaseToken: "tok", deviceType: "ios" });
  await svc.sendToUser("u", { type: "bonus", title: "a", body: "a" });
  await svc.sendToUser("u", { type: "bonus", title: "b", body: "b" });

  const count = await svc.markAllAsReadForUser("u");
  assert.equal(count, 2);
  assert.equal(await svc.countUnreadForUser("u"), 0);
  // Second call: everything already read.
  const again = await svc.markAllAsReadForUser("u");
  assert.equal(again, 0);
});
