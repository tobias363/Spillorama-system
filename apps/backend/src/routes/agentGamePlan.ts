/**
 * Fase 3 (2026-05-07): agent-router for spilleplan-runtime.
 *
 * Eksponerer GamePlanRunService til master-dashboardet (cash-inout +
 * agent-portal) bak en feature-flag-aware data-source. Master-UI lytter
 * på `/api/agent/game-plan/current` for nåværende posisjon, jackpot-
 * setup-flagg og hele plan-sekvensen — og bruker `/start` + `/advance` +
 * `/jackpot-setup` til å drive runtime-state framover.
 *
 * Endepunkter:
 *   GET  /api/agent/game-plan/current
 *     Returnerer plan + items + currentItem + nextItem + jackpot-flagg.
 *     Hvis ingen plan dekker (hall, ukedag) i dag → run=null + plan=null
 *     (ikke en feil — frontend faller tilbake til legacy-flow).
 *   POST /api/agent/game-plan/start
 *     Master-only. idle → running, current_position=1.
 *   POST /api/agent/game-plan/advance
 *     Master-only. Inkrementer current_position, eller signaler
 *     jackpotSetupRequired hvis nåværende spill krever popup.
 *   POST /api/agent/game-plan/jackpot-setup
 *     Master-only. Lagre override (draw + prizesCents) før advance.
 *   POST /api/agent/game-plan/pause
 *   POST /api/agent/game-plan/resume
 *     Master-only. Pause/resume status-overganger (mest for parity med
 *     master-UI; faktisk pause-knapp er fortsatt /api/agent/game1/pause).
 *
 * Rolle-krav:
 *   GAME1_MASTER_WRITE (ADMIN + HALL_OPERATOR + AGENT). SUPPORT er
 *   utelatt — samme som agentGame1.ts. Hall-scope håndheves ved at
 *   GET kun returnerer data for agentens egen hall, og POST avslår
 *   når caller ikke er master-hallens agent (plan.hallId === actor.hallId
 *   eller plan.groupOfHallsId.master === actor.hallId).
 *
 * Audit: writes går via GamePlanRunService som allerede skriver
 *   `game_plan_run.{create,start,advance,jackpot_set,pause,resume,finish}`.
 *
 * Feature-flag: routeren er alltid registrert. Frontend velger om den
 *   skal bruke `/api/agent/game1/current-game` (legacy) eller
 *   `/api/agent/game-plan/current` (ny) basert på `useNewGamePlan`-flagg
 *   i localStorage / config.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { GamePlanRunService } from "../game/GamePlanRunService.js";
import type { GamePlanService } from "../game/GamePlanService.js";
import type {
  GamePlan,
  GamePlanItem,
  GamePlanRun,
  GamePlanWithItems,
} from "../game/gamePlan.types.js";
import type {
  GameCatalogEntry,
  TicketColor,
} from "../game/gameCatalog.types.js";
import { TICKET_COLOR_VALUES } from "../game/gameCatalog.types.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  isRecordObject,
} from "../util/httpHelpers.js";
import { todayOsloKey } from "../util/osloTimezone.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-game-plan" });

const VALID_TICKET_COLORS = new Set<TicketColor>(TICKET_COLOR_VALUES);

export interface AgentGamePlanRouterDeps {
  platformService: PlatformService;
  planRunService: GamePlanRunService;
  planService: GamePlanService;
}

interface PlanItemWithCatalog extends GamePlanItem {
  catalogEntry: GameCatalogEntry;
}

/**
 * Resolve hall-scope identisk med agentGame1.ts:
 *   - ADMIN → query.hallId override eller user.hallId
 *   - HALL_OPERATOR/AGENT → låst til user.hallId (cross-hall query avslås)
 */
function resolveHallScope(
  user: PublicAppUser,
  queryHallId: string | undefined,
): string {
  if (user.role === "ADMIN") {
    if (queryHallId && queryHallId.trim().length > 0) {
      return queryHallId.trim();
    }
    if (user.hallId) return user.hallId;
    throw new DomainError(
      "INVALID_INPUT",
      "ADMIN må angi ?hallId for plan-scope (egen hallId ikke satt).",
    );
  }
  if (user.role === "HALL_OPERATOR" || user.role === "AGENT") {
    if (!user.hallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Din bruker er ikke tildelt en hall — kontakt admin.",
      );
    }
    if (
      queryHallId &&
      queryHallId.trim().length > 0 &&
      queryHallId.trim() !== user.hallId
    ) {
      throw new DomainError(
        "FORBIDDEN",
        "Du kan kun lese plan for din egen hall.",
      );
    }
    return user.hallId;
  }
  throw new DomainError(
    "FORBIDDEN",
    "Rollen din har ikke tilgang til spilleplan-runtime.",
  );
}

/**
 * Bestem om caller er master for planen. Master = agentens hall matcher
 * plan.hallId direkte. For group-of-halls-planer er master-hall et
 * eget begrep som krever oppslag i hallGroupService — den koblingen
 * er deferred til Fase 3.5 (vi bruker plan.hallId for nå).
 *
 * ADMIN er alltid master. HALL_OPERATOR/AGENT må matche plan-hallen
 * eksakt.
 */
