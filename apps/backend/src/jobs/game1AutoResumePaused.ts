/**
 * ADR-0022 Lag 1: JobScheduler-wrapper for Game1AutoResumePausedService.
 *
 * Kjører hvert `GAME1_AUTO_RESUME_TICK_INTERVAL_MS` (default 5s).
 * Service-en finner scheduled-games hvor engine auto-pauset etter phase-won
 * og master-heartbeat er stale, og auto-resumer engine.
 *
 * Feature-flag: `GAME1_AUTO_RESUME_ENABLED` (default: `true`). Sett til
 * `false` i miljø som av kjernemessige grunner ikke skal auto-resumere
 * (eks. ren manuell QA / regulatorisk test-modus). Skipper ticks helt.
 *
 * Robust mot "tabell mangler" (42P01) — speiler mønsteret fra de andre
 * game1-cron-jobs så fersh-clone-miljø ikke krasjer ved første tick.
 */

import type { JobResult } from "./JobScheduler.js";
import type { Game1AutoResumePausedService } from "../game/Game1AutoResumePausedService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:game1-auto-resume-paused" });

export interface Game1AutoResumePausedJobDeps {
  service: Game1AutoResumePausedService;
}

export function createGame1AutoResumePausedJob(
  deps: Game1AutoResumePausedJobDeps
): (nowMs: number) => Promise<JobResult> {
  return async function runGame1AutoResumePaused(
    _nowMs: number
  ): Promise<JobResult> {
    try {
      const result = await deps.service.tick();
      const noteParts: string[] = [];
      if (result.autoResumed > 0) {
        noteParts.push(`autoResumed=${result.autoResumed}`);
      }
      if (result.skippedMasterActive > 0) {
        noteParts.push(`skippedMasterActive=${result.skippedMasterActive}`);
      }
      if (result.errors > 0) noteParts.push(`errors=${result.errors}`);
      return {
        itemsProcessed: result.autoResumed,
        note: noteParts.length ? noteParts.join(" ") : undefined,
      };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        return {
          itemsProcessed: 0,
          note: "auto_resume_eligible_at / master_last_seen_at-kolonne mangler (migrasjon 20260801000000 ikke kjørt?)",
        };
      }
      log.error({ err }, "game1-auto-resume-paused failed");
      throw err;
    }
  };
}

/**
 * Helper: les feature-flag fra env. Default true.
 */
export function isGame1AutoResumeEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.GAME1_AUTO_RESUME_ENABLED;
  if (raw === undefined) return true;
  return raw === "true" || raw === "1";
}

/**
 * Helper: les tick-intervall fra env. Default 5000ms.
 */
export function getGame1AutoResumeTickIntervalMs(
  env: NodeJS.ProcessEnv
): number {
  const raw = env.GAME1_AUTO_RESUME_TICK_INTERVAL_MS;
  if (raw === undefined) return 5_000;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1000) return 5_000;
  return parsed;
}

/**
 * Helper: les heartbeat-timeout fra env. Default 90000ms (90s).
 */
export function getGame1MasterHeartbeatTimeoutMs(
  env: NodeJS.ProcessEnv
): number {
  const raw = env.GAME1_MASTER_HEARTBEAT_TIMEOUT_MS;
  if (raw === undefined) return 90_000;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 10_000) return 90_000;
  return parsed;
}
