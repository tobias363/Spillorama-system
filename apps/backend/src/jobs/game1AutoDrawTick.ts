/**
 * GAME1_SCHEDULE PR 4c Bolk 4+5: JobScheduler-job for auto-draw tick.
 *
 * Kjører hvert sekund (default 1000 ms) og trigger drawNext for alle
 * running Spill 1-games hvor last_drawn_at + seconds ≤ now. Se
 * Game1AutoDrawTickService for detaljer.
 *
 * Feature-flag: `GAME1_AUTO_DRAW_ENABLED` (default: false i produksjon,
 * aktiveres når admin/master-UI i PR 4d er klar til live play).
 *
 * Robust mot "tabell mangler" (42P01) matcher mønsteret fra
 * game1ScheduleTick.ts.
 */

import type { JobResult } from "./JobScheduler.js";
import type { Game1AutoDrawTickService } from "../game/Game1AutoDrawTickService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:game1-auto-draw-tick" });

export interface Game1AutoDrawTickJobDeps {
  service: Game1AutoDrawTickService;
}

export function createGame1AutoDrawTickJob(
  deps: Game1AutoDrawTickJobDeps
): (nowMs: number) => Promise<JobResult> {
  return async function runGame1AutoDrawTick(_nowMs: number): Promise<JobResult> {
    try {
      const result = await deps.service.tick();
      const noteParts: string[] = [];
      if (result.drawsTriggered > 0) noteParts.push(`draws=${result.drawsTriggered}`);
      if (result.errors > 0) noteParts.push(`errors=${result.errors}`);
      return {
        itemsProcessed: result.drawsTriggered,
        note: noteParts.length ? noteParts.join(" ") : undefined,
      };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        return {
          itemsProcessed: 0,
          note: "game1_game_state / scheduled_games tabell mangler (migrasjon ikke kjørt?)",
        };
      }
      log.error({ err }, "game1-auto-draw-tick failed");
      throw err;
    }
  };
}
