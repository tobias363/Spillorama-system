/**
 * GAP #38: Player-initiated stop-game (Spillvett-vote).
 *
 * Pengespillforskriften gives players the right to stop a game they're in via
 * Spillvett-vote. Legacy `Game/Game1/Controllers/GameController.js:3212`
 * (`stopGameByPlayers`) had no real voting — a single hall-IP-matched
 * player could stop the game. That naive flow doesn't survive web/mobile
 * (no shared LAN IP), so we replace it with an explicit threshold-based
 * vote per running round.
 *
 * Design (regulatorisk fail-closed):
 *   - Voter must be authenticated and a player in the room snapshot.
 *   - Voting is only allowed while a game is RUNNING (status === "RUNNING").
 *   - Each player can only vote ONCE per round (idempotent — re-vote is
 *     accepted but does not double-count).
 *   - Threshold = ceil(playerCount × thresholdPercent / 100). Configurable
 *     via `BINGO_STOP_VOTE_THRESHOLD_PERCENT` env (default 50 = simple
 *     majority). Minimum 1 vote for single-player rooms — preserves legacy
 *     parity where one player could trigger a stop.
 *   - When threshold is reached:
 *       1) `endGame` is called via injected `stopGame` callback (which
 *          orchestrates engine.endGame + reservation refunds).
 *       2) All votes for this round are cleared so a fresh round starts
 *          with a clean slate.
 *       3) Audit-log entry `spillevett.stop_game.threshold_reached`.
 *   - Each individual vote produces an audit-log entry
 *     `spillevett.stop_game.vote` so compliance can reconstruct who voted
 *     when, even if the threshold is never reached.
 *   - In-memory state. A round only lives in memory between game:start and
 *     game:end / threshold-reached, so persistence isn't required (vote
 *     counts evaporate on restart, same as engine state).
 *
 * Concurrency:
 *   - Each vote runs through a per-room async lock (Promise chain) so two
 *     players voting simultaneously can't both pass the threshold and
 *     trigger double-stop. Without the lock, a 2-player room with
 *     threshold=1 would double-fire stopGame on near-simultaneous votes.
 *
 * Threshold rule chosen: 50% (ceil) by default, override via env. The
 * legacy controller had no real voting, so this is a forward-looking
 * design rather than a 1:1 port.
 */

import type { BingoEngine } from "../game/BingoEngine.js";
import { DomainError } from "../game/BingoEngine.js";
import type { RoomSnapshot } from "../game/types.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "spillevett.stop-vote" });

export interface StopGameRefundCallback {
  /**
   * Called after the threshold is reached, post-engine.endGame, with the
   * list of player ids whose pre-round / running reservations should be
   * released (see `releaseReservation` in WalletAdapter — Option B). The
   * service swallows individual release errors and reports a summary.
   */
  (input: {
    roomCode: string;
    triggeringPlayerId: string;
    voteCount: number;
    threshold: number;
    playerIds: string[];
  }): Promise<void>;
}

export interface Spill1StopVoteServiceOptions {
  engine: BingoEngine;
  auditLogService?: AuditLogService;
  walletAdapter?: WalletAdapter;
  /**
   * Optional reservation lookup. When set, the service collects each
   * voter's active reservation id and releases it via
   * `walletAdapter.releaseReservation` after the threshold is reached.
   * Without it (test harness), the service only fires audit + endGame.
   */
  getReservationId?: (roomCode: string, playerId: string) => string | null;
  clearReservationId?: (roomCode: string, playerId: string) => void;
  /**
   * Threshold as a percent of playerCount, 1-100. Default 50 (simple
   * majority). Reads `BINGO_STOP_VOTE_THRESHOLD_PERCENT` env if not set
   * explicitly. Values outside [1, 100] are clamped at construction time.
   */
  thresholdPercent?: number;
}

export interface VoteResult {
  /** True when the vote was newly recorded; false when already counted. */
  recorded: boolean;
  voteCount: number;
  threshold: number;
  playerCount: number;
  /** True when this vote tipped the threshold — game was stopped. */
  thresholdReached: boolean;
}

interface RoundVoteState {
  /** Game id this vote-state belongs to — clears when a new round starts. */
  gameId: string;
  /** Set of playerIds that have voted — idempotency. */
  voters: Set<string>;
  /** Promise chain for per-room mutual exclusion. */
  lock: Promise<void>;
}

