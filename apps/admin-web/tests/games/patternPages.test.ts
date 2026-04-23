// Render + interaction tests for patternManagement pages (PR-A3 bolk 3).
//
// Focus:
//   - List page: breadcrumb, Add-button count-gating (Game 3: 32, Game 5: 17)
//   - Add page: 5x5 grid rendered; clicking cells toggles the hidden mask value
//   - View page: grid read-only, BIN-627 pending banner
//   - Dispatcher: typeId-scoped dynamic routes match

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderPatternListPage } from "../../src/pages/games/patternManagement/PatternListPage.js";
import { renderPatternViewPage } from "../../src/pages/games/patternManagement/PatternViewPage.js";
import {
  renderPatternAddPage,
  renderPatternEditPage,
  wireGrid,
} from "../../src/pages/games/patternManagement/PatternAddPage.js";
import { initI18n } from "../../src/i18n/I18n.js";
import { isGamesRoute } from "../../src/pages/games/index.js";
import type { GameType } from "../../src/pages/games/common/types.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function gameRow(slug: string, settings: Record<string, unknown> = {}): unknown {
  return {
    slug,
    title: slug === "bingo" ? "Game 1" : slug === "monsterbingo" ? "Game 3" : slug,
    description: "",
    route: "",
    isEnabled: true,
    sortOrder: 1,
    settings,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * Mock-fetch that answers both the new BIN-620 `/api/admin/game-types/*`
 * endpoints and the legacy `/api/admin/games` fallback. Pattern pages call
 * `fetchGameType` which hits the new endpoint first.
 */
function mockGameTypeFetch(slugs: string[]): typeof fetch {
  const slugToGameType = (slug: string) => {
    const slugToType: Record<string, string> = {
      bingo: "game_1",
      rocket: "game_2",
      monsterbingo: "game_3",
      spillorama: "game_5",
    };
    const type = slugToType[slug] ?? slug;
    const isPattern = type === "game_1" || type === "game_3";
    return {
      id: slug,
      typeSlug: slug,
      name: slug === "bingo" ? "Game 1" : slug === "monsterbingo" ? "Game 3" : slug,
      photo: `${slug}.png`,
      pattern: isPattern,
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
  };

  return (async (url: string | URL) => {
    const urlStr = String(url);
    // Detail endpoint: /api/admin/game-types/:id
    const detailMatch = urlStr.match(/^\/api\/admin\/game-types\/([^?]+)/);
    if (detailMatch) {
      const requestedSlug = decodeURIComponent(detailMatch[1]!);
      if (slugs.includes(requestedSlug)) {
        return okJson(slugToGameType(requestedSlug));
      }
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }),
        { status: 404 }
      );
    }
    // List endpoint
    if (urlStr.startsWith("/api/admin/game-types")) {
      return okJson({ gameTypes: slugs.map(slugToGameType), count: slugs.length });
    }
    // Pattern detail → 404 by default (no fixture)
    if (urlStr.match(/^\/api\/admin\/patterns\/[^?]+/)) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }),
        { status: 404 }
      );
    }
    // Pattern list → empty
    if (urlStr.startsWith("/api/admin/patterns")) {
      return okJson({ patterns: [], count: 0 });
    }
    // Legacy fallback
    if (urlStr.startsWith("/api/admin/games")) {
      return okJson(slugs.map((s) => gameRow(s)));
    }
    return okJson([]);
  }) as typeof fetch;
}

describe("PatternListPage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = mockGameTypeFetch(["bingo"]);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders title + breadcrumb + DataTable host", async () => {
    const c = document.createElement("div");
    await renderPatternListPage(c, "bingo");
    expect(c.querySelector(".content-header h1")?.textContent).toBeTruthy();
    expect(c.querySelector(".breadcrumb")).not.toBeNull();
    expect(c.querySelector("#pattern-list-table")).not.toBeNull();
  });

  it("renders an enabled Add button when game is Game 1 (unlimited)", async () => {
    const c = document.createElement("div");
    await renderPatternListPage(c, "bingo");
    const addBtn = c.querySelector<HTMLAnchorElement>('.pull-right a[data-action="add-pattern"]');
    expect(addBtn).not.toBeNull();
    expect(addBtn?.getAttribute("href")).toContain("bingo/add");
  });

  it("shows 'not found' error when gameType is unknown", async () => {
    globalThis.fetch = mockGameTypeFetch(["bingo"]);
    const c = document.createElement("div");
    await renderPatternListPage(c, "nonexistent");
    const alert = c.querySelector(".alert.alert-danger");
    expect(alert?.textContent).toContain("nonexistent");
  });
});

