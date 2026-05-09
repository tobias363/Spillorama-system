/**
 * BIN-806 A13: admin anti-fraud-rapport-endepunkter.
 *
 * Endpoints:
 *   GET /api/admin/anti-fraud/signals — list signal-flagg for review-kø
 *
 * RBAC: ADMIN_ANTI_FRAUD_READ (ADMIN + SUPPORT). HALL_OPERATOR er bevisst
 * utelatt fra read-vinduet — fraud-vurdering må gjøres med full helhets-
 * oversikt, ikke per hall.
 *
 * Query-parametre:
 *   - hallId        (optional)
 *   - userId        (optional)
 *   - riskLevel     (optional: low|medium|high|critical)
 *   - actionTaken   (optional: logged|flagged_for_review|blocked)
 *   - fromDate      (optional ISO-8601)
 *   - toDate        (optional ISO-8601)
 *   - limit         (optional, default 100, max 500)
 *
 * Returnerer signaler sortert nyest først. Audit-trail-rader er immutable —
 * dette endepunktet er kun read.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type {
  AntiFraudService,
  AntiFraudActionTaken,
  AntiFraudListFilter,
  AntiFraudRiskLevel,
} from "../security/AntiFraudService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  parseLimit,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-anti-fraud" });

const VALID_RISK_LEVELS: AntiFraudRiskLevel[] = ["low", "medium", "high", "critical"];
const VALID_ACTIONS: AntiFraudActionTaken[] = [
  "logged",
  "flagged_for_review",
  "blocked",
];

export interface AdminAntiFraudRouterDeps {
  platformService: PlatformService;
  antiFraudService: AntiFraudService;
}

function parseOptionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng.`);
  }
  const lower = value.trim().toLowerCase() as T;
  if (!allowed.includes(lower)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være én av ${allowed.join(", ")}.`,
    );
  }
  return lower;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng.`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseOptionalIso(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new DomainError("INVALID_INPUT", `${field} må være en ISO-8601 dato/tid.`);
  }
  return new Date(ms).toISOString();
}

export function createAdminAntiFraudRouter(
  deps: AdminAntiFraudRouterDeps,
): express.Router {
  const { platformService, antiFraudService } = deps;
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

  router.get("/api/admin/anti-fraud/signals", async (req, res) => {
    try {
      await requirePermission(req, "ADMIN_ANTI_FRAUD_READ");
      const filter: AntiFraudListFilter = {
        hallId: parseOptionalString(req.query.hallId, "hallId"),
        userId: parseOptionalString(req.query.userId, "userId"),
        riskLevel: parseOptionalEnum(req.query.riskLevel, "riskLevel", VALID_RISK_LEVELS),
        actionTaken: parseOptionalEnum(req.query.actionTaken, "actionTaken", VALID_ACTIONS),
        fromIso: parseOptionalIso(req.query.fromDate, "fromDate"),
        toIso: parseOptionalIso(req.query.toDate, "toDate"),
        limit: parseLimit(req.query.limit, 100),
      };
      const signals = await antiFraudService.listSignals(filter);
      apiSuccess(res, { signals, count: signals.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.debug("[BIN-806 A13] admin-anti-fraud router mounted");
  return router;
}
