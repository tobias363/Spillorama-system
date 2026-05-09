/**
 * Pilot Q3 2026: nightly cron-tick that auto-finishes stale plan-runs.
 *
 * Wraps `GamePlanRunCleanupService.cleanupAllStale()` in a JobScheduler
 * `JobDefinition` matching the existing `uniqueIdExpiry`-pattern:
 *   - Date-keyed gating so the heavy work only runs once per Oslo-day.
 *   - Hour-of-day gate so we run at 03:00 local (default) — late enough
 *     that no live games are running, early enough that ops sees
 *     anomalies before the next morning.
 *   - Defensive 42P01 fall-through inside the service (table missing →
 *     no-op, doesn't crash the loop).
 *
 * Multi-instance safety:
 *   The JobScheduler already wraps each tick in the Redis scheduler-lock
 *   when configured, so only one backend instance executes the cleanup
 *   per tick — no duplicate audit-events or contended UPDATEs.
 */
import type { JobResult } from "./JobScheduler.js";
import type { GamePlanRunCleanupService } from "../game/GamePlanRunCleanupService.js";
import { logger as rootLogger } from "../util/logger.js";
import { todayOsloKey, nowOsloHourMinute } from "../util/osloTimezone.js";

const log = rootLogger.child({ module: "job:game-plan-run-cleanup" });

export interface GamePlanRunCleanupJobDeps {
  service: GamePlanRunCleanupService;
  /** Oslo-tz hour to run at. Default 3 (03:00 — well past midnight). */
  runAtHourLocal?: number;
  /** Override for tests — bypasses hour + date-key gating. */
  alwaysRun?: boolean;
}

export function createGamePlanRunCleanupJob(deps: GamePlanRunCleanupJobDeps) {
  const runAtHour = deps.runAtHourLocal ?? 3;
  let lastRunDateKey = "";

  return async function runGamePlanRunCleanup(nowMs: number): Promise<JobResult> {
    const now = new Date(nowMs);

    if (!deps.alwaysRun) {
      const { hour } = nowOsloHourMinute(now);
      if (hour < runAtHour) {
        return { itemsProcessed: 0, note: `waiting for ${runAtHour}:00 Oslo` };
      }
      const todayKey = todayOsloKey(now);
      if (todayKey === lastRunDateKey) {
        return { itemsProcessed: 0, note: "already ran today" };
      }
      lastRunDateKey = todayKey;
    }

    let cleanedCount = 0;
    try {
      const result = await deps.service.cleanupAllStale(now);
      cleanedCount = result.cleanedCount;
    } catch (err) {
      // Service-internal 42P01 swallow already covered. Anything else
      // bubbles to the JobScheduler tick-handler which logs + retries on
      // the next interval — we don't want to throw here because that
      // would mark the date-key as "ran" and skip retry until tomorrow.
      log.error({ err }, "cleanup tick failed");
      throw err;
    }

    return {
      itemsProcessed: cleanedCount,
      note: cleanedCount > 0 ? `auto-closed=${cleanedCount}` : "no stale runs",
    };
  };
}
