/**
 * BIN-170: Room state store abstraction.
 *
 * Provides a pluggable storage layer for game room state.
 * - InMemoryRoomStateStore: current behavior (Map-based, no persistence)
 * - RedisRoomStateStore: write-through cache with Redis persistence
 *
 * The store manages serialization of Map/Set fields in RoomState/GameState.
 */

import type {
  RoomState,
  GameState,
  Player,
  Ticket,
  ClaimRecord,
  GameSnapshot,
  RecoverableGameSnapshot,
  RoomSummary,
  PatternDefinition,
  PatternResult,
  JackpotState,
  MiniGameState,
  PendingMiniGameState,
} from "../game/types.js";

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
  /**
   * Spill 1-recovery hardening (2026-05-17): live-room-state-felter som tidligere
   * gikk tapt på Redis-restart. Optional fordi pre-hardening-snapshots i Redis
   * må forbli leselige under rolling deploy. `deserializeGame` lar
   * `undefined`-felter passere uendret.
   *
   * - `patterns` / `patternResults`: pattern-evaluator-state for Rad 1-4 +
   *   Fullt Hus. Uten dette ville klienten miste pattern-progresjon på
   *   recovery midt i en runde.
   * - `participatingPlayerIds` (KRITISK-8): hvilke spillere som er bound til
   *   denne runden — kritisk for payout-binding og compliance-ledger.
   * - `jackpot` / `miniGame`: aktive payout-flows som må overleve restart
   *   (mini-game spillet etter Fullt Hus, SpinnGo-jackpot).
   * - `isPaused` / `pauseMessage` / `pauseUntil` / `pauseReason` (BIN-460,
   *   MED-11): pause-state som master har satt. Uten dette ville et pauset
   *   spill auto-resume etter restart.
   * - `isTestGame` (BIN-463): test-flagg som hindrer real-money-transaksjoner.
   *   Hvis dette gikk tapt på restart kunne en test-runde plutselig debite
   *   ekte wallets.
   * - `spill3PhaseState` (R10 / BIN-820): Spill 3 sequential phase-state-
   *   machine. Uten dette ville Spill 3 restarte fra Rad 1 etter recovery,
   *   selv om runden allerede var i Rad 3.
   */
  patterns?: PatternDefinition[];
  patternResults?: PatternResult[];
  participatingPlayerIds?: string[];
  jackpot?: JackpotState;
  miniGame?: MiniGameState;
  isPaused?: boolean;
  pauseMessage?: string;
  pauseUntil?: string;
  pauseReason?: string;
  isTestGame?: boolean;
  spill3PhaseState?: GameState["spill3PhaseState"];
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
  /**
   * Spill 1-recovery hardening (2026-05-17): kritiske rom-state-felter som
   * tidligere ble droppet av `serializeRoom`/`deserializeRoom`. Tap av disse
   * på Redis-restart ga symptomer som:
   *
   * - `scheduledGameId === undefined`: scheduled Spill 1-rom mistet
   *   bindingen til `app_game1_scheduled_games`-raden. `room:resume`-
   *   validering mot `scheduledGameId` feilet. Klienter måtte reloade.
   * - `isHallShared === undefined`: GoH-rom (Spill 1 per-link, Spill 2/3
   *   global) mistet shared-flagget. `BingoEngine.joinRoom` aktiverte
   *   HALL_MISMATCH-sjekken som skal være relaksert for shared rom →
   *   spillere fra ikke-master-haller ble kastet ut.
   * - `isTestHall === undefined`: demo-haller (`isTestHall=true`) mistet
   *   test-flagget → pattern-evaluator endte runden på Fullt Hus i stedet
   *   for å gå gjennom alle 5 faser, og produksjons-end-on-bingo-oppførsel
   *   trådte inn for haller som skulle vært test-modus.
   * - `pendingMiniGame === undefined`: uspilte mini-games som skulle
   *   overleve `archiveIfEnded`-wipe forsvant ⇒ Tobias prod-incident
   *   2026-04-30 ville reaktiveres.
   *
   * Optional på typen for forward-compat med eldre snapshots; deserialisering
   * defaulter `undefined` til samme verdi som før hardening (ingen endring i
   * adferd hvis feltet mangler).
   */
  scheduledGameId?: string | null;
  isHallShared?: boolean;
  isTestHall?: boolean;
  pendingMiniGame?: PendingMiniGameState;
  players: Record<string, Player>;
  currentGame?: SerializedGameState;
  gameHistory: GameSnapshot[];
  createdAt: string;
}

// ── Serialization helpers ─────────────────────────────────────────────

