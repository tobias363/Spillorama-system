/**
 * 2026-05-02 (Tobias UX, PDF 17 wireframe side 5): Choose Tickets-side for
 * Spill 2. Hver spiller får 32 deterministiske 3×3-brett (1-21 ball-range)
 * generert med seedet PRNG basert på (roomCode + playerId + gameId).
 *
 * Persistens: in-memory Map for MVP. Pool er stabilt på tvers av page-
 * refreshes så lenge backend ikke restartes (gameId regenereres ved hver
 * BingoEngine.startGame, så pool fornyes per runde uansett).
 *
 * Wireframe-krav (side 5 note C):
 *   - Hver spiller får 32 forskjellige tilfeldige brett
 *   - Allerede-kjøpte brett markeres som "purchased" ved revisit
 *   - Total max 30 brett per spiller per spill (delt grense med
 *     dropdown-kjøp i Lobby — håndheves i bet:arm-laget)
 *
 * v2-arbeid (deferred): integrasjon med BingoEngine.startGame slik at de
 * visuelt-valgte ticket-tallene faktisk matcher det som spilles. I denne
 * MVP-en vises 32 brett som deterministisk forhåndsvisning, men selve
 * spillet bruker tickets generert ved game-start. Tobias har akseptert
 * trade-off for pilot.
 */

import type { Ticket } from "@spillorama/shared-types/game";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game2-ticket-pool" });

const POOL_SIZE = 32;
const TICKET_CELLS = 9; // 3×3
const BALL_MIN = 1;
const BALL_MAX = 21;

interface Pool {
  /** 32 forhåndsgenererte 3×3-brett. */
  tickets: Ticket[];
  /** Indekser i `tickets` som er markert som kjøpt. */
  purchasedIndices: Set<number>;
  /** Spillerens valgte Lucky Number for runden (1-21). */
  pickAnyNumber: number | null;
  /** Sist oppdatert (for cleanup-heuristics). */
  updatedAt: number;
}

export interface PoolSnapshot {
  roomCode: string;
  playerId: string;
  gameId: string;
  tickets: Ticket[];
  purchasedIndices: number[];
  pickAnyNumber: number | null;
}

export interface BuyChooseTicketsInput {
  roomCode: string;
  playerId: string;
  gameId: string;
  /** 0-indeksert valg blant de 32 brettene. */
  indices: number[];
  /** Optional Lucky Number (1-21). */
  pickAnyNumber?: number | null;
}

export class Game2TicketPoolService {
  private pools = new Map<string, Pool>();

  private poolKey(roomCode: string, playerId: string, gameId: string): string {
    return `${roomCode}|${playerId}|${gameId}`;
  }

  /**
   * Hent (eller generer) pool for spiller. Idempotent — samme
   * (roomCode, playerId, gameId) gir samme 32 brett.
   */
  getOrCreatePool(
    roomCode: string,
    playerId: string,
    gameId: string,
  ): PoolSnapshot {
    const key = this.poolKey(roomCode, playerId, gameId);
    let pool = this.pools.get(key);
    if (!pool) {
      const seed = hashSeed(`${roomCode}:${playerId}:${gameId}`);
      const tickets = generatePool(seed, POOL_SIZE);
      pool = {
        tickets,
        purchasedIndices: new Set<number>(),
        pickAnyNumber: null,
        updatedAt: Date.now(),
      };
      this.pools.set(key, pool);
      log.info(
        { roomCode, playerId, gameId, ticketCount: tickets.length },
        "[choose-tickets] generated new pool",
      );
    }
    return this.toSnapshot(roomCode, playerId, gameId, pool);
  }

  /**
   * Marker brett-indekser som kjøpt + lagre Lucky Number. Validerer at
   * indekser er innenfor [0, 32) og ikke allerede kjøpt. Idempotent på
   * allerede-kjøpte indekser (no-op).
   */
  buy(input: BuyChooseTicketsInput): PoolSnapshot {
    const key = this.poolKey(input.roomCode, input.playerId, input.gameId);
    let pool = this.pools.get(key);
    if (!pool) {
      // Pool må eksistere før kjøp — caller skal alltid hente først.
      const snapshot = this.getOrCreatePool(input.roomCode, input.playerId, input.gameId);
      pool = this.pools.get(key)!;
      // Gjenta etter create — vi vil håndtere indeksene fra input nedenfor.
      void snapshot;
    }
    for (const idx of input.indices) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= pool.tickets.length) {
        throw new Error(`INVALID_INDEX: ${idx}`);
      }
      pool.purchasedIndices.add(idx);
    }
    if (typeof input.pickAnyNumber === "number") {
      if (
        !Number.isInteger(input.pickAnyNumber) ||
        input.pickAnyNumber < BALL_MIN ||
        input.pickAnyNumber > BALL_MAX
      ) {
        throw new Error(`INVALID_PICK_ANY_NUMBER: ${input.pickAnyNumber}`);
      }
      pool.pickAnyNumber = input.pickAnyNumber;
    }
    pool.updatedAt = Date.now();
    return this.toSnapshot(input.roomCode, input.playerId, input.gameId, pool);
  }

  /**
   * Slett pool — kalles ved spill-slutt for å slippe minne.
   */
  clearPool(roomCode: string, playerId: string, gameId: string): void {
    const key = this.poolKey(roomCode, playerId, gameId);
    this.pools.delete(key);
  }

  /**
   * Slett alle pools for en gameId (når runden ender for hele rommet).
   */
  clearGame(gameId: string): void {
    for (const key of [...this.pools.keys()]) {
      if (key.endsWith(`|${gameId}`)) {
        this.pools.delete(key);
      }
    }
  }

  private toSnapshot(
    roomCode: string,
    playerId: string,
    gameId: string,
    pool: Pool,
  ): PoolSnapshot {
    return {
      roomCode,
      playerId,
      gameId,
      tickets: pool.tickets,
      purchasedIndices: [...pool.purchasedIndices].sort((a, b) => a - b),
      pickAnyNumber: pool.pickAnyNumber,
    };
  }
}

/** Mulberry32 — kompakt deterministisk PRNG. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Enkel string-til-int hash for seeding. */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Pick `count` unike heltall i [min, max] med seeded PRNG. */
function pickUniqueSeeded(rng: () => number, min: number, max: number, count: number): number[] {
  const pool = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  // Fisher-Yates shuffle med seeded RNG
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

/** Generer 3×3 ticket med seeded PRNG. */
function generate3x3TicketSeeded(rng: () => number): Ticket {
  const picks = pickUniqueSeeded(rng, BALL_MIN, BALL_MAX, TICKET_CELLS);
  const grid: number[][] = [
    [picks[0]!, picks[1]!, picks[2]!],
    [picks[3]!, picks[4]!, picks[5]!],
    [picks[6]!, picks[7]!, picks[8]!],
  ];
  return { grid };
}

/** Generer N brett med deterministisk seed. */
function generatePool(seed: number, count: number): Ticket[] {
  const rng = mulberry32(seed);
  const out: Ticket[] = [];
  for (let i = 0; i < count; i++) {
    out.push(generate3x3TicketSeeded(rng));
  }
  return out;
}
