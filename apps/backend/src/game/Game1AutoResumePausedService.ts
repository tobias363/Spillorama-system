/**
 * ADR-0022 Lag 1: Auto-resume Spill 1 scheduled-games etter phase-pause når
 * master er beviselig borte.
 *
 * Bakgrunn: Engine auto-pauser etter hver fase-vinst (Rad 1 → ... → Fullt Hus).
 * Master forventes å klikke Fortsett. Hvis master glemmer eller mister
 * forbindelsen, henger runden indefinitely. Pilot-mål om Evolution Gaming-
 * grade 99.95% oppetid krever auto-recovery.
 *
 * Algoritme (kjøres hver `GAME1_AUTO_RESUME_TICK_INTERVAL_MS`, default 5s):
 *
 *   1. Finn scheduled-games med:
 *        - status = 'running'
 *        - engine_paused = true
 *        - paused_at_phase != null
 *        - auto_resume_eligible_at <= now() (settes av draw-engine ved phase-pause)
 *
 *   2. For hver kandidat, sjekk plan-run.master_last_seen_at:
 *        - Hvis master_last_seen_at > now() - HEARTBEAT_TIMEOUT_MS → SKIP
 *          (master er aktiv, forventes å klikke Fortsett selv)
 *        - Hvis master_last_seen_at <= terskel ELLER NULL → AUTO-RESUME
 *
 *   3. Auto-resume:
 *        - UPDATE app_game1_game_state SET paused=false, paused_at_phase=NULL
 *        - UPDATE app_game1_scheduled_games SET auto_resume_eligible_at=NULL
 *        - Skriv audit-event spill1.engine.auto_resume (action) med reason
 *          MASTER_INACTIVE
 *        - Notifier admin/UI via socket-broadcast (delegert til caller hvis
 *          ønsket — service-en er pure data-layer)
 *
 * Idempotent: hvis race med master manuell Fortsett (samme tick), vil UPDATE
 * bare være no-op (paused=false → false). engine.resumeGame er allerede
 * idempotent på samme måte.
 *
 * Fail-soft: en feilet rad blokkerer ikke andre rader i samme tick. Errors
 * logges som warn + tellet i metric counter.
 */

import type { Pool } from "pg";
import { logger as rootLogger } from "../util/logger.js";
import { AuditLogService } from "../compliance/AuditLogService.js";
import { SYSTEM_ACTOR_ID } from "./SystemActor.js";

const log = rootLogger.child({ module: "game1-auto-resume-paused" });

/**
 * Default heartbeat-timeout (90s). Hvis master_last_seen_at er nyere enn
 * dette, regnes master som aktiv og auto-resume skipper.
 */
export const DEFAULT_GAME1_MASTER_HEARTBEAT_TIMEOUT_MS = 90_000;

/**
 * Default tick-interval (5s). Justeres via env `GAME1_AUTO_RESUME_TICK_INTERVAL_MS`.
 */
export const DEFAULT_GAME1_AUTO_RESUME_TICK_INTERVAL_MS = 5_000;

/**
 * Stabile error-koder for observability. Strukturert logging bruker disse
 * til metric-dimensjonering.
 */
export const Game1AutoResumeErrorCodes = {
  /** DB-feil ved oppslag av kandidater. */
  CANDIDATE_QUERY_FAILED: "AUTO_RESUME_001",
  /** DB-feil ved UPDATE av engine-state. */
  STATE_UPDATE_FAILED: "AUTO_RESUME_002",
  /** Audit-skriv feilet (best-effort, blokkerer ikke resume). */
  AUDIT_WRITE_FAILED: "AUTO_RESUME_003",
} as const;

export interface Game1AutoResumeCandidate {
  scheduledGameId: string;
  hallId: string;
  planRunId: string | null;
  pausedAtPhase: number;
  autoResumeEligibleAt: Date;
  masterLastSeenAt: Date | null;
}

export interface Game1AutoResumeTickResult {
  candidatesFound: number;
  autoResumed: number;
  skippedMasterActive: number;
  errors: number;
}

export interface Game1AutoResumePausedDeps {
  pool: Pool;
  auditLogService: AuditLogService;
  /** Optional hook for å broadcast `game1:resumed`-event etter auto-resume. */
  onAutoResume?: (input: { scheduledGameId: string; pausedAtPhase: number }) => void;
  /** Heartbeat-timeout i ms. Default 90s. */
  heartbeatTimeoutMs?: number;
  /** Schema-prefix for DB-queries. Default "public". */
  schema?: string;
  /** Clock-injection for tester. */
  clock?: () => Date;
}

