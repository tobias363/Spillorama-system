/**
 * BIN-587 B4a: row → domain-mappers for PhysicalTicketService.
 *
 * Utskilt fra PhysicalTicketService.ts som del av S2-refactor. Alle mappers
 * er rene (ingen klasse-state-avhengighet).
 */

import {
  asIso,
  asIsoOrNull,
  asJsonObject,
  parseNumbersJson,
  parsePattern,
} from "./PhysicalTicketValidators.js";
import type {
  BatchRow,
  CashoutRow,
  PhysicalTicket,
  PhysicalTicketBatch,
  PhysicalTicketCashout,
  TicketRow,
} from "./PhysicalTicketTypes.js";

export function mapBatch(row: BatchRow): PhysicalTicketBatch {
  return {
    id: row.id,
    hallId: row.hall_id,
    batchName: row.batch_name,
    rangeStart: Number(row.range_start),
    rangeEnd: Number(row.range_end),
    defaultPriceCents: Number(row.default_price_cents),
    gameSlug: row.game_slug,
    assignedGameId: row.assigned_game_id,
    status: row.status,
    createdBy: row.created_by,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

export function mapCashout(row: CashoutRow): PhysicalTicketCashout {
  return {
    id: row.id,
    ticketUniqueId: row.ticket_unique_id,
    hallId: row.hall_id,
    gameId: row.game_id,
    payoutCents: Number(row.payout_cents),
    paidBy: row.paid_by,
    paidAt: asIso(row.paid_at),
    notes: row.notes,
    otherData: asJsonObject(row.other_data),
  };
}

export function mapTicket(row: TicketRow): PhysicalTicket {
  return {
    id: row.id,
    batchId: row.batch_id,
    uniqueId: row.unique_id,
    hallId: row.hall_id,
    status: row.status,
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    assignedGameId: row.assigned_game_id,
    soldAt: asIsoOrNull(row.sold_at),
    soldBy: row.sold_by,
    buyerUserId: row.buyer_user_id,
    voidedAt: asIsoOrNull(row.voided_at),
    voidedBy: row.voided_by,
    voidedReason: row.voided_reason,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    // ── BIN-698: win-data
    numbersJson: parseNumbersJson(row.numbers_json),
    patternWon: parsePattern(row.pattern_won ?? null),
    wonAmountCents:
      row.won_amount_cents === null || row.won_amount_cents === undefined
        ? null
        : Number(row.won_amount_cents),
    evaluatedAt: asIsoOrNull(row.evaluated_at ?? null),
    isWinningDistributed: row.is_winning_distributed === true,
    winningDistributedAt: asIsoOrNull(row.winning_distributed_at ?? null),
  };
}
