import { generateDatabingo60Ticket, generateBingo75Ticket } from "../game/ticket.js";
import type {
  BingoSystemAdapter,
  CheckpointInput,
  ClaimLoggedInput,
  CreateTicketInput,
  GameEndedInput,
  GameStartedInput,
  NumberDrawnInput
} from "./BingoSystemAdapter.js";

/** Game slugs that use 75-ball (5×5) tickets. */
const BINGO75_SLUGS = new Set(["bingo", "game_1"]);

export class LocalBingoSystemAdapter implements BingoSystemAdapter {
  async createTicket(input: CreateTicketInput) {
    if (input.gameSlug && BINGO75_SLUGS.has(input.gameSlug)) {
      return generateBingo75Ticket(input.color, input.type);
    }
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

