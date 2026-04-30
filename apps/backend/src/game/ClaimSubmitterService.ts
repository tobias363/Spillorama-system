/**
 * ClaimSubmitterService — extracted from BingoEngine.ts in F2-B
 * (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §3.3 / HV-3).
 *
 * Owns the **claim-submission flow** that was previously a ~640-line method
 * inside BingoEngine.ts. Two main branches (LINE / BINGO Fullt Hus) plus
 * shared validation, plus the post-transfer audit-trail (`runPostTransferClaimAuditTrail`)
 * and the recovery-event helper (`fireRecoveryEvent`).
 *
 * **Responsibilities:**
 *   - Validation: idempotency-dedupe (BIN-45), participating-player check (KRITISK-8),
 *     armed-guard (BIN-238), KYC/play-block (`assertWalletAllowedForGameplay`).
 *   - Pattern validation: LINE (matches active unwon LINE pattern via
 *     `meetsPhaseRequirement`), BINGO (full bingo on any ticket + race-mutex
 *     against `game.bingoWinnerId`).
 *   - Cap-and-transfer via {@link PhasePayoutService.computeAndPayPhase}.
 *   - State mutations on `claim`/`game`/`patternResult` (winnerId, payoutAmount,
 *     pool/budget decrement, status="ENDED" + endedReason for BINGO).
 *   - PILOT-EMERGENCY 2026-04-28: phase-state mutates even when payout=0
 *     (mode:percent + empty pool) so the round doesn't hang.
 *   - Post-transfer audit-trail (5 steps): compliance.recordLossEntry,
 *     ledger.recordComplianceLedgerEvent (PRIZE), payoutAudit, checkpoint,
 *     rooms.persist. Each step in its own try/catch with recovery-port event
 *     on failure (CRIT-6 K3).
 *   - HOUSE_DEFICIT audit-event for fixed-prize patterns where payout exceeds
 *     pool (REN AUDIT — does NOT count toward §11 aggregates).
 *   - `bingoAdapter.onClaimLogged` notification.
 *
 * **NOT this service's responsibility:**
 *   - Auto-claim path (`evaluateActivePhase`) — that path uses
 *     {@link BingoEngine.payoutPhaseWinner} (a different method) and does NOT
 *     call this service. F2-B keeps the existing split.
 *   - Mini-game / jackpot activation — handled by `BingoEngineMiniGames` via
 *     `EvaluatePhaseCallbacks.onAutoClaimedFullHouse` for auto-claim path, or
 *     `BingoEngine.activateMiniGame` for socket `claim:submit BINGO` path.
 *   - Spill 1 phase-pause — engine-level concern handled outside `submitClaim`
 *     (see `BingoEnginePatternEval`).
 *   - `requireRoom`/`requireRunningGame`/`requirePlayer` lookups — done by
 *     {@link BingoEngine.submitClaim} before delegating to this service.
 *
 * Behavior is fully equivalent to the pre-extraction inline logic. All
 * idempotency-keys, ledger-ordering, log-meldinger, and PR #741 test-hall
 * semantics are preserved byte-for-byte.
 *
 * Note: BingoEngine still wraps `submitClaim` as a thin delegate so the
 * public API (and Game2Engine/Game3Engine inheritance) is unchanged.
 */

import { randomUUID } from "node:crypto";
import { logger as rootLogger } from "../util/logger.js";
import { roundCurrency } from "../util/currency.js";
import { logRoomEvent } from "../util/roomLogVerbose.js";
import type { BingoSystemAdapter } from "../adapters/BingoSystemAdapter.js";
import type {
  WalletTransferResult,
} from "../adapters/WalletAdapter.js";
import type {
  ClaimAuditTrailFailedEvent,
  ClaimAuditTrailRecoveryPort,
  ClaimAuditTrailSeverity,
  ClaimAuditTrailStep,
} from "../adapters/ClaimAuditTrailRecoveryPort.js";
import { findFirstCompleteLinePatternIndex, hasFullBingo } from "./ticket.js";
import type {
  ClaimRecord,
  ClaimType,
  GameState,
  PatternDefinition,
  Player,
  RoomState,
} from "./types.js";
import { ComplianceManager } from "./ComplianceManager.js";
import { ComplianceLedger } from "./ComplianceLedger.js";
import type { LedgerChannel, LedgerGameType } from "./ComplianceLedger.js";
import { PayoutAuditTrail } from "./PayoutAuditTrail.js";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
import { IdempotencyKeys } from "./idempotency.js";
import { PhasePayoutService } from "./PhasePayoutService.js";
import type { RoomStateStore } from "../store/RoomStateStore.js";
import { DomainError } from "../errors/DomainError.js";

const logger = rootLogger.child({ module: "claim-submitter-service" });

const DEFAULT_BONUS_TRIGGER_PATTERN_INDEX = 1;

/**
 * Detect fixed-prize patterns. Same logic as `BingoEngine.isFixedPrizePattern`
 * — kept private so the service has no leak surface to its consumers.
 */
function isFixedPrizePattern(pattern: {
  winningType?:
    | "percent"
    | "fixed"
    | "multiplier-chain"
    | "column-specific"
    | "ball-value-multiplier";
}): boolean {
  return pattern.winningType === "fixed";
}

