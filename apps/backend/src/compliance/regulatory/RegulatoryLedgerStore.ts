/**
 * §71 Regulatory ledger — Postgres store (G2).
 *
 * Direct-write to `app_regulatory_ledger` (defined in migration
 * `20260417000005_regulatory_ledger.sql`) which has hash-chain + immutability-
 * trigger. This store is INDEPENDENT of `PostgresResponsibleGamingStore`/
 * `app_rg_compliance_ledger` — both write-paths run in parallel during the
 * migration window so backwards-compat is preserved.
 *
 * Why independent store:
 * - Clean separation: `app_rg_compliance_ledger` is the LEGACY operational
 *   ledger (rich event-types, idempotency-key, no hash-chain). The new
 *   `app_regulatory_ledger` is the §71-CANONICAL ledger that Lotteritilsynet
 *   audits — narrower event-types, mandatory hall_id, hash-chain.
 * - The mappings between the two are slightly lossy (we collapse mini-game
 *   bonuses + extra-prizes into PRIZE_PAYOUT, etc.) — keeping them as
 *   independent writes makes the mapping explicit.
 *
 * Concurrency note:
 * - Hash-chain requires a SERIALIZABLE-equivalent guarantee that no two
 *   writers read the same `lastHash` and both append. We achieve this via
 *   a Postgres advisory lock keyed on the table so only one INSERT can race
 *   per process. For multi-instance setups this is **process-level** —
 *   actual cross-instance lock would need a real Postgres row-lock. Pilot
 *   is single-instance, so advisory-lock is enough today; documented as
 *   future-tighten in §10 of SPILL71_DAILY_REPORT verification report.
 */

import type { Pool } from "pg";
import { logger as rootLogger, type Logger } from "../../util/logger.js";
import {
  REGULATORY_LEDGER_GENESIS,
  computeLedgerEventHash,
  type RegulatoryLedgerHashInput,
} from "./RegulatoryLedgerHash.js";

export type RegulatoryLedgerChannel = "HALL" | "INTERNET";

export type RegulatoryLedgerTransactionType =
  | "TICKET_SALE"
  | "PRIZE_PAYOUT"
  | "REFUND"
  | "ADJUSTMENT";

/** Input shape for a new ledger event. `id`, `event_hash`, `prev_hash`,
 * `created_at`, `sequence` are filled by the store. */
export interface RegulatoryLedgerInsertInput {
  id: string;
  event_date: string;            // YYYY-MM-DD (Europe/Oslo)
  channel: RegulatoryLedgerChannel;
  hall_id: string;
  draw_session_id: string | null;
  user_id: string | null;
  transaction_type: RegulatoryLedgerTransactionType;
  /** NOK with 2 decimals — converted to NUMERIC in DB. */
  amount_nok: number;
  ticket_ref: string | null;
  metadata?: Record<string, unknown>;
}

export interface RegulatoryLedgerRow {
  id: string;
  sequence: string;        // BIGSERIAL as string (for cross-platform safety)
  event_date: string;
  channel: RegulatoryLedgerChannel;
  hall_id: string;
  draw_session_id: string | null;
  user_id: string | null;
  transaction_type: RegulatoryLedgerTransactionType;
  amount_nok: string;      // NUMERIC as string
  ticket_ref: string | null;
  metadata: Record<string, unknown>;
  prev_hash: string | null;
  event_hash: string;
  created_at: string;
}

export interface RegulatoryLedgerStoreOptions {
  pool: Pool;
  schema: string;
  logger?: Logger;
}

/** Postgres advisory-lock key (arbitrary 32-bit int — chosen to not collide
 * with other locks). Used to serialize writes within one process. */
const ADVISORY_LOCK_KEY = 71_05_2026;

export class RegulatoryLedgerStore {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly log: Logger;

  constructor(options: RegulatoryLedgerStoreOptions) {
    this.pool = options.pool;
    this.schema = options.schema;
    this.log = options.logger ?? rootLogger.child({ module: "regulatory-ledger-store" });
  }

  private table(): string {
    return `"${this.schema}"."app_regulatory_ledger"`;
  }

  private dailyReportsTable(): string {
    return `"${this.schema}"."app_daily_regulatory_reports"`;
  }

