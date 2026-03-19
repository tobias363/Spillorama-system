import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Checkpoint store for Candy game state persistence.
//
// All writes are fire-and-forget: the game continues in memory regardless of
// whether the checkpoint succeeds.  On startup the latest checkpoint is read
// to reconstruct rooms and running games that survived a process restart.
// ---------------------------------------------------------------------------

export interface RoomCheckpoint {
  roomCode: string;
  hallId: string;
  hostPlayerId: string;
  players: Array<{ id: string; name: string; walletId: string }>;
  preRoundTickets: Record<string, number[][]>;
  createdAt: string;
}

export interface GameCheckpoint {
  roomCode: string;
  gameId: string;
  status: "WAITING" | "RUNNING" | "ENDED";
  hallId: string;
  hostPlayerId: string;
  entryFee: number;
  ticketsPerPlayer: number;
  payoutPercent: number;
  drawnNumbers: number[];
  drawBag: number[];
  players: Array<{ id: string; name: string; walletId: string }>;
  tickets: Record<string, number[][]>;
  claims: Array<{
    id: string;
    playerId: string;
    type: string;
    valid: boolean;
    reason?: string;
  }>;
  lineWinnerId: string | null;
  bingoWinnerId: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export class GameCheckpointStore {
  private pool: Pool;
  private initialized = false;

  constructor(connectionString: string, ssl = false) {
    this.pool = new Pool({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
    });
  }

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------

  async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS candy_room_checkpoints (
          room_code TEXT PRIMARY KEY,
          hall_id TEXT NOT NULL,
          host_player_id TEXT NOT NULL,
          players_json JSONB NOT NULL DEFAULT '[]',
          pre_round_tickets_json JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS candy_game_checkpoints (
          room_code TEXT NOT NULL,
          game_id TEXT NOT NULL,
          status TEXT NOT NULL,
          hall_id TEXT NOT NULL,
          host_player_id TEXT NOT NULL,
          entry_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
          tickets_per_player INTEGER NOT NULL DEFAULT 4,
          payout_percent NUMERIC(5,2) NOT NULL DEFAULT 75,
          drawn_numbers INTEGER[] NOT NULL DEFAULT '{}',
          draw_bag INTEGER[] NOT NULL DEFAULT '{}',
          players_json JSONB NOT NULL DEFAULT '[]',
          tickets_json JSONB NOT NULL DEFAULT '{}',
          claims_json JSONB NOT NULL DEFAULT '[]',
          line_winner_id TEXT,
          bingo_winner_id TEXT,
          started_at TIMESTAMPTZ,
          ended_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (room_code, game_id)
        );
      `);
      this.initialized = true;
      console.log("[checkpoint] Schema created/verified.");
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Room checkpoints
  // -------------------------------------------------------------------------

  async saveRoomCheckpoint(room: RoomCheckpoint): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO candy_room_checkpoints
           (room_code, hall_id, host_player_id, players_json, pre_round_tickets_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (room_code) DO UPDATE SET
           hall_id = EXCLUDED.hall_id,
           host_player_id = EXCLUDED.host_player_id,
           players_json = EXCLUDED.players_json,
           pre_round_tickets_json = EXCLUDED.pre_round_tickets_json,
           updated_at = now()`,
        [
          room.roomCode,
          room.hallId,
          room.hostPlayerId,
          JSON.stringify(room.players),
          JSON.stringify(room.preRoundTickets),
          room.createdAt,
        ],
      );
    } catch (error) {
      console.error("[checkpoint] Failed to save room checkpoint:", error);
    }
  }

  async loadRoomCheckpoints(): Promise<RoomCheckpoint[]> {
    const result = await this.pool.query(
      `SELECT room_code, hall_id, host_player_id, players_json, pre_round_tickets_json, created_at
       FROM candy_room_checkpoints
       ORDER BY created_at ASC`,
    );
    return result.rows.map((row) => ({
      roomCode: row.room_code,
      hallId: row.hall_id,
      hostPlayerId: row.host_player_id,
      players: row.players_json ?? [],
      preRoundTickets: row.pre_round_tickets_json ?? {},
      createdAt: row.created_at?.toISOString?.() ?? new Date().toISOString(),
    }));
  }

  // -------------------------------------------------------------------------
  // Game checkpoints
  // -------------------------------------------------------------------------

  async saveGameCheckpoint(game: GameCheckpoint): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO candy_game_checkpoints
           (room_code, game_id, status, hall_id, host_player_id, entry_fee,
            tickets_per_player, payout_percent, drawn_numbers, draw_bag,
            players_json, tickets_json, claims_json, line_winner_id,
            bingo_winner_id, started_at, ended_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
         ON CONFLICT (room_code, game_id) DO UPDATE SET
           status = EXCLUDED.status,
           drawn_numbers = EXCLUDED.drawn_numbers,
           draw_bag = EXCLUDED.draw_bag,
           players_json = EXCLUDED.players_json,
           tickets_json = EXCLUDED.tickets_json,
           claims_json = EXCLUDED.claims_json,
           line_winner_id = EXCLUDED.line_winner_id,
           bingo_winner_id = EXCLUDED.bingo_winner_id,
           ended_at = EXCLUDED.ended_at,
           updated_at = now()`,
        [
          game.roomCode,
          game.gameId,
          game.status,
          game.hallId,
          game.hostPlayerId,
          game.entryFee,
          game.ticketsPerPlayer,
          game.payoutPercent,
          game.drawnNumbers,
          game.drawBag,
          JSON.stringify(game.players),
          JSON.stringify(game.tickets),
          JSON.stringify(game.claims),
          game.lineWinnerId,
          game.bingoWinnerId,
          game.startedAt,
          game.endedAt,
        ],
      );
    } catch (error) {
      console.error("[checkpoint] Failed to save game checkpoint:", error);
    }
  }

  async loadRunningGameCheckpoints(): Promise<GameCheckpoint[]> {
    const result = await this.pool.query(
      `SELECT * FROM candy_game_checkpoints WHERE status = 'RUNNING' ORDER BY started_at ASC`,
    );
    return result.rows.map((row) => ({
      roomCode: row.room_code,
      gameId: row.game_id,
      status: row.status,
      hallId: row.hall_id,
      hostPlayerId: row.host_player_id,
      entryFee: Number(row.entry_fee),
      ticketsPerPlayer: row.tickets_per_player,
      payoutPercent: Number(row.payout_percent),
      drawnNumbers: row.drawn_numbers ?? [],
      drawBag: row.draw_bag ?? [],
      players: row.players_json ?? [],
      tickets: row.tickets_json ?? {},
      claims: row.claims_json ?? [],
      lineWinnerId: row.line_winner_id ?? null,
      bingoWinnerId: row.bingo_winner_id ?? null,
      startedAt: row.started_at?.toISOString?.() ?? null,
      endedAt: row.ended_at?.toISOString?.() ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  async cleanupEndedGames(olderThanHours = 24): Promise<number> {
    try {
      const result = await this.pool.query(
        `DELETE FROM candy_game_checkpoints
         WHERE status = 'ENDED' AND ended_at < now() - interval '1 hour' * $1`,
        [olderThanHours],
      );
      return result.rowCount ?? 0;
    } catch (error) {
      console.error("[checkpoint] Failed to cleanup ended games:", error);
      return 0;
    }
  }
}
