/**
 * ADR-0022 Lag 2: Auto-end Spill 1 scheduled-games som er virkelig stuck.
 *
 * Bakgrunn: Lag 1 (Game1AutoResumePausedService) håndterer normalfallet hvor
 * master har glemt å klikke Fortsett etter en phase-pause. Lag 2 er siste-
 * skanse-cleanup for tilfeller hvor:
 *   (a) Engine skulle trekke baller men gjør det ikke (Redis-feil, scheduler
 *       death, draw-bag glitch) — `STUCK_NO_DRAWS`
 *   (b) Scheduled_end_time er passert med betydelig margin (default 30 min)
 *       OG actual_start_time er minst pastEndThresholdMs gammel — `SCHEDULED_END_EXCEEDED`
 *
 * Algoritme (kjøres hver `GAME1_STUCK_DETECTION_INTERVAL_MS`, default 60s):
 *
 *   1. Finn scheduled-games med:
 *        - status IN ('running','paused')
 *        - PLUS ÉN av to stuck-indikatorer:
 *          (a) STUCK_NO_DRAWS:
 *              status = 'running'
 *              AND engine.paused = false
 *              AND last_drawn_at < now() - STUCK_NO_DRAWS_THRESHOLD_MS
 *              (default 5 min uten draws → noe er galt med scheduler/engine)
 *          (b) SCHEDULED_END_EXCEEDED:
 *              scheduled_end_time + STUCK_PAST_END_THRESHOLD_MS < now()
 *              AND (actual_start_time IS NULL
 *                   OR actual_start_time + STUCK_PAST_END_THRESHOLD_MS < now())
 *              (default 30 min etter scheduled-end + minst 30 min siden
 *               faktisk start. Grace-period 2026-05-12 (Tobias-direktiv):
 *               master kan starte en spilleplan-posisjon hvis scheduled_end_time
 *               allerede er i fortiden — vi gir minst 30 min reell spilletid
 *               før watchdog kan kansellere via denne pathen.)
 *
 *   2. Auto-end:
 *        - UPDATE scheduled_games SET status='cancelled',
 *          stopped_by_user_id=SYSTEM, stop_reason=<reason>, actual_end_time=now()
 *        - UPDATE game_state SET engine_ended_at=now() (idempotent via COALESCE)
 *        - Skriv audit-event `spill1.engine.auto_end_stuck` med reason-detalj
 *        - Beste-effort: destroy BingoEngine-rom (hvis aktivt)
 *        - Beste-effort: broadcast via onAutoEnd-hook
 *
 * Idempotent: hvis race med master manuell stop, vil UPDATE-en bare
 * påvirke rader som fortsatt er i (running, paused) — andre rader ignoreres.
 *
 * Fail-soft: en feilet rad blokkerer ikke andre rader i samme tick.
 *
 * Compliance: auto-end skrives som standard audit-event slik at Lotteritilsynet
 * kan se hvor mange runder som er stuck (helsesignal for pilot).
 *
 * Grace-period for SCHEDULED_END_EXCEEDED (2026-05-12, Tobias-direktiv):
 * Tidligere kunne en runde som startet 45 min etter scheduled_end_time bli
 * auto-kansellert innen sekunder fordi `scheduled_end_time + 30min < now()`
 * var sant umiddelbart. Nå kreves det også at `actual_start_time + 30min <
 * now()` — m.a.o. minst 30 min faktisk spilletid. Hvis actual_start_time
 * er NULL (runden er ikke faktisk startet enda men sitter i 'running'-state
 * fra master-trigger), faller vi tilbake til den eksisterende oppførselen
 * for å unngå at slike rader henger evig.
 */

import type { Pool } from "pg";
import { logger as rootLogger } from "../util/logger.js";
import { AuditLogService } from "../compliance/AuditLogService.js";
import { SYSTEM_ACTOR_ID } from "./SystemActor.js";

const log = rootLogger.child({ module: "game1-stuck-game-detection" });

export const DEFAULT_GAME1_STUCK_DETECTION_INTERVAL_MS = 60_000;
export const DEFAULT_GAME1_STUCK_NO_DRAWS_THRESHOLD_MS = 300_000; // 5 min
export const DEFAULT_GAME1_STUCK_PAST_END_THRESHOLD_MS = 1_800_000; // 30 min

export const Game1StuckDetectionErrorCodes = {
  CANDIDATE_QUERY_FAILED: "STUCK_001",
  AUTO_END_FAILED: "STUCK_002",
  AUDIT_WRITE_FAILED: "STUCK_003",
  ROOM_DESTROY_FAILED: "STUCK_004",
} as const;

