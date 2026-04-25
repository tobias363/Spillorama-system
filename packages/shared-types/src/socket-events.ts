// ── Socket.IO event contract ────────────────────────────────────────────────
// Codifies the event names and payload types exchanged between client and server.
//
// BIN-545: Three of the highest-risk payloads — RoomUpdate, DrawNew, ClaimSubmit
// — are now defined as Zod schemas in ./schemas.ts. The types below for those
// three are re-exported from there via z.infer<>. All other interfaces remain
// compile-time only; broader Zod rollout is tracked as a separate issue.

import type { RoomSnapshot, Ticket, Player } from "./game.js";
export {
  RoomUpdatePayloadSchema,
  DrawNewPayloadSchema,
  ClaimSubmitPayloadSchema,
  TicketReplacePayloadSchema,
  TicketSwapPayloadSchema,
  TicketCancelPayloadSchema,
  AdminHallBalancePayloadSchema,
  AdminHallBalanceResponseSchema,
  AdminDisplayScreensaverResponseSchema,
  MiniGameTypeSchema,
  MiniGamePlayResultSchema,
  MiniGameActivatedPayloadSchema,
  // BIN-527: wire-contract extension
  BetArmPayloadSchema,
  TicketMarkPayloadSchema,
  PatternWonPayloadSchema,
  ChatMessageSchema,
  TicketSelectionSchema,
  TicketTypeInfoSchema,
  RoomSnapshotSchema,
  GameSnapshotSchema,
  PlayerSchema,
  TicketSchema,
  ClaimRecordSchema,
  PatternDefinitionSchema,
  PatternResultSchema,
} from "./schemas.js";

// GAME1_SCHEDULE PR 4d.2: re-export player-join schemas for scheduled games.
export {
  Game1JoinScheduledPayloadSchema,
  Game1JoinScheduledAckDataSchema,
} from "./schemas.js";
export type {
  Game1JoinScheduledPayload,
  Game1JoinScheduledAckData,
} from "./schemas.js";

// GAME1_SCHEDULE PR 4d.3: admin-namespace real-time events.
export {
  Game1AdminSubscribePayloadSchema,
  Game1AdminStatusUpdatePayloadSchema,
  Game1AdminDrawProgressedPayloadSchema,
} from "./schemas.js";
export type {
  Game1AdminSubscribePayload,
  Game1AdminStatusUpdatePayload,
  Game1AdminDrawProgressedPayload,
} from "./schemas.js";

// GAME1_SCHEDULE PR 4d.4: admin phase-won broadcast (fra drawNext).
export { Game1AdminPhaseWonPayloadSchema } from "./schemas.js";
export type { Game1AdminPhaseWonPayload } from "./schemas.js";

// PT4: admin physical-ticket-won broadcast (fra drawNext + PhysicalTicketPayoutService).
export { Game1AdminPhysicalTicketWonPayloadSchema } from "./schemas.js";
export type { Game1AdminPhysicalTicketWonPayload } from "./schemas.js";

// Task 1.1: auto-pause ved phase-won + manuell resume (Gap #1 i MASTER_HALL_DASHBOARD_GAP_2026-04-24.md).
export {
  Game1AdminAutoPausedPayloadSchema,
  Game1AdminResumedPayloadSchema,
} from "./schemas.js";
export type {
  Game1AdminAutoPausedPayload,
  Game1AdminResumedPayload,
} from "./schemas.js";