function isMaster(actor: PublicAppUser, plan: GamePlan): boolean {
  if (actor.role === "ADMIN") return true;
  if (!actor.hallId) return false;
  if (plan.hallId && plan.hallId === actor.hallId) return true;
  // Group-of-halls: master-hall-attribusjon kobles på i Fase 3.5 når
  // app_groups-tabellen er på plass og group.master_hall_id er ekspandert
  // i plan-detaljen. Fram til da: hvis plan er knyttet til group-of-halls
  // er ingen agent master. ADMIN-route brukes til å starte runs.
  return false;
}

/**
 * Map plan-item + catalog-entry til wire-format. Frontend trenger nok
 * data til å rendre Spill1HallStatusBox + JackpotSetupModal uten ekstra
 * round-trips.
 */
function serializeItem(item: PlanItemWithCatalog): {
  id: string;
  position: number;
  notes: string | null;
  catalogEntry: GameCatalogEntry;
} {
  return {
    id: item.id,
    position: item.position,
    notes: item.notes,
    catalogEntry: item.catalogEntry,
  };
}

/**
 * Beregn jackpot-setup-flagget for nåværende posisjon. True hvis:
 *   - currentItem.catalogEntry.requiresJackpotSetup === true
 *   - run.jackpotOverrides[String(currentPosition)] mangler
 */
function computeJackpotSetupRequired(
  run: GamePlanRun,
  currentItem: PlanItemWithCatalog | null,
): boolean {
  if (!currentItem) return false;
  if (!currentItem.catalogEntry.requiresJackpotSetup) return false;
  const key = String(currentItem.position);
  return !Object.prototype.hasOwnProperty.call(run.jackpotOverrides, key);
}

/**
 * Plukk pending override for nåværende posisjon (hvis lagret). Frontend
 * pre-fyller jackpot-popup hvis admin har satt override tidligere.
 */
function pickPendingOverride(
  run: GamePlanRun,
  currentItem: PlanItemWithCatalog | null,
): { draw: number; prizesCents: Partial<Record<TicketColor, number>> } | null {
  if (!currentItem) return null;
  const key = String(currentItem.position);
  const override = run.jackpotOverrides[key];
  if (!override) return null;
  return { draw: override.draw, prizesCents: override.prizesCents };
}

