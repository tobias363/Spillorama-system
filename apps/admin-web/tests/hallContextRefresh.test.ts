// FE-P0-004 (Bølge 2B pilot-blocker): tests for hall-context-change
// re-render. When an ADMIN super-user switches active hall via the
// impersonation banner, all open admin pages must refresh their
// hall-scoped data — otherwise the operator believes they're reviewing
// Hall A's daily-balance while they're actually still seeing Hall B's.
//
// What we test:
//   1. setAdminActiveHall() persists the choice to localStorage and fires
//      `session:admin-active-hall-changed` on window.
//   2. setAdminActiveHall(null) clears localStorage and still fires the
//      event (so subscribers can re-fetch with the cleared context).
//   3. getEffectiveHall() returns the new hall on subsequent calls (so
//      a page that re-renders WILL see the new context).
//   4. The event payload carries the new hall in `detail.hall`.
//   5. setSession(null) (logout) implicitly clears the admin-active-hall
//      via clearAdminActiveHall() — defence-in-depth so a stale hall
//      doesn't leak across sessions.
//
// Why this matters for pilot:
//   - Real-money downstream actions on the wrong hall are the worst-case
//     UX bug. Pilot has 4 simulated halls — operators will switch.
//   - The fix is a global event listener in main.ts that re-runs
//     renderPage() (same pattern as `i18n:changed`). The Session.ts
//     contract is the load-bearing surface — these tests pin it.

import { describe, it, expect, beforeEach } from "vitest";
import {
  setAdminActiveHall,
  getAdminActiveHall,
  getEffectiveHall,
  setSession,
  type Session,
  type SessionHall,
} from "../src/auth/Session.js";

const HALL_A: SessionHall = { id: "hall-a", name: "Oslo Bingo" };
const HALL_B: SessionHall = { id: "hall-b", name: "Bergen Bingo", groupName: "Vestlandet" };

const ADMIN_SESSION: Session = {
  id: "admin-1",
  name: "Tobias",
  email: "tobias@example.no",
  role: "admin",
  isSuperAdmin: true,
  avatar: "",
  hall: [],
  dailyBalance: null,
  permissions: {},
};

beforeEach(() => {
  window.localStorage.removeItem("spillorama.admin.activeHall");
  setSession(null);
});

describe("setAdminActiveHall — persistence", () => {
  it("persists the chosen hall to localStorage", () => {
    setAdminActiveHall(HALL_A);
    const raw = window.localStorage.getItem("spillorama.admin.activeHall");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.id).toBe("hall-a");
    expect(parsed.name).toBe("Oslo Bingo");
  });

  it("persists groupName when present", () => {
    setAdminActiveHall(HALL_B);
    const raw = JSON.parse(window.localStorage.getItem("spillorama.admin.activeHall")!);
    expect(raw.groupName).toBe("Vestlandet");
  });

  it("clearing with null removes the localStorage entry", () => {
    setAdminActiveHall(HALL_A);
    expect(window.localStorage.getItem("spillorama.admin.activeHall")).not.toBeNull();
    setAdminActiveHall(null);
    expect(window.localStorage.getItem("spillorama.admin.activeHall")).toBeNull();
  });
});

describe("setAdminActiveHall — event dispatch (FE-P0-004 contract)", () => {
  it("fires session:admin-active-hall-changed on switch", () => {
    let fired = 0;
    let receivedHall: SessionHall | null = null;
    const handler = (e: Event): void => {
      fired += 1;
      const detail = (e as CustomEvent).detail as { hall: SessionHall | null };
      receivedHall = detail.hall;
    };
    window.addEventListener("session:admin-active-hall-changed", handler);
    setAdminActiveHall(HALL_A);
    window.removeEventListener("session:admin-active-hall-changed", handler);
    expect(fired).toBe(1);
    expect(receivedHall).toEqual(HALL_A);
  });

  it("fires the event with detail.hall = null on clear", () => {
    setAdminActiveHall(HALL_A); // Initial set
    let receivedHall: SessionHall | null | undefined = undefined;
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { hall: SessionHall | null };
      receivedHall = detail.hall;
    };
    window.addEventListener("session:admin-active-hall-changed", handler);
    setAdminActiveHall(null);
    window.removeEventListener("session:admin-active-hall-changed", handler);
    expect(receivedHall).toBeNull();
  });

  it("fires once per switch — no duplicate events", () => {
    let fired = 0;
    const handler = (): void => {
      fired += 1;
    };
    window.addEventListener("session:admin-active-hall-changed", handler);
    setAdminActiveHall(HALL_A);
    setAdminActiveHall(HALL_B);
    setAdminActiveHall(null);
    window.removeEventListener("session:admin-active-hall-changed", handler);
    expect(fired).toBe(3);
  });
});

