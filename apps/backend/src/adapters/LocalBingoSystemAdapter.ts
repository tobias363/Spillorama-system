import { generateTicketForGame } from "../game/ticket.js";
import type { Ticket } from "../game/types.js";
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
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    // Spill 2 v2 (2026-12-06): preset-grid takes priority — the caller
    // (typically the bet:arm/startGame flow with Game2TicketPoolService grids)
    // has already chosen the ticket numbers, so we wrap them as-is and
    // attach color/type. No shape validation here — caller's responsibility.
    if (input.presetGrid) {
      const ticket: Ticket = {
        grid: input.presetGrid.map((row) => [...row]),
      };
      if (input.color) ticket.color = input.color;
      if (input.type) ticket.type = input.type;
      return ticket;
    }
    return generateTicketForGame(input.gameSlug, input.color, input.type);
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

