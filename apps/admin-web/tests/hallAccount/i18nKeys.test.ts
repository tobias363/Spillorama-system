// PR-A4b (BIN-659) — i18n-key parity test for hallAccount + payout.

import { describe, it, expect } from "vitest";
import noTranslations from "../../src/i18n/no.json";
import enTranslations from "../../src/i18n/en.json";

const NEW_KEYS = [
  "amount_in",
  "amount_out",
  "manual_adjustment",
  "reported_cash",
  "shift",
  "bank_deposit",
  "bank_withdrawal",
  "correction",
  "refund",
  "last_modified",
  "reason",
  "total_bet_placed",
  "total_winning",
  "total_net",
  "payout_player_details",
  "payout_ticket_details",
  "choose_a_game",
  "username",
  "game_count",
  "game_id",
  "ticket_id",
  "created_at",
  "physical_tickets_sold",
  "player_id",
  "payout_cross_game_aggregate_pending",
  "payout_ticket_detail_backend_pending",
  // Wireframe Gap #2
  "download_receipt",
];

describe("PR-A4b i18n keys", () => {
  it("all new keys exist in no.json", () => {
    const no = noTranslations as Record<string, string>;
    for (const key of NEW_KEYS) {
      expect(no[key], `missing no.json key: ${key}`).toBeTruthy();
    }
  });

  it("all new keys exist in en.json", () => {
    const en = enTranslations as Record<string, string>;
    for (const key of NEW_KEYS) {
      expect(en[key], `missing en.json key: ${key}`).toBeTruthy();
    }
  });
});
