/**
 * 2026-05-02 (Tobias UX, PDF 17 wireframe side 5): Choose Tickets-side for
 * Spill 2. Hver spiller får 32 deterministiske 3×3-brett (1-21 ball-range)
 * generert med seedet PRNG basert på (roomCode + playerId + gameId).
 *
 * Persistens: in-memory cache + DB (`app_game2_ticket_pools`). DB er kilden
 * — cache er kun for hot-path performance. Pool persisteres via UPSERT ved
 * `getOrCreatePool` (initial generering) og `buy` (oppdaterte indices /
 * pickAnyNumber). Pool-data overlever Render-restart.
 *
 * Wireframe-krav (side 5 note C):
 *   - Hver spiller får 32 forskjellige tilfeldige brett
 *   - Allerede-kjøpte brett markeres som "purchased" ved revisit
 *   - Total max 30 brett per spiller per spill (delt grense med
 *     dropdown-kjøp i Lobby — håndheves i bet:arm-laget)
 *
 * v2/v3-arbeid (denne PR-en):
 *   - DB-persistens via `app_game2_ticket_pools`-tabellen
 *   - `getPurchasedGrids(roomCode, playerId, gameId)` → grids brukes som
 *     `presetGrid` i `BingoSystemAdapter.createTicket` så de visuelt-valgte
 *     brett MATCHER det som faktisk spilles av BingoEngine
 *   - `deletePoolForGame(gameId)` cleanup ved spill-slutt
 *   - `bet:arm`-kobling: POST /buy → armer player med `count = purchasedIndices.length`
 */

import type { Pool as PgPool } from "pg";
import type { Ticket } from "@spillorama/shared-types/game";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game2-ticket-pool" });

const POOL_SIZE = 32;
const TICKET_CELLS = 9; // 3×3
const BALL_MIN = 1;
const BALL_MAX = 21;

interface PoolState {
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

export interface Game2TicketPoolServiceOptions {
  /**
   * Optional `pg` Pool. Når satt, leses og skrives pool-state mot
   * `app_game2_ticket_pools`. Når `undefined` (test-harness uten DB),
   * oppfører servicen seg som rent in-memory (eksisterende oppførsel).
   */
  pool?: PgPool;
}

interface PoolRow {
  room_code: string;
  player_id: string;
  game_id: string;
  ticket_grids: unknown;
  purchased_indices: number[] | null;
  pick_any_number: number | null;
}

export class Game2TicketPoolService {
  private pools = new Map<string, PoolState>();
  private readonly pool: PgPool | null;

  constructor(options: Game2TicketPoolServiceOptions = {}) {
    this.pool = options.pool ?? null;
  }

  private poolKey(roomCode: string, playerId: string, gameId: string): string {
    return `${roomCode}|${playerId}|${gameId}`;
  }

  /**
   * Hent (eller generer) pool for spiller. Idempotent — samme
   * (roomCode, playerId, gameId) gir samme 32 brett.
   *
   * Lazy DB-load: hvis pool ikke er i in-memory cache, prøv først DB.
   * Hvis DB-rad finnes, hydrér cache fra den. Hvis DB-rad mangler,
   * generer ny pool, persistér i DB, og legg i cache.
   */
  async getOrCreatePool(
    roomCode: string,
    playerId: string,
    gameId: string,
  ): Promise<PoolSnapshot> {
    const key = this.poolKey(roomCode, playerId, gameId);
    let pool = this.pools.get(key);
    if (pool) {
      return this.toSnapshot(roomCode, playerId, gameId, pool);
    }

    // Try DB-load before generating.
    const fromDb = await this.loadFromDb(roomCode, playerId, gameId);
    if (fromDb) {
      this.pools.set(key, fromDb);
      return this.toSnapshot(roomCode, playerId, gameId, fromDb);
    }

    // Not in DB — generate fresh deterministic pool and persist.
    const seed = hashSeed(`${roomCode}:${playerId}:${gameId}`);
    const tickets = generatePool(seed, POOL_SIZE);
    pool = {
      tickets,
      purchasedIndices: new Set<number>(),
      pickAnyNumber: null,
      updatedAt: Date.now(),
    };
    this.pools.set(key, pool);
    await this.persistToDb(roomCode, playerId, gameId, pool);
    log.info(
      { roomCode, playerId, gameId, ticketCount: tickets.length },
      "[choose-tickets] generated new pool",
    );
    return this.toSnapshot(roomCode, playerId, gameId, pool);
  }

