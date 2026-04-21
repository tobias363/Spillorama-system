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
  children: SidebarLeaf[];
}

export interface SidebarHeader {
  kind: "header";
  labelKey: string;
}

export type SidebarNode = SidebarLeaf | SidebarGroup | SidebarHeader;

// Spillorama Live — 11 native sections (NEW, ligger over legacy)
const spilloramaLive: SidebarGroup = {
  kind: "group",
  id: "spillorama-live",
  icon: "fa fa-bolt",
  labelKey: "spillorama_live",
  children: [
    { kind: "leaf", id: "live-dashboard", path: "/live/dashboard", icon: "fa fa-circle-o", labelKey: "spillorama_live_dashboard" },
    { kind: "leaf", id: "live-game-settings", path: "/live/game-settings", icon: "fa fa-circle-o", labelKey: "spillorama_game_settings" },
    { kind: "leaf", id: "live-games", path: "/live/games", icon: "fa fa-circle-o", labelKey: "spillorama_games" },
    { kind: "leaf", id: "live-halls", path: "/live/halls", icon: "fa fa-circle-o", labelKey: "spillorama_halls" },
    { kind: "leaf", id: "live-hall-display", path: "/live/hall-display", icon: "fa fa-circle-o", labelKey: "spillorama_hall_display" },
    { kind: "leaf", id: "live-terminals", path: "/live/terminals", icon: "fa fa-circle-o", labelKey: "spillorama_terminals" },
    { kind: "leaf", id: "live-hall-rules", path: "/live/hall-rules", icon: "fa fa-circle-o", labelKey: "spillorama_hall_rules" },
    { kind: "leaf", id: "live-wallet-compliance", path: "/live/wallet-compliance", icon: "fa fa-circle-o", labelKey: "spillorama_wallet_compliance" },
    { kind: "leaf", id: "live-prize-policy", path: "/live/prize-policy", icon: "fa fa-circle-o", labelKey: "spillorama_prize_policy" },
    { kind: "leaf", id: "live-room-control", path: "/live/room-control", icon: "fa fa-circle-o", labelKey: "spillorama_room_control" },
    { kind: "leaf", id: "live-payment-requests", path: "/live/payment-requests", icon: "fa fa-circle-o", labelKey: "spillorama_payment_requests" },
    // GAME1_SCHEDULE PR 3: master-konsoll for Game 1 (routes til /game1/master/:gameId;
    // liste-navigasjon kommer i oppfølger, lenken her peker til placeholder).
    { kind: "leaf", id: "game1-master-console", path: "/game1/master/placeholder", icon: "fa fa-circle-o", labelKey: "spillorama_master_console" },
  ],
};

