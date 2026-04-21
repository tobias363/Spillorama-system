/**
 * GAME1_SCHEDULE PR 1: scheduler-tick-service for Game 1.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md
 * §3.3 Scheduler-tick (JobScheduler-integrasjon).
 *
 * Ansvar (PR 1):
 *   1) spawnUpcomingGame1Games(): for hver running daily_schedule med
 *      stopGame=false, og hver subGame i schedule-malen som matcher en
 *      aktiv ukedag innenfor 0-24t fra nå — INSERT én rad i
 *      app_game1_scheduled_games hvis ikke allerede eksisterer.
 *      UNIQUE(daily_schedule_id, scheduled_day, sub_game_index) beskytter
 *      mot dobbel-spawn.
 *   2) openPurchaseForImminentGames(): UPDATE status='scheduled' →
 *      'purchase_open' for rader der scheduled_start_time -
 *      notification_start_seconds ≤ now.
 *   3) cancelEndOfDayUnstartedGames(): UPDATE 'scheduled' | 'purchase_open' →
 *      'cancelled' med stop_reason='end_of_day_unreached' for rader der
 *      scheduled_end_time < now.
 *
 * Design:
 *   - Service leser fra `app_daily_schedules` + `app_schedules` + en
 *     "schedule-lookup-hook" fordi `DailySchedule` i nåværende schema
 *     ikke har direkte FK til schedule-mal. Vi henter schedule-malens id
 *     fra `DailySchedule.otherData.scheduleId` som første-klasses opt-in
 *     signal fra admin-UI. Plan-rader uten scheduleId i otherData hoppes
 *     over og logges (nødvendig-gap dokumentert i rapport for PR 2).
 *   - `notification_start_seconds` parser "5m"/"60s"/"30"-strenger fra
 *     schedule.subGame.notificationStartTime. Default: 300 sekunder (5m).
 *   - Scheduled start-time bygges ved å kombinere `scheduled_day` med
 *     `schedule.subGame.startTime` ("HH:MM") i UTC. Hvis subGame mangler
 *     start/end time hoppes slot-en over (logget).
 *   - Service er idempotent: UNIQUE-constraint reiser 23505, som
 *     kontrolleres og ignoreres i spawn-flyten.
 *
 * Ikke i scope (kommer i PR 2-5):
 *   - Route-endpoints (kun spawn + tick-logikk her)
 *   - Ready-flow, master-start, split-gevinst, crash-recovery
 *   - Audit-tabell (app_game1_master_audit)
 *   - Socket-broadcasts
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DomainError } from "./BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-schedule-tick-service" });

export type Game1ScheduledGameStatus =
  | "scheduled"
  | "purchase_open"
  | "ready_to_start"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";

export const GAME1_SCHEDULED_GAME_STATUSES: readonly Game1ScheduledGameStatus[] = [
  "scheduled",
  "purchase_open",
  "ready_to_start",
  "running",
  "paused",
  "completed",
  "cancelled",
];

export interface SpawnResult {
  /** Antall nye rader som ble INSERTed. */
  spawned: number;
  /** Antall (daily_schedule × subGame)-par som ble hoppet over pga eksisterende rad. */
  skipped: number;
  /** Antall daily_schedules som ble skippet pga manglende scheduleId/gap. */
  skippedSchedules: number;
  /** Antall validerings-feil (subGame uten startTime osv). */
  errors: number;
  /** Feilmeldinger for debug. */
  errorMessages?: string[];
}

export interface Game1ScheduleTickServiceOptions {
  pool: Pool;
  schema?: string;
  /**
   * Lookahead-vindu i millisekunder. Default 24t — scheduler spawner rader
   * opp til 24t frem fra tick-tidspunktet.
   */
  lookaheadMs?: number;
}

interface DailyScheduleRow {
  id: string;
  name: string;
  hall_ids_json: unknown;
  week_days: number;
  start_date: string;
  end_date: string | null;
  start_time: string;
  end_time: string;
  status: string;
  stop_game: boolean;
  other_data_json: unknown;
}

interface ScheduleRow {
  id: string;
  schedule_type: "Auto" | "Manual";
  sub_games_json: unknown;
}

