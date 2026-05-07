/**
 * PT1 — Admin-router for static-ticket CSV-import (fysisk-bong inventar).
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *
 * Endpoint:
 *   POST /api/admin/physical-tickets/static/import
 *     body: { hallId: string, csvContent: string }
 *
 * Ikke multipart — admin-UI leser filen med FileReader.readAsText() og sender
 * CSV-innholdet som JSON-streng. Dette matcher resten av admin-API-et (alle
 * andre endepunkter er JSON-body). Server aksepterer opptil 15MB via
 * body-parser-override i index.ts.
 *
 * Permission: `PHYSICAL_TICKET_WRITE` (ADMIN + HALL_OPERATOR). HALL_OPERATOR
 * er begrenset til sin egen hall via `assertUserHallScope` i route.
 *
 * Idempotens: CSV kan re-importeres uten duplikater. Eksisterende rader med
 * samme (hall_id, ticket_serial, ticket_color) returneres som `skipped` i
 * resultatet og oppdateres ikke. Dette gjør at admin kan rette en CSV og
 * re-laste uten redselsfulle konsekvenser.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { StaticTicketService } from "../compliance/StaticTicketService.js";
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

const logger = rootLogger.child({ module: "admin-static-tickets" });

export interface AdminStaticTicketsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  staticTicketService: StaticTicketService;
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
  role: PublicAppUser["role"],
): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  return "USER";
}

export function createAdminStaticTicketsRouter(
  deps: AdminStaticTicketsRouterDeps,
): express.Router {
  const { platformService, auditLogService, staticTicketService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[PT1] audit append failed");
    });
  }

  router.post("/api/admin/physical-tickets/static/import", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const hallId = mustBeNonEmptyString(req.body.hallId, "hallId");
      assertUserHallScope(adminUser, hallId);
      const csvContent = mustBeNonEmptyString(req.body.csvContent, "csvContent");

      const result = await staticTicketService.importFromCSV(csvContent, hallId);

      fireAudit({
        actorId: adminUser.id,
        actorType: actorTypeFromRole(adminUser.role),
        action: "physical_ticket.static.import",
        resource: "static_ticket_inventory",
        resourceId: hallId,
        details: {
          hallId,
          totalRows: result.totalRows,
          inserted: result.inserted,
          skipped: result.skipped,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
