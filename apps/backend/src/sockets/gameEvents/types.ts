/**
 * PR-R4: socket-event payload typer + shared types.
 * Flyttet ut av `gameEvents.ts` — ingen funksjonelle endringer.
 */
import type { ClaimType } from "../../game/types.js";

export interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface AuthenticatedSocketPayload {
  accessToken?: string;
}

export interface RoomActionPayload extends AuthenticatedSocketPayload {
  roomCode: string;
  playerId?: string;
}

export interface CreateRoomPayload extends AuthenticatedSocketPayload {
  playerName?: string;
  walletId?: string;
  hallId?: string;
  gameSlug?: string;
}

export interface JoinRoomPayload extends CreateRoomPayload {
  roomCode: string;
}

export interface ResumeRoomPayload extends RoomActionPayload {}

export interface StartGamePayload extends RoomActionPayload {
  entryFee?: number;
  ticketsPerPlayer?: number;
}

export interface ConfigureRoomPayload extends RoomActionPayload {
  entryFee?: number;
}

export interface EndGamePayload extends RoomActionPayload {
  reason?: string;
}

/**
 * GAP #38: Player-initiated stop-game (Spillvett-vote).
 * Client sends this to cast a vote for stopping the running round.
 * Idempotent — same player can re-send without double-counting.
 */
export interface StopGameVotePayload extends RoomActionPayload {}

/**
 * GAP #38: Server response data for `game:stop:vote`.
 */
export interface StopGameVoteAckData {
  recorded: boolean;
  voteCount: number;
  threshold: number;
  playerCount: number;
  thresholdReached: boolean;
}

export interface MarkPayload extends RoomActionPayload {
  number: number;
}

export interface ClaimPayload extends RoomActionPayload {
  type: ClaimType;
}

export interface RoomStatePayload extends AuthenticatedSocketPayload {
  roomCode: string;
}

export interface ExtraDrawPayload extends RoomActionPayload {
  requestedCount?: number;
  packageId?: string;
}

export interface ChatSendPayload extends RoomActionPayload {
  message: string;
  emojiId?: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
}

export interface LuckyNumberPayload extends RoomActionPayload {
  luckyNumber: number;
}

export interface LeaderboardPayload extends AuthenticatedSocketPayload {
  roomCode?: string;
}

export interface LeaderboardEntry {
  nickname: string;
  points: number;
}

/**
 * BIN-587 B4b follow-up: player-side voucher redemption.
 *
 * Spilleren sender en kode + pris hen forsøker å bruke rabatten på.
 * `roomCode` og `scheduledGameId` er begge valgfrie — ad-hoc G2/G3
 * bruker roomCode, scheduled G1 bruker scheduledGameId, en fremtidig
 * pre-lobby-innløsning kan sende ingen av delene (vouchere som
 * "lommebok-credit" kommer i et senere scope).
 */
export interface VoucherRedeemPayload extends AuthenticatedSocketPayload {
  code: string;
  gameSlug: string;
  ticketPriceCents: number;
  scheduledGameId?: string | null;
  roomCode?: string | null;
  /** Når true: bare validér uten å innløse (ingen state-endring). */
  validateOnly?: boolean;
}
