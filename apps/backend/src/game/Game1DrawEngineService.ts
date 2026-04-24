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
import { DomainError } from "./BingoEngine.js";
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
} from "./Game1DrawEngineBroadcast.js";
import { resolvePatternsForColor } from "./spill1VariantMapper.js";
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
} from "./Game1DrawEngineHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-draw-engine-service" });

// ── Public types ─────────────────────────────────────────────────────────────

export interface Game1DrawEngineConfig {
  /**
   * Maks antall kuler trukket før game ender automatisk. Legacy standard for
   * Game 1: 52. Overridable per scheduled_game via ticket_config_json.maxDraws.
   */
  defaultMaxDraws: number;
}

export const DEFAULT_GAME1_MAX_DRAWS = 52;

export interface Game1GameStateView {
  scheduledGameId: string;
  currentPhase: number; // 1..5 (1 i PR 4b — utsatt til PR 4c)
  drawsCompleted: number;
  lastDrawnBall: number | null;
  lastDrawnAt: Date | null;
  isFinished: boolean; // scheduled_game.status='completed'
  isPaused: boolean;
  drawnBalls: number[]; // I trekk-rekkefølge (tom hvis ingen draws ennå)
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
   */
  private notifyPlayerPatternWon(
    roomCode: string,
    scheduledGameId: string,
    patternName: string,
    phase: number,
    winnerIds: string[],
    drawIndex0Based: number
  ): void {
    emitPlayerPatternWon(
      this.playerBroadcaster,
      roomCode,
      scheduledGameId,
      patternName,
      phase,
      winnerIds,
      drawIndex0Based
    );
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
        return this.buildStateView(existing, game.status, draws);
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
      if (game.status !== "running") {
        await client.query(
          `UPDATE ${this.scheduledGamesTable()}
              SET status              = 'running',
                  actual_start_time   = COALESCE(actual_start_time, now()),
                  started_by_user_id  = COALESCE(started_by_user_id, $2),
                  updated_at          = now()
            WHERE id = $1`,
          [scheduledGameId, actorUserId]
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
        },
      });

