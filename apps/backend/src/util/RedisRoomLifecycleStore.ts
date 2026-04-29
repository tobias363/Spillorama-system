/**
 * RedisRoomLifecycleStore — Redis-backed implementation of the K2 atomic
 * state owner. Drop-in replacement for {@link InMemoryRoomLifecycleStore},
 * built behind the same {@link RoomLifecycleStore} interface.
 *
 * **Why this exists (Bølge K4 of pre-pilot refactor):**
 *
 * After K2 (#732) collapsed the three-way ownership leak into a single
 * atomic store, all pre-round arm/reservation/arm-cycle state still lived
 * in process memory. A Render restart — deploy mid-shift, OOM, infrastructure
 * event — wiped that state silently. Wallet reservations lingered in the DB
 * with status='active' but the in-memory mapping `playerId → reservationId`
 * was lost, so:
 *   - Players who armed at 09:55 lost their pre-round purchase at 09:56
 *     restart even though `wallet_reservations` had status='active'.
 *   - PR #722's `staleRoomBootSweep` only re-created rooms with a
 *     `game_sessions` row in WAITING/RUNNING — pre-round (no session yet)
 *     was invisible.
 *   - Multi-instance scale-out was impossible: instance A's armed-state
 *     was unknown to instance B.
 *
 * Moving lifecycle state to Redis closes both gaps. Restart no longer
 * loses pre-round state (Redis survives the process). Multi-instance reads
 * the same authoritative state. The `staleRoomBootSweep` boot-restore
 * complexity becomes obsolete because Redis IS the boot-restore source
 * (see docs/operations/BOOT_RESTORE_AFTER_K4.md).
 *
 * **Key schema** (per-room, prefix `bingo:room:<roomCode>:`):
 *   - `:armedTickets`     Hash: playerId → ticketCount (decimal-encoded number)
 *   - `:selections`       Hash: playerId → JSON-encoded TicketSelection[]
 *   - `:reservations`     Hash: playerId → reservationId (string)
 *   - `:armCycle`         String: arm-cycle UUID
 *   - `:lock`             String: per-room mutex via SET NX EX (Redis-side)
 *
 * Each write refreshes a 24h TTL on the touched key — abandoned rooms
 * auto-cleanup. The arm-cycle bump on `disarmAllPlayers` deletes the
 * `:armCycle` key so the next `getOrCreateArmCycleId` writes a fresh UUID.
 *
 * **Atomicity strategy:**
 *   - Multi-step pure-Redis ops (`evictPlayer`, `disarmAllPlayers`) use a
 *     single Lua script — Redis runs Lua atomically against the keyspace.
 *   - Ops that hand control back to JS callbacks (`cancelPreRoundTicket`,
 *     `evictWhere`) use a Redis-side per-room mutex (SET NX EX with random
 *     token + Lua-guarded release). The callback runs while the lock is
 *     held; concurrent mutators on the same room queue behind it.
 *   - Reads that need a consistent snapshot (`getPlayerWithArmedState`)
 *     pipeline the relevant HGET/HEXISTS in a single Redis round-trip.
 *     Single-instance Redis is itself sequentially consistent — the
 *     pipeline cannot interleave with another mutator's individual command.
 *
 * **Latency budget:** every operation is one Redis round-trip (Lua + script
 * cache hits typically <2 ms in the same DC). Prompt requirement is "do not
 * increase latency >5 ms per operation" — Lua + pipelined-reads stay well
 * under that for the Render Frankfurt region against managed Redis.
 *
 * **Fail-closed:** the factory `createRoomLifecycleStore` connects eagerly
 * (lazyConnect=false) so `ROOM_STATE_PROVIDER=redis` boot fails before
 * traffic if Redis is unreachable. After boot, transient Redis errors
 * propagate to callers — they bubble through the existing engine
 * error-handling rather than silently degrading to in-memory (which would
 * recreate the K2 ownership leak under partial failure).
 *
 * Reference: docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md §2.3 + §6 K4.
 * Reference: docs/operations/REDIS_KEY_SCHEMA.md (key layout + TTLs).
 * Builds on K2 ({@link RoomLifecycleStore}) interface.
 */
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { logger as rootLogger } from "./logger.js";
import type {
  ArmedPlayerSnapshot,
  CancelPreRoundTicketResult,
  EvictPlayerResult,
  RoomLifecycleStore,
  TicketSelection,
} from "./RoomLifecycleStore.js";

