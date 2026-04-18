import { DomainError } from "../game/BingoEngine.js";
import type { UserRole } from "./PlatformService.js";

const ADMIN_ACCESS_POLICY_DEFINITION = {
  ADMIN_PANEL_ACCESS: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
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
  GAME_SETTINGS_CHANGELOG_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  OVERSKUDD_READ: ["ADMIN"],
  OVERSKUDD_WRITE: ["ADMIN"],
  USER_ROLE_WRITE: ["ADMIN"],
  ROOM_CONTROL_READ: ["ADMIN", "HALL_OPERATOR"],
  ROOM_CONTROL_WRITE: ["ADMIN", "HALL_OPERATOR"],
  /** BIN-586: manuell deposit/withdraw-kø (kontant i hall, uttak over terskel). */
  PAYMENT_REQUEST_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  PAYMENT_REQUEST_WRITE: ["ADMIN", "HALL_OPERATOR"],
  /**
   * BIN-587 B2.2: KYC-moderasjon. ADMIN + SUPPORT kan se pending/rejected-
   * kø og approve/reject. HALL_OPERATOR er eksplisitt utelatt — compliance
   * er sentralt, ikke delegert per hall.
   */
  PLAYER_KYC_READ: ["ADMIN", "SUPPORT"],
  PLAYER_KYC_MODERATE: ["ADMIN", "SUPPORT"],
  /** PLAYER_KYC_OVERRIDE er destructive-path (forbi adapter-beslutning) — kun ADMIN. */
  PLAYER_KYC_OVERRIDE: ["ADMIN"],
  /**
   * BIN-587 B2.3: player lifecycle — hall-status, soft-delete/restore,
   * bankid-reverify, bulk-import, export. ADMIN + SUPPORT. HALL_OPERATOR
   * er eksplisitt utelatt — soft-delete er en sentralisert operasjon
   * (ikke per-hall), og hall-status-toggling går via ADMIN/SUPPORT som
   * del av compliance-flyt. Hall-nivå block-listing for problemspillere
   * håndteres av hall-operator via Spillvett, ikke via lifecycle-flag.
   */
  PLAYER_LIFECYCLE_WRITE: ["ADMIN", "SUPPORT"],
  /**
   * BIN-587 B3-aml: AML red-flag review + transaksjons-gjennomgang.
   * ADMIN + SUPPORT. HALL_OPERATOR er eksplisitt utelatt — AML er
   * sentralisert compliance, ikke delegert per hall.
   */
  PLAYER_AML_READ: ["ADMIN", "SUPPORT"],
  PLAYER_AML_WRITE: ["ADMIN", "SUPPORT"]
} as const;

export type AdminPermission = keyof typeof ADMIN_ACCESS_POLICY_DEFINITION;

export const ADMIN_ACCESS_POLICY: Record<AdminPermission, readonly UserRole[]> =
  ADMIN_ACCESS_POLICY_DEFINITION;

export function canAccessAdminPermission(role: UserRole, permission: AdminPermission): boolean {
  return ADMIN_ACCESS_POLICY[permission].includes(role);
}

export function listAdminPermissionsForRole(role: UserRole): AdminPermission[] {
  return (Object.keys(ADMIN_ACCESS_POLICY) as AdminPermission[]).filter((permission) =>
    canAccessAdminPermission(role, permission)
  );
}

export function getAdminPermissionMap(role: UserRole): Record<AdminPermission, boolean> {
  const map = {} as Record<AdminPermission, boolean>;
  for (const permission of Object.keys(ADMIN_ACCESS_POLICY) as AdminPermission[]) {
    map[permission] = canAccessAdminPermission(role, permission);
  }
  return map;
}

export function assertAdminPermission(role: UserRole, permission: AdminPermission, message?: string): void {
  if (canAccessAdminPermission(role, permission)) {
    return;
  }
  throw new DomainError("FORBIDDEN", message ?? "Du har ikke tilgang til dette endepunktet.");
}

/**
 * BIN-591: hall-scope guard for HALL_OPERATOR.
 *
 * Regler:
 *  - ADMIN: alltid tilgang (globalt scope). `targetHallId` ignoreres.
 *  - SUPPORT: tilsvarende globalt scope for read-operasjoner — kallsteder
 *    som trenger write-restriksjon må kontrollere rolle eksplisitt.
 *  - HALL_OPERATOR: må ha en `hallId` satt, og den må matche
 *    `targetHallId`. En operator uten tildelt hall (`hallId === null`)
 *    får FORBIDDEN — fail closed. En operator med annen hall får FORBIDDEN.
 *  - PLAYER: skal ikke nå hit (dekkes av assertAdminPermission), men
 *    fall-through blir FORBIDDEN.
 */
export function assertUserHallScope(
  user: { role: UserRole; hallId: string | null },
  targetHallId: string,
  message?: string
): void {
  if (user.role === "ADMIN" || user.role === "SUPPORT") {
    return;
  }
  if (user.role !== "HALL_OPERATOR") {
    throw new DomainError("FORBIDDEN", message ?? "Du har ikke tilgang til denne hallen.");
  }
  if (!user.hallId) {
    throw new DomainError(
      "FORBIDDEN",
      message ?? "Din bruker er ikke tildelt en hall — kontakt admin."
    );
  }
  if (user.hallId !== targetHallId) {
    throw new DomainError("FORBIDDEN", message ?? "Du har ikke tilgang til denne hallen.");
  }
}

/**
 * BIN-591: returner hallId-filter for list-queries. `undefined` betyr
 * «ingen filter» (ADMIN/SUPPORT ser alt). For HALL_OPERATOR tvinges
 * filter til deres hallId; operator uten hall får FORBIDDEN.
 */
export function resolveHallScopeFilter(
  user: { role: UserRole; hallId: string | null },
  explicitHallId?: string
): string | undefined {
  if (user.role === "HALL_OPERATOR") {
    if (!user.hallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Din bruker er ikke tildelt en hall — kontakt admin."
      );
    }
    if (explicitHallId && explicitHallId !== user.hallId) {
      throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne hallen.");
    }
    return user.hallId;
  }
  return explicitHallId;
}
