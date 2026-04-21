/**
 * BIN-582: BankID / ID-document expiry reminder job (legacy daily cron).
 * line 4967, `checkBankIdAndIdCardExpiryAndSendReminders`): finds users
 * whose BankID auth or hall-verified ID-card is about to expire, sends a
 * reminder email, and marks already-expired ones as EXPIRED so the auth
 * flow forces re-verification.
 *
 * Port strategy for the new backend:
 *   - We look at `app_users.kyc_verified_at` + `kyc_status = VERIFIED` and
 *     treat BankID verifications as valid for 12 months (Norwegian
 *     regulatory norm; the legacy system stored an explicit
 *     `bankIdAuth.expiryDate` we don't model yet).
 *   - Users whose verification expires within 30 days get a log entry;
 *     e-mail sending is stubbed until SMTP is production-verified
 *     (nodemailer is in package.json but no sender is wired in yet).
 *   - Users whose verification has passed the 12-month mark get
 *     `kyc_status = 'EXPIRED'` so the login flow will force re-KYC.
 *
 * The "id_document_expires_at" column the task description asked about
 * does not exist yet — when we wire in BankID proper and get the real
 * expiry date back from the OIDC handshake, a follow-up migration should
 * add it. For now we use `kyc_verified_at + 12 months` as the proxy and
 * mark it with a TODO.
 *
 * This job is date-keyed so it only runs once per calendar day even
 * though the scheduler ticks more frequently.
 */
import type { Pool } from "pg";
import type { JobResult } from "./JobScheduler.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:bankid-expiry-reminder" });

// Legacy BankID validity: 12 months from verification.
const BANKID_VALIDITY_DAYS = 365;
// Send reminder when verification is within this window of expiring.
const REMINDER_WINDOW_DAYS = 30;

export interface BankIdExpiryReminderDeps {
  pool: Pool;
  schema: string;
  /** Preferred run-hour local time (legacy was 00:00 daily; task asked 07:00). */
  runAtHourLocal?: number;
  /** Override for testing — if set, always runs regardless of hour/date-key. */
  alwaysRun?: boolean;
}

interface ExpiringUserRow {
  id: string;
  email: string;
  kyc_verified_at: Date;
  days_until_expiry: number;
}

export function createBankIdExpiryReminderJob(deps: BankIdExpiryReminderDeps) {
  const usersTable = `"${deps.schema}"."app_users"`;
  const runAtHour = deps.runAtHourLocal ?? 7;
  let lastRunDateKey = "";

  function dateKey(nowMs: number): string {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return async function runBankIdExpiryReminder(nowMs: number): Promise<JobResult> {
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

    // Query upcoming + already-expired verifications in a single pass.
    // Using explicit intervals (not computed columns) so the DB can use
    // the expression directly and we don't need a migration for an
    // `expires_at` column yet.
    let expiring: ExpiringUserRow[] = [];
    let expiredCount = 0;
    try {
      const expiringResult = await deps.pool.query<ExpiringUserRow>(
        `SELECT id, email, kyc_verified_at,
                EXTRACT(DAY FROM ((kyc_verified_at + ($1 || ' days')::interval) - now()))::int AS days_until_expiry
           FROM ${usersTable}
          WHERE kyc_status = 'VERIFIED'
            AND kyc_verified_at IS NOT NULL
            AND kyc_verified_at + ($1 || ' days')::interval BETWEEN now() AND now() + ($2 || ' days')::interval`,
        [String(BANKID_VALIDITY_DAYS), String(REMINDER_WINDOW_DAYS)]
      );
      expiring = expiringResult.rows;

      // Mark already-expired verifications as EXPIRED.
      const expiredResult = await deps.pool.query(
        `UPDATE ${usersTable}
            SET kyc_status = 'EXPIRED', updated_at = now()
          WHERE kyc_status = 'VERIFIED'
            AND kyc_verified_at IS NOT NULL
            AND kyc_verified_at + ($1 || ' days')::interval < now()`,
        [String(BANKID_VALIDITY_DAYS)]
      );
      expiredCount = expiredResult.rowCount ?? 0;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "42P01" || code === "42703") {
        // 42P01 = undefined_table, 42703 = undefined_column.
        return { itemsProcessed: 0, note: "app_users table/columns missing" };
      }
      throw err;
    }

    // STUB: e-mail sending. Log one row per user for now; wire into
    // nodemailer + Spillorama-templated mail when SMTP is signed off.
    for (const user of expiring) {
      log.info(
        { userId: user.id, daysUntilExpiry: user.days_until_expiry },
        "[stub] would send BankID expiry reminder (no SMTP yet)"
      );
    }

    lastRunDateKey = todayKey;

    return {
      itemsProcessed: expiring.length + expiredCount,
      note: `reminders=${expiring.length} (stubbed) expired=${expiredCount}`,
    };
  };
}
