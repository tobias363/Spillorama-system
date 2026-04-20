// BIN-647..651 wiring — integration-style tests for report-pages against the
// merged backend endpoints.
//
// Distinct from `gapPages.test.ts` (which verifies fallback rendering), these
// tests lock in:
//   - the actual request URL shape (canonical endpoints)
//   - the request query-string parameters (filter wiring)
//   - the response-shape mapping (shared-types → DataTable columns)
//   - cursor paginations hands nextCursor back correctly

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderPhysicalTicketReportPage } from "../../src/pages/reports/physicalTicket/PhysicalTicketReportPage.js";
import { renderUniqueGameReportPage } from "../../src/pages/reports/uniqueGame/UniqueGameReportPage.js";
import { renderRedFlagCategoryPage } from "../../src/pages/reports/redFlag/RedFlagCategoryPage.js";
import { renderGame1SubgamesPage } from "../../src/pages/reports/game1/Game1SubgamesPage.js";
import {
  fetchPhysicalTicketsAggregate,
  fetchUniqueTicketsRange,
  fetchPhysicalTicketsGamesInHall,
} from "../../src/api/admin-reports-physical.js";
import {
  fetchRedFlagCategories,
  fetchRedFlagPlayers,
} from "../../src/api/admin-reports-redflag.js";
import { fetchSubgameDrillDown } from "../../src/api/admin-reports-drill.js";