  /**
   * Marker brett-indekser som kjøpt + lagre Lucky Number. Validerer at
   * indekser er innenfor [0, 32) og ikke allerede kjøpt. Idempotent på
   * allerede-kjøpte indekser (no-op).
   *
   * Persisterer til DB via UPSERT etter mutation.
   */
  async buy(input: BuyChooseTicketsInput): Promise<PoolSnapshot> {
    const key = this.poolKey(input.roomCode, input.playerId, input.gameId);
    let pool = this.pools.get(key);
    if (!pool) {
      // Pool må eksistere før kjøp — hent (eller lazy-load fra DB).
      await this.getOrCreatePool(input.roomCode, input.playerId, input.gameId);
      pool = this.pools.get(key)!;
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
    } else if (input.pickAnyNumber === null) {
      pool.pickAnyNumber = null;
    }
    pool.updatedAt = Date.now();
    await this.persistToDb(input.roomCode, input.playerId, input.gameId, pool);
    return this.toSnapshot(input.roomCode, input.playerId, input.gameId, pool);
  }

  /**
   * Returnér grid-arrayen for hvert kjøpte brett, i samme rekkefølge som
   * `purchasedIndices` (sortert ascending). Brukes av bet:arm-flow til å
   * sende `presetGrid` til BingoSystemAdapter.createTicket så live-spillet
   * matcher det visuelt-valgte.
   *
   * Returnerer tom array hvis pool ikke er kjøpt fra (purchasedIndices == []).
   */
  async getPurchasedGrids(
    roomCode: string,
    playerId: string,
    gameId: string,
  ): Promise<number[][][]> {
    const snapshot = await this.getOrCreatePool(roomCode, playerId, gameId);
    return snapshot.purchasedIndices.map((idx) => {
      const ticket = snapshot.tickets[idx];
      if (!ticket) {
        // Beskytt mot stale state — hopp over tomme/manglende slots.
        return [];
      }
      return ticket.grid.map((row) => [...row]);
    }).filter((grid) => grid.length > 0);
  }

  /**
   * 2026-12-06 (v2): synchronous hot-path lookup for use in `game:start`-
   * flyten der `engine.startGame` trenger grids per spiller med en gang.
   *
   * Returnerer kun pool-data hvis det allerede er i in-memory cache (typisk
   * etter at klient har kjørt GET /api/agent/game2/choose-tickets/:roomCode).
   * Returnerer `null` hvis pool ikke er cached — i så fall faller engine
   * tilbake til normal random-generering for spilleren (defensive: pool
   * må eksistere før spill kan starte; om ikke har spilleren ikke kjøpt
   * noe og bør ikke være i armed-listen).
   *
   * Brukt fra `getPreRoundTicketsByPlayerId`-hooken i index.ts, som lar
   * BingoEngine adoptere disse grids gjennom det eksisterende
   * `preRoundTicketsByPlayerId`-mekanismen.
   */
  getPurchasedGridsFromCache(
    roomCode: string,
    playerId: string,
    gameId: string,
  ): number[][][] | null {
    const key = this.poolKey(roomCode, playerId, gameId);
    const pool = this.pools.get(key);
    if (!pool) return null;
    const sortedIndices = [...pool.purchasedIndices].sort((a, b) => a - b);
    if (sortedIndices.length === 0) return null;
    const grids: number[][][] = [];
    for (const idx of sortedIndices) {
      const ticket = pool.tickets[idx];
      if (!ticket) continue;
      grids.push(ticket.grid.map((row) => [...row]));
    }
    return grids.length > 0 ? grids : null;
  }

  /**
   * 2026-12-06 (v2): list player-ids that have at least one purchased
   * ticket in the cache for (roomCode, gameId). Brukt fra
   * `getPreRoundTicketsByPlayerId`-hooken så vi kan iterere over alle
   * spillere uten å spørre engine om RoomSnapshot.players.
   */
  listPlayersWithPurchasedTickets(
    roomCode: string,
    gameId: string,
  ): string[] {
    const playerIds: string[] = [];
    const prefix = `${roomCode}|`;
    const suffix = `|${gameId}`;
    for (const [key, pool] of this.pools) {
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      if (pool.purchasedIndices.size === 0) continue;
      const middle = key.slice(prefix.length, key.length - suffix.length);
      if (middle.length > 0) playerIds.push(middle);
    }
    return playerIds;
  }

  /**
   * Slett pool — kalles ved spill-slutt for å slippe minne + DB-rad.
   */
  async clearPool(roomCode: string, playerId: string, gameId: string): Promise<void> {
    const key = this.poolKey(roomCode, playerId, gameId);
    this.pools.delete(key);
    if (this.pool) {
      try {
        await this.pool.query(
          `DELETE FROM app_game2_ticket_pools
           WHERE room_code = $1 AND player_id = $2 AND game_id = $3`,
          [roomCode, playerId, gameId],
        );
      } catch (err) {
        log.warn({ err, roomCode, playerId, gameId }, "[choose-tickets] clearPool DB delete failed");
      }
    }
  }

