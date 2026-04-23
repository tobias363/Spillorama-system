// Render tests for gameType pages (BIN-620 wire-up).
//
// Focus: verify HTML scaffolding matches the legacy shell
// (breadcrumb, panel-heading, table columns, enabled buttons wired to handlers).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderGameTypeListPage } from "../../src/pages/games/gameType/GameTypeListPage.js";
import { renderGameTypeViewPage } from "../../src/pages/games/gameType/GameTypeViewPage.js";
import {
  renderGameTypeAddPage,
  renderGameTypeEditPage,
} from "../../src/pages/games/gameType/GameTypeAddEditPage.js";
import { renderGameTypeTestPage } from "../../src/pages/games/gameType/GameTypeTestPage.js";
import { initI18n } from "../../src/i18n/I18n.js";
import { isGamesRoute, mountGamesRoute } from "../../src/pages/games/index.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function gtFixture(slug: string, name: string): {
  id: string;
  typeSlug: string;
  name: string;
  photo: string;
  pattern: boolean;
  gridRows: number;
  gridColumns: number;
  rangeMin: number | null;
  rangeMax: number | null;
  totalNoTickets: number | null;
  userMaxTickets: number | null;
  luckyNumbers: number[];
  status: "active";
  extra: Record<string, unknown>;
  createdBy: null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: `uuid-${slug}`,
    typeSlug: slug,
    name,
    photo: `${slug}.png`,
    pattern: slug === "bingo" || slug === "monsterbingo",
    gridRows: slug === "rocket" ? 3 : 5,
    gridColumns: slug === "rocket" ? 3 : 5,
    rangeMin: 1,
    rangeMax: 75,
    totalNoTickets: null,
    userMaxTickets: null,
    luckyNumbers: [],
    status: "active",
    extra: {},
    createdBy: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("GameTypeListPage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.startsWith("/api/admin/game-types")) {
        return okJson({
          gameTypes: [gtFixture("bingo", "Game 1"), gtFixture("rocket", "Game 2")],
          count: 2,
        });
      }
      return okJson([]);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders title + breadcrumb + enabled Add-button", async () => {
    const c = document.createElement("div");
    await renderGameTypeListPage(c);
    expect(c.querySelector(".content-header h1")?.textContent).toBeTruthy();
    expect(c.querySelector(".breadcrumb")).not.toBeNull();
    const addBtn = c.querySelector<HTMLAnchorElement>('[data-action="add-game-type"]');
    expect(addBtn).not.toBeNull();
    expect(addBtn?.getAttribute("href")).toBe("#/gameType/add");
  });

  it("renders one row per GameType after fetch resolves", async () => {
    const c = document.createElement("div");
    await renderGameTypeListPage(c);
    const table = c.querySelector("#gameType-list-table table");
    expect(table).not.toBeNull();
    const rows = c.querySelectorAll("#gameType-list-table tbody tr");
    expect(rows.length).toBe(2);
  });

  it("action column has view / edit / delete buttons wired", async () => {
    const c = document.createElement("div");
    await renderGameTypeListPage(c);
    const firstRow = c.querySelector("#gameType-list-table tbody tr");
    expect(firstRow?.querySelector('a[href="#/gameType/view/uuid-bingo"]')).not.toBeNull();
    expect(firstRow?.querySelector('a[href="#/gameType/edit/uuid-bingo"]')).not.toBeNull();
    const deleteBtn = firstRow?.querySelector('button[data-action="delete-game-type"]');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn?.getAttribute("data-id")).toBe("uuid-bingo");
  });
});

