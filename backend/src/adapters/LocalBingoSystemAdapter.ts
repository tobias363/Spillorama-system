import { generateDatabingo60Ticket } from "../game/ticket.js";
import type {
  BingoSystemAdapter,
  CheckpointInput,
  ClaimLoggedInput,
  CreateTicketInput,
  GameEndedInput,
  GameStartedInput,
  NumberDrawnInput
} from "./BingoSystemAdapter.js";

export class LocalBingoSystemAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput) {
    return generateDatabingo60Ticket();
  }

  async onGameStarted(_input: GameStartedInput): Promise<void> {
    // No-op for local development.
  }

  async onNumberDrawn(_input: NumberDrawnInput): Promise<void> {
    // No-op for local development.
  }

  async onClaimLogged(_input: ClaimLoggedInput): Promise<void> {
    // No-op for local development.
  }

  async onGameEnded(_input: GameEndedInput): Promise<void> {
    // No-op for local development.
  }

  async onCheckpoint(_input: CheckpointInput): Promise<void> {
    // No-op for local development.
  }
}

