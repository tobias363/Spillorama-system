/**
 * BIN-FCM: sendGameStartNotifications cron (legacy-paritet).
 *
 * Legacy-backend hadde en cron hver 1min som varslet spillere før et spill
 * startet (ticket-config sa "5m" → varsel 5 min før scheduled_start_time).
 *
 * Port-strategi (tilpasset ny stack):
 *   - Kilde: `app_game1_scheduled_games` — status='purchase_open' eller
 *     'ready_to_start'. Raden har `scheduled_start_time` og
 *     `notification_start_seconds` (normalisert fra legacy "5m"-string).
 *   - Trigger: varsel sendes når `now >= scheduled_start_time - notification_start_seconds`
 *     MEN vi skal kun varsle ÉN gang per rad. Dedup-strategi: sjekk
 *     `app_notifications` for en rad med `type='game-start'` og
 *     `data->>'scheduledGameId' = <id>` de siste 24t.
 *   - Mottakere: alle spillere med `hall_id IN (participating_halls)`
 *     som ikke er soft-deleted og ikke har blokkert notifikasjoner for
 *     hall-en. Filter-logikk matcher admin-broadcast.
 *   - Send via FcmPushService.sendBulk — den håndterer ikke-aktive devices,
 *     rate-limit og audit.
 *
 * Dedup-valg: vi kunne lagret "notification_sent_at" på
 * `app_game1_scheduled_games`, men det ville krevd en migrasjon bare for
 * dette subsystemet. Query mot `app_notifications` er billig (indeks på
 * type+created_at), og gir oss samtidig en historie-trail i samme tabell
 * som alle andre varsler.
 *
 * Robust mot "tabell mangler" (42P01) → 0 items + note, matcher
 * swedbank-mønsteret for dev-miljø uten migrasjoner.
 */

import type { Pool } from "pg";
import type { JobResult } from "./JobScheduler.js";
import type { FcmPushService } from "../notifications/FcmPushService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:game-start-notifications" });

export interface GameStartNotificationsDeps {
  pool: Pool;
  schema: string;
  fcmPushService: FcmPushService;
  /** Upper bound on players targeted per tick — avoids "send to 10k" worst-case. */
  maxRecipientsPerGame?: number;
}

interface PendingGameRow {
  id: string;
  sub_game_name: string;
  custom_game_name: string | null;
  scheduled_start_time: Date;
  notification_start_seconds: number;
  participating_halls_json: unknown;
}

function assertSchema(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error("Ugyldig schema-navn.");
  }
  return schema;
}

function parseHallIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parseHallIds(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export function createGameStartNotificationsJob(
  deps: GameStartNotificationsDeps,
): (nowMs: number) => Promise<JobResult> {
  const schema = assertSchema(deps.schema);
  const scheduledGames = `"${schema}"."app_game1_scheduled_games"`;
  const notifications = `"${schema}"."app_notifications"`;
  const users = `"${schema}"."app_users"`;
  const hallStatus = `"${schema}"."app_player_hall_status"`;
  const maxRecipients = Math.max(1, deps.maxRecipientsPerGame ?? 5000);

  return async function runGameStartNotifications(nowMs: number): Promise<JobResult> {
    const now = new Date(nowMs);

    // 1) Finn "pending" spill: scheduled_start_time innenfor
    //    notification-vinduet, men ikke startet enda. Ekskluder rader
    //    som allerede har en game-start-varsel i app_notifications de
    //    siste 24t (dedup).
    let rows: PendingGameRow[];
    try {
      const result = await deps.pool.query<PendingGameRow>(
        `SELECT g.id, g.sub_game_name, g.custom_game_name,
                g.scheduled_start_time, g.notification_start_seconds,
                g.participating_halls_json
           FROM ${scheduledGames} g
          WHERE g.status IN ('purchase_open', 'ready_to_start')
            AND g.scheduled_start_time > now()
            AND g.scheduled_start_time - (g.notification_start_seconds || ' seconds')::interval <= now()
            AND NOT EXISTS (
              SELECT 1 FROM ${notifications} n
               WHERE n.type = 'game-start'
                 AND n.data->>'scheduledGameId' = g.id
                 AND n.created_at >= now() - interval '24 hours'
              LIMIT 1
            )
          ORDER BY g.scheduled_start_time ASC
          LIMIT 50`,
      );
      rows = result.rows;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01" || code === "42703") {
        return {
          itemsProcessed: 0,
          note: "app_game1_scheduled_games / app_notifications table missing (migration not run?)",
        };
      }
      log.error({ err }, "game-start-notifications query feilet");
      throw err;
    }

    if (rows.length === 0) {
      return { itemsProcessed: 0 };
    }

    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    for (const row of rows) {
      const hallIds = parseHallIds(row.participating_halls_json);
      if (hallIds.length === 0) {
        log.warn({ gameId: row.id }, "scheduled game har ingen participating halls — hopper over");
        continue;
      }

      let recipientIds: string[] = [];
      try {
        const result = await deps.pool.query<{ id: string }>(
          `SELECT u.id
             FROM ${users} u
             LEFT JOIN ${hallStatus} s
               ON s.user_id = u.id AND s.hall_id = u.hall_id
            WHERE u.role = 'PLAYER'
              AND u.deleted_at IS NULL
              AND u.hall_id = ANY($1::text[])
              AND COALESCE(s.is_active, true) = true
            LIMIT $2`,
          [hallIds, maxRecipients],
        );
        recipientIds = result.rows.map((r) => r.id);
      } catch (err) {
        log.error({ err, gameId: row.id }, "klarte ikke hente mottakere — hopper over denne spillet");
        continue;
      }

      if (recipientIds.length === 0) {
        continue;
      }

      const minutesUntilStart = Math.max(
        1,
        Math.round((row.scheduled_start_time.getTime() - now.getTime()) / 60_000),
      );
      const gameName = row.custom_game_name?.trim() || row.sub_game_name;

      try {
        const sendResult = await deps.fcmPushService.sendBulk(recipientIds, {
          type: "game-start",
          title: "Spillet starter snart",
          body: `${gameName} starter om ${minutesUntilStart} minutt(er). Logg inn for å kjøpe bonger!`,
          data: {
            scheduledGameId: row.id,
            gameSlug: "game1",
            minutesUntilStart,
            scheduledStartTime: row.scheduled_start_time.toISOString(),
          },
        });
        totalSent += sendResult.sent;
        totalFailed += sendResult.failed;
        totalSkipped += sendResult.skipped;
        log.info(
          {
            gameId: row.id,
            recipients: recipientIds.length,
            sent: sendResult.sent,
            failed: sendResult.failed,
            skipped: sendResult.skipped,
          },
          "game-start notifications sendt",
        );
      } catch (err) {
        log.error({ err, gameId: row.id }, "sendBulk kastet uventet");
        totalFailed += recipientIds.length;
      }
    }

    return {
      itemsProcessed: totalSent + totalFailed,
      note: `games=${rows.length} sent=${totalSent} failed=${totalFailed} skipped=${totalSkipped}`,
    };
  };
}
