/**
 * Cleanup 2026-05-08: `useNewGamePlan`-flagget er fjernet — ny spilleplan-
 * flyt er nå standard. Disse testene var tidligere parametrisert på flag-
 * verdi (legacy-oppføringer skjult når flag=true, nye oppføringer skjult
 * når flag=false). Etter cleanup verifiserer testene at:
 *
 *  - Legacy-oppføringer (Tidsplanadministrasjon, Opprettelse av spill,
 *    Lagret spillliste) IKKE lenger renders i sidebar.
 *  - Spill 1-landingsside (`/spill1`) og "spilleplan-redesign"-gruppen
 *    ALLTID renders (sidebar-reorg 2026-05-08 erstattet de tre direkte
 *    leaves «Spillkatalog», «Spilleplaner» og «Hallgrupper-administrasjon»
 *    med ett samlet inngangspunkt; tabs/cards på Spill 1-siden navigerer
 *    videre til de underliggende rutene).
 *
 * Routes for legacy-paths og de underliggende rutene (`/games/catalog`,
 * `/games/plans`, `/groupHall`) er fortsatt registrert via router/routes.ts
 * — bookmarks/direkte-lenker fungerer for tilbakekompatibilitet.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderSidebar } from "../src/shell/Sidebar.js";
import { setSession, type Session } from "../src/auth/Session.js";

const LEGACY_PATHS_REMOVED = [
  "/schedules",
  "/gameManagement",
  "/savedGameList",
] as const;

// Sidebar-reorg 2026-05-08: «Spill 1»-leaf er én landingsside (/spill1) som
// internt rendrer kort til /games/catalog, /games/plans og /groupHall. De
// underliggende rutene er fortsatt deep-linkbare men ikke synlige i sidebar.
const NEW_ADMIN_PATHS = ["/spill1"] as const;

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

describe("Sidebar — useNewGamePlan flag fjernet (cleanup 2026-05-08)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "<div id='host'></div>";
  });

  describe("admin sidebar", () => {
    it("legacy-leaves er borte fra sidebar (routes finnes fortsatt)", () => {
      const host = document.getElementById("host")!;
      const session = adminSession();
      setSession(session);

      renderSidebar(host, session, "/admin");
      const hrefs = renderedHrefs(host);

      for (const path of LEGACY_PATHS_REMOVED) {
        expect(
          hrefs,
          `legacy ${path} skal være borte fra sidebar etter cleanup`,
        ).not.toContain(`#${path}`);
      }
    });

    it("nye spilleplan-leaves er alltid synlige", () => {
      const host = document.getElementById("host")!;
      const session = adminSession();
      setSession(session);

      renderSidebar(host, session, "/admin");
      const hrefs = renderedHrefs(host);

      for (const path of NEW_ADMIN_PATHS) {
        expect(hrefs, `${path} skal være synlig`).toContain(`#${path}`);
      }
      expect(
        renderedGroupIds(host),
        "spilleplan-redesign-gruppen skal være synlig",
      ).toContain("spilleplan-redesign");
    });

    it("master-dashbord (cash-inout) og andre admin-funksjoner er uberørt", () => {
      const host = document.getElementById("host")!;
      const session = adminSession();
      setSession(session);

      renderSidebar(host, session, "/admin");

      const groupIds = renderedGroupIds(host);
      expect(groupIds, "Kontant inn/ut-gruppen skal forbli synlig").toContain("cash-inout");
      expect(groupIds, "Spilleradministrasjon-gruppen skal forbli synlig").toContain(
        "player-management",
      );
      expect(groupIds, "Rapportadministrasjon skal forbli synlig").toContain(
        "report-management",
      );

      const hrefs = renderedHrefs(host);
      expect(hrefs, "Hallspesifikke rapporter").toContain("#/hallSpecificReport");
      expect(hrefs, "Wallet-administrasjon").toContain("#/wallet");
    });
  });

  describe("agent sidebar", () => {
    it("legacy spill-leaves under game-management er borte", () => {
      const host = document.getElementById("host")!;
      const session = agentSession();
      setSession(session);

      renderSidebar(host, session, "/agent/dashboard");
      const hrefs = renderedHrefs(host);

      expect(hrefs).not.toContain("#/schedules");
      expect(hrefs).not.toContain("#/gameManagement");
      expect(hrefs).not.toContain("#/savedGameList");
    });

    it("agent-cash-in-out + andre agent-funksjoner er uberørt", () => {
      const host = document.getElementById("host")!;
      const session = agentSession();
      setSession(session);

      renderSidebar(host, session, "/agent/dashboard");

      const groupIds = renderedGroupIds(host);
      expect(groupIds, "Kontant inn/ut-gruppen skal forbli synlig").toContain(
        "agent-cash-in-out",
      );
      expect(groupIds, "Spilleradministrasjon-gruppen skal forbli synlig").toContain(
        "agent-player-management",
      );

      const hrefs = renderedHrefs(host);
      expect(hrefs).toContain("#/agent/bingo-check");
      expect(hrefs).toContain("#/agent/physical-cashout");
      expect(hrefs).toContain("#/agent/unique-id");
    });
  });
});
