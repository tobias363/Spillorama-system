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
import {
  resolveDrawBagConfig,
  buildDrawBag,
  DRAW_BAG_DEFAULT_STANDARD,
} from "./DrawBagStrategy.js";
import type { Game1TicketPurchaseService, Game1TicketPurchaseRow } from "./Game1TicketPurchaseService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { Game1PayoutService, Game1WinningAssignment } from "./Game1PayoutService.js";
import type { Game1JackpotService, Game1JackpotConfig } from "./Game1JackpotService.js";
import { evaluatePhase, TOTAL_PHASES } from "./Game1PatternEvaluator.js";
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
      const phaseResult = await this.evaluateAndPayoutPhase(
        client,
        scheduledGameId,
        state.current_phase,
        nextSequence,
        game.ticket_config_json
      );

      // UPDATE state: draws_completed + phase + eventuelt engine_ended_at.
      const bingoWon = phaseResult.phaseWon && state.current_phase === TOTAL_PHASES;
      const maxDrawsReached = nextSequence >= maxDraws;
      const isFinished = bingoWon || maxDrawsReached;
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
    });
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
      `SELECT id, status, ticket_config_json, room_code
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
   */
  private async evaluateAndPayoutPhase(
    client: PoolClient,
    scheduledGameId: string,
    currentPhase: number,
    drawSequenceAtWin: number,
    ticketConfigJson: unknown
  ): Promise<{ phaseWon: boolean; winnerCount: number }> {
    // PR 4b-modus: payoutService ikke wired opp → skip pattern-evaluering.
    if (!this.payoutService) {
      return { phaseWon: false, winnerCount: 0 };
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

    if (rows.length === 0) {
      return { phaseWon: false, winnerCount: 0 };
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
      return { phaseWon: false, winnerCount: 0 };
    }

    // Resolve totalPhasePrizeCents og jackpot fra ticket_config.
    const resolved = resolvePhaseConfig(ticketConfigJson, currentPhase);

    // Pot = sum av ikke-refunded purchases. Hent fra DB.
    const potCents = await this.computePotCents(client, scheduledGameId);
    const totalPhasePrizeCents =
      resolved.kind === "percent"
        ? Math.floor(potCents * resolved.percent / 100)
        : resolved.amountCents;

    // Jackpot (kun fase 5): velg første vinner's farge for lookup.
    let jackpotAmountCentsPerWinner = 0;
    if (currentPhase === TOTAL_PHASES && this.jackpotService) {
      const firstWinner = winners[0]!;
      const jackpotCfg = resolveJackpotConfig(ticketConfigJson);
      if (jackpotCfg) {
        const j = this.jackpotService.evaluate({
          phase: currentPhase,
          drawSequenceAtWin,
          ticketColor: firstWinner.ticketColor,
          jackpotConfig: jackpotCfg,
        });
        if (j.triggered) {
          jackpotAmountCentsPerWinner = j.amountCents;
        }
      }
    }

    // Kall payoutService. En feil her propagerer ut og rollbacker drawNext.
    await this.payoutService.payoutPhase(client, {
      scheduledGameId,
      phase: currentPhase,
      drawSequenceAtWin,
      roomCode: "",
      totalPhasePrizeCents,
      winners,
      jackpotAmountCentsPerWinner,
      phaseName: phaseDisplayName(currentPhase),
    });

    return { phaseWon: true, winnerCount: winners.length };
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

// ── Pure helpers ────────────────────────────────────────────────────────────

function parseDrawBag(raw: unknown): number[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is number => typeof x === "number" && Number.isInteger(x));
}

function parseGridArray(raw: unknown): Array<number | null> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((v) => {
    if (v === null) return null;
    if (typeof v === "number" && Number.isInteger(v)) return v;
    return null;
  });
}

// ── Phase + config helpers (PR 4c) ──────────────────────────────────────────

/**
 * Map fase-nummer til admin-form-pattern-key.
 *   1 → "row_1", 2 → "row_2", 3 → "row_3", 4 → "row_4", 5 → "full_house".
 */
function phaseToConfigKey(phase: number): string {
  if (phase === 5) return "full_house";
  return `row_${phase}`;
}

/** Norsk fase-navn for audit og logging. */
function phaseDisplayName(phase: number): string {
  switch (phase) {
    case 1:
      return "1 Rad";
    case 2:
      return "2 Rader";
    case 3:
      return "3 Rader";
    case 4:
      return "4 Rader";
    case 5:
      return "Fullt Hus";
    default:
      return `Fase ${phase}`;
  }
}

type ResolvedPhaseConfig =
  | { kind: "percent"; percent: number }
  | { kind: "fixed"; amountCents: number };

/**
 * Resolve phase-config fra ticket_config_json.
 *
 * Admin-form-shape (Spill1Config.ts): ticket_config.spill1.ticketColors[0]
 * .prizePerPattern[row_1..full_house] er prosent av pot.
 *
 * For PR 4c: bruk FØRSTE ticketColor's prizePerPattern[phase_key] som
 * prosent. I praksis skal alle farger ha samme prosent-fordeling. Hvis
 * ikke finnes eller er 0 → returnerer percent=0 (ingen utbetaling for
 * fasen, men fasen regnes fortsatt som "vunnet" slik at neste fase kan
 * starte).
 */
function resolvePhaseConfig(
  rawTicketConfig: unknown,
  phase: number
): ResolvedPhaseConfig {
  let parsed: unknown = rawTicketConfig;
  if (typeof rawTicketConfig === "string") {
    try {
      parsed = JSON.parse(rawTicketConfig);
    } catch {
      return { kind: "percent", percent: 0 };
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { kind: "percent", percent: 0 };
  }
  const obj = parsed as Record<string, unknown>;
  const spill1 = obj.spill1 as Record<string, unknown> | undefined;
  const ticketColors = Array.isArray(spill1?.ticketColors)
    ? (spill1!.ticketColors as Array<Record<string, unknown>>)
    : Array.isArray(obj.ticketColors)
    ? (obj.ticketColors as Array<Record<string, unknown>>)
    : null;
  if (!ticketColors || ticketColors.length === 0) {
    return { kind: "percent", percent: 0 };
  }
  const key = phaseToConfigKey(phase);
  const first = ticketColors[0]!;
  const ppp = first.prizePerPattern as Record<string, unknown> | undefined;
  if (ppp) {
    const raw = ppp[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      return { kind: "percent", percent: raw };
    }
    if (typeof raw === "string") {
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n) && n >= 0) {
        return { kind: "percent", percent: n };
      }
    }
  }
  return { kind: "percent", percent: 0 };
}

/**
 * Resolve jackpot-config fra ticket_config_json. Returnerer null hvis
 * jackpot ikke er konfigurert.
 *
 * #316: prizeByColor er Record<string, number> med eksakte ticket-farger
 * (f.eks. "small_yellow") eller farge-familier ("yellow", "elvis"). Alle
 * verdier konverteres til numbers; ikke-numeriske filtreres bort.
 */
function resolveJackpotConfig(
  rawTicketConfig: unknown
): Game1JackpotConfig | null {
  let parsed: unknown = rawTicketConfig;
  if (typeof rawTicketConfig === "string") {
    try {
      parsed = JSON.parse(rawTicketConfig);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const spill1 = obj.spill1 as Record<string, unknown> | undefined;
  const jp =
    (spill1?.jackpot as Record<string, unknown> | undefined) ??
    (obj.jackpot as Record<string, unknown> | undefined);
  if (!jp || typeof jp !== "object") return null;
  const pbcRaw = jp.prizeByColor as Record<string, unknown> | undefined;
  if (!pbcRaw || typeof pbcRaw !== "object") return null;
  const draw = typeof jp.draw === "number" ? jp.draw : Number.parseInt(String(jp.draw), 10);
  if (!Number.isFinite(draw) || draw <= 0) return null;
  const prizeByColor: Record<string, number> = {};
  for (const [key, val] of Object.entries(pbcRaw)) {
    const n = numberOrZero(val);
    if (n > 0) prizeByColor[key.toLowerCase()] = n;
  }
  return { prizeByColor, draw };
}

function numberOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parseMarkings(raw: unknown, expectedLength: number): boolean[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Array(expectedLength).fill(false);
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return Array(expectedLength).fill(false);
  }
  const marked = (parsed as { marked?: unknown }).marked;
  if (!Array.isArray(marked)) {
    return Array(expectedLength).fill(false);
  }
  const out = Array(expectedLength).fill(false);
  for (let i = 0; i < expectedLength; i++) {
    out[i] = Boolean(marked[i]);
  }
  return out;
}
