/**
 * GAME1_SCHEDULE PR 1+2+3: JobScheduler-job som kaller Game1ScheduleTickService.
 *
 * Kjører hvert 15. sekund (legacy-paritet). Per tick:
 *   1. spawnUpcomingGame1Games — spawner rader 24t frem
 *   2. openPurchaseForImminentGames — flipper status til purchase_open
 *   3. transitionReadyToStartGames — flipper purchase_open → ready_to_start
 *      når alle deltagende non-excluded haller er klare (PR 2).
 *   4. cancelEndOfDayUnstartedGames — marker rader utløpte rader cancelled
 *   5. detectMasterTimeout — log `timeout_detected` audit-event for games som
 *      har stått i ready_to_start > 15 min uten at master trykket START (PR 3).
 *
 * Spec: GAME1_SCHEDULE_SPEC.md §3.3 + §3.4 + §3.6.
 *
 * Feature-flag: `GAME1_SCHEDULE_TICK_ENABLED` (default: false i produksjon,
 * aktiveres når admin-UI og ready-flow er klare). Se envConfig.ts.
 *
 * Idempotent: UNIQUE-constraint i tabellen + ON CONFLICT DO NOTHING
 * beskytter mot dobbel-spawn ved multi-instance deploy.
 *
 * Robust mot "tabell mangler" (42P01) — returnerer 0 items + note,
 * matcher swedbank-mønsteret slik at dev-miljø uten migrasjoner ikke
 * spammer errors.
 */

import type { JobResult } from "./JobScheduler.js";
import type { Game1ScheduleTickService } from "../game/Game1ScheduleTickService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:game1-schedule-tick" });

export interface Game1ScheduleTickJobDeps {
  service: Game1ScheduleTickService;
}

export function createGame1ScheduleTickJob(
  deps: Game1ScheduleTickJobDeps
): (nowMs: number) => Promise<JobResult> {
  return async function runGame1ScheduleTick(nowMs: number): Promise<JobResult> {
    try {
      const spawn = await deps.service.spawnUpcomingGame1Games(nowMs);
      const opened = await deps.service.openPurchaseForImminentGames(nowMs);
      // PR 2: flip purchase_open → ready_to_start når alle haller klare.
      // Kjøres etter openPurchase slik at samme tick både kan åpne og
      // markere klar hvis bingovert trykket klar før scheduler neste runde.
      const readied = await deps.service.transitionReadyToStartGames(nowMs);
      const cancelled = await deps.service.cancelEndOfDayUnstartedGames(nowMs);
      // PR 3: detect master-timeout (ready_to_start > 15 min uten master-start).
      // Logger audit-event; INGEN auto-start (per spec §3.6 MVP).
      const timedOut = await deps.service.detectMasterTimeout(nowMs);

      const total = spawn.spawned + opened + readied + cancelled + timedOut.gameIds.length;
      const noteParts: string[] = [];
      if (spawn.spawned > 0) noteParts.push(`spawned=${spawn.spawned}`);
      if (spawn.skipped > 0) noteParts.push(`skipped=${spawn.skipped}`);
      if (spawn.skippedSchedules > 0) {
        noteParts.push(`skippedSchedules=${spawn.skippedSchedules}`);
      }
      if (spawn.errors > 0) noteParts.push(`errors=${spawn.errors}`);
      if (opened > 0) noteParts.push(`opened=${opened}`);
      if (readied > 0) noteParts.push(`readied=${readied}`);
      if (cancelled > 0) noteParts.push(`cancelled=${cancelled}`);
      if (timedOut.gameIds.length > 0) {
        noteParts.push(`masterTimeout=${timedOut.gameIds.length}`);
      }

      return {
        itemsProcessed: total,
        note: noteParts.length ? noteParts.join(" ") : undefined,
      };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        // Missing tabell i dev — ikke spam.
        return {
          itemsProcessed: 0,
          note: "game1_scheduled_games / related tabell mangler (migrasjon ikke kjørt?)",
        };
      }
      log.error({ err }, "game1-schedule-tick failed");
      throw err;
    }
  };
}