function clampPercent(value: number | undefined, fallback: number): number {
  const n = Number.isFinite(value) ? Number(value) : fallback;
  if (n < 1) return 1;
  if (n > 100) return 100;
  return Math.round(n);
}

function readThresholdPercentFromEnv(): number {
  const raw = (process.env.BINGO_STOP_VOTE_THRESHOLD_PERCENT ?? "").trim();
  if (!raw) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 50;
  return clampPercent(parsed, 50);
}

export class Spill1StopVoteService {
  private readonly engine: BingoEngine;
  private readonly auditLogService: AuditLogService | null;
  private readonly walletAdapter: WalletAdapter | null;
  private readonly getReservationId:
    | ((roomCode: string, playerId: string) => string | null)
    | null;
  private readonly clearReservationId:
    | ((roomCode: string, playerId: string) => void)
    | null;
  private readonly thresholdPercent: number;
  private readonly states: Map<string, RoundVoteState> = new Map();
  private stopGameImpl: StopGameRefundCallback | null = null;

  constructor(options: Spill1StopVoteServiceOptions) {
    this.engine = options.engine;
    this.auditLogService = options.auditLogService ?? null;
    this.walletAdapter = options.walletAdapter ?? null;
    this.getReservationId = options.getReservationId ?? null;
    this.clearReservationId = options.clearReservationId ?? null;
    this.thresholdPercent =
      options.thresholdPercent === undefined
        ? readThresholdPercentFromEnv()
        : clampPercent(options.thresholdPercent, 50);
  }

  /**
   * Wire up the stop-game orchestrator. Registered late so callers can
   * pass a closure that depends on services that themselves take this
   * service as a constructor arg (avoids circular wiring).
   */
  setStopGameImpl(impl: StopGameRefundCallback): void {
    this.stopGameImpl = impl;
  }

  /**
   * Compute threshold for a given player count.
   * Always at least 1 (single-player room → first vote stops, mirrors
   * legacy `stopGameByPlayers` parity for that edge case).
   */
  computeThreshold(playerCount: number): number {
    if (playerCount <= 0) return 0;
    const computed = Math.ceil((playerCount * this.thresholdPercent) / 100);
    return Math.max(1, computed);
  }

  /**
   * Test-only: peek at vote state without exposing internals.
   */
  _peekState(roomCode: string): {
    gameId: string;
    voters: string[];
  } | null {
    const s = this.states.get(roomCode);
    if (!s) return null;
    return { gameId: s.gameId, voters: [...s.voters] };
  }

