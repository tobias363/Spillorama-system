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
 *
 * HIGH-11: utvidet med moderasjons-API (`listForModeration`, `softDelete`,
 * `getById`) for `/api/admin/chat/messages*`-endepunktene. Gameplay-stien
 * (`listRecent`) returnerer "[Slettet av moderator]" for soft-delete-rader
 * så andre spillere ikke ser den opprinnelige teksten.
 */
import type { Pool, QueryResult } from "pg";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "chat-message-store" });

/** HIGH-11: tekst spillere ser i stedet for slettet melding. */
export const CHAT_MESSAGE_DELETED_PLACEHOLDER = "[Slettet av moderator]";

export interface PersistedChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
}

/**
 * HIGH-11: full melding-rad slik moderator-listingen ser den. Beholder
 * `hallId` + `roomCode` så admin-UI kan filtrere/segmentere, og inkluderer
 * soft-delete-feltene så slettede meldinger fortsatt vises i moderator-vyen
 * (med "deleted"-merkelapp) — vi *fjerner* aldri rader, kun maskerer dem
 * for andre spillere.
 */
export interface ModerationChatMessage {
  id: string;
  hallId: string;
  roomCode: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
  deletedAt: string | null;
  deletedByUserId: string | null;
  deleteReason: string | null;
}

/** HIGH-11: filter-felter for moderator-listing. */
export interface ChatModerationListFilter {
  hallId?: string;
  roomCode?: string;
  /** ISO timestamp, inclusive. */
  fromDate?: string;
  /** ISO timestamp, inclusive. */
  toDate?: string;
  /** Case-insensitive substring i message + player_name. */
  search?: string;
  /** Inkluder soft-deleted? Default false. */
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
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
   *
   * HIGH-11: Soft-deleted meldinger inkluderes i listingen men `message`
   * erstattes med [Slettet av moderator]-placeholder så andre spillere
   * ikke kan lese den opprinnelige teksten.
   */
  listRecent(roomCode: string, limit?: number): Promise<PersistedChatMessage[]>;

  /**
   * HIGH-11: moderator-listing med filter + pagination. Returnerer rå
   * meldinger inkludert soft-delete-felter — kun for autentiserte
   * admin/hall-operator-roller. Kalles fra `/api/admin/chat/messages`.
   */
  listForModeration(filter: ChatModerationListFilter): Promise<{
    messages: ModerationChatMessage[];
    total: number;
  }>;

  /**
   * HIGH-11: hent én melding for moderator-handling (delete-validering
   * + hall-scope-sjekk). Returnerer null ved ukjent id.
   */
  getById(id: string): Promise<ModerationChatMessage | null>;

  /**
   * HIGH-11: soft-delete én melding. Idempotent: re-sletting overskriver
   * IKKE eksisterende deleted_at/by/reason — første sletter eier audit-
   * sporet. Returnerer den oppdaterte raden, eller `null` hvis ukjent id.
   */
  softDelete(input: {
    id: string;
    deletedByUserId: string;
    deleteReason: string;
  }): Promise<ModerationChatMessage | null>;

  /** Drain pending writes before shutdown. Best-effort. */
  shutdown?(): Promise<void>;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

/** HIGH-11: bounds for moderator-listingen. */
const DEFAULT_MODERATION_LIMIT = 100;
const MAX_MODERATION_LIMIT = 500;

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
  /** HIGH-11: soft-delete-felter (NULL hvis ikke slettet). */
  deleted_at?: Date | string | null;
}

