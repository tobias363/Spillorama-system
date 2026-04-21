// BIN-625 / BIN-626 / BIN-666: integration tests for Schedule + DailySchedule
// + HallGroup wiring i admin-web.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule as deleteScheduleApi,
} from "../../src/api/admin-schedules.js";
import {
  listDailySchedules,
  createDailySchedule,
  createSpecialDailySchedule,
  updateDailySchedule,
  deleteDailySchedule as deleteDailyScheduleApi,
} from "../../src/api/admin-daily-schedules.js";
import {
  listHallGroups,
  createHallGroup,
  updateHallGroup,
  deleteHallGroup as deleteHallGroupApi,
} from "../../src/api/admin-hall-groups.js";
import { openScheduleEditorModal } from "../../src/pages/games/schedules/ScheduleEditorModal.js";
import { openDailyScheduleEditorModal } from "../../src/pages/games/dailySchedules/DailyScheduleEditorModal.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successResponse<T>(data: T, status = 200): Response {
  return jsonResponse({ ok: status < 400, data }, status);
}

function errorResponse(code: string, message: string, status = 400): Response {
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

type FetchMock = ReturnType<typeof vi.fn>;
function installFetch(
  impl: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>
): FetchMock {
  const fn = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) =>
    impl(input, init)
  );
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

// ── BIN-625: admin-schedules API client ────────────────────────────────────

describe("BIN-625 admin-schedules API client", () => {
  it("listSchedules serialiserer query-filter", async () => {
    const fetchMock = installFetch(() => successResponse({ schedules: [], count: 0 }));
    await listSchedules({ type: "Auto", status: "active", search: "kv", limit: 10 });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("type=Auto");
    expect(url).toContain("status=active");
    expect(url).toContain("search=kv");
    expect(url).toContain("limit=10");
  });

  it("createSchedule POSTer payload", async () => {
    const fetchMock = installFetch(() =>
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
        createdAt: "",
        updatedAt: "",
      })
    );
    const row = await createSchedule({ scheduleName: "Kveld" });
    expect(row.id).toBe("sch-1");
    const call = fetchMock.mock.calls[0]!;
    expect((call[1] as RequestInit).method).toBe("POST");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.scheduleName).toBe("Kveld");
  });

  it("updateSchedule PATCHer :id", async () => {
    const fetchMock = installFetch(() =>
      successResponse({
        id: "sch-1",
        scheduleName: "Nytt navn",
        scheduleNumber: "SID_001",
        scheduleType: "Auto",
        luckyNumberPrize: 0,
        status: "active",
        isAdminSchedule: true,
        manualStartTime: "",
        manualEndTime: "",
        subGames: [],
        createdBy: null,
        createdAt: "",
        updatedAt: "",
      })
    );
    await updateSchedule("sch-1", { scheduleName: "Nytt navn" });
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toContain("/api/admin/schedules/sch-1");
    expect((call[1] as RequestInit).method).toBe("PATCH");
  });

  it("deleteSchedule med hard=true legger ved ?hard=true", async () => {
    const fetchMock = installFetch(() => successResponse({ softDeleted: false }));
    await deleteScheduleApi("sch-1", { hard: true });
    expect(fetchMock.mock.calls[0]![0]).toContain("?hard=true");
  });

  it("deleteSchedule uten hard gir soft-delete (ingen query-arg)", async () => {
    const fetchMock = installFetch(() => successResponse({ softDeleted: true }));
    await deleteScheduleApi("sch-1");
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/api/admin/schedules/sch-1");
    expect(url).not.toContain("hard=");
  });

  it("API-feil fra backend overflates som ApiError.message", async () => {
    installFetch(() => errorResponse("INVALID_INPUT", "Ugyldig felt", 400));
    await expect(createSchedule({ scheduleName: "" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      status: 400,
    });
  });
});

// ── BIN-626: admin-daily-schedules API client ──────────────────────────────