/**
 * Engine-internal helpers that the service needs but cannot easily own
 * itself (they touch private state on BingoEngine — wallet refresh maps,
 * play-session state, checkpoint-retry logic).
 *
 * Same callback-port pattern used by {@link EvaluatePhaseCallbacks}.
 */
export interface ClaimSubmitterCallbacks {
  /** Lookup the player by id. Throws `PLAYER_NOT_FOUND` if missing. */
  requirePlayer(room: RoomState, playerId: string): Player;
  /**
   * Pre-claim spillevett guard — KYC, self-exclusion, daily/monthly loss-limit,
   * play-session pause. Throws `WALLET_BLOCKED` if disallowed.
   */
  assertWalletAllowedForGameplay(walletId: string, nowMs: number): void;
  /** Check if the engine is in production-runtime + room is scheduled. */
  assertNotScheduled(room: RoomState): void;
  /** K3 dual-engine quarantine: ad-hoc Spill 1 forbidden in production. */
  assertSpill1NotAdHoc(room: RoomState): void;
  /** Phase-rule per pattern config — name-based phase lookup. */
  meetsPhaseRequirement(
    pattern: PatternDefinition,
    ticket: import("./types.js").Ticket,
    drawnSet: Set<number>,
  ): boolean;
  /**
   * Re-fetch deposit/winnings split from wallet after a payout transfer so
   * `player.balance` reflects the freshly-credited winnings-side. Best-effort;
   * fail-soft (warn-log only).
   */
  refreshPlayerBalancesForWallet(walletId: string): Promise<string[]>;
  /**
   * Close all play-sessions for the round when `game.status` transitions to
   * ENDED — required for §66 mandatory-break tracking.
   */
  finishPlaySessionsForGame(
    room: RoomState,
    game: GameState,
    endedAtMs: number,
  ): Promise<void>;
  /** BIN-248: write final state checkpoint after BINGO payout settles. */
  writeGameEndCheckpoint(room: RoomState, game: GameState): Promise<void>;
  /**
   * Retry-wrapped checkpoint write after individual phase payouts so
   * crash-recovery can replay last-known-good state. The engine signature
   * narrows `prizeType` to `"LINE" | "BINGO"`.
   */
  writePayoutCheckpointWithRetry(
    room: RoomState,
    game: GameState,
    claimId: string,
    payoutAmount: number,
    transactionIds: string[],
    prizeType: "LINE" | "BINGO",
  ): Promise<void>;
}

/**
 * Inputs for {@link ClaimSubmitterService.submitClaim}.
 *
 * Caller (BingoEngine) is responsible for:
 *   - `requireRoom` + `requireRunningGame` (so the service receives validated
 *     room+game references — not a roomCode that needs lookup).
 */
export interface ClaimSubmitInput {
  /** The (already-validated) room. */
  room: RoomState;
  /** The (already-validated) running game. */
  game: GameState;
  /** Player-id submitting the claim — service does its own lookup via callbacks. */
  playerId: string;
  /** Claim type from the socket payload. */
  type: ClaimType;
}

/**
 * Stand-alone claim-submission service. Constructed once per BingoEngine
 * instance. No internal state — every input is explicit; mutations land
 * on the supplied `room`/`game`/`claim` objects.
 */
export class ClaimSubmitterService {
  constructor(
    private readonly compliance: ComplianceManager,
    private readonly ledger: ComplianceLedger,
    private readonly payoutAudit: PayoutAuditTrail,
    private readonly phasePayoutService: PhasePayoutService,
    private readonly bingoAdapter: BingoSystemAdapter,
    private readonly rooms: RoomStateStore,
    private readonly claimAuditTrailRecovery: ClaimAuditTrailRecoveryPort,
    private readonly callbacks: ClaimSubmitterCallbacks,
  ) {}

