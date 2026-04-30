export interface RouteDef {
  path: string;
  titleKey: string;
  module?: string;
  roles?: Array<"admin" | "super-admin" | "agent" | "hall-operator">;
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
  // PR-PT6 — PT1-PT5 admin-UI.
  { path: "/physical/import", titleKey: "pt_import_csv_title", module: "Physical Tickets" },
  { path: "/physical/ranges/register", titleKey: "pt_range_register_title", module: "Physical Tickets" },
  { path: "/physical/ranges", titleKey: "pt_active_ranges_title", module: "Physical Tickets" },
  { path: "/physical/payouts", titleKey: "pt_pending_payouts_title", module: "Physical Tickets" },
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
  // PR 4e.1 — /groupHall/edit/:id og /groupHall/view/:id resolves via hash-regex
  // i isGroupHallRoute (se apps/admin-web/src/pages/groupHall/index.ts).

  { path: "/productList", titleKey: "product_list", module: "Product Management" },
  { path: "/categoryList", titleKey: "category_list", module: "Product Management" },
  { path: "/hallProductList", titleKey: "hall_product_management", module: "Product Management" },
  { path: "/orderHistory", titleKey: "order_history", module: "Product Management" },

  { path: "/role", titleKey: "role_management", roles: ["admin", "super-admin"] },
  { path: "/role/matrix", titleKey: "role_management_table", roles: ["admin", "super-admin"] },
  { path: "/role/assign", titleKey: "assign_role_to_agent", roles: ["admin", "super-admin"] },
  { path: "/role/agent", titleKey: "agent_role_permissions_title", roles: ["admin", "super-admin"] },

  { path: "/reportGame1", titleKey: "game1", module: "Report Management" },
  { path: "/reportManagement/game1", titleKey: "report_management_game1", module: "Report Management" },
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
  { path: "/withdraw/xml-batches", titleKey: "withdraw_xml_batches", module: "Withdraw Management" },

  { path: "/leaderboard", titleKey: "leaderboard_tier_list_title" },
  // BIN-668 — Leaderboard tier CRUD. `/leaderboard/edit/:id` via hash-regex.
  { path: "/addLeaderboard", titleKey: "leaderboard_tier_create", module: "Leaderboard Management" },
  { path: "/voucher", titleKey: "voucher_management" },
  { path: "/loyaltyManagement", titleKey: "loyalty_tier_list_title", module: "Loyalty Management" },
  // BIN-700 — Loyalty tier CRUD + player-state. `/loyaltyManagement/edit/:id`
  // og `/loyaltyManagement/players/:userId` via hash-regex.
  { path: "/loyaltyManagement/new", titleKey: "loyalty_tier_create", module: "Loyalty Management" },
  { path: "/loyaltyManagement/players", titleKey: "loyalty_players_title", module: "Loyalty Management" },
  { path: "/loyalty", titleKey: "loyalty_tier_list_title", module: "Loyalty Management" },

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
  // BIN-720 — Profile Settings (selv-service). Tilgjengelig for spiller/player-
  // roller (og admin for debug). Ingen role-gate her — backend enforcer tilgangs-
  // regler (må ha PLAYER-role + wallet).
  { path: "/profile/settings", titleKey: "profile_settings" },
  // BIN-677 — settings sub-pages (maintenance). Edit-route via hash-regex.
  { path: "/maintenance", titleKey: "maintenance_list_title", roles: ["admin", "super-admin"] },
  { path: "/maintenance/new", titleKey: "maintenance_new_window", roles: ["admin", "super-admin"] },
  // Fase 1 MVP §24 — Screen Saver admin-config (multi-image carousel for hall-TV).
  { path: "/screen-saver", titleKey: "screen_saver_title", roles: ["admin", "super-admin"] },
  { path: "/system/systemInformation", titleKey: "system_information", roles: ["admin", "super-admin"] },
  // BIN-678 — runtime-diagnostikk (system-info-snapshot).
  { path: "/system/info", titleKey: "system_diagnostics", roles: ["admin", "super-admin"] },
  // BIN-655 — generisk transaksjonslogg + audit-logg.
  { path: "/transactions/log", titleKey: "transactions_log", module: "Transactions Management" },
  { path: "/auditLog", titleKey: "audit_log_title" },
  // HIGH-11: chat-moderasjon (Casino Review). ADMIN + HALL_OPERATOR + SUPPORT.
  { path: "/admin/chat-moderation", titleKey: "chat_moderation_title", roles: ["admin", "super-admin", "hall-operator"] },
  // ADMIN Super-User Operations Console — live ops-dashboard.
  { path: "/admin/ops", titleKey: "ops_console_title", roles: ["admin", "super-admin"] },

  { path: "/agent/dashboard", titleKey: "agent_dashboard", roles: ["agent", "hall-operator"] },
  { path: "/agent/players", titleKey: "agent_players_title", roles: ["agent", "hall-operator"] },
  { path: "/agent/cashinout", titleKey: "cash_in_out", roles: ["agent", "hall-operator"] },
  { path: "/agent/physicalCashOut", titleKey: "physical_cash_out", roles: ["agent", "hall-operator"] },
  // Agent-portal skeleton (PR feat/agent-portal-skeleton) — placeholder-routes
  // for V1.0/V2.0-wireframe-side-nav. Fylles inn i oppfølger-PR.
  { path: "/agent/physical-tickets", titleKey: "add_physical_tickets", roles: ["agent", "hall-operator"] },
  { path: "/agent/games", titleKey: "agent_game_management", roles: ["agent", "hall-operator"] },
  { path: "/agent/cash-in-out", titleKey: "agent_cash_in_out_management", roles: ["agent", "hall-operator"] },
  { path: "/agent/unique-id", titleKey: "agent_unique_id_management", roles: ["agent", "hall-operator"] },
  { path: "/agent/physical-cashout", titleKey: "agent_physical_cashout_title", roles: ["agent", "hall-operator"] },
  // Agent-portal Check-for-Bingo (P0 pilot-blokker).
  { path: "/agent/bingo-check", titleKey: "agent_check_bingo", roles: ["agent", "hall-operator"] },
  // BIN-17.32 — Past Game Winning History (agent-view).
  { path: "/agent/past-winning-history", titleKey: "past_game_winning_history", roles: ["agent", "hall-operator"] },
  // PDF 17 §17.29 — Order History (agent-view, product-sales).
  { path: "/agent/orders/history", titleKey: "order_history", roles: ["agent", "hall-operator"] },
  // PDF 17 §17.31 — Sold Ticket UI (static-tickets, scoped per hall).
  { path: "/agent/sold-tickets-ui", titleKey: "sold_ticket", roles: ["agent", "hall-operator"] },
  // PR-B1: cash-inout sub-pages. Exact matches only — use query string for
  // row-scoped deep-links (e.g. `#/agent/sellPhysicalTickets?gameId=X`).
  { path: "/agent/sellPhysicalTickets", titleKey: "register_sold_ticket", roles: ["agent"] },
  { path: "/agent/sellProduct", titleKey: "sell_products", roles: ["agent"] },
  { path: "/agent/unique-id/add", titleKey: "add_money_unique_id", roles: ["agent"] },
  { path: "/agent/unique-id/withdraw", titleKey: "withdraw_money_unique_id", roles: ["agent"] },
  { path: "/agent/register-user/add", titleKey: "add_money_register_user", roles: ["agent"] },
  { path: "/agent/register-user/withdraw", titleKey: "withdraw_money_register_user", roles: ["agent"] },
  { path: "/agent/cashout-details", titleKey: "cashout_details", roles: ["agent"] },
  // Wireframe §17.31 — agent-alias for sold-tickets-list (shift-scoped).
  { path: "/agent/sold-tickets", titleKey: "sold_tickets", roles: ["agent", "hall-operator"] },

];

export function findRoute(path: string): RouteDef | undefined {
  return routes.find((r) => r.path === path);
}
