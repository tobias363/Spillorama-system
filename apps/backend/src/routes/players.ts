/**
 * BIN-587 B2.1: player-resource endepunkter.
 *
 * Separat fra /api/auth/* — /api/auth/* håndterer tokens/sesjon/identitet,
 * mens /api/players/me* håndterer spiller-profil-ressursen (GDPR,
 * profil-felt som telefon/navn, framtidig loss-limits-historikk).
 *
 * Endepunkter:
 *   GET    /api/players/me/profile      — returner profil
 *   PUT    /api/players/me/profile      — oppdater profil-felt
 *   DELETE /api/players/me               — GDPR konto-sletting (soft-anonymize)
 */

import express from "express";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";

export interface PlayersRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

export function createPlayersRouter(deps: PlayersRouterDeps): express.Router {
  const { platformService, auditLogService } = deps;
  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  router.get("/api/players/me/profile", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      // Stripp password/compliance-ting som ikke hører hjemme i profil-
      // visning. Returnerer kun felt brukeren selv skal kunne se/endre.
      apiSuccess(res, {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        surname: user.surname ?? null,
        phone: user.phone ?? null,
        hallId: user.hallId,
        kycStatus: user.kycStatus,
        birthDate: user.birthDate ?? null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/players/me/profile", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input: { displayName?: string; email?: string; phone?: string } = {};
      if (typeof body.displayName === "string") input.displayName = body.displayName;
      if (typeof body.email === "string") input.email = body.email;
      if (typeof body.phone === "string") input.phone = body.phone;
      const updated = await platformService.updateProfile(user.id, input);
      void auditLogService
        .record({
          actorId: user.id,
          actorType: user.role === "PLAYER" ? "PLAYER" : "USER",
          action: "player.profile.update",
          resource: "user",
          resourceId: user.id,
          details: {
            changed: Object.keys(input),
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        })
        .catch((err) => {
          // Audit er fire-and-forget for ikke å blokkere skriving.
          // PostgresAuditLogStore logger allerede advarsel ved feil.
          void err;
        });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/players/me", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      await platformService.deleteAccount(user.id);
      await auditLogService
        .record({
          actorId: user.id,
          actorType: user.role === "PLAYER" ? "PLAYER" : "USER",
          action: "player.account.delete",
          resource: "user",
          resourceId: user.id,
          details: {
            reason: "gdpr-self-service",
            // Ikke logg e-post i klartekst — kun redacted markør.
            emailDomain: user.email.includes("@") ? user.email.split("@")[1] : null,
            role: user.role,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        })
        .catch(() => {
          // Se kommentar over — fire-and-forget.
        });
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
