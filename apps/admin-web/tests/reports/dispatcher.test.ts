// PR-A4a (BIN-645) — reports-dispatcher regex-match tests.
//
// Verifies isReportRoute + mountReportRoute work for all 15 report routes
// (10 static + 5 dynamic).

import { describe, it, expect, beforeEach } from "vitest";
import { isReportRoute, mountReportRoute } from "../../src/pages/reports/index.js";
import { initI18n } from "../../src/i18n/I18n.js";

describe("reports dispatcher", () => {
  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, data: { rows: [], categories: [], players: [], days: [], totals: {}, generatedAt: "" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
  });

  it("matches all 11 static routes", () => {
    const routes = [
      "/reportGame1",
      "/reportManagement/game1",
      "/reportGame2",
      "/reportGame3",
      "/reportGame4",
      "/reportGame5",
      "/hallSpecificReport",
      "/physicalTicketReport",
      "/uniqueGameReport",
      "/redFlagCategory",
      "/totalRevenueReport",
    ];
    for (const r of routes) {
      expect(isReportRoute(r)).toBe(true);
    }
  });

  it("matches 5 dynamic route patterns", () => {
    expect(isReportRoute("/reportGame1/subgames/abc123")).toBe(true);
    expect(isReportRoute("/reportGame1/history/g1/grp1/hall1")).toBe(true);
    expect(isReportRoute("/reportGame2/history/g2/grp2/hall2")).toBe(true);
    expect(isReportRoute("/reportGame3/history/g3/grp3/hall3")).toBe(true);
    expect(isReportRoute("/redFlagCategory/cat-1/players")).toBe(true);
    expect(isReportRoute("/redFlagCategory/userTransaction/user-1")).toBe(true);
  });

  it("rejects non-report routes", () => {
    expect(isReportRoute("/admin")).toBe(false);
    expect(isReportRoute("/gameType")).toBe(false);
    expect(isReportRoute("/reportGame6")).toBe(false);
    expect(isReportRoute("/reportGame1/unknown")).toBe(false);
  });

  it("mount renders 404 for unknown path", () => {
    const c = document.createElement("div");
    mountReportRoute(c, "/reportGame1/weird");
    expect(c.querySelector(".box-danger")).not.toBeNull();
  });
});
