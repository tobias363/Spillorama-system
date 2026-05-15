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
 * Løsning (tre komplementære mekanismer):
 *   1. Cron-job (kl 03:00 Oslo-tz) — finner alle gårsdagens stale runs
 *      (`status IN ('running','paused')` + `business_date < CURRENT_DATE`)
 *      og marker dem som `finished` med audit-event
 *      `game_plan_run.auto_cleanup` (`reason='cron_nightly'`).
 *   2. Inline self-heal — `getOrCreateForToday` kaller
 *      `cleanupStaleRunsForHall(hallId)` FØR oppretter dagens rad så master
 *      aldri ser STALE_PLAN_RUN-warning fra i-går-state
 *      (`reason='inline_self_heal'`).
 *   3. Natural-end-reconcile (FIX-A 2026-05-14, BUG-A audit-evidens) —
 *      poll-job som finner DAGENS stuck plan-runs hvor alle linkede
 *      scheduled-games har `status='completed'` (naturlig vinner, ikke
 *      cancelled) og siste actual_end_time er > 30s siden. Auto-finisher
 *      plan-run med audit-event `plan_run.reconcile_natural_end`
 *      (`reason='no_master_advance_after_natural_end'`). Defaultintervall
 *      30 sek (konfigurerbar via env). Fyller hullet mellom PR #1403
 *      (master-action-triggered reconcile) og nightly cron — uten denne
 *      sitter spillere fast på "Laster..." inntil noen klikker en master-
 *      handling.
 *
 * Audit-trail:
 *   Hver auto-cleanup skriver `game_plan_run.auto_cleanup` (gårsdagens
 *   stale) eller `plan_run.reconcile_natural_end` (dagens stuck etter
 *   naturlig end) via AuditLogService med før/etter-snapshot for
 *   Lotteritilsynet-sporing.
 *
 * Idempotens:
 *   Alle UPDATE-er filtrerer på `status IN ('running','paused')` så
 *   finished rader berøres ikke. Re-kjøring i samme tick er no-op.
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

/**
 * Per-run snapshot returned from `reconcileNaturalEndStuckRuns()`. Captures
 * the triggering scheduled-game's end-time + age so audit-events have full
 * evidence-trail for Lotteritilsynet-sporing.
 */
export interface NaturalEndReconcileItem {
  id: string;
  planId: string;
  hallId: string;
  businessDate: string;
  previousStatus: GamePlanRunStatus;
  currentPosition: number;
  /** Scheduled-game-id that triggered the reconcile (newest completed). */
  scheduledGameId: string;
  /** ISO-string for the triggering game's actual_end_time. */
  scheduledGameEndedAt: string;
  /** Seconds between scheduled_game.actual_end_time and now. */
  stuckForSeconds: number;
}

export interface NaturalEndReconcileResult {
  cleanedCount: number;
  closedRuns: NaturalEndReconcileItem[];
}

export interface GamePlanRunCleanupServiceOptions {
  pool: Pool;
  schema?: string;
  auditLogService?: AuditLogService | null;
  /** Override for tests so we can inject a child-logger without setting global. */
  logger?: Logger;
  /**
   * Threshold (ms) before a naturally-ended scheduled-game's plan-run is
   * considered "stuck waiting for master-advance". Default 30 000ms.
   * Service-laget tolerer at master tar litt tid på å reagere på naturlig
   * runde-end (kortvarig manuell pause er normalt), så vi venter
   * minimumsbetingelsen før vi auto-finisher.
   */
  naturalEndStuckThresholdMs?: number;
  /**
   * Pilot Q3 2026 (2026-05-15): broadcaster for spiller-shell-state-
   * oppdatering etter `reconcileNaturalEndStuckRuns` auto-finisher en
   * plan-run. Uten denne ville spiller-shell vist "Neste spill: <gammelt>"
   * inntil neste poll-tick selv om plan-run faktisk er ferdig.
   *
   * Best-effort — feil propagerer aldri til state-mutering. Når null
   * skipper service-en stille (bakoverkompat for tester).
   */
  lobbyBroadcaster?: {
    broadcastForHall(hallId: string): Promise<void>;
  } | null;
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
  private readonly naturalEndStuckThresholdMs: number;
  private lobbyBroadcaster: {
    broadcastForHall(hallId: string): Promise<void>;
  } | null;