describe("GameTypeViewPage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/admin/game-types/bingo")) {
        return okJson(gtFixture("bingo", "Game 1"));
      }
      if (urlStr.startsWith("/api/admin/game-types")) {
        return okJson({ gameTypes: [gtFixture("bingo", "Game 1")], count: 1 });
      }
      if (urlStr.startsWith("/api/admin/games")) {
        return okJson([
          {
            slug: "bingo",
            title: "Game 1",
            description: "",
            route: "",
            isEnabled: true,
            sortOrder: 1,
            settings: { row: 5, columns: 5, pattern: true },
            createdAt: "",
            updatedAt: "",
          },
        ]);
      }
      return okJson([]);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders read-only fields for a known GameType", async () => {
    const c = document.createElement("div");
    await renderGameTypeViewPage(c, "bingo");
    const inputs = c.querySelectorAll("input[readonly]");
    expect(inputs.length).toBeGreaterThan(0);
    expect(c.querySelector(".breadcrumb")).not.toBeNull();
  });

  it("shows 'not found' error for unknown id", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/admin/game-types/missing-slug")) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }),
          { status: 404 }
        );
      }
      if (urlStr.startsWith("/api/admin/game-types")) {
        return okJson({ gameTypes: [], count: 0 });
      }
      return okJson([]);
    }) as typeof fetch;
    const c = document.createElement("div");
    await renderGameTypeViewPage(c, "missing-slug");
    const alert = c.querySelector(".alert.alert-danger");
    expect(alert?.textContent).toContain("missing-slug");
  });
});

describe("GameTypeAddEditPage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/admin/game-types/bingo")) {
        return okJson(gtFixture("bingo", "Game 1"));
      }
      if (urlStr.startsWith("/api/admin/game-types")) {
        return okJson({ gameTypes: [gtFixture("bingo", "Game 1")], count: 1 });
      }
      return okJson([]);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("add-page renders an enabled submit button with form", async () => {
    const c = document.createElement("div");
    await renderGameTypeAddPage(c);
    const submit = c.querySelector<HTMLButtonElement>('button[type="submit"][data-action="save-game-type"]');
    expect(submit).not.toBeNull();
    expect(submit?.disabled).toBe(false);
    // Has name + row + columns fields
    expect(c.querySelector('input[name="name"]')).not.toBeNull();
    expect(c.querySelector('input[name="row"]')).not.toBeNull();
    expect(c.querySelector('input[name="columns"]')).not.toBeNull();
    // Has typeSlug field (only on add)
    expect(c.querySelector('input[name="typeSlug"]')).not.toBeNull();
  });

  it("edit-page pre-fills name from fetched GameType (enabled form)", async () => {
    const c = document.createElement("div");
    await renderGameTypeEditPage(c, "bingo");
    const nameInput = c.querySelector<HTMLInputElement>('input[name="name"]');
    expect(nameInput?.value).toBe("Game 1");
    // Form is enabled for BIN-620 wire-up
    expect(nameInput?.disabled).toBe(false);
    // Edit-page hides typeSlug (slug is immutable post-create)
    expect(c.querySelector('input[name="typeSlug"]')).toBeNull();
  });
});

describe("GameTypeTestPage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.startsWith("/api/admin/game-types")) {
        return okJson({ gameTypes: [gtFixture("bingo", "G1")], count: 1 });
      }
      if (urlStr.startsWith("/api/admin/games")) {
        return okJson([
          { slug: "bingo", title: "G1", description: "", route: "", isEnabled: true, sortOrder: 1, settings: {}, createdAt: "", updatedAt: "" },
        ]);
      }
      return okJson([]);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders thumbs after fetch", async () => {
    const c = document.createElement("div");
    await renderGameTypeTestPage(c);
    const img = c.querySelector("#gameType-test-thumbs img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("G1");
  });
});

describe("games route dispatcher", () => {
  it("isGamesRoute matches static and dynamic paths", () => {
    expect(isGamesRoute("/gameType")).toBe(true);
    expect(isGamesRoute("/gameType/add")).toBe(true);
    expect(isGamesRoute("/gameType/test")).toBe(true);
    expect(isGamesRoute("/gameType/view/bingo")).toBe(true);
    expect(isGamesRoute("/gameType/edit/bingo")).toBe(true);
    expect(isGamesRoute("/gameType/view/bingo?hl=1")).toBe(true);
    expect(isGamesRoute("/nonsense")).toBe(false);
    expect(isGamesRoute("/gameType/weirdthing")).toBe(false);
  });

  it("mountGamesRoute handles unknown-dynamic with a 404 box", () => {
    const c = document.createElement("div");
    mountGamesRoute(c, "/gameType/something-unknown/extra/segments");
    expect(c.querySelector(".box.box-danger")).not.toBeNull();
  });
});
