import type { Role } from "../auth/Session.js";

export interface SidebarLeaf {
  kind: "leaf";
  id: string;
  path: string;
  icon: string;
  labelKey: string;
  module?: string;
  roles?: Role[];
  agentOnly?: boolean;
  superAdminOnly?: boolean;
}

export interface SidebarGroup {
  kind: "group";
  id: string;
  icon: string;
  labelKey: string;
  module?: string;
  roles?: Role[];
  agentOnly?: boolean;
  superAdminOnly?: boolean;
  /**
   * When true, the group renders open on initial load (legacy parity for
   * "Kontant inn/ut" which is expanded-by-default in the legacy sidebar).
   */
  defaultExpanded?: boolean;
  children: SidebarLeaf[];
}

export interface SidebarHeader {
  kind: "header";
  labelKey: string;
}

export type SidebarNode = SidebarLeaf | SidebarGroup | SidebarHeader;

// Legacy admin-sidebar layout (Hovednavigasjon-section, 16 menu-items 1:1
// med legacy Spillorama Admin V1.0 — se docs/architecture/WIREFRAME_CATALOG.md
// PDF #16). Rekkefølgen + grupperingen er styrt av screenshot Tobias delte
// 2026-04-27. Eksisterende admin-extras (role-management, adminUser/hall/etc.)
// ligger under header'en, men etter de 16 legacy-elementene for å bevare
// 1:1-rekkefølgen øverst. Spillorama-Live-iframe-section er fjernet (PR #630)
// — alle features er native i admin.
export const adminSidebar: SidebarNode[] = [
  { kind: "header", labelKey: "main_navigation" },

  // 1. Dashboard
  { kind: "leaf", id: "dashboard", path: "/admin", icon: "fa fa-dashboard", labelKey: "dashboard" },

  // 2. Kontant inn/ut (expanded by default — legacy default-state)
  {
    kind: "group",
    id: "cash-inout",
    icon: "fa fa-money",
    labelKey: "cash_in_out",
    defaultExpanded: true,
    children: [
      { kind: "leaf", id: "cash-inout-overview", path: "/agent/cashinout", icon: "fa fa-circle-o", labelKey: "cash_in_out" },
      { kind: "leaf", id: "cash-inout-sold-tickets", path: "/sold-tickets", icon: "fa fa-circle-o", labelKey: "sold_tickets" },
    ],
  },

  // Game 1 master-konsoll (top-level — tidligere under Spillorama Live)
  { kind: "leaf", id: "game1-master-console", path: "/game1/master/placeholder", icon: "fa fa-bolt", labelKey: "spillorama_master_console" },

  // 3. Spilleradministrasjon (expandable)
  {
    kind: "group",
    id: "player-management",
    icon: "fa fa-users",
    labelKey: "player_management",
    module: "Players Management",
    children: [
      { kind: "leaf", id: "player", path: "/player", icon: "fa fa-circle-o", labelKey: "approved_players" },
      { kind: "leaf", id: "pendingRequests", path: "/pendingRequests", icon: "fa fa-circle-o", labelKey: "pending_requests" },
      { kind: "leaf", id: "rejectedRequests", path: "/rejectedRequests", icon: "fa fa-circle-o", labelKey: "reject_requests" },
    ],
  },

  // 4. Tidsplanadministrasjon
  { kind: "leaf", id: "schedules", path: "/schedules", icon: "fa fa-calendar", labelKey: "schedule_management", module: "Schedule Management" },

  // 5. Opprettelse av spill
  { kind: "leaf", id: "gameManagement", path: "/gameManagement", icon: "fa fa-plus-square", labelKey: "game_creation_management", module: "Game Creation Management" },

  // 6. Lagret spillliste
  { kind: "leaf", id: "savedGameList", path: "/savedGameList", icon: "fa fa-list", labelKey: "saved_game_list", module: "Saved Game List" },

  // 7. Legg til fysiske billetter
  { kind: "leaf", id: "addPhysicalTickets", path: "/addPhysicalTickets", icon: "fa fa-ticket", labelKey: "add_physical_tickets", module: "Physical Tickets" },

  // 8. Administrasjon av fysiske billetter
  { kind: "leaf", id: "physicalTicketManagement", path: "/physicalTicketManagement", icon: "fa fa-th-list", labelKey: "physical_ticket_management", module: "Physical Tickets" },

  // 9. Fysisk uttak
  { kind: "leaf", id: "physicalCashOut", path: "/physical/cash-out", icon: "fa fa-money", labelKey: "physical_cash_out", module: "Physical Tickets" },

  // 10. Produktadministrasjon
  {
    kind: "group",
    id: "product-management",
    icon: "fa fa-shopping-cart",
    labelKey: "product_management",
    module: "Product Management",
    children: [
      { kind: "leaf", id: "productList", path: "/productList", icon: "fa fa-circle-o", labelKey: "product_list" },
      { kind: "leaf", id: "categoryList", path: "/categoryList", icon: "fa fa-circle-o", labelKey: "category_list" },
      { kind: "leaf", id: "orderHistory", path: "/orderHistory", icon: "fa fa-circle-o", labelKey: "order_history" },
    ],
  },

  // 11. Rapportadministrasjon
  {
    kind: "group",
    id: "report-management",
    icon: "fa fa-bar-chart",
    labelKey: "report_management",
    module: "Report Management",
    children: [
      { kind: "leaf", id: "reportGame1", path: "/reportGame1", icon: "fa fa-circle-o", labelKey: "game1" },
      { kind: "leaf", id: "reportManagementGame1", path: "/reportManagement/game1", icon: "fa fa-circle-o", labelKey: "report_management_game1" },
      { kind: "leaf", id: "reportGame2", path: "/reportGame2", icon: "fa fa-circle-o", labelKey: "game2" },
      { kind: "leaf", id: "reportGame3", path: "/reportGame3", icon: "fa fa-circle-o", labelKey: "game3" },
      { kind: "leaf", id: "reportGame4", path: "/reportGame4", icon: "fa fa-circle-o", labelKey: "game4" },
      { kind: "leaf", id: "reportGame5", path: "/reportGame5", icon: "fa fa-circle-o", labelKey: "game5" },
      { kind: "leaf", id: "physicalTicketReport", path: "/physicalTicketReport", icon: "fa fa-circle-o", labelKey: "physical_ticket" },
      { kind: "leaf", id: "uniqueGameReport", path: "/uniqueGameReport", icon: "fa fa-circle-o", labelKey: "unique_ticket" },
      { kind: "leaf", id: "redFlagCategory", path: "/redFlagCategory", icon: "fa fa-circle-o", labelKey: "red_flag_category" },
      { kind: "leaf", id: "totalRevenueReport", path: "/totalRevenueReport", icon: "fa fa-circle-o", labelKey: "total_revenue_report" },
    ],
  },

  // 12. Utbetalingsadministrasjon
  {
    kind: "group",
    id: "payout-management",
    icon: "fa fa-google-wallet",
    labelKey: "payout_management",
    module: "Payout Management",
    children: [
      { kind: "leaf", id: "payoutPlayer", path: "/payoutPlayer", icon: "fa fa-circle-o", labelKey: "payout_for_players" },
      { kind: "leaf", id: "payoutTickets", path: "/payoutTickets", icon: "fa fa-circle-o", labelKey: "payout_for_ticket" },
    ],
  },

  // 13. Hallspesifikke rapporter
  { kind: "leaf", id: "hallSpecificReport", path: "/hallSpecificReport", icon: "fa fa-bank", labelKey: "hall_specific_reports" },

  // 14. Lommebokadministrasjon
  { kind: "leaf", id: "wallet", path: "/wallet", icon: "fa fa-credit-card", labelKey: "wallet_management", module: "Wallet Management" },

  // 15. Transaksjonsadministrasjon (expandable)
  {
    kind: "group",
    id: "transactions-management",
    icon: "fa fa-exchange",
    labelKey: "transactions_management",
    module: "Transactions Management",
    children: [
      { kind: "leaf", id: "depositRequests", path: "/deposit/requests", icon: "fa fa-circle-o", labelKey: "deposit_request" },
      { kind: "leaf", id: "depositHistory", path: "/deposit/history", icon: "fa fa-circle-o", labelKey: "deposit_history" },
      // BIN-655 — generisk transaksjons-logg (wallet + agent + payment-requests).
      { kind: "leaf", id: "transactionsLog", path: "/transactions/log", icon: "fa fa-circle-o", labelKey: "transactions_log" },
    ],
  },

  // 16. Uttaksadministrasjon
  {
    kind: "group",
    id: "withdraw-management",
    icon: "fa fa-sign-out",
    labelKey: "withdraw_management",
    module: "Withdraw Management",
    children: [
      { kind: "leaf", id: "withdrawInHall", path: "/withdraw/requests/hall", icon: "fa fa-circle-o", labelKey: "withdraw_request_in_hall" },
      { kind: "leaf", id: "withdrawInBank", path: "/withdraw/requests/bank", icon: "fa fa-circle-o", labelKey: "withdraw_request_in_bank" },
      { kind: "leaf", id: "withdrawHistoryHall", path: "/withdraw/history/hall", icon: "fa fa-circle-o", labelKey: "withdraw_history_hall" },
      { kind: "leaf", id: "withdrawHistoryBank", path: "/withdraw/history/bank", icon: "fa fa-circle-o", labelKey: "withdraw_history_bank" },
      { kind: "leaf", id: "withdrawEmails", path: "/withdraw/list/emails", icon: "fa fa-circle-o", labelKey: "add_email_account" },
      { kind: "leaf", id: "withdrawXmlBatches", path: "/withdraw/xml-batches", icon: "fa fa-file-code-o", labelKey: "withdraw_xml_batches" },
    ],
  },

  // ── Tilleggselementer som ikke er i legacy-screenshotet, men som
  //    fortsatt eies av admin-panelet (role-management, user-management,
  //    fysiske bonger PT1-PT5 etc.). Plasseres etter de 16 legacy-
  //    elementene for å bevare 1:1-rekkefølgen øverst.
  //    Spillorama Live-iframe-section ble fjernet i PR #630 (alle features
  //    er native i admin nå).

  { kind: "leaf", id: "track-spending", path: "/players/track-spending", icon: "fa fa-gamepad", labelKey: "tracking_player_spending", module: "Tracking Player Spending" },
  { kind: "leaf", id: "gameType", path: "/gameType", icon: "fa fa-gamepad", labelKey: "game_type", module: "Game Type" },

  {
    kind: "group",
    id: "other-games",
    icon: "fa fa-bar-chart",
    labelKey: "other_games",
    children: [
      { kind: "leaf", id: "wheelOfFortune", path: "/wheelOfFortune", icon: "fa fa-circle-o", labelKey: "wheel_of_fortune" },
      { kind: "leaf", id: "treasureChest", path: "/treasureChest", icon: "fa fa-circle-o", labelKey: "treasure_chest" },
      { kind: "leaf", id: "mysteryGame", path: "/mystery", icon: "fa fa-circle-o", labelKey: "mystery_game" },
      { kind: "leaf", id: "colorDraft", path: "/colorDraft", icon: "fa fa-circle-o", labelKey: "color_draft" },
    ],
  },

  { kind: "leaf", id: "physicalCheckBingo", path: "/physical/check-bingo", icon: "fa fa-check-circle-o", labelKey: "check_bingo_stamp", module: "Physical Tickets" },
  // PR-PT6 — PT1-PT5 admin-UI (CSV-import, range-registrering, aktive ranges,
  // pending payouts). Egen undergruppe under "Fysiske bonger" for å gruppere
  // de nye sidene uten å bryte layout-et for eksisterende leaf-entries.
  {
    kind: "group",
    id: "physical-tickets-live",
    icon: "fa fa-ticket",
    labelKey: "pt_nav_group_title",
    module: "Physical Tickets",
    children: [
      { kind: "leaf", id: "physical-import", path: "/physical/import", icon: "fa fa-upload", labelKey: "pt_import_csv_title", module: "Physical Tickets" },
      { kind: "leaf", id: "physical-range-register", path: "/physical/ranges/register", icon: "fa fa-plus-square", labelKey: "pt_range_register_title", module: "Physical Tickets" },
      { kind: "leaf", id: "physical-active-ranges", path: "/physical/ranges", icon: "fa fa-list", labelKey: "pt_active_ranges_title", module: "Physical Tickets" },
      { kind: "leaf", id: "physical-pending-payouts", path: "/physical/payouts", icon: "fa fa-money", labelKey: "pt_pending_payouts_title", module: "Physical Tickets" },
    ],
  },

  {
    kind: "group",
    id: "unique-id",
    icon: "fa fa-id-card",
    labelKey: "unique_id_modules",
    module: "Unique ID Modules",
    children: [
      { kind: "leaf", id: "uniqueId", path: "/uniqueId", icon: "fa fa-circle-o", labelKey: "generate_unique_id" },
      { kind: "leaf", id: "uniqueIdList", path: "/uniqueIdList", icon: "fa fa-circle-o", labelKey: "unique_id_list" },
    ],
  },
  {
    kind: "group",
    id: "other-modules",
    icon: "fa fa-bar-chart",
    labelKey: "other_modules",
    children: [{ kind: "leaf", id: "theme", path: "/theme", icon: "fa fa-circle-o", labelKey: "theme" }],
  },
  {
    kind: "group",
    id: "pattern-management",
    icon: "fa fa-paint-brush",
    labelKey: "pattern_management",
    module: "Pattern Management",
    children: [{ kind: "leaf", id: "patternMenu", path: "/patternMenu", icon: "fa fa-circle-o", labelKey: "pattern_management" }],
  },

  { kind: "leaf", id: "adminUser", path: "/adminUser", icon: "fa fa-users mr-20", labelKey: "admin_management", roles: ["admin", "super-admin"] },
  { kind: "leaf", id: "agent", path: "/agent", icon: "fa fa-users mr-20", labelKey: "agent_management", roles: ["admin", "super-admin"] },
  { kind: "leaf", id: "hall", path: "/hall", icon: "fa fa-bank", labelKey: "hall_management", roles: ["admin", "super-admin"] },
  { kind: "leaf", id: "groupHall", path: "/groupHall", icon: "fa fa-bank", labelKey: "group_of_halls_management", roles: ["admin", "super-admin"] },

  {
    kind: "group",
    id: "role-management",
    icon: "fa fa-users mr-20",
    labelKey: "role_management",
    module: "Role Management",
    roles: ["admin", "super-admin"],
    children: [
      { kind: "leaf", id: "role", path: "/role", icon: "fa fa-circle-o", labelKey: "role_list_title" },
      { kind: "leaf", id: "role-matrix", path: "/role/matrix", icon: "fa fa-circle-o", labelKey: "role_matrix_title" },
      { kind: "leaf", id: "role-assign", path: "/role/assign", icon: "fa fa-circle-o", labelKey: "assign_role_title" },
      { kind: "leaf", id: "role-agent", path: "/role/agent", icon: "fa fa-circle-o", labelKey: "agent_role_permissions_title" },
    ],
  },

  { kind: "leaf", id: "riskCountry", path: "/riskCountry", icon: "fa fa-users mr-20", labelKey: "risk_country", roles: ["admin", "super-admin"] },
  // PR-B6 (BIN-664) — security / blocked-IP admin.
  { kind: "leaf", id: "blockedIp", path: "/blockedIp", icon: "fa fa-ban mr-20", labelKey: "blocked_ip_table", roles: ["admin", "super-admin"] },
  { kind: "leaf", id: "hallAccountReport", path: "/hallAccountReport", icon: "fa fa-users mr-20", labelKey: "hall_account_report" },

  { kind: "leaf", id: "leaderboard", path: "/leaderboard", icon: "fa fa-credit-card-alt", labelKey: "leaderboard_management" },
  { kind: "leaf", id: "voucher", path: "/voucher", icon: "fa fa-users mr-20", labelKey: "voucher_management" },

  // BIN-700: tier-CRUD + spiller-liste.
  {
    kind: "group",
    id: "loyalty-management",
    icon: "fa fa-star",
    labelKey: "loyalty_management",
    module: "Loyalty Management",
    children: [
      { kind: "leaf", id: "loyaltyManagement", path: "/loyaltyManagement", icon: "fa fa-circle-o", labelKey: "loyalty_tier_list_title" },
      { kind: "leaf", id: "loyaltyPlayers", path: "/loyaltyManagement/players", icon: "fa fa-circle-o", labelKey: "loyalty_players_title" },
    ],
  },

  { kind: "leaf", id: "sms-advertisement", path: "/sms-advertisement", icon: "fa fa-mobile mr-20", labelKey: "sms_advertisement", roles: ["admin", "super-admin"] },
  { kind: "leaf", id: "cms", path: "/cms", icon: "fa fa-users mr-20", labelKey: "cms_management", roles: ["admin", "super-admin"] },
  { kind: "leaf", id: "settings", path: "/settings", icon: "fa fa-gears mr-20", labelKey: "settings", roles: ["admin", "super-admin"] },
  { kind: "leaf", id: "system-information", path: "/system/systemInformation", icon: "fa fa-bar-chart", labelKey: "system_information", superAdminOnly: true },
  // BIN-678 — runtime-diagnostikk (version, build-SHA, uptime, feature-flags).
  { kind: "leaf", id: "system-diagnostics", path: "/system/info", icon: "fa fa-heartbeat", labelKey: "system_diagnostics", superAdminOnly: true },
  // BIN-655 (alt) — audit-logg (append-only compliance-view).
  { kind: "leaf", id: "audit-log", path: "/auditLog", icon: "fa fa-history", labelKey: "audit_log_title", superAdminOnly: true },
  // HIGH-11 — chat-moderasjon (Casino Review-finding). ADMIN + HALL_OPERATOR
  // + SUPPORT (sistnevnte er read-only på backend; sidebar viser elementet
  // for admin-rollene).
  { kind: "leaf", id: "chat-moderation", path: "/admin/chat-moderation", icon: "fa fa-comments mr-20", labelKey: "chat_moderation_title", roles: ["admin", "super-admin", "hall-operator"] },
];

