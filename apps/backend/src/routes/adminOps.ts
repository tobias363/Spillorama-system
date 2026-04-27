/**
 * Tobias 2026-04-27: ADMIN Super-User Operations Console (`/admin/ops`).
 *
 * Endpoints:
 *   GET  /api/admin/ops/overview                              — OPS_CONSOLE_READ
 *   GET  /api/admin/ops/alerts                                — OPS_CONSOLE_READ
 *   POST /api/admin/ops/alerts/:id/acknowledge                — OPS_CONSOLE_WRITE
 *   POST /api/admin/ops/halls/:hallId/disable                 — OPS_CONSOLE_WRITE
 *   POST /api/admin/ops/halls/:hallId/enable                  — OPS_CONSOLE_WRITE
 *   POST /api/admin/ops/rooms/:roomCode/force-pause           — OPS_CONSOLE_WRITE
 *   POST /api/admin/ops/rooms/:roomCode/force-end             — OPS_CONSOLE_WRITE
 *   POST /api/admin/ops/rooms/:roomCode/skip-ball             — OPS_CONSOLE_WRITE
 *
 * Standalone router pattern (matcher createAdminWalletReconciliationRouter)
 * fordi vi trenger eget service-dep (AdminOpsService) som ikke er en del
 * av AdminSubRouterDeps. Wrapper rundt eksisterende engine + platformService
 * for force-actions slik at samme guards (drawNextNumber-mutex,
 * pauseGame-validation, endGame-flow) håndheves.
 *
 * Audit:
 *   - GET-endpoints: ingen audit-log (read-only).
 *   - Force-actions: full audit-log med actor + reason + payload-id.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
  UserRole,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
  parseLimit,
} from "../util/httpHelpers.js";
import type { AdminOpsService } from "../admin/AdminOpsService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "admin-ops" });

/**
 * OPS_CONSOLE_READ + OPS_CONSOLE_WRITE permissions, inline.
 *
 * Inline because AdminAccessPolicy.ts er administrert av en separat agent
 * (a57e9895357b6f16c — ADMIN all-permissions audit) i parallell. Når
 * deres PR lander vil AdminAccessPolicy få OPS_CONSOLE_READ/WRITE; vi
 * flytter dette til policy-importen i en follow-up. Konsekvens av inline:
 * tester er enklere (ingen full policy-import nødvendig) og rolle-sjekken
 * speiler hva policy ville ha gjort.
 */
const OPS_CONSOLE_READ_ROLES: ReadonlyArray<UserRole> = ["ADMIN", "SUPPORT"];
const OPS_CONSOLE_WRITE_ROLES: ReadonlyArray<UserRole> = ["ADMIN"];

type OpsPermission = "OPS_CONSOLE_READ" | "OPS_CONSOLE_WRITE";

function assertOpsPermission(role: UserRole, permission: OpsPermission): void {
  const allowed =
    permission === "OPS_CONSOLE_READ"
      ? OPS_CONSOLE_READ_ROLES
      : OPS_CONSOLE_WRITE_ROLES;
  if (!allowed.includes(role)) {
    throw new DomainError("FORBIDDEN", "Du har ikke tilgang til ops-konsollet.");
  }
}

const REASON_MIN_LENGTH = 5;
const REASON_MAX_LENGTH = 500;

export interface AdminOpsRouterDeps {
  platformService: PlatformService;
  engine: BingoEngine;
  adminOpsService: AdminOpsService;
  auditLogService: AuditLogService;
  /**
   * Eksisterende emit-fanout. Brukes etter pause/end/skip-ball så klienter
   * får oppdatering uten polling. Samme funksjon som adminRoomsRouter bruker.
   */
  emitRoomUpdate: (roomCode: string) => Promise<unknown>;
  /**
   * Socket.IO server for `admin:ops:update`-broadcast etter force-actions.
   * Optional — hvis ikke satt, gjør vi ingen broadcast (brukes i tester).
   */
  broadcastOpsUpdate?: (kind: AdminOpsBroadcastKind, payload?: Record<string, unknown>) => void;
}

/** Maskinlesbare broadcast-typer for `admin:ops:update`-eventet. */
export type AdminOpsBroadcastKind =
  | "overview-changed"
  | "alert-created"
  | "alert-acknowledged"
  | "hall-disabled"
  | "hall-enabled"
  | "room-force-paused"
  | "room-force-ended"
  | "room-skip-ball";

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

function parseReason(raw: unknown, fieldName = "reason"): string {
  const s = mustBeNonEmptyString(raw, fieldName);
  if (s.length < REASON_MIN_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være minst ${REASON_MIN_LENGTH} tegn (audit-krav).`,
    );
  }
  if (s.length > REASON_MAX_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} er for lang (maks ${REASON_MAX_LENGTH} tegn).`,
    );
  }
  return s;
}

