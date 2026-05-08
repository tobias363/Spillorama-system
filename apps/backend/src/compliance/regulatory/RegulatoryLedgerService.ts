/**
 * §71 Regulatory ledger — service layer (G2).
 *
 * Bridges legacy `ComplianceLedger.recordComplianceLedgerEvent` events into
 * the canonical `app_regulatory_ledger` table with hash-chain + immutability.
 *
 * Design (parallel-write, fire-and-forget):
 *
 * ```
 *  ComplianceLedger.recordComplianceLedgerEvent(...)
 *     ├── INSERT app_rg_compliance_ledger  ← legacy, primary path
 *     └── (optional) RegulatoryLedgerService.recordFromComplianceEvent(...)
 *           └── INSERT app_regulatory_ledger ← new, hash-chained path
 * ```
 *
 * The new path is **non-blocking**: if it fails (DB-write error,
 * hash-chain race etc.) we LOG the failure but never throw — the legacy
 * path remains the system-of-record during transition. After we have one
 * full month of dual-write data (post-pilot), we can flip the primary
 * path so `app_regulatory_ledger` is canonical and the legacy path gets
 * the fire-and-forget treatment.
 *
 * Event-type mapping (legacy → §71):
 *   STAKE             → TICKET_SALE
 *   PRIZE             → PRIZE_PAYOUT
 *   EXTRA_PRIZE       → PRIZE_PAYOUT  (collapsed; metadata.extra=true)
 *   ORG_DISTRIBUTION  → ADJUSTMENT    (organization-distribution post-§11)
 *   HOUSE_RETAINED    → ADJUSTMENT    (split-rounding rest)
 *   HOUSE_DEFICIT     → ADJUSTMENT    (audit signal)
 *   refund (future)   → REFUND
 *
 * Sign convention: `app_regulatory_ledger.amount_nok` is signed —
 *   - positive for TICKET_SALE (omsetning IN)
 *   - negative for PRIZE_PAYOUT, REFUND (penger UT)
 *   - signed-context-dependent for ADJUSTMENT (per migration comment 60)
 */

import { randomUUID } from "node:crypto";
import type { Logger } from "../../util/logger.js";
import { logger as rootLogger } from "../../util/logger.js";
import { formatOsloDateKey } from "../../util/osloTimezone.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedgerTypes.js";
import {
  RegulatoryLedgerStore,
  type RegulatoryLedgerChannel,
  type RegulatoryLedgerInsertInput,
  type RegulatoryLedgerRow,
  type RegulatoryLedgerTransactionType,
} from "./RegulatoryLedgerStore.js";

export interface RegulatoryLedgerServiceOptions {
  store: RegulatoryLedgerStore;
  logger?: Logger;
  /** If true, propagate insertion errors to the caller (used in tests).
   * Defaults to false in prod so the legacy path is never blocked by a
   * §71-store outage. */
  throwOnError?: boolean;
}

export class RegulatoryLedgerService {
  private readonly store: RegulatoryLedgerStore;
  private readonly log: Logger;
  private readonly throwOnError: boolean;

  constructor(options: RegulatoryLedgerServiceOptions) {
    this.store = options.store;
    this.log = options.logger ?? rootLogger.child({ module: "regulatory-ledger-service" });
    this.throwOnError = options.throwOnError ?? false;
  }

  /**
   * Map a fully-formed `ComplianceLedgerEntry` to `app_regulatory_ledger`
   * and append. Called from `ComplianceLedger.recordComplianceLedgerEvent`
   * AFTER the legacy persist has succeeded (so the new write only races
   * with itself, not with the operational path).
   *
   * Returns the inserted §71-row, or null if the event was filtered out
   * (e.g. unknown event-type — should not happen but we log and skip).
   */
  async recordFromComplianceEvent(
    entry: ComplianceLedgerEntry,
  ): Promise<RegulatoryLedgerRow | null> {
    try {
      const mapped = this.mapEntry(entry);
      if (!mapped) {
        return null;
      }
      return await this.store.insertEvent(mapped);
    } catch (err) {
      // Tamper-resistant ledgers should NEVER swallow errors silently in
      // production — but during dual-write transition, blocking a legitimate
      // wallet-touch on §71-ledger health is worse. Log loud, escalate via
      // metrics (TODO: prometheus counter `regulatory_ledger_write_errors`).
      this.log.error(
        {
          err: serializeError(err),
          entryId: entry.id,
          eventType: entry.eventType,
          hallId: entry.hallId,
          amount: entry.amount,
        },
        "REGULATORY_LEDGER_WRITE_FAILED",
      );
      if (this.throwOnError) {
        throw err;
      }
      return null;
    }
  }

