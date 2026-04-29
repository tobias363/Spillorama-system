/**
 * BIN-587 B4a: physical ticket (papirbillett) types.
 *
 * Typer, constants og internal row-interfaces for PhysicalTicketService.
 * Utskilt fra PhysicalTicketService.ts som del av S2-refactor; re-eksportert
 * derfra slik at eksisterende imports fortsetter å fungere.
 */

import type { Pool } from "pg";

export type PhysicalBatchStatus = "DRAFT" | "ACTIVE" | "CLOSED";
export type PhysicalTicketStatus = "UNSOLD" | "SOLD" | "VOIDED";

export const VALID_BATCH_STATUSES: PhysicalBatchStatus[] = ["DRAFT", "ACTIVE", "CLOSED"];

/** Max antall billetter som kan genereres i én batch (ops-grense). */
export const MAX_BATCH_SIZE = 10_000;

export interface PhysicalTicketBatch {
  id: string;
  hallId: string;
  batchName: string;
  rangeStart: number;
  rangeEnd: number;
  defaultPriceCents: number;
  gameSlug: string | null;
  assignedGameId: string | null;
  status: PhysicalBatchStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * BIN-698: vinnende mønster stemplet på billett-raden ved første BIN-641
 * check-bingo. Kanonisk 5×5 Bingo75-set; utvidelser gjøres via ny migrasjon.
 */
export type PhysicalTicketPattern =
  | "row_1"
  | "row_2"
  | "row_3"
  | "row_4"
  | "full_house";

export const VALID_PHYSICAL_TICKET_PATTERNS: readonly PhysicalTicketPattern[] = [
  "row_1",
  "row_2",
  "row_3",
  "row_4",
  "full_house",
] as const;

export interface PhysicalTicket {
  id: string;
  batchId: string;
  uniqueId: string;
  hallId: string;
  status: PhysicalTicketStatus;
  priceCents: number | null;
  assignedGameId: string | null;
  soldAt: string | null;
  soldBy: string | null;
  buyerUserId: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidedReason: string | null;
  createdAt: string;
  updatedAt: string;
  // ── BIN-698: win-data (stemplet av BIN-641 check-bingo ved første kall).
  /**
   * 25 tall i row-major-rekkefølge (5×5 grid, index 12 = free-centre = 0).
   * NULL før første check-bingo; immutable etter stamping.
   */
  numbersJson: number[] | null;
  /** Høyeste vinnende mønster ved stamping. NULL = ikke evaluert eller tapte. */
  patternWon: PhysicalTicketPattern | null;
  /**
   * Beregnet payout i cents. NULL = BIN-641 stamplet ikke beløp (dagens
   * oppførsel); BIN-639 (PR 2) setter verdi når admin distribuerer.
   */
  wonAmountCents: number | null;
  /** Tidspunkt for første BIN-641-stamping. NULL før check-bingo. */
  evaluatedAt: string | null;
  /** true = BIN-639 reward-all har distribuert premien. */
  isWinningDistributed: boolean;
  /** Tidspunkt for BIN-639-distribusjon. NULL før distribusjon. */
  winningDistributedAt: string | null;
}

export interface CreateBatchInput {
  hallId: string;
  batchName: string;
  rangeStart: number;
  rangeEnd: number;
  defaultPriceCents: number;
  gameSlug?: string | null;
  assignedGameId?: string | null;
  createdBy: string;
}

export interface UpdateBatchInput {
  batchName?: string;
  defaultPriceCents?: number;
  gameSlug?: string | null;
  assignedGameId?: string | null;
  status?: PhysicalBatchStatus;
}

export interface ListBatchesFilter {
  hallId?: string;
  status?: PhysicalBatchStatus;
  limit?: number;
}

export interface ListSoldTicketsFilter {
  hallId?: string;
  limit?: number;
}

export interface GenerateResult {
  batchId: string;
  generated: number;
  firstUniqueId: string;
  lastUniqueId: string;
}

export interface PhysicalTicketBatchTransfer {
  id: string;
  batchId: string;
  fromHallId: string;
  toHallId: string;
  reason: string;
  transferredBy: string;
  transferredAt: string;
  ticketCountAtTransfer: number;
}

/**
 * BIN-640: én cashout-rad per utbetalt fysisk billett. UNIQUE-constraint
 * på `ticketUniqueId` gir idempotens.
 */
export interface PhysicalTicketCashout {
  id: string;
  ticketUniqueId: string;
  hallId: string;
  gameId: string | null;
  payoutCents: number;
  paidBy: string;
  paidAt: string;
  notes: string | null;
  otherData: Record<string, unknown>;
}

export interface RecordCashoutInput {
  uniqueId: string;
  payoutCents: number;
  paidBy: string;
  notes?: string | null;
  otherData?: Record<string, unknown>;
}

export interface PhysicalTicketCashoutResult {
  cashout: PhysicalTicketCashout;
  ticket: PhysicalTicket;
}

/**
 * BIN-639: bulk reward-all input. Admin-UI beregner payoutCents per vinner
 * og sender array med `{ uniqueId, amountCents }`. Service prosesserer hver
 * ticket som egen mini-transaksjon slik at én feil ikke ruller tilbake de
 * andre.
 */
export interface RewardAllInput {
  gameId: string;
  rewards: Array<{ uniqueId: string; amountCents: number }>;
  actorId: string;
}

export type RewardAllDetailStatus =
  | "rewarded"
  | "skipped_already_distributed"
  | "skipped_not_stamped"
  | "skipped_not_won"
  | "skipped_wrong_game"
  | "ticket_not_found"
  | "invalid_amount";

export interface RewardAllDetail {
  uniqueId: string;
  status: RewardAllDetailStatus;
  amountCents?: number;
  cashoutId?: string;
  hallId?: string;
  message?: string;
}

export interface RewardAllResult {
  rewardedCount: number;
  totalPayoutCents: number;
  skippedCount: number;
  details: RewardAllDetail[];
}

export interface PhysicalTicketServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

export interface BatchRow {
  id: string;
  hall_id: string;
  batch_name: string;
  range_start: string | number;
  range_end: string | number;
  default_price_cents: string | number;
  game_slug: string | null;
  assigned_game_id: string | null;
  status: PhysicalBatchStatus;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface TicketRow {
  id: string;
  batch_id: string;
  unique_id: string;
  hall_id: string;
  status: PhysicalTicketStatus;
  price_cents: string | number | null;
  assigned_game_id: string | null;
  sold_at: Date | string | null;
  sold_by: string | null;
  buyer_user_id: string | null;
  voided_at: Date | string | null;
  voided_by: string | null;
  voided_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  // BIN-698: win-data-kolonner. pg-driver returnerer JSONB som parsed object,
  // men eldre miljøer kan returnere string — håndteres i mapTicket.
  numbers_json?: unknown;
  pattern_won?: string | null;
  won_amount_cents?: string | number | null;
  evaluated_at?: Date | string | null;
  is_winning_distributed?: boolean | null;
  winning_distributed_at?: Date | string | null;
}

export interface CashoutRow {
  id: string;
  ticket_unique_id: string;
  hall_id: string;
  game_id: string | null;
  payout_cents: string | number;
  paid_by: string;
  paid_at: Date | string;
  notes: string | null;
  other_data: unknown;
}