export const adminSidebar: SidebarNode[] = [
  { kind: "header", labelKey: "main_navigation" },

  spilloramaLive,

  { kind: "leaf", id: "dashboard", path: "/admin", icon: "fa fa-dashboard", labelKey: "dashboard" },

  {
    kind: "group",
    id: "player-management",
    icon: "fa fa-bar-chart",
    labelKey: "player_management",
    module: "Players Management",
    children: [
      { kind: "leaf", id: "player", path: "/player", icon: "fa fa-circle-o", labelKey: "approved_players" },
      { kind: "leaf", id: "pendingRequests", path: "/pendingRequests", icon: "fa fa-circle-o", labelKey: "pending_requests" },
      { kind: "leaf", id: "rejectedRequests", path: "/rejectedRequests", icon: "fa fa-circle-o", labelKey: "reject_requests" },
    ],
  },
  { kind: "leaf", id: "track-spending", path: "/players/track-spending", icon: "fa fa-gamepad", labelKey: "tracking_player_spending", module: "Tracking Player Spending" },
  { kind: "leaf", id: "gameType", path: "/gameType", icon: "fa fa-gamepad", labelKey: "game_type", module: "Game Type" },
  { kind: "leaf", id: "schedules", path: "/schedules", icon: "fa fa-calendar", labelKey: "schedule_management", module: "Schedule Management" },
  { kind: "leaf", id: "gameManagement", path: "/gameManagement", icon: "fa fa-gamepad", labelKey: "game_creation_management", module: "Game Creation Management" },
  { kind: "leaf", id: "savedGameList", path: "/savedGameList", icon: "fa fa-gears mr-20", labelKey: "saved_game_list", module: "Saved Game List" },

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

  { kind: "leaf", id: "addPhysicalTickets", path: "/addPhysicalTickets", icon: "fa fa-ticket", labelKey: "add_physical_tickets", module: "Physical Tickets" },
  { kind: "leaf", id: "physicalTicketManagement", path: "/physicalTicketManagement", icon: "fa fa-gears mr-20", labelKey: "physical_ticket_management", module: "Physical Tickets" },
  { kind: "leaf", id: "physicalCashOut", path: "/physical/cash-out", icon: "fa fa-money", labelKey: "physical_cash_out", module: "Physical Tickets" },
  { kind: "leaf", id: "physicalCheckBingo", path: "/physical/check-bingo", icon: "fa fa-check-circle-o", labelKey: "check_bingo_stamp", module: "Physical Tickets" },
  { kind: "leaf", id: "sold-tickets", path: "/sold-tickets", icon: "fa fa-ticket mr-20", labelKey: "sold_tickets" },

  {
    kind: "group",
    id: "unique-id",
    icon: "fa fa-bar-chart",
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
    id: "product-management",
    icon: "fa fa-bar-chart",
    labelKey: "product_management",
    module: "Product Management",
    children: [
      { kind: "leaf", id: "productList", path: "/productList", icon: "fa fa-circle-o", labelKey: "product_list" },
      { kind: "leaf", id: "categoryList", path: "/categoryList", icon: "fa fa-circle-o", labelKey: "category_list" },
      { kind: "leaf", id: "orderHistory", path: "/orderHistory", icon: "fa fa-circle-o", labelKey: "order_history" },
    ],
  },

  { kind: "leaf", id: "role", path: "/role", icon: "fa fa-users mr-20", labelKey: "role_management", roles: ["admin", "super-admin"] },

  {
    kind: "group",
    id: "report-management",
    icon: "fa fa-bar-chart",
    labelKey: "report_management",
    module: "Report Management",
    children: [
      { kind: "leaf", id: "reportGame1", path: "/reportGame1", icon: "fa fa-circle-o", labelKey: "game1" },
      { kind: "leaf", id: "reportGame2", path: "/reportGame2", icon: "fa fa-circle-o", labelKey: "game2" },
      { kind: "leaf", id: "reportGame3", path: "/reportGame3", icon: "fa fa-circle-o", labelKey: "game3" },
      { kind: "leaf", id: "reportGame4", path: "/reportGame4", icon: "fa fa-circle-o", labelKey: "game4" },
      { kind: "leaf", id: "reportGame5", path: "/reportGame5", icon: "fa fa-circle-o", labelKey: "game5" },
      { kind: "leaf", id: "hallSpecificReport", path: "/hallSpecificReport", icon: "fa fa-circle-o", labelKey: "hall_specific_reports" },
      { kind: "leaf", id: "physicalTicketReport", path: "/physicalTicketReport", icon: "fa fa-circle-o", labelKey: "physical_ticket" },
      { kind: "leaf", id: "uniqueGameReport", path: "/uniqueGameReport", icon: "fa fa-circle-o", labelKey: "unique_ticket" },
      { kind: "leaf", id: "redFlagCategory", path: "/redFlagCategory", icon: "fa fa-circle-o", labelKey: "red_flag_category" },
      { kind: "leaf", id: "totalRevenueReport", path: "/totalRevenueReport", icon: "fa fa-circle-o", labelKey: "total_revenue_report" },
    ],
  },

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

  { kind: "leaf", id: "riskCountry", path: "/riskCountry", icon: "fa fa-users mr-20", labelKey: "risk_country", roles: ["admin", "super-admin"] },
  // PR-B6 (BIN-664) — security / blocked-IP admin.
  { kind: "leaf", id: "blockedIp", path: "/blockedIp", icon: "fa fa-ban mr-20", labelKey: "blocked_ip_table", roles: ["admin", "super-admin"] },
  { kind: "leaf", id: "hallAccountReport", path: "/hallAccountReport", icon: "fa fa-users mr-20", labelKey: "hall_account_report" },
  { kind: "leaf", id: "wallet", path: "/wallet", icon: "fa fa-credit-card", labelKey: "wallet_management", module: "Wallet Management" },

  {
    kind: "group",
    id: "transactions-management",
    icon: "fa fa-money",
    labelKey: "transactions_management",
    module: "Transactions Management",
    children: [
      { kind: "leaf", id: "depositRequests", path: "/deposit/requests", icon: "fa fa-circle-o", labelKey: "deposit_request" },
      { kind: "leaf", id: "depositHistory", path: "/deposit/history", icon: "fa fa-circle-o", labelKey: "deposit_history" },
      // BIN-655 — generisk transaksjons-logg (wallet + agent + payment-requests).
      { kind: "leaf", id: "transactionsLog", path: "/transactions/log", icon: "fa fa-circle-o", labelKey: "transactions_log" },
    ],
  },
  {
    kind: "group",
    id: "withdraw-management",
    icon: "fa fa-user-secret",
    labelKey: "withdraw_management",
    module: "Withdraw Management",
    children: [
      { kind: "leaf", id: "withdrawInHall", path: "/withdraw/requests/hall", icon: "fa fa-circle-o", labelKey: "withdraw_request_in_hall" },
      { kind: "leaf", id: "withdrawInBank", path: "/withdraw/requests/bank", icon: "fa fa-circle-o", labelKey: "withdraw_request_in_bank" },
      { kind: "leaf", id: "withdrawHistoryHall", path: "/withdraw/history/hall", icon: "fa fa-circle-o", labelKey: "withdraw_history_hall" },
      { kind: "leaf", id: "withdrawHistoryBank", path: "/withdraw/history/bank", icon: "fa fa-circle-o", labelKey: "withdraw_history_bank" },
      { kind: "leaf", id: "withdrawEmails", path: "/withdraw/list/emails", icon: "fa fa-circle-o", labelKey: "add_email_account" },
    ],
  },

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
];

