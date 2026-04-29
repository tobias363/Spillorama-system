/**
 * RoomLifecycleStore — atomic state owner for the three-way ownership leak
 * fixed in Bølge K2 of the pre-pilot refactor.
 *
 * BEFORE this store existed, three independent Maps owned related state:
 *   1. `BingoEngine.rooms.players`             (engine-internal)
 *   2. `RoomStateManager.armedPlayerIdsByRoom` (util-internal)
 *   3. `RoomStateManager.reservationIdByPlayerByRoom` (util-internal)
 *
 * Mutators in different code paths could leave the three Maps inconsistent:
 *   - `cleanupStaleWalletInIdleRooms` deleted from (1) without touching (2/3).
 *   - `disarmAllPlayers`              cleared (2/3) without touching (1).
 *   - `bet:arm`                       wrote to (2/3) and trusted (1) untouched.
 *
 * The 2026-04-29 prod incident (60 NOK orphan reservation) was the symptom of
 * this leak. PR #724's `isPreserve`-callback patched the most-acute case
 * (cleanup-while-armed) but left the underlying ownership leak unfixed:
 * any new caller had to remember to mutate all three Maps consistently.
 *
 * This store collapses the ownership into a SINGLE authoritative owner with
 * an atomic mutator API. Each high-level operation (`armPlayer`,
 * `evictPlayer`, `disarmAllPlayers`, `clearReservation`) holds a per-room
 * mutex while it touches every relevant state-space — callers can no longer
 * leave half-mutated state behind by forgetting one of the three Maps.
 *
 * The store interface is **Redis-implementable** by design, paving the way
 * for K4 (Redis-backed shared state). The in-memory impl below uses Maps +
 * per-room async mutexes; a Redis impl would use hash-keys + Lua-scripted
 * transactions or Watch/Multi/Exec for the same atomicity guarantee.
 *
 * Reference: docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md §2.2 + §6 K2.
 * Reference: docs/audit/FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md §7.1.
 */
import { randomUUID } from "node:crypto";
import { logger as rootLogger } from "./logger.js";

const storeLog = rootLogger.child({ module: "roomLifecycleStore" });

/**
 * A ticket-type selection stored for an armed player. Matches
 * `roomState.TicketSelection` so the two surfaces are interchangeable —
 * the store IS the canonical owner of this data.
 */
export interface TicketSelection {
  /** Ticket type code, e.g. "small", "large", "elvis". */
  type: string;
  /** How many of this ticket type to purchase. */
  qty: number;
  /**
   * BIN-688: human-readable ticket-type name (e.g. "Small Yellow"),
   * matching `TicketTypeConfig.name` in variantConfig.ts. Optional for
   * backward compat — clients that only send `type` still arm successfully,
   * but pre-round tickets then fall back to sequential colour cycling.
   */
  name?: string;
}

/**
 * Read-side snapshot of an armed player's lifecycle state. Returned by
 * `getPlayerWithArmedState` so callers see a CONSISTENT view of all three
 * state-spaces (armed-set membership, ticket count, selections,
 * reservation-id). A read-write race cannot produce torn snapshots
 * because reads acquire the same per-room mutex briefly.
 */
export interface ArmedPlayerSnapshot {
  /** Total weighted ticket count (sum across selections × bundleSize). */
  armedTicketCount: number;
  /** Per-type selections — empty array when only flat ticketCount was set. */
  selections: TicketSelection[];
  /** Active wallet-reservation-id, or null if no reservation. */
  reservationId: string | null;
}

/**
 * Result of `evictPlayer` — describes what was actually changed so callers
 * can log consistently and emit follow-up events.
 */
export interface EvictPlayerResult {
  /** True if the player had armed-state when evicted. */
  hadArmedState: boolean;
  /** True if the player had a wallet reservation when evicted. */
  hadReservation: boolean;
  /**
   * The reservation id at the moment of eviction (before clearing). Caller
   * can pass to `walletAdapter.releaseReservation` if `releaseReservation`
   * was true. Null when the player had no reservation.
   */
  releasedReservationId: string | null;
}

