/**
 * DrawScheduler — orchestrates the auto-start/auto-draw tick loop.
 *
 * Extracted from index.ts to make the scheduler testable and to
 * consolidate timing, locking, error handling and watchdog in one place.
 *
 * The scheduler does NOT own business logic (starting games, drawing numbers).
 * Those are injected via callbacks so the caller retains control over engine,
 * IO, armed players, display tickets, etc.
 */

import { DrawSchedulerLock } from "./DrawSchedulerLock.js";
import { DrawWatchdog, type WatchdogRoomState } from "./DrawWatchdog.js";
import { classifyDrawError, DrawErrorTracker } from "./DrawErrorClassifier.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "scheduler" });

// ── Types ─────────────────────────────────────────────────────

export interface SchedulerSettings {
  autoRoundStartEnabled: boolean;
  autoRoundStartIntervalMs: number;
  autoRoundMinPlayers: number;
  autoDrawEnabled: boolean;
  autoDrawIntervalMs: number;
}

export interface RoomSummary {
  code: string;
  hallId: string;
  hostPlayerId: string;
  playerCount: number;
  createdAt: string;
  gameStatus: string;
}

export interface DrawSchedulerConfig {
  /** Scheduler tick interval (ms). Default 250. */
  tickIntervalMs?: number;
  /** Lock timeout (ms). Default 5000. */
  lockTimeoutMs?: number;
  /** Watchdog check interval (ms). Default 5000. */
  watchdogIntervalMs?: number;
  /** Watchdog stuck threshold multiplier. Default 3. */
  watchdogStuckMultiplier?: number;
  /** Fixed draw interval for watchdog (ms). Default 2000. */
  fixedDrawIntervalMs?: number;
  /** Whether to enforce single room per hall. */
  enforceSingleRoomPerHall?: boolean;
  /** Called during graceful shutdown to notify rooms. */
  onShutdown?: (activeRoomCodes: string[]) => Promise<void>;
  /** Called when a room exceeds max consecutive stuck detections (default 3). */
  onRoomExhausted?: (roomCode: string, consecutiveCount: number) => void;
  /**
   * Called when the scheduler re-schedules `nextStartAt` without otherwise emitting
   * a `room:update` (e.g. not enough players at T=0, or when a round ends).
   * Used to keep clients' countdowns in sync without requiring a refresh.
   */
  onRoomRescheduled?: (roomCode: string) => Promise<void> | void;

  // ── Injected dependencies ─────────────────────────────────

  /** Returns current scheduler settings (may change at runtime). */
  getSettings: () => SchedulerSettings;
  /** Returns all room summaries for the scheduler to iterate over. */
  listRoomSummaries: () => RoomSummary[];
  /** Returns a room snapshot (for double-checking inside lock). */
  getRoomSnapshot: (roomCode: string) => { currentGame?: { status: string }; hostPlayerId: string; players: Array<{ walletId: string }> };
  /** Returns all room codes (for settings sync). */
  getAllRoomCodes: () => string[];

  /**
   * Called inside the lock when it's time to start a new round.
   * Should call engine.startGame, disarm players, clear ticket cache, emit room:update, draw first ball.
   * Throw to signal failure — the scheduler handles classification.
   */
  onAutoStart: (
    roomCode: string,
    hostPlayerId: string
  ) => Promise<{
    /**
     * Timestamp (epoch ms) when the first draw was emitted.
     * Used to anchor the cadence so draw #2 happens exactly intervalMs after draw #1.
     * Return null if no draw was emitted (e.g. autoDraw disabled or round ended immediately).
     */
    firstDrawAtMs: number | null;
  }>;
  /**
   * Called inside the lock when it's time to draw the next number.
   * Should call engine.drawNextNumber, emit draw:new, emit room:update.
   * Throw to signal failure.
   */
  onAutoDraw: (roomCode: string, hostPlayerId: string) => Promise<{ roundEnded: boolean }>;

  /**
   * Called before each tick to apply pending settings changes.
   * Return true if settings were applied (summaries may have changed).
   */
  applyPendingSettings?: (nowMs: number, summaries: RoomSummary[]) => Promise<boolean>;
}

// ── Implementation ────────────────────────────────────────────

export class DrawScheduler {
  // ── Timing state ──────────────────────────────────────────
  readonly nextAutoStartAtByRoom = new Map<string, number>();
  readonly lastAutoDrawAtByRoom = new Map<string, number>();
  /**
   * Absolute-time anchor for drift-free draw pacing.
   * `anchor` is the timestamp of the last draw when `count === 0`.
   * `count` tracks how many draws have been executed since the anchor was set.
   * The next draw is due at: anchor + (count + 1) * intervalMs.
   */
  readonly drawAnchorByRoom = new Map<string, { anchor: number; count: number }>();

