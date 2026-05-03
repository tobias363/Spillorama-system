/**
 * BIN-615 / PR-C3b: Game 3 (Mønsterbingo / Spill 3) engine — extends BingoEngine
 * to add pattern-driven auto-claim-on-draw behaviour for the 5×5 / 1..75 /
 * no-free-centre variant.
 *
 * 2026-05-03 (revert): Spill 3 ble kortvarig portet til 3×3 / 1..21 i PR #860,
 * men er nå **revertert** til 5×5 / 1..75-form per Tobias-direktiv. Forskjellen
 * fra Spill 1 er at Spill 3 har KUN ÉN ticket-type ("Standard") — Spill 1 har
 * 8 farger. Patterns (Row 1-4 + Coverall) og draw-mekanikk er identisk med
 * Spill 1's BingoEngine-logikk for pattern-evaluering.
 *
 * Per Tobias 2026-05-03 (revert-direktiv):
 *   "75 baller og 5x5 bonger uten free i midten. Alt av design skal være likt
 *    [Spill 1] bare at her er det kun 1 type bonger og man spiller om mønstre.
 *    Logikken med å trekke baller og markere bonger er fortsatt helt lik."
 *
 * Non-G3 rooms are untouched: the override guard `isGame3Round(...)` returns
 * early for every round that doesn't carry the G3 variantConfig + slug combo,
 * so G1 manual-claim semantics survive unchanged. Game 2 is a sibling subclass
 * (also extends BingoEngine) and is mutually exclusive with Game 3 at the
 * room-slug level, so the two hooks never fire in the same process for the
 * same room.
 *
 * Perpetual loop (PR #863 + #868) er fortsatt aktiv: når Coverall vinnes
 * signaliserer engine `endedReason: "G3_FULL_HOUSE"` og PerpetualRoundService
 * scheduler ny runde automatisk.
 *
 * Legacy references:
 *   - gamehelper/game3.js:663-708 — createGameData (flatten patterns per round)
 *   - gamehelper/game3.js:724-848 — evaluatePatternsAndUpdateGameData (cycler)
 *   - gamehelper/game3.js:851-867 — getPatternToCheckWinner (row priority)
 *   - gamehelper/game3.js:870-1033 — processPatternWinners (split + payouts)
 *   - Game/Game3/Controllers/GameProcess.js:215-375 — checkForWinners loop
 *   - Helper/bingo.js:1197-1356 — per-ticket pattern pre-compute (replaced by
 *     PatternMatcher bitmask on-the-fly)
 *
 * Socket-event emission lives in `sockets/gameEvents.ts` via
 * {@link Game3Engine.getG3LastDrawEffects} — same atomic read-and-clear pattern
 * as Game2Engine.
 */

import { randomUUID } from "node:crypto";
import { BingoEngine } from "./BingoEngine.js";
import { IdempotencyKeys } from "./idempotency.js";
import {
  PatternCycler,
  type PatternSpec,
  type CyclerStep,
} from "./PatternCycler.js";
import {
  buildTicketMask,
  getBuiltInPatternMasks,
  isFullHouse,
  matchesAny,
  FULL_HOUSE_MASK,
} from "./PatternMatcher.js";
import type { PatternMask } from "@spillorama/shared-types";
import { uses5x5NoCenterTicket } from "./ticket.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import type {
  ClaimRecord,
  GameState,
  PatternDefinition,
  Player,
  RoomState,
} from "./types.js";
import type { GameVariantConfig } from "./variantConfig.js";
import type { LedgerChannel, LedgerGameType } from "./ComplianceLedger.js";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";

const logger = rootLogger.child({ module: "engine.game3" });

// ── Per-draw side-effect shape ──────────────────────────────────────────────

/**
 * Per-draw G3 side-effects published to the socket layer.
 *
 * Populated by {@link Game3Engine.onDrawCompleted}, drained atomically by
 * {@link Game3Engine.getG3LastDrawEffects}. The socket handler reads this AFTER
 * `drawNextNumber` returns and emits:
 *   - `g3:pattern:changed`  — when `patternsChanged === true`
 *   - `g3:pattern:auto-won` — once per winning pattern (broadcast + per-winner)
 *
 * `gameEnded` is true iff a Full House winner was found on this draw.
 */
