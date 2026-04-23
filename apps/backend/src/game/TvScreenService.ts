/**
 * TV Screen + Winners public display service.
 *
 * Kontekst: bingoverten åpner en public URL på hall-TV-skjermen
 * (`/tv/:hallId/:tvToken`). Denne service'n leverer nåværende game-state
 * og ferdig-game winners-summary til TV-klienten. Auth: kun tvToken
 * validert av PlatformService.verifyHallTvToken — ingen login-gate.
 *
 * Design:
 *   * Les-only: service'n gjør kun SELECT mot app_game1_scheduled_games,
 *     app_game1_game_state, app_game1_draws, app_game1_phase_winners.
 *   * Current-game-lookup: finner siste scheduled_game for hall som er
 *     running/paused/purchase_open/ready_to_start (status ≠ completed/cancelled).
 *     Hvis ingen aktiv, finner siste completed for countdown/winners-visning.
 *   * Pattern-rows: fase 1..5 fra legacy = Row 1 / Row 2 / Row 3 / Row 4 /
 *     Full House. Vi speiler dette navngivningsschemaet i TV-UIet.
 *   * Fail-open på tomme haller: en hall uten spill returnerer tomme felt
 *     (ingen 404) slik at TV-skjermen kan stå på med "Waiting for game".
 *
 * Legacy-spec: Admin V1.0 Game 1 - 24.3.2023 s.17 og Admin CR 21.02.2024.
 */

import type { Pool } from "pg";

export interface TvPatternRow {
  /** "Row 1".."Row 4" | "Full House" */
  name: string;
  /** Fase 1..5 — matcher app_game1_phase_winners.phase. */
  phase: number;
  /** Antall spillere/brett som vant fasen i aktuell game. */
  playersWon: number;
  /** Total prize-pot for fasen (øre). Beregnes fra phase_winners.total_phase_prize_cents. */
  prize: number;
  /** true hvis fasen nettopp ble vunnet (current_phase − 1 i state-maskinen). */
  highlighted: boolean;
}

export interface TvGameState {
  hall: { id: string; name: string };
  currentGame: {
    id: string;
    name: string;
    /** "Game N" — sub_game_index + 1. */
    number: number;
    /** scheduled_start_time ISO. */
    startAt: string;
    ballsDrawn: number[];
    lastBall: number | null;
  } | null;
  patterns: TvPatternRow[];
  /** Countdown til neste game (etter completed) — null hvis current game pågår. */
  countdownToNextGame: {
    nextGameName: string;
    secondsRemaining: number;
  } | null;
  status: "drawing" | "waiting" | "ended";
}

export interface TvWinnerRow {
  /** "Row 1".."Row 4" | "Full House" */
  pattern: string;
  phase: number;
  playersWon: number;
  /** Prize per brett (øre). */
  prizePerTicket: number;
  /** Hall navn — vinnerens hall. Legacy "Hall Belongs To". */
  hallName: string;
}

export interface TvWinnersSummary {
  totalNumbersWithdrawn: number;
  fullHouseWinners: number;
  patternsWon: number;
  winners: TvWinnerRow[];
}

/** Fase 1..5 → legacy-navn per Admin V1.0 Game 1 s.17. */
const PHASE_NAMES: Record<number, string> = {
  1: "Row 1",
  2: "Row 2",
  3: "Row 3",
  4: "Row 4",
  5: "Full House",
};

interface ScheduledGameRow {
  id: string;
  sub_game_index: number;
  sub_game_name: string;
  custom_game_name: string | null;
  scheduled_start_time: Date | string;
  scheduled_end_time: Date | string;
  status: string;
}

interface GameStateRow {
  current_phase: number;
  last_drawn_ball: number | null;
  draws_completed: number;
}

export interface TvScreenServiceOptions {
  pool: Pool;
  schema?: string;
}

