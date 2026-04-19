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
  /** G2/G3: Hall the player joined from — enables per-hall distribution display. */
  hallId?: string;
}

export interface Ticket {
  // Grid of numbers. Format depends on game type:
  // - Databingo60: 3x5 grid (3 rows, 5 cols), numbers 1-60, no free space.
  // - Bingo75:     5x5 grid (5 rows, 5 cols), numbers 1-75, center=0 (free).
  grid: number[][];
  /**
   * BIN-509: stable identifier for display (pre-round) tickets so the client can
   * reference a specific ticket to replace. Assigned by RoomStateManager when
   * tickets are generated; absent on in-game tickets because those aren't
   * user-addressable (replacement is disallowed once a game is RUNNING).
   */
  id?: string;
  /** Display color name matching Unity TicketColorManager, e.g. "Small Yellow", "Elvis 1". */
  color?: string;
  /** Ticket type code for variant logic: "small", "large", "elvis", "traffic-red", etc. */
  type?: string;
  /**
   * G15 (BIN-431): ticket-detail fields rendered on flip.
   * Mirrors Unity BingoTicket.cs:374-399 — ticketNumber, hallName, supplierName,
   * ticketPrice, plus a web-only boughtAt timestamp. Populated in
   * buildRoomUpdatePayload (display-only; not persisted by BingoEngine).
   * All optional / non-breaking — clients falls back to placeholders.
   */
  ticketNumber?: string;
  hallName?: string;
  supplierName?: string;
  price?: number;
  boughtAt?: string;
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

export interface JackpotState {
  playerId: string;
  prizeList: number[];
  totalSpins: number;
  playedSpins: number;
  spinHistory: { spinNumber: number; segmentIndex: number; prizeAmount: number }[];
  isComplete: boolean;
}

export type MiniGameType = "wheelOfFortune" | "treasureChest" | "mysteryGame" | "colorDraft";

export interface MiniGameState {
  playerId: string;
  type: MiniGameType;
  prizeList: number[];
  isPlayed: boolean;
  result?: { segmentIndex: number; prizeAmount: number };
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
  /** Game 5 jackpot mini-game (activated after BINGO win). */
  jackpot?: JackpotState;
  /** Game 1 mini-game (wheel of fortune / treasure chest, activated after BINGO win). */
  miniGame?: MiniGameState;
  /** BIN-460: Admin can pause a running game — freezes draws until resumed. */
  isPaused?: boolean;
  pauseMessage?: string;
  /** BIN-463: Test game — no real money transactions. */
  isTestGame?: boolean;
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
  /** BIN-460: True if admin has paused this game. */
  isPaused?: boolean;
  pauseMessage?: string;
  /** BIN-463: Test game — no real money transactions. */
  isTestGame?: boolean;
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
