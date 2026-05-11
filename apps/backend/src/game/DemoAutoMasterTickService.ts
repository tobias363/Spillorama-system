/**
 * DemoAutoMasterTickService — auto-master for dev/staging-haller (Tobias-direktiv 2026-05-11)
 *
 * Bakgrunn:
 *   Tobias-direktiv 2026-05-11 etter live hall-isolation-test:
 *   > "Vi må også sørge for at det er kun hallene i linken som ser sin
 *   >  trekning. ... Kan du sette default til at trekning skal gå hvert
 *   >  30 sekund? slik at vi får verifisert at vi klarer å skille på dem."
 *
 *   For å visuelt verifisere at haller er korrekt isolerte trenger vi
 *   "trafikk" på default-hall som er ULIK pilot-hallens (Tobias styrer
 *   pilot-haller manuelt som master). Default-hall får derfor en
 *   uavhengig plan + auto-master-cron som starter/advancer plan-runs
 *   automatisk hvert 30. sekund.
 *
 * Hva tjenesten gjør (per tick):
 *   1) For hver target-hall (default: `["hall-default"]`):
 *      a. Hent gjeldende plan-run for (hall, today).
 *      b. Hvis ingen run finnes → `masterActionService.start({...})`.
 *      c. Hvis run.status === "finished" → skip (planen er ferdig for i dag).
 *      d. Hvis aktiv scheduled-game er `finished` → `advance()` til neste.
 *      e. Hvis aktiv scheduled-game er `running` med max draws → la
 *         Game1AutoDrawTickService håndtere — ikke trigg advance før status flippes.
 *   2) Audit: hver auto-handling logges som `demo_auto_master.{action}`.
 *
 * Scope og guards:
 *   - **Dev/staging-only**: aktiveres KUN når env-var
 *     `DEMO_AUTO_MASTER_ENABLED=true` er satt. NEVER kjør i prod.
 *   - **Target halls**: hard-coded `["hall-default"]` ved oppstart. Pilot-
 *     haller (`demo-hall-001..004`) er IKKE i target-listen og styres
 *     fortsatt av master (Tobias).
 *   - **Synthetic actor**: Tjenesten bruker en SYSTEM-actor med `role: "ADMIN"`
 *     så `MasterActionService.assertMaster` ikke avviser. Audit-event taggers
 *     med `actor_user_id='demo-auto-master'`.
 *   - **Fail-soft**: enkelt-feil per hall logges som warn — neste tick prøver
 *     på nytt. Tjenesten skal ALDRI throws ved cron-tick.
 *
 * Konfigurasjon:
 *   - Tick-intervall styres av JobScheduler (typisk 10s)
 *   - Ball-intervall (30s mellom kuler) settes i seedet plan via
 *     `ticket_config_json.spill1.timing.seconds = 30`
 *
 * Referanser:
 *   - PITFALLS_LOG §11.10 — single-command restart må regenerere demo-state
 *   - SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md §1.0.1 — lobby-rom-konsept
 *   - PR #1196 — `closed`-state gating-fix i PlayScreen
 */

import type { Pool } from "pg";
import type { MasterActionService } from "./MasterActionService.js";
import type { MasterActor } from "./Game1MasterControlService.js";
import type { GamePlanRunService } from "./GamePlanRunService.js";
import { logger as rootLogger } from "../util/logger.js";
import { todayOsloKey } from "../util/osloTimezone.js";

const log = rootLogger.child({ module: "demo-auto-master-tick" });

export interface DemoAutoMasterTickServiceOptions {
  pool: Pool;
  schema?: string;
  masterActionService: MasterActionService;
  planRunService: GamePlanRunService;
  /**
   * Hall-IDer som skal auto-styres. Default: `["hall-default"]`. Pilot-
   * haller skal IKKE være i denne listen (Tobias styrer dem manuelt).
   */
  targetHallIds?: ReadonlyArray<string>;
}

export interface DemoAutoMasterTickResult {
  checked: number;
  startedNew: number;
  advanced: number;
  skipped: number;
  errors: number;
  errorMessages?: string[];
}

/**
 * Synthetic actor brukt av cron-en. role=ADMIN gir `assertMaster` pass
 * uten å kreve at hall-en matcher actor.hallId.
 *
 * BUG-FIX 2026-05-11: userId må peke på en eksisterende rad i app_users
 * fordi `app_game_plan_run.master_user_id` har FK-constraint.
 * Bruker den seedede demo-admin-en i stedet for en syntetisk id.
 */
const DEMO_AUTO_MASTER_ACTOR: MasterActor = {
  userId: "demo-user-admin",
  hallId: "system",
  role: "ADMIN",
};

const DEFAULT_TARGET_HALLS: ReadonlyArray<string> = ["hall-default"];

