/**
 * BIN-720: Profile Settings API — 48h-queue flush-cron.
 *
 * Promoterer pending loss-limit-endringer → active når
 * `effectiveFromMs <= now()`. Pairer med
 * `ProfileSettingsService.flushPendingLossLimits()`.
 *
 * Kjøres hyppigere enn daglig (default 15 min) for å minimere lag mellom
 * 48h-grense og aktivering. Alternative: umiddelbar aktivering ved neste
 * `getPlayerCompliance`-kall (via resolveLossLimitState) — men det krever
 * at spilleren faktisk treffer en endepunkt, og DB-raden blir hengende til
 * da. Cron-flushen holder DB ryddig og audit-sporbar.
 */
import type { JobResult } from "./JobScheduler.js";
import type { ProfileSettingsService } from "../compliance/ProfileSettingsService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:profile-pending-loss-limit-flush" });

export interface ProfilePendingLossLimitFlushDeps {
  profileSettingsService: ProfileSettingsService;
}

export function createProfilePendingLossLimitFlushJob(
  deps: ProfilePendingLossLimitFlushDeps
) {
  return async function runFlush(nowMs: number): Promise<JobResult> {
    try {
      const activated = await deps.profileSettingsService.flushPendingLossLimits(nowMs);
      if (activated > 0) {
        log.info({ activated }, "pending loss-limit changes promoted to active (48h flush)");
      }
      return { itemsProcessed: activated, note: `activated=${activated}` };
    } catch (err) {
      log.warn({ err }, "profile pending loss-limit flush failed");
      return { itemsProcessed: 0, note: `error: ${String(err)}` };
    }
  };
}
