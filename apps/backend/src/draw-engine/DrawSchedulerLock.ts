/**
 * DrawSchedulerLock — room-level mutual exclusion with timeout safety.
 *
 * Replaces the bare `Set<string>` lock that had no timeout. If a lock holder
 * hangs (unresolved promise, adapter timeout, etc.), the lock is automatically
 * released after `defaultTimeoutMs` so subsequent scheduler ticks can proceed.
 *
 * Design decisions:
 * - In-process only (single Node instance). For multi-instance, swap the
 *   backing store for a Redis/Postgres advisory lock.
 * - Fail-fast: if a lock is already held (and not timed out), the caller
 *   gets `null` back immediately — it should skip that room this tick.
 * - Force-release on timeout is logged as a warning so ops can investigate.
 */

export interface DrawSchedulerLockEntry {
  acquiredAt: number;
}

export interface DrawSchedulerLockConfig {
  /** Maximum time a lock may be held before forced release (ms). Default 5000. */
  defaultTimeoutMs?: number;
  /** Injectable clock for testing. */
  now?: () => number;
  /** Called when a lock is force-released due to timeout. */
  onTimeout?: (roomCode: string, elapsedMs: number) => void;
}

export class DrawSchedulerLock {
  private readonly locks = new Map<string, DrawSchedulerLockEntry>();
  private readonly defaultTimeoutMs: number;
  private readonly now: () => number;
  private readonly onTimeout: (roomCode: string, elapsedMs: number) => void;

  /** Cumulative counters — useful for health/metrics. */
  private _acquireCount = 0;
  private _timeoutCount = 0;

  constructor(config: DrawSchedulerLockConfig = {}) {
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 5_000;
    this.now = config.now ?? (() => Date.now());
    this.onTimeout = config.onTimeout ?? (() => {});
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Execute `work` under the room lock. Returns the result of `work`, or
   * `null` if the lock could not be acquired (room already locked and not
   * timed out).
   */
  async withLock<T>(
    roomCode: string,
    work: () => Promise<T>,
    timeoutMs?: number,
  ): Promise<T | null> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    if (!this.tryAcquire(roomCode, timeout)) {
      return null;
    }

    try {
      return await work();
    } finally {
      this.release(roomCode);
    }
  }

  /**
   * Try to acquire the lock for `roomCode`. Returns `true` if acquired.
   * If the lock is already held but has exceeded `timeoutMs`, it is
   * force-released and re-acquired.
   */
  tryAcquire(roomCode: string, timeoutMs?: number): boolean {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    const nowMs = this.now();

    const existing = this.locks.get(roomCode);
    if (existing) {
      const elapsed = nowMs - existing.acquiredAt;
      if (elapsed < timeout) {
        // Lock is still valid — caller should skip this room.
        return false;
      }
      // Timeout exceeded — force-release and re-acquire.
      this._timeoutCount++;
      this.onTimeout(roomCode, elapsed);
      this.locks.delete(roomCode);
    }

    this.locks.set(roomCode, { acquiredAt: nowMs });
    this._acquireCount++;
    return true;
  }

  /** Release the lock for `roomCode`. Safe to call even if not held. */
  release(roomCode: string): void {
    this.locks.delete(roomCode);
  }

  /** Force-release all locks (e.g. on graceful shutdown). */
  releaseAll(): void {
    this.locks.clear();
  }

  /** Check whether `roomCode` is currently locked. */
  isLocked(roomCode: string): boolean {
    return this.locks.has(roomCode);
  }

  /** Remove locks for rooms that no longer exist. */
  cleanup(activeRoomCodes: Set<string>): void {
    for (const roomCode of this.locks.keys()) {
      if (!activeRoomCodes.has(roomCode)) {
        this.locks.delete(roomCode);
      }
    }
  }

  // ── Metrics ─────────────────────────────────────────────────

  get acquireCount(): number {
    return this._acquireCount;
  }

  get timeoutCount(): number {
    return this._timeoutCount;
  }

  get heldLockCount(): number {
    return this.locks.size;
  }
}
