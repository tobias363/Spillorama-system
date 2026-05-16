/**
 * Bølge 1 (2026-05-08): GameLobbyAggregator — kanonisk read-only aggregator
 * for Spill 1 master-/agent-konsoll-state.
 *
 * Mandat (audit `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §6.1):
 *   "Gitt en hallId, returner kanonisk Spill1AgentLobbyState ved å aggregere
 *    fra plan-runtime, scheduled-games, hall-ready og GoH-membership — ÉN
 *    SoT for UI."
 *
 * Hvorfor en ny aggregator?
 * --------------------------
 * Eksisterende `Game1LobbyService` aggregerer for SPILLER-shellen
 * (`/api/games/spill1/lobby`). Den vet ikke om hall-ready-state, master-
 * agent-flagg, eller scheduled-game-action-id. UI på master-konsoll/agent-
 * portal har vært tvunget til å hente plan-runtime + legacy-current-game
 * parallelt og merge — det skapte ID-krangel-bugen som dette fundamentet
 * skal løse.
 *
 * Ansvar (én setning per metode):
 *   - `getLobbyState(hallId)`: bygger Spill1AgentLobbyState ved å aggregere
 *     fra alle relevante services. ALLTID returnerer gyldig state — bruker
 *     `inconsistencyWarnings` for diagnose istedenfor å throw på rare data.
 *
 * Pure read:
 *   Aggregator gjør INGEN write. Kaller ikke `getOrCreateForToday`. Lazy-
 *   creation av plan-run skjer fortsatt i `agentGamePlan.ts` write-routes;
 *   aggregator viser bare hva som er i DB nå. Det betyr at rute-laget for
 *   `GET /api/agent/game1/lobby` kan velge om det vil lazy-create eller
 *   ikke (Bølge 2 / MasterActionService håndterer write-sekvensering).
 *
 * Feilhåndtering:
 *   - Kontrakt-feil (ugyldig hallId) → DomainError("INVALID_INPUT").
 *   - Infrastruktur-feil (DB nede, query throws) → DomainError(
 *     "LOBBY_AGGREGATOR_INFRA_ERROR"). Disse propagerer til 5xx i routen.
 *   - Inkonsistent data (hall fjernet fra GoH, plan-run/scheduled-game
 *     status mismatch, etc.) → IKKE throw. Logg + flag i
 *     `inconsistencyWarnings` og returner en best-effort state.
 *
 * Tester (se `__tests__/GameLobbyAggregator.test.ts`): snapshot per state.
 *
 * @see packages/shared-types/src/spill1-lobby-state.ts — wire-format-kontrakt
 * @see docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md
 */

import type { Pool } from "pg";

import type {
  Spill1AgentLobbyState,
  Spill1HallReadyStatus,
  Spill1HallStatusColor,
  Spill1LobbyInconsistencyCode,
  Spill1LobbyInconsistencyWarning,
  Spill1PlanMeta,
  Spill1PlanRunStatus,
  Spill1ScheduledGameMeta,
  Spill1ScheduledGameStatus,
} from "@spillorama/shared-types";

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import { todayOsloKey } from "../util/osloTimezone.js";
import type { HallGroupService } from "../admin/HallGroupService.js";
import type { PlatformService } from "../platform/PlatformService.js";
import type { Game1HallReadyService } from "./Game1HallReadyService.js";
import { computeHallStatus } from "./Game1HallReadyService.js";
import type { GamePlanRunService } from "./GamePlanRunService.js";
import type { GamePlanService } from "./GamePlanService.js";
import type {
  GamePlanRun,
  GamePlanRunStatus,
  GamePlanWithItems,
} from "./gamePlan.types.js";

const logger = rootLogger.child({ module: "game-lobby-aggregator" });

// ── interne hjelpere ────────────────────────────────────────────────────

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

/**
 * ADR-0022 Lag 3: terskel for når UI skal vise "Auto-avbryt om Y min"-banner.
 * Speil av Game1StuckGameDetectionService.DEFAULT_GAME1_STUCK_PAST_END_THRESHOLD_MS.
 * Hardcoded fordi aggregator ikke har env-tilgang direkte — env-konfig
 * propageres via separate services. Sync via koden-eierskap (samme konstant
 * skal endres begge steder).
 */
const STUCK_AUTO_END_THRESHOLD_MS_FOR_AGGREGATOR = 1_800_000; // 30 min

/**
 * ADR-0022 Lag 4: terskel for når master regnes som "aktiv" basert på sist-
 * mottatte heartbeat. Default 90s. Speil av Game1AutoResumePausedService.
 */
const MASTER_HEARTBEAT_TIMEOUT_MS_FOR_AGGREGATOR = 90_000;

function asIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function parseHallIdsArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (x: unknown): x is string => typeof x === "string",
        );
      }
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Map plan-run.status → lobby-warning-relevant scheduled-game-status.
 * Brukes til `PLAN_SCHED_STATUS_MISMATCH`-deteksjon.
 *
 * Mapping-prinsippet er: gitt plan-run.status, hva FORVENTER vi at
 * scheduled-game er i? Hvis det avviker → mismatch-warning.
 *   - idle → ingen forventning (scheduled-game finnes ikke ennå normalt,
 *     eller rest-fra-forrige-runde i completed/cancelled).
 *   - running → forventer active statuses, eller completed mellom to
 *     master-startede plan-posisjoner.
 *   - paused → forventer paused.
 *   - finished → forventer completed (eller ingen scheduled-game).
 */