// Task 1.6: master-hall transfer-events (agent-initiert, 60s TTL).
export {
  Game1TransferRequestStatusSchema,
  Game1TransferRequestPayloadSchema,
  Game1MasterChangedPayloadSchema,
} from "./schemas.js";
export type {
  Game1TransferRequestStatus,
  Game1TransferRequestPayload,
  Game1MasterChangedPayload,
} from "./schemas.js";
import type {
  RoomUpdatePayload as RoomUpdatePayloadT,
  DrawNewPayload as DrawNewPayloadT,
  ClaimSubmitPayload as ClaimSubmitPayloadT,
  TicketReplacePayload as TicketReplacePayloadT,
  TicketSwapPayload as TicketSwapPayloadT,
  TicketCancelPayload as TicketCancelPayloadT,
  AdminHallBalancePayload as AdminHallBalancePayloadT,
  AdminHallBalanceResponse as AdminHallBalanceResponseT,
  AdminDisplayScreensaverResponse as AdminDisplayScreensaverResponseT,
  MiniGamePlayResult as MiniGamePlayResultT,
  MiniGameActivatedPayload as MiniGameActivatedPayloadT,
  BetArmPayload as BetArmPayloadT,
  TicketMarkPayload as TicketMarkPayloadT,
  PatternWonPayload as PatternWonPayloadT,
  ChatMessage as ChatMessageT,
  TicketSelection as TicketSelectionT,
  TicketTypeInfo as TicketTypeInfoT,
} from "./schemas.js";

// ── Event names ─────────────────────────────────────────────────────────────

export const SocketEvents = {
  // Client → Server (with ack)
  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_RESUME: "room:resume",
  ROOM_CONFIGURE: "room:configure",
  ROOM_STATE: "room:state",
  BET_ARM: "bet:arm",
  GAME_START: "game:start",
  GAME_END: "game:end",
  /**
   * GAP #38: Player-initiated stop-game (Spillvett-vote). Pengespillforskriften
   * gives players the right to vote to stop a running round. When the
   * threshold is reached the game ends + reservations are released.
   * Idempotent — same player can re-cast without double-counting.
   */
  GAME_STOP_VOTE: "game:stop:vote",
  DRAW_NEXT: "draw:next",
  DRAW_EXTRA_PURCHASE: "draw:extra:purchase",
  TICKET_MARK: "ticket:mark",
  /** BIN-509: swap a pre-round ticket for a new one (debits replaceAmount). */
  TICKET_REPLACE: "ticket:replace",
  /** BIN-585: free pre-round ticket swap (Game 5 / Spillorama). Legacy alias: SwapTicket. */
  TICKET_SWAP: "ticket:swap",
  /** BIN-692: cancel a single pre-round ticket (or its whole bundle). Free — pre-round arm is not yet debited. */
  TICKET_CANCEL: "ticket:cancel",
  /** BIN-585 PR D: hall operator live balance view. Legacy alias: getHallBalance. */
  ADMIN_HALL_BALANCE: "admin:hall-balance",
  /** BIN-585 PR D: hall-display screensaver config. Legacy alias: ScreenSaver. */
  ADMIN_DISPLAY_SCREENSAVER: "admin-display:screensaver",
  CLAIM_SUBMIT: "claim:submit",
  LUCKY_SET: "lucky:set",
  CHAT_SEND: "chat:send",
  CHAT_HISTORY: "chat:history",
  LEADERBOARD_GET: "leaderboard:get",
  JACKPOT_SPIN: "jackpot:spin",
  MINIGAME_PLAY: "minigame:play",
  /**
   * BIN-690 PR-M6: Player sends their choice for the active mini-game (scheduled-
   * games framework). Payload: `{ resultId, choiceJson }`. Distinct from the
   * legacy host-room `minigame:play` event — that path is unused by M6.
   */
  MINI_GAME_CHOICE: "mini_game:choice",
  // Server → Client (broadcast)
  ROOM_UPDATE: "room:update",
  DRAW_NEW: "draw:new",
  PATTERN_WON: "pattern:won",
  CHAT_MESSAGE: "chat:message",
  JACKPOT_ACTIVATED: "jackpot:activated",
  MINIGAME_ACTIVATED: "minigame:activated",
  /**
   * BIN-690 PR-M6: Server triggers a mini-game for the Fullt Hus-winner.
   * Payload: `{ resultId, miniGameType, payload, timeoutSeconds? }`. Emitted by
   * `Game1MiniGameOrchestrator.maybeTriggerFor()` via `MiniGameBroadcaster.onTrigger`.
   */
  MINI_GAME_TRIGGER: "mini_game:trigger",
  /**
   * BIN-690 PR-M6: Server resolves the mini-game result and broadcasts payout.
   * Payload: `{ resultId, miniGameType, payoutCents, resultJson }`. Emitted by
   * orchestrator post-commit via `MiniGameBroadcaster.onResult`.
   */
  MINI_GAME_RESULT: "mini_game:result",
  // Server → Client (private, to marking socket only — BIN-499)
  TICKET_MARKED: "ticket:marked",

  // BIN-615 / PR-C1: reserved event names for Game 2 / Game 3.
  // Names are part of the wire contract now so Agent A/B/5 can plan UI
  // scaffolding. Handlers are implemented in PR-C2 (Game 2) and PR-C3 (Game 3).
  /** BIN-615 / PR-C2: Game 2 — broadcast when a player completes 3x3 ticket. */
  G2_ROCKET_LAUNCH: "g2:rocket:launch",
  /** BIN-615 / PR-C2: Game 2 — jackpot-number-table state per draw. */
  G2_JACKPOT_LIST_UPDATE: "g2:jackpot:list-update",
  /** BIN-615 / PR-C2: Game 2 — ticket fully marked (all 9 cells). */
  G2_TICKET_COMPLETED: "g2:ticket:completed",
  /** BIN-615 / PR-C3: Game 3 — active pattern list changed mid-round (cycling). */
  G3_PATTERN_CHANGED: "g3:pattern:changed",
  /** BIN-615 / PR-C3: Game 3 — server auto-claimed a pattern for a player. */
  G3_PATTERN_AUTO_WON: "g3:pattern:auto-won",
} as const;

