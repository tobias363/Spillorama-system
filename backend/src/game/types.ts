export type ClaimType = "LINE" | "BINGO";
export type GameStatus = "WAITING" | "RUNNING" | "ENDED";

// ── Pattern system ──────────────────────────────────────────────────────────
// Patterns define win conditions for a game round. Each pattern maps to a
// ClaimType (LINE or BINGO) and has a prize expressed as a percentage of the
// prize pool. Patterns are won in `order` sequence.

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

export interface Player {
  id: string;
  name: string;
  walletId: string;
  balance: number;
  socketId?: string;
}

export interface Ticket {
  // 3x5 grid (3 rows, 5 columns), numbers 1-60. No free space.
  grid: number[][];
}

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

export interface GameState {
  id: string;
  status: GameStatus;
  entryFee: number;
  ticketsPerPlayer: number;
  prizePool: number;
  remainingPrizePool: number;
  payoutPercent: number;
  maxPayoutBudget: number;
  remainingPayoutBudget: number;
  drawBag: number[];
  drawnNumbers: number[];
  tickets: Map<string, Ticket[]>;
  marks: Map<string, Set<number>[]>;
  claims: ClaimRecord[];
  lineWinnerId?: string;
  bingoWinnerId?: string;
  /** KRITISK-8: Player IDs that participated (were armed + paid buy-in) when the game started. */
  participatingPlayerIds?: string[];
  patterns?: PatternDefinition[];
  patternResults?: PatternResult[];
  startedAt: string;
  endedAt?: string;
  endedReason?: string;
}

export interface RoomState {
  code: string;
  hallId: string;
  hostPlayerId: string;
  gameSlug?: string;
  players: Map<string, Player>;
  currentGame?: GameState;
  gameHistory: GameSnapshot[];
  createdAt: string;
}

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
  startedAt: string;
  endedAt?: string;
  endedReason?: string;
}

/** Extended snapshot with full engine state for crash recovery (KRITISK-5/6). */
export interface RecoverableGameSnapshot extends GameSnapshot {
  /** Ordered remaining draw sequence (consumed by drawNextNumber). */
  drawBag: number[];
  /** Per-ticket marks preserving ticket association (replaces flat marks for recovery). */
  structuredMarks: Record<string, number[][]>;
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
