/**
 * RoomLifecycleService — extracted from BingoEngine.ts in F2-C
 * (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §3.3 / HV-3).
 *
 * Owns the **room-lifecycle flow** that was previously inline on BingoEngine:
 *   - `createRoom` — generate code, build hostPlayer, ensure wallet account, persist.
 *   - `joinRoom`   — validate hall match (HALL_MISMATCH), wallet guards, append player.
 *   - `destroyRoom` — guard against in-progress games, atomic K2 evict + cleanup
 *     of per-room caches via callback.
 *   - `getRoomSnapshot` / `listRoomSummaries` — read-side projections.
 *
 * **Responsibilities:**
 *   - Validation: `assertHallId` / `assertPlayerName` on inputs (delegated via
 *     callbacks because the helpers also enforce length limits used elsewhere
 *     in BingoEngine).
 *   - Wallet guards: `assertWalletAllowedForGameplay` (KYC/play-block),
 *     `assertWalletNotInRunningGame` (cross-room dup check),
 *     `assertWalletNotAlreadyInRoom` (within-room dup check).
 *   - Wallet account materialization: `walletAdapter.ensureAccount` +
 *     `getAvailableBalance` (or fallback `getBalance`).
 *   - Build the `RoomState` record (hallId, hostPlayerId, gameSlug,
 *     isHallShared, isTestHall) and host `Player` record.
 *   - Atomic K2 cleanup on `destroyRoom`: route every player through
 *     `lifecycleStore.evictPlayer({ releaseReservation: true })` via the
 *     caller-supplied `releaseAndForgetEviction` so orphan reservations
 *     never strand on room destroy.
 *   - Structured `room.created` + `room.player.joined` log events.
 *
 * **NOT this service's responsibility:**
 *   - Mutating engine-internal Maps that aren't keyed by room (e.g.
 *     `variantConfigByRoom`, `luckyNumbersByPlayer`, `lastDrawAtByRoom`,
 *     `drawLocksByRoom`, `roomLastRoundStartMs`). The caller passes a
 *     `cleanupRoomLocalCaches` callback so the service stays decoupled
 *     from concrete cache lists.
 *   - `requireRoom` lookups for OTHER engine methods (those stay on
 *     `BingoEngine` and are still used by `markRoomAsScheduled`,
 *     `submitClaim`, etc).
 *   - `serializeRoom` / `serializeGame` — the service receives a
 *     callback that produces `RoomSnapshot` so the engine retains
 *     control over how `currentGame` is projected.
 *   - K2 `disarmAllPlayers` for arm-cycle cleanup — invoked via
 *     callback because the lifecycleStore is optional in tests and
 *     the engine wraps the call in `void` to avoid blocking on it.
 *
 * Behavior is fully equivalent to the pre-extraction inline logic. All
 * log fields, error codes, and idempotency semantics are preserved
 * byte-for-byte.
 *
 * Note: BingoEngine still wraps `createRoom`/`joinRoom`/`destroyRoom`/
 * `listRoomSummaries`/`getRoomSnapshot` as thin delegates so the public
 * API (and Game2Engine/Game3Engine inheritance) is unchanged.
 */

import { randomUUID } from "node:crypto";
import { logger as rootLogger } from "../util/logger.js";
import { logRoomEvent } from "../util/roomLogVerbose.js";
import { makeRoomCode } from "./ticket.js";
import { isCanonicalRoomCode } from "../util/canonicalRoomCode.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { RoomStateStore } from "../store/RoomStateStore.js";
import type {
  Player,
  RoomSnapshot,
  RoomState,
  RoomSummary,
} from "./types.js";
import { DomainError } from "../errors/DomainError.js";

const logger = rootLogger.child({ module: "room-lifecycle-service" });

/**
 * Inputs accepted by {@link RoomLifecycleService.createRoom}. Mirrors the
 * inline `CreateRoomInput` interface in `BingoEngine.ts` so the engine can
 * pass through unchanged.
 */
export interface RoomLifecycleCreateInput {
  playerName: string;
  hallId: string;
  walletId?: string;
  socketId?: string;
  /** Optional fixed room code (e.g. "BINGO1"). Skips random generation. */
  roomCode?: string;
  /** Game variant slug (e.g. "bingo", "rocket"). Stored on the room. */
  gameSlug?: string;
  /**
   * shared hall-room (Spill 2/3). Hvis `null` markeres rommet som
   * hall-shared via `RoomState.isHallShared=true` og `joinRoom` skipper
   * HALL_MISMATCH-sjekken. Hvis `undefined` er det per-hall-rom.
   */
  effectiveHallId?: string | null;
  /** Demo Hall bypass: `RoomState.isTestHall=true` slik at engine bypasser
   *  end-on-bingo / auto-pause for test-haller. */
  isTestHall?: boolean;
}

