/**
 * BIN-FCM: player-facing notifications endpoints.
 *
 * Erstatter stub-endpointene i game.ts (`GET /api/notifications` og
 * `POST /api/notifications/read`). Ny logikk leser fra `app_notifications`
 * og tilbyr device-registrering mot FcmPushService.
 *
 * Endepunkter:
 *   GET    /api/notifications              — paginert liste for innlogget bruker
 *   GET    /api/notifications/unread/count — ulest-teller (for badge)
 *   POST   /api/notifications/:id/read     — mark én som lest
 *   POST   /api/notifications/read-all     — mark alle som lest (fallback for legacy)
 *   POST   /api/notifications/device       — registrer FCM-token
 *   DELETE /api/notifications/device       — avregistrer FCM-token (via body.token)
 *   DELETE /api/notifications/device/:id   — avregistrer device by id
 */

import express from "express";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { FcmPushService } from "../notifications/FcmPushService.js";
import { DEVICE_TYPES, type DeviceType } from "../notifications/types.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
  parseOptionalPositiveInteger,
  parseBooleanQueryValue,
} from "../util/httpHelpers.js";
import { DomainError } from "../game/BingoEngine.js";

export interface NotificationsRouterDeps {
  platformService: PlatformService;
  fcmPushService: FcmPushService;
}

function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === "string" && (DEVICE_TYPES as readonly string[]).includes(value);
}

export function createNotificationsRouter(deps: NotificationsRouterDeps): express.Router {
  const { platformService, fcmPushService } = deps;
  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  // GET /api/notifications — liste for innlogget bruker.
  router.get("/api/notifications", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const limit = parseLimit(req.query.limit, 50);
      const offset = parseOptionalPositiveInteger(req.query.offset, "offset") ?? 0;
      const unreadOnly = parseBooleanQueryValue(req.query.unreadOnly, false);
      const items = await fcmPushService.listForUser(user.id, { limit, offset, unreadOnly });
      apiSuccess(res, items);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET /api/notifications/unread/count — tall for badge.
  router.get("/api/notifications/unread/count", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const count = await fcmPushService.countUnreadForUser(user.id);
      apiSuccess(res, { count });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // POST /api/notifications/:id/read — mark én lest.
  router.post("/api/notifications/:id/read", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const id = mustBeNonEmptyString(req.params.id, "id");
      const updated = await fcmPushService.markAsRead(id, user.id);
      apiSuccess(res, { ok: true, updated });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // POST /api/notifications/read-all — mark alle lest (fallback for legacy-klient).
  router.post("/api/notifications/read-all", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const count = await fcmPushService.markAllAsReadForUser(user.id);
      apiSuccess(res, { ok: true, updated: count });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // POST /api/notifications/read — legacy-kompatibilitet med stub-endpointet.
  // Matcher det routes/game.ts tidligere eksponerte slik at eksisterende
  // klienter ikke krasjer etter migrasjon.
  router.post("/api/notifications/read", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.id === "string" && body.id.trim()) {
        const updated = await fcmPushService.markAsRead(body.id.trim(), user.id);
        apiSuccess(res, { ok: true, updated });
        return;
      }
      // No id → treat as "mark all", matches legacy stub semantics.
      const count = await fcmPushService.markAllAsReadForUser(user.id);
      apiSuccess(res, { ok: true, updated: count });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // POST /api/notifications/device — registrer/oppdater FCM-token.
  router.post("/api/notifications/device", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const firebaseToken = mustBeNonEmptyString(body.firebaseToken ?? body.token, "firebaseToken");
      const deviceType = body.deviceType;
      if (!isDeviceType(deviceType)) {
        throw new DomainError(
          "INVALID_INPUT",
          `deviceType må være en av: ${DEVICE_TYPES.join(", ")}.`,
        );
      }
      const deviceLabel =
        typeof body.deviceLabel === "string" && body.deviceLabel.trim()
          ? body.deviceLabel.trim()
          : null;
      const device = await fcmPushService.registerDevice({
        userId: user.id,
        firebaseToken,
        deviceType,
        deviceLabel,
      });
      apiSuccess(res, device);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // DELETE /api/notifications/device — avregistrer via token (legacy-support).
  router.delete("/api/notifications/device", async (req, res) => {
    try {
      await getAuthenticatedUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = typeof body.firebaseToken === "string"
        ? body.firebaseToken.trim()
        : typeof body.token === "string"
          ? body.token.trim()
          : "";
      if (!token) {
        throw new DomainError("INVALID_INPUT", "firebaseToken mangler.");
      }
      const updated = await fcmPushService.unregisterDevice(token);
      apiSuccess(res, { ok: true, updated });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // DELETE /api/notifications/device/:id — avregistrer spesifikk device.
  router.delete("/api/notifications/device/:id", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const id = mustBeNonEmptyString(req.params.id, "id");
      const updated = await fcmPushService.unregisterDeviceById(id, user.id);
      apiSuccess(res, { ok: true, updated });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET /api/notifications/devices — liste over spillerens devices.
  router.get("/api/notifications/devices", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const includeInactive = parseBooleanQueryValue(req.query.includeInactive, false);
      const devices = await fcmPushService.listDevicesForUser(user.id, { includeInactive });
      apiSuccess(res, devices);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
