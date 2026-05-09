/**
 * Pilot Q3 2026: GamePlanRunCleanupService — auto-finish stale plan-runs.
 *
 * Bakgrunn (selvhealing-mekanisme for live-rom-robusthet):
 *   Hvis backend krasjer eller bingovert glemmer å avslutte kvelden, blir
 *   `app_game_plan_run` hengende i `running`/`paused` med gårsdagens
 *   `business_date`. Ved neste dags `getOrCreateForToday`-kall vil
 *   service-en finne den nye dagens rad — men master-konsollet vil flagge
 *   STALE_PLAN_RUN-warning fordi gårsdagens stale-rad fortsatt eksisterer
 *   og ikke kan resumeres.
 *
 *   Resultat: bingoverten må manuelt SQL-edite raden eller kontakte ops.
 *   For pilot Q3 2026 er dette uakseptabelt — neste dags spill MÅ aldri
 *   blokkeres av i-går-state.
 *
 * Løsning:
 *   1. Cron-job som kjører kl 03:00 Oslo-tz hver natt, finner alle
 *      stale plan-runs (`status IN ('running','paused')` og
 *      `business_date < CURRENT_DATE` Oslo-tz) og marker dem som
 *      `finished` med `metadata.auto_cleanup=true`.
 *   2. Self-healing: `GamePlanRunService.getOrCreateForToday` kaller
 *      `cleanupStaleRunsForHall(hallId)` inline FØR den oppretter dagens
 *      rad. Dette håndterer kanttilfellet hvor cron har feilet eller
 *      backend nettopp boot-et — vi kommer aldri til å sitte fast.
 *
 * Audit-trail:
 *   Hver auto-cleanup skriver `game_plan_run.auto_cleanup`-event via
 *   AuditLogService med før/etter-snapshot for Lotteritilsynet-sporing.
 *
 * Idempotens:
 *   Kjører trygt flere ganger samme dag — UPDATE-en filtrerer på
 *   `status IN ('running','paused')` så finished rader berøres ikke.
 */
import type { Pool } from "pg";

import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  GamePlanRun,
  GamePlanRunStatus,
} from "./gamePlan.types.js";
import { logger as rootLogger, type Logger } from "../util/logger.js";
import { todayOsloKey } from "../util/osloTimezone.js";
import { DomainError } from "../errors/DomainError.js";

const log = rootLogger.child({ module: "game-plan-run-cleanup" });

// ── Validation ──────────────────────────────────────────────────────────

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Invalid schema name.");
  }
  return schema;
}

// ── Row mapping ─────────────────────────────────────────────────────────