export type Game1StuckReason = "STUCK_NO_DRAWS" | "SCHEDULED_END_EXCEEDED";

export interface Game1StuckCandidate {
  scheduledGameId: string;
  hallId: string;
  planRunId: string | null;
  priorStatus: "running" | "paused";
  reason: Game1StuckReason;
  lastDrawnAt: Date | null;
  scheduledEndTime: Date | null;
  /**
   * Actual start-time (NULL hvis runden aldri startet, men sitter i
   * 'running'/'paused'-state). Brukes til grace-period-sjekk for
   * SCHEDULED_END_EXCEEDED: en runde som nettopp startet skal ikke
   * auto-kanselleres umiddelbart selv om scheduled_end_time er passert.
   */
  actualStartTime: Date | null;
}

export interface Game1StuckTickResult {
  candidatesFound: number;
  autoEnded: number;
  errors: number;
}

/**
 * Engine-stop-port: minimal grensesnitt mot Game1DrawEngineService så
 * service-en kan kalles uten å importere hele draw-engine-grafen (testbar
 * isolert + unngår sirkulær import).
 */
export interface Game1EngineStopPort {
  stopGame(
    scheduledGameId: string,
    reason: string,
    actorUserId: string
  ): Promise<void>;
  /**
   * Best-effort: rydd BingoEngine-rom hvis det finnes. Forventes å svelge
   * ROOM_NOT_FOUND.
   */
  destroyRoomForScheduledGameSafe?(
    scheduledGameId: string,
    reasonTag: string
  ): Promise<void>;
}

export interface Game1StuckGameDetectionDeps {
  pool: Pool;
  auditLogService: AuditLogService;
  engineStop: Game1EngineStopPort;
  /** Optional hook for å broadcast `game1:stopped`-event etter auto-end. */
  onAutoEnd?: (input: {
    scheduledGameId: string;
    reason: Game1StuckReason;
  }) => void;
  /** STUCK_NO_DRAWS-terskel i ms. Default 5 min. */
  noDrawsThresholdMs?: number;
  /** SCHEDULED_END_EXCEEDED-terskel i ms. Default 30 min. */
  pastEndThresholdMs?: number;
  schema?: string;
  clock?: () => Date;
}

export class Game1StuckGameDetectionService {
  private readonly pool: Pool;
  private readonly auditLogService: AuditLogService;
  private readonly engineStop: Game1EngineStopPort;
  private readonly onAutoEnd:
    | ((input: { scheduledGameId: string; reason: Game1StuckReason }) => void)
    | undefined;
  private readonly noDrawsThresholdMs: number;
  private readonly pastEndThresholdMs: number;
  private readonly schema: string;
  private readonly clock: () => Date;

  constructor(deps: Game1StuckGameDetectionDeps) {
    this.pool = deps.pool;
    this.auditLogService = deps.auditLogService;
    this.engineStop = deps.engineStop;
    this.onAutoEnd = deps.onAutoEnd;
    this.noDrawsThresholdMs =
      deps.noDrawsThresholdMs ?? DEFAULT_GAME1_STUCK_NO_DRAWS_THRESHOLD_MS;
    this.pastEndThresholdMs =
      deps.pastEndThresholdMs ?? DEFAULT_GAME1_STUCK_PAST_END_THRESHOLD_MS;
    this.schema = deps.schema ?? "public";
    this.clock = deps.clock ?? (() => new Date());
  }

  async tick(): Promise<Game1StuckTickResult> {
    const result: Game1StuckTickResult = {
      candidatesFound: 0,
      autoEnded: 0,
      errors: 0,
    };

    let candidates: Game1StuckCandidate[];
    try {
      candidates = await this.findCandidates();
    } catch (err) {
      log.warn(
        { err, errorCode: Game1StuckDetectionErrorCodes.CANDIDATE_QUERY_FAILED },
        "stuck-detection tick: kandidat-query feilet"
      );
      result.errors += 1;
      return result;
    }

    result.candidatesFound = candidates.length;
    if (candidates.length === 0) {
      return result;
    }

    for (const candidate of candidates) {
      try {
        await this.autoEndOne(candidate);
        result.autoEnded += 1;
      } catch (err) {
        log.warn(
          {
            err,
            scheduledGameId: candidate.scheduledGameId,
            reason: candidate.reason,
            errorCode: Game1StuckDetectionErrorCodes.AUTO_END_FAILED,
          },
          "stuck-detection tick: auto-end feilet på én rad"
        );
        result.errors += 1;
      }
    }

    if (result.autoEnded > 0) {
      log.warn(
        {
          candidatesFound: result.candidatesFound,
          autoEnded: result.autoEnded,
          errors: result.errors,
        },
        "stuck-detection tick: auto-endet stuck runde(r) — undersøk root cause"
      );
    }

    return result;
  }

