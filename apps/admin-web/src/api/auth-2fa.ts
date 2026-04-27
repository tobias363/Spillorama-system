// REQ-129/132: Frontend-wrappers for /api/auth/2fa/* og /api/auth/sessions/*.
//
// Backend-kontrakt: se apps/backend/openapi.yaml + apps/backend/src/routes/auth.ts.
// Endepunktene er listet i prompt og bekreftet i OpenAPI:
//   POST /api/auth/2fa/setup                       → { secret, otpauthUri }
//   POST /api/auth/2fa/verify  body { code }       → { enabled, backupCodes[] }
//   POST /api/auth/2fa/login   body { challengeId, code } → Session
//   POST /api/auth/2fa/disable body { password, code }    → { disabled }
//   GET  /api/auth/2fa/status                      → { enabled, enabledAt, backupCodesRemaining, hasPendingSetup }
//   POST /api/auth/2fa/backup-codes/regenerate body { password } → { backupCodes[] }
//
//   GET  /api/auth/sessions                        → { sessions[] }
//   POST /api/auth/sessions/logout-all body { includeCurrent? } → { count }
//   POST /api/auth/sessions/:id/logout             → { loggedOut: true }

import { apiRequest } from "./client.js";

// ── 2FA-setup ────────────────────────────────────────────────────────────

export interface TwoFASetupResult {
  secret: string;
  otpauthUri: string;
}

export interface TwoFAVerifyResult {
  enabled: true;
  backupCodes: string[];
}

export interface TwoFAStatus {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
  hasPendingSetup: boolean;
}

export interface BackupCodesResult {
  backupCodes: string[];
}

export async function getTwoFAStatus(): Promise<TwoFAStatus> {
  return await apiRequest<TwoFAStatus>("/api/auth/2fa/status", {
    method: "GET",
    auth: true,
  });
}

export async function setupTwoFA(): Promise<TwoFASetupResult> {
  return await apiRequest<TwoFASetupResult>("/api/auth/2fa/setup", {
    method: "POST",
    auth: true,
  });
}

export async function verifyTwoFA(code: string): Promise<TwoFAVerifyResult> {
  return await apiRequest<TwoFAVerifyResult>("/api/auth/2fa/verify", {
    method: "POST",
    auth: true,
    body: { code },
  });
}

export async function disableTwoFA(password: string, code: string): Promise<{ disabled: true }> {
  return await apiRequest<{ disabled: true }>("/api/auth/2fa/disable", {
    method: "POST",
    auth: true,
    body: { password, code },
  });
}

export async function regenerateBackupCodes(password: string): Promise<BackupCodesResult> {
  return await apiRequest<BackupCodesResult>("/api/auth/2fa/backup-codes/regenerate", {
    method: "POST",
    auth: true,
    body: { password },
  });
}

// ── 2FA-login (post-password challenge) ──────────────────────────────────

export interface TwoFALoginInput {
  challengeId: string;
  code: string;
}

export interface TwoFALoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    displayName?: string;
    role: string;
    avatar?: string;
    isSuperAdmin?: boolean;
    hall?: Array<{ id: string; name: string }>;
    dailyBalance?: number | null;
  };
  expiresAt?: string;
}

/**
 * Send TOTP-kode (eller backup-kode) etter at /api/auth/login svarte med
 * `requires2FA: true`. Returnerer rå LoginResponse — kalleren håndterer
 * setToken + mapUserToSession (delegate til auth.ts sin completeTwoFALogin).
 */
export async function twoFALoginRaw(input: TwoFALoginInput): Promise<TwoFALoginResponse> {
  return await apiRequest<TwoFALoginResponse>("/api/auth/2fa/login", {
    method: "POST",
    body: input,
  });
}

// ── Sessions ─────────────────────────────────────────────────────────────

export interface ActiveSession {
  id: string;
  userId: string;
  deviceUserAgent: string | null;
  ipAddress: string | null;
  lastActivityAt: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export async function listSessions(): Promise<{ sessions: ActiveSession[] }> {
  return await apiRequest<{ sessions: ActiveSession[] }>("/api/auth/sessions", {
    method: "GET",
    auth: true,
  });
}

export async function logoutSession(sessionId: string): Promise<{ loggedOut: true }> {
  return await apiRequest<{ loggedOut: true }>(
    `/api/auth/sessions/${encodeURIComponent(sessionId)}/logout`,
    { method: "POST", auth: true }
  );
}

export async function logoutAllSessions(includeCurrent = false): Promise<{ count: number }> {
  return await apiRequest<{ count: number }>("/api/auth/sessions/logout-all", {
    method: "POST",
    auth: true,
    body: { includeCurrent },
  });
}
