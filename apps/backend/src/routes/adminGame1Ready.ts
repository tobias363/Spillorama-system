/**
 * GAME1_SCHEDULE PR 2 + TASK HS: admin-router for ready-flow + scan-flow per
 * hall i Game 1.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.4
 *       + Task HS (låst 2026-04-24).
 *
 * Endepunkter:
 *   POST /api/admin/game1/halls/:hallId/ready
 *     Body: { gameId, digitalTicketsSold? }
 *     Permission: GAME1_HALL_READY_WRITE (ADMIN + HALL_OPERATOR + AGENT)
 *     Hall-scope: HALL_OPERATOR/AGENT må være knyttet til hallId via
 *     assertUserHallScope. AuditLog: hall.sales.closed.
 *     Socket: game1:ready-status-update + game1:hall-status-update.
 *
 *   POST /api/admin/game1/halls/:hallId/unready
 *     Body: { gameId }
 *     Permission: GAME1_HALL_READY_WRITE
 *     AuditLog: hall.sales.reopened.
 *
 *   GET /api/admin/game1/games/:gameId/ready-status
 *     Permission: GAME1_GAME_READ
 *     Returnerer: { gameId, status, halls: [...], allReady }
 *
 *   TASK HS (nye):
 *   POST /api/admin/game1/games/:gameId/halls/:hallId/scan-start
 *     Body: { ticketId }
 *     Permission: GAME1_HALL_READY_WRITE
 *     AuditLog: hall.scan.start.
 *     Socket: game1:hall-status-update.
 *
 *   POST /api/admin/game1/games/:gameId/halls/:hallId/scan-final
 *     Body: { ticketId }
 *     Permission: GAME1_HALL_READY_WRITE
 *     AuditLog: hall.scan.final.
 *     Socket: game1:hall-status-update.
 *
 *   GET /api/admin/game1/games/:gameId/hall-status
 *     Permission: GAME1_GAME_READ
 *     Returnerer: { gameId, halls: [{hallId, color, playerCount, ...}] }
 *
 * Rolle-krav:
 *   - GAME1_HALL_READY_WRITE: ADMIN + HALL_OPERATOR + AGENT (bingovert).
 *   - GAME1_GAME_READ: ADMIN + HALL_OPERATOR + SUPPORT + AGENT.
 *   Hall-scope håndheves per-endepunkt for HALL_OPERATOR/AGENT — de kan
 *   kun ready/unready/scan *egen* hall.
 *
 * Socket-events:
 *   game1:ready-status-update { gameId, hallId, hallName, isReady, ... }
 *   game1:hall-status-update  { gameId, hallId, hallName, color, playerCount,
 *                               startScanDone, finalScanDone, readyConfirmed,
 *                               soldCount, startTicketId, finalScanTicketId,
 *                               excludedFromGame, at }
 */

import express from "express";
import type { Server as SocketServer } from "socket.io";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { Game1HallReadyService } from "../game/Game1HallReadyService.js";
import {
  assertAdminPermission,
  assertUserHallScope,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";

/**
 * Hall-scope-guard for ready-flow. HALL_OPERATOR deler
 * `assertUserHallScope`-regelen. AGENT-er har rolle-egen hall-scope:
 * `user.hallId` må eksistere og matche targetHallId. Ekstrahert her
 * fordi AdminAccessPolicy.assertUserHallScope bevisst er HALL_OPERATOR-
 * kun (BIN-591-kontrakt); ready-flow er første konsument som involverer
 * AGENT, og vi vil ikke utvide BIN-591-helperen uten koordinert BIN-ID.
 */
function assertHallScopeForReadyFlow(
  user: { role: PublicAppUser["role"]; hallId: string | null },
  targetHallId: string
): void {
  if (user.role === "ADMIN" || user.role === "SUPPORT") {
    return;
  }
  if (user.role === "HALL_OPERATOR") {
    assertUserHallScope(user, targetHallId);
    return;
  }
  if (user.role === "AGENT") {
    if (!user.hallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Din bruker er ikke tildelt en hall — kontakt admin."
      );
    }
    if (user.hallId !== targetHallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Du har ikke tilgang til denne hallen."
      );
    }
    return;
  }
  throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne hallen.");
}
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-game1-ready" });

export interface AdminGame1ReadyRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  hallReadyService: Game1HallReadyService;
  /**
   * Socket.io server for live ready-status-broadcast. Valgfritt fordi
   * testene kan mount router uten socket-lag; i prod er det alltid satt.
   */
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