/**
 * Result of `cancelPreRoundTicket`. Identical shape to
 * `RoomStateManager.cancelPreRoundTicket` so the migration can keep
 * existing socket-layer wiring without behavior change.
 */
export interface CancelPreRoundTicketResult {
  removedTicketIds: string[];
  remainingTicketCount: number;
  fullyDisarmed: boolean;
}

/**
 * The atomic mutator + read interface. ALL methods are `async` even when
 * the in-memory impl could be sync — this matches the Redis impl's
 * future shape (every mutation crosses a network boundary) and prevents
 * accidental sync-only call patterns from leaking into production code
 * that needs to migrate to Redis later.
 */
export interface RoomLifecycleStore {
  // ── Arm / disarm (atomic with reservation-mapping) ──────────────────────

  /**
   * Mark a player as armed with the given total weighted ticket count and
   * (optional) per-type selections. Atomic — armedSet, selectionsMap, and
   * armCycleId for the room are all owned by this call.
   *
   * Idempotent: re-arming the same player just overwrites their entries.
   * Selection list with zero qty entries is filtered out before storage.
   */
  armPlayer(input: {
    roomCode: string;
    playerId: string;
    ticketCount: number;
    selections?: TicketSelection[];
  }): Promise<void>;

  /**
   * Remove the player's armed-state. By default this also clears their
   * reservation-mapping (matches the existing `disarmPlayer` contract in
   * RoomStateManager). Pass `keepReservation: true` to preserve the
   * reservation entry — used by ticket:cancel partial flows where the
   * reservation is reduced via prorata-release rather than fully cleared.
   */
  disarmPlayer(input: {
    roomCode: string;
    playerId: string;
    keepReservation?: boolean;
  }): Promise<void>;

  /**
   * Clear the entire room's armed-state + selections + reservation-mapping
   * + arm-cycle-id atomically. Called from `onAutoStart` after `startGame`
   * commits the buy-ins (reservations were committed, not released —
   * mapping is just cleared from in-memory state).
   *
   * BIN-693 + 2026-04-27 fix: armCycleId is bumped here so the next
   * round's bet:arm gets fresh idempotency keys.
   */
  disarmAllPlayers(input: { roomCode: string }): Promise<void>;

  // ── Reservation tracking (atomic — co-owned with armed-state) ───────────

  /**
   * Set the reservation-id for an armed player. Caller is responsible for
   * having created the wallet-reservation row first; the store only tracks
   * the in-memory mapping (playerId → reservationId).
   */
  setReservationId(input: {
    roomCode: string;
    playerId: string;
    reservationId: string;
  }): Promise<void>;

  /** Clear the reservation-mapping for one (room, player). */
  clearReservationId(input: { roomCode: string; playerId: string }): Promise<void>;

  // ── Atomic eviction (the orphan-bug killer) ─────────────────────────────

  /**
   * Atomic player eviction — removes ALL per-player state for the given
   * (roomCode, playerId): armed-state, selections, reservation-mapping.
   * Returns a description of what was actually cleared so callers can log
   * consistently and (if `releaseReservation: true` was requested) pass
   * `releasedReservationId` to `walletAdapter.releaseReservation`.
   *
   * IMPORTANT: this method does NOT touch the engine's `room.players` Map
   * — that stays the engine's own concern. The intended call pattern is:
   *
   *     const result = await store.evictPlayer({ roomCode, playerId });
   *     if (result.releasedReservationId) {
   *       await walletAdapter.releaseReservation(result.releasedReservationId);
   *     }
   *     engine.removePlayerFromRoom(roomCode, playerId);  // engine-internal
   *
   * The store guarantees that armed-state + reservation-mapping are
   * cleared atomically. The follow-up engine call is the caller's
   * responsibility — and is the boundary between K2 (this PR) and the
   * larger refactor that would unify engine + store ownership.
   *
   * Pass `releaseReservation: false` when you want to preserve the
   * wallet reservation (e.g. the caller is mid-commit and will commit
   * the reservation rather than release it). Default `true`.
   */
  evictPlayer(input: {
    roomCode: string;
    playerId: string;
    /**
     * Caller intent: should the wallet-reservation be released after the
     * mapping is cleared? Default `true` (fail-safe — orphan reservations
     * are auditor-visible). Set to `false` only when the caller is about
     * to commit the reservation via `walletAdapter.commitReservation`.
     */
    releaseReservation?: boolean;
    /**
     * Free-text reason for observability — populates the
     * `room.player.evicted` log event's `reason` field.
     */
    reason?: string;
  }): Promise<EvictPlayerResult>;