export class TvScreenService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(opts: TvScreenServiceOptions) {
    this.pool = opts.pool;
    this.schema = opts.schema ?? "public";
  }

  /**
   * Hent current state for TV-skjerm. Hall-info fra PlatformService-caller,
   * game-info queries fra DB.
   */
  async getState(hall: { id: string; name: string }): Promise<TvGameState> {
    // 1) Finn "current game" — prioritet: aktiv (running/paused/purchase_open/
    //    ready_to_start) > siste completed i dag. Hall deltar hvis den er
    //    master_hall_id ELLER står i participating_halls_json.
    const activeRow = await this.findActiveScheduledGame(hall.id);
    const fallbackRow = activeRow ?? (await this.findLatestCompletedScheduledGame(hall.id));

    if (!fallbackRow) {
      return {
        hall,
        currentGame: null,
        patterns: this.emptyPatterns(),
        countdownToNextGame: null,
        status: "waiting",
      };
    }

    const gameId = fallbackRow.id;
    const [state, draws, winners] = await Promise.all([
      this.loadGameState(gameId),
      this.loadDraws(gameId),
      this.loadPhaseWinners(gameId),
    ]);

    const patterns = this.buildPatternRows(winners, state?.current_phase ?? 1);

    // Last 5 balls (draws er i rekkefølge — backend gir dem sortert).
    const ballsDrawn = draws.slice(-5);
    const lastBall = draws.length > 0 ? draws[draws.length - 1]! : null;

    const isActive = activeRow !== null;
    const status: TvGameState["status"] = isActive
      ? fallbackRow.status === "paused"
        ? "waiting"
        : "drawing"
      : "ended";

    // Countdown: hvis siste game er completed, finn neste scheduled for hallen.
    let countdown: TvGameState["countdownToNextGame"] = null;
    if (!isActive) {
      const next = await this.findNextScheduledGame(hall.id);
      if (next) {
        const startMs = new Date(next.scheduled_start_time).getTime();
        const secondsRemaining = Math.max(0, Math.floor((startMs - Date.now()) / 1000));
        countdown = {
          nextGameName: this.displayName(next),
          secondsRemaining,
        };
      }
    }

    return {
      hall,
      currentGame: {
        id: gameId,
        name: this.displayName(fallbackRow),
        number: fallbackRow.sub_game_index + 1,
        startAt: this.asIso(fallbackRow.scheduled_start_time),
        ballsDrawn,
        lastBall,
      },
      patterns,
      countdownToNextGame: countdown,
      status,
    };
  }

  /**
   * Hent winners-summary for siste ferdig-spilte game for hallen.
   * Brukes av Winners-page mellom spill.
   */
  async getWinners(hall: { id: string; name: string }): Promise<TvWinnersSummary> {
    const last = await this.findLatestCompletedScheduledGame(hall.id);
    if (!last) {
      return {
        totalNumbersWithdrawn: 0,
        fullHouseWinners: 0,
        patternsWon: 0,
        winners: [],
      };
    }

    const [state, winners] = await Promise.all([
      this.loadGameState(last.id),
      this.loadPhaseWinners(last.id),
    ]);
    const hallNamesMap = await this.loadHallNames(winnersHallIds(winners));

    const totalNumbersWithdrawn = state?.draws_completed ?? 0;

    // Gruppér per fase → per-fase aggregering.
    const byPhase = new Map<number, { playersWon: number; prizePerTicket: number; hallIds: Set<string> }>();
    for (const w of winners) {
      const cur = byPhase.get(w.phase) ?? {
        playersWon: 0,
        prizePerTicket: 0,
        hallIds: new Set<string>(),
      };
      cur.playersWon += 1;
      // prize_amount_cents er allerede split per brett. Tar max for å
      // vise en representativ verdi — de er like når pot deltes likt.
      cur.prizePerTicket = Math.max(cur.prizePerTicket, w.prize_amount_cents);
      cur.hallIds.add(w.hall_id);
      byPhase.set(w.phase, cur);
    }

    // Row 1-5 (inkluder tomme rader).
    const phases = [1, 2, 3, 4, 5];
    const rows: TvWinnerRow[] = phases.map((phase) => {
      const agg = byPhase.get(phase);
      const hallNames = agg
        ? [...agg.hallIds].map((id) => hallNamesMap.get(id) ?? "").filter(Boolean)
        : [];
      return {
        pattern: PHASE_NAMES[phase] ?? `Phase ${phase}`,
        phase,
        playersWon: agg?.playersWon ?? 0,
        prizePerTicket: agg?.prizePerTicket ?? 0,
        hallName: hallNames.join(", "),
      };
    });

    const fullHouseWinners = byPhase.get(5)?.playersWon ?? 0;
    const patternsWon = winners.length;

    return {
      totalNumbersWithdrawn,
      fullHouseWinners,
      patternsWon,
      winners: rows,
    };
  }

  // ── Interne helpers ────────────────────────────────────────────────────

  private async findActiveScheduledGame(hallId: string): Promise<ScheduledGameRow | null> {
    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT id, sub_game_index, sub_game_name, custom_game_name,
              scheduled_start_time, scheduled_end_time, status
         FROM ${this.scheduledGamesTable()}
        WHERE (master_hall_id = $1
           OR participating_halls_json::jsonb @> to_jsonb($1::text))
          AND status IN ('running','paused','purchase_open','ready_to_start')
        ORDER BY scheduled_start_time DESC
        LIMIT 1`,
      [hallId]
    );
    return rows[0] ?? null;
  }

  private async findLatestCompletedScheduledGame(hallId: string): Promise<ScheduledGameRow | null> {
    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT id, sub_game_index, sub_game_name, custom_game_name,
              scheduled_start_time, scheduled_end_time, status
         FROM ${this.scheduledGamesTable()}
        WHERE (master_hall_id = $1
           OR participating_halls_json::jsonb @> to_jsonb($1::text))
          AND status IN ('completed','cancelled')
        ORDER BY COALESCE(actual_end_time, scheduled_end_time) DESC
        LIMIT 1`,
      [hallId]
    );
    return rows[0] ?? null;
  }

  private async findNextScheduledGame(hallId: string): Promise<ScheduledGameRow | null> {
    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT id, sub_game_index, sub_game_name, custom_game_name,
              scheduled_start_time, scheduled_end_time, status
         FROM ${this.scheduledGamesTable()}
        WHERE (master_hall_id = $1
           OR participating_halls_json::jsonb @> to_jsonb($1::text))
          AND status IN ('scheduled','purchase_open','ready_to_start')
          AND scheduled_start_time > now()
        ORDER BY scheduled_start_time ASC
        LIMIT 1`,
      [hallId]
    );
    return rows[0] ?? null;
  }

  private async loadGameState(scheduledGameId: string): Promise<GameStateRow | null> {
    const { rows } = await this.pool.query<GameStateRow>(
      `SELECT current_phase, last_drawn_ball, draws_completed
         FROM ${this.gameStateTable()}
        WHERE scheduled_game_id = $1`,
      [scheduledGameId]
    );
    return rows[0] ?? null;
  }

  private async loadDraws(scheduledGameId: string): Promise<number[]> {
    const { rows } = await this.pool.query<{ ball_value: number }>(
      `SELECT ball_value
         FROM ${this.drawsTable()}
        WHERE scheduled_game_id = $1
        ORDER BY draw_sequence ASC`,
      [scheduledGameId]
    );
    return rows.map((r) => Number(r.ball_value));
  }

  private async loadPhaseWinners(scheduledGameId: string): Promise<Array<{
    phase: number;
    prize_amount_cents: number;
    total_phase_prize_cents: number;
    hall_id: string;
  }>> {
    const { rows } = await this.pool.query<{
      phase: number;
      prize_amount_cents: number | string;
      total_phase_prize_cents: number | string;
      hall_id: string;
    }>(
      `SELECT phase, prize_amount_cents, total_phase_prize_cents, hall_id
         FROM ${this.phaseWinnersTable()}
        WHERE scheduled_game_id = $1`,
      [scheduledGameId]
    );
    return rows.map((r) => ({
      phase: Number(r.phase),
      prize_amount_cents: Number(r.prize_amount_cents),
      total_phase_prize_cents: Number(r.total_phase_prize_cents),
      hall_id: r.hall_id,
    }));
  }

  private async loadHallNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM "${this.schema}"."app_halls" WHERE id = ANY($1::text[])`,
      [ids]
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private buildPatternRows(
    winners: Array<{ phase: number; prize_amount_cents: number; total_phase_prize_cents: number }>,
    currentPhase: number
  ): TvPatternRow[] {
    const byPhase = new Map<number, { playersWon: number; prize: number }>();
    for (const w of winners) {
      const cur = byPhase.get(w.phase) ?? { playersWon: 0, prize: 0 };
      cur.playersWon += 1;
      // Total prize pot for fasen (alle vinner-rader har samme total_phase_prize_cents).
      cur.prize = Math.max(cur.prize, w.total_phase_prize_cents);
      byPhase.set(w.phase, cur);
    }

    // Siste fullførte fase = current_phase − 1 (engine rykker frem etter win).
    const highlightPhase = Math.max(1, currentPhase - 1);

    return [1, 2, 3, 4, 5].map((phase) => {
      const agg = byPhase.get(phase);
      return {
        name: PHASE_NAMES[phase] ?? `Phase ${phase}`,
        phase,
        playersWon: agg?.playersWon ?? 0,
        prize: agg?.prize ?? 0,
        highlighted: phase === highlightPhase && (agg?.playersWon ?? 0) > 0,
      };
    });
  }

  private emptyPatterns(): TvPatternRow[] {
    return [1, 2, 3, 4, 5].map((phase) => ({
      name: PHASE_NAMES[phase] ?? `Phase ${phase}`,
      phase,
      playersWon: 0,
      prize: 0,
      highlighted: false,
    }));
  }

  private displayName(row: ScheduledGameRow): string {
    return row.custom_game_name?.trim() || row.sub_game_name;
  }

  private asIso(d: Date | string): string {
    return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  private gameStateTable(): string {
    return `"${this.schema}"."app_game1_game_state"`;
  }

  private drawsTable(): string {
    return `"${this.schema}"."app_game1_draws"`;
  }

  private phaseWinnersTable(): string {
    return `"${this.schema}"."app_game1_phase_winners"`;
  }
}

/** Local utility: unique hall-IDs fra winners-rader. */
function winnersHallIds(
  winners: Array<{ hall_id: string }>
): string[] {
  const set = new Set<string>();
  for (const w of winners) set.add(w.hall_id);
  return [...set];
}
