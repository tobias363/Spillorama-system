/**
 * PT4 — Admin-router for fysisk-bong vinn-verifisering og utbetaling.
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 6: Vinn-varsel + verifisering + utbetaling", linje 127-156)
 *
 * Endpoints:
 *   GET  /api/admin/physical-ticket-payouts/pending?gameId=&userId=
 *          — List pending-rows for spill eller bruker. Hall-scope håndheves
 *            av PlatformService (HALL_OPERATOR filtreres til egen hall).
 *
 *   POST /api/admin/physical-ticket-payouts/:id/verify
 *          body: { scannedTicketId: string }
 *          — Bingovert scanner bongen for anti-svindel-sjekk. Returnerer
 *            `{ needsAdminApproval, expectedPayoutCents, ticketId, pattern, color }`.
 *
 *   POST /api/admin/physical-ticket-payouts/:id/admin-approve
 *          body: { }
 *          — Fire-øyne-approval for premier ≥ 5000 kr. Kun ADMIN.
 *
 *   POST /api/admin/physical-ticket-payouts/:id/confirm-payout
 *          body: { }
 *          — Bingovert bekrefter kontant-utbetaling. Speiler til
 *            app_static_tickets.paid_out_*.
 *
 *   POST /api/admin/physical-ticket-payouts/:id/reject
 *          body: { reason: string }
 *          — Avvis fantom-vinn.
 *
 * Permission:
 *   - GET/verify/confirm-payout/reject: `PHYSICAL_TICKET_WRITE`
 *     (ADMIN + HALL_OPERATOR i egen hall)
 *   - admin-approve: kun ADMIN-rolle
 *
 * Status-koder:
 *   - 200 ok=true ved suksess
 *   - 400 ok=false ved INVALID_INPUT og andre klient-feil
 *   - 403 ok=false ved UNAUTHORIZED / FORBIDDEN
 *   - 404 ok=false ved PENDING_PAYOUT_NOT_FOUND
 *   - 409 ok=false ved TICKET_SCAN_MISMATCH, NOT_VERIFIED, ADMIN_APPROVAL_REQUIRED,
 *         ALREADY_REJECTED, ALREADY_PAID_OUT, ADMIN_APPROVAL_NOT_REQUIRED
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  PhysicalTicketPayoutService,
  PhysicalTicketPendingPayout,
} from "../compliance/PhysicalTicketPayoutService.js";
import {
  assertAdminPermission,
  assertUserHallScope,
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

const logger = rootLogger.child({ module: "admin-physical-ticket-payouts" });

export interface AdminPhysicalTicketPayoutsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  physicalTicketPayoutService: PhysicalTicketPayoutService;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}

function userAgentHeader(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function actorTypeFromRole(
  role: PublicAppUser["role"],
): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "AGENT" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  if (role === "AGENT") return "AGENT";
  return "USER";
}

/**
 * Mapper DomainError-koder til HTTP-status. Følger samme konvensjon som
 * adminAgentTicketRanges: semantiske statuser for bingovert-app.
 *   - NOT_FOUND-kodene → 404
 *   - FORBIDDEN/UNAUTHORIZED → 403
 *   - SCAN_MISMATCH, NOT_VERIFIED, ADMIN_APPROVAL_REQUIRED,
 *     ALREADY_REJECTED, ALREADY_PAID_OUT, ADMIN_APPROVAL_NOT_REQUIRED → 409
 *   - alt annet (inkl. INVALID_INPUT) → 400
 */
function statusForDomainCode(code: string): number {
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return 403;
  if (code === "PENDING_PAYOUT_NOT_FOUND") return 404;
  if (
    code === "TICKET_SCAN_MISMATCH"
    || code === "NOT_VERIFIED"
    || code === "ADMIN_APPROVAL_REQUIRED"
    || code === "ADMIN_APPROVAL_NOT_REQUIRED"
    || code === "ALREADY_REJECTED"
    || code === "ALREADY_PAID_OUT"
  ) {
    return 409;
  }
  return 400;
}

