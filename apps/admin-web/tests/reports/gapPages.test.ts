// PR-A4a (BIN-645) — gap-endpoint pages render tests.
//
// Verifies placeholder-banner, gap-banner-text, and filter-bar integration
// for the 4 gap-endpoint-dependent pages (BIN-647/648/649/650/651).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderPhysicalTicketReportPage } from "../../src/pages/reports/physicalTicket/PhysicalTicketReportPage.js";
import { renderUniqueGameReportPage } from "../../src/pages/reports/uniqueGame/UniqueGameReportPage.js";
import { renderRedFlagCategoryPage } from "../../src/pages/reports/redFlag/RedFlagCategoryPage.js";
import { renderViewUserTransactionPage } from "../../src/pages/reports/redFlag/ViewUserTransactionPage.js";
import { renderTotalRevenueReportPage } from "../../src/pages/reports/totalRevenue/TotalRevenueReportPage.js";
import { renderHallSpecificReportPage } from "../../src/pages/reports/hallSpecific/HallSpecificReportPage.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function notFoundJson(): Response {
  return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "x" } }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

describe("gap-endpoint pages", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("PhysicalTicketReportPage shows BIN-648 gap-banner on 404", async () => {
    globalThis.fetch = (async () => notFoundJson()) as typeof fetch;
    const c = document.createElement("div");
    await renderPhysicalTicketReportPage(c);
    expect(c.querySelector('[data-gap-banner="BIN-648"]')).not.toBeNull();
    // Filter bar still renders
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
  });

  it("PhysicalTicketReportPage does not show banner when endpoint returns 200", async () => {
    globalThis.fetch = (async () => okJson({ rows: [] })) as typeof fetch;
    const c = document.createElement("div");
    await renderPhysicalTicketReportPage(c);
    expect(c.querySelector('[data-gap-banner="BIN-648"]')).toBeNull();
  });

  it("UniqueGameReportPage shows BIN-649 gap-banner on 404", async () => {
    globalThis.fetch = (async () => notFoundJson()) as typeof fetch;
    const c = document.createElement("div");
    await renderUniqueGameReportPage(c);
    expect(c.querySelector('[data-gap-banner="BIN-649"]')).not.toBeNull();
  });

  it("RedFlagCategoryPage list shows BIN-650 gap-banner", async () => {
    globalThis.fetch = (async () => notFoundJson()) as typeof fetch;
    const c = document.createElement("div");
    await renderRedFlagCategoryPage(c);
    expect(c.querySelector('[data-gap-banner="BIN-650"]')).not.toBeNull();
  });

  it("RedFlagCategoryPage players shows BIN-651 gap-banner", async () => {
    globalThis.fetch = (async () => notFoundJson()) as typeof fetch;
    const c = document.createElement("div");
    await renderRedFlagCategoryPage(c, "cat-1");
    expect(c.querySelector('[data-gap-banner="BIN-651"]')).not.toBeNull();
  });

  it("ViewUserTransactionPage renders without gap (uses existing endpoint)", async () => {
    globalThis.fetch = (async () =>
      okJson({ userId: "u1", walletId: "w1", transactions: [], count: 0 })) as typeof fetch;
    const c = document.createElement("div");
    await renderViewUserTransactionPage(c, "u1");
    expect(c.querySelector("[data-gap-banner]")).toBeNull();
    expect(c.querySelector("#user-transaction-table table")).not.toBeNull();
  });

  it("TotalRevenueReportPage renders summary + DataTable", async () => {
    globalThis.fetch = (async () =>
      okJson({
        totalStakes: 100000,
        totalPrizes: 60000,
        net: 40000,
        roundCount: 5,
        uniquePlayerCount: 3,
        uniqueHallCount: 1,
        startDate: "2026-04-01",
        endDate: "2026-04-07",
        generatedAt: "",
        days: [],
        totals: {
          grossTurnover: 100000,
          prizesPaid: 60000,
          net: 40000,
          stakeCount: 5,
          prizeCount: 3,
        },
      })) as typeof fetch;
    const c = document.createElement("div");
    await renderTotalRevenueReportPage(c);
    // Intl.NumberFormat("no-NO") uses a NON-BREAKING SPACE between thousands.
    const txt = c.querySelector("#total-revenue-summary")?.textContent ?? "";
    expect(txt.replace(/\s/g, " ")).toContain("1 000,00");
  });

  it("HallSpecificReportPage renders with hall-dropdown", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      // First: halls, second: daily
      if (call === 1) return okJson([{ id: "h1", name: "Hall 1", isActive: true }]);
      return okJson({ hallId: "h1", dateFrom: "", dateTo: "", gameType: null, rows: [], count: 0 });
    }) as typeof fetch;
    const c = document.createElement("div");
    await renderHallSpecificReportPage(c);
    expect(c.querySelector("select")).not.toBeNull();
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
  });
});
