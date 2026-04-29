/**
 * BIN-625: Schedule admin-service (gjenbrukbar spill-mal / sub-game-bundle).
 *
 * Admin-CRUD for Schedule-maler. Tabellen `app_schedules` lagrer én rad per
 * mal; subgame-bundle ligger i `sub_games_json` inntil BIN-621 normaliserer
 * det videre. En Schedule er et TEMPLATE — DailySchedule (BIN-626) er
 * kalender-raden som instantierer malen på en gitt dato/hall.
 *
 * Soft-delete default: `deleted_at` + status = 'inactive'. Hard-delete
 * (`remove({ hard: true })`) er tilgjengelig når status = 'inactive' og
 * malen aldri har blitt brukt — cross-ref-sjekk mot app_daily_schedules
 * er ikke gjort her fordi legacy bruker sub_games_json-ids, ikke en direkte
 * FK mot schedule.id. Follow-up lander med BIN-621/626-koblingen.
 *
 * Legacy-opphav:
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  validateMysteryConfig,
  validateRowPrizesByColor,
  SUB_GAME_TYPES,
  type SubGameType,
} from "@spillorama/shared-types";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "schedule-service" });

export type ScheduleStatus = "active" | "inactive";
export type ScheduleType = "Auto" | "Manual";

const VALID_STATUS: ScheduleStatus[] = ["active", "inactive"];
const VALID_TYPE: ScheduleType[] = ["Auto", "Manual"];

const HH_MM_RE = /^[0-9]{2}:[0-9]{2}$/;

/**
 * Fri-form subgame-slot i en Schedule-mal. Feltene matcher legacy
 * scheduleController.createSchedulePostData (ticketTypesData, jackpotData,
 * elvisData, timing). Ukjente felter bevares via `extra` slik at admin-UI
 * kan round-trippe uten data-tap før BIN-621 normaliserer.
 */
export interface ScheduleSubgame {
  name?: string;
  customGameName?: string;
  startTime?: string;
  endTime?: string;
  notificationStartTime?: string;
  minseconds?: number;
  maxseconds?: number;
  seconds?: number;
  ticketTypesData?: Record<string, unknown>;
  jackpotData?: Record<string, unknown>;
  elvisData?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  /**
   * feat/schedule-8-colors-mystery: sub-game-type-diskriminant.
   * "STANDARD" (default) = pattern + ticket-colors som tidligere.
   * "MYSTERY" = Mystery Game-variant (Admin V1.0 s. 5, rev. 2023-10-05).
   */
  subGameType?: SubGameType;
}

export interface Schedule {
  id: string;
  scheduleName: string;
  scheduleNumber: string;
  scheduleType: ScheduleType;
  luckyNumberPrize: number;
  status: ScheduleStatus;
  isAdminSchedule: boolean;
  manualStartTime: string;
  manualEndTime: string;
  subGames: ScheduleSubgame[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateScheduleInput {
  scheduleName: string;
  scheduleType?: ScheduleType;
  /** Auto-genereres hvis ikke satt (`SID_YYYYMMDD_HHMMSS`). */
  scheduleNumber?: string;
  luckyNumberPrize?: number;
  status?: ScheduleStatus;
  isAdminSchedule?: boolean;
  manualStartTime?: string;
  manualEndTime?: string;
  subGames?: ScheduleSubgame[];
  createdBy: string;
}

export interface UpdateScheduleInput {
  scheduleName?: string;
  scheduleType?: ScheduleType;
  luckyNumberPrize?: number;
  status?: ScheduleStatus;
  manualStartTime?: string;
  manualEndTime?: string;
  subGames?: ScheduleSubgame[];
}

export interface ListScheduleFilter {
  scheduleType?: ScheduleType;
  status?: ScheduleStatus;
  /** Søk i scheduleName + scheduleNumber (case-insensitive, ILIKE). */
  search?: string;
  /** Filter på created_by — brukes av AGENT-rolle for "mine maler". */
  createdBy?: string;
  /**
   * Hvis true (default): returner både `created_by = createdBy` OG
   * `is_admin_schedule = true`-rader. Matcher legacy agent-flyt der
   * agent ser egne + admin-opprettede maler.
   */
  includeAdminForOwner?: boolean;
  limit?: number;
  includeDeleted?: boolean;
}

export interface ScheduleServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

interface ScheduleRow {
  id: string;
  schedule_name: string;
  schedule_number: string;
  schedule_type: ScheduleType;
  lucky_number_prize: string | number;
  status: ScheduleStatus;
  is_admin_schedule: boolean;
  manual_start_time: string;
  manual_end_time: string;
  sub_games_json: unknown;
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

function assertName(value: unknown, field = "scheduleName"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError("INVALID_INPUT", `${field} kan maksimalt være 200 tegn.`);
  }
  return trimmed;
}

function assertScheduleNumber(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "scheduleNumber er påkrevd.");
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError(
      "INVALID_INPUT",
      "scheduleNumber kan maksimalt være 200 tegn."
    );
  }
  return trimmed;
}

