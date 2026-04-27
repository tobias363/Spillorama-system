// ── Client-visible game domain types ─────────────────────────────────────────
// These types represent data the client receives from the backend via Socket.IO
// and REST API. Server-internal types (GameState, RoomState) using Map/Set stay
// in the backend.

export type ClaimType = "LINE" | "BINGO";
export type GameStatus = "WAITING" | "RUNNING" | "ENDED";

// ── Pattern system ──────────────────────────────────────────────────────────

/**
 * 25-bit bitmask encoding a 5x5 pattern (Game 3 Mønsterbingo).
 *
 * Bit layout (LSB = bit 0 = top-left cell, MSB = bit 24 = bottom-right):
 *
 * ```
 *  bit:  0  1  2  3  4   ← row 0 (top)
 *        5  6  7  8  9   ← row 1
 *       10 11 12 13 14   ← row 2 (center = bit 12)
 *       15 16 17 18 19   ← row 3
 *       20 21 22 23 24   ← row 4 (bottom)
 * ```
 *
 * `(row, col) → bit = row * 5 + col`.
 *
 * The center cell (bit 12) is the Bingo75 free space; patterns that require
 * the center should set bit 12. Patterns that leave it unset treat it as an
 * optional match (engine marks it automatically).
 *
 * Encoded as a JavaScript number (safe up to 2^53 — 25 bits is well within).
 * Serialized over the wire as a plain integer in JSON.
 *
 * Shared between:
 * - `apps/admin-web` — patternManagement/PatternAddPage bitmask-grid editor (PR-A3)
 * - `apps/backend` — Game 3 PatternMatcher / PatternCycler runtime (PR-C3)
 * - `packages/game-client` — client-side pattern visualisation
 *
 * @example
 *   // Full top row (Game 1 "Line" equivalent):
 *   const topRow: PatternMask = 0b11111; // bits 0–4 set → 31
 *
 *   // Full house (bingo — all 25 cells):
 *   const fullHouse: PatternMask = 0x1FFFFFF; // bits 0–24 → 33554431
 *
 *   // Diagonal TL→BR:
 *   const diag: PatternMask = (1<<0) | (1<<6) | (1<<12) | (1<<18) | (1<<24);
 */
export type PatternMask = number;

/** Utility: the full 25-bit mask (all cells). */
export const PATTERN_MASK_FULL: PatternMask = 0x1ffffff;

/** Utility: bit index of the center cell (row 2, col 2). */
export const PATTERN_MASK_CENTER_BIT = 12;

