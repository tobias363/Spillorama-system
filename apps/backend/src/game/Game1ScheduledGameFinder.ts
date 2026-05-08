/**
 * Bølge 6 (2026-05-08): Konsolidert scheduled-game-finder-helper.
 *
 * Audit-rapport: `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`
 * §7 Bølge 6.
 *
 * Mål: erstatt tre nær-identiske finder-queries i `routes/agentGame1.ts`
 *   - `findActiveGameForHall` (status IN purchase_open/ready_to_start/running/paused)
 *   - `findActiveOrUpcomingGameForHall` (+ scheduled)
 *   - `findScheduledGameForHall` (kun scheduled)
 * med én konsolidert helper, slik at endringer i status-filteret skjer
 * på ÉN plass og finder-logikken kan testes uten å montere hele router-
 * stacken.
 *
 * Backwards-compat: gamle eksporter beholdes som thin wrappers (i
 * `routes/agentGame1.ts`) — Bølge 2 (`MasterActionService` parallel)
 * skal kunne referere disse uten signatur-brudd.
 *
 * Robusthet (LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08):
 *   - Soft-fail på 42P01 (manglende tabell) / 42703 (manglende kolonne)
 *     for å støtte dev-DB uten migrations. Returnerer null + debug-log,
 *     på samme måte som de gamle finder-funksjonene.
 *   - SQL-skjema-navnet valideres mot whitelist før innsetting i SQL —
 *     samme regex som routes/agentGame1.ts bruker (`^[a-z_][a-z0-9_]*$`).
 *   - Status-array valideres ikke-tomt — tom liste ville produsert
 *     `IN ()` (SQL-syntaks-feil i Postgres).
 */

import type { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import type { Game1ScheduledGameStatus } from "./Game1ScheduleTickService.js";

const logger = rootLogger.child({ module: "game1-scheduled-game-finder" });

/**
 * Predefinerte status-buckets — bruk disse istedet for å gjenta enum-
 * verdier i hver kall-site. Hvert sett tilsvarer en av de tre opprinnelige
 * finder-funksjonene i `routes/agentGame1.ts`.
 *
 * Verdiene er `readonly` for å hindre accidental mutasjon, og typet på
 * `Game1ScheduledGameStatus[]` så TypeScript fanger up-to-date enum-
 * stavefeil ved compile-time.
 */
export const SCHEDULED_GAME_STATUSES = {
  /** Statuser der en runde er aktivt i drift (kjøp åpent eller live). */
  ACTIVE: [
    "purchase_open",
    "ready_to_start",
    "running",
    "paused",
  ] as const satisfies readonly Game1ScheduledGameStatus[],
  /** Aktive + 'scheduled' (venter på cron-promotering til purchase_open). */
  ACTIVE_OR_UPCOMING: [
    "scheduled",
    "purchase_open",
    "ready_to_start",
    "running",
    "paused",
  ] as const satisfies readonly Game1ScheduledGameStatus[],
  /** Kun rader som ENDA ikke har åpnet for kjøp. */
  SCHEDULED_ONLY: [
    "scheduled",
  ] as const satisfies readonly Game1ScheduledGameStatus[],
} as const;

/**
 * DB-rad-shape returnert av finder-queryen. Identisk med den interne
 * `ActiveGameRow` i `routes/agentGame1.ts` for å holde wire-kontrakten
 * stabil. Felter er typet som `Date | string` fordi pg-driveren kan
 * returnere begge avhengig av tabell-konfig — caller må normalisere
 * via `toIso`-helper hvis ønskelig.
 */
export interface ScheduledGameRow {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string;
  participating_halls_json: unknown;
  sub_game_name: string;
  custom_game_name: string | null;
  scheduled_start_time: Date | string;
  scheduled_end_time: Date | string;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
}

export interface FindScheduledGameOptions {
  /** Hall som skal matches mot master_hall_id ELLER participating_halls_json. */
  hallId: string;
  /**
   * Statuser å filtrere på. Bruk en av {@link SCHEDULED_GAME_STATUSES}-
   * konstantene eller send en custom liste. Tom array kaster
   * `INVALID_INPUT` — Postgres ville produsert syntaks-feil på `IN ()`.
   */
  statuses: readonly Game1ScheduledGameStatus[];
  /**
   * Hvis flere rader matcher, hvilken velges?
   *   - `'first-by-scheduled-start'` (default) — tidligste
   *     `scheduled_start_time`. Matcher legacy-oppførsel i
   *     `routes/agentGame1.ts`.
   *   - `'most-recent'` — nyeste `created_at`. Brukes ikke i dag, men
   *     er forberedt for framtidig bruk når flere parallelle runder
   *     for samme hall kan eksistere (f.eks. når `transferHallAccess`
   *     spawner en backup-runde).
   */
  orderBy?: "first-by-scheduled-start" | "most-recent";
}

export interface Game1ScheduledGameFinderOptions {
  pool: Pool;
  /**
   * Postgres-skjema. Default `public`. Validert mot whitelist-regex
   * (`^[a-z_][a-z0-9_]*$`) før innsetting i SQL — beskytter mot SQL-
   * injection via env-konfig.
   */
  schema?: string;
}

/**
 * Konsolidert finder for `app_game1_scheduled_games`-rader. Brukes av
 * agent-portal og master-konsoll for å lokalisere "den runden hallen
 * er involvert i akkurat nå", filtrert på status-bucket.
 */
export class Game1ScheduledGameFinder {
  private readonly pool: Pool;
  private readonly scheduledGamesTable: string;

  constructor(opts: Game1ScheduledGameFinderOptions) {
    const schema = (opts.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.pool = opts.pool;
    this.scheduledGamesTable = `"${schema}"."app_game1_scheduled_games"`;
  }

  /**
   * Finn første rad som matcher `(hallId, statuses)`. Returnerer null
   * hvis ingen match, eller hvis tabellen mangler i dev-DB.
   */
  async findFor(opts: FindScheduledGameOptions): Promise<ScheduledGameRow | null> {
    const hallId = opts.hallId;
    if (typeof hallId !== "string" || hallId.trim().length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "findFor: hallId må være ikke-tom string.",
      );
    }
    if (!Array.isArray(opts.statuses) || opts.statuses.length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "findFor: statuses må være ikke-tom array.",
      );
    }

    const orderBy = opts.orderBy ?? "first-by-scheduled-start";
    const orderByClause =
      orderBy === "most-recent"
        ? "ORDER BY created_at DESC"
        : "ORDER BY scheduled_start_time ASC";

    // Generér placeholders $2, $3, ... for status-IN-listen så vi får
    // type-sikker query uten string-escaping.
    const statusPlaceholders = opts.statuses
      .map((_, i) => `$${i + 2}`)
      .join(", ");

    const sql = `
      SELECT id, status, master_hall_id, group_hall_id,
             participating_halls_json, sub_game_name, custom_game_name,
             scheduled_start_time, scheduled_end_time,
             actual_start_time, actual_end_time
        FROM ${this.scheduledGamesTable}
       WHERE (master_hall_id = $1
          OR participating_halls_json::jsonb @> to_jsonb($1::text))
         AND status IN (${statusPlaceholders})
       ${orderByClause}
       LIMIT 1
    `;

    try {
      const params = [hallId, ...opts.statuses];
      const { rows } = await this.pool.query<ScheduledGameRow>(sql, params);
      return rows[0] ?? null;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01" || code === "42703") {
        logger.debug(
          { hallId, statuses: opts.statuses, code },
          "scheduled-games table missing; returning null",
        );
        return null;
      }
      throw err;
    }
  }
}
