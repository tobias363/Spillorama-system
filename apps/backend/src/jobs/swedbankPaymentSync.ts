/**
 * BIN-582: Swedbank payment reconciliation job (legacy hourly cron).
 * line 3468, `swedbankpayCronToUpdateTransaction`): polls all pending
 * transactions, asks Swedbank for current status, credits wallets that
 * completed off-channel, marks expired ones as EXPIRED.
 *
 * Port strategy:
 *   - The new backend already has `SwedbankPayService.reconcileIntentForUser`
 *     used by `/api/payments/swedbank/:intentId/reconcile`. It performs the
 *     exact work the legacy cron did, per-intent.
 *   - This job queries `swedbank_payment_intents` for rows whose
 *     `status NOT IN ('PAID','CREDITED','FAILED','EXPIRED','CANCELLED')` and
 *     that are younger than 24h, then calls reconcile on each.
 *   - We do NOT add a "mark expired after 24h" pass in this port — that
 *     was legacy bookkeeping and the new system uses `last_error` + status
 *     progression via Swedbank's own state machine. If the product team
 *     wants it, open a follow-up issue (TODO below).
 *   - If the `swedbank_payment_intents` table does not exist (dev-without-DB),
 *     the query fails with code 42P01 and we treat it as 0 pending rows
 *     with a "table missing" note, so the job keeps the scheduler happy
 *     without erroring every hour.
 */
import type { Pool } from "pg";
import type { JobResult } from "./JobScheduler.js";
import type { SwedbankPayService } from "../payments/SwedbankPayService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:swedbank-payment-sync" });

export interface SwedbankPaymentSyncDeps {
  pool: Pool;
  schema: string;
  swedbankPayService: SwedbankPayService;
  /** Upper bound on intents processed per tick, protects against floods. */
  batchLimit?: number;
  /** Only reconcile intents newer than this many hours (legacy: 24h). */
  maxAgeHours?: number;
}

interface PendingIntentRow {
  id: string;
  user_id: string;
  status: string;
}

export function createSwedbankPaymentSyncJob(deps: SwedbankPaymentSyncDeps) {
  const batchLimit = deps.batchLimit ?? 50;
  const maxAgeHours = deps.maxAgeHours ?? 24;
  const table = `"${deps.schema}"."swedbank_payment_intents"`;

  return async function runSwedbankPaymentSync(_nowMs: number): Promise<JobResult> {
    let rows: PendingIntentRow[] = [];
    try {
      const result = await deps.pool.query<PendingIntentRow>(
        `SELECT id, user_id, status
         FROM ${table}
         WHERE status NOT IN ('PAID', 'CREDITED', 'FAILED', 'EXPIRED', 'CANCELLED')
           AND created_at >= now() - ($1 || ' hours')::interval
         ORDER BY created_at ASC
         LIMIT $2`,
        [String(maxAgeHours), batchLimit]
      );
      rows = result.rows;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      // 42P01 = undefined_table (PostgreSQL). Happens in dev where
      // migrations haven't been applied; keep scheduler noise-free.
      if (code === "42P01") {
        return { itemsProcessed: 0, note: "swedbank_payment_intents table missing" };
      }
      throw err;
    }

    if (rows.length === 0) {
      return { itemsProcessed: 0, note: "no pending intents" };
    }

    let successful = 0;
    let failed = 0;
    // Serial loop (not Promise.all) — mirrors legacy BATCH_SIZE=5 with a
    // small delay between batches; keeps load predictable on Swedbank side.
    for (const row of rows) {
      try {
        await deps.swedbankPayService.reconcileIntentForUser(row.id, row.user_id);
        successful++;
      } catch (err) {
        failed++;
        log.warn({ err, intentId: row.id }, "reconcile failed — will retry on next tick");
      }
    }

    // TODO(BIN-582): If the product team wants "mark intent as EXPIRED
    // after 24h with no progress", add an UPDATE here:
    //   UPDATE swedbank_payment_intents SET status = 'EXPIRED', ...
    //   WHERE created_at < now() - interval '24 hours' AND status NOT IN (…)
    // The legacy code did this but the new reconcile flow already sets
    // FAILED on concrete error signals, so we only add it if ops sees
    // stuck-pending rows in production.

    return {
      itemsProcessed: rows.length,
      note: `successful=${successful} failed=${failed}`,
    };
  };
}
