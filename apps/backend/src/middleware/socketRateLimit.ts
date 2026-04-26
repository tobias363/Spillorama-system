/**
 * BIN-164: Per-socket, per-event sliding-window rate limiter for Socket.IO.
 *
 * Prevents abuse by throttling events per socket. Each event type can have
 * its own limit. Disconnected sockets are cleaned up to prevent memory leaks.
 */

export interface RateLimitConfig {
  /** Window duration in milliseconds */
  windowMs: number;
  /** Maximum events allowed within the window */
  maxEvents: number;
}

/** Default per-event rate limits */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  "room:create":         { windowMs: 60_000, maxEvents: 3 },
  "room:join":           { windowMs: 30_000, maxEvents: 5 },
  "room:resume":         { windowMs: 10_000, maxEvents: 10 },
  "room:configure":      { windowMs: 10_000, maxEvents: 5 },
  "game:start":          { windowMs: 30_000, maxEvents: 3 },
  "game:end":            { windowMs: 30_000, maxEvents: 3 },
  "draw:next":           { windowMs: 2_000,  maxEvents: 5 },
  "draw:extra:purchase": { windowMs: 5_000,  maxEvents: 3 },
  "ticket:mark":         { windowMs: 1_000,  maxEvents: 10 },
  // BIN-509: wallet-mutating pre-round action — stricter than draws so an
  // abusive client can't drain a balance or spam the ledger.
  "ticket:replace":      { windowMs: 5_000,  maxEvents: 5 },
  "claim:submit":        { windowMs: 5_000,  maxEvents: 5 },
  "room:state":          { windowMs: 5_000,  maxEvents: 10 },
  "bet:arm":             { windowMs: 5_000,  maxEvents: 10 },
  // Bølge D Issue 1 (HØY): mini-games har wallet-impact (handleChoice
  // trigger prize-payout). Spam-events kan trigge race mot pending-payout.
  // 5/s matcher menneskelig knappetrykk-rate; 2/s er nok for join (idempotent
  // men auth-tunge — DB-oppslag mot getUserFromAccessToken).
  "mini_game:choice":    { windowMs: 1_000,  maxEvents: 5 },
  "mini_game:join":      { windowMs: 1_000,  maxEvents: 2 },
  // Bølge D Issue 2 (MEDIUM): admin-namespace rate-limits. Admin-actions er
  // sjeldne — 10/s totalt per admin-socket holder (matcher konservativ
  // pilot-policy fra code-reviewer). Gjelder admin-namespace + admin-display
  // + admin-game1 events. Når en admin-bug eller misbruks-account spammer
  // events skal vi avvise med RATE_LIMITED i stedet for å flomme io.to(...).
  "admin:room-ready":      { windowMs: 1_000, maxEvents: 10 },
  "admin:pause-game":      { windowMs: 1_000, maxEvents: 10 },
  "admin:resume-game":     { windowMs: 1_000, maxEvents: 10 },
  "admin:force-end":       { windowMs: 1_000, maxEvents: 10 },
  "admin:hall-balance":    { windowMs: 1_000, maxEvents: 10 },
  "admin:login":           { windowMs: 1_000, maxEvents: 10 },
  "admin-display:login":     { windowMs: 1_000, maxEvents: 10 },
  "admin-display:subscribe": { windowMs: 1_000, maxEvents: 10 },
  "admin-display:state":     { windowMs: 1_000, maxEvents: 10 },
  "admin-display:screensaver": { windowMs: 1_000, maxEvents: 10 },
  "game1:subscribe":       { windowMs: 1_000, maxEvents: 10 },
  "game1:unsubscribe":     { windowMs: 1_000, maxEvents: 10 },
};

const DEFAULT_FALLBACK: RateLimitConfig = { windowMs: 10_000, maxEvents: 20 };
const GC_INTERVAL_MS = 60_000;

