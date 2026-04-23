// Render + dispatcher tests for SavedGame / Schedule / DailySchedule pages.
//
// Etter BIN-624/625/626 er alle tre wired til live endepunkter —
// gap-banneren er fjernet.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderSavedGameListPage } from "../../src/pages/games/savedGame/SavedGameListPage.js";
import { renderSavedGameDetailPages } from "../../src/pages/games/savedGame/SavedGameDetailPages.js";
import { renderScheduleListPage } from "../../src/pages/games/schedules/ScheduleListPage.js";
import { renderScheduleDetailPages } from "../../src/pages/games/schedules/ScheduleDetailPages.js";
import { renderDailyScheduleDetailPages } from "../../src/pages/games/dailySchedules/DailyScheduleDetailPages.js";
import { renderDailyScheduleListPage } from "../../src/pages/games/dailySchedules/DailyScheduleListPage.js";
import { isGamesRoute } from "../../src/pages/games/index.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successResponse<T>(data: T, status = 200): Response {
  return jsonResponse({ ok: status < 400, data }, status);
}

function installFetchEmpty(): void {
  const fn = vi.fn(async () => successResponse({ schedules: [], count: 0 }));
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

describe("SavedGameListPage (BIN-624 live)", () => {
  beforeEach(() => {
    initI18n();
    // Default: empty list from backend.
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () =>
      successResponse({ savedGames: [], count: 0 })) as typeof fetch;
  });

  it("renders title + enabled Add link (no BIN-624 placeholder)", async () => {
    const c = document.createElement("div");
    await renderSavedGameListPage(c);
    expect(c.querySelector("h1")?.textContent).toBeTruthy();
    // No BIN-624 banner any more
    const banner = c.querySelector(".panel-body .alert");
    expect(banner?.textContent ?? "").not.toContain("BIN-624");
    // Add link points to GM (where templates are created)
    const addLink = c.querySelector<HTMLAnchorElement>('a[data-action="back-to-gm"]');
    expect(addLink).not.toBeNull();
  });

  it("mounts the empty DataTable", async () => {
    const c = document.createElement("div");
    await renderSavedGameListPage(c);
    expect(c.querySelector("#saved-game-list-table")).not.toBeNull();
  });
});

describe("SavedGame detail pages (BIN-624 live)", () => {
  beforeEach(() => {
    initI18n();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/admin/saved-games/sg-1")) {
        return successResponse({
          id: "sg-1",
          gameTypeId: "bingo",
          name: "Template A",
          isAdminSave: true,
          config: {},
          status: "active",
          createdBy: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        });
      }
      return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "x" } }, 404);
    }) as typeof fetch;
  });

  it("add page references the GameManagement workflow", async () => {
    const c = document.createElement("div");
    await renderSavedGameDetailPages(c, { kind: "add", typeId: "bingo" });
    const alert = c.querySelector(".alert.alert-info");
    expect(alert).not.toBeNull();
  });

  it("view page renders SavedGame row", async () => {
    const c = document.createElement("div");
    await renderSavedGameDetailPages(c, { kind: "view", typeId: "bingo", id: "sg-1" });
    expect(c.querySelector('[data-testid="savedGame-view"]')).not.toBeNull();
  });

  it("view-g3 page renders SavedGame row", async () => {
    const c = document.createElement("div");
    await renderSavedGameDetailPages(c, { kind: "view-g3", typeId: "bingo", id: "sg-1" });
    expect(c.querySelector('[data-testid="savedGame-view"]')).not.toBeNull();
  });

  it("edit page renders form with prefilled name", async () => {
    const c = document.createElement("div");
    await renderSavedGameDetailPages(c, { kind: "edit", typeId: "bingo", id: "sg-1" });
    const name = c.querySelector<HTMLInputElement>("#sg-name");
    expect(name?.value).toBe("Template A");
  });
});

describe("ScheduleListPage (BIN-625 wired)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.clear();
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    installFetchEmpty();
  });

  it("renders title + Add link + no placeholder banner", async () => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderScheduleListPage(c);
    await flush();
    expect(c.querySelector("h1")?.textContent).toBeTruthy();
    const createLink = c.querySelector<HTMLAnchorElement>("#schedule-add-btn");
    expect(createLink?.getAttribute("href")).toBe("#/schedules/create");
    // Banner som refererte til BIN-625 skal ikke lenger være der.
    const bannerText = c.querySelector(".panel-body .alert")?.textContent ?? "";
    expect(bannerText).not.toContain("BIN-625");
  });
});