function isPlanSchedStatusConsistent(
  planStatus: GamePlanRunStatus,
  schedStatus: Spill1ScheduledGameStatus | null,
): boolean {
  if (schedStatus === null) {
    // Ingen scheduled-game å sammenligne med — hvis plan er running
    // forventer vi at en scheduled-game finnes. Det er BRIDGE_FAILED-saken
    // som detekteres separat. Her aksepterer vi alltid null.
    return true;
  }
  switch (planStatus) {
    case "idle":
      // idle plan-run er ikke aktivt på en scheduled-game. Hvis det
      // finnes en aktiv scheduled-game (status='running'/'paused'/etc),
      // er det rart, men vi flagger ikke det som mismatch — det kan være
      // legacy-spawn.
      return true;
    case "running":
      return (
        schedStatus === "running" ||
        schedStatus === "paused" ||
        schedStatus === "ready_to_start" ||
        schedStatus === "purchase_open" ||
        schedStatus === "scheduled" ||
        schedStatus === "completed"
      );
    case "paused":
      return schedStatus === "paused" || schedStatus === "running";
    case "finished":
      // Real status-enum has only completed/cancelled for terminal-state.
      // No "finished" value to compare with — that's plan-run-only.
      return schedStatus === "completed" || schedStatus === "cancelled";
    default:
      // Aldri her, men defensive
      return true;
  }
}

// ── DB-row interfaces ───────────────────────────────────────────────────

/**
 * Subset av `app_game1_scheduled_games` som aggregator trenger. Hentes
 * via raw-SELECT for å unngå round-trip via Game1MasterControlService
 * eller andre tunge service-laget — aggregator må være billig (kalles ofte
 * fra UI-polling).
 */
interface ScheduledGameRow {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string | null;
  participating_halls_json: unknown;
  scheduled_start_time: Date | string;
  scheduled_end_time: Date | string | null;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
  plan_run_id: string | null;
  plan_position: number | null;
  pause_reason: string | null;
  engine_paused?: boolean | null;
  engine_paused_at_phase?: number | null;
  // ADR-0022 Lag 1 + 3: auto-resume eligibility-stempel som settes av draw-
  // engine ved phase-pause. Eksponeres til UI for å vise countdown til
  // auto-resume og brukes av Game1AutoResumePausedService cron.
  auto_resume_eligible_at?: Date | string | null;
  // ADR-0022 Lag 3: siste draw-timestamp fra engine-state. Brukes som
  // proxy for `pauseStartedAt` (engine auto-pauser umiddelbart etter en
  // phase-vinnende draw, så `last_drawn_at ≈ pause_started_at`).
  last_drawn_at?: Date | string | null;
}

// ── service ─────────────────────────────────────────────────────────────

export interface GameLobbyAggregatorOptions {
  pool: Pool;
  schema?: string;
  planService: GamePlanService;
  planRunService: GamePlanRunService;
  hallReadyService: Game1HallReadyService;
  hallGroupService: HallGroupService;
  platformService: PlatformService;
  /**
   * Klokke-injection. Brukes for testbarhet (snapshot-tester med fast
   * "now"). Default `() => new Date()`.
   */
  clock?: () => Date;
}

/**
 * Caller kan be om aggregert state for en gitt actor-context. Brukes til
 * å beregne `isMasterAgent`-flagget. Hvis ikke gitt, faller vi tilbake
 * til "ikke master" (UI viser ikke master-knapper).
 */
export interface LobbyActorContext {
  /** "ADMIN" → alltid master. Andre roller sammenlignes mot masterHallId. */
  role: "ADMIN" | "HALL_OPERATOR" | "AGENT" | "SUPPORT" | "PLAYER";
  /** Brukerens hall-binding (HALL_OPERATOR/AGENT må ha denne). */
  hallId: string | null;
}

export class GameLobbyAggregator {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly planService: GamePlanService;
  private readonly planRunService: GamePlanRunService;
  private readonly hallReadyService: Game1HallReadyService;
  private readonly hallGroupService: HallGroupService;
  private readonly platformService: PlatformService;
  private readonly clock: () => Date;

  constructor(opts: GameLobbyAggregatorOptions) {
    if (!opts.pool) throw new DomainError("INVALID_CONFIG", "pool er påkrevd.");
    if (!opts.planService) {
      throw new DomainError("INVALID_CONFIG", "planService er påkrevd.");
    }
    if (!opts.planRunService) {
      throw new DomainError("INVALID_CONFIG", "planRunService er påkrevd.");
    }
    if (!opts.hallReadyService) {
      throw new DomainError("INVALID_CONFIG", "hallReadyService er påkrevd.");
    }
    if (!opts.hallGroupService) {
      throw new DomainError("INVALID_CONFIG", "hallGroupService er påkrevd.");
    }
    if (!opts.platformService) {
      throw new DomainError("INVALID_CONFIG", "platformService er påkrevd.");
    }
    this.pool = opts.pool;
    this.schema = assertSchemaName(opts.schema ?? "public");
    this.planService = opts.planService;
    this.planRunService = opts.planRunService;
    this.hallReadyService = opts.hallReadyService;
    this.hallGroupService = opts.hallGroupService;
    this.platformService = opts.platformService;
    this.clock = opts.clock ?? (() => new Date());
  }

  /** @internal — test-hook (samme mønster som GamePlanRunService.forTesting). */
  static forTesting(opts: GameLobbyAggregatorOptions): GameLobbyAggregator {
    const svc = Object.create(
      GameLobbyAggregator.prototype,
    ) as GameLobbyAggregator;
    (svc as unknown as { pool: Pool }).pool = opts.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(
      opts.schema ?? "public",
    );
    (svc as unknown as { planService: GamePlanService }).planService =
      opts.planService;
    (svc as unknown as {
      planRunService: GamePlanRunService;
    }).planRunService = opts.planRunService;
    (svc as unknown as {
      hallReadyService: Game1HallReadyService;
    }).hallReadyService = opts.hallReadyService;
    (svc as unknown as {
      hallGroupService: HallGroupService;
    }).hallGroupService = opts.hallGroupService;
    (svc as unknown as {
      platformService: PlatformService;
    }).platformService = opts.platformService;
    (svc as unknown as { clock: () => Date }).clock =
      opts.clock ?? (() => new Date());
    return svc;
  }

