/**
 * Agent-portal dashboard + player-list admin-UI-sider.
 *
 * Real-data-wiring koblet AgentDashboardPage til /api/agent/dashboard og
 * rendrer alle 4 wireframe-widgets med faktiske respons-felter (KPI,
 * Latest Requests, Top 5 Players, Ongoing Games tabs Spill 1-3 + SpinnGo).
 *
 * Tester:
 *   - AgentDashboardPage poller /api/agent/dashboard og rendrer widgets
 *   - Tab-bytting oppdaterer active-klasse
 *   - unmount avbryter polling
 *   - AgentPlayersPage viser liste og export-knapp
 *   - Routes eksisterer i routes.ts med agent+hall-operator roles
 *   - Placeholder-routes for /agent/* skeleton registrert
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findRoute } from "../src/router/routes.js";
import { initI18n } from "../src/i18n/I18n.js";

const originalFetch = globalThis.fetch;

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("routes — agent-portal skeleton", () => {
  it("/agent/dashboard route finnes med riktig titleKey og roles", () => {
    const r = findRoute("/agent/dashboard");
    expect(r).toBeDefined();
    expect(r?.titleKey).toBe("agent_dashboard");
    expect(r?.roles).toContain("agent");
    expect(r?.roles).toContain("hall-operator");
  });

  it("/agent/players route finnes", () => {
    const r = findRoute("/agent/players");
    expect(r).toBeDefined();
    expect(r?.titleKey).toBe("agent_players_title");
    expect(r?.roles).toContain("agent");
    expect(r?.roles).toContain("hall-operator");
  });

  it("registrerer alle agent-portal skeleton-routes", () => {
    const skeletonPaths = [
      "/agent/physical-tickets",
      "/agent/games",
      "/agent/cash-in-out",
      "/agent/unique-id",
      "/agent/physical-cashout",
    ];
    for (const p of skeletonPaths) {
      const r = findRoute(p);
      expect(r, `route ${p} skal finnes`).toBeDefined();
      expect(r?.roles).toContain("agent");
      expect(r?.roles).toContain("hall-operator");
    }
  });
});

describe("AgentDashboardPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = '<div id="c"></div>';
    window.localStorage.setItem("bingo_admin_access_token", "tok-test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.localStorage.removeItem("bingo_admin_access_token");
  });

  function dashboardFixture(overrides: Record<string, unknown> = {}): unknown {
    return {
      agent: { userId: "agent-1", email: "agent@x.no", displayName: "Agent" },
      shift: {
        id: "s1",
        hallId: "hall-a",
        startedAt: "2026-04-30T08:00:00Z",
        endedAt: null,
        dailyBalance: 100,
        totalCashIn: 0,
        totalCashOut: 0,
        totalCardIn: 0,
        totalCardOut: 0,
        sellingByCustomerNumber: 0,
        hallCashBalance: 0,
        settledAt: null,
      },
      counts: {
        transactionsToday: 0,
        playersInHall: 250,
        activeShiftsInHall: 1,
        pendingRequests: 2,
      },
      recentTransactions: [],
      latestRequests: [
        {
          id: "req-1",
          kind: "deposit",
          userId: "user-1",
          amountCents: 10000,
          createdAt: "2026-04-30T08:30:00Z",
        },
        {
          id: "req-2",
          kind: "deposit",
          userId: "user-2",
          amountCents: 25000,
          createdAt: "2026-04-30T08:45:00Z",
        },
      ],
      topPlayers: [
        { id: "p1", username: "alice", walletAmount: 1500 },
        { id: "p2", username: "bob", walletAmount: 1200 },
      ],
      ongoingGames: [
        {
          roomCode: "rm-bingo-1",
          hallId: "hall-a",
          gameSlug: "bingo",
          gameStatus: "RUNNING",
          playerCount: 12,
          createdAt: "2026-04-30T09:00:00Z",
        },
        {
          roomCode: "rm-rocket-1",
          hallId: "hall-a",
          gameSlug: "rocket",
          gameStatus: "WAITING",
          playerCount: 5,
          createdAt: "2026-04-30T09:30:00Z",
        },
      ],
      ...overrides,
    };
  }

  it("poller /api/agent/dashboard og rendrer alle 4 widgets", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(dashboardFixture()));
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-dashboard/AgentDashboardPage.js");
    mod.mountAgentDashboard(container);
    // Vent på initial fetch
    await new Promise((r) => setTimeout(r, 50));

    expect(container.querySelector("[data-marker='agent-dashboard-kpis']")).toBeTruthy();
    expect(container.querySelector("[data-kpi='approved-players']")?.textContent).toBe("250");
    expect(container.querySelector("[data-marker='agent-dashboard-latest-requests']")).toBeTruthy();
    expect(container.querySelector("[data-marker='agent-dashboard-top-players']")).toBeTruthy();
    expect(container.querySelector("[data-marker='agent-dashboard-ongoing-games']")).toBeTruthy();
    expect(container.querySelector("[data-marker='cash-in-out-button']")).toBeTruthy();
    expect(container.querySelector("[data-marker='lang-toggle']")).toBeTruthy();

    // 4 game-tabs finnes (Spill 1-3 + SpinnGo) — game4 er deprecated
    const tabs = container.querySelectorAll("a[data-game-tab]");
    expect(tabs).toHaveLength(4);
    const tabIds = Array.from(tabs).map((a) => a.getAttribute("data-game-tab"));
    expect(tabIds).toEqual(["game1", "game2", "game3", "game5"]);

    // Latest requests-rader (2 fra fixture)
    expect(container.querySelectorAll("[data-marker='latest-request-row']")).toHaveLength(2);
    // Top players-rader (2 fra fixture)
    expect(container.querySelectorAll("[data-marker='top-player-row']")).toHaveLength(2);

    mod.unmountAgentDashboard();
  });

  it("rendrer 'ingen forespørsler'-fallback når lister er tomme", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okJson(
        dashboardFixture({
          latestRequests: [],
          topPlayers: [],
          ongoingGames: [],
          counts: { transactionsToday: 0, playersInHall: 0, activeShiftsInHall: 0, pendingRequests: 0 },
        }),
      ),
    );
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-dashboard/AgentDashboardPage.js");
    mod.mountAgentDashboard(container);
    await new Promise((r) => setTimeout(r, 50));

    expect(container.querySelectorAll("[data-marker='latest-request-row']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-marker='top-player-row']")).toHaveLength(0);
    expect(container.textContent?.toLowerCase()).toContain("ingen ventende");

    mod.unmountAgentDashboard();
  });

  it("tab-bytting oppdaterer active-klasse", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(dashboardFixture()));
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-dashboard/AgentDashboardPage.js");
    mod.mountAgentDashboard(container);
    await new Promise((r) => setTimeout(r, 50));

    // Default active tab er game1
    const pane1 = container.querySelector("#tab-game1");
    const pane2 = container.querySelector("#tab-game2");
    expect(pane1?.classList.contains("active")).toBe(true);
    expect(pane2?.classList.contains("active")).toBe(false);

    // Klikk på game2 tab
    const tab2 = container.querySelector<HTMLAnchorElement>(
      "a[data-game-tab='game2']",
    );
    tab2!.click();
    expect(pane1?.classList.contains("active")).toBe(false);
    expect(pane2?.classList.contains("active")).toBe(true);

    mod.unmountAgentDashboard();
  });

  it("unmountAgentDashboard avbryter polling-timeren", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(dashboardFixture()));
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-dashboard/AgentDashboardPage.js");
    mod.mountAgentDashboard(container);
    await new Promise((r) => setTimeout(r, 50));
    // Skal ikke kaste eller ha bivirkninger
    expect(() => mod.unmountAgentDashboard()).not.toThrow();
  });
});

describe("AgentPlayersPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = '<div id="c"></div>';
    window.localStorage.setItem("bingo_admin_access_token", "tok-test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.localStorage.removeItem("bingo_admin_access_token");
  });

  it("rendrer spiller-tabell med export-knapp", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okJson({
        hallId: "hall-a",
        players: [
          {
            id: "p1",
            email: "alice@x.no",
            displayName: "Alice",
            surname: "Alvegard",
            phone: "12345678",
            kycStatus: "VERIFIED",
            createdAt: "2026-04-21T08:00:00Z",
          },
        ],
        count: 1,
        limit: 100,
      })
    );
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-players/AgentPlayersPage.js");
    mod.mountAgentPlayers(container);
    await new Promise((r) => setTimeout(r, 50));
    const table = container.querySelector<HTMLTableElement>("#agent-players-table");
    expect(table).toBeTruthy();
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("alice@x.no");
    const exportBtn = container.querySelector<HTMLButtonElement>("[data-export-id='p1']");
    expect(exportBtn).toBeTruthy();
  });

  it("viser 'ingen spillere' når liste er tom", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okJson({ hallId: "hall-a", players: [], count: 0, limit: 100 })
    );
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-players/AgentPlayersPage.js");
    mod.mountAgentPlayers(container);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent?.toLowerCase()).toContain("ingen spillere");
  });
});
