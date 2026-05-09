/**
 * Tests for the recover-stale button in `Spill1HallStatusBox` (2026-05-09).
 *
 * The button is conditionally rendered based on the warning codes in
 * `Spill1AgentLobbyState.inconsistencyWarnings`:
 *
 *   - shows when at least one warning is STALE_PLAN_RUN or BRIDGE_FAILED
 *   - hides for any other warning code (DUAL_SCHEDULED_GAMES,
 *     PLAN_SCHED_STATUS_MISMATCH, MISSING_GOH_MEMBERSHIP)
 *   - clicking it triggers a confirm-modal first; cancel = no-op
 *   - confirm calls `recoverStale(hallId)` and refreshes lobby state
 *
 * We mock `agent-game1.js` so the test exercises the DOM rendering and
 * click-handler logic in isolation from real network I/O.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Spill1AgentLobbyState } from "../../../packages/shared-types/src/spill1-lobby-state.js";

// ── mock the API module BEFORE importing the component ──────────────────
//
// vi.mock is hoisted above all imports; we use vi.hoisted() so the mock
// fns are available inside the factory without ReferenceError. This is
// the standard pattern in Vitest 1.x for mock-bound state.
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

// Skip ApiError specifics — we only need a class to satisfy `instanceof`.
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

// Re-bind to short locals for in-test convenience.
const fetchLobbyStateMock = mocks.fetchLobbyStateMock;
const recoverStaleMock = mocks.recoverStaleMock;
const startMasterMock = mocks.startMasterMock;

// Now import the component under test (after mocks are wired).
import { mountSpill1HallStatusBox } from "../src/pages/cash-inout/Spill1HallStatusBox.js";

const HALL_ID = "11111111-1111-1111-1111-111111111111";

function makeLobbyState(
  overrides: Partial<Spill1AgentLobbyState> = {},
): Spill1AgentLobbyState {
  return {
    hallId: HALL_ID,
    hallName: "Test Hall",
    businessDate: "2026-05-09",
    generatedAt: "2026-05-09T15:00:00.000Z",
    currentScheduledGameId: null,
    planMeta: null,
    scheduledGameMeta: null,
    halls: [
      {
        hallId: HALL_ID,
        hallName: "Test Hall",
        isReady: false,
        readyAt: null,
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
  // Fresh DOM per test.
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  abortController = new AbortController();

  fetchLobbyStateMock.mockReset();
  recoverStaleMock.mockReset();
  startMasterMock.mockReset();
});

afterEach(() => {
  abortController.abort();
});

/** Helper: wait for the next refresh cycle to complete. */
async function flushPromises(): Promise<void> {
  // Two await ticks: one for the fetchLobbyState resolution, one for the
  // render-after-set-state cycle. Same pattern used by other UI tests.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Spill1HallStatusBox — recover-stale button visibility", () => {
  it("does NOT render the recover button when there are no warnings", async () => {
    fetchLobbyStateMock.mockResolvedValue(makeLobbyState());

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector(
      '[data-marker="spill1-hall-status-recover-button"]',
    );
    expect(button).toBeNull();
  });

  it("renders the recover button when STALE_PLAN_RUN warning is present", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        inconsistencyWarnings: [
          {
            code: "STALE_PLAN_RUN",
            message:
              "Plan-run for 2026-05-08 er fortsatt åpen i status='running'.",
            detail: {},
          },
        ],
      }),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector(
      '[data-marker="spill1-hall-status-recover-button"]',
    );
    expect(button).not.toBeNull();
    expect(button?.getAttribute("data-spill1-action")).toBe("recover-stale");
  });

  it("renders the recover button when BRIDGE_FAILED warning is present", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        inconsistencyWarnings: [
          {
            code: "BRIDGE_FAILED",
            message:
              "Plan-run er i 'running' men ingen scheduled-game ble opprettet.",
            detail: {},
          },
        ],
      }),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector(
      '[data-marker="spill1-hall-status-recover-button"]',
    );
    expect(button).not.toBeNull();
  });

  it("does NOT render the recover button for non-recoverable warnings", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        inconsistencyWarnings: [
          {
            code: "DUAL_SCHEDULED_GAMES",
            message: "To samtidige scheduled-games for hallen.",
            detail: {},
          },
        ],
      }),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    // The warning banner is shown, but the recover button should not be —
    // DUAL_SCHEDULED_GAMES requires manual reconciliation, not the
    // STALE_PLAN_RUN cleanup flow.
    const banner = container.querySelector(
      '[data-marker="spill1-hall-status-warning"]',
    );
    expect(banner).not.toBeNull();
    const button = container.querySelector(
      '[data-marker="spill1-hall-status-recover-button"]',
    );
    expect(button).toBeNull();
  });

  it("renders the recover button when at least ONE warning is recoverable (mixed)", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        inconsistencyWarnings: [
          {
            code: "PLAN_SCHED_STATUS_MISMATCH",
            message: "Plan-run.status='running' krangler.",
            detail: {},
          },
          {
            code: "STALE_PLAN_RUN",
            message: "Plan-run for 2026-05-08 er fortsatt åpen.",
            detail: {},
          },
        ],
      }),
    );

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector(
      '[data-marker="spill1-hall-status-recover-button"]',
    );
    expect(button).not.toBeNull();
  });
});

describe("Spill1HallStatusBox — recover-stale button click", () => {
  it("triggers confirm() then calls recoverStale on Yes", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        inconsistencyWarnings: [
          {
            code: "STALE_PLAN_RUN",
            message: "Plan-run for 2026-05-08 er fortsatt åpen.",
            detail: {},
          },
        ],
      }),
    );
    recoverStaleMock.mockResolvedValue({
      ok: true,
      cleared: { planRuns: 1, scheduledGames: 0 },
      details: {
        recoveredAt: "2026-05-09T15:00:00.000Z",
        todayBusinessDate: "2026-05-09",
        clearedPlanRuns: [],
        clearedScheduledGames: [],
      },
    });

    // Spy on confirm — simulate user clicking "OK".
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector<HTMLElement>(
      '[data-marker="spill1-hall-status-recover-button"]',
    );
    expect(button).not.toBeNull();
    button!.click();
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(recoverStaleMock).toHaveBeenCalledTimes(1);
    expect(recoverStaleMock).toHaveBeenCalledWith(HALL_ID);

    confirmSpy.mockRestore();
  });

  it("does NOT call recoverStale when user cancels confirm", async () => {
    fetchLobbyStateMock.mockResolvedValue(
      makeLobbyState({
        inconsistencyWarnings: [
          {
            code: "BRIDGE_FAILED",
            message: "Bridge failed.",
            detail: {},
          },
        ],
      }),
    );

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    mountSpill1HallStatusBox(container, abortController.signal);
    await flushPromises();

    const button = container.querySelector<HTMLElement>(
      '[data-marker="spill1-hall-status-recover-button"]',
    );
    button!.click();
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(recoverStaleMock).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});