// ── Generic ack response ────────────────────────────────────────────────────

export interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ── Client → Server payloads ────────────────────────────────────────────────

export interface AuthenticatedSocketPayload {
  accessToken?: string;
}

export interface RoomActionPayload extends AuthenticatedSocketPayload {
  roomCode: string;
  playerId?: string;
}

export interface RoomCreatePayload extends AuthenticatedSocketPayload {
  playerName?: string;
  walletId?: string;
  hallId?: string;
  gameSlug?: string;
}

export interface RoomJoinPayload extends AuthenticatedSocketPayload {
  roomCode: string;
  playerName?: string;
  walletId?: string;
  hallId?: string;
}

/**
 * Per-type ticket selection sent from client to server during bet:arm.
 * Runtime-validated — derived from `TicketSelectionSchema`.
 */
export type TicketSelection = TicketSelectionT;

/**
 * BIN-527: runtime-validated via `BetArmPayloadSchema`.
 *
 * `ticketSelections` is the preferred path; `ticketCount` is a deprecated
 * flat fallback kept for older clients mid-rollout.
 */
export type BetArmPayload = BetArmPayloadT;

export interface GameStartPayload extends RoomActionPayload {
  entryFee?: number;
  ticketsPerPlayer?: number;
}

/** BIN-527: runtime-validated via `TicketMarkPayloadSchema`. */
export type TicketMarkPayload = TicketMarkPayloadT;

/**
 * Runtime-validated via `ClaimSubmitPayloadSchema`. The backend calls
 * `.safeParse()` before acting on the payload — see BIN-545.
 */
export type ClaimSubmitPayload = ClaimSubmitPayloadT;

/**
 * BIN-509: payload for `ticket:replace`. Runtime-validated via
 * `TicketReplacePayloadSchema`. Only accepted when the target room's
 * currentGame is not RUNNING; debits `gameVariant.replaceAmount`.
 */
export type TicketReplacePayload = TicketReplacePayloadT;

/**
 * BIN-585: payload for `ticket:swap`. Runtime-validated via
 * `TicketSwapPayloadSchema`. Free pre-round swap; gated to Game 5
 * (Spillorama) by gameSlug so paid games continue to use ticket:replace.
 */