export interface PatternDefinition {
  id: string;
  name: string;
  claimType: ClaimType;
  /** Percentage of the prize pool awarded for this pattern (0–100). */
  prizePercent: number;
  /** Sequential order — patterns must be won in this order. */
  order: number;
  /** UI design identifier (1 = row, 2 = full house, 0 = custom). */
  design: number;
  /**
   * 25-bit bitmask of required cells (Game 3 custom patterns only).
   * Undefined for Game 1/Game 2 line+bingo patterns where the shape is
   * implied by `design`.
   */
  mask?: PatternMask;
  /**
   * Admin-configurable prize mode for this pattern.
   * - "percent" (default, absent): `prizePercent` of remaining pool.
   * - "fixed":           flat `prize1` kr amount, capped by RTP guards at payout.
   * - "multiplier-chain" (BIN-687 / PR-P2 Spillernes spill):
   *     Phase 1 uses `prizePercent` of pool with `minPrizeCents` floor.
   *     Phase N > 1 uses `phase1BasePrize × phase1Multiplier` with own
   *     `minPrizeCents` floor. All phases in the chain share the same
   *     mode; mixing percent/multiplier-chain across phases is allowed
   *     (typical Spillernes-config has phase 1 in percent-mode and
   *     phases 2-5 in multiplier-chain-mode).
   *
   * Promoted from backend-local `PatternDefinition` (BIN-615 / PR-C1) so
   * admin-UI → engine coupling can send per-game prize matrices over the
   * wire. Clients may read this to render expected prize amounts in the
   * pattern banner before the game starts.
   */
  winningType?:
    | "percent"
    | "fixed"
    | "multiplier-chain"
    | "column-specific"
    | "ball-value-multiplier";
  /**
   * Fixed prize amount in kr when `winningType === "fixed"`. Ignored for
   * "percent" mode. Legacy field name: prize1.
   */
  prize1?: number;
  /**
   * BIN-687 / PR-P2: Multiplier against phase-1 base prize. Only used when
   * `winningType === "multiplier-chain"` AND the pattern is NOT phase 1.
   * For Spillernes spill: Rad 2 = Rad 1 × 2 (multiplier=2), Rad 3 = Rad 1 × 3
   * (multiplier=3), etc. Absent on the phase-1 pattern itself.
   */
  phase1Multiplier?: number;
  /**
   * BIN-687 / PR-P2: Minimum prize floor in *kr* for this phase. Applied
   * after percent/multiplier calculation so the phase prize never falls
   * below the regulatory/UX floor even for low-pool games.
   *
   * Unit: kr (not cents) — matches `prize1`, `game.prizePool`, and the
   * percent-calculation path already used in BingoEngine.evaluateActivePhase.
   * Admin-UI accepts NOK input and writes kr directly.
   */
  minPrize?: number;
  /**
   * PR-P3 (Super-NILS): Column-specific prize matrix for Fullt Hus. The
   * column of the LAST drawn ball (the ball that completed the full-house)
   * determines which prize is paid. Mapping (75-ball bingo):
   *   B = 1-15, I = 16-30, N = 31-45, G = 46-60, O = 61-75.
   *
   * Only meaningful for the full-house pattern (claimType === "BINGO").
   * Ignored for other patterns. Validator rejects column-specific on
   * non-full-house patterns.
   *
   * Unit: kr (matches prize1 / minPrize).
   *
   * If `winningType === "column-specific"` and this field is missing or
   * the resolved column has no entry, engine fails closed with
   * `DomainError("COLUMN_PRIZE_MISSING")` — admin must configure all
   * five columns explicitly.
   */
  columnPrizesNok?: {
    B: number;
    I: number;
    N: number;
    G: number;
    O: number;
  };
  /**
   * PR-P4 (Ball × 10): base prize for Fullt Hus when
   * `winningType === "ball-value-multiplier"`. Final payout is
   * `baseFullHousePrizeNok + lastBall × ballValueMultiplier`.
   * Only meaningful on full-house. Validator rejects non-full-house.
   * Unit: kr.
   */
  baseFullHousePrizeNok?: number;
  /**
   * PR-P4 (Ball × 10): per-ball multiplier in kr. Combined with the
   * raw numeric value of the last drawn ball (NOT mapped to column).
   * Must be > 0. Missing field → engine fail-closed with
   * `DomainError("BALL_VALUE_FIELDS_MISSING")`.
   */
  ballValueMultiplier?: number;
}

export interface PatternResult {
  patternId: string;
  patternName: string;
  claimType: ClaimType;
  isWon: boolean;
  winnerId?: string;
  wonAtDraw?: number;
  payoutAmount?: number;
  claimId?: string;
}

// ── Player & Ticket ─────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  walletId: string;
  balance: number;
  socketId?: string;
  /** G2/G3: Hall the player joined from — enables per-hall distribution display. */
  hallId?: string;
}

export interface Ticket {
  // Grid of numbers. Format depends on game type:
  // - Databingo60: 3x5 grid (3 rows, 5 cols), numbers 1-60, no free space.
  // - Bingo75:     5x5 grid (5 rows, 5 cols), numbers 1-75, center=0 (free).
  grid: number[][];
  /**
   * BIN-509: stable id for pre-round (display) tickets. Allows the client to
   * reference a specific ticket in the ticket:replace event. Absent on in-game
   * tickets (those aren't replaceable — game is already RUNNING).
   */
  id?: string;
  /** Display color name matching Unity TicketColorManager, e.g. "Small Yellow", "Elvis 1". */
  color?: string;
  /** Ticket type code for variant logic: "small", "large", "elvis", "traffic-red", etc. */
  type?: string;
  /**
   * G15 (BIN-431): Ticket-detail fields rendered on flip.
   * Mirrors Unity BingoTicket.cs:374-399 (SetData) — txtTicketNumber, txtHallName,
   * txtSupplierName, txtTicketPrice, plus boughtAt timestamp.
   * All optional/non-breaking; the client falls back to placeholders if absent.
   */
  /** Human-readable ticket number (e.g. "42"). Unity: gameTicketData.ticketNumber. */
  ticketNumber?: string;
  /** Hall where the ticket was bought (e.g. "Oslo Sentrum"). Unity: Player_Hall_Name. */
  hallName?: string;
  /** Supplier/operator brand (e.g. "Spillorama"). Unity: gameTicketData.supplierName. */
  supplierName?: string;
  /** Price paid for this ticket (kroner, whole numbers). */
  price?: number;
  /** ISO-8601 timestamp when the ticket was bought/armed. */
  boughtAt?: string;
}