export class SocketRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly limits: Record<string, RateLimitConfig>;
  private readonly fallback: RateLimitConfig;
  private gcTimer: ReturnType<typeof setInterval> | null = null;
  private readonly activeSockets = new Set<string>();

  /**
   * HOEY-9: Player-based rate limiting.
   * Maps socketId → playerId so player-level limits survive reconnections.
   * Also tracks limits by `player:${playerId}:${event}` buckets.
   */
  private readonly socketToPlayer = new Map<string, string>();
  private readonly activePlayers = new Set<string>();

  /**
   * BIN-303: IP-based connection rate limiting.
   * Separate from socket/player buckets so GC doesn't delete active-window entries
   * when connections close. Keyed by IP address.
   */
  private readonly connectionBuckets = new Map<string, number[]>();
  private static readonly CONNECTION_RATE: RateLimitConfig = { windowMs: 60_000, maxEvents: 30 };

  constructor(limits?: Record<string, RateLimitConfig>, fallback?: RateLimitConfig) {
    this.limits = limits ?? DEFAULT_RATE_LIMITS;
    this.fallback = fallback ?? DEFAULT_FALLBACK;
  }

  /** Start periodic garbage collection of stale entries */
  start(): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS);
    if (this.gcTimer.unref) this.gcTimer.unref();
  }

  /** Stop periodic GC */
  stop(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  /**
   * HOEY-9: Associate a socket with a player ID.
   * Call this after authentication so player-level limits apply.
   */
  registerPlayer(socketId: string, playerId: string): void {
    this.socketToPlayer.set(socketId, playerId);
    this.activePlayers.add(playerId);
  }

  /**
   * Check whether an event from a socket is allowed.
   * Returns true if allowed, false if rate-limited.
   * Enforces both per-socket AND per-player limits (HOEY-9).
   */
  check(socketId: string, eventName: string, nowMs: number = Date.now()): boolean {
    this.activeSockets.add(socketId);
    const config = this.limits[eventName] ?? this.fallback;

    // Per-socket check
    if (!this.checkBucket(`${socketId}:${eventName}`, config, nowMs)) {
      return false;
    }

    // HOEY-9: Per-player check (survives reconnections)
    const playerId = this.socketToPlayer.get(socketId);
    if (playerId) {
      if (!this.checkBucket(`player:${playerId}:${eventName}`, config, nowMs)) {
        return false;
      }
    }

    return true;
  }

  /**
   * BIN-247: Check rate limit by an arbitrary key (e.g., walletId).
   * Used in addition to socket-based checks so reconnects don't reset counters.
   */
  checkByKey(key: string, eventName: string, nowMs: number = Date.now()): boolean {
    this.activeSockets.add(key);
    const bucketKey = `${key}:${eventName}`;
    const config = this.limits[eventName] ?? this.fallback;

    let timestamps = this.buckets.get(bucketKey);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(bucketKey, timestamps);
    }

    const cutoff = nowMs - config.windowMs;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= config.maxEvents) {
      return false;
    }

    timestamps.push(nowMs);
    return true;
  }

  /**
   * BIN-303: Check whether a new WebSocket connection from an IP is allowed.
   * Limits to 30 new connections per minute per IP to prevent connection-flood abuse.
   * Uses a separate bucket map so GC never removes active-window entries when
   * connections disconnect.
   */
  checkConnection(ip: string, nowMs: number = Date.now()): boolean {
    const config = SocketRateLimiter.CONNECTION_RATE;
    let timestamps = this.connectionBuckets.get(ip);
    if (!timestamps) {
      timestamps = [];
      this.connectionBuckets.set(ip, timestamps);
    }

    const cutoff = nowMs - config.windowMs;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= config.maxEvents) {
      return false;
    }

    timestamps.push(nowMs);
    return true;
  }

  private checkBucket(key: string, config: RateLimitConfig, nowMs: number): boolean {
    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }

    const cutoff = nowMs - config.windowMs;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= config.maxEvents) {
      return false;
    }

    timestamps.push(nowMs);
    return true;
  }

  /** Remove all tracking data for a disconnected socket */
  cleanup(socketId: string): void {
    this.activeSockets.delete(socketId);
    const prefix = `${socketId}:`;
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) {
        this.buckets.delete(key);
      }
    }
    // HOEY-9: Keep player-level buckets alive (they survive reconnections).
    // Only remove the socket→player mapping; player buckets expire via GC.
    this.socketToPlayer.delete(socketId);
  }

  /** Periodic GC: remove entries for sockets/players that are no longer active */
  private gc(): void {
    // Rebuild active player set from current socket→player mappings
    this.activePlayers.clear();
    for (const playerId of this.socketToPlayer.values()) {
      this.activePlayers.add(playerId);
    }

    for (const key of this.buckets.keys()) {
      if (key.startsWith("player:")) {
        // HOEY-9: Player bucket — GC if player has no active sockets
        const playerId = key.split(":")[1];
        if (!this.activePlayers.has(playerId)) {
          this.buckets.delete(key);
        }
      } else {
        const socketId = key.split(":")[0];
        if (!this.activeSockets.has(socketId)) {
          this.buckets.delete(key);
        }
      }
    }

    // BIN-303: Prune connection buckets by time (not by active sockets — connections
    // may have closed but we still need to track their rate window).
    const connCutoff = Date.now() - SocketRateLimiter.CONNECTION_RATE.windowMs;
    for (const [ip, timestamps] of this.connectionBuckets) {
      while (timestamps.length > 0 && timestamps[0] <= connCutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.connectionBuckets.delete(ip);
      }
    }
  }

  /** Visible for testing */
  get bucketCount(): number {
    return this.buckets.size;
  }

  get activeSocketCount(): number {
    return this.activeSockets.size;
  }
}
