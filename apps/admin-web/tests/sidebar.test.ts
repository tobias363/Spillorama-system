import { describe, it, expect, beforeEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderSidebar } from "../src/shell/Sidebar.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { adminSidebar, agentSidebar, sidebarFor, type SidebarNode } from "../src/shell/sidebarSpec.js";

function adminSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "u1",
    name: "Admin",
    email: "admin@example.com",
    role: "admin",
    isSuperAdmin: true,
    avatar: "",
    hall: [],
    dailyBalance: null,
    permissions: {},
    ...overrides,
  };
}

function agentSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "u2",
    name: "Agent",
    email: "agent@example.com",
    role: "agent",
    isSuperAdmin: false,
    avatar: "",
    hall: [{ id: "h1", name: "Oslo Sentrum" }],
    dailyBalance: 123.45,
    permissions: {
      "Players Management": { view: true, add: true, edit: true, delete: false },
      "Report Management": { view: true, add: false, edit: false, delete: false },
    },
    ...overrides,
  };
}

describe("Sidebar spec", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
  });

  it("admin spec does NOT include Spillorama Live iframe-group (fjernet 2026-04-27)", () => {
    // Spillorama Live var en sidebar-section som lastet legacy-v1 i iframe.
    // Fjernet — alle features er native i admin nå.
    const live = adminSidebar.find((n) => n.kind === "group" && n.id === "spillorama-live");
    expect(live).toBeUndefined();
  });

  it("admin spec exposes Game 1 master-konsoll som top-level entry", () => {
    // Master-konsollen lå tidligere nestet i Spillorama Live-gruppen. Etter
    // fjerning av iframe-section er den løftet til top-level.
    const master = adminSidebar.find((n) => n.kind === "leaf" && n.id === "game1-master-console");
    expect(master).toBeDefined();
    if (master && master.kind === "leaf") {
      expect(master.path).toBe("/game1/master/placeholder");
    }
  });

  it("admin spec contains expected count of top-level menu-items + 1 header", () => {
    expect(adminSidebar.length).toBeGreaterThanOrEqual(30);
    const headers = adminSidebar.filter((n) => n.kind === "header");
    expect(headers).toHaveLength(1);
  });

  it("admin spec contains no /live/* paths (iframe-section fjernet)", () => {
    // Sjekk rekursivt at ingen leaf har en path som starter med /live/.
    const hasLivePath = adminSidebar.some((n) => {
      if (n.kind === "leaf") return n.path.startsWith("/live/");
      if (n.kind === "group") return n.children.some((c) => c.path.startsWith("/live/"));
      return false;
    });
    expect(hasLivePath).toBe(false);
  });

  it("agent sidebar includes cash-in-out group", () => {
    // Agent-portal skeleton PR endret id fra "cash-in-out" til "agent-cash-in-out"
    // for å unngå kollisjon med admin-panelets cash-inout-gruppe.
    const cash = agentSidebar.find((n) => n.kind === "group" && n.id === "agent-cash-in-out");
    expect(cash).toBeDefined();
  });

  it("agent sidebar exposes Sell Products under cash-in-out (wireframe §17.12)", () => {
    const cash = agentSidebar.find((n) => n.kind === "group" && n.id === "agent-cash-in-out");
    expect(cash).toBeDefined();
    if (cash && cash.kind === "group") {
      const sell = cash.children.find((c) => c.id === "agent-sell-products");
      expect(sell).toBeDefined();
      expect(sell?.path).toBe("/agent/sellProduct");
    }
  });

  it("agent sidebar exposes Schedule Management + Saved Game List under game-management (PR #823 audit gaps #2/#4)", () => {
    const games = agentSidebar.find((n) => n.kind === "group" && n.id === "agent-game-management");
    expect(games).toBeDefined();
    if (games && games.kind === "group") {
      const schedules = games.children.find((c) => c.id === "agent-schedules");
      expect(schedules).toBeDefined();
      expect(schedules?.path).toBe("/schedules");
      expect(schedules?.labelKey).toBe("schedule_management");

      const savedGames = games.children.find((c) => c.id === "agent-saved-game-list");
      expect(savedGames).toBeDefined();
      expect(savedGames?.path).toBe("/savedGameList");
      expect(savedGames?.labelKey).toBe("saved_game_list");
    }
  });

  it("agent sidebar exposes report-management group with 4 wireframe-paritets-leaves (PR #823 audit gaps #7/#12/#14/#15)", () => {
    const reports = agentSidebar.find((n) => n.kind === "group" && n.id === "agent-report-management");
    expect(reports).toBeDefined();
    if (reports && reports.kind === "group") {
      const ids = reports.children.map((c) => c.id);
      expect(ids).toContain("agent-report-game1");
      expect(ids).toContain("agent-hall-specific-report");
      expect(ids).toContain("agent-hall-account-report");
      expect(ids).toContain("agent-payout-player");

      // Verifiser at paths matcher ekisterende admin-routes (router-guard
      // tillater AGENT etter PR #824, og backend RBAC har AGENT på alle
      // permissions per PR #797 + #807).
      const paths = reports.children.map((c) => c.path);
      expect(paths).toEqual([
        "/reportGame1",
        "/hallSpecificReport",
        "/hallAccountReport",
        "/payoutPlayer",
      ]);
    }
  });

  it("agent sidebar does NOT expose Wallet Management (RBAC blokk — WALLET_COMPLIANCE_READ er ADMIN/SUPPORT only)", () => {
    // PR #823 audit rad 8: Wallet Management mangler AGENT i RBAC, og er
    // bevisst ekskludert fra agent-sidebar inntil Tobias tar beslutning.
    const findWalletLeaf = (nodes: SidebarNode[]): boolean =>
      nodes.some((n) => {
        if (n.kind === "leaf") return n.path === "/wallet" || n.id === "wallet";
        if (n.kind === "group") return findWalletLeaf(n.children);
        return false;
      });
    expect(findWalletLeaf(agentSidebar)).toBe(false);
  });

  it("agent sidebar exposes Past Game Winning History (wireframe §17.32) and Sold Tickets (wireframe §17.31)", () => {
    const past = agentSidebar.find((n) => n.kind === "leaf" && n.id === "agent-past-winning-history");
    expect(past).toBeDefined();
    if (past && past.kind === "leaf") {
      expect(past.path).toBe("/agent/past-winning-history");
    }
    const sold = agentSidebar.find((n) => n.kind === "leaf" && n.id === "agent-sold-tickets");
    expect(sold).toBeDefined();
    if (sold && sold.kind === "leaf") {
      // Bruker /agent/-prefiks for å passere routes-guarden.
      expect(sold.path).toBe("/agent/sold-tickets");
    }
  });

  it("sidebarFor returns admin spec for admin/super-admin and agent spec for agent", () => {
    expect(sidebarFor("admin")).toBe(adminSidebar);
    expect(sidebarFor("super-admin")).toBe(adminSidebar);
    expect(sidebarFor("agent")).toBe(agentSidebar);
  });

  // Legacy 1:1 sidebar (Tobias screenshot 2026-04-27) — verify menu-items
  // appear in the correct order under "Hovednavigasjon". `game1-master-console`
  // skutt inn etter cash-inout for hurtig-tilgang til BIN1-master (PR
  // #629 + master-console-route 2026-04-27).
  // `admin-ops` skutt inn etter dashboard som ADMIN/super-admin-only entry
  // for ops-console (PR #667 — Ops Console backend + frontend 2026-04-27).
  describe("legacy 1:1 layout", () => {
    const LEGACY_ORDER: { id: string; kind: "leaf" | "group" }[] = [
      { id: "dashboard", kind: "leaf" },
      { id: "admin-ops", kind: "leaf" },
      { id: "cash-inout", kind: "group" },
      { id: "game1-master-console", kind: "leaf" },
      { id: "player-management", kind: "group" },
      { id: "schedules", kind: "leaf" },
      { id: "gameManagement", kind: "leaf" },
      { id: "savedGameList", kind: "leaf" },
      { id: "addPhysicalTickets", kind: "leaf" },
      { id: "physicalTicketManagement", kind: "leaf" },
      { id: "physicalCashOut", kind: "leaf" },
      { id: "product-management", kind: "group" },
      { id: "report-management", kind: "group" },
      { id: "payout-management", kind: "group" },
      { id: "hallSpecificReport", kind: "leaf" },
      { id: "wallet", kind: "leaf" },
      { id: "transactions-management", kind: "group" },
      { id: "withdraw-management", kind: "group" },
    ];

    it("first node is the Hovednavigasjon-header", () => {
      expect(adminSidebar[0]).toEqual({ kind: "header", labelKey: "main_navigation" });
    });

    it("the 16 legacy menu-items + admin-ops appear directly after the header in correct order", () => {
      const after = adminSidebar.slice(1, 1 + LEGACY_ORDER.length);
      const observed = after.map((n) => ({
        id: n.kind === "header" ? "<header>" : n.id,
        kind: n.kind,
      }));
      expect(observed).toEqual(LEGACY_ORDER);
    });

    it("Kontant inn/ut group has the 2 expected children (Kontant inn/ut, Solgte billetter)", () => {
      const cash = adminSidebar.find((n) => n.kind === "group" && n.id === "cash-inout");
      expect(cash).toBeDefined();
      if (cash && cash.kind === "group") {
        expect(cash.children.map((c) => c.id)).toEqual([
          "cash-inout-overview",
          "cash-inout-sold-tickets",
        ]);
        expect(cash.children.map((c) => c.path)).toEqual([
          "/agent/cashinout",
          "/sold-tickets",
        ]);
        expect(cash.defaultExpanded).toBe(true);
      }
    });

    it("Spilleradministrasjon group is expandable (chevron via group-kind, not default-expanded)", () => {
      const players = adminSidebar.find((n) => n.kind === "group" && n.id === "player-management");
      expect(players).toBeDefined();
      if (players && players.kind === "group") {
        expect(players.defaultExpanded).toBeUndefined();
      }
    });

    it("Transaksjonsadministrasjon group is expandable", () => {
      const tx = adminSidebar.find((n) => n.kind === "group" && n.id === "transactions-management");
      expect(tx).toBeDefined();
      if (tx && tx.kind === "group") {
        expect(tx.defaultExpanded).toBeUndefined();
      }
    });
  });
});

