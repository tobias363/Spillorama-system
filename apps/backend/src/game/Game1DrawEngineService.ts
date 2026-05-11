/**
 * GAME1_SCHEDULE PR 4b: Draw-engine core for Game 1 scheduled-games.
 *
 * Spec: GAME1_SCHEDULE PR 4b (Alt 3 — parallell draw-strøm basert på
 * DrawBagStrategy, IKKE BingoEngine). BingoEngine er host-player-room-scoped
 * og inkompatibel med master-as-admin + multi-hall-scheduled-games. Legacy
 * BingoEngine lever videre for andre spill.
 *
 * Ansvar:
 *   1) startGame(scheduledGameId, actorUserId): initialiser spill-tilstand
 *      - Validerer pre-cond (scheduled_game.status).
 *      - Resolver draw-bag via DrawBagStrategy (maxBallValue fra ticket_config
 *        eller 60 default).
 *      - INSERT app_game1_game_state med shuffled bag.
 *      - Genererer ticket-assignments for alle ikke-refunderte purchases.
 *      - UPDATE app_game1_scheduled_games.status='running',
 *        actual_start_time=NOW().
 *      - Idempotent: to kall → samme state, ingen duplicate assignments.
 *
 *   2) drawNext(scheduledGameId): trekk neste kule
 *      - Reject hvis paused eller finished.
 *      - ball = draw_bag[draws_completed].
 *      - INSERT app_game1_draws.
 *      - Oppdater markings_json per assignment (i samme transaksjon).
 *      - UPDATE game_state.draws_completed++, last_drawn_*.
 *      - Sjekk om maxDraws nådd → UPDATE scheduled_game.status='completed'.
 *
 *   3) pauseGame / resumeGame: toggle paused-flag (auto-timer i PR 4c).
 *
 *   4) stopGame(reason, actor): manuelt stopp
 *      - UPDATE scheduled_game.status='cancelled'.
 *      - UPDATE game_state.engine_ended_at=NOW().
 *      - Refund-flyt IKKE i PR 4b — kommer i PR 4d.
 *
 *   5) getState / listDraws: read-helpers for admin-konsoll + resume.
 *
 * Utenfor scope (kommer senere):
 *   - PR 4c: Pattern-matching (1-4 rader + full hus), phase-progression,
 *     payout, split-rounding, loyalty-hook, auto-draw timer, jackpot.
 *   - PR 4d: Socket player-join + master-konsoll real-time draw-visning +
 *     stop-refund-pipeline.
 *
 * Design:
 *   - Alle skriv-ops kjører i transaksjon.
 *   - AuditLog skrives fire-and-forget (category prefiks: 'game1_engine').
 *   - Norsk i DomainError-meldinger mot bruker.
 *   - DomainError fra ./BingoEngine.js.
 */

import { randomUUID } from "node:crypto";
import { randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors/DomainError.js";
import type { BingoEngine } from "./BingoEngine.js";
import {
  resolveDrawBagConfig,
  buildDrawBag,
  DRAW_BAG_DEFAULT_STANDARD,
} from "./DrawBagStrategy.js";
import type { Game1TicketPurchaseService, Game1TicketPurchaseRow } from "./Game1TicketPurchaseService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { Game1PayoutService, Game1WinningAssignment } from "./Game1PayoutService.js";
import type { Game1JackpotService, Game1JackpotConfig } from "./Game1JackpotService.js";
import type { Game1JackpotStateService } from "./Game1JackpotStateService.js";
import { runDailyJackpotEvaluation } from "./Game1DrawEngineDailyJackpot.js";
import {
  Game1LuckyBonusService,
  resolveLuckyBonusConfig,
  type Game1LuckyBonusConfig,
} from "./Game1LuckyBonusService.js";
import type { Game1PotService } from "./pot/Game1PotService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import { IdempotencyKeys } from "./idempotency.js";
import {
  runAccumulatingPotEvaluation,
  computeOrdinaryWinCentsByHallPerColor,
  computeOrdinaryWinCentsByHallFlat,
} from "./Game1DrawEnginePotEvaluator.js";
import type { AdminGame1Broadcaster } from "./AdminGame1Broadcaster.js";
import type { Game1PlayerBroadcaster } from "./Game1PlayerBroadcaster.js";
import type { Game1MiniGameOrchestrator } from "./minigames/Game1MiniGameOrchestrator.js";
import {
  parseOddsenConfig,
  type MiniGameOddsenEngine,
  type OddsenConfig,
  type OddsenResolveResult,
} from "./minigames/MiniGameOddsenEngine.js";
import type { PhysicalTicketPayoutService } from "../compliance/PhysicalTicketPayoutService.js";
import type { PotDailyAccumulationTickService } from "./pot/PotDailyAccumulationTickService.js";
import { evaluatePhase, TOTAL_PHASES } from "./Game1PatternEvaluator.js";
import type { ClaimType } from "./types.js";
import {
  evaluatePhysicalTicketsForPhase,
  loadDrawnBallsSet as loadDrawnBallsSetHelper,
  type PhysicalTicketWinInfo,
} from "./Game1DrawEnginePhysicalTickets.js";
export type { PhysicalTicketWinInfo } from "./Game1DrawEnginePhysicalTickets.js";
import {
  destroyBingoEngineRoomIfPresent,
  destroyRoomForScheduledGameFromDb,
} from "./Game1DrawEngineCleanup.js";
import {
  emitPlayerDrawNew,
  emitPlayerPatternWon,
  emitPlayerRoomUpdate,
  emitAdminDrawProgressed,
  emitAdminPhaseWon,
  emitAdminPhysicalTicketWon,
  emitAdminAutoPaused,
} from "./Game1DrawEngineBroadcast.js";
import { resolvePatternsForColor } from "./spill1VariantMapper.js";
import {
  NoopComplianceLedgerPort,
  type ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";
import {
  NoopPrizePolicyPort,
  type PrizePolicyPort,
} from "../adapters/PrizePolicyPort.js";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
import type { GameVariantConfig } from "./variantConfig.js";
import {
  parseDrawBag,
  parseGridArray,
  phaseToConfigKey,
  phaseDisplayName,
  resolvePhaseConfig,
  resolveJackpotConfig,
  buildVariantConfigFromGameConfigJson,
  resolveJackpotConfigFromGameConfig,
  resolveEngineColorName,
  patternPrizeToCents,
  parseMarkings,
  // Pot-per-bongstørrelse-fix (2026-05-08, §9 i SPILL_REGLER_OG_PAYOUT.md):
  // resolveOddsenVariantConfig leser top-level Fullt Hus HIGH/LOW-config
  // for Oddsen-katalog-rader; bongMultiplierForColorSlug mapper slug-form
  // (small_yellow / large_purple / ...) til vekt for pot-skalering.
  resolveOddsenVariantConfig,
  bongMultiplierForColorSlug,
  // Trafikklys runtime (2026-05-08, §5 i SPILL_REGLER_OG_PAYOUT.md):
  // resolveTrafikklysVariantConfig leser top-level Trafikklys-config (rad-
  // farge-styrt pot for Rad 1-4 + Fullt Hus). isTrafikklysRowColor brukes
  // til å validere DB-kolonne-verdier ved load. pickTrafikklysRowColor
  // wrapper crypto.randomInt for server-autoritativ trekking.
  resolveTrafikklysVariantConfig,
  isTrafikklysRowColor,
  pickTrafikklysRowColor,
  type TrafikklysRowColor,
  type TrafikklysVariantConfig,
} from "./Game1DrawEngineHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-draw-engine-service" });

/**
 * Debug-logging-toggle (2026-05-11, Tobias-direktiv): når
 * `DEBUG_SPILL1_DRAWS=true` skriver vi strukturerte
 * `[scheduled.assign-roomcode]`- og `[draw] committed`-logger som dekker
 * draw-commit-flyten ende-til-ende. Grep "[draw]" for hver vellykket
 * commit, "[scheduled.assign-roomcode]" for når roomCode pinnes til
 * scheduled_game-raden.
 */
const DEBUG_SPILL1_DRAWS =
  process.env.DEBUG_SPILL1_DRAWS?.trim().toLowerCase() === "true";

// ── Public types ─────────────────────────────────────────────────────────────

export interface Game1DrawEngineConfig {
  /**
   * Maks antall kuler trukket før game ender automatisk. Spill 1 scheduled
   * 75-ball skal som default kunne trekke hele bagen. Overridable per
   * scheduled_game via ticket_config_json.maxDraws.
   */
  defaultMaxDraws: number;
}

export const DEFAULT_GAME1_MAX_DRAWS = 75;

export interface Game1GameStateView {
  scheduledGameId: string;
  currentPhase: number; // 1..5 (1 i PR 4b — utsatt til PR 4c)
  drawsCompleted: number;
  lastDrawnBall: number | null;
  lastDrawnAt: Date | null;
  isFinished: boolean; // scheduled_game.status='completed'
  isPaused: boolean;
  /**
   * Task 1.1: auto-pause ved phase-won. Gap #1 i MASTER_HALL_DASHBOARD_GAP_2026-04-24.md.
   *
   * Sidecar til `isPaused`. Når engine auto-pauser seg etter phase-won
   * settes `pausedAtPhase` = fasen som akkurat ble vunnet; ved Resume
   * nullstilles feltet. `null` betyr "ikke auto-paused" (kan fortsatt
   * være manuelt-paused via master-pause, da er `isPaused=true` men
   * `pausedAtPhase=null`).
   */
  pausedAtPhase: number | null;
  /**
   * Task 1.1: true hvis siste `drawNext()`-kall var et no-op fordi
   * engine er auto-paused. Brukes av route-laget til å returnere
   * `{ pausedAutomatically: true }` i drawNext-responsen uten å
   * endre den persisterte state-viewet. Default false.
   */
  pausedAutomatically?: boolean;
  drawnBalls: number[]; // I trekk-rekkefølge (tom hvis ingen draws ennå)
  /**
   * Trafikklys runtime (2026-05-08, §5 i SPILL_REGLER_OG_PAYOUT.md):
   * server-trukket rad-farge for Trafikklys-spill. Klient/TV-skjerm bruker
   * denne til å vise banner ("Denne runden er GRØNN"). NULL for ikke-
   * Trafikklys-spill (standard hovedspill, Oddsen) og legacy-rader.
   *
   * Verdier: "rød" / "grønn" / "gul" — eller null.
   */
  trafikklysRowColor: TrafikklysRowColor | null;
}

export interface Game1DrawRecord {
  sequence: number;
  ball: number;
  drawnAt: Date;
}

export interface Game1DrawEngineServiceOptions {
  pool: Pool;
  schema?: string;
  ticketPurchaseService: Game1TicketPurchaseService;
  auditLogService: AuditLogService;
  config?: Partial<Game1DrawEngineConfig>;
  /**
   * GAME1_SCHEDULE PR 4c: pattern-evaluering + payout. Hvis ikke satt,
   * kjører drawNext() i PR 4b-modus (kun draws + markings, ingen payout).
   */
  payoutService?: Game1PayoutService;
  /**
   * GAME1_SCHEDULE PR 4c Bolk 3: Jackpot-evaluering for Fullt Hus.
   * Hvis ikke satt eller ticket_config ikke har jackpot-config → 0 jackpot.
   */
  jackpotService?: Game1JackpotService;
  /**
   * @deprecated ADR-0017 (2026-05-10): jackpot-state-service brukes ikke
   * lenger av engine. Daglig akkumulering er fjernet; per-spill jackpot-
   * setup leses fra `app_game_plan_run.jackpot_overrides_json` direkte i
   * `runDailyJackpotEvaluation`.
   *
   * Felt beholdt midlertidig for backward-compat med eksisterende
   * konstruksjons-call-sites; selve verdien er ubrukt i engine-logikk.
   */
  jackpotStateService?: Game1JackpotStateService;
  /**
   * GAME1_SCHEDULE PR 4d.3: valgfri broadcaster for admin-namespace.
   * Fire-and-forget — engine kaller `onDrawProgressed` etter persistert
   * draw slik at admin-UI får sanntids-oppdatering uten REST-polling.
   * Feil i broadcaster loggres men påvirker ikke draw-flyten.
   */
  adminBroadcaster?: AdminGame1Broadcaster;
  /**
   * PR-C4: valgfri broadcaster for default-namespace (spiller-klient).
   * Fire-and-forget — engine kaller `onDrawNew` / `onPatternWon` /
   * `onRoomUpdate` POST-commit slik at spiller-UI oppdateres samtidig
   * med admin-UI. Scheduled Spill 1 brukte før kun admin-broadcaster;
   * uten denne porten fryste spiller-brett til neste reconnect.
   */
  playerBroadcaster?: Game1PlayerBroadcaster;
  /**
   * BIN-690 M1: valgfri orchestrator for mini-games etter Fullt Hus.
   * Fire-and-forget — engine kaller `maybeTriggerFor` POST-commit slik
   * at mini-game-feil IKKE ruller tilbake bingo-payout. Default unset
   * = ingen mini-game-trigger (M1-framework kan wires opp senere eller
   * deaktiveres helt per miljø).
   */
  miniGameOrchestrator?: Game1MiniGameOrchestrator;
  /**
   * BIN-690 M5: valgfri Oddsen-engine for cross-round resolve. Når satt vil
   * `drawNext()` ved terskel-draw (default #57) slå opp aktiv
   * `app_game1_oddsen_state` for spillet og utbetale pot ved hit. Default
   * unset = ingen Oddsen-resolve (M2/M3/M4 virker uendret, Oddsen-state
   * forblir unresolved men uten regulatorisk risiko).
   */
  oddsenEngine?: MiniGameOddsenEngine;
  /**
   * PT4: valgfri tjeneste for fysisk-bong vinn-flyt. Når satt vil engine
   * også evaluere `app_static_tickets` mot aktiv fase og opprette
   * pending-payout-rader (uten auto-payout — krever manuell verifisering
   * og utbetaling via `PhysicalTicketPayoutService`). Hvis ikke satt:
   * kun digitale assignments evalueres (bakoverkompat for test + miljøer
   * uten papirbong-pilot).
   */
  physicalTicketPayoutService?: PhysicalTicketPayoutService;
  /**
   * PR-T2/T3 + PR-C2 Spor 4: valgfri akkumulerende pot-service (Jackpott +
   * Innsatsen). Når wired opp vil engine etter Fullt Hus (phase 5) vunnet
   * kalle den konsoliderte `evaluateAccumulatingPots`-helper én gang per
   * unik hall blant vinnere. Helper-en switcher på `config.potType` og
   * delegerer til Game1PotService.tryWin med riktig per-potType oppførsel
   * (fail-policy, idempotency-key, audit-action). Hvis ikke satt → ingen
   * pot-evaluering (T1/T2-pot-er står urørt, akkumulerer fortsatt via
   * PotSalesHookPort).
   */
  potService?: Game1PotService;
  /**
   * PR-T2 Spor 4: valgfri tick-service for daglig pot-boost. Sendes videre
   * til `evaluateAccumulatingPots` som bruker den på jackpott-pot-er FØR
   * tryWin slik at dagens boost er applisert. Fail-closed (per-pot-feil
   * svelges).
   */
  potDailyTickService?: PotDailyAccumulationTickService;
  /**
   * PR-T2/T3 + PR-C2 Spor 4: WalletAdapter for pot-credit. Påkrevd når
   * potService er satt. Pot-utbetaling er alltid `to: "winnings"` (pot-
   * vinn er gevinst fra spill, ikke refund). Brukes av den konsoliderte
   * `evaluateAccumulatingPots`-helper for alle pot-typer.
   */
  walletAdapter?: WalletAdapter;
  /**
   * PR-C1b: valgfri BingoEngine-referanse for å rydde in-memory rom ved
   * completion/cancellation av et schedulert Spill 1. BingoEngine-rommet
   * opprettes lazy av første spiller som joiner (`game1:join-scheduled`,
   * se PR 4d.2) og ligger i `InMemoryRoomStateStore` inntil naturlig
   * eviction. Uten denne referansen vil `drawNext()` + `stopGame()` IKKE
   * rydde rom (memory leak).
   *
   * Fail-closed: kall til `destroyRoom` er try/catch-beskyttet. Room-
   * cleanup er ikke regulatorisk-kritisk — en feilet destroyRoom logges
   * som warning og kan ikke ruke draw-persistens eller
   * master-stop-responsen.
   */
  bingoEngine?: BingoEngine;
  /**
   * K1-C: Lucky Number Bonus-service. Evaluerer om en Fullt Hus-vinners
   * valgte lykketall matcher ballen som utløste winnet (legacy
   * GameProcess.js:420-429). Pure service — DI så engine-testen kan stubbe.
   *
   * Valgfri: hvis null og sub-game ikke har `luckyBonus`-config → ingen
   * bonus beregnes eller utbetales (bakoverkompat for test + miljøer uten
   * bonus-pilot). Wallet-credit skjer via samme `WalletAdapter` som pot-
   * evaluator.
   */
  luckyBonusService?: Game1LuckyBonusService;
  /**
   * K1-C: lookup-port som gir tilbake spillerens valgte lykketall for en
   * (roomCode, userId). Lucky-numbers lagres i `RoomStateManager`-memory
   * (se apps/backend/src/util/roomState.ts), så engine trenger en port for
   * å nå frem uten sirkulær import.
   *
   * Returner `null` eller `undefined` hvis spilleren ikke har valgt lucky.
   * Kalles synkront i payout-flyt — skal være O(1) lookup.
   */
  luckyNumberLookup?: (args: {
    roomCode: string;
    userId: string;
  }) => number | null | undefined;
  /**
   * K2-A CRIT-2: ComplianceLedger-port for å skrive EXTRA_PRIZE-entries
   * for pot- og lucky-bonus-payouts. Default no-op (bakoverkompat for
   * tester) — produksjon skal alltid wire `engine.getComplianceLedgerPort()`.
   * Soft-fail: ledger-skrivefeil ruller IKKE tilbake wallet-credit (matcher
   * Game1PayoutService.payoutPhase-mønsteret).
   */
  complianceLedgerPort?: import("../adapters/ComplianceLedgerPort.js").ComplianceLedgerPort;
  /**
   * K2-A CRIT-3: PrizePolicy-port for single-prize-cap (2500 kr per
   * pengespillforskriften §11). Brukt i pot-evaluator + lucky-bonus-payout
   * for å håndheve maks-premie. Default no-op (bakoverkompat) — produksjon
   * skal alltid wire `engine.getPrizePolicyPort()`.
   */
  prizePolicyPort?: import("../adapters/PrizePolicyPort.js").PrizePolicyPort;
}

// ── Internal row shapes ─────────────────────────────────────────────────────

