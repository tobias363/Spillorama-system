/**
 * BIN-700: monthly reset of app_loyalty_player_state.month_points.
 *
 * Kjøres hver dag og sjekker om vi er inne i en ny måned. Første tick i en ny
 * måned nullstiller `month_points` for alle spillere og oppdaterer `month_key`
 * til inneværende måned. Idempotent via month_key-sammenligning: service-
 * laget sletter bare rader der `month_key < nowMonthKey OR month_key IS NULL`,
 * så dobbel-kjøring i samme måned er no-op.
 *
 * Samme pattern som selfExclusionCleanup + bankIdExpiryReminder (dato-nøkkel-
 * basert), men her bruker vi `YYYY-MM` i stedet for `YYYY-MM-DD` siden job-
 * en kun skal kjøre én gang per måned.
 */
import type { JobResult } from "./JobScheduler.js";
import type { LoyaltyService } from "../compliance/LoyaltyService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:loyalty-monthly-reset" });

export interface LoyaltyMonthlyResetDeps {
  loyaltyService: LoyaltyService;
  /** Override for testing — skip månedskift-gating. */
  alwaysRun?: boolean;
}

function monthKey(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function createLoyaltyMonthlyResetJob(deps: LoyaltyMonthlyResetDeps) {
  let lastRunMonthKey = "";

  return async function runLoyaltyMonthlyReset(nowMs: number): Promise<JobResult> {
    const currentMonth = monthKey(nowMs);

    if (!deps.alwaysRun && currentMonth === lastRunMonthKey) {
      return { itemsProcessed: 0, note: "already ran this month" };
    }

    try {
      const result = await deps.loyaltyService.monthlyReset(currentMonth);
      lastRunMonthKey = currentMonth;
      if (result.playersReset > 0) {
        log.info(
          { monthKey: currentMonth, playersReset: result.playersReset },
          "loyalty monthly reset executed"
        );
      }
      return {
        itemsProcessed: result.playersReset,
        note: `monthKey=${currentMonth}`,
      };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "42P01") {
        return {
          itemsProcessed: 0,
          note: "app_loyalty_player_state table missing",
        };
      }
      throw err;
    }
  };
}
