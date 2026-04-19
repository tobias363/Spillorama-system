// Unit tests for SavedGame / Schedule / DailySchedule state modules (PR-A3b bolker 5–7).

import { describe, it, expect } from "vitest";
import {
  fetchSavedGameList,
  fetchSavedGame,
  saveSavedGame,
  deleteSavedGame,
} from "../../src/pages/games/savedGame/SavedGameState.js";
import {
  fetchScheduleList,
  fetchSchedule,
  saveSchedule,
  deleteSchedule,
} from "../../src/pages/games/schedules/ScheduleState.js";
import {
  fetchDailyScheduleList,
  fetchDailySchedule,
  saveDailySchedule,
  deleteDailySchedule,
  maskFromDays,
  daysFromMask,
  WEEKDAY_MASKS,
  WEEKDAY_MASK_ALL,
} from "../../src/pages/games/dailySchedules/DailyScheduleState.js";

describe("SavedGame (BIN-624 placeholders)", () => {
  it("fetchSavedGameList returns []", async () => {
    expect(await fetchSavedGameList()).toEqual([]);
  });
  it("fetchSavedGame returns null", async () => {
    expect(await fetchSavedGame("x")).toBeNull();
  });
  it("saveSavedGame resolves BIN-624 BACKEND_MISSING", async () => {
    expect(await saveSavedGame({ gameTypeId: "bingo", name: "x" })).toEqual({
      ok: false,
      reason: "BACKEND_MISSING",
      issue: "BIN-624",
    });
  });
  it("deleteSavedGame resolves BIN-624 BACKEND_MISSING", async () => {
    expect(await deleteSavedGame("x")).toEqual({
      ok: false,
      reason: "BACKEND_MISSING",
      issue: "BIN-624",
    });
  });
});

describe("Schedule (BIN-625 placeholders)", () => {
  it("fetchScheduleList returns []", async () => {
    expect(await fetchScheduleList()).toEqual([]);
  });
  it("fetchSchedule returns null", async () => {
    expect(await fetchSchedule("x")).toBeNull();
  });
  it("saveSchedule resolves BIN-625 BACKEND_MISSING", async () => {
    expect(
      await saveSchedule({ name: "x", startDate: "2026-01-01", hallGroupIds: [], subGames: [] })
    ).toEqual({ ok: false, reason: "BACKEND_MISSING", issue: "BIN-625" });
  });
  it("deleteSchedule resolves BIN-625 BACKEND_MISSING", async () => {
    expect(await deleteSchedule("x")).toEqual({
      ok: false,
      reason: "BACKEND_MISSING",
      issue: "BIN-625",
    });
  });
});

describe("DailySchedule (BIN-626 placeholders)", () => {
  it("fetchDailyScheduleList returns []", async () => {
    expect(await fetchDailyScheduleList()).toEqual([]);
  });
  it("fetchDailySchedule returns null", async () => {
    expect(await fetchDailySchedule("x")).toBeNull();
  });
  it("saveDailySchedule resolves BIN-626 BACKEND_MISSING", async () => {
    expect(
      await saveDailySchedule({
        hallId: "h",
        gameTypeId: "bingo",
        weekDays: 1,
        startTime: "08:00",
        endTime: "20:00",
      })
    ).toEqual({ ok: false, reason: "BACKEND_MISSING", issue: "BIN-626" });
  });
  it("deleteDailySchedule resolves BIN-626 BACKEND_MISSING", async () => {
    expect(await deleteDailySchedule("x")).toEqual({
      ok: false,
      reason: "BACKEND_MISSING",
      issue: "BIN-626",
    });
  });
});

describe("WeekDayMask encoding (BIN-626)", () => {
  it("constants match legacy spec: mon=1, tue=2, wed=4, thu=8, fri=16, sat=32, sun=64", () => {
    expect(WEEKDAY_MASKS).toEqual({
      mon: 1,
      tue: 2,
      wed: 4,
      thu: 8,
      fri: 16,
      sat: 32,
      sun: 64,
    });
    expect(WEEKDAY_MASK_ALL).toBe(127);
  });

  it("maskFromDays combines single day correctly", () => {
    expect(maskFromDays(["mon"])).toBe(1);
    expect(maskFromDays(["sun"])).toBe(64);
  });

  it("maskFromDays OR-combines multiple days", () => {
    expect(maskFromDays(["mon", "wed", "fri"])).toBe(1 | 4 | 16);
    expect(maskFromDays(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).toBe(127);
  });

  it("daysFromMask inverts maskFromDays", () => {
    const days = ["mon", "wed", "fri"] as const;
    const mask = maskFromDays([...days]);
    expect(daysFromMask(mask).sort()).toEqual([...days].sort());
  });

  it("daysFromMask handles zero mask", () => {
    expect(daysFromMask(0)).toEqual([]);
  });

  it("daysFromMask for ALL returns all 7 weekdays", () => {
    expect(daysFromMask(WEEKDAY_MASK_ALL).sort()).toEqual(
      ["fri", "mon", "sat", "sun", "thu", "tue", "wed"].sort()
    );
  });
});
