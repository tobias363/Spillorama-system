/**
 * BUG-A (audit:db `stuck-plan-run` 2026-05-14): poll-driven job that
 * reconciles DAGENS stuck plan-runs after natural round-end.
 *
 * Wraps `GamePlanRunCleanupService.reconcileNaturalEndStuckRuns()` in a
 * JobScheduler `JobDefinition`. Polls every
 * `GAME_PLAN_RUN_NATURAL_END_RECONCILE_INTERVAL_MS` (default 30 sek) and
 * auto-finishes plan-runs hvor:
 *   - app_game_plan_run.status = 'running'
 *   - Ingen aktive scheduled-games linket
 *   - Nyeste completed scheduled-game's actual_end_time er > threshold
 *     siden (default 30 sek, env-konfigurerbar via
 *     `PLAN_RUN_NATURAL_END_RECONCILE_THRESHOLD_MS`)
 *
 * Komplementært til:
 *   - `gamePlanRunCleanup` (nightly cron — gårsdagens stale)
 *   - `MasterActionService.reconcileStuckPlanRuns` (PR #1403 — kun ved
 *     manuell master-handling)
 *   - `getOrCreateForToday` inline self-heal (kun ved master-konsoll-init)
 *
 * Feature-flag: `GAME_PLAN_RUN_NATURAL_END_RECONCILE_ENABLED`
 *   (default: `true`).
 *
 * Soft-fail policy: 42P01 (tabell mangler) → no-op slik at fersh DB ikke
 * krasjer cron. Andre PG-feil bubbles til JobScheduler-tick-handler som
 * logger og prøver neste tick — vi vil ikke kaste her fordi det ville
 * skippet retry til neste poll.
 */
import type { JobResult } from "./JobScheduler.js";
import type { GamePlanRunCleanupService } from "../game/GamePlanRunCleanupService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({
  module: "job:game-plan-run-natural-end-reconcile",
});

export interface GamePlanRunNaturalEndReconcileJobDeps {
  service: GamePlanRunCleanupService;
}

export function createGamePlanRunNaturalEndReconcileJob(
  deps: GamePlanRunNaturalEndReconcileJobDeps,
): (nowMs: number) => Promise<JobResult> {
  return async function runGamePlanRunNaturalEndReconcile(
    nowMs: number,
  ): Promise<JobResult> {
    const now = new Date(nowMs);
    try {
      const result = await deps.service.reconcileNaturalEndStuckRuns(now);
      return {
        itemsProcessed: result.cleanedCount,
        note:
          result.cleanedCount > 0
            ? `reconciled=${result.cleanedCount}`
            : "no stuck plan-runs",
      };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        return {
          itemsProcessed: 0,
          note: "plan-run or scheduled-games table missing — migration ikke kjørt?",
        };
      }
      log.error({ err }, "natural-end-reconcile tick failed");
      throw err;
    }
  };
}

export function isGamePlanRunNaturalEndReconcileEnabled(
  env: NodeJS.ProcessEnv,
): boolean {
  const raw = env.GAME_PLAN_RUN_NATURAL_END_RECONCILE_ENABLED;
  if (raw === undefined) return true;
  return raw !== "false";
}

export function getGamePlanRunNaturalEndReconcileIntervalMs(
  env: NodeJS.ProcessEnv,
): number {
  const raw = env.GAME_PLAN_RUN_NATURAL_END_RECONCILE_INTERVAL_MS;
  if (raw === undefined) return 30_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30_000;
  // Floor 5 sek så vi ikke hammer DB ved feilkonfig. Cap 1 time så vi ikke
  // glipper hele dagen ved typo.
  return Math.min(60 * 60 * 1000, Math.max(5_000, Math.floor(parsed)));
}

export function getGamePlanRunNaturalEndReconcileThresholdMs(
  env: NodeJS.ProcessEnv,
): number {
  const raw = env.PLAN_RUN_NATURAL_END_RECONCILE_THRESHOLD_MS;
  if (raw === undefined) return 30_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30_000;
  // Min 1 sek for å unngå degenerert "react instantly" som kan trigge midt
  // i naturlig overgang. Cap 30 min for å fange åpenbar typo.
  return Math.min(30 * 60 * 1000, Math.max(1_000, Math.floor(parsed)));
}