  /**
   * Cast a vote to stop the running game. Throws DomainError when the room
   * has no running game, the player is not in the room, or the game is
   * already paused/ended.
   *
   * Idempotent: same playerId voting twice returns `{ recorded: false }`
   * and does not re-fire audit / does not double-count.
   */
  async castVote(input: {
    roomCode: string;
    playerId: string;
    /** Optional metadata for audit (IP, user-agent). */
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<VoteResult> {
    const roomCode = input.roomCode.trim().toUpperCase();
    const playerId = input.playerId.trim();
    if (!roomCode) {
      throw new DomainError("INVALID_INPUT", "roomCode kreves.");
    }
    if (!playerId) {
      throw new DomainError("INVALID_INPUT", "playerId kreves.");
    }

    let snapshot: RoomSnapshot;
    try {
      snapshot = this.engine.getRoomSnapshot(roomCode);
    } catch {
      throw new DomainError(
        "ROOM_NOT_FOUND",
        `Rom ${roomCode} finnes ikke.`,
      );
    }

    const player = snapshot.players.find((p) => p.id === playerId);
    if (!player) {
      throw new DomainError(
        "PLAYER_NOT_IN_ROOM",
        "Du er ikke deltager i dette rommet.",
      );
    }

    const game = snapshot.currentGame;
    if (!game || game.status !== "RUNNING") {
      throw new DomainError(
        "GAME_NOT_RUNNING",
        "Det er ingen aktiv runde å stoppe.",
      );
    }

    // Per-room serialised section. Promise-chain lock — the next caller
    // chains onto the same `state.lock` so double-vote-races are linearised.
    const state = this.getOrInitState(roomCode, game.id);
    const next = state.lock.then(() =>
      this.castVoteLocked({
        roomCode,
        playerId,
        snapshot,
        gameId: game.id,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        state,
      }),
    );
    // Replace the lock with a forgiving continuation — even if the inner
    // call rejects, subsequent voters must still acquire the lock.
    state.lock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async castVoteLocked(input: {
    roomCode: string;
    playerId: string;
    snapshot: RoomSnapshot;
    gameId: string;
    ipAddress: string | null;
    userAgent: string | null;
    state: RoundVoteState;
  }): Promise<VoteResult> {
    const { roomCode, playerId, gameId, state } = input;

    // Re-check engine state inside the lock — game may have been stopped
    // by another voter while this call was queued.
    let snapshot: RoomSnapshot;
    try {
      snapshot = this.engine.getRoomSnapshot(roomCode);
    } catch {
      throw new DomainError(
        "ROOM_NOT_FOUND",
        `Rom ${roomCode} finnes ikke.`,
      );
    }
    const game = snapshot.currentGame;
    if (!game || game.status !== "RUNNING" || game.id !== gameId) {
      // Race: someone already triggered stop. Treat as already-stopped
      // rather than as a new failure — the player's intent has been met.
      const voteCount = state.voters.size;
      const threshold = this.computeThreshold(snapshot.players.length);
      return {
        recorded: false,
        voteCount,
        threshold,
        playerCount: snapshot.players.length,
        thresholdReached: false,
      };
    }

    // Idempotency: same playerId can't double-count.
    if (state.voters.has(playerId)) {
      const playerCount = snapshot.players.length;
      const threshold = this.computeThreshold(playerCount);
      return {
        recorded: false,
        voteCount: state.voters.size,
        threshold,
        playerCount,
        thresholdReached: false,
      };
    }

    state.voters.add(playerId);
    const voteCount = state.voters.size;
    const playerCount = snapshot.players.length;
    const threshold = this.computeThreshold(playerCount);

    // Audit-log per vote (fire-and-forget — failure must not block vote).
    this.fireVoteAudit({
      actorId: playerId,
      roomCode,
      gameId,
      voteCount,
      threshold,
      playerCount,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    log.info(
      {
        roomCode,
        gameId,
        playerId,
        voteCount,
        threshold,
        playerCount,
      },
      "[GAP #38] stop-game vote recorded",
    );

    if (voteCount < threshold) {
      return {
        recorded: true,
        voteCount,
        threshold,
        playerCount,
        thresholdReached: false,
      };
    }

    // Threshold reached — trigger stop. Snapshot voter list BEFORE clearing
    // state so the audit / refund payload is consistent even if a late
    // vote sneaks in during shutdown.
    const voterIds = [...state.voters];
    this.states.delete(roomCode);

    this.fireThresholdAudit({
      actorId: playerId,
      roomCode,
      gameId,
      voteCount,
      threshold,
      playerCount,
      voterIds,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    await this.invokeStopGame({
      roomCode,
      triggeringPlayerId: playerId,
      voteCount,
      threshold,
      playerIds: snapshot.players.map((p) => p.id),
    });

    log.info(
      {
        roomCode,
        gameId,
        triggeringPlayerId: playerId,
        voteCount,
        threshold,
        playerCount,
      },
      "[GAP #38] stop-game threshold reached — game stopped",
    );

    return {
      recorded: true,
      voteCount,
      threshold,
      playerCount,
      thresholdReached: true,
    };
  }

  /**
   * Drop vote-state for a room. Called when a round ends naturally so the
   * next round starts with a clean slate.
   */
  clearState(roomCode: string): void {
    this.states.delete(roomCode.trim().toUpperCase());
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private getOrInitState(roomCode: string, gameId: string): RoundVoteState {
    const existing = this.states.get(roomCode);
    if (existing && existing.gameId === gameId) {
      return existing;
    }
    // New round — reset state.
    const fresh: RoundVoteState = {
      gameId,
      voters: new Set(),
      lock: Promise.resolve(),
    };
    this.states.set(roomCode, fresh);
    return fresh;
  }

  private fireVoteAudit(input: {
    actorId: string;
    roomCode: string;
    gameId: string;
    voteCount: number;
    threshold: number;
    playerCount: number;
    ipAddress: string | null;
    userAgent: string | null;
  }): void {
    if (!this.auditLogService) return;
    this.auditLogService
      .record({
        actorId: input.actorId,
        actorType: "PLAYER",
        action: "spillevett.stop_game.vote",
        resource: "game1_room",
        resourceId: input.roomCode,
        details: {
          gameId: input.gameId,
          voteCount: input.voteCount,
          threshold: input.threshold,
          playerCount: input.playerCount,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) => {
        log.warn(
          { err, roomCode: input.roomCode, actorId: input.actorId },
          "[GAP #38] stop-vote audit append failed (continuing)",
        );
      });
  }

  private fireThresholdAudit(input: {
    actorId: string;
    roomCode: string;
    gameId: string;
    voteCount: number;
    threshold: number;
    playerCount: number;
    voterIds: string[];
    ipAddress: string | null;
    userAgent: string | null;
  }): void {
    if (!this.auditLogService) return;
    this.auditLogService
      .record({
        actorId: input.actorId,
        actorType: "PLAYER",
        action: "spillevett.stop_game.threshold_reached",
        resource: "game1_room",
        resourceId: input.roomCode,
        details: {
          gameId: input.gameId,
          voteCount: input.voteCount,
          threshold: input.threshold,
          playerCount: input.playerCount,
          voterIds: input.voterIds,
          triggeringPlayerId: input.actorId,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) => {
        log.warn(
          { err, roomCode: input.roomCode },
          "[GAP #38] threshold-reached audit append failed (continuing)",
        );
      });
  }

  /**
   * Default refund flow — releases each player's active reservation. The
   * `walletAdapter.releaseReservation` is the BIN-693 equivalent of the
   * legacy "refund armed reservations" path. Errors per row are isolated
   * so one stuck reservation doesn't block the rest.
   */
  private async invokeStopGame(input: {
    roomCode: string;
    triggeringPlayerId: string;
    voteCount: number;
    threshold: number;
    playerIds: string[];
  }): Promise<void> {
    if (this.stopGameImpl) {
      try {
        await this.stopGameImpl(input);
      } catch (err) {
        log.error(
          { err, roomCode: input.roomCode },
          "[GAP #38] stopGame callback failed",
        );
        // Re-throw — caller (socket handler) needs to know.
        throw err;
      }
      return;
    }

    // Default: end game + release reservations. Used when no custom
    // orchestrator is wired (default production path).
    await this.defaultStopAndRefund(input);
  }

  private async defaultStopAndRefund(input: {
    roomCode: string;
    triggeringPlayerId: string;
    playerIds: string[];
  }): Promise<void> {
    const { roomCode, triggeringPlayerId, playerIds } = input;

    // 1) End the game first so no further draws / claims race the refund.
    try {
      await this.engine.endGame({
        roomCode,
        actorPlayerId: triggeringPlayerId,
        reason: "spillevett_stop_vote",
      });
    } catch (err) {
      log.error(
        { err, roomCode },
        "[GAP #38] engine.endGame failed during stop-vote",
      );
      // Don't bail — still attempt refund so players aren't double-billed.
    }

    // 2) Release each player's active reservation.
    if (
      !this.walletAdapter?.releaseReservation ||
      !this.getReservationId ||
      !this.clearReservationId
    ) {
      log.warn(
        { roomCode },
        "[GAP #38] walletAdapter or reservation deps missing — refund skipped",
      );
      return;
    }

    let refunded = 0;
    let skipped = 0;
    let failed = 0;
    for (const pid of playerIds) {
      const resId = this.getReservationId(roomCode, pid);
      if (!resId) {
        skipped++;
        continue;
      }
      try {
        await this.walletAdapter.releaseReservation(resId);
        this.clearReservationId(roomCode, pid);
        refunded++;
      } catch (err) {
        failed++;
        log.warn(
          { err, roomCode, playerId: pid, reservationId: resId },
          "[GAP #38] releaseReservation failed (continuing)",
        );
      }
    }

    log.info(
      { roomCode, refunded, skipped, failed, total: playerIds.length },
      "[GAP #38] stop-vote refund summary",
    );
  }
}
