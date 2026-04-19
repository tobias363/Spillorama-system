// PR-B6 (BIN-664) — tests for the risk-country admin page.
// Covers:
//   - route-dispatcher contract
//   - list renders ISO-3166 code + label + reason
//   - add modal dropdown EXCLUDES already-present codes
//   - add submit POSTs with correct payload + refreshes list
//   - delete-confirm modal calls DELETE with the code
//   - fail-closed on API error

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import {
  isRiskCountryRoute,
  mountRiskCountryRoute,
} from "../src/pages/riskCountry/index.js";

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

interface MockRoute {
  match: RegExp;
  method?: string;
  handler: (url: string, init: RequestInit | undefined) => unknown;
  status?: number;
}

function mockApiRouter(routes: MockRoute[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find(
      (r) => r.match.test(url) && (r.method ? r.method.toUpperCase() === method : true)
    );
    if (!route) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "NOT_MOCKED", message: `${method} ${url}` },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        )
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

async function tick(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

const SAMPLE = [
  {
    countryCode: "IR",
    label: "Iran",
    reason: "FATF high-risk",
    addedBy: "u1",
    createdAt: "2026-04-19T00:00:00.000Z",
  },
  {
    countryCode: "KP",
    label: "North Korea",
    reason: "FATF high-risk",
    addedBy: "u1",
    createdAt: "2026-04-19T00:00:00.000Z",
  },
];

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.location.hash = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  setSession(adminSession());
});

describe("isRiskCountryRoute", () => {
  it("matches only /riskCountry", () => {
    expect(isRiskCountryRoute("/riskCountry")).toBe(true);
    expect(isRiskCountryRoute("/blockedIp")).toBe(false);
    expect(isRiskCountryRoute("/riskCountry/add")).toBe(false);
  });
});

describe("RiskCountryPage", () => {
  it("renders ISO code + label + reason", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/security\/risk-countries/,
        method: "GET",
        handler: () => ({ countries: SAMPLE, count: SAMPLE.length }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRiskCountryRoute(root, "/riskCountry");
    await tick();

    expect(root.textContent).toContain("IR");
    expect(root.textContent).toContain("Iran");
    expect(root.textContent).toContain("KP");
    expect(root.textContent).toContain("North Korea");
    expect(root.textContent).toContain("FATF high-risk");
  });

  it("add modal dropdown excludes already-present codes", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/security\/risk-countries/,
        method: "GET",
        handler: () => ({ countries: SAMPLE, count: SAMPLE.length }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRiskCountryRoute(root, "/riskCountry");
    await tick();

    root.querySelector<HTMLButtonElement>('[data-action="add-risk-country"]')!.click();
    await tick();

    const select = document.querySelector<HTMLSelectElement>("#rc-code")!;
    expect(select).toBeTruthy();
    const values = Array.from(select.options).map((o) => o.value);
    // Excluded: IR and KP already in the table.
    expect(values).not.toContain("IR");
    expect(values).not.toContain("KP");
    // Included: first option is placeholder, then at least one other valid code.
    expect(values[0]).toBe("");
    expect(values.length).toBeGreaterThan(2);
  });

  it("add POSTs /api/admin/security/risk-countries with correct payload + refreshes list", async () => {
    const posted: unknown[] = [];
    const api = mockApiRouter([
      {
        match: /\/api\/admin\/security\/risk-countries$/,
        method: "GET",
        handler: () => ({ countries: SAMPLE, count: SAMPLE.length }),
      },
      {
        match: /\/api\/admin\/security\/risk-countries$/,
        method: "POST",
        handler: (_u, init) => {
          posted.push(JSON.parse(String(init?.body ?? "{}")));
          return {
            countryCode: "SY",
            label: "Syria",
            reason: "sanctioned",
            addedBy: "u1",
            createdAt: "2026-04-19T11:00:00.000Z",
          };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRiskCountryRoute(root, "/riskCountry");
    await tick();

    const getsBefore = api.mock.calls.filter(
      ([u, init]) =>
        String(u).endsWith("/api/admin/security/risk-countries") &&
        String((init as RequestInit)?.method ?? "GET").toUpperCase() === "GET"
    ).length;

    root.querySelector<HTMLButtonElement>('[data-action="add-risk-country"]')!.click();
    await tick();

    const form = document.querySelector<HTMLFormElement>(
      'form[data-testid="add-risk-country-form"]'
    )!;
    expect(form).toBeTruthy();
    const select = form.querySelector<HTMLSelectElement>("#rc-code")!;
    // Pick SY from the dropdown — present in ISO_COUNTRIES and not in SAMPLE.
    select.value = "SY";
    form.querySelector<HTMLInputElement>("#rc-reason")!.value = "sanctioned";

    document.querySelector<HTMLButtonElement>('button[data-action="submit"]')!.click();
    await tick();

    expect(posted.length).toBe(1);
    expect(posted[0]).toMatchObject({
      countryCode: "SY",
      label: "Syria",
      reason: "sanctioned",
    });
    const getsAfter = api.mock.calls.filter(
      ([u, init]) =>
        String(u).endsWith("/api/admin/security/risk-countries") &&
        String((init as RequestInit)?.method ?? "GET").toUpperCase() === "GET"
    ).length;
    expect(getsAfter).toBeGreaterThan(getsBefore);
  });

  it("delete confirm calls DELETE /api/admin/security/risk-countries/:code", async () => {
    const api = mockApiRouter([
      {
        match: /\/api\/admin\/security\/risk-countries$/,
        method: "GET",
        handler: () => ({ countries: SAMPLE, count: SAMPLE.length }),
      },
      {
        match: /\/api\/admin\/security\/risk-countries\/IR$/,
        method: "DELETE",
        handler: () => ({ removed: true }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRiskCountryRoute(root, "/riskCountry");
    await tick();

    const del = root.querySelector<HTMLButtonElement>(
      'button[data-action="delete-risk-country"][data-code="IR"]'
    )!;
    expect(del).toBeTruthy();
    del.click();
    await tick();

    document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!.click();
    await tick();

    expect(
      api.mock.calls.some(
        ([u, init]) =>
          String(u).endsWith("/api/admin/security/risk-countries/IR") &&
          String((init as RequestInit)?.method ?? "GET").toUpperCase() === "DELETE"
      )
    ).toBe(true);
  });

  it("fail-closed: backend-500 → callout-danger, no silent empty list", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/security\/risk-countries/,
        handler: () => ({ ok: false, error: { code: "INTERNAL", message: "x" } }),
        status: 500,
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRiskCountryRoute(root, "/riskCountry");
    await tick(10);
    expect(root.querySelector(".callout-danger")).toBeTruthy();
  });
});