  // ── Modules ───────────────────────────────────────────────
  readonly lock: DrawSchedulerLock;
  readonly watchdog: DrawWatchdog;
  readonly errorTracker: DrawErrorTracker;

  // ── Config ────────────────────────────────────────────────
  private readonly tickIntervalMs: number;
  private readonly enforceSingleRoomPerHall: boolean;
  private readonly config: DrawSchedulerConfig;

  // ── Runtime ───────────────────────────────────────────────
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickInProgress = false;
  private _tickCount = 0;

  constructor(config: DrawSchedulerConfig) {
    this.config = config;
    this.tickIntervalMs = config.tickIntervalMs ?? 250;
    this.enforceSingleRoomPerHall = config.enforceSingleRoomPerHall ?? false;

    this.lock = new DrawSchedulerLock({
      defaultTimeoutMs: config.lockTimeoutMs ?? 5_000,
      onTimeout: (roomCode, elapsedMs) => {
        logger.error({ roomCode, elapsedMs }, "Lock timeout — forcing release");
      },
    });

    this.errorTracker = new DrawErrorTracker();

    this.watchdog = new DrawWatchdog({
      checkIntervalMs: config.watchdogIntervalMs ?? 5_000,
      drawIntervalMs: config.fixedDrawIntervalMs ?? 2_000,
      stuckThresholdMultiplier: config.watchdogStuckMultiplier ?? 3,
      schedulerLock: this.lock,
      getRoomStates: () => this.getWatchdogRoomStates(),
      onStuckRoom: (roomCode, elapsedMs) => {
        logger.error({ roomCode, elapsedMs }, "Room stuck — no draw");
      },
      onRoomExhausted: config.onRoomExhausted,
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      this.tick().catch((error) => {
        logger.error({ err: error }, "Unexpected tick error");
      });
    }, this.tickIntervalMs);
    this.tickTimer.unref();
    this.watchdog.start();
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.watchdog.stop();
  }

