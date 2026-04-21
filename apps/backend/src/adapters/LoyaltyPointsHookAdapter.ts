/**
 * GAME1_SCHEDULE PR 5: LoyaltyPointsHookAdapter.
 *
 * Adapter som oversetter BingoEngine-hook-events
 * (LoyaltyPointsHookPort.onLoyaltyEvent) til
 * LoyaltyService.awardPointsForActivity-kall. Holder
 * points-beregningen (kr → points) i adapter-laget så
 * business-regelen er ett sted og BingoEngine ikke trenger å vite om
 * loyalty-modellen.
 *
 * Pointsberegning (startverdier, kan endres uten å røre porten):
 *   - ticket.purchase: 1 point per kr brukt (floor).
 *   - game.win: 2 point per kr vunnet (floor).
 *
 * Disse reglene lever kun her — BingoEngine vet ikke om dem. Endringer
 * krever oppdatering av denne filen + tester.
 *
 * Fire-and-forget: Feil fra LoyaltyService catches og logges. Engine-
 * flyten skal ALDRI blokkeres av loyalty-feil.
 */

import type {
  LoyaltyHookInput,
  LoyaltyPointsHookPort,
} from "./LoyaltyPointsHookPort.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "loyalty-hook-adapter" });

/**
 * Smalt subset av LoyaltyService — nok til at adapteren kan fungere uten
 * å importere hele servicen (som vil skape sirkulær avhengighet via
 * DomainError-eksport). `awardPointsForActivity` er den eneste metoden
 * adapteren bruker.
 */
export interface LoyaltyActivityAwarder {
  awardPointsForActivity(input: {
    userId: string;
    eventType: string;
    pointsDelta: number;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface LoyaltyPointsHookAdapterOptions {
  service: LoyaltyActivityAwarder;
  /** Valgfri override av pointsberegning. Hvis ikke satt, brukes defaults. */
  pointsForPurchase?: (amountKr: number, ticketCount: number) => number;
  pointsForWin?: (amountKr: number) => number;
}

const DEFAULT_POINTS_FOR_PURCHASE = (amountKr: number, _ticketCount: number): number => {
  // 1 point per kr, floor for heltall.
  return Math.max(0, Math.floor(amountKr));
};

const DEFAULT_POINTS_FOR_WIN = (amountKr: number): number => {
  // 2 point per kr, floor.
  return Math.max(0, Math.floor(amountKr * 2));
};

export class LoyaltyPointsHookAdapter implements LoyaltyPointsHookPort {
  private readonly service: LoyaltyActivityAwarder;
  private readonly pointsForPurchase: (amountKr: number, ticketCount: number) => number;
  private readonly pointsForWin: (amountKr: number) => number;

  constructor(options: LoyaltyPointsHookAdapterOptions) {
    this.service = options.service;
    this.pointsForPurchase = options.pointsForPurchase ?? DEFAULT_POINTS_FOR_PURCHASE;
    this.pointsForWin = options.pointsForWin ?? DEFAULT_POINTS_FOR_WIN;
  }

  async onLoyaltyEvent(input: LoyaltyHookInput): Promise<void> {
    try {
      if (input.kind === "ticket.purchase") {
        const points = this.pointsForPurchase(input.amount, input.ticketCount);
        await this.service.awardPointsForActivity({
          userId: input.userId,
          eventType: "ticket.purchase",
          pointsDelta: points,
          metadata: {
            amountKr: input.amount,
            ticketCount: input.ticketCount,
            roomCode: input.roomCode,
            gameId: input.gameId,
            hallId: input.hallId,
            gameSlug: input.gameSlug,
          },
        });
      } else if (input.kind === "game.win") {
        const points = this.pointsForWin(input.amount);
        await this.service.awardPointsForActivity({
          userId: input.userId,
          eventType: "game.win",
          pointsDelta: points,
          metadata: {
            amountKr: input.amount,
            patternName: input.patternName,
            roomCode: input.roomCode,
            gameId: input.gameId,
            hallId: input.hallId,
          },
        });
      }
    } catch (err) {
      log.warn(
        { err, eventKind: input.kind, userId: input.userId },
        "[loyalty-hook-adapter] awardPointsForActivity failed — event tapt"
      );
    }
  }
}
