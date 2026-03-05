import { CryptoRngProvider, type RngProvider } from "../game/RngProvider.js";
import type {
  BingoSystemAdapter,
  ClaimLoggedInput,
  CreateTicketInput,
  GameStartedInput,
  NumberDrawnInput
} from "./BingoSystemAdapter.js";

export class LocalBingoSystemAdapter implements BingoSystemAdapter {
  constructor(private readonly rngProvider: RngProvider = new CryptoRngProvider()) {}

  async createTicket(_input: CreateTicketInput) {
    return this.rngProvider.generateTicket({
      scope: "local-adapter.create-ticket"
    });
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
}
