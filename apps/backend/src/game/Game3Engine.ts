/**
 * 2026-05-03 (Tobias-direktiv): Game 3 (Mønsterbingo / Spill 3) engine —
 * **3×3 / 1..21**-hybrid av Spill 2's runtime + Spill 1's visuelle stil.
 *
 * Tidligere (BIN-615 / PR-C3b, 2026-04-23) brukte Game 3 5×5 / 1..75 med
 * pattern-cycler (Row 1-4 + Coverall). Den varianten er nå **erstattet** —
 * Spill 3 har samme runtime-mekanikk som Spill 2 (full-3×3 winner predicate,
 * auto-claim-on-draw, ETT globalt rom). Forskjellen mellom G2 og G3 ligger i:
 *   - **Slug**: G3 = `monsterbingo` / `mønsterbingo` / `game_3`, G2 = `rocket` osv.
 *   - **Jackpot-tabell**: G2 har `jackpotNumberTable` (per-draw-bucket-prizes),
 *     G3 har det IKKE (bruker en fast pool-prosent for vinneren).
 *   - **Visuell stil**: G3-klient bruker Spill 1's design (egen PR-del).
 *
 * Per Tobias 2026-05-03:
 *   "Spill 2 og 3 har ETT globalt rom. Ingen group-of-halls, ingen master/
 *    start/stop. Aldri stopper — utbetal gevinst → fortsetter automatisk.
 *    Kun digitale bonger."
 *
 * **Perpetual loop**: når Coverall vinnes utbetales gevinst og rommet
 * markeres `ENDED`. En egen scheduler/tick (utenfor engine) skal trigge ny
 * runde — engine eksponerer signal via `lastDrawEffectsByRoom`-effekten
 * (`gameEnded: true, endedReason: "G3_FULL_HOUSE"`) som socket-laget
 * konsumerer. Implementering av selve auto-restart-tikket er **scope-cut for
 * denne PR-en** — fundamentet (engine-API + ENDED-signal) er på plass.
 *
 * Non-G3 rooms er uberørt: `isGame3Round(...)` returnerer tidlig for hver
 * runde som ikke har G3-slug-kombinasjonen. Game 2 (Spill 2) har sin egen
 * separate engine-subklasse og deler ikke kode-path med G3 — selv om begge
 * bruker `hasFull3x3` som vinner-predicate.
 *
 * Legacy 5×5-cycler-kode (PatternCycler, processG3Winners, buildPatternSpecs)
 * er fjernet i denne refaktoreringen — den var bundet til 5×5-grid og hadde
 * ingen meningsfull rolle i 3×3-modellen. Hvis Tobias ombestemmer seg eller
 * vi får et nytt 5×5-mønsterspill kan logikken hentes fra git-historikk.
 */

import { randomUUID } from "node:crypto";
import { BingoEngine } from "./BingoEngine.js";
import { IdempotencyKeys } from "./idempotency.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import { hasFull3x3, GAME3_SLUGS } from "./ticket.js";
import type {
  ClaimRecord,
  GameState,
  Player,
  RoomState,
} from "./types.js";
import type { GameVariantConfig } from "./variantConfig.js";
import type { LedgerChannel, LedgerGameType } from "./ComplianceLedger.js";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";

const logger = rootLogger.child({ module: "engine.game3" });

/**
 * Andel av prize-pool som utbetales til Coverall-vinneren når
 * `variantConfig.luckyNumberPrize` ikke er satt og det ikke finnes en
 * eksplisitt `patterns[].prizePercent`. Tilsvarer Spill 2's tilnærming der
 * full-bong-vinneren får (omtrent) hele potten innenfor RTP-budget og
 * single-prize-cap. Verdien er konservativ — admin kan overstyre via
 * `variantConfig.patterns[0].prizePercent` (først element brukes).
 */
const DEFAULT_G3_COVERALL_PRIZE_PERCENT = 80;

/**
 * Per-draw G3 side-effects publisert til socket-laget.
 *
 * Populeres av {@link Game3Engine.onDrawCompleted}, drenes atomisk av
 * {@link Game3Engine.getG3LastDrawEffects}. Wire-shape er bevart fra den
 * gamle 5×5-implementasjonen for å minimere bredde-endringer i socket-
 * eventene — `patternSnapshot` inneholder nå EN entry (Coverall) i stedet
 * for opptil 5 (Row 1-4 + Full House).
 */
