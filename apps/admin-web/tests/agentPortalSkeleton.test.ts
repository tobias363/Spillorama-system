/**
 * Agent-portal skeleton — role-based redirect + route-guard + placeholder-sider.
 *
 * Tester:
 *   - mapUserToSession mapper AGENT/HALL_OPERATOR riktig
 *   - landingRouteForRole returnerer /agent/dashboard for begge
 *   - Placeholder-sider rendrer tittel, breadcrumb og "Kommer snart"-merke
 *   - Agent-sidebar inneholder de forventede menu-items per V1.0/V2.0-wireframe
 */
import { describe, it, expect, beforeEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import {
  landingRouteForRole,
  isAgentPortalRole,
  isAdminPanelRole,
  type Session,
} from "../src/auth/Session.js";
import { agentSidebar } from "../src/shell/sidebarSpec.js";
import { mountAgentPhysicalTickets } from "../src/pages/agent-portal/AgentPhysicalTicketsPage.js";
import { mountAgentCashInOut } from "../src/pages/agent-portal/AgentCashInOutPage.js";
import { mountAgentUniqueId } from "../src/pages/agent-portal/AgentUniqueIdPage.js";
import { mountAgentPhysicalCashout } from "../src/pages/agent-portal/AgentPhysicalCashoutPage.js";

function makeSession(role: Session["role"]): Session {
  return {
    id: "u1",
    name: "Test",
    email: "t@x.no",
    role,
    isSuperAdmin: role === "super-admin",
    avatar: "",
    hall: [],
    dailyBalance: null,
    permissions: {},
  };
}

describe("Session role-helpers", () => {
  it("isAgentPortalRole returnerer true for AGENT og HALL_OPERATOR", () => {
    expect(isAgentPortalRole("agent")).toBe(true);
    expect(isAgentPortalRole("hall-operator")).toBe(true);
    expect(isAgentPortalRole("admin")).toBe(false);
    expect(isAgentPortalRole("super-admin")).toBe(false);
  });

  it("isAdminPanelRole returnerer true for ADMIN og super-admin", () => {
    expect(isAdminPanelRole("admin")).toBe(true);
    expect(isAdminPanelRole("super-admin")).toBe(true);
    expect(isAdminPanelRole("agent")).toBe(false);
    expect(isAdminPanelRole("hall-operator")).toBe(false);
  });

  it("landingRouteForRole sender AGENT/HALL_OPERATOR til /agent/dashboard", () => {
    expect(landingRouteForRole("agent")).toBe("/agent/dashboard");
    expect(landingRouteForRole("hall-operator")).toBe("/agent/dashboard");
    expect(landingRouteForRole("admin")).toBe("/admin");
    expect(landingRouteForRole("super-admin")).toBe("/admin");
  });
});

describe("mapUserToSession (backend → admin-web role-mapping)", () => {
  it("mapper HALL_OPERATOR til hall-operator, AGENT til agent", async () => {
    // Dynamisk import slik at vi bruker mapUserToSession indirekte via fetchMe.
    const { login } = await import("../src/api/auth.js");
    // Vi kan ikke enkelt teste mapUserToSession direkte siden den er privat.
    // Smoke-test via en mock fetch-response som simulerer login-flyten.
    const originalFetch = globalThis.fetch;
    try {
      const fakeUser = (role: string) => ({
        ok: true,
        data: {
          accessToken: "tok",
          user: {
            id: "u1",
            email: "x@y.no",
            displayName: "X",
            role,
            isSuperAdmin: false,
            hall: [],
          },
        },
      });
      const { setSession, getSession } = await import("../src/auth/Session.js");
      setSession(null);

      // AGENT
      globalThis.fetch = async () =>
        new Response(JSON.stringify(fakeUser("AGENT")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const agentSess = await login("a@x.no", "pw");
      expect(agentSess.role).toBe("agent");

      // HALL_OPERATOR
      globalThis.fetch = async () =>
        new Response(JSON.stringify(fakeUser("HALL_OPERATOR")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const hallOpSess = await login("h@x.no", "pw");
      expect(hallOpSess.role).toBe("hall-operator");

      // ADMIN (lowercase — legacy fixtures)
      globalThis.fetch = async () =>
        new Response(JSON.stringify(fakeUser("admin")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const adminSess = await login("admin@x.no", "pw");
      expect(adminSess.role).toBe("admin");

      // Cleanup
      setSession(null);
      void getSession;
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("agentSidebar spec", () => {
  beforeEach(() => {
    initI18n();
  });

  it("inneholder dashboard, player-management, physical-tickets, game-management, cash-in-out, unique-id, physical-cashout", () => {
    const ids = agentSidebar
      .filter((n) => n.kind !== "header")
      .map((n) => (n.kind === "leaf" || n.kind === "group" ? n.id : ""));
    expect(ids).toContain("agent-dashboard");
    expect(ids).toContain("agent-player-management");
    expect(ids).toContain("agent-physical-tickets");
    expect(ids).toContain("agent-game-management");
    expect(ids).toContain("agent-cash-in-out");
    expect(ids).toContain("agent-unique-id");
    expect(ids).toContain("agent-physical-cashout");
  });

  it("player-management er en dropdown-gruppe med 3 barn", () => {
    const group = agentSidebar.find(
      (n) => n.kind === "group" && n.id === "agent-player-management"
    );
    expect(group).toBeDefined();
    if (group && group.kind === "group") {
      expect(group.children.length).toBe(3);
    }
  });
});

describe("Agent-portal placeholder-sider", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = '<div id="c"></div>';
  });

  // /agent/games ble løftet ut av placeholder-lista da Next-Game-panel landet;
  // se nextGamePanel.test.ts for dekning av den siden.
  const placeholders = [
    { name: "physical-tickets", mount: mountAgentPhysicalTickets, titleKey: "add_physical_tickets" },
    { name: "cash-in-out", mount: mountAgentCashInOut, titleKey: "agent_cash_in_out_management" },
    { name: "unique-id", mount: mountAgentUniqueId, titleKey: "agent_unique_id_management" },
    { name: "physical-cashout", mount: mountAgentPhysicalCashout, titleKey: "agent_physical_cashout" },
  ];

  for (const p of placeholders) {
    it(`${p.name}: rendrer breadcrumb, tittel og 'Kommer snart'-merke`, () => {
      const container = document.getElementById("c")!;
      p.mount(container);
      // Breadcrumb linker tilbake til agent/dashboard
      const crumb = container.querySelector<HTMLAnchorElement>(".breadcrumb a[href='#/agent/dashboard']");
      expect(crumb, `${p.name} skal ha breadcrumb til /agent/dashboard`).toBeTruthy();
      // Coming-soon-merke
      expect(container.querySelector("[data-marker='coming-soon']")).toBeTruthy();
      // Tittel-header
      expect(container.querySelector("section.content-header h1")).toBeTruthy();
    });
  }

  // Unngå unused-warning — brukt som "hjelper" referanse.
  void makeSession;
});
