import { getSession } from "./Session.js";

export type Action = "view" | "add" | "edit" | "delete";

export function hasPermission(module: string, action: Action = "view"): boolean {
  const s = getSession();
  if (!s) return false;
  if (s.role === "admin" || s.role === "super-admin") return true;
  const p = s.permissions[module];
  if (!p) return false;
  return Boolean(p[action]);
}

export function canView(module: string): boolean {
  return hasPermission(module, "view");
}