describe("PatternAddPage — 5x5 bitmask grid interaction", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = mockGameTypeFetch(["bingo"]);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders 25 cells (5 rows x 5 cols) for Game 1", async () => {
    const c = document.createElement("div");
    await renderPatternAddPage(c, "bingo");
    const cells = c.querySelectorAll(".pattern-cell");
    expect(cells.length).toBe(25);
  });

  it("cells start off (no cell-on class) for a fresh add-page", async () => {
    const c = document.createElement("div");
    await renderPatternAddPage(c, "bingo");
    const onCells = c.querySelectorAll(".pattern-cell.cell-on");
    expect(onCells.length).toBe(0);
  });

  it("renders an enabled Submit button (BIN-627 live)", async () => {
    const c = document.createElement("div");
    await renderPatternAddPage(c, "bingo");
    const submit = c.querySelector<HTMLButtonElement>('button[type="submit"][data-action="save-pattern"]');
    expect(submit).not.toBeNull();
    expect(submit?.disabled).toBe(false);
  });

  it("renders the max-patterns info block for Game 3", async () => {
    globalThis.fetch = mockGameTypeFetch(["monsterbingo"]);
    const c = document.createElement("div");
    await renderPatternAddPage(c, "monsterbingo");
    const infos = c.querySelectorAll(".alert.alert-info");
    const hasMaxMsg = Array.from(infos).some((el) => el.textContent?.includes("32"));
    expect(hasMaxMsg).toBe(true);
  });
});

describe("wireGrid — cell-toggle updates hidden maskValue", () => {
  beforeEach(() => {
    initI18n();
  });

  it("toggles a cell on-click and updates #maskValue + cell count", () => {
    // Build a minimal container with the grid markup wireGrid expects.
    const c = document.createElement("div");
    c.innerHTML = `
      <input type="hidden" id="maskValue" value="0">
      <span id="pattern-cell-count">0</span>
      <button type="button" class="pattern-cell cell-off" data-row="0" data-col="0" aria-pressed="false"></button>
      <button type="button" class="pattern-cell cell-off" data-row="0" data-col="1" aria-pressed="false"></button>
      <button type="button" class="pattern-cell cell-off" data-row="2" data-col="2" aria-pressed="false"></button>
    `;
    const gt: GameType = {
      _id: "bingo",
      slug: "bingo",
      name: "Game 1",
      type: "game_1",
      row: 5,
      columns: 5,
      photo: "bingo.png",
      pattern: true,
    };
    wireGrid(c, gt, 0);

    const cells = c.querySelectorAll<HTMLButtonElement>(".pattern-cell");
    // Click center cell (row=2, col=2 → bit 12)
    cells[2]!.click();
    const maskInput = c.querySelector<HTMLInputElement>("#maskValue");
    expect(maskInput?.value).toBe(String(1 << 12));
    expect(cells[2]!.classList.contains("cell-on")).toBe(true);
    expect(cells[2]!.getAttribute("aria-pressed")).toBe("true");
    expect(c.querySelector("#pattern-cell-count")?.textContent).toBe("1");

    // Click top-left (row=0, col=0 → bit 0). Mask becomes 0x1001.
    cells[0]!.click();
    expect(Number(maskInput?.value)).toBe((1 << 12) | 1);
    expect(c.querySelector("#pattern-cell-count")?.textContent).toBe("2");

    // Click center again → bit 12 clears.
    cells[2]!.click();
    expect(Number(maskInput?.value)).toBe(1);
    expect(cells[2]!.classList.contains("cell-on")).toBe(false);
    expect(c.querySelector("#pattern-cell-count")?.textContent).toBe("1");
  });
});

describe("PatternEditPage (BIN-627 placeholder)", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = mockGameTypeFetch(["bingo"]);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders shell with blank grid when fetchPattern returns null", async () => {
    const c = document.createElement("div");
    await renderPatternEditPage(c, "bingo", "any-id");
    const cells = c.querySelectorAll(".pattern-cell");
    expect(cells.length).toBe(25);
    // Should have enabled form (BIN-627 live)
    const submit = c.querySelector<HTMLButtonElement>('button[type="submit"][data-action="save-pattern"]');
    expect(submit).not.toBeNull();
  });
});

describe("PatternViewPage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
    globalThis.fetch = mockGameTypeFetch(["bingo"]);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("shows not-found banner when backend yields null", async () => {
    const c = document.createElement("div");
    await renderPatternViewPage(c, "bingo", "any-id");
    const banner = c.querySelector('[data-testid="pattern-not-found"]');
    expect(banner).not.toBeNull();
  });

  it("Cancel-button navigates back to the list", async () => {
    const c = document.createElement("div");
    await renderPatternViewPage(c, "bingo", "any-id");
    const cancel = c.querySelector<HTMLAnchorElement>("a.btn.btn-danger.btn-flat");
    expect(cancel).not.toBeNull();
    expect(cancel?.getAttribute("href")).toBe("#/patternManagement/bingo");
  });
});

describe("games route dispatcher (bolk 3: patternManagement)", () => {
  it("isGamesRoute matches patternManagement typeId-scoped paths", () => {
    expect(isGamesRoute("/patternManagement/bingo")).toBe(true);
    expect(isGamesRoute("/patternManagement/bingo/add")).toBe(true);
    expect(isGamesRoute("/patternManagement/bingo/view/abc")).toBe(true);
    expect(isGamesRoute("/patternManagement/bingo/edit/abc")).toBe(true);
    // Non-matches
    expect(isGamesRoute("/patternManagement")).toBe(false);
    expect(isGamesRoute("/patternManagement/bingo/garbage/segment")).toBe(false);
    // Previously supported still works.
    expect(isGamesRoute("/gameType")).toBe(true);
    expect(isGamesRoute("/subGame/view/x")).toBe(true);
  });
});
