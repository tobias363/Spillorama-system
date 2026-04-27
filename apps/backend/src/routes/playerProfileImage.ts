/**
 * GAP #5: player profile + BankID image upload.
 *
 * Erstatter legacy `POST /player/profile/image/update` (routes/backend.js:754).
 * Legacy lagret to-element-array `profilePic[0]/[1]` for hhv. front- og
 * back-bilder; ny stack splitter i tre kategorier:
 *
 *   - `profile` — generelt profilbilde / avatar
 *   - `bankid_selfie` — BankID-selfie (compliance-relevant, audit-logget)
 *   - `bankid_document` — BankID-dokumentbilde (compliance-relevant)
 *
 * Endepunkter:
 *   POST   /api/players/me/profile/image?category=<category>
 *     Body: { imageBase64: string, mimeType?: string }
 *     Returnerer: { url, mimeType, width, height, byteLength }
 *
 *   DELETE /api/players/me/profile/image?category=<category>
 *     Setter URL = null på riktig kolonne.
 *
 * Validering (sentralisert i ImageStorageService.validateImageBase64):
 *   - MIME: jpeg/png/webp via magic-bytes
 *   - Maks 5 MB
 *   - 100×100 → 4096×4096 pixler
 *
 * Auth: bearer-token via Authorization-header. Spilleren oppdaterer kun
 * seg selv (userId = innlogget bruker).
 *
 * Audit: alle uploads logges. BankID-relaterte (selfie/document) logges
 * eksplisitt på et eget action-prefiks (`bankid.image.upload`) for
 * compliance-rapportering.
 */

import express from "express";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import { DomainError } from "../game/BingoEngine.js";
import {
  type ImageCategory,
  type ImageStorageAdapter,
  validateImageBase64,
} from "../media/ImageStorageService.js";

export interface PlayerProfileImageRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  imageStorage: ImageStorageAdapter;
}

const VALID_CATEGORIES: readonly ImageCategory[] = [
  "profile",
  "bankid_selfie",
  "bankid_document",
] as const;

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

function parseCategory(raw: unknown): ImageCategory {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value) {
    throw new DomainError(
      "INVALID_INPUT",
      "category mangler (profile | bankid_selfie | bankid_document)."
    );
  }
  if (!VALID_CATEGORIES.includes(value as ImageCategory)) {
    throw new DomainError(
      "INVALID_INPUT",
      "category må være profile, bankid_selfie eller bankid_document."
    );
  }
  return value as ImageCategory;
}

function isBankidCategory(category: ImageCategory): boolean {
  return category === "bankid_selfie" || category === "bankid_document";
}

function auditAction(category: ImageCategory, op: "upload" | "delete"): string {
  if (isBankidCategory(category)) {
    return op === "upload"
      ? `bankid.image.upload.${category === "bankid_selfie" ? "selfie" : "document"}`
      : `bankid.image.delete.${category === "bankid_selfie" ? "selfie" : "document"}`;
  }
  return op === "upload" ? "player.profile.image.upload" : "player.profile.image.delete";
}

export function createPlayerProfileImageRouter(
  deps: PlayerProfileImageRouterDeps
): express.Router {
  const { platformService, auditLogService, imageStorage } = deps;
  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  router.post("/api/players/me/profile/image", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const category = parseCategory(req.query.category);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
      const declaredMime = typeof body.mimeType === "string" ? body.mimeType : undefined;

      const validated = validateImageBase64(imageBase64, declaredMime);
      const stored = await imageStorage.store({
        userId: user.id,
        category,
        image: validated,
      });

      const updated = await platformService.updateProfileImage({
        userId: user.id,
        category,
        imageUrl: stored.url,
      });

      // Audit. Alltid logg upload (BankID-kategorier får dedikert action-
      // prefiks for compliance-rapportering). Detaljer-feltet ekskluderer
      // selve image-bytes; vi skriver kun metadata.
      void auditLogService
        .record({
          actorId: user.id,
          actorType: actorTypeFromUser(user),
          action: auditAction(category, "upload"),
          resource: "user",
          resourceId: user.id,
          details: {
            category,
            mimeType: stored.mimeType,
            byteLength: stored.byteLength,
            width: stored.width,
            height: stored.height,
            url: stored.url,
            isBankid: isBankidCategory(category),
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        })
        .catch(() => {
          // Audit er fire-and-forget, jf. BIN-588 / players-router-mønsteret.
        });

      apiSuccess(res, {
        category,
        url: stored.url,
        mimeType: stored.mimeType,
        width: stored.width,
        height: stored.height,
        byteLength: stored.byteLength,
        // Returnerer hele user-rad-en så klienten kan oppdatere caches.
        user: {
          id: updated.id,
          profileImageUrl: updated.profileImageUrl ?? null,
          bankidSelfieUrl: updated.bankidSelfieUrl ?? null,
          bankidDocumentUrl: updated.bankidDocumentUrl ?? null,
        },
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/players/me/profile/image", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const category = parseCategory(req.query.category);

      const updated = await platformService.updateProfileImage({
        userId: user.id,
        category,
        imageUrl: null,
      });

      void auditLogService
        .record({
          actorId: user.id,
          actorType: actorTypeFromUser(user),
          action: auditAction(category, "delete"),
          resource: "user",
          resourceId: user.id,
          details: {
            category,
            isBankid: isBankidCategory(category),
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        })
        .catch(() => {
          /* fire-and-forget */
        });

      apiSuccess(res, {
        category,
        url: null,
        user: {
          id: updated.id,
          profileImageUrl: updated.profileImageUrl ?? null,
          bankidSelfieUrl: updated.bankidSelfieUrl ?? null,
          bankidDocumentUrl: updated.bankidDocumentUrl ?? null,
        },
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
