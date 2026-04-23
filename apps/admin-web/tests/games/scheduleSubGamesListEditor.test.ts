// fix/schedule-structured-subgames (2026-04-23): tester for strukturert
// sub-games editor i ScheduleEditorModal.
//
// Dekker:
//   1. Tom state viser Add-knapp + hint
//   2. Add-rad legger til ny rad med tom state
//   3. Fylle ut felter + submit → POSTer samme JSON-shape som backend
//      forventer (ScheduleService.assertSubgames)
//   4. Fjern-rad (× knapp) sletter den valgte raden
//   5. Round-trip: edit-mode henter eksisterende subGames og vises i
//      listen med riktige verdier
//   6. Validering: ugyldig HH:MM i startTime → feilmelding, ikke POST
//   7. "Vis JSON" toggle: bytter til textarea med serialisert JSON,
//      bytter tilbake parser JSON og populerer listen
//   8. JSON-fallback: eksisterende "Sett inn eksempel" + "Valider JSON"
//      funksjoner jobber fortsatt i JSON-modus
//
// Mønstret etter tests/games/schedulesAdminWire.test.ts sin fetch-mock-stil.
//
// Kjernen i bakover-kompat: backend-kontrakten er uendret — samme
// JSON-array-shape sendes i POST/PATCH som før (verifisert ved å
// inspisere body.subGames i mocked fetch).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { openScheduleEditorModal } from "../../src/pages/games/schedules/ScheduleEditorModal.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successResponse<T>(data: T, status = 200): Response {
  return jsonResponse({ ok: status < 400, data }, status);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

type FetchMock = ReturnType<typeof vi.fn>;
function installFetch(
  impl: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>
): FetchMock {
  const fn = vi
    .fn()
    .mockImplementation(async (input: string | URL | Request, init?: RequestInit) =>
      impl(input, init)
    );
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

function getConfirmButton(): HTMLButtonElement {
  const btn = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".modal-footer button")
  ).find((b) => b.getAttribute("data-action") === "confirm");
  if (!btn) throw new Error("Confirm button not found");
  return btn;
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

