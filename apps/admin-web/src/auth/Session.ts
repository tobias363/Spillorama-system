export type Role = "admin" | "super-admin" | "agent";

export interface SessionHall {
  id: string;
  name: string;
}

export interface Session {
  id: string;
  name: string;
  email: string;
  role: Role;
  isSuperAdmin: boolean;
  avatar: string;
  hall: SessionHall[];
  dailyBalance: number | null;
  permissions: Record<string, PermissionFlags>;
}

export interface PermissionFlags {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
}

let current: Session | null = null;

export function setSession(s: Session | null): void {
  current = s;
  window.dispatchEvent(new CustomEvent("session:changed", { detail: { session: s } }));
}

export function getSession(): Session | null {
  return current;
}

export function requireSession(): Session {
  if (!current) throw new Error("No active session");
  return current;
}
