// Tests for GameManagementAddForm (Spill 1 opprettelse).
//
// Dekker:
//   - Form-render for game_1 (all sections + submit-button)
//   - "Not yet supported"-banner for andre game-types
//   - Ticket-farge-toggle aktiverer/deaktiverer pris-input
//   - Pattern-prize-tabell vises bare når farge er valgt
//   - Lokal validering (tomt navn, manglende start-tid, ingen farge)
//   - Submit-suksess: POST med riktig payload, redirect etter delay
//   - Submit-feil 403: viser "Tilgang nektet"
//   - Submit-feil 400 (INVALID_INPUT): viser backend-meldingen

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderGameManagementAddPage } from "../../src/pages/games/gameManagement/GameManagementAddForm.js";

// Mock GameType fetch.
const mockGameTypes = [
  {
    _id: "bingo",
    slug: "bingo",
    name: "Spill1",
    type: "game_1",
    row: 5,
    columns: 5,
    photo: "bingo.png",
    pattern: true,
  },
  {
    _id: "rocket",
    slug: "rocket",
    name: "Spill2",
    type: "game_2",
    row: 3,
    columns: 5,
    photo: "rocket.png",
    pattern: false,
  },
];
vi.mock("../../src/pages/games/gameType/GameTypeState.js", () => ({
  fetchGameTypeList: async () => mockGameTypes,
  fetchGameType: async (slug: string) =>
    mockGameTypes.find((gt) => gt._id === slug) ?? null,
}));

function mockFetchSuccess(data: unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  spy.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data }),
  });
  (globalThis as unknown as { fetch: unknown }).fetch = spy as unknown as typeof fetch;
  return spy;
}

function mockFetchError(status: number, code: string, message: string): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  spy.mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ ok: false, error: { code, message } }),
  });
  (globalThis as unknown as { fetch: unknown }).fetch = spy as unknown as typeof fetch;
  return spy;
}

async function setupForm(typeId: string): Promise<HTMLDivElement> {
  const c = document.createElement("div");
  await renderGameManagementAddPage(c, typeId);
  return c;
}

function dispatchInput(el: HTMLInputElement): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchChange(el: HTMLInputElement): void {
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInputValue(c: HTMLElement, selector: string, value: string): void {
  const el = c.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`input not found: ${selector}`);
  el.value = value;
  dispatchInput(el);
}

function toggleCheckbox(c: HTMLElement, testId: string): void {
  const el = c.querySelector<HTMLInputElement>(`[data-testid='${testId}']`);
  if (!el) throw new Error(`checkbox not found: ${testId}`);
  el.checked = !el.checked;
  dispatchChange(el);
}

describe("GameManagementAddForm — render", () => {
  beforeEach(() => {
    initI18n();
    window.localStorage.setItem("bingo_admin_access_token", "test-token");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("renderer full Spill 1-form med alle 7 seksjoner", async () => {
    const c = await setupForm("bingo");
    expect(c.querySelector("[data-testid='gm-add-form-root']")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-section-basics']")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-section-timing']")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-section-ticket-colors']")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-section-pattern-prizes']")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-section-jackpot']")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-section-elvis']")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-section-lucky-number']")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-submit']")).not.toBeNull();
  });

  it("viser not-yet-supported for game_2", async () => {
    const c = await setupForm("rocket");
    expect(c.querySelector("[data-testid='gm-add-unsupported']")).not.toBeNull();
    expect(c.querySelector("[data-testid='gm-add-form-root']")).toBeNull();
  });

  it("viser error-banner for ukjent typeId", async () => {
    const c = await setupForm("does-not-exist");
    expect(c.querySelector("[data-testid='gm-add-error']")).not.toBeNull();
  });

  it("pattern-prizes-tabell er tom inntil en ticket-farge velges", async () => {
    const c = await setupForm("bingo");
    expect(c.querySelector("[data-testid='gm-pattern-empty']")).not.toBeNull();
    toggleCheckbox(c, "gm-ticket-check-small_white");
    expect(c.querySelector("[data-testid='gm-pattern-empty']")).toBeNull();
    expect(c.querySelector("[data-testid='gm-prize-small_white-row_1']")).not.toBeNull();
  });

  it("toggle ticket-farge aktiverer pris-input", async () => {
    const c = await setupForm("bingo");
    const priceInput = c.querySelector<HTMLInputElement>(
      "[data-testid='gm-ticket-price-small_white']"
    );
    expect(priceInput?.disabled).toBe(true);
    toggleCheckbox(c, "gm-ticket-check-small_white");
    expect(priceInput?.disabled).toBe(false);
  });

  it("jackpot-seksjonen viser hjelpetekst når ingen ticket-farger er valgt", async () => {
    const c = await setupForm("bingo");
    expect(c.querySelector("[data-testid='gm-jackpot-empty']")).not.toBeNull();
    // Draw-feltet skal alltid være synlig.
    expect(c.querySelector("[data-testid='gm-jackpot-draw']")).not.toBeNull();
    // Men ingen per-farge prize-inputs.
    expect(
      c.querySelector("[data-testid='gm-jackpot-prize-small_white']")
    ).toBeNull();
  });

  it("jackpot-seksjonen rendrer én prize-input per valgt ticket-farge", async () => {
    const c = await setupForm("bingo");
    toggleCheckbox(c, "gm-ticket-check-small_white");
    toggleCheckbox(c, "gm-ticket-check-small_red");
    toggleCheckbox(c, "gm-ticket-check-elvis1");
    expect(c.querySelector("[data-testid='gm-jackpot-empty']")).toBeNull();
    expect(
      c.querySelector("[data-testid='gm-jackpot-prize-small_white']")
    ).not.toBeNull();
    expect(
      c.querySelector("[data-testid='gm-jackpot-prize-small_red']")
    ).not.toBeNull();
    expect(
      c.querySelector("[data-testid='gm-jackpot-prize-elvis1']")
    ).not.toBeNull();
    // Ingen inputs for farger som IKKE er valgt.
    expect(
      c.querySelector("[data-testid='gm-jackpot-prize-small_yellow']")
    ).toBeNull();
  });

  it("av-valg av ticket-farge fjerner jackpot-input for samme farge", async () => {
    const c = await setupForm("bingo");
    toggleCheckbox(c, "gm-ticket-check-small_white");
    expect(
      c.querySelector("[data-testid='gm-jackpot-prize-small_white']")
    ).not.toBeNull();
    toggleCheckbox(c, "gm-ticket-check-small_white");
    expect(
      c.querySelector("[data-testid='gm-jackpot-prize-small_white']")
    ).toBeNull();
    expect(c.querySelector("[data-testid='gm-jackpot-empty']")).not.toBeNull();
  });
});

