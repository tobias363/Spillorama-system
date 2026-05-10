/**
 * Bølge 2 (2026-05-08): MasterActionService — kanonisk sekvenseringsmotor
 * for plan-runtime → engine-bridge → engine-actions for Spill 1.
 *
 * Mandat (audit `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §6.1 + §7):
 *   "ENESTE sted som vet om plan + scheduled. Driver master-actions ende-til-
 *    ende. UI kaller én endpoint og får én respons; ingen klient-side merge
 *    av plan-run-id og scheduled-game-id."
 *
 * Hvorfor en ny sentralisert service?
 * -----------------------------------
 * Frem til Bølge 1 var sekvenseringen "plan-runtime → bridge → engine"
 * splittet over to steder:
 *   1. `apps/admin-web/src/api/agent-master-actions.ts` — frontend-wrapper
 *      som kalte plan-API først og legacy-API etterpå, ignorerte bridge-
 *      respons, og lot UI gjette hvilket id-rom var aktivt. SLETTET i
 *      Bølge 3 — UI bruker nå `agent-game1.ts:startMaster()` etc. direkte.
 *   2. `apps/backend/src/routes/agentGamePlan.ts:443-616` — backend-route
 *      som kjørte plan-mutering og bridge-spawn, men IKKE kalt
 *      `Game1MasterControlService.startGame` (engine).
 *
 * Resultatet var en patch-spiral (PR #1041, #1035, #1030) hvor hvert nytt
 * sekvenseringsproblem ble fikset symptom-for-symptom. Bølge 2 sentraliserer
 * sekvenseringen i denne servicen og isolerer ansvar:
 *
 *   GamePlanRunService          → eier `app_game_plan_run` state
 *   GamePlanEngineBridge        → fabrikk plan-run → scheduled-game
 *   Game1MasterControlService   → eier `app_game1_scheduled_games` state +
 *                                  draw-engine-trigger
 *   MasterActionService [ny]    → ENESTE caller som binder plan-run-id
 *                                  ↔ scheduled-game-id sammen og kjører
 *                                  rekkefølgen
 *
 * Pre-validering:
 *   Hver write-action kaller først `GameLobbyAggregator.getLobbyState` som
 *   lese-pre-check. Dette gir oss:
 *     - `isMasterAgent`  (RBAC-håndhevelse på actor-rolle vs. master-hall)
 *     - `currentScheduledGameId` (for pause/resume/stop som krever ID)
 *     - `inconsistencyWarnings` (avviser actions hvis lobby er korrupt)
 *
 *   Hvis aggregator flagger `BRIDGE_FAILED` eller `DUAL_SCHEDULED_GAMES`
 *   avviser vi all write-aksjon med `LOBBY_INCONSISTENT` — disse må
 *   reconciliers manuelt før master kan handle.
 *
 * Atomicitet og rollback:
 *   Tjenestene under (plan-run, bridge, engine) eier hver sin DB-transaksjon
 *   og `runInTransaction`-helper. Vi orkestrerer dem som en SAGA:
 *     - Hvis bridge-spawn feiler etter plan-run-overgang: ingen rollback
 *       trengs — plan-run kan re-spawne via /advance med samme position.
 *     - Hvis engine-startGame feiler etter bridge-spawn: vi har CRIT-7-
 *       rollback i master-control-servicen (eksisterende kompenserende
 *       audit-event). Plan-run-state blir hengende i `running` selv om
 *       engine ikke startet — det er DET aggregator flagger som
 *       `BRIDGE_FAILED`. Master må deretter kalle /advance på nytt.
 *
 *   Denne semantikken er konsistent med eksisterende oppførsel i
 *   `agentGamePlan.ts:443-616`-routene som vi erstatter — vi har bare flyttet
 *   logikken inn i én service.
 *
 * Feilkoder (DomainError):
 *   FORBIDDEN                 — caller er ikke master-agent (eller har
 *                                ikke GAME1_MASTER_WRITE-permission).
 *   LOBBY_INCONSISTENT        — bridge-failed eller dual-scheduled-games;
 *                                aggregator har flagget at state krangler.
 *   NO_ACTIVE_GAME            — pause/resume/stop uten aktiv scheduled-game.
 *   JACKPOT_SETUP_REQUIRED    — advance til posisjon som krever jackpot-popup.
 *   PLAN_RUN_FINISHED         — advance på allerede ferdig run.
 *   ENGINE_FAILED             — Game1MasterControlService kastet (med
 *                                original-error i details).
 *   GAME_PLAN_RUN_NOT_FOUND   — propageres uendret fra plan-service.
 *   NO_MATCHING_PLAN          — propageres fra plan-service (ingen plan
 *                                dekker (hall, ukedag)).
 *   HALL_NOT_IN_GROUP         — propageres fra bridge.
 *
 * Audit:
 *   Hver vellykket master-action skriver `spill1.master.<action>` via
 *   `AuditLogService` med actor, hallId, planRunId, scheduledGameId,
 *   final-status og evt. domain-spesifikke felter (reason, draw, prizes,
 *   etc.). Dette er separat fra `app_game1_master_audit` som master-
 *   control-servicen skriver — vi får dobbel-skriving men det er
 *   regulatorisk OK siden de tjener forskjellige formål:
 *     - `app_game1_master_audit` = engine-state-overgang per scheduled-game
 *     - `app_audit_log`           = master-action-flyt (plan + engine)
 *
 * Tester:
 *   `__tests__/MasterActionService.test.ts` — 25+ unit-tester med mocks.
 *   `__tests__/MasterActionService.integration.test.ts` — fullt løp mot
 *   ekte Postgres (skip uten WALLET_PG_TEST_CONNECTION_STRING).
 *
 * @see apps/backend/src/game/GameLobbyAggregator.ts (Bølge 1 — pre-check)
 * @see apps/backend/src/game/GamePlanRunService.ts
 * @see apps/backend/src/game/GamePlanEngineBridge.ts
 * @see apps/backend/src/game/Game1MasterControlService.ts
 * @see docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md
 */

import type { Pool } from "pg";

import type {
  Spill1AgentLobbyState,
  Spill1LobbyInconsistencyCode,
  Spill1PlanRunStatus,
  Spill1ScheduledGameStatus,
} from "@spillorama/shared-types";

import type { AuditLogService } from "../compliance/AuditLogService.js";
import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import { todayOsloKey } from "../util/osloTimezone.js";
import { withRetry, DEFAULT_RETRY_DELAYS_MS } from "../util/retry.js";
import type {
  GameLobbyAggregator,
  LobbyActorContext,
} from "./GameLobbyAggregator.js";
import type { GamePlanEngineBridge } from "./GamePlanEngineBridge.js";
import type { GamePlanRunService } from "./GamePlanRunService.js";
import type {
  Game1MasterControlService,
  MasterActor,
} from "./Game1MasterControlService.js";
import type { TicketColor } from "./gameCatalog.types.js";
import { TICKET_COLOR_VALUES } from "./gameCatalog.types.js";

const logger = rootLogger.child({ module: "master-action-service" });

