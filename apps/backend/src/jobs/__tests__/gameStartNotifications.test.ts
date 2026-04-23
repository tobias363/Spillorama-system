/**
 * BIN-FCM: gameStartNotifications cron-tester.
 *
 * Verifiserer at cronen:
 *   - plukker rader innen notification-vinduet og hopper over rader
 *     utenfor vinduet
 *   - dedup-er via eksisterende 'game-start'-rader i app_notifications
 *   - kaller sendBulk med spillerne i deltagende haller
 *   - håndterer manglende tabeller (42P01) uten å krasje scheduler-loopen
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createGameStartNotificationsJob } from "../gameStartNotifications.js";
import type { FcmPushService } from "../../notifications/FcmPushService.js";
import type { NotificationPayload, SendResult } from "../../notifications/types.js";

interface ScheduledGame {
  id: string;
  sub_game_name: string;
  custom_game_name: string | null;
  scheduled_start_time: Date;
  notification_start_seconds: number;
  participating_halls_json: unknown;
}

interface FakePoolState {
  scheduledGames: ScheduledGame[];
  dedupeRows: Array<{ scheduledGameId: string; createdAt: Date }>;
  usersByHall: Map<string, string[]>;
  throwOnQuery: { sql: RegExp; code: string } | null;
}

function makeFakePool(state: FakePoolState): Pool {
  const pool = {
    async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
      if (state.throwOnQuery && state.throwOnQuery.sql.test(sql)) {
        const err = new Error("simulated pg error") as Error & { code?: string };
        err.code = state.throwOnQuery.code;
        throw err;
      }

      // Pending games query
      if (/FROM\s+"[^"]*"\."app_game1_scheduled_games"/i.test(sql)) {
        const now = Date.now();
        const rows = state.scheduledGames.filter((g) => {
          if (g.scheduled_start_time.getTime() <= now) return false;
          const threshold = g.scheduled_start_time.getTime() - g.notification_start_seconds * 1000;
          if (threshold > now) return false;
          const alreadySent = state.dedupeRows.some(
            (r) => r.scheduledGameId === g.id && r.createdAt.getTime() >= now - 24 * 3600 * 1000,
          );
          if (alreadySent) return false;
          return true;
        });
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }

      // Recipient-query
      if (/FROM\s+"[^"]*"\."app_users"/i.test(sql)) {
        const [hallIds] = params as [string[]];
        const users = new Set<string>();
        for (const hallId of hallIds) {
          for (const id of state.usersByHall.get(hallId) ?? []) users.add(id);
        }
        const rows = [...users].map((id) => ({ id }));
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }

      throw new Error(`gameStartNotifications.test FakePool: unhandled SQL: ${sql.slice(0, 120)}`);
    },
  };
  return pool as unknown as Pool;
}

function makeFakePushService(): {
  service: FcmPushService;
  calls: Array<{ userIds: string[]; payload: NotificationPayload }>;
} {
  const calls: Array<{ userIds: string[]; payload: NotificationPayload }> = [];
  const service: Partial<FcmPushService> = {
    async sendBulk(userIds, payload): Promise<SendResult> {
      calls.push({ userIds: [...userIds], payload });
      return {
        sent: userIds.length,
        failed: 0,
        skipped: 0,
        items: userIds.map((userId) => ({
          userId,
          notificationId: `n-${userId}`,
          status: "sent" as const,
          fcmMessageId: `fake`,
          errorMessage: null,
        })),
      };
    },
  };
  return { service: service as FcmPushService, calls };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("BIN-FCM cron: sender til deltagende halls spillere når spill er innen vinduet", async () => {
  const now = Date.now();
  const state: FakePoolState = {
    scheduledGames: [
      {
        id: "game-1",
        sub_game_name: "Kveldsbingo",
        custom_game_name: null,
        scheduled_start_time: new Date(now + 3 * 60_000), // 3 min frem
        notification_start_seconds: 5 * 60, // 5 min vindu → innen
        participating_halls_json: ["hall-A", "hall-B"],
      },
    ],
    dedupeRows: [],
    usersByHall: new Map([
      ["hall-A", ["u1", "u2"]],
      ["hall-B", ["u3"]],
    ]),
    throwOnQuery: null,
  };
  const pool = makeFakePool(state);
  const { service, calls } = makeFakePushService();
  const job = createGameStartNotificationsJob({
    pool, schema: "public", fcmPushService: service,
  });

  const result = await job(now);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].userIds.sort(), ["u1", "u2", "u3"]);
  assert.equal(calls[0].payload.type, "game-start");
  assert.match(calls[0].payload.body, /Kveldsbingo/);
  assert.equal(calls[0].payload.data?.scheduledGameId, "game-1");
  assert.ok(result.itemsProcessed > 0);
});

test("BIN-FCM cron: hopper over spill utenfor notification-vinduet", async () => {
  const now = Date.now();
  const state: FakePoolState = {
    scheduledGames: [
      {
        id: "far-future",
        sub_game_name: "Neste uke",
        custom_game_name: null,
        scheduled_start_time: new Date(now + 7 * 24 * 3600 * 1000),
        notification_start_seconds: 5 * 60,
        participating_halls_json: ["hall-A"],
      },
    ],
    dedupeRows: [],
    usersByHall: new Map([["hall-A", ["u1"]]]),
    throwOnQuery: null,
  };
  const pool = makeFakePool(state);
  const { service, calls } = makeFakePushService();
  const job = createGameStartNotificationsJob({ pool, schema: "public", fcmPushService: service });
  const result = await job(now);
  assert.equal(calls.length, 0);
  assert.equal(result.itemsProcessed, 0);
});

test("BIN-FCM cron: dedup via app_notifications-historikk", async () => {
  const now = Date.now();
  const state: FakePoolState = {
    scheduledGames: [
      {
        id: "already-sent",
        sub_game_name: "Spillet",
        custom_game_name: null,
        scheduled_start_time: new Date(now + 2 * 60_000),
        notification_start_seconds: 5 * 60,
        participating_halls_json: ["hall-A"],
      },
    ],
    dedupeRows: [{ scheduledGameId: "already-sent", createdAt: new Date(now - 60_000) }],
    usersByHall: new Map([["hall-A", ["u1"]]]),
    throwOnQuery: null,
  };
  const pool = makeFakePool(state);
  const { service, calls } = makeFakePushService();
  const job = createGameStartNotificationsJob({ pool, schema: "public", fcmPushService: service });
  await job(now);
  assert.equal(calls.length, 0);
});

test("BIN-FCM cron: håndterer manglende tabell (42P01) uten å kaste", async () => {
  const state: FakePoolState = {
    scheduledGames: [],
    dedupeRows: [],
    usersByHall: new Map(),
    throwOnQuery: { sql: /FROM\s+"[^"]*"\."app_game1_scheduled_games"/i, code: "42P01" },
  };
  const pool = makeFakePool(state);
  const { service, calls } = makeFakePushService();
  const job = createGameStartNotificationsJob({ pool, schema: "public", fcmPushService: service });
  const result = await job(Date.now());
  assert.equal(calls.length, 0);
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /migration not run/);
});

test("BIN-FCM cron: ingen deltagende haller → hopper over", async () => {
  const now = Date.now();
  const state: FakePoolState = {
    scheduledGames: [
      {
        id: "g-empty",
        sub_game_name: "x",
        custom_game_name: null,
        scheduled_start_time: new Date(now + 60_000),
        notification_start_seconds: 5 * 60,
        participating_halls_json: [],
      },
    ],
    dedupeRows: [],
    usersByHall: new Map(),
    throwOnQuery: null,
  };
  const pool = makeFakePool(state);
  const { service, calls } = makeFakePushService();
  const job = createGameStartNotificationsJob({ pool, schema: "public", fcmPushService: service });
  await job(now);
  assert.equal(calls.length, 0);
});

test("BIN-FCM cron: ingen spillere i hall → ingen send", async () => {
  const now = Date.now();
  const state: FakePoolState = {
    scheduledGames: [
      {
        id: "g-no-players",
        sub_game_name: "x",
        custom_game_name: null,
        scheduled_start_time: new Date(now + 60_000),
        notification_start_seconds: 5 * 60,
        participating_halls_json: ["hall-ghost"],
      },
    ],
    dedupeRows: [],
    usersByHall: new Map([["hall-ghost", []]]),
    throwOnQuery: null,
  };
  const pool = makeFakePool(state);
  const { service, calls } = makeFakePushService();
  const job = createGameStartNotificationsJob({ pool, schema: "public", fcmPushService: service });
  await job(now);
  assert.equal(calls.length, 0);
});

test("BIN-FCM cron: bruker custom_game_name når det er satt", async () => {
  const now = Date.now();
  const state: FakePoolState = {
    scheduledGames: [
      {
        id: "custom-name",
        sub_game_name: "Standard",
        custom_game_name: "Spesial Jackpot",
        scheduled_start_time: new Date(now + 60_000),
        notification_start_seconds: 5 * 60,
        participating_halls_json: ["hall-A"],
      },
    ],
    dedupeRows: [],
    usersByHall: new Map([["hall-A", ["u1"]]]),
    throwOnQuery: null,
  };
  const pool = makeFakePool(state);
  const { service, calls } = makeFakePushService();
  const job = createGameStartNotificationsJob({ pool, schema: "public", fcmPushService: service });
  await job(now);
  assert.equal(calls.length, 1);
  assert.match(calls[0].payload.body, /Spesial Jackpot/);
});
