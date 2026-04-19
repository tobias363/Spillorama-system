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
  { path: "/pendingRequests", titleKey: "pending_requests", module: "Players Management" },
  { path: "/rejectedRequests", titleKey: "reject_requests", module: "Players Management" },
  { path: "/players/track-spending", titleKey: "tracking_player_spending", module: "Tracking Player Spending" },

  { path: "/gameType", titleKey: "game_type", module: "Game Type" },
  { path: "/schedules", titleKey: "schedule_management", module: "Schedule Management" },
  { path: "/gameManagement", titleKey: "game_creation_management", module: "Game Creation Management" },
  { path: "/savedGameList", titleKey: "saved_game_list", module: "Saved Game List" },

  { path: "/wheelOfFortune", titleKey: "wheel_of_fortune" },
  { path: "/treasureChest", titleKey: "treasure_chest" },
  { path: "/mystery", titleKey: "mystery_game" },
  { path: "/colorDraft", titleKey: "color_draft" },

  { path: "/addPhysicalTickets", titleKey: "add_physical_tickets", module: "Physical Tickets" },
  { path: "/physicalTicketManagement", titleKey: "physical_ticket_management", module: "Physical Tickets" },
  { path: "/sold-tickets", titleKey: "sold_tickets" },

  { path: "/uniqueId", titleKey: "generate_unique_id", module: "Unique ID Modules" },
  { path: "/uniqueIdList", titleKey: "unique_id_list", module: "Unique ID Modules" },

  { path: "/theme", titleKey: "theme" },
  { path: "/patternMenu", titleKey: "pattern_management", module: "Pattern Management" },

  { path: "/adminUser", titleKey: "admin_management", roles: ["admin", "super-admin"] },
  { path: "/agent", titleKey: "agent_management", roles: ["admin", "super-admin"] },
  { path: "/hall", titleKey: "hall_management", roles: ["admin", "super-admin"] },
  { path: "/groupHall", titleKey: "group_of_halls_management", roles: ["admin", "super-admin"] },

  { path: "/productList", titleKey: "product_list", module: "Product Management" },
  { path: "/categoryList", titleKey: "category_list", module: "Product Management" },
  { path: "/orderHistory", titleKey: "order_history", module: "Product Management" },

  { path: "/role", titleKey: "role_management", roles: ["admin", "super-admin"] },

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

  { path: "/riskCountry", titleKey: "risk_country", roles: ["admin", "super-admin"] },
  { path: "/hallAccountReport", titleKey: "hall_account_report" },

  { path: "/wallet", titleKey: "wallet_management", module: "Wallet Management" },
  { path: "/deposit/requests", titleKey: "deposit_request", module: "Transactions Management" },
  { path: "/deposit/history", titleKey: "deposit_history", module: "Transactions Management" },

  { path: "/withdraw/requests/hall", titleKey: "withdraw_request_in_hall", module: "Withdraw Management" },
  { path: "/withdraw/requests/bank", titleKey: "withdraw_request_in_bank", module: "Withdraw Management" },
  { path: "/withdraw/history/hall", titleKey: "withdraw_history_hall", module: "Withdraw Management" },
  { path: "/withdraw/history/bank", titleKey: "withdraw_history_bank", module: "Withdraw Management" },
  { path: "/withdraw/list/emails", titleKey: "add_email_account", module: "Withdraw Management" },

  { path: "/leaderboard", titleKey: "leaderboard_management" },
  { path: "/voucher", titleKey: "voucher_management" },
  { path: "/loyaltyManagement", titleKey: "players_loyalty_management", module: "Loyalty Management" },
  { path: "/loyalty", titleKey: "loyalty_type", module: "Loyalty Management" },

  { path: "/sms-advertisement", titleKey: "sms_advertisement", roles: ["admin", "super-admin"] },
  { path: "/cms", titleKey: "cms_management", roles: ["admin", "super-admin"] },
  { path: "/settings", titleKey: "settings", roles: ["admin", "super-admin"] },
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
