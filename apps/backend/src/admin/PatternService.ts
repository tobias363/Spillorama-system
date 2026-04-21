/**
 * BIN-627: Pattern admin-service (25-bit bitmask).
 *
 * Admin-CRUD for bingo-mønstre som Game 1 (klassisk) og Game 3
 * (Mønsterbingo) bruker. Tabellen `app_patterns` lagres i Postgres; `mask`-
 * kolonnen er et 25-bit integer som matches direkte mot PatternMatcher-
 * primitivet (apps/backend/src/game/PatternMatcher.ts) og PatternMask-typen
 * i shared-types (packages/shared-types/src/game.ts).
 *
 * Gjenbruk:
 *   - `PatternMask` fra shared-types — ikke duplisert her.
 *   - Validering av bitmask: 0 ≤ mask < 2^25 (håndheves også av DB CHECK).
 *   - Service følger samme mønster som GameManagementService /
 *     DailyScheduleService (Object.create for test, initializeSchema
 *     idempotent, soft-delete default).
 *
 * Soft-delete default: `deleted_at` settes så admin-historikk kan fortsette
 * å peke på raden. Hard-delete blokkeres hvis mønsteret er referert fra
 * andre tabeller (app_game_management.config_json / daily_schedules
 * .subgames_json) — service sjekker dette i `remove({ hard: true })`.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { PatternMask } from "@spillorama/shared-types";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "pattern-service" });

export type PatternStatus = "active" | "inactive";
export type PatternClaimType = "LINE" | "BINGO";

const VALID_STATUS: PatternStatus[] = ["active", "inactive"];
const VALID_CLAIM_TYPE: PatternClaimType[] = ["LINE", "BINGO"];

/** 25-bit mask ceiling — 2^25 = 33554432. */
const PATTERN_MASK_MAX = 0x2000000;

export interface Pattern {
  id: string;
  gameTypeId: string;
  gameName: string;
  patternNumber: string;
  name: string;
  /** 25-bit bitmask (5x5). Samme type som shared-types PatternMask. */
  mask: PatternMask;
  claimType: PatternClaimType;
  prizePercent: number;
  orderIndex: number;
  design: number;
  status: PatternStatus;
  isWoF: boolean;
  isTchest: boolean;
  isMys: boolean;
  isRowPr: boolean;
  rowPercentage: number;
  isJackpot: boolean;
  isGameTypeExtra: boolean;
  isLuckyBonus: boolean;
  patternPlace: string | null;
  extra: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreatePatternInput {
  gameTypeId: string;
  gameName?: string;
  patternNumber?: string;
  name: string;
  mask: PatternMask;
  claimType?: PatternClaimType;
  prizePercent?: number;
  orderIndex?: number;
  design?: number;
  status?: PatternStatus;
  isWoF?: boolean;
  isTchest?: boolean;
  isMys?: boolean;
  isRowPr?: boolean;
  rowPercentage?: number;
  isJackpot?: boolean;
  isGameTypeExtra?: boolean;
  isLuckyBonus?: boolean;
  patternPlace?: string | null;
  extra?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdatePatternInput {
  gameName?: string;
  patternNumber?: string;
  name?: string;
  mask?: PatternMask;
  claimType?: PatternClaimType;
  prizePercent?: number;
  orderIndex?: number;
  design?: number;
  status?: PatternStatus;
  isWoF?: boolean;
  isTchest?: boolean;
  isMys?: boolean;
  isRowPr?: boolean;
  rowPercentage?: number;
  isJackpot?: boolean;
  isGameTypeExtra?: boolean;
  isLuckyBonus?: boolean;
  patternPlace?: string | null;
  extra?: Record<string, unknown>;
}

export interface ListPatternFilter {
  gameTypeId?: string;
  status?: PatternStatus;
  limit?: number;
  includeDeleted?: boolean;
}

export interface PatternDynamicMenuEntry {
  id: string;
  name: string;
  patternNumber: string;
  mask: PatternMask;
  orderIndex: number;
  status: PatternStatus;
  claimType: PatternClaimType;
  design: number;
}

export interface PatternDynamicMenuResponse {
  gameTypeId: string | null;
  entries: PatternDynamicMenuEntry[];
  count: number;
}

export interface PatternServiceOptions {
  connectionString: string;
  schema?: string;
}

/**
 * Hook for referent-sjekk når hard-delete forsøkes. Service bruker dette
 * for å avgjøre om mønsteret er i bruk av GameManagement eller DailySchedule.
 * Returnerer `true` hvis det er referanser (blokker hard-delete).
 *
 * Default-implementasjonen sjekker config_json / subgames_json via SQL.
 * Override kan injiseres for testing.
 */
export type PatternReferenceChecker = (patternId: string) => Promise<boolean>;

interface PatternRow {
  id: string;
  game_type_id: string;
  game_name: string;
  pattern_number: string;
  name: string;
  mask: number;
  claim_type: PatternClaimType;
  prize_percent: string | number;
  order_index: number;
  design: number;
  status: PatternStatus;
  is_wof: boolean;
  is_tchest: boolean;
  is_mys: boolean;
  is_row_pr: boolean;
  row_percentage: string | number;
  is_jackpot: boolean;
  is_game_type_extra: boolean;
  is_lucky_bonus: boolean;
  pattern_place: string | null;
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

function assertMask(value: unknown): PatternMask {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new DomainError("INVALID_INPUT", "mask må være et heltall.");
  }
  if (n < 0 || n >= PATTERN_MASK_MAX) {
    throw new DomainError(
      "INVALID_INPUT",
      `mask må være 0 ≤ mask < 2^25 (fikk ${n}).`
    );
  }
  return n;
}

function assertStatus(value: unknown): PatternStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as PatternStatus;
  if (!VALID_STATUS.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `status må være én av ${VALID_STATUS.join(", ")}.`
    );
  }
  return v;
}