describe("renderSidebar", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "<div id='host'></div>";
  });

  it("renders admin sidebar with user panel and menu items", () => {
    const host = document.getElementById("host")!;
    const session = adminSession();
    setSession(session);
    renderSidebar(host, session, "/admin");
    expect(host.querySelector(".main-sidebar")).toBeTruthy();
    expect(host.querySelector(".user-panel")).toBeTruthy();
    expect(host.querySelector(".sidebar-menu")).toBeTruthy();
  });

  it("marks current route as active", () => {
    const host = document.getElementById("host")!;
    const session = adminSession();
    setSession(session);
    renderSidebar(host, session, "/admin");
    const active = host.querySelector(".sidebar-menu > li.active");
    expect(active).toBeTruthy();
    expect(active?.querySelector("a")?.getAttribute("href")).toBe("#/admin");
  });

  it("hides admin-only items from agent", () => {
    const host = document.getElementById("host")!;
    const session = agentSession();
    setSession(session);
    renderSidebar(host, session, "/admin");
    const anchors = Array.from(host.querySelectorAll<HTMLAnchorElement>("a[href^='#']"));
    const hrefs = anchors.map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("#/adminUser");
    expect(hrefs).not.toContain("#/agent");
    expect(hrefs).not.toContain("#/role");
  });

  it("renders cash-in-out group for agent", () => {
    // Agent-portal skeleton PR: id flyttet til "agent-cash-in-out".
    const host = document.getElementById("host")!;
    const session = agentSession();
    setSession(session);
    renderSidebar(host, session, "/agent/cash-in-out");
    const cashGroup = host.querySelector("[data-group-id='agent-cash-in-out']");
    expect(cashGroup).toBeTruthy();
  });

  it("renders player-management group for agent", () => {
    // Agent-portal skeleton PR: id flyttet til "agent-player-management"
    // slik at samme id ikke overlapper admin-panelets player-management.
    const host = document.getElementById("host")!;
    const session = agentSession();
    setSession(session);
    renderSidebar(host, session, "/agent/players");
    const playerGroup = host.querySelector("[data-group-id='agent-player-management']");
    expect(playerGroup).toBeTruthy();
  });

  it("admin sidebar renders Kontant inn/ut group as default-expanded (menu-open)", () => {
    const host = document.getElementById("host")!;
    const session = adminSession();
    setSession(session);
    renderSidebar(host, session, "/admin");
    const cash = host.querySelector<HTMLLIElement>("[data-group-id='cash-inout']");
    expect(cash).toBeTruthy();
    expect(cash?.classList.contains("menu-open")).toBe(true);
    const submenu = cash?.querySelector<HTMLUListElement>(":scope > ul.treeview-menu");
    expect(submenu?.style.display).toBe("block");
  });

  it("admin sidebar renders chevron (fa-angle-left) on expandable groups", () => {
    const host = document.getElementById("host")!;
    const session = adminSession();
    setSession(session);
    renderSidebar(host, session, "/admin");
    const playerGroup = host.querySelector<HTMLLIElement>("[data-group-id='player-management']");
    expect(playerGroup).toBeTruthy();
    const chevron = playerGroup?.querySelector(".pull-right-container .fa-angle-left");
    expect(chevron).toBeTruthy();
  });

  it("admin sidebar renders all 16 legacy menu-items + admin-ops in sequence directly after the header", () => {
    const host = document.getElementById("host")!;
    const session = adminSession();
    setSession(session);
    renderSidebar(host, session, "/admin");
    const ul = host.querySelector<HTMLUListElement>(".sidebar-menu");
    expect(ul).toBeTruthy();
    const items = Array.from(ul!.children) as HTMLLIElement[];
    // First child is the header <li class="header">.
    expect(items[0]?.classList.contains("header")).toBe(true);
    // Legacy menu-items. We verify each by id (leaf) or data-group-id (group).
    // Game1 master-console er innskutt etter cash-inout (PR #629 +
    // game1-master-console route 2026-04-27).
    // admin-ops er innskutt etter dashboard som ADMIN/super-admin-only
    // entry for ops-console (PR #667 — 2026-04-27).
    const expected = [
      { kind: "leaf", routeId: "dashboard" },
      { kind: "leaf", routeId: "admin-ops" },
      { kind: "group", id: "cash-inout" },
      { kind: "leaf", routeId: "game1-master-console" },
      { kind: "group", id: "player-management" },
      { kind: "leaf", routeId: "schedules" },
      { kind: "leaf", routeId: "gameManagement" },
      { kind: "leaf", routeId: "savedGameList" },
      { kind: "leaf", routeId: "addPhysicalTickets" },
      { kind: "leaf", routeId: "physicalTicketManagement" },
      { kind: "leaf", routeId: "physicalCashOut" },
      { kind: "group", id: "product-management" },
      { kind: "group", id: "report-management" },
      { kind: "group", id: "payout-management" },
      { kind: "leaf", routeId: "hallSpecificReport" },
      { kind: "leaf", routeId: "wallet" },
      { kind: "group", id: "transactions-management" },
      { kind: "group", id: "withdraw-management" },
    ];
    for (let i = 0; i < expected.length; i++) {
      const li = items[i + 1];
      const e = expected[i];
      expect(li, `item ${i} (${JSON.stringify(e)})`).toBeTruthy();
      if (!li || !e) continue;
      if (e.kind === "leaf") {
        const a = li.querySelector<HTMLAnchorElement>(`a[data-route-id='${e.routeId}']`);
        expect(a, `expected leaf with data-route-id='${e.routeId}' at position ${i + 1}`).toBeTruthy();
      } else {
        expect(li.getAttribute("data-group-id"), `expected group ${e.id} at position ${i + 1}`).toBe(e.id);
      }
    }
  });
});
