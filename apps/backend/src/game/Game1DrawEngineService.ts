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
}

// ── Internal row shapes ─────────────────────────────────────────────────────

interface ScheduledGameRow {
  id: string;
  status: string;
  ticket_config_json: unknown;
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
 * Generate grid-tall for en ticket i scheduled_game-formatet.
 *
 * Dette er IKKE legacy BingoEngine-formatet (5x5 75-ball) — for
 * scheduled-games (Alt 3) bruker vi det norske 3x3/3x9-formatet:
 *
 *   - small (3x3): 9 unike tall fra 1..maxBallValue, random.
 *   - large (3x9): 27 celler, British-style column-ranges.
 *     col 0 = 1..9, col 1 = 10..19, col 2 = 20..29, …, col 8 = 80..90.
 *     Cap'et til maxBallValue — kolonner som overstiger får null i alle celler.
 *     3 rader, per kolonne plukker vi 3 unike tall fra kolonnens range (eller
 *     alle i range hvis range < 3).
 *
 * Returnerer en flat row-major array (small=9, large=27). null for tomme
 * celler.
 */
export function generateGridForTicket(
  size: "small" | "large",
  maxBallValue: number
): Array<number | null> {
  if (size === "small") {
    return generateSmallGrid(maxBallValue);
  }
  return generateLargeGrid(maxBallValue);
}

function generateSmallGrid(maxBallValue: number): Array<number | null> {
  const nums = pickUniqueInRange(1, maxBallValue, 9);
  // Flat row-major 3x3.
  return nums as Array<number | null>;
}

/**
 * Large-grid: 3x9 = 27 celler, row-major.
 *   Row 0: col 0..8 → col 0 = col-range[0], col 1 = col-range[1], etc.
 *
 * Col-range: col c = [c*10+1 .. (c+1)*10] cap'et til maxBallValue.
 *   col 0: 1..10 (men vi skiller første kolonne på 1..9 per British-style,
 *   se under).
 *
 * British-style bingo: col 0 = 1..9, col 1 = 10..19, …, col 8 = 80..90 (90
 * i siste kolonne). Vi følger denne semantikken.
 *
 * Hvis kolonnens range overstiger maxBallValue, blir den kolonnen null
 * i alle tre rader.
 */
function generateLargeGrid(maxBallValue: number): Array<number | null> {
  const numCols = 9;
  const numRows = 3;
  // Per-kolonne 3 unike tall (eller færre hvis range < 3).
  const perCol: Array<number | null>[] = [];
  for (let c = 0; c < numCols; c++) {
    const { start, end } = largeColumnRange(c);
    // Cap til maxBallValue.
    const clippedEnd = Math.min(end, maxBallValue);
    if (clippedEnd < start) {
      perCol.push([null, null, null]);
      continue;
    }
    const rangeSize = clippedEnd - start + 1;
    const pickCount = Math.min(numRows, rangeSize);
    const picks = pickUniqueInRange(start, clippedEnd, pickCount).sort(
      (a, b) => a - b
    );
    // Pad med null hvis range < 3.
    while (picks.length < numRows) picks.push(null as unknown as number);
    perCol.push(picks as Array<number | null>);
  }
  // Flat row-major: row 0 på alle kolonner, så row 1, så row 2.
  const flat: Array<number | null> = [];
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      flat.push(perCol[c]![r] ?? null);
    }
  }
  return flat;
}

/** British-style large-bingo column-range: col 0 = 1..9, col N = N*10..N*10+9, col 8 = 80..90. */
function largeColumnRange(col: number): { start: number; end: number } {
  if (col === 0) return { start: 1, end: 9 };
  if (col === 8) return { start: 80, end: 90 };
  return { start: col * 10, end: col * 10 + 9 };
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

      // UPDATE state.
      const isFinished = nextSequence >= maxDraws;
      await client.query(
        `UPDATE ${this.gameStateTable()}
            SET draws_completed   = $2,
                last_drawn_ball   = $3,
                last_drawn_at     = now(),
                engine_ended_at   = CASE WHEN $4::boolean THEN now() ELSE engine_ended_at END
          WHERE scheduled_game_id = $1`,
        [scheduledGameId, nextSequence, ball, isFinished]
      );

      // Hvis maxDraws nådd → marker scheduled_game som completed.
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
      `SELECT id, status, ticket_config_json
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
          const markings = {
            marked: grid.map(() => false),
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