interface ScheduleSubGame {
  name?: string;
  customGameName?: string;
  startTime?: string;
  endTime?: string;
  notificationStartTime?: string;
  ticketTypesData?: Record<string, unknown>;
  jackpotData?: Record<string, unknown>;
}

interface ExistingRowKey {
  daily_schedule_id: string;
  scheduled_day: string; // 'YYYY-MM-DD'
  sub_game_index: number;
}

/**
 * Weekday bitmask: mon=1, tue=2, wed=4, thu=8, fri=16, sat=32, sun=64.
 * Matcher DailyScheduleService + admin-UI DailyScheduleState.ts.
 */
const WEEKDAY_BITMASK_BY_JS_DAY: Record<number, number> = {
  // Date.getUTCDay: 0=Sun, 1=Mon, …, 6=Sat
  0: 64, // sun
  1: 1, // mon
  2: 2, // tue
  3: 4, // wed
  4: 8, // thu
  5: 16, // fri
  6: 32, // sat
};

/**
 * Parse "5m", "60s", "30" (sekunder default) til heltall sekunder.
 * Returnerer 300 (5m) hvis input er udefinert, tom eller ugyldig.
 */
export function parseNotificationStartToSeconds(raw: unknown): number {
  if (raw === null || raw === undefined) return 300;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  if (typeof raw !== "string") return 300;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return 300;
  // "5m", "60s", "30" (sekunder antatt når ingen suffix).
  const match = trimmed.match(/^(\d+)(m|s)?$/);
  if (!match) return 300;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return 300;
  const suffix = match[2];
  if (suffix === "m") return n * 60;
  // "s" eller uten suffix: antatt sekunder.
  return n;
}

/**
 * Kombinér en dato (UTC 'YYYY-MM-DD') med "HH:MM" til en Date i UTC.
 * Returnerer null hvis input er ugyldig.
 */
export function combineDayAndTime(day: string, hhmm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [y, m, d] = day.split("-").map((x) => Number(x));
  const [hh, mm] = hhmm.split(":").map((x) => Number(x));
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    hh === undefined ||
    mm === undefined
  ) {
    return null;
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const result = new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0));
  // Guard against JS silently rolling over invalid dates (e.g. Feb 30).
  if (
    result.getUTCFullYear() !== y ||
    result.getUTCMonth() !== m - 1 ||
    result.getUTCDate() !== d
  ) {
    return null;
  }
  return result;
}

/**
 * Konverter Date til 'YYYY-MM-DD' i UTC.
 */
