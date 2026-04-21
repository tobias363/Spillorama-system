/**
 * BIN-159: PostgreSQL-backed BingoSystemAdapter with game state checkpointing.
 *
 * Persists game snapshots to PostgreSQL at critical events (BUY_IN, PAYOUT, GAME_END)
 * enabling crash recovery and regulatory audit.
 */

import { Pool } from "pg";
import { getPoolTuning } from "../util/pgPool.js";
import type {
  BingoSystemAdapter,
  CheckpointInput,
  CreateTicketInput,
  GameStartedInput,
  NumberDrawnInput,
  ClaimLoggedInput,
  GameEndedInput
} from "./BingoSystemAdapter.js";
import type { Ticket } from "../game/types.js";
import { generateTicketForGame } from "../game/ticket.js";

interface PostgresBingoSystemAdapterOptions {
  connectionString: string;
  schema?: string;
  ssl?: boolean;
}

export class PostgresBingoSystemAdapter implements BingoSystemAdapter {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: PostgresBingoSystemAdapterOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      ssl: options.ssl ? { rejectUnauthorized: false } : false,
      ...getPoolTuning()
    });
    this.schema = options.schema || "public";
  }

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    return generateTicketForGame(input.gameSlug, input.color, input.type);
  }

  async onGameStarted(_input: GameStartedInput): Promise<void> {
    // Game start is tracked via BUY_IN checkpoint
  }

  async onNumberDrawn(_input: NumberDrawnInput): Promise<void> {
    // Individual draws tracked in-memory; snapshot captures all drawn numbers
  }

  async onClaimLogged(_input: ClaimLoggedInput): Promise<void> {
    // Claims tracked via PAYOUT checkpoint
  }

  async onGameEnded(input: GameEndedInput): Promise<void> {
    await this.ensureInitialized();
    // Mark game session as ended
    await this.pool.query(
      `UPDATE ${this.sessionsTable()} SET status = 'ENDED', ended_at = now()
       WHERE game_id = $1`,
      [input.gameId]
    );
  }

  async onCheckpoint(input: CheckpointInput): Promise<void> {
    await this.ensureInitialized();

    // Upsert game session (created on BUY_IN, updated on subsequent checkpoints)
    if (input.reason === "BUY_IN") {
      await this.pool.query(
        `INSERT INTO ${this.sessionsTable()} (game_id, room_code, hall_id, status, started_at)
         VALUES ($1, $2, $3, 'RUNNING', now())
         ON CONFLICT (game_id) DO NOTHING`,
        [input.gameId, input.roomCode, input.hallId ?? null]
      );
    }

    // Append checkpoint event
    await this.pool.query(
      `INSERT INTO ${this.checkpointsTable()}
        (game_id, room_code, hall_id, reason, claim_id, payout_amount, transaction_ids, snapshot, players, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
      [
        input.gameId,
        input.roomCode,
        input.hallId ?? null,
        input.reason,
        input.claimId ?? null,
        input.payoutAmount ?? null,
        input.transactionIds ? JSON.stringify(input.transactionIds) : null,
        input.snapshot ? JSON.stringify(input.snapshot) : null,
        input.players ? JSON.stringify(input.players) : null
      ]
    );

    // Mark game ended if GAME_END
    if (input.reason === "GAME_END") {
      await this.pool.query(
        `UPDATE ${this.sessionsTable()} SET status = 'ENDED', ended_at = now()
         WHERE game_id = $1`,
        [input.gameId]
      );
    }
  }

  /** Find games that were RUNNING when the server crashed. */
  async findIncompleteGames(): Promise<Array<{ gameId: string; roomCode: string; hallId: string | null; startedAt: string }>> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{
      game_id: string;
      room_code: string;
      hall_id: string | null;
      started_at: Date | string;
    }>(
      `SELECT game_id, room_code, hall_id, started_at
       FROM ${this.sessionsTable()}
       WHERE status = 'RUNNING'
       ORDER BY started_at DESC`
    );
    return rows.map((row) => ({
      gameId: row.game_id,
      roomCode: row.room_code,
      hallId: row.hall_id,
      startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at)
    }));
  }

  /** Mark a game as ended (used during crash recovery). */
  async markGameEnded(gameId: string, reason: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `UPDATE ${this.sessionsTable()} SET status = 'ENDED', ended_at = now()
       WHERE game_id = $1`,
      [gameId]
    );
    // Record a GAME_END checkpoint for the recovery event
    await this.pool.query(
      `INSERT INTO ${this.checkpointsTable()}
        (game_id, room_code, hall_id, reason, created_at)
       VALUES ($1, (SELECT room_code FROM ${this.sessionsTable()} WHERE game_id = $1), NULL, $2, now())`,
      [gameId, `GAME_END:${reason}`]
    );
  }

  /** Get the latest snapshot for a game (for future recovery). */
  async getLatestSnapshot(gameId: string): Promise<unknown | null> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{ snapshot: unknown }>(
      `SELECT snapshot FROM ${this.checkpointsTable()}
       WHERE game_id = $1 AND snapshot IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [gameId]
    );
    return rows[0]?.snapshot ?? null;
  }

  /** BIN-245: Get the latest snapshot and players for crash recovery. */
  async getLatestCheckpointData(gameId: string): Promise<{ snapshot: unknown; players: unknown } | null> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{ snapshot: unknown; players: unknown }>(
      `SELECT snapshot, players FROM ${this.checkpointsTable()}
       WHERE game_id = $1 AND snapshot IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [gameId]
    );
    if (!rows[0]) return null;
    return { snapshot: rows[0].snapshot, players: rows[0].players };
  }

  /** BIN-173: Get full checkpoint timeline for a game (for replay/audit). */
  async getGameTimeline(gameId: string): Promise<Array<{
    id: string;
    reason: string;
    claimId: string | null;
    payoutAmount: number | null;
    transactionIds: unknown;
    snapshot: unknown;
    players: unknown;
    createdAt: string;
  }>> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{
      id: string;
      reason: string;
      claim_id: string | null;
      payout_amount: string | null;
      transaction_ids: unknown;
      snapshot: unknown;
      players: unknown;
      created_at: Date | string;
    }>(
      `SELECT id::text, reason, claim_id, payout_amount, transaction_ids, snapshot, players, created_at
       FROM ${this.checkpointsTable()}
       WHERE game_id = $1
       ORDER BY created_at ASC`,
      [gameId]
    );
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      claimId: r.claim_id,
      payoutAmount: r.payout_amount ? Number(r.payout_amount) : null,
      transactionIds: r.transaction_ids,
      snapshot: r.snapshot,
      players: r.players,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
    }));
  }

  /** BIN-173: Get game session info. */
  async getGameSession(gameId: string): Promise<{
    gameId: string; roomCode: string; hallId: string | null; status: string;
    startedAt: string; endedAt: string | null;
  } | null> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{
      game_id: string; room_code: string; hall_id: string | null; status: string;
      started_at: Date | string; ended_at: Date | string | null;
    }>(
      `SELECT game_id, room_code, hall_id, status, started_at, ended_at
       FROM ${this.sessionsTable()} WHERE game_id = $1`,
      [gameId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      gameId: r.game_id,
      roomCode: r.room_code,
      hallId: r.hall_id,
      status: r.status,
      startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : String(r.started_at),
      endedAt: r.ended_at ? (r.ended_at instanceof Date ? r.ended_at.toISOString() : String(r.ended_at)) : null
    };
  }

  async shutdown(): Promise<void> {
    await this.pool.end();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.sessionsTable()} (
          game_id TEXT PRIMARY KEY,
          room_code TEXT NOT NULL,
          hall_id TEXT,
          status TEXT NOT NULL DEFAULT 'RUNNING',
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          ended_at TIMESTAMPTZ
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_game_sessions_status
         ON ${this.sessionsTable()} (status)`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.checkpointsTable()} (
          id BIGSERIAL PRIMARY KEY,
          game_id TEXT NOT NULL,
          room_code TEXT NOT NULL,
          hall_id TEXT,
          reason TEXT NOT NULL,
          claim_id TEXT,
          payout_amount NUMERIC(20, 6),
          transaction_ids JSONB,
          snapshot JSONB,
          players JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_game_checkpoints_game_id
         ON ${this.checkpointsTable()} (game_id)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_game_checkpoints_room_code
         ON ${this.checkpointsTable()} (room_code)`
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private sessionsTable(): string {
    return `"${this.schema}"."game_sessions"`;
  }

  private checkpointsTable(): string {
    return `"${this.schema}"."game_checkpoints"`;
  }
}
