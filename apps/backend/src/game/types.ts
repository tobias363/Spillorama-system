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
  /**
   * BIN-615 / PR-C1: 25-cell bitmask (row-major, 5×5) for custom G3 patterns.
   * Populated from PatternConfig.patternDataList. Consumed by PR-C3 PatternMatcher.
   */
  patternDataList?: number[];
  /**
   * PR-P5: 25-bit bitmask for custom concurrent patterns (Extra-variant).
   * Satt fra CustomPatternDefinition.mask. Brukes av evaluateConcurrentPatterns
   * via PatternMatcher.matchesPattern.
   */
  mask?: number;
  /**
   * BIN-615 / PR-C1: G3 — pattern deactivates after this many balls drawn without a winner.
   * Used by PR-C3 pattern-cycler (evaluatePatternsAndUpdateGameData in legacy).
   */
  ballNumberThreshold?: number;
  /**
   * BIN-615 / PR-C1: G3 — alternative jackpot prize when pattern wins within ballNumberThreshold.
   * Legacy field name: prize1.
   */
  prize1?: number;
  /**
   * Prize-calculation variant.
   *   - "percent" (default): prizePercent of pool.
   *   - "fixed":             prize1 is flat kr.
   *   - "multiplier-chain"   (BIN-687 / PR-P2): phase 1 = percent with floor;
   *                          phase N = phase1Base × phase1Multiplier with floor.
   *   - "column-specific"    (PR-P3 Super-NILS): Fullt-Hus prize decided by
   *                          column of last drawn ball (B/I/N/G/O).
   *   - "ball-value-multiplier" (PR-P4 Ball × 10): Fullt-Hus-prize =
   *                          baseFullHousePrizeNok + lastBall × multiplier.
   */
  winningType?:
    | "percent"
    | "fixed"
    | "multiplier-chain"
    | "column-specific"
    | "ball-value-multiplier";
  /** BIN-687 / PR-P2: multiplier of phase-1 base prize. Only on phase > 1. */
  phase1Multiplier?: number;
  /** BIN-687 / PR-P2: minimum phase prize in kr (gulv). */
  minPrize?: number;
  /**
   * PR-P3 (Super-NILS): per-column prize matrix for full-house. Only used
   * when `winningType === "column-specific"` AND pattern is full-house.
   * Column of last drawn ball (B=1-15, I=16-30, N=31-45, G=46-60, O=61-75)
   * picks the entry. Values in kr. Engine throws
   * `DomainError("COLUMN_PRIZE_MISSING")` if missing.
   */
  columnPrizesNok?: {
    B: number;
    I: number;
    N: number;
    G: number;
    O: number;
  };
  /** PR-P4 (Ball × 10): base Fullt-Hus prize in kr. */
  baseFullHousePrizeNok?: number;
  /** PR-P4 (Ball × 10): kr per ball-value. Must be > 0. */
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
  /**
   * BIN-696: Alle spiller-IDer som vant denne fasen på samme draw.
   * Brukes av klient-popup for å forklare multi-winner-split
   * ("Premien delt på 3 spillere"). `winnerId` beholdes for backward-
   * compat og peker til første vinner.
   */
  winnerIds?: string[];
  /** PR-P5: antall vinnere på samme draw. Speiler `winnerIds.length`. */
  winnerCount?: number;
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
  /** Display color name, e.g. "Small Yellow", "Elvis 1". Match the web-klient fargevalg. */
  color?: string;
  /** Ticket type code for variant logic: "small", "large", "elvis", "traffic-red", etc. */
  type?: string;
  /**
   * G15 (BIN-431): ticket-detail fields rendered on flip.
   * Populated in buildRoomUpdatePayload (display-only; not persisted by
   * BingoEngine). Felter: ticketNumber, hallName, supplierName, ticketPrice +
   * web-only boughtAt timestamp. All optional / non-breaking — klienten
   * faller tilbake til placeholdere.
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
  /**
   * BIN-615 / PR-C2: True when the server generated this claim automatically
   * (e.g. Game 2 detecting 9/9 matched, or Game 3 pattern auto-claim in C3).
   * Distinguishes audit-trail entries for server-initiated claims from manual
   * claim:submit events.
   */
  autoGenerated?: boolean;
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
  /**
   * MED-11: ISO 8601 timestamp for når master forventer å gjenoppta spillet.
   * Brukes av klient til å vise countdown. `undefined` = ukjent varighet.
   */
  pauseUntil?: string;
  /**
   * MED-11: Maskinlesbar grunn til pausen (`AWAITING_OPERATOR`, `MANUAL_PAUSE`,
   * `MANUAL_PAUSE_5MIN`, etc.). Brukes av klient til å velge fallback-tekst
   * når `pauseUntil` ikke er satt.
   */
  pauseReason?: string;
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
  // BIN-672: required. Every room knows its game slug — input is defaulted
  // to "bingo" in BingoEngine.createRoom if the caller didn't pass one.
  gameSlug: string;
  /**
   * CRIT-4 / HIGH-1 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26):
   *
   * Hvis satt, betyr det at dette in-memory rommet er et **scheduled
   * Spill 1**-rom (slug `bingo`), opprettet via `game1:join-scheduled`.
   * Per `SPILL1_ENGINE_ROLES_2026-04-23.md`: scheduled Spill 1 SKAL
   * ALDRI bruke `BingoEngine.startGame/drawNextNumber/evaluateActivePhase/
   * submitClaim` — autoritativ engine er `Game1DrawEngineService`.
   *
   * `BingoEngine.assertNotScheduled(room)` håndhever dette ved å kaste
   * `DomainError("USE_SCHEDULED_API")` hvis BingoEngine-mutasjons-
   * metoder kalles med dette feltet satt på et `bingo`-rom. Spill 2/3
   * (slug `rocket` / `monsterbingo`) påvirkes ikke.
   *
   * Settes via `BingoEngine.markRoomAsScheduled(roomCode, scheduledGameId)`
   * etter at scheduled-flow har persistert mappingen til DB
   * (`assignRoomCode`).
   */
  scheduledGameId?: string | null;
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
  /** MED-11: estimert resume-tidspunkt (ISO 8601). Se GameState-doc. */
  pauseUntil?: string;
  /** MED-11: maskinlesbar grunn til pausen. Se GameState-doc. */
  pauseReason?: string;
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
  /**
   * BIN-672: required, not optional. Canonical slug for ticket format and
   * drawbag selection. Flows from `RoomState.gameSlug` which is set at
   * room creation (defaulted to "bingo" if caller omitted).
   */
  gameSlug: string;
  createdAt: string;
  players: Player[];
  currentGame?: GameSnapshot;
  gameHistory: GameSnapshot[];
}

export interface RoomSummary {
  code: string;
  hallId: string;
  hostPlayerId: string;
  /** BIN-672: required — see RoomSnapshot.gameSlug. */
  gameSlug: string;
  playerCount: number;
  createdAt: string;
  gameStatus: GameStatus | "NONE";
}
