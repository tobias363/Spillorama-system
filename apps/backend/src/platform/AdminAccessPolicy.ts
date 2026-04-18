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
  PLAYER_AML_WRITE: ["ADMIN", "SUPPORT"],
  /**
   * BIN-587 B3-security: withdraw-email-allowlist, risk-countries,
   * blocked-IPs, audit-log-search. ADMIN + SUPPORT. HALL_OPERATOR er
   * eksplisitt utelatt — sikkerhets-konfig er sentralt.
   */
  SECURITY_READ: ["ADMIN", "SUPPORT"],
  SECURITY_WRITE: ["ADMIN", "SUPPORT"],
  AUDIT_LOG_READ: ["ADMIN", "SUPPORT"],
  /**
   * BIN-583 B3.1: agent-CRUD (admin/hall-operator-side).
   *   - AGENT_READ: liste + hent agent-profil. SUPPORT inkludert for
   *     compliance-innsyn.
   *   - AGENT_WRITE: opprett + endre agent, tildele haller. HALL_OPERATOR
   *     kan forvalte agenter i egen hall (hall-scope håndheves separat
   *     i route via assertUserHallScope).
   *   - AGENT_DELETE: destruktiv (soft-delete + aktiv-shift-blokk). Kun ADMIN.
   */
  AGENT_READ:   ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  AGENT_WRITE:  ["ADMIN", "HALL_OPERATOR"],
  AGENT_DELETE: ["ADMIN"],
  /**
   * BIN-583 B3.1: agent-shift-state.
   *   - AGENT_SHIFT_READ: alle admin-roller + agenten selv.
   *   - AGENT_SHIFT_WRITE: AGENT selv starter/avslutter egen shift;
   *     ADMIN inkludert for "ADMIN har alle tillatelser"-invariant +
   *     fremtidige helpdesk-scenarier. Faktisk owner-semantikk
   *     (shift.userId === caller.id) håndheves i route/service, ikke her.
   *   - AGENT_SHIFT_FORCE: manuell close av stuck shift — kun ADMIN.
   */
  AGENT_SHIFT_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT", "AGENT"],
  AGENT_SHIFT_WRITE: ["ADMIN", "AGENT"],
  AGENT_SHIFT_FORCE: ["ADMIN"],
  /**
   * BIN-587 B4a: fysiske papirbilletter. ADMIN + HALL_OPERATOR fordi
   * papirbillett-administrasjon er hall-lokalt. SUPPORT er bevisst
   * utelatt — er ikke hall-operativ rolle.
   */
  PHYSICAL_TICKET_WRITE: ["ADMIN", "HALL_OPERATOR"],
  /**
   * BIN-587 B4b: voucher-konfigurasjon (rabatt-koder).
   *   - VOUCHER_READ: liste + detalj. ADMIN + HALL_OPERATOR + SUPPORT
   *     (SUPPORT kan trenge å verifisere koder under kundestøtte).
   *   - VOUCHER_WRITE: opprette, endre, deaktivere — kun ADMIN siden
   *     marketing-rabatter er sentralt.
   */
  VOUCHER_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  VOUCHER_WRITE: ["ADMIN"],
  /**
   * BIN-583 B3.2: agent-transaksjons-operasjoner.
   *   - AGENT_CASH_WRITE: cash-in/out til spiller-wallet. AGENT kun på
   *     egen shift; ADMIN inkludert for "ADMIN har alle"-invariant
   *     (owner-semantikk håndheves i service-laget).
   *   - AGENT_TICKET_WRITE: registrer digital billett + selg/kansellér
   *     fysisk billett.
   *   - AGENT_TX_READ: lese transaksjonslogg. Inkluderer admin-roller
   *     for overview og AGENT for egen logg.
   */
  AGENT_CASH_WRITE:   ["ADMIN", "AGENT"],
  AGENT_TICKET_WRITE: ["ADMIN", "AGENT"],
  AGENT_TX_READ:      ["ADMIN", "HALL_OPERATOR", "SUPPORT", "AGENT"],
  /**
   * BIN-583 B3.3: daglig kasse-oppgjør.
   *   - AGENT_SETTLEMENT_WRITE: control-daily-balance + close-day. AGENT
   *     for egen shift; ADMIN inkludert for "ADMIN har alle"-invariant.
   *     Owner-sjekk i service-laget.
   *   - AGENT_SETTLEMENT_READ: lese settlements. Alle admin-roller +
   *     AGENT (egen historikk).
   *   - AGENT_SETTLEMENT_FORCE: force-close utover diff-threshold eller
   *     edit-settlement post-close — kun ADMIN.
   */
  AGENT_SETTLEMENT_WRITE: ["ADMIN", "AGENT"],
  AGENT_SETTLEMENT_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT", "AGENT"],
  AGENT_SETTLEMENT_FORCE: ["ADMIN"],
  /**
   * BIN-583 B3.6: produkt-katalog + hall-assignment (kiosk-salg).
   *   - PRODUCT_READ: alle admin-roller + AGENT (trenger å liste egne
   *     hall-produkter for salg).
   *   - PRODUCT_WRITE: katalog-CRUD + hall-binding — ADMIN + HALL_OPERATOR
   *     (hall-operatør styrer hvilke produkter som selges i egen hall;
   *     katalog-opprett er ADMIN-only men bindinger er hall-lokale).
   */
  PRODUCT_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT", "AGENT"],
  PRODUCT_WRITE: ["ADMIN", "HALL_OPERATOR"],
  /**
   * BIN-583 B3.6: agent-siden av produkt-salg (cart + finalize).
   * AGENT kun på egen shift; ADMIN inkludert for "ADMIN har alle"-invariant.
   */
  AGENT_PRODUCT_SELL: ["ADMIN", "AGENT"],
  /**
   * BIN-583 B3.4: ekstern-maskin-integrasjon (Metronia + B3.5 OK Bingo).
   *   - MACHINE_TICKET_WRITE: opprett/topup/close/void via agent-flyt.
   *     AGENT for egen shift; ADMIN for force + helpdesk.
   *   - MACHINE_REPORT_READ : rapporter (daily-sales, hall-summary,
   *     daily-report) tilgjengelig for alle admin-roller + AGENT for
   *     egen logg.
   */
  MACHINE_TICKET_WRITE: ["ADMIN", "AGENT"],
  MACHINE_REPORT_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT", "AGENT"]
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