// ── Claims ──────────────────────────────────────────────────────────────────

export interface ClaimRecord {
  id: string;
  playerId: string;
  type: ClaimType;
  valid: boolean;
  reason?: string;
  winningPatternIndex?: number;
  patternIndex?: number;
  bonusTriggered?: boolean;
  bonusAmount?: number;
  payoutAmount?: number;
  payoutPolicyVersion?: string;
  payoutWasCapped?: boolean;
  rtpBudgetBefore?: number;
  rtpBudgetAfter?: number;
  rtpCapped?: boolean;
  /** BIN-45: Wallet transaction IDs for idempotency tracking. */
  payoutTransactionIds?: string[];
  createdAt: string;
}

// ── Snapshots (JSON-serialisable, sent to clients) ──────────────────────────

export interface GameSnapshot {
  id: string;
  status: GameStatus;
  entryFee: number;
  ticketsPerPlayer: number;
  prizePool: number;
  remainingPrizePool: number;
  payoutPercent: number;
  maxPayoutBudget: number;
  remainingPayoutBudget: number;
  /** BIN-243: Full ordered draw bag — required for deterministic recovery/replay. */
  drawBag: number[];
  drawnNumbers: number[];
  /** @deprecated use drawBag.length — kept for backward compat with old checkpoints */
  remainingNumbers: number;
  lineWinnerId?: string;
  bingoWinnerId?: string;
  patterns?: PatternDefinition[];
  patternResults?: PatternResult[];
  claims: ClaimRecord[];
  tickets: Record<string, Ticket[]>;
  /** BIN-244: Per-ticket mark sets — outer index = ticket index, inner = marked numbers. */
  marks: Record<string, number[][]>;
  participatingPlayerIds?: string[];
  /** BIN-460: True if admin has paused this game. */
  isPaused?: boolean;
  pauseMessage?: string;
  /**
   * MED-11: Estimated resume timestamp (ISO 8601). Hvis satt, skal klient vise
   * en countdown ("Spillet starter om 0:45") i stedet for en åpen tekst.
   * Når master ikke vet hvor lenge pausen varer, skal feltet være `undefined`
   * og klient viser fallback-tekst basert på `pauseReason`.
   */
  pauseUntil?: string;
  /**
   * MED-11: Maskinlesbar grunn til pausen — brukes av klient til å velge
   * passende kontekst-tekst når `pauseUntil` ikke er satt.
   *
   * - `AWAITING_OPERATOR`: Pause uten estimat, ofte fordi master venter på
   *   handling fra hallvert (typisk Bingo-check).
   * - `MANUAL_PAUSE`: Generisk manuell pause uten kjent varighet.
   * - `MANUAL_PAUSE_5MIN`/`MANUAL_PAUSE_2MIN`/`MANUAL_PAUSE_1MIN`: Korte
   *   manuelle pauser. Klient skal kombinere med `pauseUntil` når mulig.
   * - `AUTO_PAUSE_PHASE_WON`: Engine auto-pauser etter en pattern-payout.
   */
  pauseReason?: string;
  /** BIN-463: Test game — no real money transactions. */
  isTestGame?: boolean;
  startedAt: string;
  endedAt?: string;
  endedReason?: string;
}

export interface RoomSnapshot {
  code: string;
  hallId: string;
  hostPlayerId: string;
  gameSlug?: string;
  createdAt: string;
  players: Player[];
  currentGame?: GameSnapshot;
  gameHistory: GameSnapshot[];
}

export interface RoomSummary {
  code: string;
  hallId: string;
  hostPlayerId: string;
  gameSlug?: string;
  playerCount: number;
  createdAt: string;
  gameStatus: GameStatus | "NONE";
}