interface ScheduledGameRow {
  id: string;
  status: string;
  ticket_config_json: unknown;
  /**
   * PR 4d.1: BingoEngine room_code for denne schedulerte økten.
   * NULL frem til første spiller joiner (handler i PR 4d.2). Lesing er
   * tilgjengelig her så crash recovery + PR 4d.2-join-handler har én
   * kilde til sannhet.
   */
  room_code: string | null;
  /**
   * Scheduler-config-kobling: snapshot av `GameManagement.config_json`
   * (typisk `{spill1: {...}}`) kopiert inn ved spawn av scheduler. NULL
   * på historiske rader → fall tilbake til default-patterns (bakoverkompat).
   */
  game_config_json: unknown;
  /**
   * Demo Hall bypass (Tobias 2026-04-27): hentes via JOIN mot
   * `app_halls.is_test_hall` på master-hall-IDen. NULL hvis JOIN ikke
   * matcher (orphaned scheduled_game) — tolkes som FALSE.
   *
   * Når TRUE skal `drawNext` IKKE auto-pause på phase-won, slik at
   * runden går helt gjennom alle 5 faser + MAX_DRAWS uten manuell
   * Resume-trykk. Brukes kun i lokal/test-flyt.
   */
  master_is_test_hall?: boolean | null;
  /**
   * Trafikklys runtime (2026-05-08, §5 i SPILL_REGLER_OG_PAYOUT.md):
   * server-trukket rad-farge for Trafikklys-spill (rules.gameVariant=
   * 'trafikklys'). Bestemmer hvilken pot som brukes for Rad 1-4 og Fullt
   * Hus (uavhengig av bongfarge). NULL for ikke-Trafikklys-spill og legacy-
   * rader. Trekkes ÉN gang ved `startGame` og bevares gjennom hele runden.
   *
   * Whitelist håndheves av DB CHECK-constraint: 'rød'/'grønn'/'gul'.
   */
  trafikklys_row_color?: string | null;
}

interface GameStateRow {
  scheduled_game_id: string;
  draw_bag_json: unknown;
  draws_completed: number;
  current_phase: number;
  last_drawn_ball: number | null;
  last_drawn_at: Date | string | null;
  next_auto_draw_at: Date | string | null;
  paused: boolean;
  /**
   * Task 1.1: fasen som akkurat ble vunnet når engine auto-pauset seg.
   * NULL i hvilende tilstand og etter Resume. Se migration
   * `20260502000000_game1_auto_pause_on_phase.sql`.
   */
  paused_at_phase: number | null;
  engine_started_at: Date | string;
  engine_ended_at: Date | string | null;
}

// ── Grid generators (Game 1 scheduled-game format) ──────────────────────────

/**
 * Generate grid-tall for en ticket i Spill 1 (5x5 bingo).
 *
 * Tobias' spec (PM-avklaring 2026-04-21): Spill 1 bruker kun 5x5-grid.
 * `size` ('small'/'large') er en LEGACY PRISKATEGORI (påvirker farge-pris og
 * UI-rendering) — IKKE grid-format. Alle Spill 1-bretter har 25 celler.
 *
 * Format:
 *   - 25 celler, flat row-major (idx = row*5 + col).
 *   - Index 12 (row 2, col 2) = 0 — free centre (alltid "markert").
 *   - Kolonne-ranges proporsjonalt til maxBallValue:
 *       col c = [c*step+1 .. (c+1)*step] der step=floor(maxBallValue/5),
 *       siste kolonne inkluderer rest-en opp til maxBallValue.
 *     Eksempler:
 *       maxBallValue=75 → col 0=1..15, col 1=16..30, col 2=31..45,
 *         col 3=46..60, col 4=61..75 (amerikansk 75-ball).
 *       maxBallValue=90 → col 0=1..18, col 1=19..36, col 2=37..54,
 *         col 3=55..72, col 4=73..90 (legacy Helper/bingo.js:970-994).
 *   - Per kolonne plukker vi 5 unike tall (eller færre hvis range < 5),
 *     null for padding. NB: col 2 inkluderer kun 4 plukk (row 2 = free centre).
 *
 * Referanse: `.claude/legacy-ref/bingo.js:970-994` (Game 1 ticket-gen) +
 * `.claude/legacy-ref/Game1/Controllers/GameProcess.js:5519-5597` (Row1-5
 * pattern-matching antar 5x5) + `PatternMasks.ts` (klient-mirror).
 *
 * @param size LEGACY priskategori ("small"/"large"). Påvirker IKKE grid-format.
 * @param maxBallValue Maks ball-verdi (typisk 75 for moderne Spill 1, 90 for
 *   legacy). Kolonner distribueres proporsjonalt.
 * @returns Flat row-major array av 25 celler. Index 12 = 0 (free centre).
 *   Andre celler: number | null (null for tomme celler hvis range < 5).
 */
export function generateGridForTicket(
  _size: "small" | "large",
  maxBallValue: number
): Array<number | null> {
  return generate5x5Grid(maxBallValue);
}

const GRID_FREE_CENTRE_INDEX = 12; // row 2, col 2 i row-major 5x5.

/**
 * Genererer en 5x5 bingo-ticket med free centre og proporsjonal column-range.
 * Returnerer flat row-major array (25 celler).
 */
function generate5x5Grid(maxBallValue: number): Array<number | null> {
  const numCols = 5;
  const numRows = 5;
  const ranges = computeColumnRanges(maxBallValue, numCols);

  // Per-kolonne: plukk antall unike tall = rows (5), unntatt col 2 der row 2
  // er free centre (kun 4 plukk nødvendig).
  const perCol: Array<Array<number | null>> = [];
  for (let c = 0; c < numCols; c++) {
    const { start, end } = ranges[c]!;
    const needed = c === 2 ? numRows - 1 : numRows;
    if (end < start) {
      perCol.push(new Array(numRows).fill(null));
      continue;
    }
    const rangeSize = end - start + 1;
    const pickCount = Math.min(needed, rangeSize);
    const picks = pickUniqueInRange(start, end, pickCount).sort(
      (a, b) => a - b
    );
    // Fyll kolonnen: 5 slots, med null for padding.
    const colArr: Array<number | null> = new Array(numRows).fill(null);
    if (c === 2) {
      // Row 2 = free centre. Fyll row 0, 1, 3, 4 med picks.
      let pi = 0;
      for (let r = 0; r < numRows; r++) {
        if (r === 2) continue;
        colArr[r] = pi < picks.length ? picks[pi]! : null;
        pi++;
      }
    } else {
      for (let r = 0; r < numRows; r++) {
        colArr[r] = r < picks.length ? picks[r]! : null;
      }
    }
    perCol.push(colArr);
  }

  // Flat row-major.
  const flat: Array<number | null> = new Array(numRows * numCols).fill(null);
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      flat[r * numCols + c] = perCol[c]![r]!;
    }
  }
  // Free centre: idx 12 = 0 (ikke null — eksplisitt 0-sentinel).
  flat[GRID_FREE_CENTRE_INDEX] = 0;
  return flat;
}

/**
 * Proporsjonal column-range for 5-kolonne 5x5 bingo.
 *   col 0..3: step = floor(maxBallValue/5), range [c*step+1 .. (c+1)*step].
 *   col 4:    [4*step+1 .. maxBallValue] (inkluderer rest-en).
 *
 * Hvis maxBallValue < 5, får senere kolonner tom range (end<start) og dermed
 * null-padding.
 */
function computeColumnRanges(
  maxBallValue: number,
  numCols: number
): Array<{ start: number; end: number }> {
  const step = Math.max(1, Math.floor(maxBallValue / numCols));
  const ranges: Array<{ start: number; end: number }> = [];
  for (let c = 0; c < numCols; c++) {
    const start = c * step + 1;
    const end = c === numCols - 1 ? maxBallValue : (c + 1) * step;
    ranges.push({ start, end });
  }
  return ranges;
}