describe("BIN-626 admin-daily-schedules API client", () => {
  it("listDailySchedules serialiserer filter", async () => {
    const fetchMock = installFetch(() => successResponse({ schedules: [], count: 0 }));
    await listDailySchedules({
      hallId: "hall-1",
      status: "active",
      weekDays: 5,
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
      specialGame: false,
    });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("hallId=hall-1");
    expect(url).toContain("status=active");
    expect(url).toContain("weekDays=5");
    expect(url).toContain("fromDate=2026-04-01");
    expect(url).toContain("toDate=2026-04-30");
    expect(url).toContain("specialGame=false");
  });

  it("createDailySchedule POSTer payload", async () => {
    const fetchMock = installFetch(() =>
      successResponse({
        id: "ds-1",
        name: "Dagens",
        gameManagementId: null,
        hallId: "hall-1",
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
        createdAt: "",
        updatedAt: "",
      })
    );
    await createDailySchedule({ name: "Dagens", startDate: "2026-04-22", weekDays: 1 });
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toContain("/api/admin/daily-schedules");
    expect((call[1] as RequestInit).method).toBe("POST");
  });

  it("createSpecialDailySchedule POSTer /special", async () => {
    const fetchMock = installFetch(() =>
      successResponse({
        id: "ds-special",
        name: "Special",
        gameManagementId: null,
        hallId: null,
        hallIds: {},
        weekDays: 0,
        day: null,
        startDate: "2026-04-22",
        endDate: null,
        startTime: "",
        endTime: "",
        status: "active",
        stopGame: false,
        specialGame: true,
        isSavedGame: false,
        isAdminSavedGame: false,
        innsatsenSales: 0,
        subgames: [],
        otherData: {},
        createdBy: null,
        createdAt: "",
        updatedAt: "",
      })
    );
    await createSpecialDailySchedule({ name: "Special", startDate: "2026-04-22" });
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toContain("/api/admin/daily-schedules/special");
  });

  it("updateDailySchedule PATCHer :id", async () => {
    const fetchMock = installFetch(() =>
      successResponse({
        id: "ds-1",
        name: "Oppdatert",
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
        createdAt: "",
        updatedAt: "",
      })
    );
    await updateDailySchedule("ds-1", { name: "Oppdatert" });
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toContain("/api/admin/daily-schedules/ds-1");
    expect((call[1] as RequestInit).method).toBe("PATCH");
  });

  it("deleteDailySchedule kaller DELETE med id", async () => {
    const fetchMock = installFetch(() => successResponse({ softDeleted: true }));
    await deleteDailyScheduleApi("ds-1");
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toContain("/api/admin/daily-schedules/ds-1");
    expect((call[1] as RequestInit).method).toBe("DELETE");
  });
});

// ── BIN-666 / BIN-665: admin-hall-groups API client ────────────────────────

describe("BIN-666 admin-hall-groups API client", () => {
  it("listHallGroups GET /api/admin/hall-groups", async () => {
    const fetchMock = installFetch(() => successResponse({ groups: [], count: 0 }));
    await listHallGroups({ status: "active", search: "nord" });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/api/admin/hall-groups");
    expect(url).toContain("status=active");
    expect(url).toContain("search=nord");
  });

  it("createHallGroup POSTer payload", async () => {
    const fetchMock = installFetch(() =>
      successResponse({
        id: "hg-1",
        legacyGroupHallId: null,
        name: "Nord",
        status: "active",
        tvId: null,
        productIds: [],
        members: [],
        extra: {},
        createdBy: null,
        createdAt: "",
        updatedAt: "",
      })
    );
    const row = await createHallGroup({ name: "Nord", hallIds: ["hall-1"] });
    expect(row.id).toBe("hg-1");
    const call = fetchMock.mock.calls[0]!;
    expect((call[1] as RequestInit).method).toBe("POST");
  });

  it("updateHallGroup PATCHer :id", async () => {
    const fetchMock = installFetch(() =>
      successResponse({
        id: "hg-1",
        legacyGroupHallId: null,
        name: "Nordvest",
        status: "active",
        tvId: null,
        productIds: [],
        members: [],
        extra: {},
        createdBy: null,
        createdAt: "",
        updatedAt: "",
      })
    );
    await updateHallGroup("hg-1", { name: "Nordvest" });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("PATCH");
  });

  it("deleteHallGroup DELETEr :id", async () => {
    const fetchMock = installFetch(() => successResponse({ softDeleted: true }));
    await deleteHallGroupApi("hg-1");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("DELETE");
  });
});

// ── Editor-modaler ─────────────────────────────────────────────────────────

