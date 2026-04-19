// Render + dispatcher tests for SavedGame / Schedule / DailySchedule pages
// (PR-A3b bolker 5–7).

import { describe, it, expect, beforeEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderSavedGameListPage } from "../../src/pages/games/savedGame/SavedGameListPage.js";
import { renderSavedGameDetailPages } from "../../src/pages/games/savedGame/SavedGameDetailPages.js";
import { renderScheduleListPage } from "../../src/pages/games/schedules/ScheduleListPage.js";
import { renderScheduleDetailPages } from "../../src/pages/games/schedules/ScheduleDetailPages.js";
import { renderDailyScheduleDetailPages } from "../../src/pages/games/dailySchedules/DailyScheduleDetailPages.js";
import { isGamesRoute } from "../../src/pages/games/index.js";

describe("SavedGameListPage (BIN-624 placeholder)", () => {
  beforeEach(() => initI18n());

  it("renders title + BIN-624 banner + disabled Add", async () => {
    const c = document.createElement("div");
    await renderSavedGameListPage(c);
    expect(c.querySelector("h1")?.textContent).toBeTruthy();
    expect(c.querySelector(".panel-body .alert")?.textContent).toContain("BIN-624");
    const btn = c.querySelector("button[disabled]");
    expect(btn?.getAttribute("title")).toContain("BIN-624");
  });

  it("mounts the empty DataTable", async () => {
    const c = document.createElement("div");
    await renderSavedGameListPage(c);
    expect(c.querySelector("#saved-game-list-table")).not.toBeNull();
  });
});

describe("SavedGame detail pages (BIN-624)", () => {
  beforeEach(() => initI18n());
  for (const kind of ["add", "view", "view-g3", "edit"] as const) {
    it(`${kind} page renders BIN-624 banner`, async () => {
      const c = document.createElement("div");
      await renderSavedGameDetailPages(c, { kind, typeId: "bingo", id: kind === "add" ? undefined : "sg-1" });
      expect(c.querySelector(".alert")?.textContent).toContain("BIN-624");
    });
  }
});

describe("ScheduleListPage (BIN-625 placeholder)", () => {
  beforeEach(() => initI18n());
  it("renders title + BIN-625 banner + enabled Create link (to /schedules/create)", async () => {
    const c = document.createElement("div");
    await renderScheduleListPage(c);
    expect(c.querySelector("h1")?.textContent).toBeTruthy();
    expect(c.querySelector(".panel-body .alert")?.textContent).toContain("BIN-625");
    const createLink = c.querySelector<HTMLAnchorElement>("a.btn-primary");
    expect(createLink?.getAttribute("href")).toBe("#/schedules/create");
  });
});

describe("Schedule detail pages (BIN-625)", () => {
  beforeEach(() => initI18n());
  it("create page renders BIN-625 banner with 5382-linjer hint", async () => {
    const c = document.createElement("div");
    await renderScheduleDetailPages(c, { kind: "create" });
    expect(c.querySelector(".alert")?.textContent).toContain("BIN-625");
    expect(c.querySelector(".alert small")?.textContent).toContain("5 382");
  });
  it("view page renders BIN-625 banner with id", async () => {
    const c = document.createElement("div");
    await renderScheduleDetailPages(c, { kind: "view", id: "sch-1" });
    expect(c.querySelector(".alert")?.textContent).toContain("BIN-625");
    expect(c.textContent).toContain("sch-1");
  });
});

describe("DailySchedule detail pages (BIN-626)", () => {
  beforeEach(() => initI18n());
  const kinds = ["view", "create", "special", "scheduleGame", "subgame-edit", "subgame-view"] as const;
  for (const kind of kinds) {
    it(`${kind} page renders BIN-626 banner`, async () => {
      const c = document.createElement("div");
      await renderDailyScheduleDetailPages(c, { kind, typeId: "bingo", id: "x" });
      expect(c.querySelector(".alert")?.textContent).toContain("BIN-626");
    });
  }
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
