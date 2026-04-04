import type {
  BingoSystemAdapter,
  ClaimLoggedInput,
  CreateTicketInput,
  GameEndedInput,
  GameStartedInput,
  NumberDrawnInput
} from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../game/types.js";
import type { WebhookService } from "./WebhookService.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface IntegrationBingoSystemAdapterOptions {
  /** The underlying adapter (e.g. LocalBingoSystemAdapter). */
  inner: BingoSystemAdapter;
  /** Webhook service for sending game result and compliance events. */
  webhookService: WebhookService;
  /** Currency code for webhook payloads. Default "NOK". */
  currency?: string;
  /**
   * Resolve the provider's external player ID from an internal player ID.
   * Needed for webhook payloads. Returns null if player is not an integration player.
   */
  resolveExternalPlayerId: (internalPlayerId: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Decorates a BingoSystemAdapter with webhook delivery for integration mode.
 * Delegates all core operations to the inner adapter and adds webhook calls
 * on game-end events.
 */
export class IntegrationBingoSystemAdapter implements BingoSystemAdapter {
  private readonly inner: BingoSystemAdapter;
  private readonly webhookService: WebhookService;
  private readonly currency: string;
  private readonly resolveExternalPlayerId: (id: string) => Promise<string | null>;

  constructor(options: IntegrationBingoSystemAdapterOptions) {
    this.inner = options.inner;
    this.webhookService = options.webhookService;
    this.currency = options.currency ?? "NOK";
    this.resolveExternalPlayerId = options.resolveExternalPlayerId;
  }

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    return this.inner.createTicket(input);
  }

  async onGameStarted(input: GameStartedInput): Promise<void> {
    if (this.inner.onGameStarted) {
      await this.inner.onGameStarted(input);
    }
  }

  async onNumberDrawn(input: NumberDrawnInput): Promise<void> {
    if (this.inner.onNumberDrawn) {
      await this.inner.onNumberDrawn(input);
    }
  }

  async onClaimLogged(input: ClaimLoggedInput): Promise<void> {
    if (this.inner.onClaimLogged) {
      await this.inner.onClaimLogged(input);
    }
  }

  async onGameEnded(input: GameEndedInput): Promise<void> {
    // Delegate to inner first.
    if (this.inner.onGameEnded) {
      await this.inner.onGameEnded(input);
    }

    // Send webhook for each player in the game.
    for (const playerId of input.playerIds) {
      const externalId = await this.resolveExternalPlayerId(playerId);
      if (!externalId) continue; // Not an integration player — skip.

      // Calculate payout for this player from claims.
      const playerClaims = input.claims.filter((c) => c.playerId === playerId && c.valid);
      const totalPayout = playerClaims.reduce((sum, c) => sum + (c.payoutAmount ?? 0), 0);
      const patterns = playerClaims.map((c) => c.type);

      const payload = this.webhookService.buildGameResultPayload({
        gameId: input.gameId,
        sessionId: input.roomCode, // Use room code as session reference.
        playerId: externalId,
        entryFee: input.entryFee,
        totalPayout,
        currency: this.currency,
        ticketsPlayed: 1, // Each player ID has one ticket set.
        numbersDrawn: input.drawnNumbers.length,
        patterns
      });

      // Non-blocking delivery — don't hold up game flow.
      this.webhookService.sendGameResult(payload).catch((err) => {
        console.error(`[IntegrationAdapter] Webhook delivery failed for player ${externalId}:`, err);
      });
    }
  }
}
