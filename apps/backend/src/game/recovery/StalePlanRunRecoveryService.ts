/**
 * 2026-05-09: master-driven recovery for stale plan-runs and stuck
 * scheduled-games.
 *
 * Why this service exists:
 * ------------------------
 * The `GameLobbyAggregator` flags two warning codes that BLOCK all master
 * actions in `MasterActionService` (see `BLOCKING_WARNING_CODES` there):
 *
 *   STALE_PLAN_RUN  — `app_game_plan_run` row from a previous business-date
 *                     is still in `running`/`paused`/`idle` status. Master
 *                     is blocked because today's run cannot be created
 *                     while yesterday's blocks the (hall, business_date)
 *                     uniqueness invariant.
 *
 *   BRIDGE_FAILED   — `app_game_plan_run.status='running'` but no
 *                     corresponding `app_game1_scheduled_games` row is
 *                     visible. Engine-bridge spawn either failed or the
 *                     scheduled-game was cleaned up, leaving plan-state
 *                     orphaned.
 *
 * Both situations historically required `psql` access to fix — un-
 * acceptable for pilot Q3 2026 in 4 halls where the bingovert is the only
 * person on-site.
 *
 * What this service does:
 * -----------------------
 * Single atomic transaction that "closes the books" on stale state for a
 * given hall:
 *
 *   1. Mark all `app_game_plan_run` rows for `hall_id = $hallId` AND
 *      `business_date < CURRENT_DATE` (Oslo-tz) AND `status != 'finished'`
 *      as `status='finished'`, `finished_at=NOW()`. This is a forward-only
 *      state-machine transition that is always semantically safe — these
 *      runs cannot resume on a previous business day.
 *
 *   2. Mark all `app_game1_scheduled_games` rows for `master_hall_id =
 *      $hallId` AND `status NOT IN ('completed', 'cancelled')` AND
 *      `scheduled_end_time < NOW() - 24h` as `status='cancelled'`,
 *      `actual_end_time=NOW()`, `stop_reason='stale_recovery_<actorId>'`.
 *      We use a 24h cutoff (instead of 'business_date < today') so we
 *      never touch a scheduled-game from earlier the same day that may
 *      still legitimately complete.
 *
 *   3. Audit `spill1.master.recover_stale_plan_run` event with the
 *      before/after snapshots.
 *
 * Crucially, we do ZERO DELETE operations — only forward state-transitions.
 * Re-running the recovery is safe; a second invocation finds no stale rows
 * and returns `{ planRuns: 0, scheduledGames: 0 }`.
 *
 * Why this service does NOT live in MasterActionService:
 * ------------------------------------------------------
 * `MasterActionService.preValidate` rejects all actions with
 * `BLOCKING_WARNING_CODES`. The recovery flow MUST bypass that check —
 * otherwise we'd refuse to clean up the very state that triggered the
 * warning. Keeping the recovery in a separate service makes the bypass
 * explicit and reviewable, rather than adding an "if action == recover
 * skip pre-validate" branch in the master orchestrator.
 *
 * Cross-references:
 *   - GameLobbyAggregator (`STALE_PLAN_RUN`/`BRIDGE_FAILED` detection)
 *   - MasterActionService (`BLOCKING_WARNING_CODES`)
 *   - Game1RecoveryService (`crash_recovery_cancelled` — boot-time pass;
 *     this service is for runtime master-driven cleanup, NOT boot)
 *
 * @see docs/operations/HALL_PILOT_RUNBOOK.md (escalation path)
 * @see apps/backend/src/game/MasterActionService.ts:285 (BLOCKING_WARNING_CODES)
 */

import type { Pool, PoolClient } from "pg";

import type { AuditLogService } from "../../compliance/AuditLogService.js";
import { DomainError } from "../../errors/DomainError.js";
import type { MasterActor } from "../Game1MasterControlService.js";
import { logger as rootLogger } from "../../util/logger.js";
import { todayOsloKey } from "../../util/osloTimezone.js";

const logger = rootLogger.child({ module: "stale-plan-run-recovery" });

