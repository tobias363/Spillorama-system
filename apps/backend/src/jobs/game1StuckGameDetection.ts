/**
 * ADR-0022 Lag 2: JobScheduler-wrapper for Game1StuckGameDetectionService.
 *
 * Kjører hvert `GAME1_STUCK_DETECTION_INTERVAL_MS` (default 60s).
 * Service-en finner virkelig stuck scheduled-games (stale draws eller way
 * over scheduled_end_time) og auto-ender dem.
 *
 * Feature-flag: `GAME1_STUCK_DETECTION_ENABLED` (default: `true`).
 */

import type { JobResult } from "./JobScheduler.js";
import type { Game1StuckGameDetectionService } from "../game/Game1StuckGameDetectionService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:game1-stuck-game-detection" });

export interface Game1StuckGameDetectionJobDeps {
  service: Game1StuckGameDetectionService;
}

export function createGame1StuckGameDetectionJob(
  deps: Game1StuckGameDetectionJobDeps
): (nowMs: number) => Promise<JobResult> {
  return async function runGame1StuckGameDetection(
    _nowMs: number
  ): Promise<JobResult> {
    try {
      const result = await deps.service.tick();
      const noteParts: string[] = [];
      if (result.autoEnded > 0) noteParts.push(`autoEnded=${result.autoEnded}`);
      if (result.errors > 0) noteParts.push(`errors=${result.errors}`);
      return {
        itemsProcessed: result.autoEnded,
        note: noteParts.length ? noteParts.join(" ") : undefined,
      };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        return {
          itemsProcessed: 0,
          note: "game1-table mangler (migrasjon ikke kjørt?)",
        };
      }
      log.error({ err }, "game1-stuck-game-detection failed");
      throw err;
    }
  };
}

export function isGame1StuckDetectionEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.GAME1_STUCK_DETECTION_ENABLED;
  if (raw === undefined) return true;
  return raw === "true" || raw === "1";
}

export function getGame1StuckDetectionIntervalMs(
  env: NodeJS.ProcessEnv
): number {
  const raw = env.GAME1_STUCK_DETECTION_INTERVAL_MS;
  if (raw === undefined) return 60_000;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 10_000) return 60_000;
  return parsed;
}

export function getGame1StuckNoDrawsThresholdMs(
  env: NodeJS.ProcessEnv
): number {
  const raw = env.GAME1_STUCK_NO_DRAWS_THRESHOLD_MS;
  if (raw === undefined) return 300_000;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 60_000) return 300_000;
  return parsed;
}

export function getGame1StuckPastEndThresholdMs(
  env: NodeJS.ProcessEnv
): number {
  const raw = env.GAME1_STUCK_PAST_END_THRESHOLD_MS;
  if (raw === undefined) return 1_800_000;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 300_000) return 1_800_000;
  return parsed;
}
