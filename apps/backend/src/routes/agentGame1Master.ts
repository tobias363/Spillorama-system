/**
 * Bølge 2 (2026-05-08): kanoniske Spill 1 master-action-endpoints.
 *
 * Mandat (audit `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §6.2):
 *   POST /api/agent/game1/master/start
 *   POST /api/agent/game1/master/advance
 *   POST /api/agent/game1/master/pause
 *   POST /api/agent/game1/master/resume
 *   POST /api/agent/game1/master/stop
 *   POST /api/agent/game1/master/jackpot-setup
 *
 * Disse rutene erstatter den fragmenterte UI-flyten der frontend kalte
 * plan-API + legacy-API parallelt og lot klienten merge id-rommene. Nå er
 * det én post-endpoint per master-action og response-shapen er identisk
 * uavhengig av hvilken action — `MasterActionResult` med både planRunId og
 * scheduledGameId.
 *
 * RBAC: GAME1_MASTER_WRITE (ADMIN, HALL_OPERATOR, AGENT — IKKE SUPPORT).
 *
 * Hall-scope: HALL_OPERATOR/AGENT er låst til egen hallId. ADMIN kan
 * overstyre via `body.hallId`. SUPPORT/PLAYER er utestengt av
 * assertAdminPermission.
 *
 * Sekvenseringen kjøres internt i `MasterActionService` — denne route-
 * filen er ren HTTP-adapter (auth + parsing + apiSuccess/apiFailure).
 *
 * Bakover-kompatibilitet:
 *   Eksisterende endpoints (`/api/agent/game-plan/start`,
 *   `/api/agent/game-plan/advance`, etc.) er IKKE påvirket. UI bytter til
 *   ny endpoint i Bølge 3.
 *
 * 2026-05-09 (recover-stale): la til
 *   POST /api/agent/game1/master/recover-stale
 * for master-driven cleanup av STALE_PLAN_RUN/BRIDGE_FAILED-state.
 * Dette er et separat endpoint (ikke en MasterActionService-action) fordi
 * recovery MÅ bypasse MasterActionService.preValidate som ellers blokkerer
 * alle write-actions ved disse warnings (BLOCKING_WARNING_CODES). Se
 * `StalePlanRunRecoveryService` for full begrunnelse.
 */

import express from "express";
import { z } from "zod";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { MasterActionService } from "../game/MasterActionService.js";
import type { MasterActor } from "../game/Game1MasterControlService.js";
import type { StalePlanRunRecoveryService } from "../game/recovery/StalePlanRunRecoveryService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-game1-master" });

export interface AgentGame1MasterRouterDeps {
  platformService: PlatformService;
  masterActionService: MasterActionService;
  /**
   * Optional — when provided, mounts `POST /api/agent/game1/master/recover-stale`
   * for master-driven cleanup of stale plan-runs and stuck scheduled-games.
   * If omitted, the endpoint returns 503 RECOVERY_NOT_CONFIGURED so callers
   * see a clear error rather than a 404.
   */
  staleRecoveryService?: StalePlanRunRecoveryService | null;
}

// ── input-validering ─────────────────────────────────────────────────────

/**
 * Common body-felter for alle master-actions. ADMIN kan overstyre `hallId`;
 * HALL_OPERATOR/AGENT bruker egen `user.hallId`.
 */
const StartBodySchema = z
  .object({
    hallId: z.string().min(1).optional(),
  })
  .strict();

const AdvanceBodySchema = z
  .object({
    hallId: z.string().min(1).optional(),
  })
  .strict();

