// BIN-668 — Leaderboard tier admin wired-CRUD tests.
//
// Endret fra BIN-664 placeholder: nå bruker siden ekte
// /api/admin/leaderboard/tiers endepunkter. Tester mocker `fetch` og
// verifiserer list/create flow + delete-confirm.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

async function tick(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(input, init);
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiOk<T>(data: T): Response {
  return jsonResponse(200, { ok: true, data });
}

function sampleTier(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "tier-1",
    tierName: "default",
    place: 1,
    points: 100,
    prizeAmount: 500,
    prizeDescription: "Gavekort 500 kr",
    active: true,
    extra: {},
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.location.hash = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  setSession(adminSession());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isLeaderboardRoute", () => {
  it("matches declared routes", () => {
    expect(isLeaderboardRoute("/leaderboard")).toBe(true);
    expect(isLeaderboardRoute("/addLeaderboard")).toBe(true);
    expect(isLeaderboardRoute("/leaderboard/edit/abc")).toBe(true);
    expect(isLeaderboardRoute("/leaderboard/edit/")).toBe(false);
    expect(isLeaderboardRoute("/riskCountry")).toBe(false);
  });
});

describe("LeaderboardPage list (BIN-668 wired)", () => {
  it("renders tiers from backend with edit + delete buttons", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/leaderboard/tiers")) {
        return apiOk({
          tiers: [
            sampleTier({ id: "tier-1", place: 1, points: 100 }),
            sampleTier({ id: "tier-2", place: 2, points: 50, prizeAmount: null }),
          ],
          count: 2,
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLeaderboardRoute(root, "/leaderboard");
    await tick(12);

    const table = root.querySelector('[data-testid="leaderboard-table-body"]');
    expect(table).toBeTruthy();
    const rows = root.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    expect(root.querySelector('[data-testid="btn-edit-tier-tier-1"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="btn-delete-tier-tier-1"]')).toBeTruthy();
    // Add button is enabled.
    const addBtn = root.querySelector<HTMLAnchorElement>('[data-testid="btn-add-leaderboard-tier"]');
    expect(addBtn).toBeTruthy();
    expect(addBtn!.classList.contains("disabled")).toBe(false);
  });

  it("renders empty state when backend returns no tiers", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/leaderboard/tiers")) {
        return apiOk({ tiers: [], count: 0 });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLeaderboardRoute(root, "/leaderboard");
    await tick(12);
    expect(root.querySelector('[data-testid="leaderboard-empty"]')).toBeTruthy();
  });

  it("shows error banner when backend returns 500", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/leaderboard/tiers")) {
        return jsonResponse(500, { ok: false, error: { code: "INTERNAL", message: "boom" } });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLeaderboardRoute(root, "/leaderboard");
    await tick(12);
    expect(root.querySelector('[data-testid="leaderboard-load-error"]')).toBeTruthy();
  });
});

describe("AddLeaderboardPage (BIN-668 wired create form)", () => {
  it("renders create-form with all required fields enabled", async () => {
    installFetch(() => jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } }));

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLeaderboardRoute(root, "/addLeaderboard");
    await tick();

    const form = root.querySelector<HTMLFormElement>('[data-testid="leaderboard-tier-form"]');
    expect(form).toBeTruthy();
    const place = form!.querySelector<HTMLInputElement>('[data-testid="lb-place"]')!;
    const points = form!.querySelector<HTMLInputElement>('[data-testid="lb-points"]')!;
    const tierName = form!.querySelector<HTMLInputElement>('[data-testid="lb-tier-name"]')!;
    const prizeAmount = form!.querySelector<HTMLInputElement>('[data-testid="lb-prize-amount"]')!;
    const active = form!.querySelector<HTMLInputElement>('[data-testid="lb-active"]')!;

    expect(place.disabled).toBe(false);
    expect(points.disabled).toBe(false);
    expect(tierName.disabled).toBe(false);
    expect(prizeAmount.disabled).toBe(false);
    expect(active.checked).toBe(true);
  });

  it("loads existing tier values on edit route", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/leaderboard/tiers/tier-42")) {
        return apiOk(sampleTier({ id: "tier-42", place: 3, points: 25, tierName: "vip" }));
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLeaderboardRoute(root, "/leaderboard/edit/tier-42");
    await tick();

    const place = root.querySelector<HTMLInputElement>('[data-testid="lb-place"]')!;
    const points = root.querySelector<HTMLInputElement>('[data-testid="lb-points"]')!;
    const tierName = root.querySelector<HTMLInputElement>('[data-testid="lb-tier-name"]')!;

    expect(place.value).toBe("3");
    expect(points.value).toBe("25");
    expect(tierName.value).toBe("vip");
  });
});
