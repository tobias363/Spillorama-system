// BIN-678 — admin-system-info API wrapper.
//
// GET /api/admin/system/info → SystemInfoSnapshot.
// Read-only; kreves SETTINGS_READ (ADMIN + HALL_OPERATOR + SUPPORT).
//
// Snapshot-feltene cachet server-side ved oppstart — så gjentatte kall er
// billige og returnerer samme buildSha/buildTime men ny uptime.

import { apiRequest } from "./client.js";

export interface SystemInfoSnapshot {
  version: string;
  buildSha: string;
  buildTime: string;
  nodeVersion: string;
  env: string;
  uptime: number;
  features: Record<string, boolean>;
}

export async function getSystemInfo(): Promise<SystemInfoSnapshot> {
  return apiRequest<SystemInfoSnapshot>("/api/admin/system/info", {
    auth: true,
  });
}
