/**
 * LOW-1: GET /api/admin/games/:gameId/replay
 *
 * Eksponerer rekonstruert event-stream for et Game 1 scheduled_game.
 * Brukes av admin-konsoll for "spillet steg-for-steg"-visning og av
 * compliance/auditor for å bevise at spiller X tapte fordi pattern Y
 * ikke matchet før kule Z.
 *
 * RBAC: krever BÅDE GAME1_GAME_READ OG PLAYER_KYC_READ.
 *   - GAME1_GAME_READ filtrerer ut roller som ikke kan se spill-state
 *     i admin-UI (PLAYER, ekstern).
 *   - PLAYER_KYC_READ er kravet for å se redacted player-info som
 *     lekkes via tickets_purchased / phase_won (selv etter masking
 *     beholder vi userId, som er PII per pengespillforskriften).
 *
 * Resultatet er PII-redacted i Game1ReplayService før det forlater
 * service-laget. Route-laget gjør INGEN egen redaction — sjekk
 * `redactEmail` / `redactDisplayName` / `redactWalletId` der.
 *
 * Audit-side-effekt: hver replay-fetch logges til AuditLogService
 * så vi kan svare på "hvem så replayet for dette spillet?".
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { Game1ReplayService } from "../game/Game1ReplayService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-game-replay" });

export interface AdminGameReplayRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  replayService: Game1ReplayService;
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

export function createAdminGameReplayRouter(
  deps: AdminGameReplayRouterDeps
): express.Router {
  const { platformService, auditLogService, replayService } = deps;
  const router = express.Router();

  async function loadUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  function assertAllPermissions(
    user: PublicAppUser,
    permissions: AdminPermission[]
  ): void {
    for (const p of permissions) {
      assertAdminPermission(user.role, p);
    }
  }

  router.get("/api/admin/games/:gameId/replay", async (req, res) => {
    let gameId = "";
    let actor: PublicAppUser | null = null;
    try {
      // Fang gameId og bruker FØR permission-check så vi har begge
      // tilgjengelig for forbidden-audit hvis assertAllPermissions kaster.
      gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      actor = await loadUser(req);
      assertAllPermissions(actor, ["GAME1_GAME_READ", "PLAYER_KYC_READ"]);

      const replay = await replayService.getReplay(gameId);

      // Audit-trail: replay-tilgang logges som regulatorisk read-event.
      // Fire-and-forget — feiler ikke bruker hvis audit feiler.
      auditLogService
        .record({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.game.replay.read",
          resource: "game1_scheduled_game",
          resourceId: gameId,
          details: {
            eventCount: replay.meta.eventCount,
            status: replay.meta.status,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        })
        .catch((err) => {
          logger.warn({ err }, "replay audit append failed");
        });

      apiSuccess(res, replay);
    } catch (error) {
      // Kjente feil-typer:
      //   - GAME_NOT_FOUND fra service-laget → 404.
      //   - FORBIDDEN fra assertAdminPermission → 403.
      //   - UNAUTHORIZED fra getUserFromAccessToken → 401.
      if (error instanceof Error && (error as Error & { code?: string }).code === "GAME_NOT_FOUND") {
        const domainErr = new DomainError(
          "GAME_NOT_FOUND",
          "Spillet ble ikke funnet."
        );
        apiFailure(res, domainErr);
        return;
      }
      // Ved FORBIDDEN: logg forsøket for compliance-audit.
      if (error instanceof DomainError && error.code === "FORBIDDEN" && gameId && actor) {
        auditLogService
          .record({
            actorId: actor.id,
            actorType: actorTypeFromRole(actor.role),
            action: "admin.game.replay.forbidden",
            resource: "game1_scheduled_game",
            resourceId: gameId,
            details: { message: error.message, role: actor.role },
            ipAddress: clientIp(req),
            userAgent: userAgent(req),
          })
          .catch((logErr) => {
            logger.warn({ err: logErr }, "forbidden-audit append failed");
          });
      }
      apiFailure(res, error);
    }
  });

  return router;
}