/**
 * Inputs accepted by {@link RoomLifecycleService.joinRoom}. Identical shape
 * to {@link RoomLifecycleCreateInput} but `roomCode` is required.
 */
export interface RoomLifecycleJoinInput extends RoomLifecycleCreateInput {
  roomCode: string;
}

/**
 * Engine-internal helpers that the service needs but cannot easily own
 * itself (they touch private engine state — assertion helpers, K2
 * lifecycle store, per-room cache cleanup).
 *
 * Same callback-port pattern used by {@link EvaluatePhaseCallbacks} +
 * {@link ClaimSubmitterCallbacks}.
 */
export interface RoomLifecycleCallbacks {
  /** Validate + normalize a non-empty hall-id (max 120 chars). */
  assertHallId(hallId: string): string;
  /** Validate + normalize a non-empty, ≤24-char player name. */
  assertPlayerName(playerName: string): string;
  /**
   * Pre-create / pre-join spillevett guard — KYC, self-exclusion, daily/
   * monthly loss-limit, play-session pause. Throws `WALLET_BLOCKED` if
   * disallowed.
   */
  assertWalletAllowedForGameplay(walletId: string, nowMs: number): void;
  /**
   * Cross-room duplicate guard — refuses if the wallet is already part of
   * another RUNNING game. Optional `exceptRoomCode` skips one room (used
   * when re-joining the room you're already host of).
   */
  assertWalletNotInRunningGame(walletId: string, exceptRoomCode?: string): void;
  /** Within-room duplicate guard — refuses if the wallet is already a player
   *  in this specific room. */
  assertWalletNotAlreadyInRoom(room: RoomState, walletId: string): void;
  /**
   * Project a `RoomState` into a `RoomSnapshot`. Engine-owned because the
   * snapshot embeds `serializeGame` which has its own helper coupling.
   */
  serializeRoom(room: RoomState): RoomSnapshot;
  /**
   * BIN-251: After a structural mutation (createRoom / destroyRoom),
   * sync to the optional external store (e.g. Redis).
   */
  syncRoomToStore(room: RoomState): void;
  /**
   * K2 atomic eviction. Releases armed-state + reservation atomically via
   * `lifecycleStore.evictPlayer({ releaseReservation: true })` and
   * fire-and-forgets `walletAdapter.releaseReservation` on the resulting
   * reservation-id. No-op when the engine has no `lifecycleStore`.
   */
  releaseAndForgetEviction(
    roomCode: string,
    playerId: string,
    walletId: string,
  ): void;
  /**
   * K2 disarm-all entry-point. Called once per `destroyRoom` to clear the
   * arm-cycle for the room. Returns void because the engine wraps the
   * underlying promise in `void` (fire-and-forget).
   */
  disarmAllPlayersForRoom(roomCode: string): void;
  /**
   * Engine-local per-room cache eviction (variantConfigByRoom,
   * luckyNumbersByPlayer, lastDrawAtByRoom, drawLocksByRoom,
   * roomLastRoundStartMs, roomStateStore.delete). Owned by the engine
   * because the concrete Map list keeps growing; the service stays
   * decoupled from it.
   */
  cleanupRoomLocalCaches(roomCode: string): void;
}

/**
 * Stand-alone room-lifecycle service. Constructed once per BingoEngine
 * instance. No internal state — every input is explicit; mutations land
 * on the supplied `rooms` store.
 */
export class RoomLifecycleService {
  constructor(
    private readonly walletAdapter: WalletAdapter,
    private readonly rooms: RoomStateStore,
    private readonly callbacks: RoomLifecycleCallbacks,
  ) {}

