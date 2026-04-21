export interface RouteDef {
  path: string;
  titleKey: string;
  module?: string;
  roles?: Array<"admin" | "super-admin" | "agent">;
}

export const routes: RouteDef[] = [
  { path: "/", titleKey: "dashboard" },
  { path: "/admin", titleKey: "dashboard" },

  { path: "/player", titleKey: "approved_players", module: "Players Management" },
  { path: "/players/view", titleKey: "player_details", module: "Players Management" },
  { path: "/players/approved", titleKey: "approved_players_table", module: "Players Management" },
  { path: "/players/approved/view", titleKey: "player_details", module: "Players Management" },
  { path: "/pendingRequests", titleKey: "pending_requests", module: "Players Management" },
  { path: "/pending/view", titleKey: "pending_requests", module: "Players Management" },
  { path: "/rejectedRequests", titleKey: "reject_requests", module: "Players Management" },
  { path: "/rejected/view", titleKey: "reject_requests", module: "Players Management" },
  { path: "/bankid/verify", titleKey: "bankid_verify_page_title", module: "Players Management" },
  { path: "/bankid/response", titleKey: "bankid_response_page_title", module: "Players Management" },
  { path: "/players/track-spending", titleKey: "tracking_player_spending", module: "Tracking Player Spending" },

  { path: "/gameType", titleKey: "game_type", module: "Game Type" },
  // PR-A3: GameType add/test — edit/:id and view/:id resolve via the games
  // dispatcher (hash-regex match, mirrors cash-inout pattern).
  { path: "/gameType/add", titleKey: "add_game", module: "Game Type" },
  { path: "/gameType/test", titleKey: "game_type", module: "Game Type" },
  // PR-A3 bolk 2: SubGame — edit/:id and view/:id via dispatcher.
  { path: "/subGame", titleKey: "sub_game", module: "Sub Game" },
  { path: "/subGame/add", titleKey: "add_sub_game", module: "Sub Game" },
  { path: "/schedules", titleKey: "schedule_management", module: "Schedule Management" },
  { path: "/gameManagement", titleKey: "game_creation_management", module: "Game Creation Management" },
  { path: "/savedGameList", titleKey: "saved_game_list", module: "Saved Game List" },

  { path: "/wheelOfFortune", titleKey: "wheel_of_fortune" },
  { path: "/treasureChest", titleKey: "treasure_chest" },
  { path: "/mystery", titleKey: "mystery_game" },
  { path: "/colorDraft", titleKey: "color_draft" },

  { path: "/addPhysicalTickets", titleKey: "add_physical_tickets", module: "Physical Tickets" },
  { path: "/physicalTicketManagement", titleKey: "physical_ticket_management", module: "Physical Tickets" },
  { path: "/physical/cash-out", titleKey: "physical_cash_out", module: "Physical Tickets" },
  { path: "/physical/check-bingo", titleKey: "check_bingo_stamp", module: "Physical Tickets" },
  { path: "/sold-tickets", titleKey: "sold_tickets" },

  { path: "/uniqueId", titleKey: "generate_unique_id", module: "Unique ID Modules" },
  { path: "/uniqueIdList", titleKey: "unique_id_list", module: "Unique ID Modules" },

  { path: "/theme", titleKey: "theme" },
  { path: "/patternMenu", titleKey: "pattern_management", module: "Pattern Management" },

  { path: "/adminUser", titleKey: "admin_management", roles: ["admin", "super-admin"] },
  { path: "/adminUser/add", titleKey: "add_admin", roles: ["admin", "super-admin"] },
  { path: "/agent", titleKey: "agent_management", roles: ["admin", "super-admin"] },
  { path: "/agent/add", titleKey: "add_agent", roles: ["admin", "super-admin"] },
  { path: "/user", titleKey: "user_management", roles: ["admin", "super-admin"] },
  { path: "/user/add", titleKey: "add_user", roles: ["admin", "super-admin"] },
  { path: "/hall", titleKey: "hall_management", roles: ["admin", "super-admin"] },
  { path: "/hall/add", titleKey: "add_hall", roles: ["admin", "super-admin"] },
  { path: "/groupHall", titleKey: "group_of_halls_management", roles: ["admin", "super-admin"] },
  { path: "/groupHall/add", titleKey: "create_group_of_halls", roles: ["admin", "super-admin"] },

  { path: "/productList", titleKey: "product_list", module: "Product Management" },
  { path: "/categoryList", titleKey: "category_list", module: "Product Management" },
  { path: "/hallProductList", titleKey: "hall_product_management", module: "Product Management" },
  { path: "/orderHistory", titleKey: "order_history", module: "Product Management" },

  { path: "/role", titleKey: "role_management", roles: ["admin", "super-admin"] },
  { path: "/role/matrix", titleKey: "role_management_table", roles: ["admin", "super-admin"] },
  { path: "/role/assign", titleKey: "assign_role_to_agent", roles: ["admin", "super-admin"] },

  { path: "/reportGame1", titleKey: "game1", module: "Report Management" },
  { path: "/reportGame2", titleKey: "game2", module: "Report Management" },
  { path: "/reportGame3", titleKey: "game3", module: "Report Management" },
  { path: "/reportGame4", titleKey: "game4", module: "Report Management" },
  { path: "/reportGame5", titleKey: "game5", module: "Report Management" },
  { path: "/hallSpecificReport", titleKey: "hall_specific_reports", module: "Report Management" },
  { path: "/physicalTicketReport", titleKey: "physical_ticket", module: "Report Management" },
  { path: "/uniqueGameReport", titleKey: "unique_ticket", module: "Report Management" },
  { path: "/redFlagCategory", titleKey: "red_flag_category", module: "Report Management" },
  { path: "/totalRevenueReport", titleKey: "total_revenue_report", module: "Report Management" },

  { path: "/payoutPlayer", titleKey: "payout_for_players", module: "Payout Management" },
  { path: "/payoutTickets", titleKey: "payout_for_ticket", module: "Payout Management" },
  // PR-A4b — detail routes resolved via payout dispatcher (hash-regex).

  { path: "/riskCountry", titleKey: "risk_country", roles: ["admin", "super-admin"] },
  // PR-B6 (BIN-664) — security / blocked-IP. SECURITY_READ lists; SECURITY_WRITE mutations
  // via add/edit modal on the list page (no dedicated /blockedIp/add route).
  { path: "/blockedIp", titleKey: "blocked_ip_table", module: "Security Management", roles: ["admin", "super-admin"] },
  { path: "/hallAccountReport", titleKey: "hall_account_report" },
  // PR-A4b — dynamic detail + settlement routes resolved via hallAccount
  // dispatcher (hash-regex match).

  { path: "/wallet", titleKey: "wallet_management", module: "Wallet Management" },
  { path: "/wallet/view", titleKey: "view_wallet", module: "Wallet Management" },
  { path: "/deposit/requests", titleKey: "deposit_request", module: "Transactions Management" },
  { path: "/deposit/history", titleKey: "deposit_history", module: "Transactions Management" },
  { path: "/deposit/transaction", titleKey: "deposit_transaction_history", module: "Transactions Management" },

  { path: "/withdraw/requests/hall", titleKey: "withdraw_request_in_hall", module: "Withdraw Management" },
  { path: "/withdraw/requests/bank", titleKey: "withdraw_request_in_bank", module: "Withdraw Management" },
  { path: "/withdraw/history/hall", titleKey: "withdraw_history_hall", module: "Withdraw Management" },
  { path: "/withdraw/history/bank", titleKey: "withdraw_history_bank", module: "Withdraw Management" },
  { path: "/withdraw/list/emails", titleKey: "add_email_account", module: "Withdraw Management" },

  { path: "/leaderboard", titleKey: "leaderboard_tier_list_title" },
  // BIN-668 — Leaderboard tier CRUD. `/leaderboard/edit/:id` via hash-regex.
  { path: "/addLeaderboard", titleKey: "leaderboard_tier_create", module: "Leaderboard Management" },
  { path: "/voucher", titleKey: "voucher_management" },
  { path: "/loyaltyManagement", titleKey: "players_loyalty_management", module: "Loyalty Management" },
  { path: "/loyalty", titleKey: "loyalty_type", module: "Loyalty Management" },

  { path: "/sms-advertisement", titleKey: "sms_advertisement", roles: ["admin", "super-admin"] },
  { path: "/cms", titleKey: "cms_management", roles: ["admin", "super-admin"] },
  // PR-A6 (BIN-674) — CMS sub-pages (FAQ CRUD + 5 tekst-seksjoner).
  { path: "/faq", titleKey: "faq_management", roles: ["admin", "super-admin"] },
  { path: "/addFAQ", titleKey: "add_faq", roles: ["admin", "super-admin"] },
  { path: "/TermsofService", titleKey: "terms_of_service", roles: ["admin", "super-admin"] },
  { path: "/Support", titleKey: "support", roles: ["admin", "super-admin"] },
  { path: "/Aboutus", titleKey: "about_us", roles: ["admin", "super-admin"] },
  { path: "/ResponsibleGameing", titleKey: "responsible_gaming", roles: ["admin", "super-admin"] },
  { path: "/LinksofOtherAgencies", titleKey: "links_of_other_agencies", roles: ["admin", "super-admin"] },
  { path: "/settings", titleKey: "settings", roles: ["admin", "super-admin"] },
  // BIN-677 — settings sub-pages (maintenance). Edit-route via hash-regex.
  { path: "/maintenance", titleKey: "maintenance_list_title", roles: ["admin", "super-admin"] },
  { path: "/maintenance/new", titleKey: "maintenance_new_window", roles: ["admin", "super-admin"] },
  { path: "/system/systemInformation", titleKey: "system_information", roles: ["admin", "super-admin"] },

  { path: "/agent/cashinout", titleKey: "cash_in_out", roles: ["agent"] },
  { path: "/agent/physicalCashOut", titleKey: "physical_cash_out", roles: ["agent"] },
  // PR-B1: cash-inout sub-pages. Exact matches only — use query string for
  // row-scoped deep-links (e.g. `#/agent/sellPhysicalTickets?gameId=X`).
  { path: "/agent/sellPhysicalTickets", titleKey: "register_sold_ticket", roles: ["agent"] },
  { path: "/agent/sellProduct", titleKey: "sell_products", roles: ["agent"] },
  { path: "/agent/unique-id/add", titleKey: "add_money_unique_id", roles: ["agent"] },
  { path: "/agent/unique-id/withdraw", titleKey: "withdraw_money_unique_id", roles: ["agent"] },
  { path: "/agent/register-user/add", titleKey: "add_money_register_user", roles: ["agent"] },
  { path: "/agent/register-user/withdraw", titleKey: "withdraw_money_register_user", roles: ["agent"] },
  { path: "/agent/cashout-details", titleKey: "cashout_details", roles: ["agent"] },

  { path: "/live/dashboard", titleKey: "spillorama_live_dashboard" },
  { path: "/live/game-settings", titleKey: "spillorama_game_settings" },
  { path: "/live/games", titleKey: "spillorama_games" },
  { path: "/live/halls", titleKey: "spillorama_halls" },
  { path: "/live/hall-display", titleKey: "spillorama_hall_display" },
  { path: "/live/terminals", titleKey: "spillorama_terminals" },
  { path: "/live/hall-rules", titleKey: "spillorama_hall_rules" },
  { path: "/live/wallet-compliance", titleKey: "spillorama_wallet_compliance" },
  { path: "/live/prize-policy", titleKey: "spillorama_prize_policy" },
  { path: "/live/room-control", titleKey: "spillorama_room_control" },
  { path: "/live/payment-requests", titleKey: "spillorama_payment_requests" },
];

export function findRoute(path: string): RouteDef | undefined {
  return routes.find((r) => r.path === path);
}
