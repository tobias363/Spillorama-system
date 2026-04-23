/**
 * BingoEngineRecovery — helper-modul for snapshot + crash-recovery +
 * checkpoint-writers + buy-in-refund.
 *
 * Ekstrahert fra `BingoEngine.ts` i refactor/s1-bingo-engine-split
 * (Forslag A) for å redusere LOC uten å endre offentlig API eller
 * subklasse-inheritance.
 *
 * **Kontrakt:**
 *   - Rene funksjoner som tar en narrow port (`RecoveryContext`).
 *   - `writeGameEndCheckpoint` + `writePayoutCheckpointWithRetry` beholdes
 *     som `protected`-metoder på `BingoEngine` (subklassene Game2Engine og
 *     Game3Engine kaller dem direkte) — men delegerer hit.
 *   - `serializeGame` er IKKE ekstrahert (bor fortsatt på klassen) fordi
 *     den kalles fra flere steder utenfor recovery. `serializeGameForRecovery`
 *     tar `serializeGame` som callback for å unngå sirkulær avhengighet.
 *
 * **Kritisk:** checkpoint-kontrakten mot `bingoAdapter.onCheckpoint` er
 * byte-identisk med inline-versjonen. Ingen endring i log-linjer eller
 * error-swallowing-semantikk — alle write-*-funksjonene er best-effort
 * og feiler aldri ut (logger CRITICAL på failure).
 */

import type { BingoSystemAdapter } from "../adapters/BingoSystemAdapter.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { logger as rootLogger } from "../util/logger.js";
import type { RoomStateStore } from "../store/RoomStateStore.js";
import type {
  GameSnapshot,
  GameState,
  Player,
  RecoverableGameSnapshot,
  RoomState,
  Ticket,
} from "./types.js";
import { DomainError } from "./BingoEngine.js";
import { IdempotencyKeys } from "./idempotency.js";

const logger = rootLogger.child({ module: "engine.recovery" });

/**
 * Narrow port: kun de engine-feltene recovery-modulen trenger.
 * Holder `rooms`, `luckyNumbersByPlayer`, `miniGameCounter` o.l. utenfor.
 */
export interface RecoveryContext {
  readonly bingoAdapter: BingoSystemAdapter;
  readonly walletAdapter: WalletAdapter;
  readonly rooms: RoomStateStore;
  /** Kaller {@link BingoEngine.syncRoomToStore} — private helper som ikke kan eksponeres. */
  syncRoomToStore(room: RoomState): void;
  /** Kaller {@link BingoEngine.serializeGame} — private helper beholdt på klassen. */
  serializeGame(game: GameState): GameSnapshot;
}

/**
 * KRITISK-5/6: Full engine state for checkpoint recovery (preserves
 * drawBag + per-ticket marks).
 */
export function serializeGameForRecovery(
  serializeGame: (game: GameState) => GameSnapshot,
  game: GameState,
): RecoverableGameSnapshot {
  const base = serializeGame(game);
  const structuredMarks: Record<string, number[][]> = {};
  for (const [playerId, sets] of game.marks) {
    structuredMarks[playerId] = sets.map((s) => [...s]);
  }
  return {
    ...base,
    drawBag: [...game.drawBag],
    structuredMarks,
  };
}

/** HOEY-3: Write a DRAW checkpoint after each ball draw. */
export async function writeDrawCheckpoint(
  ctx: RecoveryContext,
  room: RoomState,
  game: GameState,
): Promise<void> {
  if (!ctx.bingoAdapter.onCheckpoint) return;
  try {
    await ctx.bingoAdapter.onCheckpoint({
      roomCode: room.code,
      gameId: game.id,
      reason: "DRAW",
      snapshot: serializeGameForRecovery(ctx.serializeGame, game),
      players: [...room.players.values()],
      hallId: room.hallId,
    });
  } catch (err) {
    logger.error(
      { err, gameId: game.id, drawCount: game.drawnNumbers.length },
      "CRITICAL: Checkpoint failed after draw",
    );
  }
  // HOEY-7: Persist room state to backing store after draw
  await ctx.rooms.persist(room.code);
}

/** HOEY-6: Write a GAME_END checkpoint for any termination path. */
export async function writeGameEndCheckpoint(
  ctx: RecoveryContext,
  room: RoomState,
  game: GameState,
): Promise<void> {
  if (!ctx.bingoAdapter.onCheckpoint) return;
  try {
    await ctx.bingoAdapter.onCheckpoint({
      roomCode: room.code,
      gameId: game.id,
      reason: "GAME_END",
      snapshot: serializeGameForRecovery(ctx.serializeGame, game),
      players: [...room.players.values()],
      hallId: room.hallId,
    });
  } catch (err) {
    logger.error(
      { err, gameId: game.id, endedReason: game.endedReason },
      "CRITICAL: Checkpoint failed at game end",
    );
  }
  // HOEY-7: Persist room state to backing store after game end
  await ctx.rooms.persist(room.code);
}

/**
 * Write payout checkpoint with one retry. Logs CRITICAL on final failure
 * but does not throw.
 */
export async function writePayoutCheckpointWithRetry(
  ctx: RecoveryContext,
  room: RoomState,
  game: GameState,
  claimId: string,
  payoutAmount: number,
  transactionIds: string[],
  prizeType: "LINE" | "BINGO",
): Promise<void> {
  const payload = {
    roomCode: room.code,
    gameId: game.id,
    reason: "PAYOUT" as const,
    claimId,
    payoutAmount,
    transactionIds,
    snapshot: serializeGameForRecovery(ctx.serializeGame, game),
    players: [...room.players.values()],
    hallId: room.hallId,
  };
  try {
    await ctx.bingoAdapter.onCheckpoint!(payload);
  } catch (firstErr) {
    logger.warn(
      { err: firstErr, claimId, gameId: game.id },
      `Checkpoint failed after ${prizeType} payout — retrying once`,
    );
    try {
      await ctx.bingoAdapter.onCheckpoint!(payload);
    } catch (retryErr) {
      logger.error(
        { err: retryErr, claimId, gameId: game.id },
        `CRITICAL: Checkpoint failed after ${prizeType} payout (retry exhausted)`,
      );
    }
  }
}

