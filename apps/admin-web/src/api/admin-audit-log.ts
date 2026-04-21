// BIN-655 (alt) — admin-audit-log API wrapper.
//
// GET /api/admin/audit-log?from&to&actorId&resource&action&cursor&limit
//   → { items: AdminAuditLogEvent[], nextCursor: string | null }
//
// Read-only. Kreves AUDIT_LOG_READ (ADMIN + SUPPORT).
// Parallel til /api/admin/audit/events (adminSecurity.ts fra BIN-587 B3);
// forskjell: cursor-paginert + ekstra from/to-filter.

import { apiRequest } from "./client.js";

export interface AdminAuditLogEvent {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AdminAuditLogListResponse {
  items: AdminAuditLogEvent[];
  nextCursor: string | null;
}

export interface ListAuditLogParams {
  from?: string;
  to?: string;
  actorId?: string;
  resource?: string;
  action?: string;
  cursor?: string;
  limit?: number;
}

export async function listAuditLog(
  params: ListAuditLogParams = {}
): Promise<AdminAuditLogListResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.actorId) qs.set("actorId", params.actorId);
  if (params.resource) qs.set("resource", params.resource);
  if (params.action) qs.set("action", params.action);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<AdminAuditLogListResponse>(
    `/api/admin/audit-log${suffix}`,
    { auth: true }
  );
}