  // ── Read API (consistent snapshots) ─────────────────────────────────────

  /**
   * Returns the consistent snapshot of an armed player's state, or `null`
   * if the player isn't armed. The returned object reflects all three
   * state-spaces at the same instant — no read can race a concurrent
   * write to produce a torn view (armed=true but reservationId=null when
   * a write was in progress).
   *
   * To check "do I have anything in-flight for this (roomCode, playerId)?"
   * the cheaper `hasArmedOrReservation` is preferred — same result, no
   * object allocation.
   */
  getPlayerWithArmedState(input: {
    roomCode: string;
    playerId: string;
  }): Promise<ArmedPlayerSnapshot | null>;

  /**
   * Cheap predicate: is the (roomCode, playerId) tuple armed OR holding
   * an active wallet reservation? Matches the contract of the previous
   * `RoomStateManager.hasArmedOrReservation` introspection used by
   * `cleanupStaleWalletInIdleRooms`'s preserve-callback.
   */
  hasArmedOrReservation(input: {
    roomCode: string;
    playerId: string;
  }): Promise<boolean>;

  /** Snapshot of all armed playerIds in a room. Empty array if none. */
  getArmedPlayerIds(roomCode: string): Promise<string[]>;

  /** Snapshot of armed (playerId → totalWeighted) for a room. */
  getArmedPlayerTicketCounts(roomCode: string): Promise<Record<string, number>>;

  /** Snapshot of armed (playerId → selections) for a room. */
  getArmedPlayerSelections(roomCode: string): Promise<Record<string, TicketSelection[]>>;

  /** Get a single (room, player)'s reservation-id, or null. */
  getReservationId(input: { roomCode: string; playerId: string }): Promise<string | null>;

  /** Snapshot of all (playerId → reservationId) for a room. */
  getAllReservationIds(roomCode: string): Promise<Record<string, string>>;

  // ── Arm-cycle id (idempotency-key salt) ─────────────────────────────────

  /**
   * Returns the room's current arm-cycle-id, creating one (UUID v4) on
   * first call. Bumped in `disarmAllPlayers` so the next round's bet:arm
   * gets fresh idempotency keys (post-2026-04-27 pilot bug fix).
   */
  getOrCreateArmCycleId(roomCode: string): Promise<string>;

  // ── Mutator with prorata-cancellation semantics ─────────────────────────

  /**
   * Wraps the BIN-692 cancel-pre-round-ticket logic with the same
   * atomicity guarantee. Modifies displayTicketCache (passed in via
   * `onMutateDisplayCache`), armed-state, selections, and reservation-
   * mapping in one atomic operation. Reservation is NOT released here
   * — caller (ticket:cancel handler) calls `walletAdapter.releaseReservation`
   * after this returns, using the (now possibly cleared) reservation-id.
   *
   * The `onMutateDisplayCache` callback is invoked while the per-room
   * mutex is held — the callback runs the existing
   * `RoomStateManager.cancelPreRoundTicket` logic (which mutates the
   * display cache + decides which selection-bundle to remove). When the
   * callback returns `null` (ticket id not found), the store rolls back
   * — armed-state is unchanged.
   *
   * This isolation means we can keep `cancelPreRoundTicket` in
   * RoomStateManager (where its display-cache logic lives) while still
   * routing through the store's mutex for atomicity with the other
   * state-spaces.
   */
  cancelPreRoundTicket(input: {
    roomCode: string;
    playerId: string;
    /** Caller-supplied logic that mutates display-cache + computes diff. */
    onMutateDisplayCache: () => CancelPreRoundTicketResult | null;
  }): Promise<CancelPreRoundTicketResult | null>;

