/**
 * BIN-170: Room state store abstraction.
 *
 * Provides a pluggable storage layer for game room state.
 * - InMemoryRoomStateStore: current behavior (Map-based, no persistence)
 * - RedisRoomStateStore: write-through cache with Redis persistence
 *
 * The store manages serialization of Map/Set fields in RoomState/GameState.
 */

import type { RoomState, GameState, Player, Ticket, ClaimRecord, GameSnapshot, RecoverableGameSnapshot, RoomSummary } from "../game/types.js";

// ── Serializable versions (no Map/Set) ────────────────────────────────

export interface SerializedGameState {
  id: string;
  status: "WAITING" | "RUNNING" | "ENDED";
  entryFee: number;
  ticketsPerPlayer: number;
  prizePool: number;
  remainingPrizePool: number;
  payoutPercent: number;
  maxPayoutBudget: number;
  remainingPayoutBudget: number;
  drawBag: number[];
  drawnNumbers: number[];
  tickets: Record<string, Ticket[]>;
  marks: Record<string, number[][]>;
  claims: ClaimRecord[];
  lineWinnerId?: string;
  bingoWinnerId?: string;
  startedAt: string;
  endedAt?: string;
  endedReason?: string;
}

export interface SerializedRoomState {
  code: string;
  hallId: string;
  hostPlayerId: string;
  /**
   * BIN-672: optional here so pre-BIN-672 snapshots in Redis stay readable
   * during rolling deploy. `deserializeRoom` defaults missing values to
   * "bingo" for backward compatibility.
   */
  gameSlug?: string;
  players: Record<string, Player>;
  currentGame?: SerializedGameState;
  gameHistory: GameSnapshot[];
  createdAt: string;
}

// ── Serialization helpers ─────────────────────────────────────────────

export function serializeRoom(room: RoomState): SerializedRoomState {
  return {
    code: room.code,
    hallId: room.hallId,
    hostPlayerId: room.hostPlayerId,
    gameSlug: room.gameSlug,
    players: Object.fromEntries(room.players),
    currentGame: room.currentGame ? serializeGame(room.currentGame) : undefined,
    gameHistory: room.gameHistory,
    createdAt: room.createdAt
  };
}

export function deserializeRoom(data: SerializedRoomState): RoomState {
  return {
    code: data.code,
    hallId: data.hallId,
    hostPlayerId: data.hostPlayerId,
    // BIN-672: fall back to "bingo" for pre-BIN-672 snapshots (missing field)
    // — matches DB default for game_sessions.game_slug.
    gameSlug: data.gameSlug ?? "bingo",
    players: new Map(Object.entries(data.players)),
    currentGame: data.currentGame ? deserializeGame(data.currentGame) : undefined,
    gameHistory: data.gameHistory,
    createdAt: data.createdAt
  };
}

function serializeGame(game: GameState): SerializedGameState {
  const marks: Record<string, number[][]> = {};
  for (const [playerId, sets] of game.marks) {
    marks[playerId] = sets.map((s) => [...s]);
  }
  return {
    id: game.id,
    status: game.status,
    entryFee: game.entryFee,
    ticketsPerPlayer: game.ticketsPerPlayer,
    prizePool: game.prizePool,
    remainingPrizePool: game.remainingPrizePool,
    payoutPercent: game.payoutPercent,
    maxPayoutBudget: game.maxPayoutBudget,
    remainingPayoutBudget: game.remainingPayoutBudget,
    drawBag: game.drawBag,
    drawnNumbers: game.drawnNumbers,
    tickets: Object.fromEntries(game.tickets),
    marks,
    claims: game.claims,
    lineWinnerId: game.lineWinnerId,
    bingoWinnerId: game.bingoWinnerId,
    startedAt: game.startedAt,
    endedAt: game.endedAt,
    endedReason: game.endedReason
  };
}

function deserializeGame(data: SerializedGameState): GameState {
  const marks = new Map<string, Set<number>[]>();
  for (const [playerId, arrays] of Object.entries(data.marks)) {
    marks.set(playerId, arrays.map((arr) => new Set(arr)));
  }
  return {
    id: data.id,
    status: data.status,
    entryFee: data.entryFee,
    ticketsPerPlayer: data.ticketsPerPlayer,
    prizePool: data.prizePool,
    remainingPrizePool: data.remainingPrizePool,
    payoutPercent: data.payoutPercent,
    maxPayoutBudget: data.maxPayoutBudget,
    remainingPayoutBudget: data.remainingPayoutBudget,
    drawBag: data.drawBag,
    drawnNumbers: data.drawnNumbers,
    tickets: new Map(Object.entries(data.tickets)),
    marks,
    claims: data.claims,
    lineWinnerId: data.lineWinnerId,
    bingoWinnerId: data.bingoWinnerId,
    startedAt: data.startedAt,
    endedAt: data.endedAt,
    endedReason: data.endedReason
  };
}

// ── Recovery deserialization ─────────────────────────────────────────