function assertClaimType(value: unknown): PatternClaimType {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "claimType må være en streng.");
  }
  const v = value.trim() as PatternClaimType;
  if (!VALID_CLAIM_TYPE.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `claimType må være én av ${VALID_CLAIM_TYPE.join(", ")}.`
    );
  }
  return v;
}

function assertPercent(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new DomainError("INVALID_INPUT", `${field} må være 0-100.`);
  }
  return n;
}

function assertNonNegativeNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være 0 eller større.`);
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

function assertExtra(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "extra må være et objekt.");
  }
  return value as Record<string, unknown>;
}

function assertOptionalString(value: unknown, field: string, maxLen = 200): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} kan maksimalt være ${maxLen} tegn.`
    );
  }
  return trimmed;
}

function assertRequiredString(value: unknown, field: string, maxLen = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} kan maksimalt være ${maxLen} tegn.`
    );
  }
  return trimmed;
}

function maybeBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  throw new DomainError("INVALID_INPUT", "Boolean-felt må være true/false.");
}

export class PatternService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly referenceChecker: PatternReferenceChecker | null;
  private initPromise: Promise<void> | null = null;

  constructor(
    options: PatternServiceOptions,
    referenceChecker: PatternReferenceChecker | null = null
  ) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for PatternService."
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
    referenceChecker: PatternReferenceChecker | null = null
  ): PatternService {
    const svc = Object.create(PatternService.prototype) as PatternService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    (svc as unknown as { referenceChecker: PatternReferenceChecker | null }).referenceChecker =
      referenceChecker;
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_patterns"`;
  }

  async list(filter: ListPatternFilter = {}): Promise<Pattern[]> {
    await this.ensureInitialized();
    const limit =
      filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 200;
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
    const { rows } = await this.pool.query<PatternRow>(
      `SELECT id, game_type_id, game_name, pattern_number, name, mask,
              claim_type, prize_percent, order_index, design, status,
              is_wof, is_tchest, is_mys, is_row_pr, row_percentage,
              is_jackpot, is_game_type_extra, is_lucky_bonus, pattern_place,
              extra_json, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       ${where}
       ORDER BY game_type_id ASC, order_index ASC, created_at ASC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.map(r));
  }

  async get(id: string): Promise<Pattern> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<PatternRow>(
      `SELECT id, game_type_id, game_name, pattern_number, name, mask,
              claim_type, prize_percent, order_index, design, status,
              is_wof, is_tchest, is_mys, is_row_pr, row_percentage,
              is_jackpot, is_game_type_extra, is_lucky_bonus, pattern_place,
              extra_json, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("PATTERN_NOT_FOUND", "Mønster finnes ikke.");
    }
    return this.map(row);
  }

  async create(input: CreatePatternInput): Promise<Pattern> {
    await this.ensureInitialized();
    const gameTypeId = assertGameTypeId(input.gameTypeId);
    const name = assertName(input.name);
    const mask = assertMask(input.mask);
    const claimType = input.claimType ? assertClaimType(input.claimType) : "BINGO";
    const prizePercent =
      input.prizePercent === undefined ? 0 : assertPercent(input.prizePercent, "prizePercent");
    const orderIndex =
      input.orderIndex === undefined
        ? 0
        : assertNonNegativeInt(input.orderIndex, "orderIndex");
    const design =
      input.design === undefined ? 0 : assertNonNegativeInt(input.design, "design");
    const status = input.status ? assertStatus(input.status) : "active";
    const rowPercentage =
      input.rowPercentage === undefined
        ? 0
        : assertNonNegativeNumber(input.rowPercentage, "rowPercentage");
    const extra = assertExtra(input.extra);
    const patternPlace = assertOptionalString(input.patternPlace, "patternPlace");
    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    // Auto-generate pattern_number hvis ikke oppgitt — format matches
    // legacy-konvensjon (timestamp_G{N}Pattern).
    let patternNumber: string;
    if (input.patternNumber !== undefined) {
      patternNumber = assertRequiredString(input.patternNumber, "patternNumber");
    } else {
      patternNumber = `${Date.now()}_${gameTypeId}_pattern`;
    }

    // gameName fallback: utled fra gameTypeId (f.eks. "game_1" → "Game1").
    let gameName: string;
    if (input.gameName !== undefined) {
      gameName = assertRequiredString(input.gameName, "gameName");
    } else {
      gameName = gameTypeId
        .split(/[_\s-]+/)
        .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : ""))
        .join("");
      if (!gameName) gameName = gameTypeId;
    }

    const id = randomUUID();
    try {
      const { rows } = await this.pool.query<PatternRow>(
        `INSERT INTO ${this.table()}
           (id, game_type_id, game_name, pattern_number, name, mask,
            claim_type, prize_percent, order_index, design, status,
            is_wof, is_tchest, is_mys, is_row_pr, row_percentage,
            is_jackpot, is_game_type_extra, is_lucky_bonus, pattern_place,
            extra_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6,
                 $7, $8, $9, $10, $11,
                 $12, $13, $14, $15, $16,
                 $17, $18, $19, $20,
                 $21::jsonb, $22)
         RETURNING id, game_type_id, game_name, pattern_number, name, mask,
                   claim_type, prize_percent, order_index, design, status,
                   is_wof, is_tchest, is_mys, is_row_pr, row_percentage,
                   is_jackpot, is_game_type_extra, is_lucky_bonus, pattern_place,
                   extra_json, created_by, created_at, updated_at, deleted_at`,
        [
          id,
          gameTypeId,
          gameName,
          patternNumber,
          name,
          mask,
          claimType,
          prizePercent,
          orderIndex,
          design,
          status,
          maybeBool(input.isWoF, false),
          maybeBool(input.isTchest, false),
          maybeBool(input.isMys, false),
          maybeBool(input.isRowPr, false),
          rowPercentage,
          maybeBool(input.isJackpot, false),
          maybeBool(input.isGameTypeExtra, false),
          maybeBool(input.isLuckyBonus, false),
          patternPlace,
          JSON.stringify(extra),
          input.createdBy,
        ]
      );
      return this.map(rows[0]!);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "PATTERN_DUPLICATE_NAME",
          `Mønsternavn '${name}' finnes allerede for gameType '${gameTypeId}'.`
        );
      }
      throw err;
    }
  }

  async update(id: string, update: UpdatePatternInput): Promise<Pattern> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "PATTERN_DELETED",
        "Mønster er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.gameName !== undefined) {
      sets.push(`game_name = $${params.length + 1}`);
      params.push(assertRequiredString(update.gameName, "gameName"));
    }
    if (update.patternNumber !== undefined) {
      sets.push(`pattern_number = $${params.length + 1}`);
      params.push(assertRequiredString(update.patternNumber, "patternNumber"));
    }
    if (update.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(assertName(update.name));
    }
    if (update.mask !== undefined) {
      sets.push(`mask = $${params.length + 1}`);
      params.push(assertMask(update.mask));
    }
    if (update.claimType !== undefined) {
      sets.push(`claim_type = $${params.length + 1}`);
      params.push(assertClaimType(update.claimType));
    }
    if (update.prizePercent !== undefined) {
      sets.push(`prize_percent = $${params.length + 1}`);
      params.push(assertPercent(update.prizePercent, "prizePercent"));
    }
    if (update.orderIndex !== undefined) {
      sets.push(`order_index = $${params.length + 1}`);
      params.push(assertNonNegativeInt(update.orderIndex, "orderIndex"));
    }
    if (update.design !== undefined) {
      sets.push(`design = $${params.length + 1}`);
      params.push(assertNonNegativeInt(update.design, "design"));
    }
    if (update.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(assertStatus(update.status));
    }
    if (update.isWoF !== undefined) {
      sets.push(`is_wof = $${params.length + 1}`);
      params.push(maybeBool(update.isWoF, false));
    }
    if (update.isTchest !== undefined) {
      sets.push(`is_tchest = $${params.length + 1}`);
      params.push(maybeBool(update.isTchest, false));
    }
    if (update.isMys !== undefined) {
      sets.push(`is_mys = $${params.length + 1}`);
      params.push(maybeBool(update.isMys, false));
    }
    if (update.isRowPr !== undefined) {
      sets.push(`is_row_pr = $${params.length + 1}`);
      params.push(maybeBool(update.isRowPr, false));
    }
    if (update.rowPercentage !== undefined) {
      sets.push(`row_percentage = $${params.length + 1}`);
      params.push(assertNonNegativeNumber(update.rowPercentage, "rowPercentage"));
    }
    if (update.isJackpot !== undefined) {
      sets.push(`is_jackpot = $${params.length + 1}`);
      params.push(maybeBool(update.isJackpot, false));
    }
    if (update.isGameTypeExtra !== undefined) {
      sets.push(`is_game_type_extra = $${params.length + 1}`);
      params.push(maybeBool(update.isGameTypeExtra, false));
    }
    if (update.isLuckyBonus !== undefined) {
      sets.push(`is_lucky_bonus = $${params.length + 1}`);
      params.push(maybeBool(update.isLuckyBonus, false));
    }
    if (update.patternPlace !== undefined) {
      sets.push(`pattern_place = $${params.length + 1}`);
      params.push(assertOptionalString(update.patternPlace, "patternPlace"));
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
      const { rows } = await this.pool.query<PatternRow>(
        `UPDATE ${this.table()}
         SET ${sets.join(", ")}
         WHERE id = $${params.length}
         RETURNING id, game_type_id, game_name, pattern_number, name, mask,
                   claim_type, prize_percent, order_index, design, status,
                   is_wof, is_tchest, is_mys, is_row_pr, row_percentage,
                   is_jackpot, is_game_type_extra, is_lucky_bonus, pattern_place,
                   extra_json, created_by, created_at, updated_at, deleted_at`,
        params
      );
      const row = rows[0];
      if (!row) {
        throw new DomainError("PATTERN_NOT_FOUND", "Mønster finnes ikke.");
      }
      return this.map(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "PATTERN_DUPLICATE_NAME",
          "Mønsternavn finnes allerede for denne gameType."
        );
      }
      throw err;
    }
  }

  /**
   * Default: soft-delete (sett deleted_at). Hvis `hard=true` og mønsteret
   * ikke er referert fra GameManagement/DailySchedule, kan hard-delete
   * brukes. I praksis brukes soft for alt som har vært aktivert.
   */
  async remove(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError("PATTERN_DELETED", "Mønster er allerede slettet.");
    }

    if (options.hard === true) {
      const referenced = await this.isReferenced(existing.id);
      if (referenced) {
        throw new DomainError(
          "PATTERN_IN_USE",
          "Mønsteret er i bruk av GameManagement eller DailySchedule — kan ikke hard-slettes."
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

  /**
   * BIN-627: dynamic-menu-endpoint. Returnerer en ordnet liste av mønstre
   * per gameType (eller alle), slik at admin-UI-dropdown kan rendre mønstre
   * gruppert/sortert etter `order_index`.
   */
  async dynamicMenu(gameTypeId?: string): Promise<PatternDynamicMenuResponse> {
    await this.ensureInitialized();
    const params: unknown[] = [];
    const conditions: string[] = ["deleted_at IS NULL"];
    let gameTypeFilter: string | null = null;
    if (gameTypeId) {
      gameTypeFilter = assertGameTypeId(gameTypeId);
      params.push(gameTypeFilter);
      conditions.push(`game_type_id = $${params.length}`);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      pattern_number: string;
      mask: number;
      order_index: number;
      status: PatternStatus;
      claim_type: PatternClaimType;
      design: number;
    }>(
      `SELECT id, name, pattern_number, mask, order_index, status, claim_type, design
       FROM ${this.table()}
       ${where}
       ORDER BY
         CASE WHEN status = 'active' THEN 0 ELSE 1 END,
         order_index ASC,
         name ASC`,
      params
    );
    const entries: PatternDynamicMenuEntry[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      patternNumber: r.pattern_number,
      mask: Number(r.mask),
      orderIndex: r.order_index,
      status: r.status,
      claimType: r.claim_type,
      design: r.design,
    }));
    return {
      gameTypeId: gameTypeFilter,
      entries,
      count: entries.length,
    };
  }

  /** Telle eksisterende mønstre per gameType — brukes av admin-UI-limits. */
  async countByGameType(gameTypeId: string): Promise<number> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{ c: string | number }>(
      `SELECT COUNT(*)::bigint AS c
       FROM ${this.table()}
       WHERE game_type_id = $1 AND deleted_at IS NULL`,
      [assertGameTypeId(gameTypeId)]
    );
    return Number(rows[0]?.c ?? 0);
  }

  /**
   * Sjekk om et mønster er referert fra app_game_management.config_json
   * eller app_daily_schedules.subgames_json. Brukt av hard-delete-flyt.
   */
  private async isReferenced(patternId: string): Promise<boolean> {
    if (this.referenceChecker) {
      return this.referenceChecker(patternId);
    }
    // Default: Postgres JSONB-sjekk. Hvis noen av tabellene ikke finnes,
    // fall tilbake til false (migration-rekkefølge kan være ufullstendig
    // i ny installasjon).
    const gmTable = `"${this.schema}"."app_game_management"`;
    const dsTable = `"${this.schema}"."app_daily_schedules"`;
    try {
      const { rows } = await this.pool.query<{ n: string | number }>(
        `SELECT (
            (SELECT COUNT(*) FROM ${gmTable}
             WHERE deleted_at IS NULL
               AND config_json::text LIKE $1)
          + (SELECT COUNT(*) FROM ${dsTable}
             WHERE deleted_at IS NULL
               AND subgames_json::text LIKE $1)
         )::bigint AS n`,
        [`%${patternId}%`]
      );
      return Number(rows[0]?.n ?? 0) > 0;
    } catch (err) {
      logger.warn({ err }, "[BIN-627] referent-sjekk feilet — antar ingen referanser");
      return false;
    }
  }

  private map(row: PatternRow): Pattern {
    return {
      id: row.id,
      gameTypeId: row.game_type_id,
      gameName: row.game_name,
      patternNumber: row.pattern_number,
      name: row.name,
      mask: Number(row.mask),
      claimType: row.claim_type,
      prizePercent: Number(row.prize_percent),
      orderIndex: row.order_index,
      design: row.design,
      status: row.status,
      isWoF: row.is_wof,
      isTchest: row.is_tchest,
      isMys: row.is_mys,
      isRowPr: row.is_row_pr,
      rowPercentage: Number(row.row_percentage),
      isJackpot: row.is_jackpot,
      isGameTypeExtra: row.is_game_type_extra,
      isLuckyBonus: row.is_lucky_bonus,
      patternPlace: row.pattern_place,
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
          pattern_number TEXT NOT NULL,
          name TEXT NOT NULL,
          mask INTEGER NOT NULL CHECK (mask >= 0 AND mask < 33554432),
          claim_type TEXT NOT NULL DEFAULT 'BINGO'
            CHECK (claim_type IN ('LINE', 'BINGO')),
          prize_percent NUMERIC(6,3) NOT NULL DEFAULT 0
            CHECK (prize_percent >= 0 AND prize_percent <= 100),
          order_index INTEGER NOT NULL DEFAULT 0 CHECK (order_index >= 0),
          design INTEGER NOT NULL DEFAULT 0 CHECK (design >= 0),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'inactive')),
          is_wof BOOLEAN NOT NULL DEFAULT false,
          is_tchest BOOLEAN NOT NULL DEFAULT false,
          is_mys BOOLEAN NOT NULL DEFAULT false,
          is_row_pr BOOLEAN NOT NULL DEFAULT false,
          row_percentage NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (row_percentage >= 0),
          is_jackpot BOOLEAN NOT NULL DEFAULT false,
          is_game_type_extra BOOLEAN NOT NULL DEFAULT false,
          is_lucky_bonus BOOLEAN NOT NULL DEFAULT false,
          pattern_place TEXT NULL,
          extra_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_patterns_game_type
         ON ${this.table()}(game_type_id) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_patterns_status
         ON ${this.table()}(status) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_patterns_name_per_type
         ON ${this.table()}(game_type_id, name) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_patterns_order
         ON ${this.table()}(game_type_id, order_index) WHERE deleted_at IS NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-627] patterns schema init failed");
      throw new DomainError(
        "PATTERN_INIT_FAILED",
        "Kunne ikke initialisere patterns-tabell."
      );
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  // pg SQLSTATE 23505 = unique_violation
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code: unknown }).code === "23505";
  }
  return false;
}