export class Game1AutoResumePausedService {
  private readonly pool: Pool;
  private readonly auditLogService: AuditLogService;
  private readonly onAutoResume:
    | ((input: { scheduledGameId: string; pausedAtPhase: number }) => void)
    | undefined;
  private readonly heartbeatTimeoutMs: number;
  private readonly schema: string;
  private readonly clock: () => Date;

  constructor(deps: Game1AutoResumePausedDeps) {
    this.pool = deps.pool;
    this.auditLogService = deps.auditLogService;
    this.onAutoResume = deps.onAutoResume;
    this.heartbeatTimeoutMs =
      deps.heartbeatTimeoutMs ?? DEFAULT_GAME1_MASTER_HEARTBEAT_TIMEOUT_MS;
    this.schema = deps.schema ?? "public";
    this.clock = deps.clock ?? (() => new Date());
  }

  /**
   * Kjør én tick. Brukes av JobScheduler.
   */
  async tick(): Promise<Game1AutoResumeTickResult> {
    const result: Game1AutoResumeTickResult = {
      candidatesFound: 0,
      autoResumed: 0,
      skippedMasterActive: 0,
      errors: 0,
    };

    let candidates: Game1AutoResumeCandidate[];
    try {
      candidates = await this.findCandidates();
    } catch (err) {
      log.warn(
        { err, errorCode: Game1AutoResumeErrorCodes.CANDIDATE_QUERY_FAILED },
        "auto-resume tick: kandidat-query feilet"
      );
      result.errors += 1;
      return result;
    }

    result.candidatesFound = candidates.length;
    if (candidates.length === 0) {
      return result;
    }

    const now = this.clock();
    const heartbeatCutoff = new Date(now.getTime() - this.heartbeatTimeoutMs);

    for (const candidate of candidates) {
      // Skip hvis master-heartbeat er friskt (master er aktiv, forventes å
      // klikke Fortsett selv).
      if (
        candidate.masterLastSeenAt !== null &&
        candidate.masterLastSeenAt > heartbeatCutoff
      ) {
        result.skippedMasterActive += 1;
        log.debug(
          {
            scheduledGameId: candidate.scheduledGameId,
            hallId: candidate.hallId,
            pausedAtPhase: candidate.pausedAtPhase,
            masterLastSeenAt: candidate.masterLastSeenAt.toISOString(),
            heartbeatTimeoutMs: this.heartbeatTimeoutMs,
          },
          "auto-resume skip: master er aktiv (heartbeat innenfor terskel)"
        );
        continue;
      }

      try {
        await this.autoResumeOne(candidate);
        result.autoResumed += 1;
      } catch (err) {
        log.warn(
          {
            err,
            scheduledGameId: candidate.scheduledGameId,
            errorCode: Game1AutoResumeErrorCodes.STATE_UPDATE_FAILED,
          },
          "auto-resume tick: feilet på én rad"
        );
        result.errors += 1;
      }
    }

    if (result.autoResumed > 0) {
      log.info(
        {
          candidatesFound: result.candidatesFound,
          autoResumed: result.autoResumed,
          skippedMasterActive: result.skippedMasterActive,
          errors: result.errors,
        },
        "auto-resume tick: ferdig"
      );
    }

    return result;
  }

  /**
   * Finn auto-resume-kandidater. JOIN på plan-run for å hente
   * master_last_seen_at i samme query.
   */
  private async findCandidates(): Promise<Game1AutoResumeCandidate[]> {
    const { rows } = await this.pool.query<{
      scheduled_game_id: string;
      hall_id: string;
      plan_run_id: string | null;
      paused_at_phase: number;
      auto_resume_eligible_at: Date;
      master_last_seen_at: Date | null;
    }>(
      `SELECT
         sg.id                        AS scheduled_game_id,
         sg.master_hall_id            AS hall_id,
         sg.plan_run_id               AS plan_run_id,
         gs.paused_at_phase           AS paused_at_phase,
         sg.auto_resume_eligible_at   AS auto_resume_eligible_at,
         pr.master_last_seen_at       AS master_last_seen_at
       FROM "${this.schema}"."app_game1_scheduled_games" sg
       INNER JOIN "${this.schema}"."app_game1_game_state" gs
         ON gs.scheduled_game_id = sg.id
       LEFT JOIN "${this.schema}"."app_game_plan_run" pr
         ON pr.id = sg.plan_run_id
       WHERE sg.status = 'running'
         AND gs.paused = true
         AND gs.paused_at_phase IS NOT NULL
         AND sg.auto_resume_eligible_at IS NOT NULL
         AND sg.auto_resume_eligible_at <= now()
       ORDER BY sg.auto_resume_eligible_at ASC
       LIMIT 50`
    );

    return rows.map((r) => ({
      scheduledGameId: r.scheduled_game_id,
      hallId: r.hall_id,
      planRunId: r.plan_run_id,
      pausedAtPhase: r.paused_at_phase,
      autoResumeEligibleAt: r.auto_resume_eligible_at,
      masterLastSeenAt: r.master_last_seen_at,
    }));
  }

