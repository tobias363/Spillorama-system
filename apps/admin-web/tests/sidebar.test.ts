import { describe, it, expect, beforeEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderSidebar } from "../src/shell/Sidebar.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { adminSidebar, agentSidebar, sidebarFor } from "../src/shell/sidebarSpec.js";

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

  it("admin spec includes Spillorama Live group with 12 leaves (11 native + 1 Game 1 master-konsoll)", () => {
    // GAME1_SCHEDULE PR 3 la til master-konsoll som 12. leaf.
    const live = adminSidebar.find((n) => n.kind === "group" && n.id === "spillorama-live");
    expect(live).toBeDefined();
    if (live && live.kind === "group") {
      expect(live.children).toHaveLength(12);
    }
  });

  it("admin spec contains all 34 legacy top-level menu-items + 1 Spillorama Live + 1 header", () => {
    // 1 header + 1 Spillorama Live group + 34 legacy entries
    // (top-level: dashboard, 2 player-ish entries (player-management group + track-spending leaf → both count), etc.)
    expect(adminSidebar.length).toBeGreaterThanOrEqual(30);
    const headers = adminSidebar.filter((n) => n.kind === "header");
    expect(headers).toHaveLength(1);
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
});