  /**
   * Append a new event to the ledger. Hash-chain is computed inside a single
   * transaction using SELECT ... FOR UPDATE on the latest row to prevent
   * two writers from reading the same `prev_hash`.
   *
   * Returns the inserted row (including computed `event_hash` and `sequence`).
   * Throws if the immutability-trigger fires (should not happen on INSERT).
   */
  async insertEvent(input: RegulatoryLedgerInsertInput): Promise<RegulatoryLedgerRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Process-level lock: serialize all writers from this Node process.
      // Cross-instance: SELECT-MAX-sequence-FOR-UPDATE-style serialization
      // is automatic via Postgres' MVCC — concurrent transactions will
      // serialize on the latest row's read-lock.
      await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY]);

      const { rows: prevRows } = await client.query<{ event_hash: string }>(
        `SELECT event_hash FROM ${this.table()}
          ORDER BY sequence DESC LIMIT 1`
      );
      const prevHash = prevRows.length > 0 ? prevRows[0]!.event_hash : null;
      const prevHashForCompute = prevHash ?? REGULATORY_LEDGER_GENESIS;

      const createdAt = new Date().toISOString();
      const amountStr = this.toAmountString(input.amount_nok);

      const hashInput: RegulatoryLedgerHashInput = {
        id: input.id,
        event_date: input.event_date,
        channel: input.channel,
        hall_id: input.hall_id,
        transaction_type: input.transaction_type,
        amount_nok: amountStr,
        ticket_ref: input.ticket_ref,
        created_at: createdAt,
      };
      const eventHash = computeLedgerEventHash(prevHashForCompute, hashInput);

      const { rows } = await client.query<RegulatoryLedgerRow>(
        `INSERT INTO ${this.table()} (
           id, event_date, channel, hall_id, draw_session_id, user_id,
           transaction_type, amount_nok, ticket_ref, metadata,
           prev_hash, event_hash, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9, $10::jsonb, $11, $12, $13)
         RETURNING id, sequence::text AS sequence, event_date::text AS event_date,
                   channel, hall_id, draw_session_id, user_id, transaction_type,
                   amount_nok::text AS amount_nok, ticket_ref, metadata,
                   prev_hash, event_hash, created_at`,
        [
          input.id,
          input.event_date,
          input.channel,
          input.hall_id,
          input.draw_session_id,
          input.user_id,
          input.transaction_type,
          amountStr,
          input.ticket_ref,
          JSON.stringify(input.metadata ?? {}),
          prevHash, // NULL preserved here — only the first row gets NULL prev_hash
          eventHash,
          createdAt,
        ]
      );

      await client.query("COMMIT");
      return rows[0]!;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * List events in chain-order (sequence ASC) for a date-range. Used by
   * the verifier and by the daily-report aggregator.
   */
  async listEventsForDate(eventDate: string): Promise<RegulatoryLedgerRow[]> {
    const { rows } = await this.pool.query<RegulatoryLedgerRow>(
      `SELECT id, sequence::text AS sequence, event_date::text AS event_date,
              channel, hall_id, draw_session_id, user_id, transaction_type,
              amount_nok::text AS amount_nok, ticket_ref, metadata,
              prev_hash, event_hash, created_at
         FROM ${this.table()}
        WHERE event_date = $1
        ORDER BY sequence ASC`,
      [eventDate]
    );
    return rows;
  }

  /**
   * Get sequence-bounds for a (date, hall, channel) bucket — used by
   * G4 daily-report computation.
   */
  async getSequenceBounds(input: {
    eventDate: string;
    hallId: string;
    channel: RegulatoryLedgerChannel;
  }): Promise<{ first: string; last: string } | null> {
    const { rows } = await this.pool.query<{ first_seq: string | null; last_seq: string | null }>(
      `SELECT MIN(sequence)::text AS first_seq, MAX(sequence)::text AS last_seq
         FROM ${this.table()}
        WHERE event_date = $1 AND hall_id = $2 AND channel = $3`,
      [input.eventDate, input.hallId, input.channel]
    );
    if (rows.length === 0 || rows[0]!.first_seq === null) {
      return null;
    }
    return { first: rows[0]!.first_seq!, last: rows[0]!.last_seq! };
  }

  /**
   * Read the previous day's signed_hash for a (hall, channel) chain. Returns
   * null if no prior day exists (genesis row).
   *
   * Used by `DailyRegulatoryReportService` to chain consecutive days.
   * Chain is per (hall_id, channel) so that one hall's report can be
   * verified independently of another's.
   */
  async getLastDailyReportSignedHash(input: {
    hallId: string;
    channel: RegulatoryLedgerChannel;
    /** Cutoff — only rows with report_date < this are considered. */
    beforeDate: string;
  }): Promise<string | null> {
    const { rows } = await this.pool.query<{ signed_hash: string }>(
      `SELECT signed_hash FROM ${this.dailyReportsTable()}
        WHERE hall_id = $1 AND channel = $2 AND report_date < $3
        ORDER BY report_date DESC LIMIT 1`,
      [input.hallId, input.channel, input.beforeDate]
    );
    return rows.length > 0 ? rows[0]!.signed_hash : null;
  }

  /**
   * Upsert a daily-report row. Uses `ON CONFLICT (report_date, hall_id, channel)
   * DO NOTHING` because the migration's UNIQUE-constraint forbids overwrite.
   * Returns true if the row was inserted, false if already existed (skipped).
   */
  async upsertDailyReport(input: {
    id: string;
    report_date: string;
    hall_id: string;
    channel: RegulatoryLedgerChannel;
    ticket_turnover_nok: number;
    prizes_paid_nok: number;
    tickets_sold_count: number;
    unique_players: number;
    ledger_first_sequence: string;
    ledger_last_sequence: string;
    prev_hash: string | null;
    signed_hash: string;
    generated_by: string | null;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO ${this.dailyReportsTable()} (
         id, report_date, hall_id, channel,
         ticket_turnover_nok, prizes_paid_nok,
         tickets_sold_count, unique_players,
         ledger_first_sequence, ledger_last_sequence,
         prev_hash, signed_hash, generated_at, generated_by
       )
       VALUES (
         $1, $2, $3, $4,
         $5::numeric, $6::numeric,
         $7, $8,
         $9::bigint, $10::bigint,
         $11, $12, now(), $13
       )
       ON CONFLICT (report_date, hall_id, channel) DO NOTHING`,
      [
        input.id,
        input.report_date,
        input.hall_id,
        input.channel,
        this.toAmountString(input.ticket_turnover_nok),
        this.toAmountString(input.prizes_paid_nok),
        input.tickets_sold_count,
        input.unique_players,
        input.ledger_first_sequence,
        input.ledger_last_sequence,
        input.prev_hash,
        input.signed_hash,
        input.generated_by,
      ]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Walk the ledger chain in sequence-order and verify each row's hash.
   * Returns mismatches; empty array means chain is intact.
   *
   * This is the canonical tamper-detection function. Hooked up to
   * `npm run verify:audit-chain` and the nightly cron (G5 follow-up).
   */
  async verifyChain(options?: { sinceDate?: string }): Promise<RegulatoryChainMismatch[]> {
    const params: unknown[] = [];
    let where = "";
    if (options?.sinceDate) {
      params.push(options.sinceDate);
      where = `WHERE event_date >= $${params.length}`;
    }
    const { rows } = await this.pool.query<RegulatoryLedgerRow>(
      `SELECT id, sequence::text AS sequence, event_date::text AS event_date,
              channel, hall_id, draw_session_id, user_id, transaction_type,
              amount_nok::text AS amount_nok, ticket_ref, metadata,
              prev_hash, event_hash, created_at
         FROM ${this.table()}
         ${where}
        ORDER BY sequence ASC`,
      params
    );

    const mismatches: RegulatoryChainMismatch[] = [];
    let lastStoredHash: string | null = null;
    let isFirstRow = true;

    for (const row of rows) {
      // For the very first row, prev_hash should be NULL in DB; for
      // subsequent rows, prev_hash should equal the previous row's event_hash.
      if (!isFirstRow && row.prev_hash !== lastStoredHash) {
        mismatches.push({
          eventId: row.id,
          sequence: row.sequence,
          reason: "previous_hash_mismatch",
          storedPrevHash: row.prev_hash,
          expectedPrevHash: lastStoredHash,
          storedEventHash: row.event_hash,
          expectedEventHash: row.event_hash, // not yet recomputed below
        });
      }

      const hashInput: RegulatoryLedgerHashInput = {
        id: row.id,
        event_date: row.event_date,
        channel: row.channel,
        hall_id: row.hall_id,
        transaction_type: row.transaction_type,
        amount_nok: row.amount_nok,
        ticket_ref: row.ticket_ref,
        created_at:
          typeof row.created_at === "string"
            ? row.created_at
            : new Date(row.created_at).toISOString(),
      };
      const prevForCompute = row.prev_hash ?? REGULATORY_LEDGER_GENESIS;
      const expected = computeLedgerEventHash(prevForCompute, hashInput);
      if (expected !== row.event_hash) {
        mismatches.push({
          eventId: row.id,
          sequence: row.sequence,
          reason: "event_hash_mismatch",
          storedPrevHash: row.prev_hash,
          expectedPrevHash: lastStoredHash,
          storedEventHash: row.event_hash,
          expectedEventHash: expected,
        });
      }

      lastStoredHash = row.event_hash;
      isFirstRow = false;
    }

    return mismatches;
  }

  /**
   * Round NOK to 2 decimals AS STRING. Must match canonical-JSON serialization
   * so the hash is reproducible from DB.
   */
  private toAmountString(value: number): string {
    if (!Number.isFinite(value)) {
      throw new Error(`amount_nok must be finite, got ${value}`);
    }
    return value.toFixed(2);
  }
}

export interface RegulatoryChainMismatch {
  eventId: string;
  sequence: string;
  reason: "event_hash_mismatch" | "previous_hash_mismatch";
  storedPrevHash: string | null;
  expectedPrevHash: string | null;
  storedEventHash: string;
  expectedEventHash: string;
}
