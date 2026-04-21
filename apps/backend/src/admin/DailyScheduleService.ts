/**
 * BIN-626: DailySchedule admin-service (daglig spill-plan per hall).
 *
 * Admin-CRUD for daglige plan-rader som kobler GameManagement (BIN-622) til
 * hall + tidspunkt + sub-game-komposisjon. Tabellen `app_daily_schedules`
 * lagres i Postgres; sub-game-slots ligger i `subgames_json` inntil
 * BIN-621/627 normaliserer dem ut.
 *
 * Soft-delete i første omgang: `deleted_at` settes så historikk kan peke på
 * raden. Hard-delete er tilgjengelig via `remove({ hard: true })` når raden
 * aldri har vært kjørt (status = 'active' / 'inactive' og innsatsen = 0).
 *
 * Legacy-opphav:
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "daily-schedule-service" });

export type DailyScheduleStatus = "active" | "running" | "finish" | "inactive";
export type DailyScheduleDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

const VALID_STATUS: DailyScheduleStatus[] = ["active", "running", "finish", "inactive"];
const VALID_DAY: DailyScheduleDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const HH_MM_RE = /^[0-9]{2}:[0-9]{2}$/;

export interface DailyScheduleHallIds {
  masterHallId?: string | null;
  hallIds?: string[];
  groupHallIds?: string[];
}

export interface DailyScheduleSubgameSlot {
  subGameId?: string | null;
  index?: number;
  ticketPrice?: number;
  prizePool?: number;
  patternId?: string | null;
  status?: string;
  extra?: Record<string, unknown>;
}

export interface DailySchedule {
  id: string;
  name: string;
  gameManagementId: string | null;
  hallId: string | null;
  hallIds: DailyScheduleHallIds;
  /** Bitmask: mon=1, tue=2, wed=4, thu=8, fri=16, sat=32, sun=64. */
  weekDays: number;
  day: DailyScheduleDay | null;
  startDate: string;
  endDate: string | null;
  startTime: string;
  endTime: string;
  status: DailyScheduleStatus;
  stopGame: boolean;
  specialGame: boolean;
  isSavedGame: boolean;
  isAdminSavedGame: boolean;
  innsatsenSales: number;
  subgames: DailyScheduleSubgameSlot[];
  otherData: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateDailyScheduleInput {
  name: string;
  gameManagementId?: string | null;
  hallId?: string | null;
  hallIds?: DailyScheduleHallIds;
  weekDays?: number;
  day?: DailyScheduleDay | null;
  startDate: string;
  endDate?: string | null;
  startTime?: string;
  endTime?: string;
  status?: DailyScheduleStatus;
  stopGame?: boolean;
  specialGame?: boolean;
  isSavedGame?: boolean;
  isAdminSavedGame?: boolean;
  subgames?: DailyScheduleSubgameSlot[];
  otherData?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateDailyScheduleInput {
  name?: string;
  gameManagementId?: string | null;
  hallId?: string | null;
  hallIds?: DailyScheduleHallIds;
  weekDays?: number;
  day?: DailyScheduleDay | null;
  startDate?: string;
  endDate?: string | null;
  startTime?: string;
  endTime?: string;
  status?: DailyScheduleStatus;
  stopGame?: boolean;
  specialGame?: boolean;
  isSavedGame?: boolean;
  isAdminSavedGame?: boolean;
  innsatsenSales?: number;
  subgames?: DailyScheduleSubgameSlot[];
  otherData?: Record<string, unknown>;
}

export interface ListDailyScheduleFilter {
  gameManagementId?: string;
  hallId?: string;
  /** Weekday bitmask — hvis satt, returner rader der (week_days & mask) != 0. */
  weekDaysMask?: number;
  /** Dato-range — returner rader der start_date ligger i [from, to]. */
  fromDate?: string;
  toDate?: string;
  status?: DailyScheduleStatus;
  specialGame?: boolean;
  limit?: number;
  includeDeleted?: boolean;
}

export interface DailyScheduleServiceOptions {
  connectionString: string;
  schema?: string;
}

interface DailyScheduleRow {
  id: string;
  name: string;
  game_management_id: string | null;
  hall_id: string | null;
  hall_ids_json: unknown;
  week_days: number;
  day: DailyScheduleDay | null;
  start_date: Date | string;
  end_date: Date | string | null;
  start_time: string;
  end_time: string;
  status: DailyScheduleStatus;
  stop_game: boolean;
  special_game: boolean;
  is_saved_game: boolean;
  is_admin_saved_game: boolean;
  innsatsen_sales: string | number;
  subgames_json: unknown;
  other_data_json: unknown;
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

function assertOptionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError("INVALID_INPUT", `${field} kan maksimalt være 200 tegn.`);
  }
  return trimmed;
}