  // ── public API ─────────────────────────────────────────────────────────

  /**
   * Hovedflyten: bygg kanonisk lobby-state for hallen.
   *
   * Algoritme:
   *   1) Resolver `businessDate` (Oslo-tz) og hall-display-navn.
   *   2) Hent plan-run for (hallId, businessDate). Read-only — ingen
   *      lazy-create.
   *   3) Hvis run finnes, hent plan + items.
   *   4) Resolver `currentScheduledGameId` med prioritet:
   *        a. plan-bridge-spawn (`scheduled_games.plan_run_id = run.id
   *           AND plan_position = run.current_position`)
   *        b. legacy-spawn (aktiv status for hallen)
   *        c. null
   *   5) Hent hall-ready-rows for scheduled-game-id (hvis funnet).
   *   6) Filtrer haller mot nåværende GoH-membership; flagg
   *      MISSING_GOH_MEMBERSHIP hvis vi droppet noen.
   *   7) Bygg planMeta + scheduledGameMeta.
   *   8) Detekter inconsistencies (status-mismatch, stale run, bridge
   *      failed, dual scheduled-games).
   *   9) Beregn isMasterAgent ut fra actor-context.
   *  10) Returner state.
   *
   * Throw kun ved infrastruktur-feil (DB nede). Alle "data ser rar ut"-
   * scenarioer flagges via inconsistencyWarnings i state.
   */
  async getLobbyState(
    hallId: string,
    actor?: LobbyActorContext,
  ): Promise<Spill1AgentLobbyState> {
    const hall = assertHallId(hallId);
    const now = this.clock();
    const businessDate = this.resolveBusinessDate(now);
    const generatedAt = now.toISOString();

    // Diagnose-akkumulator. Sub-helpers pusher inn warnings.
    const warnings: Spill1LobbyInconsistencyWarning[] = [];

    // Hall-navn (best-effort — fallback til hallId hvis lookup feiler).
    const hallName = await this.resolveHallName(hall);

    // 1. Plan-run (read-only). Kan throw på DB-feil.
    let planRun: GamePlanRun | null;
    try {
      planRun = await this.planRunService.findForDay(hall, businessDate);
    } catch (err) {
      throw this.toInfraError(err, "planRunService.findForDay");
    }

    // 2. Plan + items hvis run finnes.
    let plan: GamePlanWithItems | null = null;
    if (planRun) {
      try {
        plan = await this.planService.getById(planRun.planId);
      } catch (err) {
        throw this.toInfraError(err, "planService.getById");
      }
      if (!plan) {
        // Plan slettet etter run ble opprettet — defensivt fallback.
        logger.warn(
          { runId: planRun.id, planId: planRun.planId, hallId: hall },
          "[lobby-aggregator] plan slettet for aktiv run",
        );
      }
    } else {
      // 2b. Tobias-direktiv 2026-05-15 (header-bug): når ingen plan-run
      // eksisterer (master har aldri trykket Start, eller backend nettopp
      // ble dev:nuke-restartet), skal aggregator likevel returnere
      // `catalogDisplayName` så master-konsoll viser "Neste spill: Bingo".
      //
      // Tidligere oppførsel returnerte `planMeta=null` i idle-state →
      // `data.catalogDisplayName=null` → header viste "Neste spill" uten
      // navn (Image 1 i Tobias-rapport 2026-05-15).
      //
      // Fix: slå opp aktiv plan for (hall, businessDate) UTEN å opprette
      // en plan-run. Aggregator's `buildPlanMeta` med `planRun=null`
      // peker da til items[0] og setter `catalogDisplayName`.
      try {
        plan = await this.planRunService.findActivePlanForDay(
          hall,
          businessDate,
        );
      } catch (err) {
        // Ikke fatal — fall tilbake til `planMeta=null`. UI vil vise
        // generisk "Neste spill" uten navn, men ellers fungere.
        logger.warn(
          { err, hallId: hall, businessDate },
          "[lobby-aggregator] findActivePlanForDay feilet — fortsetter uten planMeta",
        );
      }
    }

    // 3. Stale-run-detection (yesterday or older still open).
    if (planRun && planRun.status !== "finished") {
      if (planRun.businessDate < businessDate) {
        warnings.push({
          code: "STALE_PLAN_RUN",
          message: `Plan-run for ${planRun.businessDate} er fortsatt åpen i status='${planRun.status}'. Master må fullføre forrige dag.`,
          detail: {
            planRunId: planRun.id,
            planRunBusinessDate: planRun.businessDate,
            todayBusinessDate: businessDate,
            planRunStatus: planRun.status,
          },
        });
      }
    }

    // 4. Resolve currentScheduledGameId med prioritet.
    const { primaryRow: scheduledGameRow, dualConflict } =
      await this.resolveScheduledGame(hall, planRun);
    if (dualConflict) {
      warnings.push({
        code: "DUAL_SCHEDULED_GAMES",
        message:
          "To samtidige scheduled-games for hallen — legacy-spawn + plan-bridge har kollidert. Plan-bridge-raden brukes; legacy-rad bør avsluttes manuelt.",
        detail: dualConflict,
      });
    }

    // 5. BRIDGE_FAILED detection — plan-run.running uten scheduled-game.
    if (
      planRun &&
      planRun.status === "running" &&
      scheduledGameRow === null
    ) {
      warnings.push({
        code: "BRIDGE_FAILED",
        message:
          "Plan-run er i 'running' men ingen scheduled-game ble opprettet. Engine-bridge feilet ved spawn — kall /advance på nytt.",
        detail: {
          planRunId: planRun.id,
          planRunStatus: planRun.status,
          currentPosition: planRun.currentPosition,
        },
      });
    }

    // 6. PLAN_SCHED_STATUS_MISMATCH detection.
    if (planRun && scheduledGameRow) {
      const schedStatus = scheduledGameRow.status as Spill1ScheduledGameStatus;
      if (!isPlanSchedStatusConsistent(planRun.status, schedStatus)) {
        warnings.push({
          code: "PLAN_SCHED_STATUS_MISMATCH",
          message: `Plan-run.status='${planRun.status}' krangler med scheduled-game.status='${schedStatus}'. UI bør refresh; MasterActionService må reconciliere før neste action.`,
          detail: {
            planRunId: planRun.id,
            planRunStatus: planRun.status,
            scheduledGameId: scheduledGameRow.id,
            scheduledGameStatus: schedStatus,
          },
        });
      }
    }

    // 7. Hall-ready-rows — kun meningsfullt når en scheduled-game finnes.
    let hallReadyRows: Awaited<
      ReturnType<Game1HallReadyService["getReadyStatusForGame"]>
    > = [];
    if (scheduledGameRow) {
      try {
        hallReadyRows =
          await this.hallReadyService.getReadyStatusForGame(scheduledGameRow.id);
      } catch (err) {
        // Ikke fatal — vi kan rendre state uten ready-rows. Logg + warn.
        logger.warn(
          { err, gameId: scheduledGameRow.id, hallId: hall },
          "[lobby-aggregator] getReadyStatusForGame feilet — fortsetter uten ready-data",
        );
      }
    }

    // 8. GoH-membership-resolve. Filtrerer stale haller.
    const goh = await this.resolveGoHForLobby({
      hall,
      scheduledGameRow,
      planRun,
      plan,
    });
    if (goh.staleHallIds.length > 0) {
      warnings.push({
        code: "MISSING_GOH_MEMBERSHIP",
        message: `${goh.staleHallIds.length} hall(er) er fjernet fra GoH etter spawn — skjult fra lobby-listen.`,
        detail: { staleHallIds: goh.staleHallIds, groupId: goh.groupId },
      });
    }

    // 9. Bygg halls[] med ready-status + computed colorCode.
    const masterHallIdResolved =
      scheduledGameRow?.master_hall_id ?? goh.masterHallIdFallback ?? null;
    const halls = this.buildHallStatuses({
      hallIdsToShow: goh.hallIdsToShow,
      hallNames: goh.hallNames,
      readyRows: hallReadyRows,
      participatingHallIds: scheduledGameRow
        ? new Set(parseHallIdsArray(scheduledGameRow.participating_halls_json))
        : null,
      masterHallId: masterHallIdResolved,
      hasScheduledGame: scheduledGameRow !== null,
    });

    // 10. allHallsReady
    const candidates = halls.filter((h) => !h.excludedFromGame);
    const allHallsReady =
      candidates.length > 0 && candidates.every((h) => h.isReady);

    // 11. Plan-meta
    const planMeta = this.buildPlanMeta(planRun, plan);

    // 12. Scheduled-game-meta
    const scheduledGameMeta = this.buildScheduledGameMeta(scheduledGameRow);

    // 13. masterHallId / groupOfHallsId top-level
    const groupOfHallsId =
      scheduledGameRow?.group_hall_id ?? goh.groupId ?? null;

    // 14. isMasterAgent
    const isMasterAgent = this.computeIsMasterAgent({
      actor,
      masterHallId: masterHallIdResolved,
    });

    // 15. nextScheduledStartTime
    const nextScheduledStartTime = scheduledGameRow
      ? asIso(
          scheduledGameRow.actual_start_time ??
            scheduledGameRow.scheduled_start_time,
        )
      : null;

    // 16. ADR-0022 Lag 4: master heartbeat-state. Leses fra plan-run-raden
    // hvis den finnes — for UI til å vise master-status-indikator + brukes
    // til å vise/skjule auto-resume-countdown.
    const masterLastSeenAt = await this.loadMasterLastSeenAt(
      planRun?.id ?? null,
    );
    const masterIsActive = this.computeMasterIsActive(masterLastSeenAt);

    return {
      hallId: hall,
      hallName,
      businessDate,
      generatedAt,
      currentScheduledGameId: scheduledGameRow?.id ?? null,
      planMeta,
      scheduledGameMeta,
      halls,
      allHallsReady,
      masterHallId: masterHallIdResolved,
      groupOfHallsId,
      isMasterAgent,
      nextScheduledStartTime,
      inconsistencyWarnings: warnings,
      masterLastSeenAt,
      masterIsActive,
    };
  }

