// PR-A4a (BIN-645) — per-game report page render tests.
//
// Covers all aktive game reports (Spill 1, 2, 3, 5/SpinnGo) + game history
// pages + subgames drill-down. Spill 4 / themebingo (legacy game4) er
// DEPRECATED (BIN-496) og har ingen rapport-rute. Uses stubbed fetch to
// verify DataTable mounts + filter-bar renders.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderGame1ReportPage } from "../../src/pages/reports/game1/Game1ReportPage.js";
import { renderGame2ReportPage } from "../../src/pages/reports/game2/Game2ReportPage.js";
import { renderGame3ReportPage } from "../../src/pages/reports/game3/Game3ReportPage.js";
import { renderGame5ReportPage } from "../../src/pages/reports/game5/Game5ReportPage.js";
import { renderGame1SubgamesPage } from "../../src/pages/reports/game1/Game1SubgamesPage.js";
import { renderGame1HistoryPage } from "../../src/pages/reports/game1/Game1HistoryPage.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function emptyReport(): unknown {
  return {
    rows: [],
    days: [],
    totals: {},
    generatedAt: "",
    startDate: "",
    endDate: "",
  };
}

describe("game report pages", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async () => okJson(emptyReport())) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("Game1ReportPage renders filter bar + DataTable", async () => {
    const c = document.createElement("div");
    await renderGame1ReportPage(c);
    // Content-header + breadcrumb
    expect(c.querySelector(".content-header h1")?.textContent).toBeTruthy();
    expect(c.querySelector(".breadcrumb")).not.toBeNull();
    // Filter bar: date-range + CSV-button
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    expect(c.querySelector(".datatable-csv-btn")).not.toBeNull();
    // Host exists and table was mounted inside. Spill 1 sender gameSlug
    // "MAIN_GAME" til backend (parseOptionalLedgerGameType godtar kun
    // MAIN_GAME / DATABINGO).
    expect(c.querySelector("#report-MAIN_GAME-table table")).not.toBeNull();
  });

  it("Game2/3/5 report pages render with distinct titles", async () => {
    for (const fn of [renderGame2ReportPage, renderGame3ReportPage, renderGame5ReportPage]) {
      const c = document.createElement("div");
      await fn(c);
      expect(c.querySelector(".content-header h1")).not.toBeNull();
      expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    }
  });

  it("Game1Subgames drill-down surfaces inline warning when backend 404s (BIN-647 rolling-deploy fallback)", async () => {
    // BIN-647 backend shipped; the dedicated gap-banner `[data-gap-banner]`
    // is gone. On 404 we still render a `.alert-warning` inline so operators
    // know the endpoint isn't responding in their environment.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "x" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const c = document.createElement("div");
    await renderGame1SubgamesPage(c, "parent-schedule-1");
    const warning = c.querySelector("#subgame-drilldown-table .alert-warning");
    expect(warning).not.toBeNull();
    // Filter bar still renders (date-range on DataTable)
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
  });

  it("Game1Subgames drill-down renders items from backend on 200", async () => {
    const response = {
      parentId: "parent-1",
      from: "2026-04-01T00:00:00Z",
      to: "2026-04-08T00:00:00Z",
      items: [
        {
          subGameId: "sub-1",
          subGameNumber: "1",
          parentScheduleId: "parent-1",
          hallId: "h1",
          hallName: "Hall 1",
          gameType: "bingo",
          gameMode: null,
          name: "Row 1",
          sequence: 1,
          startDate: null,
          revenue: 10000,
          totalWinnings: 4000,
          netProfit: 6000,
          profitPercentage: 60,
          ticketCount: 20,
          players: 5,
        },
      ],
      nextCursor: null,
      totals: {
        revenue: 10000,
        totalWinnings: 4000,
        netProfit: 6000,
        ticketCount: 20,
        players: 5,
      },
    };
    globalThis.fetch = (async () => okJson(response)) as typeof fetch;
    const c = document.createElement("div");
    await renderGame1SubgamesPage(c, "parent-1");
    // Give cursorPaging.load a tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(c.querySelector("#subgame-drilldown-table tbody tr")).not.toBeNull();
    expect(c.querySelector("#subgame-drilldown-table .alert-warning")).toBeNull();
  });

  it("Game1History renders DataTable + filter bar", async () => {
    const c = document.createElement("div");
    await renderGame1HistoryPage(c, "g1", "grp1", "hall1");
    expect(c.querySelector(".datatable-csv-btn")).not.toBeNull();
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
  });
});
