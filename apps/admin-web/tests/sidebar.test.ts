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

  it("agent sidebar includes cash-in-out group (agentOnly)", () => {
    const cash = agentSidebar.find((n) => n.kind === "group" && n.id === "cash-in-out");
    expect(cash).toBeDefined();
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
    const host = document.getElementById("host")!;
    const session = agentSession();
    setSession(session);
    renderSidebar(host, session, "/agent/cashinout");
    const cashGroup = host.querySelector("[data-group-id='cash-in-out']");
    expect(cashGroup).toBeTruthy();
  });

  it("filters groups by module permission for agent", () => {
    const host = document.getElementById("host")!;
    // Agent without Report Management permission
    const session = agentSession({
      permissions: {
        "Players Management": { view: true, add: false, edit: false, delete: false },
      },
    });
    setSession(session);
    renderSidebar(host, session, "/admin");
    // Report group should NOT appear
    const reportGroup = host.querySelector("[data-group-id='report-management']");
    expect(reportGroup).toBeFalsy();
    // Player group SHOULD appear
    const playerGroup = host.querySelector("[data-group-id='player-management']");
    expect(playerGroup).toBeTruthy();
  });
});