function assertType(value: unknown): ScheduleType {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "scheduleType må være en streng.");
  }
  const v = value.trim() as ScheduleType;
  if (!VALID_TYPE.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `scheduleType må være én av ${VALID_TYPE.join(", ")}.`
    );
  }
  return v;
}

function assertStatus(value: unknown): ScheduleStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as ScheduleStatus;
  if (!VALID_STATUS.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `status må være én av ${VALID_STATUS.join(", ")}.`
    );
  }
  return v;
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

function assertNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et ikke-negativt heltall.`);
  }
  return n;
}

function assertOptionalObject(
  value: unknown,
  field: string
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et objekt.`);
  }
  return value as Record<string, unknown>;
}

function assertSubgames(value: unknown): ScheduleSubgame[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "subGames må være en array.");
  }
  return value.map((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new DomainError("INVALID_INPUT", `subGames[${i}] må være et objekt.`);
    }
    const r = raw as Record<string, unknown>;
    const slot: ScheduleSubgame = {};
    if (r.name !== undefined) {
      if (typeof r.name !== "string") {
        throw new DomainError("INVALID_INPUT", `subGames[${i}].name må være en streng.`);
      }
      slot.name = r.name;
    }
    if (r.customGameName !== undefined) {
      if (r.customGameName !== null && typeof r.customGameName !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          `subGames[${i}].customGameName må være en streng.`
        );
      }
      if (typeof r.customGameName === "string") slot.customGameName = r.customGameName;
    }
    if (r.startTime !== undefined) {
      slot.startTime = assertHhMm(r.startTime, `subGames[${i}].startTime`);
    }
    if (r.endTime !== undefined) {
      slot.endTime = assertHhMm(r.endTime, `subGames[${i}].endTime`);
    }
    if (r.notificationStartTime !== undefined) {
      if (typeof r.notificationStartTime !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          `subGames[${i}].notificationStartTime må være en streng.`
        );
      }
      slot.notificationStartTime = r.notificationStartTime;
    }
    if (r.minseconds !== undefined) {
      slot.minseconds = assertNonNegativeInt(
        r.minseconds,
        `subGames[${i}].minseconds`
      );
    }
    if (r.maxseconds !== undefined) {
      slot.maxseconds = assertNonNegativeInt(
        r.maxseconds,
        `subGames[${i}].maxseconds`
      );
    }
    if (r.seconds !== undefined) {
      slot.seconds = assertNonNegativeInt(r.seconds, `subGames[${i}].seconds`);
    }
    const tData = assertOptionalObject(
      r.ticketTypesData,
      `subGames[${i}].ticketTypesData`
    );
    if (tData !== undefined) slot.ticketTypesData = tData;
    const jData = assertOptionalObject(
      r.jackpotData,
      `subGames[${i}].jackpotData`
    );
    if (jData !== undefined) slot.jackpotData = jData;
    const eData = assertOptionalObject(r.elvisData, `subGames[${i}].elvisData`);
    if (eData !== undefined) slot.elvisData = eData;
    const extra = assertOptionalObject(r.extra, `subGames[${i}].extra`);
    if (extra !== undefined) slot.extra = extra;

    // feat/schedule-8-colors-mystery: validér sub-game-type + ekstra-felter.
    // Lagres på wire som eget felt på subgame-objektet, ikke inne i `extra`,
    // slik at service-laget kan diskriminere uten å pakke opp JSON.
    if (r.subGameType !== undefined) {
      if (typeof r.subGameType !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          `subGames[${i}].subGameType må være en streng.`
        );
      }
      const sgType = r.subGameType as SubGameType;
      if (!(SUB_GAME_TYPES as readonly string[]).includes(sgType)) {
        throw new DomainError(
          "INVALID_INPUT",
          `subGames[${i}].subGameType må være én av ${SUB_GAME_TYPES.join(", ")}.`
        );
      }
      slot.subGameType = sgType;
    }

    // rowPrizesByColor + mysteryConfig: lagres i `extra` for bakoverkompat
    // (unormalisert JSONB). Valideres her hvis satt.
    if (slot.extra) {
      const rp = (slot.extra as Record<string, unknown>).rowPrizesByColor;
      if (rp !== undefined) {
        const err = validateRowPrizesByColor(rp);
        if (err) {
          throw new DomainError(
            "INVALID_INPUT",
            `subGames[${i}].extra.${err}`
          );
        }
      }
      const mc = (slot.extra as Record<string, unknown>).mysteryConfig;
      if (mc !== undefined) {
        const err = validateMysteryConfig(mc);
        if (err) {
          throw new DomainError(
            "INVALID_INPUT",
            `subGames[${i}].extra.${err}`
          );
        }
      }
    }

    return slot;
  });
}