export interface G3DrawEffects {
  roomCode: string;
  gameId: string;
  drawIndex: number;
  lastBall: number;
  /** True når Coverall-pattern endret state (vunnet) på denne trekningen. */
  patternsChanged: boolean;
  /** Singleton-array med Coverall-snapshot — wire-kompatibilitet med eldre klienter. */
  patternSnapshot: G3PatternSnapshot[];
  /** Non-empty når Coverall ble vunnet på denne trekningen. */
  winners: G3WinnerRecord[];
  /** True når Coverall vant og runden endte. */
  gameEnded: boolean;
  /** Settes når gameEnded; "G3_FULL_HOUSE" alltid. */
  endedReason?: string;
}

/**
 * Wire-shape pattern-snapshot. Beholdes for backward-kompat med klienter som
 * leser `g3:pattern:changed`. For 3×3-Spill 3 er dette alltid en singleton
 * med Coverall (full bong) som eneste pattern.
 */
export interface G3PatternSnapshot {
  id: string;
  name: string;
  ballThreshold: number;
  isFullHouse: boolean;
  isWon: boolean;
  design: number;
  /**
   * Pattern-mask som flat array. For 3×3-Spill 3 er dette en 9-celle full-
   * mask (alle 1-er). Beholder `number[]` shape for wire-kompat.
   */
  patternDataList: number[];
  amount: number;
}

export interface G3WinnerRecord {
  patternId: string;
  patternName: string;
  isFullHouse: boolean;
  /** Premie per (ticket, pattern)-vinner etter split. */
  pricePerWinner: number;
  /** Én entry per (player, ticket) som matchet pattern på denne trekningen. */
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

/**
 * Identifier for "Coverall"-pattern i wire-snapshots. Eksportert så socket-
 * tester kan referere stabilt navn uten magiske strenger.
 */
export const G3_COVERALL_PATTERN_ID = "g3-coverall";
export const G3_COVERALL_PATTERN_NAME = "Coverall";

/**
 * Hele 9-celle full-bong-mask som flat array for wire-emission. Beholdes
 * eksportert for bruk i tester og potensielle integrasjoner.
 */
export const G3_3X3_FULL_MASK_FLAT: number[] = [1, 1, 1, 1, 1, 1, 1, 1, 1];

export class Game3Engine extends BingoEngine {
  /**
   * Atomisk read-and-clear stash for per-draw G3 effekter — socket-laget
   * konsumerer via {@link getG3LastDrawEffects} etter `drawNextNumber`.
   */
  private readonly lastDrawEffectsByRoom = new Map<string, G3DrawEffects>();

  /**
   * Public reader for socket-laget. Returnerer `undefined` når siste
   * trekning ikke var en G3-trekning (eller effektene allerede er konsumert).
   */
  getG3LastDrawEffects(roomCode: string): G3DrawEffects | undefined {
    const effects = this.lastDrawEffectsByRoom.get(roomCode);
    if (effects) this.lastDrawEffectsByRoom.delete(roomCode);
    return effects;
  }