export function createAdminGame1ReadyRouter(
  deps: AdminGame1ReadyRouterDeps
): express.Router {
  const { platformService, auditLogService, hallReadyService, io } = deps;
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

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn(
        { err, action: event.action },
        "[GAME1_SCHEDULE PR2] audit append failed"
      );
    });
  }

  /**
   * Bygg broadcast-payload for en enkelt hall-status-endring. allReady
   * beregnes én gang per broadcast slik at klienter slipper ekstra round-trip.
   */
  async function buildAndBroadcastReadyUpdate(
    gameId: string,
    hallId: string
  ): Promise<{
    hallName: string;
    allReady: boolean;
  }> {
    let hallName = hallId;
    try {
      const hall = await platformService.getHall(hallId);
      hallName = hall.name;
    } catch {
      // Soft-fail — klient viser hallId hvis navn ikke finnes.
    }
    const statuses = await hallReadyService.getReadyStatusForGame(gameId);
    const thisHall = statuses.find((s) => s.hallId === hallId);
    const allReady = await hallReadyService.allParticipatingHallsReady(gameId);
    const event = {
      gameId,
      hallId,
      hallName,
      isReady: thisHall?.isReady ?? false,
      digitalSold: thisHall?.digitalTicketsSold ?? 0,
      physicalSold: thisHall?.physicalTicketsSold ?? 0,
      excludedFromGame: thisHall?.excludedFromGame ?? false,
      allReady,
      at: Date.now(),
    };
    if (io) {
      // Global broadcast — admin master-UI-subscribers + hall-display.
      io.emit("game1:ready-status-update", event);
      io.to(`hall:${hallId}:display`).emit("game1:ready-status-update", event);
    }
    // TASK HS: også broadcast beriket farge-event. Hentes separat for å
    // inkludere scan-data. Broadcastet til `group:<groupId>`-rom slik at
    // alle abonnenter i gruppen får oppdatering.
    await broadcastHallStatusUpdate(gameId, hallId, hallName);
    return { hallName, allReady };
  }

  /**
   * TASK HS: broadcast `game1:hall-status-update` — beriket per-hall status
   * med farge-kode, spiller-count og scan-data. Separat fra ready-update for
   * å ikke sprenge eksisterende kontrakt.
   *
   * Broadcastet til:
   *   - Default namespace, rom `group:<groupId>` (hall-displays abonnerer der).
   *   - `/admin-game1`-namespace, rom `game1:<gameId>` (master-konsoll
   *     abonnerer der via AdminGame1Socket).
   */
  async function broadcastHallStatusUpdate(
    gameId: string,
    hallId: string,
    hallNameHint?: string
  ): Promise<void> {
    if (!io) return;
    try {
      const [hallStatuses, groupId] = await Promise.all([
        hallReadyService.getHallStatusForGame(gameId),
        hallReadyService.getGameGroupId(gameId),
      ]);
      const hallStatus = hallStatuses.find((s) => s.hallId === hallId);
      if (!hallStatus) return;
      let hallName = hallNameHint ?? hallId;
      if (!hallNameHint) {
        try {
          const hall = await platformService.getHall(hallId);
          hallName = hall.name;
        } catch {
          // soft-fail
        }
      }
      const payload = {
        gameId,
        hallId,
        hallName,
        color: hallStatus.color,
        playerCount: hallStatus.playerCount,
        startScanDone: hallStatus.startScanDone,
        finalScanDone: hallStatus.finalScanDone,
        readyConfirmed: hallStatus.readyConfirmed,
        soldCount: hallStatus.soldCount,
        startTicketId: hallStatus.startTicketId,
        finalScanTicketId: hallStatus.finalScanTicketId,
        excludedFromGame: hallStatus.excludedFromGame,
        at: Date.now(),
      };
      // Default namespace — hall-displays + admin pollers.
      io.to(`group:${groupId}`).emit("game1:hall-status-update", payload);
      // Admin-game1 namespace — master-console real-time subscription.
      try {
        io.of("/admin-game1")
          .to(`game1:${gameId}`)
          .emit("game1:hall-status-update", payload);
      } catch {
        // namespace kan mangle i minimal-test-setup; ignorer
      }
    } catch (err) {
      logger.warn(
        { err, gameId, hallId },
        "[TASK HS] hall-status-update broadcast feilet — route-respons er allerede sendt"
      );
    }
  }

  // ── POST /api/admin/game1/halls/:hallId/ready ────────────────────────────

  router.post("/api/admin/game1/halls/:hallId/ready", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_HALL_READY_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      // Hall-scope: HALL_OPERATOR og AGENT må være bundet til denne hallen.
      assertHallScopeForReadyFlow(actor, hallId);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const gameId = mustBeNonEmptyString(req.body.gameId, "gameId");
      const digitalTicketsSold =
        typeof req.body.digitalTicketsSold === "number" &&
        Number.isFinite(req.body.digitalTicketsSold) &&
        req.body.digitalTicketsSold >= 0
          ? Math.floor(req.body.digitalTicketsSold)
          : undefined;

      const markReadyInput: Parameters<Game1HallReadyService["markReady"]>[0] = {
        gameId,
        hallId,
        userId: actor.id,
      };
      if (digitalTicketsSold !== undefined) {
        markReadyInput.digitalTicketsSold = digitalTicketsSold;
      }
      const status = await hallReadyService.markReady(markReadyInput);

      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "hall.sales.closed",
        resource: "game1_scheduled_game",
        resourceId: gameId,
        details: {
          hallId,
          digitalSold: status.digitalTicketsSold,
          physicalSold: status.physicalTicketsSold,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      const { hallName, allReady } = await buildAndBroadcastReadyUpdate(
        gameId,
        hallId
      );

      apiSuccess(res, {
        gameId,
        hallId,
        hallName,
        isReady: status.isReady,
        readyAt: status.readyAt,
        readyByUserId: status.readyByUserId,
        digitalSold: status.digitalTicketsSold,
        physicalSold: status.physicalTicketsSold,
        excludedFromGame: status.excludedFromGame,
        allReady,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/admin/game1/halls/:hallId/unready ──────────────────────────

  router.post("/api/admin/game1/halls/:hallId/unready", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_HALL_READY_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertHallScopeForReadyFlow(actor, hallId);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const gameId = mustBeNonEmptyString(req.body.gameId, "gameId");

      const status = await hallReadyService.unmarkReady({
        gameId,
        hallId,
        userId: actor.id,
      });

      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "hall.sales.reopened",
        resource: "game1_scheduled_game",
        resourceId: gameId,
        details: {
          hallId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      const { hallName, allReady } = await buildAndBroadcastReadyUpdate(
        gameId,
        hallId
      );

      apiSuccess(res, {
        gameId,
        hallId,
        hallName,
        isReady: status.isReady,
        readyAt: status.readyAt,
        readyByUserId: status.readyByUserId,
        digitalSold: status.digitalTicketsSold,
        physicalSold: status.physicalTicketsSold,
        excludedFromGame: status.excludedFromGame,
        allReady,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/admin/game1/games/:gameId/ready-status ──────────────────────

  router.get("/api/admin/game1/games/:gameId/ready-status", async (req, res) => {
    try {
      await requirePermission(req, "GAME1_GAME_READ");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      const statuses = await hallReadyService.getReadyStatusForGame(gameId);
      const allReady = await hallReadyService.allParticipatingHallsReady(gameId);
      // Berik med hall-name for hver rad (soft-fail hvis ukjent).
      const halls = await Promise.all(
        statuses.map(async (s) => {
          let hallName = s.hallId;
          try {
            const hall = await platformService.getHall(s.hallId);
            hallName = hall.name;
          } catch {
            // soft-fail
          }
          return {
            hallId: s.hallId,
            hallName,
            isReady: s.isReady,
            readyAt: s.readyAt,
            readyByUserId: s.readyByUserId,
            digitalSold: s.digitalTicketsSold,
            physicalSold: s.physicalTicketsSold,
            excludedFromGame: s.excludedFromGame,
            excludedReason: s.excludedReason,
          };
        })
      );
      apiSuccess(res, {
        gameId,
        halls,
        allReady,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── TASK HS: POST /api/admin/game1/games/:gameId/halls/:hallId/scan-start ─

  router.post(
    "/api/admin/game1/games/:gameId/halls/:hallId/scan-start",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "GAME1_HALL_READY_WRITE");
        const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
        const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
        assertHallScopeForReadyFlow(actor, hallId);
        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const ticketId = mustBeNonEmptyString(req.body.ticketId, "ticketId");

        const status = await hallReadyService.recordStartScan({
          gameId,
          hallId,
          ticketId,
        });

        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "hall.scan.start",
          resource: "game1_scheduled_game",
          resourceId: gameId,
          details: { hallId, ticketId },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });

        await broadcastHallStatusUpdate(gameId, hallId);

        apiSuccess(res, {
          gameId,
          hallId,
          startTicketId: status.startTicketId,
          startScannedAt: status.startScannedAt,
          finalScanTicketId: status.finalScanTicketId,
          finalScannedAt: status.finalScannedAt,
        });
      } catch (error) {
        apiFailure(res, error);
      }
    }
  );

  // ── TASK HS: POST /api/admin/game1/games/:gameId/halls/:hallId/scan-final ─

  router.post(
    "/api/admin/game1/games/:gameId/halls/:hallId/scan-final",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "GAME1_HALL_READY_WRITE");
        const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
        const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
        assertHallScopeForReadyFlow(actor, hallId);
        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const ticketId = mustBeNonEmptyString(req.body.ticketId, "ticketId");

        const status = await hallReadyService.recordFinalScan({
          gameId,
          hallId,
          ticketId,
        });

        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "hall.scan.final",
          resource: "game1_scheduled_game",
          resourceId: gameId,
          details: {
            hallId,
            ticketId,
            startTicketId: status.startTicketId,
            physicalTicketsSold: status.physicalTicketsSold,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });

        await broadcastHallStatusUpdate(gameId, hallId);

        apiSuccess(res, {
          gameId,
          hallId,
          startTicketId: status.startTicketId,
          finalScanTicketId: status.finalScanTicketId,
          finalScannedAt: status.finalScannedAt,
          physicalTicketsSold: status.physicalTicketsSold,
        });
      } catch (error) {
        apiFailure(res, error);
      }
    }
  );

  // ── REQ-007: POST /api/admin/game1/games/:gameId/halls/:hallId/force-unready
  //
  // Admin-only: tving en hall fra is_ready=true → false uten hall-scope-guard.
  // Brukes når en bingovert har disconnected uten å unmark-e ready og admin
  // må overstyre i UI. Krever påkrevd `reason` som persisteres i audit-spor.
  // Idempotent — returnerer { reverted: false } hvis raden allerede er false.

  router.post(
    "/api/admin/game1/games/:gameId/halls/:hallId/force-unready",
    async (req, res) => {
      try {
        // Force-revert er ADMIN-only — fail-closed for HALL_OPERATOR/AGENT.
        // Vi krever GAME1_HALL_READY_WRITE pluss eksplisitt rolle-sjekk så
        // det er klart at dette er en escalert path.
        const actor = await requirePermission(req, "GAME1_HALL_READY_WRITE");
        if (actor.role !== "ADMIN") {
          throw new DomainError(
            "FORBIDDEN",
            "Kun ADMIN kan tvinge revert av ready-status."
          );
        }
        const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
        const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const reason = mustBeNonEmptyString(req.body.reason, "reason");

        const result = await hallReadyService.forceUnmarkReady({
          gameId,
          hallId,
          actorUserId: actor.id,
          reason,
        });

        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "hall.ready.force_revert",
          resource: "game1_scheduled_game",
          resourceId: gameId,
          details: {
            hallId,
            reason,
            reverted: result !== null,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });

        // Broadcast oppdatert status hvis raden faktisk ble flippet.
        if (result !== null) {
          await buildAndBroadcastReadyUpdate(gameId, hallId);
        }

        apiSuccess(res, {
          gameId,
          hallId,
          reverted: result !== null,
          isReady: result?.isReady ?? false,
        });
      } catch (error) {
        apiFailure(res, error);
      }
    }
  );

  // ── TASK HS: GET /api/admin/game1/games/:gameId/hall-status ──────────────

  router.get(
    "/api/admin/game1/games/:gameId/hall-status",
    async (req, res) => {
      try {
        await requirePermission(req, "GAME1_GAME_READ");
        const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
        const statuses = await hallReadyService.getHallStatusForGame(gameId);
        const halls = await Promise.all(
          statuses.map(async (s) => {
            let hallName = s.hallId;
            try {
              const hall = await platformService.getHall(s.hallId);
              hallName = hall.name;
            } catch {
              // soft-fail
            }
            return {
              hallId: s.hallId,
              hallName,
              color: s.color,
              playerCount: s.playerCount,
              startScanDone: s.startScanDone,
              finalScanDone: s.finalScanDone,
              readyConfirmed: s.readyConfirmed,
              soldCount: s.soldCount,
              startTicketId: s.startTicketId,
              finalScanTicketId: s.finalScanTicketId,
              digitalTicketsSold: s.digitalTicketsSold,
              physicalTicketsSold: s.physicalTicketsSold,
              excludedFromGame: s.excludedFromGame,
              excludedReason: s.excludedReason,
            };
          })
        );
        apiSuccess(res, { gameId, halls });
      } catch (error) {
        apiFailure(res, error);
      }
    }
  );

  return router;
}