/**
 * Generer Schedule-nummer à la legacy (SID_YYYYMMDD_HHMMSS + ms-suffix for
 * kollisjonstoleranse). Bruker UTC så to parallelle innkomster som skjer
 * innen samme millisekund får ulikt suffix via randomUUID-chunk.
 */
function generateScheduleNumber(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const suffix = randomUUID().split("-")[0] ?? "";
  return `SID_${y}${m}${d}_${hh}${mm}${ss}_${suffix}`;
}

export class ScheduleService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: ScheduleServiceOptions) {
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
        "ScheduleService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): ScheduleService {
    const svc = Object.create(ScheduleService.prototype) as ScheduleService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_schedules"`;
  }

  async list(filter: ListScheduleFilter = {}): Promise<Schedule[]> {
    await this.ensureInitialized();
    const limit =
      filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.scheduleType) {
      params.push(assertType(filter.scheduleType));
      conditions.push(`schedule_type = $${params.length}`);
    }
    if (filter.status) {
      params.push(assertStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    if (filter.search && filter.search.trim()) {
      const pattern = `%${filter.search.trim()}%`;
      params.push(pattern);
      const p1 = params.length;
      params.push(pattern);
      const p2 = params.length;
      conditions.push(
        `(schedule_name ILIKE $${p1} OR schedule_number ILIKE $${p2})`
      );
    }
    if (filter.createdBy) {
      if (filter.includeAdminForOwner !== false) {
        // Legacy agent-flyt: se egne + admin-opprettede.
        params.push(filter.createdBy);
        conditions.push(
          `(created_by = $${params.length} OR is_admin_schedule = true)`
        );
      } else {
        params.push(filter.createdBy);
        conditions.push(`created_by = $${params.length}`);
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<ScheduleRow>(
      `SELECT id, schedule_name, schedule_number, schedule_type,
              lucky_number_prize, status, is_admin_schedule,
              manual_start_time, manual_end_time, sub_games_json,
              created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.map(r));
  }

  async get(id: string): Promise<Schedule> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<ScheduleRow>(
      `SELECT id, schedule_name, schedule_number, schedule_type,
              lucky_number_prize, status, is_admin_schedule,
              manual_start_time, manual_end_time, sub_games_json,
              created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("SCHEDULE_NOT_FOUND", "Schedule-malen finnes ikke.");
    }
    return this.map(row);
  }

  async create(input: CreateScheduleInput): Promise<Schedule> {
    await this.ensureInitialized();
    const scheduleName = assertName(input.scheduleName);
    const scheduleType = input.scheduleType ? assertType(input.scheduleType) : "Manual";
    const scheduleNumber = input.scheduleNumber
      ? assertScheduleNumber(input.scheduleNumber)
      : generateScheduleNumber();
    const luckyNumberPrize =
      input.luckyNumberPrize === undefined
        ? 0
        : assertNonNegativeInt(input.luckyNumberPrize, "luckyNumberPrize");
    const status = input.status ? assertStatus(input.status) : "active";
    const isAdminSchedule =
      input.isAdminSchedule === undefined ? true : Boolean(input.isAdminSchedule);
    const subGames = assertSubgames(input.subGames);

    // Auto-type: avled manual-tidene fra første/siste subgame hvis ikke
    // eksplisitt gitt. Dette matcher legacy createSchedulePostData.
    let manualStartTime = assertHhMm(input.manualStartTime, "manualStartTime");
    let manualEndTime = assertHhMm(input.manualEndTime, "manualEndTime");
    if (scheduleType === "Auto" && subGames.length > 0) {
      if (!manualStartTime && subGames[0]?.startTime) {
        manualStartTime = subGames[0].startTime;
      }
      if (!manualEndTime && subGames[subGames.length - 1]?.endTime) {
        manualEndTime = subGames[subGames.length - 1]!.endTime!;
      }
    }

    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    const id = randomUUID();
    try {
      const { rows } = await this.pool.query<ScheduleRow>(
        `INSERT INTO ${this.table()}
           (id, schedule_name, schedule_number, schedule_type,
            lucky_number_prize, status, is_admin_schedule,
            manual_start_time, manual_end_time, sub_games_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
         RETURNING id, schedule_name, schedule_number, schedule_type,
                   lucky_number_prize, status, is_admin_schedule,
                   manual_start_time, manual_end_time, sub_games_json,
                   created_by, created_at, updated_at, deleted_at`,
        [
          id,
          scheduleName,
          scheduleNumber,
          scheduleType,
          luckyNumberPrize,
          status,
          isAdminSchedule,
          manualStartTime,
          manualEndTime,
          JSON.stringify(subGames),
          input.createdBy,
        ]
      );
      return this.map(rows[0]!);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (code === "23505") {
        throw new DomainError(
          "SCHEDULE_NUMBER_CONFLICT",
          "scheduleNumber er allerede i bruk."
        );
      }
      logger.error({ err }, "[BIN-625] schedule insert failed");
      throw new DomainError(
        "SCHEDULE_INSERT_FAILED",
        "Kunne ikke lagre Schedule."
      );
    }
  }

  async update(id: string, update: UpdateScheduleInput): Promise<Schedule> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "SCHEDULE_DELETED",
        "Schedule er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.scheduleName !== undefined) {
      sets.push(`schedule_name = $${params.length + 1}`);
      params.push(assertName(update.scheduleName));
    }
    if (update.scheduleType !== undefined) {
      sets.push(`schedule_type = $${params.length + 1}`);
      params.push(assertType(update.scheduleType));
    }
    if (update.luckyNumberPrize !== undefined) {
      sets.push(`lucky_number_prize = $${params.length + 1}`);
      params.push(assertNonNegativeInt(update.luckyNumberPrize, "luckyNumberPrize"));
    }
    if (update.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(assertStatus(update.status));
    }
    if (update.manualStartTime !== undefined) {
      sets.push(`manual_start_time = $${params.length + 1}`);
      params.push(assertHhMm(update.manualStartTime, "manualStartTime"));
    }
    if (update.manualEndTime !== undefined) {
      sets.push(`manual_end_time = $${params.length + 1}`);
      params.push(assertHhMm(update.manualEndTime, "manualEndTime"));
    }
    if (update.subGames !== undefined) {
      sets.push(`sub_games_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertSubgames(update.subGames)));
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }
    sets.push("updated_at = now()");
    params.push(existing.id);

    const { rows } = await this.pool.query<ScheduleRow>(
      `UPDATE ${this.table()}
       SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING id, schedule_name, schedule_number, schedule_type,
                 lucky_number_prize, status, is_admin_schedule,
                 manual_start_time, manual_end_time, sub_games_json,
                 created_by, created_at, updated_at, deleted_at`,
      params
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("SCHEDULE_NOT_FOUND", "Schedule-malen finnes ikke.");
    }
    return this.map(row);
  }

  /**
   * Default: soft-delete (sett deleted_at, status='inactive'). Hvis `hard=true`
   * og raden er inaktiv (status='inactive' eller allerede slettet), hard-
   * delete kan kjøres. Hard-delete av en active-mal blokkeres — sett
   * status='inactive' først via update().
   */
  async remove(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "SCHEDULE_DELETED",
        "Schedule er allerede slettet."
      );
    }
    const canHardDelete =
      options.hard === true && existing.status === "inactive";

    if (canHardDelete) {
      await this.pool.query(`DELETE FROM ${this.table()} WHERE id = $1`, [
        existing.id,
      ]);
      return { softDeleted: false };
    }
    if (options.hard === true) {
      throw new DomainError(
        "SCHEDULE_HARD_DELETE_BLOCKED",
        "Hard-delete krever status='inactive' først."
      );
    }
    await this.pool.query(
      `UPDATE ${this.table()}
       SET deleted_at = now(), status = 'inactive', updated_at = now()
       WHERE id = $1`,
      [existing.id]
    );
    return { softDeleted: true };
  }

  private map(row: ScheduleRow): Schedule {
    const rawSubgames = Array.isArray(row.sub_games_json) ? row.sub_games_json : [];
    const subGames: ScheduleSubgame[] = rawSubgames
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .map((s) => {
        const slot: ScheduleSubgame = {};
        if (typeof s.name === "string") slot.name = s.name;
        if (typeof s.customGameName === "string") slot.customGameName = s.customGameName;
        if (typeof s.startTime === "string") slot.startTime = s.startTime;
        if (typeof s.endTime === "string") slot.endTime = s.endTime;
        if (typeof s.notificationStartTime === "string") {
          slot.notificationStartTime = s.notificationStartTime;
        }
        if (typeof s.minseconds === "number") slot.minseconds = s.minseconds;
        if (typeof s.maxseconds === "number") slot.maxseconds = s.maxseconds;
        if (typeof s.seconds === "number") slot.seconds = s.seconds;
        if (s.ticketTypesData && typeof s.ticketTypesData === "object" && !Array.isArray(s.ticketTypesData)) {
          slot.ticketTypesData = s.ticketTypesData as Record<string, unknown>;
        }
        if (s.jackpotData && typeof s.jackpotData === "object" && !Array.isArray(s.jackpotData)) {
          slot.jackpotData = s.jackpotData as Record<string, unknown>;
        }
        if (s.elvisData && typeof s.elvisData === "object" && !Array.isArray(s.elvisData)) {
          slot.elvisData = s.elvisData as Record<string, unknown>;
        }
        if (s.extra && typeof s.extra === "object" && !Array.isArray(s.extra)) {
          slot.extra = s.extra as Record<string, unknown>;
        }
        if (typeof s.subGameType === "string") {
          const sgType = s.subGameType as SubGameType;
          if ((SUB_GAME_TYPES as readonly string[]).includes(sgType)) {
            slot.subGameType = sgType;
          }
        }
        return slot;
      });
    return {
      id: row.id,
      scheduleName: row.schedule_name,
      scheduleNumber: row.schedule_number,
      scheduleType: row.schedule_type,
      luckyNumberPrize: Number(row.lucky_number_prize),
      status: row.status,
      isAdminSchedule: Boolean(row.is_admin_schedule),
      manualStartTime: row.manual_start_time,
      manualEndTime: row.manual_end_time,
      subGames,
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
          schedule_name TEXT NOT NULL,
          schedule_number TEXT NOT NULL UNIQUE,
          schedule_type TEXT NOT NULL DEFAULT 'Manual'
            CHECK (schedule_type IN ('Auto','Manual')),
          lucky_number_prize BIGINT NOT NULL DEFAULT 0
            CHECK (lucky_number_prize >= 0),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active','inactive')),
          is_admin_schedule BOOLEAN NOT NULL DEFAULT true,
          manual_start_time TEXT NOT NULL DEFAULT ''
            CHECK (manual_start_time = '' OR manual_start_time ~ '^[0-9]{2}:[0-9]{2}$'),
          manual_end_time TEXT NOT NULL DEFAULT ''
            CHECK (manual_end_time = '' OR manual_end_time ~ '^[0-9]{2}:[0-9]{2}$'),
          sub_games_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_schedules_created_at
         ON ${this.table()}(created_at DESC) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_schedules_type
         ON ${this.table()}(schedule_type) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_schedules_created_by
         ON ${this.table()}(created_by) WHERE deleted_at IS NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-625] schedules schema init failed");
      throw new DomainError(
        "SCHEDULE_INIT_FAILED",
        "Kunne ikke initialisere schedules-tabell."
      );
    } finally {
      client.release();
    }
  }
}