describe("GameManagementAddForm — validering", () => {
  beforeEach(() => {
    initI18n();
    window.localStorage.setItem("bingo_admin_access_token", "test-token");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("viser validerings-feil når form submiteres tom", async () => {
    const c = await setupForm("bingo");
    const submit = c.querySelector<HTMLButtonElement>("[data-testid='gm-submit']");
    submit?.click();
    // Field-errors-alerten skal vises.
    await Promise.resolve();
    expect(c.querySelector("[data-testid='gm-field-errors-alert']")).not.toBeNull();
  });

  it("fremhever pattern-%-sum > 100 som rød", async () => {
    const c = await setupForm("bingo");
    toggleCheckbox(c, "gm-ticket-check-small_white");
    setInputValue(c, "[data-testid='gm-prize-small_white-row_1']", "60");
    setInputValue(c, "[data-testid='gm-prize-small_white-row_2']", "50");
    const sumCell = c.querySelector<HTMLElement>("[data-testid='gm-prize-sum-small_white']");
    expect(sumCell?.textContent).toBe("110%");
    expect(sumCell?.style.color).toBe("rgb(217, 83, 79)");
  });
});

describe("GameManagementAddForm — submit", () => {
  beforeEach(() => {
    initI18n();
    window.localStorage.setItem("bingo_admin_access_token", "test-token");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  async function fillValidForm(c: HTMLElement): Promise<void> {
    setInputValue(c, "[data-testid='gm-name']", "Fredag Bingo");
    setInputValue(c, "#gm-start-time", "18:00");
    setInputValue(c, "#gm-end-time", "20:00");
    toggleCheckbox(c, "gm-ticket-check-small_white");
    setInputValue(c, "[data-testid='gm-ticket-price-small_white']", "20");
    setInputValue(c, "[data-testid='gm-prize-small_white-row_1']", "25");
    setInputValue(c, "[data-testid='gm-prize-small_white-full_house']", "50");
    // Jackpot-draw må være 50-59.
    setInputValue(c, "[data-testid='gm-jackpot-draw']", "55");
  }

  it("submit-suksess: POST med riktig body + global success-alert", async () => {
    const c = await setupForm("bingo");
    await fillValidForm(c);
    const fetchSpy = mockFetchSuccess({
      id: "gm-new-1",
      gameTypeId: "bingo",
      parentId: null,
      name: "Fredag Bingo",
      ticketType: "Small",
      ticketPrice: 2000,
      startDate: "2026-05-01T18:00:00.000Z",
      endDate: "2026-05-01T20:00:00.000Z",
      status: "active",
      totalSold: 0,
      totalEarning: 0,
      config: { spill1: { startTime: "18:00" } },
      repeatedFromId: null,
      createdBy: "admin-1",
      createdAt: "2026-04-21T12:00:00Z",
      updatedAt: "2026-04-21T12:00:00Z",
    });
    const submit = c.querySelector<HTMLButtonElement>("[data-testid='gm-submit']");
    submit?.click();
    // Vent på Promise.microtask-kjeden å tømme.
    await vi.waitFor(() =>
      expect(c.querySelector("[data-testid='gm-global-alert-success']")).not.toBeNull()
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/game-management",
      expect.objectContaining({ method: "POST" })
    );
    // Verifier payload-struktur.
    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1].body as string) as {
      gameTypeId: string;
      name: string;
      ticketType: string;
      ticketPrice: number;
      config: { spill1: { startTime: string; ticketColors: unknown[] } };
    };
    expect(body.gameTypeId).toBe("bingo");
    expect(body.name).toBe("Fredag Bingo");
    expect(body.ticketType).toBe("Small");
    // 20 NOK → 2000 øre.
    expect(body.ticketPrice).toBe(2000);
    expect(body.config.spill1.startTime).toBe("18:00");
    expect(body.config.spill1.ticketColors).toHaveLength(1);
  });

  it("submit 403 feil: viser forbidden-melding", async () => {
    const c = await setupForm("bingo");
    await fillValidForm(c);
    mockFetchError(403, "FORBIDDEN", "not allowed");
    const submit = c.querySelector<HTMLButtonElement>("[data-testid='gm-submit']");
    submit?.click();
    await vi.waitFor(() =>
      expect(c.querySelector("[data-testid='gm-global-alert-danger']")).not.toBeNull()
    );
    const alert = c.querySelector<HTMLElement>("[data-testid='gm-global-alert-danger']");
    expect(alert?.textContent?.toLowerCase()).toContain("tilgang");
  });

  it("submit 400 INVALID_INPUT: viser backend-melding", async () => {
    const c = await setupForm("bingo");
    await fillValidForm(c);
    mockFetchError(400, "INVALID_INPUT", "startDate må være satt");
    const submit = c.querySelector<HTMLButtonElement>("[data-testid='gm-submit']");
    submit?.click();
    await vi.waitFor(() =>
      expect(c.querySelector("[data-testid='gm-global-alert-danger']")).not.toBeNull()
    );
    const alert = c.querySelector<HTMLElement>("[data-testid='gm-global-alert-danger']");
    expect(alert?.textContent).toContain("startDate");
  });

  it("submit inkluderer per-farge jackpot-prize i payload", async () => {
    const c = await setupForm("bingo");
    await fillValidForm(c);
    // Legg til en ekstra farge + sett jackpot-premier på flere farger.
    toggleCheckbox(c, "gm-ticket-check-small_red");
    setInputValue(c, "[data-testid='gm-ticket-price-small_red']", "15");
    setInputValue(c, "[data-testid='gm-jackpot-prize-small_white']", "10000");
    setInputValue(c, "[data-testid='gm-jackpot-prize-small_red']", "7500");
    const fetchSpy = mockFetchSuccess({
      id: "gm-new-1",
      gameTypeId: "bingo",
      parentId: null,
      name: "Fredag Bingo",
      ticketType: "Small",
      ticketPrice: 1500,
      startDate: "2026-05-01T18:00:00.000Z",
      endDate: "2026-05-01T20:00:00.000Z",
      status: "active",
      totalSold: 0,
      totalEarning: 0,
      config: {},
      repeatedFromId: null,
      createdBy: "admin-1",
      createdAt: "2026-04-21T12:00:00Z",
      updatedAt: "2026-04-21T12:00:00Z",
    });
    const submit = c.querySelector<HTMLButtonElement>("[data-testid='gm-submit']");
    submit?.click();
    await vi.waitFor(() =>
      expect(c.querySelector("[data-testid='gm-global-alert-success']")).not.toBeNull()
    );
    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1].body as string) as {
      config: {
        spill1: {
          jackpot: { prizeByColor: Record<string, number>; draw: number };
        };
      };
    };
    expect(body.config.spill1.jackpot.prizeByColor).toEqual({
      small_white: 10000,
      small_red: 7500,
    });
    expect(body.config.spill1.jackpot.draw).toBe(55);
  });

  it("submit 404 NOT_FOUND: viser not-found-melding", async () => {
    const c = await setupForm("bingo");
    await fillValidForm(c);
    mockFetchError(404, "GAME_TYPE_NOT_FOUND", "gone");
    const submit = c.querySelector<HTMLButtonElement>("[data-testid='gm-submit']");
    submit?.click();
    await vi.waitFor(() =>
      expect(c.querySelector("[data-testid='gm-global-alert-danger']")).not.toBeNull()
    );
  });
});