interface ModerationChatMessageRow {
  id: string;
  hall_id: string;
  room_code: string;
  player_id: string;
  player_name: string;
  message: string;
  emoji_id: number;
  created_at: Date | string;
  deleted_at: Date | string | null;
  deleted_by_user_id: string | null;
  delete_reason: string | null;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToModeration(row: ModerationChatMessageRow): ModerationChatMessage {
  return {
    id: String(row.id),
    hallId: row.hall_id,
    roomCode: row.room_code,
    playerId: row.player_id,
    playerName: row.player_name,
    message: row.message,
    emojiId: Number(row.emoji_id),
    createdAt: toIsoOrNull(row.created_at) ?? new Date().toISOString(),
    deletedAt: toIsoOrNull(row.deleted_at),
    deletedByUserId: row.deleted_by_user_id,
    deleteReason: row.delete_reason,
  };
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
        `SELECT id::text, player_id, player_name, message, emoji_id, created_at, deleted_at
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
        // HIGH-11: maskér slettede meldinger for andre spillere.
        message: row.deleted_at ? CHAT_MESSAGE_DELETED_PLACEHOLDER : row.message,
        emojiId: Number(row.emoji_id),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      }));
    } catch (err) {
      logger.warn({ err, roomCode }, "[BIN-516] chat history query failed (returning empty)");
      return [];
    }
  }

  async listForModeration(filter: ChatModerationListFilter): Promise<{
    messages: ModerationChatMessage[];
    total: number;
  }> {
    const limit = Math.max(
      1,
      Math.min(MAX_MODERATION_LIMIT, Math.floor(filter.limit ?? DEFAULT_MODERATION_LIMIT))
    );
    const offset = Math.max(0, Math.floor(filter.offset ?? 0));

    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.hallId) {
      params.push(filter.hallId);
      where.push(`hall_id = $${params.length}`);
    }
    if (filter.roomCode) {
      params.push(filter.roomCode);
      where.push(`room_code = $${params.length}`);
    }
    if (filter.fromDate) {
      params.push(filter.fromDate);
      where.push(`created_at >= $${params.length}`);
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      where.push(`created_at <= $${params.length}`);
    }
    if (filter.search && filter.search.trim()) {
      params.push(`%${filter.search.trim()}%`);
      const idx = params.length;
      where.push(`(message ILIKE $${idx} OR player_name ILIKE $${idx})`);
    }
    if (!filter.includeDeleted) {
      where.push(`deleted_at IS NULL`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    try {
      // Vi gjør count + page i parallell siden begge spørringene har
      // samme WHERE-klausul (admin-UI trenger total for paginator).
      const [pageResult, countResult] = await Promise.all([
        this.pool.query<ModerationChatMessageRow>(
          `SELECT id::text, hall_id, room_code, player_id, player_name, message,
                  emoji_id, created_at, deleted_at, deleted_by_user_id, delete_reason
           FROM ${this.tableName}
           ${whereClause}
           ORDER BY created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
        this.pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${this.tableName} ${whereClause}`,
          params
        ),
      ]);

      const messages = pageResult.rows.map(rowToModeration);
      const total = Number(countResult.rows[0]?.count ?? 0);
      return { messages, total };
    } catch (err) {
      logger.warn({ err }, "[HIGH-11] chat moderation list failed (returning empty)");
      return { messages: [], total: 0 };
    }
  }

  async getById(id: string): Promise<ModerationChatMessage | null> {
    try {
      const result = await this.pool.query<ModerationChatMessageRow>(
        `SELECT id::text, hall_id, room_code, player_id, player_name, message,
                emoji_id, created_at, deleted_at, deleted_by_user_id, delete_reason
         FROM ${this.tableName}
         WHERE id::text = $1
         LIMIT 1`,
        [id]
      );
      const row = result.rows[0];
      return row ? rowToModeration(row) : null;
    } catch (err) {
      logger.warn({ err, id }, "[HIGH-11] chat getById failed");
      return null;
    }
  }

  async softDelete(input: {
    id: string;
    deletedByUserId: string;
    deleteReason: string;
  }): Promise<ModerationChatMessage | null> {
    const reason = input.deleteReason.slice(0, 500);
    try {
      // Idempotent: kun sett deleted_at hvis NULL, ellers behold første
      // moderator som "eier" sletten (audit-spor).
      const result = await this.pool.query<ModerationChatMessageRow>(
        `UPDATE ${this.tableName}
         SET deleted_at         = COALESCE(deleted_at, now()),
             deleted_by_user_id = COALESCE(deleted_by_user_id, $2),
             delete_reason      = COALESCE(delete_reason, $3)
         WHERE id::text = $1
         RETURNING id::text, hall_id, room_code, player_id, player_name, message,
                   emoji_id, created_at, deleted_at, deleted_by_user_id, delete_reason`,
        [input.id, input.deletedByUserId, reason]
      );
      const row = result.rows[0];
      return row ? rowToModeration(row) : null;
    } catch (err) {
      logger.warn({ err, id: input.id }, "[HIGH-11] chat softDelete failed");
      return null;
    }
  }
}

// ── In-memory implementation ────────────────────────────────────────────────
// Used by tests and the dev fallback when APP_PG_CONNECTION_STRING is unset.

interface InMemoryChatRow {
  id: string;
  hallId: string;
  roomCode: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
  deletedAt: string | null;
  deletedByUserId: string | null;
  deleteReason: string | null;
}

export class InMemoryChatMessageStore implements ChatMessageStore {
  private readonly rows: InMemoryChatRow[] = [];
  private nextId = 1;

  async insert(input: {
    hallId: string;
    roomCode: string;
    playerId: string;
    playerName: string;
    message: string;
    emojiId: number;
  }): Promise<void> {
    this.rows.push({
      id: String(this.nextId++),
      hallId: input.hallId,
      roomCode: input.roomCode,
      playerId: input.playerId,
      playerName: input.playerName,
      message: input.message.slice(0, 500),
      emojiId: input.emojiId,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      deletedByUserId: null,
      deleteReason: null,
    });
  }

  async listRecent(roomCode: string, limit = DEFAULT_HISTORY_LIMIT): Promise<PersistedChatMessage[]> {
    const safeLimit = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.floor(limit)));
    const list = this.rows.filter((r) => r.roomCode === roomCode);
    return list.slice(-safeLimit).map((m) => ({
      id: m.id,
      playerId: m.playerId,
      playerName: m.playerName,
      // HIGH-11: maskér slettede meldinger.
      message: m.deletedAt ? CHAT_MESSAGE_DELETED_PLACEHOLDER : m.message,
      emojiId: m.emojiId,
      createdAt: m.createdAt,
    }));
  }

  async listForModeration(filter: ChatModerationListFilter): Promise<{
    messages: ModerationChatMessage[];
    total: number;
  }> {
    const limit = Math.max(
      1,
      Math.min(MAX_MODERATION_LIMIT, Math.floor(filter.limit ?? DEFAULT_MODERATION_LIMIT))
    );
    const offset = Math.max(0, Math.floor(filter.offset ?? 0));
    const search = filter.search?.trim().toLowerCase() ?? "";

    const filtered = this.rows.filter((r) => {
      if (filter.hallId && r.hallId !== filter.hallId) return false;
      if (filter.roomCode && r.roomCode !== filter.roomCode) return false;
      if (filter.fromDate && r.createdAt < filter.fromDate) return false;
      if (filter.toDate && r.createdAt > filter.toDate) return false;
      if (!filter.includeDeleted && r.deletedAt) return false;
      if (search) {
        const hay = `${r.message} ${r.playerName}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    // Newest-first (matches Postgres ORDER BY created_at DESC).
    const sorted = [...filtered].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
    );
    const page = sorted.slice(offset, offset + limit);
    return {
      messages: page.map((r) => ({
        id: r.id,
        hallId: r.hallId,
        roomCode: r.roomCode,
        playerId: r.playerId,
        playerName: r.playerName,
        message: r.message,
        emojiId: r.emojiId,
        createdAt: r.createdAt,
        deletedAt: r.deletedAt,
        deletedByUserId: r.deletedByUserId,
        deleteReason: r.deleteReason,
      })),
      total: sorted.length,
    };
  }

  async getById(id: string): Promise<ModerationChatMessage | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    return {
      id: row.id,
      hallId: row.hallId,
      roomCode: row.roomCode,
      playerId: row.playerId,
      playerName: row.playerName,
      message: row.message,
      emojiId: row.emojiId,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
      deletedByUserId: row.deletedByUserId,
      deleteReason: row.deleteReason,
    };
  }

  async softDelete(input: {
    id: string;
    deletedByUserId: string;
    deleteReason: string;
  }): Promise<ModerationChatMessage | null> {
    const row = this.rows.find((r) => r.id === input.id);
    if (!row) return null;
    // Idempotent: første sletter eier sporet.
    if (row.deletedAt === null) {
      row.deletedAt = new Date().toISOString();
      row.deletedByUserId = input.deletedByUserId;
      row.deleteReason = input.deleteReason.slice(0, 500);
    }
    return this.getById(input.id);
  }

  /** Test helper. */
  clear(): void {
    this.rows.length = 0;
    this.nextId = 1;
  }
}