  /**
   * Create a fresh room with the caller as host-player.
   *
   * Behavior is byte-identical to the pre-extraction inline implementation:
   *   - Wallet KYC/play-block check.
   *   - Cross-room duplicate guard (no `exceptRoomCode` — host can't already
   *     be in a running game).
   *   - `walletAdapter.ensureAccount` (errors propagate as-is so callers see
   *     the original wallet-tjeneste-melding).
   *   - `getAvailableBalance` preferred over `getBalance` (BIN-693 — klient-
   *     visning matcher det som faktisk er tilgjengelig).
   *   - Random room-code unless caller passes a fixed `roomCode` that
   *     doesn't already exist.
   *   - `effectiveHallId === null` → mark room as hall-shared.
   *   - `isTestHall === true` → mark room as test-hall.
   *   - Two structured log events: `room.created` + `room.player.joined`
   *     (LIVE_ROOM_OBSERVABILITY 2026-04-29).
   *
   * @throws Wallet errors propagate untouched.
   * @throws `DomainError("INVALID_HALL_ID" | "INVALID_NAME" | …)` from the
   *   assertion helpers in callbacks.
   */
  async createRoom(
    input: RoomLifecycleCreateInput,
  ): Promise<{ roomCode: string; playerId: string }> {
    const hallId = this.callbacks.assertHallId(input.hallId);
    const playerId = randomUUID();
    const walletId = input.walletId?.trim() || `wallet-${playerId}`;
    logger.debug(
      { hallId, walletId, playerName: input.playerName },
      "createRoom start",
    );
    this.callbacks.assertWalletAllowedForGameplay(walletId, Date.now());
    this.callbacks.assertWalletNotInRunningGame(walletId);
    try {
      logger.debug({ walletId }, "ensureAccount start");
      await this.walletAdapter.ensureAccount(walletId);
      logger.debug({ walletId }, "ensureAccount OK");
    } catch (err) {
      logger.error({ walletId, err }, "ensureAccount FAILED");
      throw err;
    }
    let balance: number;
    try {
      // BIN-693: bruker available_balance så klient-visning matcher det som
      // faktisk er tilgjengelig (total − sum av aktive reservations).
      logger.debug({ walletId }, "getAvailableBalance start");
      balance = this.walletAdapter.getAvailableBalance
        ? await this.walletAdapter.getAvailableBalance(walletId)
        : await this.walletAdapter.getBalance(walletId);
      logger.debug({ walletId, balance }, "getAvailableBalance OK");
    } catch (err) {
      logger.error({ walletId, err }, "getAvailableBalance FAILED");
      throw err;
    }

    const player: Player = {
      id: playerId,
      name: this.callbacks.assertPlayerName(input.playerName),
      walletId,
      balance,
      socketId: input.socketId,
      hallId,
    };

    // Tobias-direktiv 2026-05-04 (room-uniqueness invariant): hvis caller
    // har bedt om en KANONISK rom-kode (BINGO_*, ROCKET, MONSTERBINGO) og
    // den allerede finnes i `this.rooms`, IKKE fall tilbake til en random-
    // generert kode — det skaper duplikat-rom for samme slug-invariant.
    // Race-eksempel: Hall A og Hall B kaller `createRoom({roomCode:"ROCKET"})`
    // samtidig; A vinner racet og setter `ROCKET`, B faller her igjennom og
    // havner i `makeRoomCode()` → ny random kode for samme rocket-slug.
    // Resultat: to ROCKET-rom som spillere kan splitte seg mellom.
    //
    // Korrekt oppførsel: kast ROOM_ALREADY_EXISTS så caller (room:create-
    // handler) kan re-loope tilbake til `findRoomByCode` og joine det
    // eksisterende rommet i stedet. For non-canonical codes (legacy random,
    // tester med eksplisitt code) beholder vi den gamle fall-back-oppførselen.
    const existingCodes = new Set(this.rooms.keys());
    let code: string;
    if (input.roomCode && existingCodes.has(input.roomCode)) {
      if (isCanonicalRoomCode(input.roomCode)) {
        throw new DomainError(
          "ROOM_ALREADY_EXISTS",
          `Kanonisk rom ${input.roomCode} finnes allerede. Bruk findRoomByCode + joinRoom i stedet.`,
        );
      }
      // Legacy non-canonical fallback: generer random kode (eksisterende
      // oppførsel for tester og random-coded rom).
      code = makeRoomCode(existingCodes);
    } else if (input.roomCode) {
      code = input.roomCode;
    } else {
      code = makeRoomCode(existingCodes);
    }
    // Tobias 2026-04-27: Spill 2/3 sender `effectiveHallId: null` for shared
    // global rooms. Vi beholder opprettende hall i `room.hallId` (audit) men
    // setter `isHallShared=true` så `joinRoom` skipper HALL_MISMATCH.
    const isHallShared = input.effectiveHallId === null;
    // Demo Hall bypass (Tobias 2026-04-27): caller (typisk join-handler i
    // socket-laget) sender flagget basert på PlatformService.getHall.isTestHall.
    // Engine selv slår ikke opp i DB her — vi holder createRoom synkron mot
    // wallet og lar caller composere hall-info.
    const isTestHall = input.isTestHall === true;
    const room: RoomState = {
      code,
      hallId,
      hostPlayerId: playerId,
      // BIN-672: gameSlug is REQUIRED on RoomState. Default to "bingo" when
      // caller omitted — matches game_sessions.game_slug DB default and
      // reflects that this platform only ships Bingo right now.
      gameSlug: input.gameSlug?.trim() || "bingo",
      createdAt: new Date().toISOString(),
      players: new Map([[playerId, player]]),
      gameHistory: [],
      ...(isHallShared ? { isHallShared: true } : {}),
      ...(isTestHall ? { isTestHall: true } : {}),
    };

    this.rooms.set(code, room);
    this.callbacks.syncRoomToStore(room); // BIN-251
    // LIVE_ROOM_OBSERVABILITY 2026-04-29: structured INFO-log slik at ops kan
    // grep room.created i Render-loggen og se hvem som åpnet rommet, hall,
    // canonical-kode + om det er test-hall. Tidligere ble dette begravd bak
    // logger.debug — useless ved post-mortem av prod-incident.
    logRoomEvent(
      logger,
      {
        roomCode: code,
        hallId,
        gameSlug: room.gameSlug,
        hostPlayerId: playerId,
        walletId,
        isTestHall: isTestHall || undefined,
        isHallShared: isHallShared || undefined,
      },
      "room.created",
    );
    logRoomEvent(
      logger,
      {
        roomCode: code,
        playerId,
        walletId,
        socketId: input.socketId ?? null,
        hallId,
        role: "host",
      },
      "room.player.joined",
    );
    return { roomCode: code, playerId };
  }

