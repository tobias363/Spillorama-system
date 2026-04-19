// Render + dispatcher tests for gameManagement pages (PR-A3b bolk 4).
//
// Focus: verify HTML scaffolding (breadcrumb, banner, disabled buttons) and
// that the games-dispatcher knows about every new route.

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

describe("GameManagementPage (list/picker)", () => {
  beforeEach(() => initI18n());
  afterEach(() => {
    window.location.hash = "";
  });

  it("renders the type-picker select with options from GameType list", async () => {
    const c = document.createElement("div");
    await renderGameManagementPage(c);
    const picker = c.querySelector<HTMLSelectElement>("#gm-type-picker");
    expect(picker).not.toBeNull();
    const opts = c.querySelectorAll("#gm-type-picker option");
    // One default + 2 mocked types (no Game 4 in the mock, so no filtering needed).
    expect(opts.length).toBe(3);
  });

  it("renders the BIN-622 add-button disabled", async () => {
    const c = document.createElement("div");
    await renderGameManagementPage(c);
    const btn = c.querySelector("button[disabled]");
    expect(btn?.getAttribute("title")).toContain("BIN-622");
  });

  it("when typeId is provided, renders the header + banner + backend placeholder", async () => {
    const c = document.createElement("div");
    await renderGameManagementPage(c, "bingo");
    expect(c.querySelector("#gm-list-header h1")?.textContent).toContain("Spill1");
    expect(c.querySelector("#gm-backend-banner .alert")?.textContent).toContain("BIN-622");
  });
});

describe("GameManagement detail pages (BIN-622 / BIN-623 placeholders)", () => {
  beforeEach(() => initI18n());

  it("add page renders banner with BIN-622", async () => {
    const c = document.createElement("div");
    await renderGameManagementAddPage(c, "bingo");
    expect(c.querySelector(".alert")?.textContent).toContain("BIN-622");
  });
  it("add-g3 page renders banner with BIN-622 and Game 3 wording", async () => {
    const c = document.createElement("div");
    await renderGameManagementAddG3Page(c, "monsterbingo");
    expect(c.querySelector(".alert")?.textContent).toContain("BIN-622");
    expect(c.querySelector("h1")?.textContent).toContain("Spill3");
  });
  it("view page shows id in title", async () => {
    const c = document.createElement("div");
    await renderGameManagementViewPage(c, "bingo", "gm-42");
    expect(c.querySelector("h1")?.textContent).toContain("gm-42");
  });
  it("view-g3 page shows id in title", async () => {
    const c = document.createElement("div");
    await renderGameManagementViewG3Page(c, "monsterbingo", "gm3-42");
    expect(c.querySelector("h1")?.textContent).toContain("gm3-42");
  });
  it("tickets page shows ticket label + id", async () => {
    const c = document.createElement("div");
    await renderGameManagementTicketsPage(c, "bingo", "gm-42");
    expect(c.querySelector("h1")?.textContent).toContain("gm-42");
  });
  it("subGames page shows sub_game label + id", async () => {
    const c = document.createElement("div");
    await renderGameManagementSubGamesPage(c, "bingo", "gm-42");
    expect(c.querySelector("h1")?.textContent).toContain("gm-42");
  });
  it("closeDay page cites BIN-623 (not BIN-622)", async () => {
    const c = document.createElement("div");
    await renderGameManagementCloseDayPage(c, "bingo", "gm-42");
    expect(c.querySelector(".alert")?.textContent).toContain("BIN-623");
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
