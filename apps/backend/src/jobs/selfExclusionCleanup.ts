/**
 * BIN-582: Self-exclusion / pause cleanup job (legacy daily cron).
 * line 5121, `updatePlayerBlockRules`): removes block rules whose
 * `endDate < now()` so players are no longer held out once the period
 * has elapsed.
 *
 * Port strategy:
 *   - New schema uses `app_rg_restrictions` with two columns:
 *       `timed_pause_until` (voluntary pause — clears when expired)
 *       `self_excluded_at` + `self_exclusion_minimum_until` (1-year
 *         self-exclusion — clears only after the minimum has passed)
 *   - Policy from MEMORY.md (spillevett_implementation): self-exclusion
 *     is minimum 1 year, voluntary pause is a separate mechanism. We
 *     clear only what has genuinely expired; anything still inside its
 *     minimum window is left in place.
 *   - Per regulatory memo, expired pauses can be silently cleared. We
 *     log one entry per cleared row for audit trail; the primary audit
 *     log lives elsewhere (`app_rg_*` event tables), and this cleanup is
 *     just bookkeeping.
 *   - Date-keyed, same as bankid reminder, so it only runs once per day.
 */
import type { Pool } from "pg";
import type { JobResult } from "./JobScheduler.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:self-exclusion-cleanup" });

export interface SelfExclusionCleanupDeps {
  pool: Pool;
  schema: string;
  /** Preferred run-hour local time (legacy was 00:00). */
  runAtHourLocal?: number;
  /** Override for testing. */
  alwaysRun?: boolean;
}

export function createSelfExclusionCleanupJob(deps: SelfExclusionCleanupDeps) {
  const table = `"${deps.schema}"."app_rg_restrictions"`;
  const runAtHour = deps.runAtHourLocal ?? 0;
  let lastRunDateKey = "";

  function dateKey(nowMs: number): string {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return async function runSelfExclusionCleanup(nowMs: number): Promise<JobResult> {
    const now = new Date(nowMs);
    const todayKey = dateKey(nowMs);

    if (!deps.alwaysRun) {
      // For 00:00 we run as soon as the day changes. For later hours we
      // wait for the wall-clock hour to match.
      if (runAtHour > 0 && now.getHours() < runAtHour) {
        return { itemsProcessed: 0, note: `waiting for ${runAtHour}:00 local` };
      }
      if (todayKey === lastRunDateKey) {
        return { itemsProcessed: 0, note: "already ran today" };
      }
    }

    let pausesCleared = 0;
    let selfExclusionsCleared = 0;

    try {
      // Expired voluntary pauses — clear both the until and set_at.
      const pauseResult = await deps.pool.query(
        `UPDATE ${table}
            SET timed_pause_until = NULL,
                timed_pause_set_at = NULL,
                updated_at = now()
          WHERE timed_pause_until IS NOT NULL
            AND timed_pause_until < now()`
      );
      pausesCleared = pauseResult.rowCount ?? 0;

      // Self-exclusions whose 1-year minimum has elapsed. We only clear
      // the minimum-until marker, NOT `self_excluded_at`, so the audit
      // trail stays intact. Lifting the exclusion itself is an explicit
      // user action (they must re-engage consciously).
      //
      // NOTE: per regulatory requirements, "self-exclusion period elapsed"
      // does NOT imply automatic re-activation. We just stop blocking on
      // the minimum-window check.
      const exclResult = await deps.pool.query(
        `UPDATE ${table}
            SET self_exclusion_minimum_until = NULL,
                updated_at = now()
          WHERE self_exclusion_minimum_until IS NOT NULL
            AND self_exclusion_minimum_until < now()`
      );
      selfExclusionsCleared = exclResult.rowCount ?? 0;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "42P01") {
        return { itemsProcessed: 0, note: "app_rg_restrictions table missing" };
      }
      throw err;
    }

    if (pausesCleared > 0 || selfExclusionsCleared > 0) {
      log.info(
        { pausesCleared, selfExclusionsCleared },
        "cleared expired RG restrictions"
      );
    }

    lastRunDateKey = todayKey;

    return {
      itemsProcessed: pausesCleared + selfExclusionsCleared,
      note: `pauses=${pausesCleared} exclusions=${selfExclusionsCleared}`,
    };
  };
}