/**
 * Cutoff window for `app_game1_scheduled_games`-cancellation. Only games
 * whose `scheduled_end_time` is older than this many ms ago are touched.
 * 24h matches the legacy `Game1RecoveryService.maxRunningWindowMs` style
 * but with a cleaner business-date semantics for master-driven recovery.
 */
const SCHEDULED_GAME_STALE_CUTOFF_MS = 24 * 60 * 60 * 1000;

export interface StalePlanRunRecoveryOptions {
  pool: Pool;
  schema?: string;
  auditLogService?: AuditLogService | null;
  /** Test-hook for clock injection (default `() => new Date()`). */
  clock?: () => Date;
}

export interface StalePlanRunRecoveryInput {
  actor: MasterActor;
  hallId: string;
}

export interface StalePlanRunSnapshot {
  id: string;
  businessDate: string;
  status: string;
  currentPosition: number;
  planId: string;
}

export interface StaleScheduledGameSnapshot {
  id: string;
  status: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  subGameName: string;
  groupHallId: string;
}

export interface StalePlanRunRecoveryResult {
  /** Number of `app_game_plan_run` rows transitioned to `finished`. */
  planRunsCleared: number;
  /** Number of `app_game1_scheduled_games` rows transitioned to `cancelled`. */
  scheduledGamesCleared: number;
  /** IDs of touched plan-run rows (audit + observability). */
  clearedPlanRuns: StalePlanRunSnapshot[];
  /** IDs of touched scheduled-game rows (audit + observability). */
  clearedScheduledGames: StaleScheduledGameSnapshot[];
  /** ISO timestamp when recovery ran (server-clock). */
  recoveredAt: string;
  /** The hall the recovery was run for. */
  hallId: string;
  /** Today's Oslo business-date that was used as the "current" cutoff. */
  todayBusinessDate: string;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertHallId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
  }
  return value.trim();
}

function assertActor(actor: unknown): MasterActor {
  if (!actor || typeof actor !== "object") {
    throw new DomainError("INVALID_INPUT", "actor er påkrevd.");
  }
  const a = actor as Partial<MasterActor>;
  if (typeof a.userId !== "string" || !a.userId.trim()) {
    throw new DomainError("INVALID_INPUT", "actor.userId er påkrevd.");
  }
  if (
    a.role !== "ADMIN" &&
    a.role !== "HALL_OPERATOR" &&
    a.role !== "AGENT" &&
    a.role !== "SUPPORT"
  ) {
    throw new DomainError("INVALID_INPUT", "actor.role er ugyldig.");
  }
  if (typeof a.hallId !== "string") {
    throw new DomainError("INVALID_INPUT", "actor.hallId må være streng.");
  }
  return a as MasterActor;
}

function dateRowToString(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "string") {
    // Postgres `date` type may already be `YYYY-MM-DD`.
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  return String(value);
}

