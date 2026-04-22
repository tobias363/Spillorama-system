// PR 4e.1 (2026-04-22) — GroupHall dispatcher-tests.
//
// Coverage:
//   - isGroupHallRoute matcher static + edit + view-paths
//   - mountGroupHallRoute renderer list-siden og fetcher data
//   - /groupHall/add åpner create-modal umiddelbart

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import {
  isGroupHallRoute,
  mountGroupHallRoute,
} from "../../src/pages/groupHall/index.js";

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetchBatch(pattern: RegExp, data: unknown): FetchMock {
  const fn: FetchMock = vi.fn((async (url: string) => {
    if (pattern.test(url)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data }),
      };
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: { code: "NOT_MOCKED", message: url } }),
    };
  }) as never);
  (globalThis as unknown as { fetch: unknown }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  initI18n();
  window.localStorage.setItem("bingo_admin_access_token", "test-token");
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GroupHall dispatcher — isGroupHallRoute", () => {
  it("matcher static paths", () => {
    expect(isGroupHallRoute("/groupHall")).toBe(true);
    expect(isGroupHallRoute("/groupHall/add")).toBe(true);
  });

  it("matcher edit-paths via regex", () => {
    expect(isGroupHallRoute("/groupHall/edit/hg-1")).toBe(true);
    expect(isGroupHallRoute("/groupHall/edit/")).toBe(false);
  });

  it("matcher legacy view-paths (bakoverkompat)", () => {
    expect(isGroupHallRoute("/groupHall/view/hg-1")).toBe(true);
  });

  it("avviser andre paths", () => {
    expect(isGroupHallRoute("/hall")).toBe(false);
    expect(isGroupHallRoute("/groupHall/banana")).toBe(false);
  });
});

describe("GroupHall dispatcher — mountGroupHallRoute", () => {
  it("/groupHall renderer list-siden", async () => {
    mockFetchBatch(/\/api\/admin\/hall-groups/, { groups: [], count: 0 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountGroupHallRoute(root, "/groupHall");
    await tick();
    expect(root.querySelector('[data-testid="gh-list-table"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="gh-add-btn"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="group-halls-placeholder-banner"]')).toBeNull();
  });

  it("/groupHall/add åpner create-modal over list-siden", async () => {
    mockFetchBatch(/\/api\/admin\/(hall-groups|halls)/, { groups: [], count: 0 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountGroupHallRoute(root, "/groupHall/add");
    await tick();
    // List-siden er fortsatt montert
    expect(root.querySelector('[data-testid="gh-list-table"]')).toBeTruthy();
    // Modalen er åpnet (via document.body, ikke i `root`)
    expect(document.body.querySelector('[data-testid="gh-modal-loading"], [data-testid="gh-editor-form"]')).toBeTruthy();
  });
});
