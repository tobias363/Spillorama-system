// PR-B2: admin-player API-wrappers.
// Mirrors apps/backend/src/routes/adminPlayers.ts (BIN-587 B2.2 + B2.3).
//
// Ingen fake-data: wrappers returnerer typede DTO-er; feilhåndtering skjer
// i ApiError-instanser (se api/client.ts). Siden-kode gjør sin egen UX-toast.

import { apiRequest } from "./client.js";

// ── Kjerne-DTO ───────────────────────────────────────────────────────────────

export type KycStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

export interface PlayerSummary {
  id: string;
  email: string;
  displayName: string;
  surname: string | null;
  phone: string | null;
  kycStatus: KycStatus;
  birthDate: string | null;
  kycVerifiedAt: string | null;
  kycProviderRef: string | null;
  hallId: string | null;
  createdAt: string;
  updatedAt: string;
  complianceData: Record<string, unknown> | null;
}

export interface PlayerListResult {
  players: PlayerSummary[];
  count: number;
}

// ── Lister ───────────────────────────────────────────────────────────────────

export async function listPending(limit = 100): Promise<PlayerListResult> {
  return apiRequest<PlayerListResult>(`/api/admin/players/pending?limit=${limit}`, { auth: true });
}

export async function listRejected(limit = 100): Promise<PlayerListResult> {
  return apiRequest<PlayerListResult>(`/api/admin/players/rejected?limit=${limit}`, { auth: true });
}

export interface SearchParams {
  query: string;
  limit?: number;
  includeDeleted?: boolean;
}

export async function searchPlayers(params: SearchParams): Promise<PlayerListResult> {
  const qs = new URLSearchParams();
  qs.set("query", params.query);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.includeDeleted) qs.set("includeDeleted", "1");
  return apiRequest<PlayerListResult>(`/api/admin/players/search?${qs}`, { auth: true });
}

export function buildExportCsvUrl(params?: {
  kycStatus?: KycStatus;
  hallId?: string;
  limit?: number;
  includeDeleted?: boolean;
}): string {
  const qs = new URLSearchParams();
  if (params?.kycStatus) qs.set("kycStatus", params.kycStatus);
  if (params?.hallId) qs.set("hallId", params.hallId);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.includeDeleted) qs.set("includeDeleted", "1");
  const qstr = qs.toString();
  return `/api/admin/players/export.csv${qstr ? `?${qstr}` : ""}`;
}

// ── Detalj + audit ───────────────────────────────────────────────────────────

export async function getPlayer(id: string): Promise<PlayerSummary> {
  return apiRequest<PlayerSummary>(`/api/admin/players/${encodeURIComponent(id)}`, { auth: true });
}

export interface AuditEvent {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditListResult {
  events: AuditEvent[];
  count: number;
}

export async function getPlayerAudit(id: string, limit = 100): Promise<AuditListResult> {
  return apiRequest<AuditListResult>(
    `/api/admin/players/${encodeURIComponent(id)}/audit?limit=${limit}`,
    { auth: true }
  );
}

// ── KYC moderasjon ───────────────────────────────────────────────────────────

export async function approvePlayer(id: string, note?: string): Promise<PlayerSummary> {
  return apiRequest<PlayerSummary>(`/api/admin/players/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: note ? { note } : {},
    auth: true,
  });
}

export async function rejectPlayer(id: string, reason: string): Promise<PlayerSummary> {
  return apiRequest<PlayerSummary>(`/api/admin/players/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    body: { reason },
    auth: true,
  });
}

export async function resubmitPlayer(id: string): Promise<PlayerSummary> {
  return apiRequest<PlayerSummary>(`/api/admin/players/${encodeURIComponent(id)}/resubmit`, {
    method: "POST",
    body: {},
    auth: true,
  });
}

export async function overrideKycStatus(
  id: string,
  status: KycStatus,
  reason: string
): Promise<PlayerSummary> {
  return apiRequest<PlayerSummary>(`/api/admin/players/${encodeURIComponent(id)}/kyc-status`, {
    method: "PUT",
    body: { status, reason },
    auth: true,
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export interface PlayerHallStatus {
  hallId: string;
  hallName?: string;
  isActive: boolean;
  status?: string;
  updatedAt?: string;
  reason?: string | null;
}

export interface PlayerHallStatusList {
  statuses: PlayerHallStatus[];
  count: number;
}

export async function listHallStatus(id: string): Promise<PlayerHallStatusList> {
  return apiRequest<PlayerHallStatusList>(
    `/api/admin/players/${encodeURIComponent(id)}/hall-status`,
    { auth: true }
  );
}

export async function setHallStatus(
  id: string,
  hallId: string,
  isActive: boolean,
  reason?: string
): Promise<unknown> {
  return apiRequest<unknown>(`/api/admin/players/${encodeURIComponent(id)}/hall-status`, {
    method: "PUT",
    body: { hallId, isActive, ...(reason ? { reason } : {}) },
    auth: true,
  });
}

export async function softDeletePlayer(id: string, reason?: string): Promise<{ softDeleted: boolean }> {
  return apiRequest<{ softDeleted: boolean }>(
    `/api/admin/players/${encodeURIComponent(id)}/soft-delete`,
    {
      method: "POST",
      body: reason ? { reason } : {},
      auth: true,
    }
  );
}

export async function restorePlayer(id: string): Promise<{ restored: boolean }> {
  return apiRequest<{ restored: boolean }>(
    `/api/admin/players/${encodeURIComponent(id)}/restore`,
    { method: "POST", body: {}, auth: true }
  );
}

// ── BankID ───────────────────────────────────────────────────────────────────

export interface BankIdReverifyResult {
  user: PlayerSummary;
  bankIdSession: { sessionId: string; authUrl: string } | null;
  bankIdConfigured: boolean;
}

export async function bankIdReverify(id: string): Promise<BankIdReverifyResult> {
  return apiRequest<BankIdReverifyResult>(
    `/api/admin/players/${encodeURIComponent(id)}/bankid-reverify`,
    { method: "POST", body: {}, auth: true }
  );
}

// ── Utils ────────────────────────────────────────────────────────────────────

/** Human-friendly KYC-status badge-klasse (matcher legacy-farger). */
export function kycBadgeClass(status: KycStatus): "success" | "warning" | "danger" | "default" {
  switch (status) {
    case "VERIFIED":
      return "success";
    case "PENDING":
      return "warning";
    case "REJECTED":
      return "danger";
    case "UNVERIFIED":
    default:
      return "default";
  }
}
