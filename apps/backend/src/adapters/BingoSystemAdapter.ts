import type { Player, Ticket, ClaimType, ClaimRecord, GameSnapshot, RecoverableGameSnapshot } from "../game/types.js";

export interface CreateTicketInput {
  roomCode: string;
  gameId: string;
  gameSlug?: string;
  player: Player;
  ticketIndex: number;
  ticketsPerPlayer: number;
  /** Display color name for the client, e.g. "Small Yellow", "Elvis 1". */
  color?: string;
  /** Ticket type code for variant logic: "small", "large", "elvis", "traffic-red", etc. */
  type?: string;
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
  reason: "PAYOUT" | "GAME_END" | "BUY_IN" | "DRAW";
  claimId?: string;
  payoutAmount?: number;
  transactionIds?: string[];
  /** BIN-159: Full serialized game snapshot at checkpoint time. */
  snapshot?: GameSnapshot | RecoverableGameSnapshot;
  /** BIN-159: Players in the room at checkpoint time. */
  players?: Player[];
  /** BIN-159: Hall ID for the room. */
  hallId?: string;
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