function shuffle<T>(values: T[]): T[] {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function pickUniqueInRange(
  start: number,
  end: number,
  count: number
): number[] {
  const values = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  return shuffle(values).slice(0, count);
}

// ── Service ──────────────────────────────────────────────────────────────────

export class Game1DrawEngineService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly ticketPurchase: Game1TicketPurchaseService;
  private readonly audit: AuditLogService;
  private readonly config: Game1DrawEngineConfig;
  private readonly payoutService: Game1PayoutService | null;
  private readonly jackpotService: Game1JackpotService | null;
  /**
   * MASTER_PLAN §2.3: state-service for daglig akkumulert jackpot.
   * Late-binding via setJackpotStateService unngår sirkulær wiring.
   * Default null = ingen daglig-jackpot-evaluering.
   */
  private jackpotStateService: Game1JackpotStateService | null;
  private adminBroadcaster: AdminGame1Broadcaster | null;
  /** PR-C4: broadcaster for default-namespace (spiller-klient). */
  private playerBroadcaster: Game1PlayerBroadcaster | null;
  private miniGameOrchestrator: Game1MiniGameOrchestrator | null;
  private oddsenEngine: MiniGameOddsenEngine | null;
  private physicalTicketPayoutService: PhysicalTicketPayoutService | null;
  /**
   * PR-T2/T3 Spor 4: akkumulerende pot-service (Jackpott + Innsatsen).
   * Valgfri — hvis ikke wired opp hopper engine over pot-evaluering.
   * Ikke `readonly` så late-binding via `setPotService` (T2) er mulig.
   */
  private potService: Game1PotService | null;
  /**
   * PR-T2 Spor 4: tick-service for daglig pot-boost. Kalles lazy fra
   * PotEvaluator (jackpott-sti) FØR tryWin slik at dagens boost er
   * applisert. Sendes inn til evaluator som valgfri dependency — evaluator
   * bruker den kun når potType='jackpott'.
   */
  private potDailyTickService: PotDailyAccumulationTickService | null;
  /**
   * PR-T2/T3 Spor 4: wallet-adapter for pot-payout. Kun brukt når
   * potService er satt. Pot-utbetaling kjører `to: "winnings"` (gevinst
   * fra spill). Brukes av den konsoliderte `evaluateAccumulatingPots`
   * (PR-C2) for alle pot-typer (jackpott + innsatsen + generic).
   */
  private walletAdapter: WalletAdapter | null;
  /**
   * PR-C1b: BingoEngine-referanse for room-cleanup ved
   * completion/cancellation. Ikke `readonly` så late-binding via
   * `setBingoEngine()` er mulig (matcher patternet for andre valgfrie
   * dependencies — unngår sirkulær wiring hvis engine konstrueres senere).
   * Default null = ingen cleanup-call (test-scenarier uten engine virker
   * uendret).
   */
  private bingoEngine: BingoEngine | null;
  /**
   * K1-C: Lucky Number Bonus. Null = feature av (bakoverkompat). Begge må
   * være satt for at bonus skal utbetales: service beregner, lookup-port
   * gir spillerens valgte lykketall for rommet.
   */
  private luckyBonusService: Game1LuckyBonusService | null;
  private luckyNumberLookup:
    | ((args: { roomCode: string; userId: string }) => number | null | undefined)
    | null;
  /** K2-A CRIT-2: compliance ledger-port for EXTRA_PRIZE-entries. */
  private readonly complianceLedgerPort: ComplianceLedgerPort;
  /** K2-A CRIT-3: prize policy-port for single-prize-cap (2500 kr). */
  private readonly prizePolicyPort: PrizePolicyPort;

  constructor(options: Game1DrawEngineServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
    this.ticketPurchase = options.ticketPurchaseService;
    this.audit = options.auditLogService;
    this.config = {
      defaultMaxDraws:
        options.config?.defaultMaxDraws ?? DEFAULT_GAME1_MAX_DRAWS,
    };
    this.payoutService = options.payoutService ?? null;
    this.jackpotService = options.jackpotService ?? null;
    this.jackpotStateService = options.jackpotStateService ?? null;
    this.adminBroadcaster = options.adminBroadcaster ?? null;
    this.playerBroadcaster = options.playerBroadcaster ?? null;
    this.miniGameOrchestrator = options.miniGameOrchestrator ?? null;
    this.oddsenEngine = options.oddsenEngine ?? null;
    this.physicalTicketPayoutService = options.physicalTicketPayoutService ?? null;
    this.potService = options.potService ?? null;
    this.potDailyTickService = options.potDailyTickService ?? null;
    this.walletAdapter = options.walletAdapter ?? null;
    this.bingoEngine = options.bingoEngine ?? null;
    this.luckyBonusService = options.luckyBonusService ?? null;
    this.luckyNumberLookup = options.luckyNumberLookup ?? null;
    // K2-A CRIT-2 / CRIT-3: ledger + prize-policy ports. Default no-op
    // (bakoverkompat for tester). Produksjon wires til
    // engine.getComplianceLedgerPort() + engine.getPrizePolicyPort().
    this.complianceLedgerPort =
      options.complianceLedgerPort ?? new NoopComplianceLedgerPort();
    this.prizePolicyPort =
      options.prizePolicyPort ?? new NoopPrizePolicyPort();
    // PR-T3 Spor 4: fail-closed — hvis potService wired ved konstruksjon uten
    // walletAdapter → ugyldig konfig. (Late-binding via setters er unntak for
    // test-oppsett og sirkulær wiring; der ansvarliggjøres caller for å sette
    // begge før første draw.)
    if (this.potService !== null && this.walletAdapter === null) {
      throw new DomainError(
        "INVALID_CONFIG",
        "potService krever også walletAdapter i Game1DrawEngineService."
      );
    }
  }

  /** PR-T2: late-binding for Game1PotService (unngå sirkulær wiring). */
  setPotService(svc: Game1PotService): void {
    this.potService = svc;
  }

  /**
   * MASTER_PLAN §2.3: late-binding for Game1JackpotStateService.
   * Når wired sammen med walletAdapter vil engine etter Fullt Hus innen
   * threshold atomisk debit-and-reset daglig-pott og distribuere til
   * vinnere. Uten state-service er evalueringen no-op (bakoverkompat).
   */
  setJackpotStateService(svc: Game1JackpotStateService): void {
    this.jackpotStateService = svc;
  }

  /** PR-T2: late-binding for PotDailyAccumulationTickService. */
  setPotDailyTickService(svc: PotDailyAccumulationTickService): void {
    this.potDailyTickService = svc;
  }

  /** PR-T2: late-binding for WalletAdapter (pot-credit). */
  setWalletAdapter(adapter: WalletAdapter): void {
    this.walletAdapter = adapter;
  }

  /** PT4: late-binding for physical-ticket payout service (unngå sirkulær wiring). */
  setPhysicalTicketPayoutService(svc: PhysicalTicketPayoutService): void {
    this.physicalTicketPayoutService = svc;
  }

  /** BIN-690 M1: late-binding for mini-game orchestrator. */
  setMiniGameOrchestrator(orchestrator: Game1MiniGameOrchestrator): void {
    this.miniGameOrchestrator = orchestrator;
  }

  /**
   * BIN-690 M5: late-binding for Oddsen-engine. Brukes av drawNext() ved
   * terskel-draw for å resolve aktiv Oddsen-state fra forrige spill.
   * Separat fra miniGameOrchestrator fordi Oddsen-resolve er ATOMISK med
   * draw (inne i samme transaksjon), mens orchestrator.maybeTriggerFor er
   * fire-and-forget POST-commit.
   */
  setOddsenEngine(engine: MiniGameOddsenEngine): void {
    this.oddsenEngine = engine;
  }

  /**
   * PR-C1b: late-binding for BingoEngine (unngå sirkulær wiring). Satt fra
   * index.ts etter at `engine` er konstruert. Uten denne vil room-cleanup
   * ved completion/cancellation være no-op.
   */
  setBingoEngine(engine: BingoEngine): void {
    this.bingoEngine = engine;
  }

  /**
   * PR-C1b: delegate-wrapper mot helper-funksjon i
   * `Game1DrawEngineCleanup.ts`. Byte-identisk fail-closed kontrakt —
   * se helper-filen for full dokumentasjon.
   */
  private destroyRoomIfPresent(
    scheduledGameId: string,
    roomCode: string | null,
    context: "completion" | "cancellation"
  ): void {
    destroyBingoEngineRoomIfPresent(
      this.bingoEngine,
      scheduledGameId,
      roomCode,
      context
    );
  }

  /** PR 4d.3: late-binding for admin-broadcaster (io må finnes først). */
  setAdminBroadcaster(broadcaster: AdminGame1Broadcaster): void {
    this.adminBroadcaster = broadcaster;
  }

  /** PR-C4: late-binding for player-broadcaster (io må finnes først). */
  setPlayerBroadcaster(broadcaster: Game1PlayerBroadcaster): void {
    this.playerBroadcaster = broadcaster;
  }

  /**
   * PR-C4: Delegate-wrapper mot `emitPlayerDrawNew` i
   * `Game1DrawEngineBroadcast.ts`. Byte-identisk atferd.
   */
  private notifyPlayerDrawNew(
    roomCode: string,
    scheduledGameId: string,
    ballNumber: number,
    drawIndex0Based: number
  ): void {
    emitPlayerDrawNew(
      this.playerBroadcaster,
      roomCode,
      scheduledGameId,
      ballNumber,
      drawIndex0Based
    );
  }

  /**
   * PR-C4: Delegate-wrapper mot `emitPlayerPatternWon`.
   *
   * BIN-696 / Tobias 2026-04-26: utvidet med `prizePerWinnerKr` og
   * `claimType` slik at scheduled-Spill1 broadcast matcher event-
   * kontrakten i `PatternWonPayload` (claim-/draw-events i ad-hoc
   * Spill 2/3 inkluderte allerede begge feltene). Uten disse fikk
   * klient-popupen `payoutAmount=undefined` → 0 kr ved Fullt Hus
   * vinst, og `claimType=undefined` brøt LINE/BINGO-routing.
   */
  private notifyPlayerPatternWon(
    roomCode: string,
    scheduledGameId: string,
    patternName: string,
    phase: number,
    winnerIds: string[],
    drawIndex0Based: number,
    prizePerWinnerKr: number,
    claimType: ClaimType
  ): void {
    emitPlayerPatternWon(
      this.playerBroadcaster,
      roomCode,
      scheduledGameId,
      patternName,
      phase,
      winnerIds,
      drawIndex0Based,
      prizePerWinnerKr,
      claimType
    );
  }

  private resolvePlayerPatternWinnerIds(
    roomCode: string,
    winnerWalletIds: string[],
    fallbackWinnerIds: string[]
  ): string[] {
    if (!this.bingoEngine || winnerWalletIds.length === 0) {
      return fallbackWinnerIds;
    }
    try {
      const walletSet = new Set(winnerWalletIds);
      const snapshot = this.bingoEngine.getRoomSnapshot(roomCode);
      const playerIds = snapshot.players
        .filter((player) => walletSet.has(player.walletId))
        .map((player) => player.id);
      const uniquePlayerIds = Array.from(new Set(playerIds));
      return uniquePlayerIds.length > 0 ? uniquePlayerIds : fallbackWinnerIds;
    } catch (err) {
      log.warn(
        { err, roomCode },
        "kunne ikke mappe scheduled winner walletIds til runtime playerIds — bruker fallback winnerIds"
      );
      return fallbackWinnerIds;
    }
  }

  /**
   * PR-C4: Delegate-wrapper mot `emitPlayerRoomUpdate`.
   */
  private notifyPlayerRoomUpdate(roomCode: string): void {
    emitPlayerRoomUpdate(this.playerBroadcaster, roomCode);
  }

  /** PR 4d.3: Delegate-wrapper mot `emitAdminDrawProgressed`. */
  private notifyDrawProgressed(
    scheduledGameId: string,
    ballNumber: number,
    drawIndex: number,
    currentPhase: number
  ): void {
    emitAdminDrawProgressed(
      this.adminBroadcaster,
      scheduledGameId,
      ballNumber,
      drawIndex,
      currentPhase
    );
  }

  /** PR 4d.4: Delegate-wrapper mot `emitAdminPhaseWon`. */
  private notifyPhaseWon(
    scheduledGameId: string,
    patternName: string,
    phase: number,
    winnerIds: string[],
    drawIndex: number
  ): void {
    emitAdminPhaseWon(
      this.adminBroadcaster,
      scheduledGameId,
      patternName,
      phase,
      winnerIds,
      drawIndex
    );
  }

  /**
   * PT4: Delegate-wrapper mot `emitAdminPhysicalTicketWon`.
   */
  private notifyPhysicalTicketWon(evt: {
    gameId: string;
    phase: number;
    patternName: string;
    pendingPayoutId: string;
    ticketId: string;
    hallId: string;
    responsibleUserId: string;
    expectedPayoutCents: number;
    color: string;
    adminApprovalRequired: boolean;
  }): void {
    emitAdminPhysicalTicketWon(this.adminBroadcaster, evt);
  }

  /** Task 1.1: Delegate-wrapper mot `emitAdminAutoPaused`. */
  private notifyAutoPaused(scheduledGameId: string, phase: number): void {
    emitAdminAutoPaused(this.adminBroadcaster, scheduledGameId, phase);
  }

  // ── Table helpers ─────────────────────────────────────────────────────────

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  private gameStateTable(): string {
    return `"${this.schema}"."app_game1_game_state"`;
  }

  private drawsTable(): string {
    return `"${this.schema}"."app_game1_draws"`;
  }

  private assignmentsTable(): string {
    return `"${this.schema}"."app_game1_ticket_assignments"`;
  }

  /** PT4: tabell-referanse for fysisk-bong inventar. */
  private staticTicketsTable(): string {
    return `"${this.schema}"."app_static_tickets"`;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Initialiserer spill-tilstand:
   *   1. Henter scheduled_game.status (må være 'ready_to_start' eller
   *      'purchase_open' med allReady — assertion skjer før engine kalles av
   *      master-control).
   *   2. Resolver draw-bag via DrawBagStrategy.
   *   3. INSERT app_game1_game_state med shuffled bag.
   *   4. Genererer ticket-assignments for alle ikke-refunderte purchases.
   *   5. UPDATE scheduled_game.status='running', actual_start_time=NOW().
   *   6. Idempotent: hvis game_state allerede finnes og spillet er running,
   *      returnerer samme state uten å opprette duplikater.
   */
  async startGame(
    scheduledGameId: string,
    actorUserId: string
  ): Promise<Game1GameStateView> {
    return this.runInTransaction(async (client) => {
      const game = await this.loadScheduledGameForUpdate(client, scheduledGameId);

      // Idempotent short-circuit: hvis game_state allerede finnes → gi tilbake
      // eksisterende state.
      const existing = await this.loadGameState(client, scheduledGameId);
      if (existing) {
        // Hvis status allerede er running/completed, vi skal ikke re-initialisere.
        log.debug(
          { scheduledGameId, status: game.status },
          "startGame idempotent: engine-state finnes allerede"
        );
        const draws = await this.loadDrawsInOrder(client, scheduledGameId);
        return this.buildStateView(
          existing,
          game.status,
          draws,
          game.trafikklys_row_color ?? null,
        );
      }

      // Pre-cond-sjekk. Master-control validerer også dette, men vi defender
      // engine-lag for direkte kall.
      if (
        game.status !== "ready_to_start" &&
        game.status !== "purchase_open" &&
        game.status !== "running"
      ) {
        throw new DomainError(
          "ENGINE_NOT_STARTABLE",
          `Kan ikke starte draw-engine i status '${game.status}'.`
        );
      }

      // Resolve draw-bag.
      const bagConfig = resolveDrawBagConfig("game_1", undefined);
      const drawBag = buildDrawBag(bagConfig);

      // Trafikklys runtime (2026-05-08, §5 i SPILL_REGLER_OG_PAYOUT.md):
      // Detekter Trafikklys-variant ved spill-start, valider at den IKKE
      // kombineres med Oddsen, og trekk én rad-farge server-autoritativt.
      // Rad-fargen persisteres på scheduled-game-raden og bevares gjennom
      // hele runden (Rad 1 → ... → Fullt Hus). Klient-snapshot eksponerer
      // den via `Game1GameStateView.trafikklysRowColor` slik at TV-skjerm/
      // spiller-app kan vise banner ("Denne runden er GRØNN").
      //
      // Idempotent re-start: hvis kolonnen allerede er satt på raden, behold
      // verdien (ikke re-trekk). Det skjer kun via crash-recovery — startGame
      // har idempotent short-circuit ovenfor som returnerer tidligere.
      const trafikklysCfg =
        resolveTrafikklysVariantConfig(game.ticket_config_json) ??
        resolveTrafikklysVariantConfig(game.game_config_json);
      const oddsenCfgForExclusivity =
        resolveOddsenVariantConfig(game.ticket_config_json) ??
        resolveOddsenVariantConfig(game.game_config_json);
      if (trafikklysCfg && oddsenCfgForExclusivity) {
        // §B9: Trafikklys + Oddsen er gjensidig ekskluderende. Per Tobias
        // 2026-05-08 (gap-doc §3.3) kaster vi heller enn å silently la
        // Trafikklys vinne — det er en konfig-bug som må synlig fanges
        // tidlig før penger er på spill.
        throw new DomainError(
          "TRAFIKKLYS_ODDSEN_EXCLUSIVE",
          "Trafikklys og Oddsen kan ikke kombineres på samme katalog-rad.",
        );
      }

      let trafikklysRowColorPicked: TrafikklysRowColor | null = null;
      if (trafikklysCfg) {
        trafikklysRowColorPicked = pickTrafikklysRowColor(trafikklysCfg);
      }

      // INSERT game_state.
      await client.query(
        `INSERT INTO ${this.gameStateTable()}
           (scheduled_game_id, draw_bag_json, draws_completed, current_phase,
            engine_started_at)
         VALUES ($1, $2::jsonb, 0, 1, now())`,
        [scheduledGameId, JSON.stringify(drawBag)]
      );

      // Generer ticket-assignments.
      const purchases = await this.ticketPurchase.listPurchasesForGame(
        scheduledGameId
      );
      const assignmentsCreated = await this.generateTicketAssignments(
        client,
        scheduledGameId,
        purchases,
        bagConfig.maxBallValue
      );

      // UPDATE scheduled_game status → running (hvis ikke allerede running).
      // Persist trafikklys-rad-fargen i samme query når den trekkes — det
      // sparer en round-trip og garanterer atomisitet (rad-farge er låst
      // til status='running'-flippen).
      if (game.status !== "running" || trafikklysRowColorPicked !== null) {
        await client.query(
          `UPDATE ${this.scheduledGamesTable()}
              SET status                = CASE WHEN status = 'running' THEN status ELSE 'running' END,
                  actual_start_time     = COALESCE(actual_start_time, now()),
                  started_by_user_id    = COALESCE(started_by_user_id, $2),
                  trafikklys_row_color  = COALESCE(trafikklys_row_color, $3),
                  updated_at            = now()
            WHERE id = $1`,
          [scheduledGameId, actorUserId, trafikklysRowColorPicked]
        );
      }

      // Audit.
      this.fireAudit({
        actorId: actorUserId,
        action: "game1_engine.start",
        resourceId: scheduledGameId,
        details: {
          maxBallValue: bagConfig.maxBallValue,
          drawBagSize: bagConfig.drawBagSize,
          assignmentsCreated,
          purchasesCount: purchases.length,
          // Trafikklys-spor for compliance-audit. Når null har raden ikke
          // Trafikklys-variant — auditor kan filtrere på feltet.
          trafikklysRowColor: trafikklysRowColorPicked,
          trafikklysActive: trafikklysCfg !== null,
        },
      });

      log.info(
        {
          scheduledGameId,
          maxBallValue: bagConfig.maxBallValue,
          assignmentsCreated,
          trafikklysRowColor: trafikklysRowColorPicked,
        },
        "[GAME1_SCHEDULE PR4b] draw-engine startet"
      );

      const state = await this.loadGameState(client, scheduledGameId);
      if (!state) {
        throw new DomainError(
          "ENGINE_STATE_MISSING",
          "Kunne ikke lese ny engine-state etter INSERT."
        );
      }
      return this.buildStateView(state, "running", [], trafikklysRowColorPicked);
    });
  }

  /**
   * Trekk neste kule.
   *   1. Hent state. Reject hvis paused eller finished.
   *   2. ball = draw_bag[draws_completed].
   *   3. INSERT app_game1_draws.
   *   4. Oppdater markings_json per assignment i samme transaksjon.
   *   5. UPDATE game_state: draws_completed++, last_drawn_*.
   *   6. Sjekk maxDraws → UPDATE scheduled_game.status='completed'.
   *
   * Pattern-evaluering + fase-progresjon implementeres i PR 4c.
   */
  async drawNext(scheduledGameId: string): Promise<Game1GameStateView> {
    // PR 4d.4: fanget i closure fra transaksjonen så notifyPhaseWon kan
    // kalles POST-commit. Ingen broadcast hvis transaksjonen ruller tilbake.
    let capturedPhaseResult: {
      phaseWon: boolean;
      winnerIds: string[];
      patternName: string;
      phase: number;
      /**
       * W1-hotfix (Tobias 2026-04-26): unike wallet-IDer for vinnere.
       * Brukes POST-commit til å refreshe in-memory `Player.balance` i
       * BingoEngine-rommet før `notifyPlayerRoomUpdate` slik at
       * `room:update`-snapshot reflekterer faktisk wallet-state etter
       * payout. Uten dette dedup'er GameBridge.lastEmittedBalance bort
       * gevinst-broadcasten fordi me.balance var stale.
       */
      winnerWalletIds: string[];
      /**
       * BIN-696 / Tobias 2026-04-26: per-winner split-amount i kr for
       * pattern:won-broadcast. Eksakt for flat-path; representativt
       * (første color-gruppe) for per-color-path.
       */
      prizePerWinnerKr: number;
      /** BIN-696: claim-type for pattern:won (LINE/BINGO). */
      claimType: ClaimType;
    } | null = null;

    // BIN-690 M1: capture for POST-commit mini-game-trigger. Populert kun
    // hvis Fullt Hus (fase 5) vunnet og orchestrator er wired opp. Hver
    // vinner får sin egen mini-game (typisk kun én vinner per Fullt Hus).
    let capturedFullHouseInfo: {
      winnerIds: string[];
      drawSequenceAtWin: number;
      gameConfigJson: unknown;
    } | null = null;

    // PT4: fanget fysisk-bong-vinnere fra evaluateAndPayoutPhase. Broadcast
    // skjer POST-commit slik at rollback ikke sender falskt varsel.
    let capturedPhysicalWinners: PhysicalTicketWinInfo[] = [];

    // PR-C1b: fanget room_code + isFinished for POST-commit destroyRoom.
    // Kun aktuelt når scheduled_game.status blir satt til 'completed' i
    // denne drawen. Room-cleanup skjer ETTER commit slik at rollback
    // aldri kan slette et rom som fortsatt er i bruk.
    let capturedCleanupInfo: {
      roomCode: string | null;
    } | null = null;

    // PR-C4: fanget BingoEngine room_code slik at playerBroadcaster kan
    // sende `draw:new` + `room:update` til spiller-rommet POST-commit.
    // NULL når ingen spiller har joinet enda (rommet finnes ikke) —
    // da hopper vi over player-broadcast (admin-broadcast går uansett).
    let capturedRoomCode: string | null = null;

    // Task 1.1: Gap #1 — fanget phase som akkurat ble vunnet slik at
    // notifyAutoPaused kan kalles POST-commit. Kun satt når phaseWon
    // trigget auto-pause (ikke når Fullt Hus avslutter runden — da er
    // spillet completed, ikke pauset).
    let capturedAutoPausedPhase: number | null = null;

    return this.runInTransaction(async (client) => {
      const state = await this.loadGameStateForUpdate(client, scheduledGameId);
      if (!state) {
        throw new DomainError(
          "ENGINE_NOT_STARTED",
          "Draw-engine er ikke startet for dette spillet."
        );
      }
      if (state.paused) {
        throw new DomainError(
          "GAME_PAUSED",
          "Spillet er pauset — kan ikke trekke kule."
        );
      }
      if (state.engine_ended_at) {
        throw new DomainError(
          "GAME_FINISHED",
          "Spillet er avsluttet — kan ikke trekke flere kuler."
        );
      }

      const game = await this.loadScheduledGameForUpdate(client, scheduledGameId);
      if (game.status !== "running") {
        throw new DomainError(
          "GAME_NOT_RUNNING",
          `Kan ikke trekke kule i status '${game.status}'.`
        );
      }

      // PR-C4: capture room_code for POST-commit player-broadcast.
      // Settes kun hvis minst én spiller har joinet (handler i 4d.2 skriver
      // kolonnen). NULL → hopp over player-broadcast, admin-broadcast går
      // uansett.
      capturedRoomCode = game.room_code;

      const drawBag = parseDrawBag(state.draw_bag_json);
      if (state.draws_completed >= drawBag.length) {
        throw new DomainError(
          "DRAW_BAG_EXHAUSTED",
          "Alle kuler i draw-bag er trukket."
        );
      }

      const ball = drawBag[state.draws_completed]!;
      const nextSequence = state.draws_completed + 1;
      const maxDraws = this.resolveMaxDraws(game.ticket_config_json);

      // INSERT draws-rad.
      const drawId = `g1d-${randomUUID()}`;
      await client.query(
        `INSERT INTO ${this.drawsTable()}
           (id, scheduled_game_id, draw_sequence, ball_value, drawn_at,
            current_phase_at_draw)
         VALUES ($1, $2, $3, $4, now(), $5)`,
        [drawId, scheduledGameId, nextSequence, ball, state.current_phase]
      );

      // Oppdater markings per assignment. Last assignments som har ball i
      // grid_numbers_json, og marker riktig indeks.
      await this.markBallOnAssignments(client, scheduledGameId, ball);

      // GAME1_SCHEDULE PR 4c Bolk 5: Evaluér aktiv fase mot alle assignments.
      // Hvis vinnere finnes → kall payoutService, øk current_phase, eller
      // ender spillet hvis Fullt Hus.
      //
      // Scheduler-config-kobling: hvis `game_config_json` er satt (spawnet
      // etter scheduler-fix landet) → per-farge-matriser via spill1-
      // mapperen. Hvis NULL → fallback til ticket_config_json (legacy form).
      const phaseResult = await this.evaluateAndPayoutPhase(
        client,
        scheduledGameId,
        state.current_phase,
        nextSequence,
        game.ticket_config_json,
        game.game_config_json,
        ball,
        game.room_code,
        // Trafikklys runtime (2026-05-08, §5): persistert rad-farge fra
        // scheduled-game-raden. Validert mot whitelist; null hvis ikke-
        // Trafikklys-spill. Brukes til å overstyre Rad/Fullt Hus-poten.
        isTrafikklysRowColor(game.trafikklys_row_color)
          ? game.trafikklys_row_color
          : null,
      );

      // PR 4d.4: capture for post-commit admin-broadcast.
      if (phaseResult.phaseWon && phaseResult.winnerIds.length > 0) {
        capturedPhaseResult = {
          phaseWon: true,
          winnerIds: phaseResult.winnerIds,
          patternName: phaseDisplayName(state.current_phase),
          phase: state.current_phase,
          // W1-hotfix: capture vinner-wallet-IDer slik at
          // `notifyPlayerRoomUpdate` POST-commit kan refreshe in-memory
          // Player.balance før broadcast. Se kommentar på field-deklarasjonen.
          winnerWalletIds: phaseResult.winnerWalletIds,
          // BIN-696: capture per-winner split-amount + claimType for
          // pattern:won-broadcast slik at klient-popup viser faktisk
          // credited beløp og kan route LINE vs BINGO korrekt.
          prizePerWinnerKr: phaseResult.prizePerWinnerKr,
          claimType: phaseResult.claimType,
        };
      }

      // PT4: capture fysisk-bong-vinnere for post-commit broadcast.
      // Broadcast skjer uavhengig av digital phaseWon — en fysisk bong kan
      // vinne selv om ingen digitale bonger vinner samme fase.
      if (phaseResult.physicalWinners.length > 0) {
        capturedPhysicalWinners = phaseResult.physicalWinners;
      }

      // UPDATE state: draws_completed + phase + eventuelt engine_ended_at.
      const bingoWon = phaseResult.phaseWon && state.current_phase === TOTAL_PHASES;
      const maxDrawsReached = nextSequence >= maxDraws;
      const isFinished = bingoWon || maxDrawsReached;

      // BIN-690 M1: hvis Fullt Hus vunnet → capture for POST-commit
      // mini-game-trigger. Orchestrator er fire-and-forget (krasher ikke
      // denne transaksjonen).
      if (bingoWon && phaseResult.winnerIds.length > 0) {
        capturedFullHouseInfo = {
          winnerIds: phaseResult.winnerIds,
          drawSequenceAtWin: nextSequence,
          gameConfigJson: game.game_config_json,
        };
      }
      const newPhase = phaseResult.phaseWon && !bingoWon
        ? state.current_phase + 1
        : state.current_phase;

      // Task 1.1: Auto-pause ved phase-won. Gap #1 i
      // MASTER_HALL_DASHBOARD_GAP_2026-04-24.md.
      //
      // Trigger-condition: phaseWon er true OG bingoWon er false (Fullt Hus
      // avslutter runden — ingen pause trengs). Effekt: sett paused=true
      // + paused_at_phase = fasen som akkurat ble vunnet. Dette blokkerer
      // både videre `drawNext()`-kall (guard linje ~938) OG auto-tick
      // (WHERE-filter `gs.paused = false` i Game1AutoDrawTickService).
      //
      // paused_at_phase brukes av master-UI for banner-tekst ("Pause
      // etter Rad N") og av Resume-flyten (`resumeGame` må tillate
      // running+paused-state og nullstille feltet).
      //
      // Demo Hall bypass (Tobias 2026-04-27): hvis master-hallen er merket
      // som test-hall (`app_halls.is_test_hall = TRUE`), skipper vi auto-
      // pausen helt så testeren får hele runden gjennom alle 5 faser uten
      // manuell Resume. MAX_DRAWS_REACHED i `isFinished` over avslutter
      // runden naturlig når draw-bag er tom. Operatoren ser fortsatt
      // phase-won-broadcast og kan verifisere mini-game/jackpot-flyt.
      const isMasterTestHall = game.master_is_test_hall === true;
      const autoPauseTriggered =
        phaseResult.phaseWon && !bingoWon && !isMasterTestHall;
      if (autoPauseTriggered) {
        capturedAutoPausedPhase = state.current_phase;
      }
      if (isMasterTestHall && phaseResult.phaseWon && !bingoWon) {
        log.info(
          {
            scheduledGameId,
            phase: state.current_phase,
            drawSequence: nextSequence,
          },
          "[demo-hall-bypass] phase won — hopper over auto-pause (master_is_test_hall=true)"
        );
      }

      await client.query(
        `UPDATE ${this.gameStateTable()}
            SET draws_completed   = $2,
                last_drawn_ball   = $3,
                last_drawn_at     = now(),
                current_phase     = $4,
                engine_ended_at   = CASE WHEN $5::boolean THEN now() ELSE engine_ended_at END,
                paused            = CASE WHEN $6::boolean THEN true ELSE paused END,
                paused_at_phase   = CASE WHEN $6::boolean THEN $7::int ELSE paused_at_phase END
          WHERE scheduled_game_id = $1`,
        [
          scheduledGameId,
          nextSequence,
          ball,
          newPhase,
          isFinished,
          autoPauseTriggered,
          autoPauseTriggered ? state.current_phase : null,
        ]
      );

      // Hvis Fullt Hus vunnet eller maxDraws nådd → marker scheduled_game som completed.
      if (isFinished) {
        await client.query(
          `UPDATE ${this.scheduledGamesTable()}
              SET status          = 'completed',
                  actual_end_time = COALESCE(actual_end_time, now()),
                  updated_at      = now()
            WHERE id = $1`,
          [scheduledGameId]
        );

        // F21 (E2E-verification 2026-Q3): strukturert log-event når engine
        // avslutter en runde. Tidligere endte spillet stille uten log
        // (kun DB-update + audit-event), så ops kunne ikke se "hvorfor
        // sluttet runden" uten å spørre databasen. Nå logger vi grunn
        // (FULL_HOUSE eller MAX_DRAWS_REACHED), draws-count, og phase.
        // Følger CLAUDE.md regel 3.4 R5/R8 om strukturert event-logg
        // per state-overgang.
        const completionReason = bingoWon ? "FULL_HOUSE" : "MAX_DRAWS_REACHED";
        log.info(
          {
            scheduledGameId,
            roomCode: game.room_code,
            reason: completionReason,
            drawsCompleted: nextSequence,
            maxDraws,
            currentPhase: state.current_phase,
            phaseWon: phaseResult.phaseWon,
            event: "game1.engine.completed",
          },
          `[engine] game completed reason=${completionReason} draws=${nextSequence}/${maxDraws} phase=${state.current_phase}`,
        );

        // PR-C1b: capture room_code for POST-commit destroyRoom-kall.
        // `game.room_code` er allerede FOR UPDATE-låst tidligere i
        // transaksjonen (se loadScheduledGameForUpdate), så vi trenger
        // ingen ny query. roomCode er null hvis ingen spiller har joinet
        // (vi destroyer da ikke noe — se destroyRoomIfPresent).
        capturedCleanupInfo = { roomCode: game.room_code };
      }

      // BIN-690 M5: Oddsen-resolve. Hvis draw-sekvensen når terskelen (default
      // 57) OG det finnes aktiv Oddsen-state for dette spillet, gjennomfør
      // resolve INNE i transaksjonen. Atomisk ift draw-persistens slik at en
      // payout-feil ruller tilbake BÅDE draw OG oddsen_state-update.
      //
      // Engine er valgfri: hvis ikke wired opp (test-scenarier uten oddsen),
      // hopper vi over. Fail-closed: hvis resolve kaster (wallet-feil, osv.)
      // ruller hele drawet tilbake — ingen half-committed state.
      if (this.oddsenEngine) {
        try {
          await this.maybeResolveOddsen(
            client,
            scheduledGameId,
            nextSequence,
            isFinished
          );
        } catch (err) {
          log.error(
            { err, scheduledGameId, drawSequence: nextSequence },
            "[BIN-690 M5] Oddsen resolveForGame kastet inne i draw-transaksjon — rull tilbake"
          );
          throw err;
        }
      }

      // Audit.
      this.fireAudit({
        actorId: null,
        action: "game1_engine.draw",
        resourceId: scheduledGameId,
        details: {
          drawSequence: nextSequence,
          ballValue: ball,
          isFinished,
          phaseWon: phaseResult.phaseWon,
          phaseThatWasEvaluated: state.current_phase,
          phaseAfterDraw: newPhase,
          winnerCount: phaseResult.winnerCount,
          bingoWon,
        },
      });

      // Returner oppdatert view.
      const updatedState = await this.loadGameState(client, scheduledGameId);
      if (!updatedState) {
        throw new DomainError(
          "ENGINE_STATE_MISSING",
          "Kunne ikke lese engine-state etter draw."
        );
      }
      const updatedStatus = isFinished ? "completed" : game.status;
      const draws = await this.loadDrawsInOrder(client, scheduledGameId);
      // Trafikklys runtime (2026-05-08): rad-farge er persistert ved
      // startGame; vi videreformidler den til state-view-en så hver
      // drawNext-respons inneholder rowColor (idempotent på tvers av draws).
      return this.buildStateView(
        updatedState,
        updatedStatus,
        draws,
        game.trafikklys_row_color ?? null,
      );
    }).then(async (view) => {
      // PR 4d.3: admin-broadcast etter commit. view.lastDrawnBall er alltid
      // satt her (vi har akkurat trukket og persistert), og drawsCompleted
      // avspeiler sekvensen for tell-logikk i UI.
      if (view.lastDrawnBall != null) {
        this.notifyDrawProgressed(
          scheduledGameId,
          view.lastDrawnBall,
          view.drawsCompleted,
          view.currentPhase
        );
      }
      // PR 4d.4: admin phase-won-broadcast. Rekkefølge matcher default-
      // namespace-kontrakten (draw:new → pattern:won → room:update) så
      // admin-UI ser phase-won etter draw-progressed.
      if (capturedPhaseResult) {
        this.notifyPhaseWon(
          scheduledGameId,
          capturedPhaseResult.patternName,
          capturedPhaseResult.phase,
          capturedPhaseResult.winnerIds,
          view.drawsCompleted
        );
      }
      // Task 1.1: admin auto-paused-broadcast etter phase-won som trigger
      // auto-pause. Går ETTER phase-won slik at UI får begge events i
      // deterministic rekkefølge (phase-won for payout-animasjon, så
      // auto-paused for Resume-knapp). IKKE emit når Fullt Hus avslutter
      // runden — da er spillet ferdig, ikke pauset.
      if (capturedAutoPausedPhase !== null) {
        this.notifyAutoPaused(scheduledGameId, capturedAutoPausedPhase);
        // Merk view-et så route-laget kan returnere { pausedAutomatically:true }
        // uten å måtte korrelere med auto-paused-eventet.
        view.pausedAutomatically = true;
      }

      // W1-hotfix (Tobias 2026-04-26 — wallet 2.-vinn-bug):
      // ─────────────────────────────────────────────────────
      // Refresh in-memory `Player.balance` for vinner-wallets FØR vi pusher
      // `room:update`. Uten dette ville snapshot bygget i
      // `notifyPlayerRoomUpdate` inneholdt stale balance (verdien fra FØR
      // payoutPhase committed), og GameBridge.lastEmittedBalance-dedup
      // blokkerer broadcast — symptom var Tobias' rapporterte regresjon der
      // gevinst-chip ikke oppdaterte ved 2. vinn (round 1 fungerte ved
      // gameEnded-refetch, round 2 mistet race-en).
      //
      // Vi bruker `getAvailableBalance` (via BingoEngine.refresh-helper) så
      // chip-en (som også viser available) får konsistent verdi — dette er
      // korrekt valg per saldo-flash-fix #534. Fail-closed: en feil her er
      // logget men kaster ikke (payout er allerede committed; missende
      // refresh ruller IKKE tilbake credit-en).
      if (
        capturedPhaseResult &&
        capturedPhaseResult.winnerWalletIds.length > 0 &&
        this.bingoEngine
      ) {
        for (const walletId of capturedPhaseResult.winnerWalletIds) {
          try {
            await this.bingoEngine.refreshPlayerBalancesForWallet(walletId);
          } catch (err) {
            log.warn(
              { err, scheduledGameId, walletId },
              "[W1-HOTFIX] refreshPlayerBalancesForWallet feilet — payout committed uansett, room:update kan inneholde stale balance for denne wallet"
            );
          }
        }
      }

      // 2026-05-11 (Tobias-direktiv): structured commit-log FØR broadcast-
      // sekvensen. Setter `roomCode` til `capturedRoomCode` (kan være null)
      // slik at en null-verdi her direkte forklarer hvorfor spiller-klient
      // ikke får `draw:new` — broadcast-laget skipper når
      // `capturedRoomCode===null` (ingen spillere joinet enda).
      if (DEBUG_SPILL1_DRAWS && view.lastDrawnBall != null) {
        log.info(
          {
            scheduledGameId,
            roomCode: capturedRoomCode,
            drawIndex: view.drawsCompleted - 1,
            ball: view.lastDrawnBall,
            drawsCompleted: view.drawsCompleted,
            isFinished: view.isFinished,
          },
          "[draw] committed"
        );
      }

      // PR-C4: spiller-broadcast til default-namespace. Samme rekkefølge som
      // admin-broadcast (draw:new → pattern:won → room:update) slik at
      // spiller-UI og admin-UI holder seg synkronisert.
      //
      // `drawsCompleted` i view er 1-basert (INSERT-sekvens). Klientens
      // `GameBridge.lastAppliedDrawIndex` er 0-basert (første ball =
      // drawIndex 0), så vi sender `view.drawsCompleted - 1`. Matcher
      // `drawBall()` for Spill 2/3 i BingoEngine som også er 0-basert.
      if (capturedRoomCode !== null && view.lastDrawnBall != null) {
        const drawIndex0Based = view.drawsCompleted - 1;
        this.notifyPlayerDrawNew(
          capturedRoomCode,
          scheduledGameId,
          view.lastDrawnBall,
          drawIndex0Based
        );
        if (capturedPhaseResult) {
          const playerWinnerIds = this.resolvePlayerPatternWinnerIds(
            capturedRoomCode,
            capturedPhaseResult.winnerWalletIds,
            capturedPhaseResult.winnerIds
          );
          this.notifyPlayerPatternWon(
            capturedRoomCode,
            scheduledGameId,
            capturedPhaseResult.patternName,
            capturedPhaseResult.phase,
            playerWinnerIds,
            drawIndex0Based,
            // BIN-696: per-winner split-amount + claimType slik at
            // klient-popup (WinPopup/WinScreenV2) får faktisk credited
            // beløp i stedet for å regne om phase-prize på egen hånd.
            capturedPhaseResult.prizePerWinnerKr,
            capturedPhaseResult.claimType
          );
        }
        // room:update push avslutter sekvensen — spilleren får oppdatert
        // player-liste / lucky-numbers / stakes samtidig med ball.
        // W1-hotfix: balanser er allerede refresh'ed over så snapshot-
        // building i `notifyPlayerRoomUpdate` plukker opp ny verdi.
        this.notifyPlayerRoomUpdate(capturedRoomCode);
      }
      // BIN-690 M1: fire-and-forget mini-game-trigger for Fullt Hus-vinnere.
      // Kjøres POST-commit slik at mini-game-feil IKKE kan rulle tilbake
      // bingo-payout. Orchestrator kaster aldri mot caller.
      if (capturedFullHouseInfo && this.miniGameOrchestrator) {
        this.triggerMiniGamesForFullHouse(
          scheduledGameId,
          capturedFullHouseInfo.winnerIds,
          capturedFullHouseInfo.drawSequenceAtWin,
          capturedFullHouseInfo.gameConfigJson
        );
      }

      // PT4: fire-and-forget broadcast av fysisk-bong-vinnere til admin-
      // namespace. Én broadcast per vinnende bong (ikke aggregert). Feil i
      // broadcast påvirker ikke noe — pending-rad er allerede persistert.
      for (const pw of capturedPhysicalWinners) {
        this.notifyPhysicalTicketWon({
          gameId: scheduledGameId,
          phase: pw.phase,
          patternName: pw.patternName,
          pendingPayoutId: pw.pendingPayoutId,
          ticketId: pw.ticketId,
          hallId: pw.hallId,
          responsibleUserId: pw.responsibleUserId,
          expectedPayoutCents: pw.expectedPayoutCents,
          color: pw.color,
          adminApprovalRequired: pw.adminApprovalRequired,
        });
      }

      // PR-C1b: cleanup in-memory BingoEngine-room POST-commit. Kun når
      // drawen akkurat fullførte scheduled_game (isFinished=true i
      // transaksjonen). Fail-closed — se destroyRoomIfPresent.
      if (capturedCleanupInfo) {
        this.destroyRoomIfPresent(
          scheduledGameId,
          capturedCleanupInfo.roomCode,
          "completion"
        );
      }
      return view;
    });
  }

  /**
   * BIN-690 M1: fire-and-forget trigger for mini-game etter Fullt Hus.
   * Kalles POST-commit fra drawNext. Hver vinner får sin egen mini-game
   * via orchestrator. Feil logges men krasher ikke draw-flyten.
   */
  private triggerMiniGamesForFullHouse(
    scheduledGameId: string,
    winnerIds: string[],
    drawSequenceAtWin: number,
    gameConfigJson: unknown
  ): void {
    const orchestrator = this.miniGameOrchestrator;
    if (!orchestrator) return;
    for (const winnerId of winnerIds) {
      // Lookup wallet + hall for vinneren. Orchestrator gjør dette internt
      // men for trigger-pathway må vi sende inn hall slik at admin-config
      // snapshot kan caches per hall hvis nødvendig i M2+. For M1 bruker
      // vi minimal metadata; orchestrator henter resten internt når
      // handleChoice kommer inn.
      void this.resolveWalletAndHallForUser(winnerId)
        .then((resolved) => {
          if (!resolved) {
            log.warn(
              { scheduledGameId, winnerId },
              "[BIN-690] Kunne ikke resolve wallet/hall for Fullt Hus-vinner — skipper mini-game"
            );
            return;
          }
          return orchestrator.maybeTriggerFor({
            scheduledGameId,
            winnerUserId: winnerId,
            winnerWalletId: resolved.walletId,
            hallId: resolved.hallId,
            drawSequenceAtWin,
            gameConfigJson,
          });
        })
        .catch((err) => {
          log.error(
            { err, scheduledGameId, winnerId },
            "[BIN-690] maybeTriggerFor kastet — fire-and-forget, ignorert"
          );
        });
    }
  }

  /**
   * BIN-690 M1: hent walletId + hallId for en vinner etter Fullt Hus.
   * Bruker phase_winners-tabellen (skrevet av payoutService i samme
   * transaksjon som draw) for å finne hall, og app_users for wallet.
   */
  private async resolveWalletAndHallForUser(
    userId: string
  ): Promise<{ walletId: string; hallId: string } | null> {
    try {
      const { rows } = await this.pool.query<{
        wallet_id: string | null;
        hall_id: string | null;
      }>(
        `SELECT u.wallet_id,
                (SELECT pw.hall_id
                   FROM "${this.schema}"."app_game1_phase_winners" pw
                  WHERE pw.winner_user_id = u.id
                  ORDER BY pw.created_at DESC
                  LIMIT 1) AS hall_id
           FROM "${this.schema}"."app_users" u
          WHERE u.id = $1
          LIMIT 1`,
        [userId]
      );
      if (rows.length === 0) return null;
      const { wallet_id, hall_id } = rows[0]!;
      if (!wallet_id || !hall_id) return null;
      return { walletId: wallet_id, hallId: hall_id };
    } catch (err) {
      log.warn(
        { err, userId },
        "[BIN-690] resolveWalletAndHallForUser feilet"
      );
      return null;
    }
  }

  /**
   * BIN-690 M5: Oddsen cross-round resolve. Kalles fra drawNext() inne i
   * draw-transaksjonen når draw-sekvensen når terskelen eller spillet
   * fullfører. Leser oddsen-config (fra `app_mini_games_config`) for å
   * bestemme resolveAtDraw-terskel + pot-størrelse, og delegerer selve
   * resolve-logikken til `MiniGameOddsenEngine.resolveForGame()`.
   *
   * Fail-closed: hvis engine kaster → drawNext ruller tilbake, ingen
   * half-committed state. Hvis ingen oddsen_state finnes for spillet →
   * return uten feil (normalflyt for spill uten Oddsen-kontekst).
   *
   * Resolve-trigger-strategi:
   *   a) drawSequence === config.resolveAtDraw (typisk 57) — main path,
   *      evaluerer alle drawn ball-verdier mot chosen_number.
   *   b) isFinished OG drawSequence < resolveAtDraw — spillet fullførte
   *      før terskel (Fullt Hus tidlig eller maxDraws lavere). Vi resolver
   *      med de tall som faktisk er trukket. Hvis chosen_number ikke er
   *      blant dem → miss (ikke expired — spilleren fikk full sjans).
   */
  private async maybeResolveOddsen(
    client: PoolClient,
    scheduledGameId: string,
    drawSequence: number,
    isFinished: boolean
  ): Promise<void> {
    const engine = this.oddsenEngine;
    if (!engine) return;

    // Hent config-snapshot for oddsen. Fall-back til default ved mangel.
    const oddsenConfig = await this.fetchOddsenConfig();

    // Resolve trigger-strategi: terskel-draw eller game-end.
    const atThreshold = drawSequence >= oddsenConfig.resolveAtDraw;
    const gameEndedBeforeThreshold = isFinished && !atThreshold;
    if (!atThreshold && !gameEndedBeforeThreshold) return;

    // Hent drawn numbers for dette spillet (inkludert den vi akkurat
    // trakk — den er persistert i samme transaksjon via INSERT ovenfor).
    const { rows } = await client.query<{ ball_value: number }>(
      `SELECT ball_value FROM ${this.drawsTable()}
        WHERE scheduled_game_id = $1
        ORDER BY draw_sequence ASC`,
      [scheduledGameId]
    );
    const drawnNumbers = rows.map((r) => Number(r.ball_value));

    const result: OddsenResolveResult | null = await engine.resolveForGame(
      scheduledGameId,
      drawnNumbers,
      oddsenConfig,
      client
    );
    if (result) {
      log.info(
        {
          scheduledGameId,
          drawSequence,
          outcome: result.outcome,
          potAmountCents: result.potAmountCents,
          chosenNumber: result.chosenNumber,
        },
        "[BIN-690 M5] Oddsen resolved"
      );
    }
  }

  /**
   * BIN-690 M5: hent oddsen-config fra `app_mini_games_config`. Bruker default
   * hvis ingen rad finnes (samme pattern som orchestrator.fetchConfigSnapshot).
   * Leser via pool (ikke transaksjon) for enkelhet — config-changes er
   * eventual consistent ift drawNext-transaksjonen, som er akseptabel
   * siden oddsenConfig er nesten-statisk.
   */
  private async fetchOddsenConfig(): Promise<OddsenConfig> {
    try {
      const { rows } = await this.pool.query<{
        config_json: Record<string, unknown> | null;
      }>(
        `SELECT config_json FROM "${this.schema}"."app_mini_games_config"
          WHERE game_type = 'oddsen' AND active = true LIMIT 1`
      );
      const snapshot: Readonly<Record<string, unknown>> =
        rows.length > 0 && rows[0]!.config_json ? rows[0]!.config_json : {};
      return parseOddsenConfig(snapshot);
    } catch (err) {
      log.warn(
        { err },
        "[BIN-690 M5] fetchOddsenConfig feilet — faller tilbake til default"
      );
      return parseOddsenConfig({});
    }
  }

  /**
   * Pauser auto-draw (PR 4c bruker next_auto_draw_at + paused-flag). I PR 4b
   * setter vi bare paused=true slik at drawNext() reject'er.
   */
  async pauseGame(
    scheduledGameId: string,
    actorUserId: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.gameStateTable()}
          SET paused = true
        WHERE scheduled_game_id = $1`,
      [scheduledGameId]
    );
    this.fireAudit({
      actorId: actorUserId,
      action: "game1_engine.pause",
      resourceId: scheduledGameId,
      details: {},
    });
    log.info({ scheduledGameId, actorUserId }, "[GAME1_SCHEDULE PR4b] engine pause");
  }

  async resumeGame(
    scheduledGameId: string,
    actorUserId: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.gameStateTable()}
          SET paused = false
        WHERE scheduled_game_id = $1`,
      [scheduledGameId]
    );
    this.fireAudit({
      actorId: actorUserId,
      action: "game1_engine.resume",
      resourceId: scheduledGameId,
      details: {},
    });
    log.info({ scheduledGameId, actorUserId }, "[GAME1_SCHEDULE PR4b] engine resume");
  }

  /**
   * Stopp spillet manuelt. Refund-flyt IKKE i PR 4b — kommer i PR 4d.
   * Scheduled_game status-oppdatering gjøres av master-control som orchestrator;
   * denne metoden oppdaterer kun engine-state.
   *
   * PR-C1b: rydder også eventuelt BingoEngine-rom (in-memory). Leser
   * room_code fra scheduled_games og kaller destroyRoom fail-closed.
   * Idempotent: gjentatt kall (eller kall uten engine-state) er trygt —
   * destroyRoomIfPresent svelger ROOM_NOT_FOUND.
   */
  async stopGame(
    scheduledGameId: string,
    reason: string,
    actorUserId: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.gameStateTable()}
          SET engine_ended_at = COALESCE(engine_ended_at, now())
        WHERE scheduled_game_id = $1`,
      [scheduledGameId]
    );
    this.fireAudit({
      actorId: actorUserId,
      action: "game1_engine.stop",
      resourceId: scheduledGameId,
      details: { reason },
    });
    log.info(
      { scheduledGameId, actorUserId, reason },
      "[GAME1_SCHEDULE PR4b] engine stop"
    );

    // PR-C1b: rydd BingoEngine-rom etter manual stop. Feil her svelges —
    // master-control-responsen skal aldri feile pga. en room-cleanup.
    await this.destroyRoomForScheduledGameSafe(
      scheduledGameId,
      "cancellation"
    );
  }

  /**
   * PR-C1b: delegate-wrapper mot helper-funksjon. Signatur og atferd uendret.
   * Se `Game1DrawEngineCleanup.ts` for full dokumentasjon.
   */
  async destroyRoomForScheduledGameSafe(
    scheduledGameId: string,
    context: "completion" | "cancellation"
  ): Promise<void> {
    await destroyRoomForScheduledGameFromDb(
      this.pool,
      this.scheduledGamesTable(),
      this.bingoEngine,
      scheduledGameId,
      context
    );
  }

  async getState(
    scheduledGameId: string
  ): Promise<Game1GameStateView | null> {
    const { rows } = await this.pool.query<GameStateRow>(
      `SELECT * FROM ${this.gameStateTable()} WHERE scheduled_game_id = $1`,
      [scheduledGameId]
    );
    const state = rows[0];
    if (!state) return null;
    // Trafikklys runtime (2026-05-08): hent rad-farge så getState-snapshot
    // matcher startGame/drawNext-snapshotene. Klient/TV-skjerm bruker
    // verdien til å vise banner.
    const { rows: gameRows } = await this.pool.query<{
      status: string;
      trafikklys_row_color: string | null;
    }>(
      `SELECT status, trafikklys_row_color FROM ${this.scheduledGamesTable()} WHERE id = $1`,
      [scheduledGameId]
    );
    const status = gameRows[0]?.status ?? "unknown";
    const trafikklysRowColor = gameRows[0]?.trafikklys_row_color ?? null;
    const draws = await this.listDraws(scheduledGameId);
    return this.buildStateView(state, status, draws, trafikklysRowColor);
  }

  /**
   * Liste alle trukne kuler i rekkefølge (for admin-konsoll recovery etter refresh).
   */
  async listDraws(scheduledGameId: string): Promise<Game1DrawRecord[]> {
    const { rows } = await this.pool.query<{
      draw_sequence: number;
      ball_value: number;
      drawn_at: Date | string;
    }>(
      `SELECT draw_sequence, ball_value, drawn_at
         FROM ${this.drawsTable()}
         WHERE scheduled_game_id = $1
         ORDER BY draw_sequence ASC`,
      [scheduledGameId]
    );
    return rows.map((r) => ({
      sequence: Number(r.draw_sequence),
      ball: Number(r.ball_value),
      drawnAt: r.drawn_at instanceof Date ? r.drawn_at : new Date(r.drawn_at),
    }));
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async runInTransaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // swallow rollback error
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async loadScheduledGameForUpdate(
    client: PoolClient,
    scheduledGameId: string
  ): Promise<ScheduledGameRow> {
    // Demo Hall bypass (Tobias 2026-04-27): join inn `is_test_hall` fra
    // master-hallen så `drawNext` kan bypasse auto-pause-på-phase-won
    // når master-hallen er en test-hall (Demo Hall*). LEFT JOIN — orphaned
    // master_hall_id (skulle ikke skje pga FK, men defensiv) gir NULL
    // → tolkes som FALSE i ::boolean-koersjonen i drawNext.
    //
    // FOR UPDATE OF sg sikrer at vi kun låser scheduled_games-raden, ikke
    // halls (som kan brukes parallelt av andre transaksjoner).
    const { rows } = await client.query<ScheduledGameRow>(
      `SELECT sg.id,
              sg.status,
              sg.ticket_config_json,
              sg.room_code,
              sg.game_config_json,
              sg.trafikklys_row_color,
              h.is_test_hall AS master_is_test_hall
         FROM ${this.scheduledGamesTable()} sg
         LEFT JOIN "${this.schema}"."app_halls" h
                ON h.id = sg.master_hall_id
         WHERE sg.id = $1
         FOR UPDATE OF sg`,
      [scheduledGameId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "GAME_NOT_FOUND",
        "Spillet finnes ikke."
      );
    }
    return row;
  }

  /**
   * PR 4d.1: Les BingoEngine `room_code` for en schedulert økt.
   *
   * Semantikk:
   *   - Returnerer string når scheduled_game eksisterer og har fått
   *     `room_code` satt (av PR 4d.2-join-handler).
   *   - Returnerer `null` når scheduled_game eksisterer men ingen spiller
   *     har joinet ennå (kolonnen er NULL).
   *   - Kaster `DomainError("GAME_NOT_FOUND")` når `scheduledGameId` ikke
   *     finnes (matcher `loadScheduledGameForUpdate`-semantikken).
   *
   * Read-only: bruker pool direkte (ingen transaction).
   */
  async getRoomCodeForScheduledGame(
    scheduledGameId: string
  ): Promise<string | null> {
    const { rows } = await this.pool.query<{ room_code: string | null }>(
      `SELECT room_code
         FROM ${this.scheduledGamesTable()}
         WHERE id = $1`,
      [scheduledGameId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "GAME_NOT_FOUND",
        "Spillet finnes ikke."
      );
    }
    return row.room_code;
  }

  /**
   * PR 4d.2: Persister `room_code`-tildeling for en schedulert økt atomisk.
   *
   * Race-sikring: FOR UPDATE-lås hindrer at to samtidige `joinScheduled`-
   * handlere begge skriver hver sin room_code. Første vinner, andre får
   * returnert vinnerens kode slik at caller kan destroy sitt BingoEngine-
   * rom og `joinRoom` inn i det faktiske.
   *
   * Unique-constraint `idx_app_game1_scheduled_games_room_code` (PR 4d.1)
   * fanger også kollisjon på tvers av scheduled_games (~0% sjanse med
   * `makeRoomCode`-alfabet, men cheap safety-net).
   *
   * Returverdi: faktisk `room_code` i DB etter commit. Hvis satt før kallet
   * ble dette det, ellers `roomCode`-parameteren. Kaster
   * `DomainError("GAME_NOT_FOUND")` når `scheduledGameId` ikke finnes.
   */
  async assignRoomCode(
    scheduledGameId: string,
    roomCode: string
  ): Promise<string> {
    const result = await this.runInTransaction(async (client) => {
      const { rows } = await client.query<{ room_code: string | null }>(
        `SELECT room_code
           FROM ${this.scheduledGamesTable()}
          WHERE id = $1
          FOR UPDATE`,
        [scheduledGameId]
      );
      const row = rows[0];
      if (!row) {
        throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke.");
      }
      if (row.room_code !== null) {
        // Annen request vant racen. Returner eksisterende kode uten UPDATE.
        return { before: row.room_code, after: row.room_code, wonRace: false };
      }
      await client.query(
        `UPDATE ${this.scheduledGamesTable()}
            SET room_code  = $2,
                updated_at = now()
          WHERE id = $1 AND room_code IS NULL`,
        [scheduledGameId, roomCode]
      );
      return { before: null as string | null, after: roomCode, wonRace: true };
    });
    if (DEBUG_SPILL1_DRAWS) {
      // 2026-05-11: log både `before` og `after` slik at ops kan se om denne
      // request vant racet (before=null, after=ROOMA) eller mistet
      // (before=ROOMB, after=ROOMB). Kritisk for å diagnostisere klient som
      // joiner én roomCode mens scheduled-engine emitter til en annen.
      log.info(
        {
          scheduledGameId,
          roomCode: result.after,
          before: result.before,
          after: result.after,
          wonRace: result.wonRace,
        },
        "[scheduled.assign-roomcode]"
      );
    }
    return result.after;
  }

  private async loadGameState(
    client: PoolClient,
    scheduledGameId: string
  ): Promise<GameStateRow | null> {
    const { rows } = await client.query<GameStateRow>(
      `SELECT * FROM ${this.gameStateTable()} WHERE scheduled_game_id = $1`,
      [scheduledGameId]
    );
    return rows[0] ?? null;
  }

  private async loadGameStateForUpdate(
    client: PoolClient,
    scheduledGameId: string
  ): Promise<GameStateRow | null> {
    const { rows } = await client.query<GameStateRow>(
      `SELECT * FROM ${this.gameStateTable()}
         WHERE scheduled_game_id = $1
         FOR UPDATE`,
      [scheduledGameId]
    );
    return rows[0] ?? null;
  }

  private async loadDrawsInOrder(
    client: PoolClient,
    scheduledGameId: string
  ): Promise<Game1DrawRecord[]> {
    const { rows } = await client.query<{
      draw_sequence: number;
      ball_value: number;
      drawn_at: Date | string;
    }>(
      `SELECT draw_sequence, ball_value, drawn_at
         FROM ${this.drawsTable()}
         WHERE scheduled_game_id = $1
         ORDER BY draw_sequence ASC`,
      [scheduledGameId]
    );
    return rows.map((r) => ({
      sequence: Number(r.draw_sequence),
      ball: Number(r.ball_value),
      drawnAt: r.drawn_at instanceof Date ? r.drawn_at : new Date(r.drawn_at),
    }));
  }

  private async generateTicketAssignments(
    client: PoolClient,
    scheduledGameId: string,
    purchases: Game1TicketPurchaseRow[],
    maxBallValue: number
  ): Promise<number> {
    let created = 0;
    for (const purchase of purchases) {
      if (purchase.refundedAt) continue;
      let sequence = 1;
      for (const specEntry of purchase.ticketSpec) {
        for (let i = 0; i < specEntry.count; i++) {
          const grid = generateGridForTicket(specEntry.size, maxBallValue);
          // Free centre (idx 12, cell=0) starter som "markert". Alle andre
          // celler starter umarkert.
          const markings = {
            marked: grid.map((cell) => cell === 0),
          };
          const assignmentId = `g1a-${randomUUID()}`;
          await client.query(
            `INSERT INTO ${this.assignmentsTable()}
              (id, scheduled_game_id, purchase_id, buyer_user_id, hall_id,
               ticket_color, ticket_size, grid_numbers_json,
               sequence_in_purchase, markings_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb)
             ON CONFLICT (purchase_id, sequence_in_purchase) DO NOTHING`,
            [
              assignmentId,
              scheduledGameId,
              purchase.id,
              purchase.buyerUserId,
              purchase.hallId,
              specEntry.color,
              specEntry.size,
              JSON.stringify(grid),
              sequence,
              JSON.stringify(markings),
            ]
          );
          sequence++;
          created++;
        }
      }
    }
    return created;
  }

  /**
   * GAME1_SCHEDULE PR 4c Bolk 5: Evaluér aktiv fase mot alle assignments
   * og utløs payout hvis vinnere finnes. Returnerer state om hvorvidt
   * fasen ble vunnet (→ caller øker current_phase eller ender spillet).
   *
   * Kalles INNE i drawNext-transaksjonen slik at en payout-feil fører til
   * rollback av hele draw-en (inkludert draws-INSERT og markings).
   *
   * Rollback-semantikk: Hvis payoutService.payoutPhase kaster (f.eks.
   * PAYOUT_WALLET_CREDIT_FAILED) → throw propagerer ut av drawNext-
   * transaksjonen og runInTransaction utfører ROLLBACK. Dette er
   * regulatorisk krav (§11 fail-closed).
   *
   * Scheduler-config-kobling (#316-follow-up): hvis `gameConfigJson`
   * inneholder `spill1.ticketColors[]` → bruk spill1VariantMapper til å
   * bygge per-farge pattern-matrise. Vinnere grupperes per ticket-color
   * og hver gruppe får egen premie (Option X). Uten per-farge-config
   * brukes flat-path (dagens atferd, første ticket-farge for alle).
   *
   * Bug 2-fix: jackpot-routing slås opp per vinner's egen ticketColor,
   * ikke bare første vinner. Før endret, får kun `winners[0]` riktig
   * jackpot ved multi-winner-scenarioer.
   */
  private async evaluateAndPayoutPhase(
    client: PoolClient,
    scheduledGameId: string,
    currentPhase: number,
    drawSequenceAtWin: number,
    ticketConfigJson: unknown,
    gameConfigJson: unknown,
    lastBall: number,
    roomCode: string | null,
    /**
     * Trafikklys runtime (2026-05-08, §5 i SPILL_REGLER_OG_PAYOUT.md):
     * server-trukket rad-farge for spillet. Validert mot whitelist
     * (rød/grønn/gul) før det sendes inn — null for ikke-Trafikklys-spill.
     * Når satt: payout-pathen overstyrer Rad/Fullt Hus-poten basert på
     * rad-farge i stedet for bongfarge.
     */
    trafikklysRowColor: TrafikklysRowColor | null = null,
  ): Promise<{
    phaseWon: boolean;
    winnerCount: number;
    winnerIds: string[];
    /**
     * W1-hotfix (Tobias 2026-04-26): unique wallet-IDer for vinner-bonger.
     * Brukes POST-commit av drawNext() for å refresh-e in-memory
     * `Player.balance` i BingoEngine-rommet etter wallet-credit. Uten
     * dette ville `room:update`-snapshot pushed via playerBroadcaster
     * inneholdt stale balance og GameBridge.lastEmittedBalance-dedup
     * blokkerer broadcast — symptom er Tobias' rapporterte 2.-vinn-bug
     * der gevinst-chip ikke oppdaterer ved runde 2.
     *
     * Tomt array hvis ingen vinnere eller payoutService ikke wired.
     */
    winnerWalletIds: string[];
    /**
     * BIN-696 / Tobias 2026-04-26: per-winner split-amount i kroner
     * (uten jackpot-bonus). Brukes av POST-commit `pattern:won`-broadcast
     * slik at klient-popup kan vise faktisk credited beløp i stedet for
     * å regne om phase-prize på egen hånd (som ga 1700 kr UI-bug ved
     * 5-veis split der kun 144 kr var faktisk creditert).
     *
     * For per-color-path er dette første color-gruppes prizePerWinner —
     * approximerer for enkle multi-color-tilfeller. `room:update` som
     * følger pattern:won inneholder eksakt verdi i `patternResults[]`
     * (engine setter `firstPayoutAmount` per Pattern), så LeftInfoPanel
     * "Gevinst"-summen i klient bruker den eksakte snapshot-verdien.
     *
     * 0 hvis ingen vinnere eller intet å betale ut.
     */
    prizePerWinnerKr: number;
    /**
     * BIN-696: claim-type for fasen — "LINE" for fase 1-4, "BINGO" for
     * Fullt Hus (fase 5). Klient bruker dette til å route popup
     * (WinPopup vs WinScreenV2). Manglet før i scheduled-Spill1-broadcast.
     */
    claimType: ClaimType;
    physicalWinners: PhysicalTicketWinInfo[];
  }> {
    // BIN-696: claimType utledes av fase-nummer — fase 5 (TOTAL_PHASES)
    // er Fullt Hus = "BINGO", øvrige er rad-vinn = "LINE". Klient bruker
    // dette til popup-routing (WinPopup vs WinScreenV2).
    const phaseClaimType: ClaimType = currentPhase === TOTAL_PHASES ? "BINGO" : "LINE";

    // PR 4b-modus: payoutService ikke wired opp → skip pattern-evaluering.
    if (!this.payoutService) {
      return {
        phaseWon: false,
        winnerCount: 0,
        winnerIds: [],
        winnerWalletIds: [],
        prizePerWinnerKr: 0,
        claimType: phaseClaimType,
        physicalWinners: [],
      };
    }

    // Les alle assignments etter markings-oppdatering.
    // Bruker samme client → samme transaksjon.
    //
    // PR-T1 KRITISK 4 (casino-grade research 2026-04-28): JOIN med purchases
    // for `purchased_at` + ORDER BY (purchased_at ASC, assignment.id ASC) så
    // vinner-rekkefølgen er fullstendig deterministisk.
    //
    // Tobias-krav: "100% sikkerhet at den bongen som først fullfører en rad
    // får gevinsten" — bonger med tidligere `purchased_at` rangerer høyere,
    // og ved like timestamps tie-breaker-er vi på assignment.id (UUID/TEXT,
    // lex-sort).
    //
    // Uten ORDER BY garanterer Postgres ingen rekkefølge → samme draw kan
    // gi ulik `firstWinnerId` ved retry, recovery eller ulike DB-noder.
    //
    // SELECT-projeksjonen er fullt-kvalifisert (a.<col>) fordi assignments
    // og purchases overlapper i `id`, `buyer_user_id` og `hall_id` — uten
    // alias ville Postgres kaste "column reference is ambiguous". Eksisterende
    // unit-test-mocks som matcher på `"SELECT id, grid_numbers_json, ..."`-
    // substring må oppdateres for å matche `"SELECT a.id, a.grid_numbers_json"`
    // (gjøres i samme PR).
    const { rows } = await client.query<{
      id: string;
      grid_numbers_json: unknown;
      markings_json: unknown;
      buyer_user_id: string;
      hall_id: string;
      ticket_color: string;
    }>(
      `SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id, a.hall_id, a.ticket_color
         FROM ${this.assignmentsTable()} a
         JOIN "${this.schema}"."app_game1_ticket_purchases" p ON p.id = a.purchase_id
        WHERE a.scheduled_game_id = $1
        ORDER BY p.purchased_at ASC, a.id ASC`,
      [scheduledGameId]
    );

    // PT4: samle fysisk-bong-vinnere uavhengig av om digitale vinnere finnes.
    // Selv om det ikke finnes digitale assignments for denne phase kan det
    // fortsatt være fysiske bonger solgt til dette spillet som vinner.
    const physicalWinners = await this.evaluatePhysicalTickets(
      client,
      scheduledGameId,
      currentPhase,
      ticketConfigJson,
      gameConfigJson
    );

    if (rows.length === 0) {
      // Ingen digitale assignments. Fysiske vinnere alene markerer ikke
      // `phaseWon=true` — fase-progresjon styres fortsatt av digitale
      // spillere + auto-draw-regler. Fysiske bonger er passiv pengeflyt.
      return {
        phaseWon: false,
        winnerCount: 0,
        winnerIds: [],
        winnerWalletIds: [],
        prizePerWinnerKr: 0,
        claimType: phaseClaimType,
        physicalWinners,
      };
    }

    // Find alle assignments som oppfyller current_phase.
    const winners: Array<Game1WinningAssignment & { userId: string }> = [];
    for (const row of rows) {
      const grid = parseGridArray(row.grid_numbers_json);
      const markings = parseMarkings(row.markings_json, grid.length);
      const eval_ = evaluatePhase(grid, markings, currentPhase);
      if (eval_.isWinner) {
        // Slå opp wallet-id for buyer via separat query (én rad).
        const walletId = await this.resolveWalletIdForUser(client, row.buyer_user_id);
        winners.push({
          assignmentId: row.id,
          walletId,
          userId: row.buyer_user_id,
          hallId: row.hall_id,
          ticketColor: row.ticket_color,
        });
      }
    }

    if (winners.length === 0) {
      return {
        phaseWon: false,
        winnerCount: 0,
        winnerIds: [],
        winnerWalletIds: [],
        prizePerWinnerKr: 0,
        claimType: phaseClaimType,
        physicalWinners,
      };
    }

    // PR 4d.4: dedupliser winnerIds (én spiller kan ha flere tickets som
    // vinner samtidig — broadcast én gang per user).
    const winnerIds = Array.from(new Set(winners.map((w) => w.userId)));
    // W1-hotfix (Tobias 2026-04-26): dedupliserte wallet-IDer til POST-commit
    // refresh av in-memory `Player.balance`. Samme dedupliserings-rasjonale
    // som winnerIds — én bruker kan ha flere bonger som vinner samme fase,
    // men trenger kun én balance-refresh per wallet.
    const winnerWalletIds = Array.from(new Set(winners.map((w) => w.walletId)));

    // Pot = sum av ikke-refunded purchases. Hent fra DB (felles for alle
    // farge-grupper og flat-path).
    const potCents = await this.computePotCents(client, scheduledGameId);

    // Scheduler-config-kobling: bygg per-farge-matrise hvis
    // game_config_json (snapshot av GameManagement.config.spill1) er satt.
    // Null → fallback til flat-path (dagens atferd, bakoverkompat).
    let variantConfig: GameVariantConfig | null = null;
    try {
      variantConfig = buildVariantConfigFromGameConfigJson(gameConfigJson);
    } catch (err) {
      // Regulatorisk fail-closed: mapper-feil → logg warning og fall tilbake
      // til flat-path. Vi ruller ikke tilbake draw-en pga konfig-feil.
      log.warn(
        { err, scheduledGameId, currentPhase },
        "[SCHEDULER_FIX] variantConfig-bygging feilet — faller tilbake til default-patterns"
      );
      variantConfig = null;
    }

    // Jackpot-config (shared between per-color and flat-path). Les fra
    // ticket_config_json (subGame.jackpotData ved spawn) eller fra
    // game_config_json hvis der finnes.
    const jackpotCfg =
      resolveJackpotConfig(ticketConfigJson) ??
      resolveJackpotConfigFromGameConfig(gameConfigJson);

    // Agent IJ2 — beregn ordinær premie for firstWinner-per-hall, slik at
    // pot-er med `capType='total'` kan trimme pot-payout etter legacy-
    // semantikken (ordinær + pot ≤ maxAmountCents). Må gjøres med samme
    // split-logikk som payout-stien. Variabelen populeres i begge gren-ene
    // under og sendes inn til pot-evaluator etterpå.
    let ordinaryWinCentsByHall: Map<string, number> | undefined;

    // BIN-696 / Tobias 2026-04-26: per-winner split-amount i ØRE for
    // pattern:won-broadcast. Settes i begge payout-grenene. For per-color-
    // path bruker vi første color-gruppes prizePerWinner som representativ
    // verdi (multi-color-bonger med ulik prize gir small UI-impresisjon
    // til neste room:update-snapshot ankommer; LeftInfoPanel "Gevinst"-
    // summen bruker uansett patternResults[].payoutAmount fra snapshot).
    let prizePerWinnerCentsForBroadcast = 0;

    if (variantConfig && variantConfig.patternsByColor) {
      // Pot-per-bongstørrelse-path (2026-05-08, §9 i SPILL_REGLER_OG_PAYOUT.md):
      // For hver fase deles ÉN pot per bongstørrelse mellom vinnerne av den
      // størrelsen. Hver pot skalerer med bong-multiplier (hvit×1, gul×2,
      // lilla×3 — small/large × 2 utover det). En spiller får summen av
      // sine bongers andeler innenfor sin størrelse.
      //
      // Trafikklys-overstyring (§5 + §9.4): når trafikklysRowColor er satt,
      // erstatter payoutPerColorGroups bongstørrelse-poten med en uniform
      // pot lest fra rules.{prizesPerRowColor, bingoPerRowColor}[rowColor].
      // Alle vinnere deler poten likt — flat 15 kr-bong, ingen vekting.
      await this.payoutPerColorGroups(
        client,
        scheduledGameId,
        currentPhase,
        drawSequenceAtWin,
        winners,
        potCents,
        variantConfig,
        jackpotCfg,
        ticketConfigJson,
        gameConfigJson,
        trafikklysRowColor,
      );

      // Trafikklys-overstyring (§5 + §9.4): når rad-farge er trukket,
      // er prizePerWinner = pot[rowColor] / antall_vinnere — alle vinnere
      // deler poten likt fordi alle bonger er flat 15 kr. Dette må evalueres
      // FØR Oddsen-pathen så vi ikke får dobbel-beregning.
      const trafikklysCfgForBroadcast =
        trafikklysRowColor !== null
          ? resolveTrafikklysVariantConfig(ticketConfigJson) ??
            resolveTrafikklysVariantConfig(gameConfigJson)
          : null;
      const trafikklysActive =
        trafikklysCfgForBroadcast !== null &&
        trafikklysRowColor !== null &&
        trafikklysCfgForBroadcast.rowColors.includes(trafikklysRowColor);

      if (trafikklysActive && trafikklysCfgForBroadcast && trafikklysRowColor) {
        const isFullHouse = currentPhase === TOTAL_PHASES;
        const trafikklysPot = isFullHouse
          ? trafikklysCfgForBroadcast.bingoPerRowColor[trafikklysRowColor]
          : trafikklysCfgForBroadcast.prizesPerRowColor[trafikklysRowColor];
        if (typeof trafikklysPot === "number" && trafikklysPot > 0) {
          prizePerWinnerCentsForBroadcast = Math.floor(
            trafikklysPot / winners.length,
          );
        }
      } else {
        // BIN-696: Beregn representativ prizePerWinner basert på første
        // vinners color-gruppe (matcher engine `firstPayoutAmount`-konvensjon
        // for snapshot-feltet `patternResult.payoutAmount`). Dette er kun
        // for pattern:won-broadcast — eksakte per-vinner-beløp er allerede
        // utbetalt korrekt av payoutPerColorGroups via payoutService.
        //
        // Pot-per-bongstørrelse-fix (2026-05-08): første vinners FAKTISKE
        // andel er pot[firstSize] / antall_vinnere_i_firstSize, ikke en
        // global-pot-andel. Vi bruker firstColor's pot direkte (som er
        // base × bongMultiplier via patternPrizeToCents) og deler på
        // firstColor-gruppe-størrelse.
        const firstWinnerColor = winners[0]?.ticketColor;
        if (firstWinnerColor) {
          const firstColorGroupSize = winners.filter((w) => w.ticketColor === firstWinnerColor).length;
          const firstColorEngineName = resolveEngineColorName(firstWinnerColor) ?? firstWinnerColor;
          const firstColorPatterns = resolvePatternsForColor(
            variantConfig,
            firstColorEngineName,
            () => {}
          );
          const firstColorPhasePattern = firstColorPatterns[currentPhase - 1];
          if (firstColorPhasePattern && firstColorGroupSize > 0) {
            let firstColorTotalPrizeCents = patternPrizeToCents(firstColorPhasePattern, potCents);

            // Oddsen Fullt Hus override (samme bucket-logikk som payoutPerColorGroups).
            if (currentPhase === TOTAL_PHASES) {
              const oddsenCfg =
                resolveOddsenVariantConfig(ticketConfigJson) ??
                resolveOddsenVariantConfig(gameConfigJson);
              if (oddsenCfg) {
                const bucket =
                  drawSequenceAtWin <= oddsenCfg.targetDraw ? "high" : "low";
                const baseForBucket =
                  bucket === "high" ? oddsenCfg.bingoBaseHigh : oddsenCfg.bingoBaseLow;
                const multiplier = bongMultiplierForColorSlug(firstWinnerColor);
                if (multiplier !== null) {
                  firstColorTotalPrizeCents = baseForBucket * multiplier;
                }
              }
            }

            prizePerWinnerCentsForBroadcast = Math.floor(firstColorTotalPrizeCents / firstColorGroupSize);
          }
        }
      }

      if (currentPhase === TOTAL_PHASES) {
        // Pot-per-bongstørrelse-fix (2026-05-08): for Oddsen Fullt Hus
        // overstyres pot-en med HIGH/LOW bucket × bongMultiplier. Resolved
        // én gang her og brukt i patternsForColor-callback.
        // Trafikklys-overstyring: hvis rad-farge er trukket, returner
        // uniform pot (rules.bingoPerRowColor[rowColor]) for ALLE bonger.
        const oddsenCfgForCap =
          resolveOddsenVariantConfig(ticketConfigJson) ??
          resolveOddsenVariantConfig(gameConfigJson);
        ordinaryWinCentsByHall = computeOrdinaryWinCentsByHallPerColor({
          winners,
          phase: currentPhase,
          drawSequenceAtWin,
          potCents,
          patternsForColor: (color) => {
            // Trafikklys Fullt Hus: rad-farge gir uniform pot på tvers av
            // bongfarger. Pot deles likt blant ALLE vinnere — vi returnerer
            // samme totalPhasePrizeCents per (color)-key, og caller-en
            // splitter etterpå basert på winnerCount.
            if (trafikklysActive && trafikklysCfgForBroadcast && trafikklysRowColor) {
              const pot = trafikklysCfgForBroadcast.bingoPerRowColor[trafikklysRowColor];
              if (typeof pot === "number" && pot > 0) {
                return { totalPhasePrizeCents: pot };
              }
            }
            // Oddsen Fullt Hus: HIGH/LOW × multiplier overstyrer pattern.
            if (oddsenCfgForCap) {
              const bucket =
                drawSequenceAtWin <= oddsenCfgForCap.targetDraw ? "high" : "low";
              const baseForBucket =
                bucket === "high"
                  ? oddsenCfgForCap.bingoBaseHigh
                  : oddsenCfgForCap.bingoBaseLow;
              const multiplier = bongMultiplierForColorSlug(color);
              if (multiplier !== null) {
                return { totalPhasePrizeCents: baseForBucket * multiplier };
              }
            }
            const engineName = resolveEngineColorName(color) ?? color;
            const patterns = resolvePatternsForColor(
              variantConfig!,
              engineName,
              () => {}
            );
            const pp = patterns[currentPhase - 1];
            if (!pp) return null;
            return {
              totalPhasePrizeCents: patternPrizeToCents(pp, potCents),
            };
          },
          jackpotForColor: (color) => {
            if (!this.jackpotService || !jackpotCfg) return 0;
            const j = this.jackpotService.evaluate({
              phase: currentPhase,
              drawSequenceAtWin,
              ticketColor: color,
              jackpotConfig: jackpotCfg,
            });
            return j.triggered ? j.amountCents : 0;
          },
        });
      }
    } else {
      // Flat-path (bakoverkompat): én global pott fordelt likt. Jackpot-
      // routing bruker hver vinners egen farge (Bug 2-fix).
      const resolved = resolvePhaseConfig(ticketConfigJson, currentPhase);
      const totalPhasePrizeCents =
        resolved.kind === "percent"
          ? Math.floor((potCents * resolved.percent) / 100)
          : resolved.amountCents;

      // BIN-696: Per-winner split-amount for pattern:won-broadcast.
      // Floor-split — rest beholdes av huset (samme semantikk som
      // payoutService.payoutPhase). Eksklusiv jackpot-bonus (klient-
      // popup viser den separat hvis triggered).
      prizePerWinnerCentsForBroadcast = Math.floor(totalPhasePrizeCents / winners.length);

      await this.payoutFlatPathWithPerWinnerJackpot(
        client,
        scheduledGameId,
        currentPhase,
        drawSequenceAtWin,
        winners,
        totalPhasePrizeCents,
        jackpotCfg
      );

      if (currentPhase === TOTAL_PHASES) {
        ordinaryWinCentsByHall = computeOrdinaryWinCentsByHallFlat({
          winners,
          totalPhasePrizeCents,
          jackpotForColor: (color) => {
            if (!this.jackpotService || !jackpotCfg) return 0;
            const j = this.jackpotService.evaluate({
              phase: currentPhase,
              drawSequenceAtWin,
              ticketColor: color,
              jackpotConfig: jackpotCfg,
            });
            return j.triggered ? j.amountCents : 0;
          },
        });
      }
    }

    // K1-C: Lucky Number Bonus. Utløses kun ved Fullt Hus hvor ballen som
    // traff winnet (`lastBall`) === spillerens registrerte lucky. Bonus
    // utbetales per kvalifisert vinner I TILLEGG til ordinær premie +
    // jackpot. Idempotent via `g1-lucky-bonus-{scheduledGameId}-{winnerId}`.
    //
    // Legacy-ref: GameProcess.js:420-429 (lucky-bonus-utløser) +
    // GameProcess.js:5960-6100 (processLuckyNumberBonus utbetalings-flyt).
    //
    // Fail-closed: service/lookup-port ikke satt → hopper over bonus.
    // Bonus-config NULL (ikke konfigurert i sub-game) → hopper over.
    if (
      currentPhase === TOTAL_PHASES &&
      winners.length > 0 &&
      this.luckyBonusService !== null
    ) {
      await this.payoutLuckyBonusForFullHouseWinners({
        client,
        scheduledGameId,
        winners,
        lastBall,
        drawSequenceAtWin,
        roomCode,
        ticketConfigJson,
      });
    }

    // PR-C2 Spor 4: evaluér akkumulerende pot-er (Innsatsen + Jackpott)
    // via konsolidert PotEvaluator. Kjøres kun når Fullt Hus er vunnet —
    // ingen av pot-typene utløses før phase 5. Implementasjon ekstrahert
    // til `Game1DrawEnginePotEvaluator.ts` (PR-S4). Fail-closed-semantikk
    // og multi-hall-iterasjon er uendret.
    //
    // Agent IJ2: `ordinaryWinCentsByHall` sendes inn for total-cap-
    // semantikk (Innsatsen legacy). Pot-er med capType='pot-balance'
    // påvirkes ikke av denne verdien.
    if (currentPhase === TOTAL_PHASES && this.potService && winners.length > 0) {
      await runAccumulatingPotEvaluation({
        client,
        potService: this.potService,
        walletAdapter: this.walletAdapter!,
        audit: this.audit,
        potDailyTickService: this.potDailyTickService,
        scheduledGameId,
        drawSequenceAtWin,
        winners,
        ordinaryWinCentsByHall,
        // K2-A CRIT-2 / CRIT-3: thread ports gjennom til pot-evaluator.
        complianceLedgerPort: this.complianceLedgerPort,
        prizePolicyPort: this.prizePolicyPort,
      });
    }

    // ADR-0017 (2026-05-10, Tobias-direktiv): per-spill jackpot-payout via
    // plan-run-overrides. Master setter draw + prizesCents per bongfarge i
    // JackpotSetupModal før Jackpot-spillet (pos 7) starter — verdiene lagres
    // i `app_game_plan_run.jackpot_overrides_json[currentPosition]`.
    //
    // Auto-utbetaling skjer kun når Fullt Hus vinnes på/innen `override.draw`.
    // Ingen daglig akkumulering — `app_game1_jackpot_state` er deprecated.
    if (
      currentPhase === TOTAL_PHASES &&
      winners.length > 0 &&
      this.walletAdapter !== null
    ) {
      await runDailyJackpotEvaluation({
        client,
        schema: this.schema,
        walletAdapter: this.walletAdapter,
        audit: this.audit,
        scheduledGameId,
        drawSequenceAtWin,
        winners: winners.map((w) => ({
          assignmentId: w.assignmentId,
          walletId: w.walletId,
          userId: w.userId,
          hallId: w.hallId,
          ticketColor: w.ticketColor,
        })),
      });
    }

    return {
      phaseWon: true,
      winnerCount: winners.length,
      winnerIds,
      winnerWalletIds,
      // BIN-696: per-winner split-amount i kr (uten jackpot-bonus).
      // Rounded down øre→kr (samme floor-konvensjon som payoutService).
      prizePerWinnerKr: Math.floor(prizePerWinnerCentsForBroadcast / 100),
      claimType: phaseClaimType,
      physicalWinners,
    };
  }

  /**
   * PT4: Delegate-wrapper mot `evaluatePhysicalTicketsForPhase` (helper-
   * modul i `Game1DrawEnginePhysicalTickets.ts`). Wrapperen gjør PT4-
   * service-sjekken og sender inn alle avhengigheter som narrow deps-port.
   *
   * Byte-identisk atferd: `physicalTicketPayoutService` null → returner
   * tom liste (bakoverkompat), ellers full PT4-evaluering.
   */
  private async evaluatePhysicalTickets(
    client: PoolClient,
    scheduledGameId: string,
    currentPhase: number,
    ticketConfigJson: unknown,
    gameConfigJson: unknown
  ): Promise<PhysicalTicketWinInfo[]> {
    // PT4-service ikke wired opp → skip (bakoverkompat).
    if (!this.physicalTicketPayoutService) {
      return [];
    }
    return evaluatePhysicalTicketsForPhase(
      {
        physicalTicketPayoutService: this.physicalTicketPayoutService,
        staticTicketsTable: this.staticTicketsTable(),
        computePotCents: (c, sid) => this.computePotCents(c, sid),
        loadDrawnBallsSet: (c, sid) => this.loadDrawnBallsSet(c, sid),
        fireAudit: (evt) => this.fireAudit(evt),
        buildVariantConfigFromGameConfigJson,
        resolvePhaseConfig,
        phaseToConfigKey,
        phaseDisplayName,
        resolveEngineColorName,
        patternPrizeToCents,
      },
      client,
      scheduledGameId,
      currentPhase,
      ticketConfigJson,
      gameConfigJson
    );
  }

  /**
   * PT4: Last alle trukne kuler for spillet som Set<number>. Tynn wrapper
   * mot helper-funksjonen i `Game1DrawEnginePhysicalTickets.ts` — beholdt
   * som service-metode fordi `evaluatePhysicalTickets` trenger den via
   * `deps.loadDrawnBallsSet`-callback (service har `drawsTable()`).
   */
  private async loadDrawnBallsSet(
    client: PoolClient,
    scheduledGameId: string
  ): Promise<Set<number>> {
    return loadDrawnBallsSetHelper(client, this.drawsTable(), scheduledGameId);
  }

  /**
   * Pot-per-bongstørrelse-payout (2026-05-08, §9 i SPILL_REGLER_OG_PAYOUT.md):
   *
   * For hver fase (Rad 1, ..., Fullt Hus) er det SEPARATE potter per
   * bongstørrelse. Hver pot deles likt mellom bongene som vant innenfor
   * samme bongstørrelse. En spiller får summen av sine bongers andeler.
   *
   * Algoritme (§9.7):
   * ```
   * for each bongstørrelse (slug = ticketColor, eks. small_yellow, large_purple):
   *   winning_tickets = winners with that ticketColor
   *   if empty: continue (ingen pot for denne størrelsen)
   *   pot_cents = patternPrizeToCents(patternForColor[phase])
   *              (allerede auto-multiplisert via bridge — base × bongMultiplier)
   *   floor-split blant winning_tickets via payoutService.payoutPhase
   *   rest tilfaller huset (HOUSE_RETAINED via splitRoundingAudit + complianceLedger)
   * ```
   *
   * **Oddsen Fullt Hus-overstyring (§9.5):**
   * Hvis `currentPhase === TOTAL_PHASES` OG `spill1.oddsen` er satt i
   * config, overstyrer vi Fullt Hus-poten basert på `drawSequenceAtWin <=
   * targetDraw` (HIGH-bucket) eller > (LOW-bucket). Pot for HIGH/LOW =
   * `bingoBaseHigh/Low × bongMultiplier`. Rad 1-4 i Oddsen følger
   * standard auto-mult (uendret).
   *
   * **Multi-jackpot-routing per farge:** bevares for Fullt Hus med
   * Game1JackpotService — innenfor hver bongstørrelse-gruppe kan det
   * fortsatt være jackpot-bonus per vinner (basert på vinnerens egen
   * farge). Vi henter jackpot per vinner og legger den til gruppens
   * `jackpotAmountCentsPerWinner` — siden alle bonger i samme gruppe har
   * samme `ticketColor` (slug), får alle samme jackpot-sats.
   *
   * **Verifisering mot §9.3 test-matrise:**
   * - 1 lilla solo: lilla-pot 300 / 1 = 300 ✅
   * - 2 hvit: hvit-pot 100 / 2 = 50 hver ✅
   * - 1 hvit + 1 lilla: hvit-pot 100 → hvit får 100; lilla-pot 300 →
   *   lilla får 300 ✅
   * - 1 spiller med 3 lilla: lilla-pot 300 / 3 = 100 per bong → spilleren
   *   får 100 + 100 + 100 = 300 ✅
   * - 7 lilla: lilla-pot 300 / 7 = floor 42 per bong, rest 6 → HOUSE_RETAINED
   */
  private async payoutPerColorGroups(
    client: PoolClient,
    scheduledGameId: string,
    currentPhase: number,
    drawSequenceAtWin: number,
    winners: Array<Game1WinningAssignment & { userId: string }>,
    potCents: number,
    variantConfig: GameVariantConfig,
    jackpotCfg: Game1JackpotConfig | null,
    ticketConfigJson: unknown,
    gameConfigJson: unknown,
    /**
     * Trafikklys runtime (2026-05-08, §5 + §9.4 i SPILL_REGLER_OG_PAYOUT.md):
     * server-trukket rad-farge fra scheduled-game-raden. Når satt OG
     * Trafikklys-config er aktiv, overstyrer vi pot-tabellen — alle
     * vinnere deler én uniform pot lest fra rules.{prizesPerRowColor,
     * bingoPerRowColor}[rowColor]. Ingen vekting per bongstørrelse fordi
     * alle bonger er flat 15 kr.
     */
    trafikklysRowColor: TrafikklysRowColor | null = null,
  ): Promise<void> {
    if (winners.length === 0) {
      return;
    }

    // Trafikklys-overstyring (§5 + §9.4): rad-farge bestemmer pot-en, ikke
    // bongfargen. Resolve config tidlig så vi kan velge mellom Trafikklys-
    // path og standard pot-per-bongstørrelse-path.
    const trafikklysCfg =
      trafikklysRowColor !== null
        ? resolveTrafikklysVariantConfig(ticketConfigJson) ??
          resolveTrafikklysVariantConfig(gameConfigJson)
        : null;

    if (trafikklysCfg && trafikklysRowColor !== null) {
      // Defensiv guard: rad-fargen må være kjent i config. Hvis admin
      // har endret rules.rowColors etter at runden startet, faller vi
      // tilbake til standard pot-per-bongstørrelse-pathen — sikrere enn
      // 0-payout. Audit-log fanger avviket.
      const rowColorIsKnown = trafikklysCfg.rowColors.includes(
        trafikklysRowColor,
      );
      if (rowColorIsKnown) {
        await this.payoutTrafikklys(client, {
          scheduledGameId,
          currentPhase,
          drawSequenceAtWin,
          winners,
          trafikklysCfg,
          trafikklysRowColor,
          jackpotCfg,
        });
        return;
      }
      log.warn(
        {
          scheduledGameId,
          trafikklysRowColor,
          knownColors: trafikklysCfg.rowColors,
        },
        "[TRAFIKKLYS] trukket rad-farge mangler i rules.rowColors — faller til standard pot-per-bongstørrelse",
      );
    }

    // Resolve oddsen-config (gjelder kun Fullt Hus-fase). Ledser fra
    // spill1.oddsen i ticket_config_json eller game_config_json.
    const oddsenCfg =
      currentPhase === TOTAL_PHASES
        ? resolveOddsenVariantConfig(ticketConfigJson) ??
          resolveOddsenVariantConfig(gameConfigJson)
        : null;

    // Grupper winners per ticketColor (= bongstørrelse-slug). En spiller
    // med 3 lilla-bonger havner i samme gruppe; en spiller med 1 hvit + 1
    // lilla havner i to grupper.
    const winnersByColor = new Map<
      string,
      Array<Game1WinningAssignment & { userId: string }>
    >();
    // Bevar farge-rekkefølge så ledger-events får deterministisk orden
    // (basert på første-vinner-rekkefølgen fra purchase_at-sortering i
    // evaluateAndPayoutPhase).
    const colorOrder: string[] = [];
    for (const w of winners) {
      let list = winnersByColor.get(w.ticketColor);
      if (!list) {
        list = [];
        winnersByColor.set(w.ticketColor, list);
        colorOrder.push(w.ticketColor);
      }
      list.push(w);
    }

    for (const color of colorOrder) {
      const groupWinners = winnersByColor.get(color)!;
      const engineName = resolveEngineColorName(color) ?? color;
      const colorPatterns = resolvePatternsForColor(
        variantConfig,
        engineName,
        (missingColor) => {
          log.warn(
            {
              scheduledGameId,
              color,
              engineName,
              missingColor,
            },
            "[POT_PER_BONGSIZE] farge mangler i patternsByColor → faller til __default__",
          );
        },
      );
      const phasePattern = colorPatterns[currentPhase - 1];

      // Pot-størrelse for denne bongstørrelsen.
      // - Standard: patternPrizeToCents(pattern, pot) — bridge har allerede
      //   skalert basen × bongMultiplier per (color, size) via auto-mult.
      // - Oddsen Fullt Hus: HIGH/LOW base × bongMultiplier. Bestemmes per
      //   gruppe basert på drawSequenceAtWin vs targetDraw.
      let potForBongSizeCents = phasePattern
        ? patternPrizeToCents(phasePattern, potCents)
        : 0;

      let oddsenBucket: "low" | "high" | undefined;
      if (oddsenCfg) {
        oddsenBucket =
          drawSequenceAtWin <= oddsenCfg.targetDraw ? "high" : "low";
        const baseForBucket =
          oddsenBucket === "high" ? oddsenCfg.bingoBaseHigh : oddsenCfg.bingoBaseLow;
        // Beregn bongMultiplier basert på pris fra første winning-bong i
        // gruppen. Alle bonger i samme `ticketColor`-gruppe (slug-form
        // small_yellow / large_purple / etc.) har samme størrelse OG
        // dermed samme pris, så vi kan utlede multiplier fra pattern-
        // prisen. Trygg fallback: bruk patternPrizeToCents.
        const multiplier = bongMultiplierForColorSlug(color);
        if (multiplier !== null) {
          potForBongSizeCents = baseForBucket * multiplier;
        } else if (phasePattern) {
          // Hvis vi ikke kan utlede multiplier (ukjent slug), behold
          // pattern-basert pot — sikrere enn 0-payout.
          potForBongSizeCents = patternPrizeToCents(phasePattern, potCents);
        }
      }

      // Multi-jackpot-routing per gruppe. Alle bonger i samme color-slug
      // har samme `ticketColor` → jackpotService gir samme amount for
      // hele gruppen. Vi tar første vinner som representativ.
      let jackpotAmountCentsPerWinner = 0;
      if (
        currentPhase === TOTAL_PHASES &&
        this.jackpotService &&
        jackpotCfg &&
        groupWinners.length > 0
      ) {
        const j = this.jackpotService.evaluate({
          phase: currentPhase,
          drawSequenceAtWin,
          ticketColor: groupWinners[0]!.ticketColor,
          jackpotConfig: jackpotCfg,
        });
        jackpotAmountCentsPerWinner = j.triggered ? j.amountCents : 0;
      }

      // §9.6 audit-felter for compliance-ledger.
      const uniquePlayerIds = new Set(groupWinners.map((w) => w.userId));
      const multiplier = bongMultiplierForColorSlug(color);
      const gameVariant: "standard" | "oddsen" =
        oddsenBucket !== undefined ? "oddsen" : "standard";

      await this.payoutService!.payoutPhase(client, {
        scheduledGameId,
        phase: currentPhase,
        drawSequenceAtWin,
        roomCode: "",
        totalPhasePrizeCents: potForBongSizeCents,
        winners: groupWinners,
        jackpotAmountCentsPerWinner,
        phaseName: phaseDisplayName(currentPhase),
        potMetadata: {
          bongMultiplier: multiplier ?? undefined,
          potCentsForBongSize: potForBongSizeCents,
          winningTicketsInSameSize: groupWinners.length,
          winningPlayersInSameSize: uniquePlayerIds.size,
          gameVariant,
          ...(oddsenBucket !== undefined && {
            oddsenBucket,
            oddsenTargetDraw: oddsenCfg!.targetDraw,
          }),
        },
      });
    }
  }

  /**
   * Trafikklys-payout (2026-05-08, §5 + §9.4 i SPILL_REGLER_OG_PAYOUT.md):
   *
   * Pot-størrelsen er definert av RAD-FARGEN (ikke bongfargen). Alle vinnere
   * deler poten LIKT — ingen vekting fordi alle bonger har samme pris (15 kr).
   *
   * Algoritme:
   * ```
   * if currentPhase < TOTAL_PHASES (Rad 1-4):
   *   pot_cents = rules.prizesPerRowColor[rowColor]
   * else (Fullt Hus):
   *   pot_cents = rules.bingoPerRowColor[rowColor]
   * floor-split blant ALLE vinnere via payoutService.payoutPhase
   * rest tilfaller huset (HOUSE_RETAINED via splitRoundingAudit)
   * ```
   *
   * Compliance-ledger får `gameVariant: "trafikklys"` + `trafikklysRowColor`
   * i potMetadata for full Lotteritilsynet-sporbarhet (§9.6).
   *
   * **Multi-bong-per-spiller:** §9.4 sier at hvis én spiller har flere
   * bonger som vinner samme rad/Fullt Hus, får hen én pot-andel × antall
   * vinner-bonger (eller én aggregert credit). Vi sender alle vinner-
   * bonger inn til payoutService.payoutPhase som genererer én credit per
   * bong med per-bong-andel. Wallet-summen blir total = (pot/N) × bong-
   * antall, som matcher §9.4 multi-bong-regelen.
   *
   * **Verifisering mot §A4 test-matrise:**
   * - Solo Rad rød (50 kr): potCents = 5000, 1 bong → 5000 ✅
   * - Solo Rad gul (150 kr): potCents = 15000, 1 bong → 15000 ✅
   * - 2 vinnere Rad grønn (100 kr): potCents = 10000, 2 bonger → 5000 hver ✅
   * - 3 vinnere Rad rød (50 kr): potCents = 5000, 3 bonger → 1666 hver, rest 2 ✅
   * - Solo Fullt Hus rød (500 kr): potCents = 50000, 1 bong → 50000 ✅
   * - 2 vinnere Fullt Hus grønn (1000 kr): potCents = 100000, 2 bonger → 50000 hver ✅
   */
  private async payoutTrafikklys(
    client: PoolClient,
    args: {
      scheduledGameId: string;
      currentPhase: number;
      drawSequenceAtWin: number;
      winners: Array<Game1WinningAssignment & { userId: string }>;
      trafikklysCfg: TrafikklysVariantConfig;
      trafikklysRowColor: TrafikklysRowColor;
      jackpotCfg: Game1JackpotConfig | null;
    },
  ): Promise<void> {
    const {
      scheduledGameId,
      currentPhase,
      drawSequenceAtWin,
      winners,
      trafikklysCfg,
      trafikklysRowColor,
      jackpotCfg,
    } = args;

    if (winners.length === 0) {
      return;
    }

    // §5.4: Rad 1-4 bruker prizesPerRowColor; Fullt Hus bruker bingoPerRowColor.
    const isFullHouse = currentPhase === TOTAL_PHASES;
    const potCents = isFullHouse
      ? trafikklysCfg.bingoPerRowColor[trafikklysRowColor]
      : trafikklysCfg.prizesPerRowColor[trafikklysRowColor];

    // Defensiv: hvis pot er 0 eller udefinert (config-bug), logg og skip.
    // Vi vil ikke utbetale ukjente beløp eller kaste — bedre å hoppe over
    // payout og la audit-log flagge avviket.
    if (typeof potCents !== "number" || potCents <= 0) {
      log.warn(
        {
          scheduledGameId,
          currentPhase,
          trafikklysRowColor,
          potCents,
        },
        "[TRAFIKKLYS] potCents er 0/udefinert — hopper over payout for fasen",
      );
      return;
    }

    // Multi-jackpot-routing for Fullt Hus. Trafikklys + Jackpot er ikke
    // en standard kombinasjon (Trafikklys er en variant, Jackpot er en
    // annen variant), men vi opprettholder eksisterende jackpot-path for
    // backward-compat: hvis admin tilfeldigvis har koblet jackpot til en
    // Trafikklys-rad, evalueres jackpot per vinner-farge som vanlig.
    let jackpotAmountCentsPerWinner = 0;
    if (
      isFullHouse &&
      this.jackpotService &&
      jackpotCfg &&
      winners.length > 0
    ) {
      // Bruk første vinners ticketColor som representativ. I praksis
      // er dette uvanlig fordi Trafikklys ikke er konfigurert med
      // prize-by-color-jackpot — verdien blir typisk 0.
      const j = this.jackpotService.evaluate({
        phase: currentPhase,
        drawSequenceAtWin,
        ticketColor: winners[0]!.ticketColor,
        jackpotConfig: jackpotCfg,
      });
      jackpotAmountCentsPerWinner = j.triggered ? j.amountCents : 0;
    }

    // §9.6 audit-felter for compliance-ledger.
    const uniquePlayerIds = new Set(winners.map((w) => w.userId));

    await this.payoutService!.payoutPhase(client, {
      scheduledGameId,
      phase: currentPhase,
      drawSequenceAtWin,
      roomCode: "",
      totalPhasePrizeCents: potCents,
      winners,
      jackpotAmountCentsPerWinner,
      phaseName: phaseDisplayName(currentPhase),
      potMetadata: {
        // bongMultiplier IKKE skrevet for Trafikklys — flat-prising,
        // ingen vekting per bongfarge.
        potCentsForBongSize: potCents,
        winningTicketsInSameSize: winners.length,
        winningPlayersInSameSize: uniquePlayerIds.size,
        gameVariant: "trafikklys",
        trafikklysRowColor,
      },
    });
  }

  /**
   * Flat-path-payout (bakoverkompat): alle vinnere deler én pott. Før
   * Bug 2-fix brukte koden `winners[0].ticketColor` for ALLE vinnere ved
   * jackpot-lookup. Nå itererer vi per vinner og gir hver sin egen
   * jackpot-sats basert på sin bong-farge.
   *
   * Multi-winner-split på hovedpremien er fortsatt likt fordelt (flat-
   * path-semantikk — Option X krever eksplisitt per-farge-config).
   */
  private async payoutFlatPathWithPerWinnerJackpot(
    client: PoolClient,
    scheduledGameId: string,
    currentPhase: number,
    drawSequenceAtWin: number,
    winners: Array<Game1WinningAssignment & { userId: string }>,
    totalPhasePrizeCents: number,
    jackpotCfg: Game1JackpotConfig | null
  ): Promise<void> {
    // Hvis ikke fase 5 eller ingen jackpot-config → én samlet payout (som
    // før). Ingen per-farge-behov.
    if (
      currentPhase !== TOTAL_PHASES ||
      !this.jackpotService ||
      !jackpotCfg
    ) {
      await this.payoutService!.payoutPhase(client, {
        scheduledGameId,
        phase: currentPhase,
        drawSequenceAtWin,
        roomCode: "",
        totalPhasePrizeCents,
        winners,
        jackpotAmountCentsPerWinner: 0,
        phaseName: phaseDisplayName(currentPhase),
      });
      return;
    }

    // Bug 2-fix: iterér vinnere per-farge for å gi hver riktig jackpot.
    // Hovedpremien (totalPhasePrizeCents) deles likt uansett farge (flat-
    // path-semantikk). Vi må derfor beregne split én gang og emitte én
    // payoutPhase per unik jackpot-sats slik at payoutService får riktig
    // beløp per vinner-gruppe.
    const byJackpotAmount = new Map<
      number,
      Array<Game1WinningAssignment & { userId: string }>
    >();
    for (const w of winners) {
      const j = this.jackpotService.evaluate({
        phase: currentPhase,
        drawSequenceAtWin,
        ticketColor: w.ticketColor,
        jackpotConfig: jackpotCfg,
      });
      const amount = j.triggered ? j.amountCents : 0;
      let list = byJackpotAmount.get(amount);
      if (!list) {
        list = [];
        byJackpotAmount.set(amount, list);
      }
      list.push(w);
    }

    // Hovedpremien deles globalt likt — vi fordeler totalPhasePrizeCents
    // proporsjonalt etter gruppestørrelse slik at split-rounding-
    // semantikken i payoutService holder seg konsistent. floor-split med
    // rest til hus via payoutService.
    const totalWinners = winners.length;
    const perWinnerPrizeFromFlatPot = Math.floor(
      totalPhasePrizeCents / totalWinners
    );

    for (const [jackpotAmount, groupWinners] of byJackpotAmount.entries()) {
      // For at split-semantikken skal stemme med klassisk flat-path, og
      // for at ingen kroner skal forsvinne, beregner vi group-local
      // totalPrize = perWinnerPrize × groupSize. Rest (fra original
      // floor-division) går til huset via den siste gruppens payoutPhase
      // via differansen mellom totalPhasePrizeCents og sum-of-floor.
      const groupSize = groupWinners.length;
      const groupTotalPrize = perWinnerPrizeFromFlatPot * groupSize;
      await this.payoutService!.payoutPhase(client, {
        scheduledGameId,
        phase: currentPhase,
        drawSequenceAtWin,
        roomCode: "",
        totalPhasePrizeCents: groupTotalPrize,
        winners: groupWinners,
        jackpotAmountCentsPerWinner: jackpotAmount,
        phaseName: phaseDisplayName(currentPhase),
      });
    }
  }

  /**
   * K1-C: Lucky Number Bonus for Fullt Hus-vinnere. Utbetales I TILLEGG til
   * ordinær premie + jackpot når (`lastBall === player.luckyNumber`).
   *
   * Legacy-referanse: GameProcess.js:420-429 (trigger-conditions) +
   * GameProcess.js:5960-6100 (utbetalings-flyt + per-player dedupe).
   *
   * Flyt:
   *   1) For hver unik (userId) blant vinnere, slå opp luckyNumber via
   *      `luckyNumberLookup`-porten mot room-state.
   *   2) Evaluér bonus via `Game1LuckyBonusService.evaluate` — respekterer
   *      enabled-flag + amountCents + phase + luckyNumber match.
   *   3) Hvis trigget → wallet.credit til vinnerens winnings-konto med
   *      idempotency-key `g1-lucky-bonus-{scheduledGameId}-{winnerId}`.
   *      Wallet-feil → throw DomainError → hele drawNext-transaksjonen
   *      ruller tilbake (regulatorisk §11 fail-closed).
   *   4) Audit-entry `game1.lucky_number_bonus_won` per utbetaling.
   *
   * Dedupe: en spiller kan vinne Fullt Hus på flere assignments samtidig,
   * men bonus skal kun utbetales ÉN gang per (scheduledGameId, winnerId)
   * (legacy gjør samme dedupe i processLuckyNumberBonus via
   * multiLuckyBonusWinningArray.reduce).
   */
  private async payoutLuckyBonusForFullHouseWinners(args: {
    client: PoolClient;
    scheduledGameId: string;
    winners: Array<Game1WinningAssignment & { userId: string }>;
    lastBall: number;
    drawSequenceAtWin: number;
    roomCode: string | null;
    ticketConfigJson: unknown;
  }): Promise<void> {
    const {
      client,
      scheduledGameId,
      winners,
      lastBall,
      drawSequenceAtWin,
      roomCode,
      ticketConfigJson,
    } = args;

    // Guard: service eller lookup-port ikke satt → feature av (bakoverkompat).
    // walletAdapter trengs for wallet.credit — hopp over ellers (samme
    // mønster som pot-evaluator-wiring).
    if (!this.luckyBonusService) return;
    if (!this.luckyNumberLookup) return;
    if (!this.walletAdapter) return;

    // Resolve bonus-config fra sub-game. Null → feature av for dette spillet.
    const bonusConfig: Game1LuckyBonusConfig | null = resolveLuckyBonusConfig(
      ticketConfigJson
    );
    if (!bonusConfig || !bonusConfig.enabled || bonusConfig.amountCents <= 0) {
      return;
    }

    // roomCode er NULL for spill ingen spiller har joinet — ingen lucky-
    // numbers kan da finnes. Kun fysiske bonger kan være vinnere, og de har
    // ikke lucky-number i dagens modell.
    if (!roomCode) return;

    // Dedupe: én bonus per unik userId per spill. Første vinner-assignment
    // tas som canonical (samme pattern som legacy multiLuckyBonusWinningArray).
    const seenUserIds = new Set<string>();
    const uniqueWinners: Array<Game1WinningAssignment & { userId: string }> = [];
    for (const w of winners) {
      if (seenUserIds.has(w.userId)) continue;
      seenUserIds.add(w.userId);
      uniqueWinners.push(w);
    }

    for (const winner of uniqueWinners) {
      const luckyNumber = this.luckyNumberLookup({
        roomCode,
        userId: winner.userId,
      });

      const ev = this.luckyBonusService.evaluate({
        winnerId: winner.userId,
        luckyNumber,
        fullHouseTriggerBall: lastBall,
        phase: TOTAL_PHASES,
        bonusConfig,
      });

      if (!ev.triggered) continue;

      // K2-A CRIT-3: håndhev single-prize-cap (2500 kr) på lucky bonus FØR
      // wallet-credit. Bonus-config kan være konfigurert > 2500 → cap.
      const requestedBonusCents = ev.bonusCents;
      const capResult = this.prizePolicyPort.applySinglePrizeCap({
        hallId: winner.hallId,
        amount: requestedBonusCents / 100,
      });
      const cappedBonusCents = Math.floor(capResult.cappedAmount * 100);
      const houseRetainedCents = requestedBonusCents - cappedBonusCents;
      if (capResult.wasCapped) {
        log.info(
          {
            scheduledGameId,
            winnerId: winner.userId,
            hallId: winner.hallId,
            requestedBonusCents,
            cappedBonusCents,
            houseRetainedCents,
            policyId: capResult.policyId,
          },
          "[K2-A CRIT-3] Lucky bonus single-prize-cap applied"
        );
      }

      if (cappedBonusCents <= 0) {
        // Cap'en trimmet til 0 — hopp over credit + ledger.
        continue;
      }

      // Wallet-credit. PR-W2: `to: "winnings"` — gevinst fra spill.
      // Wallet-feil ruller tilbake hele drawNext-transaksjonen
      // (regulatorisk §11 fail-closed).
      let walletTxId: string | null = null;
      try {
        const tx = await this.walletAdapter.credit(
          winner.walletId,
          cappedBonusCents / 100,
          `Spill 1 Lucky Number Bonus — spill ${scheduledGameId}`,
          {
            idempotencyKey: IdempotencyKeys.game1LuckyBonus({
              scheduledGameId,
              winnerId: winner.userId,
            }),
            to: "winnings",
          }
        );
        walletTxId = tx.id;
      } catch (err) {
        log.error(
          {
            err,
            scheduledGameId,
            winnerId: winner.userId,
            walletId: winner.walletId,
            bonusCents: cappedBonusCents,
          },
          "[K1-C] Lucky Number Bonus wallet.credit feilet — ruller tilbake draw-transaksjon"
        );
        if (err instanceof WalletError) {
          throw new DomainError(
            "PAYOUT_WALLET_CREDIT_FAILED",
            `Lucky bonus-credit feilet for vinner ${winner.userId}: ${err.message} (code=${err.code})`
          );
        }
        throw new DomainError(
          "PAYOUT_WALLET_CREDIT_FAILED",
          `Lucky bonus-credit feilet for vinner ${winner.userId}: ${(err as Error).message ?? "ukjent"}`
        );
      }

      // K2-A CRIT-2: skriv EXTRA_PRIZE-entry til ComplianceLedger §71 for
      // lucky bonus. Soft-fail (matcher Game1PayoutService-mønsteret) —
      // ledger-feil ruller IKKE tilbake credit. Idempotency-key på wallet-
      // credit hindrer dobbel-credit ved retry.
      try {
        await this.complianceLedgerPort.recordComplianceLedgerEvent({
          hallId: winner.hallId,
          // Spill 1 (hovedspill).
          gameType: ledgerGameTypeForSlug("bingo"),
          channel: "INTERNET",
          eventType: "EXTRA_PRIZE",
          amount: cappedBonusCents / 100,
          gameId: scheduledGameId,
          roomCode: roomCode || undefined,
          playerId: winner.userId,
          walletId: winner.walletId,
          policyVersion: capResult.policyId,
          metadata: {
            reason: "GAME1_LUCKY_NUMBER_BONUS",
            luckyNumber: luckyNumber ?? null,
            fullHouseBall: lastBall,
            requestedBonusCents,
            cappedBonusCents,
            houseRetainedCents,
            drawSequenceAtWin,
            ticketColor: winner.ticketColor,
          },
        });
      } catch (err) {
        log.warn(
          {
            err,
            scheduledGameId,
            winnerId: winner.userId,
            hallId: winner.hallId,
            cappedBonusCents,
          },
          "[K2-A CRIT-2] complianceLedger.recordComplianceLedgerEvent EXTRA_PRIZE feilet — lucky bonus credit fortsetter uansett"
        );
      }

      // Audit (fire-and-forget). Matcher PM-spec for task K1-C:
      // action `game1.lucky_number_bonus_won` med { luckyNumber,
      // fullHouseBall, bonusCents }.
      this.fireAudit({
        actorId: winner.userId,
        action: "game1.lucky_number_bonus_won",
        resourceId: scheduledGameId,
        details: {
          luckyNumber: luckyNumber ?? null,
          fullHouseBall: lastBall,
          bonusCents: cappedBonusCents,
          requestedBonusCents,
          houseRetainedCents,
          drawSequenceAtWin,
          walletTransactionId: walletTxId,
          hallId: winner.hallId,
          ticketColor: winner.ticketColor,
        },
      });

      log.info(
        {
          scheduledGameId,
          winnerId: winner.userId,
          luckyNumber,
          lastBall,
          bonusCents: cappedBonusCents,
          requestedBonusCents,
          walletTxId,
        },
        "[K1-C] Lucky Number Bonus paid"
      );
    }
  }

  /**
   * Slå opp wallet-id for bruker. For scheduled-games antas én wallet per
   * user → primary wallet_id i app_users.
   */
  private async resolveWalletIdForUser(
    client: PoolClient,
    userId: string
  ): Promise<string> {
    const { rows } = await client.query<{ wallet_id: string }>(
      `SELECT wallet_id FROM "${this.schema}"."app_users" WHERE id = $1`,
      [userId]
    );
    const walletId = rows[0]?.wallet_id;
    if (!walletId) {
      throw new DomainError(
        "WALLET_NOT_FOUND",
        `Wallet-id mangler for bruker ${userId}.`
      );
    }
    return walletId;
  }

  /**
   * Sum (non-refunded) purchases.total_amount_cents for scheduled_game.
   * Pot-kalkulasjon for prize% pattern.
   */
  private async computePotCents(
    client: PoolClient,
    scheduledGameId: string
  ): Promise<number> {
    const { rows } = await client.query<{ pot_cents: string | number | null }>(
      `SELECT COALESCE(SUM(total_amount_cents), 0) AS pot_cents
         FROM "${this.schema}"."app_game1_ticket_purchases"
        WHERE scheduled_game_id = $1
          AND refunded_at IS NULL`,
      [scheduledGameId]
    );
    const raw = rows[0]?.pot_cents ?? 0;
    return typeof raw === "number" ? raw : Number.parseInt(String(raw), 10) || 0;
  }

  /**
   * For en gitt ball, last alle assignments som har ball i grid_numbers_json
   * og oppdater markings_json.marked[idx]=true. Bruker jsonb_set for presise
   * atomiske oppdateringer.
   *
   * Implementasjon: Les (id, grid_numbers_json, markings_json) for alle
   * assignments, kalkuler ny markings JS-side, skriv tilbake. Denne
   * tilnærmingen er enkel å teste og holder oss unna kompleks SQL (jsonb
   * path-indexing for store arrays).
   */
  private async markBallOnAssignments(
    client: PoolClient,
    scheduledGameId: string,
    ball: number
  ): Promise<void> {
    const { rows } = await client.query<{
      id: string;
      grid_numbers_json: unknown;
      markings_json: unknown;
    }>(
      `SELECT id, grid_numbers_json, markings_json
         FROM ${this.assignmentsTable()}
         WHERE scheduled_game_id = $1
         FOR UPDATE`,
      [scheduledGameId]
    );
    for (const row of rows) {
      const grid = parseGridArray(row.grid_numbers_json);
      const markings = parseMarkings(row.markings_json, grid.length);
      let changed = false;
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] === ball && !markings[i]) {
          markings[i] = true;
          changed = true;
        }
      }
      if (changed) {
        await client.query(
          `UPDATE ${this.assignmentsTable()}
              SET markings_json = $2::jsonb
            WHERE id = $1`,
          [row.id, JSON.stringify({ marked: markings })]
        );
      }
    }
  }

  private resolveMaxDraws(rawTicketConfig: unknown): number {
    let parsed: unknown = rawTicketConfig;
    if (typeof rawTicketConfig === "string") {
      try {
        parsed = JSON.parse(rawTicketConfig);
      } catch {
        return this.config.defaultMaxDraws;
      }
    }
    if (!parsed || typeof parsed !== "object") {
      return this.config.defaultMaxDraws;
    }
    const maxDraws = (parsed as { maxDraws?: unknown }).maxDraws;
    if (typeof maxDraws === "number" && Number.isInteger(maxDraws) && maxDraws > 0) {
      return maxDraws;
    }
    if (typeof maxDraws === "string") {
      const n = Number.parseInt(maxDraws, 10);
      if (Number.isInteger(n) && n > 0) return n;
    }
    return this.config.defaultMaxDraws;
  }

  private buildStateView(
    state: GameStateRow,
    gameStatus: string,
    draws: Game1DrawRecord[],
    /**
     * Trafikklys runtime (2026-05-08): server-trukket rad-farge for
     * Trafikklys-spill. NULL for ikke-Trafikklys-spill og legacy-rader.
     * Sendes inn fra calleren som henter `scheduled_games`-raden.
     */
    trafikklysRowColor: string | null = null,
  ): Game1GameStateView {
    const isFinished =
      gameStatus === "completed" ||
      gameStatus === "cancelled" ||
      state.engine_ended_at !== null;
    // Validér rad-farge mot whitelist før eksponering — defensivt mot
    // korrupt DB-data. Ukjent verdi → null (klient ser ingen banner).
    const validatedRowColor =
      trafikklysRowColor !== null && isTrafikklysRowColor(trafikklysRowColor)
        ? trafikklysRowColor
        : null;
    return {
      scheduledGameId: state.scheduled_game_id,
      currentPhase: Number(state.current_phase),
      drawsCompleted: Number(state.draws_completed),
      lastDrawnBall:
        state.last_drawn_ball === null ? null : Number(state.last_drawn_ball),
      lastDrawnAt:
        state.last_drawn_at === null
          ? null
          : state.last_drawn_at instanceof Date
          ? state.last_drawn_at
          : new Date(state.last_drawn_at),
      isFinished,
      isPaused: Boolean(state.paused),
      // Task 1.1: paused_at_phase kan være null (hvile / manuell pause) eller
      // tall (auto-paused etter phase-won). Master-UI bruker feltet for å
      // vise banner-tekst uten å sammenligne draws_completed.
      pausedAtPhase:
        state.paused_at_phase === null || state.paused_at_phase === undefined
          ? null
          : Number(state.paused_at_phase),
      drawnBalls: draws.map((d) => d.ball),
      trafikklysRowColor: validatedRowColor,
    };
  }

  private fireAudit(event: {
    actorId: string | null;
    action: string;
    resourceId: string;
    details: Record<string, unknown>;
  }): void {
    this.audit
      .record({
        actorId: event.actorId,
        actorType: event.actorId === null ? "SYSTEM" : "ADMIN",
        action: event.action,
        resource: "game1_scheduled_game",
        resourceId: event.resourceId,
        details: event.details,
      })
      .catch((err) => {
        log.warn(
          { err, action: event.action, resourceId: event.resourceId },
          "[GAME1_SCHEDULE PR4b] audit append failed"
        );
      });
  }
}

// Pure helpers + type-definisjoner er flyttet til `./Game1DrawEngineHelpers.ts`
// i refactor/s4b-draw-engine-helpers. Importeres øverst i fila.
//
// PT4-helpers er flyttet til `./Game1DrawEnginePhysicalTickets.ts` i
// refactor/s4-draw-engine-split. `PhysicalTicketWinInfo` re-eksporteres
// fra toppen av filen slik at eksisterende importer (tester, broadcast-
// kall) forblir uendret.
