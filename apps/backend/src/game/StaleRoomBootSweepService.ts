/**
 * Boot-sweep for "RUNNING-but-exhausted" Spill 2/3-rom (Tobias 2026-05-03 —
 * pilot-emergency-fix).
 *
 * Bakgrunn (fra direktivet):
 *   "det skjer fortsatt ingenting … ingen nedtelling, ingen bonger vises når
 *    de kjøpes og står bare trekk 21/21"
 *
 *   ROCKET-rommet kan persistere `status=RUNNING + drawnNumbers.length=21
 *   + endedReason=null` i Postgres-checkpoint hvis prosessen krasjet/ble
 *   restartet ETTER siste draw men FØR engine rakk å mutere status til
 *   ENDED og fyre `onGameEnded`. Render-restart loader stale-state, og
 *   PerpetualRoundService kan ikke schedulere ny runde fordi `onGameEnded`
 *   aldri har blitt fyrt for forrige runde.
 *
 *   PR #876 (game-end-fixen) krever en ny draw-event for å trigge end-pathen
 *   — men ballbagen er allerede tom, så ingen nye draws kommer.
 *
 * Tilnærming:
 *   1. Ved boot, ETTER alle recovery-passene (BIN-170/BIN-245 +
 *      `sweepStaleNonCanonicalRooms`), enumererer vi rom via
 *      `engine.listRoomSummaries()` og filtrerer på Spill 2/3-slug.
 *   2. For hvert rom henter vi fullt snapshot via `engine.getRoomSnapshot`
 *      og sjekker tre kriterier:
 *        - `currentGame.status === "RUNNING"`
 *        - `drawnNumbers.length >= maxBallsForSlug(slug)` (21 for Spill 2,
 *          75 for Spill 3)
 *        - `currentGame.endedReason === null/undefined` (ikke allerede endet)
 *   3. Ved match: kall `engine.forceEndStaleRound(roomCode, "BOOT_SWEEP_STALE_ROUND")`
 *      som mutere state, fyrer `bingoAdapter.onGameEnded`, og dermed
 *      trigger `PerpetualRoundService.handleGameEnded` for å spawne ny runde.
 *
 * Ikke-mål:
 *   - Vi rør IKKE Spill 1 (`bingo`) — Spill 1 har egen scheduled-engine-flyt
 *     med eksplisitt master-start/end-koreografi.
 *   - Vi rør IKKE SpinnGo (`spillorama`) — player-startet, ingen perpetual-loop.
 *   - Vi rør IKKE rom hvor `endedReason` allerede er satt — disse er gyldig
 *     ferdig-endete runder som perpetual-restarten enten har behandlet eller
 *     vil behandle ved neste game-end-trigger.
 *   - Vi rør IKKE rom med `<maxBalls` trekk — disse er pågående legitime runder.
 *
 * Trygghetsregler:
 *   - Fail-soft per rom: en feil i forceEndStaleRound for ett rom stopper
 *     ikke sweepen for andre rom. Boot fortsetter selv om alle forsøkene
 *     feiler — dette er en best-effort recovery-mekanisme.
 *   - Idempotent: andre + senere kjøringer finner ingenting å gjøre fordi
 *     `endedReason` er satt etter første pass.
 *   - Ingen wallet/compliance/ledger-mutasjon her — engine.forceEndStaleRound
 *     gjør samme `finishPlaySessionsForGame + writeGameEndCheckpoint` som
 *     den naturlige end-pathen.
 */

import { GAME2_SLUGS, GAME2_MAX_BALLS } from "./Game2AutoDrawTickService.js";
import { GAME3_SLUGS, GAME3_MAX_BALLS } from "./Game3AutoDrawTickService.js";

/**
 * Returnerer maks-antall baller for en gitt Spill 2/3-slug, eller `null`
 * hvis slugen ikke er en perpetual-spill-slug.
 *
 * Eksportert for testing — sweepen bruker den internt for filtrering.
 */
export function maxBallsForSlug(slug: string | undefined): number | null {
  if (!slug) return null;
  const normalized = slug.toLowerCase().trim();
  if (GAME2_SLUGS.has(normalized)) return GAME2_MAX_BALLS;
  if (GAME3_SLUGS.has(normalized)) return GAME3_MAX_BALLS;
  return null;
}

