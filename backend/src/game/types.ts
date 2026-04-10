export type ClaimType = "LINE" | "BINGO";
export type GameStatus = "WAITING" | "RUNNING" | "ENDED";

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
  startedAt: string;
  endedAt?: string;
  endedReason?: string;
}

export interface RoomState {
  code: string;
  hallId: string;
  hostPlayerId: string;
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
  drawnNumbers: number[];
  remainingNumbers: number;
  lineWinnerId?: string;
  bingoWinnerId?: string;
  claims: ClaimRecord[];
  tickets: Record<string, Ticket[]>;
  marks: Record<string, number[]>;
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
  createdAt: string;
  players: Player[];
  currentGame?: GameSnapshot;
  gameHistory: GameSnapshot[];
}

export interface RoomSummary {
  code: string;
  hallId: string;
  hostPlayerId: string;
  playerCount: number;
  createdAt: string;
  gameStatus: GameStatus | "NONE";
}
