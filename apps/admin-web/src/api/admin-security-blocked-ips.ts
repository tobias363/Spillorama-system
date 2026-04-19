// PR-B6 (BIN-664) — admin blocked-IP API wrappers.
// Thin wrappers around `apps/backend/src/routes/adminSecurity.ts` for
// port av legacy `security/blockedIP.html` + `security/addBlockedIP.html`.
//
// Menypunktet lever under `/blockedIp` i admin-web (matcher legacy
// security/blockedIP.html), men selve endepunktet ligger under
// /api/admin/security/blocked-ips for at backend-modularisering speiler
// pengespillforskriften-domenet "security" fremfor legacy-menystruktur.
//
// Permissions:
//   - list:   SECURITY_READ  (ADMIN, HALL_OPERATOR, SUPPORT)
//   - add/del: SECURITY_WRITE (ADMIN kun)
//
// Edit: backend har ikke PATCH-endepunkt. Frontend gjør DELETE + POST
// (GAP-G1 i PR-B6-PLAN §2.1 — 2 audit-events er MER sporbart enn én).
//
// Regulatorisk: Alle mutasjoner audit-logges av backend via fireAudit()
// — se adminSecurity.ts:257-295. Frontend trenger ingen ekstra
// audit-logikk utover gyldig JWT i Authorization-header.

import { apiRequest } from "./client.js";

export interface BlockedIp {
  id: string;
  ipAddress: string;
  reason: string | null;
  blockedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ListBlockedIpsResponse {
  ips: BlockedIp[];
  count: number;
}

export function listBlockedIps(): Promise<ListBlockedIpsResponse> {
  return apiRequest<ListBlockedIpsResponse>(
    "/api/admin/security/blocked-ips",
    { auth: true }
  );
}

export interface AddBlockedIpBody {
  ipAddress: string;
  reason?: string | null;
  expiresAt?: string | null;
}

export function addBlockedIp(body: AddBlockedIpBody): Promise<BlockedIp> {
  return apiRequest<BlockedIp>("/api/admin/security/blocked-ips", {
    method: "POST",
    body,
    auth: true,
  });
}

export function deleteBlockedIp(id: string): Promise<{ removed: true }> {
  return apiRequest<{ removed: true }>(
    `/api/admin/security/blocked-ips/${encodeURIComponent(id)}`,
    { method: "DELETE", auth: true }
  );
}