  /**
   * Submit a claim. Validates, computes payout via PhasePayoutService,
   * mutates state, writes audit-trail, and returns the resulting claim record.
   *
   * Idempotent: if the player already has a paid claim of the same type in
   * this game, the existing claim is returned without side-effects (BIN-45).
   *
   * @throws `DomainError` for hard validation failures (NOT_ARMED_FOR_GAME,
   *   PLAYER_NOT_PARTICIPATING, TICKET_NOT_FOUND). Wallet-transfer failures
   *   propagate from PhasePayoutService; for the BINGO branch, the service
   *   rolls back `game.bingoWinnerId` race-mutex before re-throwing.
   */
  async submitClaim(input: ClaimSubmitInput): Promise<ClaimRecord> {
    const { room, game, playerId, type } = input;

    // CRIT-4: scheduled Spill 1 has its own claim-flow via
    // Game1DrawEngineService.evaluateAndPayoutPhase. If a client sends
    // claim:submit on a scheduled room we risk dual-payout since the
    // idempotency-keys differ (g1-phase-* vs line-prize-*).
    this.callbacks.assertNotScheduled(room);
    // K3: production retail Spill 1 claim-flow lives in scheduled-engine.
    this.callbacks.assertSpill1NotAdHoc(room);

    const player = this.callbacks.requirePlayer(room, playerId);
    this.callbacks.assertWalletAllowedForGameplay(player.walletId, Date.now());

    // KRITISK-8: Only players who participated (were armed + paid buy-in) can claim prizes.
    if (
      game.participatingPlayerIds &&
      !game.participatingPlayerIds.includes(player.id)
    ) {
      throw new DomainError(
        "PLAYER_NOT_PARTICIPATING",
        "Spilleren deltok ikke i denne runden og kan ikke kreve premie.",
      );
    }

    // BIN-45: Idempotency — if this player already has a paid-out claim of the
    // same type in this game, return the existing claim instead of processing again.
    // This prevents double payouts when the client retries after a network error.
    const existingClaim = game.claims.find(
      (c) =>
        c.playerId === player.id &&
        c.type === type &&
        c.valid &&
        c.payoutAmount !== undefined &&
        c.payoutAmount > 0,
    );
    if (existingClaim) {
      return existingClaim;
    }

    // BIN-238: Explicit armed guard — only players who received tickets in this
    // game round (i.e. paid buy-in and passed eligibility) may submit claims.
    const playerTickets = game.tickets.get(player.id);
    if (!playerTickets || playerTickets.length === 0) {
      throw new DomainError(
        "NOT_ARMED_FOR_GAME",
        "Spilleren deltok ikke i denne runden og kan ikke gjøre krav.",
      );
    }
    const playerMarks = game.marks.get(player.id);
    if (!playerMarks || playerMarks.length !== playerTickets.length) {
      throw new DomainError(
        "TICKET_NOT_FOUND",
        "Spiller mangler brett i aktivt spill.",
      );
    }

    let valid = false;
    let reason: string | undefined;
    let winningPatternIndex: number | undefined;

    if (type === "LINE") {
      // BIN-694: LINE-claim covers phase 1-4. Find the active unwon
      // LINE-pattern and validate via `meetsPhaseRequirement` (which handles
      // name-based phase lookup — "1 Rad" = row/col, "2-4 Rader" = N cols).
      // When auto-claim-on-draw is active, this path rarely has work — the
      // winner is already detected in evaluateActivePhase.
      const activeLineResult = game.patternResults?.find(
        (r) => r.claimType === "LINE" && !r.isWon,
      );
      if (!activeLineResult) {
        reason = "LINE_ALREADY_CLAIMED";
      } else {
        const activeLinePattern = game.patterns?.find(
          (p) => p.id === activeLineResult.patternId,
        );
        if (!activeLinePattern) {
          reason = "NO_VALID_LINE";
        } else {
          for (let ticketIndex = 0; ticketIndex < playerTickets.length; ticketIndex += 1) {
            if (
              this.callbacks.meetsPhaseRequirement(
                activeLinePattern,
                playerTickets[ticketIndex],
                playerMarks[ticketIndex],
              )
            ) {
              valid = true;
              // Historical contract: winningPatternIndex points to the first
              // complete line (0-9 = row/column). Used by bonus-trigger
              // pattern-index and a few audits.
              winningPatternIndex = findFirstCompleteLinePatternIndex(
                playerTickets[ticketIndex],
                playerMarks[ticketIndex],
              );
              if (winningPatternIndex < 0) winningPatternIndex = 0;
              break;
            }
          }
          if (!valid) {
            reason = "NO_VALID_LINE";
          }
        }
      }
    } else if (type === "BINGO") {
      // KRITISK-4/BIN-242: Guard against duplicate BINGO claims — reject if BINGO is already claimed.
      if (game.bingoWinnerId) {
        valid = false;
        reason = "BINGO_ALREADY_CLAIMED";
      } else {
        valid = playerTickets.some((ticket, index) =>
          hasFullBingo(ticket, playerMarks[index]),
        );
        if (!valid) {
          reason = "NO_VALID_BINGO";
        }
      }
    } else {
      reason = "UNKNOWN_CLAIM_TYPE";
    }

    const claim: ClaimRecord = {
      id: randomUUID(),
      playerId: player.id,
      type,
      valid,
      reason,
      createdAt: new Date().toISOString(),
    };
    if (winningPatternIndex !== undefined) {
      claim.winningPatternIndex = winningPatternIndex;
      claim.patternIndex = winningPatternIndex;
    }
    game.claims.push(claim);

    // K2-A CRIT-1: per-spill resolver. Spill 1 (slug `bingo`) → MAIN_GAME.
    const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.ledger.makeHouseAccountId(
      room.hallId,
      gameType,
      channel,
    );

    if (valid && type === "LINE") {
      await this.handleValidLineClaim({
        room,
        game,
        player,
        claim,
        houseAccountId,
        gameType,
        channel,
        winningPatternIndex,
      });
    }

    if (valid && type === "BINGO") {
      const bingoResult = await this.handleValidBingoClaim({
        room,
        game,
        player,
        claim,
        houseAccountId,
        gameType,
        channel,
      });
      if (bingoResult === "ALREADY_CLAIMED") {
        return claim;
      }
    }

    if (this.bingoAdapter.onClaimLogged) {
      await this.bingoAdapter.onClaimLogged({
        roomCode: room.code,
        gameId: game.id,
        playerId: player.id,
        type,
        valid: claim.valid,
        reason: claim.reason,
      });
    }

    // HOEY-6: Write GAME_END checkpoint if the game ended via BINGO_CLAIMED
    if (game.status === "ENDED" && game.endedReason === "BINGO_CLAIMED") {
      await this.callbacks.writeGameEndCheckpoint(room, game);
    }

    return claim;
  }

