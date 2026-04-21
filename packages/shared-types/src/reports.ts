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

/**
 * BIN-648: physical-tickets aggregate — deprecated placeholder-shape.
 *
 * Kept for admin-web PR-A4a's fallback wrapper. The canonical wire-shape for
 * the aggregate endpoint is `PhysicalTicketsAggregateRow` below; new consumers
 * should use that. Existing consumers of this placeholder will continue to
 * fall back to the "backend gap" banner (placeholder rows) since the new
 * endpoint lives under a different URL with a per-(gameId, hallId) shape.
 *
 * @deprecated BIN-648 shipped with `PhysicalTicketsAggregateRow`; this shape
 *             is no longer emitted by the backend and will be removed once
 *             admin-web migrates.
 */
export interface PhysicalTicketReportRow {
  date: string;
  hallId: string;
  hallName?: string;
  ticketsSold: number;
  ticketsRefunded: number;
  totalStakes: number;
  totalPayouts: number;
}

// ── BIN-648: physical-tickets aggregate (sold / pending / cashed-out) ──────

/**
 * BIN-648 canonical shape: one row per `(gameId, hallId)` combination.
 * Emitted by `GET /api/admin/reports/physical-tickets/aggregate`.
 *
 * - `sold`: tickets in scope with status='SOLD' that have NO matching
 *   `app_agent_transactions` row with `action_type='CASH_OUT'`.
 * - `pending`: alias for `sold` — BIN-648-contract exposes both so admin-UI
 *   can map 1:1 to the Linear spec columns without client-side renaming.
 * - `cashedOut`: tickets SOLD in scope that later had a matching CASH_OUT
 *   agent-transaction (joined on `ticket_unique_id`).
 * - `totalRevenueCents`: sum of `COALESCE(ticket.price_cents, batch.default_price_cents)`
 *   for all SOLD tickets in the row's scope.
 */
export interface PhysicalTicketsAggregateRow {
  gameId: string | null;
  hallId: string;
  sold: number;
  pending: number;
  cashedOut: number;
  totalRevenueCents: number;
}

export interface PhysicalTicketsAggregateTotals {
  sold: number;
  pending: number;
  cashedOut: number;
  totalRevenueCents: number;
  rowCount: number;
}

/** Wire-shape for `GET /api/admin/reports/physical-tickets/aggregate`. */
export interface PhysicalTicketsAggregateResponse {
  generatedAt: string;
  from: string | null;
  to: string | null;
  hallId: string | null;
  rows: PhysicalTicketsAggregateRow[];
  totals: PhysicalTicketsAggregateTotals;
}

// ── BIN-638: physical-tickets games-in-hall aggregate ─────────────────────

/**
 * BIN-638: per-game aggregate-row scoped to a single hall.
 * Emitted by `GET /api/admin/physical-tickets/games/in-hall?hallId=&from=&to=`.
 *
 * Legacy-reference: `legacy/unity-backend/App/Views/physicalTickets/
 * physicalGameTicketList.html` viste per-game liste med pending/rewarded-
 * tellere før agent dykker inn i enkelt-billettene. Denne kontrakten er den
 * nye canonical shape som blokkerer admin-web PR-B3.
 *
 * - `gameId`: `app_physical_tickets.assigned_game_id` (kan være `null` for
 *   billetter som er SOLD uten eksplisitt game-tilordning).
 * - `name`: `hall_game_schedules.display_name` når `gameId` matcher en
 *   schedule-slot; null ellers (pragmatisk lookup — `assigned_game_id` kan
 *   referere til session-IDer uten schedule-slot-rad).
 * - `status`: `hall_game_schedules.is_active ? 'ACTIVE' : 'INACTIVE'`, null
 *   hvis gameId ikke matcher en schedule-slot.
 * - `sold`: billetter i scope med status='SOLD' (inkluderer både cashed-out
 *   og ikke-cashed-out). Nært analogt til BIN-648 `sold + cashedOut`.
 * - `pendingCashoutCount`: sold-billetter som IKKE har en matchende
 *   `app_agent_transactions` CASH_OUT-rad. Samme som BIN-648's `pending`.
 * - `cashedOut`: sold-billetter med matchende CASH_OUT-transaksjon.
 * - `ticketsInPlay`: alias for `pendingCashoutCount` — BIN-638-kontrakten
 *   (Linear-spec) eksponerer begge navnene eksplisitt så admin-UI kan
 *   mappe 1:1 til kolonnene `ticketsInPlay` og `pendingCashoutCount` uten
 *   klient-side rename.
 * - `totalRevenueCents`: sum av `COALESCE(ticket.price_cents,
 *   batch.default_price_cents)` for alle SOLD-billetter i raden.
 */