export function serializeRoom(room: RoomState): SerializedRoomState {
  const serialized: SerializedRoomState = {
    code: room.code,
    hallId: room.hallId,
    hostPlayerId: room.hostPlayerId,
    gameSlug: room.gameSlug,
    players: Object.fromEntries(room.players),
    currentGame: room.currentGame ? serializeGame(room.currentGame) : undefined,
    gameHistory: room.gameHistory,
    createdAt: room.createdAt
  };
  // Spill 1-recovery hardening (2026-05-17): only emit optional fields when
  // they are set, slik at den serialiserte payloaden ikke blåses opp med
  // `undefined`-keys for rom som ikke har scheduled-binding etc.
  if (room.scheduledGameId !== undefined) serialized.scheduledGameId = room.scheduledGameId;
  if (room.isHallShared !== undefined) serialized.isHallShared = room.isHallShared;
  if (room.isTestHall !== undefined) serialized.isTestHall = room.isTestHall;
  if (room.pendingMiniGame !== undefined) serialized.pendingMiniGame = room.pendingMiniGame;
  return serialized;
}

export function deserializeRoom(data: SerializedRoomState): RoomState {
  const room: RoomState = {
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
  // Spill 1-recovery hardening (2026-05-17): bevar optional felter når de
  // finnes i payloaden. Mangler de (pre-hardening Redis-snapshot) lar vi
  // dem være `undefined` slik at adferden matcher pre-hardening default.
  if (data.scheduledGameId !== undefined) room.scheduledGameId = data.scheduledGameId;
  if (data.isHallShared !== undefined) room.isHallShared = data.isHallShared;
  if (data.isTestHall !== undefined) room.isTestHall = data.isTestHall;
  if (data.pendingMiniGame !== undefined) room.pendingMiniGame = data.pendingMiniGame;
  return room;
}

function serializeGame(game: GameState): SerializedGameState {
  const marks: Record<string, number[][]> = {};
  for (const [playerId, sets] of game.marks) {
    marks[playerId] = sets.map((s) => [...s]);
  }
  const serialized: SerializedGameState = {
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
  // Spill 1-recovery hardening (2026-05-17): bevar live-room-felter på
  // tvers av restart. Bare emit når de er satt for å holde payloaden
  // kompakt og forward-compat.
  if (game.patterns !== undefined) serialized.patterns = game.patterns;
  if (game.patternResults !== undefined) serialized.patternResults = game.patternResults;
  if (game.participatingPlayerIds !== undefined) {
    serialized.participatingPlayerIds = [...game.participatingPlayerIds];
  }
  if (game.jackpot !== undefined) serialized.jackpot = game.jackpot;
  if (game.miniGame !== undefined) serialized.miniGame = game.miniGame;
  if (game.isPaused !== undefined) serialized.isPaused = game.isPaused;
  if (game.pauseMessage !== undefined) serialized.pauseMessage = game.pauseMessage;
  if (game.pauseUntil !== undefined) serialized.pauseUntil = game.pauseUntil;
  if (game.pauseReason !== undefined) serialized.pauseReason = game.pauseReason;
  if (game.isTestGame !== undefined) serialized.isTestGame = game.isTestGame;
  if (game.spill3PhaseState !== undefined) {
    // Deep-clone JSON-felter slik at vi ikke deler referanse mellom in-memory
    // og persistert payload — speiler `BingoEngine.serializeGame`-mønsteret.
    serialized.spill3PhaseState = {
      currentPhaseIndex: game.spill3PhaseState.currentPhaseIndex,
      pausedUntilMs: game.spill3PhaseState.pausedUntilMs,
      phasesWon: [...game.spill3PhaseState.phasesWon],
      status: game.spill3PhaseState.status,
      endedReason: game.spill3PhaseState.endedReason,
    };
  }
  return serialized;
}

function deserializeGame(data: SerializedGameState): GameState {
  const marks = new Map<string, Set<number>[]>();
  for (const [playerId, arrays] of Object.entries(data.marks)) {
    marks.set(playerId, arrays.map((arr) => new Set(arr)));
  }
  const game: GameState = {
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
  if (data.patterns !== undefined) game.patterns = data.patterns;
  if (data.patternResults !== undefined) game.patternResults = data.patternResults;
  if (data.participatingPlayerIds !== undefined) {
    game.participatingPlayerIds = [...data.participatingPlayerIds];
  }
  if (data.jackpot !== undefined) game.jackpot = data.jackpot;
  if (data.miniGame !== undefined) game.miniGame = data.miniGame;
  if (data.isPaused !== undefined) game.isPaused = data.isPaused;
  if (data.pauseMessage !== undefined) game.pauseMessage = data.pauseMessage;
  if (data.pauseUntil !== undefined) game.pauseUntil = data.pauseUntil;
  if (data.pauseReason !== undefined) game.pauseReason = data.pauseReason;
  if (data.isTestGame !== undefined) game.isTestGame = data.isTestGame;
  if (data.spill3PhaseState !== undefined) {
    game.spill3PhaseState = {
      currentPhaseIndex: data.spill3PhaseState.currentPhaseIndex,
      pausedUntilMs: data.spill3PhaseState.pausedUntilMs,
      phasesWon: [...data.spill3PhaseState.phasesWon],
      status: data.spill3PhaseState.status,
      endedReason: data.spill3PhaseState.endedReason,
    };
  }
  return game;
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