  /**
   * ADR-0022 Lag 4: hent siste master-heartbeat-timestamp fra plan-run.
   * Returnerer null hvis ingen plan-run finnes eller master aldri har sendt
   * heartbeat på denne run-en.
   */
  private async loadMasterLastSeenAt(
    planRunId: string | null,
  ): Promise<string | null> {
    if (!planRunId) return null;
    try {
      const { rows } = await this.pool.query<{
        master_last_seen_at: Date | string | null;
      }>(
        `SELECT master_last_seen_at
         FROM "${this.schema}"."app_game_plan_run"
         WHERE id = $1
         LIMIT 1`,
        [planRunId],
      );
      const row = rows[0];
      if (!row) return null;
      return asIso(row.master_last_seen_at);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      // Tabell/kolonne mangler i fresh-dev — fail-soft.
      if (code === "42P01" || code === "42703") return null;
      // Andre feil: log warn men returner null så aggregator ikke kaster.
      logger.warn(
        { err, planRunId },
        "[lobby-aggregator] master_last_seen_at-lookup feilet — antar null",
      );
      return null;
    }
  }

  /**
   * ADR-0022 Lag 4: computer `masterIsActive` basert på heartbeat-timestamp.
   * True hvis master sendte heartbeat innenfor MASTER_HEARTBEAT_TIMEOUT_MS.
   * False hvis null eller eldre enn terskel.
   */
  private computeMasterIsActive(masterLastSeenAt: string | null): boolean {
    if (!masterLastSeenAt) return false;
    const seenMs = new Date(masterLastSeenAt).getTime();
    if (Number.isNaN(seenMs)) return false;
    const now = this.clock().getTime();
    return now - seenMs <= MASTER_HEARTBEAT_TIMEOUT_MS_FOR_AGGREGATOR;
  }