export type TicketSwapPayload = TicketSwapPayloadT;

/**
 * BIN-692: payload for `ticket:cancel`. Runtime-validated via
 * `TicketCancelPayloadSchema`. Only accepted while the game is NOT
 * RUNNING. Pre-round arming is not debited (buy-in happens at
 * `game:start`), so cancellation is free — the handler just drops the
 * bundle from the player's armed selections and the display-cache, then
 * emits room:update. UI shows Innsats=0 straight after.
 */
export type TicketCancelPayload = TicketCancelPayloadT;

/**
 * BIN-585 PR D: payload and response for `admin:hall-balance`. Replaces
 * legacy `getHallBalance`. Returns the current balance of each house
 * account for the hall (typically DATABINGO × {HALL, INTERNET}).
 */
export type AdminHallBalancePayload = AdminHallBalancePayloadT;
export type AdminHallBalanceResponse = AdminHallBalanceResponseT;

/**
 * BIN-585 PR D: response for `admin-display:screensaver`. Replaces
 * legacy `ScreenSaver`. Returns static screensaver config (from env).
 */
export type AdminDisplayScreensaverResponse = AdminDisplayScreensaverResponseT;

export interface LuckyNumberPayload extends RoomActionPayload {
  luckyNumber: number;
}

export interface ChatSendPayload extends RoomActionPayload {
  message: string;
  emojiId?: number;
}

// ── Server → Client payloads ────────────────────────────────────────────────

/**
 * Ticket type config sent from backend to client for purchase UI.
 * Runtime-validated — derived from `TicketTypeInfoSchema`.
 */
export type TicketTypeInfo = TicketTypeInfoT;

/**
 * Runtime-validated via `RoomUpdatePayloadSchema` (see ./schemas.ts).
 * The schema inlines the RoomSnapshot shape via `.extend()` so new RoomSnapshot
 * fields must also be added to the schema or validation will reject them.
 */
export type RoomUpdatePayload = RoomUpdatePayloadT;

/**
 * Server → client draw broadcast. Runtime-validated via `DrawNewPayloadSchema`.
 */
export type DrawNewPayload = DrawNewPayloadT;

/**
 * BIN-499: Private ack event sent to the marking socket only after ticket:mark.
 * Replaces the old full room-snapshot broadcast. No room-fanout here — claims
 * (LINE/BINGO via claim:submit) still trigger room:update as before.
 */
export interface TicketMarkedPayload {
  roomCode: string;
  playerId: string;
  number: number;
}

/** BIN-527: runtime-validated via `PatternWonPayloadSchema`. */
export type PatternWonPayload = PatternWonPayloadT;

/** BIN-527: runtime-validated via `ChatMessageSchema`. */
export type ChatMessage = ChatMessageT;

export interface LeaderboardEntry {
  nickname: string;
  points: number;
}

// ── Jackpot (Game 5 Free Spin) ─────────────────────────────────────────────

export interface JackpotActivatedPayload {
  gameId: string;
  playerId: string;
  prizeList: number[];
  totalSpins: number;
  playedSpins: number;
  spinHistory: JackpotSpinEntry[];
}

export interface JackpotSpinPayload extends RoomActionPayload {}

export interface JackpotSpinResult {
  segmentIndex: number;
  prizeAmount: number;
  playedSpins: number;
  totalSpins: number;
  isComplete: boolean;
  spinHistory: JackpotSpinEntry[];
}

export interface JackpotSpinEntry {
  spinNumber: number;
  segmentIndex: number;
  prizeAmount: number;
}

// ── Mini-games (Game 1 — Wheel of Fortune / Treasure Chest) ──────────────────

/**
 * BIN-505/506: 4-way mini-game rotation — wheel of fortune → treasure chest →
 * mystery game → color draft. Runtime-validated via `MiniGameTypeSchema`.
 */
export type MiniGameType = "wheelOfFortune" | "treasureChest" | "mysteryGame" | "colorDraft";

