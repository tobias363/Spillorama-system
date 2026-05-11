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

export interface ResumeRoomPayload extends RoomActionPayload {
  scheduledGameId?: string;
}

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
  scheduledGameId?: string;
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

/**
 * Tobias 2026-04-29 (post-orphan-fix UX): partial-buy info returned in
 * `bet:arm` ack når spilleren treffer dagens/månedens tap-grense midt
 * i bestillingen, og — på success-acks — alltid med oppdatert tap-state
 * så Kjøp Bonger-popup-en kan rendre "Brukt i dag: X / Y kr"-headeren
 * uten en separat `/api/wallet/me/compliance`-runde.
 *
 * Pengespillforskriften §22: grensene er hall-scope-d. Tallene reflekterer
 * caller-ens effektive grense (Math.min av personal og regulatorisk) for
 * kjøpe-hallen.
 *
 * Semantikk:
 *   - `requested`  = totalt antall brett-vekt spilleren forsøkte å arme
 *     etter merge med eksisterende armed-set (vektet — ett "Large" = 3 brett).
 *   - `accepted`   = antall brett-vekt som faktisk ble armed (≤ requested).
 *   - `rejected`   = `requested - accepted`, aldri negativt.
 *   - `rejectionReason` er det første grense-treff som stoppet bestillingen,
 *     eller `null` hvis intet ble avvist (full-buy).
 *
 * Klienten viser et toast "X av Y bonger kjøpt — Z avvist (DAILY_LIMIT)"
 * når `rejected > 0` og `accepted > 0`. Hvis `accepted === 0` returneres
 * en feil-ack (`LOSS_LIMIT_REACHED` / `MONTHLY_LIMIT_REACHED`) i stedet —
 * bet:arm armer da ingenting og klienten holder popup-en åpen med
 * feilmeldingen.
 */
export interface BetArmLossLimitInfo {
  /** Antall brett-vekt i bestillingen (etter merge med eksisterende armed). */
  requested: number;
  /** Antall brett-vekt faktisk armed (≤ requested). */
  accepted: number;
  /** Antall brett-vekt avvist pga loss-limit (= requested - accepted). */
  rejected: number;
  /** Hvilken grense som først ble truffet — `null` hvis intet ble avvist. */
  rejectionReason: "DAILY_LIMIT" | "MONTHLY_LIMIT" | null;
  /** Brukt i dag på hallen (pre-buy). NOK. */
  dailyUsed: number;
  /** Effektiv grense daglig (Math.min personal/regulatory). NOK. */
  dailyLimit: number;
  /** Brukt i måned på hallen (pre-buy). NOK. */
  monthlyUsed: number;
  /** Effektiv grense månedlig. NOK. */
  monthlyLimit: number;
  /**
   * Tilgjengelig saldo på lommebok ETTER at reservasjonen for `accepted`
   * brett er gjort, NOK. `null` hvis adapter ikke eksponerer
   * `getAvailableBalance` (test-harnesses uten reservation-API).
   */
  walletBalance: number | null;
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