export function toIsoDay(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Hent `scheduleId` fra `DailySchedule.otherData.scheduleId` som
 * første-klasses signal. Fallback: otherData.scheduleIdByDay er en
 * `{ monday: 'sid-...', tuesday: 'sid-...' }`-mapping (som matcher
 * legacy `days: { mon: sid }`), hvor vi velger matching ukedag.
 */
export function resolveScheduleIdForDay(
  otherData: Record<string, unknown>,
  jsDayOfWeek: number
): string | null {
  // Single scheduleId for alle dager.
  if (typeof otherData.scheduleId === "string" && otherData.scheduleId.trim()) {
    return otherData.scheduleId.trim();
  }
  // Per-dag mapping.
  const byDay = otherData.scheduleIdByDay;
  if (byDay && typeof byDay === "object" && !Array.isArray(byDay)) {
    const map = byDay as Record<string, unknown>;
    const keysByJsDay: Record<number, readonly string[]> = {
      0: ["sunday", "sun"],
      1: ["monday", "mon"],
      2: ["tuesday", "tue"],
      3: ["wednesday", "wed"],
      4: ["thursday", "thu"],
      5: ["friday", "fri"],
      6: ["saturday", "sat"],
    };
    const keys = keysByJsDay[jsDayOfWeek] ?? [];
    for (const key of keys) {
      const v = map[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export class Game1ScheduleTickService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly lookaheadMs: number;

  constructor(options: Game1ScheduleTickServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
    this.lookaheadMs = options.lookaheadMs ?? 24 * 60 * 60 * 1000;
  }

  /** @internal for tests. */
  static forTesting(
    pool: Pool,
    schema = "public",
    lookaheadMs?: number
  ): Game1ScheduleTickService {
    return new Game1ScheduleTickService({ pool, schema, lookaheadMs });
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  private dailySchedulesTable(): string {
    return `"${this.schema}"."app_daily_schedules"`;
  }

  private schedulesTable(): string {
    return `"${this.schema}"."app_schedules"`;
  }

  /**
   * Spawn game1 rader 0-24t frem fra `nowMs`. Idempotent —
   * UNIQUE(daily_schedule_id, scheduled_day, sub_game_index) beskytter.
   */
  async spawnUpcomingGame1Games(nowMs: number): Promise<SpawnResult> {
    const now = new Date(nowMs);
    const windowEnd = new Date(nowMs + this.lookaheadMs);
    const result: SpawnResult = {
      spawned: 0,
      skipped: 0,
      skippedSchedules: 0,
      errors: 0,
    };
    const errorMessages: string[] = [];

    // 1) Hent alle kandidat-daily_schedules i vinduet.
    const { rows: dailyRows } = await this.pool.query<DailyScheduleRow>(
      `SELECT id, name, hall_ids_json, week_days, start_date, end_date,
              start_time, end_time, status, stop_game, other_data_json
       FROM ${this.dailySchedulesTable()}
       WHERE status = 'running'
         AND stop_game = false
         AND deleted_at IS NULL
         AND start_date <= $1::timestamptz
         AND (end_date IS NULL OR end_date >= $2::timestamptz)`,
      [windowEnd.toISOString(), now.toISOString()]
    );

    if (dailyRows.length === 0) {
      return result;
    }

    // 2) Samle scheduleIds vi trenger å slå opp. Én mal kan deles.
    type DailyWithSchedule = {
      daily: DailyScheduleRow;
      otherData: Record<string, unknown>;
      hallIds: {
        masterHallId: string | null;
        hallIds: string[];
        groupHallIds: string[];
      };
    };
    const dailyWith: DailyWithSchedule[] = [];
    const scheduleIdsNeeded = new Set<string>();
    for (const daily of dailyRows) {
      const otherData = parseJsonObject(daily.other_data_json);
      const hallIdsRaw = parseJsonObject(daily.hall_ids_json);
      const masterHallId =
        typeof hallIdsRaw.masterHallId === "string" ? hallIdsRaw.masterHallId : null;
      const hallIdsArr = Array.isArray(hallIdsRaw.hallIds)
        ? hallIdsRaw.hallIds.filter((x: unknown): x is string => typeof x === "string")
        : [];
      const groupHallIdsArr = Array.isArray(hallIdsRaw.groupHallIds)
        ? hallIdsRaw.groupHallIds.filter((x: unknown): x is string => typeof x === "string")
        : [];
      dailyWith.push({
        daily,
        otherData,
        hallIds: {
          masterHallId,
          hallIds: hallIdsArr,
          groupHallIds: groupHallIdsArr,
        },
      });
      // Pluck scheduleIds fra otherData (both flavors: scalar og per-day).
      if (typeof otherData.scheduleId === "string" && otherData.scheduleId.trim()) {
        scheduleIdsNeeded.add(otherData.scheduleId.trim());
      }
      const byDay = otherData.scheduleIdByDay;
      if (byDay && typeof byDay === "object" && !Array.isArray(byDay)) {
        for (const v of Object.values(byDay as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim()) scheduleIdsNeeded.add(v.trim());
        }
      }
    }

    if (scheduleIdsNeeded.size === 0) {
      // Alle daily_schedules mangler scheduleId. Logg og returner.
      result.skippedSchedules = dailyRows.length;
      log.debug(
        { dailyCount: dailyRows.length },
        "spawn: no daily_schedules have scheduleId in otherData"
      );
      return result;
    }

    // 3) Hent schedule-maler.
    const scheduleIdList = Array.from(scheduleIdsNeeded);
    const { rows: scheduleRows } = await this.pool.query<ScheduleRow>(
      `SELECT id, schedule_type, sub_games_json
       FROM ${this.schedulesTable()}
       WHERE id = ANY($1::text[])
         AND deleted_at IS NULL
         AND status = 'active'`,
      [scheduleIdList]
    );
    const schedulesById = new Map<string, ScheduleRow>();
    for (const row of scheduleRows) {
      schedulesById.set(row.id, row);
    }

    // 4) Hent eksisterende rader for å være idempotent (i tillegg til
    //    UNIQUE-constraint). Query per daily_schedule for å holde query-listen
    //    kompakt.
    const dailyIdsForExisting = dailyWith.map((d) => d.daily.id);
    let existingKeys = new Set<string>();
    if (dailyIdsForExisting.length > 0) {
      const { rows: existing } = await this.pool.query<ExistingRowKey>(
        `SELECT daily_schedule_id, scheduled_day, sub_game_index
         FROM ${this.scheduledGamesTable()}
         WHERE daily_schedule_id = ANY($1::text[])
           AND scheduled_day >= $2::date
           AND scheduled_day <= $3::date`,
        [dailyIdsForExisting, toIsoDay(now), toIsoDay(windowEnd)]
      );
      existingKeys = new Set(
        existing.map(
          (r) =>
            `${r.daily_schedule_id}|${typeof r.scheduled_day === "string" ? r.scheduled_day : toIsoDay(new Date(r.scheduled_day))}|${r.sub_game_index}`
        )
      );
    }

    // 5) For hver daily_schedule, iterér dager i vinduet og spawn.
    for (const entry of dailyWith) {
      const { daily, otherData, hallIds } = entry;

      // Bekreft at daily har nødvendige halls for FK i scheduled_games.
      if (!hallIds.masterHallId) {
        result.skippedSchedules += 1;
        log.debug(
          { dailyScheduleId: daily.id },
          "spawn: daily_schedule skipped — masterHallId missing in hall_ids_json"
        );
        continue;
      }
      const groupHallId = hallIds.groupHallIds[0];
      if (!groupHallId) {
        result.skippedSchedules += 1;
        log.debug(
          { dailyScheduleId: daily.id },
          "spawn: daily_schedule skipped — no groupHallIds[0] in hall_ids_json"
        );
        continue;
      }

      // Iterate dager i vinduet.
      const windowStartDay = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
      const windowEndDay = new Date(
        Date.UTC(
          windowEnd.getUTCFullYear(),
          windowEnd.getUTCMonth(),
          windowEnd.getUTCDate()
        )
      );
      for (
        let d = new Date(windowStartDay);
        d.getTime() <= windowEndDay.getTime();
        d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
      ) {
        const jsDay = d.getUTCDay();
        const weekdayMask = WEEKDAY_BITMASK_BY_JS_DAY[jsDay] ?? 0;
        // week_days = 0 betyr "ingen ukedags-filter" (kun dato).
        // Hvis week_days > 0 må ukedagen matche bitmask.
        if (daily.week_days > 0 && (daily.week_days & weekdayMask) === 0) {
          continue;
        }
        // Sjekk at dato er innenfor daily.start_date / end_date.
        const startDateMs = new Date(daily.start_date).getTime();
        const endDateMs = daily.end_date
          ? new Date(daily.end_date).getTime()
          : Number.POSITIVE_INFINITY;
        if (d.getTime() < startDateMs || d.getTime() > endDateMs) {
          continue;
        }

        // Resolve scheduleId for denne ukedagen.
        const scheduleId = resolveScheduleIdForDay(otherData, jsDay);
        if (!scheduleId) {
          result.skippedSchedules += 1;
          continue;
        }
        const schedule = schedulesById.get(scheduleId);
        if (!schedule) {
          result.skippedSchedules += 1;
          log.debug(
            { dailyScheduleId: daily.id, scheduleId },
            "spawn: schedule mal ikke funnet eller ikke aktiv"
          );
          continue;
        }

        const subGames = parseJsonArray(schedule.sub_games_json).filter(
          (s): s is ScheduleSubGame =>
            !!s && typeof s === "object" && !Array.isArray(s)
        );
        const isoDay = toIsoDay(d);

        for (let i = 0; i < subGames.length; i++) {
          const sg = subGames[i]!;
          const existKey = `${daily.id}|${isoDay}|${i}`;
          if (existingKeys.has(existKey)) {
            result.skipped += 1;
            continue;
          }

          if (typeof sg.startTime !== "string" || !sg.startTime) {
            result.errors += 1;
            errorMessages.push(
              `daily=${daily.id} sub=${i}: mangler startTime i schedule.subGame`
            );
            continue;
          }
          if (typeof sg.endTime !== "string" || !sg.endTime) {
            result.errors += 1;
            errorMessages.push(
              `daily=${daily.id} sub=${i}: mangler endTime i schedule.subGame`
            );
            continue;
          }

          const startTs = combineDayAndTime(isoDay, sg.startTime);
          const endTsRaw = combineDayAndTime(isoDay, sg.endTime);
          if (!startTs || !endTsRaw) {
            result.errors += 1;
            errorMessages.push(
              `daily=${daily.id} sub=${i}: ugyldig start/end time`
            );
            continue;
          }
          // Hvis endTime er før startTime (f.eks. 23:00 → 01:00), rull over
          // til neste dag.
          const endTs =
            endTsRaw.getTime() <= startTs.getTime()
              ? new Date(endTsRaw.getTime() + 24 * 60 * 60 * 1000)
              : endTsRaw;

          // Hopp over rader der start allerede er mer enn 1 time i fortiden —
          // vi vil ikke spawne stale rader for dager som allerede er forbi
          // kjøretid.
          if (startTs.getTime() + 60 * 60 * 1000 < nowMs) {
            continue;
          }

          const notificationStartSeconds = parseNotificationStartToSeconds(
            sg.notificationStartTime
          );

          try {
            await this.pool.query(
              `INSERT INTO ${this.scheduledGamesTable()}
                 (id, daily_schedule_id, schedule_id, sub_game_index, sub_game_name,
                  custom_game_name, scheduled_day, scheduled_start_time,
                  scheduled_end_time, notification_start_seconds,
                  ticket_config_json, jackpot_config_json, game_mode,
                  master_hall_id, group_hall_id, participating_halls_json,
                  status)
               VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::timestamptz,
                       $9::timestamptz, $10, $11::jsonb, $12::jsonb, $13,
                       $14, $15, $16::jsonb, 'scheduled')
               ON CONFLICT (daily_schedule_id, scheduled_day, sub_game_index)
                 DO NOTHING`,
              [
                randomUUID(),
                daily.id,
                scheduleId,
                i,
                sg.name ?? `subGame-${i}`,
                sg.customGameName ?? null,
                isoDay,
                startTs.toISOString(),
                endTs.toISOString(),
                notificationStartSeconds,
                JSON.stringify(sg.ticketTypesData ?? {}),
                JSON.stringify(sg.jackpotData ?? {}),
                schedule.schedule_type,
                hallIds.masterHallId,
                groupHallId,
                JSON.stringify(hallIds.hallIds),
              ]
            );
            result.spawned += 1;
            existingKeys.add(existKey);
          } catch (err) {
            const code = (err as { code?: string } | null)?.code ?? "";
            if (code === "23505") {
              // UNIQUE-violation: en annen tick rakk å spawne samtidig.
              result.skipped += 1;
            } else if (code === "23503") {
              // FK-violation: master_hall_id / group_hall_id / schedule_id
              // ikke funnet. Rapporter men ikke kast.
              result.errors += 1;
              errorMessages.push(
                `daily=${daily.id} sub=${i}: FK-feil (hall/group/schedule mangler)`
              );
            } else {
              throw err;
            }
          }
        }
      }
    }

    if (errorMessages.length > 0) {
      result.errorMessages = errorMessages;
      log.warn(
        {
          spawned: result.spawned,
          errors: result.errors,
          firstError: errorMessages[0],
        },
        "spawnUpcomingGame1Games completed with validation errors"
      );
    }
    return result;
  }

  /**
   * Transition 'scheduled' → 'purchase_open' når (scheduled_start_time -
   * notification_start_seconds) ≤ now. Returnerer antall oppdaterte rader.
   */
  async openPurchaseForImminentGames(nowMs: number): Promise<number> {
    const now = new Date(nowMs);
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.scheduledGamesTable()}
       SET status = 'purchase_open', updated_at = now()
       WHERE status = 'scheduled'
         AND (scheduled_start_time
              - make_interval(secs => notification_start_seconds))
             <= $1::timestamptz
         AND scheduled_end_time > $1::timestamptz`,
      [now.toISOString()]
    );
    return rowCount ?? 0;
  }

  /**
   * Cancel rader som aldri nådde start før slutten av deres kjøretidsvindu.
   * stop_reason='end_of_day_unreached'.
   */
  async cancelEndOfDayUnstartedGames(nowMs: number): Promise<number> {
    const now = new Date(nowMs);
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.scheduledGamesTable()}
       SET status = 'cancelled',
           stop_reason = 'end_of_day_unreached',
           actual_end_time = now(),
           updated_at = now()
       WHERE status IN ('scheduled', 'purchase_open', 'ready_to_start')
         AND scheduled_end_time < $1::timestamptz`,
      [now.toISOString()]
    );
    return rowCount ?? 0;
  }

  /**
   * GAME1_SCHEDULE PR 2: transition 'purchase_open' → 'ready_to_start' når
   * alle participating non-excluded haller har is_ready=true. Returnerer
   * antall spill som ble oppdatert.
   *
   * Logikk (SQL-first for ytelse):
   *   - Finn alle games i status='purchase_open'
   *   - For hvert game:
   *       * Hent deltagende non-excluded haller via participating_halls_json
   *         (inkluder master_hall_id selv om den ikke er i listen).
   *       * Sjekk at ALLE disse har en rad i hall_ready_status med is_ready=true.
   *       * Hvis ja → UPDATE status='ready_to_start'.
   *
   * Vi setter ikke actual_start_time her — det skjer i PR 3 (master-start).
   * `ready_to_start` betyr kun "alle grønne, master kan trykke START".
   */
  async transitionReadyToStartGames(nowMs: number): Promise<number> {
    const now = new Date(nowMs);
    // Hent kandidater + deres participating-liste. SQL-join med COUNT/
    // AGG er mulig, men participating_halls_json er JSONB-array så en
    // JS-loop er klarere og håndterer master-hall-spesialcasen uten
    // krevende jsonb_array_elements-uttrykk.
    const { rows: candidates } = await this.pool.query<{
      id: string;
      participating_halls_json: unknown;
      master_hall_id: string;
    }>(
      `SELECT id, participating_halls_json, master_hall_id
         FROM ${this.scheduledGamesTable()}
         WHERE status = 'purchase_open'
           AND scheduled_end_time > $1::timestamptz`,
      [now.toISOString()]
    );

    if (candidates.length === 0) return 0;

    let transitioned = 0;
    for (const g of candidates) {
      const participating = (() => {
        const raw = g.participating_halls_json;
        if (Array.isArray(raw)) {
          return raw.filter((x: unknown): x is string => typeof x === "string");
        }
        if (typeof raw === "string") {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              return parsed.filter((x: unknown): x is string => typeof x === "string");
            }
          } catch {
            return [];
          }
        }
        return [];
      })();
      const hallSet = new Set<string>(participating);
      hallSet.add(g.master_hall_id);
      const hallIds = Array.from(hallSet);
      if (hallIds.length === 0) continue;

      // Hent ready-rader for disse hallene.
      const { rows: readyRows } = await this.pool.query<{
        hall_id: string;
        is_ready: boolean;
        excluded_from_game: boolean;
      }>(
        `SELECT hall_id, is_ready, excluded_from_game
           FROM ${this.hallReadyTable()}
           WHERE game_id = $1`,
        [g.id]
      );
      const byHall = new Map<string, { isReady: boolean; excluded: boolean }>();
      for (const r of readyRows) {
        byHall.set(r.hall_id, {
          isReady: Boolean(r.is_ready),
          excluded: Boolean(r.excluded_from_game),
        });
      }
      // Regel: minst én non-excluded hall, og ALLE non-excluded må være ready.
      // Haller uten rad teller som excluded=false + isReady=false.
      let hasCandidate = false;
      let allReady = true;
      for (const hallId of hallIds) {
        const r = byHall.get(hallId) ?? { isReady: false, excluded: false };
        if (r.excluded) continue;
        hasCandidate = true;
        if (!r.isReady) {
          allReady = false;
          break;
        }
      }
      if (!hasCandidate || !allReady) continue;

      const { rowCount } = await this.pool.query(
        `UPDATE ${this.scheduledGamesTable()}
           SET status = 'ready_to_start', updated_at = now()
           WHERE id = $1 AND status = 'purchase_open'`,
        [g.id]
      );
      if ((rowCount ?? 0) > 0) {
        transitioned += 1;
        log.info(
          { gameId: g.id, hallCount: hallIds.length },
          "[GAME1_SCHEDULE PR2] transitioned purchase_open → ready_to_start"
        );
      }
    }
    return transitioned;
  }

  private hallReadyTable(): string {
    return `"${this.schema}"."app_game1_hall_ready_status"`;
  }

  private masterAuditTable(): string {
    return `"${this.schema}"."app_game1_master_audit"`;
  }

  /**
   * GAME1_SCHEDULE PR 3: detect master-timeout i MVP-form.
   *
   * Spec §3.6: master som ikke trykker START innen X minutter etter alle
   * haller er ready. Per MVP-policy gjør vi INGEN auto-failover — vi
   * logger event i audit-tabellen og returnerer antall detekterte timeouts
   * så socket-laget kan broadcaste warning til master-UI.
   *
   * Idempotens: for hver game som har vært i `ready_to_start` > terskelen,
   * skriv kun én audit-rad per state-epoke (ingen ny rad hvis det allerede
   * finnes en timeout_detected-rad etter siste state-endring).
   */
  async detectMasterTimeout(
    nowMs: number,
    timeoutThresholdSeconds = 900
  ): Promise<{ gameIds: string[] }> {
    const now = new Date(nowMs);
    const threshold = new Date(nowMs - timeoutThresholdSeconds * 1000);

    const { rows: candidates } = await this.pool.query<{
      id: string;
      master_hall_id: string;
      group_hall_id: string;
      updated_at: Date | string;
    }>(
      `SELECT id, master_hall_id, group_hall_id, updated_at
         FROM ${this.scheduledGamesTable()}
         WHERE status = 'ready_to_start'
           AND updated_at <= $1::timestamptz
           AND scheduled_end_time > $2::timestamptz`,
      [threshold.toISOString(), now.toISOString()]
    );
    if (candidates.length === 0) return { gameIds: [] };

    const timedOut: string[] = [];
    for (const g of candidates) {
      const { rows: existing } = await this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM ${this.masterAuditTable()}
           WHERE game_id = $1
             AND action  = 'timeout_detected'
             AND created_at >= $2::timestamptz`,
        [g.id, g.updated_at instanceof Date ? g.updated_at.toISOString() : g.updated_at]
      );
      const count = Number(existing[0]?.count ?? "0");
      if (count > 0) continue;

      const { rows: readyRows } = await this.pool.query<{
        hall_id: string;
        is_ready: boolean;
        excluded_from_game: boolean;
      }>(
        `SELECT hall_id, is_ready, excluded_from_game
           FROM ${this.hallReadyTable()}
           WHERE game_id = $1`,
        [g.id]
      );
      const snapshot: Record<string, { isReady: boolean; excluded: boolean }> = {};
      for (const r of readyRows) {
        snapshot[r.hall_id] = {
          isReady: Boolean(r.is_ready),
          excluded: Boolean(r.excluded_from_game),
        };
      }

      const auditId = randomUUID();
      try {
        await this.pool.query(
          `INSERT INTO ${this.masterAuditTable()}
             (id, game_id, action, actor_user_id, actor_hall_id, group_hall_id,
              halls_ready_snapshot, metadata_json)
           VALUES ($1, $2, 'timeout_detected', 'SYSTEM', $3, $4, $5::jsonb, $6::jsonb)`,
          [
            auditId,
            g.id,
            g.master_hall_id,
            g.group_hall_id,
            JSON.stringify(snapshot),
            JSON.stringify({
              detectedAt: now.toISOString(),
              thresholdSeconds: timeoutThresholdSeconds,
              readyToStartSince: g.updated_at instanceof Date
                ? g.updated_at.toISOString()
                : g.updated_at,
            }),
          ]
        );
        timedOut.push(g.id);
        log.info(
          { gameId: g.id, thresholdSeconds: timeoutThresholdSeconds },
          "[GAME1_SCHEDULE PR3] master timeout_detected"
        );
      } catch (err) {
        const code = (err as { code?: string } | null)?.code ?? "";
        if (code === "42P01") {
          log.debug({ gameId: g.id }, "master_audit table missing; skipping detect_master_timeout");
          return { gameIds: [] };
        }
        throw err;
      }
    }
    return { gameIds: timedOut };
  }
}