/** Runtime-validated — see `MiniGameActivatedPayloadSchema`. */
export type MiniGameActivatedPayload = MiniGameActivatedPayloadT;

export interface MiniGamePlayPayload extends RoomActionPayload {
  /** For treasureChest / mysteryGame / colorDraft: which slot the player picked (0-based index). */
  selectedIndex?: number;
}

/**
 * BIN-505/506: unified ack shape for all four mini-game types.
 * Runtime-validated via `MiniGamePlayResultSchema`.
 */
export type MiniGamePlayResult = MiniGamePlayResultT;

// ── BIN-690 PR-M6: scheduled-games mini-game wire contract ─────────────────
//
// These events replace the legacy `minigame:activated`/`minigame:play` pair for
// the scheduled-games framework (Spill 1 Fullt Hus path). The framework
// discriminator is the M1 `MiniGameType` union — "wheel"/"chest"/"colordraft"/
// "oddsen" — which is INTENTIONALLY different from the legacy
// `"wheelOfFortune"|"treasureChest"|"mysteryGame"|"colorDraft"` names above.
//
// Event flow:
//   1. Server → Client: `mini_game:trigger` {resultId, miniGameType, payload, timeoutSeconds?}
//   2. Client → Server: `mini_game:choice`  {resultId, choiceJson}
//   3. Server → Client: `mini_game:result`  {resultId, miniGameType, payoutCents, resultJson}
//
// `payload` and `choiceJson`/`resultJson` are free-form per type; each overlay
// validates its own shape. See `packages/game-client/src/games/game1/README.md`
// for the per-type schemas.

/**
 * M6 framework mini-game type discriminator. Mirrors
 * `apps/backend/src/game/minigames/types.ts:MiniGameType`. Intentionally
 * separate from the legacy `MiniGameType` above.
 */
export type M6MiniGameType =
  | "wheel"
  | "chest"
  | "colordraft"
  | "oddsen"
  | "mystery";

/** Server → Client: trigger payload for a newly activated mini-game. */
export interface MiniGameTriggerPayload {
  /** Unique UUID for this mini-game round — echoed back in choice + result. */
  readonly resultId: string;
  /** Framework-type; drives overlay selection on the client. */
  readonly miniGameType: M6MiniGameType;
  /** Type-specific UI payload. Per-type shapes:
   *    - wheel:      { totalBuckets, prizes, spinCount }
   *    - chest:      { chestCount, prizeRange, hasDiscreteTiers }
   *    - colordraft: { numberOfSlots, targetColor, slotColors, winPrizeNok, consolationPrizeNok }
   *    - oddsen:     { validNumbers, potSmallNok, potLargeNok, resolveAtDraw }
   *    - mystery:    { middleNumber, resultNumber, prizeListNok, maxRounds,
   *                    autoTurnFirstMoveSec, autoTurnOtherMoveSec }
   */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Optional client-side countdown in seconds. */
  readonly timeoutSeconds?: number;
}

/** Client → Server: player's choice for the active mini-game. */
export interface MiniGameChoicePayload extends AuthenticatedSocketPayload {
  readonly resultId: string;
  /** Type-specific choice payload. Per-type shapes:
   *    - wheel:      {} (no choice — auto-sent on spin click)
   *    - chest:      { chosenIndex: number }
   *    - colordraft: { chosenIndex: number }
   *    - oddsen:     { chosenNumber: number }
   *    - mystery:    { directions: ("up"|"down")[] } (1..5 elements; joker
   *                    terminates early so <5 is valid)
   */
  readonly choiceJson: Readonly<Record<string, unknown>>;
}

