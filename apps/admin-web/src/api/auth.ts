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
  const roleRaw = (u.role ?? "").toLowerCase();
  const role: Session["role"] = roleRaw === "agent" ? "agent" : u.isSuperAdmin ? "super-admin" : "admin";
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