function assertStatus(value: unknown): DailyScheduleStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as DailyScheduleStatus;
  if (!VALID_STATUS.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `status må være én av ${VALID_STATUS.join(", ")}.`
    );
  }
  return v;
}

function assertOptionalDay(value: unknown): DailyScheduleDay | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "day må være en streng.");
  }
  const v = value.trim() as DailyScheduleDay;
  if (!VALID_DAY.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `day må være én av ${VALID_DAY.join(", ")}.`
    );
  }
  return v;
}

function assertWeekDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 127) {
    throw new DomainError(
      "INVALID_INPUT",
      "weekDays må være heltall 0-127 (bitmask)."
    );
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

function assertHhMm(value: unknown, field: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være 'HH:MM' eller tom.`);
  }
  const s = value.trim();
  if (s === "") return "";
  if (!HH_MM_RE.test(s)) {
    throw new DomainError("INVALID_INPUT", `${field} må være 'HH:MM' eller tom.`);
  }
  const [hh, mm] = s.split(":").map((x) => Number(x));
  if (hh === undefined || mm === undefined || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new DomainError("INVALID_INPUT", `${field} må være gyldig 'HH:MM'.`);
  }
  return s;
}

function assertObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et objekt.`);
  }
  return value as Record<string, unknown>;
}

function assertHallIds(value: unknown): DailyScheduleHallIds {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "hallIds må være et objekt.");
  }
  const raw = value as Record<string, unknown>;
  const out: DailyScheduleHallIds = {};
  if (raw.masterHallId !== undefined) {
    out.masterHallId = raw.masterHallId === null ? null : assertOptionalId(raw.masterHallId, "masterHallId");
  }
  if (raw.hallIds !== undefined) {
    if (!Array.isArray(raw.hallIds)) {
      throw new DomainError("INVALID_INPUT", "hallIds.hallIds må være en array.");
    }
    out.hallIds = raw.hallIds.map((x, i) => {
      const id = assertOptionalId(x, `hallIds.hallIds[${i}]`);
      if (!id) {
        throw new DomainError("INVALID_INPUT", `hallIds.hallIds[${i}] er ugyldig.`);
      }
      return id;
    });
  }
  if (raw.groupHallIds !== undefined) {
    if (!Array.isArray(raw.groupHallIds)) {
      throw new DomainError("INVALID_INPUT", "hallIds.groupHallIds må være en array.");
    }
    out.groupHallIds = raw.groupHallIds.map((x, i) => {
      const id = assertOptionalId(x, `hallIds.groupHallIds[${i}]`);
      if (!id) {
        throw new DomainError(
          "INVALID_INPUT",
          `hallIds.groupHallIds[${i}] er ugyldig.`
        );
      }
      return id;
    });
  }
  return out;
}