  /**
   * Slett alle pools for en gameId (når runden ender for hele rommet).
   *
   * Synkron-alias for `deletePoolForGame` — bevart for bakoverkompatibilitet
   * med eksisterende test-harness-oppdrag som forventer tom return.
   * Wraps deletePoolForGame som er den nye async-public-API.
   */
  clearGame(gameId: string): void {
    for (const key of [...this.pools.keys()]) {
      if (key.endsWith(`|${gameId}`)) {
        this.pools.delete(key);
      }
    }
    // Fire-and-forget DB-cleanup — caller kan velge deletePoolForGame
    // for await-mulighet hvis det trengs.
    if (this.pool) {
      this.pool.query(
        `DELETE FROM app_game2_ticket_pools WHERE game_id = $1`,
        [gameId],
      ).catch((err) => {
        log.warn({ err, gameId }, "[choose-tickets] clearGame DB delete failed (background)");
      });
    }
  }

  /**
   * Async cleanup for game-end. Sletter alle pools (in-memory + DB) for
   * den gitte gameId. Kalles fra game-end-listener i index.ts så pool ikke
   * akkumulerer over tid.
   */
  async deletePoolForGame(gameId: string): Promise<void> {
    for (const key of [...this.pools.keys()]) {
      if (key.endsWith(`|${gameId}`)) {
        this.pools.delete(key);
      }
    }
    if (this.pool) {
      try {
        await this.pool.query(
          `DELETE FROM app_game2_ticket_pools WHERE game_id = $1`,
          [gameId],
        );
      } catch (err) {
        log.warn({ err, gameId }, "[choose-tickets] deletePoolForGame DB delete failed");
      }
    }
  }

  private toSnapshot(
    roomCode: string,
    playerId: string,
    gameId: string,
    pool: PoolState,
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

  private async loadFromDb(
    roomCode: string,
    playerId: string,
    gameId: string,
  ): Promise<PoolState | null> {
    if (!this.pool) return null;
    try {
      const { rows } = await this.pool.query<PoolRow>(
        `SELECT room_code, player_id, game_id, ticket_grids,
                purchased_indices, pick_any_number
           FROM app_game2_ticket_pools
          WHERE room_code = $1 AND player_id = $2 AND game_id = $3
          LIMIT 1`,
        [roomCode, playerId, gameId],
      );
      const row = rows[0];
      if (!row) return null;
      const grids = parseTicketGridsFromDb(row.ticket_grids);
      if (!grids) {
        log.warn({ roomCode, playerId, gameId }, "[choose-tickets] DB row had malformed ticket_grids — regenerating pool");
        return null;
      }
      const tickets: Ticket[] = grids.map((grid) => ({ grid }));
      const rawIndices: unknown[] = Array.isArray(row.purchased_indices)
        ? (row.purchased_indices as unknown[])
        : [];
      const validIndices: number[] = [];
      for (const n of rawIndices) {
        if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n < tickets.length) {
          validIndices.push(n);
        }
      }
      const purchasedIndices = new Set<number>(validIndices);
      return {
        tickets,
        purchasedIndices,
        pickAnyNumber: typeof row.pick_any_number === "number" ? row.pick_any_number : null,
        updatedAt: Date.now(),
      };
    } catch (err) {
      log.warn({ err, roomCode, playerId, gameId }, "[choose-tickets] DB load failed — falling back to in-memory generation");
      return null;
    }
  }

  private async persistToDb(
    roomCode: string,
    playerId: string,
    gameId: string,
    pool: PoolState,
  ): Promise<void> {
    if (!this.pool) return;
    const grids = pool.tickets.map((t) => t.grid);
    const purchasedArr = [...pool.purchasedIndices].sort((a, b) => a - b);
    try {
      await this.pool.query(
        `INSERT INTO app_game2_ticket_pools
            (room_code, player_id, game_id, ticket_grids, purchased_indices, pick_any_number, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::int[], $6, NOW())
         ON CONFLICT (room_code, player_id, game_id)
         DO UPDATE SET
           ticket_grids = EXCLUDED.ticket_grids,
           purchased_indices = EXCLUDED.purchased_indices,
           pick_any_number = EXCLUDED.pick_any_number,
           updated_at = NOW()`,
        [roomCode, playerId, gameId, JSON.stringify(grids), purchasedArr, pool.pickAnyNumber],
      );
    } catch (err) {
      // Fail-soft: in-memory state forblir gyldig, men varsel logges
      // så ops kan se DB-write-feil. Cron-cleanup vil håndtere foreldede
      // rader hvis DB delvis er ute.
      log.warn({ err, roomCode, playerId, gameId }, "[choose-tickets] DB upsert failed");
    }
  }
}

function parseTicketGridsFromDb(value: unknown): number[][][] | null {
  // pg-driveren returnerer JSONB som allerede-parset JS-objekt for de fleste
  // konfigurasjonene; håndter både array og string for robusthet.
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const grids: number[][][] = [];
  for (const grid of parsed) {
    if (!Array.isArray(grid)) return null;
    const rows: number[][] = [];
    for (const row of grid) {
      if (!Array.isArray(row)) return null;
      const cells: number[] = [];
      for (const cell of row) {
        if (typeof cell !== "number" || !Number.isInteger(cell)) return null;
        cells.push(cell);
      }
      rows.push(cells);
    }
    grids.push(rows);
  }
  return grids;
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