  /**
   * Auto-resume én scheduled-game. Idempotent: gjentatt kall er trygt.
   */
  private async autoResumeOne(
    candidate: Game1AutoResumeCandidate
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Step 1: clear paused + paused_at_phase på engine-state.
      // Bruker conditional UPDATE for å unngå race med master manuell
      // Fortsett (de samme feltene nullstilles der også).
      const { rowCount: stateUpdated } = await client.query(
        `UPDATE "${this.schema}"."app_game1_game_state"
            SET paused = false,
                paused_at_phase = NULL
          WHERE scheduled_game_id = $1
            AND paused = true`,
        [candidate.scheduledGameId]
      );

      // Step 2: clear auto_resume_eligible_at uansett (idempotent).
      await client.query(
        `UPDATE "${this.schema}"."app_game1_scheduled_games"
            SET auto_resume_eligible_at = NULL,
                updated_at = now()
          WHERE id = $1`,
        [candidate.scheduledGameId]
      );

      await client.query("COMMIT");

      // Hvis stateUpdated=0 har master allerede klikket Fortsett — vi
      // returnerer success uten audit eller broadcast (no-op race-fix).
      if (stateUpdated === 0) {
        log.debug(
          { scheduledGameId: candidate.scheduledGameId },
          "auto-resume race: master fortsatt allerede — no-op"
        );
        return;
      }

      // Best-effort audit. Feiler audit, logger vi warn men beholder
      // resume-effekten (regulatorisk: bedre å miste audit-rad enn å miste
      // en gjenoppretting av live-runde).
      try {
        await this.auditLogService.record({
          actorType: "SYSTEM",
          actorId: SYSTEM_ACTOR_ID,
          action: "spill1.engine.auto_resume",
          resource: "spill1_scheduled_game",
          resourceId: candidate.scheduledGameId,
          details: {
            reason: "MASTER_INACTIVE",
            pausedAtPhase: candidate.pausedAtPhase,
            hallId: candidate.hallId,
            planRunId: candidate.planRunId,
            heartbeatTimeoutMs: this.heartbeatTimeoutMs,
            masterLastSeenAt:
              candidate.masterLastSeenAt?.toISOString() ?? null,
            autoResumeEligibleAt: candidate.autoResumeEligibleAt.toISOString(),
            adr: "ADR-0022",
          },
        });
      } catch (auditErr) {
        log.warn(
          {
            err: auditErr,
            scheduledGameId: candidate.scheduledGameId,
            errorCode: Game1AutoResumeErrorCodes.AUDIT_WRITE_FAILED,
          },
          "auto-resume audit-write feilet — resume effekten beholdes"
        );
      }

      // Best-effort socket-broadcast. Feiler det, henter UI ny state via
      // polling i neste runde uansett.
      if (this.onAutoResume) {
        try {
          this.onAutoResume({
            scheduledGameId: candidate.scheduledGameId,
            pausedAtPhase: candidate.pausedAtPhase,
          });
        } catch (broadcastErr) {
          log.warn(
            { err: broadcastErr, scheduledGameId: candidate.scheduledGameId },
            "auto-resume broadcast feilet — polling fanger neste runde"
          );
        }
      }

      log.info(
        {
          scheduledGameId: candidate.scheduledGameId,
          hallId: candidate.hallId,
          pausedAtPhase: candidate.pausedAtPhase,
          masterLastSeenAt:
            candidate.masterLastSeenAt?.toISOString() ?? "never",
        },
        "auto-resume: gjenopprettet pauset runde"
      );
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback-feil
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