  /**
   * Add a guest-player to an existing room.
   *
   * Behavior is byte-identical to the pre-extraction inline implementation:
   *   - Required `roomCode` (already trimmed + uppercased).
   *   - HALL_MISMATCH guard, skipped for `room.isHallShared` (Spill 2/3).
   *   - Wallet KYC/play-block + cross-room dup (with `exceptRoomCode` so
   *     the same wallet can re-join the room they're already in via
   *     reconnect — current room is skipped from the cross-room search).
   *   - Within-room dup guard (`PLAYER_ALREADY_IN_ROOM`).
   *   - `walletAdapter.ensureAccount` + `getBalance` (NB: this path uses
   *     `getBalance` rather than `getAvailableBalance` — preserved 1:1).
   *   - Single `room.player.joined` log event.
   *
   * @throws `DomainError("ROOM_NOT_FOUND")` if `roomCode` does not exist.
   * @throws `DomainError("HALL_MISMATCH")` for hall-restricted rooms.
   * @throws Wallet errors propagate untouched.
   */
  async joinRoom(
    input: RoomLifecycleJoinInput,
  ): Promise<{ roomCode: string; playerId: string }> {
    const roomCode = input.roomCode.trim().toUpperCase();
    const hallId = this.callbacks.assertHallId(input.hallId);
    const room = this.requireRoom(roomCode);
    // Tobias 2026-04-27: shared rooms (Spill 2/3 — ROCKET / MONSTERBINGO) er
    // GLOBALE og deles av alle haller — skip HALL_MISMATCH-sjekken.
    //
    // 2026-05-04 (Tobias-direktiv) defense-in-depth: legacy ROCKET/MONSTERBINGO-
    // rom på prod kan ha `isHallShared = undefined` (gammel data fra før
    // PILOT-STOP-SHIP-fix 2026-04-27). Sjekk gameSlug i tillegg så hall-
    // mismatch aldri kastes for rocket/monsterbingo uansett lagret state.
    const sharedSlugs = new Set(["rocket", "game_2", "tallspill", "monsterbingo", "mønsterbingo", "game_3"]);
    const isSharedSlug = sharedSlugs.has((room.gameSlug ?? "").toLowerCase());
    const isShared = room.isHallShared === true || isSharedSlug;
    if (!isShared && room.hallId !== hallId) {
      throw new DomainError("HALL_MISMATCH", "Rommet tilhører en annen hall.");
    }

    const playerId = randomUUID();
    const walletId = input.walletId?.trim() || `wallet-${playerId}`;
    this.callbacks.assertWalletAllowedForGameplay(walletId, Date.now());
    this.callbacks.assertWalletNotInRunningGame(walletId, roomCode);
    this.callbacks.assertWalletNotAlreadyInRoom(room, walletId);
    await this.walletAdapter.ensureAccount(walletId);
    const balance = await this.walletAdapter.getBalance(walletId);

    room.players.set(playerId, {
      id: playerId,
      name: this.callbacks.assertPlayerName(input.playerName),
      walletId,
      balance,
      socketId: input.socketId,
      hallId,
    });

    logRoomEvent(
      logger,
      {
        roomCode,
        playerId,
        walletId,
        socketId: input.socketId ?? null,
        hallId,
        role: "guest",
      },
      "room.player.joined",
    );
    return { roomCode, playerId };
  }