  // ── interne sub-helpers ───────────────────────────────────────────────

  private resolveBusinessDate(now: Date): string {
    return todayOsloKey(now);
  }

  private async resolveHallName(hallId: string): Promise<string> {
    try {
      const hall = await this.platformService.getHall(hallId);
      return hall.name ?? hallId;
    } catch {
      return hallId;
    }
  }

  /**
   * Velger scheduled-game-rad for (hallId, plan-run). Returnerer i tillegg
   * et `dualConflict`-objekt hvis vi fant både plan-bridge-rad og legacy-
   * rad samtidig.
   *
   * Prioritet:
   *   1. Plan-bridge: WHERE plan_run_id = $1 AND plan_position = $2
   *   2. Legacy: WHERE (master_hall_id = $1 OR participating @> [$1])
   *      AND status IN (purchase_open, ready_to_start, running, paused)
   *
   * Hvis 1 finner rad: returner DEN. Hvis vi i tillegg fant en annen
   * legacy-rad → flagg som DUAL_SCHEDULED_GAMES.
   */
  private async resolveScheduledGame(
    hallId: string,
    planRun: GamePlanRun | null,
  ): Promise<{
    primaryRow: ScheduledGameRow | null;
    dualConflict: { planBridgeId: string; legacyId: string } | null;
  }> {
    let bridgeRow: ScheduledGameRow | null = null;
    if (planRun) {
      try {
        bridgeRow = await this.queryScheduledGameByPlanRun(
          planRun.id,
          planRun.currentPosition,
        );
      } catch (err) {
        throw this.toInfraError(err, "queryScheduledGameByPlanRun");
      }
    }

    let legacyRow: ScheduledGameRow | null = null;
    try {
      legacyRow = await this.queryActiveScheduledGameForHall(hallId);
    } catch (err) {
      throw this.toInfraError(err, "queryActiveScheduledGameForHall");
    }

    // Velg primary
    let primary: ScheduledGameRow | null = null;
    if (bridgeRow) primary = bridgeRow;
    else if (legacyRow) primary = legacyRow;

    // Detect dual conflict
    let dualConflict: { planBridgeId: string; legacyId: string } | null = null;
    if (bridgeRow && legacyRow && bridgeRow.id !== legacyRow.id) {
      dualConflict = {
        planBridgeId: bridgeRow.id,
        legacyId: legacyRow.id,
      };
    }

    return { primaryRow: primary, dualConflict };
  }

