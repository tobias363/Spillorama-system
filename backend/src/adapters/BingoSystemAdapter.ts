import type { Player, Ticket, ClaimType, ClaimRecord } from "../game/types.js";

export interface CreateTicketInput {
  roomCode: string;
  gameId: string;
  player: Player;
  ticketIndex: number;
  ticketsPerPlayer: number;
}

export interface GameStartedInput {
  roomCode: string;
  gameId: string;
  entryFee: number;
  playerIds: string[];
}

export interface NumberDrawnInput {
  roomCode: string;
  gameId: string;
  number: number;
  drawIndex: number;
}

export interface ClaimLoggedInput {
  roomCode: string;
  gameId: string;
  playerId: string;
  type: ClaimType;
  valid: boolean;
  reason?: string;
}

export interface GameEndedInput {
  roomCode: string;
  hallId: string;
  gameId: string;
  entryFee: number;
  endedReason: string;
  drawnNumbers: number[];
  claims: ClaimRecord[];
  playerIds: string[];
}

/** BIN-48: Checkpoint input — critical state that must be persisted synchronously. */
export interface CheckpointInput {
  roomCode: string;
  gameId: string;
  reason: "PAYOUT" | "GAME_END" | "BUY_IN";
  claimId?: string;
  payoutAmount?: number;
  transactionIds?: string[];
}

export interface BingoSystemAdapter {
  createTicket(input: CreateTicketInput): Promise<Ticket>;
  onGameStarted?(input: GameStartedInput): Promise<void>;
  onNumberDrawn?(input: NumberDrawnInput): Promise<void>;
  onClaimLogged?(input: ClaimLoggedInput): Promise<void>;
  onGameEnded?(input: GameEndedInput): Promise<void>;
  /** BIN-48: Synchronous checkpoint after critical events (payout, game end). */
  onCheckpoint?(input: CheckpointInput): Promise<void>;
}
