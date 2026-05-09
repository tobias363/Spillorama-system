/**
 * §71 Regulatory ledger — hash-chain helpers (G2).
 *
 * Mirrors the wallet-layer hash-chain pattern (BIN-764, see
 * `apps/backend/src/adapters/PostgresWalletAdapter.ts:183-223` and
 * `apps/backend/src/wallet/WalletAuditVerifier.ts`) but for the
 * §71-data tables `app_regulatory_ledger` and `app_daily_regulatory_reports`.
 *
 * Why we mirror the pattern instead of reusing the helpers:
 * - The hash-input shape is different (regulatory-ledger has `event_date`,
 *   `transaction_type`, `amount_nok`, `ticket_ref`, `metadata`-via-skip while
 *   wallet has `side`, `account_side`, etc).
 * - The two chains are independent — wallet covers MONEY-MOVEMENTS, regulatory
 *   covers WHAT-LOTTERITILSYNET-SEES. Both must be verifiable separately.
 *
 * Canonical JSON rules:
 * - Keys sorted alphabetically (deterministic output across Node versions).
 * - Numeric `amount_nok` serialized as STRING (avoids JS-float jitter that
 *   would silently break the chain when a row is re-hashed).
 * - `metadata` field is INTENTIONALLY excluded from the hash — see migration
 *   `20260417000005_regulatory_ledger.sql:62`. Tampering with `metadata`
 *   never breaks the chain since money-amounts are not stored there.
 * - `prev_hash` is concatenated as raw input to SHA-256 (same as wallet).
 *   GENESIS sentinel is 64 hex zeros for the first row in the chain.
 */

import { createHash } from "node:crypto";

/** Genesis sentinel — first row in chain has prev_hash=NULL but the canonical
 * input still hashes against this value so the verifier walk-up has a
 * well-defined starting point. */
export const REGULATORY_LEDGER_GENESIS = "0".repeat(64);

/**
 * Fields that participate in `event_hash`. Locked at first prod-deploy: any
 * change requires a re-hash migration. Order in this interface is irrelevant
 * — `canonicalJsonForLedgerEntry` sorts keys alphabetically before stringify.
 *
 * NB: This MUST match the SHA-256 input documented in migration
 * `20260417000005_regulatory_ledger.sql:17-20,64`:
 *   sha256(id || event_date || channel || hall_id || transaction_type
 *          || amount_nok || ticket_ref || created_at || prev_hash)
 *
 * We use canonical-JSON (sorted-keys + amount-as-string) which is a
 * stricter superset of the raw `||`-concatenation in the SQL comment —
 * canonical-JSON guarantees identical output for any verifier that uses
 * the same shape, while raw-concat is brittle to NULL handling. The SQL
 * comment is descriptive (which fields contribute), not prescriptive
 * (the exact byte-stream).
 */
export interface RegulatoryLedgerHashInput {
  /** UUID generated client-side. */
  id: string;
  /** ISO date YYYY-MM-DD (Europe/Oslo business date). */
  event_date: string;
  /** "HALL" | "INTERNET". */
  channel: string;
  /** Hall ID (always required per migration). */
  hall_id: string;
  /** "TICKET_SALE" | "PRIZE_PAYOUT" | "REFUND" | "ADJUSTMENT". */
  transaction_type: string;
  /** Amount in NOK with 2 decimals — serialized as STRING in canonical JSON
   * to avoid JS-float drift across hosts. */
  amount_nok: string;
  /** Optional ticket reference (serial / ticket_id). NULL serialized as null. */
  ticket_ref: string | null;
  /** ISO 8601 UTC timestamp. */
  created_at: string;
}

/**
 * Canonical JSON: alphabetically-sorted keys, NULL preserved, amount as
 * string. This is the byte-stream that gets fed to SHA-256.
 */
export function canonicalJsonForLedgerEntry(input: RegulatoryLedgerHashInput): string {
  const keys = Object.keys(input).sort();
  return JSON.stringify(input, keys);
}

/**
 * SHA-256(prev_hash || canonicalJson(input)).
 * `prev_hash` is the previous row's `event_hash`, or `REGULATORY_LEDGER_GENESIS`
 * for the first row in the chain (database column will be NULL but hash input
 * uses GENESIS).
 */
export function computeLedgerEventHash(
  previousHash: string,
  input: RegulatoryLedgerHashInput,
): string {
  return createHash("sha256")
    .update(previousHash, "utf8")
    .update(canonicalJsonForLedgerEntry(input), "utf8")
    .digest("hex");
}

// ── Daily-report chain (G3) ──────────────────────────────────────────────

/**
 * Fields that participate in `signed_hash` for `app_daily_regulatory_reports`.
 * Locked at first prod-deploy. Matches migration
 * `20260417000006_daily_regulatory_reports.sql:41`:
 *   sha256(report_date||hall_id||channel||ticket_turnover||prizes_paid
 *          ||tickets_sold||unique_players||first_seq||last_seq||prev_hash)
 *
 * Canonical-JSON form (alphabetic keys) is the actual hashed byte-stream.
 */
export interface DailyRegulatoryReportHashInput {
  report_date: string;
  hall_id: string;
  channel: string;
  /** ticket_turnover_nok — STRING for float-stability. */
  ticket_turnover_nok: string;
  /** prizes_paid_nok — STRING. */
  prizes_paid_nok: string;
  tickets_sold_count: number;
  unique_players: number;
  /** ledger_first_sequence — STRING (BIGSERIAL → string for stability). */
  ledger_first_sequence: string;
  /** ledger_last_sequence — STRING (BIGSERIAL → string for stability). */
  ledger_last_sequence: string;
}

export function canonicalJsonForDailyReport(input: DailyRegulatoryReportHashInput): string {
  const keys = Object.keys(input).sort();
  return JSON.stringify(input, keys);
}

/**
 * SHA-256(prev_hash || canonicalJson(input)) for daily-report chain.
 *
 * `prev_hash` is the previous DAY's `signed_hash` (per (hall_id, channel) — or
 * across all rows globally if we keep one chain; we choose one chain per
 * (hall_id, channel) tuple for parallel verification, see G3 design notes).
 * GENESIS for the very first row in a (hall, channel) chain.
 */
export function computeDailyReportSignedHash(
  previousHash: string,
  input: DailyRegulatoryReportHashInput,
): string {
  return createHash("sha256")
    .update(previousHash, "utf8")
    .update(canonicalJsonForDailyReport(input), "utf8")
    .digest("hex");
}