/** KRITISK-5/6: Reconstruct a full GameState from a RecoverableGameSnapshot (checkpoint recovery). */
export function deserializeRecoverableSnapshot(snap: RecoverableGameSnapshot): GameState {
  const marks = new Map<string, Set<number>[]>();
  for (const [playerId, arrays] of Object.entries(snap.structuredMarks)) {
    marks.set(playerId, arrays.map(arr => new Set(arr)));
  }
  return {
    id: snap.id,
    status: snap.status,
    entryFee: snap.entryFee,
    ticketsPerPlayer: snap.ticketsPerPlayer,
    prizePool: snap.prizePool,
    remainingPrizePool: snap.remainingPrizePool,
    payoutPercent: snap.payoutPercent,
    maxPayoutBudget: snap.maxPayoutBudget,
    remainingPayoutBudget: snap.remainingPayoutBudget,
    drawBag: [...snap.drawBag],
    drawnNumbers: [...snap.drawnNumbers],
    tickets: new Map(Object.entries(snap.tickets)),
    marks,
    claims: [...snap.claims],
    lineWinnerId: snap.lineWinnerId,
    bingoWinnerId: snap.bingoWinnerId,
    participatingPlayerIds: snap.participatingPlayerIds,
    startedAt: snap.startedAt,
    endedAt: snap.endedAt,
    endedReason: snap.endedReason,
  };
}

// ── Errors ────────────────────────────────────────────────────────────

/**
 * ADR-0019 P0-2: thrown by `setAndPersist()` when the synchronous persist
 * to the backing store fails. Critical paths catch this and decide whether
 * to:
 *   - propagate (fail-closed) — preserve regulatorisk consistency,
 *   - log + degrade — pilot prefers fail-closed for state-binding paths.
 *
 * The original cause is preserved in `cause` (Error.cause / ES2022).
 */
export class RoomStatePersistError extends Error {
  override readonly name = "RoomStatePersistError";
  constructor(
    public readonly roomCode: string,
    cause: unknown,
  ) {
    super(
      `Failed to persist room ${roomCode} to backing store synchronously`,
      // Spread for cause-friendly construction without breaking older runtimes.
      cause instanceof Error ? { cause } : undefined,
    );
  }
}

// ── Store interface ───────────────────────────────────────────────────

export interface RoomStateStore {
  get(code: string): RoomState | undefined;
  /**
   * BIN-170: write-through to in-memory cache. For Redis-backed stores
   * this schedules a fire-and-forget persist — the in-memory state is
   * authoritative until `persist()` / `setAndPersist()` confirms the
   * Redis write.
   *
   * Use for non-critical mutations (cleanup, eviction, heartbeat). For
   * regulatorisk-kritiske paths (room creation, scheduled-game binding,
   * isHallShared flip) use {@link setAndPersist} instead — see ADR-0019.
   */
  set(code: string, room: RoomState): void;
  /**
   * ADR-0019 P0-2: write to in-memory cache AND await the persist to the
   * backing store. Throws {@link RoomStatePersistError} on failure so
   * critical paths can decide between fail-closed (re-throw) and
   * fail-degraded (log + continue).
   *
   * Use for:
   *   - room creation (RoomLifecycleService.createRoom)
   *   - scheduledGameId binding (setScheduledGameId)
   *   - isHallShared / isTestHall flag flips that affect routing
   *   - post-checkpoint state-binding paths
   *
   * In-memory store: this is a no-op-equivalent (memory is the source of
   * truth, no separate persist target). It still goes through the same
   * async signature for caller-symmetry.
   */
  setAndPersist(code: string, room: RoomState): Promise<void>;
  delete(code: string): void;
  has(code: string): boolean;
  keys(): IterableIterator<string>;
  values(): IterableIterator<RoomState>;
  readonly size: number;

  /** Persist current state to backing store (no-op for in-memory). */
  persist(code: string): Promise<void>;

  /** Load all rooms from backing store into memory (startup recovery). */
  loadAll(): Promise<number>;

  /** Shutdown: flush pending writes. */
  shutdown(): Promise<void>;
}

// ── In-memory implementation ──────────────────────────────────────────

export class InMemoryRoomStateStore implements RoomStateStore {
  private readonly rooms = new Map<string, RoomState>();

  get(code: string): RoomState | undefined { return this.rooms.get(code); }
  set(code: string, room: RoomState): void { this.rooms.set(code, room); }
  /**
   * ADR-0019 P0-2: for in-memory store, memory IS the backing store.
   * `setAndPersist` reduces to `set` + `Promise.resolve()` so callers can
   * use the same await-pattern for both store-types.
   */
  async setAndPersist(code: string, room: RoomState): Promise<void> {
    this.rooms.set(code, room);
  }
  delete(code: string): void { this.rooms.delete(code); }
  has(code: string): boolean { return this.rooms.has(code); }
  keys(): IterableIterator<string> { return this.rooms.keys(); }
  values(): IterableIterator<RoomState> { return this.rooms.values(); }
  get size(): number { return this.rooms.size; }

  async persist(): Promise<void> { /* no-op */ }
  async loadAll(): Promise<number> { return 0; }
  async shutdown(): Promise<void> { /* no-op */ }
}
