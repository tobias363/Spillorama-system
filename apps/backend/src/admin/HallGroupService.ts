/**
 * BIN-665: HallGroup admin-service.
 *
 * Admin-CRUD for hall-grupper (cross-hall spill). GroupHall = en navngitt
 * gruppering av haller som Game 2 + Game 3 bruker for sammenkoblede draws
 * mot flere fysiske haller. Legacy Mongo-schema `GroupHall` hadde embedded
 * `halls: [{id, name, status}]` — vi normaliserer til `app_hall_groups` +
 * `app_hall_group_members` slik at FK til `app_halls` kan håndheves.
 *
 * Gjenbruk:
 *   - Service følger samme mønster som PatternService (BIN-627),
 *     GameManagementService (BIN-622), DailyScheduleService (BIN-626).
 *   - `Object.create` test-hook, idempotent `ensureInitialized`, soft-delete
 *     default.
 *   - Medlemsskap vedlikeholdes atomisk via transaksjon (BEGIN/COMMIT),
 *     slik at group + members alltid er konsistent.
 *
 * Soft-delete: `deleted_at` settes + status = 'inactive'. Hard-delete
 * blokkeres hvis gruppen er referert fra `app_daily_schedules.groupHallIds`
 * (JSON array). Service sjekker dette i `remove({ hard: true })`.
 */

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "hall-group-service" });

export type HallGroupStatus = "active" | "inactive";

const VALID_STATUS: HallGroupStatus[] = ["active", "inactive"];

export interface HallGroupMember {
  hallId: string;
  hallName: string;
  hallStatus: string;
  addedAt: string;
}

export interface HallGroup {
  id: string;
  legacyGroupHallId: string | null;
  name: string;
  status: HallGroupStatus;
  tvId: number | null;
  productIds: string[];
  members: HallGroupMember[];
  extra: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateHallGroupInput {
  name: string;
  hallIds?: string[];
  status?: HallGroupStatus;
  tvId?: number | null;
  productIds?: string[];
  extra?: Record<string, unknown>;
  legacyGroupHallId?: string | null;
  createdBy: string;
}

export interface UpdateHallGroupInput {
  name?: string;
  /** Hvis satt, erstatter hele medlems-listen. */
  hallIds?: string[];
  status?: HallGroupStatus;
  tvId?: number | null;
  productIds?: string[];
  extra?: Record<string, unknown>;
}

export interface ListHallGroupFilter {
  status?: HallGroupStatus;
  hallId?: string;
  limit?: number;
  includeDeleted?: boolean;
}

export interface HallGroupServiceOptions {
  connectionString: string;
  schema?: string;
}

/**
 * Hook for referent-sjekk når hard-delete forsøkes. Returnerer `true`
 * hvis gruppen er referert fra DailySchedule.groupHallIds.
 */
export type HallGroupReferenceChecker = (groupId: string) => Promise<boolean>;

interface HallGroupRow {
  id: string;
  legacy_group_hall_id: string | null;
  name: string;
  status: HallGroupStatus;
  tv_id: number | null;
  products_json: unknown;
  extra_json: Record<string, unknown>;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface HallGroupMemberRow {
  group_id: string;
  hall_id: string;
  hall_name: string;
  hall_status: string;
  added_at: Date | string;
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

function assertName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "name er påkrevd.");
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError("INVALID_INPUT", "name kan maksimalt være 200 tegn.");
  }
  return trimmed;
}

function assertStatus(value: unknown): HallGroupStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as HallGroupStatus;
  if (!VALID_STATUS.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `status må være én av ${VALID_STATUS.join(", ")}.`
    );
  }
  return v;
}

function assertTvId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "tvId må være et ikke-negativt heltall eller null."
    );
  }
  return n;
}

