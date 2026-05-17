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
  roomCode: string | null;
  status: string;
  drawnNumbers: Set<number>;
  playerTicketNumbersByWallet: Map<string, Set<number>>;
  expiresAtMs: number;
}

interface ScheduledGameRow {
  room_code: string | null;
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

function isMarkableStatus(status: string, allowCompleted: boolean): boolean {
  const normalized = status.toLowerCase();
  return normalized === "running" || normalized === "paused" || (allowCompleted && normalized === "completed");
}

/**
 * High-frequency scheduled Spill 1 validator for `ticket:mark`.
 *
 * This intentionally does not hydrate `enrichScheduledGame1RoomSnapshot()`:
 * at GoH 4x80 scale each drawn ball can produce thousands of player marks,
 * and the full room snapshot loads every purchase/assignment. This service
   * uses an explicit scheduledGameId when the client/runner echoes `draw:new.gameId`.
   * That keeps late marks valid even after the canonical room has been reset for
   * the next round. Legacy callers without scheduledGameId still fall back to
   * the in-memory room binding.
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
    scheduledGameId?: string;
  }): Promise<boolean> {
    const snapshot = this.engine.getRoomSnapshot(input.roomCode);
    const explicitScheduledGameId = typeof input.scheduledGameId === "string" && input.scheduledGameId.trim().length > 0
      ? input.scheduledGameId.trim()
      : null;
    if (snapshot.gameSlug.toLowerCase() !== "bingo") {
      if (explicitScheduledGameId) {
        throw new DomainError("GAME_MISMATCH", "Scheduled markering kan bare brukes for Spill 1.");
      }
      return false;
    }

    const scheduledGameId = explicitScheduledGameId ?? snapshot.scheduledGameId ?? null;
    if (!scheduledGameId) {
      return false;
    }

    const player = snapshot.players.find((entry) => entry.id === input.playerId);
    if (!player) {
      throw new DomainError("PLAYER_NOT_FOUND", "Spiller finnes ikke i rommet.");
    }

    const allowCompletedAck = explicitScheduledGameId !== null;
    const gameCache = await this.getGameCache(scheduledGameId, false);
    if (!gameCache) {
      if (explicitScheduledGameId) {
        throw new DomainError("SCHEDULED_GAME_NOT_FOUND", "Fant ikke planlagt runde.");
      }
      throw new DomainError("GAME_NOT_RUNNING", "Ingen aktiv runde.");
    }
    this.assertRoomMatches(input.roomCode, gameCache);
    if (!isMarkableStatus(gameCache.status, allowCompletedAck)) {
      throw new DomainError("GAME_NOT_RUNNING", "Ingen aktiv runde.");
    }

    let cacheForDraw = gameCache;
    if (!cacheForDraw.drawnNumbers.has(input.number)) {
      cacheForDraw = await this.getGameCache(scheduledGameId, true) ?? gameCache;
      this.assertRoomMatches(input.roomCode, cacheForDraw);
    }
    if (!isMarkableStatus(cacheForDraw.status, allowCompletedAck)) {
      throw new DomainError("GAME_NOT_RUNNING", "Ingen aktiv runde.");
    }
    if (!cacheForDraw.drawnNumbers.has(input.number)) {
      throw new DomainError("NUMBER_NOT_DRAWN", "Tallet er ikke trukket ennå.");
    }

    const playerTicketNumbers = await this.getPlayerTicketNumbers(
      scheduledGameId,
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

  private assertRoomMatches(inputRoomCode: string, gameCache: GameMarkCache): void {
    if (!gameCache.roomCode) return;
    if (gameCache.roomCode.toUpperCase() !== inputRoomCode.toUpperCase()) {
      throw new DomainError("SCHEDULED_GAME_ROOM_MISMATCH", "Runden tilhører et annet rom.");
    }
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
      `SELECT sg.room_code, sg.status, gs.draw_bag_json, gs.draws_completed
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
      roomCode: row.room_code,
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
