/**
 * BIN-623: CloseDay-service — regulatorisk dagsavslutning per GameManagement.
 *
 * Ansvar:
 *   1) Aggregere et summary-snapshot for et spill (totalSold / totalEarning /
 *      winners / payouts / jackpots / tickets). I første iterasjon kommer
 *      feltene fra `app_game_management`-raden direkte; når BIN-622+
 *      normaliserer tickets/wins/jackpots til egne tabeller utvides
 *      kildene (se PR-body for design-valg).
 *   2) Lukke dagen (idempotent): én rad per (game_management_id, close_date).
 *      Unique-indeks i DB gir fail-fast på dobbel-lukking og service mapper
 *      feilen til `GAME_CLOSE_DAY_ALREADY_CLOSED`. Router gjør denne om til
 *      HTTP 409.
 *
 * Merknader:
 *   - Audit-log-skriving ligger i router-laget (samme mønster som BIN-622
 *     GameManagement + BIN-665 HallGroup) slik at IP/UA er tilgjengelig.
 *     Service returnerer den persisterte entry-en inkl. summary slik at
 *     routerens audit-details matcher 1:1.
 *   - `closeDate` er YYYY-MM-DD (streng, validert). Vi lagrer som DATE i
 *     Postgres og konverterer ved utgangen for stabil wire-shape.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";
import type {
  GameManagementService,
  GameManagement,
} from "./GameManagementService.js";

const logger = rootLogger.child({ module: "close-day-service" });

/** Snapshot-felter aggregert på lukketidspunkt. */
export interface CloseDaySummary {
  /** ID for spillet (matches input). */
  gameManagementId: string;
  /** ISO-dato (YYYY-MM-DD) summaryen gjelder for. */
  closeDate: string;
  /** `true` hvis spillet allerede er lukket for denne datoen. */
  alreadyClosed: boolean;
  /** Når allerede lukket: closedAt fra loggen. */
  closedAt: string | null;
  /** Når allerede lukket: closedBy fra loggen. */
  closedBy: string | null;
  /** GameManagement.totalSold (kopiert for stabilitet ved senere oppdatering). */
  totalSold: number;
  /** GameManagement.totalEarning. */
  totalEarning: number;
  /** Antall solgte billetter (v1: speil av totalSold til egne tabeller finnes). */
  ticketsSold: number;
  /** Antall vinnere (v1: 0 til vinner-tabell er normalisert). */
  winnersCount: number;
  /** Sum utbetalinger (v1: 0 til payout-tabell er normalisert). */
  payoutsTotal: number;
  /** Sum jackpot-utbetalinger (v1: 0 til jackpot-logg er normalisert). */
  jackpotsTotal: number;
  /** Når snapshot ble tatt (ISO-timestamp). */
  capturedAt: string;
}

/** Persistert close-day-rad. Summary-snapshot er inkludert. */
export interface CloseDayEntry {
  id: string;
  gameManagementId: string;
  closeDate: string;
  closedBy: string | null;
  closedAt: string;
  summary: CloseDaySummary;
}

export interface CloseDayServiceOptions {
  connectionString: string;
  schema?: string;
  gameManagementService: GameManagementService;
}