  /**
   * LINE-branch: variable LINE prize (percent of pool) or fixed prize.
   * Behavior is unchanged from the inline implementation in `BingoEngine.submitClaim`.
   */
  private async handleValidLineClaim(params: {
    room: RoomState;
    game: GameState;
    player: Player;
    claim: ClaimRecord;
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    winningPatternIndex: number | undefined;
  }): Promise<void> {
    const {
      room,
      game,
      player,
      claim,
      houseAccountId,
      gameType,
      channel,
      winningPatternIndex,
    } = params;

    const rtpBudgetBefore = roundCurrency(
      Math.max(0, game.remainingPayoutBudget),
    );
    const nextLineResult = game.patternResults?.find(
      (r) => r.claimType === "LINE" && !r.isWon,
    );
    const linePattern = nextLineResult
      ? game.patterns?.find((p) => p.id === nextLineResult.patternId)
      : game.patterns?.find((p) => p.claimType === "LINE");
    const lineIsFixedPrize = !!linePattern && isFixedPrizePattern(linePattern);
    const requestedPayout = lineIsFixedPrize
      ? Math.max(0, linePattern!.prize1 ?? 0)
      : Math.floor(
          (game.prizePool * (linePattern?.prizePercent ?? 30)) / 100,
        );

    const linePhaseResult = await this.phasePayoutService.computeAndPayPhase({
      hallId: room.hallId,
      roomCode: room.code,
      gameId: game.id,
      isTestHall: room.isTestHall === true,
      pattern: linePattern ?? { winningType: undefined, name: undefined },
      prizePerWinner: requestedPayout,
      remainingPrizePool: game.remainingPrizePool,
      remainingPayoutBudget: game.remainingPayoutBudget,
      houseAccountId,
      walletId: player.walletId,
      transferMemo: `Line prize ${room.code}`,
      idempotencyKey: IdempotencyKeys.adhocLinePrize({
        gameId: game.id,
        claimId: claim.id,
      }),
      phase: "LINE",
    });
    const {
      payout,
      payoutSkipped: linePayoutWasSkipped,
      payoutSkippedReason: linePayoutSkippedReason,
      rtpCapped: lineRtpCapped,
      requestedAfterPolicyAndPool,
      houseAvailableBalance: lineHouseAvailableBalance,
      walletTransfer: transfer,
      policy: linePolicy,
      houseDeficit: lineHouseDeficit,
      houseFundedGap: lineHouseFundedGap,
      houseFundedGapAmount: lineHouseFundedGapAmount,
    } = linePhaseResult;

    let transferredTxIds: [string, string] | null = null;
    if (payout > 0 && transfer) {
      try {
        await this.callbacks.refreshPlayerBalancesForWallet(player.walletId);
      } catch (err) {
        logger.warn(
          {
            err,
            walletId: player.walletId,
            gameId: game.id,
            claimId: claim.id,
            phase: "LINE",
          },
          "submitClaim LINE: wallet refresh feilet (best-effort)",
        );
      }
      const linePoolBeforePayout = game.remainingPrizePool;
      game.remainingPrizePool = roundCurrency(
        Math.max(0, game.remainingPrizePool - payout),
      );
      game.remainingPayoutBudget = roundCurrency(
        Math.max(0, game.remainingPayoutBudget - payout),
      );
      claim.payoutTransactionIds = [transfer.fromTx.id, transfer.toTx.id];
      transferredTxIds = [transfer.fromTx.id, transfer.toTx.id];

      if (lineHouseDeficit > 0) {
        try {
          await this.ledger.recordComplianceLedgerEvent({
            hallId: room.hallId,
            gameType,
            channel,
            eventType: "HOUSE_DEFICIT",
            amount: lineHouseDeficit,
            roomCode: room.code,
            gameId: game.id,
            claimId: claim.id,
            playerId: player.id,
            walletId: player.walletId,
            sourceAccountId: houseAccountId,
            policyVersion: linePolicy.id,
            metadata: {
              reason: "FIXED_PRIZE_HOUSE_GUARANTEE",
              phase: "LINE",
              patternName: linePattern?.name,
              winningType: linePattern?.winningType,
              payout,
              poolBeforePayout: linePoolBeforePayout,
            },
          });
        } catch (err) {
          logger.warn(
            { err, gameId: game.id, claimId: claim.id, lineHouseDeficit },
            "HOUSE_DEFICIT ledger-event feilet (best-effort) — payout fortsetter",
          );
        }
      }
      // HV-2: hall-default floor hus-pre-fund audit (REN AUDIT). Logger
      // gap-amount så audit kan rekonstruere hva huset la ut for å nå floor.
      if (lineHouseFundedGap && lineHouseFundedGapAmount > 0) {
        try {
          await this.ledger.recordComplianceLedgerEvent({
            hallId: room.hallId,
            gameType,
            channel,
            eventType: "HOUSE_DEFICIT",
            amount: lineHouseFundedGapAmount,
            roomCode: room.code,
            gameId: game.id,
            claimId: claim.id,
            playerId: player.id,
            walletId: player.walletId,
            sourceAccountId: houseAccountId,
            policyVersion: linePolicy.id,
            metadata: {
              reason: "HALL_DEFAULT_FLOOR_GUARANTEE",
              phase: "LINE",
              patternName: linePattern?.name,
              winningType: linePattern?.winningType,
              payout,
              minPrizeFloor: linePattern?.minPrize,
              poolBeforePayout: linePoolBeforePayout,
            },
          });
        } catch (err) {
          logger.warn(
            { err, gameId: game.id, claimId: claim.id, lineHouseFundedGapAmount },
            "HV-2 HOUSE_DEFICIT ledger-event feilet (best-effort) — payout fortsetter",
          );
        }
      }

      const auditResult = await this.runPostTransferClaimAuditTrail({
        phase: "LINE",
        room,
        game,
        claim,
        player,
        payout,
        transfer,
        houseAccountId,
        gameType,
        channel,
        policyVersion: linePolicy.id,
      });
      claim.auditTrailStatus = auditResult.status;
    }
    // PILOT-EMERGENCY 2026-04-28: state-mutations MUST happen regardless of payout amount.
    game.lineWinnerId = player.id;
    const linePatternResult = game.patternResults?.find(
      (r) => r.claimType === "LINE" && !r.isWon,
    );
    if (linePatternResult) {
      linePatternResult.isWon = true;
      linePatternResult.winnerId = player.id;
      linePatternResult.wonAtDraw = game.drawnNumbers.length;
      linePatternResult.payoutAmount = payout;
      linePatternResult.claimId = claim.id;
      if (linePayoutWasSkipped) {
        linePatternResult.payoutSkipped = true;
        if (linePayoutSkippedReason) {
          linePatternResult.payoutSkippedReason = linePayoutSkippedReason;
        }
      }
    }
    void transferredTxIds;
    const rtpBudgetAfter = roundCurrency(
      Math.max(0, game.remainingPayoutBudget),
    );
    claim.payoutAmount = payout;
    claim.payoutPolicyVersion = linePolicy.id;
    claim.payoutWasCapped = payout < requestedPayout;
    claim.rtpBudgetBefore = rtpBudgetBefore;
    claim.rtpBudgetAfter = rtpBudgetAfter;
    claim.rtpCapped = lineRtpCapped;
    if (linePayoutWasSkipped) {
      claim.payoutSkipped = true;
      if (linePayoutSkippedReason) {
        claim.payoutSkippedReason = linePayoutSkippedReason;
      }
      logRoomEvent(
        logger,
        {
          roomCode: room.code,
          gameId: game.id,
          patternId: linePatternResult?.patternId ?? null,
          patternName: linePattern?.name ?? null,
          claimId: claim.id,
          playerId: player.id,
          phase: "LINE",
          configuredFaceValue: requestedPayout,
          requestedAfterPolicyAndPool,
          remainingBudget: rtpBudgetBefore,
          houseAvailableBalance: Number.isFinite(lineHouseAvailableBalance)
            ? lineHouseAvailableBalance
            : null,
          reason: linePayoutSkippedReason,
        },
        "game.pattern.payout-skipped",
      );
    } else {
      logRoomEvent(
        logger,
        {
          roomCode: room.code,
          gameId: game.id,
          patternId: linePatternResult?.patternId ?? null,
          patternName: linePattern?.name ?? null,
          claimId: claim.id,
          winnerId: player.id,
          phase: "LINE",
          payoutAmount: payout,
          rtpCapped: claim.rtpCapped,
          faceValue: requestedPayout,
        },
        "game.pattern.won",
      );
    }
    claim.bonusTriggered = winningPatternIndex === DEFAULT_BONUS_TRIGGER_PATTERN_INDEX;
    if (claim.bonusTriggered) {
      claim.bonusAmount = payout;
    }
  }

