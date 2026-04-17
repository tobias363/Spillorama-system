/**
 * BIN-516: chat-message persistence store.
 *
 * The interface is narrow on purpose — chat is fire-and-forget on the write
 * side (a DB outage must never block a chat send) and bounded on the read
 * side (history defaults to the most recent 50 messages per room).
 *
 * Two implementations:
 *   - PostgresChatMessageStore — production-backed.
 *   - InMemoryChatMessageStore — used by socketIntegration tests + when
 *     APP_PG_CONNECTION_STRING is unset (dev convenience).
 */
import type { Pool, QueryResult } from "pg";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "chat-message-store" });

export interface PersistedChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
}

export interface ChatMessageStore {
  /**
   * Insert a chat message. Implementations must NOT throw on a transient DB
   * error — instead log and return so chat keeps flowing. The in-memory
   * implementation never throws.
   */
  insert(input: {
    hallId: string;
    roomCode: string;
    playerId: string;
    playerName: string;
    message: string;
    emojiId: number;
  }): Promise<void>;

  /**
   * Return the N most recent messages for a room, oldest-first (so the
   * client can render in display order without flipping). Bounded by `limit`.
   */
  listRecent(roomCode: string, limit?: number): Promise<PersistedChatMessage[]>;

  /** Drain pending writes before shutdown. Best-effort. */
  shutdown?(): Promise<void>;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

// ── Postgres implementation ─────────────────────────────────────────────────

export interface PostgresChatMessageStoreOptions {
  pool: Pool;
  schema?: string;
}

interface ChatMessageRow {
  id: string;
  player_id: string;
  player_name: string;
  message: string;
  emoji_id: number;
  created_at: Date | string;
}

export class PostgresChatMessageStore implements ChatMessageStore {
  private readonly pool: Pool;
  private readonly tableName: string;

  constructor(options: PostgresChatMessageStoreOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
    this.tableName = `${schema}.app_chat_messages`;
  }

  async insert(input: {
    hallId: string;
    roomCode: string;
    playerId: string;
    playerName: string;
    message: string;
    emojiId: number;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO ${this.tableName} (hall_id, room_code, player_id, player_name, message, emoji_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.hallId, input.roomCode, input.playerId, input.playerName, input.message.slice(0, 500), input.emojiId],
      );
    } catch (err) {
      // Fire-and-forget on the write path. A DB outage should not break chat;
      // it just means history won't replay this message later.
      logger.warn({ err, roomCode: input.roomCode }, "[BIN-516] chat insert failed (continuing)");
    }
  }

  async listRecent(roomCode: string, limit = DEFAULT_HISTORY_LIMIT): Promise<PersistedChatMessage[]> {
    const safeLimit = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.floor(limit)));
    try {
      const result: QueryResult<ChatMessageRow> = await this.pool.query<ChatMessageRow>(
        `SELECT id::text, player_id, player_name, message, emoji_id, created_at
         FROM ${this.tableName}
         WHERE room_code = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [roomCode, safeLimit],
      );
      // Reverse to oldest-first for client display.
      return result.rows.reverse().map((row) => ({
        id: String(row.id),
        playerId: row.player_id,
        playerName: row.player_name,
        message: row.message,
        emojiId: Number(row.emoji_id),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      }));
    } catch (err) {
      logger.warn({ err, roomCode }, "[BIN-516] chat history query failed (returning empty)");
      return [];
    }
  }
}

// ── In-memory implementation ────────────────────────────────────────────────
// Used by tests and the dev fallback when APP_PG_CONNECTION_STRING is unset.

export class InMemoryChatMessageStore implements ChatMessageStore {
  private readonly byRoom = new Map<string, PersistedChatMessage[]>();
  private nextId = 1;

  async insert(input: {
    hallId: string;
    roomCode: string;
    playerId: string;
    playerName: string;
    message: string;
    emojiId: number;
  }): Promise<void> {
    let list = this.byRoom.get(input.roomCode);
    if (!list) { list = []; this.byRoom.set(input.roomCode, list); }
    list.push({
      id: String(this.nextId++),
      playerId: input.playerId,
      playerName: input.playerName,
      message: input.message.slice(0, 500),
      emojiId: input.emojiId,
      createdAt: new Date().toISOString(),
    });
  }

  async listRecent(roomCode: string, limit = DEFAULT_HISTORY_LIMIT): Promise<PersistedChatMessage[]> {
    const safeLimit = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.floor(limit)));
    const list = this.byRoom.get(roomCode) ?? [];
    return list.slice(-safeLimit).map((m) => ({ ...m }));
  }

  /** Test helper. */
  clear(): void { this.byRoom.clear(); this.nextId = 1; }
}
