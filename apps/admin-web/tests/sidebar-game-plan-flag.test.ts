/**
 * Cleanup 2026-05-07: legacy game-admin sidebar-oppføringer (Tidsplan-
 * administrasjon, Opprettelse av spill, Lagret spillliste) skjules når
 * feature-flag `useNewGamePlan=true`. De nye oppføringene (Spillkatalog,
 * Spilleplaner, samt selve "spilleplan-redesign"-gruppen) skjules når
 * flagget er av.
 *
 * Routes blir værende registrert i begge tilstander — det er kun
 * sidebar-rendringen som filtreres. Bookmark-/direkte-lenke-tilgang
 * fortsetter dermed å fungere i overgangsperioden.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderSidebar } from "../src/shell/Sidebar.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { setFeatureFlag } from "../src/utils/featureFlags.js";

const LEGACY_ADMIN_PATHS = [
  "/schedules",
  "/gameManagement",
  "/savedGameList",
] as const;

const NEW_ADMIN_PATHS = ["/games/catalog", "/games/plans"] as const;

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
      "Schedule Management": { view: true, add: true, edit: true, delete: false },
      "Game Creation Management": { view: true, add: true, edit: true, delete: false },
      "Saved Game List": { view: true, add: true, edit: true, delete: false },
      "Game Catalog": { view: true, add: true, edit: true, delete: false },
      "Game Plans": { view: true, add: true, edit: true, delete: false },
    },
    ...overrides,
  };
}

function renderedHrefs(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLAnchorElement>("a[href^='#']")).map(
    (a) => a.getAttribute("href") ?? "",
  );
}

function renderedGroupIds(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-group-id]")).map(
    (el) => el.getAttribute("data-group-id") ?? "",
  );
}

describe("Sidebar — useNewGamePlan flag-gate (cleanup 2026-05-07)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "<div id='host'></div>";
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("admin sidebar", () => {
    it("default (flag=false): legacy-oppføringer er synlige, nye er skjult", () => {
      const host = document.getElementById("host")!;
      const session = adminSession();
      setSession(session);

      renderSidebar(host, session, "/admin");
      const hrefs = renderedHrefs(host);

      for (const path of LEGACY_ADMIN_PATHS) {
        expect(hrefs, `legacy ${path} skal være synlig når flag=false`).toContain(`#${path}`);
      }
      for (const path of NEW_ADMIN_PATHS) {
        expect(hrefs, `new ${path} skal være skjult når flag=false`).not.toContain(`#${path}`);
      }
      expect(renderedGroupIds(host), "spilleplan-redesign-gruppen skal være skjult når flag=false").not.toContain(
        "spilleplan-redesign",
      );
    });

    it("flag=true: legacy-oppføringer er skjult, nye er synlige", () => {
      setFeatureFlag("useNewGamePlan", true);

      const host = document.getElementById("host")!;
      const session = adminSession();
      setSession(session);

      renderSidebar(host, session, "/admin");
      const hrefs = renderedHrefs(host);

      for (const path of LEGACY_ADMIN_PATHS) {
        expect(hrefs, `legacy ${path} skal være skjult når flag=true`).not.toContain(`#${path}`);
      }
      for (const path of NEW_ADMIN_PATHS) {
        expect(hrefs, `new ${path} skal være synlig når flag=true`).toContain(`#${path}`);
      }
      expect(renderedGroupIds(host), "spilleplan-redesign-gruppen skal være synlig når flag=true").toContain(
        "spilleplan-redesign",
      );
    });

    it("flag=true: master-dashbord (cash-inout) og andre admin-funksjoner er uberørt", () => {
      setFeatureFlag("useNewGamePlan", true);

      const host = document.getElementById("host")!;
      const session = adminSession();
      setSession(session);

      renderSidebar(host, session, "/admin");

      const groupIds = renderedGroupIds(host);
      expect(groupIds, "Kontant inn/ut-gruppen skal forbli synlig").toContain("cash-inout");
      expect(groupIds, "Spilleradministrasjon-gruppen skal forbli synlig").toContain("player-management");
      expect(groupIds, "Rapportadministrasjon skal forbli synlig").toContain("report-management");

      const hrefs = renderedHrefs(host);
      expect(hrefs, "Hallspesifikke rapporter").toContain("#/hallSpecificReport");
      expect(hrefs, "Wallet-administrasjon").toContain("#/wallet");
    });
  });

  describe("agent sidebar", () => {
    it("default (flag=false): legacy spill-leaves under game-management er synlige", () => {
      const host = document.getElementById("host")!;
      const session = agentSession();
      setSession(session);

      renderSidebar(host, session, "/agent/dashboard");
      const hrefs = renderedHrefs(host);

      // Agent-sidebaren bruker samme legacy-paths som admin (de er felles
      // routes — agent har bare egne sidebar-leaves som peker til samme URL).
      expect(hrefs).toContain("#/schedules");
      expect(hrefs).toContain("#/gameManagement");
      expect(hrefs).toContain("#/savedGameList");
    });

    it("flag=true: legacy spill-leaves under game-management er skjult", () => {
      setFeatureFlag("useNewGamePlan", true);

      const host = document.getElementById("host")!;
      const session = agentSession();
      setSession(session);

      renderSidebar(host, session, "/agent/dashboard");
      const hrefs = renderedHrefs(host);

      expect(hrefs).not.toContain("#/schedules");
      expect(hrefs).not.toContain("#/gameManagement");
      expect(hrefs).not.toContain("#/savedGameList");
    });

    it("flag=true: agent-cash-in-out + andre agent-funksjoner er uberørt", () => {
      setFeatureFlag("useNewGamePlan", true);

      const host = document.getElementById("host")!;
      const session = agentSession();
      setSession(session);

      renderSidebar(host, session, "/agent/dashboard");

      const groupIds = renderedGroupIds(host);
      expect(groupIds, "Kontant inn/ut-gruppen skal forbli synlig").toContain("agent-cash-in-out");
      expect(groupIds, "Spilleradministrasjon-gruppen skal forbli synlig").toContain("agent-player-management");

      const hrefs = renderedHrefs(host);
      expect(hrefs).toContain("#/agent/bingo-check");
      expect(hrefs).toContain("#/agent/physical-cashout");
      expect(hrefs).toContain("#/agent/unique-id");
    });
  });
});