  /**
   * Tear down a room and its derived state.
   *
   * Behavior is byte-identical to the pre-extraction inline implementation:
   *   - `ROOM_NOT_FOUND` if the code is unknown.
   *   - `GAME_IN_PROGRESS` if `room.currentGame.status === "RUNNING"` —
   *     callers must `endGame` first (also blocks the post-pilot scheduled
   *     bridge from yanking the rug under an active draw).
   *   - K2 cleanup: every player goes through `releaseAndForgetEviction`
   *     (releasing armed-state + reservation atomically, then fire-and-
   *     forget `walletAdapter.releaseReservation`) before the room is
   *     deleted.
   *   - K2 arm-cycle cleanup via `disarmAllPlayersForRoom` (engine wraps
   *     in `void` to avoid blocking on the underlying promise).
   *   - Engine-local per-room caches (variantConfigByRoom,
   *     luckyNumbersByPlayer, drawLocksByRoom, lastDrawAtByRoom,
   *     roomLastRoundStartMs, roomStateStore) cleared via
   *     `cleanupRoomLocalCaches` callback.
   *   - Final `this.rooms.delete(code)`.
   *
   * @throws `DomainError("ROOM_NOT_FOUND" | "GAME_IN_PROGRESS")`.
   */
  destroyRoom(roomCode: string): void {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new DomainError("ROOM_NOT_FOUND", `Rom ${code} finnes ikke.`);
    }
    if (room.currentGame && room.currentGame.status === "RUNNING") {
      throw new DomainError(
        "GAME_IN_PROGRESS",
        `Kan ikke slette rom ${code} mens en runde pågår.`,
      );
    }
    // K2 (2026-04-29) — FORHANDSKJOP §7.5: pre-K2 destroyRoom evicted from
    // engine.rooms but never touched RoomStateManager / lifecycleStore,
    // leaving armed-state + reservation-mappings + arm-cycle stranded
    // until process restart. Now we evict each player atomically before
    // deleting the room, releasing any orphan reservations along the way.
    for (const player of room.players.values()) {
      this.callbacks.releaseAndForgetEviction(code, player.id, player.walletId);
    }
    // Clear arm-cycle for the room (no public API for this — disarm-all
    // via the store handles it as a side effect).
    this.callbacks.disarmAllPlayersForRoom(code);

    this.rooms.delete(code);
    this.callbacks.cleanupRoomLocalCaches(code);
  }

  /**
   * Return a list of read-side room summaries sorted by code.
   *
   * Mirrors the inline implementation byte-for-byte: maps every
   * `RoomState` into the small `RoomSummary` shape and sorts by
   * `code.localeCompare`.
   */
  listRoomSummaries(): RoomSummary[] {
    return [...this.rooms.values()]
      .map((room) => {
        const gameStatus: RoomSummary["gameStatus"] = room.currentGame
          ? room.currentGame.status
          : "NONE";
        return {
          code: room.code,
          hallId: room.hallId,
          hostPlayerId: room.hostPlayerId,
          gameSlug: room.gameSlug,
          playerCount: room.players.size,
          createdAt: room.createdAt,
          gameStatus,
          ...(room.isHallShared ? { isHallShared: true } : {}),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Return a full `RoomSnapshot` for a given code.
   *
   * Mirrors the inline `getRoomSnapshot` byte-for-byte: trims +
   * uppercases the code, requires the room (throws `ROOM_NOT_FOUND`
   * if missing), and projects via `callbacks.serializeRoom`.
   */
  getRoomSnapshot(roomCode: string): RoomSnapshot {
    const room = this.requireRoom(roomCode.trim().toUpperCase());
    return this.callbacks.serializeRoom(room);
  }

  /**
   * Internal helper — kept on this service so `joinRoom` and
   * `getRoomSnapshot` don't need to round-trip through the engine for a
   * basic Map-lookup. Throws `ROOM_NOT_FOUND` with the same Norwegian
   * message as `BingoEngine.requireRoom`.
   */
  private requireRoom(roomCode: string): RoomState {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new DomainError("ROOM_NOT_FOUND", "Rommet finnes ikke.");
    }
    return room;
  }
}