/**
 * Tobias-direktiv 2026-05-11 (oppdatert): "default hall skal ha sitt eget rom
 * hvor det er trekning hvert 30 sekund". Dette overrider per-game `seconds`
 * fra ticket_config så Game1AutoDrawTickService trekker baller med 30-sek-
 * intervall i stedet for default 5. Pilot-haller er IKKE påvirket (de styres
 * av sin egen plan-config og master).
 *
 * NB: hall-default er allerede isolert i sin egen GoH `demo-default-goh`
 * (single-hall GoH, kun `hall-default` som medlem) — bekreftet via
 * `app_hall_groups` live query 2026-05-11. canonicalRoomCode er da
 * `BINGO_DEMO-DEFAULT-GOH` som er TOMT for andre haller (ikke delt med
 * pilot-haller eller demo-haller).
 */
const DEFAULT_HALL_BALL_INTERVAL_SECONDS = 30;

/**
 * `process.env.DEMO_AUTO_MASTER_ENABLED` flag. Tjenesten er KUN aktiv
 * når denne er "true" (string compare). Ikke aktiv i prod by default.
 */
export function isDemoAutoMasterEnabled(): boolean {
  return process.env["DEMO_AUTO_MASTER_ENABLED"] === "true";
}

export class DemoAutoMasterTickService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly masterActionService: MasterActionService;
  private readonly planRunService: GamePlanRunService;
  private readonly targetHallIds: ReadonlyArray<string>;

  constructor(options: DemoAutoMasterTickServiceOptions) {
    this.pool = options.pool;
    this.schema = options.schema ?? "public";
    this.masterActionService = options.masterActionService;
    this.planRunService = options.planRunService;
    this.targetHallIds = options.targetHallIds ?? DEFAULT_TARGET_HALLS;
  }

  /**
   * Cron-entry-point. Returnerer aggregert resultat for observability.
   * Throws ALDRI — fail-soft per hall.
   */
  async tick(now: Date = new Date()): Promise<DemoAutoMasterTickResult> {
    const result: DemoAutoMasterTickResult = {
      checked: 0,
      startedNew: 0,
      advanced: 0,
      skipped: 0,
      errors: 0,
      errorMessages: [],
    };

    for (const hallId of this.targetHallIds) {
      result.checked++;
      try {
        await this.tickHall(hallId, now, result);
      } catch (err) {
        result.errors++;
        const msg = err instanceof Error ? err.message : String(err);
        if (result.errorMessages && result.errorMessages.length < 10) {
          result.errorMessages.push(`${hallId}: ${msg}`);
        }
        log.warn({ err, hallId }, "[demo-auto-master] tick feilet for hall");
      }
    }

    return result;
  }

  private async tickHall(
    hallId: string,
    now: Date,
    result: DemoAutoMasterTickResult,
  ): Promise<void> {
    const businessDate = todayOsloKey(now);

    // 1) Sjekk eksisterende plan-run.
    let run;
    try {
      run = await this.planRunService.findForDay(hallId, businessDate);
    } catch (err) {
      log.warn({ err, hallId }, "[demo-auto-master] planRunService.findForDay feilet");
      result.skipped++;
      return;
    }

    // 2) Plan ferdig → slett run så cron kan starte ny iteration.
    //    Tobias-direktiv 2026-05-11: default-hall skal LOOP-e auto-master
    //    kontinuerlig — ikke stoppe når 1-item-planen er ferdig. Slett
    //    finished run så getOrCreateForToday lager en ny idle-run neste tick.
    if (run && run.status === "finished") {
      await this.pool.query(
        `DELETE FROM ${this.schema}.app_game_plan_run WHERE id = $1`,
        [run.id],
      );
      log.info(
        { hallId, planRunId: run.id },
        "[demo-auto-master] slettet finished run for ny iteration",
      );
      result.skipped++;
      return;
    }

    // 3) Ingen run eller run=idle uten scheduled-game → master.start.
    //    Bug-fix 2026-05-11: tidligere sjekket vi kun (!run), men
    //    planRunService.findForDay returnerer ofte en eksisterende idle-run
    //    fra forrige sesjon. Hvis ingen scheduled-game finnes for
    //    current_position må vi fortsatt kalle start() — som er idempotent
    //    (idle→running) og oppretter scheduled-game via engine-bridge.
    const scheduledGameStatus = run
      ? await this.getCurrentScheduledGameStatus(run.id, run.currentPosition)
      : null;

    if (!run || (run.status === "idle" && scheduledGameStatus === null)) {
      log.info(
        { hallId, businessDate, runStatus: run?.status ?? null },
        "[demo-auto-master] starter ny plan-run / scheduled-game",
      );
      try {
        await this.masterActionService.start({
          actor: DEMO_AUTO_MASTER_ACTOR,
          hallId,
        });
        result.startedNew++;
        // Override ticket_config.spill1.timing.seconds for default-hall så
        // Game1AutoDrawTickService trekker baller med 3-sek-intervall.
        // Idempotent — påvirker kun den nyeste scheduled-game-raden.
        await this.applyDefaultHallTimingOverride(hallId);
      } catch (err) {
        // Plan-mangler eller HALL_NOT_IN_GROUP er forventet hvis seed
        // ikke har kjørt — logg som info ikke error.
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("NO_MATCHING_PLAN") ||
          msg.includes("HALL_NOT_IN_GROUP")
        ) {
          log.debug(
            { hallId, error: msg },
            "[demo-auto-master] ingen plan for hall — skip",
          );
          result.skipped++;
          return;
        }
        throw err;
      }
      return;
    }

    // 4) Aktiv scheduled-game er ferdig (`completed`/`cancelled`) → advance.
    //    Bug-fix 2026-05-11: tabellen bruker `completed`/`cancelled`-status,
    //    ikke `finished` (som var den feilaktige antakelsen).
    if (
      scheduledGameStatus === "completed" ||
      scheduledGameStatus === "cancelled"
    ) {
      log.info(
        { hallId, planRunId: run.id, position: run.currentPosition },
        "[demo-auto-master] advancer til neste posisjon",
      );
      try {
        await this.masterActionService.advance({
          actor: DEMO_AUTO_MASTER_ACTOR,
          hallId,
        });
        result.advanced++;
        await this.applyDefaultHallTimingOverride(hallId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("PLAN_RUN_FINISHED")) {
          result.skipped++;
          return;
        }
        throw err;
      }
      return;
    }

    // 5) Aktiv runde kjører — ikke gjør noe (auto-draw-tick håndterer kuler).
    result.skipped++;
  }

  /**
   * Hent status på currently active scheduled-game for plan-run-en.
   * Returnerer `null` hvis ingen scheduled-game finnes for posisjonen.
   */
  private async getCurrentScheduledGameStatus(
    planRunId: string,
    currentPosition: number,
  ): Promise<string | null> {
    const { rows } = await this.pool.query<{ status: string }>(
      `SELECT status FROM ${this.schema}.app_game1_scheduled_games
       WHERE plan_run_id = $1 AND plan_position = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [planRunId, currentPosition],
    );
    return rows[0]?.status ?? null;
  }

  /**
   * Override `ticket_config_json.spill1.timing.seconds` på default-hall sin
   * nyeste scheduled-game-rad til 3 sekunder (Tobias-direktiv 2026-05-11).
   *
   * Game1AutoDrawTickService leser `seconds` fra ticket_config og bruker
   * det som ball-intervall (default 5). Pilot-haller skal IKKE påvirkes —
   * vi patcher kun raden hvor master_hall_id = hallId.
   *
   * Idempotent — re-kjøring med samme verdi er no-op (DB-row uendret).
   */
  private async applyDefaultHallTimingOverride(hallId: string): Promise<void> {
    try {
      // PostgreSQL JSONB merge: behold eksisterende ticket_config, men
      // overstyr `spill1.timing.seconds` til 3.
      await this.pool.query(
        `UPDATE ${this.schema}.app_game1_scheduled_games
         SET ticket_config_json = jsonb_set(
           jsonb_set(
             jsonb_set(
               COALESCE(ticket_config_json::jsonb, '{}'::jsonb),
               '{spill1}',
               COALESCE(ticket_config_json::jsonb -> 'spill1', '{}'::jsonb),
               true
             ),
             '{spill1,timing}',
             COALESCE(ticket_config_json::jsonb -> 'spill1' -> 'timing', '{}'::jsonb),
             true
           ),
           '{spill1,timing,seconds}',
           to_jsonb($2::int),
           true
         )
         WHERE master_hall_id = $1
           AND status IN ('scheduled', 'purchase_open', 'ready_to_start', 'running')
           AND id = (
             SELECT id FROM ${this.schema}.app_game1_scheduled_games
             WHERE master_hall_id = $1
               AND status IN ('scheduled', 'purchase_open', 'ready_to_start', 'running')
             ORDER BY created_at DESC
             LIMIT 1
           )`,
        [hallId, DEFAULT_HALL_BALL_INTERVAL_SECONDS],
      );
      log.debug(
        { hallId, seconds: DEFAULT_HALL_BALL_INTERVAL_SECONDS },
        "[demo-auto-master] timing override applied",
      );
    } catch (err) {
      // Fail-soft — hvis JSONB-patchet feiler, kjøres draws bare med
      // default 5-sek-intervall. Ikke kritisk for hall-isolation-bevis.
      log.warn(
        { err, hallId },
        "[demo-auto-master] kunne ikke override timing — bruker default seconds",
      );
    }
  }
}