  private async queryScheduledGameByPlanRun(
    planRunId: string,
    position: number,
  ): Promise<ScheduledGameRow | null> {
    try {
      const { rows } = await this.pool.query<ScheduledGameRow>(
        `SELECT sg.id, sg.status, sg.master_hall_id, sg.group_hall_id,
                sg.participating_halls_json, sg.scheduled_start_time,
                sg.scheduled_end_time, sg.actual_start_time, sg.actual_end_time,
                sg.plan_run_id, sg.plan_position, sg.pause_reason,
                sg.auto_resume_eligible_at AS auto_resume_eligible_at,
                gs.paused AS engine_paused,
                gs.paused_at_phase AS engine_paused_at_phase,
                gs.last_drawn_at AS last_drawn_at
         FROM "${this.schema}"."app_game1_scheduled_games" sg
         LEFT JOIN "${this.schema}"."app_game1_game_state" gs
                ON gs.scheduled_game_id = sg.id
         WHERE sg.plan_run_id = $1 AND sg.plan_position = $2
         ORDER BY
           CASE
             WHEN sg.status IN ('purchase_open','ready_to_start','running','paused') THEN 0
             ELSE 1
           END,
           sg.created_at DESC
         LIMIT 1`,
        [planRunId, position],
      );
      return rows[0] ?? null;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01" || code === "42703") {
        // Tabell/kolonne mangler i dev — defensivt null.
        return null;
      }
      throw err;
    }
  }

  private async queryActiveScheduledGameForHall(
    hallId: string,
  ): Promise<ScheduledGameRow | null> {
    try {
      const { rows } = await this.pool.query<ScheduledGameRow>(
        `SELECT sg.id, sg.status, sg.master_hall_id, sg.group_hall_id,
                sg.participating_halls_json, sg.scheduled_start_time,
                sg.scheduled_end_time, sg.actual_start_time, sg.actual_end_time,
                sg.plan_run_id, sg.plan_position, sg.pause_reason,
                sg.auto_resume_eligible_at AS auto_resume_eligible_at,
                gs.paused AS engine_paused,
                gs.paused_at_phase AS engine_paused_at_phase,
                gs.last_drawn_at AS last_drawn_at
         FROM "${this.schema}"."app_game1_scheduled_games" sg
         LEFT JOIN "${this.schema}"."app_game1_game_state" gs
                ON gs.scheduled_game_id = sg.id
         WHERE (sg.master_hall_id = $1
            OR sg.participating_halls_json::jsonb @> to_jsonb($1::text))
           AND sg.status IN ('purchase_open','ready_to_start','running','paused')
         ORDER BY sg.scheduled_start_time ASC
         LIMIT 1`,
        [hallId],
      );
      return rows[0] ?? null;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01" || code === "42703") {
        return null;
      }
      throw err;
    }
  }

  /**
   * Resolve hvilke haller som skal vises, deres navn, og hvilke som er
   * stale (i `participating_halls_json` men ikke aktivt GoH-medlem
   * lenger).
   *
   * Hvis ingen scheduled-game eksisterer, faller vi tilbake til hallens
   * GoH-membership for dagens visning ("hva ville hall vist hvis runde
   * spawnet nå?"). Det er konsistent med audit-anbefalingen om at lobby-
   * state skal vise samme haller før og etter spawn.
   */
  private async resolveGoHForLobby(input: {
    hall: string;
    scheduledGameRow: ScheduledGameRow | null;
    planRun: GamePlanRun | null;
    plan: GamePlanWithItems | null;
  }): Promise<{
    hallIdsToShow: string[];
    hallNames: Map<string, string>;
    staleHallIds: string[];
    groupId: string | null;
    masterHallIdFallback: string | null;
  }> {
    const { hall, scheduledGameRow, plan } = input;

    // 1. Forsøk å finne GoH via scheduled-game.group_hall_id (mest presist).
    let groupId: string | null = scheduledGameRow?.group_hall_id ?? null;

    // 2. Hvis ingen scheduled-game, og plan er GoH-bundet, bruk plan.
    if (!groupId && plan && plan.groupOfHallsId) {
      groupId = plan.groupOfHallsId;
    }

    // 3. Hvis fortsatt ingen, finn alle aktive GoH-er hallen er medlem av.
    let goHMembers: Map<string, string> = new Map();
    let masterHallIdFallback: string | null = null;
    if (groupId) {
      try {
        const group = await this.hallGroupService.get(groupId);
        for (const m of group.members) {
          goHMembers.set(m.hallId, m.hallName);
        }
        masterHallIdFallback = group.masterHallId ?? null;
      } catch (err) {
        logger.debug(
          { err, groupId },
          "[lobby-aggregator] hallGroupService.get failed — falling back to direct lookup",
        );
      }
    } else {
      // Ingen group-id — finn aktiv GoH for hall.
      try {
        const groups = await this.hallGroupService.list({
          status: "active",
          hallId: hall,
        });
        const first = groups[0] ?? null;
        if (first) {
          groupId = first.id;
          for (const m of first.members) {
            goHMembers.set(m.hallId, m.hallName);
          }
          masterHallIdFallback = first.masterHallId ?? null;
        }
      } catch (err) {
        logger.debug(
          { err, hall },
          "[lobby-aggregator] hallGroupService.list failed — empty GoH",
        );
      }
    }

    // 4. Beregn stale haller (i participating_halls_json men ikke i GoH).
    const participatingIds = scheduledGameRow
      ? parseHallIdsArray(scheduledGameRow.participating_halls_json)
      : [];
    const staleHallIds: string[] = [];
    if (goHMembers.size > 0) {
      for (const id of participatingIds) {
        if (!goHMembers.has(id)) {
          staleHallIds.push(id);
        }
      }
    }

    // 5. Bygg hall-id-listen som UI skal vise.
    const hallIdsToShow = new Set<string>();
    // Alle GoH-medlemmer (etter filter — stale er allerede ute).
    for (const id of goHMembers.keys()) {
      hallIdsToShow.add(id);
    }
    // Master alltid med (selv om den skulle ha falt ut av GoH-en).
    if (scheduledGameRow?.master_hall_id) {
      hallIdsToShow.add(scheduledGameRow.master_hall_id);
    }
    if (masterHallIdFallback) {
      hallIdsToShow.add(masterHallIdFallback);
    }
    // Caller's egen hall alltid med.
    hallIdsToShow.add(hall);

    // 6. Hall-navn-mapping. For haller som ikke er i GoH (master/caller
    // som faller ut), prøv platformService som siste fallback.
    //
    // Code-review (PR #1050) flagget N+1: tidligere itererte vi sekvensielt
    // og await-et hver getHall — gir lineær latency for alle missing-haller.
    // Promise.all parallelliserer fallback-lookups; getHall er trygg å kalle
    // parallelt (read-only DB-spørring per hall, ingen delt lock).
    const hallNames = new Map<string, string>(goHMembers);
    const idsToResolve: string[] = [];
    for (const id of hallIdsToShow) {
      if (!hallNames.has(id)) {
        idsToResolve.push(id);
      }
    }
    if (idsToResolve.length > 0) {
      const lookups = await Promise.all(
        idsToResolve.map(async (id) => {
          try {
            const platHall = await this.platformService.getHall(id);
            return { id, name: platHall.name };
          } catch {
            return { id, name: id };
          }
        }),
      );
      for (const { id, name } of lookups) {
        hallNames.set(id, name);
      }
    }

    return {
      hallIdsToShow: Array.from(hallIdsToShow),
      hallNames,
      staleHallIds,
      groupId,
      masterHallIdFallback,
    };
  }

  /**
   * Bygg per-hall ready-status-shape. Aggregerer ready-row + GoH-name +
   * scheduled-game-deltakelse til ferdig-beregnet `colorCode` og
   * relevante flagg.
   */
  private buildHallStatuses(input: {
    hallIdsToShow: string[];
    hallNames: Map<string, string>;
    readyRows: Awaited<
      ReturnType<Game1HallReadyService["getReadyStatusForGame"]>
    >;
    participatingHallIds: Set<string> | null;
    masterHallId: string | null;
    hasScheduledGame: boolean;
  }): Spill1HallReadyStatus[] {
    const {
      hallIdsToShow,
      hallNames,
      readyRows,
      participatingHallIds,
      masterHallId,
      hasScheduledGame,
    } = input;

    const readyByHallId = new Map(readyRows.map((r) => [r.hallId, r]));

    const result: Spill1HallReadyStatus[] = [];
    for (const hallId of hallIdsToShow) {
      const ready = readyByHallId.get(hallId) ?? null;
      // Cache computeHallStatus-resultatet — code-review (PR #1050) flagget
      // at vi tidligere kalte funksjonen to ganger på samme rad i samme
      // iterasjon (én for colorCode, én for hasNoCustomers). Én call holder.
      const computedStatus = ready ? computeHallStatus(ready) : null;

      // Hvis en runde finnes og hallen ikke er i participating_halls_json
      // OG ikke er master, marker som ekskludert (semantisk: ikke deltaker).
      let excludedFromGame = ready?.excludedFromGame ?? false;
      let excludedReason = ready?.excludedReason ?? null;
      if (
        hasScheduledGame &&
        participatingHallIds !== null &&
        !participatingHallIds.has(hallId) &&
        hallId !== masterHallId &&
        !excludedFromGame
      ) {
        excludedFromGame = true;
        excludedReason = "Ikke deltaker i denne runden";
      }

      // Beregn colorCode. Hvis vi har en ready-row, bruk
      // computeHallStatus (delt logikk med master-konsoll). Hvis vi ikke
      // har row OG ingen scheduled-game finnes, marker som "gray"
      // (ikke participating ennå).
      let colorCode: Spill1HallStatusColor;
      if (computedStatus) {
        // Re-map: 'red' fra computeHallStatus = playerCount=0; det
        // matcher vår semantikk. 'orange'/'green' likt.
        colorCode = computedStatus.color;
      } else if (!hasScheduledGame) {
        // Ingen runde spawnet ennå — vi viser hallen som gray (avventer).
        colorCode = "gray";
      } else {
        // Runde finnes men hallen har ingen ready-rad. Default red
        // (playerCount=0 → ikke klar, ingen spillere).
        colorCode = "red";
      }

      // hasNoCustomers er i praksis det samme som excludedFromGame med
      // reason "Ingen kunder", men vi eksponerer det som eget felt så UI
      // kan rendre forskjellig (rødt med "Ingen kunder"-tekst vs. orange
      // "Ikke klar"-tekst). I dette aggregator-laget mapper vi:
      //   hasNoCustomers = true hvis playerCount=0 og ready-rad finnes
      //                    eller hvis excludedReason == "Ingen kunder"
      let hasNoCustomers = false;
      if (computedStatus) {
        hasNoCustomers = computedStatus.playerCount === 0;
      } else if (!hasScheduledGame) {
        // Ingen runde ennå — vi vet ikke. Default false.
        hasNoCustomers = false;
      } else {
        // Runde finnes men ingen ready-rad → ingen spillere.
        hasNoCustomers = true;
      }

      const lastUpdatedAt = ready?.updatedAt
        ? typeof ready.updatedAt === "string" && ready.updatedAt.trim() !== ""
          ? ready.updatedAt
          : null
        : null;

      result.push({
        hallId,
        hallName: hallNames.get(hallId) ?? hallId,
        isReady: ready?.isReady ?? false,
        hasNoCustomers,
        excludedFromGame,
        excludedReason,
        colorCode,
        lastUpdatedAt,
        isMaster: hallId === masterHallId,
      });
    }
    return result;
  }

  private buildPlanMeta(
    planRun: GamePlanRun | null,
    plan: GamePlanWithItems | null,
  ): Spill1PlanMeta | null {
    // Tobias-direktiv 2026-05-13: "Neste spill må vises uavhengig hvilken
    // status man har." Aggregator returnerer plan-meta også når plan-run
    // ikke er opprettet ennå (master har ikke trykket Start første gang).
    // Da bygger vi meta fra plan + position=1 (første plan-item).
    if (!plan) return null;
    const items = plan.items;
    if (items.length === 0) {
      // Plan uten items — vi kan ikke bygge meta. Returner null.
      return null;
    }
    // currentPosition kan være 0 (idle, lazy-create-default 1, men vi er
    // defensive). Hvis currentPosition > items.length, fall tilbake til
    // siste posisjon. Hvis 0 eller plan-run mangler, peke til item 1.
    //
    // Fix 2026-05-14 (Tobias-rapport, komplementært til PR #1422):
    //   Når plan-run.status='finished' OG `currentPosition < items.length`,
    //   skal master-UI vise NESTE plan-item som "neste spill", ikke det
    //   forrige som ble ferdigspilt. Master-klikk vil trigge
    //   `getOrCreateForToday` som DELETE+INSERT-er ny plan-run med
    //   `current_position = previousPosition + 1` (PR #1422-logikken).
    //
    //   Eksempel: finished på position=1 (Bingo) av 13 → master-UI viser
    //   "1000-spill" (position=2) som neste, ikke "Bingo" igjen.
    //
    //   Hvis `currentPosition >= items.length` (plan helt ferdig) →
    //   peker fortsatt til siste posisjon. UI ser `planRunStatus='finished'`
    //   og rendrer "Spilleplan ferdig"-banner. (Tobias-direktiv 10:17:
    //   "Plan-completed beats stengetid".)
    const rawPosition = planRun?.currentPosition ?? 0;
    const isFinishedWithNextItem =
      planRun?.status === "finished" &&
      rawPosition > 0 &&
      rawPosition < items.length;
    const targetPosition = isFinishedWithNextItem
      ? rawPosition + 1
      : rawPosition === 0
        ? 1
        : rawPosition;
    const positionForDisplay = Math.max(
      1,
      Math.min(targetPosition, items.length),
    );
    const currentItem = items.find((i) => i.position === positionForDisplay);
    if (!currentItem) {
      logger.warn(
        {
          runId: planRun?.id ?? null,
          currentPosition: rawPosition,
          itemsCount: items.length,
        },
        "[lobby-aggregator] currentItem mangler — kan ikke bygge planMeta",
      );
      return null;
    }

    // jackpotSetupRequired — replicates computeJackpotSetupRequired in
    // agentGamePlan.ts. Kjent kode-duplisering; Bølge 2 (MasterActionService)
    // konsoliderer. Når plan-run mangler kan ikke override eksistere ennå,
    // så jackpotSetupRequired = catalog.requiresJackpotSetup uten override-sjekk.
    //
    // Fix 2026-05-14: jackpot-lookup må peke til `positionForDisplay`, ikke
    // `planRun.currentPosition`. Når plan-run er finished+next-item-shown,
    // peker `positionForDisplay` til kommende posisjon — den nye plan-run-en
    // som spawnes vil ha override-key matching dette feltet.
    const jackpotLookupKey = String(positionForDisplay);
    const jackpotSetupRequired = planRun
      ? currentItem.catalogEntry.requiresJackpotSetup &&
        !Object.prototype.hasOwnProperty.call(
          planRun.jackpotOverrides,
          jackpotLookupKey,
        )
      : currentItem.catalogEntry.requiresJackpotSetup;

    // pendingJackpotOverride — null hvis plan-run mangler
    const pendingJackpotOverride = planRun
      ? planRun.jackpotOverrides[jackpotLookupKey] ?? null
      : null;

    // status-mapping — null hvis plan-run mangler (idle, pre-Start)
    const planRunStatus: Spill1PlanRunStatus | null = planRun
      ? (planRun.status as Spill1PlanRunStatus)
      : null;

    return {
      planRunId: planRun?.id ?? null,
      planId: plan.id,
      planName: plan.name,
      currentPosition: rawPosition,
      totalPositions: items.length,
      catalogSlug: currentItem.catalogEntry.slug,
      catalogDisplayName: currentItem.catalogEntry.displayName,
      planRunStatus,
      jackpotSetupRequired,
      pendingJackpotOverride,
    };
  }

  private buildScheduledGameMeta(
    row: ScheduledGameRow | null,
  ): Spill1ScheduledGameMeta | null {
    if (!row) return null;
    const startIso = asIso(row.scheduled_start_time);
    if (!startIso) {
      logger.warn(
        { gameId: row.id },
        "[lobby-aggregator] scheduled_start_time mangler — utelater scheduledGameMeta",
      );
      return null;
    }
    const effectiveStatus: Spill1ScheduledGameStatus =
      row.status === "running" && row.engine_paused === true
        ? "paused"
        : row.status as Spill1ScheduledGameStatus;
    const pauseReason =
      row.pause_reason ??
      (row.engine_paused === true
        ? row.engine_paused_at_phase !== null && row.engine_paused_at_phase !== undefined
          ? `Auto-pause etter fase ${row.engine_paused_at_phase}`
          : "Auto-pause i draw-engine"
        : null);

    // ADR-0022 Lag 3: pauseStartedAt ≈ last_drawn_at når engine_paused=true.
    // Engine auto-pauser umiddelbart etter den phase-vinnende draw, så
    // siste-draw-timestamp er presis nok for UI-countdown.
    const pauseStartedAt =
      row.engine_paused === true && row.last_drawn_at !== null
        ? asIso(row.last_drawn_at ?? null)
        : null;

    // ADR-0022 Lag 3: stuckAutoEndAt = scheduled_end_time +
    // STUCK_PAST_END_THRESHOLD_MS. UI rendrer kritisk banner når denne nærmer
    // seg now(). Bruker default 30 min siden vi ikke har env-tilgang her —
    // er konsistent med Game1StuckGameDetectionService default.
    const stuckEndThresholdMs = STUCK_AUTO_END_THRESHOLD_MS_FOR_AGGREGATOR;
    const stuckAutoEndAt = row.scheduled_end_time
      ? (() => {
          const endIso = asIso(row.scheduled_end_time);
          if (endIso === null) return null;
          const endMs = new Date(endIso).getTime();
          if (Number.isNaN(endMs)) return null;
          return new Date(endMs + stuckEndThresholdMs).toISOString();
        })()
      : null;

    return {
      scheduledGameId: row.id,
      status: effectiveStatus,
      scheduledStartTime: startIso,
      scheduledEndTime: asIso(row.scheduled_end_time),
      actualStartTime: asIso(row.actual_start_time),
      actualEndTime: asIso(row.actual_end_time),
      pauseReason,
      pauseStartedAt,
      autoResumeEligibleAt: asIso(row.auto_resume_eligible_at ?? null),
      stuckAutoEndAt,
    };
  }

  private computeIsMasterAgent(input: {
    actor?: LobbyActorContext;
    masterHallId: string | null;
  }): boolean {
    const { actor, masterHallId } = input;
    if (!actor) return false;
    if (actor.role === "ADMIN") return true;
    if (!masterHallId) return false;
    if (!actor.hallId) return false;
    return actor.hallId === masterHallId;
  }

  /**
   * Wrap infrastruktur-feil. DomainError propagerer uendret; alt annet
   * (PG client error, etc.) pakkes inn i `LOBBY_AGGREGATOR_INFRA_ERROR`
   * så routen kan returnere 5xx.
   */
  private toInfraError(err: unknown, context: string): DomainError {
    if (err instanceof DomainError) return err;
    logger.error(
      { err, context },
      "[lobby-aggregator] infrastructure error",
    );
    const message =
      err instanceof Error ? err.message : "Ukjent infrastruktur-feil";
    return new DomainError(
      "LOBBY_AGGREGATOR_INFRA_ERROR",
      `Aggregator feilet i ${context}: ${message}`,
    );
  }
}

// Re-eksport for testbarhet (tester ønsker enums uten å gå via shared-types).
export type { Spill1AgentLobbyState, Spill1LobbyInconsistencyCode };