// Agent sidebar — Agent-portal V1.0 (06.01.2025) + V2.0 (10.07.2024).
// Struktur: Dashboard, Players Management ▾, Add Physical Ticket,
// Game Management ▾, Cash In/Out Management ▾, Unique ID Management,
// Physical Cashout. Legacy /agent/dashboard, /agent/players etc. er
// placeholder-sider som fylles inn i oppfølger-PR-er.
export const agentSidebar: SidebarNode[] = [
  { kind: "header", labelKey: "main_navigation" },
  { kind: "leaf", id: "agent-dashboard", path: "/agent/dashboard", icon: "fa fa-dashboard", labelKey: "dashboard" },
  {
    kind: "group",
    id: "agent-player-management",
    icon: "fa fa-users",
    labelKey: "player_management",
    children: [
      { kind: "leaf", id: "agent-players", path: "/agent/players", icon: "fa fa-circle-o", labelKey: "approved_players" },
      { kind: "leaf", id: "agent-pending", path: "/pendingRequests", icon: "fa fa-circle-o", labelKey: "pending_requests" },
      { kind: "leaf", id: "agent-rejected", path: "/rejectedRequests", icon: "fa fa-circle-o", labelKey: "reject_requests" },
    ],
  },
  { kind: "leaf", id: "agent-physical-tickets", path: "/agent/physical-tickets", icon: "fa fa-ticket", labelKey: "add_physical_tickets" },
  {
    kind: "group",
    id: "agent-game-management",
    icon: "fa fa-gamepad",
    labelKey: "agent_game_management",
    children: [
      { kind: "leaf", id: "agent-games-overview", path: "/agent/games", icon: "fa fa-circle-o", labelKey: "agent_games_overview" },
    ],
  },
  {
    kind: "group",
    id: "agent-cash-in-out",
    icon: "fa fa-money",
    labelKey: "agent_cash_in_out_management",
    children: [
      { kind: "leaf", id: "agent-cash-overview", path: "/agent/cash-in-out", icon: "fa fa-circle-o", labelKey: "cash_in_out" },
      // Wireframe §17.12: Sell Products (kiosk-flyt — kaffe/sjokolade/ris).
      // Wireframe §17.29: Order History — fortsatt placeholder, kobles inn
      // i en oppfølger-PR (BIN-650).
      { kind: "leaf", id: "agent-sell-products", path: "/agent/sellProduct", icon: "fa fa-shopping-cart", labelKey: "sell_products" },
    ],
  },
  { kind: "leaf", id: "agent-unique-id", path: "/agent/unique-id", icon: "fa fa-id-card", labelKey: "agent_unique_id_management" },
  { kind: "leaf", id: "agent-bingo-check", path: "/agent/bingo-check", icon: "fa fa-check-circle-o", labelKey: "agent_check_bingo" },
  { kind: "leaf", id: "agent-physical-cashout", path: "/agent/physical-cashout", icon: "fa fa-ticket", labelKey: "agent_physical_cashout" },
  // Wireframe §17.32: Past Game Winning History (agent-view).
  { kind: "leaf", id: "agent-past-winning-history", path: "/agent/past-winning-history", icon: "fa fa-history", labelKey: "past_game_winning_history" },
  // Wireframe §17.31: Sold Ticket — shift-scoped list av billetter solgt
  // av agent. Bruker `/agent/sold-tickets`-aliaset slik at routes-guarden
  // tillater AGENT/HALL_OPERATOR-tilgang.
  { kind: "leaf", id: "agent-sold-tickets", path: "/agent/sold-tickets", icon: "fa fa-list", labelKey: "sold_tickets" },
];

export function sidebarFor(role: Role): SidebarNode[] {
  // HALL_OPERATOR shares the agent-portal UX with AGENT. ADMIN/super-admin
  // keep the full admin-panel sidebar.
  return role === "agent" || role === "hall-operator" ? agentSidebar : adminSidebar;
}