export interface G3DrawEffects {
  roomCode: string;
  gameId: string;
  drawIndex: number;
  lastBall: number;
  /** True when the active-pattern set changed this draw (activate or deactivate). */
  patternsChanged: boolean;
  /** Full snapshot of all patterns after this draw — Row payloads use this. */
  patternSnapshot: G3PatternSnapshot[];
  /** Non-empty when any pattern had winners this draw. */
  winners: G3WinnerRecord[];
  /** True when a Full House was won and the round ended. */
  gameEnded: boolean;
  /** Set when gameEnded; "G3_FULL_HOUSE" currently. */
  endedReason?: string;
}

/**
 * Wire-shape pattern snapshot used in `g3:pattern:changed`. Mirrors legacy
 * `PatternChange.patterns[*]` minus the 2D-array `patternDataList`
 * (we keep the 25-bit mask in memory and surface it as a flat 25-cell array
 * for wire compatibility).
 */
export interface G3PatternSnapshot {
  id: string;
  name: string;
  ballThreshold: number;
  isFullHouse: boolean;
  isWon: boolean;
  design: number;
  /** 25-cell 0/1 bitmask (row-major). For Row 1-4 the mask shown is the first in the set. */
  patternDataList: number[];
  /** Resolved prize for this pattern at current pool state (display only). */
  amount: number;
}

export interface G3WinnerRecord {
  patternId: string;
  patternName: string;
  isFullHouse: boolean;
  /** Split prize paid per (ticket, pattern) winner. */
  pricePerWinner: number;
  /** One entry per (player, ticket) that matched this pattern this draw. */
  ticketWinners: G3TicketWinner[];
}

export interface G3TicketWinner {
  playerId: string;
  ticketIndex: number;
  ticketId?: string;
  claimId: string;
  payoutAmount: number;
  luckyBonus: number;
}

// ── Engine ──────────────────────────────────────────────────────────────────

export class Game3Engine extends BingoEngine {
  /** Per-room pattern cycler, built lazily on the first draw of each G3 round. */
  private readonly cyclersByRoom = new Map<string, PatternCycler>();
  /** Per-room gameId the cycler was built for — reset when a new round starts. */
  private readonly cyclerGameIdByRoom = new Map<string, string>();
  /**
   * Atomic read-and-clear stash for per-draw G3 effects — socket layer consumes
   * via {@link getG3LastDrawEffects} after `drawNextNumber` returns.
   */
  private readonly lastDrawEffectsByRoom = new Map<string, G3DrawEffects>();

  /**
   * Public reader for the socket layer. Returns undefined when the last draw
   * was not a G3 draw (or the effects have already been consumed).
   */
  getG3LastDrawEffects(roomCode: string): G3DrawEffects | undefined {
    const effects = this.lastDrawEffectsByRoom.get(roomCode);
    if (effects) this.lastDrawEffectsByRoom.delete(roomCode);
    return effects;
  }

