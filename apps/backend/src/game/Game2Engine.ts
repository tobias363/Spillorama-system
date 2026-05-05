/**
 * BIN-615 / PR-C2: Game 2 (Tallspill / Spill 2) engine — extends BingoEngine
 * to add auto-claim-on-draw behaviour for the 3×3 / 1..21 variant.
 *
 * G1 rooms are unaffected — the G2 hook path is guarded by
 * `variantConfig.patternEvalMode === "auto-claim-on-draw"` AND the presence
 * of a 3×3 ticket grid. Every other room falls through to the BingoEngine
 * default `onDrawCompleted` (no-op), preserving G1 manual-claim semantics.
 *
 * Legacy references:
 *   - Game/Game2/Controllers/GameProcess.js:192-252 — draw loop + shouldStop
 *   - Game/Game2/Controllers/GameProcess.js:254-367 — checkForWinners
 *     (matched.length > 8 = full 3×3, triggers only after draw 9)
 *   - Game/Game2/Controllers/GameProcess.js:343-354 — TicketCompleted per-winner emit
 *   - gamehelper/game2.js:1466-1625 — normalize + checkJackPot (multi-winner split)
 *   - gamehelper/game2.js:1628-1712 — checkLuckyNumber (lastBall === luckyNumber bonus)
 *   - Game/Game2/Controllers/GameController.js:873-891 — game2JackpotUpdate (per-draw broadcast)
 *
 * Event emission is deferred to the socket layer via
 * {@link getG2LastDrawEffects}. Keeps the engine socket-agnostic.
 */

import { randomUUID } from "node:crypto";
import { BingoEngine } from "./BingoEngine.js";
import { IdempotencyKeys } from "./idempotency.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import { metrics } from "../util/metrics.js";
import { hasFull3x3, ticketContainsNumber } from "./ticket.js";
import {
  computeJackpotList,
  resolveJackpotPrize,
  type JackpotListEntry,
} from "./Game2JackpotTable.js";
import type { GameState, Player, RoomState, ClaimRecord } from "./types.js";
import type { GameVariantConfig } from "./variantConfig.js";
import type { LedgerChannel, LedgerGameType } from "./ComplianceLedger.js";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
import type { PrizePolicyVersion } from "./PrizePolicyManager.js";

const logger = rootLogger.child({ module: "engine.game2" });

/** Minimum draws required before winner check runs (legacy: >9 balls → check). */
export const GAME2_MIN_DRAWS_FOR_CHECK = 9;
/**
 * 2026-05-03: Maks antall baller i Spill 2 (1..21). Når
 * `drawnNumbers.length >= 21` og ingen vinner ennå → runden ender med
 * `endedReason: "G2_NO_WINNER"` så `PerpetualRoundService.handleGameEnded`
 * kan spawne ny runde. Uten denne henger rommet på status=RUNNING for
 * alltid og blokkerer perpetual-loopen.
 */
export const GAME2_MAX_BALLS = 21;

/**
 * SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §3.1: når antall vinnere overstiger
 * denne terskelen bytter onDrawCompleted til batched parallel mass-payout-
 * pathen. Under terskelen brukes sequential-path som er enklere og
 * tilstrekkelig rask. Tobias-direktiv 2026-05-05: pilot-skala 24 haller ×
 * 1500 spillere = 36 000 samtidige; worst-case 100+ vinnere på siste ball.
 *
 * Sequential-pathen tar ~250-500ms per vinner (4-5 sekvensielle Postgres-
 * roundtrips: walletAdapter.transfer + recordLossEntry +
 * recordComplianceLedgerEvent + appendPayoutAuditEvent + checkpoint).
 * 100 vinnere × 500ms = 50s — blokkerer auto-draw-tick (30s).
 *
 * Med parallel-path: hver batch av 50 kjører konkurrent. Under
 * antagelsen at Postgres-poolen har ~25 connections, treffer vi
 * naturlig parallelism-grense. 100 vinnere → 2 batcher × ~3-5s = ~6-10s.
 */
export const MASS_PAYOUT_PARALLEL_THRESHOLD = 10;
export const MASS_PAYOUT_BATCH_SIZE = 50;

/**
 * Bucket-label-helper for spill23_ondrawcompleted_duration_ms metric.
 * Lar p95 segmenteres på antall vinnere uten cardinality-eksplosjon.
 */
function winnersBucketLabel(count: number): "0-9" | "10-49" | "50-99" | "100+" {
  if (count < 10) return "0-9";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  return "100+";
}

/**
 * Per-draw G2 side-effects published to the socket layer.
 *
 * The socket handler (gameEvents.ts `draw:next`) reads this AFTER drawNextNumber
 * returns and emits the corresponding wire events:
 *   - g2:jackpot:list-update (always, when jackpotList is set)
 *   - g2:ticket:completed    (private, per winner)
 *   - g2:rocket:launch       (broadcast, once per round when game ends with winners)
 */
export interface G2DrawEffects {
  roomCode: string;
  gameId: string;
  drawIndex: number;
  lastBall: number;
  /** Updated per-draw jackpot display list — emitted on every G2 draw. */
  jackpotList: JackpotListEntry[];
  /** Non-empty when 9/9-completion was detected this draw. */
  winners: G2WinnerRecord[];
  /** True when the round ended as a result of winners being found. */
  gameEnded: boolean;
  /** When gameEnded, the terminal reason string set on game.endedReason. */
  endedReason?: string;
}

