/**
 * Pilot-blokker K1A follow-up: mark Customer Unique ID cards as EXPIRED
 * once their `expiry_date` is in the past.
 *
 * Without this job a card stays `status = 'ACTIVE'` forever even after
 * `expiry_date < now()`, because the read-time guard in
 * `UniqueIdService.mustGetActive()` only inspects `status`, not the
 * timestamp. Wireframe 17.9-footnote ("Your Unique Id will be Expired
 * before starting of the game, please Contact Administrator") relies on
 * the status flag being authoritative.
 *
 * Implementation mirrors `bankIdExpiryReminder` (date-keyed daily run,
 * defensive 42P01 / 42703 swallow) and the SQL is a single bounded
 * UPDATE — the table is small (one row per issued card) and the
 * `idx_app_unique_ids_status` index covers `(status, expiry_date)`.
 *
 * Cards in `WITHDRAWN` or `REGENERATED` state are left alone — their
 * lifecycle has already terminated and overwriting that with EXPIRED
 * would lose audit detail.
 */
import type { Pool } from "pg";
import type { JobResult } from "./JobScheduler.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:unique-id-expiry" });

export interface UniqueIdExpiryJobDeps {
  pool: Pool;
  schema: string;
  /** Preferred run-hour local time. Default 1 — runs once just past midnight. */
  runAtHourLocal?: number;
  /** Override for tests — bypasses hour + date-key gating. */
  alwaysRun?: boolean;
}

export function createUniqueIdExpiryJob(deps: UniqueIdExpiryJobDeps) {
  const tableName = `"${deps.schema}"."app_unique_ids"`;
  const runAtHour = deps.runAtHourLocal ?? 1;
  let lastRunDateKey = "";

  function dateKey(nowMs: number): string {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return async function runUniqueIdExpiry(nowMs: number): Promise<JobResult> {
    const now = new Date(nowMs);
    const todayKey = dateKey(nowMs);

    if (!deps.alwaysRun) {
      if (now.getHours() < runAtHour) {
        return { itemsProcessed: 0, note: `waiting for ${runAtHour}:00 local` };
      }
      if (todayKey === lastRunDateKey) {
        return { itemsProcessed: 0, note: "already ran today" };
      }
    }

    let expiredCount = 0;
    try {
      const result = await deps.pool.query(
        `UPDATE ${tableName}
            SET status = 'EXPIRED', updated_at = now()
          WHERE status = 'ACTIVE'
            AND expiry_date < now()`,
      );
      expiredCount = result.rowCount ?? 0;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "42P01" || code === "42703") {
        // 42P01 = undefined_table, 42703 = undefined_column.
        // Migration 20260724001000 not yet applied — safe no-op.
        return { itemsProcessed: 0, note: "app_unique_ids table/columns missing" };
      }
      throw err;
    }

    lastRunDateKey = todayKey;

    if (expiredCount > 0) {
      log.info({ expiredCount }, "marked unique-id cards as EXPIRED");
    }

    return {
      itemsProcessed: expiredCount,
      note: `expired=${expiredCount}`,
    };
  };
}
