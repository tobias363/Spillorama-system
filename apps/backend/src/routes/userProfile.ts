/**
 * Profile Settings API (BIN-720).
 *
 * Selv-service-endepunkter for spillere (wireframe PDF 8 + PDF 9):
 *
 *   GET  /api/user/profile/settings
 *   POST /api/user/profile/loss-limits      { daily?, monthly? }
 *   POST /api/user/profile/self-exclude     { duration: '1d'|'7d'|'30d'|'1y'|'permanent' }
 *   POST /api/user/profile/language         { language: 'nb-NO'|'en-US' }
 *   POST /api/user/profile/pause            { durationMinutes: number }
 *
 * Forretningslogikk ligger i `ProfileSettingsService`. Ruteren er en
 * tynn lag: auth + input-validering + apiSuccess/apiFailure. Service'n
 * håndterer 48h-queue, audit-log og ComplianceManager-integrasjon.
 */

import express from "express";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { ProfileSettingsService, SelfExcludeDuration, SupportedLanguage } from "../compliance/ProfileSettingsService.js";
import type { AuditActorType } from "../compliance/AuditLogService.js";
import { DomainError } from "../game/BingoEngine.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  parseOptionalNonNegativeNumber,
  parseOptionalPositiveInteger,
} from "../util/httpHelpers.js";

export interface UserProfileRouterDeps {
  platformService: PlatformService;
  profileSettingsService: ProfileSettingsService;
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

function actorTypeFromUser(user: PublicAppUser): AuditActorType {
  return user.role === "PLAYER" ? "PLAYER" : "USER";
}

export function createUserProfileRouter(deps: UserProfileRouterDeps): express.Router {
  const { platformService, profileSettingsService } = deps;
  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  router.get("/api/user/profile/settings", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const settings = await profileSettingsService.getSettings(user.id);
      apiSuccess(res, settings);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/user/profile/loss-limits", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const daily = parseOptionalNonNegativeNumber(req.body?.daily, "daily");
      const monthly = parseOptionalNonNegativeNumber(req.body?.monthly, "monthly");
      if (daily === undefined && monthly === undefined) {
        throw new DomainError("INVALID_INPUT", "daily eller monthly må oppgis.");
      }
      const view = await profileSettingsService.updateLossLimits({
        userId: user.id,
        actor: {
          type: actorTypeFromUser(user),
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        },
        daily,
        monthly,
      });
      apiSuccess(res, view);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/user/profile/self-exclude", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const durationRaw = req.body?.duration;
      if (typeof durationRaw !== "string" || !durationRaw.trim()) {
        throw new DomainError("INVALID_INPUT", "duration mangler.");
      }
      const view = await profileSettingsService.selfExclude({
        userId: user.id,
        actor: {
          type: actorTypeFromUser(user),
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        },
        duration: durationRaw.trim() as SelfExcludeDuration,
      });
      apiSuccess(res, view);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/user/profile/language", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const language = req.body?.language;
      const view = await profileSettingsService.setLanguage({
        userId: user.id,
        actor: {
          type: actorTypeFromUser(user),
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        },
        language: language as SupportedLanguage,
      });
      apiSuccess(res, view);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/user/profile/pause", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const durationMinutes = parseOptionalPositiveInteger(req.body?.durationMinutes, "durationMinutes");
      if (durationMinutes === undefined) {
        throw new DomainError("INVALID_INPUT", "durationMinutes mangler.");
      }
      const view = await profileSettingsService.setPause({
        userId: user.id,
        actor: {
          type: actorTypeFromUser(user),
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        },
        durationMinutes,
      });
      apiSuccess(res, view);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
