/**
 * BIN-620: GameType admin-service.
 *
 * Admin-CRUD for topp-nivå spill-typer (katalog). GameType = en stabil,
 * navngitt variant av et spill ("Game 1", "Game 3", "Databingo 60") som
 * backend-engine + admin-UI + dashboard dropper ned. Legacy Mongo-schema
 * `app_game_types` med egne kolonner for aktivt-brukte felter og JSON-
 * fallback for resten.
 *
 * Gjenbruk:
 *   - Samme mønster som PatternService (BIN-627), HallGroupService (BIN-665),
 *     GameManagementService (BIN-622), DailyScheduleService (BIN-626).
 *   - `Object.create` test-hook, idempotent `ensureInitialized`, soft-delete
 *     default.
 *
 * Soft-delete: `deleted_at` settes + status = 'inactive'. Hard-delete
 * blokkeres hvis GameType er referert fra:
 *   - app_game_management.game_type_id (aktive spill-oppsett)
 *   - app_patterns.game_type_id (mønster-katalog, BIN-627)
 *   - app_sub_games.game_type_id (sub-game-katalog, BIN-621)
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "game-type-service" });

export type GameTypeStatus = "active" | "inactive";

const VALID_STATUS: GameTypeStatus[] = ["active", "inactive"];

export interface GameType {
  id: string;
  typeSlug: string;
  name: string;
  photo: string;
  pattern: boolean;
  gridRows: number;
  gridColumns: number;
  rangeMin: number | null;
  rangeMax: number | null;
  totalNoTickets: number | null;
  userMaxTickets: number | null;
  luckyNumbers: number[];
  status: GameTypeStatus;
  extra: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateGameTypeInput {
  typeSlug: string;
  name: string;
  photo?: string;
  pattern?: boolean;
  gridRows?: number;
  gridColumns?: number;
  rangeMin?: number | null;
  rangeMax?: number | null;
  totalNoTickets?: number | null;
  userMaxTickets?: number | null;
  luckyNumbers?: number[];
  status?: GameTypeStatus;
  extra?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateGameTypeInput {
  typeSlug?: string;
  name?: string;
  photo?: string;
  pattern?: boolean;
  gridRows?: number;
  gridColumns?: number;
  rangeMin?: number | null;
  rangeMax?: number | null;
  totalNoTickets?: number | null;
  userMaxTickets?: number | null;
  luckyNumbers?: number[];
  status?: GameTypeStatus;
  extra?: Record<string, unknown>;
}

export interface ListGameTypeFilter {
  status?: GameTypeStatus;
  limit?: number;
  includeDeleted?: boolean;
}

export interface GameTypeServiceOptions {
  connectionString: string;
  schema?: string;
}

/**
 * Hook for referent-sjekk. Returnerer `true` hvis GameType er i bruk
 * (GameManagement, Pattern, SubGame). Service bruker dette til å blokkere
 * hard-delete og ved status-endring til inactive (advarsel, ikke blokkering).
 */
export type GameTypeReferenceChecker = (gameTypeId: string) => Promise<boolean>;

interface GameTypeRow {
  id: string;
  type_slug: string;
  name: string;
  photo: string;
  pattern: boolean;
  grid_rows: number;
  grid_columns: number;
  range_min: number | null;
  range_max: number | null;
  total_no_tickets: number | null;
  user_max_tickets: number | null;
  lucky_numbers_json: unknown;
  status: GameTypeStatus;
  extra_json: Record<string, unknown>;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertNonEmptyString(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} kan maksimalt være ${max} tegn.`
    );
  }
  return trimmed;
}

function assertStatus(value: unknown): GameTypeStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as GameTypeStatus;
  if (!VALID_STATUS.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `status må være én av ${VALID_STATUS.join(", ")}.`
    );
  }
  return v;
}

function assertPositiveInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et positivt heltall.`
    );
  }
  return n;
}

function assertIntOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et heltall eller null.`
    );
  }
  return n;
}

function assertPositiveIntOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et positivt heltall eller null.`
    );
  }
  return n;
}

function assertLuckyNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "luckyNumbers må være en liste.");
  }
  const result: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const n = Number(item);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new DomainError(
        "INVALID_INPUT",
        "luckyNumbers må være en liste av heltall."
      );
    }
    if (seen.has(n)) continue;
    seen.add(n);
    result.push(n);
  }
  return result;
}

function assertExtra(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "extra må være et objekt.");
  }
  return value as Record<string, unknown>;
}

function parseLuckyNumbers(raw: unknown): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && Number.isInteger(n));
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n) && Number.isInteger(n));
      }
    } catch {
      return [];
    }
  }
  return [];
}

export class GameTypeService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly referenceChecker: GameTypeReferenceChecker | null;
  private initPromise: Promise<void> | null = null;

  constructor(
    options: GameTypeServiceOptions,
    referenceChecker: GameTypeReferenceChecker | null = null
  ) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for GameTypeService."
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
    this.referenceChecker = referenceChecker;
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    schema = "public",
    referenceChecker: GameTypeReferenceChecker | null = null
  ): GameTypeService {
    const svc = Object.create(GameTypeService.prototype) as GameTypeService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    (svc as unknown as {
      referenceChecker: GameTypeReferenceChecker | null;
    }).referenceChecker = referenceChecker;
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_game_types"`;
  }

  async list(filter: ListGameTypeFilter = {}): Promise<GameType[]> {
    await this.ensureInitialized();
    const limit =
      filter.limit && filter.limit > 0
        ? Math.min(Math.floor(filter.limit), 500)
        : 200;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.status) {
      params.push(assertStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<GameTypeRow>(
      `SELECT id, type_slug, name, photo, pattern,
              grid_rows, grid_columns, range_min, range_max,
              total_no_tickets, user_max_tickets, lucky_numbers_json,
              status, extra_json, created_by,
              created_at, updated_at, deleted_at
       FROM ${this.table()}
       ${where}
       ORDER BY name ASC, created_at ASC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((row) => this.mapRow(row));
  }

  async get(id: string): Promise<GameType> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<GameTypeRow>(
      `SELECT id, type_slug, name, photo, pattern,
              grid_rows, grid_columns, range_min, range_max,
              total_no_tickets, user_max_tickets, lucky_numbers_json,
              status, extra_json, created_by,
              created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("GAME_TYPE_NOT_FOUND", "GameType finnes ikke.");
    }
    return this.mapRow(row);
  }

  /** Hent GameType via type_slug. Returnerer null hvis ikke funnet. */
  async getBySlug(slug: string): Promise<GameType | null> {
    await this.ensureInitialized();
    if (!slug?.trim()) {
      throw new DomainError("INVALID_INPUT", "slug er påkrevd.");
    }
    const { rows } = await this.pool.query<GameTypeRow>(
      `SELECT id, type_slug, name, photo, pattern,
              grid_rows, grid_columns, range_min, range_max,
              total_no_tickets, user_max_tickets, lucky_numbers_json,
              status, extra_json, created_by,
              created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE type_slug = $1 AND deleted_at IS NULL`,
      [slug.trim()]
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async create(input: CreateGameTypeInput): Promise<GameType> {
    await this.ensureInitialized();
    const typeSlug = assertNonEmptyString(input.typeSlug, "typeSlug");
    const name = assertNonEmptyString(input.name, "name");
    const photo =
      input.photo !== undefined
        ? typeof input.photo === "string"
          ? input.photo.trim()
          : ""
        : "";
    if (photo.length > 500) {
      throw new DomainError(
        "INVALID_INPUT",
        "photo kan maksimalt være 500 tegn."
      );
    }
    const pattern = input.pattern === true;
    const gridRows =
      input.gridRows !== undefined ? assertPositiveInt(input.gridRows, "gridRows") : 5;
    const gridColumns =
      input.gridColumns !== undefined
        ? assertPositiveInt(input.gridColumns, "gridColumns")
        : 5;
    const rangeMin =
      input.rangeMin !== undefined ? assertIntOrNull(input.rangeMin, "rangeMin") : null;
    const rangeMax =
      input.rangeMax !== undefined ? assertIntOrNull(input.rangeMax, "rangeMax") : null;
    if (rangeMin !== null && rangeMax !== null && rangeMax < rangeMin) {
      throw new DomainError(
        "INVALID_INPUT",
        "rangeMax må være >= rangeMin."
      );
    }
    const totalNoTickets =
      input.totalNoTickets !== undefined
        ? assertPositiveIntOrNull(input.totalNoTickets, "totalNoTickets")
        : null;
    const userMaxTickets =
      input.userMaxTickets !== undefined
        ? assertPositiveIntOrNull(input.userMaxTickets, "userMaxTickets")
        : null;
    const luckyNumbers =
      input.luckyNumbers !== undefined ? assertLuckyNumbers(input.luckyNumbers) : [];
    const status = input.status ? assertStatus(input.status) : "active";
    const extra = assertExtra(input.extra);
    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.table()}
           (id, type_slug, name, photo, pattern,
            grid_rows, grid_columns, range_min, range_max,
            total_no_tickets, user_max_tickets, lucky_numbers_json,
            status, extra_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15)`,
        [
          id,
          typeSlug,
          name,
          photo,
          pattern,
          gridRows,
          gridColumns,
          rangeMin,
          rangeMax,
          totalNoTickets,
          userMaxTickets,
          JSON.stringify(luckyNumbers),
          status,
          JSON.stringify(extra),
          input.createdBy,
        ]
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "GAME_TYPE_DUPLICATE",
          `GameType med slug '${typeSlug}' eller navn '${name}' finnes allerede.`
        );
      }
      throw err;
    }
    return this.get(id);
  }

  async update(id: string, update: UpdateGameTypeInput): Promise<GameType> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "GAME_TYPE_DELETED",
        "GameType er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.typeSlug !== undefined) {
      sets.push(`type_slug = $${params.length + 1}`);
      params.push(assertNonEmptyString(update.typeSlug, "typeSlug"));
    }
    if (update.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(assertNonEmptyString(update.name, "name"));
    }
    if (update.photo !== undefined) {
      const photo = typeof update.photo === "string" ? update.photo.trim() : "";
      if (photo.length > 500) {
        throw new DomainError(
          "INVALID_INPUT",
          "photo kan maksimalt være 500 tegn."
        );
      }
      sets.push(`photo = $${params.length + 1}`);
      params.push(photo);
    }
    if (update.pattern !== undefined) {
      if (typeof update.pattern !== "boolean") {
        throw new DomainError("INVALID_INPUT", "pattern må være boolean.");
      }
      sets.push(`pattern = $${params.length + 1}`);
      params.push(update.pattern);
    }
    if (update.gridRows !== undefined) {
      sets.push(`grid_rows = $${params.length + 1}`);
      params.push(assertPositiveInt(update.gridRows, "gridRows"));
    }
    if (update.gridColumns !== undefined) {
      sets.push(`grid_columns = $${params.length + 1}`);
      params.push(assertPositiveInt(update.gridColumns, "gridColumns"));
    }
    if (update.rangeMin !== undefined) {
      sets.push(`range_min = $${params.length + 1}`);
      params.push(assertIntOrNull(update.rangeMin, "rangeMin"));
    }
    if (update.rangeMax !== undefined) {
      sets.push(`range_max = $${params.length + 1}`);
      params.push(assertIntOrNull(update.rangeMax, "rangeMax"));
    }
    if (update.totalNoTickets !== undefined) {
      sets.push(`total_no_tickets = $${params.length + 1}`);
      params.push(
        assertPositiveIntOrNull(update.totalNoTickets, "totalNoTickets")
      );
    }
    if (update.userMaxTickets !== undefined) {
      sets.push(`user_max_tickets = $${params.length + 1}`);
      params.push(
        assertPositiveIntOrNull(update.userMaxTickets, "userMaxTickets")
      );
    }
    if (update.luckyNumbers !== undefined) {
      sets.push(`lucky_numbers_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertLuckyNumbers(update.luckyNumbers)));
    }
    if (update.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(assertStatus(update.status));
    }
    if (update.extra !== undefined) {
      sets.push(`extra_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertExtra(update.extra)));
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }

    // Cross-field: valider rangeMin <= rangeMax hvis begge er satt.
    // Vi må resolve til slutt-verdier (eksisterende + oppdatering) for å
    // sjekke invariantet.
    const newRangeMin =
      update.rangeMin !== undefined
        ? assertIntOrNull(update.rangeMin, "rangeMin")
        : existing.rangeMin;
    const newRangeMax =
      update.rangeMax !== undefined
        ? assertIntOrNull(update.rangeMax, "rangeMax")
        : existing.rangeMax;
    if (newRangeMin !== null && newRangeMax !== null && newRangeMax < newRangeMin) {
      throw new DomainError("INVALID_INPUT", "rangeMax må være >= rangeMin.");
    }

    sets.push("updated_at = now()");
    params.push(existing.id);
    try {
      await this.pool.query(
        `UPDATE ${this.table()}
         SET ${sets.join(", ")}
         WHERE id = $${params.length}`,
        params
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "GAME_TYPE_DUPLICATE",
          "GameType-slug eller navn finnes allerede."
        );
      }
      throw err;
    }
    return this.get(existing.id);
  }

  /**
   * Default: soft-delete (sett deleted_at + status = 'inactive'). Hvis
   * `hard=true` og gameType ikke er referert, kan hard-delete brukes.
   */
  async remove(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "GAME_TYPE_DELETED",
        "GameType er allerede slettet."
      );
    }

    if (options.hard === true) {
      const referenced = await this.isReferenced(existing.id, existing.typeSlug);
      if (referenced) {
        throw new DomainError(
          "GAME_TYPE_IN_USE",
          "GameType er referert fra GameManagement, Pattern eller SubGame — kan ikke hard-slettes."
        );
      }
      await this.pool.query(`DELETE FROM ${this.table()} WHERE id = $1`, [
        existing.id,
      ]);
      return { softDeleted: false };
    }

    await this.pool.query(
      `UPDATE ${this.table()}
       SET deleted_at = now(), status = 'inactive', updated_at = now()
       WHERE id = $1`,
      [existing.id]
    );
    return { softDeleted: true };
  }

  /** Telle GameTypes (aktive + ikke-slettet). Brukes av dashboard-widget. */
  async count(filter: ListGameTypeFilter = {}): Promise<number> {
    await this.ensureInitialized();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.status) {
      params.push(assertStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query<{ c: string | number }>(
      `SELECT COUNT(*)::bigint AS c FROM ${this.table()} ${where}`,
      params
    );
    return Number(rows[0]?.c ?? 0);
  }

  /**
   * Sjekk om GameType er referert fra GameManagement/Pattern/SubGame.
   * Brukes av hard-delete-flyt. Støtter både id-basert lookup og slug-
   * basert (legacy app_game_management lagrer game_type_id som stabil slug).
   */
  private async isReferenced(
    gameTypeId: string,
    typeSlug: string
  ): Promise<boolean> {
    if (this.referenceChecker) {
      return this.referenceChecker(gameTypeId);
    }
    const gmTable = `"${this.schema}"."app_game_management"`;
    const ptTable = `"${this.schema}"."app_patterns"`;
    const sgTable = `"${this.schema}"."app_sub_games"`;
    try {
      const candidates = [gameTypeId, typeSlug];
      const { rows: gm } = await this.pool.query<{ n: string | number }>(
        `SELECT COUNT(*)::bigint AS n
         FROM ${gmTable}
         WHERE deleted_at IS NULL AND game_type_id = ANY($1::text[])`,
        [candidates]
      );
      if (Number(gm[0]?.n ?? 0) > 0) return true;
      const { rows: pt } = await this.pool.query<{ n: string | number }>(
        `SELECT COUNT(*)::bigint AS n
         FROM ${ptTable}
         WHERE deleted_at IS NULL AND game_type_id = ANY($1::text[])`,
        [candidates]
      );
      if (Number(pt[0]?.n ?? 0) > 0) return true;
      // SubGame-tabell kan ikke finnes ennå (BIN-621 kjører i samme bundle).
      // Prøv forsiktig — hvis tabellen mangler returnerer vi false.
      try {
        const { rows: sg } = await this.pool.query<{ n: string | number }>(
          `SELECT COUNT(*)::bigint AS n
           FROM ${sgTable}
           WHERE deleted_at IS NULL AND game_type_id = ANY($1::text[])`,
          [candidates]
        );
        if (Number(sg[0]?.n ?? 0) > 0) return true;
      } catch (err) {
        // Tabell finnes ikke ennå — forventet før BIN-621 migration kjører.
        logger.debug({ err }, "[BIN-620] sub_games-tabell finnes ikke (ennå)");
      }
      return false;
    } catch (err) {
      logger.warn(
        { err },
        "[BIN-620] referent-sjekk feilet — antar ingen referanser"
      );
      return false;
    }
  }

  private mapRow(row: GameTypeRow): GameType {
    return {
      id: row.id,
      typeSlug: row.type_slug,
      name: row.name,
      photo: row.photo,
      pattern: row.pattern,
      gridRows: Number(row.grid_rows),
      gridColumns: Number(row.grid_columns),
      rangeMin: row.range_min === null ? null : Number(row.range_min),
      rangeMax: row.range_max === null ? null : Number(row.range_max),
      totalNoTickets:
        row.total_no_tickets === null ? null : Number(row.total_no_tickets),
      userMaxTickets:
        row.user_max_tickets === null ? null : Number(row.user_max_tickets),
      luckyNumbers: parseLuckyNumbers(row.lucky_numbers_json),
      status: row.status,
      extra: (row.extra_json ?? {}) as Record<string, unknown>,
      createdBy: row.created_by,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
      deletedAt: asIsoOrNull(row.deleted_at),
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
          type_slug TEXT NOT NULL,
          name TEXT NOT NULL,
          photo TEXT NOT NULL DEFAULT '',
          pattern BOOLEAN NOT NULL DEFAULT false,
          grid_rows INTEGER NOT NULL DEFAULT 5 CHECK (grid_rows > 0),
          grid_columns INTEGER NOT NULL DEFAULT 5 CHECK (grid_columns > 0),
          range_min INTEGER NULL,
          range_max INTEGER NULL,
          total_no_tickets INTEGER NULL
            CHECK (total_no_tickets IS NULL OR total_no_tickets > 0),
          user_max_tickets INTEGER NULL
            CHECK (user_max_tickets IS NULL OR user_max_tickets > 0),
          lucky_numbers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'inactive')),
          extra_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL,
          CHECK (range_min IS NULL OR range_max IS NULL OR range_max >= range_min)
        )`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_game_types_type_slug
         ON ${this.table()}(type_slug) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_game_types_name
         ON ${this.table()}(name) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_game_types_status
         ON ${this.table()}(status) WHERE deleted_at IS NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-620] game_types schema init failed");
      throw new DomainError(
        "GAME_TYPE_INIT_FAILED",
        "Kunne ikke initialisere game_types-tabell."
      );
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code: unknown }).code === "23505";
  }
  return false;
}
