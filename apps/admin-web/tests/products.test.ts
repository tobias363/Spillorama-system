// PR-B5 (BIN-660) — tests for Products admin pages.
// Focus: route-dispatcher contract, list renders + filter, category
// filter refires the list endpoint, hall-products round-trips PUT with
// the correct productIds payload, fail-closed on API errors.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import {
  isProductsRoute,
  mountProductsRoute,
} from "../src/pages/products/index.js";

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
          JSON.stringify({ ok: false, error: { code: "NOT_MOCKED", message: `${method} ${url}` } }),
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

const SAMPLE_CATEGORIES = [
  {
    id: "cat-1",
    name: "Snacks",
    sortOrder: 1,
    isActive: true,
    createdAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
  },
  {
    id: "cat-2",
    name: "Drikke",
    sortOrder: 2,
    isActive: true,
    createdAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
  },
];

const SAMPLE_PRODUCTS = [
  {
    id: "p-1",
    name: "Nøtter",
    description: null,
    priceCents: 5000,
    categoryId: "cat-1",
    status: "ACTIVE" as const,
    createdAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
  },
  {
    id: "p-2",
    name: "Brus",
    description: null,
    priceCents: 3500,
    categoryId: "cat-2",
    status: "INACTIVE" as const,
    createdAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
  },
];

const SAMPLE_HALLS = [
  { id: "hall-a", slug: "a", name: "Hall A", isActive: true },
  { id: "hall-b", slug: "b", name: "Hall B", isActive: false },
];

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.location.hash = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  setSession(adminSession());
});

describe("isProductsRoute", () => {
  it("matches 3 declared routes", () => {
    expect(isProductsRoute("/productList")).toBe(true);
    expect(isProductsRoute("/categoryList")).toBe(true);
    expect(isProductsRoute("/hallProductList")).toBe(true);
    expect(isProductsRoute("/orderHistory")).toBe(false);
    expect(isProductsRoute("/wallet")).toBe(false);
  });
});

