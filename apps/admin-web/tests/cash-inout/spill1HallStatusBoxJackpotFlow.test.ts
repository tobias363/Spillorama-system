/**
 * Jackpot-modal: master-flow-2026-05-10 (Tobias-direktiv).
 *
 * Tester at "Start neste spill"-knappen i `Spill1HallStatusBox`:
 *
 *   - Ved JACKPOT_CONFIRM_REQUIRED → viser confirm-popup → retry'er
 *     startMaster med jackpotConfirmed=true.
 *   - Ved JACKPOT_SETUP_REQUIRED → fetcher plan-current → viser
 *     setup-popup → retry'er start.
 *   - Avbryt i confirm-popup → ingen retry.
 *   - Annen ApiError → toast-error, ingen retry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Spill1AgentLobbyState } from "../../../../packages/shared-types/src/spill1-lobby-state.js";
import type {
  AgentGamePlanCurrentResponse,
  AgentGamePlanItem,
} from "../../src/api/agent-game-plan.js";
import type { GameCatalogEntry } from "../../src/api/admin-game-catalog.js";

// ── mock the API modules BEFORE importing the component ──────────────────
const mocks = vi.hoisted(() => ({
  fetchLobbyStateMock: vi.fn(),
  startMasterMock: vi.fn(),
  pauseMasterMock: vi.fn(),
  resumeMasterMock: vi.fn(),
  recoverStaleMock: vi.fn(),
  markHallReadyMock: vi.fn(),
  unmarkHallReadyMock: vi.fn(),
  setHallNoCustomersMock: vi.fn(),
  setHallHasCustomersMock: vi.fn(),
  fetchAgentGamePlanCurrentMock: vi.fn(),
  setAgentGamePlanJackpotMock: vi.fn(),
}));

vi.mock("../../src/api/agent-game1.js", () => ({
  fetchLobbyState: mocks.fetchLobbyStateMock,
  startMaster: mocks.startMasterMock,
  pauseMaster: mocks.pauseMasterMock,
  resumeMaster: mocks.resumeMasterMock,
  recoverStale: mocks.recoverStaleMock,
  markHallReadyForGame: mocks.markHallReadyMock,
  unmarkHallReadyForGame: mocks.unmarkHallReadyMock,
  setHallNoCustomersForGame: mocks.setHallNoCustomersMock,
  setHallHasCustomersForGame: mocks.setHallHasCustomersMock,
}));

vi.mock("../../src/api/agent-game-plan.js", () => ({
  fetchAgentGamePlanCurrent: mocks.fetchAgentGamePlanCurrentMock,
  setAgentGamePlanJackpot: mocks.setAgentGamePlanJackpotMock,
}));

vi.mock("../../src/components/Toast.js", () => ({
  Toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

// Re-bind locals.
const fetchLobbyStateMock = mocks.fetchLobbyStateMock;
const startMasterMock = mocks.startMasterMock;
const fetchAgentGamePlanCurrentMock = mocks.fetchAgentGamePlanCurrentMock;
const setAgentGamePlanJackpotMock = mocks.setAgentGamePlanJackpotMock;

// Import after mocks are wired.
import { mountSpill1HallStatusBox } from "../../src/pages/cash-inout/Spill1HallStatusBox.js";
import { ApiError } from "../../src/api/client.js";
import { Toast } from "../../src/components/Toast.js";

const HALL_ID = "11111111-1111-1111-1111-111111111111";

function makeLobbyState(
  overrides: Partial<Spill1AgentLobbyState> = {},
): Spill1AgentLobbyState {
  return {
    hallId: HALL_ID,
    hallName: "Test Hall",
    businessDate: "2026-05-09",
    generatedAt: "2026-05-09T15:00:00.000Z",
    currentScheduledGameId: "scheduled-game-1",
    planMeta: {
      planId: "plan-1",
      planName: "Pilot Demo",
      currentPosition: 1,
      totalPositions: 13,
      catalogSlug: "bingo",
      catalogDisplayName: "Bingo",
      planRunStatus: "running",
      jackpotSetupRequired: false,
      pendingJackpotOverride: null,
    },
    scheduledGameMeta: {
      scheduledGameId: "scheduled-game-1",
      status: "ready_to_start",
      scheduledStartTime: "2026-05-09T18:00:00.000Z",
      scheduledEndTime: null,
    },
    halls: [
      {
        hallId: HALL_ID,
        hallName: "Test Hall",
        isReady: true,
        readyAt: "2026-05-09T17:30:00.000Z",
        excludedFromGame: false,
        digitalTicketsSold: 5,
        physicalTicketsSold: 0,
      },
    ],
    allHallsReady: true,
    masterHallId: HALL_ID,
    groupOfHallsId: "demo-pilot-goh",
    isMasterAgent: true,
    nextScheduledStartTime: null,
    inconsistencyWarnings: [],
    ...overrides,
  } as Spill1AgentLobbyState;
}

function makeCatalogEntry(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  return {
    id: "cat-jackpot",
    slug: "jackpot",
    displayName: "Jackpot",
    description: null,
    rules: {},
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { gul: 1000, hvit: 500, lilla: 1500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 100000, lilla: 300000 },
    },
    prizeMultiplierMode: "explicit_per_color",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: true,
    isActive: true,
    sortOrder: 7,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    createdByUserId: "admin-1",
    ...overrides,
  };
}

function makePlanCurrentResponse(
  catalog: GameCatalogEntry,
  position = 7,
): AgentGamePlanCurrentResponse {
  const item: AgentGamePlanItem = {
    id: `item-${position}`,
    position,
    notes: null,
    catalogEntry: catalog,
  };
  return {
    hallId: HALL_ID,
    businessDate: "2026-05-09",
    run: {
      id: "run-1",
      planId: "plan-1",
      hallId: HALL_ID,
      businessDate: "2026-05-09",
      currentPosition: position,
      status: "running",
      jackpotOverrides: {},
      startedAt: "2026-05-09T17:00:00Z",
      finishedAt: null,
      masterUserId: "admin-1",
      createdAt: "",
      updatedAt: "",
    },
    plan: {
      id: "plan-1",
      name: "Pilot Demo",
      description: null,
      hallId: null,
      groupOfHallsId: "demo-pilot-goh",
      weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      startTime: "11:00",
      endTime: "23:00",
      isActive: true,
    },
    items: [item],
    currentItem: item,
    nextItem: null,
    jackpotSetupRequired: true,
    pendingJackpotOverride: null,
    isMaster: true,
  };
}

let container: HTMLElement;
let abortController: AbortController;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  abortController = new AbortController();

  fetchLobbyStateMock.mockReset();
  startMasterMock.mockReset();
  fetchAgentGamePlanCurrentMock.mockReset();
  setAgentGamePlanJackpotMock.mockReset();
  vi.mocked(Toast.success).mockClear();
  vi.mocked(Toast.error).mockClear();
});

afterEach(() => {
  abortController.abort();
  document.body.innerHTML = "";
});

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function clickStartButton(): Promise<void> {
  // Knapp har data-spill1-action="start"
  const btn = container.querySelector<HTMLButtonElement>(
    '[data-spill1-action="start"]',
  );
  if (!btn) throw new Error("Start-knapp ikke funnet i container");
  btn.click();
  await flushPromises();
}

describe("Spill1HallStatusBox — JACKPOT_CONFIRM_REQUIRED-flyt", () => {
  it("åpner confirm-popup ved første start-feil og retry'er med jackpotConfirmed=true ved bekreftelse", async () => {
    fetchLobbyStateMock.mockResolvedValue(makeLobbyState());

    let startCalls = 0;
    startMasterMock.mockImplementation(
      async (_hallId?: string, jackpotConfirmed?: boolean) => {
        startCalls += 1;
        if (!jackpotConfirmed) {
          throw new ApiError(
            "Jackpott må bekreftes",
            "JACKPOT_CONFIRM_REQUIRED",
            400,
            {
              jackpotAmountCents: 200000,
              maxCapCents: 3000000,
              dailyIncrementCents: 400000,
              drawThresholds: [50, 55, 56, 57],
              hallGroupId: "demo-pilot-goh",
            },
          );
        }
        return {
          scheduledGameId: "scheduled-game-1",
          planRunId: "run-1",
          status: "running" as const,
          scheduledGameStatus: "running" as const,
          inconsistencyWarnings: [],
        };
      },
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    await clickStartButton();
    // Modal skal være åpen
    await flushPromises();
    const amountEl = document.querySelector(
      '[data-testid="jackpot-confirm-amount"]',
    );
    expect(amountEl).not.toBeNull();
    expect(amountEl?.textContent).toMatch(/2[\s ]?000\s*kr/);

    // Klikk bekreft
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="confirm"]',
    );
    expect(confirmBtn).not.toBeNull();
    confirmBtn?.click();
    await flushPromises();

    // Verifiser at start ble retry'et med jackpotConfirmed=true
    expect(startCalls).toBe(2);
    expect(startMasterMock).toHaveBeenLastCalledWith(HALL_ID, true);
    expect(Toast.success).toHaveBeenCalledWith("Spill 1 startet.");
  });

  it("avbryter start når master klikker Avbryt i confirm-popup", async () => {
    fetchLobbyStateMock.mockResolvedValue(makeLobbyState());

    let startCalls = 0;
    startMasterMock.mockImplementation(
      async (_hallId?: string, jackpotConfirmed?: boolean) => {
        startCalls += 1;
        if (!jackpotConfirmed) {
          throw new ApiError("Jackpott må bekreftes", "JACKPOT_CONFIRM_REQUIRED", 400, {
            jackpotAmountCents: 200000,
            maxCapCents: 3000000,
            dailyIncrementCents: 400000,
            drawThresholds: [50, 55, 56, 57],
          });
        }
        return {
          scheduledGameId: "scheduled-game-1",
          planRunId: "run-1",
          status: "running" as const,
          scheduledGameStatus: "running" as const,
          inconsistencyWarnings: [],
        };
      },
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    await clickStartButton();
    await flushPromises();

    // Klikk avbryt
    const cancelBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="cancel"]',
    );
    cancelBtn?.click();
    await flushPromises();

    // Bare ett start-kall (det første som feilet med JACKPOT_CONFIRM_REQUIRED)
    expect(startCalls).toBe(1);
    expect(Toast.success).not.toHaveBeenCalled();
  });
});

describe("Spill1HallStatusBox — JACKPOT_SETUP_REQUIRED-flyt", () => {
  it("fetcher plan-current og åpner setup-popup ved JACKPOT_SETUP_REQUIRED", async () => {
    const catalog = makeCatalogEntry();
    fetchLobbyStateMock.mockResolvedValue(makeLobbyState());
    fetchAgentGamePlanCurrentMock.mockResolvedValue(
      makePlanCurrentResponse(catalog, 7),
    );

    let startCalls = 0;
    startMasterMock.mockImplementation(async () => {
      startCalls += 1;
      if (startCalls === 1) {
        throw new ApiError(
          "Catalog krever jackpot-setup",
          "JACKPOT_SETUP_REQUIRED",
          400,
          { position: 7, catalogId: "cat-jackpot", catalogSlug: "jackpot" },
        );
      }
      return {
        scheduledGameId: "scheduled-game-1",
        planRunId: "run-1",
        status: "running" as const,
        scheduledGameStatus: "running" as const,
        inconsistencyWarnings: [],
      };
    });

    setAgentGamePlanJackpotMock.mockResolvedValue({
      run: {
        id: "run-1",
        planId: "plan-1",
        hallId: HALL_ID,
        businessDate: "2026-05-09",
        currentPosition: 7,
        status: "running",
        jackpotOverrides: {
          "7": { draw: 50, prizesCents: { gul: 200000, hvit: 100000, lilla: 300000 } },
        },
        startedAt: null,
        finishedAt: null,
        masterUserId: null,
        createdAt: "",
        updatedAt: "",
      },
    });

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    await clickStartButton();
    await flushPromises();

    // fetchAgentGamePlanCurrent skal være kalt med riktig hallId
    expect(fetchAgentGamePlanCurrentMock).toHaveBeenCalledWith({
      hallId: HALL_ID,
    });

    // JackpotSetupModal skal være åpen — sjekk for setup-form
    const setupForm = document.querySelector(
      '[data-testid="jackpot-setup-form"]',
    );
    expect(setupForm).not.toBeNull();
    expect(setupForm?.getAttribute("data-position")).toBe("7");

    // Sjekk at draw-input er rendret
    const drawInput = document.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-draw-input"]',
    );
    expect(drawInput).not.toBeNull();
  });

  it("viser feilmelding når plan-current-fetch feiler", async () => {
    fetchLobbyStateMock.mockResolvedValue(makeLobbyState());
    fetchAgentGamePlanCurrentMock.mockRejectedValue(
      new Error("Network error"),
    );

    startMasterMock.mockRejectedValue(
      new ApiError(
        "Catalog krever jackpot-setup",
        "JACKPOT_SETUP_REQUIRED",
        400,
        { position: 7 },
      ),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    await clickStartButton();
    await flushPromises();

    expect(Toast.error).toHaveBeenCalledWith(
      expect.stringContaining("plan-data for jackpot-setup"),
    );
  });
});

describe("Spill1HallStatusBox — annen feil i start-flow", () => {
  it("viser Toast.error ved generisk ApiError", async () => {
    fetchLobbyStateMock.mockResolvedValue(makeLobbyState());

    startMasterMock.mockRejectedValue(
      new ApiError("Master-hallen har ingen spillere", "MASTER_HALL_RED", 400),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    await clickStartButton();
    await flushPromises();

    expect(Toast.error).toHaveBeenCalledWith("Master-hallen har ingen spillere");
    expect(startMasterMock).toHaveBeenCalledTimes(1);
  });

  it("starter direkte uten popup når ingen jackpot-feil oppstår", async () => {
    fetchLobbyStateMock.mockResolvedValue(makeLobbyState());

    startMasterMock.mockResolvedValue({
      scheduledGameId: "scheduled-game-1",
      planRunId: "run-1",
      status: "running" as const,
      scheduledGameStatus: "running" as const,
      inconsistencyWarnings: [],
    });

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    await clickStartButton();
    await flushPromises();

    // Verifiser at ingen jackpot-modal vises
    expect(document.querySelector('[data-testid="jackpot-confirm-amount"]')).toBeNull();
    expect(document.querySelector('[data-testid="jackpot-setup-form"]')).toBeNull();

    expect(startMasterMock).toHaveBeenCalledTimes(1);
    expect(startMasterMock).toHaveBeenCalledWith(HALL_ID, undefined);
    expect(Toast.success).toHaveBeenCalledWith("Spill 1 startet.");
  });
});