/**
 * HOEY-4: Refund buy-ins when game startup fails partway through.
 * Returns structured data about any failed refunds for reconciliation.
 */
export async function refundDebitedPlayers(
  walletAdapter: WalletAdapter,
  debitedPlayers: Array<{
    player: Player;
    fromAccountId: string;
    toAccountId: string;
    amount: number;
  }>,
  houseAccountId: string,
  roomCode: string,
  gameId: string,
): Promise<{
  failedRefunds: Array<{
    playerId: string;
    walletId: string;
    amount: number;
    error: string;
  }>;
}> {
  const failedRefunds: Array<{
    playerId: string;
    walletId: string;
    amount: number;
    error: string;
  }> = [];
  for (const { player, amount } of debitedPlayers) {
    try {
      await walletAdapter.transfer(
        houseAccountId,
        player.walletId,
        amount,
        `Refund: game start failed ${roomCode}`,
        {
          idempotencyKey: IdempotencyKeys.adhocRefund({
            gameId,
            playerId: player.id,
          }),
        },
      );
      player.balance += amount;
    } catch (refundErr) {
      failedRefunds.push({
        playerId: player.id,
        walletId: player.walletId,
        amount,
        error: String(refundErr),
      });
      logger.error(
        { err: refundErr, playerId: player.id, walletId: player.walletId, gameId, roomCode },
        "CRITICAL: Failed to refund buy-in after game start failure — requires manual reconciliation",
      );
    }
  }
  if (failedRefunds.length > 0) {
    logger.error(
      {
        failedRefunds,
        gameId,
        roomCode,
        totalFailedAmount: failedRefunds.reduce((s, r) => s + r.amount, 0),
      },
      `RECONCILIATION: ${failedRefunds.length} refund(s) failed for game ${gameId} — players owe money`,
    );
  }
  return { failedRefunds };
}

/**
 * BIN-245: Restore a room and its in-progress game from a PostgreSQL
 * checkpoint snapshot. Called during startup crash recovery when a game
 * was RUNNING at the time of the last checkpoint. Reconstructs
 * in-memory Maps/Sets from the snapshot's plain-object serialization.
 */
export function restoreRoomFromSnapshot(
  ctx: RecoveryContext,
  roomCode: string,
  hallId: string,
  hostPlayerId: string,
  players: Player[],
  snapshot: GameSnapshot,
  // BIN-672: required — caller MUST pass a gameSlug from the
  // persisted game_sessions.game_slug column. No fallback here; an
  // unknown slug should fail loud (will be thrown by the ticket-gen
  // chain when display-tickets are requested).
  gameSlug: string,
): void {
  const code = roomCode.trim().toUpperCase();
  if (ctx.rooms.has(code)) {
    throw new DomainError(
      "ROOM_ALREADY_EXISTS",
      `Rom ${code} finnes allerede — kan ikke gjenopprette.`,
    );
  }

  const tickets = new Map<string, Ticket[]>(
    Object.entries(snapshot.tickets).map(([pid, t]) => [
      pid,
      t.map((tk) => ({ grid: tk.grid.map((row) => [...row]) })),
    ]),
  );

  // BIN-244: snapshot.marks is Record<string, number[][]> — restore to Map<string, Set<number>[]>
  const marks = new Map<string, Set<number>[]>(
    Object.entries(snapshot.marks).map(([pid, marksByTicket]) => [
      pid,
      marksByTicket.map((nums) => new Set(nums)),
    ]),
  );

  const game: GameState = {
    id: snapshot.id,
    status: "RUNNING",
    entryFee: snapshot.entryFee,
    ticketsPerPlayer: snapshot.ticketsPerPlayer,
    prizePool: snapshot.prizePool,
    remainingPrizePool: snapshot.remainingPrizePool,
    payoutPercent: snapshot.payoutPercent,
    maxPayoutBudget: snapshot.maxPayoutBudget,
    remainingPayoutBudget: snapshot.remainingPayoutBudget,
    // BIN-243: Restore full ordered draw bag from snapshot
    drawBag: [...snapshot.drawBag],
    drawnNumbers: [...snapshot.drawnNumbers],
    tickets,
    marks,
    claims: [...snapshot.claims],
    lineWinnerId: snapshot.lineWinnerId,
    bingoWinnerId: snapshot.bingoWinnerId,
    patterns: snapshot.patterns ? [...snapshot.patterns] : undefined,
    patternResults: snapshot.patternResults ? [...snapshot.patternResults] : undefined,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    endedReason: snapshot.endedReason,
  };

  const playersMap = new Map<string, Player>(players.map((p) => [p.id, p]));

  const restoredRoom: RoomState = {
    code,
    hallId,
    hostPlayerId,
    gameSlug,
    players: playersMap,
    currentGame: game,
    gameHistory: [],
    createdAt: new Date().toISOString(),
  };
  ctx.rooms.set(code, restoredRoom);
  ctx.syncRoomToStore(restoredRoom); // BIN-251

  logger.warn(
    {
      roomCode: code,
      gameId: snapshot.id,
      drawn: snapshot.drawnNumbers.length,
      remaining: snapshot.drawBag.length,
    },
    "[BIN-245] Room restored from checkpoint",
  );
}