  /**
   * BIN-615 / PR-C3b hook override:
   *   - Non-G3 rooms → fall through (preserves G1 manual-claim semantics).
   *   - G3 rooms     → step cycler, scan tickets, auto-claim + split, end on Full House.
   *
   * Calls `super.onDrawCompleted` so any future base-class default hook still
   * runs. Game 2 is a sibling subclass (not a base), so its 3×3 logic is never
   * reachable from this override — rooms must be a Game 2 OR Game 3 instance,
   * never both.
   */
  protected async onDrawCompleted(ctx: {
    room: RoomState;
    game: GameState;
    lastBall: number;
    drawIndex: number;
    variantConfig: GameVariantConfig | undefined;
  }): Promise<void> {
    await super.onDrawCompleted(ctx);
    const { room, game, lastBall, drawIndex, variantConfig } = ctx;
    if (!this.isGame3Round(room, variantConfig)) return;

    const cycler = this.getOrCreateCycler(room, game);
    const step = cycler.step(drawIndex);

    const winnerRecords = await this.processG3Winners({
      room,
      game,
      lastBall,
      drawIndex,
      step,
      variantConfig: variantConfig!,
    });

    // End the round only when a Full House was awarded this draw (legacy parity).
    const fullHouseWon = winnerRecords.some((w) => w.isFullHouse && w.ticketWinners.length > 0);
    if (fullHouseWon) {
      const endedAtMs = Date.now();
      game.bingoWinnerId = winnerRecords.find((w) => w.isFullHouse)?.ticketWinners[0]?.playerId;
      game.status = "ENDED";
      game.endedAt = new Date(endedAtMs).toISOString();
      game.endedReason = "G3_FULL_HOUSE";
      await this.finishPlaySessionsForGame(room, game, endedAtMs);
      await this.writeGameEndCheckpoint(room, game);
      await this.rooms.persist(room.code);
    }

    this.lastDrawEffectsByRoom.set(room.code, {
      roomCode: room.code,
      gameId: game.id,
      drawIndex,
      lastBall,
      patternsChanged: step.changed,
      patternSnapshot: this.buildPatternSnapshot(cycler, game),
      winners: winnerRecords,
      gameEnded: fullHouseWon,
      endedReason: fullHouseWon ? "G3_FULL_HOUSE" : undefined,
    });
  }

  // ── Cycler construction ──────────────────────────────────────────────────

  /**
   * Build (or retrieve) the per-room cycler for this round. The cycler is
   * snapshot-copied from `game.patterns` at first draw — legacy parity with
   * `game.allPatternArray` being frozen at round-start (admin-edits mid-round
   * do NOT bleed into active rounds).
   */
  private getOrCreateCycler(room: RoomState, game: GameState): PatternCycler {
    const existing = this.cyclersByRoom.get(room.code);
    const lastGameId = this.cyclerGameIdByRoom.get(room.code);
    if (existing && lastGameId === game.id) return existing;

    const specs = buildPatternSpecs(game.patterns ?? []);
    const cycler = new PatternCycler(specs);
    this.cyclersByRoom.set(room.code, cycler);
    this.cyclerGameIdByRoom.set(room.code, game.id);
    return cycler;
  }

  // ── Winner processing ────────────────────────────────────────────────────

  /**
   * Scan every active pattern against every player's tickets, auto-claim each
   * match, and split the pattern prize `round(patternPrize / winnerCount)` per
   * (ticket, pattern) winner. Full-House is processed like any other pattern;
   * the caller ends the round afterwards if a Full House landed.
   *
   * Legacy parity: one ClaimRecord per (ticket, pattern). Same ticket winning
   * two patterns on the same draw produces two ClaimRecords (see
   * `gamehelper/game3.js:870-1033` + `GameProcess.js:268-275`).
   */
  private async processG3Winners(args: {
    room: RoomState;
    game: GameState;
    lastBall: number;
    drawIndex: number;
    step: CyclerStep;
    variantConfig: GameVariantConfig;
  }): Promise<G3WinnerRecord[]> {
    const { room, game, lastBall, drawIndex, step, variantConfig } = args;
    if (step.activePatterns.length === 0) return [];

    const drawnSet = new Set(game.drawnNumbers);
    const ticketMasksByPlayer = this.buildTicketMasksByPlayer(room, game, drawnSet);
    const records: G3WinnerRecord[] = [];
    // K2-A CRIT-1 (utvidelse 2026-04-30): Spill 3 (slug `monsterbingo`) er
    // hovedspill — bruk per-spill resolver for ledger-gameType. Resolver
    // er tolerant for null/manglende slug; faller til DATABINGO for å
    // bevare bakoverkompatibilitet for ukjente slugs.
    const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);