const VALID_TICKET_COLORS = new Set<TicketColor>(TICKET_COLOR_VALUES);

// Spill 1 trekker maks 90 baller. setJackpot validerer mot dette.
const MIN_DRAW = 1;
const MAX_DRAW = 90;

// ── public types ────────────────────────────────────────────────────────

/**
 * Aggregert resultat for hver master-action. Inkluderer både plan-run-id og
 * scheduled-game-id slik at routen kan returnere begge til klient (klient
 * skal kun bruke `scheduledGameId` for videre actions per Bølge 1-kontrakt,
 * men `planRunId` er nyttig for diagnose og audit-korrelasjon).
 */
export interface MasterActionResult {
  /**
   * Aktiv scheduled-game-id ETTER actionen. `null` ved `finish` eller hvis
   * bridgen feilet å spawne. Klient bruker DENNE for videre master-actions
   * (start/pause/resume/stop).
   */
  scheduledGameId: string | null;
  /** Plan-run-id som handlingen ble utført mot. Aldri null. */
  planRunId: string;
  /** Plan-runtime-status etter handlingen. */
  status: Spill1PlanRunStatus;
  /**
   * Scheduled-game-status etter handlingen. `null` hvis ingen scheduled-game
   * ble berørt (e.g. `start` med BRIDGE_FAILED, eller `setJackpot` som ikke
   * spawner).
   */
  scheduledGameStatus: Spill1ScheduledGameStatus | null;
  /**
   * Inconsistency-warnings fra aggregator-pre-check. Tom liste = alt
   * konsistent. Klient bør vise disse som info-banner i UI.
   *
   * Vi inkluderer warnings selv etter en vellykket action — de kan dekke
   * stale-state som ikke blokkerer current action (f.eks. STALE_PLAN_RUN
   * fra i går).
   */
  inconsistencyWarnings: Spill1LobbyInconsistencyCode[];
}

/**
 * Common input for alle master-actions. Caller (route-laget) henter `actor`
 * fra session-token og resolveer `hallId` via `resolveHallScope`-helperen i
 * routes-laget.
 */
export interface MasterActionInput {
  actor: MasterActor;
  hallId: string;
}

/** Pause/Stop input — har optional reason for audit-trail. */
export interface MasterActionInputWithReason extends MasterActionInput {
  reason?: string;
}

/**
 * Stop krever non-empty reason for regulatorisk sporbarhet (master må
 * forklare hvorfor en runde ble avbrutt). Resume har ingen reason.
 */
export interface MasterStopInput extends MasterActionInput {
  reason: string;
}

/** SetJackpot — master submitter draw + prizesCents per bongfarge. */
export interface MasterSetJackpotInput extends MasterActionInput {
  position: number;
  draw: number;
  prizesCents: Record<string, number>;
}

// ── service options ─────────────────────────────────────────────────────

export interface MasterActionServiceOptions {
  pool: Pool;
  schema?: string;
  planRunService: GamePlanRunService;
  engineBridge: GamePlanEngineBridge;
  masterControlService: Game1MasterControlService;
  lobbyAggregator: GameLobbyAggregator;
  auditLogService?: AuditLogService | null;
  /**
   * Klokke-injection for testbarhet (snapshot-tester med fast "now").
   * Default `() => new Date()`.
   */
  clock?: () => Date;
  /**
   * Best-effort lobby-broadcaster. Når satt, kalles
   * `broadcastForHall(hallId)` etter hver vellykket master-action så
   * klient som er subscribed til `spill1:lobby:{hallId}`-rom mottar
   * `lobby:state-update` umiddelbart. Best-effort — broadcast-feil
   * blokkerer ikke responsen.
   */
  lobbyBroadcaster?: {
    broadcastForHall(hallId: string): Promise<void>;
  } | null;
  /**
   * Pilot Q3 2026 (PR #1116, 2026-05-09): backoff-delays for bridge-spawn
   * retry. Default `[100, 500, 2000]` ms. Tester injisere `[0, 0, 0]`.
   */
  bridgeRetryDelaysMs?: ReadonlyArray<number>;
  /**
   * Sleep-injection for retry-helper (test-determinisme).
   */
  retrySleep?: (ms: number) => Promise<void>;
}

// ── helpers ─────────────────────────────────────────────────────────────

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
  if (typeof a.hallId !== "string" && a.hallId !== "") {
    // Tomstrenger fra legacy-callers tillates men signaliserer "ingen hall";
    // role-håndhevelsen under vil avvise korrekt.
    throw new DomainError("INVALID_INPUT", "actor.hallId må være streng.");
  }
  if (
    a.role !== "ADMIN" &&
    a.role !== "HALL_OPERATOR" &&
    a.role !== "AGENT" &&
    a.role !== "SUPPORT"
  ) {
    throw new DomainError("INVALID_INPUT", "actor.role er ugyldig.");
  }
  return a as MasterActor;
}

/**
 * Mapper master-actor (`Game1MasterControlService.MasterActor`-shape) til
 * aggregator-actor-context. Aggregator trenger kun `role` + `hallId` for å
 * beregne `isMasterAgent`-flagget.
 */
function toAggregatorActor(actor: MasterActor): LobbyActorContext {
  return {
    role: actor.role,
    hallId: actor.hallId || null,
  };
}

/**
 * Filtrer ut warnings som BLOKKERER all write-aksjon. Disse må manuell
 * reconciliers før master kan kjøre flere actions.
 *
 * `BRIDGE_FAILED` og `DUAL_SCHEDULED_GAMES` indikerer at lobby-state krangler
 * med engine-state — vi avviser fail-closed for å unngå å gjøre situasjonen
 * verre. Andre warnings (STALE_PLAN_RUN, MISSING_GOH_MEMBERSHIP,
 * PLAN_SCHED_STATUS_MISMATCH) er informative og blokkerer ikke.
 */
const BLOCKING_WARNING_CODES: ReadonlySet<Spill1LobbyInconsistencyCode> =
  new Set(["BRIDGE_FAILED", "DUAL_SCHEDULED_GAMES"]);

function findBlockingWarnings(
  state: Spill1AgentLobbyState,
): Spill1LobbyInconsistencyCode[] {
  return state.inconsistencyWarnings
    .map((w) => w.code)
    .filter((c) => BLOCKING_WARNING_CODES.has(c));
}

function extractWarningCodes(
  state: Spill1AgentLobbyState,
): Spill1LobbyInconsistencyCode[] {
  return state.inconsistencyWarnings.map((w) => w.code);
}

/**
 * Wrap engine-feil i `ENGINE_FAILED` med original-error i details for
 * sporbarhet. DomainError propageres uendret — hvis engine kaster en
 * spesifikk DomainError (HALLS_NOT_READY, JACKPOT_SETUP_REQUIRED, etc.)
 * skal klient se den koden direkte.
 */
function wrapEngineError(err: unknown, context: string): never {
  if (err instanceof DomainError) throw err;
  const message = err instanceof Error ? err.message : "Ukjent engine-feil";
  throw new DomainError(
    "ENGINE_FAILED",
    `Engine-action feilet i ${context}: ${message}`,
    {
      context,
      originalMessage: message,
    },
  );
}

