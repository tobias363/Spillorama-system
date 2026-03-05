import { randomInt as cryptoRandomInt, randomUUID } from "node:crypto";
import { generateTraditional75Ticket, makeShuffledBallBag } from "./ticket.js";
import type { Ticket } from "./types.js";

export interface RngUsageContext {
  scope: string;
  roomCode?: string;
  gameId?: string;
  roundId?: string;
  hallId?: string;
}

export interface RngRoundDrawBagInput {
  roundId: string;
  maxNumber?: number;
  roomCode?: string;
  gameId?: string;
}

export interface RngRoundDrawBagResult {
  roundId: string;
  requestId: string;
  providerId: string;
  algorithmVersion: string;
  generatedAt: string;
  drawBag: number[];
  cacheHit: boolean;
}

export interface RngProvider {
  readonly providerId: string;
  readonly algorithmVersion: string;
  randomInt(maxExclusive: number, context?: RngUsageContext): number;
  shuffle<T>(values: readonly T[], context?: RngUsageContext): T[];
  generateTicket(context?: RngUsageContext): Ticket;
  getRoundDrawBag(input: RngRoundDrawBagInput): RngRoundDrawBagResult;
  releaseRound(roundId: string): void;
}

interface CachedRoundDrawBag {
  requestId: string;
  generatedAt: string;
  drawBag: number[];
}

export class CryptoRngProvider implements RngProvider {
  public readonly providerId = "crypto-rng-provider";
  public readonly algorithmVersion = "node:crypto.randomInt/v1";
  private readonly roundDrawBagCache = new Map<string, CachedRoundDrawBag>();

  randomInt(maxExclusive: number, _context?: RngUsageContext): number {
    if (!Number.isFinite(maxExclusive) || !Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`Invalid maxExclusive for RNG: ${maxExclusive}`);
    }
    return cryptoRandomInt(maxExclusive);
  }

  shuffle<T>(values: readonly T[], context?: RngUsageContext): T[] {
    const arr = [...values];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = this.randomInt(i + 1, context);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  generateTicket(context?: RngUsageContext): Ticket {
    return generateTraditional75Ticket((maxExclusive) =>
      this.randomInt(maxExclusive, {
        ...context,
        scope: context?.scope ?? "ticket.generateTraditional75"
      })
    );
  }

  getRoundDrawBag(input: RngRoundDrawBagInput): RngRoundDrawBagResult {
    const roundId = input.roundId.trim();
    if (!roundId) {
      throw new Error("roundId mangler for RNG round draw bag.");
    }
    const maxNumber = input.maxNumber ?? 75;
    if (!Number.isFinite(maxNumber) || !Number.isInteger(maxNumber) || maxNumber <= 0) {
      throw new Error(`Ugyldig maxNumber for RNG round draw bag: ${maxNumber}`);
    }

    const cached = this.roundDrawBagCache.get(roundId);
    if (cached) {
      return {
        roundId,
        requestId: cached.requestId,
        providerId: this.providerId,
        algorithmVersion: this.algorithmVersion,
        generatedAt: cached.generatedAt,
        drawBag: [...cached.drawBag],
        cacheHit: true
      };
    }

    const drawBag = makeShuffledBallBag(maxNumber, (maxExclusive) =>
      this.randomInt(maxExclusive, {
        scope: "round.drawBag",
        roomCode: input.roomCode,
        gameId: input.gameId,
        roundId
      })
    );
    const generatedAt = new Date().toISOString();
    const requestId = randomUUID();
    this.roundDrawBagCache.set(roundId, {
      requestId,
      generatedAt,
      drawBag: [...drawBag]
    });

    return {
      roundId,
      requestId,
      providerId: this.providerId,
      algorithmVersion: this.algorithmVersion,
      generatedAt,
      drawBag,
      cacheHit: false
    };
  }

  releaseRound(roundId: string): void {
    const normalizedRoundId = roundId.trim();
    if (!normalizedRoundId) {
      return;
    }
    this.roundDrawBagCache.delete(normalizedRoundId);
  }
}
