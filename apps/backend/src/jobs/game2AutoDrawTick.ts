/**
 * JobScheduler-job for Spill 2 auto-draw tick.
 *
 * Kjører periodisk (default 1000 ms polling) og trigger `drawNextNumber`
 * for alle running Spill 2 (rocket / game_2 / tallspill)-rom hvor
 * draw-throttle er passert. Se {@link Game2AutoDrawTickService} for
 * detaljer.
 *
 * Feature-flag: `GAME2_AUTO_DRAW_ENABLED` (default ON i prod siden Spill 2
 * uten denne ikke trekker baller; perpetual-loopen vil ellers henge).
 */

import type { JobResult } from "./JobScheduler.js";
import type { Game2AutoDrawTickService } from "../game/Game2AutoDrawTickService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:game2-auto-draw-tick" });

export interface Game2AutoDrawTickJobDeps {
  service: Game2AutoDrawTickService;
}

export function createGame2AutoDrawTickJob(
  deps: Game2AutoDrawTickJobDeps
): (nowMs: number) => Promise<JobResult> {
  return async function runGame2AutoDrawTick(_nowMs: number): Promise<JobResult> {
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
      log.error({ err }, "game2-auto-draw-tick failed");
      throw err;
    }
  };
}
