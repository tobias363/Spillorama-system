export type ClaimType = "LINE" | "BINGO" | "PATTERN";
export type GameStatus = "WAITING" | "RUNNING" | "ENDED";

export interface Player {
  id: string;
  name: string;
  walletId: string;
  balance: number;
  socketId?: string;
}

export interface Ticket {
  // Authoritative cell order for Candy/Theme1 is row-major numbers[15].
  // grid is kept for compatibility with legacy validation/tests.
  numbers?: number[];
  grid: number[][];
}

export interface ClaimRecord {
  id: string;
  playerId: string;
  type: ClaimType;
  valid: boolean;
  reason?: string;
  claimKind?: "LEGACY_LINE" | "LEGACY_BINGO" | "PATTERN_FAMILY";
  winningPatternIndex?: number;
  patternIndex?: number;
  displayPatternNumber?: number;
  topperSlotIndex?: number;
  ticketIndex?: number;
  bonusTriggered?: boolean;
  bonusAmount?: number;
  payoutAmount?: number;
  payoutPolicyVersion?: string;
  payoutWasCapped?: boolean;
  rtpBudgetBefore?: number;
  rtpBudgetAfter?: number;
  rtpCapped?: boolean;
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
  activePatternIndexes: number[];
  patternPayoutAmounts: number[];
  drawBag: number[];
  drawnNumbers: number[];
  nearMissTargetRateApplied?: number;
  tickets: Map<string, Ticket[]>;
  marks: Map<string, Set<number>[]>;
  settledPatternTopperSlots: Map<string, Set<number>[]>;
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
  preRoundTicketsByPlayer: Map<string, Ticket[]>;
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
  activePatternIndexes: number[];
  patternPayoutAmounts: number[];
  drawnNumbers: number[];
  remainingNumbers: number;
  nearMissTargetRateApplied?: number;
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
  preRoundTickets?: Record<string, Ticket[]>;
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