const PauseBodySchema = z
  .object({
    hallId: z.string().min(1).optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

const ResumeBodySchema = z
  .object({
    hallId: z.string().min(1).optional(),
  })
  .strict();

const StopBodySchema = z
  .object({
    hallId: z.string().min(1).optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();

const JackpotSetupBodySchema = z
  .object({
    hallId: z.string().min(1).optional(),
    position: z.number().int().min(1),
    draw: z.number().int().min(1).max(90),
    prizesCents: z.record(z.string(), z.number().int().min(1)).refine(
      (obj) => Object.keys(obj).length > 0,
      { message: "prizesCents må ha minst én farge." },
    ),
  })
  .strict();

/**
 * 2026-05-09 (recover-stale): body-schema for cleanup-endpoint. Same
 * `hallId`-pattern as other master-actions (ADMIN can override, others
 * locked to own hall via `resolveHallScope`).
 */
const RecoverStaleBodySchema = z
  .object({
    hallId: z.string().min(1).optional(),
  })
  .strict();

// ── hall-scope-resolver ──────────────────────────────────────────────────

/**
 * Resolver hall-id fra body eller user. ADMIN kan overstyre; HALL_OPERATOR/
 * AGENT er låst til egen hallId. ADMIN uten egen hallId og uten body.hallId
 * returneres som BAD_REQUEST — write-actions må vite hvilken hall de
 * målbinder.
 */
function resolveHallScope(
  user: PublicAppUser,
  bodyHallId: string | undefined,
): string {
  if (user.role === "ADMIN") {
    if (bodyHallId && bodyHallId.trim().length > 0) {
      return bodyHallId.trim();
    }
    if (user.hallId) return user.hallId;
    throw new DomainError(
      "INVALID_INPUT",
      "ADMIN må sende `hallId` i body for master-actions.",
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
      bodyHallId &&
      bodyHallId.trim().length > 0 &&
      bodyHallId.trim() !== user.hallId
    ) {
      throw new DomainError(
        "FORBIDDEN",
        "Du kan kun utføre master-actions for din egen hall.",
      );
    }
    return user.hallId;
  }
  // SUPPORT/PLAYER er utestengt av assertAdminPermission, men defensiv:
  throw new DomainError(
    "FORBIDDEN",
    "Rollen din har ikke tilgang til Spill 1 master-actions.",
  );
}

/**
 * Bygg `MasterActor` fra autentisert user. Kaster FORBIDDEN hvis user.role
 * er PLAYER (master-actions er kun for ADMIN/HALL_OPERATOR/AGENT/SUPPORT,
 * og SUPPORT er utestengt av assertAdminPermission på GAME1_MASTER_WRITE).
 */
function toMasterActor(user: PublicAppUser): MasterActor {
  if (
    user.role !== "ADMIN" &&
    user.role !== "HALL_OPERATOR" &&
    user.role !== "AGENT" &&
    user.role !== "SUPPORT"
  ) {
    throw new DomainError(
      "FORBIDDEN",
      "Rollen din har ikke tilgang til master-actions.",
    );
  }
  return {
    userId: user.id,
    hallId: user.hallId ?? "",
    role: user.role,
  };
}

// ── router ───────────────────────────────────────────────────────────────

export function createAgentGame1MasterRouter(
  deps: AgentGame1MasterRouterDeps,
): express.Router {
  const { platformService, masterActionService } = deps;
  const staleRecoveryService = deps.staleRecoveryService ?? null;
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

  // ── POST /api/agent/game1/master/start ─────────────────────────────────

  router.post("/api/agent/game1/master/start", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME1_MASTER_WRITE");
      const parsed = StartBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(
          "INVALID_INPUT",
          `Ugyldig request body: ${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}`,
        );
      }
      const hallId = resolveHallScope(user, parsed.data.hallId);
      const actor = toMasterActor(user);

      const result = await masterActionService.start({ actor, hallId });
      apiSuccess(res, result);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game1/master/advance ───────────────────────────────

  router.post("/api/agent/game1/master/advance", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME1_MASTER_WRITE");
      const parsed = AdvanceBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(
          "INVALID_INPUT",
          `Ugyldig request body: ${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}`,
        );
      }
      const hallId = resolveHallScope(user, parsed.data.hallId);
      const actor = toMasterActor(user);

      const result = await masterActionService.advance({ actor, hallId });
      apiSuccess(res, result);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game1/master/pause ─────────────────────────────────

  router.post("/api/agent/game1/master/pause", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME1_MASTER_WRITE");
      const parsed = PauseBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(
          "INVALID_INPUT",
          `Ugyldig request body: ${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}`,
        );
      }
      const hallId = resolveHallScope(user, parsed.data.hallId);
      const actor = toMasterActor(user);

      const result = await masterActionService.pause({
        actor,
        hallId,
        reason: parsed.data.reason,
      });
      apiSuccess(res, result);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game1/master/resume ────────────────────────────────

  router.post("/api/agent/game1/master/resume", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME1_MASTER_WRITE");
      const parsed = ResumeBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(
          "INVALID_INPUT",
          `Ugyldig request body: ${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}`,
        );
      }
      const hallId = resolveHallScope(user, parsed.data.hallId);
      const actor = toMasterActor(user);

      const result = await masterActionService.resume({ actor, hallId });
      apiSuccess(res, result);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game1/master/stop ──────────────────────────────────

  router.post("/api/agent/game1/master/stop", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME1_MASTER_WRITE");
      const parsed = StopBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(
          "INVALID_INPUT",
          `Ugyldig request body: ${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}`,
        );
      }
      const hallId = resolveHallScope(user, parsed.data.hallId);
      const actor = toMasterActor(user);

      const result = await masterActionService.stop({
        actor,
        hallId,
        reason: parsed.data.reason,
      });
      apiSuccess(res, result);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game1/master/jackpot-setup ─────────────────────────

  router.post("/api/agent/game1/master/jackpot-setup", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME1_MASTER_WRITE");
      const parsed = JackpotSetupBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(
          "INVALID_INPUT",
          `Ugyldig request body: ${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}`,
        );
      }
      const hallId = resolveHallScope(user, parsed.data.hallId);
      const actor = toMasterActor(user);

      const result = await masterActionService.setJackpot({
        actor,
        hallId,
        position: parsed.data.position,
        draw: parsed.data.draw,
        prizesCents: parsed.data.prizesCents,
      });
      apiSuccess(res, result);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game1/master/recover-stale ─────────────────────────
  //
  // 2026-05-09: master-driven cleanup of STALE_PLAN_RUN/BRIDGE_FAILED
  // state. This bypasses MasterActionService.preValidate (which would
  // block on those exact warnings) and goes straight to the recovery
  // service. Idempotent — running it on a clean hall returns
  // `{ planRunsCleared: 0, scheduledGamesCleared: 0 }`.
  //
  // RBAC: same GAME1_MASTER_WRITE as other master-actions. Hall-scope
  // also identical: ADMIN can override hallId, HALL_OPERATOR/AGENT
  // locked to own hall. SUPPORT not allowed (excluded by permission).
  router.post("/api/agent/game1/master/recover-stale", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME1_MASTER_WRITE");
      const parsed = RecoverStaleBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(
          "INVALID_INPUT",
          `Ugyldig request body: ${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}`,
        );
      }
      const hallId = resolveHallScope(user, parsed.data.hallId);
      const actor = toMasterActor(user);

      if (!staleRecoveryService) {
        // Fail-loud rather than 404 so ops sees a clear cause when the
        // service isn't wired into a given environment.
        res.status(503).json({
          ok: false,
          error: {
            code: "RECOVERY_NOT_CONFIGURED",
            message:
              "Stale-plan-run-recovery er ikke konfigurert på denne backend-instansen.",
          },
        });
        return;
      }

      const result = await staleRecoveryService.recoverStaleForHall({
        actor,
        hallId,
      });

      apiSuccess(res, {
        ok: true,
        cleared: {
          planRuns: result.planRunsCleared,
          scheduledGames: result.scheduledGamesCleared,
        },
        details: {
          recoveredAt: result.recoveredAt,
          todayBusinessDate: result.todayBusinessDate,
          clearedPlanRuns: result.clearedPlanRuns,
          clearedScheduledGames: result.clearedScheduledGames,
        },
      });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // Logger init slik at vi ser router-konstruksjon i oppstartslog.
  logger.info(
    {
      routes: [
        "POST /api/agent/game1/master/start",
        "POST /api/agent/game1/master/advance",
        "POST /api/agent/game1/master/pause",
        "POST /api/agent/game1/master/resume",
        "POST /api/agent/game1/master/stop",
        "POST /api/agent/game1/master/jackpot-setup",
        "POST /api/agent/game1/master/recover-stale",
      ],
      staleRecoveryConfigured: staleRecoveryService !== null,
    },
    "[agent-game1-master] router initialized",
  );

  return router;
}