      log.info(
        {
          scheduledGameId,
          maxBallValue: bagConfig.maxBallValue,
          assignmentsCreated,
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
      return this.buildStateView(state, "running", []);
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
        game.room_code
      );

      // PR 4d.4: capture for post-commit admin-broadcast.
      if (phaseResult.phaseWon && phaseResult.winnerIds.length > 0) {
        capturedPhaseResult = {
          phaseWon: true,
          winnerIds: phaseResult.winnerIds,
          patternName: phaseDisplayName(state.current_phase),
          phase: state.current_phase,
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

      await client.query(
        `UPDATE ${this.gameStateTable()}
            SET draws_completed   = $2,
                last_drawn_ball   = $3,
                last_drawn_at     = now(),
                current_phase     = $4,
                engine_ended_at   = CASE WHEN $5::boolean THEN now() ELSE engine_ended_at END
          WHERE scheduled_game_id = $1`,
        [scheduledGameId, nextSequence, ball, newPhase, isFinished]
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
      return this.buildStateView(updatedState, updatedStatus, draws);
    }).then((view) => {
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
          this.notifyPlayerPatternWon(
            capturedRoomCode,
            scheduledGameId,
            capturedPhaseResult.patternName,
            capturedPhaseResult.phase,
            capturedPhaseResult.winnerIds,
            drawIndex0Based
          );
        }
        // room:update push avslutter sekvensen — spilleren får oppdatert
        // player-liste / lucky-numbers / stakes samtidig med ball.
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
    const { rows: gameRows } = await this.pool.query<{ status: string }>(
      `SELECT status FROM ${this.scheduledGamesTable()} WHERE id = $1`,
      [scheduledGameId]
    );
    const status = gameRows[0]?.status ?? "unknown";
    const draws = await this.listDraws(scheduledGameId);
    return this.buildStateView(state, status, draws);
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
    const { rows } = await client.query<ScheduledGameRow>(
      `SELECT id, status, ticket_config_json, room_code, game_config_json
         FROM ${this.scheduledGamesTable()}
         WHERE id = $1
         FOR UPDATE`,
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
    return this.runInTransaction(async (client) => {
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
        return row.room_code;
      }
      await client.query(
        `UPDATE ${this.scheduledGamesTable()}
            SET room_code  = $2,
                updated_at = now()
          WHERE id = $1 AND room_code IS NULL`,
        [scheduledGameId, roomCode]
      );
      return roomCode;
    });
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
    roomCode: string | null
  ): Promise<{
    phaseWon: boolean;
    winnerCount: number;
    winnerIds: string[];
    physicalWinners: PhysicalTicketWinInfo[];
  }> {
    // PR 4b-modus: payoutService ikke wired opp → skip pattern-evaluering.
    if (!this.payoutService) {
      return {
        phaseWon: false,
        winnerCount: 0,
        winnerIds: [],
        physicalWinners: [],
      };
    }

    // Les alle assignments etter markings-oppdatering.
    // Bruker samme client → samme transaksjon.
    const { rows } = await client.query<{
      id: string;
      grid_numbers_json: unknown;
      markings_json: unknown;
      buyer_user_id: string;
      hall_id: string;
      ticket_color: string;
    }>(
      `SELECT id, grid_numbers_json, markings_json, buyer_user_id, hall_id, ticket_color
         FROM ${this.assignmentsTable()}
        WHERE scheduled_game_id = $1`,
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
        physicalWinners,
      };
    }

    // PR 4d.4: dedupliser winnerIds (én spiller kan ha flere tickets som
    // vinner samtidig — broadcast én gang per user).
    const winnerIds = Array.from(new Set(winners.map((w) => w.userId)));

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

    if (variantConfig && variantConfig.patternsByColor) {
      // Per-farge-path: gruppér vinnere per ticketColor og utbetal hver
      // gruppe uavhengig. Dette er Option X (PM-vedtak 2026-04-21).
      await this.payoutPerColorGroups(
        client,
        scheduledGameId,
        currentPhase,
        drawSequenceAtWin,
        winners,
        potCents,
        variantConfig,
        jackpotCfg
      );

      if (currentPhase === TOTAL_PHASES) {
        ordinaryWinCentsByHall = computeOrdinaryWinCentsByHallPerColor({
          winners,
          phase: currentPhase,
          drawSequenceAtWin,
          potCents,
          patternsForColor: (color) => {
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
      });
    }

    return {
      phaseWon: true,
      winnerCount: winners.length,
      winnerIds,
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
   * Per-farge-payout: grupperer vinnere per ticketColor og utbetaler hver
   * farge-gruppe uavhengig (PM Option X). Hver gruppe har egen pott-andel
   * og multi-winner-split skjer innen gruppen.
   *
   * Bug 2-fix: jackpot-routing slås opp per gruppens farge (hver gruppe
   * har én unik farge → én korrekt jackpot-sats).
   */
  private async payoutPerColorGroups(
    client: PoolClient,
    scheduledGameId: string,
    currentPhase: number,
    drawSequenceAtWin: number,
    winners: Array<Game1WinningAssignment & { userId: string }>,
    potCents: number,
    variantConfig: GameVariantConfig,
    jackpotCfg: Game1JackpotConfig | null
  ): Promise<void> {
    // Gruppe-key = ticketColor.
    const groups = new Map<string, Array<Game1WinningAssignment & { userId: string }>>();
    for (const w of winners) {
      const key = w.ticketColor;
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(w);
    }

    for (const [color, groupWinners] of groups.entries()) {
      // Resolve pattern-matrise for fargen (fallback til __default__).
      const colorEngineName = resolveEngineColorName(color) ?? color;
      const patterns = resolvePatternsForColor(
        variantConfig,
        colorEngineName,
        (missingColor) => {
          log.warn(
            { scheduledGameId, color, engineName: colorEngineName, missingColor },
            "[SCHEDULER_FIX] farge har ikke eksplisitt per-farge-matrise → faller til __default__"
          );
        }
      );
      const phasePattern = patterns[currentPhase - 1];
      const totalPhasePrizeCents = phasePattern
        ? patternPrizeToCents(phasePattern, potCents)
        : 0;

      // Jackpot per-farge: evaluér mot gruppens farge (korrekt routing).
      let jackpotAmountCentsPerWinner = 0;
      if (currentPhase === TOTAL_PHASES && this.jackpotService && jackpotCfg) {
        const j = this.jackpotService.evaluate({
          phase: currentPhase,
          drawSequenceAtWin,
          ticketColor: color,
          jackpotConfig: jackpotCfg,
        });
        if (j.triggered) {
          jackpotAmountCentsPerWinner = j.amountCents;
        }
      }

      await this.payoutService!.payoutPhase(client, {
        scheduledGameId,
        phase: currentPhase,
        drawSequenceAtWin,
        roomCode: "",
        totalPhasePrizeCents,
        winners: groupWinners,
        jackpotAmountCentsPerWinner,
        phaseName: phaseDisplayName(currentPhase),
      });
    }
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

      // Wallet-credit. PR-W2: `to: "winnings"` — gevinst fra spill.
      // Wallet-feil ruller tilbake hele drawNext-transaksjonen
      // (regulatorisk §11 fail-closed).
      let walletTxId: string | null = null;
      try {
        const tx = await this.walletAdapter.credit(
          winner.walletId,
          ev.bonusCents / 100,
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
            bonusCents: ev.bonusCents,
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
          bonusCents: ev.bonusCents,
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
          bonusCents: ev.bonusCents,
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
    draws: Game1DrawRecord[]
  ): Game1GameStateView {
    const isFinished =
      gameStatus === "completed" ||
      gameStatus === "cancelled" ||
      state.engine_ended_at !== null;
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
      drawnBalls: draws.map((d) => d.ball),
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
