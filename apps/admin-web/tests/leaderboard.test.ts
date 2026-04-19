// PR-B6 (BIN-664) — tests for Leaderboard tier admin placeholder pages.
// Backend CRUD is tracked as BIN-668 (P3). These tests verify:
//   - route-dispatcher contract for /leaderboard and /addLeaderboard
//   - list page surfaces backend-pending banner (not a red error)
//     because the API wrapper rejects with NOT_IMPLEMENTED (501)
//   - add page renders disabled form + BIN-668 banner
//   - BIN-668 link is present in both banners
//   - Add button on list page is disabled until backend ships

import { describe, it, expect, beforeEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import {
  isLeaderboardRoute,
  mountLeaderboardRoute,
} from "../src/pages/leaderboard/index.js";

function adminSession(): Session {
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
  };
}

async function tick(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.location.hash = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  setSession(adminSession());
});

describe("isLeaderboardRoute", () => {
  it("matches declared routes", () => {
    expect(isLeaderboardRoute("/leaderboard")).toBe(true);
    expect(isLeaderboardRoute("/addLeaderboard")).toBe(true);
    expect(isLeaderboardRoute("/leaderboardEdit/abc")).toBe(false);
    expect(isLeaderboardRoute("/riskCountry")).toBe(false);
  });
});

describe("LeaderboardPage (list placeholder)", () => {
  it("renders backend-pending banner with BIN-668 link + disables add button", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLeaderboardRoute(root, "/leaderboard");
    await tick(10);

    const banner = root.querySelector<HTMLElement>(
      '[data-testid="leaderboard-backend-pending-banner"]'
    );
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("BIN-668");
    expect(banner!.querySelector("a[href*='BIN-668']")).toBeTruthy();

    const addBtn = root.querySelector<HTMLButtonElement>(
      'button[data-action="add-leaderboard-tier"]'
    )!;
    expect(addBtn).toBeTruthy();
    expect(addBtn.disabled).toBe(true);

    // No callout-danger since this is planned-work, not an error.
    expect(root.querySelector(".callout-danger")).toBeNull();
  });
});

describe("AddLeaderboardPage (form placeholder)", () => {
  it("renders disabled form + BIN-668 banner", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLeaderboardRoute(root, "/addLeaderboard");
    await tick();

    const banner = root.querySelector<HTMLElement>(
      '[data-testid="leaderboard-backend-pending-banner"]'
    );
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("BIN-668");

    const form = root.querySelector<HTMLFormElement>(
      'form[data-testid="add-leaderboard-placeholder-form"]'
    );
    expect(form).toBeTruthy();

    const placeInput = form!.querySelector<HTMLInputElement>("#lb-place")!;
    const pointsInput = form!.querySelector<HTMLInputElement>("#lb-points")!;
    expect(placeInput.disabled).toBe(true);
    expect(pointsInput.disabled).toBe(true);

    const submitBtn = form!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submitBtn.disabled).toBe(true);
  });
});