export interface PhysicalTicketsGameInHallRow {
  gameId: string | null;
  name: string | null;
  status: "ACTIVE" | "INACTIVE" | null;
  sold: number;
  pendingCashoutCount: number;
  /** Alias for `pendingCashoutCount` — BIN-638-kontrakten krever begge. */
  ticketsInPlay: number;
  cashedOut: number;
  totalRevenueCents: number;
}

export interface PhysicalTicketsGamesInHallTotals {
  sold: number;
  pendingCashoutCount: number;
  ticketsInPlay: number;
  cashedOut: number;
  totalRevenueCents: number;
  rowCount: number;
}

/** Wire-shape for `GET /api/admin/physical-tickets/games/in-hall`. */
export interface PhysicalTicketsGamesInHallResponse {
  generatedAt: string;
  hallId: string;
  from: string | null;
  to: string | null;
  rows: PhysicalTicketsGameInHallRow[];
  totals: PhysicalTicketsGamesInHallTotals;
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

/**
 * BIN-650 placeholder: red-flag category with count of open flags.
 *
 * Kept for admin-web PR-A4a's gap-banner wrapper
 * (`admin-reports-redflag.ts`). The canonical wire-shape emitted by
 * `GET /api/admin/reports/red-flag/categories` is
 * `RedFlagCategoryRow` + `RedFlagCategoriesResponse` below.
 *
 * @deprecated Use `RedFlagCategoryRow` + `RedFlagCategoriesResponse` instead.
 */
export interface RedFlagCategory {
  id: string;
  name: string;
  description: string;
  playerCount: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * BIN-650 canonical shape: one row per AML rule-category aggregated over
 * the requested `[from, to]` window.
 *
 * Legacy mapping (`legacy/unity-backend/App/Controllers/redFlagCategoryController.js`):
 *   redFlagData[].name  → label
 *   (implicit count)    → count
 *   translate.*         → description
 *
 * `category` is the AML rule-slug (e.g. `high-velocity`, `lost-per-day`,
 * `pep`, `risk-country`). `severity` matches `AmlService.AmlSeverity`.
 * `count` is the number of red-flags (all statuses) for that slug in the
 * window. `openCount` is the subset still with status='OPEN' — useful
 * for compliance dashboards that surface unresolved flags.
 */
export interface RedFlagCategoryRow {
  category: string;
  label: string;
  description: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  count: number;
  openCount: number;
}

export interface RedFlagCategoriesTotals {
  totalFlags: number;
  totalOpenFlags: number;
  categoryCount: number;
}

/** Wire-shape for `GET /api/admin/reports/red-flag/categories`. */
export interface RedFlagCategoriesResponse {
  from: string;
  to: string;
  generatedAt: string;
  categories: RedFlagCategoryRow[];
  totals: RedFlagCategoriesTotals;
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

/**
 * BIN-651: paginated response for GET /api/admin/reports/red-flag/players.
 *
 * `category` is the slug that was filtered on (null = all categories).
 * `from`/`to` echo the requested ISO window (null = no bound).
 * `nextCursor` is an opaque base64url offset; null when no more rows.
 * `totalCount` is the total number of matching flags before pagination.
 */
export interface RedFlagPlayersResponse {
  category: string | null;
  from: string | null;
  to: string | null;
  items: RedFlagPlayerEntry[];
  nextCursor: string | null;
  totalCount: number;
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

// ── BIN-630: player chips-history ──────────────────────────────────────────

/**
 * BIN-630: one wallet-transaksjon for en gitt spiller i admin-player-detalj-
 * UI. Chips = wallet-balance i admin-terminologi (legacy bingo-domene).
 *
 * Legacy reference:
 *   `legacy/unity-backend/App/Controllers/PlayerController.js` — external
 *   transactions API (linje ~1260) viste innskudd, uttak, gevinst, innsats
 *   og bonuser per spiller via `typeOfTransaction` + `category`.
 *
 * Backend-mapping:
 *   Kilde er `wallet_transactions` (én rad per hendelse på spillerens
 *   `wallet_accounts.id`). `balanceAfter` regnes ut ved å spille av saldoen
 *   bakover fra dagens balanse (DESC-sortert). `description` = `reason`.
 *   `sourceGameId` og `refundedAt` er future-proof felter — nå alltid null
 *   fordi vi ikke sporer dem direkte på wallet-tx'en (oppslag via
 *   compliance-ledger kan legges til senere uten wire-endring).
 */
export interface ChipsHistoryEntry {
  id: string;
  timestamp: string;
  type:
    | "DEBIT"
    | "CREDIT"
    | "TOPUP"
    | "WITHDRAWAL"
    | "TRANSFER_OUT"
    | "TRANSFER_IN";
  amount: number;
  balanceAfter: number;
  description: string;
  sourceGameId: string | null;
  refundedAt: string | null;
}

/**
 * BIN-630: paginert chips-historikk. Wire-shape for
 * `GET /api/admin/players/:id/chips-history`.
 *
 * - `userId` / `walletId` ekko request + wallet-kontoen entries kommer fra.
 * - `from`/`to` ekko requested ISO-vindu (null = ikke oppgitt).
 * - `items` er DESC på `timestamp` (nyeste først).
 * - `nextCursor` er opaque base64url-offset (null = ikke flere).
 */
export interface ChipsHistoryResponse {
  userId: string;
  walletId: string;
  from: string | null;
  to: string | null;
  items: ChipsHistoryEntry[];
  nextCursor: string | null;
}

// ── BIN-618: top-N players by wallet-balance ──────────────────────────────

/**
 * BIN-618: top-N players by wallet-balance.
 *
 * Legacy reference (`legacy/unity-backend/App/Controllers/Dashboard.js:120-127`):
 *   `PlayerServices.getAllPlayerDataTableSelected(query, { username: 1,
 *    profilePic: 1, walletAmount: 1 }, 0, 5, { walletAmount: -1 })`.
 *
 * The legacy dashboard widget ranks by current wallet balance descending —
 * NOT by 30-day stake. We preserve that contract so the existing admin-web
 * `TopPlayersBox` wires up 1:1 (`id` + `username` + `avatar` + `walletAmount`).
 *
 * Wire-shape emitted by `GET /api/admin/players/top?metric=wallet&limit=5`:
 *   `{ players: TopPlayerEntry[], count, limit, generatedAt }`
 */
export interface TopPlayerEntry {
  /** Stable user-id (app_users.id). */
  id: string;
  /** Display-name — legacy emitted `username`; we keep that field-name on the wire. */
  username: string;
  /** Optional avatar URL — legacy `profilePic`; absent → admin-web falls back to placeholder. */
  avatar?: string;
  /** Current wallet balance in Kr (not øre) — matches legacy `walletAmount`. */
  walletAmount: number;
}

export interface TopPlayersResponse {
  generatedAt: string;
  /** Echoed `limit` query-param. */
  limit: number;
  /** Ranked descending by `walletAmount`. `count` == `players.length`. */
  count: number;
  players: TopPlayerEntry[];
}

// ── BIN-629: Player login-history ───────────────────────────────────────────
//
// Wire-shape for `GET /api/admin/players/:id/login-history`. Per-player
// login audit view used by admin-player-detail-UI. Source of truth is the
// shared `app_audit_log` table — rows are emitted by the auth-router for
// every `/api/auth/login` success and failure. Legacy reference:
// `legacy/unity-backend/App/Models/loginHistory.js` (fields: date, ip,
// client; we add `success` + `failureReason` because the audit-log already
// distinguishes them — the legacy UI only rendered the first three).

/** Single login attempt for a player. */
export interface PlayerLoginHistoryEntry {
  /** Stable audit-log row id. */
  id: string;
  /** ISO-8601 timestamp of the login attempt. */
  timestamp: string;
  /** Remote IP, null if the request was loopback/proxy-stripped. */
  ipAddress: string | null;
  /** Client user-agent string, null if the browser omitted it. */
  userAgent: string | null;
  /** True when the login resulted in a session; false for failed attempts. */
  success: boolean;
  /** Stable code for why a failed login failed (`INVALID_CREDENTIALS`, …). */
  failureReason: string | null;
}

/** Paginated wire-shape for GET /api/admin/players/:id/login-history. */
export interface PlayerLoginHistoryResponse {
  userId: string;
  /** ISO window echoed back from the request, null when unbounded. */
  from: string | null;
  to: string | null;
  items: PlayerLoginHistoryEntry[];
  /** Opaque base64url offset cursor; null when no further pages. */
  nextCursor: string | null;
}

// ── BIN-698: physical-ticket win-data (prerequisite for BIN-639 reward-all) ──

/**
 * BIN-698: vinnende mønster stemplet på en fysisk papirbillett ved første
 * BIN-641 check-bingo. Kanonisk Bingo75-set; utvidelser legges til via ny
 * migrasjon + eksplisitt whitelist.
 */
export type PhysicalTicketPattern =
  | "row_1"
  | "row_2"
  | "row_3"
  | "row_4"
  | "full_house";

/**
 * BIN-698: win-data-felter stemplet på `app_physical_tickets` ved BIN-641
 * check-bingo. Immutable etter første stamping; BIN-639 (reward-all PR 2)
 * distribuerer beløp og setter `isWinningDistributed = true`.
 */
export interface PhysicalTicketWinData {
  /**
   * 25 tall i row-major-rekkefølge (5×5 grid, index 12 = free-centre = 0).
   * NULL før første check-bingo; immutable etter stamping.
   */
  numbersJson: number[] | null;
  /** Høyeste vinnende mønster ved stamping. NULL = ikke evaluert eller tapte. */
  patternWon: PhysicalTicketPattern | null;
  /**
   * Beregnet payout i cents. NULL = BIN-641 har ikke kalkulert beløp (dagens
   * PR 1-atferd); BIN-639 (PR 2) setter verdi ved distribusjon.
   */
  wonAmountCents: number | null;
  /** ISO-tidspunkt for første BIN-641-stamping. NULL før check-bingo. */
  evaluatedAt: string | null;
  /** true = BIN-639 reward-all har distribuert premien for denne billetten. */
  isWinningDistributed: boolean;
  /** ISO-tidspunkt for BIN-639-distribusjon. NULL før distribusjon. */
  winningDistributedAt: string | null;
}

/**
 * BIN-641 / BIN-698 response body for
 * `POST /api/admin/physical-tickets/:uniqueId/check-bingo`. Utvider dagens
 * read-only shape med idempotens-metadata (alreadyEvaluated, evaluatedAt)
 * og win-data-persistens (wonAmountCents, isWinningDistributed) som gjør
 * BIN-639 reward-all mulig i PR 2.
 */
export interface PhysicalTicketCheckBingoResponse {
  uniqueId: string;
  gameId: string;
  gameStatus: string;
  hasWon: boolean;
  winningPattern: PhysicalTicketPattern | null;
  matchedNumbers: number[];
  drawnNumbersCount: number;
  payoutEligible: boolean;
  /** BIN-698: true hvis billetten allerede var stemplet fra en tidligere check. */
  alreadyEvaluated: boolean;
  /** BIN-698: ISO-tidspunkt for stamping (satt etter første check-bingo). */
  evaluatedAt: string | null;
  /** BIN-698: stamplet beløp. NULL i PR 1 — BIN-639 setter verdi ved distribusjon. */
  wonAmountCents: number | null;
  /** BIN-698: true når BIN-639 har distribuert premien. */
  isWinningDistributed: boolean;
}