  /**
   * BINGO (Fullt Hus) branch: pays out remaining-pool (variable) or fixed prize,
   * then ends the round.
   *
   * Returns `"ALREADY_CLAIMED"` if a competing claim landed bingoWinnerId between
   * the validate-step and this branch (race-mutex).
   */
  private async handleValidBingoClaim(params: {
    room: RoomState;
    game: GameState;
    player: Player;
    claim: ClaimRecord;
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
  }): Promise<"OK" | "ALREADY_CLAIMED"> {
    const { room, game, player, claim, houseAccountId, gameType, channel } = params;

    if (game.bingoWinnerId) {
      claim.valid = false;
      claim.reason = "BINGO_ALREADY_CLAIMED";
      return "ALREADY_CLAIMED";
    }
    game.bingoWinnerId = player.id;
    const endedAtMs = Date.now();
    const endedAt = new Date(endedAtMs);
    const nextBingoResult = game.patternResults?.find(
      (r) => r.claimType === "BINGO" && !r.isWon,
    );
    const bingoPattern = nextBingoResult
      ? game.patterns?.find((p) => p.id === nextBingoResult.patternId)
      : game.patterns?.find((p) => p.claimType === "BINGO");
    const bingoIsFixedPrize = !!bingoPattern && isFixedPrizePattern(bingoPattern);
    const requestedPayout = bingoIsFixedPrize
      ? Math.max(0, bingoPattern!.prize1 ?? 0)
      : game.remainingPrizePool;

    let bingoPhaseResult;
    try {
      bingoPhaseResult = await this.phasePayoutService.computeAndPayPhase({
        hallId: room.hallId,
        roomCode: room.code,
        gameId: game.id,
        isTestHall: room.isTestHall === true,
        pattern: bingoPattern ?? { winningType: undefined, name: undefined },
        prizePerWinner: requestedPayout,
        remainingPrizePool: game.remainingPrizePool,
        remainingPayoutBudget: game.remainingPayoutBudget,
        houseAccountId,
        walletId: player.walletId,
        transferMemo: `Bingo prize ${room.code}`,
        idempotencyKey: IdempotencyKeys.adhocBingoPrize({
          gameId: game.id,
          claimId: claim.id,
        }),
        phase: "BINGO",
      });
    } catch (err) {
      // CRIT-6 partial-state-protection: roll back the mutex-lock so retry
      // can come in, and so a failed transfer doesn't mark the round as won.
      game.bingoWinnerId = undefined;
      throw err;
    }
    const {
      payout,
      payoutSkipped: bingoPayoutWasSkipped,
      payoutSkippedReason: bingoPayoutSkippedReason,
      rtpCapped: bingoRtpCapped,
      rtpBudgetBefore,
      requestedAfterPolicyAndPool,
      houseAvailableBalance: bingoHouseAvailableBalance,
      walletTransfer: transfer,
      policy: bingoPolicy,
      houseDeficit: bingoHouseDeficit,
      houseFundedGap: bingoHouseFundedGap,
      houseFundedGapAmount: bingoHouseFundedGapAmount,
    } = bingoPhaseResult;

    if (payout > 0 && transfer) {
      try {
        await this.callbacks.refreshPlayerBalancesForWallet(player.walletId);
      } catch (err) {
        logger.warn(
          {
            err,
            walletId: player.walletId,
            gameId: game.id,
            claimId: claim.id,
            phase: "BINGO",
          },
          "submitClaim BINGO: wallet refresh feilet (best-effort)",
        );
      }
      claim.payoutTransactionIds = [transfer.fromTx.id, transfer.toTx.id];

      const bingoPoolBeforePayout = game.remainingPrizePool;
      if (bingoHouseDeficit > 0) {
        try {
          await this.ledger.recordComplianceLedgerEvent({
            hallId: room.hallId,
            gameType,
            channel,
            eventType: "HOUSE_DEFICIT",
            amount: bingoHouseDeficit,
            roomCode: room.code,
            gameId: game.id,
            claimId: claim.id,
            playerId: player.id,
            walletId: player.walletId,
            sourceAccountId: houseAccountId,
            policyVersion: bingoPolicy.id,
            metadata: {
              reason: "FIXED_PRIZE_HOUSE_GUARANTEE",
              phase: "BINGO",
              patternName: bingoPattern?.name,
              winningType: bingoPattern?.winningType,
              payout,
              poolBeforePayout: bingoPoolBeforePayout,
            },
          });
        } catch (err) {
          logger.warn(
            { err, gameId: game.id, claimId: claim.id, bingoHouseDeficit },
            "HOUSE_DEFICIT ledger-event feilet (best-effort) — payout fortsetter",
          );
        }
      }
      // HV-2: hall-default floor hus-pre-fund audit (REN AUDIT). Distinkt
      // metadata-reason fra fixed-prize hus-garanti — gjør at audit/regnskap
      // kan skille floor-finansiering fra fixed-prize-overlapp.
      if (bingoHouseFundedGap && bingoHouseFundedGapAmount > 0) {
        try {
          await this.ledger.recordComplianceLedgerEvent({
            hallId: room.hallId,
            gameType,
            channel,
            eventType: "HOUSE_DEFICIT",
            amount: bingoHouseFundedGapAmount,
            roomCode: room.code,
            gameId: game.id,
            claimId: claim.id,
            playerId: player.id,
            walletId: player.walletId,
            sourceAccountId: houseAccountId,
            policyVersion: bingoPolicy.id,
            metadata: {
              reason: "HALL_DEFAULT_FLOOR_GUARANTEE",
              phase: "BINGO",
              patternName: bingoPattern?.name,
              winningType: bingoPattern?.winningType,
              payout,
              minPrizeFloor: bingoPattern?.minPrize,
              poolBeforePayout: bingoPoolBeforePayout,
            },
          });
        } catch (err) {
          logger.warn(
            { err, gameId: game.id, claimId: claim.id, bingoHouseFundedGapAmount },
            "HV-2 HOUSE_DEFICIT ledger-event feilet (best-effort) — payout fortsetter",
          );
        }
      }

      const auditResult = await this.runPostTransferClaimAuditTrail({
        phase: "BINGO",
        room,
        game,
        claim,
        player,
        payout,
        transfer,
        houseAccountId,
        gameType,
        channel,
        policyVersion: bingoPolicy.id,
      });
      claim.auditTrailStatus = auditResult.status;
    }
    game.remainingPrizePool = roundCurrency(
      Math.max(0, game.remainingPrizePool - payout),
    );
    game.remainingPayoutBudget = roundCurrency(
      Math.max(0, game.remainingPayoutBudget - payout),
    );
    game.status = "ENDED";
    game.endedAt = endedAt.toISOString();
    game.endedReason = "BINGO_CLAIMED";
    await this.callbacks.finishPlaySessionsForGame(room, game, endedAtMs);
    await this.callbacks.writeGameEndCheckpoint(room, game);
    const rtpBudgetAfter = roundCurrency(
      Math.max(0, game.remainingPayoutBudget),
    );
    claim.payoutAmount = payout;
    claim.payoutPolicyVersion = bingoPolicy.id;
    claim.payoutWasCapped = payout < requestedPayout;
    claim.rtpBudgetBefore = rtpBudgetBefore;
    claim.rtpBudgetAfter = rtpBudgetAfter;
    claim.rtpCapped = bingoRtpCapped;
    const bingoPatternResult = game.patternResults?.find(
      (r) => r.claimType === "BINGO" && !r.isWon,
    );
    if (bingoPatternResult) {
      bingoPatternResult.isWon = true;
      bingoPatternResult.winnerId = player.id;
      bingoPatternResult.wonAtDraw = game.drawnNumbers.length;
      bingoPatternResult.payoutAmount = payout;
      bingoPatternResult.claimId = claim.id;
      if (bingoPayoutWasSkipped) {
        bingoPatternResult.payoutSkipped = true;
        if (bingoPayoutSkippedReason) {
          bingoPatternResult.payoutSkippedReason = bingoPayoutSkippedReason;
        }
      }
    }
    if (bingoPayoutWasSkipped) {
      claim.payoutSkipped = true;
      if (bingoPayoutSkippedReason) {
        claim.payoutSkippedReason = bingoPayoutSkippedReason;
      }
      logRoomEvent(
        logger,
        {
          roomCode: room.code,
          gameId: game.id,
          patternId: bingoPatternResult?.patternId ?? null,
          patternName: bingoPattern?.name ?? null,
          claimId: claim.id,
          playerId: player.id,
          phase: "BINGO",
          configuredFaceValue: requestedPayout,
          requestedAfterPolicyAndPool,
          remainingBudget: rtpBudgetBefore,
          houseAvailableBalance: Number.isFinite(bingoHouseAvailableBalance)
            ? bingoHouseAvailableBalance
            : null,
          reason: bingoPayoutSkippedReason,
        },
        "game.pattern.payout-skipped",
      );
    } else {
      logRoomEvent(
        logger,
        {
          roomCode: room.code,
          gameId: game.id,
          patternId: bingoPatternResult?.patternId ?? null,
          patternName: bingoPattern?.name ?? null,
          claimId: claim.id,
          winnerId: player.id,
          phase: "BINGO",
          payoutAmount: payout,
          rtpCapped: claim.rtpCapped,
          faceValue: requestedPayout,
        },
        "game.pattern.won",
      );
    }

    return "OK";
  }

