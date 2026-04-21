// Render + dispatcher tests for gameManagement pages (BIN-684 wire-up).
//
// Focus:
//   - Add-knapp er nå live (NOT disabled, NOT BIN-622 tooltip)
//   - Liste-laster spinner, og viser tabell fra live data
//   - View/View-G3 siden henter detail-data og rendrer table
//   - SubGames er wired
//   - Tickets + CloseDay forblir placeholders (backend mangler / BIN-623)

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderGameManagementPage } from "../../src/pages/games/gameManagement/GameManagementPage.js";
import {
  renderGameManagementAddPage,
  renderGameManagementAddG3Page,
  renderGameManagementViewPage,
  renderGameManagementViewG3Page,
  renderGameManagementTicketsPage,
  renderGameManagementSubGamesPage,
  renderGameManagementCloseDayPage,
} from "../../src/pages/games/gameManagement/GameManagementDetailPages.js";
import { isGamesRoute } from "../../src/pages/games/index.js";

// Mock the GameType fetch so detail pages have a name to render.
vi.mock("../../src/pages/games/gameType/GameTypeState.js", async () => {
  return {
    fetchGameTypeList: async () => [
      { _id: "bingo", slug: "bingo", name: "Spill1", type: "game_1", row: 5, columns: 5, photo: "bingo.png", pattern: true },
      { _id: "monsterbingo", slug: "monsterbingo", name: "Spill3", type: "game_3", row: 5, columns: 5, photo: "mb.png", pattern: true },
    ],
  };
});

function mockFetch(data: unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  spy.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data }),
  });
  (globalThis as unknown as { fetch: unknown }).fetch = spy as unknown as typeof fetch;
  return spy;
}

const emptyList = { games: [], count: 0 };

const sampleRow = {
  id: "gm-42",
  gameTypeId: "bingo",
  parentId: "parent-99",
  name: "Fredag Bingo",
  ticketType: "Large",
  ticketPrice: 20,
  startDate: "2026-05-01",
  endDate: null,
  status: "active",
  totalSold: 7,
  totalEarning: 140,
  config: {},
  repeatedFromId: null,
  createdBy: "admin-1",
  createdAt: "2026-04-19T12:00:00Z",
  updatedAt: "2026-04-19T12:00:00Z",
};

describe("GameManagementPage (list/picker) — BIN-684 wired", () => {
  beforeEach(() => {
    initI18n();
    window.localStorage.setItem("bingo_admin_access_token", "test-token");
  });
  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("renders the type-picker select with options from GameType list", async () => {
    mockFetch(emptyList);
    const c = document.createElement("div");
    await renderGameManagementPage(c);
    const picker = c.querySelector<HTMLSelectElement>("#gm-type-picker");
    expect(picker).not.toBeNull();
    const opts = c.querySelectorAll("#gm-type-picker option");
    // One default + 2 mocked types.
    expect(opts.length).toBe(3);
  });

  it("Add-knapp er aktiv (ingen BIN-622 tooltip)", async () => {
    mockFetch(emptyList);
    const c = document.createElement("div");
    await renderGameManagementPage(c, "bingo");
    const addBtn = c.querySelector<HTMLAnchorElement>("[data-testid='gm-add-btn']");
    expect(addBtn).not.toBeNull();
    expect(addBtn?.getAttribute("href")).toContain("/gameManagement/bingo/add");
    // Skal ikke ha disabled eller BIN-622-tooltip lenger.
    const disabled = c.querySelector("button[disabled]");
    expect(disabled).toBeNull();
  });

  it("G3 type får href til /add-g3", async () => {
    mockFetch(emptyList);
    const c = document.createElement("div");
    await renderGameManagementPage(c, "monsterbingo");
    const addBtn = c.querySelector<HTMLAnchorElement>("[data-testid='gm-add-btn']");
    expect(addBtn?.getAttribute("href")).toContain("/gameManagement/monsterbingo/add-g3");
  });

  it("henter live liste når typeId er satt", async () => {
    const fetchSpy = mockFetch({ games: [sampleRow], count: 1 });
    const c = document.createElement("div");
    await renderGameManagementPage(c, "bingo");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/game-management?gameTypeId=bingo",
      expect.objectContaining({ method: "GET" })
    );
    // Tabellen må rendres med innholdet.
    expect(c.textContent).toContain("Fredag Bingo");
    // Ingen backend-banner lenger.
    expect(c.querySelector("#gm-backend-banner")).toBeNull();
  });

  it("viser error-state ved 403", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, error: { code: "FORBIDDEN", message: "nope" } }),
    })) as unknown as typeof fetch;
    const c = document.createElement("div");
    await renderGameManagementPage(c, "bingo");
    const err = c.querySelector("[data-testid='gm-error']");
    expect(err).not.toBeNull();
  });
});