    for (const pattern of step.activePatterns) {
      const matches = this.findPatternMatches(ticketMasksByPlayer, pattern);
      if (matches.length === 0) continue;

      // round(prize / winnerCount) split — legacy game3.js:1017-1020.
      const resolvedPrize = this.resolvePatternPrize(pattern, game);
      const pricePerWinner = matches.length > 0
        ? Math.round(resolvedPrize / matches.length)
        : resolvedPrize;

      const ticketWinners: G3TicketWinner[] = [];
      for (const match of matches) {
        const winner = await this.payG3PatternShare({
          room,
          game,
          player: match.player,
          ticketIndex: match.ticketIndex,
          ticketId: match.ticketId,
          pattern,
          pricePerWinner,
          lastBall,
          drawIndex,
          houseAccountId,
          gameType,
          channel,
          luckyPrize: variantConfig.luckyNumberPrize ?? 0,
        });
        ticketWinners.push(winner);
      }

      cyclerMarkWon(this.cyclersByRoom.get(room.code), pattern.id);

      records.push({
        patternId: pattern.id,
        patternName: pattern.name,
        isFullHouse: pattern.isFullHouse,
        pricePerWinner,
        ticketWinners,
      });
    }
    return records;
  }

  /** Build `{ playerId → Array<{ticketIndex, ticketId, mask}>}` for all room players. */
  private buildTicketMasksByPlayer(
    room: RoomState,
    game: GameState,
    drawnSet: Set<number>,
  ): Map<string, Array<{ ticketIndex: number; ticketId?: string; mask: PatternMask }>> {
    const out = new Map<string, Array<{ ticketIndex: number; ticketId?: string; mask: PatternMask }>>();
    for (const player of room.players.values()) {
      const tickets = game.tickets.get(player.id);
      if (!tickets || tickets.length === 0) continue;
      const entries = tickets.map((t, i) => ({
        ticketIndex: i,
        ticketId: t.id,
        mask: buildTicketMask(t, drawnSet),
      }));
      out.set(player.id, entries);
    }
    return out;
  }

  /** Find every (player, ticket) whose mask satisfies the pattern. */
  private findPatternMatches(
    ticketMasksByPlayer: Map<string, Array<{ ticketIndex: number; ticketId?: string; mask: PatternMask }>>,
    pattern: PatternSpec,
  ): Array<{ player: Player; ticketIndex: number; ticketId?: string }> {
    const matches: Array<{ player: Player; ticketIndex: number; ticketId?: string }> = [];
    for (const [playerId, entries] of ticketMasksByPlayer) {
      const roomPlayer = this.requirePlayerById(playerId);
      for (const e of entries) {
        if (matchesAny(e.mask, pattern.masks)) {
          matches.push({ player: roomPlayer, ticketIndex: e.ticketIndex, ticketId: e.ticketId });
        }
      }
    }
    return matches;
  }

  /**
   * Resolve prize amount for a pattern. "fixed" variants use prize1 (legacy
   * field name), "percent" (default) uses prizePercent of the game's prizePool.
   * Rounded to the nearest kr.
   */
  private resolvePatternPrize(pattern: PatternSpec, game: GameState): number {
    if (pattern.prizeMode === "cash") {
      return roundCurrency(Math.max(0, pattern.prize));
    }
    const pct = Math.max(0, Math.min(100, pattern.prize));
    return roundCurrency((game.prizePool * pct) / 100);
  }

  // ── Payout per (ticket, pattern) winner ──────────────────────────────────

  /**
   * Create a ClaimRecord + debit house → player + update compliance ledger +
   * apply per-policy prize cap + honour remainingPrizePool and
   * remainingPayoutBudget. Mirrors Game2Engine.payG2JackpotShare but scoped to
   * per-(ticket, pattern) shares. Returns the recorded TicketWinner.
   */
  private async payG3PatternShare(args: {
    room: RoomState;
    game: GameState;
    player: Player;
    ticketIndex: number;
    ticketId?: string;
    pattern: PatternSpec;
    pricePerWinner: number;
    lastBall: number;
    drawIndex: number;
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    luckyPrize: number;
  }): Promise<G3TicketWinner> {
    const { room, game, player, ticketIndex, ticketId, pattern, pricePerWinner, lastBall, drawIndex, houseAccountId, gameType, channel, luckyPrize } = args;
    const claimId = randomUUID();
    const claim: ClaimRecord = {
      id: claimId,
      playerId: player.id,
      type: pattern.isFullHouse ? "BINGO" : "LINE",
      valid: true,
      autoGenerated: true,
      createdAt: new Date().toISOString(),
      payoutAmount: 0,
    };

    const paid = pricePerWinner > 0
      ? await this.transferPrizeShare({
          room, game, player, claim,
          requestedPayout: pricePerWinner,
          houseAccountId, gameType, channel,
          label: `G3 pattern ${pattern.name} ${room.code}`,
          idempotencyKey: IdempotencyKeys.game3Pattern({
            gameId: game.id,
            claimId: claim.id,
          }),
        })
      : 0;

    // Lucky-number bonus (legacy game3.js:945-997). Paid per winner when
    // `lastBall === luckyNumber` for that player AND `luckyNumberPrize > 0`.
    let luckyPaid = 0;
    const luckyNumber = this.luckyNumbersByPlayer.get(room.code)?.get(player.id);
    if (luckyPrize > 0 && luckyNumber !== undefined && luckyNumber === lastBall) {
      luckyPaid = await this.transferPrizeShare({
        room, game, player, claim,
        requestedPayout: luckyPrize,
        houseAccountId, gameType, channel,
        label: `G3 lucky bonus ${room.code}`,
        idempotencyKey: IdempotencyKeys.game3Lucky({
          gameId: game.id,
          claimId: claim.id,
        }),
      });
      if (luckyPaid > 0) {
        claim.bonusTriggered = true;
        claim.bonusAmount = luckyPaid;
      }
    }

    const totalPayout = roundCurrency(paid + luckyPaid);
    claim.payoutAmount = totalPayout;
    game.claims.push(claim);

    if (this.bingoAdapter.onClaimLogged) {
      try {
        await this.bingoAdapter.onClaimLogged({
          roomCode: room.code,
          gameId: game.id,
          playerId: player.id,
          type: claim.type,
          valid: claim.valid,
          reason: claim.reason,
        });
      } catch (err) {
        logger.error({ err, gameId: game.id, roomCode: room.code }, "onClaimLogged failed for G3 auto-claim");
      }
    }

    logger.info({
      event: "G3_PATTERN_PAYOUT",
      roomCode: room.code,
      gameId: game.id,
      playerId: player.id,
      claimId,
      patternId: pattern.id,
      patternName: pattern.name,
      isFullHouse: pattern.isFullHouse,
      drawIndex,
      pricePerWinner,
      paid,
      luckyBonus: luckyPaid,
    }, "Game 3 pattern auto-claim paid");

    return {
      playerId: player.id,
      ticketIndex,
      ticketId,
      claimId,
      payoutAmount: paid,
      luckyBonus: luckyPaid,
    };
  }

  /**
   * Shared prize-transfer primitive: single-prize-cap + pool + budget gating,
   * compliance-ledger + payout-audit emission, retry-safe idempotencyKey.
   * Returns the actual credited amount (0 when capped to nothing).
   */
  private async transferPrizeShare(args: {
    room: RoomState;
    game: GameState;
    player: Player;
    claim: ClaimRecord;
    requestedPayout: number;
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    label: string;
    idempotencyKey: string;
  }): Promise<number> {
    const { room, game, player, claim, requestedPayout, houseAccountId, gameType, channel, label, idempotencyKey } = args;
    const rtpBefore = roundCurrency(Math.max(0, game.remainingPayoutBudget));
    const capped = this.prizePolicy.applySinglePrizeCap({
      hallId: room.hallId,
      gameType: "DATABINGO",
      amount: requestedPayout,
    });
    const afterPoolCap = Math.min(capped.cappedAmount, game.remainingPrizePool);
    const payout = Math.max(0, Math.min(afterPoolCap, game.remainingPayoutBudget));
    if (payout <= 0) {
      claim.payoutWasCapped = requestedPayout > 0;
      claim.rtpCapped = afterPoolCap > 0 && game.remainingPayoutBudget <= 0;
      claim.rtpBudgetBefore = rtpBefore;
      claim.rtpBudgetAfter = rtpBefore;
      await this.payoutAudit.appendPayoutAuditEvent({
        kind: "CLAIM_PRIZE",
        claimId: claim.id,
        gameId: game.id,
        roomCode: room.code,
        hallId: room.hallId,
        policyVersion: capped.policy.id,
        amount: 0,
        walletId: player.walletId,
        playerId: player.id,
        sourceAccountId: houseAccountId,
        txIds: [],
      });
      return 0;
    }
    // PR-W3 wallet-split: payout er gevinst → krediter winnings-siden.
    const transfer = await this.walletAdapter.transfer(
      houseAccountId,
      player.walletId,
      payout,
      label,
      { idempotencyKey, targetSide: "winnings" },
    );
    player.balance = roundCurrency(player.balance + payout);
    game.remainingPrizePool = roundCurrency(Math.max(0, game.remainingPrizePool - payout));
    game.remainingPayoutBudget = roundCurrency(Math.max(0, game.remainingPayoutBudget - payout));
    await this.compliance.recordLossEntry(player.walletId, room.hallId, {
      type: "PAYOUT",
      amount: payout,
      createdAtMs: Date.now(),
    });
    await this.ledger.recordComplianceLedgerEvent({
      hallId: room.hallId,
      gameType,
      channel,
      eventType: "PRIZE",
      amount: payout,
      roomCode: room.code,
      gameId: game.id,
      claimId: claim.id,
      playerId: player.id,
      walletId: player.walletId,
      sourceAccountId: transfer.fromTx.accountId,
      targetAccountId: transfer.toTx.accountId,
      policyVersion: capped.policy.id,
    });
    await this.payoutAudit.appendPayoutAuditEvent({
      kind: "CLAIM_PRIZE",
      claimId: claim.id,
      gameId: game.id,
      roomCode: room.code,
      hallId: room.hallId,
      policyVersion: capped.policy.id,
      amount: payout,
      walletId: player.walletId,
      playerId: player.id,
      sourceAccountId: houseAccountId,
      txIds: [transfer.fromTx.id, transfer.toTx.id],
    });
    claim.payoutTransactionIds = [...(claim.payoutTransactionIds ?? []), transfer.fromTx.id, transfer.toTx.id];
    claim.payoutPolicyVersion = capped.policy.id;
    claim.payoutWasCapped = payout < requestedPayout || (claim.payoutWasCapped ?? false);
    claim.rtpBudgetBefore = rtpBefore;
    claim.rtpBudgetAfter = roundCurrency(Math.max(0, game.remainingPayoutBudget));
    claim.rtpCapped = payout < afterPoolCap || (claim.rtpCapped ?? false);
    if (this.bingoAdapter.onCheckpoint) {
      await this.writePayoutCheckpointWithRetry(
        room, game, claim.id, payout,
        [transfer.fromTx.id, transfer.toTx.id],
        claim.type,
      );
    }
    return payout;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Guard predicate: true when the round is a G3 auto-claim round.
   *
   * Criteria (ALL must hold):
   *   - room.gameSlug opts in via `uses5x5NoCenterTicket(...)`
   *   - variantConfig.patternEvalMode === "auto-claim-on-draw"
   *   - variantConfig.jackpotNumberTable is NOT set (that's G2)
   *
   * Keeps G1 (manual-claim) and G2 (jackpotNumberTable) both out of the hook.
   */
  private isGame3Round(room: RoomState, variantConfig: GameVariantConfig | undefined): boolean {
    if (!variantConfig) return false;
    if (variantConfig.patternEvalMode !== "auto-claim-on-draw") return false;
    if (variantConfig.jackpotNumberTable) return false; // G2 opts in via jackpotNumberTable
    if (!uses5x5NoCenterTicket(room.gameSlug)) return false;
    return true;
  }

  /** Lookup a player across all rooms (cheap — rooms are small). */
  private requirePlayerById(playerId: string): Player {
    for (const room of this.rooms.values()) {
      const p = room.players.get(playerId);
      if (p) return p;
    }
    throw new Error(`player not found: ${playerId}`);
  }

  /**
   * Build the wire-shape pattern snapshot used in `g3:pattern:changed`.
   * Walks the cycler's internal specs so callers see deactivated entries
   * (marked isPatternWin=true) alongside active ones.
   */
  private buildPatternSnapshot(cycler: PatternCycler, game: GameState): G3PatternSnapshot[] {
    const snap: G3PatternSnapshot[] = [];
    for (const spec of cycler.snapshot()) {
      const patternDef = game.patterns?.find((p) => p.id === spec.id);
      const design = patternDef?.design ?? 0;
      const firstMask = spec.masks[0] ?? 0;
      snap.push({
        id: spec.id,
        name: spec.name,
        ballThreshold: spec.ballThreshold,
        isFullHouse: spec.isFullHouse,
        isWon: spec.isPatternWin,
        design,
        patternDataList: maskToFlatArray(firstMask),
        amount: this.resolvePatternPrize(spec, game),
      });
    }
    return snap;
  }
}

// ── Free helpers ────────────────────────────────────────────────────────────

/**
 * Safe `markWon` caller — the cycler is required for winner processing but the
 * public cyclersByRoom Map is lookup-only from the processor's perspective.
 * Extracted so we don't shadow `cycler` in the outer scope.
 */
function cyclerMarkWon(cycler: PatternCycler | undefined, patternId: string): void {
  cycler?.markWon(patternId);
}

/**
 * Build `PatternSpec[]` from `PatternDefinition[]` (the round-snapshot copy
 * stashed into `game.patterns` at `startGame`).
 *
 * - `Row 1`..`Row 4` / `Coverall` / `Full House` → built-in mask sets.
 * - Custom (design === 0) with `patternDataList` → single mask from the 25-cell
 *   bitmask array.
 * - Fallback: empty mask set (pattern will never match; logs a warning).
 *
 * Threshold resolution:
 *   - `patternDefinition.ballNumberThreshold` if defined,
 *   - else 75 (effectively "no threshold" for a 75-ball game).
 *
 * Full-House detection:
 *   - name in {"Full House", "Coverall"}, OR
 *   - patternDataList covers all 25 cells.
 */
export function buildPatternSpecs(patterns: readonly PatternDefinition[]): PatternSpec[] {
  const specs: PatternSpec[] = [];
  for (const p of patterns) {
    const builtIn = getBuiltInPatternMasks(p.name);
    let masks: readonly PatternMask[];
    if (builtIn) {
      masks = builtIn;
    } else if (Array.isArray(p.patternDataList) && p.patternDataList.length === 25) {
      masks = [encodeBitmaskFromDataList(p.patternDataList)];
    } else {
      logger.warn({ patternId: p.id, patternName: p.name }, "G3 pattern has no resolvable mask — will never match");
      masks = [];
    }
    const coversAll = masks.some((m) => isFullHouse(m));
    const nameIsFullHouse = p.name === "Full House" || p.name === "Coverall";
    const isFH = nameIsFullHouse || coversAll;
    const prizeMode: PatternSpec["prizeMode"] = p.winningType === "fixed" ? "cash" : "percent";
    const prize = prizeMode === "cash"
      ? (p.prize1 ?? 0)
      : p.prizePercent;
    specs.push({
      id: p.id,
      name: p.name,
      ballThreshold: p.ballNumberThreshold ?? 75,
      isFullHouse: isFH,
      masks,
      prize,
      prizeMode,
      isPatternWin: false,
    });
  }
  return specs;
}

/** Convert a 25-cell 0/1 array (row-major) to a bitmask. */
function encodeBitmaskFromDataList(dataList: readonly number[]): PatternMask {
  let mask = 0;
  for (let i = 0; i < 25; i += 1) {
    if (dataList[i] === 1) mask |= 1 << i;
  }
  return mask;
}

/** Convert a bitmask back to a 25-cell 0/1 array for wire emission. */
function maskToFlatArray(mask: PatternMask): number[] {
  const out = new Array<number>(25);
  for (let i = 0; i < 25; i += 1) {
    out[i] = (mask & (1 << i)) !== 0 ? 1 : 0;
  }
  return out;
}

// Re-export for tests.
export { FULL_HOUSE_MASK };