interface CloseDayLogRow {
  id: string;
  game_management_id: string;
  close_date: Date | string;
  closed_by: string | null;
  summary_json: Record<string, unknown> | null;
  closed_at: Date | string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertCloseDate(value: unknown, field = "closeDate"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (!DATE_PATTERN.test(trimmed)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være på formatet YYYY-MM-DD.`
    );
  }
  // Parse-sanity: må være gyldig kalenderdato.
  const parsed = Date.parse(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new DomainError("INVALID_INPUT", `${field} er ikke en gyldig dato.`);
  }
  return trimmed;
}

function assertGameId(value: unknown, field = "gameManagementId"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError("INVALID_INPUT", `${field} kan maksimalt være 200 tegn.`);
  }
  return trimmed;
}

function assertClosedBy(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "closedBy er påkrevd.");
  }
  return value.trim();
}

function asIsoDate(value: Date | string): string {
  if (typeof value === "string") {
    // Postgres returnerer DATE som "YYYY-MM-DD" — pass-through.
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  // Unngå tidssone-drift: format YYYY-MM-DD i UTC.
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function asIsoTimestamp(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function parseSummary(value: unknown): Partial<CloseDaySummary> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Partial<CloseDaySummary>;
}

export class CloseDayService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly gameManagementService: GameManagementService;
  private initPromise: Promise<void> | null = null;

  constructor(options: CloseDayServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for CloseDayService."
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.gameManagementService = options.gameManagementService;
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    gameManagementService: GameManagementService,
    schema = "public"
  ): CloseDayService {
    const svc = Object.create(CloseDayService.prototype) as CloseDayService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as {
      gameManagementService: GameManagementService;
    }).gameManagementService = gameManagementService;
    (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_close_day_log"`;
  }

  /**
   * Bygg summary-snapshot for et spill. Inkluderer `alreadyClosed`-flagg
   * slik at admin-UI kan vise "dagen er allerede lukket"-banner før bruker
   * trykker bekreft.
   */
  async summary(gameIdRaw: string, closeDateRaw: string): Promise<CloseDaySummary> {
    await this.ensureInitialized();
    const gameId = assertGameId(gameIdRaw);
    const closeDate = assertCloseDate(closeDateRaw);
    const game = await this.gameManagementService.get(gameId);
    const existing = await this.findExisting(gameId, closeDate);
    return this.buildSummary(game, closeDate, existing);
  }

  /**
   * Lukk dagen. Idempotent: returnerer eksisterende rad hvis dagen allerede
   * er lukket (caller velger 200 vs 409 basert på `alreadyClosed`-flagget).
   *
   * Router bruker `CLOSE_DAY_ALREADY_CLOSED` fra DomainError for å returnere
   * 409 på collision. Denne service-metoden kaster DomainError, så dobbel-
   * lukking er en eksplisitt feil — callers som vil ha idempotent semantikk
   * kan kalle `summary()` først og sjekke `alreadyClosed`.
   */
  async close(input: {
    gameManagementId: string;
    closeDate: string;
    closedBy: string;
  }): Promise<CloseDayEntry> {
    await this.ensureInitialized();
    const gameId = assertGameId(input.gameManagementId);
    const closeDate = assertCloseDate(input.closeDate);
    const closedBy = assertClosedBy(input.closedBy);
    const game = await this.gameManagementService.get(gameId);
    if (game.deletedAt) {
      throw new DomainError(
        "GAME_MANAGEMENT_DELETED",
        "Kan ikke lukke dagen for et slettet spill."
      );
    }

    const existing = await this.findExisting(gameId, closeDate);
    if (existing) {
      throw new DomainError(
        "CLOSE_DAY_ALREADY_CLOSED",
        `Dagen ${closeDate} er allerede lukket for dette spillet.`
      );
    }

    const summary = this.buildSummary(game, closeDate, null);
    const id = randomUUID();

    try {
      const { rows } = await this.pool.query<CloseDayLogRow>(
        `INSERT INTO ${this.table()}
           (id, game_management_id, close_date, closed_by, summary_json)
         VALUES ($1, $2, $3::date, $4, $5::jsonb)
         RETURNING id, game_management_id, close_date, closed_by, summary_json, closed_at`,
        [id, gameId, closeDate, closedBy, JSON.stringify(summary)]
      );
      const row = rows[0];
      if (!row) {
        throw new DomainError(
          "CLOSE_DAY_INSERT_FAILED",
          "Kunne ikke lagre close-day-rad."
        );
      }
      return this.map(row);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      // Håndter race-condition: unique-index fanger dobbel-lukking som
      // to parallelle requests kunne ha sluppet forbi summary-sjekken over.
      const message =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (message === "23505") {
        throw new DomainError(
          "CLOSE_DAY_ALREADY_CLOSED",
          `Dagen ${closeDate} er allerede lukket for dette spillet.`
        );
      }
      logger.error({ err, gameId, closeDate }, "[BIN-623] close-day insert failed");
      throw new DomainError(
        "CLOSE_DAY_INSERT_FAILED",
        "Kunne ikke lagre close-day-rad."
      );
    }
  }

  /** Helper: hent siste lukking for (gameId, date) eller null. */
  private async findExisting(
    gameId: string,
    closeDate: string
  ): Promise<CloseDayEntry | null> {
    const { rows } = await this.pool.query<CloseDayLogRow>(
      `SELECT id, game_management_id, close_date, closed_by, summary_json, closed_at
       FROM ${this.table()}
       WHERE game_management_id = $1 AND close_date = $2::date
       LIMIT 1`,
      [gameId, closeDate]
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  /** Bygg summary fra kilde-data + eksisterende lukking (hvis finnes). */
  private buildSummary(
    game: GameManagement,
    closeDate: string,
    existing: CloseDayEntry | null
  ): CloseDaySummary {
    // Når dagen er lukket fra før: behold snapshotet slik det var på
    // lukketidspunktet (kopier ut fra summary_json) — ellers speiler vi
    // dagens live-tall fra GameManagement.
    if (existing) {
      const prior = existing.summary;
      return {
        gameManagementId: game.id,
        closeDate,
        alreadyClosed: true,
        closedAt: existing.closedAt,
        closedBy: existing.closedBy,
        totalSold: Number(prior.totalSold ?? game.totalSold),
        totalEarning: Number(prior.totalEarning ?? game.totalEarning),
        ticketsSold: Number(prior.ticketsSold ?? game.totalSold),
        winnersCount: Number(prior.winnersCount ?? 0),
        payoutsTotal: Number(prior.payoutsTotal ?? 0),
        jackpotsTotal: Number(prior.jackpotsTotal ?? 0),
        capturedAt: prior.capturedAt ?? existing.closedAt,
      };
    }
    return {
      gameManagementId: game.id,
      closeDate,
      alreadyClosed: false,
      closedAt: null,
      closedBy: null,
      totalSold: game.totalSold,
      totalEarning: game.totalEarning,
      ticketsSold: game.totalSold,
      winnersCount: 0,
      payoutsTotal: 0,
      jackpotsTotal: 0,
      capturedAt: new Date().toISOString(),
    };
  }

  private map(row: CloseDayLogRow): CloseDayEntry {
    const summaryRaw = parseSummary(row.summary_json);
    const closeDate = asIsoDate(row.close_date);
    const closedAt = asIsoTimestamp(row.closed_at);
    const summary: CloseDaySummary = {
      gameManagementId: row.game_management_id,
      closeDate,
      alreadyClosed: true,
      closedAt,
      closedBy: row.closed_by,
      totalSold: Number(summaryRaw.totalSold ?? 0),
      totalEarning: Number(summaryRaw.totalEarning ?? 0),
      ticketsSold: Number(summaryRaw.ticketsSold ?? 0),
      winnersCount: Number(summaryRaw.winnersCount ?? 0),
      payoutsTotal: Number(summaryRaw.payoutsTotal ?? 0),
      jackpotsTotal: Number(summaryRaw.jackpotsTotal ?? 0),
      capturedAt:
        typeof summaryRaw.capturedAt === "string" ? summaryRaw.capturedAt : closedAt,
    };
    return {
      id: row.id,
      gameManagementId: row.game_management_id,
      closeDate,
      closedBy: row.closed_by,
      closedAt,
      summary,
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.table()} (
          id TEXT PRIMARY KEY,
          game_management_id TEXT NOT NULL,
          close_date DATE NOT NULL,
          closed_by TEXT NULL,
          summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_close_day_game_date
         ON ${this.table()}(game_management_id, close_date)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_close_day_game_recent
         ON ${this.table()}(game_management_id, closed_at DESC)`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-623] close-day schema init failed");
      throw new DomainError(
        "CLOSE_DAY_INIT_FAILED",
        "Kunne ikke initialisere close-day-tabell."
      );
    } finally {
      client.release();
    }
  }
}