describe("getEffectiveHall — admin sees the active hall after switch", () => {
  it("returns the active hall after setAdminActiveHall for admin role", () => {
    setSession(ADMIN_SESSION);
    setAdminActiveHall(HALL_A);
    expect(getEffectiveHall()).toEqual(HALL_A);
  });

  it("switching active hall changes the effective hall (FE-P0-004 fix)", () => {
    setSession(ADMIN_SESSION);
    setAdminActiveHall(HALL_A);
    expect(getEffectiveHall()?.id).toBe("hall-a");
    setAdminActiveHall(HALL_B);
    expect(getEffectiveHall()?.id).toBe("hall-b");
  });

  it("returns null when admin has no active hall set", () => {
    setSession(ADMIN_SESSION);
    expect(getEffectiveHall()).toBeNull();
  });
});

describe("getAdminActiveHall — restored from localStorage", () => {
  it("survives a page-reload (read directly from localStorage)", () => {
    setAdminActiveHall(HALL_B);
    // Simulate a reload by re-reading without going through setAdminActiveHall
    const restored = getAdminActiveHall();
    expect(restored).toEqual(HALL_B);
  });

  it("returns null on missing entry", () => {
    expect(getAdminActiveHall()).toBeNull();
  });

  it("returns null on malformed JSON (defensive)", () => {
    window.localStorage.setItem("spillorama.admin.activeHall", "not-valid-json");
    expect(getAdminActiveHall()).toBeNull();
  });
});

describe("setSession(null) — logout cleanup (defence-in-depth)", () => {
  it("clears admin-active-hall on logout to prevent cross-session leak", () => {
    setSession(ADMIN_SESSION);
    setAdminActiveHall(HALL_A);
    expect(window.localStorage.getItem("spillorama.admin.activeHall")).not.toBeNull();
    setSession(null);
    expect(window.localStorage.getItem("spillorama.admin.activeHall")).toBeNull();
  });
});

describe("FE-P0-004 — page-refresh-on-hall-switch wiring", () => {
  // This test simulates the wire-up done in main.ts: a global listener
  // for session:admin-active-hall-changed that triggers a re-render.
  // We can't import main.ts directly (it boots an entire SPA), so we
  // mirror the wire-up here and assert the contract: dispatching the
  // event triggers the registered callback exactly once per switch.
  it("a global listener fires on each hall-switch (mirrors main.ts wire-up)", () => {
    let renderCount = 0;
    const onHallChange = (): void => {
      renderCount += 1;
    };
    window.addEventListener("session:admin-active-hall-changed", onHallChange);
    setAdminActiveHall(HALL_A);
    setAdminActiveHall(HALL_B);
    window.removeEventListener("session:admin-active-hall-changed", onHallChange);
    expect(renderCount).toBe(2);
  });

  it("the listener receives a hall payload it can use to scope a refetch", () => {
    const observedHallIds: (string | null)[] = [];
    const onHallChange = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { hall: SessionHall | null };
      observedHallIds.push(detail.hall?.id ?? null);
    };
    window.addEventListener("session:admin-active-hall-changed", onHallChange);
    setAdminActiveHall(HALL_A);
    setAdminActiveHall(HALL_B);
    setAdminActiveHall(null);
    window.removeEventListener("session:admin-active-hall-changed", onHallChange);
    expect(observedHallIds).toEqual(["hall-a", "hall-b", null]);
  });
});