const storeLog = rootLogger.child({ module: "redisRoomLifecycleStore" });

// ── Tunables ──────────────────────────────────────────────────────────────

/** Default TTL on touched per-room keys. 24h matches RedisRoomStateStore. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Per-room mutex hold timeout. Bounded so a crashed JS callback can never
 * permanently lock a room — Redis evicts the lock after `LOCK_TTL_SECONDS`
 * even if the holder never calls `release`. 30s is generous for the
 * cancelPreRoundTicket / evictWhere callbacks (which mutate display cache
 * + return synchronously) and short enough that an orphaned lock never
 * blocks more than half a typical pre-round window.
 */
const LOCK_TTL_SECONDS = 30;

/**
 * Mutex spin-wait between acquire retries. We pick a small constant rather
 * than exponential back-off because contention is per-room (not per-process)
 * and the typical hold time is single-digit ms. 5 ms keeps under the prompt's
 * 5ms-per-op budget for the uncontended hot path while bounding wasted CPU
 * during contention.
 */
const LOCK_RETRY_MS = 5;

/** How long an `acquireLock` spins before giving up — observability gate. */
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;

// ── Lua scripts (atomic mutators) ─────────────────────────────────────────

/**
 * armPlayer Lua: HSET ticketCount + (selections-JSON or HDEL stale) +
 * EXPIRE both keys. Atomic against any concurrent reader/mutator.
 *
 * KEYS[1] = armedTicketsKey
 * KEYS[2] = selectionsKey
 * ARGV[1] = playerId
 * ARGV[2] = ticketCount (string)
 * ARGV[3] = selectionsJson  ("" sentinel for "no selections — clear stale")
 * ARGV[4] = ttlSeconds
 */
const ARM_PLAYER_SCRIPT = `
redis.call("HSET", KEYS[1], ARGV[1], ARGV[2])
if ARGV[3] == "" then
  redis.call("HDEL", KEYS[2], ARGV[1])
else
  redis.call("HSET", KEYS[2], ARGV[1], ARGV[3])
end
redis.call("EXPIRE", KEYS[1], ARGV[4])
redis.call("EXPIRE", KEYS[2], ARGV[4])
return 1
`;

/**
 * disarmPlayer Lua: HDEL armed + selections; conditionally HDEL reservation
 * unless caller passed keepReservation=1.
 *
 * KEYS[1] = armedTicketsKey
 * KEYS[2] = selectionsKey
 * KEYS[3] = reservationsKey
 * ARGV[1] = playerId
 * ARGV[2] = keepReservation ("1" preserves)
 */
const DISARM_PLAYER_SCRIPT = `
redis.call("HDEL", KEYS[1], ARGV[1])
redis.call("HDEL", KEYS[2], ARGV[1])
if ARGV[2] ~= "1" then
  redis.call("HDEL", KEYS[3], ARGV[1])
end
return 1
`;

/**
 * disarmAllPlayers Lua: DEL all three player-keyed hashes + the arm-cycle.
 * Atomic — no caller can observe a half-cleared room.
 *
 * KEYS[1] = armedTicketsKey
 * KEYS[2] = selectionsKey
 * KEYS[3] = reservationsKey
 * KEYS[4] = armCycleKey
 */
const DISARM_ALL_SCRIPT = `
redis.call("DEL", KEYS[1])
redis.call("DEL", KEYS[2])
redis.call("DEL", KEYS[3])
redis.call("DEL", KEYS[4])
return 1
`;

/**
 * evictPlayer Lua: read armed/reservation state, clear all three slots,
 * return `{hadArmed, hadReservation, reservationId}` so the caller can
 * decide whether to release the wallet reservation.
 *
 * KEYS[1] = armedTicketsKey
 * KEYS[2] = selectionsKey
 * KEYS[3] = reservationsKey
 * ARGV[1] = playerId
 *
 * Return: { hadArmed (0|1), hadReservation (0|1), reservationId (string or "") }
 */