/**
 * Pilot Q3 2026 (PR #1116, 2026-05-09): DomainError-koder som indikerer en
 * PERMANENT bridge-feil — retry vil ikke fikse dem.
 */
const PERMANENT_BRIDGE_ERROR_CODES: ReadonlySet<string> = new Set([
  "JACKPOT_SETUP_REQUIRED",
  "HALL_NOT_IN_GROUP",
  "MASTER_NOT_IN_GROUP",
  "NO_ACTIVE_HALLS_IN_GROUP",
  "INVALID_INPUT",
  "GAME_PLAN_RUN_NOT_FOUND",
  "GAME_CATALOG_NOT_FOUND",
  "GAME_PLAN_RUN_CORRUPT",
  "GAME_PLAN_NOT_FOUND",
]);

function isBridgeRetrySafe(err: unknown): boolean {
  if (err instanceof DomainError) {
    return !PERMANENT_BRIDGE_ERROR_CODES.has(err.code);
  }
  return true;
}

// ── service ─────────────────────────────────────────────────────────────

export class MasterActionService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly planRunService: GamePlanRunService;
  private readonly engineBridge: GamePlanEngineBridge;
  private readonly masterControlService: Game1MasterControlService;
  private readonly lobbyAggregator: GameLobbyAggregator;
  private auditLogService: AuditLogService | null;
  private readonly clock: () => Date;
  private readonly lobbyBroadcaster: {
    broadcastForHall(hallId: string): Promise<void>;
  } | null;
  private readonly bridgeRetryDelaysMs: ReadonlyArray<number>;
  private readonly retrySleep: ((ms: number) => Promise<void>) | undefined;

  constructor(opts: MasterActionServiceOptions) {
    if (!opts.pool) throw new DomainError("INVALID_CONFIG", "pool er påkrevd.");
    if (!opts.planRunService) {
      throw new DomainError("INVALID_CONFIG", "planRunService er påkrevd.");
    }
    if (!opts.engineBridge) {
      throw new DomainError("INVALID_CONFIG", "engineBridge er påkrevd.");
    }
    if (!opts.masterControlService) {
      throw new DomainError(
        "INVALID_CONFIG",
        "masterControlService er påkrevd.",
      );
    }
    if (!opts.lobbyAggregator) {
      throw new DomainError("INVALID_CONFIG", "lobbyAggregator er påkrevd.");
    }
    this.pool = opts.pool;
    this.schema = assertSchemaName(opts.schema ?? "public");
    this.planRunService = opts.planRunService;
    this.engineBridge = opts.engineBridge;
    this.masterControlService = opts.masterControlService;
    this.lobbyAggregator = opts.lobbyAggregator;
    this.auditLogService = opts.auditLogService ?? null;
    this.clock = opts.clock ?? (() => new Date());
    this.lobbyBroadcaster = opts.lobbyBroadcaster ?? null;
    this.bridgeRetryDelaysMs =
      opts.bridgeRetryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.retrySleep = opts.retrySleep;
  }

  /** @internal — test-hook (samme mønster som GamePlanRunService.forTesting). */
  static forTesting(opts: MasterActionServiceOptions): MasterActionService {
    const svc = Object.create(
      MasterActionService.prototype,
    ) as MasterActionService;
    (svc as unknown as { pool: Pool }).pool = opts.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(
      opts.schema ?? "public",
    );
    (svc as unknown as {
      planRunService: GamePlanRunService;
    }).planRunService = opts.planRunService;
    (svc as unknown as {
      engineBridge: GamePlanEngineBridge;
    }).engineBridge = opts.engineBridge;
    (svc as unknown as {
      masterControlService: Game1MasterControlService;
    }).masterControlService = opts.masterControlService;
    (svc as unknown as {
      lobbyAggregator: GameLobbyAggregator;
    }).lobbyAggregator = opts.lobbyAggregator;
    (svc as unknown as {
      auditLogService: AuditLogService | null;
    }).auditLogService = opts.auditLogService ?? null;
    (svc as unknown as { clock: () => Date }).clock =
      opts.clock ?? (() => new Date());
    (svc as unknown as {
      lobbyBroadcaster: {
        broadcastForHall(hallId: string): Promise<void>;
      } | null;
    }).lobbyBroadcaster = opts.lobbyBroadcaster ?? null;
    (svc as unknown as {
      bridgeRetryDelaysMs: ReadonlyArray<number>;
    }).bridgeRetryDelaysMs =
      opts.bridgeRetryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    (svc as unknown as {
      retrySleep: ((ms: number) => Promise<void>) | undefined;
    }).retrySleep = opts.retrySleep;
    return svc;
  }

  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service ?? null;
  }

  // ── public API ─────────────────────────────────────────────────────────

  /**
   * Start neste posisjon i planen. Sekvens:
   *
   *   1. Pre-validere via aggregator (RBAC + blocking warnings).
   *   2. `planRunService.getOrCreateForToday(hallId)` — idempotent lazy-create.
   *   3. `planRunService.start` — idle → running, position=1.
   *   4. `engineBridge.createScheduledGameForPlanRunPosition` — spawn
   *      `app_game1_scheduled_games`-rad.
   *   5. `masterControlService.startGame({ gameId })` — engine starter
   *      (status='ready_to_start' → 'running').
   *   6. Audit + return.
   *
   * Hvis (5) feiler: rollback (4) ved å la run-status være `running` men
   * scheduled-game-status forblir `ready_to_start`. Aggregator vil flagge
   * dette som `BRIDGE_FAILED` ved neste poll (selv om bridgen ikke faktisk
   * feilet — det er state-mismatch som triggrer warning). Master må kalle
   * `start` igjen for å re-trigger engine.
   *
   * NB: Dette er kompromisset audit-rapporten beskriver — full SAGA-
   * rollback krever cross-service-transaksjon som ikke er praktisk. Vi
   * lar plan-state stå og lar aggregator detektere mismatch.
   */
  async start(input: MasterActionInput): Promise<MasterActionResult> {
    const hallId = assertHallId(input.hallId);
    const actor = assertActor(input.actor);

    // 1. Pre-validation
    const lobby = await this.preValidate(hallId, actor, "start");

    // 2. Lazy-create plan-run for today (idempotent).
    const businessDate = this.businessDate();
    let run;
    try {
      run = await this.planRunService.getOrCreateForToday(hallId, businessDate);
    } catch (err) {
      // NO_MATCHING_PLAN, HALL_NOT_IN_GROUP propageres uendret — UI viser
      // klar feilmelding.
      throw err;
    }

    // 3. Validate state-machine pre-condition. Idempotent re-start på en
    // running run skal ikke feile — vi rull tilbake state og lar bridgen
    // gjenbruke eksisterende scheduled-game-rad. Men start fra `paused`
    // eller `finished` er ikke gyldig.
    if (run.status === "paused") {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        "Plan-run er pauset — bruk /resume i stedet.",
      );
    }
    if (run.status === "finished") {
      throw new DomainError(
        "PLAN_RUN_FINISHED",
        "Plan-run er allerede ferdig for i dag.",
      );
    }

    // 4. Start (idle → running). Hvis allerede running er dette idempotent
    // for engine-bridge-spawn, men plan-service vil avvise idle→running
    // som ugyldig overgang. Vi sjekker først.
    let started = run;
    if (run.status === "idle") {
      started = await this.planRunService.start(
        hallId,
        businessDate,
        actor.userId,
      );
    }

    // 5. Bridge-spawn for current_position. Idempotent på (run.id, position).
    // Pilot Q3 2026 (PR #1116, 2026-05-09): retry-with-rollback. Hvis bridgen
    // feiler med transient DB-glitch eller race-condition, prøver vi opptil
    // 3 ganger med exponential backoff (100ms, 500ms, 2000ms). Hvis alle
    // 3 forsøk feiler — OG vi nettopp flyttet plan-run til running (run var
    // 'idle' før vi startet) — ruller vi plan-run tilbake til 'idle' så
    // master kan trygt re-prøve uten GAME_PLAN_RUN_INVALID_TRANSITION.
    //
    // Permanente feil (JACKPOT_SETUP_REQUIRED, HALL_NOT_IN_GROUP, etc.)
    // propageres uendret etter første forsøk via isBridgeRetrySafe.
    const wasIdleBefore = run.status === "idle";
    let scheduledGameId: string;
    try {
      const retryResult = await withRetry(
        async () =>
          this.engineBridge.createScheduledGameForPlanRunPosition(
            started.id,
            started.currentPosition,
          ),
        {
          operationName: "engine-bridge.spawn.start",
          delaysMs: this.bridgeRetryDelaysMs,
          ...(this.retrySleep ? { sleep: this.retrySleep } : {}),
          shouldRetry: (err) => isBridgeRetrySafe(err),
          onRetry: (info) => {
            logger.warn(
              {
                runId: started.id,
                position: started.currentPosition,
                attemptNumber: info.attemptNumber,
                nextDelayMs: info.delayMs,
                correlationId: info.correlationId,
              },
              "[master-action] bridge-spawn retry på start",
            );
          },
        },
      );
      scheduledGameId = retryResult.value.scheduledGameId;
    } catch (err) {
      // Propager permanente DomainErrors uendret.
      if (err instanceof DomainError && PERMANENT_BRIDGE_ERROR_CODES.has(err.code)) {
        throw err;
      }
      logger.error(
        { err, runId: started.id, position: started.currentPosition },
        "[master-action] bridge-spawn feilet etter retries",
      );

      // Rollback plan-run hvis vi var den som flyttet den til running.
      if (wasIdleBefore) {
        await this.tryRollbackPlanRun({
          runId: started.id,
          actor,
          reason: "bridge_failed_after_retries:start",
          expectedPosition: started.currentPosition,
          targetPosition: 1,
          contextErr: err,
        });
        await this.audit({
          action: "spill1.master.start.bridge_failed_with_rollback",
          actor,
          hallId,
          planRunId: started.id,
          scheduledGameId: null,
          details: {
            position: started.currentPosition,
            originalError: err instanceof Error ? err.message : "ukjent feil",
            rolledBack: true,
          },
        });
        throw new DomainError(
          "BRIDGE_FAILED",
          "Bridge feilet etter 3 forsøk — plan-run resatt til idle, prøv igjen.",
          {
            runId: started.id,
            position: started.currentPosition,
            originalError: err instanceof Error ? err.message : "ukjent feil",
            rolledBack: true,
            rollbackReason: "bridge_failed_after_retries",
          },
        );
      }

      // Hvis run allerede var running (idempotent re-start), kast vanlig
      // BRIDGE_FAILED uten rollback — vi vil ikke klusse med eksisterende
      // engine-state.
      throw new DomainError(
        "BRIDGE_FAILED",
        "Kunne ikke spawne scheduled-game fra plan-run-posisjon (etter retries).",
        {
          runId: started.id,
          position: started.currentPosition,
          originalError: err instanceof Error ? err.message : "ukjent feil",
          rolledBack: false,
        },
      );
    }

    // 6. Engine.startGame — flytter scheduled-game.status til 'running' +
    // trigger draw-engine.
    let engineResult;
    try {
      engineResult = await this.masterControlService.startGame({
        gameId: scheduledGameId,
        actor,
        // Tobias-direktiv 2026-05-08: master kan starte uavhengig av
        // ready-status. Vi sender ikke confirmUnready/confirmExcludeRed
        // — masterControlService auto-ekskluderer non-green halls.
        //
        // ADR-0017 (2026-05-10): jackpotConfirmed-feltet er fjernet.
        // Daglig jackpot-akkumulering er erstattet av per-spill setup via
        // JackpotSetupModal (lagres i app_game_plan_run.jackpot_overrides_json).
      });
    } catch (err) {
      logger.warn(
        {
          err,
          scheduledGameId,
          runId: started.id,
          actorId: actor.userId,
        },
        "[master-action] engine.startGame feilet — plan-state forblir running. Master må kalle /start igjen.",
      );
      wrapEngineError(err, "start.engine");
    }

    // 7. Audit
    await this.audit({
      action: "spill1.master.start",
      actor,
      hallId,
      planRunId: started.id,
      scheduledGameId,
      details: {
        position: started.currentPosition,
        previousPlanStatus: run.status,
        engineStatus: engineResult.status,
      },
    });

    // 8. Best-effort broadcast
    this.fireLobbyBroadcast(hallId);

    return this.buildResult({
      scheduledGameId,
      planRunId: started.id,
      planRunStatus: started.status,
      scheduledGameStatus: engineResult.status as Spill1ScheduledGameStatus,
      lobby,
    });
  }

  /**
   * Flytt til neste posisjon i planen. Sekvens:
   *
   *   1. Pre-validering.
   *   2. `planRunService.advanceToNext` — position++ (eller finished hvis
   *      siste posisjon nådd). Returnerer `jackpotSetupRequired=true` hvis
   *      catalog krever popup; i så fall blir plan-run IKKE flyttet.
   *   3. Hvis `jackpotSetupRequired=true` → kast `JACKPOT_SETUP_REQUIRED`
   *      og la caller invoke /setJackpot.
   *   4. Hvis status='finished' → return uten engine-call.
   *   5. `engineBridge.createScheduledGameForPlanRunPosition` for ny posisjon.
   *   6. `masterControlService.startGame({ gameId })` for ny posisjon.
   *   7. Audit + return.
   */

  /**
   * 2026-05-09 (Tobias-direktiv) — pre-game ready-flow.
   *
   * Lazy-spawner scheduled-game-rad (status=scheduled) UTEN å starte engine.
   * Brukes av `markReady`-route så haller kan markere seg klar FØR master
   * har trykket "Start neste spill".
   *
   * Steg 1-5 av `start()` gjenbrukes:
   *   1. Lazy-create plan-run via planRunService.getOrCreateForToday
   *   2. Validér state (paused/finished → throw)
   *   3. idle → running (planRunService.start)
   *   4. Bridge-spawn scheduled-game (idempotent på (run.id, position))
   *   5. RETURNER scheduledGameId + planRunId
   *
   * STEG 6 (engine.startGame) er BEVISST UTELATT. Engine-start trigges
   * separat når master klikker "Start neste spill" — `start()` bruker
   * eksisterende scheduled-game-rad (idempotent).
   *
   * Permission-modell:
   * - SKIPPER `preValidate` (som krever GAME1_MASTER_WRITE)
   * - Caller (typisk `markReady`-route) har egen permission-sjekk
   *   (GAME1_HALL_READY_WRITE + hall-scope). Sub-haller kan da trigge
   *   prepare via mark-ready uten å være master.
   *
   * Hall-id-håndtering:
   * - `hallId` skal være MASTER-hallens id. Plan-run knyttes til master.
   * - Caller fra sub-hall må først finne masterHallId via GoH og sende den.
   */
  async prepareScheduledGame(input: {
    hallId: string;
    actor: MasterActor;
  }): Promise<{
    scheduledGameId: string;
    planRunId: string;
    planRunStatus: Spill1PlanRunStatus;
  }> {
    const hallId = assertHallId(input.hallId);
    const actor = assertActor(input.actor);

    // 1. Lazy-create plan-run for today (idempotent).
    const businessDate = this.businessDate();
    const run = await this.planRunService.getOrCreateForToday(
      hallId,
      businessDate,
    );

    // 2. State-validation. Paused/finished kan ikke spawne ny scheduled-game.
    if (run.status === "paused") {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        "Plan-run er pauset — kan ikke forberede ny runde.",
      );
    }
    if (run.status === "finished") {
      throw new DomainError(
        "PLAN_RUN_FINISHED",
        "Plan-run er allerede ferdig for i dag.",
      );
    }

    // 3. idle → running (start plan-run hvis ikke startet).
    let started = run;
    if (run.status === "idle") {
      started = await this.planRunService.start(
        hallId,
        businessDate,
        actor.userId,
      );
    }

    // 4. Bridge-spawn scheduled-game. Idempotent på (run.id, position).
    let scheduledGameId: string;
    try {
      const bridgeResult = await this.engineBridge.createScheduledGameForPlanRunPosition(
        started.id,
        started.currentPosition,
      );
      scheduledGameId = bridgeResult.scheduledGameId;
    } catch (err) {
      if (err instanceof DomainError && PERMANENT_BRIDGE_ERROR_CODES.has(err.code)) {
        throw err;
      }
      logger.error(
        { err, runId: started.id, position: started.currentPosition },
        "[master-action] prepareScheduledGame bridge-spawn feilet",
      );
      throw new DomainError(
        "BRIDGE_FAILED",
        "Kunne ikke forberede scheduled-game.",
        {
          runId: started.id,
          position: started.currentPosition,
          originalError: err instanceof Error ? err.message : "ukjent feil",
        },
      );
    }

    // 5. Audit-trail. Logger som spill1.master.prepare.
    await this.audit({
      action: "spill1.master.prepare",
      actor,
      hallId,
      planRunId: started.id,
      scheduledGameId,
      details: {
        position: started.currentPosition,
        wasIdleBefore: run.status === "idle",
      },
    });

    // 6. Best-effort lobby-broadcast.
    if (this.lobbyBroadcaster) {
      try {
        await this.lobbyBroadcaster.broadcastForHall(hallId);
      } catch (err) {
        logger.debug(
          { err, hallId },
          "[master-action] lobby-broadcast feilet etter prepare (best-effort)",
        );
      }
    }

    return {
      scheduledGameId,
      planRunId: started.id,
      planRunStatus: started.status,
    };
  }

  async advance(input: MasterActionInput): Promise<MasterActionResult> {
    const hallId = assertHallId(input.hallId);
    const actor = assertActor(input.actor);

    const lobby = await this.preValidate(hallId, actor, "advance");

    const businessDate = this.businessDate();
    const result = await this.planRunService.advanceToNext(
      hallId,
      businessDate,
      actor.userId,
    );

    // Catch jackpot-setup blokkering FØR engine-bridge-spawn.
    if (result.jackpotSetupRequired) {
      const detail = result.nextGame
        ? {
            position: result.run.currentPosition + 1,
            catalogId: result.nextGame.id,
            catalogSlug: result.nextGame.slug,
          }
        : { position: result.run.currentPosition + 1 };
      throw new DomainError(
        "JACKPOT_SETUP_REQUIRED",
        "Neste posisjon krever jackpot-popup — kall /jackpot-setup først.",
        detail,
      );
    }

    // Plan-run gikk til 'finished' (siste posisjon passert).
    if (result.run.status === "finished") {
      await this.audit({
        action: "spill1.master.finish",
        actor,
        hallId,
        planRunId: result.run.id,
        scheduledGameId: null,
        details: {
          finalPosition: result.run.currentPosition,
          reason: "advance_past_end",
        },
      });
      this.fireLobbyBroadcast(hallId);
      return this.buildResult({
        scheduledGameId: null,
        planRunId: result.run.id,
        planRunStatus: result.run.status,
        scheduledGameStatus: null,
        lobby,
      });
    }

    // Spawn ny scheduled-game-rad.
    // Pilot Q3 2026 (PR #1116, 2026-05-09): retry-with-rollback for advance.
    // Hvis bridgen feiler etter alle retries, ruller vi position tilbake til
    // forrige verdi (planRun.advanceToNext har allerede inkrementert position).
    // Status forblir running — bare position rolles back så master kan
    // re-prøve /advance med samme target.
    const previousPosition = result.run.currentPosition - 1;
    let scheduledGameId: string;
    try {
      const retryResult = await withRetry(
        async () =>
          this.engineBridge.createScheduledGameForPlanRunPosition(
            result.run.id,
            result.run.currentPosition,
          ),
        {
          operationName: "engine-bridge.spawn.advance",
          delaysMs: this.bridgeRetryDelaysMs,
          ...(this.retrySleep ? { sleep: this.retrySleep } : {}),
          shouldRetry: (err) => isBridgeRetrySafe(err),
          onRetry: (info) => {
            logger.warn(
              {
                runId: result.run.id,
                position: result.run.currentPosition,
                attemptNumber: info.attemptNumber,
                nextDelayMs: info.delayMs,
                correlationId: info.correlationId,
              },
              "[master-action] bridge-spawn retry på advance",
            );
          },
        },
      );
      scheduledGameId = retryResult.value.scheduledGameId;
    } catch (err) {
      if (err instanceof DomainError && PERMANENT_BRIDGE_ERROR_CODES.has(err.code)) {
        // Permanente feil — rull position tilbake siden vi har inkrementert
        // den men kan ikke fullføre. Master kan re-prøve etter at root
        // cause er fikset (f.eks. jackpot-setup).
        if (previousPosition >= 1) {
          await this.tryRollbackPlanRunPosition({
            runId: result.run.id,
            actor,
            reason: `bridge_permanent_error:advance:${err.code}`,
            expectedStatus: "running",
            expectedPosition: result.run.currentPosition,
            targetPosition: previousPosition,
            contextErr: err,
          });
        }
        throw err;
      }
      logger.error(
        { err, runId: result.run.id, position: result.run.currentPosition },
        "[master-action] bridge-spawn feilet på advance etter retries",
      );

      // Rull position tilbake til forrige verdi.
      if (previousPosition >= 1) {
        await this.tryRollbackPlanRunPosition({
          runId: result.run.id,
          actor,
          reason: "bridge_failed_after_retries:advance",
          expectedStatus: "running",
          expectedPosition: result.run.currentPosition,
          targetPosition: previousPosition,
          contextErr: err,
        });
        await this.audit({
          action: "spill1.master.advance.bridge_failed_with_rollback",
          actor,
          hallId,
          planRunId: result.run.id,
          scheduledGameId: null,
          details: {
            fromPosition: result.run.currentPosition,
            toPosition: previousPosition,
            originalError: err instanceof Error ? err.message : "ukjent feil",
            rolledBack: true,
          },
        });
        throw new DomainError(
          "BRIDGE_FAILED",
          "Bridge feilet etter 3 forsøk på advance — plan-position resatt, prøv igjen.",
          {
            runId: result.run.id,
            position: result.run.currentPosition,
            previousPosition,
            originalError: err instanceof Error ? err.message : "ukjent feil",
            rolledBack: true,
            rollbackReason: "bridge_failed_after_retries",
          },
        );
      }

      throw new DomainError(
        "BRIDGE_FAILED",
        "Kunne ikke spawne scheduled-game for ny posisjon (etter retries).",
        {
          runId: result.run.id,
          position: result.run.currentPosition,
          originalError: err instanceof Error ? err.message : "ukjent feil",
          rolledBack: false,
        },
      );
    }

    // Trigger engine.
    let engineResult;
    try {
      engineResult = await this.masterControlService.startGame({
        gameId: scheduledGameId,
        actor,
      });
    } catch (err) {
      logger.warn(
        {
          err,
          scheduledGameId,
          runId: result.run.id,
        },
        "[master-action] engine.startGame feilet på advance",
      );
      wrapEngineError(err, "advance.engine");
    }

    await this.audit({
      action: "spill1.master.advance",
      actor,
      hallId,
      planRunId: result.run.id,
      scheduledGameId,
      details: {
        toPosition: result.run.currentPosition,
        catalogSlug: result.nextGame?.slug ?? null,
        engineStatus: engineResult.status,
      },
    });

    this.fireLobbyBroadcast(hallId);

    return this.buildResult({
      scheduledGameId,
      planRunId: result.run.id,
      planRunStatus: result.run.status,
      scheduledGameStatus: engineResult.status as Spill1ScheduledGameStatus,
      lobby,
    });
  }

  /**
   * Pause aktiv runde. Sekvens:
   *
   *   1. Pre-validering.
   *   2. `lobby.currentScheduledGameId` MÅ være satt — ellers NO_ACTIVE_GAME.
   *   3. `masterControlService.pauseGame({ gameId, reason })`.
   *   4. `planRunService.pause` — best-effort marker. Hvis run er i annen
   *      status, logg + skip (ikke kast).
   *   5. Audit + return.
   */
  async pause(input: MasterActionInputWithReason): Promise<MasterActionResult> {
    const hallId = assertHallId(input.hallId);
    const actor = assertActor(input.actor);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";

    const lobby = await this.preValidate(hallId, actor, "pause");

    const scheduledGameId = lobby.currentScheduledGameId;
    if (!scheduledGameId) {
      throw new DomainError(
        "NO_ACTIVE_GAME",
        "Ingen aktiv runde å pause for hallen.",
      );
    }

    let engineResult;
    try {
      engineResult = await this.masterControlService.pauseGame({
        gameId: scheduledGameId,
        actor,
        ...(reason ? { reason } : {}),
      });
    } catch (err) {
      logger.warn(
        { err, scheduledGameId, hallId },
        "[master-action] pauseGame feilet",
      );
      wrapEngineError(err, "pause.engine");
    }

    // Best-effort plan-run pause. Plan-run kan være i `running` eller annen
    // status; vi ignorerer feil her siden engine allerede er pauset.
    const planRunId = lobby.planMeta?.planRunId ?? null;
    if (planRunId && lobby.planMeta?.planRunStatus === "running") {
      try {
        await this.planRunService.pause(
          hallId,
          this.businessDate(),
          actor.userId,
        );
      } catch (err) {
        logger.warn(
          { err, planRunId, hallId },
          "[master-action] plan-run pause feilet — fortsetter (engine allerede pauset)",
        );
      }
    }

    await this.audit({
      action: "spill1.master.pause",
      actor,
      hallId,
      planRunId,
      scheduledGameId,
      details: {
        reason: reason || null,
        engineStatus: engineResult.status,
      },
    });

    this.fireLobbyBroadcast(hallId);

    // Re-fetch plan-run-status post-pause for return-value.
    const refreshedPlan = await this.planRunService.findForDay(
      hallId,
      this.businessDate(),
    );
    const planStatus = refreshedPlan?.status ?? lobby.planMeta?.planRunStatus;

    return this.buildResult({
      scheduledGameId,
      planRunId: planRunId ?? "",
      planRunStatus: (planStatus ?? "running") as Spill1PlanRunStatus,
      scheduledGameStatus: engineResult.status as Spill1ScheduledGameStatus,
      lobby,
    });
  }

  /**
   * Resume pauset runde. Sekvens speiler `pause` motsatt vei.
   */
  async resume(input: MasterActionInput): Promise<MasterActionResult> {
    const hallId = assertHallId(input.hallId);
    const actor = assertActor(input.actor);

    const lobby = await this.preValidate(hallId, actor, "resume");

    const scheduledGameId = lobby.currentScheduledGameId;
    if (!scheduledGameId) {
      throw new DomainError(
        "NO_ACTIVE_GAME",
        "Ingen aktiv runde å resume for hallen.",
      );
    }

    let engineResult;
    try {
      engineResult = await this.masterControlService.resumeGame({
        gameId: scheduledGameId,
        actor,
      });
    } catch (err) {
      logger.warn(
        { err, scheduledGameId, hallId },
        "[master-action] resumeGame feilet",
      );
      wrapEngineError(err, "resume.engine");
    }

    const planRunId = lobby.planMeta?.planRunId ?? null;
    if (planRunId && lobby.planMeta?.planRunStatus === "paused") {
      try {
        await this.planRunService.resume(
          hallId,
          this.businessDate(),
          actor.userId,
        );
      } catch (err) {
        logger.warn(
          { err, planRunId, hallId },
          "[master-action] plan-run resume feilet — fortsetter (engine allerede resumed)",
        );
      }
    }

    await this.audit({
      action: "spill1.master.resume",
      actor,
      hallId,
      planRunId,
      scheduledGameId,
      details: {
        engineStatus: engineResult.status,
      },
    });

    this.fireLobbyBroadcast(hallId);

    const refreshedPlan = await this.planRunService.findForDay(
      hallId,
      this.businessDate(),
    );
    const planStatus = refreshedPlan?.status ?? lobby.planMeta?.planRunStatus;

    return this.buildResult({
      scheduledGameId,
      planRunId: planRunId ?? "",
      planRunStatus: (planStatus ?? "running") as Spill1PlanRunStatus,
      scheduledGameStatus: engineResult.status as Spill1ScheduledGameStatus,
      lobby,
    });
  }

  /**
   * Stopp aktiv runde og avslutt plan-run (idempotent for begge state-rom).
   * Sekvens:
   *
   *   1. Pre-validering.
   *   2. `masterControlService.stopGame({ gameId, reason })` — engine-side
   *      cancellation (status='cancelled', refund-loop, etc.).
   *   3. `planRunService.finish` — plan-run til 'finished'.
   *   4. Audit + return.
   *
   * Reason er påkrevd (regulatorisk audit). Hvis ingen scheduled-game
   * eksisterer (e.g. master vil bare avslutte plan-run-en) kan plan-run
   * fortsatt finishes alene — men da kalles ikke engine.
   */
  async stop(input: MasterStopInput): Promise<MasterActionResult> {
    const hallId = assertHallId(input.hallId);
    const actor = assertActor(input.actor);
    const reason = (input.reason ?? "").trim();
    if (!reason) {
      throw new DomainError("INVALID_INPUT", "reason er påkrevd ved stop.");
    }

    const lobby = await this.preValidate(hallId, actor, "stop");

    const scheduledGameId = lobby.currentScheduledGameId;
    let engineResult: { status: string; refundSummary?: unknown } | null = null;

    if (scheduledGameId) {
      try {
        engineResult = await this.masterControlService.stopGame({
          gameId: scheduledGameId,
          actor,
          reason,
        });
      } catch (err) {
        logger.warn(
          { err, scheduledGameId, hallId },
          "[master-action] stopGame feilet",
        );
        wrapEngineError(err, "stop.engine");
      }
    }

    const planRunId = lobby.planMeta?.planRunId ?? null;
    if (planRunId) {
      try {
        await this.planRunService.finish(
          hallId,
          this.businessDate(),
          actor.userId,
        );
      } catch (err) {
        // Hvis run er i status der finish ikke er gyldig, logg og fortsett.
        // Engine er allerede stoppet, så semantisk er stoppet utført.
        logger.warn(
          { err, planRunId, hallId },
          "[master-action] plan-run finish feilet — fortsetter (engine allerede stoppet)",
        );
      }
    }

    await this.audit({
      action: "spill1.master.stop",
      actor,
      hallId,
      planRunId,
      scheduledGameId: scheduledGameId ?? null,
      details: {
        reason,
        engineStatus: engineResult?.status ?? null,
      },
    });

    this.fireLobbyBroadcast(hallId);

    return this.buildResult({
      scheduledGameId,
      planRunId: planRunId ?? "",
      planRunStatus: "finished",
      scheduledGameStatus:
        (engineResult?.status as Spill1ScheduledGameStatus | undefined) ??
        null,
      lobby,
    });
  }

  /**
   * Submit jackpot-popup (draw + prizesCents) for en posisjon. Validerer:
   *
   *   - position ≥ 1
   *   - draw ∈ [1, 90]
   *   - prizesCents-keys i TICKET_COLOR_VALUES, verdier positive heltall (øre)
   *
   * Plan-run må være i `running` eller `paused`. Service-laget validerer
   * også at posisjonen krever override (catalog.requiresJackpotSetup=true).
   */
  async setJackpot(input: MasterSetJackpotInput): Promise<MasterActionResult> {
    const hallId = assertHallId(input.hallId);
    const actor = assertActor(input.actor);

    if (
      !Number.isFinite(input.position) ||
      !Number.isInteger(input.position) ||
      input.position < 1
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "position må være positivt heltall.",
      );
    }
    if (
      !Number.isFinite(input.draw) ||
      !Number.isInteger(input.draw) ||
      input.draw < MIN_DRAW ||
      input.draw > MAX_DRAW
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        `draw må være heltall mellom ${MIN_DRAW} og ${MAX_DRAW}.`,
      );
    }
    if (
      !input.prizesCents ||
      typeof input.prizesCents !== "object" ||
      Array.isArray(input.prizesCents)
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "prizesCents må være et objekt.",
      );
    }
    const prizesCents: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.prizesCents)) {
      if (!VALID_TICKET_COLORS.has(k as TicketColor)) {
        throw new DomainError(
          "INVALID_INPUT",
          `prizesCents.${k} er ikke en gyldig bongfarge.`,
        );
      }
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new DomainError(
          "INVALID_INPUT",
          `prizesCents.${k} må være positivt heltall (øre).`,
        );
      }
      prizesCents[k] = n;
    }
    if (Object.keys(prizesCents).length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "prizesCents må ha minst én farge.",
      );
    }

    const lobby = await this.preValidate(hallId, actor, "setJackpot");

    const businessDate = this.businessDate();
    const updated = await this.planRunService.setJackpotOverride(
      hallId,
      businessDate,
      input.position,
      { draw: input.draw, prizesCents },
      actor.userId,
    );

    await this.audit({
      action: "spill1.master.jackpot_set",
      actor,
      hallId,
      planRunId: updated.id,
      scheduledGameId: lobby.currentScheduledGameId,
      details: {
        position: input.position,
        draw: input.draw,
        prizeColors: Object.keys(prizesCents),
      },
    });

    this.fireLobbyBroadcast(hallId);

    return this.buildResult({
      scheduledGameId: lobby.currentScheduledGameId,
      planRunId: updated.id,
      planRunStatus: updated.status,
      scheduledGameStatus:
        lobby.scheduledGameMeta?.status ?? null,
      lobby,
    });
  }

  // ── private helpers ────────────────────────────────────────────────────

  private businessDate(): string {
    return todayOsloKey(this.clock());
  }

  /**
   * Pre-validering for alle write-actions:
   *
   *   1. Hent `Spill1AgentLobbyState` via aggregator.
   *   2. Avvis hvis `isMasterAgent=false` — caller har ikke RBAC til å
   *      utføre actions for denne hallen (FORBIDDEN).
   *   3. Avvis hvis blocking-warnings (`BRIDGE_FAILED`,
   *      `DUAL_SCHEDULED_GAMES`) er satt (LOBBY_INCONSISTENT).
   */
  private async preValidate(
    hallId: string,
    actor: MasterActor,
    actionName: string,
  ): Promise<Spill1AgentLobbyState> {
    let state: Spill1AgentLobbyState;
    try {
      state = await this.lobbyAggregator.getLobbyState(
        hallId,
        toAggregatorActor(actor),
      );
    } catch (err) {
      // Aggregator kaster LOBBY_AGGREGATOR_INFRA_ERROR ved DB-feil. Vi
      // propagerer uendret slik at routen returnerer 5xx; klient ser ikke
      // misvisende 4xx for infrastruktur-problem.
      throw err;
    }

    if (!state.isMasterAgent) {
      throw new DomainError(
        "FORBIDDEN",
        `Kun master-hallens agent kan utføre '${actionName}'-handlingen.`,
      );
    }

    const blocking = findBlockingWarnings(state);
    if (blocking.length > 0) {
      logger.warn(
        {
          hallId,
          actor: { userId: actor.userId, role: actor.role },
          actionName,
          blockingWarnings: blocking,
          warnings: state.inconsistencyWarnings,
        },
        "[master-action] avviser action — lobby har blocking warnings",
      );
      throw new DomainError(
        "LOBBY_INCONSISTENT",
        `Lobby-state har blocking-warnings (${blocking.join(", ")}) — manuell reconciliation kreves før master kan handle.`,
        {
          blockingWarnings: blocking,
          allWarnings: state.inconsistencyWarnings,
        },
      );
    }

    return state;
  }

  /**
   * Bygg `MasterActionResult` fra interim state. Alle felter er satt;
   * caller får en konsistent shape uavhengig av action-type.
   */
  private buildResult(input: {
    scheduledGameId: string | null;
    planRunId: string;
    planRunStatus: Spill1PlanRunStatus;
    scheduledGameStatus: Spill1ScheduledGameStatus | null;
    lobby: Spill1AgentLobbyState;
  }): MasterActionResult {
    return {
      scheduledGameId: input.scheduledGameId,
      planRunId: input.planRunId,
      status: input.planRunStatus,
      scheduledGameStatus: input.scheduledGameStatus,
      inconsistencyWarnings: extractWarningCodes(input.lobby),
    };
  }

  /**
   * Best-effort lobby-broadcast. Aldri kaster — feil logges av broadcasteren
   * selv. UI-en som lytter får oppdatert state innen ~50ms etter action.
   */
  private fireLobbyBroadcast(hallId: string): void {
    if (!this.lobbyBroadcaster) return;
    void this.lobbyBroadcaster.broadcastForHall(hallId);
  }

  /**
   * Pilot Q3 2026 (PR #1116, 2026-05-09): best-effort rollback av plan-run
   * etter at bridge-spawn feilet alle retries. Fire-and-forget — hvis
   * rollback selv kaster, logges det og vi kaster videre den ORIGINALE
   * bridge-feilen så master ser klar feilmelding.
   *
   * @internal
   */
  private async tryRollbackPlanRun(input: {
    runId: string;
    actor: MasterActor;
    reason: string;
    expectedPosition: number;
    targetPosition: number;
    contextErr: unknown;
  }): Promise<void> {
    try {
      const result = await this.planRunService.rollbackToIdle({
        runId: input.runId,
        expectedStatus: "running",
        expectedPosition: input.expectedPosition,
        targetPosition: input.targetPosition,
        reason: input.reason,
        masterUserId: input.actor.userId,
      });
      if (result === null) {
        logger.warn(
          {
            runId: input.runId,
            actorId: input.actor.userId,
            reason: input.reason,
          },
          "[master-action] rollback no-op — state already changed by another actor",
        );
      } else {
        logger.info(
          {
            runId: input.runId,
            actorId: input.actor.userId,
            reason: input.reason,
            originalError:
              input.contextErr instanceof Error
                ? input.contextErr.message
                : "ukjent feil",
          },
          "[master-action] plan-run rolled back to idle after bridge failure",
        );
      }
    } catch (rollbackErr) {
      // Rollback-feil må aldri overskrive original bridge-feilen.
      logger.error(
        {
          err: rollbackErr,
          runId: input.runId,
          reason: input.reason,
          originalErr: input.contextErr,
        },
        "[master-action] rollback selv feilet — manuell intervensjon kreves",
      );
    }
  }

  /**
   * Pilot Q3 2026: best-effort rollback av position-only (advance-feil).
   * Beholder status=running men ruller current_position tilbake.
   *
   * @internal
   */
  private async tryRollbackPlanRunPosition(input: {
    runId: string;
    actor: MasterActor;
    reason: string;
    expectedStatus: "running" | "paused";
    expectedPosition: number;
    targetPosition: number;
    contextErr: unknown;
  }): Promise<void> {
    try {
      const result = await this.planRunService.rollbackPosition({
        runId: input.runId,
        expectedStatus: input.expectedStatus,
        expectedPosition: input.expectedPosition,
        targetPosition: input.targetPosition,
        reason: input.reason,
        masterUserId: input.actor.userId,
      });
      if (result === null) {
        logger.warn(
          {
            runId: input.runId,
            actorId: input.actor.userId,
            reason: input.reason,
          },
          "[master-action] position rollback no-op — state changed by another actor",
        );
      } else {
        logger.info(
          {
            runId: input.runId,
            actorId: input.actor.userId,
            reason: input.reason,
            fromPosition: input.expectedPosition,
            toPosition: input.targetPosition,
          },
          "[master-action] plan-run position rolled back after bridge failure",
        );
      }
    } catch (rollbackErr) {
      logger.error(
        {
          err: rollbackErr,
          runId: input.runId,
          reason: input.reason,
          originalErr: input.contextErr,
        },
        "[master-action] position rollback selv feilet — manuell intervensjon kreves",
      );
    }
  }

  /**
   * Audit-event for master-actions. Skriver `spill1.master.<action>`-event
   * via `AuditLogService`. Fire-and-forget — failure logges men blokkerer
   * ikke responsen (samme mønster som `GamePlanRunService.audit`).
   *
   * Felter som skrives:
   *   - actorId   = actor.userId
   *   - actorType = mapping fra MasterActor.role
   *   - action    = "spill1.master.<verb>"
   *   - resource  = "spill1_master_action"
   *   - resourceId = scheduledGameId ?? planRunId (best identifier)
   *   - details   = { hallId, planRunId, scheduledGameId, ...domainSpecific }
   */
  private async audit(input: {
    action: string;
    actor: MasterActor;
    hallId: string;
    planRunId: string | null;
    scheduledGameId: string | null;
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.auditLogService) return;
    try {
      const actorType =
        input.actor.role === "ADMIN"
          ? "ADMIN"
          : input.actor.role === "HALL_OPERATOR"
            ? "HALL_OPERATOR"
            : input.actor.role === "AGENT"
              ? "AGENT"
              : input.actor.role === "SUPPORT"
                ? "SUPPORT"
                : "USER";
      const resourceId =
        input.scheduledGameId ?? input.planRunId ?? null;
      await this.auditLogService.record({
        actorId: input.actor.userId,
        actorType,
        action: input.action,
        resource: "spill1_master_action",
        resourceId,
        details: {
          hallId: input.hallId,
          planRunId: input.planRunId,
          scheduledGameId: input.scheduledGameId,
          ...(input.details ?? {}),
        },
      });
    } catch (err) {
      // Audit-svikt skal aldri blokkere domene-actions.
      logger.warn(
        { err, action: input.action },
        "[master-action] audit-log feilet — fortsetter",
      );
    }
  }
}
