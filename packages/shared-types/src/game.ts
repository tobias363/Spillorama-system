// ── Client-visible game domain types ─────────────────────────────────────────
// These types represent data the client receives from the backend via Socket.IO
// and REST API. Server-internal types (GameState, RoomState) using Map/Set stay
// in the backend.

export type ClaimType = "LINE" | "BINGO";
export type GameStatus = "WAITING" | "RUNNING" | "ENDED";

// ── Pattern system ──────────────────────────────────────────────────────────

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
  /** Display color name matching Unity TicketColorManager, e.g. "Small Yellow", "Elvis 1". */
  color?: string;
  /** Ticket type code for variant logic: "small", "large", "elvis", "traffic-red", etc. */
  type?: string;
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