function isoOrNow(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

interface PlanRunRow {
  id: string;
  plan_id: string;
  business_date: Date | string;
  status: string;
  current_position: number;
}

interface ScheduledGameRow {
  id: string;
  status: string;
  scheduled_start_time: Date | string;
  scheduled_end_time: Date | string;
  sub_game_name: string;
  group_hall_id: string;
}

export class StalePlanRunRecoveryService {
  private readonly pool: Pool;
  private readonly schema: string;
  private auditLogService: AuditLogService | null;
  private readonly clock: () => Date;

  constructor(options: StalePlanRunRecoveryOptions) {
    if (!options.pool) {
      throw new DomainError("INVALID_CONFIG", "pool er påkrevd.");
    }
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.auditLogService = options.auditLogService ?? null;
    this.clock = options.clock ?? (() => new Date());
  }

  /** @internal — test helper that bypasses the constructor pool-check. */
  static forTesting(
    options: StalePlanRunRecoveryOptions,
  ): StalePlanRunRecoveryService {
    const svc = Object.create(
      StalePlanRunRecoveryService.prototype,
    ) as StalePlanRunRecoveryService;
    (svc as unknown as { pool: Pool }).pool = options.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(
      options.schema ?? "public",
    );
    (svc as unknown as {
      auditLogService: AuditLogService | null;
    }).auditLogService = options.auditLogService ?? null;
    (svc as unknown as { clock: () => Date }).clock =
      options.clock ?? (() => new Date());
    return svc;
  }

  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service ?? null;
  }

  private planRunTable(): string {
    return `"${this.schema}"."app_game_plan_run"`;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  /**
   * Idempotent recovery — runs entire cleanup in a single transaction.
   *
   * Safe to invoke any number of times; a second call with no stale state
   * returns `{ planRunsCleared: 0, scheduledGamesCleared: 0 }`.
   *
   * Throws `DomainError` ONLY for genuinely invalid input (missing
   * hallId/actor) or unrecoverable DB errors. Audit-log failures are
   * logged but never block the response — same fire-and-forget semantics
   * as `MasterActionService.audit`.
   */
  async recoverStaleForHall(
    input: StalePlanRunRecoveryInput,
  ): Promise<StalePlanRunRecoveryResult> {
    const hallId = assertHallId(input.hallId);
    const actor = assertActor(input.actor);
    const now = this.clock();
    const todayBusinessDate = todayOsloKey(now);
    const recoveredAt = now.toISOString();
    const cutoffIso = new Date(
      now.getTime() - SCHEDULED_GAME_STALE_CUTOFF_MS,
    ).toISOString();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const clearedPlanRuns = await this.clearStalePlanRuns(
        client,
        hallId,
        todayBusinessDate,
      );

      // Build stop_reason that survives in audit-trail without violating
      // the existing `stop_reason TEXT` schema. We tag with actor id so
      // ops can correlate the cancellation with the master-action audit-
      // event.
      const sanitizedActorId = actor.userId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const stopReason = `stale_recovery_${sanitizedActorId}`;

      const clearedScheduledGames = await this.clearStaleScheduledGames(
        client,
        hallId,
        cutoffIso,
        stopReason,
      );

      await client.query("COMMIT");

      const result: StalePlanRunRecoveryResult = {
        planRunsCleared: clearedPlanRuns.length,
        scheduledGamesCleared: clearedScheduledGames.length,
        clearedPlanRuns,
        clearedScheduledGames,
        recoveredAt,
        hallId,
        todayBusinessDate,
      };

      // Best-effort audit OUTSIDE the transaction so audit-log failures
      // don't roll back the recovery itself.
      await this.audit(actor, hallId, result);

      logger.warn(
        {
          hallId,
          actorId: actor.userId,
          planRunsCleared: result.planRunsCleared,
          scheduledGamesCleared: result.scheduledGamesCleared,
          todayBusinessDate,
        },
        "[stale-plan-run-recovery] master-driven cleanup completed",
      );

      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        logger.error(
          { rollbackErr, originalErr: err, hallId },
          "[stale-plan-run-recovery] ROLLBACK failed after error",
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Mark stale plan-runs as `finished`. Returns snapshots of the rows
   * that were transitioned (caller uses them for audit + the API
   * response).
   *
   * SQL pattern:
   *   1. SELECT candidates with FOR UPDATE so concurrent recovery calls
   *      don't double-process the same row.
   *   2. UPDATE matching rows. We re-check the WHERE-clause in the
   *      UPDATE itself so a race that finishes a row between SELECT and
   *      UPDATE is safe — the UPDATE simply matches zero rows for that
   *      id and we drop it from the snapshot.
   */
  private async clearStalePlanRuns(
    client: PoolClient,
    hallId: string,
    todayBusinessDate: string,
  ): Promise<StalePlanRunSnapshot[]> {
    const { rows } = await client.query<PlanRunRow>(
      `SELECT id, plan_id, business_date, status, current_position
         FROM ${this.planRunTable()}
        WHERE hall_id = $1
          AND business_date < $2::date
          AND status <> 'finished'
        ORDER BY business_date ASC, id ASC
        FOR UPDATE`,
      [hallId, todayBusinessDate],
    );

    if (rows.length === 0) return [];

    const cleared: StalePlanRunSnapshot[] = [];
    for (const row of rows) {
      const { rows: updated } = await client.query<{ id: string }>(
        `UPDATE ${this.planRunTable()}
            SET status      = 'finished',
                finished_at = COALESCE(finished_at, now()),
                updated_at  = now()
          WHERE id = $1
            AND status <> 'finished'
          RETURNING id`,
        [row.id],
      );
      if (updated.length === 0) {
        // Race-loser — another transaction finished the row first. Skip.
        continue;
      }
      cleared.push({
        id: row.id,
        businessDate: dateRowToString(row.business_date),
        status: row.status,
        currentPosition: row.current_position,
        planId: row.plan_id,
      });
    }
    return cleared;
  }

  /**
   * Mark stuck scheduled-games as `cancelled`. We use `scheduled_end_time
   * < now() - 24h` instead of `business_date` because scheduled-games
   * use a TIMESTAMPTZ end-time rather than a DATE business-date, and we
   * want a tighter cutoff (don't touch today's later-ending games).
   *
   * The SELECT FOR UPDATE prevents concurrent recovery calls from
   * double-processing; the UPDATE re-checks the cutoff so a row that
   * legitimately completed between SELECT and UPDATE is left alone.
   */
  private async clearStaleScheduledGames(
    client: PoolClient,
    hallId: string,
    cutoffIso: string,
    stopReason: string,
  ): Promise<StaleScheduledGameSnapshot[]> {
    const { rows } = await client.query<ScheduledGameRow>(
      `SELECT id, status, scheduled_start_time, scheduled_end_time,
              sub_game_name, group_hall_id
         FROM ${this.scheduledGamesTable()}
        WHERE master_hall_id = $1
          AND status NOT IN ('completed', 'cancelled')
          AND scheduled_end_time < $2::timestamptz
        ORDER BY scheduled_end_time ASC, id ASC
        FOR UPDATE`,
      [hallId, cutoffIso],
    );

    if (rows.length === 0) return [];

    const cleared: StaleScheduledGameSnapshot[] = [];
    for (const row of rows) {
      const { rows: updated } = await client.query<{ id: string }>(
        `UPDATE ${this.scheduledGamesTable()}
            SET status            = 'cancelled',
                stopped_by_user_id = $2,
                stop_reason        = $3,
                actual_end_time    = COALESCE(actual_end_time, now()),
                updated_at         = now()
          WHERE id = $1
            AND status NOT IN ('completed', 'cancelled')
          RETURNING id`,
        [row.id, "SYSTEM", stopReason],
      );
      if (updated.length === 0) {
        // Race-loser — skip.
        continue;
      }
      cleared.push({
        id: row.id,
        status: row.status,
        scheduledStartTime: isoOrNow(row.scheduled_start_time),
        scheduledEndTime: isoOrNow(row.scheduled_end_time),
        subGameName: row.sub_game_name,
        groupHallId: row.group_hall_id,
      });
    }
    return cleared;
  }

  /**
   * Audit-log entry for the recovery event. Same fire-and-forget pattern
   * as `MasterActionService.audit` — failures are logged but never
   * surface to the caller.
   *
   * The event is intentionally rich: the full before/after snapshot
   * captures every row that was modified so a regulator (or PM 6 months
   * from now) can reconstruct exactly what state was discarded.
   */
  private async audit(
    actor: MasterActor,
    hallId: string,
    result: StalePlanRunRecoveryResult,
  ): Promise<void> {
    if (!this.auditLogService) return;
    try {
      const actorType =
        actor.role === "ADMIN"
          ? "ADMIN"
          : actor.role === "HALL_OPERATOR"
            ? "HALL_OPERATOR"
            : actor.role === "AGENT"
              ? "AGENT"
              : actor.role === "SUPPORT"
                ? "SUPPORT"
                : "USER";
      await this.auditLogService.record({
        actorId: actor.userId,
        actorType,
        action: "spill1.master.recover_stale_plan_run",
        resource: "spill1_master_action",
        resourceId: hallId,
        details: {
          hallId,
          todayBusinessDate: result.todayBusinessDate,
          recoveredAt: result.recoveredAt,
          planRunsCleared: result.planRunsCleared,
          scheduledGamesCleared: result.scheduledGamesCleared,
          clearedPlanRuns: result.clearedPlanRuns,
          clearedScheduledGames: result.clearedScheduledGames,
        },
      });
    } catch (err) {
      logger.warn(
        { err, hallId, actorId: actor.userId },
        "[stale-plan-run-recovery] audit-log failed — recovery itself succeeded",
      );
    }
  }
}