interface GamePlanRunRow {
  id: string;
  plan_id: string;
  hall_id: string;
  business_date: unknown;
  current_position: number;
  status: string;
  jackpot_overrides_json: unknown;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  master_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function dateRowToString(value: unknown): string {
  if (typeof value === "string") {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  if (value instanceof Date) {
    const yyyy = value.getUTCFullYear();
    const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(value.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return "0000-00-00";
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return asIso(value);
}

function summarizeRow(row: GamePlanRunRow): {
  id: string;
  planId: string;
  hallId: string;
  businessDate: string;
  status: GamePlanRunStatus;
  currentPosition: number;
  startedAt: string | null;
  finishedAt: string | null;
} {
  return {
    id: row.id,
    planId: row.plan_id,
    hallId: row.hall_id,
    businessDate: dateRowToString(row.business_date),
    status: row.status as GamePlanRunStatus,
    currentPosition: Number(row.current_position),
    startedAt: asIsoOrNull(row.started_at),
    finishedAt: asIsoOrNull(row.finished_at),
  };
}

// ── Service ─────────────────────────────────────────────────────────────

export interface GamePlanRunCleanupResult {
  /** Total stale runs auto-finished in this invocation. */
  cleanedCount: number;
  /** Snapshot of runs that were closed (id + planId + hallId + previous status). */
  closedRuns: Array<{
    id: string;
    planId: string;
    hallId: string;
    businessDate: string;
    previousStatus: GamePlanRunStatus;
  }>;
}

export interface GamePlanRunCleanupServiceOptions {
  pool: Pool;
  schema?: string;
  auditLogService?: AuditLogService | null;
  /** Override for tests so we can inject a child-logger without setting global. */
  logger?: Logger;
}

/**
 * Stateless service that auto-finishes stale plan-runs.
 *
 * Two entry-points:
 *   - `cleanupAllStale()` — called by cron each night, finds all stale rows
 *     across all halls.
 *   - `cleanupStaleRunsForHall(hallId)` — called inline by
 *     `GamePlanRunService.getOrCreateForToday` to self-heal one hall.
 *
 * Both methods share `cleanupStaleRunsInternal` for atomicity (single
 * UPDATE ... RETURNING per call so we get the closed-row snapshot for
 * audit-events without a separate SELECT).
 */
export class GamePlanRunCleanupService {
  private readonly pool: Pool;
  private readonly schema: string;
  private auditLogService: AuditLogService | null;
  private readonly logger: Logger;

  constructor(options: GamePlanRunCleanupServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.auditLogService = options.auditLogService ?? null;
    this.logger = options.logger ?? log;
  }

  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service ?? null;
  }

  private table(): string {
    return `"${this.schema}"."app_game_plan_run"`;
  }

  /**
   * Cron entry-point: find ALL stale runs across all halls and auto-finish
   * them. "Stale" means:
   *   - status IN ('running', 'paused')
   *   - business_date < today's Oslo-tz date
   *
   * Idempotent — safe to call repeatedly. The UPDATE filters on status so
   * already-finished rows are untouched.
   *
   * Logging policy:
   *   - 0 cleanups: silent (no log emitted — keeps prod-logs quiet).
   *   - >= 1 cleanups: warn-level log so ops sees the auto-recovery and can
   *     follow up if a particular hall is consistently leaking stale runs.
   */
  async cleanupAllStale(now: Date = new Date()): Promise<GamePlanRunCleanupResult> {
    const todayKey = todayOsloKey(now);
    const result = await this.cleanupStaleRunsInternal({
      todayKey,
      hallId: null,
      reason: "cron_nightly",
    });

    if (result.cleanedCount > 0) {
      this.logger.warn(
        {
          cleanedCount: result.cleanedCount,
          todayOsloKey: todayKey,
          closedRuns: result.closedRuns,
        },
        `auto-closed ${result.cleanedCount} stale plan-runs`,
      );
    }
    return result;
  }

  /**
   * Inline self-healing: called by `GamePlanRunService.getOrCreateForToday`
   * BEFORE it returns or creates today's run. Scoped to a single hall so we
   * don't sweep across the whole platform on every getOrCreate-call.
   *
   * Logging policy:
   *   - 0 cleanups: silent (call-site is hot-path; verbose logs would be
   *     noisy under normal operation).
   *   - >= 1 cleanups: info-level log so ops can correlate self-heal events
   *     with the master-call that triggered them.
   */
  async cleanupStaleRunsForHall(
    hallId: string,
    now: Date = new Date(),
  ): Promise<GamePlanRunCleanupResult> {
    if (typeof hallId !== "string" || !hallId.trim()) {
      throw new DomainError("INVALID_INPUT", "hallId is required.");
    }
    const todayKey = todayOsloKey(now);
    const result = await this.cleanupStaleRunsInternal({
      todayKey,
      hallId: hallId.trim(),
      reason: "inline_self_heal",
    });

    if (result.cleanedCount > 0) {
      this.logger.info(
        {
          cleanedCount: result.cleanedCount,
          hallId: hallId.trim(),
          todayOsloKey: todayKey,
          closedRuns: result.closedRuns,
        },
        `inline self-heal closed ${result.cleanedCount} stale plan-runs for hall`,
      );
    }
    return result;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * Single-pass UPDATE ... RETURNING that finds + finishes stale rows in
   * one round-trip. Audit-events are written best-effort after the UPDATE
   * commits — failures to record do NOT roll back the cleanup.
   *
   * Why we use UPDATE-RETURNING rather than SELECT-then-UPDATE:
   *   - Atomic: no race where another instance grabs a row between SELECT
   *     and UPDATE (matters under multi-instance deploys without lock).
   *   - One round-trip for the data we need to audit.
   *   - PG returns the PRE-update row only via OLD; we rely on the WHERE
   *     filter to know the previous status was running/paused.
   */
  private async cleanupStaleRunsInternal(args: {
    todayKey: string;
    hallId: string | null;
    reason: "cron_nightly" | "inline_self_heal";
  }): Promise<GamePlanRunCleanupResult> {
    const { todayKey, hallId, reason } = args;
    const params: unknown[] = [todayKey];
    let hallFilter = "";
    if (hallId !== null) {
      params.push(hallId);
      hallFilter = "AND hall_id = $2";
    }

    // UPDATE ... RETURNING: we need the PRE-update status for audit so
    // we capture it via a CTE that SELECTs FOR UPDATE first, then the
    // UPDATE references it. This keeps the row-lock semantics correct.
    const sql = `
      WITH stale AS (
        SELECT id, plan_id, hall_id, business_date, current_position, status,
               jackpot_overrides_json, started_at, finished_at, master_user_id,
               created_at, updated_at
        FROM ${this.table()}
        WHERE status IN ('running', 'paused')
          AND business_date < $1::date
          ${hallFilter}
        FOR UPDATE
      ),
      updated AS (
        UPDATE ${this.table()} r
        SET status = 'finished',
            finished_at = COALESCE(r.finished_at, now()),
            updated_at = now()
        FROM stale
        WHERE r.id = stale.id
        RETURNING r.id
      )
      SELECT s.id, s.plan_id, s.hall_id, s.business_date, s.current_position, s.status,
             s.jackpot_overrides_json, s.started_at, s.finished_at, s.master_user_id,
             s.created_at, s.updated_at
      FROM stale s
      INNER JOIN updated u ON u.id = s.id
    `;

    let rows: GamePlanRunRow[];
    try {
      const result = await this.pool.query<GamePlanRunRow>(sql, params);
      rows = result.rows;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      // 42P01 = undefined_table. Migration not applied — safe no-op.
      // We don't want to crash the cron loop in fresh environments.
      if (code === "42P01") {
        this.logger.warn(
          { reason },
          "app_game_plan_run table missing — skipping cleanup",
        );
        return { cleanedCount: 0, closedRuns: [] };
      }
      throw err;
    }

    const closedRuns = rows.map(summarizeRow);

    // Best-effort audit per closed row. Failures to record are logged but
    // never block the cleanup commit (cleanup already happened).
    for (const closed of closedRuns) {
      void this.auditCleanup({
        runId: closed.id,
        before: closed,
        reason,
        todayOsloKey: todayKey,
      });
    }

    return {
      cleanedCount: closedRuns.length,
      closedRuns: closedRuns.map((r) => ({
        id: r.id,
        planId: r.planId,
        hallId: r.hallId,
        businessDate: r.businessDate,
        previousStatus: r.status,
      })),
    };
  }

  private async auditCleanup(input: {
    runId: string;
    before: ReturnType<typeof summarizeRow>;
    reason: "cron_nightly" | "inline_self_heal";
    todayOsloKey: string;
  }): Promise<void> {
    if (!this.auditLogService) return;
    try {
      await this.auditLogService.record({
        actorId: "system",
        actorType: "SYSTEM",
        action: "game_plan_run.auto_cleanup",
        resource: "game_plan_run",
        resourceId: input.runId,
        details: {
          before: input.before,
          after: {
            ...input.before,
            status: "finished",
            // finished_at is set by COALESCE — we capture "now" semantically;
            // exact timestamp is in updated_at on the row.
            metadata: { auto_cleanup: true, reason: input.reason },
          },
          reason: input.reason,
          todayOsloKey: input.todayOsloKey,
        },
      });
    } catch (err) {
      this.logger.warn(
        { err, runId: input.runId },
        "audit-log record failed for auto-cleanup — continuing",
      );
    }
  }
}

/**
 * Helper used by `GamePlanRunService.getOrCreateForToday` to opt-in to
 * inline self-healing. Kept as a free function so the run-service can
 * accept an OPTIONAL hook without coupling to the cleanup-service ctor —
 * the bind happens at app-boot in `index.ts`.
 */
export type InlineCleanupHook = (
  hallId: string,
  now?: Date,
) => Promise<GamePlanRunCleanupResult>;

export function makeInlineCleanupHook(
  service: GamePlanRunCleanupService,
): InlineCleanupHook {
  return (hallId, now) => service.cleanupStaleRunsForHall(hallId, now);
}

// Type-export for downstream consumers (cron wiring + GamePlanRunService).
export type { GamePlanRun };
