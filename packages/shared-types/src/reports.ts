// PR-A4a (BIN-645) — shared report types used by both backend routes and
// admin-web API wrappers.
//
// These mirror the shapes emitted by `apps/backend/src/game/ComplianceLedger.ts`
// and `apps/backend/src/services/HallReportService.ts`. Types here intentionally
// stay minimal — consumers import them and extend via structural typing rather
// than carrying business-rule logic into shared-types.
//
// The gap-endpoint shapes (PhysicalTicketReportRow, UniqueTicketReportRow,
// RedFlagCategory, RedFlagPlayerEntry) are defined as the backend team has
// signalled them in BIN-648/BIN-650/BIN-651 specs. They will be the canonical
// wire format once those endpoints land; until then admin-web renders the
// gap-banner (`hasBackendGap: true`).
//
// References:
//   - PR-A4-PLAN §5 (Shared-types additions)
//   - BIN-647 (subgame drill-down)
//   - BIN-648 (physical-tickets aggregate)
//   - BIN-650 (red-flag categories)
//   - BIN-651 (red-flag players viewer)

// ── Core query shapes ───────────────────────────────────────────────────────

/** Inclusive date range in YYYY-MM-DD (UTC). */
export interface DateRangeQuery {
  startDate: string;
  endDate: string;
}

export interface HallScopedQuery extends DateRangeQuery {
  hallId?: string;
}

export type ReportGameSlug = "bingo" | "rocket" | "mystery" | "wheel" | "color-draft";

// ── Revenue / Range totals ──────────────────────────────────────────────────

export interface RevenueRow {
  date: string;
  hallId: string;
  hallName?: string;
  totalStakes: number;
  totalPrizes: number;
  net: number;
  stakeCount: number;
  prizeCount: number;
}

export interface RevenueSummaryTotals {
  totalStakes: number;
  totalPrizes: number;
  net: number;
  roundCount: number;
  uniquePlayerCount: number;
  uniqueHallCount: number;
}

export interface RevenueSummaryResponse {
  startDate: string;
  endDate: string;
  generatedAt: string;
  totalStakes: number;
  totalPrizes: number;
  net: number;
  roundCount: number;
  uniquePlayerCount: number;
  uniqueHallCount: number;
}

// ── Per-game drill-down ─────────────────────────────────────────────────────

export interface GameReportRow {
  hallId: string;
  gameType: string;
  roundCount: number;
  distinctPlayerCount: number;
  totalStakes: number;
  totalPrizes: number;
  net: number;
  averagePrizePerRound: number;
}

export interface GameReportResponse {
  startDate: string;
  endDate: string;
  generatedAt: string;
  rows: GameReportRow[];
  totals: {
    roundCount: number;
    distinctPlayerCount: number;
    totalStakes: number;
    totalPrizes: number;
    net: number;
  };
}

// ── Sessions / game-history ─────────────────────────────────────────────────

export interface SessionRow {
  gameId: string;
  hallId: string;
  gameType: string;
  firstEventAt: string;
  lastEventAt: string;
  totalStakes: number;
  totalPrizes: number;
  net: number;
  playerCount: number;
}

export interface SessionsResponse {
  startDate: string;
  endDate: string;
  generatedAt: string;
  rows: SessionRow[];
}

// ── Payout (per-player / per-ticket) ────────────────────────────────────────

export interface PayoutPlayerRow {
  userId: string;
  displayName?: string;
  totalBet: number;
  totalWinning: number;
  totalNet: number;
  gameCount: number;
}

export interface PayoutTicketRow {
  ticketId: string;
  gameId: string;
  hallId?: string;
  totalBet: number;
  totalWinning: number;
  totalNet: number;
  createdAt: string;
}

// ── Hall account / settlement ───────────────────────────────────────────────

/**
 * Daily hall-report row. Wire-shape emitted by backend
 * `HallAccountReportService.getDailyReport()` (see
 * `apps/backend/src/compliance/HallAccountReportService.ts:40`).
 *
 * All monetary values are in øre/cents (integer). `gameType` is null for
 * aggregate/"ALL" rows that carry only cash-flow totals (no ledger stakes).
 */
export interface HallAccountRow {
  date: string;                 // YYYY-MM-DD
  gameType: string | null;
  ticketsSoldCents: number;     // stake (omsetning)
  winningsPaidCents: number;    // prize (utbetalt)
  netRevenueCents: number;      // stake - prize
  cashInCents: number;
  cashOutCents: number;
  cardInCents: number;
  cardOutCents: number;
}

/**
 * Account-balance snapshot. Wire-shape from
 * `GET /api/admin/reports/halls/:hallId/account-balance`
 * (`apps/backend/src/compliance/HallAccountReportService.ts:64`).
 */
