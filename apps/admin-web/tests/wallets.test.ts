// PR-B4 (BIN-646) — tests for walletManagement pages.
// Fokus: list renders with view-btn, detail reads hashParam("id"),
// fail-closed på backend-error.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { isWalletRoute, mountWalletRoute } from "../src/pages/wallets/index.js";

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

function mockApiRouter(
  routes: Array<{ match: RegExp; handler: (url: string, init: RequestInit | undefined) => unknown; status?: number }>
): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match.test(url));
    if (!route) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: { code: "NOT_MOCKED", message: url } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    const body = route.handler(url, init);
    const status = route.status ?? 200;
    return Promise.resolve(
      new Response(JSON.stringify(status < 400 ? { ok: true, data: body } : body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.location.hash = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  setSession(adminSession());
});

describe("isWalletRoute", () => {
  it("matches 2 declared routes", () => {
    expect(isWalletRoute("/wallet")).toBe(true);
    expect(isWalletRoute("/wallet/view")).toBe(true);
    expect(isWalletRoute("/deposit/requests")).toBe(false);
  });
});

describe("WalletListPage", () => {
  it("GETs /api/wallets and renders view-buttons", async () => {
    const api = mockApiRouter([
      {
        match: /\/api\/wallets$/,
        handler: () => [
          { id: "w1", balance: 25000, createdAt: "2026-04-19T00:00:00Z", updatedAt: "2026-04-19T00:00:00Z" },
          { id: "w2", balance: 50000, createdAt: "2026-04-19T00:00:00Z", updatedAt: "2026-04-19T00:00:00Z" },
        ],
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountWalletRoute(root, "/wallet");
    await tick();
    expect(api.mock.calls.length).toBeGreaterThanOrEqual(1);
    // 2 view-knapper, en per rad
    const viewLinks = Array.from(root.querySelectorAll("a")).filter((a) =>
      (a.getAttribute("href") ?? "").startsWith("#/wallet/view")
    );
    expect(viewLinks.length).toBe(2);
    expect(viewLinks[0]!.getAttribute("href")).toContain("id=w1");
    expect(root.textContent).toContain("250.00");
    expect(root.textContent).toContain("500.00");
  });

  it("fail-closed: error → callout-danger shown", async () => {
    mockApiRouter([
      {
        match: /\/api\/wallets/,
        handler: () => ({ ok: false, error: { code: "INTERNAL", message: "boom" } }),
        status: 500,
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountWalletRoute(root, "/wallet");
    await tick(10);
    expect(root.querySelector(".callout-danger")).toBeTruthy();
  });
});

describe("WalletViewPage", () => {
  it("reads hashParam id and fetches /api/wallets/:id", async () => {
    window.location.hash = "#/wallet/view?id=wallet-42";
    const api = mockApiRouter([
      {
        match: /\/api\/wallets\/wallet-42$/,
        handler: () => ({
          account: {
            id: "wallet-42",
            balance: 99900,
            createdAt: "2026-04-19T00:00:00Z",
            updatedAt: "2026-04-19T00:00:00Z",
          },
          transactions: [
            {
              id: "tx1",
              accountId: "wallet-42",
              type: "TOPUP",
              amount: 10000,
              reason: "Deposit",
              createdAt: "2026-04-19T01:00:00Z",
            },
          ],
        }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountWalletRoute(root, "/wallet/view");
    await tick();
    expect(api.mock.calls.some(([u]) => String(u).endsWith("/api/wallets/wallet-42"))).toBe(true);
    expect(root.textContent).toContain("wallet-42");
    expect(root.textContent).toContain("999.00"); // balance rendered
    expect(root.textContent).toContain("TOPUP"); // transaction row
  });

  it("fail-closed when id missing: callout + no fetch", async () => {
    const api = mockApiRouter([
      {
        match: /\/api\/wallets/,
        handler: () => ({ account: { id: "", balance: 0, createdAt: "", updatedAt: "" }, transactions: [] }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountWalletRoute(root, "/wallet/view");
    await tick(8);
    expect(root.querySelector(".callout-danger")).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
});

// PR-W4 wallet-split: header-UI rendrer deposit + winnings separat.
describe("WalletViewPage — PR-W4 split-header", () => {
  it("rendrer deposit + winnings som separate linjer med ARIA-labels", async () => {
    window.location.hash = "#/wallet/view?id=w-split";
    mockApiRouter([
      {
        match: /\/api\/wallets\/w-split$/,
        handler: () => ({
          account: {
            id: "w-split",
            balance: 150000,
            depositBalance: 50000,
            winningsBalance: 100000,
            createdAt: "2026-04-22T00:00:00Z",
            updatedAt: "2026-04-22T00:00:00Z",
          },
          transactions: [],
        }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountWalletRoute(root, "/wallet/view");
    await tick();

    // 500 kr (deposit) + 1000 kr (winnings) + 1500 kr (total)
    const depositNode = root.querySelector(".wallet-deposit");
    const winningsNode = root.querySelector(".wallet-winnings");
    const totalNode = root.querySelector(".wallet-total");

    expect(depositNode).toBeTruthy();
    expect(winningsNode).toBeTruthy();
    expect(totalNode).toBeTruthy();

    // ARIA-label for skjermleser-tilgjengelighet
    expect(depositNode!.getAttribute("aria-label")).toMatch(/innskudd/i);
    expect(winningsNode!.getAttribute("aria-label")).toMatch(/gevinst/i);
    expect(totalNode!.getAttribute("aria-label")).toMatch(/total/i);

    // Verdier riktig format (formatAmountCents deler på 100)
    expect(depositNode!.textContent).toContain("500.00");
    expect(winningsNode!.textContent).toContain("1000.00");
    expect(totalNode!.textContent).toContain("1500.00");
  });

  it("bakoverkompat: account uten split-felter viser kun total balance", async () => {
    window.location.hash = "#/wallet/view?id=w-legacy";
    mockApiRouter([
      {
        match: /\/api\/wallets\/w-legacy$/,
        handler: () => ({
          account: {
            id: "w-legacy",
            balance: 100000,
            // ingen depositBalance / winningsBalance — legacy response
            createdAt: "2026-04-01T00:00:00Z",
            updatedAt: "2026-04-01T00:00:00Z",
          },
          transactions: [],
        }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountWalletRoute(root, "/wallet/view");
    await tick();

    // Split-felter ikke rendret
    expect(root.querySelector(".wallet-deposit")).toBeNull();
    expect(root.querySelector(".wallet-winnings")).toBeNull();
    // Fortsatt en total balance synlig
    expect(root.textContent).toContain("1000.00");
  });

  it("transaksjons-tabell viser split-fordeling for DEBIT med winnings+deposit", async () => {
    window.location.hash = "#/wallet/view?id=w-tx";
    mockApiRouter([
      {
        match: /\/api\/wallets\/w-tx$/,
        handler: () => ({
          account: {
            id: "w-tx",
            balance: 0,
            depositBalance: 0,
            winningsBalance: 0,
            createdAt: "2026-04-22T00:00:00Z",
            updatedAt: "2026-04-22T00:00:00Z",
          },
          transactions: [
            {
              id: "tx-split",
              accountId: "w-tx",
              type: "TRANSFER_OUT",
              amount: 15000, // 150 kr
              reason: "Bingo buy-in",
              createdAt: "2026-04-22T10:00:00Z",
              split: { fromDeposit: 10000, fromWinnings: 5000 }, // 100 kr + 50 kr
            },
            {
              id: "tx-legacy",
              accountId: "w-tx",
              type: "TOPUP",
              amount: 10000,
              reason: "Legacy top-up",
              createdAt: "2026-04-22T09:00:00Z",
              // ingen split-felt
            },
          ],
        }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountWalletRoute(root, "/wallet/view");
    await tick();

    // TRANSFER_OUT med split skal vise begge deler
    expect(root.textContent).toMatch(/100\.00.*innskudd/i);
    expect(root.textContent).toMatch(/50\.00.*gevinst/i);
  });
});

// PR-W4: WalletListPage viser deposit + winnings som separate kolonner.
describe("WalletListPage — PR-W4 split-kolonner", () => {
  it("rendrer Deposit + Winnings + Balance som separate kolonner", async () => {
    mockApiRouter([
      {
        match: /\/api\/wallets$/,
        handler: () => [
          {
            id: "w1",
            balance: 75000,
            depositBalance: 50000,
            winningsBalance: 25000,
            createdAt: "2026-04-22T00:00:00Z",
            updatedAt: "2026-04-22T00:00:00Z",
          },
        ],
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountWalletRoute(root, "/wallet");
    await tick();

    const text = root.textContent ?? "";
    // 500.00 = deposit, 250.00 = winnings, 750.00 = balance
    expect(text).toContain("500.00");
    expect(text).toContain("250.00");
    expect(text).toContain("750.00");
  });
});