describe("Schedule detail pages (BIN-625 wired)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.clear();
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    installFetchEmpty();
  });

  it("view page fetches and renders detail tabell når rad finnes", async () => {
    const fn = vi.fn(async () =>
      successResponse({
        id: "sch-1",
        scheduleName: "Kveld",
        scheduleNumber: "SID_001",
        scheduleType: "Auto",
        luckyNumberPrize: 0,
        status: "active",
        isAdminSchedule: true,
        manualStartTime: "",
        manualEndTime: "",
        subGames: [],
        createdBy: null,
        createdAt: "2026-04-20T10:00:00Z",
        updatedAt: "2026-04-20T10:00:00Z",
      })
    );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderScheduleDetailPages(c, { kind: "view", id: "sch-1" });
    await flush();
    expect(c.textContent).toContain("Kveld");
    expect(c.textContent).toContain("sch-1");
  });

  it("view page shows 'not found' banner når backend returnerer 404", async () => {
    const fn = vi.fn(async () => jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "nope" } }, 404));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderScheduleDetailPages(c, { kind: "view", id: "missing" });
    await flush();
    expect(c.querySelector(".alert")?.textContent?.toLowerCase()).toContain("ikke");
  });
});

describe("DailySchedule list page (BIN-626 wired)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.clear();
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    installFetchEmpty();
  });

  it("renders title + add + special buttons (no placeholder banner)", async () => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderDailyScheduleListPage(c);
    await flush();
    expect(c.querySelector("#daily-schedule-add-btn")).not.toBeNull();
    expect(c.querySelector("#daily-schedule-special-btn")).not.toBeNull();
    const alertText = c.querySelector(".panel-body .alert")?.textContent ?? "";
    expect(alertText).not.toContain("BIN-626");
  });
});

describe("DailySchedule detail pages (BIN-626 wired)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.clear();
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    installFetchEmpty();
  });

  it("view kind delegerer til ListPage (ingen BIN-626 banner)", async () => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderDailyScheduleDetailPages(c, { kind: "view", typeId: "bingo", id: "x" });
    await flush();
    expect(c.querySelector("#daily-schedule-list-table")).not.toBeNull();
    const alertText = c.querySelector(".panel-body .alert")?.textContent ?? "";
    expect(alertText).not.toContain("BIN-626");
  });

  it("subgame-view henter data og rendrer tabell", async () => {
    const fn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/details")) {
        return successResponse({
          schedule: {
            id: "ds-1",
            name: "Testplan",
            gameManagementId: null,
            hallId: "hall-1",
            hallIds: {},
            weekDays: 1,
            day: null,
            startDate: "2026-04-22",
            endDate: null,
            startTime: "08:00",
            endTime: "20:00",
            status: "active",
            stopGame: false,
            specialGame: false,
            isSavedGame: false,
            isAdminSavedGame: false,
            innsatsenSales: 0,
            subgames: [],
            otherData: {},
            createdBy: null,
            createdAt: "2026-04-20T10:00:00Z",
            updatedAt: "2026-04-20T10:00:00Z",
          },
          subgames: [],
          gameManagement: null,
        });
      }
      return successResponse({});
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderDailyScheduleDetailPages(c, { kind: "subgame-view", id: "ds-1" });
    await flush();
    expect(c.textContent).toContain("Testplan");
  });
});

describe("games dispatcher — new routes recognised", () => {
  // savedGameList
  it("savedGameList routes", () => {
    expect(isGamesRoute("/savedGameList")).toBe(true);
    expect(isGamesRoute("/savedGameList/bingo/add")).toBe(true);
    expect(isGamesRoute("/savedGameList/bingo/view/sg-1")).toBe(true);
    expect(isGamesRoute("/savedGameList/bingo/view-g3/sg-1")).toBe(true);
    expect(isGamesRoute("/savedGameList/bingo/edit/sg-1")).toBe(true);
  });
  // schedules
  it("schedules routes", () => {
    expect(isGamesRoute("/schedules")).toBe(true);
    expect(isGamesRoute("/schedules/create")).toBe(true);
    expect(isGamesRoute("/schedules/view/sch-1")).toBe(true);
  });
  // dailySchedules
  it("dailySchedules routes", () => {
    expect(isGamesRoute("/dailySchedule/view")).toBe(true);
    expect(isGamesRoute("/dailySchedule/create/bingo")).toBe(true);
    expect(isGamesRoute("/dailySchedule/special/bingo")).toBe(true);
    expect(isGamesRoute("/dailySchedule/scheduleGame/sch-1")).toBe(true);
    expect(isGamesRoute("/dailySchedule/subgame/edit/sg-1")).toBe(true);
    expect(isGamesRoute("/dailySchedule/subgame/view/sg-1")).toBe(true);
  });
});
