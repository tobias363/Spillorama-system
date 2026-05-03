/**
 * JobScheduler-job for Spill 3 auto-draw tick.
 *
 * Kjører periodisk (default 1000 ms polling) og trigger `drawNextNumber`
 * for alle running Spill 3 (monsterbingo / mønsterbingo / game_3)-rom hvor
 * draw-throttle er passert. Se {@link Game3AutoDrawTickService} for
 * detaljer.
 *
 * Feature-flag: `GAME3_AUTO_DRAW_ENABLED` (default ON i prod siden Spill 3
 * uten denne ikke trekker baller; perpetual-loopen vil ellers henge).
 */

import type { JobResult } from "./JobScheduler.js";
import type { Game3AutoDrawTickService } from "../game/Game3AutoDrawTickService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:game3-auto-draw-tick" });

export interface Game3AutoDrawTickJobDeps {
  service: Game3AutoDrawTickService;
}

export function createGame3AutoDrawTickJob(
  deps: Game3AutoDrawTickJobDeps
): (nowMs: number) => Promise<JobResult> {
  return async function runGame3AutoDrawTick(_nowMs: number): Promise<JobResult> {
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
      log.error({ err }, "game3-auto-draw-tick failed");
      throw err;
    }
  };
}
