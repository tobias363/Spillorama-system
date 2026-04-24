/**
 * Task 1.6: JobScheduler-job som kaller Game1TransferExpiryTickService.
 *
 * Kjører hvert 5. sekund som default. Per tick: UPDATE status='expired' for
 * alle pending-requests med valid_till < NOW() + broadcast `game1:transfer-
 * expired` for hver. Idempotent.
 *
 * Feature-flag: `GAME1_TRANSFER_EXPIRY_TICK_ENABLED` (default: true — dette er
 * nødvendig for at 60s TTL skal håndheves).
 *
 * Robust mot "tabell mangler" (42P01) matcher mønsteret fra
 * game1ScheduleTick.ts.
 */

import type { JobResult } from "./JobScheduler.js";
import type { Game1TransferExpiryTickService } from "../game/Game1TransferExpiryTickService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:game1-transfer-expiry-tick" });

export interface Game1TransferExpiryTickJobDeps {
  service: Game1TransferExpiryTickService;
}

export function createGame1TransferExpiryTickJob(
  deps: Game1TransferExpiryTickJobDeps
): (nowMs: number) => Promise<JobResult> {
  return async function runGame1TransferExpiryTick(
    _nowMs: number
  ): Promise<JobResult> {
    try {
      const result = await deps.service.tick();
      const noteParts: string[] = [];
      if (result.expiredCount > 0) {
        noteParts.push(`expired=${result.expiredCount}`);
      }
      if (result.errors > 0) noteParts.push(`errors=${result.errors}`);
      return {
        itemsProcessed: result.expiredCount,
        note: noteParts.length ? noteParts.join(" ") : undefined,
      };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        return {
          itemsProcessed: 0,
          note: "app_game1_master_transfer_requests tabell mangler (migrasjon ikke kjørt?)",
        };
      }
      log.error({ err }, "game1-transfer-expiry-tick failed");
      throw err;
    }
  };
}