describe("GameManagement detail pages — BIN-684 wired", () => {
  beforeEach(() => {
    initI18n();
    window.localStorage.setItem("bingo_admin_access_token", "test-token");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("add page viser placeholder-banner (BIN-622 skjema-UI kommer)", async () => {
    const c = document.createElement("div");
    await renderGameManagementAddPage(c, "bingo");
    expect(c.querySelector("[data-testid='gm-placeholder']")?.textContent).toContain("BIN-622");
  });

  it("add-g3 page viser placeholder + Game 3 wording", async () => {
    const c = document.createElement("div");
    await renderGameManagementAddG3Page(c, "monsterbingo");
    expect(c.querySelector("[data-testid='gm-placeholder']")?.textContent).toContain("BIN-622");
    expect(c.querySelector("h1")?.textContent).toContain("Spill3");
  });

  it("view page henter detail og viser rad-info", async () => {
    mockFetch(sampleRow);
    const c = document.createElement("div");
    await renderGameManagementViewPage(c, "bingo", "gm-42");
    expect(c.querySelector("h1")?.textContent).toContain("gm-42");
    expect(c.querySelector("[data-testid='gm-view-details']")).not.toBeNull();
    expect(c.textContent).toContain("Fredag Bingo");
  });

  it("view-g3 page henter detail", async () => {
    mockFetch(sampleRow);
    const c = document.createElement("div");
    await renderGameManagementViewG3Page(c, "monsterbingo", "gm3-42");
    expect(c.querySelector("h1")?.textContent).toContain("gm3-42");
    expect(c.querySelector("[data-testid='gm-view-details']")).not.toBeNull();
  });

  it("view page viser not-found for 404", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: { code: "NOT_FOUND", message: "gone" } }),
    })) as unknown as typeof fetch;
    const c = document.createElement("div");
    await renderGameManagementViewPage(c, "bingo", "missing");
    expect(c.querySelector("[data-testid='gm-not-found']")).not.toBeNull();
  });

  it("tickets page forblir placeholder (backend-rute mangler)", async () => {
    const c = document.createElement("div");
    await renderGameManagementTicketsPage(c, "bingo", "gm-42");
    expect(c.querySelector("[data-testid='gm-placeholder']")?.textContent).toContain("BIN-622");
    expect(c.querySelector("h1")?.textContent).toContain("gm-42");
  });

  it("subGames page henter live data og rendrer parent-rad", async () => {
    mockFetch(sampleRow);
    const c = document.createElement("div");
    await renderGameManagementSubGamesPage(c, "bingo", "gm-42");
    expect(c.querySelector("[data-testid='gm-subgames']")).not.toBeNull();
    expect(c.textContent).toContain("parent-99");
  });

  it("closeDay page forblir placeholder med BIN-623", async () => {
    const c = document.createElement("div");
    await renderGameManagementCloseDayPage(c, "bingo", "gm-42");
    expect(c.querySelector("[data-testid='gm-placeholder']")?.textContent).toContain("BIN-623");
  });
});

describe("games dispatcher — gameManagement routes recognised", () => {
  it("matches /gameManagement", () => {
    expect(isGamesRoute("/gameManagement")).toBe(true);
    expect(isGamesRoute("/gameManagement?typeId=bingo")).toBe(true);
  });
  it("matches /gameManagement/:typeId/add and /add-g3", () => {
    expect(isGamesRoute("/gameManagement/bingo/add")).toBe(true);
    expect(isGamesRoute("/gameManagement/monsterbingo/add-g3")).toBe(true);
  });
  it("matches /gameManagement/:typeId/view/:id and /view-g3/:id", () => {
    expect(isGamesRoute("/gameManagement/bingo/view/gm-1")).toBe(true);
    expect(isGamesRoute("/gameManagement/monsterbingo/view-g3/gm-1")).toBe(true);
  });
  it("matches /gameManagement/:typeId/tickets/:id", () => {
    expect(isGamesRoute("/gameManagement/bingo/tickets/gm-1")).toBe(true);
  });
  it("matches /gameManagement/subGames/:typeId/:id", () => {
    expect(isGamesRoute("/gameManagement/subGames/bingo/gm-1")).toBe(true);
  });
  it("matches /gameManagement/closeDay/:typeId/:id", () => {
    expect(isGamesRoute("/gameManagement/closeDay/bingo/gm-1")).toBe(true);
  });
  it("does NOT match unrelated paths", () => {
    expect(isGamesRoute("/gameManagement/foo/bar/baz/extra")).toBe(false);
    expect(isGamesRoute("/foo")).toBe(false);
  });
});