  /**
   * CRIT-6 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26): post-transfer audit-trail
   * for submitClaim. Called ONLY after walletAdapter.transfer is committed
   * and state is mutated.
   *
   * Sequence:
   *   1. compliance.recordLossEntry  (PAYOUT for net-loss tracking)  [REGULATORY]
   *   2. ledger.recordComplianceLedgerEvent  (§11-rapport)            [REGULATORY]
   *   3. payoutAudit.appendPayoutAuditEvent  (hash-chain audit)       [INTERNAL]
   *   4. bingoAdapter.onCheckpoint  (BIN-48 crash-recovery)           [INTERNAL]
   *   5. rooms.persist  (HOEY-7 in-memory ↔ store sync)               [INTERNAL]
   */
  private async runPostTransferClaimAuditTrail(input: {
    phase: "LINE" | "BINGO";
    room: RoomState;
    game: GameState;
    claim: ClaimRecord;
    player: Player;
    payout: number;
    transfer: WalletTransferResult;
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    policyVersion: string;
  }): Promise<{
    status: "complete" | "degraded";
    failedSteps: ClaimAuditTrailStep[];
  }> {
    const {
      phase,
      room,
      game,
      claim,
      player,
      payout,
      transfer,
      houseAccountId,
      gameType,
      channel,
      policyVersion,
    } = input;

    const failedSteps: ClaimAuditTrailStep[] = [];

    // 1) compliance.recordLossEntry — track PAYOUT for net-loss calculation.
    const complianceLossPayload = {
      walletId: player.walletId,
      hallId: room.hallId,
      type: "PAYOUT" as const,
      amount: payout,
    };
    try {
      await this.compliance.recordLossEntry(player.walletId, room.hallId, {
        type: "PAYOUT",
        amount: payout,
        createdAtMs: Date.now(),
      });
    } catch (err) {
      failedSteps.push("complianceLossEntry");
      logger.error(
        {
          err,
          claimId: claim.id,
          gameId: game.id,
          phase,
          payout,
          walletId: player.walletId,
          step: "recordLossEntry",
        },
        "[CRIT-6] post-transfer compliance.recordLossEntry feilet — ops-rekonsiliering kreves; pengene er betalt",
      );
      await this.fireRecoveryEvent({
        step: "complianceLossEntry",
        severity: "REGULATORY",
        phase,
        room,
        game,
        claim,
        player,
        payout,
        payload: complianceLossPayload,
        err,
      });
    }

    // 2) ledger.recordComplianceLedgerEvent — regulatorisk §11-rapport.
    const ledgerPayload = {
      hallId: room.hallId,
      gameType,
      channel,
      eventType: "PRIZE" as const,
      amount: payout,
      roomCode: room.code,
      gameId: game.id,
      claimId: claim.id,
      playerId: player.id,
      walletId: player.walletId,
      sourceAccountId: transfer.fromTx.accountId,
      targetAccountId: transfer.toTx.accountId,
      policyVersion,
    };
    try {
      await this.ledger.recordComplianceLedgerEvent(ledgerPayload);
    } catch (err) {
      failedSteps.push("complianceLedgerEvent");
      logger.error(
        {
          err,
          claimId: claim.id,
          gameId: game.id,
          phase,
          payout,
          step: "recordComplianceLedgerEvent",
        },
        "[CRIT-6] post-transfer ledger.recordComplianceLedgerEvent feilet — REGULATORISK rekonsiliering kreves; pengene er betalt",
      );
      await this.fireRecoveryEvent({
        step: "complianceLedgerEvent",
        severity: "REGULATORY",
        phase,
        room,
        game,
        claim,
        player,
        payout,
        payload: ledgerPayload,
        err,
      });
    }

    // 3) payoutAudit.appendPayoutAuditEvent — internt audit-trail.
    const auditPayload = {
      kind: "CLAIM_PRIZE" as const,
      claimId: claim.id,
      gameId: game.id,
      roomCode: room.code,
      hallId: room.hallId,
      policyVersion,
      amount: payout,
      walletId: player.walletId,
      playerId: player.id,
      sourceAccountId: houseAccountId,
      txIds: [transfer.fromTx.id, transfer.toTx.id] as [string, string],
    };
    try {
      await this.payoutAudit.appendPayoutAuditEvent(auditPayload);
    } catch (err) {
      failedSteps.push("payoutAuditEvent");
      logger.error(
        {
          err,
          claimId: claim.id,
          gameId: game.id,
          phase,
          payout,
          step: "appendPayoutAuditEvent",
        },
        "[CRIT-6] post-transfer payoutAudit.appendPayoutAuditEvent feilet — audit-trail har gap; pengene er betalt",
      );
      await this.fireRecoveryEvent({
        step: "payoutAuditEvent",
        severity: "INTERNAL",
        phase,
        room,
        game,
        claim,
        player,
        payout,
        payload: auditPayload,
        err,
      });
    }

    // 4) BIN-48 checkpoint — synchronous checkpoint after payout for crash-recovery.
    if (this.bingoAdapter.onCheckpoint) {
      const checkpointPayload = {
        claimId: claim.id,
        roomCode: room.code,
        gameId: game.id,
        payout,
        txIds: [transfer.fromTx.id, transfer.toTx.id],
        phase,
      };
      try {
        await this.callbacks.writePayoutCheckpointWithRetry(
          room,
          game,
          claim.id,
          payout,
          [transfer.fromTx.id, transfer.toTx.id],
          phase,
        );
      } catch (err) {
        failedSteps.push("checkpoint");
        logger.error(
          {
            err,
            claimId: claim.id,
            gameId: game.id,
            phase,
            payout,
            step: "writePayoutCheckpointWithRetry",
          },
          "[CRIT-6] post-transfer checkpoint feilet — crash-recovery integritet redusert; pengene er betalt",
        );
        await this.fireRecoveryEvent({
          step: "checkpoint",
          severity: "INTERNAL",
          phase,
          room,
          game,
          claim,
          player,
          payout,
          payload: checkpointPayload,
          err,
        });
      }
    }

    // 5) HOEY-7 — persist room-state after payout.
    try {
      await this.rooms.persist(room.code);
    } catch (err) {
      failedSteps.push("roomPersist");
      logger.error(
        {
          err,
          roomCode: room.code,
          claimId: claim.id,
          step: "rooms.persist",
        },
        "[CRIT-6] post-transfer rooms.persist feilet — in-memory og store kan divergere; pengene er betalt",
      );
      await this.fireRecoveryEvent({
        step: "roomPersist",
        severity: "INTERNAL",
        phase,
        room,
        game,
        claim,
        player,
        payout,
        payload: { roomCode: room.code },
        err,
      });
    }

    return {
      status: failedSteps.length === 0 ? "complete" : "degraded",
      failedSteps,
    };
  }