function replyFailure(res: express.Response, error: unknown): void {
  if (error instanceof DomainError) {
    res.status(statusForDomainCode(error.code)).json({
      ok: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  apiFailure(res, error);
}

/**
 * Sanitize pending payout for JSON serialisering — map til camelCase slik at
 * frontend får stabile feltnavn.
 */
function serializePending(p: PhysicalTicketPendingPayout): Record<string, unknown> {
  return {
    id: p.id,
    ticketId: p.ticketId,
    hallId: p.hallId,
    scheduledGameId: p.scheduledGameId,
    patternPhase: p.patternPhase,
    expectedPayoutCents: p.expectedPayoutCents,
    responsibleUserId: p.responsibleUserId,
    color: p.color,
    detectedAt: p.detectedAt,
    verifiedAt: p.verifiedAt,
    verifiedByUserId: p.verifiedByUserId,
    paidOutAt: p.paidOutAt,
    paidOutByUserId: p.paidOutByUserId,
    adminApprovalRequired: p.adminApprovalRequired,
    adminApprovedAt: p.adminApprovedAt,
    adminApprovedByUserId: p.adminApprovedByUserId,
    rejectedAt: p.rejectedAt,
    rejectedByUserId: p.rejectedByUserId,
    rejectedReason: p.rejectedReason,
  };
}

export function createAdminPhysicalTicketPayoutsRouter(
  deps: AdminPhysicalTicketPayoutsRouterDeps,
): express.Router {
  const { platformService, auditLogService, physicalTicketPayoutService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[PT4] audit append failed");
    });
  }

  // GET /api/admin/physical-ticket-payouts/pending?gameId=&userId=
  router.get("/api/admin/physical-ticket-payouts/pending", async (req, res) => {
    try {
      const user = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const gameId = typeof req.query.gameId === "string" && req.query.gameId.trim()
        ? req.query.gameId.trim()
        : null;
      const userIdQuery = typeof req.query.userId === "string" && req.query.userId.trim()
        ? req.query.userId.trim()
        : null;

      if (!gameId && !userIdQuery) {
        throw new DomainError(
          "INVALID_INPUT",
          "Minst én av gameId eller userId må spesifiseres.",
        );
      }

      let pending: PhysicalTicketPendingPayout[];
      if (gameId && userIdQuery) {
        // Intersect i minnet (lite volum forventet).
        const byGame = await physicalTicketPayoutService.listPendingForGame(gameId);
        pending = byGame.filter((p) => p.responsibleUserId === userIdQuery);
      } else if (gameId) {
        pending = await physicalTicketPayoutService.listPendingForGame(gameId);
      } else {
        pending = await physicalTicketPayoutService.listPendingForUser(userIdQuery!);
      }

      // Hall-scope for HALL_OPERATOR: filtrer til egen hall.
      if (user.role === "HALL_OPERATOR") {
        if (!user.hallId) {
          throw new DomainError(
            "FORBIDDEN",
            "Din bruker er ikke tildelt en hall — kontakt admin.",
          );
        }
        pending = pending.filter((p) => p.hallId === user.hallId);
      }

      apiSuccess(res, { pending: pending.map(serializePending) });
    } catch (error) {
      replyFailure(res, error);
    }
  });

  // POST /api/admin/physical-ticket-payouts/:id/verify
  router.post(
    "/api/admin/physical-ticket-payouts/:id/verify",
    async (req, res) => {
      try {
        const user = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
        const pendingPayoutId = mustBeNonEmptyString(req.params.id, "id");

        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const scannedTicketId = mustBeNonEmptyString(
          req.body.scannedTicketId,
          "scannedTicketId",
        );

        // Hent pending for hall-scope-sjekk først.
        const existing = await physicalTicketPayoutService.getById(pendingPayoutId);
        if (!existing) {
          throw new DomainError(
            "PENDING_PAYOUT_NOT_FOUND",
            `Pending payout '${pendingPayoutId}' finnes ikke.`,
          );
        }
        assertUserHallScope(user, existing.hallId);

        const result = await physicalTicketPayoutService.verifyWin({
          pendingPayoutId,
          scannedTicketId,
          userId: user.id,
        });

        fireAudit({
          actorId: user.id,
          actorType: actorTypeFromRole(user.role),
          action: "physical_ticket.verified",
          resource: "physical_ticket_pending_payout",
          resourceId: pendingPayoutId,
          details: {
            ticketId: result.ticketId,
            pattern: result.pattern,
            color: result.color,
            expectedPayoutCents: result.expectedPayoutCents,
            needsAdminApproval: result.needsAdminApproval,
            hallId: existing.hallId,
            scheduledGameId: existing.scheduledGameId,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, result);
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  // POST /api/admin/physical-ticket-payouts/:id/admin-approve
  // Kun ADMIN — fire-øyne-approval for premier ≥ terskel.
  router.post(
    "/api/admin/physical-ticket-payouts/:id/admin-approve",
    async (req, res) => {
      try {
        const accessToken = getAccessTokenFromRequest(req);
        const user = await platformService.getUserFromAccessToken(accessToken);
        if (user.role !== "ADMIN") {
          throw new DomainError(
            "FORBIDDEN",
            "Kun ADMIN kan gi fire-øyne-godkjenning.",
          );
        }
        const pendingPayoutId = mustBeNonEmptyString(req.params.id, "id");

        const existing = await physicalTicketPayoutService.getById(pendingPayoutId);
        if (!existing) {
          throw new DomainError(
            "PENDING_PAYOUT_NOT_FOUND",
            `Pending payout '${pendingPayoutId}' finnes ikke.`,
          );
        }

        const updated = await physicalTicketPayoutService.adminApprove({
          pendingPayoutId,
          adminUserId: user.id,
        });

        fireAudit({
          actorId: user.id,
          actorType: "ADMIN",
          action: "physical_ticket.admin_approved",
          resource: "physical_ticket_pending_payout",
          resourceId: pendingPayoutId,
          details: {
            ticketId: updated.ticketId,
            pattern: updated.patternPhase,
            expectedPayoutCents: updated.expectedPayoutCents,
            hallId: updated.hallId,
            scheduledGameId: updated.scheduledGameId,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, serializePending(updated));
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  // POST /api/admin/physical-ticket-payouts/:id/confirm-payout
  router.post(
    "/api/admin/physical-ticket-payouts/:id/confirm-payout",
    async (req, res) => {
      try {
        const user = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
        const pendingPayoutId = mustBeNonEmptyString(req.params.id, "id");

        const existing = await physicalTicketPayoutService.getById(pendingPayoutId);
        if (!existing) {
          throw new DomainError(
            "PENDING_PAYOUT_NOT_FOUND",
            `Pending payout '${pendingPayoutId}' finnes ikke.`,
          );
        }
        assertUserHallScope(user, existing.hallId);

        const result = await physicalTicketPayoutService.confirmPayout({
          pendingPayoutId,
          userId: user.id,
        });

        fireAudit({
          actorId: user.id,
          actorType: actorTypeFromRole(user.role),
          action: "physical_ticket.payout",
          resource: "physical_ticket_pending_payout",
          resourceId: pendingPayoutId,
          details: {
            ticketId: result.ticketId,
            amountCents: result.paidOutAmountCents,
            pattern: existing.patternPhase,
            paidByUserId: user.id,
            hallId: existing.hallId,
            scheduledGameId: existing.scheduledGameId,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, result);
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  // POST /api/admin/physical-ticket-payouts/:id/reject
  // Body: { reason: string }
  router.post(
    "/api/admin/physical-ticket-payouts/:id/reject",
    async (req, res) => {
      try {
        const user = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
        const pendingPayoutId = mustBeNonEmptyString(req.params.id, "id");

        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const reason = mustBeNonEmptyString(req.body.reason, "reason");

        const existing = await physicalTicketPayoutService.getById(pendingPayoutId);
        if (!existing) {
          throw new DomainError(
            "PENDING_PAYOUT_NOT_FOUND",
            `Pending payout '${pendingPayoutId}' finnes ikke.`,
          );
        }
        assertUserHallScope(user, existing.hallId);

        const result = await physicalTicketPayoutService.rejectWin({
          pendingPayoutId,
          userId: user.id,
          reason,
        });

        fireAudit({
          actorId: user.id,
          actorType: actorTypeFromRole(user.role),
          action: "physical_ticket.rejected",
          resource: "physical_ticket_pending_payout",
          resourceId: pendingPayoutId,
          details: {
            ticketId: existing.ticketId,
            reason,
            hallId: existing.hallId,
            scheduledGameId: existing.scheduledGameId,
            pattern: existing.patternPhase,
            expectedPayoutCents: existing.expectedPayoutCents,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, result);
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  return router;
}