export function createAgentGamePlanRouter(
  deps: AgentGamePlanRouterDeps,
): express.Router {
  const { platformService, planRunService, planService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user, permission);
    return user;
  }

  /**
   * Slå opp aktiv eller siste run for (hall, businessDate). Returnerer
   * null hvis ingen run finnes (idempotent — caller velger om de vil
   * opprette).
   *
   * Soft-fail: hvis NO_MATCHING_PLAN kastes (ingen aktiv plan dekker
   * dagen for hallen), returner null. Frontend faller tilbake til
   * legacy-flyten via `useNewGamePlan=false`.
   */
  async function loadCurrent(
    hallId: string,
    businessDate: string,
  ): Promise<{
    run: GamePlanRun;
    plan: GamePlanWithItems;
  } | null> {
    const run = await planRunService.findForDay(hallId, businessDate);
    if (!run) return null;
    const plan = await planService.getById(run.planId);
    if (!plan) {
      // Plan slettet etter run ble opprettet — defensivt fall tilbake.
      logger.warn(
        { runId: run.id, planId: run.planId, hallId },
        "[fase-3] plan slettet for aktiv run — returnerer null",
      );
      return null;
    }
    return { run, plan };
  }

  // ── GET /api/agent/game-plan/current ───────────────────────────────────

  router.get("/api/agent/game-plan/current", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const queryHallId =
        typeof req.query.hallId === "string" ? req.query.hallId : undefined;
      const hallId = resolveHallScope(actor, queryHallId);
      const businessDate = todayOsloKey();

      const loaded = await loadCurrent(hallId, businessDate);
      if (!loaded) {
        apiSuccess(res, {
          hallId,
          businessDate,
          run: null,
          plan: null,
          items: [],
          currentItem: null,
          nextItem: null,
          jackpotSetupRequired: false,
          pendingJackpotOverride: null,
          isMaster: false,
        });
        return;
      }
      const { run, plan } = loaded;
      const items = plan.items;
      const currentItem =
        items.find((i) => i.position === run.currentPosition) ?? null;
      const nextItem =
        items.find((i) => i.position === run.currentPosition + 1) ?? null;
      const jackpotSetupRequired = computeJackpotSetupRequired(
        run,
        currentItem,
      );
      const pendingJackpotOverride = pickPendingOverride(run, currentItem);
      const master = isMaster(actor, plan);

      apiSuccess(res, {
        hallId,
        businessDate,
        run,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          hallId: plan.hallId,
          groupOfHallsId: plan.groupOfHallsId,
          weekdays: plan.weekdays,
          startTime: plan.startTime,
          endTime: plan.endTime,
          isActive: plan.isActive,
        },
        items: items.map(serializeItem),
        currentItem: currentItem ? serializeItem(currentItem) : null,
        nextItem: nextItem ? serializeItem(nextItem) : null,
        jackpotSetupRequired,
        pendingJackpotOverride,
        isMaster: master,
      });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/start ────────────────────────────────────

  router.post("/api/agent/game-plan/start", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();

      // getOrCreateForToday sikrer at en run finnes for dagen. Hvis
      // ingen plan dekker (hall, ukedag) kastes NO_MATCHING_PLAN.
      const run = await planRunService.getOrCreateForToday(hallId, businessDate);
      const plan = await planService.getById(run.planId);
      if (!plan) {
        throw new DomainError(
          "GAME_PLAN_NOT_FOUND",
          "Plan finnes ikke for run.",
        );
      }
      if (!isMaster(actor, plan)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan starte spilleplan-runden.",
        );
      }

      const started = await planRunService.start(
        hallId,
        businessDate,
        actor.id,
      );
      apiSuccess(res, { run: started });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/advance ──────────────────────────────────

  router.post("/api/agent/game-plan/advance", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();

      const loaded = await loadCurrent(hallId, businessDate);
      if (!loaded) {
        throw new DomainError(
          "GAME_PLAN_RUN_NOT_FOUND",
          "Ingen aktiv run for (hall, dato). Kall /start først.",
        );
      }
      const { plan } = loaded;
      if (!isMaster(actor, plan)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan flytte spilleplanen videre.",
        );
      }

      const result = await planRunService.advanceToNext(
        hallId,
        businessDate,
        actor.id,
      );
      apiSuccess(res, {
        run: result.run,
        nextGame: result.nextGame,
        jackpotSetupRequired: result.jackpotSetupRequired,
        // Frontend trenger fortsatt gameId for engine-binding i Fase 3.5
        // — i Fase 3 reflekterer vi bare state-overgangen.
      });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/jackpot-setup ────────────────────────────

  router.post("/api/agent/game-plan/jackpot-setup", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();

      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const positionRaw = body.position;
      const position = Number(positionRaw);
      if (
        !Number.isFinite(position) ||
        !Number.isInteger(position) ||
        position < 1
      ) {
        throw new DomainError(
          "INVALID_INPUT",
          "position må være positivt heltall.",
        );
      }
      const drawRaw = body.draw;
      const draw = Number(drawRaw);
      if (!Number.isFinite(draw) || !Number.isInteger(draw) || draw < 1) {
        throw new DomainError(
          "INVALID_INPUT",
          "draw må være positivt heltall.",
        );
      }
      if (
        !body.prizesCents ||
        typeof body.prizesCents !== "object" ||
        Array.isArray(body.prizesCents)
      ) {
        throw new DomainError(
          "INVALID_INPUT",
          "prizesCents må være et objekt.",
        );
      }
      // Whitelist-validering — service-laget repeterer dette mot
      // catalog-entry, men vi skiller "ugyldig farge i request" fra
      // "farge ikke tillatt for spillet" tidligst mulig for klart UX.
      const prizesCents: Record<string, number> = {};
      for (const [k, v] of Object.entries(
        body.prizesCents as Record<string, unknown>,
      )) {
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

      const loaded = await loadCurrent(hallId, businessDate);
      if (!loaded) {
        throw new DomainError(
          "GAME_PLAN_RUN_NOT_FOUND",
          "Ingen aktiv run for (hall, dato).",
        );
      }
      const { plan } = loaded;
      if (!isMaster(actor, plan)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan sette jackpot-override.",
        );
      }

      const updated = await planRunService.setJackpotOverride(
        hallId,
        businessDate,
        position,
        { draw, prizesCents },
        actor.id,
      );
      apiSuccess(res, { run: updated });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/pause ────────────────────────────────────

  router.post("/api/agent/game-plan/pause", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();
      const loaded = await loadCurrent(hallId, businessDate);
      if (!loaded) {
        throw new DomainError(
          "GAME_PLAN_RUN_NOT_FOUND",
          "Ingen aktiv run for (hall, dato).",
        );
      }
      if (!isMaster(actor, loaded.plan)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan pause spilleplanen.",
        );
      }
      const run = await planRunService.pause(hallId, businessDate, actor.id);
      apiSuccess(res, { run });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/resume ───────────────────────────────────

  router.post("/api/agent/game-plan/resume", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();
      const loaded = await loadCurrent(hallId, businessDate);
      if (!loaded) {
        throw new DomainError(
          "GAME_PLAN_RUN_NOT_FOUND",
          "Ingen aktiv run for (hall, dato).",
        );
      }
      if (!isMaster(actor, loaded.plan)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan resume spilleplanen.",
        );
      }
      const run = await planRunService.resume(hallId, businessDate, actor.id);
      apiSuccess(res, { run });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  return router;
}
