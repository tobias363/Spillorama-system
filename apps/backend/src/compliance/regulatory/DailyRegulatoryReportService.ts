/**
 * §71 Daily report — service layer (G3 + G4).
 *
 * Generates rows in `app_daily_regulatory_reports` from the canonical ledger
 * `app_regulatory_ledger`. Computes the four fields the §71-verification report
 * (`docs/compliance/SPILL71_DAILY_REPORT_VERIFICATION_2026-Q3.md`) flagged as
 * MISSING:
 *
 *   G4-a: `tickets_sold_count`  — count of TICKET_SALE rows in the bucket
 *                                  (NB: this is "tickets purchased on this
 *                                   day", not "ledger events", so it's
 *                                   correct as-per §71 wording)
 *   G4-b: `unique_players`      — DISTINCT user_id from TICKET_SALE rows
 *   G4-c: `ledger_first_seq`    — MIN(sequence) for the bucket
 *   G4-d: `ledger_last_seq`     — MAX(sequence) for the bucket
 *   G3:   `prev_hash`           — yesterday's `signed_hash` for (hall, channel)
 *                                  chain — NULL for the very first day
 *   G3:   `signed_hash`         — SHA-256(prev_hash || canonical(this row))
 *
 * Chain design: ONE chain per (hall_id, channel) tuple. Rationale:
 *  - Per-hall verification: Lotteritilsynet can audit one hall in isolation
 *    without needing the whole national chain.
 *  - Channel separation: hall-cash-flow and internet-flow are reported
 *    separately per §11 (different distribution percentages).
 *  - We considered a single global chain but rejected it because adding a
 *    new hall mid-pilot would require chain-replay, which is operationally
 *    fragile.
 *
 * Idempotency: re-running the cron for the same (date, hall, channel) is a
 * no-op — the UNIQUE-constraint + ON CONFLICT DO NOTHING on the table
 * ensures we never accidentally insert duplicate reports. The signed-hash
 * for an already-existing row is NEVER recomputed (immutability-trigger
 * prevents UPDATE; verifier walks stored hashes).
 *
 * Failure-modes:
 *  - If yesterday's signed_hash is missing for a (hall, channel) chain BUT
 *    we know the hall was active before, the chain has a gap. We log a
 *    `CHAIN_GAP_DETECTED` warning and use GENESIS as prev_hash (admin must
 *    investigate). This is conservative — the verifier will flag the gap.
 *  - If the ledger has no TICKET_SALE/PRIZE_PAYOUT rows for a (date, hall,
 *    channel) bucket, we DO NOT insert a daily-report row for that bucket
 *    (no data → no report). This means the chain can have non-consecutive
 *    dates per (hall, channel) — that's OK because the chain links by
 *    most-recent-prior, not by literal date-1.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Logger } from "../../util/logger.js";
import { logger as rootLogger } from "../../util/logger.js";
import {
  computeDailyReportSignedHash,
  REGULATORY_LEDGER_GENESIS,
  type DailyRegulatoryReportHashInput,
} from "./RegulatoryLedgerHash.js";
import {
  RegulatoryLedgerStore,
  type RegulatoryLedgerChannel,
} from "./RegulatoryLedgerStore.js";

export interface DailyRegulatoryReportRow {
  id: string;
  reportDate: string;
  hallId: string;
  channel: RegulatoryLedgerChannel;
  ticketTurnoverNok: number;
  prizesPaidNok: number;
  ticketsSoldCount: number;
  uniquePlayers: number;
  ledgerFirstSequence: string;
  ledgerLastSequence: string;
  prevHash: string | null;
  signedHash: string;
  inserted: boolean; // false if row already existed (re-run no-op)
}

export interface DailyReportGenerationResult {
  date: string;
  rows: DailyRegulatoryReportRow[];
  /** (hall, channel) chains where we used GENESIS because no prior signed_hash
   * was found. Empty for steady-state operation; non-empty during initial
   * deploy or after a chain-gap-detected. */
  chainsStartedFromGenesis: Array<{ hallId: string; channel: RegulatoryLedgerChannel }>;
  durationMs: number;
}

