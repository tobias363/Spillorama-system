/**
 * DrawWatchdog — monitors RUNNING rooms for stalled draws.
 *
 * Runs on its own interval (independent of the scheduler tick) and checks
 * whether each RUNNING room has drawn within a reasonable time window.
 * If a room exceeds the threshold, the watchdog logs a warning and can
 * optionally force-release the scheduler lock so the next tick can proceed.
 *
 * This catches failure modes that the scheduler itself cannot detect:
 * - Hung promises inside withRoomSchedulerLock
 * - Silent exceptions swallowed by adapters
 * - Unexpected gameStatus transitions that bypass processAutoDraw
 */

import type { DrawSchedulerLock } from "./DrawSchedulerLock.js";

// ── Types ─────────────────────────────────────────────────────

export interface WatchdogRoomState {
  roomCode: string;
  gameStatus: string;
  lastDrawAt: number | undefined;
}

export interface DrawWatchdogConfig {
  /** How often the watchdog checks (ms). Default 5000. */
  checkIntervalMs?: number;
  /**
   * Multiplier applied to `drawIntervalMs` to determine the stuck threshold.
   * Default 3 (i.e. 3 × 2000ms = 6s).
   */
  stuckThresholdMultiplier?: number;
  /** The normal draw interval (ms). Default 2000. */
  drawIntervalMs?: number;
  /** Injectable clock for testing. */
  now?: () => number;
  /** Callback when a stuck room is detected. */
  onStuckRoom?: (roomCode: string, timeSinceLastDrawMs: number) => void;
  /**
   * Provides the current list of RUNNING rooms with their last draw timestamps.
   * Called once per watchdog tick.
   */
  getRoomStates: () => WatchdogRoomState[];
  /** Optional: scheduler lock to force-release stuck rooms. */
  schedulerLock?: DrawSchedulerLock;
  /** Max consecutive stuck detections before escalation. Default 3. */
  maxConsecutiveStuck?: number;
  /** Called when a room exceeds max consecutive stuck detections. */
  onRoomExhausted?: (roomCode: string, consecutiveCount: number) => void;
}

export interface WatchdogMetrics {
  lastCheckAt: number;
  checkCount: number;
  stuckDetectionCount: number;
  currentStuckRoomCodes: string[];
}

// ── Implementation ────────────────────────────────────────────

export class DrawWatchdog {
  private readonly checkIntervalMs: number;
  private readonly stuckThresholdMs: number;
  private readonly now: () => number;
  private readonly onStuckRoom: (roomCode: string, timeSinceLastDrawMs: number) => void;
  private readonly getRoomStates: () => WatchdogRoomState[];
  private readonly schedulerLock: DrawSchedulerLock | undefined;
  private readonly maxConsecutiveStuck: number;
  private readonly onRoomExhausted: (roomCode: string, consecutiveCount: number) => void;
  private readonly consecutiveStuckCount = new Map<string, number>();

  private timer: ReturnType<typeof setInterval> | null = null;
  private _lastCheckAt = 0;
  private _checkCount = 0;
  private _stuckDetectionCount = 0;
  private _currentStuckRoomCodes: string[] = [];

  constructor(config: DrawWatchdogConfig) {
    this.checkIntervalMs = config.checkIntervalMs ?? 5_000;
    this.stuckThresholdMs =
      (config.drawIntervalMs ?? 2_000) * (config.stuckThresholdMultiplier ?? 3);
    this.now = config.now ?? (() => Date.now());
    this.onStuckRoom = config.onStuckRoom ?? (() => {});
    this.getRoomStates = config.getRoomStates;
    this.schedulerLock = config.schedulerLock;
    this.maxConsecutiveStuck = config.maxConsecutiveStuck ?? 3;
    this.onRoomExhausted = config.onRoomExhausted ?? (() => {});
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /** Start the watchdog loop. Safe to call multiple times (idempotent). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), this.checkIntervalMs);
    this.timer.unref(); // Don't prevent Node from exiting.
  }

  /** Stop the watchdog loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single check (also called by the interval). Exposed for testing. */
  check(): void {
    const nowMs = this.now();
    this._lastCheckAt = nowMs;
    this._checkCount++;

    const rooms = this.getRoomStates();
    const stuckCodes: string[] = [];

    for (const room of rooms) {
      if (room.gameStatus !== "RUNNING") {
        this.consecutiveStuckCount.delete(room.roomCode);
        continue;
      }
      if (room.lastDrawAt === undefined) {
        this.consecutiveStuckCount.delete(room.roomCode);
        continue;
      }

      const elapsed = nowMs - room.lastDrawAt;
      if (elapsed > this.stuckThresholdMs) {
        const prevCount = this.consecutiveStuckCount.get(room.roomCode) ?? 0;
        const newCount = prevCount + 1;
        this.consecutiveStuckCount.set(room.roomCode, newCount);

        stuckCodes.push(room.roomCode);
        this._stuckDetectionCount++;
        this.onStuckRoom(room.roomCode, elapsed);

        if (newCount >= this.maxConsecutiveStuck) {
          // Escalate: room has been stuck too many times.
          this.onRoomExhausted(room.roomCode, newCount);
          this.consecutiveStuckCount.delete(room.roomCode);
        } else if (this.schedulerLock?.isLocked(room.roomCode)) {
          // Normal recovery: release the lock.
          this.schedulerLock.release(room.roomCode);
        }
      } else {
        // Room is healthy — reset counter.
        this.consecutiveStuckCount.delete(room.roomCode);
      }
    }

    this._currentStuckRoomCodes = stuckCodes;
  }

  // ── Metrics ─────────────────────────────────────────────────

  get metrics(): WatchdogMetrics {
    return {
      lastCheckAt: this._lastCheckAt,
      checkCount: this._checkCount,
      stuckDetectionCount: this._stuckDetectionCount,
      currentStuckRoomCodes: [...this._currentStuckRoomCodes],
    };
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  get exhaustedRoomCount(): number {
    return [...this.consecutiveStuckCount.values()].filter(c => c >= this.maxConsecutiveStuck).length;
  }
}
