// ── Socket.IO event contract ────────────────────────────────────────────────
// Codifies the event names and payload types exchanged between client and server.

import type { RoomSnapshot, Ticket, Player } from "./game.js";

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

export interface BetArmPayload extends RoomActionPayload {
  armed?: boolean;
}

export interface GameStartPayload extends RoomActionPayload {
  entryFee?: number;
  ticketsPerPlayer?: number;
}

export interface TicketMarkPayload extends RoomActionPayload {
  number: number;
}

export interface ClaimSubmitPayload extends RoomActionPayload {
  type: "LINE" | "BINGO";
}

export interface LuckyNumberPayload extends RoomActionPayload {
  luckyNumber: number;
}

export interface ChatSendPayload extends RoomActionPayload {
  message: string;
  emojiId?: number;
}

// ── Server → Client payloads ────────────────────────────────────────────────

/** Ticket type config sent from backend to client for purchase UI. */
export interface TicketTypeInfo {
  name: string;
  type: string;
  priceMultiplier: number;
  ticketCount: number;
  colors?: string[];
}

export type RoomUpdatePayload = RoomSnapshot & {
  scheduler: Record<string, unknown>;
  preRoundTickets: Record<string, Ticket[]>;
  /** Player IDs who have explicitly armed (bet:arm) for the next round. */
  armedPlayerIds: string[];
  luckyNumbers: Record<string, number>;
  serverTimestamp: number;
  /**
   * Server-authoritative stake per player (in kroner).
   * Only populated for players with an active stake; absence = no stake.
   */
  playerStakes: Record<string, number>;
  /** BIN-443: Active game variant info for client purchase UI. */
  gameVariant?: {
    gameType: string;
    ticketTypes: TicketTypeInfo[];
    replaceAmount?: number;
  };
};

export interface DrawNewPayload {
  number: number;
  drawIndex: number;
  gameId: string;
}

export interface PatternWonPayload {
  patternId: string;
  patternName: string;
  winnerId: string;
  wonAtDraw: number;
  payoutAmount: number;
  claimType: "LINE" | "BINGO";
  gameId: string;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
}

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

export type MiniGameType = "wheelOfFortune" | "treasureChest" | "mysteryGame" | "colorDraft";

export interface MiniGameActivatedPayload {
  gameId: string;
  playerId: string;
  type: MiniGameType;
  prizeList: number[];
}

export interface MiniGamePlayPayload extends RoomActionPayload {
  /** For treasureChest: which chest the player picked (0-based index). */
  selectedIndex?: number;
}

export interface MiniGamePlayResult {
  type: MiniGameType;
  /** Index of the winning segment/chest. */
  segmentIndex: number;
  /** Prize amount won. */
  prizeAmount: number;
  /** Full prize list revealed (all segments/chests). */
  prizeList: number[];
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