/**
 * Ende-grunn som settes på `game.endedReason` ved boot-sweep. Holdt som
 * eksportert konstant så observability-pipelines (logger, audit) kan
 * filtrere på akkurat denne strengen for å skille mellom naturlige
 * round-ender (G2_WINNER, G3_FULL_HOUSE, MAX_DRAWS_REACHED, DRAW_BAG_EMPTY)
 * og recovery-fyrte ender.
 *
 * Merk: PerpetualRoundService.NATURAL_END_REASONS inkluderer IKKE denne
 * strengen, men sweepen er fortsatt designet for å trigge perpetual-restart.
 * Det er en bevisst kompromis: vi vil at restart-en skal skje (rommet er
 * "stuck" og spillere venter), men reasonen sier eksplisitt at runden ble
 * tvungen-endet av sweepen, ikke en naturlig round-end. PerpetualRoundService
 * filtrerer på `endedReason`, så vi må enten utvide NATURAL_END_REASONS,
 * eller bruke en av de eksisterende reasonene. Vi velger sistnevnte path
 * via `effectiveEndedReasonForPerpetual` slik at perpetual-restart trigger
 * uten å forurense begrepet "naturlig" ende.
 */
export const STALE_ROUND_END_REASON = "BOOT_SWEEP_STALE_ROUND";

/**
 * Engine-overflate som tjenesten trenger. Holdt minimal for testbarhet.
 */
export interface StaleRoomBootSweepEngine {
  listRoomSummaries(): Array<{
    code: string;
    gameSlug?: string;
    gameStatus: string;
  }>;
  getRoomSnapshot(roomCode: string): {
    code: string;
    gameSlug?: string;
    currentGame?: {
      status: string;
      drawnNumbers: number[];
      endedReason?: string;
    };
  };
  forceEndStaleRound(roomCode: string, endedReason: string): Promise<boolean>;
}

/**
 * Logger-overflate. Vi bruker `info` for normale `[boot-sweep] ended stale
 * room ROCKET (drawn=21/21)`-meldinger, `warn` for skip-cases hvor noe
 * uventet skjedde, og `error` for forceEndStaleRound-feil.
 */
export interface StaleRoomBootSweepLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface StaleRoomBootSweepResult {
  /** Antall Spill 2/3-rom undersøkt totalt. */
  inspected: number;
  /** Rom-koder som matchet stale-kriterier og ble tvungen-endet. */
  ended: string[];
  /** Rom-koder som matchet, men forceEndStaleRound returnerte false (no-op). */
  noop: string[];
  /** Rom-koder + feil for forceEndStaleRound-feil. */
  failures: Array<{ roomCode: string; error: string }>;
}

export interface StaleRoomBootSweepServiceOptions {
  engine: StaleRoomBootSweepEngine;
  logger: StaleRoomBootSweepLogger;
}

/**
 * Tjeneste som scanner alle Spill 2/3-rom og forcefully ender de som er
 * stuck i RUNNING-but-exhausted-state.
 *
 * Bruks-mønster (i index.ts boot-sequence):
 *
 *   const sweepService = new StaleRoomBootSweepService({ engine, logger });
 *   try {
 *     const result = await sweepService.sweep();
 *     // Logger interne meldinger; result kan brukes til boot-summary-log.
 *   } catch (err) {
 *     // Skal aldri skje — sweep() er fail-soft per rom og kaster aldri.
 *     console.error("[boot-sweep] stale-Spill-2-3 sweep failed", err);
 *   }
 *
 * Tjenesten er stateless mellom kjøringer — ingen pending-state, ingen
 * intern teller. Trygt å instansiere én gang og kalle `sweep()` flere
 * ganger (men i praksis kalles den kun ved boot).
 */
export class StaleRoomBootSweepService {
  private readonly engine: StaleRoomBootSweepEngine;
  private readonly logger: StaleRoomBootSweepLogger;

  constructor(options: StaleRoomBootSweepServiceOptions) {
    this.engine = options.engine;
    this.logger = options.logger;
  }