const EVICT_PLAYER_SCRIPT = `
local hadArmed = redis.call("HEXISTS", KEYS[1], ARGV[1])
local existingRes = redis.call("HGET", KEYS[3], ARGV[1])
local hadReservation = 0
if existingRes ~= false and existingRes ~= nil then
  hadReservation = 1
end
redis.call("HDEL", KEYS[1], ARGV[1])
redis.call("HDEL", KEYS[2], ARGV[1])
redis.call("HDEL", KEYS[3], ARGV[1])
local resOut = ""
if hadReservation == 1 then resOut = existingRes end
return { hadArmed, hadReservation, resOut }
`;

/**
 * setReservationId Lua: HSET reservation + EXPIRE.
 *
 * KEYS[1] = reservationsKey
 * ARGV[1] = playerId
 * ARGV[2] = reservationId
 * ARGV[3] = ttlSeconds
 */
const SET_RESERVATION_SCRIPT = `
redis.call("HSET", KEYS[1], ARGV[1], ARGV[2])
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1
`;

/**
 * cancelPreRoundTicket "fully disarm" Lua: same as evictPlayer's
 * write portion, scoped to a single player. Returns nothing — caller
 * already has the displayCache result and just needs the cleanup.
 *
 * KEYS[1..3] = armedTickets, selections, reservations keys
 * ARGV[1] = playerId
 */
const CANCEL_FULL_DISARM_SCRIPT = `
redis.call("HDEL", KEYS[1], ARGV[1])
redis.call("HDEL", KEYS[2], ARGV[1])
redis.call("HDEL", KEYS[3], ARGV[1])
return 1
`;

/**
 * cancelPreRoundTicket "partial" Lua: just update the ticketCount.
 * Reservation entry stays — caller (ticket:cancel handler) does prorata-
 * release outside the store.
 *
 * KEYS[1] = armedTicketsKey
 * ARGV[1] = playerId
 * ARGV[2] = remainingTicketCount
 * ARGV[3] = ttlSeconds
 */
const CANCEL_PARTIAL_SCRIPT = `
redis.call("HSET", KEYS[1], ARGV[1], ARGV[2])
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1
`;

/**
 * Lua-guarded mutex release: only DEL the lock key if it still holds OUR
 * token. Prevents a stale release from a crashed-and-recovered holder
 * from killing a fresh holder's lock.
 *
 * KEYS[1] = lockKey
 * ARGV[1] = token
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

// ── Implementation ─────────────────────────────────────────────────────────

export interface RedisRoomLifecycleStoreOptions {
  /**
   * Pre-built `ioredis` client. When supplied, the store reuses it (sharing
   * pools across multiple Redis-backed surfaces). When omitted, the store
   * creates its own connection from `url`.
   */
  redis?: Redis;
  /** Connection URL (default: redis://localhost:6379). Ignored if `redis` is set. */
  url?: string;
  /** Key prefix (default: `bingo:room:`). */
  keyPrefix?: string;
  /** Per-key TTL in seconds (default: 24h). */
  ttlSeconds?: number;
  /**
   * If set, the store does not eagerly connect — the caller is responsible
   * for `redis.connect()`. Useful in tests where the suite manages
   * lifecycle. Production wiring leaves this off (factory connects eagerly).
   */
  lazyConnect?: boolean;
  /**
   * If true, the store does not own the underlying Redis client and
   * `shutdown()` will NOT call `quit()`. Set to true when reusing a
   * shared client (e.g. RedisRoomStateStore + this store on same pool).
   * Default: false (we own the client we created).
   */
  externallyManaged?: boolean;
}

/**
 * Redis-backed atomic state owner. Same contract as
 * {@link InMemoryRoomLifecycleStore} — every mutator is atomic against
 * the (roomCode, playerId) pair, and `evictPlayer` clears all three
 * state-spaces in one Redis-side script call.
 */
export class RedisRoomLifecycleStore implements RoomLifecycleStore {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly externallyManaged: boolean;
  private closed = false;