  /**
   * Graceful shutdown: stop the tick loop, notify active rooms, release all locks.
   * Unlike stop(), this signals to clients that a restart is happening.
   */
  async gracefulStop(): Promise<void> {
    // 1. Stop the tick loop immediately — no more new work.
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    // 2. Wait for any in-progress tick to finish (poll briefly).
    const deadline = Date.now() + 5_000;
    while (this.tickInProgress && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // 3. Notify active rooms (so clients can show "server restarting").
    if (this.config.onShutdown) {
      const activeRooms = this.config.listRoomSummaries()
        .filter((s) => s.gameStatus === "RUNNING")
        .map((s) => s.code);
      try {
        await this.config.onShutdown(activeRooms);
      } catch (error) {
        logger.error({ err: error }, "Error during shutdown notification");
      }
    }

    // 4. Release all locks and stop watchdog.
    this.lock.releaseAll();
    this.watchdog.stop();

    console.info("[DrawScheduler] Graceful shutdown complete.");
  }

  get isRunning(): boolean {
    return this.tickTimer !== null;
  }

  // ── Core tick ─────────────────────────────────────────────

  /** Run a single scheduler tick. Exposed for testing. */
  async tick(): Promise<void> {
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    this._tickCount++;

    try {
      const now = Date.now();
      let summaries = this.config.listRoomSummaries();

      if (this.config.applyPendingSettings) {
        const applied = await this.config.applyPendingSettings(now, summaries);
        if (applied) {
          summaries = this.config.listRoomSummaries();
        }
      }

      const schedulerSummaries = this.selectSchedulerRooms(summaries);
      // Cleanup runs every 40 ticks (~10s at 250ms) since room changes are infrequent.
      if (this._tickCount % 40 === 0) {
        this.cleanup(new Set(schedulerSummaries.map((s) => s.code)));
      }

      for (const summary of schedulerSummaries) {
        try {
          await this.processAutoStart(summary, now);
          await this.processAutoDraw(summary, now);
        } catch (error) {
          const classification = classifyDrawError(error);
          this.errorTracker.record(summary.code, classification);
          const logLevel = classification.logLevel === "error" ? "error"
            : classification.logLevel === "warn" ? "warn"
            : "info";
          logger[logLevel]({ roomCode: summary.code, category: classification.category }, classification.reason);
        }
      }
    } finally {
      this.tickInProgress = false;
    }
  }

  // ── processAutoStart ──────────────────────────────────────

  private async processAutoStart(summary: RoomSummary, now: number): Promise<void> {
    const roomCode = summary.code;
    const settings = this.config.getSettings();

    if (!settings.autoRoundStartEnabled) {
      this.nextAutoStartAtByRoom.delete(roomCode);
      return;
    }

    const scheduledStartAt = this.normalizeNextAutoStartAt(roomCode, now);

    if (summary.gameStatus === "RUNNING") {
      if (scheduledStartAt <= now) {
        this.setNextRoundForRoom(roomCode, now);
      }
      return;
    }

    if (summary.playerCount < settings.autoRoundMinPlayers) {
      if (scheduledStartAt <= now) {
        this.setNextRoundForRoom(roomCode, now);
        await this.config.onRoomRescheduled?.(roomCode);
      }
      return;
    }

    if (now < scheduledStartAt) {
      return;
    }

    await this.lock.withLock(roomCode, async () => {
      const snapshot = this.config.getRoomSnapshot(roomCode);
      if (snapshot.currentGame?.status === "RUNNING") {
        this.setNextRoundForRoom(roomCode, Date.now());
        await this.config.onRoomRescheduled?.(roomCode);
        return;
      }
      if (snapshot.players.length < settings.autoRoundMinPlayers) {
        this.setNextRoundForRoom(roomCode, Date.now());
        await this.config.onRoomRescheduled?.(roomCode);
        return;
      }

      // Delegate the actual game start + optional immediate first draw to the caller.
      const { firstDrawAtMs } = await this.config.onAutoStart(roomCode, snapshot.hostPlayerId);

      const startNow = Date.now();
      this.setNextRoundForRoom(roomCode, startNow);

      const anchor =
        typeof firstDrawAtMs === "number" && Number.isFinite(firstDrawAtMs) && firstDrawAtMs > 0
          ? Math.min(firstDrawAtMs, startNow)
          : startNow;

      // Anchor-based timing expects `anchor` to represent the timestamp of the most recent draw
      // when `count === 0`, so draw #2 happens at `anchor + intervalMs`.
      this.drawAnchorByRoom.set(roomCode, { anchor, count: 0 });
      // Keep lastAutoDrawAtByRoom in sync for watchdog compatibility.
      this.lastAutoDrawAtByRoom.set(roomCode, anchor);
    });
  }

  // ── processAutoDraw ───────────────────────────────────────

  private async processAutoDraw(summary: RoomSummary, now: number): Promise<void> {
    const roomCode = summary.code;
    const settings = this.config.getSettings();

    if (!settings.autoDrawEnabled || summary.gameStatus !== "RUNNING") {
      return;
    }

    const anchorState = this.drawAnchorByRoom.get(roomCode);

    if (anchorState) {
      // ── Anchor-based (drift-free) timing ───────────────────
      const nextDrawAt = anchorState.anchor + (anchorState.count + 1) * settings.autoDrawIntervalMs;
      if (now < nextDrawAt) {
        return;
      }

      // If we've missed multiple intervals (e.g. long GC pause), don't try
      // to "catch up" with a burst of draws — just draw once and re-anchor.
      const missedIntervals = Math.floor((now - nextDrawAt) / settings.autoDrawIntervalMs);
      const needsReanchor = missedIntervals >= 2;

      await this.lock.withLock(roomCode, async () => {
        const snapshot = this.config.getRoomSnapshot(roomCode);
        if (snapshot.currentGame?.status !== "RUNNING") {
          this.lastAutoDrawAtByRoom.delete(roomCode);
          this.drawAnchorByRoom.delete(roomCode);
          return;
        }

        // Re-check timing inside the lock using the anchor (not Date.now())
        // to keep the draw grid perfectly aligned.
        const lockNow = Date.now();
        const recheckedNextDrawAt = anchorState.anchor + (anchorState.count + 1) * settings.autoDrawIntervalMs;
        if (lockNow < recheckedNextDrawAt) {
          return;
        }

        const { roundEnded } = await this.config.onAutoDraw(roomCode, snapshot.hostPlayerId);

        const afterDrawNow = Date.now();
        // Keep lastAutoDrawAtByRoom in sync for watchdog compatibility.
        this.lastAutoDrawAtByRoom.set(roomCode, afterDrawNow);

        if (needsReanchor) {
          const missedCount = missedIntervals;
          const expectedAt = new Date(nextDrawAt).toISOString();
          const actualAt = new Date(afterDrawNow).toISOString();
          logger.warn({
            roomCode,
            missedIntervals: missedCount,
            expectedAt,
            actualAt,
            deltaMs: afterDrawNow - nextDrawAt
          }, "Re-anchoring draw schedule");
          this.drawAnchorByRoom.set(roomCode, { anchor: afterDrawNow, count: 0 });
        } else {
          anchorState.count++;
        }

        if (roundEnded) {
          this.setNextRoundForRoom(roomCode, afterDrawNow);
          await this.config.onRoomRescheduled?.(roomCode);
        }
      });
    } else {
      // ── Fallback: relative timing (backward compat) ────────
      // No anchor exists — room may have been RUNNING before the upgrade.
      const lastDrawAt = this.lastAutoDrawAtByRoom.get(roomCode) ?? 0;
      if (now - lastDrawAt < settings.autoDrawIntervalMs) {
        return;
      }

      await this.lock.withLock(roomCode, async () => {
        const snapshot = this.config.getRoomSnapshot(roomCode);
        if (snapshot.currentGame?.status !== "RUNNING") {
          this.lastAutoDrawAtByRoom.delete(roomCode);
          return;
        }

        const refreshedLastDrawAt = this.lastAutoDrawAtByRoom.get(roomCode) ?? 0;
        const currentNow = Date.now();
        if (currentNow - refreshedLastDrawAt < settings.autoDrawIntervalMs) {
          return;
        }

        const { roundEnded } = await this.config.onAutoDraw(roomCode, snapshot.hostPlayerId);

        this.lastAutoDrawAtByRoom.set(roomCode, currentNow);
        // Establish anchor now that we've drawn, so future draws use anchor-based timing.
        this.drawAnchorByRoom.set(roomCode, { anchor: currentNow, count: 0 });

        if (roundEnded) {
          this.setNextRoundForRoom(roomCode, Date.now());
          await this.config.onRoomRescheduled?.(roomCode);
        }
      });
    }
  }

  // ── Timing helpers ────────────────────────────────────────

  setNextRoundForRoom(roomCode: string, nowMs: number): number {
    const settings = this.config.getSettings();
    const nextStartAt = nowMs + settings.autoRoundStartIntervalMs;
    this.nextAutoStartAtByRoom.set(roomCode, nextStartAt);
    return nextStartAt;
  }

  normalizeNextAutoStartAt(roomCode: string, nowMs: number): number {
    const settings = this.config.getSettings();

    if (!settings.autoRoundStartEnabled) {
      this.nextAutoStartAtByRoom.delete(roomCode);
      return nowMs;
    }

    const fallback = Math.ceil(nowMs / settings.autoRoundStartIntervalMs) * settings.autoRoundStartIntervalMs;
    const staleToleranceMs = Math.max(1500, this.tickIntervalMs * 4);
    const existing = this.nextAutoStartAtByRoom.get(roomCode);

    if (existing === undefined || !Number.isFinite(existing)) {
      this.nextAutoStartAtByRoom.set(roomCode, fallback);
      return fallback;
    }
    if (existing < nowMs - staleToleranceMs) {
      this.nextAutoStartAtByRoom.set(roomCode, fallback);
      return fallback;
    }

    return existing;
  }

  // ── Settings sync ─────────────────────────────────────────

  /** Call after runtime settings change to re-sync timing state. */
  syncAfterSettingsChange(previous: SchedulerSettings): void {
    const current = this.config.getSettings();
    const autoStartToggled = previous.autoRoundStartEnabled !== current.autoRoundStartEnabled;
    const roundIntervalChanged = previous.autoRoundStartIntervalMs !== current.autoRoundStartIntervalMs;
    const autoDrawToggled = previous.autoDrawEnabled !== current.autoDrawEnabled;

    if (!current.autoRoundStartEnabled) {
      this.nextAutoStartAtByRoom.clear();
    }
    if (!current.autoDrawEnabled) {
      this.lastAutoDrawAtByRoom.clear();
      this.drawAnchorByRoom.clear();
    }
    if (current.autoRoundStartEnabled && (autoStartToggled || roundIntervalChanged)) {
      const nowMs = Date.now();
      for (const roomCode of this.config.getAllRoomCodes()) {
        this.setNextRoundForRoom(roomCode, nowMs);
      }
    }
    if (autoDrawToggled && current.autoDrawEnabled) {
      this.lastAutoDrawAtByRoom.clear();
      this.drawAnchorByRoom.clear();
    }
  }

  // ── Cleanup ───────────────────────────────────────────────

  cleanup(activeRoomCodes: Set<string>): void {
    for (const code of this.nextAutoStartAtByRoom.keys()) {
      if (!activeRoomCodes.has(code)) this.nextAutoStartAtByRoom.delete(code);
    }
    for (const code of this.lastAutoDrawAtByRoom.keys()) {
      if (!activeRoomCodes.has(code)) this.lastAutoDrawAtByRoom.delete(code);
    }
    for (const code of this.drawAnchorByRoom.keys()) {
      if (!activeRoomCodes.has(code)) this.drawAnchorByRoom.delete(code);
    }
    this.lock.cleanup(activeRoomCodes);
    this.errorTracker.cleanup(activeRoomCodes);
  }

  releaseRoom(roomCode: string): void {
    this.lock.release(roomCode);
    this.nextAutoStartAtByRoom.delete(roomCode);
    this.lastAutoDrawAtByRoom.delete(roomCode);
    this.drawAnchorByRoom.delete(roomCode);
  }

  // ── Room selection ────────────────────────────────────────

  private selectSchedulerRooms(summaries: RoomSummary[]): RoomSummary[] {
    if (!this.enforceSingleRoomPerHall) {
      return summaries;
    }
    const canonicalByHall = new Map<string, RoomSummary>();
    for (const s of summaries) {
      const existing = canonicalByHall.get(s.hallId);
      if (!existing || this.comparePriority(s, existing) < 0) {
        canonicalByHall.set(s.hallId, s);
      }
    }
    return [...canonicalByHall.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  private comparePriority(a: RoomSummary, b: RoomSummary): number {
    const runA = a.gameStatus === "RUNNING" ? 1 : 0;
    const runB = b.gameStatus === "RUNNING" ? 1 : 0;
    if (runA !== runB) return runB - runA;
    if (a.playerCount !== b.playerCount) return b.playerCount - a.playerCount;
    const createdA = Date.parse(a.createdAt);
    const createdB = Date.parse(b.createdAt);
    const normA = Number.isFinite(createdA) ? createdA : Number.MAX_SAFE_INTEGER;
    const normB = Number.isFinite(createdB) ? createdB : Number.MAX_SAFE_INTEGER;
    if (normA !== normB) return normA - normB;
    return a.code.localeCompare(b.code);
  }

  // ── Watchdog data ─────────────────────────────────────────

  private getWatchdogRoomStates(): WatchdogRoomState[] {
    const summaries = this.config.listRoomSummaries();
    return summaries.map((s) => ({
      roomCode: s.code,
      gameStatus: s.gameStatus === "NONE" ? "WAITING" : s.gameStatus,
      lastDrawAt: this.lastAutoDrawAtByRoom.get(s.code),
    }));
  }

  // ── Metrics ───────────────────────────────────────────────

  get tickCount(): number {
    return this._tickCount;
  }

  /** Health-endpoint summary (no sensitive data). */
  healthSummary(detailed?: boolean): Record<string, unknown> {
    const wm = this.watchdog.metrics;
    const base: Record<string, unknown> = {
      drawWatchdog: {
        stuckRooms: wm.currentStuckRoomCodes.length,
        stuckRoomCodes: wm.currentStuckRoomCodes,
        lastCheckAt: wm.lastCheckAt ? new Date(wm.lastCheckAt).toISOString() : null,
        totalDetections: wm.stuckDetectionCount,
      },
      schedulerLock: {
        heldLocks: this.lock.heldLockCount,
        timeoutCount: this.lock.timeoutCount,
      },
      drawErrors: this.errorTracker.toJSON(),
      tickCount: this._tickCount,
    };

    if (!detailed) return base;

    // Collect all tracked room codes (union of timing maps).
    const trackedRoomCodes = new Set<string>([
      ...this.nextAutoStartAtByRoom.keys(),
      ...this.lastAutoDrawAtByRoom.keys(),
    ]);

    const rooms: Array<{
      roomCode: string;
      lastDrawAt: string | null;
      nextAutoStartAt: string | null;
      isLocked: boolean;
    }> = [];

    for (const roomCode of trackedRoomCodes) {
      const lastDraw = this.lastAutoDrawAtByRoom.get(roomCode);
      const nextStart = this.nextAutoStartAtByRoom.get(roomCode);
      rooms.push({
        roomCode,
        lastDrawAt: lastDraw ? new Date(lastDraw).toISOString() : null,
        nextAutoStartAt: nextStart ? new Date(nextStart).toISOString() : null,
        isLocked: this.lock.isLocked(roomCode),
      });
    }

    return {
      ...base,
      activeRooms: rooms.length,
      rooms,
    };
  }
}
