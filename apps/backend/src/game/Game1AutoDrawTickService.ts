/**
 * GAME1_SCHEDULE PR 4c Bolk 4: Game1AutoDrawTickService.
 *
 * Global 1-sekunds-tick som driver automatisk kule-trekk for alle
 * running Spill 1-games. Tick-service-mønster: JobScheduler kaller tick()
 * hvert sekund; metoden finner games klare for draw og trigger
 * drawEngine.drawNext() for hver.
 *
 * PM-avklaring 2026-04-21: Fixed interval (`seconds`-felt fra
 * ticket_config.spill1.timing), ikke random min/max. Tobias' eksakte ord:
 * "hver kule kommer med akuratt samme mellomrom. eneste master gjør er
 * da enten å stoppe trekning og starte treking."
 *
 * Algoritme per tick:
 *   1) Hent alle running games: scheduled_game.status='running' AND
 *      game_state.paused=false AND engine_ended_at IS NULL.
 *   2) For hver game, sjekk om `last_drawn_at + seconds <= now()` (eller
 *      last_drawn_at IS NULL for å trigge første draw umiddelbart etter
 *      start).
 *   3) Trigger drawEngine.drawNext(scheduledGameId). Samle feil per game —
 *      én feil blokkerer ikke tick-en for andre games.
 *
 * Throttling:
 *   - Service bruker `next_auto_draw_at`-kolonnen i app_game1_game_state
 *     som en shortcut for å unngå repeterte query-er, men den er ikke
 *     strengt nødvendig — hovedalgoritmen er basert på last_drawn_at +
 *     seconds <= now(). `next_auto_draw_at` oppdateres etter hver draw
 *     slik at SELECT-en kan filtrere raskt.
 *
 * Scope:
 *   - Service leser `seconds` fra ticket_config.spill1.timing.seconds
 *     (default 5 hvis ikke satt). `minseconds`/`maxseconds` er LEGACY
 *     random-range-felter fra form-en som ikke brukes i praksis.
 *   - Pause: `paused=true` blokkerer tick. resumeGame setter paused=false
 *     + last_drawn_at blir intakt, så neste draw trekkes når
 *     `last_drawn_at + seconds <= now()` naturlig passerer.
 *   - Ingen socket-broadcast her — det skjer i PR 4d.
 *
 * Referanse:
 *   - Spill1Config.ts: `Spill1Timing.seconds` = sekunder per kule.
 *   - `.claude/legacy-ref/Game1/Controllers/GameProcess.js` (auto-draw-timer
 *     pre-dated scheduling; forenklet i denne versjonen).
 */

