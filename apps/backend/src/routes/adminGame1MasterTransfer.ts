/**
 * Task 1.6: admin-router for runtime master-hall-overføring.
 *
 * Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md Appendix B.3.
 * Service: Game1TransferHallService.
 *
 * Endepunkter:
 *   POST /api/admin/game1/games/:gameId/transfer-master/request
 *     Body: { toHallId }
 *     Auth: GAME1_MASTER_WRITE + bruker-hallId == game.master_hall_id (fra).
 *
 *   POST /api/admin/game1/master-transfers/:requestId/approve
 *     Body: {}
 *     Auth: GAME1_MASTER_WRITE + bruker-hallId == request.to_hall_id.
 *
 *   POST /api/admin/game1/master-transfers/:requestId/reject
 *     Body: { reason? }
 *     Auth: GAME1_MASTER_WRITE + bruker-hallId == request.to_hall_id.
 *
 *   GET  /api/admin/game1/games/:gameId/transfer-request
 *     Auth: GAME1_GAME_READ. Returnerer aktiv pending request eller `null`.
 *
 * Socket-broadcast ansvar: router ringer en broadcast-hook som er injected av
 * index.ts. Hook implementeres i adminGame1Namespace.ts + default-namespace
 * (hall-rom). Hvis hook mangler (tester uten socket-miljø) er det no-op.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type {
  Game1TransferHallService,
  TransferRequest,
} from "../game/Game1TransferHallService.js";
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

const logger = rootLogger.child({ module: "admin-game1-master-transfer" });

export interface TransferBroadcastHooks {
  onRequestCreated?: (request: TransferRequest) => void;
  onApproved?: (payload: {
    request: TransferRequest;
    previousMasterHallId: string;
    newMasterHallId: string;
  }) => void;
  onRejected?: (request: TransferRequest) => void;
}

export interface AdminGame1MasterTransferRouterDeps {
  platformService: PlatformService;
  transferService: Game1TransferHallService;
  broadcastHooks?: TransferBroadcastHooks;
}

export function createAdminGame1MasterTransferRouter(
  deps: AdminGame1MasterTransferRouterDeps
): express.Router {
  const { platformService, transferService, broadcastHooks } = deps;
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

  /** Resolve effektiv hall-id for actor-sjekk. ADMIN har globalt scope. */
  function actorHallId(user: PublicAppUser): string {
    if (user.role === "ADMIN") {
      return user.hallId ?? "ADMIN_CONSOLE";
    }
    if (!user.hallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Din bruker er ikke tildelt en hall — kontakt admin."
      );
    }
    return user.hallId;
  }

  // ── POST /games/:gameId/transfer-master/request ──────────────────────────

  router.post(
    "/api/admin/game1/games/:gameId/transfer-master/request",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
        const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const toHallId = mustBeNonEmptyString(req.body.toHallId, "toHallId");

        // fromHallId = actor sin hall (eller ADMIN kan initiere fra master-hall
        // som på den tid fetched). ADMIN trenger ikke tilhøre master-hallen,
        // men service-laget krever at fromHallId == game.master_hall_id.
        // For ADMIN: vi kan ikke vite master_hall_id uten en query — vi lar
        // service-laget validere. ADMIN sender dermed fra sitt assigned hall
        // (eller vi bruker en fallback). I praksis kjører ADMIN-flow sjelden.
        const fromHallId = actorHallId(actor);

        const request = await transferService.requestTransfer({
          gameId,
          fromHallId,
          toHallId,
          initiatedByUserId: actor.id,
        });

        broadcastHooks?.onRequestCreated?.(request);

        apiSuccess(res, {
          request,
        });
      } catch (error) {
        logger.debug({ err: error }, "transfer-request failed");
        apiFailure(res, error);
      }
    }
  );

  // ── POST /master-transfers/:requestId/approve ────────────────────────────

  router.post(
    "/api/admin/game1/master-transfers/:requestId/approve",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
        const requestId = mustBeNonEmptyString(
          req.params.requestId,
          "requestId"
        );
        const respondedByHallId = actorHallId(actor);

        const result = await transferService.approveTransfer({
          requestId,
          respondedByUserId: actor.id,
          respondedByHallId,
        });

        broadcastHooks?.onApproved?.(result);

        apiSuccess(res, {
          request: result.request,
          previousMasterHallId: result.previousMasterHallId,
          newMasterHallId: result.newMasterHallId,
        });
      } catch (error) {
        logger.debug({ err: error }, "transfer-approve failed");
        apiFailure(res, error);
      }
    }
  );

  // ── POST /master-transfers/:requestId/reject ─────────────────────────────

  router.post(
    "/api/admin/game1/master-transfers/:requestId/reject",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
        const requestId = mustBeNonEmptyString(
          req.params.requestId,
          "requestId"
        );
        const respondedByHallId = actorHallId(actor);
        const body = isRecordObject(req.body) ? req.body : {};
        const reason =
          typeof body.reason === "string" && body.reason.trim()
            ? body.reason.trim()
            : undefined;

        const request = await transferService.rejectTransfer({
          requestId,
          respondedByUserId: actor.id,
          respondedByHallId,
          ...(reason !== undefined ? { reason } : {}),
        });

        broadcastHooks?.onRejected?.(request);

        apiSuccess(res, { request });
      } catch (error) {
        logger.debug({ err: error }, "transfer-reject failed");
        apiFailure(res, error);
      }
    }
  );

  // ── GET /games/:gameId/transfer-request (aktiv pending) ──────────────────

  router.get(
    "/api/admin/game1/games/:gameId/transfer-request",
    async (req, res) => {
      try {
        await requirePermission(req, "GAME1_GAME_READ");
        const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
        const request = await transferService.getActiveRequestForGame(gameId);
        apiSuccess(res, { request });
      } catch (error) {
        apiFailure(res, error);
      }
    }
  );

  return router;
}