  // ── Bulk-eviction sweep ─────────────────────────────────────────────────

  /**
   * Atomic sweep over all rooms — for each (roomCode, playerId) tuple
   * matched by `predicate`, evict the player (clearing armed + selections
   * + reservation-mapping). Returns the list of evictions that actually
   * happened so the caller can issue follow-up wallet operations.
   *
   * Used by socket-layer cleanup helpers to evict disconnected wallet
   * bindings while keeping atomicity with reservation-state. Replaces
   * the looser `cleanupStaleWalletInIdleRooms` + `isPreserve`-callback
   * pattern from PR #724.
   *
   * **Predicate constraint:** the predicate runs INSIDE the per-room mutex
   * for that candidate's room. It must NOT call back into the store on
   * the SAME room — that would deadlock waiting for its own lock. Reads
   * on OTHER rooms are fine. The typical predicate inspects external
   * state (e.g. engine.rooms.get(code).players) which is sync and safe.
   */
  evictWhere(predicate: (input: {
    roomCode: string;
    playerId: string;
  }) => boolean | Promise<boolean>): Promise<EvictPlayerResult[]>;
}

// ── In-memory impl ──────────────────────────────────────────────────────

/**
 * Per-room async mutex — serializes mutators for a single room. Lookups +
 * mutations across DIFFERENT rooms run in parallel.
 *
 * Implementation: a chain of pending Promises, keyed by roomCode. Each
 * acquire returns a release-fn; release resolves the next waiter. This
 * is the smallest correct mutex pattern in node — battle-tested in
 * `BingoEngine.drawLocksByRoom` and elsewhere in the codebase.
 *
 * Why per-room: mutating room A's state should not block mutating room
 * B's. Per-room granularity matches the only contention pattern we
 * actually see (per-player ops within one room).
 */
class PerRoomMutex {
  private readonly chain = new Map<string, Promise<void>>();