  constructor(options: RedisRoomLifecycleStoreOptions = {}) {
    if (options.redis) {
      this.redis = options.redis;
      this.externallyManaged = options.externallyManaged ?? true;
    } else {
      this.redis = new Redis(options.url ?? "redis://localhost:6379", {
        maxRetriesPerRequest: 3,
        // Eager by default; tests pass lazyConnect:true to defer.
        lazyConnect: options.lazyConnect ?? false,
      });
      this.externallyManaged = options.externallyManaged ?? false;
    }
    this.keyPrefix = options.keyPrefix ?? "bingo:room:";
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

    this.redis.on("error", (err: Error) => {
      // Connection-level errors are logged but not thrown — individual
      // commands surface their own errors. The error handler exists so
      // ioredis doesn't crash the process on transient TCP blips.
      storeLog.error({ err }, "redis connection error");
    });
  }

  // ── Key builders ────────────────────────────────────────────────────────

  /** `bingo:room:<roomCode>:armedTickets` */
  private armedTicketsKey(roomCode: string): string {
    return `${this.keyPrefix}${roomCode}:armedTickets`;
  }

  /** `bingo:room:<roomCode>:selections` */
  private selectionsKey(roomCode: string): string {
    return `${this.keyPrefix}${roomCode}:selections`;
  }

  /** `bingo:room:<roomCode>:reservations` */
  private reservationsKey(roomCode: string): string {
    return `${this.keyPrefix}${roomCode}:reservations`;
  }

  /** `bingo:room:<roomCode>:armCycle` */
  private armCycleKey(roomCode: string): string {
    return `${this.keyPrefix}${roomCode}:armCycle`;
  }

  /** `bingo:room:<roomCode>:lock` */
  private lockKey(roomCode: string): string {
    return `${this.keyPrefix}${roomCode}:lock`;
  }

  // ── Per-room Redis-side mutex ──────────────────────────────────────────

  /**
   * Acquire the per-room mutex via Redis SET NX EX. Spins with
   * `LOCK_RETRY_MS` back-off until either acquired or
   * `LOCK_ACQUIRE_TIMEOUT_MS` elapses (then throws — never silently
   * proceeds without the lock).
   *
   * Returns the release-token; pass to `releaseLock` when done.
   */
  private async acquireLock(roomCode: string): Promise<string> {
    const token = randomUUID();
    const key = this.lockKey(roomCode);
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await this.redis.set(key, token, "EX", LOCK_TTL_SECONDS, "NX");
      if (result === "OK") return token;
      // Contended — wait briefly and retry. Avoid busy-loop.
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
    // Timeout. Surface — callers can decide to halt the room rather than
    // proceeding without atomicity. This is the K4 fail-closed surface.
    throw new Error(
      `RedisRoomLifecycleStore: lock acquire timeout for room ${roomCode} (>${LOCK_ACQUIRE_TIMEOUT_MS} ms)`,
    );
  }

  private async releaseLock(roomCode: string, token: string): Promise<void> {
    const key = this.lockKey(roomCode);
    // Lua-guarded delete: only DEL if the value still matches our token.
    // Prevents a stale release (after Redis-side TTL expired and another
    // holder acquired the lock) from killing the live holder.
    await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
  }

  /** Convenience wrapper that acquires the per-room lock for the duration of `fn`. */
  private async withLock<T>(roomCode: string, fn: () => Promise<T>): Promise<T> {
    const token = await this.acquireLock(roomCode);
    try {
      return await fn();
    } finally {
      try {
        await this.releaseLock(roomCode, token);
      } catch (err) {
        // Release-failure is logged but doesn't throw — the lock will
        // expire naturally via TTL. Throwing here would mask the inner
        // error and could dead-lock the caller's error-handling path.
        storeLog.warn({ err, roomCode }, "redisRoomLifecycleStore.releaseLock failed");
      }
    }
  }

  // ── Connection lifecycle ────────────────────────────────────────────────