function assertSubgames(value: unknown): DailyScheduleSubgameSlot[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "subgames må være en array.");
  }
  return value.map((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new DomainError("INVALID_INPUT", `subgames[${i}] må være et objekt.`);
    }
    const r = raw as Record<string, unknown>;
    const slot: DailyScheduleSubgameSlot = {};
    if (r.subGameId !== undefined) {
      slot.subGameId =
        r.subGameId === null ? null : assertOptionalId(r.subGameId, `subgames[${i}].subGameId`);
    }
    if (r.index !== undefined) {
      const n = Number(r.index);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw new DomainError(
          "INVALID_INPUT",
          `subgames[${i}].index må være et ikke-negativt heltall.`
        );
      }
      slot.index = n;
    }
    if (r.ticketPrice !== undefined) {
      const n = Number(r.ticketPrice);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw new DomainError(
          "INVALID_INPUT",
          `subgames[${i}].ticketPrice må være et ikke-negativt heltall.`
        );
      }
      slot.ticketPrice = n;
    }
    if (r.prizePool !== undefined) {
      const n = Number(r.prizePool);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw new DomainError(
          "INVALID_INPUT",
          `subgames[${i}].prizePool må være et ikke-negativt heltall.`
        );
      }
      slot.prizePool = n;
    }
    if (r.patternId !== undefined) {
      slot.patternId =
        r.patternId === null
          ? null
          : assertOptionalId(r.patternId, `subgames[${i}].patternId`);
    }
    if (r.status !== undefined) {
      if (typeof r.status !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          `subgames[${i}].status må være en streng.`
        );
      }
      slot.status = r.status;
    }
    if (r.extra !== undefined) {
      slot.extra = assertObject(r.extra, `subgames[${i}].extra`);
    }
    return slot;
  });
}

function assertNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et ikke-negativt heltall.`);
  }
  return n;
}

export class DailyScheduleService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: DailyScheduleServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for DailyScheduleService."
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): DailyScheduleService {
    const svc = Object.create(DailyScheduleService.prototype) as DailyScheduleService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_daily_schedules"`;
  }

  async list(filter: ListDailyScheduleFilter = {}): Promise<DailySchedule[]> {
    await this.ensureInitialized();
    const limit =
      filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.gameManagementId) {
      params.push(assertOptionalId(filter.gameManagementId, "gameManagementId"));
      conditions.push(`game_management_id = $${params.length}`);
    }
    if (filter.hallId) {
      params.push(assertOptionalId(filter.hallId, "hallId"));
      conditions.push(`hall_id = $${params.length}`);
    }
    if (filter.weekDaysMask !== undefined) {
      params.push(assertWeekDays(filter.weekDaysMask));
      conditions.push(`(week_days & $${params.length}) <> 0`);
    }
    if (filter.fromDate) {
      params.push(assertTimestamp(filter.fromDate, "fromDate"));
      conditions.push(`start_date >= $${params.length}::timestamptz`);
    }
    if (filter.toDate) {
      params.push(assertTimestamp(filter.toDate, "toDate"));
      conditions.push(`start_date <= $${params.length}::timestamptz`);
    }
    if (filter.status) {
      params.push(assertStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    if (filter.specialGame !== undefined) {
      params.push(Boolean(filter.specialGame));
      conditions.push(`special_game = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<DailyScheduleRow>(
      `SELECT id, name, game_management_id, hall_id, hall_ids_json, week_days,
              day, start_date, end_date, start_time, end_time, status,
              stop_game, special_game, is_saved_game, is_admin_saved_game,
              innsatsen_sales, subgames_json, other_data_json, created_by,
              created_at, updated_at, deleted_at
       FROM ${this.table()}
       ${where}
       ORDER BY start_date DESC, created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.map(r));
  }

  async get(id: string): Promise<DailySchedule> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<DailyScheduleRow>(
      `SELECT id, name, game_management_id, hall_id, hall_ids_json, week_days,
              day, start_date, end_date, start_time, end_time, status,
              stop_game, special_game, is_saved_game, is_admin_saved_game,
              innsatsen_sales, subgames_json, other_data_json, created_by,
              created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "DAILY_SCHEDULE_NOT_FOUND",
        "Daglig plan-rad finnes ikke."
      );
    }
    return this.map(row);
  }

  async create(input: CreateDailyScheduleInput): Promise<DailySchedule> {
    await this.ensureInitialized();
    const name = assertName(input.name);
    const gameManagementId = assertOptionalId(input.gameManagementId, "gameManagementId");
    const hallId = assertOptionalId(input.hallId, "hallId");
    const hallIds = input.hallIds ? assertHallIds(input.hallIds) : {};
    const weekDays = input.weekDays === undefined ? 0 : assertWeekDays(input.weekDays);
    const day = assertOptionalDay(input.day);
    const startDate = assertTimestamp(input.startDate, "startDate");
    const endDate = assertOptionalTimestamp(input.endDate, "endDate");
    if (endDate && Date.parse(endDate) < Date.parse(startDate)) {
      throw new DomainError("INVALID_INPUT", "endDate må være ≥ startDate.");
    }
    const startTime = assertHhMm(input.startTime, "startTime");
    const endTime = assertHhMm(input.endTime, "endTime");
    const status = input.status ? assertStatus(input.status) : "active";
    const subgames = assertSubgames(input.subgames);
    const otherData = assertObject(input.otherData, "otherData");
    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    const id = randomUUID();
    const { rows } = await this.pool.query<DailyScheduleRow>(
      `INSERT INTO ${this.table()}
         (id, name, game_management_id, hall_id, hall_ids_json, week_days,
          day, start_date, end_date, start_time, end_time, status,
          stop_game, special_game, is_saved_game, is_admin_saved_game,
          subgames_json, other_data_json, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz, $9::timestamptz,
               $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19)
       RETURNING id, name, game_management_id, hall_id, hall_ids_json, week_days,
                 day, start_date, end_date, start_time, end_time, status,
                 stop_game, special_game, is_saved_game, is_admin_saved_game,
                 innsatsen_sales, subgames_json, other_data_json, created_by,
                 created_at, updated_at, deleted_at`,
      [
        id,
        name,
        gameManagementId,
        hallId,
        JSON.stringify(hallIds),
        weekDays,
        day,
        startDate,
        endDate,
        startTime,
        endTime,
        status,
        Boolean(input.stopGame),
        Boolean(input.specialGame),
        Boolean(input.isSavedGame),
        Boolean(input.isAdminSavedGame),
        JSON.stringify(subgames),
        JSON.stringify(otherData),
        input.createdBy,
      ]
    );
    return this.map(rows[0]!);
  }

  async update(id: string, update: UpdateDailyScheduleInput): Promise<DailySchedule> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "DAILY_SCHEDULE_DELETED",
        "Daglig plan-rad er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(assertName(update.name));
    }
    if (update.gameManagementId !== undefined) {
      sets.push(`game_management_id = $${params.length + 1}`);
      params.push(assertOptionalId(update.gameManagementId, "gameManagementId"));
    }
    if (update.hallId !== undefined) {
      sets.push(`hall_id = $${params.length + 1}`);
      params.push(assertOptionalId(update.hallId, "hallId"));
    }
    if (update.hallIds !== undefined) {
      sets.push(`hall_ids_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertHallIds(update.hallIds)));
    }
    if (update.weekDays !== undefined) {
      sets.push(`week_days = $${params.length + 1}`);
      params.push(assertWeekDays(update.weekDays));
    }
    if (update.day !== undefined) {
      sets.push(`day = $${params.length + 1}`);
      params.push(assertOptionalDay(update.day));
    }
    if (update.startDate !== undefined) {
      sets.push(`start_date = $${params.length + 1}::timestamptz`);
      params.push(assertTimestamp(update.startDate, "startDate"));
    }
    if (update.endDate !== undefined) {
      sets.push(`end_date = $${params.length + 1}::timestamptz`);
      params.push(assertOptionalTimestamp(update.endDate, "endDate"));
    }
    if (update.startTime !== undefined) {
      sets.push(`start_time = $${params.length + 1}`);
      params.push(assertHhMm(update.startTime, "startTime"));
    }
    if (update.endTime !== undefined) {
      sets.push(`end_time = $${params.length + 1}`);
      params.push(assertHhMm(update.endTime, "endTime"));
    }
    if (update.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(assertStatus(update.status));
    }
    if (update.stopGame !== undefined) {
      sets.push(`stop_game = $${params.length + 1}`);
      params.push(Boolean(update.stopGame));
    }
    if (update.specialGame !== undefined) {
      sets.push(`special_game = $${params.length + 1}`);
      params.push(Boolean(update.specialGame));
    }
    if (update.isSavedGame !== undefined) {
      sets.push(`is_saved_game = $${params.length + 1}`);
      params.push(Boolean(update.isSavedGame));
    }
    if (update.isAdminSavedGame !== undefined) {
      sets.push(`is_admin_saved_game = $${params.length + 1}`);
      params.push(Boolean(update.isAdminSavedGame));
    }
    if (update.innsatsenSales !== undefined) {
      sets.push(`innsatsen_sales = $${params.length + 1}`);
      params.push(assertNonNegativeInt(update.innsatsenSales, "innsatsenSales"));
    }
    if (update.subgames !== undefined) {
      sets.push(`subgames_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertSubgames(update.subgames)));
    }
    if (update.otherData !== undefined) {
      sets.push(`other_data_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertObject(update.otherData, "otherData")));
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }
    sets.push("updated_at = now()");
    params.push(existing.id);

    const { rows } = await this.pool.query<DailyScheduleRow>(
      `UPDATE ${this.table()}
       SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING id, name, game_management_id, hall_id, hall_ids_json, week_days,
                 day, start_date, end_date, start_time, end_time, status,
                 stop_game, special_game, is_saved_game, is_admin_saved_game,
                 innsatsen_sales, subgames_json, other_data_json, created_by,
                 created_at, updated_at, deleted_at`,
      params
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "DAILY_SCHEDULE_NOT_FOUND",
        "Daglig plan-rad finnes ikke."
      );
    }
    const result = this.map(row);
    if (result.endDate && Date.parse(result.endDate) < Date.parse(result.startDate)) {
      throw new DomainError("INVALID_INPUT", "endDate må være ≥ startDate.");
    }
    return result;
  }

  /**
   * Default: soft-delete (sett deleted_at, status='inactive'). Hvis `hard=true`
   * og raden aldri har vært kjørt (innsatsen_sales=0, status active/inactive)
   * kan hard-delete brukes.
   */
  async remove(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "DAILY_SCHEDULE_DELETED",
        "Daglig plan-rad er allerede slettet."
      );
    }
    const canHardDelete =
      options.hard === true &&
      existing.innsatsenSales === 0 &&
      (existing.status === "active" || existing.status === "inactive");

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
   * BIN-626: special-schedule = create() med `special_game = true` og typisk
   * multi-hall-oppsett via `hallIds`. Service normaliserer + håndhever at
   * special-rader har unikt navn innenfor datoområdet (best-effort — for
   * faktisk oppslag bruker admin-UI list()-endepunktet).
   */
  async createSpecial(input: CreateDailyScheduleInput): Promise<DailySchedule> {
    return this.create({ ...input, specialGame: true });
  }

  private map(row: DailyScheduleRow): DailySchedule {
    const hallIdsRaw = (row.hall_ids_json ?? {}) as Record<string, unknown>;
    const hallIds: DailyScheduleHallIds = {};
    if (hallIdsRaw.masterHallId !== undefined) {
      hallIds.masterHallId =
        hallIdsRaw.masterHallId === null
          ? null
          : typeof hallIdsRaw.masterHallId === "string"
            ? hallIdsRaw.masterHallId
            : null;
    }
    if (Array.isArray(hallIdsRaw.hallIds)) {
      hallIds.hallIds = hallIdsRaw.hallIds.filter(
        (x): x is string => typeof x === "string"
      );
    }
    if (Array.isArray(hallIdsRaw.groupHallIds)) {
      hallIds.groupHallIds = hallIdsRaw.groupHallIds.filter(
        (x): x is string => typeof x === "string"
      );
    }
    const subgamesRaw = Array.isArray(row.subgames_json) ? row.subgames_json : [];
    const subgames: DailyScheduleSubgameSlot[] = subgamesRaw
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .map((s) => {
        const slot: DailyScheduleSubgameSlot = {};
        if (typeof s.subGameId === "string") slot.subGameId = s.subGameId;
        else if (s.subGameId === null) slot.subGameId = null;
        if (typeof s.index === "number") slot.index = s.index;
        if (typeof s.ticketPrice === "number") slot.ticketPrice = s.ticketPrice;
        if (typeof s.prizePool === "number") slot.prizePool = s.prizePool;
        if (typeof s.patternId === "string") slot.patternId = s.patternId;
        else if (s.patternId === null) slot.patternId = null;
        if (typeof s.status === "string") slot.status = s.status;
        if (s.extra && typeof s.extra === "object" && !Array.isArray(s.extra)) {
          slot.extra = s.extra as Record<string, unknown>;
        }
        return slot;
      });
    return {
      id: row.id,
      name: row.name,
      gameManagementId: row.game_management_id,
      hallId: row.hall_id,
      hallIds,
      weekDays: Number(row.week_days),
      day: row.day,
      startDate: asIso(row.start_date),
      endDate: asIsoOrNull(row.end_date),
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      stopGame: Boolean(row.stop_game),
      specialGame: Boolean(row.special_game),
      isSavedGame: Boolean(row.is_saved_game),
      isAdminSavedGame: Boolean(row.is_admin_saved_game),
      innsatsenSales: Number(row.innsatsen_sales),
      subgames,
      otherData: (row.other_data_json ?? {}) as Record<string, unknown>,
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
          name TEXT NOT NULL,
          game_management_id TEXT NULL,
          hall_id TEXT NULL,
          hall_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          week_days INTEGER NOT NULL DEFAULT 0
            CHECK (week_days >= 0 AND week_days <= 127),
          day TEXT NULL
            CHECK (day IS NULL OR day IN
              ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
          start_date TIMESTAMPTZ NOT NULL,
          end_date TIMESTAMPTZ NULL,
          start_time TEXT NOT NULL DEFAULT ''
            CHECK (start_time = '' OR start_time ~ '^[0-9]{2}:[0-9]{2}$'),
          end_time TEXT NOT NULL DEFAULT ''
            CHECK (end_time = '' OR end_time ~ '^[0-9]{2}:[0-9]{2}$'),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active','running','finish','inactive')),
          stop_game BOOLEAN NOT NULL DEFAULT false,
          special_game BOOLEAN NOT NULL DEFAULT false,
          is_saved_game BOOLEAN NOT NULL DEFAULT false,
          is_admin_saved_game BOOLEAN NOT NULL DEFAULT false,
          innsatsen_sales BIGINT NOT NULL DEFAULT 0 CHECK (innsatsen_sales >= 0),
          subgames_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          other_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL,
          CHECK (end_date IS NULL OR end_date >= start_date)
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_daily_sched_gm
         ON ${this.table()}(game_management_id) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_daily_sched_hall
         ON ${this.table()}(hall_id) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_daily_sched_status
         ON ${this.table()}(status) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_daily_sched_start_date
         ON ${this.table()}(start_date DESC) WHERE deleted_at IS NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-626] daily_schedules schema init failed");
      throw new DomainError(
        "DAILY_SCHEDULE_INIT_FAILED",
        "Kunne ikke initialisere daily_schedules-tabell."
      );
    } finally {
      client.release();
    }
  }
}
