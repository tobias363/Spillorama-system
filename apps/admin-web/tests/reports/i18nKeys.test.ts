// PR-A4a (BIN-645) — i18n-key parity test for report pages.
//
// Ensures every new key added by bolk 3 exists in both no.json and en.json.

import { describe, it, expect } from "vitest";
import noTranslations from "../../src/i18n/no.json";
import enTranslations from "../../src/i18n/en.json";

const REPORT_KEYS = [
  "channel",
  "ended_at",
  "flagged_at",
  "gap_physical_ticket_aggregate",
  "gap_red_flag_categories",
  "gap_red_flag_players",
  "gap_subgame_drilldown",
  "gap_unique_ticket_range",
  "gross_turnover",
  "history",
  "last_activity",
  "match",
  "name",
  "net",
  "pending_backend_endpoint",
  "prizes_paid",
  "reference",
  "rounds",
  "severity",
  "started_at",
  "subgame_report",
  "tickets_refunded",
  "total_payouts",
  "total_prizes",
  "total_stakes",
  "type",
  "unique_players",
  "user_transactions",
  "winners",
  // BIN-BOT-01: Report Management Game 1 keys.
  "report_management_game1",
  "oms",
  "utd",
  "res",
  "payout_percent",
  "by_player",
  "by_bot",
  "export_excel",
  "total_utd",
  "total_res",
  "total_payout_percent",
  "all_halls",
  "all_groups",
  "no_subgames_found",
  "bot_filter_not_supported_note",
  "print_report",
];

describe("report-bolk i18n keys", () => {
  it("all new keys exist in no.json", () => {
    const no = noTranslations as Record<string, string>;
    for (const key of REPORT_KEYS) {
      expect(no[key], `missing no.json key: ${key}`).toBeTruthy();
    }
  });

  it("all new keys exist in en.json", () => {
    const en = enTranslations as Record<string, string>;
    for (const key of REPORT_KEYS) {
      expect(en[key], `missing en.json key: ${key}`).toBeTruthy();
    }
  });
});