export interface DailyRegulatoryReportServiceOptions {
  pool: Pool;
  schema: string;
  store: RegulatoryLedgerStore;
  logger?: Logger;
}

export class DailyRegulatoryReportService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly store: RegulatoryLedgerStore;
  private readonly log: Logger;

  constructor(options: DailyRegulatoryReportServiceOptions) {
    this.pool = options.pool;
    this.schema = options.schema;
    this.store = options.store;
    this.log = options.logger ?? rootLogger.child({ module: "daily-regulatory-report" });
  }

  private ledgerTable(): string {
    return `"${this.schema}"."app_regulatory_ledger"`;
  }

  /**
   * Generate (or re-confirm) all (hall, channel) report-rows for one date.
   * Returns a result describing what was inserted.
   *
   * Caller (cron) typically passes yesterday's Oslo date so that the day
   * is "closed" by the time we aggregate. Re-running for any past date is
   * safe (idempotent — see file-header comment).
   */
  async generateForDate(input: {
    date: string; // YYYY-MM-DD (Europe/Oslo business date)
    generatedBy?: string | null;
  }): Promise<DailyReportGenerationResult> {
    const startMs = Date.now();
    const date = input.date;
    const generatedBy = input.generatedBy ?? null;

    // 1. Aggregate the ledger for this date, grouping by (hall, channel).
    const buckets = await this.aggregateBuckets(date);
    if (buckets.length === 0) {
      this.log.info({ date }, "no §71-ledger rows for date — nothing to report");
      return {
        date,
        rows: [],
        chainsStartedFromGenesis: [],
        durationMs: Date.now() - startMs,
      };
    }

    const rows: DailyRegulatoryReportRow[] = [];
    const genesisStarts: Array<{
      hallId: string;
      channel: RegulatoryLedgerChannel;
    }> = [];

    // 2. For each bucket, look up the previous (hall, channel) signed_hash,
    //    compute this row's signed_hash, and insert.
    for (const bucket of buckets) {
      const prevHash = await this.store.getLastDailyReportSignedHash({
        hallId: bucket.hallId,
        channel: bucket.channel,
        beforeDate: date,
      });
      const prevHashForCompute = prevHash ?? REGULATORY_LEDGER_GENESIS;
      if (prevHash === null) {
        genesisStarts.push({ hallId: bucket.hallId, channel: bucket.channel });
      }

      const hashInput: DailyRegulatoryReportHashInput = {
        report_date: date,
        hall_id: bucket.hallId,
        channel: bucket.channel,
        ticket_turnover_nok: bucket.ticketTurnoverNok.toFixed(2),
        prizes_paid_nok: bucket.prizesPaidNok.toFixed(2),
        tickets_sold_count: bucket.ticketsSoldCount,
        unique_players: bucket.uniquePlayers,
        ledger_first_sequence: bucket.ledgerFirstSequence,
        ledger_last_sequence: bucket.ledgerLastSequence,
      };
      const signedHash = computeDailyReportSignedHash(prevHashForCompute, hashInput);
      const id = randomUUID();

      const inserted = await this.store.upsertDailyReport({
        id,
        report_date: date,
        hall_id: bucket.hallId,
        channel: bucket.channel,
        ticket_turnover_nok: bucket.ticketTurnoverNok,
        prizes_paid_nok: bucket.prizesPaidNok,
        tickets_sold_count: bucket.ticketsSoldCount,
        unique_players: bucket.uniquePlayers,
        ledger_first_sequence: bucket.ledgerFirstSequence,
        ledger_last_sequence: bucket.ledgerLastSequence,
        prev_hash: prevHash,
        signed_hash: signedHash,
        generated_by: generatedBy,
      });

      rows.push({
        id,
        reportDate: date,
        hallId: bucket.hallId,
        channel: bucket.channel,
        ticketTurnoverNok: bucket.ticketTurnoverNok,
        prizesPaidNok: bucket.prizesPaidNok,
        ticketsSoldCount: bucket.ticketsSoldCount,
        uniquePlayers: bucket.uniquePlayers,
        ledgerFirstSequence: bucket.ledgerFirstSequence,
        ledgerLastSequence: bucket.ledgerLastSequence,
        prevHash,
        signedHash,
        inserted,
      });

      if (!inserted) {
        this.log.info(
          {
            date,
            hallId: bucket.hallId,
            channel: bucket.channel,
          },
          "daily-regulatory-report row already exists — re-run no-op",
        );
      }
    }

    return {
      date,
      rows,
      chainsStartedFromGenesis: genesisStarts,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Aggregate `app_regulatory_ledger` for one date into per-(hall, channel)
   * buckets. The query computes ALL §71-fields in one round-trip:
   *   - turnover (sum of TICKET_SALE amounts, positive)
   *   - prizes paid (sum of PRIZE_PAYOUT amounts, taking abs() because the
   *     ledger stores them negative)
   *   - tickets_sold_count (count of distinct ticket-purchases — we use
   *     count(*) on TICKET_SALE rows since each row represents one purchase
   *     event; multi-ticket batches show up as one row with sum-amount per
   *     `ComplianceLedger.recordComplianceLedgerEvent` semantics)
   *   - unique_players (DISTINCT user_id on TICKET_SALE rows; NULL user_ids
   *     for system-generated tickets are excluded since "player" implies an
   *     identifiable participant)
   *   - first_sequence / last_sequence (MIN / MAX of sequence column for ALL
   *     events in the bucket — TICKET_SALE + PRIZE_PAYOUT + ADJUSTMENT, since
   *     the auditor wants the full audit-trail bounds, not just sales)
   */
  private async aggregateBuckets(date: string): Promise<BucketAggregate[]> {
    const { rows } = await this.pool.query<{
      hall_id: string;
      channel: RegulatoryLedgerChannel;
      ticket_turnover_nok: string | null;
      prizes_paid_nok: string | null;
      tickets_sold_count: string;
      unique_players: string;
      ledger_first_sequence: string;
      ledger_last_sequence: string;
    }>(
      `SELECT hall_id,
              channel,
              -- TICKET_SALE rows have positive amount per sign-convention;
              -- coalesce to 0 if there are no sales (only payouts).
              SUM(amount_nok) FILTER (WHERE transaction_type = 'TICKET_SALE')::text
                AS ticket_turnover_nok,
              -- PRIZE_PAYOUT rows have negative amount; take abs() for the
              -- "prizes paid out" magnitude (positive number per §71).
              ABS(SUM(amount_nok) FILTER (WHERE transaction_type = 'PRIZE_PAYOUT'))::text
                AS prizes_paid_nok,
              COUNT(*) FILTER (WHERE transaction_type = 'TICKET_SALE')::text
                AS tickets_sold_count,
              COUNT(DISTINCT user_id)
                FILTER (WHERE transaction_type = 'TICKET_SALE' AND user_id IS NOT NULL)::text
                AS unique_players,
              MIN(sequence)::text AS ledger_first_sequence,
              MAX(sequence)::text AS ledger_last_sequence
         FROM ${this.ledgerTable()}
        WHERE event_date = $1
        GROUP BY hall_id, channel
        ORDER BY hall_id, channel`,
      [date]
    );

    return rows.map((row) => ({
      hallId: row.hall_id,
      channel: row.channel,
      ticketTurnoverNok: parseAmount(row.ticket_turnover_nok),
      prizesPaidNok: parseAmount(row.prizes_paid_nok),
      ticketsSoldCount: parseIntStrict(row.tickets_sold_count),
      uniquePlayers: parseIntStrict(row.unique_players),
      ledgerFirstSequence: row.ledger_first_sequence,
      ledgerLastSequence: row.ledger_last_sequence,
    }));
  }

  /**
   * Verify the chain integrity for a single (hall, channel) chain. Walks
   * all daily-report rows in date-ASC order, recomputes each `signed_hash`
   * from stored `prev_hash`, and reports mismatches.
   *
   * Used by `npm run verify:audit-chain` (G5 follow-up) and by Lotteritilsynet
   * audit-on-demand.
   */
  async verifyChain(input: {
    hallId: string;
    channel: RegulatoryLedgerChannel;
    sinceDate?: string;
  }): Promise<DailyReportChainMismatch[]> {
    const params: unknown[] = [input.hallId, input.channel];
    let extra = "";
    if (input.sinceDate) {
      params.push(input.sinceDate);
      extra = `AND report_date >= $${params.length}`;
    }
    const { rows } = await this.pool.query<{
      id: string;
      report_date: string;
      hall_id: string;
      channel: RegulatoryLedgerChannel;
      ticket_turnover_nok: string;
      prizes_paid_nok: string;
      tickets_sold_count: number;
      unique_players: number;
      ledger_first_sequence: string;
      ledger_last_sequence: string;
      prev_hash: string | null;
      signed_hash: string;
    }>(
      `SELECT id, report_date::text AS report_date, hall_id, channel,
              ticket_turnover_nok::text AS ticket_turnover_nok,
              prizes_paid_nok::text AS prizes_paid_nok,
              tickets_sold_count, unique_players,
              ledger_first_sequence::text AS ledger_first_sequence,
              ledger_last_sequence::text AS ledger_last_sequence,
              prev_hash, signed_hash
         FROM "${this.schema}"."app_daily_regulatory_reports"
        WHERE hall_id = $1 AND channel = $2 ${extra}
        ORDER BY report_date ASC, sequence ASC`,
      params
    );

    const mismatches: DailyReportChainMismatch[] = [];
    let lastStoredHash: string | null = null;
    let isFirst = true;

    for (const row of rows) {
      // Chain-link integrity: stored prev_hash must equal previous row's
      // signed_hash (or NULL/GENESIS for the first row).
      if (!isFirst && row.prev_hash !== lastStoredHash) {
        mismatches.push({
          reportId: row.id,
          reportDate: row.report_date,
          hallId: row.hall_id,
          channel: row.channel,
          reason: "previous_hash_mismatch",
          storedPrevHash: row.prev_hash,
          expectedPrevHash: lastStoredHash,
          storedSignedHash: row.signed_hash,
          expectedSignedHash: row.signed_hash,
        });
      }

      const prevForCompute = row.prev_hash ?? REGULATORY_LEDGER_GENESIS;
      const expected = computeDailyReportSignedHash(prevForCompute, {
        report_date: row.report_date,
        hall_id: row.hall_id,
        channel: row.channel,
        ticket_turnover_nok: row.ticket_turnover_nok,
        prizes_paid_nok: row.prizes_paid_nok,
        tickets_sold_count: row.tickets_sold_count,
        unique_players: row.unique_players,
        ledger_first_sequence: row.ledger_first_sequence,
        ledger_last_sequence: row.ledger_last_sequence,
      });
      if (expected !== row.signed_hash) {
        mismatches.push({
          reportId: row.id,
          reportDate: row.report_date,
          hallId: row.hall_id,
          channel: row.channel,
          reason: "signed_hash_mismatch",
          storedPrevHash: row.prev_hash,
          expectedPrevHash: lastStoredHash,
          storedSignedHash: row.signed_hash,
          expectedSignedHash: expected,
        });
      }

      lastStoredHash = row.signed_hash;
      isFirst = false;
    }

    return mismatches;
  }
}

interface BucketAggregate {
  hallId: string;
  channel: RegulatoryLedgerChannel;
  ticketTurnoverNok: number;
  prizesPaidNok: number;
  ticketsSoldCount: number;
  uniquePlayers: number;
  ledgerFirstSequence: string;
  ledgerLastSequence: string;
}

function parseAmount(value: string | null): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.round(n * 100) / 100;
}

function parseIntStrict(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

export interface DailyReportChainMismatch {
  reportId: string;
  reportDate: string;
  hallId: string;
  channel: RegulatoryLedgerChannel;
  reason: "signed_hash_mismatch" | "previous_hash_mismatch";
  storedPrevHash: string | null;
  expectedPrevHash: string | null;
  storedSignedHash: string;
  expectedSignedHash: string;
}
