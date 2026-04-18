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
import type {
  RoomUpdatePayload as RoomUpdatePayloadT,
  DrawNewPayload as DrawNewPayloadT,
  ClaimSubmitPayload as ClaimSubmitPayloadT,
  TicketReplacePayload as TicketReplacePayloadT,
  TicketSwapPayload as TicketSwapPayloadT,
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
  DRAW_NEXT: "draw:next",
  DRAW_EXTRA_PURCHASE: "draw:extra:purchase",
  TICKET_MARK: "ticket:mark",
  /** BIN-509: swap a pre-round ticket for a new one (debits replaceAmount). */
  TICKET_REPLACE: "ticket:replace",
  /** BIN-585: free pre-round ticket swap (Game 5 / Spillorama). Legacy alias: SwapTicket. */
  TICKET_SWAP: "ticket:swap",
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
  // Server → Client (broadcast)
  ROOM_UPDATE: "room:update",
  DRAW_NEW: "draw:new",
  PATTERN_WON: "pattern:won",
  CHAT_MESSAGE: "chat:message",
  JACKPOT_ACTIVATED: "jackpot:activated",
  MINIGAME_ACTIVATED: "minigame:activated",
  // Server → Client (private, to marking socket only — BIN-499)
  TICKET_MARKED: "ticket:marked",
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