function assertHallIds(value: unknown, field = "hallIds"): string[] {
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være en liste.`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new DomainError(
        "INVALID_INPUT",
        `${field} må være en liste av ikke-tomme strenger.`
      );
    }
    const trimmed = item.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function assertProductIds(value: unknown): string[] {
  return assertHallIds(value, "productIds");
}

function assertExtra(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "extra må være et objekt.");
  }
  return value as Record<string, unknown>;
}

function parseProducts(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string");
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

export class HallGroupService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly referenceChecker: HallGroupReferenceChecker | null;
  private initPromise: Promise<void> | null = null;

  constructor(
    options: HallGroupServiceOptions,
    referenceChecker: HallGroupReferenceChecker | null = null
  ) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for HallGroupService."
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
    referenceChecker: HallGroupReferenceChecker | null = null
  ): HallGroupService {
    const svc = Object.create(HallGroupService.prototype) as HallGroupService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    (svc as unknown as { referenceChecker: HallGroupReferenceChecker | null }).referenceChecker =
      referenceChecker;
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_hall_groups"`;
  }

  private membersTable(): string {
    return `"${this.schema}"."app_hall_group_members"`;
  }

  private hallsTable(): string {
    return `"${this.schema}"."app_halls"`;
  }

  async list(filter: ListHallGroupFilter = {}): Promise<HallGroup[]> {
    await this.ensureInitialized();
    const limit =
      filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 200;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("g.deleted_at IS NULL");
    }
    if (filter.status) {
      params.push(assertStatus(filter.status));
      conditions.push(`g.status = $${params.length}`);
    }
    let joinClause = "";
    if (filter.hallId) {
      params.push(filter.hallId.trim());
      joinClause = `
        INNER JOIN ${this.membersTable()} mf
          ON mf.group_id = g.id AND mf.hall_id = $${params.length}`;
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<HallGroupRow>(
      `SELECT g.id, g.legacy_group_hall_id, g.name, g.status, g.tv_id,
              g.products_json, g.extra_json, g.created_by,
              g.created_at, g.updated_at, g.deleted_at
       FROM ${this.table()} g
       ${joinClause}
       ${where}
       ORDER BY g.name ASC, g.created_at ASC
       LIMIT $${params.length}`,
      params
    );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const members = await this.loadMembers(ids);
    return rows.map((row) => this.mapRow(row, members.get(row.id) ?? []));
  }

  async get(id: string): Promise<HallGroup> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<HallGroupRow>(
      `SELECT id, legacy_group_hall_id, name, status, tv_id,
              products_json, extra_json, created_by,
              created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("HALL_GROUP_NOT_FOUND", "Hall-gruppe finnes ikke.");
    }
    const members = await this.loadMembers([row.id]);
    return this.mapRow(row, members.get(row.id) ?? []);
  }

  async create(input: CreateHallGroupInput): Promise<HallGroup> {
    await this.ensureInitialized();
    const name = assertName(input.name);
    const hallIds = input.hallIds !== undefined ? assertHallIds(input.hallIds) : [];
    const status = input.status ? assertStatus(input.status) : "active";
    const tvId = input.tvId !== undefined ? assertTvId(input.tvId) : null;
    const productIds =
      input.productIds !== undefined ? assertProductIds(input.productIds) : [];
    const extra = assertExtra(input.extra);
    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    // Legacy-id: auto-generer hvis ikke oppgitt (matches legacy `GH_<timestamp>`-
    // konvensjonen). Admin-UI kan sette egen verdi for re-imports.
    let legacyGroupHallId: string | null;
    if (input.legacyGroupHallId !== undefined) {
      legacyGroupHallId =
        input.legacyGroupHallId === null ? null : String(input.legacyGroupHallId).trim();
      if (legacyGroupHallId === "") legacyGroupHallId = null;
    } else {
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      legacyGroupHallId = `GH_${timestamp}`;
    }

    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Verifiser at alle hallIds finnes (og ikke er slettet).
      if (hallIds.length > 0) {
        await this.assertHallsExist(client, hallIds);
      }

      try {
        await client.query(
          `INSERT INTO ${this.table()}
             (id, legacy_group_hall_id, name, status, tv_id,
              products_json, extra_json, created_by)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
          [
            id,
            legacyGroupHallId,
            name,
            status,
            tvId,
            JSON.stringify(productIds),
            JSON.stringify(extra),
            input.createdBy,
          ]
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          await client.query("ROLLBACK");
          throw new DomainError(
            "HALL_GROUP_DUPLICATE_NAME",
            `Hall-gruppe '${name}' finnes allerede.`
          );
        }
        throw err;
      }

      if (hallIds.length > 0) {
        await this.insertMembers(client, id, hallIds);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return this.get(id);
  }

  async update(id: string, update: UpdateHallGroupInput): Promise<HallGroup> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "HALL_GROUP_DELETED",
        "Hall-gruppe er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    let hallIdsToSet: string[] | null = null;

    if (update.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(assertName(update.name));
    }
    if (update.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(assertStatus(update.status));
    }
    if (update.tvId !== undefined) {
      sets.push(`tv_id = $${params.length + 1}`);
      params.push(assertTvId(update.tvId));
    }
    if (update.productIds !== undefined) {
      sets.push(`products_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertProductIds(update.productIds)));
    }
    if (update.extra !== undefined) {
      sets.push(`extra_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertExtra(update.extra)));
    }
    if (update.hallIds !== undefined) {
      hallIdsToSet = assertHallIds(update.hallIds);
    }

    if (sets.length === 0 && hallIdsToSet === null) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      if (hallIdsToSet !== null && hallIdsToSet.length > 0) {
        await this.assertHallsExist(client, hallIdsToSet);
      }

      if (sets.length > 0) {
        sets.push("updated_at = now()");
        params.push(existing.id);
        try {
          await client.query(
            `UPDATE ${this.table()}
             SET ${sets.join(", ")}
             WHERE id = $${params.length}`,
            params
          );
        } catch (err) {
          if (isUniqueViolation(err)) {
            await client.query("ROLLBACK");
            throw new DomainError(
              "HALL_GROUP_DUPLICATE_NAME",
              "Hall-gruppenavn finnes allerede."
            );
          }
          throw err;
        }
      } else {
        // Hvis kun medlemskap oppdateres, bump updated_at likevel.
        await client.query(
          `UPDATE ${this.table()} SET updated_at = now() WHERE id = $1`,
          [existing.id]
        );
      }

      if (hallIdsToSet !== null) {
        await client.query(
          `DELETE FROM ${this.membersTable()} WHERE group_id = $1`,
          [existing.id]
        );
        if (hallIdsToSet.length > 0) {
          await this.insertMembers(client, existing.id, hallIdsToSet);
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return this.get(existing.id);
  }

  /**
   * Default: soft-delete (sett deleted_at + status = 'inactive'). Hvis
   * `hard=true` og gruppen ikke er referert fra DailySchedule, kan hard-
   * delete brukes (fjerner også alle medlemsskap via FK CASCADE).
   */
  async remove(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "HALL_GROUP_DELETED",
        "Hall-gruppe er allerede slettet."
      );
    }

    if (options.hard === true) {
      const referenced = await this.isReferenced(existing.id);
      if (referenced) {
        throw new DomainError(
          "HALL_GROUP_IN_USE",
          "Hall-gruppen er referert fra DailySchedule — kan ikke hard-slettes."
        );
      }
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

  /** Telle hall-grupper (aktive + ikke-slettet). Brukes av dashboard-widget. */
  async count(filter: ListHallGroupFilter = {}): Promise<number> {
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
   * Load members for en liste av group-ids, returnerer map {groupId -> members[]}.
   */
  private async loadMembers(groupIds: string[]): Promise<Map<string, HallGroupMember[]>> {
    const map = new Map<string, HallGroupMember[]>();
    if (groupIds.length === 0) return map;
    const { rows } = await this.pool.query<HallGroupMemberRow>(
      `SELECT m.group_id, m.hall_id, h.name AS hall_name, h.status AS hall_status, m.added_at
       FROM ${this.membersTable()} m
       INNER JOIN ${this.hallsTable()} h ON h.id = m.hall_id
       WHERE m.group_id = ANY($1::text[])
       ORDER BY h.name ASC`,
      [groupIds]
    );
    for (const row of rows) {
      const arr = map.get(row.group_id) ?? [];
      arr.push({
        hallId: row.hall_id,
        hallName: row.hall_name,
        hallStatus: row.hall_status,
        addedAt: asIso(row.added_at),
      });
      map.set(row.group_id, arr);
    }
    return map;
  }

  private async insertMembers(
    client: PoolClient,
    groupId: string,
    hallIds: string[]
  ): Promise<void> {
    if (hallIds.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [groupId];
    for (const hallId of hallIds) {
      params.push(hallId);
      values.push(`($1, $${params.length})`);
    }
    await client.query(
      `INSERT INTO ${this.membersTable()} (group_id, hall_id)
       VALUES ${values.join(", ")}
       ON CONFLICT (group_id, hall_id) DO NOTHING`,
      params
    );
  }

  private async assertHallsExist(client: PoolClient, hallIds: string[]): Promise<void> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ${this.hallsTable()} WHERE id = ANY($1::text[])`,
      [hallIds]
    );
    const found = new Set(rows.map((r) => r.id));
    const missing = hallIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new DomainError(
        "HALL_NOT_FOUND",
        `Hall-id(s) finnes ikke: ${missing.join(", ")}`
      );
    }
  }

  /**
   * Sjekk om en hall-gruppe er referert fra app_daily_schedules.groupHallIds.
   * Brukes av hard-delete-flyt. Legacy-id-format støttes også (groupHallIds
   * kan inneholde både UUID og "GH_..."-strenger).
   */
  private async isReferenced(groupId: string): Promise<boolean> {
    if (this.referenceChecker) {
      return this.referenceChecker(groupId);
    }
    const dsTable = `"${this.schema}"."app_daily_schedules"`;
    try {
      // `hall_ids_json` er JSON-objekt {masterHallId, hallIds, groupHallIds}.
      // `subgames_json` kan også referere gruppen fra sub-game-config.
      const { rows } = await this.pool.query<{ n: string | number }>(
        `SELECT COUNT(*)::bigint AS n
         FROM ${dsTable}
         WHERE deleted_at IS NULL
           AND (
             hall_ids_json::text LIKE $1
             OR subgames_json::text LIKE $1
           )`,
        [`%${groupId}%`]
      );
      return Number(rows[0]?.n ?? 0) > 0;
    } catch (err) {
      logger.warn({ err }, "[BIN-665] referent-sjekk feilet — antar ingen referanser");
      return false;
    }
  }

  private mapRow(row: HallGroupRow, members: HallGroupMember[]): HallGroup {
    return {
      id: row.id,
      legacyGroupHallId: row.legacy_group_hall_id,
      name: row.name,
      status: row.status,
      tvId: row.tv_id === null ? null : Number(row.tv_id),
      productIds: parseProducts(row.products_json),
      members,
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
          legacy_group_hall_id TEXT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'inactive')),
          tv_id INTEGER NULL,
          products_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          extra_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL
        )`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.membersTable()} (
          group_id TEXT NOT NULL,
          hall_id TEXT NOT NULL,
          added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (group_id, hall_id)
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_hall_groups_status
         ON ${this.table()}(status) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_hall_groups_name
         ON ${this.table()}(name) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_hall_groups_legacy_id
         ON ${this.table()}(legacy_group_hall_id)
         WHERE legacy_group_hall_id IS NOT NULL AND deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_hall_group_members_hall
         ON ${this.membersTable()}(hall_id)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_hall_group_members_group
         ON ${this.membersTable()}(group_id)`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-665] hall_groups schema init failed");
      throw new DomainError(
        "HALL_GROUP_INIT_FAILED",
        "Kunne ikke initialisere hall_groups-tabell."
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
