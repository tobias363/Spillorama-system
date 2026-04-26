/**
 * BIN-624: SavedGame admin-service.
 *
 * Admin-CRUD for SavedGame-templates (gjenbrukbare GameManagement-oppsett).
 * En SavedGame er IKKE et kjørbart spill — det er en template som admin
 * lagrer for senere "load-to-game"-bruk. load-to-game-flyten kopierer
 * config_json inn i et nytt `app_game_management`-oppsett (BIN-622).
 * (insertSavedGameData / getByIdSavedGames / updateSaveGameData).
 *
 * Mønster: samme struktur som SubGameService (BIN-621), GameTypeService
 * (BIN-620) og CloseDayService (BIN-623). Object.create test-hook,
 * idempotent ensureInitialized, soft-delete default.
 *
 * Load-to-game-semantikk:
 *   - `loadToGame()` returnerer config-snapshot som caller kan sende til
 *     GameManagementService.create(). Service mutates ikke SavedGame-raden
 *     (bare leser); audit-skrivning ligger i router-laget der IP/UA er
 *     tilgjengelig (samme mønster som CloseDay).
 *   - Vi delegerer IKKE GameManagement-opprettelsen hit for å unngå
 *     sirkulær avhengighet (GameManagementService kjenner ikke SavedGame).
 *     Router-laget koordinerer: load() → GameManagementService.create().
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "saved-game-service" });

export type SavedGameStatus = "active" | "inactive";

const VALID_STATUS: SavedGameStatus[] = ["active", "inactive"];

/**
 * En persisterte SavedGame-rad. `config` er en fri-form Record — legacy
 * savedGame hadde ~50 felter (ticket-priser, farger, patterns, subgames,
 * halls, days, betMultiplier, prize-tiers, ...). Vi bevarer payloaden i
 * sin helhet i v1 slik at load-to-game kan reprodusere et identisk
 * GameManagement-oppsett. Service validerer kun at det er et objekt.
 */
export interface SavedGame {
  id: string;
  gameTypeId: string;
  name: string;
  isAdminSave: boolean;
  config: Record<string, unknown>;
  status: SavedGameStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateSavedGameInput {
  gameTypeId: string;
  name: string;
  isAdminSave?: boolean;
  config?: Record<string, unknown>;
  status?: SavedGameStatus;
  createdBy: string;
}

export interface UpdateSavedGameInput {
  name?: string;
  isAdminSave?: boolean;
  config?: Record<string, unknown>;
  status?: SavedGameStatus;
}

export interface ListSavedGameFilter {
  gameTypeId?: string;
  status?: SavedGameStatus;
  createdBy?: string;
  limit?: number;
  includeDeleted?: boolean;
}

/**
 * Resultat fra loadToGame(). `config` er en dyp kopi slik at caller kan
 * mutere returverdi uten å påvirke lagret mal.
 */
export interface SavedGameLoadPayload {
  savedGameId: string;
  gameTypeId: string;
  name: string;
  config: Record<string, unknown>;
}

/**
 * Resultat fra applyToSchedule(). Speiler SavedGameLoadPayload — read-only
 * snapshot som router-laget bruker for å overskrive en eksisterende
 * DailySchedule (i motsetning til loadToGame som er ment for å opprette
 * et helt nytt GameManagement-oppsett).
 */
export interface SavedGameApplyPayload {
  savedGameId: string;
  gameTypeId: string;
  name: string;
  config: Record<string, unknown>;
}

/** Input for saveFromSchedule — sub-set av CreateSavedGameInput. */
export interface SaveFromScheduleInput {
  templateName: string;
  gameTypeId: string;
  config: Record<string, unknown>;
  createdBy: string;
  /** Valgfri beskrivelse — embeddes i `config.description` for senere oppslag. */
  description?: string;
}

export interface SavedGameServiceOptions {
  connectionString: string;
  schema?: string;
}

interface SavedGameRow {
  id: string;
  game_type_id: string;
  name: string;
  is_admin_save: boolean;
  config_json: unknown;
  status: SavedGameStatus;
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

function assertStatus(value: unknown): SavedGameStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as SavedGameStatus;
  if (!VALID_STATUS.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `status må være én av ${VALID_STATUS.join(", ")}.`
    );
  }
  return v;
}