  /**
   * CRIT-6: fire-and-forget helper that registers a failed audit-trail step
   * on the recovery-port. The port itself must not throw — if it does, we
   * fall back to log-only (same as before the port was wired).
   */
  private async fireRecoveryEvent(input: {
    step: ClaimAuditTrailStep;
    severity: ClaimAuditTrailSeverity;
    phase: "LINE" | "BINGO";
    room: RoomState;
    game: GameState;
    claim: ClaimRecord;
    player: Player;
    payout: number;
    payload: Record<string, unknown>;
    err: unknown;
  }): Promise<void> {
    const {
      step,
      severity,
      phase,
      room,
      game,
      claim,
      player,
      payout,
      payload,
      err,
    } = input;
    const errAsAny = err as { message?: string; code?: string };
    const errorMessage =
      typeof errAsAny?.message === "string" ? errAsAny.message : String(err);
    const errorCode =
      typeof errAsAny?.code === "string" ? errAsAny.code : undefined;
    const event: ClaimAuditTrailFailedEvent = {
      step,
      severity,
      phase,
      claimId: claim.id,
      gameId: game.id,
      roomCode: room.code,
      hallId: room.hallId,
      walletId: player.walletId,
      playerId: player.id,
      payoutAmount: payout,
      payload,
      errorMessage,
      errorCode,
      failedAt: new Date().toISOString(),
    };
    try {
      await this.claimAuditTrailRecovery.onAuditTrailStepFailed(event);
    } catch (recoveryErr) {
      logger.error(
        {
          err: recoveryErr,
          claimId: claim.id,
          step,
        },
        "[CRIT-6] claimAuditTrailRecovery.onAuditTrailStepFailed kastet — recovery-event tapt, kun log-trail igjen",
      );
    }
  }
}
