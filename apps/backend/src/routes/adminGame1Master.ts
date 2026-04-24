/**
 * GAME1_SCHEDULE PR 3: admin-router for master-control-flow i Game 1.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.5 + §3.9.
 *
 * Endepunkter:
 *   POST /api/admin/game1/games/:gameId/start           (GAME1_MASTER_WRITE)
 *   POST /api/admin/game1/games/:gameId/exclude-hall    (GAME1_MASTER_WRITE)
 *   POST /api/admin/game1/games/:gameId/include-hall    (GAME1_MASTER_WRITE)
 *   POST /api/admin/game1/games/:gameId/pause           (GAME1_MASTER_WRITE)
 *   POST /api/admin/game1/games/:gameId/resume          (GAME1_MASTER_WRITE)
 *   POST /api/admin/game1/games/:gameId/stop            (GAME1_MASTER_WRITE)
 *   GET  /api/admin/game1/games/:gameId                 (GAME1_GAME_READ)
 *
 * Rolle-krav:
 *   - GAME1_MASTER_WRITE = ADMIN + HALL_OPERATOR + AGENT (SUPPORT utelatt).
 *   - Hall-scope: HALL_OPERATOR/AGENT må tilhøre `game.master_hall_id`
 *     (fetched før permission-check). ADMIN har globalt scope.
 *
 * Socket-event (ny):
 *   game1:master-action {
 *     gameId, action, status, auditId, actorUserId, at
 *   }
 *   Broadcastes globalt + til master-UI-subscribers. Haller som deltar i
 *   linken abonnerer via `group:<groupHallId>` room.
 */

import express from "express";
import type { Server as SocketServer } from "socket.io";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  Game1MasterControlService,
  MasterActor,
  MasterActionResult,
} from "../game/Game1MasterControlService.js";
import type { Game1DrawEngineService } from "../game/Game1DrawEngineService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-game1-master" });

export interface AdminGame1MasterRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  masterControlService: Game1MasterControlService;
  /**
   * Task 1.1: valgfri draw-engine for å inkludere engine-state (paused,
   * paused_at_phase, current_phase) i GET-responsen. Hvis ikke satt faller
   * responsen tilbake til kun scheduled_game-state (legacy-kontrakt).
   */
  drawEngine?: Game1DrawEngineService;
  io?: SocketServer;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function actorTypeFromRole(
  role: PublicAppUser["role"]
): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "USER" | "AGENT" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  if (role === "AGENT") return "AGENT";
  return "USER";
}

function buildActor(
  user: PublicAppUser,
  masterHallId: string | null
): MasterActor {
  if (user.role === "ADMIN") {
    return {
      userId: user.id,
      hallId: masterHallId ?? user.hallId ?? "ADMIN_CONSOLE",
      role: "ADMIN",
    };
  }
  if (user.role === "HALL_OPERATOR" || user.role === "AGENT") {
    if (!user.hallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Din bruker er ikke tildelt en hall — kontakt admin."
      );
    }
    return {
      userId: user.id,
      hallId: user.hallId,
      role: user.role,
    };
  }
  throw new DomainError(
    "FORBIDDEN",
    "Rollen din har ikke tilgang til master-actions."
  );
}

function broadcastAction(
  io: SocketServer | undefined,
  payload: {
    gameId: string;
    groupHallId: string | null;
    action: string;
    status: string;
    auditId: string;
    actorUserId: string;
  }
): void {
  if (!io) return;
  const eventPayload = { ...payload, at: Date.now() };
  io.emit("game1:master-action", eventPayload);
  if (payload.groupHallId) {
    io.to(`group:${payload.groupHallId}`).emit(
      "game1:master-action",
      eventPayload
    );
  }
}

