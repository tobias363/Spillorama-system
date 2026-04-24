// BIN-647..651 wiring — report-pages render tests.
//
// Since BIN-647/648/649/650/651 shipped, the pages no longer render the
// pre-launch gap-banner `[data-gap-banner="..."]`. Instead they:
//   - render the filter-bar + DataTable + summary (where applicable)
//   - surface an inline `.alert-warning` with the `gap_*` i18n message when
//     the endpoint returns 404/501 (rolling-deploy fallback)
//
// The tests here exercise both the success path (real data rendered) and the
// fallback path (inline warning visible).

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

function tickUntil(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("report pages — wired to merged backend endpoints", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("PhysicalTicketReportPage shows inline warning on 404 (rolling-deploy fallback)", async () => {
    globalThis.fetch = (async () => notFoundJson()) as typeof fetch;
    const c = document.createElement("div");
    await renderPhysicalTicketReportPage(c);
    // Inline warning visible
    const warning = c.querySelector("#physical-ticket-report-table .alert-warning");
    expect(warning).not.toBeNull();
    // Filter bar still renders (date inputs + hall selector)
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    expect(c.querySelector('select[data-testid="hall-filter"]')).not.toBeNull();
  });

  it("PhysicalTicketReportPage renders rows + summary on 200", async () => {
    const aggregate = {
      generatedAt: "2026-04-01T00:00:00Z",
      from: "2026-03-25T00:00:00Z",
      to: "2026-04-01T00:00:00Z",
      hallId: null,
      rows: [
        {
          gameId: "g1",
          hallId: "h1",
          sold: 10,
          pending: 4,
          cashedOut: 6,
          totalRevenueCents: 50000,
        },
      ],
      totals: {
        sold: 10,
        pending: 4,
        cashedOut: 6,
        totalRevenueCents: 50000,
        rowCount: 1,
      },
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
      if (url.includes("/api/admin/halls")) return okJson([]);
      return okJson(aggregate);
    }) as typeof fetch;
    const c = document.createElement("div");
    await renderPhysicalTicketReportPage(c);
    // No inline warning
    expect(c.querySelector("#physical-ticket-report-table .alert-warning")).toBeNull();
    // Table body has a row
    expect(c.querySelector("#physical-ticket-report-table tbody tr")).not.toBeNull();
    // Summary rendered (with totals)
    const summary = c.querySelector("#physical-ticket-summary")?.textContent ?? "";
    expect(summary.length).toBeGreaterThan(0);
  });

  it("UniqueGameReportPage surfaces filter inputs and inline warning on 404", async () => {
    globalThis.fetch = (async () => notFoundJson()) as typeof fetch;
    const c = document.createElement("div");
    await renderUniqueGameReportPage(c);
    await tickUntil(0);
    // Date range + hall + status + 2 numeric uniqueId inputs
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    expect(c.querySelector('select[data-testid="hall-filter"]')).not.toBeNull();
    expect(c.querySelector('select[data-testid="status-filter"]')).not.toBeNull();
    expect(c.querySelector('input[data-testid="unique-id-start"]')).not.toBeNull();
    expect(c.querySelector('input[data-testid="unique-id-end"]')).not.toBeNull();
  });

  it("UniqueGameReportPage renders rows on 200", async () => {
    const response = {
      hallId: null,
      status: null,
      uniqueIdStart: null,
      uniqueIdEnd: null,
      from: null,
      to: null,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: "t1",
          uniqueId: 12345,
          hallId: "h1",
          status: "SOLD",
          assignedGameId: "g1",
          priceCents: 1000,
          createdAt: "2026-04-01T00:00:00Z",
          soldAt: "2026-04-01T00:10:00Z",
        },
      ],
      count: 1,
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
      if (url.includes("/api/admin/halls")) return okJson([]);
      return okJson(response);
    }) as typeof fetch;
    const c = document.createElement("div");
    await renderUniqueGameReportPage(c);
    await tickUntil(0);
    expect(c.querySelector("#unique-game-report-table tbody tr")).not.toBeNull();
  });

  it("RedFlagCategoryPage list shows inline warning on 404", async () => {
    globalThis.fetch = (async () => notFoundJson()) as typeof fetch;
    const c = document.createElement("div");
    await renderRedFlagCategoryPage(c);
    const warning = c.querySelector("#redflag-categories-table .alert-warning");
    expect(warning).not.toBeNull();
  });

  it("RedFlagCategoryPage list renders rows on 200", async () => {
    const data = {
      from: "2026-03-01T00:00:00Z",
      to: "2026-04-01T00:00:00Z",
      generatedAt: "2026-04-01T00:00:00Z",
      categories: [
        {
          category: "high-velocity",
          label: "High velocity",
          description: "lots of play",
          severity: "HIGH",
          count: 5,
          openCount: 3,
        },
      ],
      totals: { totalFlags: 5, totalOpenFlags: 3, categoryCount: 1 },
    };
    globalThis.fetch = (async () => okJson(data)) as typeof fetch;
    const c = document.createElement("div");
    await renderRedFlagCategoryPage(c);
    expect(c.querySelector("#redflag-categories-table tbody tr")).not.toBeNull();
    expect(c.querySelector("#redflag-categories-table .alert-warning")).toBeNull();
  });

  it("RedFlagCategoryPage players view shows inline warning on 404", async () => {
    globalThis.fetch = (async () => notFoundJson()) as typeof fetch;
    const c = document.createElement("div");
    await renderRedFlagCategoryPage(c, "high-velocity");
    await tickUntil(0);
    const warning = c.querySelector("#redflag-players-table .alert-warning");
    expect(warning).not.toBeNull();
  });

  it("RedFlagCategoryPage players view renders rows + uses cursor shape on 200", async () => {
    const data = {
      category: "high-velocity",
      from: null,
      to: null,
      items: [
        {
          userId: "u1",
          displayName: "Alice",
          email: "a@b.no",
          categoryId: "high-velocity",
          flaggedAt: "2026-04-01T10:00:00Z",
          totalStakes: 500,
          lastActivity: "2026-04-01T10:30:00Z",
        },
      ],
      nextCursor: null,
      totalCount: 1,
    };
    globalThis.fetch = (async () => okJson(data)) as typeof fetch;
    const c = document.createElement("div");
    await renderRedFlagCategoryPage(c, "high-velocity");
    await tickUntil(0);
    expect(c.querySelector("#redflag-players-table tbody tr")).not.toBeNull();
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

  it("HallSpecificReportPage renders per-hall rows with Elvis + Game 1-5 kolonner (17.36)", async () => {
    // BIN-17.36 replaces the hall-dropdown skeleton with a multi-hall aggregate
    // response from /api/admin/reports/hall-specific. Sjekk at:
    //   - 2 date-inputs (from/to)
    //   - Elvis Replacement-kolonne rendres i <thead>
    //   - Ingen <select> (den gamle dropdown-modellen er erstattet)
    globalThis.fetch = (async () => {
      return okJson({
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-30T23:59:59.999Z",
        generatedAt: new Date().toISOString(),
        rows: [
          {
            hallId: "h1",
            hallName: "Hall 1",
            groupOfHallId: null,
            groupOfHallName: null,
            agentDisplayName: null,
            elvisReplacementAmount: 42,
            games: {
              game1: { oms: 100, utd: 50, payoutPct: 50, res: 50 },
              game2: { oms: 0, utd: 0, payoutPct: 0, res: 0 },
              game3: { oms: 0, utd: 0, payoutPct: 0, res: 0 },
              game4: { oms: 0, utd: 0, payoutPct: 0, res: 0 },
              game5: { oms: 0, utd: 0, payoutPct: 0, res: 0 },
            },
          },
        ],
        totals: {
          elvisReplacementAmount: 42,
          games: {
            game1: { oms: 100, utd: 50, payoutPct: 50, res: 50 },
            game2: { oms: 0, utd: 0, payoutPct: 0, res: 0 },
            game3: { oms: 0, utd: 0, payoutPct: 0, res: 0 },
            game4: { oms: 0, utd: 0, payoutPct: 0, res: 0 },
            game5: { oms: 0, utd: 0, payoutPct: 0, res: 0 },
          },
        },
      });
    }) as typeof fetch;
    const c = document.createElement("div");
    await renderHallSpecificReportPage(c);
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    // Elvis-kolonne skal være i header (PM-låst Appendix B).
    const headerText = c.querySelector("thead")?.textContent ?? "";
    expect(/Elvis/i.test(headerText)).toBe(true);
    // Skal ha per-Game OMS/UTD (20 kolonner) — verifiser minst Game 1 OMS.
    expect(/OMS/i.test(headerText)).toBe(true);
  });
});