  private async findCandidates(): Promise<Game1StuckCandidate[]> {
    const noDrawsCutoffMs = this.noDrawsThresholdMs;
    const pastEndCutoffMs = this.pastEndThresholdMs;

    const { rows } = await this.pool.query<{
      scheduled_game_id: string;
      hall_id: string;
      plan_run_id: string | null;
      status: "running" | "paused";
      last_drawn_at: Date | null;
      scheduled_end_time: Date | null;
      actual_start_time: Date | null;
      reason: Game1StuckReason;
    }>(
      `SELECT
         sg.id                          AS scheduled_game_id,
         sg.master_hall_id              AS hall_id,
         sg.plan_run_id                 AS plan_run_id,
         sg.status                      AS status,
         gs.last_drawn_at               AS last_drawn_at,
         sg.scheduled_end_time          AS scheduled_end_time,
         sg.actual_start_time           AS actual_start_time,
         CASE
           WHEN sg.scheduled_end_time IS NOT NULL
                AND sg.scheduled_end_time + ($2::int * INTERVAL '1 ms') < now()
                AND (
                  sg.actual_start_time IS NULL
                  OR sg.actual_start_time + ($2::int * INTERVAL '1 ms') < now()
                )
             THEN 'SCHEDULED_END_EXCEEDED'
           ELSE 'STUCK_NO_DRAWS'
         END                            AS reason
       FROM "${this.schema}"."app_game1_scheduled_games" sg
       INNER JOIN "${this.schema}"."app_game1_game_state" gs
         ON gs.scheduled_game_id = sg.id
       WHERE sg.status IN ('running','paused')
         AND gs.engine_ended_at IS NULL
         AND (
           -- (a) STUCK_NO_DRAWS: engine should be running but isn't
           (
             sg.status = 'running'
             AND gs.paused = false
             AND gs.last_drawn_at IS NOT NULL
             AND gs.last_drawn_at < now() - ($1::int * INTERVAL '1 ms')
           )
           OR
           -- (b) SCHEDULED_END_EXCEEDED: way past scheduled end-time
           --     AND minst pastEndThresholdMs siden faktisk start
           --     (grace-period 2026-05-12, Tobias-direktiv: master kan
           --     starte en runde med scheduled_end_time i fortiden, og
           --     vi gir minst pastEndThresholdMs reell spilletid før
           --     watchdog kan auto-kansellere)
           (
             sg.scheduled_end_time IS NOT NULL
             AND sg.scheduled_end_time + ($2::int * INTERVAL '1 ms') < now()
             AND (
               sg.actual_start_time IS NULL
               OR sg.actual_start_time + ($2::int * INTERVAL '1 ms') < now()
             )
           )
         )
       ORDER BY
         COALESCE(sg.scheduled_end_time, gs.last_drawn_at, sg.created_at) ASC
       LIMIT 50`,
      [noDrawsCutoffMs, pastEndCutoffMs]
    );

    return rows.map((r) => ({
      scheduledGameId: r.scheduled_game_id,
      hallId: r.hall_id,
      planRunId: r.plan_run_id,
      priorStatus: r.status,
      reason: r.reason,
      lastDrawnAt: r.last_drawn_at,
      scheduledEndTime: r.scheduled_end_time,
      actualStartTime: r.actual_start_time,
    }));
  }

