/**
 * BIN-622: Game Management admin-service.
 *
 * Admin-CRUD for spill-varianter som operatører kan starte. Tabellen
 * `app_game_management` lagres i Postgres; felter som ikke har egen kolonne
 * (prize tiers, hall-group visibility, sub-game composition, ticket colors,
 * pattern-valg) holdes i `config_json` inntil GameType/SubGame/Pattern CRUD
 * (BIN-620/621/627) lander.
 *
 * Soft-delete i første omgang: `deleted_at` settes så hall-historikk kan
 * fortsette å peke på raden. Hard-delete er tilgjengelig via
 * `remove({ hard: true })` hvis service ønsker å purge-utkast.
 *
 * Repeat-flyt er idempotent på inngangsnivå: gitt samme `repeatToken` (fra
 * caller) returnerer service samme nye rad i stedet for å duplisere.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "game-management-service" });

export type GameManagementStatus = "active" | "running" | "closed" | "inactive";
export type GameManagementTicketType = "Large" | "Small";

const VALID_STATUS: GameManagementStatus[] = ["active", "running", "closed", "inactive"];
const VALID_TICKET_TYPE: GameManagementTicketType[] = ["Large", "Small"];

export interface GameManagement {
  id: string;
  gameTypeId: string;
  parentId: string | null;
  name: string;
  ticketType: GameManagementTicketType | null;
  ticketPrice: number;
  startDate: string;
  endDate: string | null;
  status: GameManagementStatus;
  totalSold: number;
  totalEarning: number;
  config: Record<string, unknown>;
  repeatedFromId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateGameManagementInput {
  gameTypeId: string;
  parentId?: string | null;
  name: string;
  ticketType?: GameManagementTicketType | null;
  ticketPrice?: number;
  startDate: string;
  endDate?: string | null;
  status?: GameManagementStatus;
  config?: Record<string, unknown>;
  createdBy: string;
  /** If set, create is idempotent for the same (createdBy, repeatToken) pair. */
  repeatedFromId?: string | null;
  repeatToken?: string | null;
}

export interface UpdateGameManagementInput {
  name?: string;
  ticketType?: GameManagementTicketType | null;
  ticketPrice?: number;
  startDate?: string;
  endDate?: string | null;
  status?: GameManagementStatus;
  parentId?: string | null;
  config?: Record<string, unknown>;
  totalSold?: number;
  totalEarning?: number;
}

export interface ListGameManagementFilter {
  gameTypeId?: string;
  status?: GameManagementStatus;
  limit?: number;
  includeDeleted?: boolean;
}

export interface RepeatGameManagementInput {
  sourceId: string;
  startDate: string;
  endDate?: string | null;
  name?: string | null;
  createdBy: string;
  /** Idempotency key — same token returns the same new rad. */
  repeatToken?: string | null;
}

export interface GameManagementServiceOptions {
  connectionString: string;
  schema?: string;
}

interface GameManagementRow {
  id: string;
  game_type_id: string;
  parent_id: string | null;
  name: string;
  ticket_type: GameManagementTicketType | null;
  ticket_price: string | number;
  start_date: Date | string;
  end_date: Date | string | null;
  status: GameManagementStatus;
  total_sold: string | number;
  total_earning: string | number;
  config_json: Record<string, unknown>;
  repeated_from_id: string | null;
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

function assertName(value: unknown, field = "name"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError("INVALID_INPUT", `${field} kan maksimalt være 200 tegn.`);
  }
  return trimmed;
}

function assertGameTypeId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "gameTypeId er påkrevd.");
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError("INVALID_INPUT", "gameTypeId kan maksimalt være 200 tegn.");
  }
  return trimmed;
}

function assertStatus(value: unknown): GameManagementStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as GameManagementStatus;
  if (!VALID_STATUS.includes(v)) {
    throw new DomainError("INVALID_INPUT", `status må være én av ${VALID_STATUS.join(", ")}.`);
  }
  return v;
}

function assertOptionalTicketType(value: unknown): GameManagementTicketType | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "ticketType må være en streng.");
  }
  const v = value.trim() as GameManagementTicketType;
  if (!VALID_TICKET_TYPE.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `ticketType må være én av ${VALID_TICKET_TYPE.join(", ")}.`
    );
  }
  return v;
}

function assertTicketPrice(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", "ticketPrice må være et ikke-negativt heltall.");
  }
  return n;
}

function assertTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const s = value.trim();
  if (Number.isNaN(Date.parse(s))) {
    throw new DomainError("INVALID_INPUT", `${field} må være en ISO-timestamp.`);
  }
  return s;
}

function assertOptionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim();
  if (Number.isNaN(Date.parse(s))) {
    throw new DomainError("INVALID_INPUT", `${field} må være en ISO-timestamp.`);
  }
  return s;
}

function assertConfig(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "config må være et objekt.");
  }
  return value as Record<string, unknown>;
}

function assertNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et ikke-negativt heltall.`);
  }
  return n;
}

function assertOptionalParentId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError("INVALID_INPUT", "parentId kan maksimalt være 200 tegn.");
  }
  return trimmed;
}

export class GameManagementService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: GameManagementServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for GameManagementService."
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): GameManagementService {
    const svc = Object.create(GameManagementService.prototype) as GameManagementService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_game_management"`;
  }

  async list(filter: ListGameManagementFilter = {}): Promise<GameManagement[]> {
    await this.ensureInitialized();
    const limit = filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.gameTypeId) {
      params.push(assertGameTypeId(filter.gameTypeId));
      conditions.push(`game_type_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(assertStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<GameManagementRow>(
      `SELECT id, game_type_id, parent_id, name, ticket_type, ticket_price,
              start_date, end_date, status, total_sold, total_earning,
              config_json, repeated_from_id, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.map(r));
  }

  async get(id: string): Promise<GameManagement> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<GameManagementRow>(
      `SELECT id, game_type_id, parent_id, name, ticket_type, ticket_price,
              start_date, end_date, status, total_sold, total_earning,
              config_json, repeated_from_id, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "Game Management-rad finnes ikke.");
    }
    return this.map(row);
  }

  async create(input: CreateGameManagementInput): Promise<GameManagement> {
    await this.ensureInitialized();
    const gameTypeId = assertGameTypeId(input.gameTypeId);
    const name = assertName(input.name);
    const ticketType = assertOptionalTicketType(input.ticketType);
    const ticketPrice = input.ticketPrice === undefined ? 0 : assertTicketPrice(input.ticketPrice);
    const startDate = assertTimestamp(input.startDate, "startDate");
    const endDate = assertOptionalTimestamp(input.endDate, "endDate");
    if (endDate && Date.parse(endDate) < Date.parse(startDate)) {
      throw new DomainError("INVALID_INPUT", "endDate må være ≥ startDate.");
    }
    const status = input.status ? assertStatus(input.status) : "inactive";
    const config = assertConfig(input.config);
    const parentId = assertOptionalParentId(input.parentId);
    const repeatedFromId = assertOptionalParentId(input.repeatedFromId);
    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    // Idempotency: hvis repeatToken er satt og det allerede eksisterer en
    // rad med samme createdBy + repeated_from_id der config_json.repeatToken
    // matcher, returner eksisterende rad (ingen dup-insert).
    if (input.repeatToken && repeatedFromId) {
      const existing = await this.findByRepeatToken(
        repeatedFromId,
        input.createdBy,
        input.repeatToken
      );
      if (existing) return existing;
      // Lagre token inn i config_json så vi kan finne igjen raden.
      (config as Record<string, unknown>).repeatToken = input.repeatToken;
    }

    const id = randomUUID();
    const { rows } = await this.pool.query<GameManagementRow>(
      `INSERT INTO ${this.table()}
         (id, game_type_id, parent_id, name, ticket_type, ticket_price,
          start_date, end_date, status, config_json, repeated_from_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10::jsonb, $11, $12)
       RETURNING id, game_type_id, parent_id, name, ticket_type, ticket_price,
                 start_date, end_date, status, total_sold, total_earning,
                 config_json, repeated_from_id, created_by, created_at, updated_at, deleted_at`,
      [
        id,
        gameTypeId,
        parentId,
        name,
        ticketType,
        ticketPrice,
        startDate,
        endDate,
        status,
        JSON.stringify(config),
        repeatedFromId,
        input.createdBy,
      ]
    );
    return this.map(rows[0]!);
  }

  async update(id: string, update: UpdateGameManagementInput): Promise<GameManagement> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "GAME_MANAGEMENT_DELETED",
        "Game Management-rad er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(assertName(update.name));
    }
    if (update.ticketType !== undefined) {
      sets.push(`ticket_type = $${params.length + 1}`);
      params.push(assertOptionalTicketType(update.ticketType));
    }
    if (update.ticketPrice !== undefined) {
      sets.push(`ticket_price = $${params.length + 1}`);
      params.push(assertTicketPrice(update.ticketPrice));
    }
    if (update.startDate !== undefined) {
      sets.push(`start_date = $${params.length + 1}::timestamptz`);
      params.push(assertTimestamp(update.startDate, "startDate"));
    }
    if (update.endDate !== undefined) {
      sets.push(`end_date = $${params.length + 1}::timestamptz`);
      params.push(assertOptionalTimestamp(update.endDate, "endDate"));
    }
    if (update.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(assertStatus(update.status));
    }
    if (update.parentId !== undefined) {
      sets.push(`parent_id = $${params.length + 1}`);
      params.push(assertOptionalParentId(update.parentId));
    }
    if (update.config !== undefined) {
      sets.push(`config_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertConfig(update.config)));
    }
    if (update.totalSold !== undefined) {
      sets.push(`total_sold = $${params.length + 1}`);
      params.push(assertNonNegativeInt(update.totalSold, "totalSold"));
    }
    if (update.totalEarning !== undefined) {
      sets.push(`total_earning = $${params.length + 1}`);
      params.push(assertNonNegativeInt(update.totalEarning, "totalEarning"));
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }
    sets.push("updated_at = now()");
    params.push(existing.id);

    const { rows } = await this.pool.query<GameManagementRow>(
      `UPDATE ${this.table()}
       SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING id, game_type_id, parent_id, name, ticket_type, ticket_price,
                 start_date, end_date, status, total_sold, total_earning,
                 config_json, repeated_from_id, created_by, created_at, updated_at, deleted_at`,
      params
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "Game Management-rad finnes ikke.");
    }
    const result = this.map(row);
    if (
      result.endDate &&
      Date.parse(result.endDate) < Date.parse(result.startDate)
    ) {
      throw new DomainError("INVALID_INPUT", "endDate må være ≥ startDate.");
    }
    return result;
  }

  /**
   * Default: soft-delete (sett deleted_at). Hvis `hard=true` og raden aldri
   * har vært kjørt (status = 'inactive' / 'active' og total_sold = 0) kan
   * hard-delete brukes. I praksis brukes soft for alt som har solgte billetter.
   */
  async remove(id: string, options: { hard?: boolean } = {}): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "GAME_MANAGEMENT_DELETED",
        "Game Management-rad er allerede slettet."
      );
    }
    const canHardDelete =
      options.hard === true &&
      existing.totalSold === 0 &&
      existing.totalEarning === 0 &&
      (existing.status === "inactive" || existing.status === "active");

    if (canHardDelete) {
      await this.pool.query(`DELETE FROM ${this.table()} WHERE id = $1`, [existing.id]);
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
   * BIN-622: repeat-flyt. Tar en eksisterende rad og lager en ny kopi med
   * nye datoer. Idempotent for samme (sourceId, createdBy, repeatToken).
   *
   * Kopierer: gameTypeId, parentId, ticketType, ticketPrice, config, name
   *   (navnet får "(repeat)" suffix med mindre `input.name` er satt).
   * Kopierer IKKE: totalSold, totalEarning (nullstilles), status (settes
   *   til 'inactive'), repeated_from_id (settes til sourceId).
   */
  async repeat(input: RepeatGameManagementInput): Promise<GameManagement> {
    const source = await this.get(input.sourceId);
    if (source.deletedAt) {
      throw new DomainError(
        "GAME_MANAGEMENT_DELETED",
        "Kan ikke repeat-kopiere slettet rad."
      );
    }
    const name =
      typeof input.name === "string" && input.name.trim()
        ? input.name.trim()
        : `${source.name} (repeat)`;
    return this.create({
      gameTypeId: source.gameTypeId,
      parentId: source.parentId,
      name,
      ticketType: source.ticketType,
      ticketPrice: source.ticketPrice,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      status: "inactive",
      config: { ...source.config },
      createdBy: input.createdBy,
      repeatedFromId: source.id,
      repeatToken: input.repeatToken ?? null,
    });
  }

  private async findByRepeatToken(
    repeatedFromId: string,
    createdBy: string,
    repeatToken: string
  ): Promise<GameManagement | null> {
    const { rows } = await this.pool.query<GameManagementRow>(
      `SELECT id, game_type_id, parent_id, name, ticket_type, ticket_price,
              start_date, end_date, status, total_sold, total_earning,
              config_json, repeated_from_id, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE repeated_from_id = $1
         AND created_by = $2
         AND config_json ->> 'repeatToken' = $3
         AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [repeatedFromId, createdBy, repeatToken]
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  private map(row: GameManagementRow): GameManagement {
    return {
      id: row.id,
      gameTypeId: row.game_type_id,
      parentId: row.parent_id,
      name: row.name,
      ticketType: row.ticket_type,
      ticketPrice: Number(row.ticket_price),
      startDate: asIso(row.start_date),
      endDate: asIsoOrNull(row.end_date),
      status: row.status,
      totalSold: Number(row.total_sold),
      totalEarning: Number(row.total_earning),
      config: (row.config_json ?? {}) as Record<string, unknown>,
      repeatedFromId: row.repeated_from_id,
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
          parent_id TEXT NULL,
          name TEXT NOT NULL,
          ticket_type TEXT NULL CHECK (ticket_type IS NULL OR ticket_type IN ('Large', 'Small')),
          ticket_price BIGINT NOT NULL DEFAULT 0 CHECK (ticket_price >= 0),
          start_date TIMESTAMPTZ NOT NULL,
          end_date TIMESTAMPTZ NULL,
          status TEXT NOT NULL DEFAULT 'inactive'
            CHECK (status IN ('active', 'running', 'closed', 'inactive')),
          total_sold BIGINT NOT NULL DEFAULT 0 CHECK (total_sold >= 0),
          total_earning BIGINT NOT NULL DEFAULT 0 CHECK (total_earning >= 0),
          config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          repeated_from_id TEXT NULL,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL,
          CHECK (end_date IS NULL OR end_date >= start_date)
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_game_mgmt_type
         ON ${this.table()}(game_type_id) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_game_mgmt_status
         ON ${this.table()}(status) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_game_mgmt_repeated_from
         ON ${this.table()}(repeated_from_id) WHERE repeated_from_id IS NOT NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-622] game_management schema init failed");
      throw new DomainError(
        "GAME_MANAGEMENT_INIT_FAILED",
        "Kunne ikke initialisere game_management-tabell."
      );
    } finally {
      client.release();
    }
  }
}