  /**
   * Override av BingoEngine sin draw-completed-hook:
   *   - Non-G3 rooms → fall through (super-implementasjonen kjører normalt)
   *   - G3 rooms     → skann tickets for full 3×3, auto-claim + split,
   *                    avslutt rund når Coverall lander.
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

    // Spill 3 evaluerer Coverall etter HVER trekning. Det finnes ingen
    // minste-antall-baller-grense (i motsetning til Spill 2's
    // GAME2_MIN_DRAWS_FOR_CHECK = 9 før jackpot-evaluering kicker inn) —
    // teoretisk sett kan en Coverall lande på allerede første trekning hvis
    // bingo-ticket inneholder kun 1 unik tall, men praktisk vil den lande
    // tidligst etter at alle 9 cellene er trukket.
    const prizePercent = this.resolveCoverallPrizePercent(variantConfig!);
    const candidates = this.findG3Winners(room, game);
    if (candidates.length === 0) {
      // Ingen vinnere denne trekningen — publiser snapshot uten winners.
      this.lastDrawEffectsByRoom.set(room.code, {
        roomCode: room.code,
        gameId: game.id,
        drawIndex,
        lastBall,
        patternsChanged: false,
        patternSnapshot: [this.buildCoverallSnapshot(game, prizePercent, false)],
        winners: [],
        gameEnded: false,
      });
      return;
    }

    const winnerRecord = await this.processG3CoverallWinners({
      room,
      game,
      candidates,
      lastBall,
      drawIndex,
      variantConfig: variantConfig!,
      prizePercent,
    });

    // Coverall vant → avslutt rund (perpetual restart håndteres av
    // socket-laget / scheduler etter at endedReason er publisert).
    const endedAtMs = Date.now();
    game.bingoWinnerId = winnerRecord.ticketWinners[0]?.playerId;
    game.status = "ENDED";
    game.endedAt = new Date(endedAtMs).toISOString();
    game.endedReason = "G3_FULL_HOUSE";
    await this.finishPlaySessionsForGame(room, game, endedAtMs);
    await this.writeGameEndCheckpoint(room, game);
    await this.rooms.persist(room.code);

    this.lastDrawEffectsByRoom.set(room.code, {
      roomCode: room.code,
      gameId: game.id,
      drawIndex,
      lastBall,
      patternsChanged: true,
      patternSnapshot: [this.buildCoverallSnapshot(game, prizePercent, true)],
      winners: [winnerRecord],
      gameEnded: true,
      endedReason: "G3_FULL_HOUSE",
    });
  }

  /**
   * Resolve Coverall-prosent fra variantConfig.
   *
   * Prioritet:
   *   1. `variantConfig.patterns[0].prizePercent` hvis > 0 (admin-override)
   *   2. DEFAULT_G3_COVERALL_PRIZE_PERCENT (80%) ellers
   *
   * NB: Denne leser fra `variantConfig` (live config) — IKKE fra `game.patterns`,
   * fordi BingoEngine.startGame substituerer `DEFAULT_PATTERNS` (1 Rad / Full
   * Plate, Spill 1-defaults) når `variantConfig.patterns` er tomt. Den substitusjonen
   * er irrelevant for Spill 3 siden vi har vår egen Coverall-prize-resolver, men
   * vi må unngå å lese fra `game.patterns[0]` som ville gitt 30% istedenfor 80%.
   */
  private resolveCoverallPrizePercent(variantConfig: GameVariantConfig): number {
    const configured = variantConfig.patterns?.[0]?.prizePercent;
    if (typeof configured === "number" && configured > 0) return configured;
    return DEFAULT_G3_COVERALL_PRIZE_PERCENT;
  }

  // ── Winner detection ───────────────────────────────────────────────────────

  /**
   * Skann alle (player, ticket) for full 3×3 (9/9 trukne tall). Identisk
   * predicate som Spill 2's {@link Game2Engine.findG2Winners} men holdes
   * separat for å bevare separasjon mellom G2/G3-engine-paths.
   *
   * Returnerer én entry per (player, ticket) som har full bong — samme
   * spiller med flere fulle bonger får flere entries (legacy parity med
   * G2: hver bong er en uavhengig vinner).
   */
  private findG3Winners(room: RoomState, game: GameState): Array<{
    player: Player;
    ticketIndex: number;
    ticketId?: string;
  }> {
    const drawnSet = new Set(game.drawnNumbers);
    const winners: Array<{ player: Player; ticketIndex: number; ticketId?: string }> = [];
    for (const player of room.players.values()) {
      const tickets = game.tickets.get(player.id);
      if (!tickets) continue;
      for (let i = 0; i < tickets.length; i += 1) {
        const t = tickets[i];
        if (hasFull3x3(t, drawnSet)) {
          winners.push({ player, ticketIndex: i, ticketId: t.id });
        }
      }
    }
    return winners;
  }

  // ── Payout ─────────────────────────────────────────────────────────────────

  /**
   * Utbetal Coverall-premie til alle (player, ticket)-vinnere via likedeling.
   *
   * Premieløsning:
   *   1. Hvis `variantConfig.patterns[0].prizePercent` > 0 → bruk det
   *   2. Ellers → bruk DEFAULT_G3_COVERALL_PRIZE_PERCENT (80%) av
   *      `game.prizePool`
   *
   * Split: `round(totalPrize / winnerCount)` per (ticket, player), samme
   * mønster som Spill 2's `resolveJackpotPrize`. Restbeløp etter rundings-
   * tap havner i RTP-budgetet (ingen "phantom money").
   */
  private async processG3CoverallWinners(args: {
    room: RoomState;
    game: GameState;
    candidates: Array<{ player: Player; ticketIndex: number; ticketId?: string }>;
    lastBall: number;
    drawIndex: number;
    variantConfig: GameVariantConfig;
    /** Pre-resolved av onDrawCompleted så snapshot og payout bruker samme prosent. */
    prizePercent: number;
  }): Promise<G3WinnerRecord> {
    const { room, game, candidates, lastBall, drawIndex, variantConfig, prizePercent } = args;

    const totalPrize = roundCurrency((game.prizePool * prizePercent) / 100);
    const pricePerWinner = candidates.length > 0
      ? Math.round(totalPrize / candidates.length)
      : totalPrize;

    // K2-A CRIT-1 (utvidelse 2026-04-30): Spill 3 (slug `monsterbingo`) er
    // hovedspill — bruk per-spill resolver for ledger-gameType.
    const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);