// Agent sidebar — legacy/.../navigation.html:713-1548 (subset, permission-gated)
export const agentSidebar: SidebarNode[] = [
  { kind: "header", labelKey: "main_navigation" },
  spilloramaLive,
  { kind: "leaf", id: "dashboard", path: "/admin", icon: "fa fa-dashboard", labelKey: "dashboard" },
  { kind: "leaf", id: "agent-dashboard", path: "/agent/dashboard", icon: "fa fa-line-chart", labelKey: "agent_dashboard", agentOnly: true },
  { kind: "leaf", id: "agent-players", path: "/agent/players", icon: "fa fa-users", labelKey: "agent_players_title", agentOnly: true },
  {
    kind: "group",
    id: "cash-in-out",
    icon: "fa fa-money",
    labelKey: "cash_in_out",
    agentOnly: true,
    children: [
      { kind: "leaf", id: "cashinout", path: "/agent/cashinout", icon: "fa fa-circle-o", labelKey: "cash_in_out" },
      { kind: "leaf", id: "sold-tickets", path: "/sold-tickets", icon: "fa fa-circle-o", labelKey: "sold_tickets" },
    ],
  },
  {
    kind: "group",
    id: "player-management",
    icon: "fa fa-bar-chart",
    labelKey: "player_management",
    module: "Players Management",
    children: [
      { kind: "leaf", id: "player", path: "/player", icon: "fa fa-circle-o", labelKey: "approved_players" },
      { kind: "leaf", id: "pendingRequests", path: "/pendingRequests", icon: "fa fa-circle-o", labelKey: "pending_requests" },
      { kind: "leaf", id: "rejectedRequests", path: "/rejectedRequests", icon: "fa fa-circle-o", labelKey: "reject_requests" },
    ],
  },
  { kind: "leaf", id: "track-spending", path: "/players/track-spending", icon: "fa fa-gamepad", labelKey: "tracking_player_spending", module: "Tracking Player Spending" },
  { kind: "leaf", id: "schedules", path: "/schedules", icon: "fa fa-calendar", labelKey: "schedule_management", module: "Schedule Management" },
  { kind: "leaf", id: "gameManagement", path: "/gameManagement", icon: "fa fa-gamepad", labelKey: "game_creation_management", module: "Game Creation Management" },
  { kind: "leaf", id: "physicalCashOut", path: "/agent/physicalCashOut", icon: "fa fa-ticket", labelKey: "physical_cash_out", agentOnly: true },
  { kind: "leaf", id: "sold-tickets-main", path: "/sold-tickets", icon: "fa fa-ticket mr-20", labelKey: "sold_tickets" },
  { kind: "leaf", id: "hallAccountReport", path: "/hallAccountReport", icon: "fa fa-users mr-20", labelKey: "hall_account_report" },
  { kind: "leaf", id: "hallSpecificReport", path: "/hallSpecificReport", icon: "fa fa-bar-chart", labelKey: "hall_specific_reports", module: "Report Management" },
  { kind: "leaf", id: "wallet", path: "/wallet", icon: "fa fa-credit-card", labelKey: "wallet_management", module: "Wallet Management" },
];

export function sidebarFor(role: Role): SidebarNode[] {
  return role === "agent" ? agentSidebar : adminSidebar;
}