  private async autoEndOne(candidate: Game1StuckCandidate): Promise<void> {
    const reasonText =
      candidate.reason === "SCHEDULED_END_EXCEEDED"
        ? "Auto-ended: scheduled_end_time passert med margin (Lag 2)"
        : "Auto-ended: ingen draws siste 5+ min — engine antatt stuck (Lag 2)";

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Step 1: cancel scheduled-game-rad. Filter på status så vi ikke race-
      // overrider master manuell stop som skjedde i samme tick.
      const { rowCount: cancelledRows } = await client.query(
        `UPDATE "${this.schema}"."app_game1_scheduled_games"
            SET status              = 'cancelled',
                stopped_by_user_id  = $2,
                stop_reason         = $3,
                actual_end_time     = COALESCE(actual_end_time, now()),
                auto_resume_eligible_at = NULL,
                updated_at          = now()
          WHERE id = $1
            AND status IN ('running','paused')`,
        [candidate.scheduledGameId, SYSTEM_ACTOR_ID, reasonText]
      );

      // Step 2: marker engine-state som ended. Idempotent via COALESCE.
      await client.query(
        `UPDATE "${this.schema}"."app_game1_game_state"
            SET engine_ended_at = COALESCE(engine_ended_at, now()),
                paused          = false,
                paused_at_phase = NULL
          WHERE scheduled_game_id = $1`,
        [candidate.scheduledGameId]
      );

      await client.query("COMMIT");

      // Hvis cancelledRows=0, var det allerede stoppet av master eller annen
      // tick. No-op race-fix.
      if (cancelledRows === 0) {
        log.debug(
          { scheduledGameId: candidate.scheduledGameId },
          "stuck-detection race: rad allerede cancelled/completed — no-op"
        );
        return;
      }

      // Best-effort audit-skriv. Compliance-pålagt at vi har en rad for
      // hvert auto-end, men hvis audit feiler skal vi IKKE rollback cancel-
      // operasjonen (regulatorisk: stuck-runde må stoppes uansett).
      try {
        await this.auditLogService.record({
          actorType: "SYSTEM",
          actorId: SYSTEM_ACTOR_ID,
          action: "spill1.engine.auto_end_stuck",
          resource: "spill1_scheduled_game",
          resourceId: candidate.scheduledGameId,
          details: {
            reason: candidate.reason,
            reasonText,
            priorStatus: candidate.priorStatus,
            hallId: candidate.hallId,
            planRunId: candidate.planRunId,
            lastDrawnAt: candidate.lastDrawnAt?.toISOString() ?? null,
            scheduledEndTime:
              candidate.scheduledEndTime?.toISOString() ?? null,
            actualStartTime:
              candidate.actualStartTime?.toISOString() ?? null,
            noDrawsThresholdMs: this.noDrawsThresholdMs,
            pastEndThresholdMs: this.pastEndThresholdMs,
            adr: "ADR-0022",
          },
        });
      } catch (auditErr) {
        log.warn(
          {
            err: auditErr,
            scheduledGameId: candidate.scheduledGameId,
            errorCode: Game1StuckDetectionErrorCodes.AUDIT_WRITE_FAILED,
          },
          "stuck-detection audit-write feilet — auto-end effekten beholdes"
        );
      }

      // Best-effort: kall engine.stopGame for å frigjøre in-memory state
      // og evt. Redis-tilstand. Fail-closed via .catch.
      try {
        await this.engineStop.stopGame(
          candidate.scheduledGameId,
          reasonText,
          SYSTEM_ACTOR_ID
        );
      } catch (engineErr) {
        log.warn(
          {
            err: engineErr,
            scheduledGameId: candidate.scheduledGameId,
            errorCode: Game1StuckDetectionErrorCodes.ROOM_DESTROY_FAILED,
          },
          "stuck-detection engine.stopGame feilet — DB-state er allerede cancelled"
        );
      }

      // Best-effort: rydd BingoEngine-rom hvis det fortsatt finnes (rom
      // kan ha blitt joinet av spillere via game1:join-scheduled før vi
      // kalte stopGame). engine.stopGame burde rydde dette, men vi gjør
      // et ekstra forsøk for sikkerhets skyld.
      if (this.engineStop.destroyRoomForScheduledGameSafe) {
        try {
          await this.engineStop.destroyRoomForScheduledGameSafe(
            candidate.scheduledGameId,
            "stuck-auto-end"
          );
        } catch (destroyErr) {
          log.debug(
            { err: destroyErr, scheduledGameId: candidate.scheduledGameId },
            "stuck-detection destroyRoom feilet (kan være OK om rom ikke fantes)"
          );
        }
      }

      // Best-effort: broadcast `game1:stopped`-event så admin-UI ser
      // statusendring umiddelbart uten å vente på polling.
      if (this.onAutoEnd) {
        try {
          this.onAutoEnd({
            scheduledGameId: candidate.scheduledGameId,
            reason: candidate.reason,
          });
        } catch (broadcastErr) {
          log.warn(
            { err: broadcastErr, scheduledGameId: candidate.scheduledGameId },
            "stuck-detection broadcast feilet — polling fanger neste runde"
          );
        }
      }

      log.warn(
        {
          scheduledGameId: candidate.scheduledGameId,
          hallId: candidate.hallId,
          reason: candidate.reason,
          priorStatus: candidate.priorStatus,
          lastDrawnAt: candidate.lastDrawnAt?.toISOString() ?? "never",
          scheduledEndTime: candidate.scheduledEndTime?.toISOString() ?? null,
          actualStartTime: candidate.actualStartTime?.toISOString() ?? null,
        },
        "stuck-detection: auto-endet stuck Spill 1-runde"
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
