import { DomainError } from "../game/BingoEngine.js";
import type { UserRole } from "./PlatformService.js";

const ADMIN_ACCESS_POLICY_DEFINITION = {
  ADMIN_PANEL_ACCESS: ["ADMIN"],
  GAME_CATALOG_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  GAME_CATALOG_WRITE: ["ADMIN"],
  HALL_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  HALL_WRITE: ["ADMIN"],
  TERMINAL_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  TERMINAL_WRITE: ["ADMIN", "HALL_OPERATOR"],
  HALL_GAME_CONFIG_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  HALL_GAME_CONFIG_WRITE: ["ADMIN", "HALL_OPERATOR"],
  WALLET_COMPLIANCE_READ: ["ADMIN", "SUPPORT"],
  WALLET_COMPLIANCE_WRITE: ["ADMIN", "SUPPORT"],
  EXTRA_DRAW_DENIALS_READ: ["ADMIN", "SUPPORT"],
  PRIZE_POLICY_READ: ["ADMIN", "HALL_OPERATOR"],
  PRIZE_POLICY_WRITE: ["ADMIN"],
  EXTRA_PRIZE_AWARD: ["ADMIN"],
  PAYOUT_AUDIT_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  LEDGER_READ: ["ADMIN", "HALL_OPERATOR"],
  LEDGER_WRITE: ["ADMIN"],
  DAILY_REPORT_RUN: ["ADMIN", "HALL_OPERATOR"],
  DAILY_REPORT_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  OVERSKUDD_READ: ["ADMIN"],
  OVERSKUDD_WRITE: ["ADMIN"],
  USER_ROLE_WRITE: ["ADMIN"],
  ROOM_CONTROL_READ: ["ADMIN"],
  ROOM_CONTROL_WRITE: ["ADMIN"]
} as const;

export type AdminPermission = keyof typeof ADMIN_ACCESS_POLICY_DEFINITION;

export const ADMIN_ACCESS_POLICY: Record<AdminPermission, readonly UserRole[]> =
  ADMIN_ACCESS_POLICY_DEFINITION;

export function canAccessAdminPermission(role: UserRole, permission: AdminPermission): boolean {
  return ADMIN_ACCESS_POLICY[permission].includes(role);
}

export function assertAdminPermission(role: UserRole, permission: AdminPermission, message?: string): void {
  if (canAccessAdminPermission(role, permission)) {
    return;
  }
  throw new DomainError("FORBIDDEN", message ?? "Du har ikke tilgang til dette endepunktet.");
}