import type { Pool } from "pg";
import { DomainError } from "./BingoEngine.js";
import type { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-auto-draw-tick" });

// ── Public types ────────────────────────────────────────────────────────────

export interface Game1AutoDrawTickServiceOptions {
  pool: Pool;
  schema?: string;
  drawEngine: Game1DrawEngineService;
  /**
   * Default sekunder hvis ticket_config.timing.seconds mangler eller er
   * ugyldig. Legacy standard = 5.
   */
  defaultSeconds?: number;
  /**
   * Globalt override som vinner over per-game ticket_config_json.timing.seconds.
   * Når satt, brukes denne verdien for ALLE Spill 1-spill uavhengig av admin-config.
   *
   * Settes typisk fra `AUTO_DRAW_INTERVAL_MS` env-var slik at Tobias kan
   * tune draw-tempo i prod uten å redigere per-game ticket_config. Når
   * env-var er satt holder intervalet seg stabilt på tvers av runder
   * (var bug før: runde 1 brukte env-verdien implisitt, runde 2 falt til
   * default fordi env-var-en ikke ble lest).
   */
  forceSecondsOverride?: number;
}

export interface Game1AutoDrawTickResult {
  /** Antall games undersøkt. */
  checked: number;
  /** Antall games hvor drawNext ble trigget. */
  drawsTriggered: number;
  /** Antall games hoppet over (ikke klar — for tidlig siden siste draw). */
  skippedNotDue: number;
  /** Antall feil fra drawNext (f.eks. GAME_PAUSED race-condition). */
  errors: number;
  /** Per-game-feilmelding for debug (opptil 10 første). */
  errorMessages?: string[];
}

interface RunningGameRow {
  id: string; // scheduled_game_id
  ticket_config_json: unknown;
  draws_completed: number;
  last_drawn_at: Date | string | null;
  engine_started_at: Date | string;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class Game1AutoDrawTickService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly drawEngine: Game1DrawEngineService;
  private readonly defaultSeconds: number;
  private readonly forceSecondsOverride: number | null;

  constructor(options: Game1AutoDrawTickServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
    this.drawEngine = options.drawEngine;
    this.defaultSeconds = options.defaultSeconds ?? 5;
    // Aksepter kun positive heltall som override; alt annet → null (= ingen override).
    const override = options.forceSecondsOverride;
    this.forceSecondsOverride =
      typeof override === "number" && Number.isFinite(override) && override > 0
        ? Math.floor(override)
        : null;
  }

  /**
   * Kjør én tick. Trigger drawNext for hvert game som er "klar" (enten
   * ingen draws ennå, eller last_drawn_at + seconds <= now()).
   *
   * Feil fra individuelle drawNext-kall fanges og rapporteres i
   * result.errors — tick-en fortsetter for andre games.
   */
  async tick(): Promise<Game1AutoDrawTickResult> {
    const runningGames = await this.loadRunningGames();
    const now = Date.now();
    let drawsTriggered = 0;
    let skippedNotDue = 0;
    let errors = 0;
    const errorMessages: string[] = [];

    for (const game of runningGames) {
      const seconds = this.resolveSeconds(game.ticket_config_json);
      const lastDrawnMs = this.parseLastDrawnMs(game);
      const dueAt = lastDrawnMs + seconds * 1000;

      if (now < dueAt) {
        skippedNotDue++;
        continue;
      }

      try {
        await this.drawEngine.drawNext(game.id);
        drawsTriggered++;
      } catch (err) {
        errors++;
        const msg = `${game.id}: ${(err as Error).message ?? "unknown"}`;
        if (errorMessages.length < 10) errorMessages.push(msg);
        log.warn(
          { err, scheduledGameId: game.id },
          "[GAME1_PR4c] auto-draw tick: drawNext failed for game"
        );
      }
    }

    log.debug(
      {
        checked: runningGames.length,
        drawsTriggered,
        skippedNotDue,
        errors,
      },
      "[GAME1_PR4c] auto-draw tick completed"
    );

    return {
      checked: runningGames.length,
      drawsTriggered,
      skippedNotDue,
      errors,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async loadRunningGames(): Promise<RunningGameRow[]> {
    // Inner join med game_state for paused-flag + last_drawn_at.
    const { rows } = await this.pool.query<RunningGameRow>(
      `SELECT sg.id,
              sg.ticket_config_json,
              gs.draws_completed,
              gs.last_drawn_at,
              gs.engine_started_at
         FROM "${this.schema}"."app_game1_scheduled_games" sg
         JOIN "${this.schema}"."app_game1_game_state" gs
           ON gs.scheduled_game_id = sg.id
        WHERE sg.status = 'running'
          AND gs.paused = false
          AND gs.engine_ended_at IS NULL`
    );
    return rows;
  }

  /**
   * Finn siste-draw-millisekund. Hvis ingen draws ennå (last_drawn_at=null),
   * bruk engine_started_at som base slik at første draw blir trigget
   * `seconds` etter start — ikke umiddelbart.
   *
   * Hvorfor ikke trigge umiddelbart? Det gir spillere tid til å se kortene
   * før første kule kommer. Master-kontroll kan overstyre ved manuelt
   * `drawNext()`-kall.
   */
  private parseLastDrawnMs(game: RunningGameRow): number {
    const last = game.last_drawn_at ?? game.engine_started_at;
    if (last instanceof Date) return last.getTime();
    if (typeof last === "string") return new Date(last).getTime();
    return Date.now();
  }

  /**
   * Resolve seconds-felt fra ticket_config_json.
   * Support både:
   *   - top-level `{ seconds: N }` (kompakt form)
   *   - nested `{ spill1: { timing: { seconds: N } } }` (admin-form)
   *   - nested `{ timing: { seconds: N } }` (generisk)
   *
   * `forceSecondsOverride` (typisk fra `AUTO_DRAW_INTERVAL_MS` env-var)
   * vinner over per-game-config slik at draw-tempoet er stabilt på tvers
   * av alle runder i prod.
   */
  private resolveSeconds(rawConfig: unknown): number {
    if (this.forceSecondsOverride !== null) {
      return this.forceSecondsOverride;
    }
    let parsed: unknown = rawConfig;
    if (typeof rawConfig === "string") {
      try {
        parsed = JSON.parse(rawConfig);
      } catch {
        return this.defaultSeconds;
      }
    }
    if (!parsed || typeof parsed !== "object") {
      return this.defaultSeconds;
    }
    const obj = parsed as Record<string, unknown>;

    // Admin-form-shape: { spill1: { timing: { seconds } } }.
    const spill1 = obj.spill1 as Record<string, unknown> | undefined;
    if (spill1 && typeof spill1 === "object") {
      const timing = spill1.timing as Record<string, unknown> | undefined;
      if (timing && typeof timing === "object") {
        const s = pickPositiveInt(timing.seconds);
        if (s !== null) return s;
      }
    }

    // Generisk nested: { timing: { seconds } }.
    const timing = obj.timing as Record<string, unknown> | undefined;
    if (timing && typeof timing === "object") {
      const s = pickPositiveInt(timing.seconds);
      if (s !== null) return s;
    }

    // Top-level.
    const s = pickPositiveInt(obj.seconds);
    if (s !== null) return s;

    return this.defaultSeconds;
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function pickPositiveInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}
