/**
 * BIN-170: Redis-backed room state store.
 *
 * Write-through cache: in-memory Map for zero-latency reads,
 * Redis for persistence and cross-instance sync.
 *
 * On startup: loadAll() hydrates memory from Redis.
 * On mutation: persist() writes serialized state to Redis.
 * On shutdown: all pending writes flushed.
 *
 * Redis keys: `bingo:room:{roomCode}` with configurable TTL.
 */

import { Redis } from "ioredis";
import type { RoomState } from "../game/types.js";
import { serializeRoom, deserializeRoom, type RoomStateStore } from "./RoomStateStore.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "redis-room-store" });

export interface RedisRoomStateStoreOptions {
  /** Redis connection URL (default: redis://localhost:6379) */
  url?: string;
  /** Key prefix (default: bingo:room:) */
  keyPrefix?: string;
  /** TTL in seconds for room state (default: 86400 = 24h) */
  ttlSeconds?: number;
}

export class RedisRoomStateStore implements RoomStateStore {
  private readonly rooms = new Map<string, RoomState>();
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private closed = false;

  constructor(options?: RedisRoomStateStoreOptions) {
    this.redis = new Redis(options?.url ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });
    this.keyPrefix = options?.keyPrefix ?? "bingo:room:";
    this.ttlSeconds = options?.ttlSeconds ?? 86_400;

    this.redis.on("error", (err: Error) => {
      logger.error({ err }, "Redis connection error");
    });
  }

  private redisKey(code: string): string {
    return `${this.keyPrefix}${code}`;
  }

  // ── Synchronous in-memory access (hot path) ──────────────────────────

  get(code: string): RoomState | undefined { return this.rooms.get(code); }

  set(code: string, room: RoomState): void {
    this.rooms.set(code, room);
    // Fire-and-forget persist — errors logged, not thrown
    this.persistAsync(code).catch(() => {});
  }

  delete(code: string): void {
    this.rooms.delete(code);
    this.redis.del(this.redisKey(code)).catch((err: Error) => {
      logger.error({ err, roomCode: code }, "Failed to delete room from Redis");
    });
  }

  has(code: string): boolean { return this.rooms.has(code); }
  keys(): IterableIterator<string> { return this.rooms.keys(); }
  values(): IterableIterator<RoomState> { return this.rooms.values(); }
  get size(): number { return this.rooms.size; }

  // ── Async persistence ────────────────────────────────────────────────

  /**
   * HOEY-11: Explicitly persist a room to Redis (synchronous with error propagation).
   * Called after critical mutations (payout, game end, buy-in).
   * Throws on failure so callers can handle or log at CRITICAL level.
   */
  async persist(code: string): Promise<void> {
    const room = this.rooms.get(code);
    if (!room) return;
    const serialized = serializeRoom(room);
    const json = JSON.stringify(serialized);
    await this.redis.setex(this.redisKey(code), this.ttlSeconds, json);
  }

  /**
   * Fire-and-forget persistence for non-critical write-through cache updates.
   * Errors are logged but not thrown — in-memory state is authoritative.
   */
  private async persistAsync(code: string): Promise<void> {
    try {
      await this.persist(code);
    } catch (err) {
      logger.error({ err, roomCode: code }, "Failed to persist room to Redis (non-critical)");
    }
  }

  /** Load all rooms from Redis into memory (startup recovery). */
  async loadAll(): Promise<number> {
    try {
      await this.redis.connect();
    } catch {
      // Already connected or connection failed — handled by error listener
    }

    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length === 0) return 0;

      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        pipeline.get(key);
      }
      const results = await pipeline.exec();
      if (!results) return 0;

      let loaded = 0;
      for (let i = 0; i < keys.length; i++) {
        const [err, value] = results[i];
        if (err || !value || typeof value !== "string") continue;

        try {
          const data = JSON.parse(value);
          const room = deserializeRoom(data);
          this.rooms.set(room.code, room);
          loaded++;
        } catch (parseErr) {
          logger.warn({ err: parseErr, key: keys[i] }, "Failed to deserialize room from Redis");
        }
      }

      logger.info({ loaded, total: keys.length }, "Loaded rooms from Redis");
      return loaded;
    } catch (err) {
      logger.error({ err }, "Failed to load rooms from Redis");
      return 0;
    }
  }

  /** Flush all in-memory rooms to Redis and disconnect. */
  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Persist all rooms
    const promises: Promise<void>[] = [];
    for (const code of this.rooms.keys()) {
      promises.push(this.persistAsync(code));
    }
    await Promise.allSettled(promises);

    try {
      await this.redis.quit();
    } catch {
      // Already disconnected
    }
  }
}