export interface G2WinnerRecord {
  playerId: string;
  /** Winner's ticket index within their ticket array (per room.tickets map). */
  ticketIndex: number;
  /** Optional stable ticket id if the Ticket carried one. */
  ticketId?: string;
  /** ClaimRecord.id — autoGenerated=true for all G2 auto-claims. */
  claimId: string;
  /** Jackpot prize in kr after split + cap. 0 when no jackpot entry matched. */
  jackpotPrize: number;
  /** Lucky-number bonus in kr (legacy game2.js:1628-1712). 0 when not triggered. */
  luckyBonus: number;
  /** Total credited to player's wallet this draw (jackpotPrize + luckyBonus after caps). */
  totalPayout: number;
}

export class Game2Engine extends BingoEngine {
  /**
   * BIN-615 / PR-C2: Side-effects stash per room. Populated by onDrawCompleted,
   * drained by the socket layer after drawNextNumber returns. The socket layer
   * calls {@link getG2LastDrawEffects} which atomically reads-and-clears.
   */
  private readonly lastDrawEffectsByRoom = new Map<string, G2DrawEffects>();

  /**
   * BIN-615 / PR-C2: Public reader for the socket layer. Returns undefined when
   * the last draw was not a G2 draw or effects have already been consumed.
   *
   * Atomic read-and-clear so the same effects aren't emitted twice on replay.
   */
  getG2LastDrawEffects(roomCode: string): G2DrawEffects | undefined {
    const effects = this.lastDrawEffectsByRoom.get(roomCode);
    if (effects) this.lastDrawEffectsByRoom.delete(roomCode);
    return effects;
  }

  /**
   * BIN-615 / PR-C1 hook (C2 override):
   *   - Non-G2 rooms → fall through to base no-op.
   *   - G2 rooms → compute jackpotList; if drawIndex ≥ 9, scan tickets for 9/9,
   *     run auto-claim + multi-winner payout + lucky-bonus, end game on winners.
   *
   * All side-effects stashed into lastDrawEffectsByRoom for the socket layer.
   */
  protected async onDrawCompleted(ctx: {
    room: RoomState;
    game: GameState;
    lastBall: number;
    drawIndex: number;
    variantConfig: GameVariantConfig | undefined;
  }): Promise<void> {
    const { room, game, lastBall, drawIndex, variantConfig } = ctx;
    if (!this.isGame2Round(variantConfig)) return;

    // 2026-05-04 (Tobias bug-fix): auto-mark celler som matcher lastBall.
    // Spill 2 er auto-claim-on-draw — engine evaluerer 9/9-completion via
    // `findG2Winners` som bruker `drawnNumbers` direkte. Men `game.marks`
    // ble aldri oppdatert, så debug-route + recovery + late-joiner-state
    // viste 0 marks selv når 7/9 celler matchet trukne baller.
    //
    // Bivirkninger: ingen — `findG2Winners` baserer seg på `drawnNumbers`,
    // ikke `marks`. Klient-UIet beregner egne marks via `state.myMarks[i] ??
    // state.drawnNumbers` (PlayScreen.ts), så fallbacken fortsatte å virke
    // før denne fixen. Auto-mark sikrer audit-paritet med Spill 1 og at
    // hver runde har korrekt mark-state for compliance-eksport.
    autoMarkPlayerCells(game, lastBall);

    const purchasedTickets = countTickets(game);
    const ticketPrice = game.entryFee;
    const jackpotList = computeJackpotList(
      variantConfig!.jackpotNumberTable ?? {},
      purchasedTickets,
      ticketPrice,
    );

    if (drawIndex < GAME2_MIN_DRAWS_FOR_CHECK) {
      // Pre-check draws: publish jackpot list only.
      this.lastDrawEffectsByRoom.set(room.code, {
        roomCode: room.code,
        gameId: game.id,
        drawIndex,
        lastBall,
        jackpotList,
        winners: [],
        gameEnded: false,
      });
      return;
    }

    // Scan all tickets for 9/9 full-plate completion.
    const candidates = this.findG2Winners(room, game);
    if (candidates.length === 0) {
      // 2026-05-03: hvis alle 21 baller er trukket uten vinner, ender vi
      // runden med endedReason="G2_NO_WINNER" så PerpetualRoundService
      // kan spawne ny runde via onGameEnded-hooken. Tidligere hang
      // rommet på status=RUNNING for alltid og blokkerte loopen.
      //
      // BUG-FIX 2026-05-03: drawIndex er 0-basert (BIN-689) — på siste
      // (21.) ball er drawIndex=20. Sjekken `>= GAME2_MAX_BALLS (21)`
      // traff aldri. Bytter til drawnNumbers.length som er antall trukne
      // baller (1-basert teller) — på siste ball er den lik
      // GAME2_MAX_BALLS (21). Verifisert via Agent CC Playwright-test:
      // ROCKET-rom hadde drawnNumbers.length=21 men drawIndex=20.
      if (game.drawnNumbers.length >= GAME2_MAX_BALLS) {
        const endedAtMs = Date.now();
        game.status = "ENDED";
        game.endedAt = new Date(endedAtMs).toISOString();
        game.endedReason = "G2_NO_WINNER";
        await this.finishPlaySessionsForGame(room, game, endedAtMs);
        await this.writeGameEndCheckpoint(room, game);
        await this.rooms.persist(room.code);

        this.lastDrawEffectsByRoom.set(room.code, {
          roomCode: room.code,
          gameId: game.id,
          drawIndex,
          lastBall,
          jackpotList,
          winners: [],
          gameEnded: true,
          endedReason: "G2_NO_WINNER",
        });
        return;
      }

      this.lastDrawEffectsByRoom.set(room.code, {
        roomCode: room.code,
        gameId: game.id,
        drawIndex,
        lastBall,
        jackpotList,
        winners: [],
        gameEnded: false,
      });
      return;
    }

    // Resolve jackpot prize per current draw count (9..21 bucket semantics).
    const jackpotResolution = resolveJackpotPrize(
      variantConfig!.jackpotNumberTable ?? {},
      drawIndex,
      candidates.length,
      purchasedTickets,
      ticketPrice,
    );

    // 2026-05-06 (audit §3.1 fix): track total time spent in mass-payout-
    // pathen for histogram-metric. Slug fixed til "rocket" — Game3Engine
    // overrider denne hooken via own onDrawCompleted-implementasjon, så
    // når denne pathen kjører er det alltid Spill 2 (rocket).
    const onDrawStartMs = Date.now();
    const winnersBucket = winnersBucketLabel(candidates.length);

    const winnerRecords: G2WinnerRecord[] = [];
    // K2-A CRIT-1 (utvidelse 2026-04-30): Spill 2 (slug `rocket`) er
    // hovedspill — bruk per-spill resolver for ledger-gameType. Resolver
    // er tolerant for null/manglende slug; faller til DATABINGO for å
    // bevare bakoverkompatibilitet for ukjente slugs.
    const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);