describe("SubGamesListEditor (fix/schedule-structured-subgames)", () => {
  it("tom state: viser hint + Add-knapp, ingen rader", async () => {
    installFetch(() => successResponse({}));
    await openScheduleEditorModal({ mode: "create" });
    await flush();

    const listHost = document.querySelector<HTMLElement>("#sch-subgames-list");
    expect(listHost).not.toBeNull();

    const emptyHint = document.querySelector<HTMLElement>("#sch-subgames-empty");
    expect(emptyHint).not.toBeNull();

    // Ingen rader enda
    const rows = document.querySelectorAll<HTMLElement>(".sg-row");
    expect(rows.length).toBe(0);

    // Add-knapp finnes i listen-host
    const addBtn = listHost!.querySelector<HTMLButtonElement>(
      '[data-sg-action="add"]'
    );
    expect(addBtn).not.toBeNull();
  });

  it("klikk Add → ny rad vises med tomme felt", async () => {
    installFetch(() => successResponse({}));
    await openScheduleEditorModal({ mode: "create" });
    await flush();

    const listHost = document.querySelector<HTMLElement>("#sch-subgames-list")!;
    const addBtn = listHost.querySelector<HTMLButtonElement>(
      '[data-sg-action="add"]'
    )!;
    addBtn.click();
    await flush();

    const rows = document.querySelectorAll<HTMLElement>(".sg-row");
    expect(rows.length).toBe(1);

    // Rad skal ha tomme kjerne-felt
    const nameInput = rows[0]!.querySelector<HTMLInputElement>(
      '[data-sg-field="name"]'
    );
    expect(nameInput).not.toBeNull();
    expect(nameInput!.value).toBe("");

    const startInput = rows[0]!.querySelector<HTMLInputElement>(
      '[data-sg-field="startTime"]'
    );
    expect(startInput).not.toBeNull();
    expect(startInput!.value).toBe("");
  });

  it("legger til rad, fyller felt, og submit POSTer strukturert subGames-array", async () => {
    const fetchMock = installFetch((_url, init) => {
      if (init && init.method === "POST") {
        const body = JSON.parse(init.body as string);
        return successResponse({
          id: "sch-new",
          scheduleName: body.scheduleName,
          scheduleNumber: "SID_X",
          scheduleType: body.scheduleType ?? "Auto",
          luckyNumberPrize: 0,
          status: "active",
          isAdminSchedule: true,
          manualStartTime: "",
          manualEndTime: "",
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

    document.querySelector<HTMLInputElement>("#sch-name")!.value = "Pilot-kveld";

    // Legg til 2 rader
    const listHost = document.querySelector<HTMLElement>("#sch-subgames-list")!;
    const addBtn = listHost.querySelector<HTMLButtonElement>(
      '[data-sg-action="add"]'
    )!;
    addBtn.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    const rows = document.querySelectorAll<HTMLElement>(".sg-row");
    expect(rows.length).toBe(2);

    // Rad 1
    const r1Name = rows[0]!.querySelector<HTMLInputElement>('[data-sg-field="name"]')!;
    r1Name.value = "Spill 1";
    r1Name.dispatchEvent(new Event("input"));
    const r1Start = rows[0]!.querySelector<HTMLInputElement>(
      '[data-sg-field="startTime"]'
    )!;
    r1Start.value = "10:00";
    r1Start.dispatchEvent(new Event("input"));
    const r1End = rows[0]!.querySelector<HTMLInputElement>(
      '[data-sg-field="endTime"]'
    )!;
    r1End.value = "11:00";
    r1End.dispatchEvent(new Event("input"));

    // Rad 2
    const r2Name = rows[1]!.querySelector<HTMLInputElement>('[data-sg-field="name"]')!;
    r2Name.value = "Spill 2";
    r2Name.dispatchEvent(new Event("input"));
    const r2Start = rows[1]!.querySelector<HTMLInputElement>(
      '[data-sg-field="startTime"]'
    )!;
    r2Start.value = "11:30";
    r2Start.dispatchEvent(new Event("input"));

    getConfirmButton().click();
    await flush();

    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.subGames).toBeDefined();
    expect(Array.isArray(body.subGames)).toBe(true);
    expect(body.subGames.length).toBe(2);
    expect(body.subGames[0]).toMatchObject({
      name: "Spill 1",
      startTime: "10:00",
      endTime: "11:00",
    });
    expect(body.subGames[1]).toMatchObject({
      name: "Spill 2",
      startTime: "11:30",
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("fjern-knapp sletter valgt rad", async () => {
    installFetch(() => successResponse({}));
    await openScheduleEditorModal({ mode: "create" });
    await flush();

    // Legg til 2 rader
    const addBtn = document.querySelector<HTMLButtonElement>(
      '[data-sg-action="add"]'
    )!;
    addBtn.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    expect(document.querySelectorAll(".sg-row").length).toBe(2);

    // Fyll navn i rad 1 så vi kan identifisere den
    const rows = document.querySelectorAll<HTMLElement>(".sg-row");
    const r1Name = rows[0]!.querySelector<HTMLInputElement>('[data-sg-field="name"]')!;
    r1Name.value = "Beholdes";
    r1Name.dispatchEvent(new Event("input"));

    // Fjern rad 2 (index 1)
    const removeBtn2 = rows[1]!.querySelector<HTMLButtonElement>(
      '[data-sg-action="remove"]'
    )!;
    removeBtn2.click();
    await flush();

    const remaining = document.querySelectorAll<HTMLElement>(".sg-row");
    expect(remaining.length).toBe(1);
    const surviving = remaining[0]!.querySelector<HTMLInputElement>(
      '[data-sg-field="name"]'
    )!;
    expect(surviving.value).toBe("Beholdes");
  });

  it("edit-modus: pre-fyller rader fra eksisterende subGames", async () => {
    installFetch((url, init) => {
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
          subGames: [
            {
              name: "Første",
              startTime: "10:00",
              endTime: "10:30",
              minseconds: 5,
            },
            {
              name: "Andre",
              startTime: "10:45",
              endTime: "11:15",
            },
          ],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });

    await openScheduleEditorModal({ mode: "edit", scheduleId: "sch-1" });
    await flush();

    const rows = document.querySelectorAll<HTMLElement>(".sg-row");
    expect(rows.length).toBe(2);

    const r1Name = rows[0]!.querySelector<HTMLInputElement>('[data-sg-field="name"]')!;
    expect(r1Name.value).toBe("Første");
    const r1Start = rows[0]!.querySelector<HTMLInputElement>(
      '[data-sg-field="startTime"]'
    )!;
    expect(r1Start.value).toBe("10:00");
    const r1Min = rows[0]!.querySelector<HTMLInputElement>(
      '[data-sg-field="minseconds"]'
    )!;
    expect(r1Min.value).toBe("5");

    const r2Name = rows[1]!.querySelector<HTMLInputElement>('[data-sg-field="name"]')!;
    expect(r2Name.value).toBe("Andre");
  });

  it("ugyldig HH:MM i startTime → feilmelding og ingen POST", async () => {
    const fetchMock = installFetch(() => successResponse({}));
    const onSaved = vi.fn();
    await openScheduleEditorModal({ mode: "create", onSaved });
    await flush();

    document.querySelector<HTMLInputElement>("#sch-name")!.value = "Ugyldig tid";

    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    const row = document.querySelector<HTMLElement>(".sg-row")!;
    const startInput = row.querySelector<HTMLInputElement>(
      '[data-sg-field="startTime"]'
    )!;
    startInput.value = "bad-time";
    startInput.dispatchEvent(new Event("input"));

    getConfirmButton().click();
    await flush();

    const err = document.querySelector<HTMLElement>("#schedule-editor-error");
    expect(err).not.toBeNull();
    expect(err!.style.display).toBe("block");
    expect(err!.textContent).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      )
    ).toBe(false);
  });

  it("advanced JSON-felt (ticketTypesData) lagres som objekt i POST", async () => {
    const fetchMock = installFetch((_url, init) => {
      if (init && init.method === "POST") {
        const body = JSON.parse(init.body as string);
        return successResponse({
          id: "sch-new",
          scheduleName: body.scheduleName,
          scheduleNumber: "SID_X",
          scheduleType: "Auto",
          luckyNumberPrize: 0,
          status: "active",
          isAdminSchedule: true,
          manualStartTime: "",
          manualEndTime: "",
          subGames: body.subGames ?? [],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });

    await openScheduleEditorModal({ mode: "create" });
    await flush();

    document.querySelector<HTMLInputElement>("#sch-name")!.value = "Med billetter";

    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    const row = document.querySelector<HTMLElement>(".sg-row")!;
    const ttField = row.querySelector<HTMLTextAreaElement>(
      '[data-sg-field="ticketTypesDataJson"]'
    )!;
    ttField.value = '{"rod":{"price":30}}';
    ttField.dispatchEvent(new Event("input"));

    getConfirmButton().click();
    await flush();

    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.subGames[0].ticketTypesData).toEqual({ rod: { price: 30 } });
  });

  it("Vis JSON toggle: bytter til JSON-textarea med serialisert innhold", async () => {
    installFetch(() => successResponse({}));
    await openScheduleEditorModal({ mode: "create" });
    await flush();

    // Legg til rad + navn
    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();
    const nameInput = document.querySelector<HTMLInputElement>(
      '[data-sg-field="name"]'
    )!;
    nameInput.value = "Serialiser meg";
    nameInput.dispatchEvent(new Event("input"));

    // Sjekk start-visibility
    const listPanel = document.querySelector<HTMLElement>(
      "#sch-subgames-list-panel"
    )!;
    const jsonPanel = document.querySelector<HTMLElement>(
      "#sch-subgames-json-panel"
    )!;
    expect(listPanel.style.display).toBe("block");
    expect(jsonPanel.style.display).toBe("none");

    // Toggle → JSON
    const toggleBtn = document.querySelector<HTMLButtonElement>(
      "#sch-subgames-toggle"
    )!;
    toggleBtn.click();
    await flush();

    expect(listPanel.style.display).toBe("none");
    expect(jsonPanel.style.display).toBe("block");

    const textarea = document.querySelector<HTMLTextAreaElement>("#sch-subgames")!;
    const parsed = JSON.parse(textarea.value);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe("Serialiser meg");
  });

  it("Vis liste toggle: parser JSON tilbake og re-populerer rader", async () => {
    installFetch(() => successResponse({}));
    await openScheduleEditorModal({ mode: "create" });
    await flush();

    // Bytt til JSON-modus direkte og skriv manuell JSON
    document
      .querySelector<HTMLButtonElement>("#sch-subgames-toggle")!
      .click();
    await flush();

    const textarea = document.querySelector<HTMLTextAreaElement>("#sch-subgames")!;
    textarea.value = JSON.stringify([
      { name: "Fra JSON", startTime: "09:00", endTime: "09:30" },
    ]);

    // Toggle tilbake → liste
    document
      .querySelector<HTMLButtonElement>("#sch-subgames-toggle")!
      .click();
    await flush();

    const rows = document.querySelectorAll<HTMLElement>(".sg-row");
    expect(rows.length).toBe(1);
    const nameInput = rows[0]!.querySelector<HTMLInputElement>(
      '[data-sg-field="name"]'
    )!;
    expect(nameInput.value).toBe("Fra JSON");
    const startInput = rows[0]!.querySelector<HTMLInputElement>(
      '[data-sg-field="startTime"]'
    )!;
    expect(startInput.value).toBe("09:00");
  });

  it("Vis liste toggle: ugyldig JSON viser feil og beholder JSON-modus", async () => {
    installFetch(() => successResponse({}));
    await openScheduleEditorModal({ mode: "create" });
    await flush();

    // Bytt til JSON-modus
    document
      .querySelector<HTMLButtonElement>("#sch-subgames-toggle")!
      .click();
    await flush();

    const textarea = document.querySelector<HTMLTextAreaElement>("#sch-subgames")!;
    textarea.value = "{ugyldig";

    // Prøv å bytte tilbake til liste — skal feile
    document
      .querySelector<HTMLButtonElement>("#sch-subgames-toggle")!
      .click();
    await flush();

    const jsonPanel = document.querySelector<HTMLElement>(
      "#sch-subgames-json-panel"
    )!;
    // Skal fortsatt være i JSON-modus
    expect(jsonPanel.style.display).toBe("block");

    const status = document.querySelector<HTMLElement>("#sch-subgames-status");
    expect(status).not.toBeNull();
    expect(status!.style.display).toBe("block");
  });

  // ── feat/schedule-8-colors-mystery (2026-04-23): 9 farger + Mystery ─────

  it("8-colors: type-select default STANDARD viser farge-fieldset med 9 farger", async () => {
    installFetch(() => successResponse({}));
    await openScheduleEditorModal({ mode: "create" });
    await flush();

    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    const row = document.querySelector<HTMLElement>(".sg-row")!;
    const typeSelect = row.querySelector<HTMLSelectElement>(
      '[data-sg-field="subGameType"]'
    );
    expect(typeSelect).not.toBeNull();
    expect(typeSelect!.value).toBe("STANDARD");

    const colorCheckboxes = row.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"][data-sg-color]:not([data-sg-color-field])'
    );
    expect(colorCheckboxes.length).toBe(9);
    const codes = Array.from(colorCheckboxes).map(
      (cb) => cb.getAttribute("data-sg-color") ?? ""
    );
    expect(codes).toEqual([
      "SMALL_YELLOW",
      "LARGE_YELLOW",
      "SMALL_WHITE",
      "LARGE_WHITE",
      "SMALL_PURPLE",
      "LARGE_PURPLE",
      "RED",
      "GREEN",
      "BLUE",
    ]);
  });

  it("8-colors: velge farge viser per-color pris-input; POST inneholder rowPrizesByColor", async () => {
    const fetchMock = installFetch((_url, init) => {
      if (init && init.method === "POST") {
        const body = JSON.parse(init.body as string);
        return successResponse({
          id: "sch-new",
          scheduleName: body.scheduleName,
          scheduleNumber: "SID_X",
          scheduleType: "Auto",
          luckyNumberPrize: 0,
          status: "active",
          isAdminSchedule: true,
          manualStartTime: "",
          manualEndTime: "",
          subGames: body.subGames ?? [],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });

    await openScheduleEditorModal({ mode: "create" });
    await flush();

    document.querySelector<HTMLInputElement>("#sch-name")!.value = "Med farger";

    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    // Huk av Small Yellow og Red.
    const syCb = document.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-sg-color="SMALL_YELLOW"]'
    )!;
    syCb.checked = true;
    syCb.dispatchEvent(new Event("change"));
    await flush();

    const redCb = document.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-sg-color="RED"]'
    )!;
    redCb.checked = true;
    redCb.dispatchEvent(new Event("change"));
    await flush();

    // Per-color pris-input skal nå vises for disse to.
    const syTicketPrice = document.querySelector<HTMLInputElement>(
      'input[data-sg-color="SMALL_YELLOW"][data-sg-color-field="ticketPrice"]'
    );
    expect(syTicketPrice).not.toBeNull();
    syTicketPrice!.value = "30";
    syTicketPrice!.dispatchEvent(new Event("input"));

    const syFullHouse = document.querySelector<HTMLInputElement>(
      'input[data-sg-color="SMALL_YELLOW"][data-sg-color-field="fullHouse"]'
    )!;
    syFullHouse.value = "200";
    syFullHouse.dispatchEvent(new Event("input"));

    const redTicketPrice = document.querySelector<HTMLInputElement>(
      'input[data-sg-color="RED"][data-sg-color-field="ticketPrice"]'
    )!;
    redTicketPrice.value = "50";
    redTicketPrice.dispatchEvent(new Event("input"));

    getConfirmButton().click();
    await flush();

    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.subGames[0].subGameType).toBe("STANDARD");
    expect(body.subGames[0].extra.rowPrizesByColor).toEqual({
      SMALL_YELLOW: { ticketPrice: 30, fullHouse: 200 },
      RED: { ticketPrice: 50 },
    });
  });

  it("8-colors: Mystery-type viser price-options felt; POST inneholder mysteryConfig", async () => {
    const fetchMock = installFetch((_url, init) => {
      if (init && init.method === "POST") {
        const body = JSON.parse(init.body as string);
        return successResponse({
          id: "sch-new",
          scheduleName: body.scheduleName,
          scheduleNumber: "SID_X",
          scheduleType: "Auto",
          luckyNumberPrize: 0,
          status: "active",
          isAdminSchedule: true,
          manualStartTime: "",
          manualEndTime: "",
          subGames: body.subGames ?? [],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });

    await openScheduleEditorModal({ mode: "create" });
    await flush();

    document.querySelector<HTMLInputElement>("#sch-name")!.value = "Mystery-kveld";

    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    // Bytt til Mystery
    const typeSelect = document.querySelector<HTMLSelectElement>(
      '[data-sg-field="subGameType"]'
    )!;
    typeSelect.value = "MYSTERY";
    typeSelect.dispatchEvent(new Event("change"));
    await flush();

    // Mystery-fieldset erstatter farge-fieldset.
    expect(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-sg-color]'
      ).length
    ).toBe(0);

    const priceInput = document.querySelector<HTMLInputElement>(
      '[data-sg-field="mysteryPriceOptions"]'
    )!;
    priceInput.value = "1000,1500,2000,2500,3000,4000";
    priceInput.dispatchEvent(new Event("input"));

    const doublesCb = document.querySelector<HTMLInputElement>(
      '[data-sg-field="mysteryYellowDoubles"]'
    )!;
    doublesCb.checked = true;
    doublesCb.dispatchEvent(new Event("change"));

    getConfirmButton().click();
    await flush();

    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.subGames[0].subGameType).toBe("MYSTERY");
    expect(body.subGames[0].extra.mysteryConfig).toEqual({
      priceOptions: [1000, 1500, 2000, 2500, 3000, 4000],
      yellowDoubles: true,
    });
  });

  it("8-colors: Mystery uten priceOptions → feilmelding og ingen POST", async () => {
    const fetchMock = installFetch(() => successResponse({}));
    await openScheduleEditorModal({ mode: "create" });
    await flush();

    document.querySelector<HTMLInputElement>("#sch-name")!.value = "Bad mystery";

    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    const typeSelect = document.querySelector<HTMLSelectElement>(
      '[data-sg-field="subGameType"]'
    )!;
    typeSelect.value = "MYSTERY";
    typeSelect.dispatchEvent(new Event("change"));
    await flush();

    getConfirmButton().click();
    await flush();

    const err = document.querySelector<HTMLElement>("#schedule-editor-error");
    expect(err).not.toBeNull();
    expect(err!.style.display).toBe("block");
    expect(
      fetchMock.mock.calls.some(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      )
    ).toBe(false);
  });

  it("8-colors: edit-modus round-trip henter rowPrizesByColor + subGameType", async () => {
    installFetch((url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "GET" && u.includes("/api/admin/schedules/sch-rt")) {
        return successResponse({
          id: "sch-rt",
          scheduleName: "Round-trip",
          scheduleNumber: "SID_RT",
          scheduleType: "Auto",
          luckyNumberPrize: 0,
          status: "active",
          isAdminSchedule: true,
          manualStartTime: "",
          manualEndTime: "",
          subGames: [
            {
              name: "Standard",
              subGameType: "STANDARD",
              extra: {
                rowPrizesByColor: {
                  SMALL_YELLOW: { ticketPrice: 30, fullHouse: 200 },
                  BLUE: { ticketPrice: 50 },
                },
              },
            },
            {
              name: "Mystery",
              subGameType: "MYSTERY",
              extra: {
                mysteryConfig: {
                  priceOptions: [1000, 2000, 3000],
                  yellowDoubles: false,
                },
              },
            },
          ],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });

    await openScheduleEditorModal({ mode: "edit", scheduleId: "sch-rt" });
    await flush();

    const rows = document.querySelectorAll<HTMLElement>(".sg-row");
    expect(rows.length).toBe(2);

    // Rad 1 (STANDARD): Small Yellow + BLUE avhuket, andre ikke.
    const r1 = rows[0]!;
    const r1Type = r1.querySelector<HTMLSelectElement>(
      '[data-sg-field="subGameType"]'
    )!;
    expect(r1Type.value).toBe("STANDARD");
    const syCb = r1.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-sg-color="SMALL_YELLOW"]'
    )!;
    expect(syCb.checked).toBe(true);
    const blueCb = r1.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-sg-color="BLUE"]'
    )!;
    expect(blueCb.checked).toBe(true);
    const redCb = r1.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-sg-color="RED"]'
    )!;
    expect(redCb.checked).toBe(false);

    // Pris-input for SMALL_YELLOW skal være pre-fylt.
    const syPrice = r1.querySelector<HTMLInputElement>(
      'input[data-sg-color="SMALL_YELLOW"][data-sg-color-field="ticketPrice"]'
    )!;
    expect(syPrice.value).toBe("30");
    const syFh = r1.querySelector<HTMLInputElement>(
      'input[data-sg-color="SMALL_YELLOW"][data-sg-color-field="fullHouse"]'
    )!;
    expect(syFh.value).toBe("200");

    // Rad 2 (MYSTERY): price-options pre-fylt.
    const r2 = rows[1]!;
    const r2Type = r2.querySelector<HTMLSelectElement>(
      '[data-sg-field="subGameType"]'
    )!;
    expect(r2Type.value).toBe("MYSTERY");
    const mp = r2.querySelector<HTMLInputElement>(
      '[data-sg-field="mysteryPriceOptions"]'
    )!;
    expect(mp.value).toBe("1000,2000,3000");
  });

  // ── Agent IJ — Innsatsen-jackpot: strukturert jackpot-terskel ────────────

  it("jackpot: strukturert jackpotDraw-input lagres inn i jackpotData", async () => {
    const fetchMock = installFetch((_url, init) => {
      if (init && init.method === "POST") {
        const body = JSON.parse(init.body as string);
        return successResponse({
          id: "sch-new",
          scheduleName: body.scheduleName,
          scheduleNumber: "SID_X",
          scheduleType: body.scheduleType ?? "Auto",
          luckyNumberPrize: 0,
          status: "active",
          isAdminSchedule: true,
          manualStartTime: "",
          manualEndTime: "",
          subGames: body.subGames ?? [],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });
    await openScheduleEditorModal({ mode: "create" });
    await flush();
    document.querySelector<HTMLInputElement>("#sch-name")!.value = "Pilot";

    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    const row = document.querySelector<HTMLElement>(".sg-row")!;
    row.querySelector<HTMLInputElement>('[data-sg-field="name"]')!.value =
      "Innsatsen-runde";
    row
      .querySelector<HTMLInputElement>('[data-sg-field="name"]')!
      .dispatchEvent(new Event("input"));

    const drawInput = row.querySelector<HTMLInputElement>(
      '[data-sg-field="jackpotDraw"]'
    )!;
    expect(drawInput).not.toBeNull();
    drawInput.value = "58";
    drawInput.dispatchEvent(new Event("input"));

    const prizeInput = row.querySelector<HTMLInputElement>(
      '[data-sg-field="jackpotPrize"]'
    )!;
    prizeInput.value = "2000";
    prizeInput.dispatchEvent(new Event("input"));

    getConfirmButton().click();
    await flush();

    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.subGames[0].jackpotData).toEqual({
      jackpotDraw: 58,
      jackpotPrize: 2000,
    });
  });

  it("jackpot: jackpotDraw > 75 → valideringsfeil og ingen POST", async () => {
    const fetchMock = installFetch(() => successResponse({}));
    await openScheduleEditorModal({ mode: "create" });
    await flush();
    document.querySelector<HTMLInputElement>("#sch-name")!.value = "Pilot";

    document
      .querySelector<HTMLButtonElement>('[data-sg-action="add"]')!
      .click();
    await flush();

    const row = document.querySelector<HTMLElement>(".sg-row")!;
    row.querySelector<HTMLInputElement>('[data-sg-field="name"]')!.value =
      "Bad runde";
    row
      .querySelector<HTMLInputElement>('[data-sg-field="name"]')!
      .dispatchEvent(new Event("input"));

    const drawInput = row.querySelector<HTMLInputElement>(
      '[data-sg-field="jackpotDraw"]'
    )!;
    drawInput.value = "76";
    drawInput.dispatchEvent(new Event("input"));

    getConfirmButton().click();
    await flush();

    // Ingen POST skal ha gått ut
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeFalsy();
  });

  it("jackpot: edit-modus round-trip henter jackpotDraw fra eksisterende jackpotData", async () => {
    installFetch((url) => {
      if (String(url).includes("/sch-1")) {
        return successResponse({
          id: "sch-1",
          scheduleName: "Innsatsen-mal",
          scheduleNumber: "SID_1",
          scheduleType: "Auto",
          luckyNumberPrize: 0,
          status: "active",
          isAdminSchedule: true,
          manualStartTime: "",
          manualEndTime: "",
          subGames: [
            {
              name: "Innsatsen-runde",
              jackpotData: { jackpotDraw: 58, jackpotPrize: 2000, someLegacyKey: "keep" },
            },
          ],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });

    await openScheduleEditorModal({ mode: "edit", scheduleId: "sch-1" });
    await flush();

    const row = document.querySelector<HTMLElement>(".sg-row")!;
    const drawInput = row.querySelector<HTMLInputElement>(
      '[data-sg-field="jackpotDraw"]'
    )!;
    expect(drawInput.value).toBe("58");
    const prizeInput = row.querySelector<HTMLInputElement>(
      '[data-sg-field="jackpotPrize"]'
    )!;
    expect(prizeInput.value).toBe("2000");

    // Advanced jackpotData-JSON skal inneholde legacy-key (someLegacyKey)
    // men IKKE duplisere jackpotDraw/jackpotPrize.
    const jpTextarea = row.querySelector<HTMLTextAreaElement>(
      '[data-sg-field="jackpotDataJson"]'
    )!;
    const advancedJson = jpTextarea.value.trim()
      ? JSON.parse(jpTextarea.value)
      : {};
    expect(advancedJson).toEqual({ someLegacyKey: "keep" });
  });

  it("JSON-fallback: submit fra JSON-modus sender samme shape som listen", async () => {
    const fetchMock = installFetch((_url, init) => {
      if (init && init.method === "POST") {
        const body = JSON.parse(init.body as string);
        return successResponse({
          id: "sch-new",
          scheduleName: body.scheduleName,
          scheduleNumber: "SID_X",
          scheduleType: "Auto",
          luckyNumberPrize: 0,
          status: "active",
          isAdminSchedule: true,
          manualStartTime: "",
          manualEndTime: "",
          subGames: body.subGames ?? [],
          createdBy: null,
          createdAt: "",
          updatedAt: "",
        });
      }
      return successResponse({});
    });

    await openScheduleEditorModal({ mode: "create" });
    await flush();

    document.querySelector<HTMLInputElement>("#sch-name")!.value = "Fra JSON-modus";

    // Bytt til JSON og lim inn custom array
    document
      .querySelector<HTMLButtonElement>("#sch-subgames-toggle")!
      .click();
    await flush();

    const textarea = document.querySelector<HTMLTextAreaElement>("#sch-subgames")!;
    textarea.value = JSON.stringify([
      { name: "Custom", startTime: "12:00", endTime: "12:30", minseconds: 7 },
    ]);

    getConfirmButton().click();
    await flush();

    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.subGames).toEqual([
      { name: "Custom", startTime: "12:00", endTime: "12:30", minseconds: 7 },
    ]);
  });
});