/** Server → Client: resolved mini-game result with payout. */
export interface MiniGameResultPayload {
  readonly resultId: string;
  readonly miniGameType: M6MiniGameType;
  /** Total payout in øre (cents). 0 for Oddsen choice-phase (deferred to next game). */
  readonly payoutCents: number;
  /** Type-specific result payload. Per-type shapes:
   *    - wheel:      { winningBucketIndex, prizeGroupIndex, amountKroner, totalBuckets, animationSeed }
   *    - chest:      { chosenIndex, prizeAmountKroner, allValuesKroner, chestCount }
   *    - colordraft: { chosenIndex, chosenColor, targetColor, matched, prizeAmountKroner, allSlotColors, numberOfSlots }
   *    - oddsen:     { chosenNumber, oddsenStateId, chosenForGameId, ticketSizeAtWin, potAmountNokIfHit, validNumbers, payoutDeferred: true }
   *                    (resolved outcome arrives via separate event in the next game)
   *    - mystery:    { middleNumber, resultNumber, rounds: MysteryRoundResult[],
   *                    finalPriceIndex, prizeAmountKroner, jokerTriggered }
   */
  readonly resultJson: Readonly<Record<string, unknown>>;
}

// ── BIN-615 / PR-C1: reserved Game 2 / Game 3 broadcast payloads ────────────
// Types are part of the wire contract now; backend emits in PR-C2 / PR-C3.

/** BIN-615 / PR-C2: Game 2 rocket-launch broadcast (player completed 3x3). */
export interface G2RocketLaunchPayload {
  roomCode: string;
  gameId: string;
  playerId: string;
  ticketId?: string;
  /** Draw index at which the ticket completed (1-based). */
  drawIndex: number;
  /** Total draws so far in the round. */
  totalDraws: number;
}

/** BIN-615 / PR-C2: Game 2 jackpot-number-table update (per-draw prize mapping). */
export interface G2JackpotListUpdatePayload {
  roomCode: string;
  gameId: string;
  /**
   * Computed per-draw prize list — mirrors legacy processJackpotNumbers
   * output (gamehelper/game2.js:1489-1506). Each entry:
   *   - number: "9".."13" or "14-21" (display form for the 1421 bucket)
   *   - prize:  computed kr amount (cash passthrough, or percent-of-pool)
   *   - type:   "gain" for 13 and 1421, "jackpot" otherwise
   */
  jackpotList: Array<{
    number: string;
    prize: number;
    type: "gain" | "jackpot";
  }>;
  /** Current draw index (1-based). */
  currentDraw: number;
}

/** BIN-615 / PR-C2: Game 2 ticket-completed broadcast (all 9 cells marked). */
export interface G2TicketCompletedPayload {
  roomCode: string;
  gameId: string;
  playerId: string;
  ticketId?: string;
  drawIndex: number;
}

/** BIN-615 / PR-C3: Game 3 pattern-list mutation (cycling during round). */
export interface G3PatternChangedPayload {
  roomCode: string;
  gameId: string;
  /** Full current list of active patterns after the mutation. */
  activePatterns: Array<{
    id: string;
    name: string;
    design: number;
    /** 25-cell bitmask for custom patterns. */
    patternDataList?: number[];
    /** Ball threshold at which pattern deactivates if unwon. */
    ballNumberThreshold?: number;
  }>;
  /** Current draw index that triggered the change (1-based). */
  drawIndex: number;
}

/** BIN-615 / PR-C3: Game 3 server auto-claim broadcast. */
export interface G3PatternAutoWonPayload {
  roomCode: string;
  gameId: string;
  patternId: string;
  patternName: string;
  /** Winner player ids — multiple when several tickets completed same pattern on the same draw. */
  winnerPlayerIds: string[];
  /** Prize per winner after splitting (kr). */
  prizePerWinner: number;
  /** Draw index at which the pattern was won (1-based). */
  drawIndex: number;
}

// ── Scheduler settings (sent inside room:update scheduler field) ────────────

export interface BingoSchedulerSettings {
  autoRoundStartEnabled: boolean;
  autoRoundStartIntervalMs: number;
  autoRoundMinPlayers: number;
  autoRoundTicketsPerPlayer: number;
  autoRoundEntryFee: number;
  payoutPercent: number;
  autoDrawEnabled: boolean;
  autoDrawIntervalMs: number;
}
