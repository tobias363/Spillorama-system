/**
 * BIN-629: per-player login-history — pure DTO builder.
 *
 * Legacy reference:
 *   legacy/unity-backend/App/Models/loginHistory.js — schema had
 *     { player, ip, date, flag, client }
 *   legacy/unity-backend/App/Views/player/loginHistory.html — UI rendered
 *     date / ip / client (flag/player was never shown).
 *
 * Backend data-model difference:
 *   The dedicated Mongo `loginhistory` collection is gone. Login events
 *   are instead audit-log rows in `app_audit_log` (BIN-588) — the auth
 *   router emits `auth.login` / `auth.login.failed` with actorId = user.id,
 *   resource = "session". That gives us the exact (ipAddress, userAgent,
 *   createdAt) tuple the legacy UI needed, plus success/failure which the
 *   legacy schema carried in `flag` but never surfaced.
 *
 * This module is pure — it takes already-fetched `PersistedAuditEvent` rows
 * and maps them to the wire-shape the admin-player-detail UI consumes. DB
 * I/O lives in the route layer, same pattern as BIN-647 subgame drill-down.
 *
 * Cursor-pagination:
 *   Offset-based base64url, same style as BIN-647 / BIN-651 (opaque from
 *   the client's POV, decodes to a row-offset in the server).
 */

import type { PersistedAuditEvent } from "../compliance/AuditLogService.js";
import type {
  PlayerLoginHistoryEntry,
  PlayerLoginHistoryResponse,
} from "@spillorama/shared-types";

/** Opaque-cursor helpers — shared style with BIN-647/BIN-651. */
export function encodeLoginCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function decodeLoginCursor(cursor: string): number {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

export interface BuildLoginHistoryInput {
  userId: string;
  /**
   * Result of `AuditLogService.listLoginHistory({ actorId: userId, ..., limit: pageSize + 1 })`.
   * Callers over-fetch by one row so we can tell whether there's a next page
   * without issuing a COUNT — same trick used in adminReports routes.
   */
  events: PersistedAuditEvent[];
  /** Echoed back to the caller; null when unbounded. */
  from: string | null;
  to: string | null;
  /** Page size asked for. `events.length > pageSize` signals a next page. */
  pageSize: number;
  /** Offset that produced `events`; used to compute next-cursor. */
  offset: number;
}

/** Map an audit-log row to the wire-shape. */
function toEntry(event: PersistedAuditEvent): PlayerLoginHistoryEntry {
  const success = event.action === "auth.login";
  const rawReason = event.details?.["failureReason"];
  const failureReason = !success && typeof rawReason === "string" ? rawReason : null;
  return {
    id: event.id,
    timestamp: event.createdAt,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    success,
    failureReason,
  };
}

export function buildLoginHistoryResponse(
  input: BuildLoginHistoryInput,
): PlayerLoginHistoryResponse {
  const pageSize = Math.max(1, Math.floor(input.pageSize));
  const hasMore = input.events.length > pageSize;
  const page = hasMore ? input.events.slice(0, pageSize) : input.events;
  const nextCursor = hasMore ? encodeLoginCursor(input.offset + pageSize) : null;
  return {
    userId: input.userId,
    from: input.from,
    to: input.to,
    items: page.map(toEntry),
    nextCursor,
  };
}
