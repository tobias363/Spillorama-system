/**
 * BIN-621: SubGame admin-service.
 *
 * Admin-CRUD for gjenbrukbare SubGame-maler (navngitte bundles av pattern-
 * ids + ticket-farger). DailySchedule (BIN-626) binder inn SubGame-ids via
 * subgames_json. Legacy Mongo-schema `subGame1`
 * `app_sub_games` med egne kolonner for de feltene som brukes aktivt og
 * JSON-fallback for resten.
 *
 * Gjenbruk:
 *   - Samme mønster som GameTypeService (BIN-620), PatternService (BIN-627),
 *     HallGroupService (BIN-665).
 *   - `Object.create` test-hook, idempotent `ensureInitialized`, soft-delete
 *     default.
 *
 * Soft-delete: `deleted_at` settes + status = 'inactive'. Hard-delete
 * blokkeres hvis SubGame er referert fra:
 *   - app_daily_schedules.subgames_json (JSON array av subGame-ids)
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "sub-game-service" });

export type SubGameStatus = "active" | "inactive";

const VALID_STATUS: SubGameStatus[] = ["active", "inactive"];

/**
 * Pattern-referanse i en SubGame. Wire-format eksponerer kun {patternId,
 * name}; JSON-lagringen kan inneholde flere legacy-felter (patternType, isWoF,
 * m.m.) som service-laget bevarer i extra_json-speilet ved behov.
 */
export interface SubGamePatternRef {
  patternId: string;
  name: string;
}

export interface SubGame {
  id: string;
  gameTypeId: string;
  gameName: string;
  name: string;
  subGameNumber: string;
  patternRows: SubGamePatternRef[];
  ticketColors: string[];
  status: SubGameStatus;
  extra: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateSubGameInput {
  gameTypeId: string;
  gameName?: string;
  name: string;
  /** Auto-genereres av service hvis ikke satt. */
  subGameNumber?: string;
  patternRows?: SubGamePatternRef[];
  ticketColors?: string[];
  status?: SubGameStatus;
  extra?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateSubGameInput {
  gameName?: string;
  name?: string;
  subGameNumber?: string;
  patternRows?: SubGamePatternRef[];
  ticketColors?: string[];
  status?: SubGameStatus;
  extra?: Record<string, unknown>;
}

export interface ListSubGameFilter {
  gameTypeId?: string;
  status?: SubGameStatus;
  limit?: number;
  includeDeleted?: boolean;
}

export interface SubGameServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

/**
 * Hook for referent-sjekk. Returnerer `true` hvis SubGame er i bruk
 * (DailySchedule). Service bruker dette til å blokkere hard-delete.
 */
export type SubGameReferenceChecker = (subGameId: string) => Promise<boolean>;

interface SubGameRow {
  id: string;
  game_type_id: string;
  game_name: string;
  name: string;
  sub_game_number: string;
  pattern_rows_json: unknown;
  ticket_colors_json: unknown;
  status: SubGameStatus;
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

function assertStatus(value: unknown): SubGameStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as SubGameStatus;
  if (!VALID_STATUS.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `status må være én av ${VALID_STATUS.join(", ")}.`
    );
  }
  return v;
}

/**
 * Valider + normaliser pattern-rows. Wire-kontrakten krever {patternId, name}
 * per rad; vi dedupliserer på patternId for å unngå samme mønster flere
 * ganger i samme SubGame. Ekstra felter i raw-inputen ignoreres (men kan
 * bevares i extra_json hvis kallsteden trenger det).
 */
function assertPatternRows(value: unknown): SubGamePatternRef[] {
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "patternRows må være en liste.");
  }
  const result: SubGamePatternRef[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new DomainError(
        "INVALID_INPUT",
        "patternRows må være liste av objekter."
      );
    }
    const obj = raw as Record<string, unknown>;
    const patternId = assertNonEmptyString(obj.patternId, "patternRows[].patternId");
    const name = assertNonEmptyString(obj.name, "patternRows[].name");
    if (seen.has(patternId)) continue;
    seen.add(patternId);
    result.push({ patternId, name });
  }
  return result;
}

/**
 * Valider + normaliser ticket-colors. Wire-kontrakten er string[]; vi
 * dedupliserer (trim + lowercase compare) og kaster på tomme strenger.
 */