describe("ScheduleEditorModal (BIN-625)", () => {
  it("opprett-modus: POSTer når bruker fyller inn navn + klikker Opprett", async () => {
    const fetchMock = installFetch((_url, init) => {
      if (init && init.method === "POST") {
        const body = JSON.parse(init.body as string);
        return successResponse({
          id: "sch-new",
          scheduleName: body.scheduleName,
          scheduleNumber: "SID_X",
          scheduleType: body.scheduleType ?? "Auto",
          luckyNumberPrize: body.luckyNumberPrize ?? 0,
          status: body.status ?? "active",
          isAdminSchedule: true,
          manualStartTime: body.manualStartTime ?? "",
          manualEndTime: body.manualEndTime ?? "",
          subGames: body.subGames ?? [],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });
    const onSaved = vi.fn();
    await openScheduleEditorModal({ mode: "create", onSaved });
    await flush();
    const nameInput = document.querySelector<HTMLInputElement>("#sch-name");
    expect(nameInput).not.toBeNull();
    nameInput!.value = "Min nye mal";
    const confirmBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-footer button")
    ).find((b) => b.getAttribute("data-action") === "confirm");
    expect(confirmBtn).not.toBeUndefined();
    confirmBtn!.click();
    await flush();
    expect(fetchMock).toHaveBeenCalled();
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.scheduleName).toBe("Min nye mal");
    expect(onSaved).toHaveBeenCalled();
  });

  it("opprett-modus: viser feilmelding når navn mangler", async () => {
    installFetch(() => successResponse({}));
    const onSaved = vi.fn();
    await openScheduleEditorModal({ mode: "create", onSaved });
    await flush();
    const confirmBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-footer button")
    ).find((b) => b.getAttribute("data-action") === "confirm");
    confirmBtn!.click();
    await flush();
    const err = document.querySelector<HTMLElement>("#schedule-editor-error");
    expect(err).not.toBeNull();
    expect(err!.style.display).toBe("block");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("rediger-modus: fetcher eksisterende + PATCHer", async () => {
    const fetchMock = installFetch((url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "GET" && u.includes("/api/admin/schedules/sch-1")) {
        return successResponse({
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
          createdAt: "",
          updatedAt: "",
        });
      }
      if (method === "PATCH") {
        const body = JSON.parse((init as RequestInit).body as string);
        return successResponse({
          id: "sch-1",
          scheduleName: body.scheduleName,
          scheduleNumber: "SID_001",
          scheduleType: "Auto",
          luckyNumberPrize: 0,
          status: "active",
          isAdminSchedule: true,
          manualStartTime: "",
          manualEndTime: "",
          subGames: [],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });
    const onSaved = vi.fn();
    await openScheduleEditorModal({ mode: "edit", scheduleId: "sch-1", onSaved });
    await flush();
    const nameInput = document.querySelector<HTMLInputElement>("#sch-name");
    expect(nameInput?.value).toBe("Kveld");
    nameInput!.value = "Morgen";
    const confirmBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-footer button")
    ).find((b) => b.getAttribute("data-action") === "confirm");
    confirmBtn!.click();
    await flush();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")).toBe(true);
    expect(onSaved).toHaveBeenCalled();
  });
});

describe("DailyScheduleEditorModal (BIN-626)", () => {
  it("opprett-modus: POSTer til /api/admin/daily-schedules", async () => {
    const fetchMock = installFetch((_url, init) => {
      if (init && init.method === "POST") {
        const body = JSON.parse(init.body as string);
        return successResponse({
          id: "ds-new",
          name: body.name,
          gameManagementId: body.gameManagementId ?? null,
          hallId: body.hallId ?? null,
          hallIds: body.hallIds ?? {},
          weekDays: body.weekDays ?? 0,
          day: body.day ?? null,
          startDate: body.startDate,
          endDate: body.endDate ?? null,
          startTime: body.startTime ?? "",
          endTime: body.endTime ?? "",
          status: body.status ?? "active",
          stopGame: body.stopGame ?? false,
          specialGame: body.specialGame ?? false,
          isSavedGame: false,
          isAdminSavedGame: false,
          innsatsenSales: 0,
          subgames: body.subgames ?? [],
          otherData: body.otherData ?? {},
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });
    const onSaved = vi.fn();
    await openDailyScheduleEditorModal({ mode: "create", onSaved });
    await flush();
    const nameInput = document.querySelector<HTMLInputElement>("#ds-name");
    expect(nameInput).not.toBeNull();
    nameInput!.value = "Ny plan";
    const monCheck = document.querySelector<HTMLInputElement>("#ds-wd-mon");
    expect(monCheck).not.toBeNull();
    monCheck!.checked = true;
    const confirmBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-footer button")
    ).find((b) => b.getAttribute("data-action") === "confirm");
    confirmBtn!.click();
    await flush();
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.name).toBe("Ny plan");
    expect(body.weekDays).toBe(1); // mon=1
    expect(onSaved).toHaveBeenCalled();
  });

  it("special-modus: POSTer til /api/admin/daily-schedules/special", async () => {
    const fetchMock = installFetch((_url, init) => {
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "POST") {
        return successResponse({
          id: "ds-special",
          name: "Special",
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
          specialGame: true,
          isSavedGame: false,
          isAdminSavedGame: false,
          innsatsenSales: 0,
          subgames: [],
          otherData: {},
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });
    const onSaved = vi.fn();
    await openDailyScheduleEditorModal({ mode: "special", onSaved });
    await flush();
    const nameInput = document.querySelector<HTMLInputElement>("#ds-name");
    nameInput!.value = "Special";
    const monCheck = document.querySelector<HTMLInputElement>("#ds-wd-mon");
    monCheck!.checked = true;
    const confirmBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-footer button")
    ).find((b) => b.getAttribute("data-action") === "confirm");
    confirmBtn!.click();
    await flush();
    const postCall = fetchMock.mock.calls.find((c) => {
      const url = String(c[0]);
      return url.includes("/api/admin/daily-schedules/special");
    });
    expect(postCall).toBeTruthy();
    expect(onSaved).toHaveBeenCalled();
  });

  it("validerer at minst én ukedag eller enkelt-dag er valgt", async () => {
    installFetch(() => successResponse({}));
    const onSaved = vi.fn();
    await openDailyScheduleEditorModal({ mode: "create", onSaved });
    await flush();
    const nameInput = document.querySelector<HTMLInputElement>("#ds-name");
    nameInput!.value = "Uten dag";
    const confirmBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-footer button")
    ).find((b) => b.getAttribute("data-action") === "confirm");
    confirmBtn!.click();
    await flush();
    const err = document.querySelector<HTMLElement>("#ds-editor-error");
    expect(err).not.toBeNull();
    expect(err!.style.display).toBe("block");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