describe("ProductListPage", () => {
  it("renders products, category filter options and refires on change", async () => {
    const api = mockApiRouter([
      {
        match: /\/api\/admin\/product-categories/,
        handler: () => ({ categories: SAMPLE_CATEGORIES, count: 2 }),
      },
      {
        match: /\/api\/admin\/products(\?|$)/,
        handler: () => ({ products: SAMPLE_PRODUCTS, count: 2 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountProductsRoute(root, "/productList");
    await tick();

    // Both products rendered with formatted prices and status pills
    expect(root.textContent).toContain("Nøtter");
    expect(root.textContent).toContain("Brus");
    expect(root.textContent).toContain("50.00");
    expect(root.textContent).toContain("35.00");
    expect(root.querySelectorAll(".label-success").length).toBeGreaterThan(0);
    expect(root.querySelectorAll(".label-default").length).toBeGreaterThan(0);

    // Category filter populated with 2 categories + the "Select Category" placeholder
    const select = root.querySelector<HTMLSelectElement>(
      'select[data-testid="product-category-filter"]'
    )!;
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(3);
    expect(select.options[1]!.value).toBe("cat-1");

    // Filter-change refires products endpoint with categoryId
    const before = api.mock.calls.filter(([u]) =>
      String(u).includes("/api/admin/products?categoryId=cat-1")
    ).length;
    select.value = "cat-1";
    select.dispatchEvent(new Event("change"));
    await tick();
    const after = api.mock.calls.filter(([u]) =>
      String(u).includes("/api/admin/products?categoryId=cat-1")
    ).length;
    expect(after).toBeGreaterThan(before);
  });

  it("fail-closed: error → callout-danger", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/product-categories/,
        handler: () => ({ ok: false, error: { code: "INTERNAL", message: "boom" } }),
        status: 500,
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountProductsRoute(root, "/productList");
    await tick(10);
    expect(root.querySelector(".callout-danger")).toBeTruthy();
  });

  it("Add product modal POSTs /api/admin/products with correct payload", async () => {
    const posted: unknown[] = [];
    const api = mockApiRouter([
      {
        match: /\/api\/admin\/product-categories/,
        handler: () => ({ categories: SAMPLE_CATEGORIES, count: 2 }),
      },
      {
        match: /\/api\/admin\/products(\?|$)/,
        method: "GET",
        handler: () => ({ products: SAMPLE_PRODUCTS, count: 2 }),
      },
      {
        match: /\/api\/admin\/products$/,
        method: "POST",
        handler: (_u, init) => {
          posted.push(JSON.parse(String(init?.body ?? "{}")));
          return {
            id: "p-new",
            name: "Ny",
            description: null,
            priceCents: 12000,
            categoryId: "cat-1",
            status: "ACTIVE",
            createdAt: "now",
            updatedAt: "now",
          };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountProductsRoute(root, "/productList");
    await tick();

    // Open the Add modal
    const addBtn = root.querySelector<HTMLButtonElement>('button[data-action="add-product"]')!;
    expect(addBtn).toBeTruthy();
    addBtn.click();
    await tick();

    const form = document.querySelector<HTMLFormElement>(
      'form[data-testid="add-product-form"]'
    )!;
    expect(form).toBeTruthy();
    form.querySelector<HTMLInputElement>("#pf-name")!.value = "Ny";
    form.querySelector<HTMLInputElement>("#pf-price")!.value = "120";
    form.querySelector<HTMLSelectElement>("#pf-category")!.value = "cat-1";
    form.querySelector<HTMLSelectElement>("#pf-status")!.value = "ACTIVE";

    const submit = document.querySelector<HTMLButtonElement>(
      'button[data-action="submit"]'
    )!;
    submit.click();
    await tick();

    expect(posted.length).toBe(1);
    expect(posted[0]).toMatchObject({
      name: "Ny",
      priceCents: 12000,
      categoryId: "cat-1",
      status: "ACTIVE",
    });
    // POST was dispatched
    expect(
      api.mock.calls.some(
        ([u, init]) =>
          String(u).endsWith("/api/admin/products") &&
          String((init as RequestInit)?.method ?? "GET").toUpperCase() === "POST"
      )
    ).toBe(true);
  });
});

describe("CategoryListPage", () => {
  it("renders categories and opens add modal", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/product-categories/,
        handler: () => ({ categories: SAMPLE_CATEGORIES, count: 2 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountProductsRoute(root, "/categoryList");
    await tick();

    expect(root.textContent).toContain("Snacks");
    expect(root.textContent).toContain("Drikke");

    const addBtn = root.querySelector<HTMLButtonElement>('button[data-action="add-category"]')!;
    expect(addBtn).toBeTruthy();
    addBtn.click();
    await tick();
    expect(
      document.querySelector('form[data-testid="add-category-form"]')
    ).toBeTruthy();
  });

  it("fail-closed when API errors", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/product-categories/,
        handler: () => ({ ok: false, error: { code: "INTERNAL", message: "x" } }),
        status: 500,
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountProductsRoute(root, "/categoryList");
    await tick(10);
    expect(root.querySelector(".callout-danger")).toBeTruthy();
  });
});

describe("HallProductsPage", () => {
  it("loads halls + product pool, renders selector and assignment on pick", async () => {
    const api = mockApiRouter([
      { match: /\/api\/admin\/halls$/, handler: () => SAMPLE_HALLS },
      {
        match: /\/api\/admin\/products\?status=ACTIVE/,
        handler: () => ({ products: SAMPLE_PRODUCTS, count: 2 }),
      },
      {
        match: /\/api\/admin\/halls\/hall-a\/products/,
        method: "GET",
        handler: () => ({
          hallId: "hall-a",
          products: [
            {
              hallId: "hall-a",
              productId: "p-1",
              isActive: true,
              addedAt: "now",
              addedBy: null,
              product: SAMPLE_PRODUCTS[0],
            },
          ],
          count: 1,
        }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountProductsRoute(root, "/hallProductList");
    await tick();

    const selector = root.querySelector<HTMLSelectElement>(
      'select[data-testid="hall-selector"]'
    )!;
    expect(selector).toBeTruthy();
    // Only active halls present (hall-b is inactive): placeholder + Hall A only
    expect(selector.options.length).toBe(2);
    expect(selector.options[1]!.value).toBe("hall-a");

    selector.value = "hall-a";
    selector.dispatchEvent(new Event("change"));
    await tick();

    // Both products show; p-1 checked (assigned), p-2 unchecked
    const checks = root.querySelectorAll<HTMLInputElement>(
      '.hp-product-check'
    );
    expect(checks.length).toBe(2);
    const byId = new Map<string, HTMLInputElement>();
    checks.forEach((c) => byId.set(c.getAttribute("data-product-id") ?? "", c));
    expect(byId.get("p-1")!.checked).toBe(true);
    expect(byId.get("p-2")!.checked).toBe(false);

    expect(api).toHaveBeenCalled();
  });

  it("Save PUTs /api/admin/halls/:id/products with correct productIds", async () => {
    const put: unknown[] = [];
    mockApiRouter([
      { match: /\/api\/admin\/halls$/, handler: () => SAMPLE_HALLS },
      {
        match: /\/api\/admin\/products\?status=ACTIVE/,
        handler: () => ({ products: SAMPLE_PRODUCTS, count: 2 }),
      },
      {
        match: /\/api\/admin\/halls\/hall-a\/products/,
        method: "GET",
        handler: () => ({
          hallId: "hall-a",
          products: [],
          count: 0,
        }),
      },
      {
        match: /\/api\/admin\/halls\/hall-a\/products$/,
        method: "PUT",
        handler: (_u, init) => {
          put.push(JSON.parse(String(init?.body ?? "{}")));
          return { hallId: "hall-a", added: 1, removed: 0, total: 1 };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountProductsRoute(root, "/hallProductList");
    await tick();

    const selector = root.querySelector<HTMLSelectElement>(
      'select[data-testid="hall-selector"]'
    )!;
    selector.value = "hall-a";
    selector.dispatchEvent(new Event("change"));
    await tick();

    // Tick p-2 only
    const p2 = root.querySelector<HTMLInputElement>(
      '.hp-product-check[data-product-id="p-2"]'
    )!;
    p2.checked = true;

    const saveBtn = root.querySelector<HTMLButtonElement>(
      'button[data-action="save-hall-products"]'
    )!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await tick();

    expect(put.length).toBe(1);
    expect(put[0]).toMatchObject({ productIds: ["p-2"] });
  });

  it("fail-closed when initial halls fetch errors", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/halls$/,
        handler: () => ({ ok: false, error: { code: "INTERNAL", message: "x" } }),
        status: 500,
      },
      {
        match: /\/api\/admin\/products\?status=ACTIVE/,
        handler: () => ({ products: SAMPLE_PRODUCTS, count: 2 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountProductsRoute(root, "/hallProductList");
    await tick(10);
    expect(root.querySelector(".callout-danger")).toBeTruthy();
  });
});
