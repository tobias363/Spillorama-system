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
      ],
    },
    "[agent-game1-master] router initialized",
  );

  return router;
}