function assertTicketColors(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "ticketColors må være en liste.");
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new DomainError(
        "INVALID_INPUT",
        "ticketColors må være en liste av ikke-tomme strenger."
      );
    }
    const trimmed = raw.trim();
    if (trimmed.length > 100) {
      throw new DomainError(
        "INVALID_INPUT",
        "ticketColors-verdi kan maksimalt være 100 tegn."
      );
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
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

function parsePatternRows(raw: unknown): SubGamePatternRef[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (v): v is { patternId: unknown; name: unknown } =>
          !!v && typeof v === "object" && !Array.isArray(v)
      )
      .map((v) => ({
        patternId: String((v as { patternId: unknown }).patternId ?? ""),
        name: String((v as { name: unknown }).name ?? ""),
      }))
      .filter((v) => v.patternId && v.name);
  }
  if (typeof raw === "string") {
    try {
      return parsePatternRows(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function parseTicketColors(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((v) => {
        if (typeof v === "string") return v;
        if (v && typeof v === "object" && "name" in v) {
          const n = (v as { name: unknown }).name;
          return typeof n === "string" ? n : "";
        }
        return "";
      })
      .filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    try {
      return parseTicketColors(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Generer legacy-kompatibel sub_game_number ("SG_<YYYYMMDD>_<HHMMSS>") når
 * kaller ikke sender egen. Unikhet håndheves av partial unique index; hvis
 * to requests lander innen samme sekund blir den andre avvist med
 * SUB_GAME_DUPLICATE og kaller kan retry'e.
 */
function generateSubGameNumber(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  return `SG_${y}${m}${d}_${h}${mi}${s}`;
}

export class SubGameService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly referenceChecker: SubGameReferenceChecker | null;
  private initPromise: Promise<void> | null = null;

  constructor(
    options: SubGameServiceOptions,
    referenceChecker: SubGameReferenceChecker | null = null
  ) {
    this.schema = assertSchemaName(options.schema ?? "public");
    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "SubGameService krever pool eller connectionString."
      );
    }
    this.referenceChecker = referenceChecker;
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    schema = "public",
    referenceChecker: SubGameReferenceChecker | null = null
  ): SubGameService {
    const svc = Object.create(SubGameService.prototype) as SubGameService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    (svc as unknown as {
      referenceChecker: SubGameReferenceChecker | null;
    }).referenceChecker = referenceChecker;
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_sub_games"`;
  }

  async list(filter: ListSubGameFilter = {}): Promise<SubGame[]> {
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
    if (filter.gameTypeId !== undefined) {
      params.push(assertNonEmptyString(filter.gameTypeId, "gameTypeId"));
      conditions.push(`game_type_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(assertStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<SubGameRow>(
      `SELECT id, game_type_id, game_name, name, sub_game_number,
              pattern_rows_json, ticket_colors_json,
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

  async get(id: string): Promise<SubGame> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<SubGameRow>(
      `SELECT id, game_type_id, game_name, name, sub_game_number,
              pattern_rows_json, ticket_colors_json,
              status, extra_json, created_by,
              created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("SUB_GAME_NOT_FOUND", "SubGame finnes ikke.");
    }
    return this.mapRow(row);
  }

  async create(input: CreateSubGameInput): Promise<SubGame> {
    await this.ensureInitialized();
    const gameTypeId = assertNonEmptyString(input.gameTypeId, "gameTypeId");
    const name = assertNonEmptyString(input.name, "name");
    const gameName =
      input.gameName !== undefined
        ? assertNonEmptyString(input.gameName, "gameName")
        : name;
    const subGameNumber =
      input.subGameNumber !== undefined
        ? assertNonEmptyString(input.subGameNumber, "subGameNumber")
        : generateSubGameNumber();
    const patternRows =
      input.patternRows !== undefined ? assertPatternRows(input.patternRows) : [];
    const ticketColors =
      input.ticketColors !== undefined
        ? assertTicketColors(input.ticketColors)
        : [];
    const status = input.status ? assertStatus(input.status) : "active";
    const extra = assertExtra(input.extra);
    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.table()}
           (id, game_type_id, game_name, name, sub_game_number,
            pattern_rows_json, ticket_colors_json,
            status, extra_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10)`,
        [
          id,
          gameTypeId,
          gameName,
          name,
          subGameNumber,
          JSON.stringify(patternRows),
          JSON.stringify(ticketColors),
          status,
          JSON.stringify(extra),
          input.createdBy,
        ]
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "SUB_GAME_DUPLICATE",
          `SubGame med navn '${name}' eller nummer '${subGameNumber}' finnes allerede.`
        );
      }
      throw err;
    }
    return this.get(id);
  }

  async update(id: string, update: UpdateSubGameInput): Promise<SubGame> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "SUB_GAME_DELETED",
        "SubGame er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.gameName !== undefined) {
      sets.push(`game_name = $${params.length + 1}`);
      params.push(assertNonEmptyString(update.gameName, "gameName"));
    }
    if (update.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(assertNonEmptyString(update.name, "name"));
    }
    if (update.subGameNumber !== undefined) {
      sets.push(`sub_game_number = $${params.length + 1}`);
      params.push(assertNonEmptyString(update.subGameNumber, "subGameNumber"));
    }
    if (update.patternRows !== undefined) {
      sets.push(`pattern_rows_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertPatternRows(update.patternRows)));
    }
    if (update.ticketColors !== undefined) {
      sets.push(`ticket_colors_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertTicketColors(update.ticketColors)));
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
          "SUB_GAME_DUPLICATE",
          "SubGame-navn eller nummer finnes allerede."
        );
      }
      throw err;
    }
    return this.get(existing.id);
  }

  /**
   * Default: soft-delete (sett deleted_at + status = 'inactive'). Hvis
   * `hard=true` og SubGame ikke er referert, kan hard-delete brukes.
   */
  async remove(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "SUB_GAME_DELETED",
        "SubGame er allerede slettet."
      );
    }

    if (options.hard === true) {
      const referenced = await this.isReferenced(
        existing.id,
        existing.subGameNumber
      );
      if (referenced) {
        throw new DomainError(
          "SUB_GAME_IN_USE",
          "SubGame er referert fra DailySchedule — kan ikke hard-slettes."
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

  /** Tell SubGames (aktive + ikke-slettet). Brukes av dashboard-widget. */
  async count(filter: ListSubGameFilter = {}): Promise<number> {
    await this.ensureInitialized();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.gameTypeId !== undefined) {
      params.push(assertNonEmptyString(filter.gameTypeId, "gameTypeId"));
      conditions.push(`game_type_id = $${params.length}`);
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
   * Sjekk om SubGame er referert fra DailySchedule (subgames_json).
   * Brukes av hard-delete-flyt. Støtter både id-basert lookup og legacy
   * sub_game_number-basert (DailySchedule kan inneholde gamle SG_-strenger).
   */
  private async isReferenced(
    subGameId: string,
    subGameNumber: string
  ): Promise<boolean> {
    if (this.referenceChecker) {
      return this.referenceChecker(subGameId);
    }
    const dsTable = `"${this.schema}"."app_daily_schedules"`;
    try {
      const candidates = [subGameId, subGameNumber];
      // subgames_json kan være:
      //   - array av strings (id-er eller SG_-nummer)
      //   - array av objekter {subGameId: "..."} (legacy)
      // jsonb_path_exists dekker begge formene med en OR-sjekk.
      const { rows } = await this.pool.query<{ n: string | number }>(
        `SELECT COUNT(*)::bigint AS n
         FROM ${dsTable}
         WHERE deleted_at IS NULL
           AND (
             subgames_json ?| $1::text[]
             OR EXISTS (
               SELECT 1 FROM jsonb_array_elements(subgames_json) AS elem
               WHERE jsonb_typeof(elem) = 'object'
                 AND elem ->> 'subGameId' = ANY($1::text[])
             )
           )`,
        [candidates]
      );
      if (Number(rows[0]?.n ?? 0) > 0) return true;
      return false;
    } catch (err) {
      logger.warn(
        { err },
        "[BIN-621] referent-sjekk feilet — antar ingen referanser"
      );
      return false;
    }
  }

  private mapRow(row: SubGameRow): SubGame {
    return {
      id: row.id,
      gameTypeId: row.game_type_id,
      gameName: row.game_name,
      name: row.name,
      subGameNumber: row.sub_game_number,
      patternRows: parsePatternRows(row.pattern_rows_json),
      ticketColors: parseTicketColors(row.ticket_colors_json),
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
          game_type_id TEXT NOT NULL,
          game_name TEXT NOT NULL,
          name TEXT NOT NULL,
          sub_game_number TEXT NOT NULL,
          pattern_rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          ticket_colors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'inactive')),
          extra_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL
        )`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_sub_games_name_per_type
         ON ${this.table()}(game_type_id, name) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_sub_games_sub_game_number
         ON ${this.table()}(sub_game_number) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_sub_games_game_type
         ON ${this.table()}(game_type_id) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_sub_games_status
         ON ${this.table()}(status) WHERE deleted_at IS NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-621] sub_games schema init failed");
      throw new DomainError(
        "SUB_GAME_INIT_FAILED",
        "Kunne ikke initialisere sub_games-tabell."
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
