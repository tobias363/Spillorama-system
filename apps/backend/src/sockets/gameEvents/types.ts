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
