import type { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import type { BingoEngine } from "./BingoEngine.js";

type QueryablePool = Pick<Pool, "query">;

interface ServiceOptions {
  pool: QueryablePool;
  engine: BingoEngine;
  schema?: string;
  cacheTtlMs?: number;
}

interface GameMarkCache {
  status: string;
  drawnNumbers: Set<number>;
  playerTicketNumbersByWallet: Map<string, Set<number>>;
  expiresAtMs: number;
}

interface ScheduledGameRow {
  status: string;
  draw_bag_json: unknown | null;
  draws_completed: number | string | null;
}

interface DrawRow {
  ball_value: number | string;
}

interface AssignmentRow {
  grid_numbers_json: unknown;
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function table(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function parseNumberArray(raw: unknown): number[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function isMarkableStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "running" || normalized === "paused";
}

/**
 * High-frequency scheduled Spill 1 validator for `ticket:mark`.
 *
 * This intentionally does not hydrate `enrichScheduledGame1RoomSnapshot()`:
 * at GoH 4x80 scale each drawn ball can produce thousands of player marks,
 * and the full room snapshot loads every purchase/assignment. This service
 * uses the in-memory room binding to resolve scheduledGameId, then caches the
 * small immutable pieces needed for validation.
 */
export class Game1ScheduledTicketMarkService {
  private readonly pool: QueryablePool;
  private readonly engine: BingoEngine;
  private readonly schema: string;
  private readonly cacheTtlMs: number;
  private readonly cacheByGameId = new Map<string, GameMarkCache>();

  constructor(options: ServiceOptions) {
    this.pool = options.pool;
    this.engine = options.engine;
    this.schema = options.schema ?? "public";
    this.cacheTtlMs = options.cacheTtlMs ?? 2_000;
  }

  async validate(input: {
    roomCode: string;
    playerId: string;
    number: number;
  }): Promise<boolean> {
    const snapshot = this.engine.getRoomSnapshot(input.roomCode);
    if (snapshot.gameSlug.toLowerCase() !== "bingo" || !snapshot.scheduledGameId) {
      return false;
    }

    const player = snapshot.players.find((entry) => entry.id === input.playerId);
    if (!player) {
      throw new DomainError("PLAYER_NOT_FOUND", "Spiller finnes ikke i rommet.");
    }

    const gameCache = await this.getGameCache(snapshot.scheduledGameId, false);
    if (!gameCache || !isMarkableStatus(gameCache.status)) {
      throw new DomainError("GAME_NOT_RUNNING", "Ingen aktiv runde.");
    }

    let cacheForDraw = gameCache;
    if (!cacheForDraw.drawnNumbers.has(input.number)) {
      cacheForDraw = await this.getGameCache(snapshot.scheduledGameId, true) ?? gameCache;
    }
    if (!isMarkableStatus(cacheForDraw.status)) {
      throw new DomainError("GAME_NOT_RUNNING", "Ingen aktiv runde.");
    }
    if (!cacheForDraw.drawnNumbers.has(input.number)) {
      throw new DomainError("NUMBER_NOT_DRAWN", "Tallet er ikke trukket ennå.");
    }

    const playerTicketNumbers = await this.getPlayerTicketNumbers(
      snapshot.scheduledGameId,
      player.walletId,
      cacheForDraw,
    );
    if (playerTicketNumbers.size === 0) {
      throw new DomainError("MARKS_NOT_FOUND", "Kunne ikke finne markeringer for spiller.");
    }
    if (!playerTicketNumbers.has(input.number)) {
      throw new DomainError("NUMBER_NOT_ON_TICKET", "Tallet finnes ikke på spillerens brett.");
    }

    return true;
  }

  private async getGameCache(
    scheduledGameId: string,
    forceRefresh: boolean,
  ): Promise<GameMarkCache | null> {
    const nowMs = Date.now();
    const existing = this.cacheByGameId.get(scheduledGameId);
    if (!forceRefresh && existing && existing.expiresAtMs > nowMs) {
      return existing;
    }

    const scheduledGames = table(this.schema, "app_game1_scheduled_games");
    const gameState = table(this.schema, "app_game1_game_state");
    const draws = table(this.schema, "app_game1_draws");

    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT sg.status, gs.draw_bag_json, gs.draws_completed
         FROM ${scheduledGames} sg
         LEFT JOIN ${gameState} gs ON gs.scheduled_game_id = sg.id
        WHERE sg.id = $1
        LIMIT 1`,
      [scheduledGameId],
    );
    const row = rows[0];
    if (!row) {
      this.cacheByGameId.delete(scheduledGameId);
      return null;
    }

    const { rows: drawRows } = await this.pool.query<DrawRow>(
      `SELECT ball_value
         FROM ${draws}
        WHERE scheduled_game_id = $1
        ORDER BY draw_sequence ASC`,
      [scheduledGameId],
    );

    const drawnNumbers = new Set<number>();
    for (const draw of drawRows) {
      const value = Number(draw.ball_value);
      if (Number.isInteger(value) && value > 0) {
        drawnNumbers.add(value);
      }
    }
    const fallbackDrawsCompleted = Number(row.draws_completed) || 0;
    if (fallbackDrawsCompleted > 0) {
      for (const value of parseNumberArray(row.draw_bag_json).slice(0, fallbackDrawsCompleted)) {
        drawnNumbers.add(value);
      }
    }

    const refreshed: GameMarkCache = {
      status: row.status,
      drawnNumbers,
      playerTicketNumbersByWallet: existing?.playerTicketNumbersByWallet ?? new Map(),
      expiresAtMs: nowMs + this.cacheTtlMs,
    };
    this.cacheByGameId.set(scheduledGameId, refreshed);
    return refreshed;
  }

  private async getPlayerTicketNumbers(
    scheduledGameId: string,
    walletId: string,
    gameCache: GameMarkCache,
  ): Promise<Set<number>> {
    const cached = gameCache.playerTicketNumbersByWallet.get(walletId);
    if (cached) {
      return cached;
    }

    const assignments = table(this.schema, "app_game1_ticket_assignments");
    const users = table(this.schema, "app_users");
    const { rows } = await this.pool.query<AssignmentRow>(
      `SELECT a.grid_numbers_json
         FROM ${assignments} a
         JOIN ${users} u ON u.id = a.buyer_user_id
        WHERE a.scheduled_game_id = $1
          AND u.wallet_id = $2`,
      [scheduledGameId, walletId],
    );

    const numbers = new Set<number>();
    for (const row of rows) {
      for (const value of parseNumberArray(row.grid_numbers_json)) {
        numbers.add(value);
      }
    }
    gameCache.playerTicketNumbersByWallet.set(walletId, numbers);
    return numbers;
  }
}
