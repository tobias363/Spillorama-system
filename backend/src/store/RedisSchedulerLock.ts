/**
 * BIN-171: Redis-backed distributed scheduler lock.
 *
 * Replaces the in-memory DrawSchedulerLock for multi-instance deployments.
 * Uses Redis SET NX EX pattern (single-instance Redlock variant).
 *
 * Same interface as DrawSchedulerLock: withLock(), tryAcquire(), release().
 */

import { Redis } from "ioredis";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "redis-lock" });

export interface RedisSchedulerLockOptions {
  /** Redis connection URL (default: redis://localhost:6379) */
  url?: string;
  /** Lock key prefix (default: bingo:lock:) */
  keyPrefix?: string;
  /** Default lock timeout in ms (default: 5000) */
  defaultTimeoutMs?: number;
  /** Instance ID for lock ownership (default: random UUID) */
  instanceId?: string;
}

export class RedisSchedulerLock {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly defaultTimeoutMs: number;
  private readonly instanceId: string;

  // Metrics
  private _acquireCount = 0;
  private _timeoutCount = 0;

  constructor(options?: RedisSchedulerLockOptions) {
    this.redis = new Redis(options?.url ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: false
    });
    this.keyPrefix = options?.keyPrefix ?? "bingo:lock:";
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 5000;
    this.instanceId = options?.instanceId ?? `instance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.redis.on("error", (err: Error) => {
      logger.error({ err }, "Redis lock connection error");
    });
  }

  private lockKey(roomCode: string): string {
    return `${this.keyPrefix}${roomCode}`;
  }

  /**
   * Try to acquire a lock for a room.
   * Returns true if acquired, false if already held by another instance.
   */
  async tryAcquire(roomCode: string, timeoutMs?: number): Promise<boolean> {
    const ttlMs = timeoutMs ?? this.defaultTimeoutMs;
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    const key = this.lockKey(roomCode);

    const result = await this.redis.set(key, this.instanceId, "EX", ttlSeconds, "NX");
    if (result === "OK") {
      this._acquireCount++;
      return true;
    }
    return false;
  }

  /** Release a lock (only if we own it). */
  async release(roomCode: string): Promise<void> {
    const key = this.lockKey(roomCode);
    // Lua script: only delete if the value matches our instance ID
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, key, this.instanceId);
  }

  /**
   * Execute work under a distributed lock.
   * Returns null if lock could not be acquired (another instance holds it).
   */
  async withLock<T>(roomCode: string, work: () => Promise<T>, timeoutMs?: number): Promise<T | null> {
    const acquired = await this.tryAcquire(roomCode, timeoutMs);
    if (!acquired) return null;

    try {
      return await work();
    } finally {
      await this.release(roomCode);
    }
  }

  /** Check if a room is locked (by any instance). */
  async isLocked(roomCode: string): Promise<boolean> {
    const value = await this.redis.get(this.lockKey(roomCode));
    return value !== null;
  }

  /** Release all locks held by this instance. */
  async releaseAll(): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    if (keys.length === 0) return;

    const pipeline = this.redis.pipeline();
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    for (const key of keys) {
      pipeline.eval(script, 1, key, this.instanceId);
    }
    await pipeline.exec();
  }

  /** Remove stale locks for rooms that no longer exist. */
  async cleanup(activeRoomCodes: Set<string>): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    for (const key of keys) {
      const roomCode = key.slice(this.keyPrefix.length);
      if (!activeRoomCodes.has(roomCode)) {
        await this.redis.del(key);
      }
    }
  }

  /** Metrics for health endpoint. */
  get heldLockCount(): number {
    // Can't know synchronously — return 0 (use isLocked for specific rooms)
    return 0;
  }

  get acquireCount(): number { return this._acquireCount; }
  get timeoutCount(): number { return this._timeoutCount; }

  async shutdown(): Promise<void> {
    await this.releaseAll();
    try {
      await this.redis.quit();
    } catch {
      // Already disconnected
    }
  }
}