export function createAdminGame1MasterRouter(
  deps: AdminGame1MasterRouterDeps
): express.Router {
  const { platformService, auditLogService, masterControlService, drawEngine, io } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  async function loadMasterHallId(gameId: string): Promise<{
    masterHallId: string;
    groupHallId: string;
  }> {
    const detail = await masterControlService.getGameDetail(gameId);
    return {
      masterHallId: detail.game.masterHallId,
      groupHallId: detail.game.groupHallId,
    };
  }

  function logForbiddenAudit(
    req: express.Request,
    user: PublicAppUser,
    gameId: string,
    action: string,
    err: Error
  ): void {
    auditLogService
      .record({
        actorId: user.id,
        actorType: actorTypeFromRole(user.role),
        action: `admin.game1.master.${action}.forbidden`,
        resource: "game1_scheduled_game",
        resourceId: gameId,
        details: { message: err.message, role: user.role, hallId: user.hallId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      })
      .catch((logErr) => {
        logger.warn({ err: logErr }, "forbidden-audit append failed");
      });
  }

  // ── POST /start ───────────────────────────────────────────────────────────

  router.post("/api/admin/game1/games/:gameId/start", async (req, res) => {
    let gameId = "";
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      const body = isRecordObject(req.body) ? req.body : {};
      const confirmExcludedHalls = Array.isArray(body.confirmExcludedHalls)
        ? body.confirmExcludedHalls.filter((v: unknown): v is string => typeof v === "string")
        : undefined;
      // Task 1.5: "agents not ready"-override. Klient kaller /start uten flag
      // først; dersom backend returnerer HALLS_NOT_READY med `unreadyHalls`,
      // viser frontend popup og re-kaller /start med samtlige orange hall-IDer
      // i `confirmUnreadyHalls`. Se Game1MasterControlService.startGame
      // for audit- og exclude-semantikk.
      const confirmUnreadyHalls = Array.isArray(body.confirmUnreadyHalls)
        ? body.confirmUnreadyHalls.filter((v: unknown): v is string => typeof v === "string")
        : undefined;
      // Task 1.5 (forward-compat mot HS #451): accept `confirmExcludeRedHalls`
      // for rød-auto-exclude-mønster. Mappes inn som excluded (samme som
      // confirmExcludedHalls). Hvis #451 lander kan service-laget bruke
      // `Game1HallReadyService.getHallStatusForGame` for farge-deteksjon.
      const confirmExcludeRedHalls = Array.isArray(body.confirmExcludeRedHalls)
        ? body.confirmExcludeRedHalls.filter((v: unknown): v is string => typeof v === "string")
        : undefined;

      const { masterHallId, groupHallId } = await loadMasterHallId(gameId);
      const masterActor = buildActor(actor, masterHallId);
      const startInput: Parameters<Game1MasterControlService["startGame"]>[0] = {
        gameId,
        actor: masterActor,
      };
      if (confirmExcludedHalls !== undefined || confirmExcludeRedHalls !== undefined) {
        startInput.confirmExcludedHalls = [
          ...(confirmExcludedHalls ?? []),
          ...(confirmExcludeRedHalls ?? []),
        ];
      }
      if (confirmUnreadyHalls !== undefined) {
        startInput.confirmUnreadyHalls = confirmUnreadyHalls;
      }
      const result = await masterControlService.startGame(startInput);

      broadcastAction(io, {
        gameId: result.gameId,
        groupHallId,
        action: "start",
        status: result.status,
        auditId: result.auditId,
        actorUserId: actor.id,
      });

      apiSuccess(res, {
        gameId: result.gameId,
        status: result.status,
        actualStartTime: result.actualStartTime,
        auditId: result.auditId,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === "FORBIDDEN" && gameId) {
        try {
          const actor = await requirePermission(req, "GAME1_MASTER_WRITE").catch(() => null);
          if (actor) logForbiddenAudit(req, actor, gameId, "start", error);
        } catch { /* soft */ }
      }
      apiFailure(res, error);
    }
  });

  // ── POST /exclude-hall ────────────────────────────────────────────────────

  router.post("/api/admin/game1/games/:gameId/exclude-hall", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const hallId = mustBeNonEmptyString(req.body.hallId, "hallId");
      const reason = mustBeNonEmptyString(req.body.reason, "reason");

      const { masterHallId, groupHallId } = await loadMasterHallId(gameId);
      const masterActor = buildActor(actor, masterHallId);
      const result = await masterControlService.excludeHall({
        gameId,
        hallId,
        reason,
        actor: masterActor,
      });

      broadcastAction(io, {
        gameId: result.gameId,
        groupHallId,
        action: "exclude_hall",
        status: result.status,
        auditId: result.auditId,
        actorUserId: actor.id,
      });

      apiSuccess(res, {
        gameId: result.gameId,
        hallId,
        status: result.status,
        auditId: result.auditId,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /include-hall ────────────────────────────────────────────────────

  router.post("/api/admin/game1/games/:gameId/include-hall", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const hallId = mustBeNonEmptyString(req.body.hallId, "hallId");

      const { masterHallId, groupHallId } = await loadMasterHallId(gameId);
      const masterActor = buildActor(actor, masterHallId);
      const result = await masterControlService.includeHall({
        gameId,
        hallId,
        actor: masterActor,
      });

      broadcastAction(io, {
        gameId: result.gameId,
        groupHallId,
        action: "include_hall",
        status: result.status,
        auditId: result.auditId,
        actorUserId: actor.id,
      });

      apiSuccess(res, {
        gameId: result.gameId,
        hallId,
        status: result.status,
        auditId: result.auditId,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /pause ───────────────────────────────────────────────────────────

  router.post("/api/admin/game1/games/:gameId/pause", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      const body = isRecordObject(req.body) ? req.body : {};
      const reasonRaw = typeof body.reason === "string" ? body.reason.trim() : "";

      const { masterHallId, groupHallId } = await loadMasterHallId(gameId);
      const masterActor = buildActor(actor, masterHallId);
      const pauseInput: Parameters<Game1MasterControlService["pauseGame"]>[0] = {
        gameId,
        actor: masterActor,
      };
      if (reasonRaw) {
        pauseInput.reason = reasonRaw;
      }
      const result = await masterControlService.pauseGame(pauseInput);

      broadcastAction(io, {
        gameId: result.gameId,
        groupHallId,
        action: "pause",
        status: result.status,
        auditId: result.auditId,
        actorUserId: actor.id,
      });

      apiSuccess(res, {
        gameId: result.gameId,
        status: result.status,
        auditId: result.auditId,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /resume ──────────────────────────────────────────────────────────

  router.post("/api/admin/game1/games/:gameId/resume", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");

      const { masterHallId, groupHallId } = await loadMasterHallId(gameId);
      const masterActor = buildActor(actor, masterHallId);
      const result = await masterControlService.resumeGame({
        gameId,
        actor: masterActor,
      });

      broadcastAction(io, {
        gameId: result.gameId,
        groupHallId,
        action: "resume",
        status: result.status,
        auditId: result.auditId,
        actorUserId: actor.id,
      });

      apiSuccess(res, {
        gameId: result.gameId,
        status: result.status,
        auditId: result.auditId,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /stop ────────────────────────────────────────────────────────────

  router.post("/api/admin/game1/games/:gameId/stop", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const reason = mustBeNonEmptyString(req.body.reason, "reason");

      const { masterHallId, groupHallId } = await loadMasterHallId(gameId);
      const masterActor = buildActor(actor, masterHallId);
      const result: MasterActionResult = await masterControlService.stopGame({
        gameId,
        reason,
        actor: masterActor,
      });

      broadcastAction(io, {
        gameId: result.gameId,
        groupHallId,
        action: "stop",
        status: result.status,
        auditId: result.auditId,
        actorUserId: actor.id,
      });

      apiSuccess(res, {
        gameId: result.gameId,
        status: result.status,
        actualEndTime: result.actualEndTime,
        auditId: result.auditId,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /:gameId ──────────────────────────────────────────────────────────

  router.get("/api/admin/game1/games/:gameId", async (req, res) => {
    try {
      await requirePermission(req, "GAME1_GAME_READ");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      const detail = await masterControlService.getGameDetail(gameId);

      const hallsWithName = await Promise.all(
        detail.halls.map(async (h) => {
          let hallName = h.hallId;
          try {
            const hall = await platformService.getHall(h.hallId);
            hallName = hall.name;
          } catch {
            // soft-fail
          }
          return { ...h, hallName };
        })
      );

      const allReady =
        hallsWithName.length > 0 &&
        hallsWithName.filter((h) => !h.excludedFromGame).length > 0 &&
        hallsWithName
          .filter((h) => !h.excludedFromGame)
          .every((h) => h.isReady);

      // Task 1.1: inkluder engine-state (paused, paused_at_phase, phase)
      // når draw-engine er wired inn. Admin-UI bruker feltene for å vise
      // Resume-knapp + banner ved auto-pause uten å trenge ekstra REST-
      // kall. Fail-soft: hvis engine.getState kaster (f.eks. engine ikke
      // startet ennå), faller vi tilbake til engineState=null.
      let engineState:
        | null
        | {
            isPaused: boolean;
            pausedAtPhase: number | null;
            currentPhase: number;
            drawsCompleted: number;
            isFinished: boolean;
          } = null;
      if (drawEngine) {
        try {
          const view = await drawEngine.getState(gameId);
          if (view) {
            engineState = {
              isPaused: view.isPaused,
              pausedAtPhase: view.pausedAtPhase,
              currentPhase: view.currentPhase,
              drawsCompleted: view.drawsCompleted,
              isFinished: view.isFinished,
            };
          }
        } catch (err) {
          logger.warn(
            { err, gameId },
            "[Task 1.1] drawEngine.getState feilet — returnerer engineState=null"
          );
        }
      }

      apiSuccess(res, {
        game: detail.game,
        halls: hallsWithName,
        allReady,
        auditRecent: detail.auditRecent,
        engineState,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
