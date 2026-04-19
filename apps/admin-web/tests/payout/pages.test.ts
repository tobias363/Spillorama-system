// PR-A4b (BIN-659) — payout page render tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderPayoutPlayerPage } from "../../src/pages/payout/PayoutPlayerPage.js";
import { renderPayoutTicketsPage } from "../../src/pages/payout/PayoutTicketsPage.js";
import { renderViewPayoutPlayerPage } from "../../src/pages/payout/ViewPayoutPlayerPage.js";
import { renderViewPayoutTicketsPage } from "../../src/pages/payout/ViewPayoutTicketsPage.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("payout pages", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async () =>
      okJson({
        summary: { playerId: "p1", totalStakes: 10000, totalPrizes: 5000, net: 5000, gameCount: 2 },
        physicalTickets: [],
        physicalTicketCount: 0,
        sessionSummary: null,
      })) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("PayoutPlayerPage renders filter-bar + gap-banner", async () => {
    const c = document.createElement("div");
    await renderPayoutPlayerPage(c);
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    expect(c.querySelector(".datatable-csv-btn")).not.toBeNull();
    expect(c.querySelector('[data-gap-banner="BIN-659"]')).not.toBeNull();
    // toolbar has game-selector + player-ID input
    expect(c.querySelectorAll(".datatable-toolbar-extra select").length).toBe(1);
    expect(c.querySelectorAll(".datatable-toolbar-extra input[type=text]").length).toBe(1);
  });

  it("PayoutTicketsPage renders filter-bar + gap-banner", async () => {
    const c = document.createElement("div");
    await renderPayoutTicketsPage(c);
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    expect(c.querySelector(".datatable-csv-btn")).not.toBeNull();
    expect(c.querySelector('[data-gap-banner="BIN-659"]')).not.toBeNull();
    // summary-host rendered below table
    expect(c.querySelector("#payout-tickets-summary")).not.toBeNull();
  });

  it("ViewPayoutPlayerPage renders player summary form", async () => {
    const c = document.createElement("div");
    await renderViewPayoutPlayerPage(c, "p1");
    expect(c.querySelector(".content-header h1")?.textContent).toBeTruthy();
    // 5 readonly inputs for username/totalBet/totalWinning/net/gameCount
    const readonly = c.querySelectorAll('input[readonly]');
    expect(readonly.length).toBe(5);
    // Cancel-back button
    expect(c.querySelector('a[href="#/payoutPlayer"]')).not.toBeNull();
  });

  it("ViewPayoutTicketsPage renders placeholder info-box", async () => {
    const c = document.createElement("div");
    await renderViewPayoutTicketsPage(c, "ticket-xyz");
    expect(c.querySelector(".alert-info")).not.toBeNull();
    expect(c.querySelector('a[href="#/payoutTickets"]')).not.toBeNull();
  });
});
