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
  MACHINE_REPORT_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT", "AGENT"],
  /**
   * BIN-622: Game Management (admin-katalog av spill-varianter).
   *   - GAME_MGMT_READ : liste + detalj + tickets-view. Alle admin-roller
   *     (HALL_OPERATOR ser samme liste; hall-scope håndheves i service-lag
   *     via config_json.hallIds når BIN-621 lander).
   *   - GAME_MGMT_WRITE: opprett/oppdatér/slett/repeat. ADMIN + HALL_OPERATOR
   *     (hall-operator styrer hall-lokale varianter; cross-hall er ADMIN-
   *     domain men scope-sjekken er løftet ut av første versjon siden
   *     hall-binding fortsatt lever i config_json).
   */
  GAME_MGMT_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  GAME_MGMT_WRITE: ["ADMIN", "HALL_OPERATOR"],
  /**
   * BIN-628: regulatorisk track-spending aggregat (pengespillforskriften §11
   * forebyggende tiltak). ADMIN + HALL_OPERATOR + SUPPORT:
   *   - ADMIN ser på tvers av alle haller (global oversikt).
   *   - HALL_OPERATOR ser aggregat for egen hall — hall-scope håndheves
   *     i route via assertUserHallScope når hallId er satt.
   *   - SUPPORT har read-tilgang for compliance-innsyn (samme mønster som
   *     PLAYER_AML_READ). SUPPORT kan se på tvers av haller — kundestøtte
   *     trenger fullstendig oversikt ved kundesamtaler.
   * Ingen WRITE-variant: dette er et rent aggregat-endepunkt, ingen mutasjon.
   */
  TRACK_SPENDING_READ: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  /**
   * BIN-626: DailySchedule (daglig spill-plan per hall).
   *   - SCHEDULE_READ : liste + detalj + subgame-details. Alle admin-roller.
   *     Hall-scope (HALL_OPERATOR ser kun egen hall) håndheves i route via
   *     resolveHallScopeFilter / assertUserHallScope.
   *   - SCHEDULE_WRITE: opprett/oppdatér/slett + special-schedule. ADMIN +
   *     HALL_OPERATOR (hall-operator styrer egen hall's plan). SUPPORT er
   *     bevisst utelatt — compliance-rolle, ikke drift.
   */
  SCHEDULE_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  SCHEDULE_WRITE: ["ADMIN", "HALL_OPERATOR"],
  /**
   * BIN-627: Pattern CRUD (25-bit bitmask mønstre for Game 1 + Game 3).
   *   - PATTERN_READ : liste + detalj + dynamic-menu. Alle admin-roller.
   *     Mønstre er ikke hall-bundne — samme katalog for alle haller.
   *   - PATTERN_WRITE: opprett/oppdatér/slett. ADMIN + HALL_OPERATOR
   *     (hall-operator kan trenge å tilpasse mønster-katalog; cross-hall-
   *     effekter er små siden hver plan refererer eksplisitt pattern-id).
   *     SUPPORT er bevisst utelatt — kompeliance-rolle, ikke drift.
   */
  PATTERN_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  PATTERN_WRITE: ["ADMIN", "HALL_OPERATOR"],
  /**
   * BIN-665: HallGroup CRUD (cross-hall spill-grupper for Game 2 + Game 3).
   *   - HALL_GROUP_READ : liste + detalj. Alle admin-roller.
   *     Hall-grupper er globalt admin-domain — ikke hall-scope-bundet (en
   *     gruppe spenner per definisjon over flere haller). HALL_OPERATOR
   *     ser samme liste; medlemsskaps-operasjoner over egen hall håndheves
   *     i route-laget når Agent A kobler frontend.
   *   - HALL_GROUP_WRITE: opprett/oppdatér/slett. ADMIN + HALL_OPERATOR.
   *     SUPPORT er bevisst utelatt — compliance-rolle, ikke drift. Samme
   *     mønster som HALL_WRITE / PATTERN_WRITE.
   */
  HALL_GROUP_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  HALL_GROUP_WRITE: ["ADMIN", "HALL_OPERATOR"],
  /**
   * BIN-620: GameType CRUD (topp-nivå katalog av spill-typer).
   *   - GAME_TYPE_READ : liste + detalj. Alle admin-roller. GameType-
   *     katalogen er global (ikke hall-bunden) og SUPPORT trenger
   *     innsyn for kundestøtte-kontekst ("hva er dette spillet?").
   *   - GAME_TYPE_WRITE: opprett/oppdatér/slett. ADMIN-only fordi
   *     spill-typer er sentralt definert og påvirker hele systemet
   *     (referenced by GameManagement, Pattern, SubGame, DailySchedule).
   *     HALL_OPERATOR er bevisst utelatt — hall-operator endrer ikke
   *     globalt spill-katalog. Samme mønster som GAME_CATALOG_WRITE.
   */
  GAME_TYPE_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  GAME_TYPE_WRITE: ["ADMIN"],
  /**
   * BIN-621: SubGame CRUD (navngitte gjenbrukbare pattern-bundles).
   *   - SUB_GAME_READ : liste + detalj. Alle admin-roller.
   *   - SUB_GAME_WRITE: opprett/oppdatér/slett. ADMIN + HALL_OPERATOR.
   *     SubGame-maler er mindre sentrale enn GameType (de refereres fra
   *     DailySchedule men endrer ikke selve spill-typen), så hall-operator
   *     kan administrere egen hall's bundles — samme mønster som
   *     PATTERN_WRITE / SCHEDULE_WRITE. SUPPORT er bevisst utelatt.
   */
  SUB_GAME_READ:   ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  SUB_GAME_WRITE:  ["ADMIN", "HALL_OPERATOR"],
  /**
   * BIN-668: LeaderboardTier CRUD (admin-konfig av plass→premie/poeng-
   * mapping). Dette er ren ADMIN-konfigurasjon — ikke runtime-state.
   *   - LEADERBOARD_TIER_READ : liste + detalj. Alle admin-roller. SUPPORT
   *     trenger read-tilgang for compliance/kundestøtte ("hvilken premie
   *     lå på plass 3 forrige uke?").
   *   - LEADERBOARD_TIER_WRITE: opprett/oppdatér/slett. ADMIN-only fordi
   *     premie-strukturen er sentralt definert (samme mønster som
   *     GAME_TYPE_WRITE / GAME_CATALOG_WRITE). HALL_OPERATOR er bevisst
   *     utelatt — leaderboard-tier er ikke hall-lokal konfig.
   */
  LEADERBOARD_TIER_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  LEADERBOARD_TIER_WRITE: ["ADMIN"],
  /**
   * BIN-624: SavedGame CRUD (gjenbrukbare GameManagement-templates).
   *   - SAVED_GAME_READ : liste + detalj. Alle admin-roller.
   *   - SAVED_GAME_WRITE: opprett/oppdatér/slett + load-to-game. ADMIN +
   *     HALL_OPERATOR. SavedGame-maler er template-katalog (aldri kjørbare
   *     spill), så hall-operator kan lagre/laste egne maler — samme mønster
   *     som SUB_GAME_WRITE. SUPPORT er bevisst utelatt (compliance-rolle,
   *     ikke drift; SUPPORT får kun READ).
   */
  SAVED_GAME_READ:   ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  SAVED_GAME_WRITE:  ["ADMIN", "HALL_OPERATOR"],
  /**
   * BIN-677: System settings (system-wide config: timezone, currency, logo-
   * refs, klient-versjoner, feature-flags).
   *   - SETTINGS_READ  : liste + detalj. Alle admin-roller. SUPPORT trenger
   *     innsyn ved feilsøking ("hvilken iOS-versjon er i kraft?").
   *   - SETTINGS_WRITE : PATCH-er én eller flere nøkler. ADMIN-only fordi
   *     endringer er globale og kan påvirke alle haller/spillere.
   *     HALL_OPERATOR styrer per-hall-konfig via HALL_WRITE; system-wide
   *     settings er sentralt ADMIN-ansvar. Matches GAME_TYPE_WRITE /
   *     LEADERBOARD_TIER_WRITE.
   */
  SETTINGS_READ:    ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  SETTINGS_WRITE:   ["ADMIN"],
  /**
   * BIN-677: Maintenance-vinduer (planlagt/aktiv vedlikeholdsmodus).
   *   - MAINTENANCE_READ  : liste + detalj. Alle admin-roller. SUPPORT må
   *     kunne se om et vindu er aktivt ved kundesamtaler.
   *   - MAINTENANCE_WRITE : aktiver/deaktiver (PUT) + fremtidig CRUD.
   *     ADMIN-only fordi vedlikeholdsmodus stopper live spill globalt
   *     — ikke en hall-operatør-beslutning.
   */
  MAINTENANCE_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  MAINTENANCE_WRITE: ["ADMIN"],
  /**
   * BIN-679: MiniGames config CRUD (Wheel + Chest + Mystery + Colordraft).
   * Sentral konfig for de fire Game 1 mini-spillene — én singleton-rad per
   * spill-type. Ren admin-katalog (runtime-integrasjon er egen PR).
   *   - MINI_GAMES_READ : liste + detalj. Alle admin-roller. SUPPORT
   *     trenger read-tilgang for compliance/kundestøtte ("hvilken premie-
   *     struktur gjaldt i dag?").
   *   - MINI_GAMES_WRITE: oppdatér (singleton PUT). ADMIN-only fordi mini-
   *     game-konfigen er sentralt definert og gjelder alle haller (samme
   *     mønster som GAME_CATALOG_WRITE / LEADERBOARD_TIER_WRITE).
   *     HALL_OPERATOR er bevisst utelatt — dette er ikke hall-lokal konfig.
   */
  MINI_GAMES_READ:   ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  MINI_GAMES_WRITE:  ["ADMIN"],
  /**
   * BIN-676: CMS content + FAQ (aboutus, terms, support, links, responsible-
   * gaming + Q&A-liste).
   *   - CMS_READ  : hent tekst-sider + FAQ-liste. Alle admin-roller. SUPPORT
   *     trenger read-tilgang for kundestøtte ("hva står i terms-siden
   *     akkurat nå?"), HALL_OPERATOR for å kontekstualisere hall-innhold.
   *   - CMS_WRITE : oppdatér tekst-sider + FAQ CRUD. ADMIN-only fordi
   *     CMS-innhold er globalt og regulatorisk-sensitivt (responsible-gaming
   *     er gated av BIN-680 inntil versjons-historikk er på plass). Samme
   *     mønster som GAME_CATALOG_WRITE / LEADERBOARD_TIER_WRITE.
   *     HALL_OPERATOR er bevisst utelatt — CMS er ikke hall-lokal konfig.
   */
  CMS_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  CMS_WRITE: ["ADMIN"],
  /**
   * GAME1_SCHEDULE PR2: per-hall ready-flow i Game 1.
   *   - GAME1_GAME_READ : hent ready-status for et spill på tvers av haller
   *     + liste spawned games. Alle admin-roller + AGENT (bingovert trenger
   *     innsyn i egen hall's status). Hall-scope håndheves i route-laget
   *     via assertUserHallScope for HALL_OPERATOR/AGENT.
   *   - GAME1_HALL_READY_WRITE: trykke "klar" / angre "klar" for en hall.
   *     ADMIN + HALL_OPERATOR + AGENT. SUPPORT er bevisst utelatt —
   *     compliance-rolle, ikke drift. Bingovert (AGENT eller HALL_OPERATOR)
   *     er primær-actor; ADMIN inkludert for drift/helpdesk ("ADMIN har
   *     alle"-invariant). Hall-scope håndheves i route.
   */
  GAME1_GAME_READ:         ["ADMIN", "HALL_OPERATOR", "SUPPORT", "AGENT"],
  GAME1_HALL_READY_WRITE:  ["ADMIN", "HALL_OPERATOR", "AGENT"],
  /**
   * GAME1_SCHEDULE PR3: master-control (start/pause/resume/stop/exclude_hall/
   * include_hall) for Game 1.
   *   - GAME1_MASTER_WRITE: trykke master-knapper. ADMIN + HALL_OPERATOR +
   *     AGENT (bingovert). SUPPORT er eksplisitt utelatt — master-rollen
   *     er drift, ikke compliance-review. Route-laget håndhever hall-scope:
   *     HALL_OPERATOR/AGENT må tilhøre `game.master_hall_id` (unntatt
   *     ADMIN som er globalt scope).
   */
  GAME1_MASTER_WRITE:      ["ADMIN", "HALL_OPERATOR", "AGENT"],
  /**
   * BIN-700: Loyalty-system (tier-CRUD + player-state + points-award +
   * tier-override).
   *   - LOYALTY_READ  : list tiers, detail, player-state. Alle admin-roller
   *     (ADMIN + HALL_OPERATOR + SUPPORT). SUPPORT trenger innsyn ved
   *     kundestøtte ("hvilken tier har spilleren? hvorfor fikk de ikke
   *     bonus?"), HALL_OPERATOR for hall-lokal oversikt ved VIP-håndtering.
   *   - LOYALTY_WRITE : tier-CRUD + points-award + tier-override. ADMIN-only
   *     fordi loyalty-tier-struktur er sentralt og manuelt points-tildeling
   *     er sensitivt (revisjons-kritisk, AuditLog). Samme mønster som
   *     GAME_TYPE_WRITE / LEADERBOARD_TIER_WRITE. HALL_OPERATOR er bevisst
   *     utelatt — tier-strukturen er ikke hall-lokal.
   */
  LOYALTY_READ:  ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  LOYALTY_WRITE: ["ADMIN"]
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