  async acquire(roomCode: string): Promise<() => void> {
    const previous = this.chain.get(roomCode) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = () => {
        // Best-effort cleanup: drop the chain entry when this mutex is
        // released and no other waiter has queued behind it. Prevents
        // unbounded growth of the chain map for rooms that mutate once
        // and never again. If a waiter joined between resolve() and
        // delete-check, we leave the chain alone.
        resolve();
        if (this.chain.get(roomCode) === next) {
          this.chain.delete(roomCode);
        }
      };
    });
    this.chain.set(roomCode, next);
    await previous;
    return release;
  }

  async withLock<T>(roomCode: string, fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire(roomCode);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Shape of the underlying Maps the in-memory store operates on. Exposed
 * as a parameter to {@link InMemoryRoomLifecycleStore.constructor} so
 * `RoomStateManager` can SHARE the same Map references — its existing
 * sync getters/setters continue to work, while the store provides the
 * atomic-mutator API that cleanup/eviction paths require.
 *
 * Both surfaces (RoomStateManager + Store) read/write the same Maps.
 * In-process, JS single-threadedness means uncontended sync writes from
 * RoomStateManager are safe; the Store's mutex protects multi-step
 * mutations (evictPlayer, evictWhere) from being interleaved with each
 * other or with bulk reads that need consistency.
 *
 * For Redis: this struct goes away entirely — the Redis impl talks to
 * Redis directly and exposes only the Store interface.
 */
export interface RoomLifecycleMaps {
  armedTicketsByRoom: Map<string, Map<string, number>>;
  armedSelectionsByRoom: Map<string, Map<string, TicketSelection[]>>;
  reservationsByRoom: Map<string, Map<string, string>>;
  armCycleByRoom: Map<string, string>;
}

/**
 * In-memory implementation. Maps live in-process; a restart loses state.
 * For multi-instance / restart-resilience, use the Redis impl that K4
 * will introduce against this same interface.
 *
 * The Maps may be passed in by `RoomStateManager` so the two surfaces
 * share state. When omitted (tests, standalone usage), the store
 * allocates its own Maps.
 */
export class InMemoryRoomLifecycleStore implements RoomLifecycleStore {
  private readonly armedTicketsByRoom: Map<string, Map<string, number>>;
  private readonly armedSelectionsByRoom: Map<string, Map<string, TicketSelection[]>>;
  private readonly reservationsByRoom: Map<string, Map<string, string>>;
  private readonly armCycleByRoom: Map<string, string>;

  private readonly mutex = new PerRoomMutex();

  constructor(maps?: RoomLifecycleMaps) {
    this.armedTicketsByRoom = maps?.armedTicketsByRoom ?? new Map();
    this.armedSelectionsByRoom = maps?.armedSelectionsByRoom ?? new Map();
    this.reservationsByRoom = maps?.reservationsByRoom ?? new Map();
    this.armCycleByRoom = maps?.armCycleByRoom ?? new Map();
  }

  // ── Internal helpers (must be called WITH the per-room mutex held) ────

  private clearPlayerStateLocked(roomCode: string, playerId: string): {
    hadArmedState: boolean;
    hadReservation: boolean;
    reservationId: string | null;
  } {
    const armedRoom = this.armedTicketsByRoom.get(roomCode);
    const hadArmedState = armedRoom?.has(playerId) ?? false;
    armedRoom?.delete(playerId);
    this.armedSelectionsByRoom.get(roomCode)?.delete(playerId);

    const resRoom = this.reservationsByRoom.get(roomCode);
    const reservationId = resRoom?.get(playerId) ?? null;
    const hadReservation = reservationId !== null;
    resRoom?.delete(playerId);

    return { hadArmedState, hadReservation, reservationId };
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async armPlayer(input: {
    roomCode: string;
    playerId: string;
    ticketCount: number;
    selections?: TicketSelection[];
  }): Promise<void> {
    const { roomCode, playerId, ticketCount, selections } = input;
    await this.mutex.withLock(roomCode, () => {
      let armed = this.armedTicketsByRoom.get(roomCode);
      if (!armed) {
        armed = new Map();
        this.armedTicketsByRoom.set(roomCode, armed);
      }
      armed.set(playerId, ticketCount);

      // Selections: store when non-empty; clear stale entry when no
      // selections supplied (matches RoomStateManager.armPlayer's
      // backward-compat behavior for ticketCount-only arms).
      if (selections && selections.length > 0) {
        let selMap = this.armedSelectionsByRoom.get(roomCode);
        if (!selMap) {
          selMap = new Map();
          this.armedSelectionsByRoom.set(roomCode, selMap);
        }
        selMap.set(playerId, selections.map((s) => ({ ...s })));
      } else {
        this.armedSelectionsByRoom.get(roomCode)?.delete(playerId);
      }
    });
  }

  async disarmPlayer(input: {
    roomCode: string;
    playerId: string;
    keepReservation?: boolean;
  }): Promise<void> {
    const { roomCode, playerId, keepReservation } = input;
    await this.mutex.withLock(roomCode, () => {
      this.armedTicketsByRoom.get(roomCode)?.delete(playerId);
      this.armedSelectionsByRoom.get(roomCode)?.delete(playerId);
      if (!keepReservation) {
        this.reservationsByRoom.get(roomCode)?.delete(playerId);
      }
    });
  }

  async disarmAllPlayers(input: { roomCode: string }): Promise<void> {
    const { roomCode } = input;
    await this.mutex.withLock(roomCode, () => {
      this.armedTicketsByRoom.get(roomCode)?.clear();
      this.armedSelectionsByRoom.get(roomCode)?.clear();
      this.reservationsByRoom.get(roomCode)?.clear();
      // Bump arm-cycle: bet:arm idempotency keys for the next round are
      // distinct from the just-completed round's keys (post-2026-04-27 fix).
      this.armCycleByRoom.delete(roomCode);
    });
  }

  async setReservationId(input: {
    roomCode: string;
    playerId: string;
    reservationId: string;
  }): Promise<void> {
    const { roomCode, playerId, reservationId } = input;
    await this.mutex.withLock(roomCode, () => {
      let map = this.reservationsByRoom.get(roomCode);
      if (!map) {
        map = new Map();
        this.reservationsByRoom.set(roomCode, map);
      }
      map.set(playerId, reservationId);
    });
  }

  async clearReservationId(input: {
    roomCode: string;
    playerId: string;
  }): Promise<void> {
    const { roomCode, playerId } = input;
    await this.mutex.withLock(roomCode, () => {
      this.reservationsByRoom.get(roomCode)?.delete(playerId);
    });
  }

  async evictPlayer(input: {
    roomCode: string;
    playerId: string;
    releaseReservation?: boolean;
    reason?: string;
  }): Promise<EvictPlayerResult> {
    const { roomCode, playerId, releaseReservation = true, reason } = input;
    return this.mutex.withLock(roomCode, () => {
      const cleared = this.clearPlayerStateLocked(roomCode, playerId);
      // Observability: log when state was actually cleared (skip silent
      // no-ops for already-clean players). Reason field is grep-able in
      // ops post-mortem.
      if (cleared.hadArmedState || cleared.hadReservation) {
        storeLog.info(
          {
            roomCode,
            playerId,
            hadArmedState: cleared.hadArmedState,
            hadReservation: cleared.hadReservation,
            releaseReservation,
            reason: reason ?? "evictPlayer",
          },
          "roomLifecycleStore.evictPlayer",
        );
      }
      return {
        hadArmedState: cleared.hadArmedState,
        hadReservation: cleared.hadReservation,
        // Only surface reservation-id when caller asked us to release
        // (releaseReservation=false → caller will commit; don't expose
        // the id since they shouldn't release it).
        releasedReservationId: releaseReservation ? cleared.reservationId : null,
      };
    });
  }

  async getPlayerWithArmedState(input: {
    roomCode: string;
    playerId: string;
  }): Promise<ArmedPlayerSnapshot | null> {
    const { roomCode, playerId } = input;
    return this.mutex.withLock(roomCode, () => {
      const armedTickets = this.armedTicketsByRoom.get(roomCode)?.get(playerId);
      const reservationId = this.reservationsByRoom.get(roomCode)?.get(playerId) ?? null;
      // Player is "armed" if either armedSet has them OR they hold a
      // reservation. The reservation-only state is a transient race window
      // — bet:arm sets reservation BEFORE armPlayer in the current
      // production code, so a reader could see it. Treat as armed.
      if (armedTickets === undefined && reservationId === null) return null;
      const selectionsRaw = this.armedSelectionsByRoom.get(roomCode)?.get(playerId);
      // Defensive copy so callers can't mutate stored arrays.
      const selections: TicketSelection[] = selectionsRaw
        ? selectionsRaw.map((s) => ({ ...s }))
        : [];
      return {
        armedTicketCount: armedTickets ?? 0,
        selections,
        reservationId,
      };
    });
  }

  async hasArmedOrReservation(input: {
    roomCode: string;
    playerId: string;
  }): Promise<boolean> {
    const { roomCode, playerId } = input;
    // Read-side mutex acquisition guarantees we don't see a torn snapshot
    // mid-write. The cost is one mutex tick — negligible for the
    // socket-layer call sites that use this.
    return this.mutex.withLock(roomCode, () => {
      const armed = this.armedTicketsByRoom.get(roomCode)?.has(playerId) ?? false;
      if (armed) return true;
      return this.reservationsByRoom.get(roomCode)?.has(playerId) ?? false;
    });
  }

  async getArmedPlayerIds(roomCode: string): Promise<string[]> {
    return this.mutex.withLock(roomCode, () => {
      const map = this.armedTicketsByRoom.get(roomCode);
      return map ? [...map.keys()] : [];
    });
  }

  async getArmedPlayerTicketCounts(roomCode: string): Promise<Record<string, number>> {
    return this.mutex.withLock(roomCode, () => {
      const map = this.armedTicketsByRoom.get(roomCode);
      if (!map) return {};
      return Object.fromEntries(map);
    });
  }

  async getArmedPlayerSelections(roomCode: string): Promise<Record<string, TicketSelection[]>> {
    return this.mutex.withLock(roomCode, () => {
      const selMap = this.armedSelectionsByRoom.get(roomCode);
      if (!selMap) return {};
      const out: Record<string, TicketSelection[]> = {};
      for (const [pid, sels] of selMap) {
        out[pid] = sels.map((s) => ({ ...s }));
      }
      return out;
    });
  }

  async getReservationId(input: {
    roomCode: string;
    playerId: string;
  }): Promise<string | null> {
    const { roomCode, playerId } = input;
    return this.mutex.withLock(roomCode, () => {
      return this.reservationsByRoom.get(roomCode)?.get(playerId) ?? null;
    });
  }

  async getAllReservationIds(roomCode: string): Promise<Record<string, string>> {
    return this.mutex.withLock(roomCode, () => {
      const map = this.reservationsByRoom.get(roomCode);
      if (!map) return {};
      return Object.fromEntries(map);
    });
  }

  async getOrCreateArmCycleId(roomCode: string): Promise<string> {
    return this.mutex.withLock(roomCode, () => {
      let id = this.armCycleByRoom.get(roomCode);
      if (!id) {
        id = randomUUID();
        this.armCycleByRoom.set(roomCode, id);
      }
      return id;
    });
  }

  async cancelPreRoundTicket(input: {
    roomCode: string;
    playerId: string;
    onMutateDisplayCache: () => CancelPreRoundTicketResult | null;
  }): Promise<CancelPreRoundTicketResult | null> {
    const { roomCode, playerId, onMutateDisplayCache } = input;
    return this.mutex.withLock(roomCode, () => {
      // Caller's logic mutates the display cache (which lives in
      // RoomStateManager today — kept there because it's not in the
      // critical orphan path and avoids forcing all display logic
      // through the store on day one). The result tells us whether
      // the player is now fully disarmed.
      const result = onMutateDisplayCache();
      if (!result) return null;

      if (result.fullyDisarmed) {
        // Mirror RoomStateManager.cancelPreRoundTicket's old behavior:
        // disarmPlayer also clears the reservation-mapping. The wallet
        // reservation row itself is released by the caller AFTER this
        // returns (see ticketEvents.ts).
        this.armedTicketsByRoom.get(roomCode)?.delete(playerId);
        this.armedSelectionsByRoom.get(roomCode)?.delete(playerId);
        this.reservationsByRoom.get(roomCode)?.delete(playerId);
      } else {
        // Partial cancel: armedSet's totalWeighted decreases. The
        // selections list inside the cache was already mutated by
        // onMutateDisplayCache — we just update the ticket-count
        // counter. Reservation-mapping stays put because the
        // wallet-side prorata-release happens in the caller.
        this.armedTicketsByRoom
          .get(roomCode)
          ?.set(playerId, result.remainingTicketCount);
      }
      return result;
    });
  }

  async evictWhere(
    predicate: (input: {
      roomCode: string;
      playerId: string;
    }) => boolean | Promise<boolean>,
  ): Promise<EvictPlayerResult[]> {
    // Collect candidates first (without holding any room mutex). Then
    // evict each match while holding only that room's mutex.
    //
    // This matches the legacy `cleanupStaleWalletInIdleRooms` ordering:
    // outer iteration over rooms, inner iteration over (roomCode,
    // playerId). The per-room mutex prevents another mutator from
    // touching state mid-eviction; an addPlayer racing the outer
    // iteration may be missed but that's acceptable — eviction is
    // idempotent and the next sweep catches any new entrants.
    const candidates: Array<{ roomCode: string; playerId: string }> = [];
    // Snapshot armedTickets keys + reservation keys; union them so we
    // catch the rare reservation-only state.
    const roomCodes = new Set<string>();
    for (const code of this.armedTicketsByRoom.keys()) roomCodes.add(code);
    for (const code of this.reservationsByRoom.keys()) roomCodes.add(code);

    for (const roomCode of roomCodes) {
      const armedRoom = this.armedTicketsByRoom.get(roomCode);
      const resRoom = this.reservationsByRoom.get(roomCode);
      const playerIds = new Set<string>();
      if (armedRoom) for (const pid of armedRoom.keys()) playerIds.add(pid);
      if (resRoom) for (const pid of resRoom.keys()) playerIds.add(pid);
      for (const playerId of playerIds) {
        candidates.push({ roomCode, playerId });
      }
    }

    const results: EvictPlayerResult[] = [];
    for (const candidate of candidates) {
      // Re-check predicate inside mutex so we don't evict if a
      // concurrent mutator changed state (e.g. clearReservation
      // ran while we built the candidate list).
      const evictResult = await this.mutex.withLock(candidate.roomCode, async () => {
        const stillEligible = await predicate(candidate);
        if (!stillEligible) return null;
        const cleared = this.clearPlayerStateLocked(
          candidate.roomCode,
          candidate.playerId,
        );
        if (!cleared.hadArmedState && !cleared.hadReservation) {
          // Already evicted between snapshot and predicate check.
          return null;
        }
        storeLog.info(
          {
            roomCode: candidate.roomCode,
            playerId: candidate.playerId,
            hadArmedState: cleared.hadArmedState,
            hadReservation: cleared.hadReservation,
          },
          "roomLifecycleStore.evictWhere",
        );
        return {
          hadArmedState: cleared.hadArmedState,
          hadReservation: cleared.hadReservation,
          releasedReservationId: cleared.reservationId,
        };
      });
      if (evictResult) results.push(evictResult);
    }
    return results;
  }
}

// ── Factory ─────────────────────────────────────────────────────────────

export interface CreateRoomLifecycleStoreOptions {
  /** "memory" — the only provider this synchronous factory creates. */
  provider?: "memory";
  /**
   * Optional pre-allocated Maps to share with `RoomStateManager`. When
   * provided, the store reads/writes through the supplied Maps so
   * existing sync getters on RoomStateManager keep seeing fresh state.
   */
  maps?: RoomLifecycleMaps;
}

/**
 * Construct an in-memory RoomLifecycleStore synchronously. Kept for
 * test ergonomics — production uses {@link
 * "./createRoomLifecycleStore.js".createRoomLifecycleStore} which is
 * async (it eagerly connects to Redis when `ROOM_STATE_PROVIDER=redis`)
 * and returns either the in-memory or Redis impl based on env-flag.
 *
 * If you pass `provider: "redis"` here it will throw — use the async
 * factory in `createRoomLifecycleStore.ts` for that.
 */
export function createRoomLifecycleStore(
  options: CreateRoomLifecycleStoreOptions = {},
): RoomLifecycleStore {
  return new InMemoryRoomLifecycleStore(options.maps);
}
