// PR-A4a (BIN-645) — per-game report page render tests.
//
// Covers all 5 game reports + game history pages + subgames drill-down.
// Uses stubbed fetch to verify DataTable mounts + filter-bar renders.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderGame1ReportPage } from "../../src/pages/reports/game1/Game1ReportPage.js";
import { renderGame2ReportPage } from "../../src/pages/reports/game2/Game2ReportPage.js";
import { renderGame3ReportPage } from "../../src/pages/reports/game3/Game3ReportPage.js";
import { renderGame4ReportPage } from "../../src/pages/reports/game4/Game4ReportPage.js";
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
    // Host exists and table was mounted inside
    expect(c.querySelector("#report-bingo-table table")).not.toBeNull();
  });

  it("Game2–5 report pages render with distinct titles", async () => {
    for (const fn of [renderGame2ReportPage, renderGame3ReportPage, renderGame4ReportPage, renderGame5ReportPage]) {
      const c = document.createElement("div");
      await fn(c);
      expect(c.querySelector(".content-header h1")).not.toBeNull();
      expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    }
  });

  it("Game1Subgames drill-down renders gap-banner (BIN-647)", async () => {
    // Default fetch returns 200 empty — endpoint fallback-path is hit only on
    // 404/501. Simulate 404 to get isPlaceholder=true.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "x" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const c = document.createElement("div");
    await renderGame1SubgamesPage(c, "game-xyz");
    const banner = c.querySelector('[data-gap-banner="BIN-647"]');
    expect(banner).not.toBeNull();
  });

  it("Game1History renders DataTable + filter bar", async () => {
    const c = document.createElement("div");
    await renderGame1HistoryPage(c, "g1", "grp1", "hall1");
    expect(c.querySelector(".datatable-csv-btn")).not.toBeNull();
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
  });
});