/**
 * Config må være et objekt (ikke array, ikke null). Felt-innhold valideres
 * IKKE — legacy savedGame hadde ~50 fri-form-felter som varierer per
 * gameType. GameManagement-layeret (BIN-622) gjør semantisk validering
 * når load-to-game-resultatet inngår i et nytt GameManagement-oppsett.
 */
function assertConfig(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "config må være et objekt.");
  }
  return value as Record<string, unknown>;
}

function parseConfig(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to empty
    }
  }
  return {};
}

/** Dyp kopi via JSON round-trip — SavedGame config er ren data. */
function cloneConfig(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

export class SavedGameService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: SavedGameServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for SavedGameService."
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): SavedGameService {
    const svc = Object.create(SavedGameService.prototype) as SavedGameService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_saved_games"`;
  }

  async list(filter: ListSavedGameFilter = {}): Promise<SavedGame[]> {
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
    if (filter.createdBy !== undefined) {
      params.push(assertNonEmptyString(filter.createdBy, "createdBy"));
      conditions.push(`created_by = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<SavedGameRow>(
      `SELECT id, game_type_id, name, is_admin_save, config_json,
              status, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       ${where}
       ORDER BY name ASC, created_at ASC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((row) => this.mapRow(row));
  }

  async get(id: string): Promise<SavedGame> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<SavedGameRow>(
      `SELECT id, game_type_id, name, is_admin_save, config_json,
              status, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("SAVED_GAME_NOT_FOUND", "SavedGame finnes ikke.");
    }
    return this.mapRow(row);
  }

  async create(input: CreateSavedGameInput): Promise<SavedGame> {
    await this.ensureInitialized();
    const gameTypeId = assertNonEmptyString(input.gameTypeId, "gameTypeId");
    const name = assertNonEmptyString(input.name, "name");
    const config = assertConfig(input.config);
    const status = input.status ? assertStatus(input.status) : "active";
    const isAdminSave = input.isAdminSave !== false; // default true
    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.table()}
           (id, game_type_id, name, is_admin_save, config_json,
            status, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          id,
          gameTypeId,
          name,
          isAdminSave,
          JSON.stringify(config),
          status,
          input.createdBy,
        ]
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "SAVED_GAME_DUPLICATE",
          `SavedGame med navn '${name}' finnes allerede for denne gameType.`
        );
      }
      throw err;
    }
    return this.get(id);
  }

  async update(id: string, update: UpdateSavedGameInput): Promise<SavedGame> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "SAVED_GAME_DELETED",
        "SavedGame er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(assertNonEmptyString(update.name, "name"));
    }
    if (update.isAdminSave !== undefined) {
      if (typeof update.isAdminSave !== "boolean") {
        throw new DomainError(
          "INVALID_INPUT",
          "isAdminSave må være en boolean."
        );
      }
      sets.push(`is_admin_save = $${params.length + 1}`);
      params.push(update.isAdminSave);
    }
    if (update.config !== undefined) {
      sets.push(`config_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertConfig(update.config)));
    }
    if (update.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(assertStatus(update.status));
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
          "SAVED_GAME_DUPLICATE",
          "SavedGame-navn finnes allerede for denne gameType."
        );
      }
      throw err;
    }
    return this.get(existing.id);
  }

  /**
   * Default: soft-delete (sett deleted_at + status = 'inactive'). Hvis
   * `hard=true`, slettes raden permanent. Ingen andre tabeller refererer
   * SavedGame (load-to-game kopierer config ved bruk, så ingen FK).
   */
  async remove(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "SAVED_GAME_DELETED",
        "SavedGame er allerede slettet."
      );
    }

    if (options.hard === true) {
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

  /**
   * Last en SavedGame-template som forberedelse for å opprette et nytt
   * GameManagement-oppsett. Mutates ikke raden. Router-laget koordinerer
   * den faktiske GameManagement.create()-kallen + audit-log-skriving.
   *
   * Forretningsregler:
   *   - SavedGame må ikke være slettet (deleted_at IS NULL).
   *   - SavedGame må være active (status='active'). Inaktive maler er
   *     skjult fra load-to-game-dropdowns i admin-UI men kan re-aktiveres
   *     via PATCH. Denne regel matcher legacy isSavedGame=true-query
   *     (som hadde status="active").
   */
  async loadToGame(id: string): Promise<SavedGameLoadPayload> {
    const saved = await this.get(id);
    if (saved.deletedAt) {
      throw new DomainError(
        "SAVED_GAME_DELETED",
        "SavedGame er slettet — kan ikke lastes inn som nytt spill."
      );
    }
    if (saved.status !== "active") {
      throw new DomainError(
        "SAVED_GAME_INACTIVE",
        "SavedGame må være active for å kunne lastes inn som nytt spill."
      );
    }
    return {
      savedGameId: saved.id,
      gameTypeId: saved.gameTypeId,
      name: saved.name,
      config: cloneConfig(saved.config),
    };
  }

  /**
   * Forberedelse for å overskrive en eksisterende DailySchedule med en
   * SavedGame-mal. Read-only — mutates ikke raden. Speiler
   * `loadToGame()`-semantikken men returnerer `SavedGameApplyPayload` slik
   * at router-laget kan koordinere oppdatering av target-schedule.
   *
   * Forretningsregler:
   *   - SavedGame må ikke være slettet (deleted_at IS NULL).
   *   - SavedGame må være active (status='active').
   */
  async applyToSchedule(id: string): Promise<SavedGameApplyPayload> {
    const saved = await this.get(id);
    if (saved.deletedAt) {
      throw new DomainError(
        "SAVED_GAME_DELETED",
        "SavedGame er slettet — kan ikke brukes på en eksisterende plan."
      );
    }
    if (saved.status !== "active") {
      throw new DomainError(
        "SAVED_GAME_INACTIVE",
        "SavedGame må være active for å kunne brukes på en eksisterende plan."
      );
    }
    return {
      savedGameId: saved.id,
      gameTypeId: saved.gameTypeId,
      name: saved.name,
      config: cloneConfig(saved.config),
    };
  }

  /**
   * Lagre en eksisterende DailySchedule som en gjenbrukbar SavedGame-mal.
   * Tynn wrapper rundt `create()`. Beskrivelsen embeddes i
   * `config.description` slik at vi ikke trenger en ny DB-kolonne i denne
   * iterasjonen — eksisterende `config_json` er fri-form. Duplikat-navn
   * fanges av eksisterende unique-constraint og gir SAVED_GAME_DUPLICATE.
   */
  async saveFromSchedule(input: SaveFromScheduleInput): Promise<SavedGame> {
    const templateName = assertNonEmptyString(input.templateName, "templateName");
    const gameTypeId = assertNonEmptyString(input.gameTypeId, "gameTypeId");
    const config = assertConfig(input.config);
    const description = input.description?.trim();
    const mergedConfig: Record<string, unknown> = description
      ? { ...config, description }
      : { ...config };
    return this.create({
      gameTypeId,
      name: templateName,
      config: mergedConfig,
      createdBy: input.createdBy,
      isAdminSave: true,
      status: "active",
    });
  }

  /** Tell SavedGames (aktive + ikke-slettet). Brukes av dashboard-widget. */
  async count(filter: ListSavedGameFilter = {}): Promise<number> {
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
    if (filter.createdBy !== undefined) {
      params.push(assertNonEmptyString(filter.createdBy, "createdBy"));
      conditions.push(`created_by = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query<{ c: string | number }>(
      `SELECT COUNT(*)::bigint AS c FROM ${this.table()} ${where}`,
      params
    );
    return Number(rows[0]?.c ?? 0);
  }

  private mapRow(row: SavedGameRow): SavedGame {
    return {
      id: row.id,
      gameTypeId: row.game_type_id,
      name: row.name,
      isAdminSave: row.is_admin_save,
      config: parseConfig(row.config_json),
      status: row.status,
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
          name TEXT NOT NULL,
          is_admin_save BOOLEAN NOT NULL DEFAULT true,
          config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'inactive')),
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL
        )`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_saved_games_name_per_type
         ON ${this.table()}(game_type_id, name) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_saved_games_game_type
         ON ${this.table()}(game_type_id) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_saved_games_status
         ON ${this.table()}(status) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_saved_games_created_by
         ON ${this.table()}(created_by) WHERE deleted_at IS NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-624] saved_games schema init failed");
      throw new DomainError(
        "SAVED_GAME_INIT_FAILED",
        "Kunne ikke initialisere saved_games-tabell."
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
