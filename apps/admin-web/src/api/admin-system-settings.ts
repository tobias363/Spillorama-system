// BIN-677 — admin-system-settings API wrappers (wired til backend).
//
// Bakgrunn: legacy localStorage-fallback er erstattet med ekte backend-kall
// mot `/api/admin/settings` (19-nøkkel registry, se
// apps/backend/src/admin/SettingsService.ts) og `/api/admin/maintenance`
// (maintenance-vinduer).
//
// System-wide settings (BIN-677) er nøkkel/verdi med fast registry:
//   GET   /api/admin/settings       → { settings: SystemSettingRow[], count }
//   PATCH /api/admin/settings       → body { patches: [{key,value}, ...] }
//
// Maintenance-vinduer (BIN-677) er separate rader; én aktiv om gangen:
//   GET   /api/admin/maintenance            → liste + active
//   GET   /api/admin/maintenance/:id        → detalj
//   POST  /api/admin/maintenance            → opprett
//   PUT   /api/admin/maintenance/:id        → full update / status-toggle
//
// Legacy GlobalAppSettings-felter (android_version etc.) er ikke fjernet
// men flyttet til system settings-nøkler (`app.android_version`, osv.).
// SystemInformation (legacy systemInformationData) lagres nå under
// nøkkelen `system.information` via samme endepunkt.
//
// Per-hall Spillvett-tak (daglig/månedlig) tar presedens — ligger i
// `/api/admin/halls/:id` og er ikke en del av dette API-et.

import { apiRequest } from "./client.js";

// ── SystemSetting (19-nøkkel registry) ───────────────────────────────────────

export type SystemSettingType = "string" | "number" | "boolean" | "object";

export interface SystemSettingRow {
  key: string;
  value: unknown;
  category: string;
  description: string;
  type: SystemSettingType;
  /** true hvis verdien kommer fra registry-default (ingen DB-rad eksisterer). */
  isDefault: boolean;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface SystemSettingsListResponse {
  settings: SystemSettingRow[];
  count: number;
}

export interface SystemSettingPatchEntry {
  key: string;
  value: unknown;
}

/** Fetch hele 19-nøkkel registeret (katalog + current values). */
export async function getSystemSettings(): Promise<SystemSettingsListResponse> {
  return apiRequest<SystemSettingsListResponse>("/api/admin/settings", {
    auth: true,
  });
}

/** Patch én eller flere nøkler i en batch (transaksjonell i backend). */
export async function patchSystemSettings(
  patches: SystemSettingPatchEntry[]
): Promise<SystemSettingsListResponse> {
  return apiRequest<SystemSettingsListResponse>("/api/admin/settings", {
    method: "PATCH",
    body: { patches },
    auth: true,
  });
}

// ── SystemInformation (singleton under system.information) ──────────────────

export interface SystemInformationRecord {
  content: string;
  updatedAt: string | null;
}

export async function getSystemInformation(): Promise<SystemInformationRecord> {
  const res = await getSystemSettings();
  const row = res.settings.find((s) => s.key === "system.information");
  return {
    content: typeof row?.value === "string" ? row.value : "",
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function updateSystemInformation(
  content: string
): Promise<SystemInformationRecord> {
  const res = await patchSystemSettings([{ key: "system.information", value: content }]);
  const row = res.settings.find((s) => s.key === "system.information");
  return {
    content: typeof row?.value === "string" ? row.value : content,
    updatedAt: row?.updatedAt ?? null,
  };
}

// ── Maintenance-vinduer ──────────────────────────────────────────────────────

export type MaintenanceStatus = "active" | "inactive";

export interface MaintenanceWindow {
  id: string;
  maintenanceStart: string;
  maintenanceEnd: string;
  message: string;
  showBeforeMinutes: number;
  status: MaintenanceStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  deactivatedAt: string | null;
}

export interface MaintenanceListResponse {
  windows: MaintenanceWindow[];
  count: number;
  active: MaintenanceWindow | null;
}

export interface CreateMaintenanceBody {
  maintenanceStart: string;
  maintenanceEnd: string;
  message?: string;
  showBeforeMinutes?: number;
  status?: MaintenanceStatus;
}

export interface UpdateMaintenanceBody {
  maintenanceStart?: string;
  maintenanceEnd?: string;
  message?: string;
  showBeforeMinutes?: number;
  status?: MaintenanceStatus;
}

export async function listMaintenanceWindows(
  params: { status?: MaintenanceStatus; limit?: number } = {}
): Promise<MaintenanceListResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<MaintenanceListResponse>(`/api/admin/maintenance${suffix}`, {
    auth: true,
  });
}

export async function getMaintenanceWindow(id: string): Promise<MaintenanceWindow> {
  return apiRequest<MaintenanceWindow>(
    `/api/admin/maintenance/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export async function createMaintenanceWindow(
  body: CreateMaintenanceBody
): Promise<MaintenanceWindow> {
  return apiRequest<MaintenanceWindow>("/api/admin/maintenance", {
    method: "POST",
    body,
    auth: true,
  });
}

export async function updateMaintenanceWindow(
  id: string,
  body: UpdateMaintenanceBody
): Promise<MaintenanceWindow> {
  return apiRequest<MaintenanceWindow>(
    `/api/admin/maintenance/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body,
      auth: true,
    }
  );
}

/** Convenience — aktiver/deaktiver et vindu. */
export async function setMaintenanceStatus(
  id: string,
  status: MaintenanceStatus
): Promise<MaintenanceWindow> {
  return updateMaintenanceWindow(id, { status });
}
