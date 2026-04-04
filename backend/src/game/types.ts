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
  // 5x5 board, where 0 indicates the free center square.
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
  startedAt: string;
  endedAt?: string;
  endedReason?: string;
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