  /**
   * Kjør én sweep-pass. Itererer alle rom, filtrerer på Spill 2/3, og
   * ender de stale.
   *
   * Aldri kaster — alle feil isoleres per rom og logges/returneres i
   * `failures`. Boot-sequence skal IKKE feile pga sweepen.
   */
  async sweep(): Promise<StaleRoomBootSweepResult> {
    const result: StaleRoomBootSweepResult = {
      inspected: 0,
      ended: [],
      noop: [],
      failures: [],
    };

    let summaries: ReturnType<StaleRoomBootSweepEngine["listRoomSummaries"]>;
    try {
      summaries = this.engine.listRoomSummaries();
    } catch (err) {
      this.logger.error("[boot-sweep] listRoomSummaries failed — aborting sweep", {
        err: err instanceof Error ? err.message : String(err),
      });
      return result;
    }

    for (const summary of summaries) {
      const slug = (summary.gameSlug ?? "").toLowerCase().trim();
      const maxBalls = maxBallsForSlug(slug);
      if (maxBalls === null) {
        // Ikke et Spill 2/3-rom — skip uten counter-bump (vi bryr oss
        // kun om perpetual-spill-rom i denne sweepen).
        continue;
      }

      // Hurtig-skip på listRoomSummaries-status: kun RUNNING kan være stale.
      if (summary.gameStatus !== "RUNNING") continue;

      result.inspected += 1;

      let snapshot: ReturnType<StaleRoomBootSweepEngine["getRoomSnapshot"]>;
      try {
        snapshot = this.engine.getRoomSnapshot(summary.code);
      } catch (err) {
        // Rommet kan være destroyed mellom listRoomSummaries og getRoomSnapshot
        // (race med annet boot-pass). Logg som warn og fortsett.
        this.logger.warn(
          `[boot-sweep] getRoomSnapshot failed for ${summary.code}`,
          { err: err instanceof Error ? err.message : String(err) },
        );
        result.failures.push({
          roomCode: summary.code,
          error: `getRoomSnapshot failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      const game = snapshot.currentGame;
      if (!game) continue; // race med destroy/archive
      if (game.status !== "RUNNING") continue; // status endret seg mellom snapshot og sjekk

      const drawnCount = game.drawnNumbers.length;
      if (drawnCount < maxBalls) {
        // Pågående legitim runde — ikke stuck.
        continue;
      }

      if (game.endedReason) {
        // Allerede merket som endet — perpetual-restart har enten kjørt
        // eller vil kjøre via vanlig flyt. Ikke vår jobb å rydde.
        continue;
      }

      // Match. Force-end runden.
      try {
        const ended = await this.engine.forceEndStaleRound(
          summary.code,
          STALE_ROUND_END_REASON,
        );
        if (ended) {
          result.ended.push(summary.code);
          this.logger.info(
            `[boot-sweep] ended stale room ${summary.code} (drawn=${drawnCount}/${maxBalls})`,
            {
              roomCode: summary.code,
              slug,
              drawnCount,
              maxBalls,
              endedReason: STALE_ROUND_END_REASON,
            },
          );
        } else {
          // forceEndStaleRound returnerer false hvis room er gone, status
          // endret seg, eller endedReason allerede er satt — alt sammen
          // race med annen handler. Logg på info, ikke warn.
          result.noop.push(summary.code);
          this.logger.info(
            `[boot-sweep] forceEndStaleRound was no-op for ${summary.code} (race with concurrent handler)`,
            { roomCode: summary.code, slug, drawnCount, maxBalls },
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[boot-sweep] forceEndStaleRound failed for ${summary.code}`,
          { roomCode: summary.code, slug, drawnCount, maxBalls, err: msg },
        );
        result.failures.push({
          roomCode: summary.code,
          error: `forceEndStaleRound failed: ${msg}`,
        });
      }
    }

    if (result.ended.length > 0) {
      this.logger.info(
        `[boot-sweep] Spill 2/3 stale-room sweep complete: ended=${result.ended.length}, noop=${result.noop.length}, failures=${result.failures.length}`,
        {
          inspected: result.inspected,
          ended: result.ended,
          noop: result.noop,
          failureCount: result.failures.length,
        },
      );
    } else if (result.inspected > 0) {
      // Vi inspiserte rom, men ingen var stale — typisk happy-path etter
      // første sweep eller etter at perpetual-restart har ryddet.
      this.logger.info(
        `[boot-sweep] Spill 2/3 stale-room sweep complete: no stale rooms found (inspected=${result.inspected})`,
        { inspected: result.inspected },
      );
    }
    // Hvis inspected=0 er det ingen Spill 2/3-rom i engine — typisk
    // fresh boot uten persisterte ROCKET/MONSTERBINGO. Ingen log.

    return result;
  }
}