export function createAdminOpsRouter(
  deps: AdminOpsRouterDeps,
): express.Router {
  const {
    platformService,
    engine,
    adminOpsService,
    auditLogService,
    emitRoomUpdate,
    broadcastOpsUpdate,
  } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: OpsPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertOpsPermission(user.role, permission);
    return user;
  }

  function fireAndForgetAudit(
    req: express.Request,
    actor: PublicAppUser,
    action: string,
    resource: string,
    resourceId: string | null,
    details: Record<string, unknown>,
  ): void {
    auditLogService
      .record({
        actorId: actor.id,
        actorType: "ADMIN",
        action,
        resource,
        resourceId,
        details,
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      })
      .catch((err) => {
        log.warn({ err, action }, "audit-log append failed (non-blocking)");
      });
  }

  function safeBroadcast(kind: AdminOpsBroadcastKind, payload?: Record<string, unknown>): void {
    if (!broadcastOpsUpdate) return;
    try {
      broadcastOpsUpdate(kind, payload);
    } catch (err) {
      log.warn({ err, kind }, "broadcastOpsUpdate failed (non-blocking)");
    }
  }

  // ── GET overview ───────────────────────────────────────────────────────────

  router.get("/api/admin/ops/overview", async (req, res) => {
    try {
      await requirePermission(req, "OPS_CONSOLE_READ");
      const overview = await adminOpsService.aggregateOverview();
      apiSuccess(res, overview);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET alerts ─────────────────────────────────────────────────────────────

  router.get("/api/admin/ops/alerts", async (req, res) => {
    try {
      await requirePermission(req, "OPS_CONSOLE_READ");
      const limit = parseLimit(req.query.limit, 200);
      const alerts = await adminOpsService.listActiveAlerts({ limit });
      apiSuccess(res, { alerts, count: alerts.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST alerts/:id/acknowledge ────────────────────────────────────────────

  router.post("/api/admin/ops/alerts/:id/acknowledge", async (req, res) => {
    try {
      const actor = await requirePermission(req, "OPS_CONSOLE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");

      // Wallet-recon og payment-stale er virtuelle alerts — kan ikke ack-es
      // her. Klient må bruke deres respektive endepunkter.
      if (id.startsWith("wallet-recon:")) {
        throw new DomainError(
          "ALERT_NOT_ACKNOWLEDGEABLE",
          "Wallet-reconciliation-alerts må håndteres via /api/admin/wallet/reconciliation-alerts/:id/resolve.",
        );
      }
      if (id.startsWith("payment-stale:")) {
        throw new DomainError(
          "ALERT_NOT_ACKNOWLEDGEABLE",
          "Stale payment-request-alerts blir borte automatisk når forespørselen aksepteres eller avvises.",
        );
      }

      const ok = await adminOpsService.acknowledgeAlert(id, actor.id);
      if (!ok) {
        throw new DomainError(
          "ALERT_NOT_FOUND",
          "Alert finnes ikke eller er allerede acknowledged.",
        );
      }

      fireAndForgetAudit(req, actor, "admin.ops.alert.acknowledge", "ops_alert", id, {
        alertId: id,
      });
      safeBroadcast("alert-acknowledged", { alertId: id });

      apiSuccess(res, { acknowledged: true, id });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST halls/:hallId/disable ─────────────────────────────────────────────

  router.post("/api/admin/ops/halls/:hallId/disable", async (req, res) => {
    try {
      const actor = await requirePermission(req, "OPS_CONSOLE_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const reason = parseReason(req.body.reason);

      const hall = await platformService.getHall(hallId);
      if (!hall.isActive) {
        throw new DomainError(
          "HALL_ALREADY_INACTIVE",
          "Hallen er allerede inaktiv.",
        );
      }

      const updated = await platformService.updateHall(hall.id, {
        isActive: false,
      });

      fireAndForgetAudit(req, actor, "admin.ops.hall.disable", "hall", hall.id, {
        hallId: hall.id,
        hallName: hall.name,
        reason,
      });
      safeBroadcast("hall-disabled", { hallId: hall.id, reason });

      apiSuccess(res, { hall: updated, reason });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST halls/:hallId/enable ──────────────────────────────────────────────

  router.post("/api/admin/ops/halls/:hallId/enable", async (req, res) => {
    try {
      const actor = await requirePermission(req, "OPS_CONSOLE_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      // Reason er valgfri på enable — sett en default hvis ikke gitt.
      const reasonRaw = isRecordObject(req.body) ? req.body.reason : null;
      const reason =
        typeof reasonRaw === "string" && reasonRaw.trim()
          ? parseReason(reasonRaw)
          : "Re-enabled fra ops-konsollet";

      const hall = await platformService.getHall(hallId);
      if (hall.isActive) {
        throw new DomainError(
          "HALL_ALREADY_ACTIVE",
          "Hallen er allerede aktiv.",
        );
      }

      const updated = await platformService.updateHall(hall.id, {
        isActive: true,
      });

      fireAndForgetAudit(req, actor, "admin.ops.hall.enable", "hall", hall.id, {
        hallId: hall.id,
        hallName: hall.name,
        reason,
      });
      safeBroadcast("hall-enabled", { hallId: hall.id, reason });

      apiSuccess(res, { hall: updated, reason });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST rooms/:roomCode/force-pause ──────────────────────────────────────

  router.post("/api/admin/ops/rooms/:roomCode/force-pause", async (req, res) => {
    try {
      const actor = await requirePermission(req, "OPS_CONSOLE_WRITE");
      const roomCode = mustBeNonEmptyString(
        req.params.roomCode,
        "roomCode",
      ).toUpperCase();
      const reason = isRecordObject(req.body) && req.body.reason
        ? parseReason(req.body.reason)
        : "Force-pause fra ops-konsollet";
      const message = isRecordObject(req.body) && typeof req.body.message === "string"
        ? req.body.message.slice(0, 200)
        : reason;

      // Wrapper rundt engine.pauseGame — engine validerer at runde kjører.
      engine.pauseGame(roomCode, message, { pauseReason: "OPS_FORCE_PAUSE" });
      const snapshot = await emitRoomUpdate(roomCode);

      fireAndForgetAudit(req, actor, "admin.ops.room.force_pause", "room", roomCode, {
        roomCode,
        reason,
      });
      safeBroadcast("room-force-paused", { roomCode, reason });

      apiSuccess(res, { roomCode, isPaused: true, snapshot, reason });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST rooms/:roomCode/force-end ────────────────────────────────────────

  router.post("/api/admin/ops/rooms/:roomCode/force-end", async (req, res) => {
    try {
      const actor = await requirePermission(req, "OPS_CONSOLE_WRITE");
      const roomCode = mustBeNonEmptyString(
        req.params.roomCode,
        "roomCode",
      ).toUpperCase();
      if (!isRecordObject(req.body)) {
        throw new DomainError(
          "INVALID_INPUT",
          "Payload må være et objekt med `reason`.",
        );
      }
      const reason = parseReason(req.body.reason);

      // Wrapper rundt engine.endGame — bruker hostPlayerId fra snapshot
      // siden ADMIN ikke har en host-rolle. endGame håndhever
      // wallet-allowed-for-gameplay på host og sjekker runde-state.
      const snapshotBefore = engine.getRoomSnapshot(roomCode);
      await engine.endGame({
        roomCode,
        actorPlayerId: snapshotBefore.hostPlayerId,
        reason: `OPS_FORCE_END: ${reason}`,
      });
      const snapshot = await emitRoomUpdate(roomCode);

      fireAndForgetAudit(req, actor, "admin.ops.room.force_end", "room", roomCode, {
        roomCode,
        reason,
      });
      safeBroadcast("room-force-ended", { roomCode, reason });

      apiSuccess(res, { roomCode, snapshot, reason });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST rooms/:roomCode/skip-ball ────────────────────────────────────────

  router.post("/api/admin/ops/rooms/:roomCode/skip-ball", async (req, res) => {
    try {
      const actor = await requirePermission(req, "OPS_CONSOLE_WRITE");
      const roomCode = mustBeNonEmptyString(
        req.params.roomCode,
        "roomCode",
      ).toUpperCase();
      if (!isRecordObject(req.body)) {
        throw new DomainError(
          "INVALID_INPUT",
          "Payload må være et objekt med `reason`.",
        );
      }
      const reason = parseReason(req.body.reason);

      const snapshotBefore = engine.getRoomSnapshot(roomCode);
      const drawResult = await engine.drawNextNumber({
        roomCode,
        actorPlayerId: snapshotBefore.hostPlayerId,
      });
      const snapshot = await emitRoomUpdate(roomCode);

      fireAndForgetAudit(req, actor, "admin.ops.room.skip_ball", "room", roomCode, {
        roomCode,
        reason,
        gameId: drawResult.gameId,
        number: drawResult.number,
        drawIndex: drawResult.drawIndex,
      });
      safeBroadcast("room-skip-ball", {
        roomCode,
        number: drawResult.number,
        drawIndex: drawResult.drawIndex,
      });

      apiSuccess(res, {
        roomCode,
        number: drawResult.number,
        drawIndex: drawResult.drawIndex,
        gameId: drawResult.gameId,
        snapshot,
        reason,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
