import { generateTraditional75Ticket } from "../game/ticket.js";
import type {
  BingoSystemAdapter,
  ClaimLoggedInput,
  CreateTicketInput,
  GameEndedInput,
  GameStartedInput,
  NumberDrawnInput
} from "./BingoSystemAdapter.js";

export class LocalBingoSystemAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput) {
    return generateTraditional75Ticket();
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
}