    // 2026-05-06 (audit §3.1 fix): batched parallel mass-payout-path når
    // antall vinnere overstiger MASS_PAYOUT_PARALLEL_THRESHOLD. Pre-fix
    // sequential-pathen kunne ta 15-20s ved 100 vinnere — blokkerte auto-
    // draw-tick-en og kaskaderte til timeout-errors.
    //
    // Strategi (regulatorisk-trygg):
    //   1. Pre-pass (sync): allokér jackpot-payout per vinner deterministic
    //      iht. budget/pool/cap. Decrement game.remainingPayoutBudget +
    //      remainingPrizePool synkront i samme rekkefølge som sequential.
    //   2. I/O-pass (parallel batches): spawn walletAdapter.transfer +
    //      compliance + ledger + audit + checkpoint via Promise.allSettled
    //      i batches av MASS_PAYOUT_BATCH_SIZE.
    //
    // Lucky-bonus kjøres fortsatt sequential — det krever lookup på
    // luckyNumbersByPlayer + samme budget-pool, og er en mindre andel av
    // total tid.
    const useBatchedPath = candidates.length > MASS_PAYOUT_PARALLEL_THRESHOLD;

    if (useBatchedPath) {
      await this.processG2WinnersBatched({
        room,
        game,
        candidates,
        jackpotResolution,
        variantConfig: variantConfig!,
        lastBall,
        drawIndex,
        houseAccountId,
        gameType,
        channel,
        winnerRecords,
      });
    } else {
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

        // Jackpot payout (per-winner split from resolveJackpotPrize).
        let jackpotPaid = 0;
        if (jackpotResolution && jackpotResolution.pricePerWinner > 0) {
          jackpotPaid = await this.payG2JackpotShare({
            room,
            game,
            player: c.player,
            claim,
            requestedPayout: jackpotResolution.pricePerWinner,
            drawIndex,
            houseAccountId,
            gameType,
            channel,
          });
        }

        // Lucky-number bonus (legacy game2.js:1628-1712): paid only when
        // lastBall === this player's luckyNumber AND they won.
        let luckyPaid = 0;
        const luckyNumber = this.luckyNumbersByPlayer.get(room.code)?.get(c.player.id);
        const luckyPrize = variantConfig!.luckyNumberPrize ?? 0;
        if (luckyNumber !== undefined && luckyNumber === lastBall && luckyPrize > 0) {
          luckyPaid = await this.payG2LuckyBonus({
            room,
            game,
            player: c.player,
            claim,
            requestedPayout: luckyPrize,
            houseAccountId,
            gameType,
            channel,
          });
        }

        const totalPayout = roundCurrency(jackpotPaid + luckyPaid);
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
            logger.error({ err, gameId: game.id, roomCode: room.code }, "onClaimLogged failed for G2 auto-claim");
          }
        }

        winnerRecords.push({
          playerId: c.player.id,
          ticketIndex: c.ticketIndex,
          ticketId: c.ticketId,
          claimId,
          jackpotPrize: jackpotPaid,
          luckyBonus: luckyPaid,
          totalPayout,
        });
      }
    }

    // End the round — legacy: once winners are found, no more draws.
    const endedAtMs = Date.now();
    game.bingoWinnerId = winnerRecords[0]?.playerId;
    game.status = "ENDED";
    game.endedAt = new Date(endedAtMs).toISOString();
    game.endedReason = "G2_WINNER";
    await this.finishPlaySessionsForGame(room, game, endedAtMs);
    await this.writeGameEndCheckpoint(room, game);
    await this.rooms.persist(room.code);

    // 2026-05-06 (audit §3.1 fix): observability — record total
    // onDrawCompleted-duration including mass-payout. Alert i prod ved
    // p95 > 5s (Spill23_OnDrawCompletedSlow per audit §17).
    try {
      metrics.spill23OnDrawCompletedDuration.observe(
        { slug: "rocket", winnersBucket },
        Date.now() - onDrawStartMs,
      );
    } catch {
      // Metric-failure er aldri kritisk for game-flow.
    }

    this.lastDrawEffectsByRoom.set(room.code, {
      roomCode: room.code,
      gameId: game.id,
      drawIndex,
      lastBall,
      jackpotList,
      winners: winnerRecords,
      gameEnded: true,
      endedReason: "G2_WINNER",
    });
  }

  /**
   * 2026-05-06 (audit §3.1 fix): parallel mass-payout for store G2-runder.
   *
   * Aktiveres når `candidates.length > MASS_PAYOUT_PARALLEL_THRESHOLD`.
   * Skala-bevis (audit-mål): 100 vinnere skal fullføre under 5 sekunder.
   *
   * Algoritme:
   *   1. Pre-pass (sync): per vinner allokeres jackpotPayout +
   *      luckyPayout deterministic iht. game.remainingPayoutBudget /
   *      remainingPrizePool / single-prize-cap. Budget decrementeres
   *      synkront i samme rekkefølge som sequential-pathen ville gjort.
   *      Dette beholder regulatorisk atomicity — budget kan aldri gå
   *      negativ eller over-allokeres i parallel.
   *
   *   2. I/O-pass (parallel batches av MASS_PAYOUT_BATCH_SIZE):
   *      for hver vinner kjøres walletAdapter.transfer +
   *      compliance.recordLossEntry + ledger.recordComplianceLedgerEvent +
   *      payoutAudit.appendPayoutAuditEvent + checkpoint via
   *      Promise.allSettled. Postgres-poolens connection-grense (~25)
   *      naturlig serialiserer parallelism — vi får alle gevinstene gjort
   *      i tid uten å sprenge poolen.
   *
   *   3. Failure-håndtering: hvis en wallet-transfer feiler i parallel-
   *      batchen, logges feilen og vinneren markeres som "failed-payout".
   *      Idempotency-key i transfer-en betyr at en retry vil hoppe over
   *      duplikater. Outcome-metric (`spill23_mass_payout_outcome_total`)
   *      inkrementerer "partial" så ops kan alarmere.
   *
   * Regulatorisk: hver vinner får fortsatt enten alt eller ingenting per
   * wallet-transfer (én Postgres-transaksjon per vinner — atomicity er
   * uendret). Budget kan aldri over-allokeres fordi alt skjer synkront
   * i pre-pass-en. Hver vinner sin claim/budget-state er identisk med hva
   * sequential-pathen ville produsert i samme rekkefølge.
   */
  private async processG2WinnersBatched(args: {
    room: RoomState;
    game: GameState;
    candidates: Array<{ player: Player; ticketIndex: number; ticketId?: string }>;
    jackpotResolution: ReturnType<typeof resolveJackpotPrize>;
    variantConfig: GameVariantConfig;
    lastBall: number;
    drawIndex: number;
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    winnerRecords: G2WinnerRecord[];
  }): Promise<void> {
    const {
      room,
      game,
      candidates,
      jackpotResolution,
      variantConfig,
      lastBall,
      drawIndex,
      houseAccountId,
      gameType,
      channel,
      winnerRecords,
    } = args;

    type CapResult = { cappedAmount: number; wasCapped: boolean; policy: PrizePolicyVersion };
    interface AllocatedWinner {
      candidate: { player: Player; ticketIndex: number; ticketId?: string };
      claim: ClaimRecord;
      jackpotPayout: number;
      jackpotCappedPolicy: CapResult | null;
      luckyPayout: number;
      luckyCappedPolicy: CapResult | null;
      rtpBefore: number;
      jackpotRequested: number;
      jackpotAfterPoolCap: number;
    }

    // ── Phase A (sync): allocate budget per winner deterministically ──
    //
    // Same order + math as sequential-pathen så atomicity-invariantene
    // holder. Budget decrementes etter hver vinner; hvis budget løper tom
    // får senere vinnere 0 (samme oppførsel som sequential).
    const allocations: AllocatedWinner[] = [];
    const luckyPrize = variantConfig.luckyNumberPrize ?? 0;
    const cappedGameType = ledgerGameTypeForSlug(room.gameSlug);

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

      const rtpBefore = roundCurrency(Math.max(0, game.remainingPayoutBudget));

      // ── Jackpot allocation ──
      let jackpotPayout = 0;
      let jackpotCappedPolicy: CapResult | null = null;
      let jackpotRequested = 0;
      let jackpotAfterPoolCap = 0;
      if (jackpotResolution && jackpotResolution.pricePerWinner > 0) {
        jackpotRequested = jackpotResolution.pricePerWinner;
        const capped = this.prizePolicy.applySinglePrizeCap({
          hallId: room.hallId,
          gameType: cappedGameType,
          amount: jackpotRequested,
        });
        jackpotCappedPolicy = capped;
        jackpotAfterPoolCap = Math.min(capped.cappedAmount, game.remainingPrizePool);
        jackpotPayout = Math.max(0, Math.min(jackpotAfterPoolCap, game.remainingPayoutBudget));
        if (jackpotPayout > 0) {
          game.remainingPrizePool = roundCurrency(Math.max(0, game.remainingPrizePool - jackpotPayout));
          game.remainingPayoutBudget = roundCurrency(Math.max(0, game.remainingPayoutBudget - jackpotPayout));
        }
        // Speil samme claim-flag-mønster som payG2JackpotShare gjør på
        // 0-payout (capped/budget-exhaustion-event går fortsatt gjennom
        // I/O-pass-en).
        if (jackpotPayout <= 0) {
          claim.payoutWasCapped = jackpotRequested > 0;
          claim.rtpCapped = jackpotAfterPoolCap > 0 && game.remainingPayoutBudget <= 0;
          claim.rtpBudgetBefore = rtpBefore;
          claim.rtpBudgetAfter = rtpBefore;
        }
      }

      // ── Lucky bonus allocation (kun hvis jackpot ikke konsumerte
      // hele budget — speiler sequential-pathens semantikk der lucky
      // sjekkes etter jackpot allerede har trukket fra budget) ──
      let luckyPayout = 0;
      let luckyCappedPolicy: CapResult | null = null;
      const luckyNumber = this.luckyNumbersByPlayer.get(room.code)?.get(c.player.id);
      if (luckyNumber !== undefined && luckyNumber === lastBall && luckyPrize > 0) {
        const capped = this.prizePolicy.applySinglePrizeCap({
          hallId: room.hallId,
          gameType: cappedGameType,
          amount: luckyPrize,
        });
        luckyCappedPolicy = capped;
        const afterPoolCap = Math.min(capped.cappedAmount, game.remainingPrizePool);
        luckyPayout = Math.max(0, Math.min(afterPoolCap, game.remainingPayoutBudget));
        if (luckyPayout > 0) {
          game.remainingPrizePool = roundCurrency(Math.max(0, game.remainingPrizePool - luckyPayout));
          game.remainingPayoutBudget = roundCurrency(Math.max(0, game.remainingPayoutBudget - luckyPayout));
        }
      }

      allocations.push({
        candidate: c,
        claim,
        jackpotPayout,
        jackpotCappedPolicy,
        luckyPayout,
        luckyCappedPolicy,
        rtpBefore,
        jackpotRequested,
        jackpotAfterPoolCap,
      });
    }

    // ── Phase B (parallel batches): I/O ──
    let partialOutcome = false;
    const totalBatches = Math.ceil(allocations.length / MASS_PAYOUT_BATCH_SIZE);
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx += 1) {
      const start = batchIdx * MASS_PAYOUT_BATCH_SIZE;
      const end = Math.min(start + MASS_PAYOUT_BATCH_SIZE, allocations.length);
      const batch = allocations.slice(start, end);

      const settled = await Promise.allSettled(
        batch.map((alloc) =>
          this.transferG2PreallocatedPayout({
            room,
            game,
            allocation: alloc,
            houseAccountId,
            gameType,
            channel,
            drawIndex,
          }),
        ),
      );

      for (let i = 0; i < settled.length; i += 1) {
        const result = settled[i];
        const alloc = batch[i];
        if (result.status === "rejected") {
          partialOutcome = true;
          // Idempotency-key på transfer + ledger sikrer at retry fra
          // recovery-pathen hopper over duplikater. Vinneren får ikke
          // betaling i denne tick-en, men budget er fortsatt allokert
          // (compliance-conservative — better to over-deduct than over-pay).
          logger.error(
            {
              err: result.reason,
              event: "G2_MASS_PAYOUT_FAILED",
              roomCode: room.code,
              gameId: game.id,
              playerId: alloc.candidate.player.id,
              claimId: alloc.claim.id,
              jackpotPayout: alloc.jackpotPayout,
              luckyPayout: alloc.luckyPayout,
            },
            "G2 mass-payout: parallel transfer/ledger failed for one winner — retry from recovery",
          );
        }
      }
    }

    // ── Phase C (sequential): build winnerRecords + onClaimLogged ──
    //
    // Disse må kjøre etter I/O fordi claim.payoutTransactionIds settes
    // av transferG2PreallocatedPayout. Vi gjør det sequential fordi
    // game.claims.push og winnerRecords.push muterer shared state og
    // antall winnere er nå håndterbart (worst-case ~100).
    for (const alloc of allocations) {
      const totalPayout = roundCurrency(alloc.jackpotPayout + alloc.luckyPayout);
      alloc.claim.payoutAmount = totalPayout;
      game.claims.push(alloc.claim);

      if (this.bingoAdapter.onClaimLogged) {
        try {
          await this.bingoAdapter.onClaimLogged({
            roomCode: room.code,
            gameId: game.id,
            playerId: alloc.candidate.player.id,
            type: alloc.claim.type,
            valid: alloc.claim.valid,
            reason: alloc.claim.reason,
          });
        } catch (err) {
          logger.error({ err, gameId: game.id, roomCode: room.code }, "onClaimLogged failed for G2 auto-claim (batched)");
        }
      }

      winnerRecords.push({
        playerId: alloc.candidate.player.id,
        ticketIndex: alloc.candidate.ticketIndex,
        ticketId: alloc.candidate.ticketId,
        claimId: alloc.claim.id,
        jackpotPrize: alloc.jackpotPayout,
        luckyBonus: alloc.luckyPayout,
        totalPayout,
      });
    }

    try {
      metrics.spill23MassPayoutOutcome.inc({
        slug: "rocket",
        outcome: partialOutcome ? "partial" : "success",
      });
    } catch {
      // Metric-failure er aldri kritisk for game-flow.
    }
  }

  /**
   * 2026-05-06 (audit §3.1 fix): I/O-pass for én pre-allokert vinner.
   *
   * Brukes kun fra `processG2WinnersBatched` — alle budget-decrements
   * er allerede gjort i caller. Denne metoden kjører i parallel
   * (Promise.allSettled) og gjør:
   *   1. walletAdapter.transfer (Postgres TX, REPEATABLE READ + retry)
   *   2. compliance.recordLossEntry (fire-and-forget per port-kontrakt)
   *   3. ledger.recordComplianceLedgerEvent
   *   4. payoutAudit.appendPayoutAuditEvent
   *   5. writePayoutCheckpointWithRetry (hvis bingoAdapter har checkpoint)
   *
   * Hver av disse er per-wallet/per-claim, så de skalerer uten lock-
   * contention forutsatt Postgres-poolen har nok connections (Render
   * starter: 25). 100 winnere → ~4× sequence på poolen, godt under
   * 30s draw-tick-grensen.
   */
  private async transferG2PreallocatedPayout(args: {
    room: RoomState;
    game: GameState;
    allocation: {
      candidate: { player: Player; ticketIndex: number; ticketId?: string };
      claim: ClaimRecord;
      jackpotPayout: number;
      jackpotCappedPolicy: { cappedAmount: number; wasCapped: boolean; policy: PrizePolicyVersion } | null;
      luckyPayout: number;
      luckyCappedPolicy: { cappedAmount: number; wasCapped: boolean; policy: PrizePolicyVersion } | null;
      rtpBefore: number;
      jackpotRequested: number;
      jackpotAfterPoolCap: number;
    };
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    drawIndex: number;
  }): Promise<void> {
    const { room, game, allocation, houseAccountId, gameType, channel, drawIndex } = args;
    const {
      candidate,
      claim,
      jackpotPayout,
      jackpotCappedPolicy,
      luckyPayout,
      luckyCappedPolicy,
      rtpBefore,
      jackpotRequested,
      jackpotAfterPoolCap,
    } = allocation;
    const player = candidate.player;
    const txIds: string[] = [];

    // ── Jackpot transfer + ledger ──
    if (jackpotPayout > 0 && jackpotCappedPolicy) {
      const transfer = await this.walletAdapter.transfer(
        houseAccountId,
        player.walletId,
        jackpotPayout,
        `G2 jackpot prize ${room.code}`,
        {
          idempotencyKey: IdempotencyKeys.game2Jackpot({
            gameId: game.id,
            claimId: claim.id,
          }),
          targetSide: "winnings",
        },
      );
      player.balance = roundCurrency(player.balance + jackpotPayout);
      txIds.push(transfer.fromTx.id, transfer.toTx.id);

      await this.compliance.recordLossEntry(player.walletId, room.hallId, {
        type: "PAYOUT",
        amount: jackpotPayout,
        createdAtMs: Date.now(),
      });
      await this.ledger.recordComplianceLedgerEvent({
        hallId: room.hallId,
        gameType,
        channel,
        eventType: "PRIZE",
        amount: jackpotPayout,
        roomCode: room.code,
        gameId: game.id,
        claimId: claim.id,
        playerId: player.id,
        walletId: player.walletId,
        sourceAccountId: transfer.fromTx.accountId,
        targetAccountId: transfer.toTx.accountId,
        policyVersion: jackpotCappedPolicy.policy.id,
      });
      await this.payoutAudit.appendPayoutAuditEvent({
        kind: "CLAIM_PRIZE",
        claimId: claim.id,
        gameId: game.id,
        roomCode: room.code,
        hallId: room.hallId,
        policyVersion: jackpotCappedPolicy.policy.id,
        amount: jackpotPayout,
        walletId: player.walletId,
        playerId: player.id,
        sourceAccountId: houseAccountId,
        txIds: [transfer.fromTx.id, transfer.toTx.id],
      });
      // Speil sequential-pathens claim-flagg-semantikk:
      //   claim.payoutWasCapped = (payout < requestedPayout)
      //   claim.rtpCapped       = (payout < afterPoolCap)
      // Vi bruker pre-allokerings-snapshotten (`jackpotRequested`,
      // `jackpotAfterPoolCap`) som er identisk verdi-mønster som
      // sequential-pathen ville sett.
      claim.payoutPolicyVersion = jackpotCappedPolicy.policy.id;
      claim.payoutWasCapped = jackpotPayout < jackpotRequested;
      claim.rtpCapped = jackpotPayout < jackpotAfterPoolCap;
      claim.rtpBudgetBefore = rtpBefore;
      claim.rtpBudgetAfter = roundCurrency(Math.max(0, game.remainingPayoutBudget));

      logger.info(
        {
          event: "G2_JACKPOT_PAYOUT_BATCHED",
          roomCode: room.code,
          gameId: game.id,
          playerId: player.id,
          claimId: claim.id,
          drawIndex,
          paid: jackpotPayout,
        },
        "Game 2 jackpot share paid (batched)",
      );
    } else if (jackpotCappedPolicy) {
      // 0-payout audit-event (capped/budget-exhaustion). Sequential-pathen
      // skriver alltid en CLAIM_PRIZE-audit-event når policy var konsultert,
      // selv om amount=0.
      await this.payoutAudit.appendPayoutAuditEvent({
        kind: "CLAIM_PRIZE",
        claimId: claim.id,
        gameId: game.id,
        roomCode: room.code,
        hallId: room.hallId,
        policyVersion: jackpotCappedPolicy.policy.id,
        amount: 0,
        walletId: player.walletId,
        playerId: player.id,
        sourceAccountId: houseAccountId,
        txIds: [],
      });
    }

    // ── Lucky transfer + ledger ──
    if (luckyPayout > 0 && luckyCappedPolicy) {
      const transfer = await this.walletAdapter.transfer(
        houseAccountId,
        player.walletId,
        luckyPayout,
        `G2 lucky bonus ${room.code}`,
        {
          idempotencyKey: IdempotencyKeys.game2Lucky({
            gameId: game.id,
            claimId: claim.id,
          }),
          targetSide: "winnings",
        },
      );
      player.balance = roundCurrency(player.balance + luckyPayout);
      txIds.push(transfer.fromTx.id, transfer.toTx.id);

      await this.compliance.recordLossEntry(player.walletId, room.hallId, {
        type: "PAYOUT",
        amount: luckyPayout,
        createdAtMs: Date.now(),
      });
      await this.ledger.recordComplianceLedgerEvent({
        hallId: room.hallId,
        gameType,
        channel,
        eventType: "PRIZE",
        amount: luckyPayout,
        roomCode: room.code,
        gameId: game.id,
        claimId: claim.id,
        playerId: player.id,
        walletId: player.walletId,
        sourceAccountId: transfer.fromTx.accountId,
        targetAccountId: transfer.toTx.accountId,
        policyVersion: luckyCappedPolicy.policy.id,
      });
      await this.payoutAudit.appendPayoutAuditEvent({
        kind: "CLAIM_PRIZE",
        claimId: claim.id,
        gameId: game.id,
        roomCode: room.code,
        hallId: room.hallId,
        policyVersion: luckyCappedPolicy.policy.id,
        amount: luckyPayout,
        walletId: player.walletId,
        playerId: player.id,
        sourceAccountId: houseAccountId,
        txIds: [transfer.fromTx.id, transfer.toTx.id],
      });
      claim.bonusTriggered = true;
      claim.bonusAmount = luckyPayout;

      logger.info(
        {
          event: "G2_LUCKY_BONUS_PAYOUT_BATCHED",
          roomCode: room.code,
          gameId: game.id,
          playerId: player.id,
          claimId: claim.id,
          paid: luckyPayout,
        },
        "Game 2 lucky-number bonus paid (batched)",
      );
    }

    if (txIds.length > 0) {
      claim.payoutTransactionIds = [...(claim.payoutTransactionIds ?? []), ...txIds];
    }

    if (this.bingoAdapter.onCheckpoint && txIds.length > 0) {
      await this.writePayoutCheckpointWithRetry(
        room,
        game,
        claim.id,
        roundCurrency(jackpotPayout + luckyPayout),
        txIds,
        "BINGO",
      );
    }
  }

  /**
   * BIN-615 / PR-C2: Detect all tickets that are 9/9 matched (full 3×3).
   * Returns one record per winning (player, ticket) pair — legacy can award
   * the same player multiple times if they hold >1 completed ticket.
   *
   * Legacy ref: GameProcess.js:280-312 (ticket chunking + matched > 8 check).
   *
   * 2026-05-06 (audit §3.4 fix): snapshot iterator FØR vi går inn i payout-
   * loopen. Pre-fix muterte parallell `room:join`-handler `room.players` Map
   * via `assertWalletNotInRunningGame` mens denne iteratoren kjørte (1500-
   * spillere-skala + ~50 join/min ≈ 100% sannsynlighet daglig). Snapshot
   * eliminerer iterator-state-korrupsjon; defensiv `room.players.has(...)`-
   * sjekk inne i loop fanger spillere som ble evicted under iteration og
   * inkrementerer race-detector-metric.
   */
  private findG2Winners(room: RoomState, game: GameState): Array<{
    player: Player;
    ticketIndex: number;
    ticketId?: string;
  }> {
    const drawnSet = new Set(game.drawnNumbers);
    const winners: Array<{ player: Player; ticketIndex: number; ticketId?: string }> = [];

    // 2026-05-06 (audit §3.4): snapshot iterator FØR await-er. Kritisk for
    // 1500-spillere-skala der parallel room:join-handler kan slette
    // spillere fra room.players Map mid-iteration via
    // assertWalletNotInRunningGame.
    const playerSnapshot = [...room.players.values()];

    for (const player of playerSnapshot) {
      // Defense-in-depth: re-sjekk player er fortsatt i rommet. Hvis evicted
      // mellom snapshot og denne iterasjonen, skip + log race-event.
      if (!room.players.has(player.id)) {
        try {
          metrics.spill23RoomPlayersRaceDetected.inc({ slug: "rocket" });
        } catch {
          // metric-failure er aldri kritisk for game-flow
        }
        logger.warn(
          {
            event: "G2_ROOM_PLAYERS_RACE_DETECTED",
            roomCode: room.code,
            gameId: game.id,
            playerId: player.id,
            walletId: player.walletId,
          },
          "Player evicted between snapshot and findG2Winners iteration — skipping",
        );
        continue;
      }

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

  /**
   * BIN-615 / PR-C2: Apply single-prize cap, transfer from house → player,
   * update balances + compliance ledger + payout audit. Returns the actual
   * credited amount (may be less than requested if capped or budget-limited).
   *
   * Mirrors BingoEngine's existing LINE/BINGO payout accounting (lines 1081-1132)
   * but scoped to per-winner G2 jackpot shares.
   */
  private async payG2JackpotShare(args: {
    room: RoomState;
    game: GameState;
    player: Player;
    claim: ClaimRecord;
    requestedPayout: number;
    drawIndex: number;
    houseAccountId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
  }): Promise<number> {
    const { room, game, player, claim, requestedPayout, drawIndex, houseAccountId, gameType, channel } = args;
    const rtpBefore = roundCurrency(Math.max(0, game.remainingPayoutBudget));
    // 2026-05-06 (audit §9.1): bind prize-cap mot per-spill `PrizeGameType`
    // resolved fra `room.gameSlug`. Spill 2 (rocket) er hovedspill → MAIN_GAME;
    // pre-fix hardkodet "DATABINGO" som var regulatorisk inkonsistent med
    // ledger-events (PR #769) som allerede skrev MAIN_GAME for Spill 2/3.
    const capped = this.prizePolicy.applySinglePrizeCap({
      hallId: room.hallId,
      gameType: ledgerGameTypeForSlug(room.gameSlug),
      amount: requestedPayout,
    });
    const afterPoolCap = Math.min(capped.cappedAmount, game.remainingPrizePool);
    const payout = Math.max(0, Math.min(afterPoolCap, game.remainingPayoutBudget));
    if (payout <= 0) {
      claim.payoutWasCapped = requestedPayout > 0;
      claim.rtpCapped = afterPoolCap > 0 && game.remainingPayoutBudget <= 0;
      claim.rtpBudgetBefore = rtpBefore;
      claim.rtpBudgetAfter = rtpBefore;
      // Legacy behaviour: even a zero payout is logged via PayoutAuditTrail
      // so compliance can audit budget-exhaustion events.
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
      `G2 jackpot prize ${room.code}`,
      {
        idempotencyKey: IdempotencyKeys.game2Jackpot({
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
    logger.info({
      event: "G2_JACKPOT_PAYOUT",
      roomCode: room.code,
      gameId: game.id,
      playerId: player.id,
      claimId: claim.id,
      drawIndex,
      requested: requestedPayout,
      paid: payout,
      capped: payout < requestedPayout
    }, "Game 2 jackpot share paid");
    return payout;
  }

  /**
   * BIN-615 / PR-C2: Lucky-number bonus payout — paid on top of jackpot when
   * lastBall === player.luckyNumber. Legacy ref: game2.js:1628-1712.
   *
   * Budget is shared with the jackpot payout — we reuse the game's
   * remainingPayoutBudget so total credited cannot exceed maxPayoutBudget.
   */
  private async payG2LuckyBonus(args: {
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
    // 2026-05-06 (audit §9.1): se kommentar i `payG2JackpotShare` —
    // bind prize-cap mot per-spill resolver i stedet for hardkodet
    // "DATABINGO".
    const capped = this.prizePolicy.applySinglePrizeCap({
      hallId: room.hallId,
      gameType: ledgerGameTypeForSlug(room.gameSlug),
      amount: requestedPayout,
    });
    const afterPoolCap = Math.min(capped.cappedAmount, game.remainingPrizePool);
    const payout = Math.max(0, Math.min(afterPoolCap, game.remainingPayoutBudget));
    if (payout <= 0) return 0;
    // PR-W3 wallet-split: payout er gevinst → krediter winnings-siden.
    const transfer = await this.walletAdapter.transfer(
      houseAccountId,
      player.walletId,
      payout,
      `G2 lucky bonus ${room.code}`,
      {
        idempotencyKey: IdempotencyKeys.game2Lucky({
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
    claim.bonusTriggered = true;
    claim.bonusAmount = payout;
    claim.payoutTransactionIds = [...(claim.payoutTransactionIds ?? []), transfer.fromTx.id, transfer.toTx.id];
    logger.info({
      event: "G2_LUCKY_BONUS_PAYOUT",
      roomCode: room.code,
      gameId: game.id,
      playerId: player.id,
      claimId: claim.id,
      requested: requestedPayout,
      paid: payout
    }, "Game 2 lucky-number bonus paid");
    return payout;
  }

  /**
   * BIN-615 / PR-C2: guard predicate — true when the current round is a G2
   * auto-claim round. Used by onDrawCompleted to short-circuit for non-G2 rooms.
   *
   * Criteria:
   *   - variantConfig.patternEvalMode === "auto-claim-on-draw"
   *   - jackpotNumberTable defined (distinguishes G2 from future G3 auto-claim)
   *
   * G3 in PR-C3 will add its own guard (pattern-driven) and avoid G2 path.
   */
  private isGame2Round(variantConfig: GameVariantConfig | undefined): boolean {
    if (!variantConfig) return false;
    if (variantConfig.patternEvalMode !== "auto-claim-on-draw") return false;
    if (!variantConfig.jackpotNumberTable) return false;
    return true;
  }
}

function countTickets(game: GameState): number {
  let total = 0;
  for (const tickets of game.tickets.values()) total += tickets.length;
  return total;
}

/**
 * 2026-05-04 (Tobias bug-fix): auto-mark celler som matcher `lastBall` på
 * alle aktive tickets i rommet. Idempotent — Set.add() er en no-op hvis
 * tallet allerede er markert.
 *
 * Brukt av Game2Engine + Game3Engine for å holde `game.marks` synkronisert
 * med `game.drawnNumbers` selv om auto-claim-pathen ikke konsulterer
 * marks. Krever at hver player.tickets[i] korresponderer 1:1 med
 * player.marks[i] (engine-invariant siden BIN-244).
 *
 * Eksportert som intern util fordi Game3Engine.onDrawCompleted gjenbruker
 * eksakt samme logikk; å duplikere ville være regresjons-risiko.
 */
export function autoMarkPlayerCells(game: GameState, lastBall: number): void {
  for (const [playerId, ticketArray] of game.tickets) {
    const marksByTicket = game.marks.get(playerId);
    if (!marksByTicket) continue;
    for (let i = 0; i < ticketArray.length; i += 1) {
      const ticket = ticketArray[i];
      if (!ticket) continue;
      const tMarks = marksByTicket[i];
      if (!tMarks) continue;
      if (ticketContainsNumber(ticket, lastBall)) {
        tMarks.add(lastBall);
      }
    }
  }
}