  /**
   * Map a legacy compliance-ledger event to the canonical §71 shape. Pure
   * function — no DB access. Exposed for tests.
   *
   * Returns null if the event-type does not have a §71-counterpart (should
   * not happen with current event-types but defensive for future-extension).
   */
  mapEntry(entry: ComplianceLedgerEntry): RegulatoryLedgerInsertInput | null {
    const transactionType = mapEventType(entry.eventType);
    if (!transactionType) {
      this.log.warn(
        { entryId: entry.id, eventType: entry.eventType },
        "regulatory-ledger: unknown event-type, skipping",
      );
      return null;
    }

    // Sign convention: TICKET_SALE positive, PRIZE_PAYOUT/REFUND negative,
    // ADJUSTMENT signed by metadata if known else positive.
    const sign = signFor(transactionType);
    const amountNok = roundTo2dp(sign * Math.abs(entry.amount));

    // Event-date = Europe/Oslo business date of the event timestamp.
    // Reuses the canonical helper from `osloTimezone.ts` (same one
    // `yesterdayOsloKey` builds on) for tz-stability across DST.
    const eventDate = formatOsloDateKey(new Date(entry.createdAtMs));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      throw new Error(`Invalid event timestamp: ${entry.createdAtMs}`);
    }

    // Ticket-ref: Spill 1 events carry it on metadata.ticketRef (when known);
    // mini-game events carry it via claimId. We accept any non-empty value.
    const ticketRef =
      typeof entry.metadata?.ticketRef === "string" && entry.metadata.ticketRef.trim()
        ? entry.metadata.ticketRef.trim()
        : entry.claimId?.trim() || null;

    // Pass-through metadata, with an `extra` flag for EXTRA_PRIZE so the
    // mapping-collapse stays auditable.
    const metadata: Record<string, unknown> = {
      legacyEventType: entry.eventType,
      gameType: entry.gameType,
      ...(entry.gameId ? { gameId: entry.gameId } : {}),
      ...(entry.roomCode ? { roomCode: entry.roomCode } : {}),
      ...(entry.batchId ? { batchId: entry.batchId } : {}),
      ...(entry.policyVersion ? { policyVersion: entry.policyVersion } : {}),
      ...(entry.eventType === "EXTRA_PRIZE" ? { extraPrize: true } : {}),
      ...(entry.metadata ? { source: entry.metadata } : {}),
    };

    return {
      id: randomUUID(),
      event_date: eventDate,
      channel: entry.channel as RegulatoryLedgerChannel,
      hall_id: entry.hallId,
      // §71 hooks: draw-session-id is not on ComplianceLedgerEntry yet,
      // but gameId for Spill 1 IS the scheduled-game-id, which links to
      // a draw-session via app_draw_sessions.scheduled_game_id. We do
      // NOT join here — leave NULL, let the verifier query rebuild the
      // chain by sequence + event_date.
      draw_session_id: null,
      user_id: entry.playerId ?? null,
      transaction_type: transactionType,
      amount_nok: amountNok,
      ticket_ref: ticketRef,
      metadata,
    };
  }
}

/** Map legacy event-type → §71 transaction-type. Returns null for unknown. */
function mapEventType(
  eventType: ComplianceLedgerEntry["eventType"],
): RegulatoryLedgerTransactionType | null {
  switch (eventType) {
    case "STAKE":
      return "TICKET_SALE";
    case "PRIZE":
    case "EXTRA_PRIZE":
      return "PRIZE_PAYOUT";
    case "ORG_DISTRIBUTION":
    case "HOUSE_RETAINED":
    case "HOUSE_DEFICIT":
      return "ADJUSTMENT";
    default:
      return null;
  }
}

/** Sign convention per §71: omsetning positive, utbetaling negative. */
function signFor(type: RegulatoryLedgerTransactionType): 1 | -1 {
  switch (type) {
    case "TICKET_SALE":
      return 1;
    case "PRIZE_PAYOUT":
    case "REFUND":
      return -1;
    case "ADJUSTMENT":
      // Adjustments default to positive (ORG_DISTRIBUTION, HOUSE_RETAINED
      // both shrink the house's hold and are positive accounting events
      // from the org/house-retained perspective). Caller can pass negative
      // amounts via the legacy entry and the abs() in `mapEntry` keeps
      // the sign-convention consistent.
      return 1;
  }
}

function roundTo2dp(value: number): number {
  // Avoid 0.1+0.2 jitter — Math.round on shifted value.
  return Math.round(value * 100) / 100;
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}