interface CapturedRequest {
  url: string;
  method: string;
}

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function recordingFetch(response: (url: string) => unknown): {
  fetch: typeof globalThis.fetch;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    return okJson(response(url));
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe("report-pages wired endpoints", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("BIN-648 physical-tickets aggregate", () => {
    it("fetchPhysicalTicketsAggregate hits canonical URL with all filters", async () => {
      const { fetch, calls } = recordingFetch(() => ({
        generatedAt: "",
        from: null,
        to: null,
        hallId: null,
        rows: [],
        totals: { sold: 0, pending: 0, cashedOut: 0, totalRevenueCents: 0, rowCount: 0 },
      }));
      globalThis.fetch = fetch;
      await fetchPhysicalTicketsAggregate({
        hallId: "hall-abc",
        from: "2026-03-01",
        to: "2026-04-01",
        limit: 100,
      });
      expect(calls[0]?.url).toContain("/api/admin/reports/physical-tickets/aggregate");
      expect(calls[0]?.url).toContain("hallId=hall-abc");
      expect(calls[0]?.url).toContain("from=2026-03-01");
      expect(calls[0]?.url).toContain("to=2026-04-01");
      expect(calls[0]?.url).toContain("limit=100");
    });

    it("page renders columns from PhysicalTicketsAggregateRow", async () => {
      const { fetch } = recordingFetch((url: string) => {
        if (url.includes("/api/admin/halls")) return [];
        return {
          generatedAt: "",
          from: null,
          to: null,
          hallId: null,
          rows: [
            {
              gameId: "g-1",
              hallId: "hall-1",
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
      });
      globalThis.fetch = fetch;
      const c = document.createElement("div");
      await renderPhysicalTicketReportPage(c);
      // First cell should be gameId; "g-1" must be rendered as text.
      const firstRow = c.querySelector("#physical-ticket-report-table tbody tr");
      expect(firstRow).not.toBeNull();
      expect(firstRow!.textContent).toContain("g-1");
      expect(firstRow!.textContent).toContain("10");
    });
  });

  describe("BIN-649 unique-tickets range", () => {
    it("fetchUniqueTicketsRange hits canonical URL with filters", async () => {
      const { fetch, calls } = recordingFetch(() => ({
        hallId: null,
        status: null,
        uniqueIdStart: null,
        uniqueIdEnd: null,
        from: null,
        to: null,
        limit: 50,
        offset: 0,
        rows: [],
        count: 0,
      }));
      globalThis.fetch = fetch;
      await fetchUniqueTicketsRange({
        hallId: "h1",
        status: "SOLD",
        uniqueIdStart: 100,
        uniqueIdEnd: 200,
        from: "2026-03-01",
        to: "2026-04-01",
        limit: 50,
        offset: 100,
      });
      const url = calls[0]?.url ?? "";
      expect(url).toContain("/api/admin/reports/unique-tickets/range");
      expect(url).toContain("hallId=h1");
      expect(url).toContain("status=SOLD");
      expect(url).toContain("uniqueIdStart=100");
      expect(url).toContain("uniqueIdEnd=200");
      expect(url).toContain("from=2026-03-01");
      expect(url).toContain("to=2026-04-01");
      expect(url).toContain("limit=50");
      expect(url).toContain("offset=100");
    });

    it("page emits offset-cursor after a full page", async () => {
      const { fetch, calls } = recordingFetch((url: string) => {
        if (url.includes("/api/admin/halls")) return [];
        // Respond with 50 rows (full page) so that DataTable synthesizes a
        // non-null nextCursor based on offset.
        const rows = Array.from({ length: 50 }, (_, i) => ({
          id: `t${i}`,
          uniqueId: 1000 + i,
          hallId: "h1",
          status: "SOLD",
          assignedGameId: null,
          priceCents: 100,
          createdAt: "2026-04-01T00:00:00Z",
          soldAt: null,
        }));
        return {
          hallId: null,
          status: null,
          uniqueIdStart: null,
          uniqueIdEnd: null,
          from: null,
          to: null,
          limit: 50,
          offset: 0,
          rows,
          count: 50,
        };
      });
      globalThis.fetch = fetch;
      const c = document.createElement("div");
      await renderUniqueGameReportPage(c);
      await new Promise((r) => setTimeout(r, 0));
      // Request includes limit=50 (cursor paging default)
      const reqUrls = calls.map((x) => x.url);
      expect(reqUrls.some((u) => u.includes("/api/admin/reports/unique-tickets/range"))).toBe(true);
      expect(c.querySelectorAll("#unique-game-report-table tbody tr").length).toBe(50);
      // Load-more button is active (nextCursor non-null).
      const btn = c.querySelector<HTMLButtonElement>(".datatable-load-more");
      expect(btn).not.toBeNull();
      expect(btn!.disabled).toBe(false);
    });
  });

  describe("BIN-650 red-flag categories", () => {
    it("fetchRedFlagCategories hits canonical URL with dateRange", async () => {
      const { fetch, calls } = recordingFetch(() => ({
        from: "",
        to: "",
        generatedAt: "",
        categories: [],
        totals: { totalFlags: 0, totalOpenFlags: 0, categoryCount: 0 },
      }));
      globalThis.fetch = fetch;
      await fetchRedFlagCategories({ from: "2026-03-01", to: "2026-04-01" });
      const url = calls[0]?.url ?? "";
      expect(url).toContain("/api/admin/reports/red-flag/categories");
      expect(url).toContain("from=2026-03-01");
      expect(url).toContain("to=2026-04-01");
    });

    it("page renders RedFlagCategoryRow columns (label, severity, count, openCount)", async () => {
      const { fetch } = recordingFetch(() => ({
        from: "",
        to: "",
        generatedAt: "",
        categories: [
          {
            category: "pep",
            label: "PEP",
            description: "Politically exposed",
            severity: "CRITICAL",
            count: 2,
            openCount: 1,
          },
        ],
        totals: { totalFlags: 2, totalOpenFlags: 1, categoryCount: 1 },
      }));
      globalThis.fetch = fetch;
      const c = document.createElement("div");
      await renderRedFlagCategoryPage(c);
      const row = c.querySelector("#redflag-categories-table tbody tr");
      expect(row).not.toBeNull();
      expect(row!.textContent).toContain("PEP");
      expect(row!.textContent).toContain("CRITICAL");
    });
  });

  describe("BIN-651 red-flag players (cursor paginated)", () => {
    it("fetchRedFlagPlayers hits canonical URL with category + cursor", async () => {
      const { fetch, calls } = recordingFetch(() => ({
        category: "high-velocity",
        from: null,
        to: null,
        items: [],
        nextCursor: null,
        totalCount: 0,
      }));
      globalThis.fetch = fetch;
      await fetchRedFlagPlayers({
        category: "high-velocity",
        from: "2026-03-01",
        to: "2026-04-01",
        cursor: "opaque123",
        limit: 50,
      });
      const url = calls[0]?.url ?? "";
      expect(url).toContain("/api/admin/reports/red-flag/players");
      expect(url).toContain("category=high-velocity");
      expect(url).toContain("from=2026-03-01");
      expect(url).toContain("to=2026-04-01");
      expect(url).toContain("cursor=opaque123");
      expect(url).toContain("limit=50");
    });

    it("page passes nextCursor back to backend on load-more", async () => {
      let call = 0;
      const { fetch, calls } = recordingFetch(() => {
        call += 1;
        if (call === 1) {
          return {
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
                totalStakes: 100,
                lastActivity: "2026-04-01T11:00:00Z",
              },
            ],
            nextCursor: "page-2-cursor",
            totalCount: 2,
          };
        }
        return {
          category: "high-velocity",
          from: null,
          to: null,
          items: [
            {
              userId: "u2",
              displayName: "Bob",
              email: "b@b.no",
              categoryId: "high-velocity",
              flaggedAt: "2026-04-01T10:00:00Z",
              totalStakes: 200,
              lastActivity: "2026-04-01T11:00:00Z",
            },
          ],
          nextCursor: null,
          totalCount: 2,
        };
      });
      globalThis.fetch = fetch;
      const c = document.createElement("div");
      await renderRedFlagCategoryPage(c, "high-velocity");
      await new Promise((r) => setTimeout(r, 0));

      // Click load-more
      const btn = c.querySelector<HTMLButtonElement>(".datatable-load-more");
      expect(btn).not.toBeNull();
      btn!.click();
      await new Promise((r) => setTimeout(r, 0));

      // Second call should include cursor=page-2-cursor.
      const urlsWithCursor = calls.filter((c) => c.url.includes("cursor=page-2-cursor"));
      expect(urlsWithCursor.length).toBeGreaterThan(0);
    });
  });

  describe("BIN-647 subgame drill-down (cursor paginated)", () => {
    it("fetchSubgameDrillDown hits canonical URL with parentId + dateRange + cursor", async () => {
      const { fetch, calls } = recordingFetch(() => ({
        parentId: "p1",
        from: "",
        to: "",
        items: [],
        nextCursor: null,
        totals: { revenue: 0, totalWinnings: 0, netProfit: 0, ticketCount: 0, players: 0 },
      }));
      globalThis.fetch = fetch;
      await fetchSubgameDrillDown({
        parentId: "p1",
        from: "2026-03-01",
        to: "2026-04-01",
        cursor: "cursor-abc",
        limit: 25,
      });
      const url = calls[0]?.url ?? "";
      expect(url).toContain("/api/admin/reports/subgame-drill-down");
      expect(url).toContain("parentId=p1");
      expect(url).toContain("from=2026-03-01");
      expect(url).toContain("to=2026-04-01");
      expect(url).toContain("cursor=cursor-abc");
      expect(url).toContain("limit=25");
    });

    it("page renders items from response.items", async () => {
      const { fetch } = recordingFetch(() => ({
        parentId: "parent-1",
        from: "",
        to: "",
        items: [
          {
            subGameId: "sub-1",
            subGameNumber: "A",
            parentScheduleId: "parent-1",
            hallId: "h1",
            hallName: "Hall 1",
            gameType: "bingo",
            gameMode: null,
            name: "Row 1",
            sequence: 1,
            startDate: null,
            revenue: 5000,
            totalWinnings: 2000,
            netProfit: 3000,
            profitPercentage: 60,
            ticketCount: 10,
            players: 4,
          },
        ],
        nextCursor: null,
        totals: { revenue: 5000, totalWinnings: 2000, netProfit: 3000, ticketCount: 10, players: 4 },
      }));
      globalThis.fetch = fetch;
      const c = document.createElement("div");
      await renderGame1SubgamesPage(c, "parent-1");
      await new Promise((r) => setTimeout(r, 0));
      const firstCell = c.querySelector("#subgame-drilldown-table tbody tr td");
      expect(firstCell?.textContent).toBe("A");
    });
  });

  describe("BIN-638 physical-tickets games-in-hall", () => {
    it("fetchPhysicalTicketsGamesInHall hits canonical URL with hallId required", async () => {
      const { fetch, calls } = recordingFetch(() => ({
        generatedAt: "",
        hallId: "h1",
        from: null,
        to: null,
        rows: [],
        totals: {
          sold: 0,
          pendingCashoutCount: 0,
          ticketsInPlay: 0,
          cashedOut: 0,
          totalRevenueCents: 0,
          rowCount: 0,
        },
      }));
      globalThis.fetch = fetch;
      await fetchPhysicalTicketsGamesInHall({ hallId: "h1", from: "2026-04-01" });
      const url = calls[0]?.url ?? "";
      expect(url).toContain("/api/admin/physical-tickets/games/in-hall");
      expect(url).toContain("hallId=h1");
      expect(url).toContain("from=2026-04-01");
    });
  });
});