    const ticketWinners: G3TicketWinner[] = [];
    for (const c of candidates) {
      const claimId = randomUUID();
      const claim: ClaimRecord = {
        id: claimId,
        playerId: c.player.id,
        type: "BINGO",
        valid: true,
        autoGenerated: true,
        createdAt: new Date().toISOString(),
        payoutAmount: 0,
      };

      const paid = pricePerWinner > 0
        ? await this.payG3CoverallShare({
            room,
            game,
            player: c.player,
            claim,
            requestedPayout: pricePerWinner,
            houseAccountId,
            gameType,
            channel,
          })
        : 0;

      // Lucky-number bonus: paid only when lastBall === player's luckyNumber
      // AND `variantConfig.luckyNumberPrize > 0`. Samme semantics som G2.
      let luckyPaid = 0;
      const luckyNumber = this.luckyNumbersByPlayer.get(room.code)?.get(c.player.id);
      const luckyPrize = variantConfig.luckyNumberPrize ?? 0;
      if (luckyNumber !== undefined && luckyNumber === lastBall && luckyPrize > 0) {
        luckyPaid = await this.payG3LuckyBonus({
          room,
          game,
          player: c.player,
          claim,
          requestedPayout: luckyPrize,
          houseAccountId,
          gameType,
          channel,
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
            playerId: c.player.id,
            type: claim.type,
            valid: claim.valid,
            reason: claim.reason,
          });
        } catch (err) {
          logger.error({ err, gameId: game.id, roomCode: room.code }, "onClaimLogged failed for G3 auto-claim");
        }
      }

      ticketWinners.push({
        playerId: c.player.id,
        ticketIndex: c.ticketIndex,
        ticketId: c.ticketId,
        claimId,
        payoutAmount: paid,
        luckyBonus: luckyPaid,
      });

      logger.info({
        event: "G3_COVERALL_PAYOUT",
        roomCode: room.code,
        gameId: game.id,
        playerId: c.player.id,
        claimId,
        drawIndex,
        pricePerWinner,
        paid,
        luckyBonus: luckyPaid,
      }, "Game 3 Coverall payout");
    }

