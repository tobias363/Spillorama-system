/**
 * Agent dashboard + player-list admin-UI-sider.
 *
 * Tester:
 *   - AgentDashboardPage rendrer shift-info + counts + recent transactions
 *   - AgentDashboardPage håndterer null shift
 *   - AgentPlayersPage viser liste og export-knapp
 *   - Routes eksisterer i routes.ts
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

describe("routes — agent-dashboard + agent-players", () => {
  it("/agent/dashboard route finnes med riktig titleKey", () => {
    const r = findRoute("/agent/dashboard");
    expect(r).toBeDefined();
    expect(r?.titleKey).toBe("agent_dashboard");
    expect(r?.roles).toEqual(["agent"]);
  });

  it("/agent/players route finnes med riktig titleKey", () => {
    const r = findRoute("/agent/players");
    expect(r).toBeDefined();
    expect(r?.titleKey).toBe("agent_players_title");
    expect(r?.roles).toEqual(["agent"]);
  });
});

describe("AgentDashboardPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = '<div id="c"></div>';
    // Sett token for apiRequest
    window.localStorage.setItem("bingo_admin_access_token", "tok-test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.localStorage.removeItem("bingo_admin_access_token");
  });

  it("rendrer shift-info + counts når backend returnerer aktiv shift", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okJson({
        agent: { userId: "a1", email: "a@x.no", displayName: "Agent One" },
        shift: {
          id: "s1",
          hallId: "hall-a",
          startedAt: "2026-04-21T08:00:00Z",
          endedAt: null,
          dailyBalance: 1234.56,
          totalCashIn: 2000,
          totalCashOut: 765.44,
          totalCardIn: 0,
          totalCardOut: 0,
          sellingByCustomerNumber: 3,
          hallCashBalance: 5000,
          settledAt: null,
        },
        counts: { transactionsToday: 7, playersInHall: 42, activeShiftsInHall: 1 },
        recentTransactions: [
          {
            id: "tx1",
            actionType: "CASH_IN",
            amount: 100,
            paymentMethod: "CASH",
            createdAt: "2026-04-21T09:00:00Z",
          },
        ],
      })
    );
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-dashboard/AgentDashboardPage.js");
    mod.mountAgentDashboard(container);
    // Vent på async refresh
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("#agent-dashboard-shift")).toBeTruthy();
    expect(container.querySelector("#agent-dashboard-counts")).toBeTruthy();
    expect(container.textContent).toContain("1234.56");
    expect(container.textContent).toContain("hall-a");
    expect(container.textContent).toContain("CASH_IN");
    mod.unmountAgentDashboard();
  });

  it("viser 'Ingen aktiv shift' når backend returnerer null shift", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okJson({
        agent: { userId: "a1", email: "a@x.no", displayName: "Agent One" },
        shift: null,
        counts: { transactionsToday: 0, playersInHall: null, activeShiftsInHall: null },
        recentTransactions: [],
      })
    );
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-dashboard/AgentDashboardPage.js");
    mod.mountAgentDashboard(container);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".callout-warning")).toBeTruthy();
    expect(container.textContent?.toLowerCase()).toContain("ingen aktiv shift");
    mod.unmountAgentDashboard();
  });

  it("viser feilmelding når API feiler", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: "FAIL", message: "ouch" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-dashboard/AgentDashboardPage.js");
    mod.mountAgentDashboard(container);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".box-danger")).toBeTruthy();
    mod.unmountAgentDashboard();
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
