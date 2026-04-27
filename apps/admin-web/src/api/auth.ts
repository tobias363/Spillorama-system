import { apiRequest, setToken, clearToken } from "./client.js";
import type { Session } from "../auth/Session.js";

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  user: ApiUser;
}

export interface ApiUser {
  id: string;
  email: string;
  displayName?: string;
  role: string;
  avatar?: string;
  isSuperAdmin?: boolean;
  hall?: Array<{ id: string; name: string }>;
  dailyBalance?: number | null;
}

export async function login(email: string, password: string): Promise<Session> {
  const result = await apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  setToken(result.accessToken);
  return mapUserToSession(result.user);
}

// ── PR-B7 (BIN-675): register + forgot/reset password wrappers ────────────
// Backend: apps/backend/src/routes/auth.ts — /api/auth/register,
// /api/auth/forgot-password, /api/auth/reset-password/:token.

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  surname: string;
  birthDate: string;
  phone?: string;
}

/**
 * Register a new player account. Backend returns a full session identical in
 * shape to `/api/auth/login`, so we set the access token and map user →
 * Session exactly like login(). First user in the system becomes ADMIN;
 * everyone else is PLAYER — admin-web exposes this form only via direct
 * URL (`#/register`), per PR-B7 scope (hall-operator-assisted signup).
 */
export async function register(input: RegisterInput): Promise<Session> {
  const result = await apiRequest<LoginResponse>("/api/auth/register", {
    method: "POST",
    body: {
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      surname: input.surname,
      birthDate: input.birthDate,
      ...(input.phone ? { phone: input.phone } : {}),
    },
  });
  setToken(result.accessToken);
  return mapUserToSession(result.user);
}

/**
 * Request a password-reset e-mail. Enumeration-safe on the backend — always
 * returns `{ sent: true }` regardless of whether the user exists. Callers
 * MUST render identical UI feedback for both outcomes.
 */
export async function forgotPassword(email: string): Promise<{ sent: boolean }> {
  const result = await apiRequest<{ sent: boolean }>("/api/auth/forgot-password", {
    method: "POST",
    body: { email },
  });
  return { sent: Boolean(result?.sent) };
}

/**
 * Check whether a password-reset token is valid without consuming it.
 * Throws `ApiError` with 400/401/404 on invalid/expired tokens — the caller
 * should render a generic "invalid or expired" message.
 */
export async function validateResetToken(token: string): Promise<{ valid: boolean; userId: string }> {
  const result = await apiRequest<{ valid: boolean; userId: string }>(
    `/api/auth/reset-password/${encodeURIComponent(token)}`,
    { method: "GET" }
  );
  return { valid: Boolean(result?.valid), userId: String(result?.userId ?? "") };
}

/**
 * Consume a password-reset token and set a new password. Backend consumes
 * the token before writing the new hash, so a failed setPassword still
 * invalidates the link (prevents reuse).
 */
export async function resetPassword(token: string, newPassword: string): Promise<{ reset: boolean }> {
  const result = await apiRequest<{ reset: boolean }>(
    `/api/auth/reset-password/${encodeURIComponent(token)}`,
    { method: "POST", body: { newPassword } }
  );
  return { reset: Boolean(result?.reset) };
}

/**
 * REQ-130 (PDF 9 Frontend CR): Phone+PIN-login som alternativ til
 * email+password. Backend krever norsk telefonnummer og 4-6-sifret PIN.
 */
export async function loginPhone(phone: string, pin: string): Promise<Session> {
  const result = await apiRequest<LoginResponse>("/api/auth/login-phone", {
    method: "POST",
    body: { phone, pin },
  });
  setToken(result.accessToken);
  return mapUserToSession(result.user);
}

export interface PinStatusResponse {
  enabled: boolean;
  locked: boolean;
  lockedUntil: string | null;
  failedAttempts: number;
  lastUsedAt: string | null;
  configured: boolean;
}

export async function getPinStatus(): Promise<PinStatusResponse> {
  return apiRequest<PinStatusResponse>("/api/auth/pin/status", {
    method: "GET",
    auth: true,
  });
}

export async function setupPin(pin: string): Promise<{ enabled: boolean }> {
  return apiRequest<{ enabled: boolean }>("/api/auth/pin/setup", {
    method: "POST",
    auth: true,
    body: { pin },
  });
}

export async function disablePin(password: string): Promise<{ disabled: boolean }> {
  return apiRequest<{ disabled: boolean }>("/api/auth/pin/disable", {
    method: "POST",
    auth: true,
    body: { password },
  });
}

export async function logout(): Promise<void> {
  try {
    await apiRequest("/api/auth/logout", { method: "POST", auth: true });
  } finally {
    clearToken();
  }
}

export async function fetchMe(): Promise<Session> {
  const user = await apiRequest<ApiUser>("/api/auth/me", { auth: true });
  const permissions = await fetchPermissions();
  return mapUserToSession(user, permissions);
}

async function fetchPermissions(): Promise<Record<string, { view: boolean; add: boolean; edit: boolean; delete: boolean }>> {
  try {
    const raw = await apiRequest<unknown>("/api/admin/permissions", { auth: true });
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, { view: boolean; add: boolean; edit: boolean; delete: boolean }>;
    }
    return {};
  } catch {
    return {};
  }
}

function mapUserToSession(
  u: ApiUser,
  permissions: Record<string, { view: boolean; add: boolean; edit: boolean; delete: boolean }> = {}
): Session {
  // Backend uses uppercase UserRole ("ADMIN" | "HALL_OPERATOR" | "SUPPORT" |
  // "PLAYER" | "AGENT"); some legacy test-fixtures still send lowercase
  // ("admin"/"agent"). We compare uppercased for robustness.
  // Agent-portal PR: HALL_OPERATOR now lands in the agent-portal (same UX as
  // AGENT, but with elevated permissions per AdminAccessPolicy). SUPPORT
  // stays on the admin-panel (compliance role).
  const roleRaw = (u.role ?? "").toUpperCase();
  let role: Session["role"];
  if (roleRaw === "AGENT") {
    role = "agent";
  } else if (roleRaw === "HALL_OPERATOR") {
    role = "hall-operator";
  } else if (u.isSuperAdmin) {
    role = "super-admin";
  } else {
    role = "admin";
  }
  return {
    id: u.id,
    name: u.displayName ?? u.email,
    email: u.email,
    role,
    isSuperAdmin: Boolean(u.isSuperAdmin),
    avatar: u.avatar ?? "",
    hall: u.hall ?? [],
    dailyBalance: u.dailyBalance ?? null,
    permissions,
  };
}