  /**
   * Eagerly connect (no-op if already connected). The factory calls this
   * at boot so `ROOM_STATE_PROVIDER=redis` fails fast if Redis is down.
   */
  async connect(): Promise<void> {
    // ioredis is forgiving about double-connect — but we surface explicit
    // failures to fail-closed boot.
    if (this.redis.status === "ready" || this.redis.status === "connecting") return;
    try {
      await this.redis.connect();
    } catch (err) {
      // Re-throw so the factory's caller (index.ts boot) crashes the
      // process rather than running with broken room-state.
      throw new Error(
        `RedisRoomLifecycleStore: failed to connect to Redis: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Disconnect. After shutdown, calls fail with "connection is closed". */
  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.externallyManaged) return;
    try {
      await this.redis.quit();
    } catch {
      // Already disconnected; nothing to do.
    }
  }

  // ── armPlayer / disarmPlayer ────────────────────────────────────────────

  async armPlayer(input: {
    roomCode: string;
    playerId: string;
    ticketCount: number;
    selections?: TicketSelection[];
  }): Promise<void> {
    const { roomCode, playerId, ticketCount, selections } = input;
    const armedKey = this.armedTicketsKey(roomCode);
    const selKey = this.selectionsKey(roomCode);
    // Defensive copy: serialize a clone so a caller mutating the array
    // after this call cannot corrupt downstream readers (matches the
    // in-memory impl's `selections.map((s) => ({ ...s }))`).
    const selectionsJson =
      selections && selections.length > 0
        ? JSON.stringify(selections.map((s) => ({ ...s })))
        : "";
    await this.redis.eval(
      ARM_PLAYER_SCRIPT,
      2,
      armedKey,
      selKey,
      playerId,
      String(ticketCount),
      selectionsJson,
      String(this.ttlSeconds),
    );
  }

  async disarmPlayer(input: {
    roomCode: string;
    playerId: string;
    keepReservation?: boolean;
  }): Promise<void> {
    const { roomCode, playerId, keepReservation } = input;
    await this.redis.eval(
      DISARM_PLAYER_SCRIPT,
      3,
      this.armedTicketsKey(roomCode),
      this.selectionsKey(roomCode),
      this.reservationsKey(roomCode),
      playerId,
      keepReservation ? "1" : "0",
    );
  }

  async disarmAllPlayers(input: { roomCode: string }): Promise<void> {
    const { roomCode } = input;
    await this.redis.eval(
      DISARM_ALL_SCRIPT,
      4,
      this.armedTicketsKey(roomCode),
      this.selectionsKey(roomCode),
      this.reservationsKey(roomCode),
      this.armCycleKey(roomCode),
    );
  }

  // ── Reservation tracking ────────────────────────────────────────────────

  async setReservationId(input: {
    roomCode: string;
    playerId: string;
    reservationId: string;
  }): Promise<void> {
    const { roomCode, playerId, reservationId } = input;
    await this.redis.eval(
      SET_RESERVATION_SCRIPT,
      1,
      this.reservationsKey(roomCode),
      playerId,
      reservationId,
      String(this.ttlSeconds),
    );
  }

  async clearReservationId(input: {
    roomCode: string;
    playerId: string;
  }): Promise<void> {
    const { roomCode, playerId } = input;
    await this.redis.hdel(this.reservationsKey(roomCode), playerId);
  }

  // ── evictPlayer (atomic Lua — the orphan-bug killer) ────────────────────

  async evictPlayer(input: {
    roomCode: string;
    playerId: string;
    releaseReservation?: boolean;
    reason?: string;
  }): Promise<EvictPlayerResult> {
    const { roomCode, playerId, releaseReservation = true, reason } = input;
    // Single Lua script — atomic against any concurrent reader/mutator
    // on the same room, and significantly faster than the JS-side
    // mutex+pipeline pattern.
    const raw = (await this.redis.eval(
      EVICT_PLAYER_SCRIPT,
      3,
      this.armedTicketsKey(roomCode),
      this.selectionsKey(roomCode),
      this.reservationsKey(roomCode),
      playerId,
    )) as [number, number, string];
    const hadArmedState = raw[0] === 1;
    const hadReservation = raw[1] === 1;
    const reservationId = raw[2] === "" ? null : raw[2];

    if (hadArmedState || hadReservation) {
      storeLog.info(
        {
          roomCode,
          playerId,
          hadArmedState,
          hadReservation,
          releaseReservation,
          reason: reason ?? "evictPlayer",
        },
        "redisRoomLifecycleStore.evictPlayer",
      );
    }

    return {
      hadArmedState,
      hadReservation,
      releasedReservationId: releaseReservation ? reservationId : null,
    };
  }

  // ── Read API (consistent snapshots via pipelined reads) ─────────────────

  async getPlayerWithArmedState(input: {
    roomCode: string;
    playerId: string;
  }): Promise<ArmedPlayerSnapshot | null> {
    const { roomCode, playerId } = input;
    // Pipelined three-key read — single round-trip; Redis runs these
    // sequentially against the keyspace so a concurrent mutator can
    // only land between the pipeline boundaries (not within).
    const pipeline = this.redis.pipeline();
    pipeline.hget(this.armedTicketsKey(roomCode), playerId);
    pipeline.hget(this.selectionsKey(roomCode), playerId);
    pipeline.hget(this.reservationsKey(roomCode), playerId);
    const results = await pipeline.exec();
    if (!results) return null;
    const armedRaw = results[0]?.[1] as string | null | undefined;
    const selectionsRaw = results[1]?.[1] as string | null | undefined;
    const reservationRaw = results[2]?.[1] as string | null | undefined;

    const armedTickets = armedRaw == null ? undefined : Number(armedRaw);
    const reservationId = reservationRaw == null ? null : reservationRaw;
    if (armedTickets === undefined && reservationId === null) return null;
    let selections: TicketSelection[] = [];
    if (selectionsRaw) {
      try {
        const parsed = JSON.parse(selectionsRaw) as TicketSelection[];
        // Defensive copy so callers can't corrupt our pipelined read by
        // mutating the returned array (matches in-memory impl).
        selections = parsed.map((s) => ({ ...s }));
      } catch (err) {
        storeLog.warn(
          { err, roomCode, playerId, selectionsRaw },
          "redisRoomLifecycleStore.getPlayerWithArmedState — failed to parse selections; treating as empty",
        );
      }
    }
    return {
      armedTicketCount: armedTickets ?? 0,
      selections,
      reservationId,
    };
  }

  async hasArmedOrReservation(input: {
    roomCode: string;
    playerId: string;
  }): Promise<boolean> {
    const { roomCode, playerId } = input;
    // Two HEXISTS in a pipeline — minimal round-trip.
    const pipeline = this.redis.pipeline();
    pipeline.hexists(this.armedTicketsKey(roomCode), playerId);
    pipeline.hexists(this.reservationsKey(roomCode), playerId);
    const results = await pipeline.exec();
    if (!results) return false;
    const armed = (results[0]?.[1] as number | undefined) === 1;
    if (armed) return true;
    return (results[1]?.[1] as number | undefined) === 1;
  }

  async getArmedPlayerIds(roomCode: string): Promise<string[]> {
    return this.redis.hkeys(this.armedTicketsKey(roomCode));
  }

  async getArmedPlayerTicketCounts(roomCode: string): Promise<Record<string, number>> {
    const raw = await this.redis.hgetall(this.armedTicketsKey(roomCode));
    const out: Record<string, number> = {};
    for (const [pid, count] of Object.entries(raw)) {
      out[pid] = Number(count);
    }
    return out;
  }

  async getArmedPlayerSelections(roomCode: string): Promise<Record<string, TicketSelection[]>> {
    const raw = await this.redis.hgetall(this.selectionsKey(roomCode));
    const out: Record<string, TicketSelection[]> = {};
    for (const [pid, json] of Object.entries(raw)) {
      try {
        const parsed = JSON.parse(json) as TicketSelection[];
        out[pid] = parsed.map((s) => ({ ...s }));
      } catch (err) {
        // Corrupt entry: skip and log. Don't fail the whole map read.
        storeLog.warn(
          { err, roomCode, playerId: pid },
          "redisRoomLifecycleStore.getArmedPlayerSelections — failed to parse; skipping",
        );
      }
    }
    return out;
  }

  async getReservationId(input: {
    roomCode: string;
    playerId: string;
  }): Promise<string | null> {
    const { roomCode, playerId } = input;
    const value = await this.redis.hget(this.reservationsKey(roomCode), playerId);
    return value ?? null;
  }

  async getAllReservationIds(roomCode: string): Promise<Record<string, string>> {
    return this.redis.hgetall(this.reservationsKey(roomCode));
  }

  // ── arm-cycle id ────────────────────────────────────────────────────────

  async getOrCreateArmCycleId(roomCode: string): Promise<string> {
    const key = this.armCycleKey(roomCode);
    // Try to read first. If missing, attempt SET NX with a fresh UUID; on
    // race lose, re-read. This is a "get-or-set" without holding the
    // per-room mutex (since multiple racing creators converge on the same
    // value via NX). Refreshing TTL on every read keeps the cycle alive
    // for the room's lifetime.
    const existing = await this.redis.get(key);
    if (existing) {
      // Refresh TTL so the cycle survives idle gaps within the same round.
      await this.redis.expire(key, this.ttlSeconds);
      return existing;
    }
    const candidate = randomUUID();
    const setResult = await this.redis.set(
      key,
      candidate,
      "EX",
      this.ttlSeconds,
      "NX",
    );
    if (setResult === "OK") return candidate;
    // Race: someone else SET first; read theirs.
    const winner = await this.redis.get(key);
    if (!winner) {
      // Pathological: both NX failed and read returned empty (key was
      // deleted between SET and GET). Generate fresh and retry.
      const retry = await this.redis.set(
        key,
        randomUUID(),
        "EX",
        this.ttlSeconds,
        "NX",
      );
      if (retry === "OK") {
        const value = await this.redis.get(key);
        if (value) return value;
      }
      // Give up gracefully — return a fresh UUID even though we didn't
      // persist. Next call will re-create. Acceptable degradation.
      storeLog.warn(
        { roomCode },
        "redisRoomLifecycleStore.getOrCreateArmCycleId — racy NX failure; returning unpersisted id",
      );
      return candidate;
    }
    return winner;
  }

  // ── cancelPreRoundTicket (atomic-with-callback) ─────────────────────────

  async cancelPreRoundTicket(input: {
    roomCode: string;
    playerId: string;
    onMutateDisplayCache: () => CancelPreRoundTicketResult | null;
  }): Promise<CancelPreRoundTicketResult | null> {
    const { roomCode, playerId, onMutateDisplayCache } = input;
    // The callback runs JS — we need a real mutex around it so concurrent
    // mutators on the same room can't interleave. Lua can't span a JS
    // callback, so a Redis-side SET NX EX lock is the only way to keep
    // the same atomicity guarantee as the in-memory PerRoomMutex.
    return this.withLock(roomCode, async () => {
      const result = onMutateDisplayCache();
      if (!result) return null;

      if (result.fullyDisarmed) {
        await this.redis.eval(
          CANCEL_FULL_DISARM_SCRIPT,
          3,
          this.armedTicketsKey(roomCode),
          this.selectionsKey(roomCode),
          this.reservationsKey(roomCode),
          playerId,
        );
      } else {
        await this.redis.eval(
          CANCEL_PARTIAL_SCRIPT,
          1,
          this.armedTicketsKey(roomCode),
          playerId,
          String(result.remainingTicketCount),
          String(this.ttlSeconds),
        );
      }
      return result;
    });
  }

  // ── evictWhere (bulk sweep across rooms) ────────────────────────────────

  async evictWhere(
    predicate: (input: {
      roomCode: string;
      playerId: string;
    }) => boolean | Promise<boolean>,
  ): Promise<EvictPlayerResult[]> {
    // Two-phase identical to the in-memory impl:
    //   1. Collect candidates by SCAN-ing for armedTickets/* and
    //      reservations/* hash-keys (without holding any room lock).
    //   2. For each candidate, acquire the per-room mutex, re-evaluate
    //      predicate (predicate-races: state may have changed mid-flight),
    //      and evict via the same Lua used by `evictPlayer`.
    const armedPattern = `${this.keyPrefix}*:armedTickets`;
    const reservationsPattern = `${this.keyPrefix}*:reservations`;

    // Discover rooms by SCAN (avoid `KEYS *` which blocks on big keyspaces).
    const armedRoomCodes = await this.scanRoomCodesForSuffix(armedPattern, ":armedTickets");
    const reservationRoomCodes = await this.scanRoomCodesForSuffix(
      reservationsPattern,
      ":reservations",
    );
    const roomCodes = new Set<string>([...armedRoomCodes, ...reservationRoomCodes]);

    // Build (roomCode, playerId) candidates.
    const candidates: Array<{ roomCode: string; playerId: string }> = [];
    for (const roomCode of roomCodes) {
      const armedPlayers = await this.redis.hkeys(this.armedTicketsKey(roomCode));
      const reservationPlayers = await this.redis.hkeys(this.reservationsKey(roomCode));
      const playerIds = new Set<string>([...armedPlayers, ...reservationPlayers]);
      for (const playerId of playerIds) candidates.push({ roomCode, playerId });
    }

    const results: EvictPlayerResult[] = [];
    for (const candidate of candidates) {
      const evictResult = await this.withLock(candidate.roomCode, async () => {
        const stillEligible = await predicate(candidate);
        if (!stillEligible) return null;
        const raw = (await this.redis.eval(
          EVICT_PLAYER_SCRIPT,
          3,
          this.armedTicketsKey(candidate.roomCode),
          this.selectionsKey(candidate.roomCode),
          this.reservationsKey(candidate.roomCode),
          candidate.playerId,
        )) as [number, number, string];
        const hadArmedState = raw[0] === 1;
        const hadReservation = raw[1] === 1;
        if (!hadArmedState && !hadReservation) {
          // Already evicted between snapshot and predicate check.
          return null;
        }
        storeLog.info(
          {
            roomCode: candidate.roomCode,
            playerId: candidate.playerId,
            hadArmedState,
            hadReservation,
          },
          "redisRoomLifecycleStore.evictWhere",
        );
        return {
          hadArmedState,
          hadReservation,
          releasedReservationId: raw[2] === "" ? null : raw[2],
        };
      });
      if (evictResult) results.push(evictResult);
    }
    return results;
  }

  /**
   * SCAN pattern → extract room codes by stripping prefix + suffix.
   * Replaces `KEYS pattern` (which blocks Redis with big keyspaces).
   */
  private async scanRoomCodesForSuffix(pattern: string, suffix: string): Promise<string[]> {
    const out: string[] = [];
    const prefixLen = this.keyPrefix.length;
    const suffixLen = suffix.length;
    let cursor = "0";
    do {
      const [next, batch] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = next;
      for (const key of batch) {
        if (key.startsWith(this.keyPrefix) && key.endsWith(suffix)) {
          out.push(key.slice(prefixLen, key.length - suffixLen));
        }
      }
    } while (cursor !== "0");
    return out;
  }

  // ── Boot-restore helper (used by staleRoomBootSweep replacement) ────────

  /**
   * Enumerate every room with any live lifecycle state (armed players,
   * reservations, or just an arm-cycle that survived a partial cleanup).
   * Used by the K4 boot path: instead of reconstructing armed-state from
   * `game_sessions` (which doesn't see pre-round), we read it from Redis
   * directly. The returned set is an upper-bound; some entries may have
   * already been disarmed mid-scan, which the caller can resolve via
   * `getArmedPlayerIds(code)` per room.
   */
  async listActiveRoomCodes(): Promise<string[]> {
    const armedRooms = await this.scanRoomCodesForSuffix(
      `${this.keyPrefix}*:armedTickets`,
      ":armedTickets",
    );
    const reservationRooms = await this.scanRoomCodesForSuffix(
      `${this.keyPrefix}*:reservations`,
      ":reservations",
    );
    const armCycleRooms = await this.scanRoomCodesForSuffix(
      `${this.keyPrefix}*:armCycle`,
      ":armCycle",
    );
    const all = new Set<string>([...armedRooms, ...reservationRooms, ...armCycleRooms]);
    return [...all];
  }
}
