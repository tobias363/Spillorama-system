// Render + dispatcher tests for gameManagement pages (BIN-684 wire-up).
//
// Focus:
//   - Add-knapp er nå live (NOT disabled, NOT BIN-622 tooltip)
//   - Liste-laster spinner, og viser tabell fra live data
//   - View/View-G3 siden henter detail-data og rendrer table
//   - SubGames er wired
//   - Tickets + CloseDay forblir placeholders (backend mangler / BIN-623)
//   - DailySchedule-seksjonen (feat/game-management-daily-schedules):
//     tabell + buttons + row-actions når type er valgt (pilot-blokker).

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
const mockGameTypes = [
  { _id: "bingo", slug: "bingo", name: "Spill1", type: "game_1", row: 5, columns: 5, photo: "bingo.png", pattern: true },
  { _id: "monsterbingo", slug: "monsterbingo", name: "Spill3", type: "game_3", row: 5, columns: 5, photo: "mb.png", pattern: true },
];
vi.mock("../../src/pages/games/gameType/GameTypeState.js", async () => {
  return {
    fetchGameTypeList: async () => mockGameTypes,
    fetchGameType: async (slug: string) =>
      mockGameTypes.find((gt) => gt._id === slug) ?? null,
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

  // ── DailySchedule-seksjonen (feat/game-management-daily-schedules) ─────────
  // Legacy-admin viste DailySchedule-tabell + 2 actions når type var valgt.
  // Ny admin må matche dette for pilot-blokkeren.

  /**
   * Fetch-mock som svarer på ulike endepunkter:
   *   /api/admin/game-management  → games-liste
   *   /api/admin/daily-schedules  → schedules-liste
   *   alt annet                   → null (no-op)
   */
  function mockMultiFetch(routes: {
    games?: unknown[];
    schedules?: unknown[];
  }): ReturnType<typeof vi.fn> {
    const games = routes.games ?? [];
    const schedules = routes.schedules ?? [];
    const spy = vi.fn();
    spy.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/api/admin/game-management")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: { games, count: games.length } }),
        };
      }
      if (u.includes("/api/admin/daily-schedules")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: { schedules, count: schedules.length },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: null }),
      };
    });
    (globalThis as unknown as { fetch: unknown }).fetch = spy as unknown as typeof fetch;
    return spy;
  }

  const sampleDs = {
    id: "DSN_2026419_111942258",
    name: "Oslo bingo Mon-Fre",
    gameManagementId: "gm-42",
    hallId: null,
    hallIds: {
      masterHallId: "Oslo bingo",
      hallIds: ["Oslo"],
      groupHallIds: ["Oslo"],
    },
    weekDays: 31,
    day: null,
    startDate: "2026-04-20T00:00:00.000Z",
    endDate: "2026-04-24T00:00:00.000Z",
    startTime: "09:00",
    endTime: "23:00",
    status: "active" as const,
    stopGame: false,
    specialGame: false,
    isSavedGame: false,
    isAdminSavedGame: false,
    innsatsenSales: 0,
    subgames: [],
    otherData: {},
    createdBy: "admin-1",
    createdAt: "2026-04-19T12:00:00Z",
    updatedAt: "2026-04-19T12:00:00Z",
    deletedAt: null,
  };

  it("DS-seksjonen er skjult før type er valgt", async () => {
    mockFetch(emptyList);
    const c = document.createElement("div");
    await renderGameManagementPage(c);
    const ds = c.querySelector<HTMLElement>("[data-testid='gm-ds-section']");
    expect(ds).not.toBeNull();
    expect(ds?.style.display).toBe("none");
  });

  it("DS-seksjonen viser 2 knapper (Spesialspill + Lag daglig tidsplan) når type er valgt", async () => {
    mockMultiFetch({ games: [sampleRow], schedules: [] });
    const c = document.createElement("div");
    await renderGameManagementPage(c, "bingo");
    const ds = c.querySelector<HTMLElement>("[data-testid='gm-ds-section']");
    expect(ds?.style.display).not.toBe("none");
    const specialBtn = c.querySelector<HTMLAnchorElement>("[data-testid='gm-ds-special-btn']");
    const dailyBtn = c.querySelector<HTMLAnchorElement>("[data-testid='gm-ds-daily-btn']");
    expect(specialBtn).not.toBeNull();
    expect(dailyBtn).not.toBeNull();
    // Heading er "<type.name> Tabell"
    const heading = c.querySelector("#gm-ds-heading");
    expect(heading?.textContent).toContain("Spill1");
  });

  it("DS-tabell filtrerer schedules etter gameManagementId i GM-listen", async () => {
    const scheduleInScope = { ...sampleDs, id: "DSN_match", gameManagementId: "gm-42" };
    const scheduleOutOfScope = { ...sampleDs, id: "DSN_other", gameManagementId: "gm-999" };
    mockMultiFetch({
      games: [sampleRow], // gm-42
      schedules: [scheduleInScope, scheduleOutOfScope],
    });
    const c = document.createElement("div");
    await renderGameManagementPage(c, "bingo");
    expect(c.textContent).toContain("DSN_match");
    expect(c.textContent).not.toContain("DSN_other");
  });

  it("DS-tabell formatterer dato-range som DD/MM/YYYY-DD/MM/YYYY + tidsluke", async () => {
    mockMultiFetch({ games: [sampleRow], schedules: [sampleDs] });
    const c = document.createElement("div");
    await renderGameManagementPage(c, "bingo");
    // Forventet: 20/04/2026-24/04/2026 (matchende legacy-format).
    expect(c.textContent).toContain("20/04/2026-24/04/2026");
    // Tidsluke: "09:00 - 23:00"
    expect(c.textContent).toContain("09:00 - 23:00");
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

  it("add page (Spill 1) renderer full form, ikke lenger placeholder", async () => {
    const c = document.createElement("div");
    await renderGameManagementAddPage(c, "bingo");
    // Ingen BIN-622-placeholder lenger; full form skal rendres.
    expect(c.querySelector("[data-testid='gm-placeholder']")).toBeNull();
    expect(c.querySelector("[data-testid='gm-add-form-root']")).not.toBeNull();
    expect(c.querySelector("#gm-add-form")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-submit']")).not.toBeNull();
  });

  it("add page (ukjent type) viser not-yet-supported banner", async () => {
    const c = document.createElement("div");
    await renderGameManagementAddPage(c, "monsterbingo");
    expect(c.querySelector("[data-testid='gm-add-unsupported']")).not.toBeNull();
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

  it("closeDay page henter summary + rendrer close-button (BIN-623 live)", async () => {
    // Need mocks for both the GM detail fetch and the close-day-summary fetch.
    const spy = vi.fn();
    const summary = {
      gameManagementId: "gm-42",
      closeDate: "2026-04-23",
      alreadyClosed: false,
      closedAt: null,
      closedBy: null,
      totalSold: 7,
      totalEarning: 140,
      ticketsSold: 7,
      winnersCount: 0,
      payoutsTotal: 0,
      jackpotsTotal: 0,
      capturedAt: "2026-04-23T12:00:00Z",
    };
    spy.mockImplementation(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/close-day-summary")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, data: summary }) };
      }
      // Any other call → sampleRow (GM detail)
      return { ok: true, status: 200, json: async () => ({ ok: true, data: sampleRow }) };
    });
    (globalThis as unknown as { fetch: unknown }).fetch = spy as unknown as typeof fetch;

    const c = document.createElement("div");
    await renderGameManagementCloseDayPage(c, "bingo", "gm-42");
    // Summary rendered
    expect(c.querySelector("[data-testid='cd-summary']")).not.toBeNull();
    // Close-day button present
    const btn = c.querySelector<HTMLButtonElement>('button[data-action="confirm-close-day"]');
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(false);
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