  constructor(options: GamePlanRunCleanupServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.auditLogService = options.auditLogService ?? null;
    this.logger = options.logger ?? log;
    // Default 30 sek — service-laget tolerer kort manuell pause. Min 1 sek
    // for å unngå degenerert "react instantly"-konfig.
    const requestedMs =
      options.naturalEndStuckThresholdMs ?? 30_000;
    this.naturalEndStuckThresholdMs = Math.max(1_000, Math.floor(requestedMs));
    this.lobbyBroadcaster = options.lobbyBroadcaster ?? null;
  }

  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service ?? null;
  }

  /**
   * Pilot Q3 2026 (2026-05-15): late-binding for lobby-broadcaster.
   * Brukes når broadcaster konstrueres etter cleanup-service.
   */
  setLobbyBroadcaster(
    broadcaster: {
      broadcastForHall(hallId: string): Promise<void>;
    } | null,
  ): void {
    this.lobbyBroadcaster = broadcaster;
  }

  private table(): string {
    return `"${this.schema}"."app_game_plan_run"`;
  }

  private schedTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
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

  /**
   * BUG-A (audit:db `stuck-plan-run` 2026-05-14): poll-driven reconcile for
   * DAGENS plan-runs hvor naturlig runde-end ikke har trigget master-
   * advance. Fyller hullet mellom:
   *   - PR #1403 `MasterActionService.reconcileStuckPlanRuns` (kun ved
   *     manuell master-handling — fyrer aldri uten klikk)
   *   - `cleanupAllStale` (kun gårsdagens stale)
   *
   * Logikk (1:1 paritet med audit:db `stuck-plan-run`-query, utvidet med
   *  threshold-check):
   *   - Finn plan-runs hvor status='running'
   *   - LEFT JOIN scheduled-games på plan_run_id
   *   - HAVING ingen aktiv scheduled-game (`scheduled` / `purchase_open` /
   *     `ready_to_start` / `running` / `paused`)
   *   - OG nyeste completed scheduled-game har `actual_end_time` > threshold
   *     siden (default 30 sek). Cancelled scheduled-games kvalifiserer IKKE
   *     som naturlig-end — dette hindrer at vi masker cancellation-bugs.
   *
   * For hver match:
   *   - UPDATE plan-run til status='finished' + finished_at=now()
   *   - Skriv audit-event `plan_run.reconcile_natural_end` med fullt
   *     scheduled-game-id + stuck_for_seconds + reason
   *
   * Idempotens: re-kjøring etter første finish er no-op (status='running'-
   * filter feiler i WHERE-klausulen).
   *
   * Soft-fail: 42P01 → no-op (fresh DB-boot). Andre PG-feil bubbles til
   * cron som logger og prøver neste tick.
   */
  async reconcileNaturalEndStuckRuns(
    now: Date = new Date(),
  ): Promise<NaturalEndReconcileResult> {
    const thresholdMs = this.naturalEndStuckThresholdMs;
    const params: unknown[] = [thresholdMs];

    // The CTE flow:
    //   completed_sched: per plan_run_id, finn nyeste completed
    //     scheduled-game (MAX(actual_end_time)).
    //   active_sched_count: per plan_run_id, count av aktive
    //     scheduled-games.
    //   stuck: plan-runs hvor status='running' + 0 aktive
    //     + nyeste completed-game er > threshold-sek siden.
    //   updated: gjør UPDATE og returner rad-id-er.
    //   final SELECT: kombiner stuck + completed-info for audit.
    //
    // Vi bruker `FOR UPDATE OF pr` i CTE-en for å låse plan-run-raden
    // konsistent ved multi-instance deploy (samme mønster som
    // `cleanupStaleRunsInternal`).
    const sql = `
      WITH active_sched_counts AS (
        SELECT plan_run_id, COUNT(*)::int AS active_count
        FROM ${this.schedTable()}
        WHERE plan_run_id IS NOT NULL
          AND status IN ('scheduled','purchase_open','ready_to_start','running','paused')
        GROUP BY plan_run_id
      ),
      completed_sched AS (
        SELECT plan_run_id,
               (ARRAY_AGG(id ORDER BY actual_end_time DESC NULLS LAST))[1] AS sched_id,
               MAX(actual_end_time) AS ended_at
        FROM ${this.schedTable()}
        WHERE plan_run_id IS NOT NULL
          AND status = 'completed'
          AND actual_end_time IS NOT NULL
        GROUP BY plan_run_id
      ),
      stuck AS (
        SELECT pr.id, pr.plan_id, pr.hall_id, pr.business_date,
               pr.current_position, pr.status,
               pr.jackpot_overrides_json, pr.started_at, pr.finished_at,
               pr.master_user_id, pr.created_at, pr.updated_at,
               cs.sched_id AS scheduled_game_id,
               cs.ended_at AS scheduled_game_ended_at,
               EXTRACT(EPOCH FROM (now() - cs.ended_at))::int AS stuck_for_seconds
        FROM ${this.table()} pr
        INNER JOIN completed_sched cs ON cs.plan_run_id = pr.id
        LEFT JOIN active_sched_counts asc_t ON asc_t.plan_run_id = pr.id
        WHERE pr.status = 'running'
          AND COALESCE(asc_t.active_count, 0) = 0
          AND cs.ended_at < now() - ($1::int * INTERVAL '1 millisecond')
        FOR UPDATE OF pr
      ),
      updated AS (
        UPDATE ${this.table()} r
        SET status = 'finished',
            finished_at = COALESCE(r.finished_at, now()),
            updated_at = now()
        FROM stuck
        WHERE r.id = stuck.id
        RETURNING r.id
      )
      SELECT s.id, s.plan_id, s.hall_id, s.business_date, s.current_position,
             s.status, s.jackpot_overrides_json, s.started_at, s.finished_at,
             s.master_user_id, s.created_at, s.updated_at,
             s.scheduled_game_id, s.scheduled_game_ended_at,
             s.stuck_for_seconds
      FROM stuck s
      INNER JOIN updated u ON u.id = s.id
    `;

    interface ReconcileRow extends GamePlanRunRow {
      scheduled_game_id: string;
      scheduled_game_ended_at: Date | string;
      stuck_for_seconds: number | string;
    }

    let rows: ReconcileRow[];
    try {
      const result = await this.pool.query<ReconcileRow>(sql, params);
      rows = result.rows;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "42P01") {
        // Migration ikke kjørt enda — safe no-op.
        this.logger.warn(
          { reason: "natural_end_reconcile" },
          "app_game_plan_run or app_game1_scheduled_games table missing — skipping natural-end reconcile",
        );
        return { cleanedCount: 0, closedRuns: [] };
      }
      throw err;
    }

    const closedRuns: NaturalEndReconcileItem[] = rows.map((r) => {
      const base = summarizeRow(r);
      const endedAtIso = asIso(r.scheduled_game_ended_at);
      return {
        id: base.id,
        planId: base.planId,
        hallId: base.hallId,
        businessDate: base.businessDate,
        previousStatus: base.status,
        currentPosition: base.currentPosition,
        scheduledGameId: r.scheduled_game_id,
        scheduledGameEndedAt: endedAtIso,
        stuckForSeconds: Number(r.stuck_for_seconds),
      };
    });

    // Best-effort audit per closed row. Same pattern as `auditCleanup` —
    // audit-failures are logged but never block the caller (UPDATE already
    // committed).
    for (const item of closedRuns) {
      void this.auditNaturalEndReconcile({ item, now });
    }

    // Pilot Q3 2026 (2026-05-15): broadcast spiller-shell-state for hver
    // hall som ble auto-reconciled. Uten dette ville spiller-shell vist
    // "Neste spill: <gammelt>" inntil neste 3s/10s-poll-tick selv etter
    // at plan-run faktisk er ferdig. Tobias-rapport 2026-05-15: 2-min
    // delay observert i live-test — denne pathen dekker tilfellet hvor
    // master ikke trykker advance/finish manuelt etter natural round-end.
    //
    // Fire-and-forget — broadcaster-feil logges av broadcaster selv og
    // påvirker ikke audit eller cleanup-result.
    for (const item of closedRuns) {
      this.fireLobbyBroadcastForFinish(item.hallId);
    }

    if (closedRuns.length > 0) {
      this.logger.warn(
        {
          cleanedCount: closedRuns.length,
          closedRuns: closedRuns.map((r) => ({
            id: r.id,
            hallId: r.hallId,
            scheduledGameId: r.scheduledGameId,
            stuckForSeconds: r.stuckForSeconds,
          })),
        },
        `auto-reconciled ${closedRuns.length} stuck plan-runs after natural round-end`,
      );
    }

    return { cleanedCount: closedRuns.length, closedRuns };
  }

  /**
   * Pilot Q3 2026 (2026-05-15): fire-and-forget lobby-broadcast etter
   * auto-finish av plan-run. Best-effort — broadcaster-feil propagerer
   * aldri. Når null skipper service-en stille.
   */
  private fireLobbyBroadcastForFinish(hallId: string): void {
    if (!this.lobbyBroadcaster) return;
    const broadcaster = this.lobbyBroadcaster;
    try {
      void Promise.resolve(broadcaster.broadcastForHall(hallId)).catch(
        (err) => {
          this.logger.warn(
            { err, hallId },
            "[plan-run-cleanup] lobby-broadcast etter natural-end reconcile feilet — best-effort",
          );
        },
      );
    } catch (err) {
      this.logger.warn(
        { err, hallId },
        "[plan-run-cleanup] lobby-broadcast etter natural-end reconcile kastet synkront — best-effort",
      );
    }
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

  private async auditNaturalEndReconcile(input: {
    item: NaturalEndReconcileItem;
    now: Date;
  }): Promise<void> {
    if (!this.auditLogService) return;
    try {
      await this.auditLogService.record({
        actorId: "system",
        actorType: "SYSTEM",
        action: "plan_run.reconcile_natural_end",
        resource: "game_plan_run",
        resourceId: input.item.id,
        details: {
          planRunId: input.item.id,
          hallId: input.item.hallId,
          businessDate: input.item.businessDate,
          currentPosition: input.item.currentPosition,
          scheduledGameId: input.item.scheduledGameId,
          scheduledGameEndedAt: input.item.scheduledGameEndedAt,
          stuckForSeconds: input.item.stuckForSeconds,
          reason: "no_master_advance_after_natural_end",
          thresholdMs: this.naturalEndStuckThresholdMs,
          reconciledAt: input.now.toISOString(),
        },
      });
    } catch (err) {
      this.logger.warn(
        { err, runId: input.item.id },
        "audit-log record failed for natural-end-reconcile — continuing",
      );
    }
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
