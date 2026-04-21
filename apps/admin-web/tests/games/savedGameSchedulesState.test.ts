// Unit tests for SavedGame / Schedule / DailySchedule state modules (PR-A3b bolker 5–7).
//
// BIN-625/626 wiring: Schedule + DailySchedule state delegates to
// /api/admin/schedules and /api/admin/daily-schedules. These tests cover the
// helper utilities (weekday bitmask) and verify that the state modules
// call the API wrappers as expected via fetch-mock.

import { describe, it, expect, beforeEach, vi } from "vitest";
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successResponse<T>(data: T, status = 200): Response {
  return jsonResponse({ ok: status < 400, data }, status);
}

type FetchMock = ReturnType<typeof vi.fn>;
function installFetch(impl: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>): FetchMock {
  const fn = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => impl(input, init));
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

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

describe("Schedule state (BIN-625 wired)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("fetchScheduleList calls GET /api/admin/schedules and flattens schedules[]", async () => {
    const fetchMock = installFetch(() =>
      successResponse({
        schedules: [
          {
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
          },
        ],
        count: 1,
      })
    );
    const rows = await fetchScheduleList();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/api/admin/schedules");
    expect(rows).toHaveLength(1);
    expect(rows[0]!._id).toBe("sch-1");
    expect(rows[0]!.scheduleName).toBe("Kveld");
  });

  it("fetchSchedule returns null when backend returns 404", async () => {
    installFetch(() => jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }, 404));
    const row = await fetchSchedule("x");
    expect(row).toBeNull();
  });

  it("saveSchedule POSTs on create and PATCHes on update", async () => {
    const createResp = {
      id: "sch-new",
      scheduleName: "Morgen",
      scheduleNumber: "SID_002",
      scheduleType: "Manual",
      luckyNumberPrize: 100,
      status: "active",
      isAdminSchedule: true,
      manualStartTime: "08:00",
      manualEndTime: "10:00",
      subGames: [],
      createdBy: null,
      createdAt: "2026-04-20T10:00:00Z",
      updatedAt: "2026-04-20T10:00:00Z",
    };
    const fetchMock = installFetch((_url, init) => successResponse({ ...createResp, scheduleName: (JSON.parse(init?.body as string) as any).scheduleName }));

    const rowCreate = await saveSchedule({ scheduleName: "Morgen" });
    expect(rowCreate._id).toBe("sch-new");
    const createCall = fetchMock.mock.calls[0]!;
    expect((createCall[1] as RequestInit).method).toBe("POST");

    const rowUpdate = await saveSchedule({ scheduleName: "Kveld" }, "sch-new");
    const updateCall = fetchMock.mock.calls[1]!;
    expect((updateCall[1] as RequestInit).method).toBe("PATCH");
    expect(rowUpdate.scheduleName).toBe("Kveld");
  });

  it("deleteSchedule calls DELETE /api/admin/schedules/:id", async () => {
    const fetchMock = installFetch(() => successResponse({ softDeleted: true }));
    const res = await deleteSchedule("sch-1");
    expect(res.softDeleted).toBe(true);
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toContain("/api/admin/schedules/sch-1");
    expect((call[1] as RequestInit).method).toBe("DELETE");
  });

  it("deleteSchedule with hard=true sends ?hard=true", async () => {
    const fetchMock = installFetch(() => successResponse({ softDeleted: false }));
    await deleteSchedule("sch-1", { hard: true });
    expect(fetchMock.mock.calls[0]![0]).toContain("?hard=true");
  });
});

describe("DailySchedule state (BIN-626 wired)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("fetchDailyScheduleList calls GET /api/admin/daily-schedules", async () => {
    const fetchMock = installFetch(() =>
      successResponse({
        schedules: [
          {
            id: "ds-1",
            name: "Dagens",
            gameManagementId: null,
            hallId: "hall-1",
            hallIds: {},
            weekDays: 1,
            day: null,
            startDate: "2026-04-20",
            endDate: null,
            startTime: "",
            endTime: "",
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
        ],
        count: 1,
      })
    );
    const rows = await fetchDailyScheduleList();
    expect(fetchMock.mock.calls[0]![0]).toContain("/api/admin/daily-schedules");
    expect(rows).toHaveLength(1);
    expect(rows[0]!._id).toBe("ds-1");
    expect(rows[0]!.name).toBe("Dagens");
  });

  it("fetchDailySchedule returns null on 404", async () => {
    installFetch(() => jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }, 404));
    expect(await fetchDailySchedule("x")).toBeNull();
  });

  it("saveDailySchedule POSTs on create and PATCHes on update", async () => {
    const baseRow = {
      id: "ds-new",
      name: "Dagens",
      gameManagementId: null,
      hallId: null,
      hallIds: {},
      weekDays: 1,
      day: null,
      startDate: "2026-04-22",
      endDate: null,
      startTime: "",
      endTime: "",
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
    };
    const fetchMock = installFetch(() => successResponse(baseRow));
    const created = await saveDailySchedule({
      name: "Dagens",
      startDate: "2026-04-22",
      startTime: "08:00",
      endTime: "20:00",
      weekDays: 1,
    });
    expect(created._id).toBe("ds-new");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");

    await saveDailySchedule({ name: "Oppdatert", startDate: "2026-04-22" }, "ds-new");
    expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe("PATCH");
  });

  it("deleteDailySchedule calls DELETE /api/admin/daily-schedules/:id", async () => {
    const fetchMock = installFetch(() => successResponse({ softDeleted: true }));
    const res = await deleteDailySchedule("ds-1");
    expect(res.softDeleted).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toContain("/api/admin/daily-schedules/ds-1");
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