    return {
      patternId: G3_COVERALL_PATTERN_ID,
      patternName: G3_COVERALL_PATTERN_NAME,
      isFullHouse: true,
      pricePerWinner,
      ticketWinners,
    };
  }

  /**
   * Apply single-prize cap, transfer house → player, oppdater compliance-
   * ledger + payout-audit. Identisk shape som Game2Engine sin payG2JackpotShare
   * — beholdes som privat metode for å unngå tett kopling mellom subklassene.
   */
  private async payG3CoverallShare(args: {
    room: RoomState;
    game: GameState;
    player: Player;
    claim: ClaimRecord;
    requestedPayout: number;
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
  }): Promise<number> {
    const { room, game, player, claim, requestedPayout, houseAccountId, gameType, channel } = args;
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
    const transfer = await this.walletAdapter.transfer(
      houseAccountId,
      player.walletId,
      payout,
      `G3 Coverall ${room.code}`,
      {
        idempotencyKey: IdempotencyKeys.game3Pattern({
          gameId: game.id,
          claimId: claim.id,
        }),
        targetSide: "winnings",
      }
    );
    player.balance = roundCurrency(player.balance + payout);
    game.remainingPrizePool = roundCurrency(Math.max(0, game.remainingPrizePool - payout));
    game.remainingPayoutBudget = roundCurrency(Math.max(0, game.remainingPayoutBudget - payout));
    await this.compliance.recordLossEntry(player.walletId, room.hallId, {
      type: "PAYOUT",
      amount: payout,
      createdAtMs: Date.now()
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
      policyVersion: capped.policy.id
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
      txIds: [transfer.fromTx.id, transfer.toTx.id]
    });
    claim.payoutTransactionIds = [...(claim.payoutTransactionIds ?? []), transfer.fromTx.id, transfer.toTx.id];
    claim.payoutPolicyVersion = capped.policy.id;
    claim.payoutWasCapped = payout < requestedPayout;
    claim.rtpBudgetBefore = rtpBefore;
    claim.rtpBudgetAfter = roundCurrency(Math.max(0, game.remainingPayoutBudget));
    claim.rtpCapped = payout < afterPoolCap;
    if (this.bingoAdapter.onCheckpoint) {
      await this.writePayoutCheckpointWithRetry(
        room, game, claim.id, payout,
        [transfer.fromTx.id, transfer.toTx.id],
        "BINGO"
      );
    }
    return payout;
  }

  /**
   * Lucky-number bonus payout — paid on top of Coverall when lastBall ===
   * player.luckyNumber. Identisk shape som G2's payG2LuckyBonus.
   */
  private async payG3LuckyBonus(args: {
    room: RoomState;
    game: GameState;
    player: Player;
    claim: ClaimRecord;
    requestedPayout: number;
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
  }): Promise<number> {
    const { room, game, player, claim, requestedPayout, houseAccountId, gameType, channel } = args;
    const capped = this.prizePolicy.applySinglePrizeCap({
      hallId: room.hallId,
      gameType: "DATABINGO",
      amount: requestedPayout,
    });
    const afterPoolCap = Math.min(capped.cappedAmount, game.remainingPrizePool);
    const payout = Math.max(0, Math.min(afterPoolCap, game.remainingPayoutBudget));
    if (payout <= 0) return 0;
    const transfer = await this.walletAdapter.transfer(
      houseAccountId,
      player.walletId,
      payout,
      `G3 lucky bonus ${room.code}`,
      {
        idempotencyKey: IdempotencyKeys.game3Lucky({
          gameId: game.id,
          claimId: claim.id,
        }),
        targetSide: "winnings",
      }
    );
    player.balance = roundCurrency(player.balance + payout);
    game.remainingPrizePool = roundCurrency(Math.max(0, game.remainingPrizePool - payout));
    game.remainingPayoutBudget = roundCurrency(Math.max(0, game.remainingPayoutBudget - payout));
    await this.compliance.recordLossEntry(player.walletId, room.hallId, {
      type: "PAYOUT",
      amount: payout,
      createdAtMs: Date.now()
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
      policyVersion: capped.policy.id
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
      txIds: [transfer.fromTx.id, transfer.toTx.id]
    });
    claim.payoutTransactionIds = [...(claim.payoutTransactionIds ?? []), transfer.fromTx.id, transfer.toTx.id];
    return payout;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Guard predicate: true når runden er en G3 auto-claim-runde.
   *
   * Kriterier (ALLE må holde):
   *   - room.gameSlug i GAME3_SLUGS (`monsterbingo` / `mønsterbingo` / `game_3`)
   *   - variantConfig.patternEvalMode === "auto-claim-on-draw"
   *   - variantConfig.jackpotNumberTable IKKE satt (det er G2-markøren)
   *
   * Holder G1 (manual-claim) og G2 (jackpotNumberTable) begge utenfor hooken.
   * Bruker direkte `GAME3_SLUGS.has(slug)` i stedet for `uses5x5NoCenterTicket`
   * fordi den hjelperen er deprecated etter 2026-05-03 (Spill 3 → 3×3).
   */
  private isGame3Round(room: RoomState, variantConfig: GameVariantConfig | undefined): boolean {
    if (!variantConfig) return false;
    if (variantConfig.patternEvalMode !== "auto-claim-on-draw") return false;
    if (variantConfig.jackpotNumberTable) return false; // G2-markør
    return GAME3_SLUGS.has(room.gameSlug ?? "");
  }

  /**
   * Bygg singleton Coverall-pattern-snapshot for wire-emission. Returnerer
   * EN entry siden Spill 3 har kun ett pattern (full 3×3-bong).
   *
   * `prizePercent` må komme fra {@link resolveCoverallPrizePercent} så snapshot
   * og payout bruker samme prosent (NB: `game.patterns` blir substituert med
   * Spill 1's defaults når variantConfig.patterns er tomt — vi må IKKE lese
   * derfra her).
   */
  private buildCoverallSnapshot(
    game: GameState,
    prizePercent: number,
    isWon: boolean,
  ): G3PatternSnapshot {
    const amount = roundCurrency((game.prizePool * prizePercent) / 100);
    return {
      id: G3_COVERALL_PATTERN_ID,
      name: G3_COVERALL_PATTERN_NAME,
      ballThreshold: 21, // Coverall kan vinnes når som helst inntil bag exhaustion
      isFullHouse: true,
      isWon,
      design: 0,
      patternDataList: [...G3_3X3_FULL_MASK_FLAT],
      amount,
    };
  }
}
