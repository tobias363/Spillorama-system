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
 *      respons, og lot UI gjette hvilket id-rom var aktivt.
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

/** Pause input — har optional reason for audit-trail. */
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
 * spesifikk DomainError (HALLS_NOT_READY, JACKPOT_CONFIRM_REQUIRED, etc.)
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

// ── service ─────────────────────────────────────────────────────────────

/**
 * Skeleton — public methods kommer i påfølgende commits.
 * (Bølge 2: skeleton + interfaces først for atomic-commit-historikk.)
 */
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
    return svc;
  }

  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service ?? null;
  }

  // ── public API ─────────────────────────────────────────────────────────
  // start/advance/pause/resume/stop/setJackpot kommer i neste commit.

  // ── private helpers (delvis — preValidate/buildResult lander i neste commit) ──

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
  protected async preValidate(
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
  protected buildResult(input: {
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
  protected fireLobbyBroadcast(hallId: string): void {
    if (!this.lobbyBroadcaster) return;
    void this.lobbyBroadcaster.broadcastForHall(hallId);
  }

  /** Wrapper rundt engine-feil for konsistent ENGINE_FAILED-shape. */
  protected wrapEngineError(err: unknown, context: string): never {
    return wrapEngineError(err, context);
  }

  /** Validate ticket-color string — eksponert for setJackpot-implementasjonen. */
  protected isValidTicketColor(s: string): boolean {
    return VALID_TICKET_COLORS.has(s as TicketColor);
  }

  /** MIN_DRAW/MAX_DRAW eksponert for tester og setJackpot. */
  static readonly MIN_DRAW = MIN_DRAW;
  static readonly MAX_DRAW = MAX_DRAW;
}
