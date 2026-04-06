import { describe, expect, it } from "vitest";
import type { CandyRoomSchedulerState } from "@/domain/realtime/contracts";
import {
  resolveSchedulerCountdownLabel,
  resolveVisibleCountdownPanelLabel,
} from "@/domain/theme1/schedulerCountdown";

function createSchedulerState(): CandyRoomSchedulerState {
  return {
    enabled: true,
    liveRoundsIndependentOfBet: true,
    intervalMs: 30000,
    minPlayers: 1,
    playerCount: 2,
    armedPlayerCount: 0,
    armedPlayerIds: [],
    entryFee: 30,
    payoutPercent: 90,
    drawCapacity: 60,
    currentDrawCount: 0,
    remainingDrawCapacity: 60,
    nextStartAt: "2026-03-13T11:00:30.000Z",
    millisUntilNextStart: 30000,
    canStartNow: false,
    serverTime: "2026-03-13T11:00:00.000Z",
  };
}

describe("resolveSchedulerCountdownLabel", () => {
  it("counts down locally from the scheduler nextStartAt timestamp", () => {
    const label = resolveSchedulerCountdownLabel(
      createSchedulerState(),
      "00:30",
      Date.parse("2026-03-13T11:00:12.000Z"),
    );

    expect(label).toBe("00:18");
  });

  it("falls back to serverTime + millisUntilNextStart when nextStartAt is missing", () => {
    const scheduler = createSchedulerState();
    scheduler.nextStartAt = null;

    const label = resolveSchedulerCountdownLabel(
      scheduler,
      "00:30",
      Date.parse("2026-03-13T11:00:12.000Z"),
    );

    expect(label).toBe("00:18");
  });

  it("returns the existing label when scheduler data is unavailable", () => {
    expect(resolveSchedulerCountdownLabel(undefined, "00:45", Date.now())).toBe("00:45");
  });

  it("hides the countdown while a round is running", () => {
    expect(
      resolveSchedulerCountdownLabel(
        createSchedulerState(),
        "00:30",
        Date.parse("2026-03-13T11:00:12.000Z"),
        "RUNNING",
      ),
    ).toBe("");
  });

  it("keeps the countdown panel hidden until the UI delay window has passed", () => {
    expect(
      resolveVisibleCountdownPanelLabel(
        "00:30",
        Date.parse("2026-03-16T12:00:03.000Z"),
        Date.parse("2026-03-16T12:00:05.000Z"),
        "WAITING",
      ),
    ).toBe("");

    expect(
      resolveVisibleCountdownPanelLabel(
        "00:30",
        Date.parse("2026-03-16T12:00:06.000Z"),
        Date.parse("2026-03-16T12:00:05.000Z"),
        "WAITING",
      ),
    ).toBe("00:30");
  });
});
