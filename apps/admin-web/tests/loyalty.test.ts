// BIN-700 — Loyalty admin wired-CRUD tests.
//
// Tester mocker fetch og verifiserer list/create/award/override flyter.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import {
  isLoyaltyRoute,
  mountLoyaltyRoute,
} from "../src/pages/loyalty/index.js";

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

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Response | Promise<Response>;

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
    id: "t-1",
    name: "Bronze",
    rank: 1,
    minPoints: 0,
    maxPoints: 500,
    benefits: { bonus_pct: 5 },
    active: true,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function sampleState(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    userId: "u-42",
    currentTier: null,
    lifetimePoints: 0,
    monthPoints: 0,
    monthKey: null,
    tierLocked: false,
    lastUpdatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
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

describe("isLoyaltyRoute", () => {
  it("matches declared routes", () => {
    expect(isLoyaltyRoute("/loyaltyManagement")).toBe(true);
    expect(isLoyaltyRoute("/loyaltyManagement/new")).toBe(true);
    expect(isLoyaltyRoute("/loyaltyManagement/edit/t-1")).toBe(true);
    expect(isLoyaltyRoute("/loyaltyManagement/players")).toBe(true);
    expect(isLoyaltyRoute("/loyaltyManagement/players/u-1")).toBe(true);
    expect(isLoyaltyRoute("/loyalty")).toBe(true);
    expect(isLoyaltyRoute("/loyaltyManagement/edit/")).toBe(false);
    expect(isLoyaltyRoute("/leaderboard")).toBe(false);
  });
});

describe("LoyaltyManagementPage (BIN-700 tier list)", () => {
  it("renders tiers fra backend med edit + delete knapper", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/loyalty/tiers")) {
        return apiOk({
          tiers: [
            sampleTier({ id: "t-1", name: "Bronze", rank: 1 }),
            sampleTier({ id: "t-2", name: "Gold", rank: 3, minPoints: 1000, maxPoints: null }),
          ],
          count: 2,
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLoyaltyRoute(root, "/loyaltyManagement");
    await tick(12);

    const table = root.querySelector('[data-testid="loyalty-tier-table-body"]');
    expect(table).toBeTruthy();
    expect(root.querySelectorAll("tbody tr").length).toBe(2);
    expect(root.querySelector('[data-testid="btn-edit-loyalty-tier-t-1"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="btn-delete-loyalty-tier-t-1"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="btn-add-loyalty-tier"]')).toBeTruthy();
  });

  it("viser empty-state når backend returnerer ingen tiers", async () => {
    installFetch(() => apiOk({ tiers: [], count: 0 }));

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLoyaltyRoute(root, "/loyaltyManagement");
    await tick(12);
    expect(root.querySelector('[data-testid="loyalty-tier-empty"]')).toBeTruthy();
  });

  it("viser error banner ved 500", async () => {
    installFetch(() =>
      jsonResponse(500, { ok: false, error: { code: "INTERNAL", message: "boom" } })
    );

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLoyaltyRoute(root, "/loyaltyManagement");
    await tick(12);
    expect(root.querySelector('[data-testid="loyalty-tier-load-error"]')).toBeTruthy();
  });
});

describe("AddLoyaltyTierPage (BIN-700 create form)", () => {
  it("renderer create-form med alle feltene tilgjengelige", async () => {
    installFetch(() =>
      jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } })
    );

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLoyaltyRoute(root, "/loyaltyManagement/new");
    await tick();

    const form = root.querySelector<HTMLFormElement>('[data-testid="loyalty-tier-form"]');
    expect(form).toBeTruthy();
    expect(form!.querySelector<HTMLInputElement>('[data-testid="lt-name"]')).toBeTruthy();
    expect(form!.querySelector<HTMLInputElement>('[data-testid="lt-rank"]')).toBeTruthy();
    expect(form!.querySelector<HTMLInputElement>('[data-testid="lt-min-points"]')).toBeTruthy();
    expect(form!.querySelector<HTMLInputElement>('[data-testid="lt-max-points"]')).toBeTruthy();
    expect(form!.querySelector<HTMLTextAreaElement>('[data-testid="lt-benefits"]')).toBeTruthy();
  });

  it("preload-er eksisterende verdier på edit-route", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/loyalty/tiers/t-42")) {
        return apiOk(
          sampleTier({ id: "t-42", name: "Platinum", rank: 4, minPoints: 5000, maxPoints: null })
        );
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLoyaltyRoute(root, "/loyaltyManagement/edit/t-42");
    await tick(12);

    const name = root.querySelector<HTMLInputElement>('[data-testid="lt-name"]')!;
    const rank = root.querySelector<HTMLInputElement>('[data-testid="lt-rank"]')!;
    const minPts = root.querySelector<HTMLInputElement>('[data-testid="lt-min-points"]')!;

    expect(name.value).toBe("Platinum");
    expect(rank.value).toBe("4");
    expect(minPts.value).toBe("5000");
  });
});

describe("LoyaltyPlayersPage (BIN-700 spillerliste)", () => {
  it("renderer spillerliste med tier-badge", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/loyalty/tiers")) {
        return apiOk({ tiers: [sampleTier({ id: "t-1", name: "Bronze" })], count: 1 });
      }
      if (url.includes("/api/admin/loyalty/players")) {
        return apiOk({
          players: [
            sampleState({
              userId: "u-1",
              currentTier: sampleTier({ id: "t-1", name: "Bronze" }),
              lifetimePoints: 500,
              monthPoints: 50,
            }),
          ],
          total: 1,
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLoyaltyRoute(root, "/loyaltyManagement/players");
    await tick(20);

    const table = root.querySelector('[data-testid="loyalty-players-table-body"]');
    expect(table).toBeTruthy();
    expect(root.querySelector('[data-testid="loyalty-player-row-u-1"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="btn-view-loyalty-player-u-1"]')).toBeTruthy();
  });
});

describe("LoyaltyPlayerDetailPage (BIN-700 award + override)", () => {
  it("viser player-state, award-form og override-form", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/loyalty/players/u-42")) {
        return apiOk({
          state: sampleState({ userId: "u-42", lifetimePoints: 250, monthPoints: 50 }),
          events: [],
        });
      }
      if (url.includes("/api/admin/loyalty/tiers")) {
        return apiOk({ tiers: [sampleTier({ id: "t-1" })], count: 1 });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLoyaltyRoute(root, "/loyaltyManagement/players/u-42");
    await tick(20);

    expect(root.querySelector('[data-testid="loyalty-player-state"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="loyalty-award-form"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="loyalty-override-form"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="loyalty-lifetime-points"]')?.textContent?.trim()).toContain("250");
  });
});
