/**
 * BIN-668: LeaderboardTier admin-service.
 *
 * Admin-CRUD for leaderboard-tier-tabellen (plass→poeng/premie-mapping).
 * Ren KONFIGURASJON (admin-katalog), ikke runtime-state. Runtime
 * `/api/leaderboard` (apps/backend/src/routes/game.ts) aggregerer prize-
 * points fra faktiske wins og er uavhengig av denne tabellen.
 *
 * Gjenbruk:
 *   - Samme mønster som GameTypeService (BIN-620), HallGroupService (BIN-665),
 *     PatternService (BIN-627). `Object.create` test-hook, idempotent
 *     `ensureInitialized`, soft-delete default.
 *
 * Soft-delete: `deleted_at` settes + `active = false`. Hard-delete er alltid
 * mulig fordi leaderboard-tier-raden har ingen runtime-fremmede referanser
 * (det er ren konfigurasjon; eventuelle utbetalinger som utløses fra en
 * tier er allerede snapshot-et i audit/ledger).
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "leaderboard-tier-service" });

export interface LeaderboardTier {
  id: string;
  tierName: string;
  place: number;
  points: number;
  prizeAmount: number | null;
  prizeDescription: string;
  active: boolean;
  extra: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateLeaderboardTierInput {
  tierName?: string;
  place: number;
  points?: number;
  prizeAmount?: number | null;
  prizeDescription?: string;
  active?: boolean;
  extra?: Record<string, unknown>;
  createdByUserId: string;
}

export interface UpdateLeaderboardTierInput {
  tierName?: string;
  place?: number;
  points?: number;
  prizeAmount?: number | null;
  prizeDescription?: string;
  active?: boolean;
  extra?: Record<string, unknown>;
}

export interface ListLeaderboardTierFilter {
  tierName?: string;
  active?: boolean;
  limit?: number;
  includeDeleted?: boolean;
}

export interface LeaderboardTierServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

interface LeaderboardTierRow {
  id: string;
  tier_name: string;
  place: number | string;
  points: number | string;
  prize_amount: number | string | null;
  prize_description: string;
  active: boolean;
  extra_json: Record<string, unknown> | null;
  created_by_user_id: string | null;
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

function assertNonEmptyString(
  value: unknown,
  field: string,
  max = 200
): string {
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

function assertOptionalStringMax(
  value: unknown,
  field: string,
  max: number
): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng.`);
  }
  if (value.length > max) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} kan maksimalt være ${max} tegn.`
    );
  }
  return value;
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

function assertNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et ikke-negativt heltall.`
    );
  }
  return n;
}

function assertNonNegativeNumberOrNull(
  value: unknown,
  field: string
): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et ikke-negativt tall eller null.`
    );
  }
  return n;
}

function assertExtra(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "extra må være et objekt.");
  }
  return value as Record<string, unknown>;
}

export class LeaderboardTierService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: LeaderboardTierServiceOptions) {
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
        "LeaderboardTierService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    schema = "public"
  ): LeaderboardTierService {
    const svc = Object.create(
      LeaderboardTierService.prototype
    ) as LeaderboardTierService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_leaderboard_tiers"`;
  }

  async list(
    filter: ListLeaderboardTierFilter = {}
  ): Promise<LeaderboardTier[]> {
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
    if (filter.tierName) {
      params.push(assertNonEmptyString(filter.tierName, "tierName"));
      conditions.push(`tier_name = $${params.length}`);
    }
    if (filter.active !== undefined) {
      if (typeof filter.active !== "boolean") {
        throw new DomainError("INVALID_INPUT", "active må være boolean.");
      }
      params.push(filter.active);
      conditions.push(`active = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<LeaderboardTierRow>(
      `SELECT id, tier_name, place, points, prize_amount, prize_description,
              active, extra_json, created_by_user_id,
              created_at, updated_at, deleted_at
       FROM ${this.table()}
       ${where}
       ORDER BY tier_name ASC, place ASC, created_at ASC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((row) => this.mapRow(row));
  }

  async get(id: string): Promise<LeaderboardTier> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<LeaderboardTierRow>(
      `SELECT id, tier_name, place, points, prize_amount, prize_description,
              active, extra_json, created_by_user_id,
              created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "LEADERBOARD_TIER_NOT_FOUND",
        "Leaderboard-tier finnes ikke."
      );
    }
    return this.mapRow(row);
  }

  async create(input: CreateLeaderboardTierInput): Promise<LeaderboardTier> {
    await this.ensureInitialized();
    const tierName =
      input.tierName !== undefined
        ? assertNonEmptyString(input.tierName, "tierName")
        : "default";
    const place = assertPositiveInt(input.place, "place");
    const points =
      input.points !== undefined
        ? assertNonNegativeInt(input.points, "points")
        : 0;
    const prizeAmount =
      input.prizeAmount !== undefined
        ? assertNonNegativeNumberOrNull(input.prizeAmount, "prizeAmount")
        : null;
    const prizeDescription =
      input.prizeDescription !== undefined
        ? assertOptionalStringMax(
            input.prizeDescription,
            "prizeDescription",
            500
          )
        : "";
    const active = input.active === undefined ? true : input.active === true;
    const extra = assertExtra(input.extra);
    if (!input.createdByUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdByUserId er påkrevd.");
    }

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.table()}
           (id, tier_name, place, points, prize_amount, prize_description,
            active, extra_json, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [
          id,
          tierName,
          place,
          points,
          prizeAmount,
          prizeDescription,
          active,
          JSON.stringify(extra),
          input.createdByUserId,
        ]
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "LEADERBOARD_TIER_DUPLICATE",
          `Leaderboard-tier for (tierName='${tierName}', place=${place}) finnes allerede.`
        );
      }
      throw err;
    }
    return this.get(id);
  }

  async update(
    id: string,
    update: UpdateLeaderboardTierInput
  ): Promise<LeaderboardTier> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "LEADERBOARD_TIER_DELETED",
        "Leaderboard-tier er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.tierName !== undefined) {
      sets.push(`tier_name = $${params.length + 1}`);
      params.push(assertNonEmptyString(update.tierName, "tierName"));
    }
    if (update.place !== undefined) {
      sets.push(`place = $${params.length + 1}`);
      params.push(assertPositiveInt(update.place, "place"));
    }
    if (update.points !== undefined) {
      sets.push(`points = $${params.length + 1}`);
      params.push(assertNonNegativeInt(update.points, "points"));
    }
    if (update.prizeAmount !== undefined) {
      sets.push(`prize_amount = $${params.length + 1}`);
      params.push(
        assertNonNegativeNumberOrNull(update.prizeAmount, "prizeAmount")
      );
    }
    if (update.prizeDescription !== undefined) {
      sets.push(`prize_description = $${params.length + 1}`);
      params.push(
        assertOptionalStringMax(
          update.prizeDescription,
          "prizeDescription",
          500
        )
      );
    }
    if (update.active !== undefined) {
      if (typeof update.active !== "boolean") {
        throw new DomainError("INVALID_INPUT", "active må være boolean.");
      }
      sets.push(`active = $${params.length + 1}`);
      params.push(update.active);
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
          "LEADERBOARD_TIER_DUPLICATE",
          "Leaderboard-tier med samme (tierName, place) finnes allerede."
        );
      }
      throw err;
    }
    return this.get(existing.id);
  }

  /**
   * Default: soft-delete (sett deleted_at + active = false). Hvis `hard=true`
   * hard-slettes raden. Hard-delete er alltid tillatt for tier-rader siden
   * det ikke er runtime-referanser (kun admin-konfig).
   */
  async remove(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "LEADERBOARD_TIER_DELETED",
        "Leaderboard-tier er allerede slettet."
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
       SET deleted_at = now(), active = false, updated_at = now()
       WHERE id = $1`,
      [existing.id]
    );
    return { softDeleted: true };
  }

  /** Telle tier-rader (ikke-slettet). Brukes av dashboard-widget. */
  async count(filter: ListLeaderboardTierFilter = {}): Promise<number> {
    await this.ensureInitialized();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.tierName) {
      params.push(assertNonEmptyString(filter.tierName, "tierName"));
      conditions.push(`tier_name = $${params.length}`);
    }
    if (filter.active !== undefined) {
      if (typeof filter.active !== "boolean") {
        throw new DomainError("INVALID_INPUT", "active må være boolean.");
      }
      params.push(filter.active);
      conditions.push(`active = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query<{ c: string | number }>(
      `SELECT COUNT(*)::bigint AS c FROM ${this.table()} ${where}`,
      params
    );
    return Number(rows[0]?.c ?? 0);
  }

  private mapRow(row: LeaderboardTierRow): LeaderboardTier {
    return {
      id: row.id,
      tierName: row.tier_name,
      place: Number(row.place),
      points: Number(row.points),
      prizeAmount: row.prize_amount === null ? null : Number(row.prize_amount),
      prizeDescription: row.prize_description ?? "",
      active: Boolean(row.active),
      extra: (row.extra_json ?? {}) as Record<string, unknown>,
      createdByUserId: row.created_by_user_id,
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
          tier_name TEXT NOT NULL DEFAULT 'default',
          place INTEGER NOT NULL CHECK (place > 0),
          points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
          prize_amount NUMERIC(12, 2) NULL
            CHECK (prize_amount IS NULL OR prize_amount >= 0),
          prize_description TEXT NOT NULL DEFAULT '',
          active BOOLEAN NOT NULL DEFAULT true,
          extra_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by_user_id TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL
        )`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_leaderboard_tiers_tier_place
         ON ${this.table()}(tier_name, place) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_leaderboard_tiers_tier_active
         ON ${this.table()}(tier_name, active) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_leaderboard_tiers_place
         ON ${this.table()}(tier_name, place ASC) WHERE deleted_at IS NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-668] leaderboard_tiers schema init failed");
      throw new DomainError(
        "LEADERBOARD_TIER_INIT_FAILED",
        "Kunne ikke initialisere leaderboard_tiers-tabell."
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
