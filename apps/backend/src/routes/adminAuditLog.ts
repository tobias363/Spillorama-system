/**
 * BIN-655 (alt-variant): read-only admin-UI endpoint for audit-log.
 *
 * Endepunkt:
 *   GET /api/admin/audit-log?from&to&actorId&resource&action&cursor&limit
 *
 * Dette endepunktet lever parallelt med BIN-587 B3-security sitt
 * `/api/admin/audit/events` (adminSecurity.ts). Forskjeller:
 *   - Cursor-paginert (base64url-offset, samme mønster som BIN-647) istedenfor
 *     ren limit-basert slice.
 *   - Returnerer `{ items, nextCursor }` for å matche ellers i UI-siden.
 *   - Støtter both `from`+`to` (tidsvindu) istedenfor bare `since`.
 *
 * Data kommer fra `AuditLogService.list()`. Read-only; ingen mutasjon,
 * ingen audit-av-audit.
 *
 * Rolle-krav: AUDIT_LOG_READ (ADMIN + SUPPORT). Regulatorisk-sensitivt (§11),
 * samme bredde som adminSecurity.ts.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type {
  AuditLogService,
  PersistedAuditEvent,
} from "../compliance/AuditLogService.js";
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

// ── Cursor helpers ───────────────────────────────────────────────────────────

export function encodeAuditCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function decodeAuditCursor(cursor: string): number {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

// ── Wire-types ───────────────────────────────────────────────────────────────

export interface AdminAuditLogListResponse {
  items: PersistedAuditEvent[];
  nextCursor: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseOptionalIso(
  value: unknown,
  fieldName: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være ISO-8601 dato/tid.`
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være ISO-8601 dato/tid.`
    );
  }
  return new Date(ms).toISOString();
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ── Router ───────────────────────────────────────────────────────────────────

export interface AdminAuditLogRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
}

export function createAdminAuditLogRouter(
  deps: AdminAuditLogRouterDeps
): express.Router {
  const { platformService, auditLogService } = deps;
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

  router.get("/api/admin/audit-log", async (req, res) => {
    try {
      await requirePermission(req, "AUDIT_LOG_READ");
      const from = parseOptionalIso(req.query.from, "from");
      const to = parseOptionalIso(req.query.to, "to");
      const actorId = parseOptionalString(req.query.actorId);
      const resource = parseOptionalString(req.query.resource);
      const action = parseOptionalString(req.query.action);
      const limit = parseLimit(req.query.limit, 100);
      const cursor = parseOptionalString(req.query.cursor);
      const offset = cursor ? decodeAuditCursor(cursor) : 0;

      // AuditLogService.list() har ikke nativ offset-støtte. Vi henter
      // `offset + limit + 1` rader og skivaer ut siden-slicen. Dette er
      // bevisst: audit-tabellen er append-only og liten pr spørring,
      // og vi beholder API-et bakoverkompatibelt uten å utvide store-
      // interface-et. For store volumer finnes /api/admin/audit/events
      // med limit-basert slice (BIN-587 B3-security).
      const listFilter: Parameters<AuditLogService["list"]>[0] = {
        limit: offset + limit + 1,
      };
      if (actorId !== undefined) listFilter.actorId = actorId;
      if (resource !== undefined) listFilter.resource = resource;
      if (action !== undefined) listFilter.action = action;
      // AuditListFilter har `since` (inclusive from). `to` filtreres client-
      // side her fordi AuditListFilter ikke eksponerer en upper-bound.
      if (from !== undefined) listFilter.since = from;

      const allEvents = await auditLogService.list(listFilter);
      const filtered =
        to !== undefined
          ? allEvents.filter((e) => e.createdAt <= to)
          : allEvents;

      const sliced = filtered.slice(offset, offset + limit + 1);
      const hasMore = sliced.length > limit;
      const page = hasMore ? sliced.slice(0, limit) : sliced;
      const nextCursor = hasMore ? encodeAuditCursor(offset + limit) : null;

      const response: AdminAuditLogListResponse = {
        items: page,
        nextCursor,
      };
      apiSuccess(res, response);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
