/**
 * Tests for "Angre Klar"-knappen i `Spill1HallStatusBox` (2026-05-13).
 *
 * Tobias-rapport 2026-05-13: "det er heller ikke mulig å angre klar i
 * backend". Pre-fix-flyt:
 *
 *   • Master har Klar=true på en COMPLETED scheduled-game (forrige runde).
 *   • UI disabler "Angre Klar"-knappen med terminal-tooltip, ELLER
 *     click-handler bailer stille fordi `readyActionGameId === null`.
 *   • Master kan ikke angre Klar — verken via UI eller direkte API-kall.
 *
 * Fix:
 *   1. Backend `/api/admin/game1/halls/:hallId/unready` støtter nå
 *      lazy-spawn (samme flyt som `/ready`). Hvis gameId mangler eller
 *      refererer til terminal-runde, auto-advancer plan-run + spawner
 *      ny scheduled-game.
 *   2. API-klient `unmarkHallReadyForGame` aksepterer nå `gameId: null`.
 *   3. UI enabler knappen i terminal- og idle-state (backend håndterer
 *      lazy-spawn).
 *
 * Disse testene verifiserer (3) — at UI sender riktig request og at
 * knappen er enablet i terminal/idle-tilstander.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Spill1AgentLobbyState } from "../../../packages/shared-types/src/spill1-lobby-state.js";

const mocks = vi.hoisted(() => ({
  fetchLobbyStateMock: vi.fn(),
  recoverStaleMock: vi.fn(),
  startMasterMock: vi.fn(),
  pauseMasterMock: vi.fn(),
  resumeMasterMock: vi.fn(),
  markHallReadyMock: vi.fn(),
  unmarkHallReadyMock: vi.fn(),
  setHallNoCustomersMock: vi.fn(),
  setHallHasCustomersMock: vi.fn(),
}));

vi.mock("../src/api/agent-game1.js", () => ({
  fetchLobbyState: mocks.fetchLobbyStateMock,
  recoverStale: mocks.recoverStaleMock,
  startMaster: mocks.startMasterMock,
  pauseMaster: mocks.pauseMasterMock,
  resumeMaster: mocks.resumeMasterMock,
  markHallReadyForGame: mocks.markHallReadyMock,
  unmarkHallReadyForGame: mocks.unmarkHallReadyMock,
  setHallNoCustomersForGame: mocks.setHallNoCustomersMock,
  setHallHasCustomersForGame: mocks.setHallHasCustomersMock,
}));

vi.mock("../src/components/Toast.js", () => ({
  Toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("../src/api/client.js", () => ({
  ApiError: class extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

const fetchLobbyStateMock = mocks.fetchLobbyStateMock;
const unmarkHallReadyMock = mocks.unmarkHallReadyMock;

import { mountSpill1HallStatusBox } from "../src/pages/cash-inout/Spill1HallStatusBox.js";

const HALL_ID = "22222222-2222-2222-2222-222222222222";

function makeLobbyState(
  overrides: Partial<Spill1AgentLobbyState> = {},
): Spill1AgentLobbyState {
  return {
    hallId: HALL_ID,
    hallName: "Master Hall",
    businessDate: "2026-05-13",
    generatedAt: "2026-05-13T18:00:00.000Z",
    currentScheduledGameId: null,
    planMeta: null,
    scheduledGameMeta: null,
    halls: [
      {
        hallId: HALL_ID,
        hallName: "Master Hall",
        isReady: true,
        readyAt: "2026-05-13T17:00:00.000Z",
        excludedFromGame: false,
        digitalTicketsSold: 0,
        physicalTicketsSold: 0,
      },
    ],
    allHallsReady: false,
    masterHallId: HALL_ID,
    groupOfHallsId: null,
    isMasterAgent: true,
    nextScheduledStartTime: null,
    inconsistencyWarnings: [],
    ...overrides,
  } as Spill1AgentLobbyState;
}

let container: HTMLElement;
let abortController: AbortController;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  abortController = new AbortController();

  fetchLobbyStateMock.mockReset();
  unmarkHallReadyMock.mockReset();
  unmarkHallReadyMock.mockResolvedValue({});
});

afterEach(() => {
  abortController.abort();
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Spill1HallStatusBox — Angre Klar (Tobias fix #5, 2026-05-13)", () => {
  it("renderer 'Angre Klar' når isReady=true uansett scheduled-game-status", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        currentScheduledGameId: "completed-game-id",
        scheduledGameMeta: {
          scheduledGameId: "completed-game-id",
          status: "completed",
          scheduledStartTime: "2026-05-13T17:00:00.000Z",
          scheduledEndTime: null,
          actualStartTime: "2026-05-13T17:00:00.000Z",
          actualEndTime: "2026-05-13T17:30:00.000Z",
          pauseReason: null,
          pauseStartedAt: null,
          autoResumeEligibleAt: null,
          stuckAutoEndAt: null,
        },
      }),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector<HTMLButtonElement>(
      'button[data-spill1-action="unmark-ready"]',
    );
    expect(button).not.toBeNull();
    // Etter Tobias-fix #5: knappen er ENABLED selv i terminal-runde fordi
    // backend støtter lazy-spawn for unmark.
    expect(button?.disabled).toBe(false);
  });

  it("'Angre Klar' i terminal-runde kaller unmarkHallReadyForGame med null gameId (lazy-spawn-flyten)", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        currentScheduledGameId: "completed-game-id",
        scheduledGameMeta: {
          scheduledGameId: "completed-game-id",
          status: "completed",
          scheduledStartTime: "2026-05-13T17:00:00.000Z",
          scheduledEndTime: null,
          actualStartTime: "2026-05-13T17:00:00.000Z",
          actualEndTime: "2026-05-13T17:30:00.000Z",
          pauseReason: null,
          pauseStartedAt: null,
          autoResumeEligibleAt: null,
          stuckAutoEndAt: null,
        },
      }),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector<HTMLButtonElement>(
      'button[data-spill1-action="unmark-ready"]',
    );
    expect(button).not.toBeNull();

    button?.click();
    await flushPromises();

    // Verifiser at unmarkHallReadyForGame ble kalt med gameId=null
    // (terminal-runde → readyActionGameId=null → backend lazy-spawner).
    expect(unmarkHallReadyMock).toHaveBeenCalledTimes(1);
    const [hallIdArg, gameIdArg] = unmarkHallReadyMock.mock.calls[0]!;
    expect(hallIdArg).toBe(HALL_ID);
    expect(gameIdArg).toBeNull();
  });

  it("'Angre Klar' i idle-state (ingen scheduled-game) kaller unmarkHallReadyForGame med null gameId", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        // Ingen current scheduled-game — idle-tilstand (transient state).
        currentScheduledGameId: null,
        scheduledGameMeta: null,
      }),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector<HTMLButtonElement>(
      'button[data-spill1-action="unmark-ready"]',
    );
    expect(button).not.toBeNull();
    // Etter Tobias-fix #5: idle-knapp er ENABLED (backend lazy-spawner).
    expect(button?.disabled).toBe(false);

    button?.click();
    await flushPromises();

    expect(unmarkHallReadyMock).toHaveBeenCalledTimes(1);
    const [hallIdArg, gameIdArg] = unmarkHallReadyMock.mock.calls[0]!;
    expect(hallIdArg).toBe(HALL_ID);
    expect(gameIdArg).toBeNull();
  });

  it("'Angre Klar' i pre-game (scheduled) kaller unmarkHallReadyForGame med gyldig gameId", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        currentScheduledGameId: "scheduled-game-id",
        scheduledGameMeta: {
          scheduledGameId: "scheduled-game-id",
          status: "scheduled",
          scheduledStartTime: "2026-05-13T18:00:00.000Z",
          scheduledEndTime: null,
          actualStartTime: null,
          actualEndTime: null,
          pauseReason: null,
          pauseStartedAt: null,
          autoResumeEligibleAt: null,
          stuckAutoEndAt: null,
        },
      }),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector<HTMLButtonElement>(
      'button[data-spill1-action="unmark-ready"]',
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);

    button?.click();
    await flushPromises();

    // Pre-game: vi sender den eksisterende gameId direkte (ingen lazy-spawn
    // nødvendig på backend-siden — happy-path).
    expect(unmarkHallReadyMock).toHaveBeenCalledTimes(1);
    const [hallIdArg, gameIdArg] = unmarkHallReadyMock.mock.calls[0]!;
    expect(hallIdArg).toBe(HALL_ID);
    expect(gameIdArg).toBe("scheduled-game-id");
  });

  it("'Angre Klar' i running-runde er DISABLED (master kan ikke angre mens engine trekker)", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        currentScheduledGameId: "running-game-id",
        scheduledGameMeta: {
          scheduledGameId: "running-game-id",
          status: "running",
          scheduledStartTime: "2026-05-13T18:00:00.000Z",
          scheduledEndTime: null,
          actualStartTime: "2026-05-13T18:00:00.000Z",
          actualEndTime: null,
          pauseReason: null,
          pauseStartedAt: null,
          autoResumeEligibleAt: null,
          stuckAutoEndAt: null,
        },
      }),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector<HTMLButtonElement>(
      'button[data-spill1-action="unmark-ready"]',
    );
    expect(button).not.toBeNull();
    // Running er den ene staten hvor Angre Klar fortsatt er disabled —
    // master kan ikke angre Klar mens engine aktivt trekker baller.
    expect(button?.disabled).toBe(true);
  });
});
