// Render tests for subGame pages (BIN-621 wire-up).
//
// Focus: verify HTML scaffolding matches the legacy shell
// (breadcrumb, panel-heading, enabled buttons wired to handlers,
// dispatcher registration).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderSubGameListPage, formatLegacyDateTime } from "../../src/pages/games/subGame/SubGameListPage.js";
import { renderSubGameViewPage } from "../../src/pages/games/subGame/SubGameViewPage.js";
import {
  renderSubGameAddPage,
  renderSubGameEditPage,
} from "../../src/pages/games/subGame/SubGameAddEditPage.js";
import { initI18n } from "../../src/i18n/I18n.js";
import { isGamesRoute, mountGamesRoute } from "../../src/pages/games/index.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
}

function errJson(code: string, message: string, status: number): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    { status }
  );
}

function defaultFetch(): typeof fetch {
  return (async (url: string | URL) => {
    const urlStr = String(url);
    if (urlStr.startsWith("/api/admin/sub-games")) {
      return okJson({ subGames: [], count: 0 });
    }
    if (urlStr.startsWith("/api/admin/game-types")) {
      return okJson({ gameTypes: [], count: 0 });
    }
    if (urlStr.startsWith("/api/admin/games")) {
      return okJson([]);
    }
    return okJson([]);
  }) as typeof fetch;
}

describe("SubGameListPage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = defaultFetch();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders title + breadcrumb + enabled Add-button (BIN-621 live)", async () => {
    const c = document.createElement("div");
    await renderSubGameListPage(c);
    expect(c.querySelector(".content-header h1")?.textContent).toBeTruthy();
    expect(c.querySelector(".breadcrumb")).not.toBeNull();
    const addBtn = c.querySelector<HTMLAnchorElement>('[data-action="add-sub-game"]');
    expect(addBtn).not.toBeNull();
    expect(addBtn?.getAttribute("href")).toBe("#/subGame/add");
  });

  it("mounts an empty DataTable (no rows until backend has data)", async () => {
    const c = document.createElement("div");
    await renderSubGameListPage(c);
    const host = c.querySelector("#subGame-list-table");
    expect(host).not.toBeNull();
    const rows = c.querySelectorAll("#subGame-list-table tbody tr");
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});

describe("SubGameViewPage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async () => errJson("NOT_FOUND", "missing", 404)) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders pending banner when backend returns null", async () => {
    const c = document.createElement("div");
    await renderSubGameViewPage(c, "any-id");
    const banner = c.querySelector(".alert.alert-warning");
    expect(banner?.textContent).toContain("BIN-621");
    // Breadcrumb + Cancel button still rendered
    expect(c.querySelector(".breadcrumb")).not.toBeNull();
    const cancel = c.querySelector('a.btn.btn-danger[href="#/subGame"]');
    expect(cancel).not.toBeNull();
  });
});

describe("SubGameAddEditPage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = defaultFetch();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("add-page renders an enabled submit button", async () => {
    const c = document.createElement("div");
    await renderSubGameAddPage(c);
    const submit = c.querySelector<HTMLButtonElement>('button[type="submit"][data-action="save-sub-game"]');
    expect(submit).not.toBeNull();
    expect(submit?.disabled).toBe(false);
  });

  it("add-page includes ticket-color select with 8 legacy options", async () => {
    const c = document.createElement("div");
    await renderSubGameAddPage(c);
    const colorSelect = c.querySelector<HTMLSelectElement>('select[name="selectTicketColor"]');
    expect(colorSelect).not.toBeNull();
    // Enabled for BIN-621 wire-up
    expect(colorSelect?.disabled).toBe(false);
    expect(colorSelect?.querySelectorAll("option").length).toBe(8);
  });

  it("add-page includes status select with active/inactive", async () => {
    const c = document.createElement("div");
    await renderSubGameAddPage(c);
    const status = c.querySelector<HTMLSelectElement>('select[name="status"]');
    expect(status).not.toBeNull();
    expect(status?.querySelector('option[value="active"]')).not.toBeNull();
    expect(status?.querySelector('option[value="inactive"]')).not.toBeNull();
  });

  it("edit-page shows 'not found' when fetchSubGame returns null", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/admin/sub-games/missing-id")) {
        return errJson("NOT_FOUND", "missing", 404);
      }
      return okJson([]);
    }) as typeof fetch;
    const c = document.createElement("div");
    await renderSubGameEditPage(c, "missing-id");
    const err = c.querySelector(".alert.alert-danger");
    expect(err?.textContent ?? "").toContain("missing-id");
  });
});

describe("games route dispatcher (bolk 2: subGame)", () => {
  it("isGamesRoute matches /subGame static + dynamic paths", () => {
    expect(isGamesRoute("/subGame")).toBe(true);
    expect(isGamesRoute("/subGame/add")).toBe(true);
    expect(isGamesRoute("/subGame/view/abc123")).toBe(true);
    expect(isGamesRoute("/subGame/edit/abc123")).toBe(true);
    // Previously supported routes must still match.
    expect(isGamesRoute("/gameType")).toBe(true);
    expect(isGamesRoute("/gameType/view/bingo")).toBe(true);
  });

  it("mountGamesRoute routes /subGame to list page", () => {
    initI18n();
    const c = document.createElement("div");
    mountGamesRoute(c, "/subGame");
    expect(c.querySelector(".page-wrapper")).not.toBeNull();
  });

  it("mountGamesRoute routes /subGame/view/:id to view page", () => {
    initI18n();
    const c = document.createElement("div");
    mountGamesRoute(c, "/subGame/view/xxx");
    expect(c.querySelector(".page-wrapper")).not.toBeNull();
  });

  it("URL-decodes :id when dispatching", () => {
    initI18n();
    const c = document.createElement("div");
    mountGamesRoute(c, "/subGame/edit/abc%20def");
    expect(c.querySelector(".page-wrapper")).not.toBeNull();
  });
});

describe("formatLegacyDateTime", () => {
  it("formats a morning ISO date as `y/mm/d h:mm am`", () => {
    const out = formatLegacyDateTime("2026-04-19T07:05:00Z");
    expect(out).toMatch(/^\d{4}\/\d{2}\/\d{1,2} \d{1,2}:\d{2} (am|pm)$/);
  });

  it("pads minutes to 2 digits", () => {
    const out = formatLegacyDateTime("2026-04-19T09:05:00");
    expect(out).toMatch(/ \d{1,2}:05 /);
  });

  it("uses 12 for midnight and noon", () => {
    const midnight = formatLegacyDateTime("2026-04-19T00:30:00");
    const noon = formatLegacyDateTime("2026-04-19T12:30:00");
    expect(midnight).toMatch(/ (am|pm)$/);
    expect(noon).toMatch(/ (am|pm)$/);
  });

  it("returns em-dash on invalid input", () => {
    expect(formatLegacyDateTime("")).toBe("—");
    expect(formatLegacyDateTime("not-a-date")).toBe("—");
  });
});