export interface HallAccountBalanceDto {
  hallId: string;
  hallCashBalance: number;
  dropsafeBalance: number;
  periodTotalCashInCents: number;
  periodTotalCashOutCents: number;
  periodTotalCardInCents: number;
  periodTotalCardOutCents: number;
  periodSellingByCustomerNumberCents: number;
  periodManualAdjustmentCents: number;
  periodNetCashFlowCents: number;
}

/**
 * Manual hall-account adjustment (rekvisita/coffee/bank-deposit/etc).
 * Wire-shape from `GET /api/admin/reports/halls/:hallId/manual-entries`
 * (`apps/backend/src/compliance/HallAccountReportService.ts:25`).
 */
export interface ManualAdjustmentEntryDto {
  id: string;
  hallId: string;
  amountCents: number;
  category: "BANK_DEPOSIT" | "BANK_WITHDRAWAL" | "CORRECTION" | "REFUND" | "OTHER";
  businessDate: string;         // YYYY-MM-DD
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface ShiftSettlementRow {
  shiftId: string;
  hallId: string;
  agentId: string;
  shiftDate: string;
  metroniaIn?: number;
  metroniaOut?: number;
  okBingoIn?: number;
  okBingoOut?: number;
  openDayIn?: number;
  openDayOut?: number;
  totalAmount: number;
  status: "OPEN" | "CLOSED" | "SETTLED";
}

// ── Gap-endpoint placeholder shapes (BIN-648, BIN-650, BIN-651) ────────────

/** BIN-648: physical-tickets aggregate per hall × day. */
export interface PhysicalTicketReportRow {
  date: string;
  hallId: string;
  hallName?: string;
  ticketsSold: number;
  ticketsRefunded: number;
  totalStakes: number;
  totalPayouts: number;
}

/**
 * BIN-647 placeholder (PR-A4a). Kept for backward compatibility with the
 * admin-web gap-banner wrapper (`admin-reports-drill.ts`) which predates the
 * canonical drill-down shape below. New consumers should use
 * `SubgameDrillDownItem` + `SubgameDrillDownResponse`.
 *
 * @deprecated Use `SubgameDrillDownItem` instead.
 */
export interface SubgameReportRow {
  subgameId: string;
  patternName: string;
  roundCount: number;
  winnerCount: number;
  totalStakes: number;
  totalPrizes: number;
  net: number;
}

/**
 * BIN-647: sub-game drill-down row for a single child (sub-game) under a
 * parent `hall_game_schedules` row.
 *
 * Legacy mapping (legacy/unity-backend/App/Views/report/subgame1reports.html):
 *   gameNumber              → subGameNumber
 *   gameMode                → gameMode
 *   startDate               → startDate
 *   subGames[0].gameName    → name
 *   halls                   → hallId + hallName
 *   ticketSold              → ticketCount
 *   earnedFromTickets       → revenue
 *   totalWinning            → totalWinnings
 *   finalGameProfitAmount   → netProfit
 *   profitPercentage        → profitPercentage
 *
 * `players` = count of distinct `wallet_id` with STAKE events for this
 * sub-game in the requested window (legacy Mongo field was implicit in
 * `ticketSold` — we expose it explicitly per task spec).
 */
export interface SubgameDrillDownItem {
  subGameId: string;
  subGameNumber: string | null;
  parentScheduleId: string;
  hallId: string;
  hallName: string;
  gameType: string;
  gameMode: string | null;
  name: string;
  sequence: number | null;
  startDate: string | null;
  revenue: number;
  totalWinnings: number;
  netProfit: number;
  profitPercentage: number;
  ticketCount: number;
  players: number;
}

export interface SubgameDrillDownResponse {
  parentId: string;
  from: string;
  to: string;
  items: SubgameDrillDownItem[];
  nextCursor: string | null;
  totals: {
    revenue: number;
    totalWinnings: number;
    netProfit: number;
    ticketCount: number;
    players: number;
  };
}

/** BIN-650: red-flag category with count of open flags. */
export interface RedFlagCategory {
  id: string;
  name: string;
  description: string;
  playerCount: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
}

/** BIN-651: player flagged in a red-flag category. */
export interface RedFlagPlayerEntry {
  userId: string;
  displayName: string;
  email: string;
  categoryId: string;
  flaggedAt: string;
  totalStakes: number;
  lastActivity: string;
}

/** Unique-ticket range report. */
export interface UniqueTicketRow {
  uniqueId: string;
  gameId: string;
  hallId: string;
  totalStakes: number;
  totalPrizes: number;
  createdAt: string;
}
