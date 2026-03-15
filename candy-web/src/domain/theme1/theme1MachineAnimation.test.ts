import { describe, expect, it } from "vitest";
import {
  THEME1_DRAW_PRESENTATION_MS,
  THEME1_MACHINE_TIMINGS,
  deriveTheme1MachinePresentationState,
} from "@/domain/theme1/theme1MachineAnimation";

describe("theme1MachineAnimation", () => {
  it("keeps the draw presentation window in sync with machine timings", () => {
    expect(THEME1_MACHINE_TIMINGS.totalMs).toBe(1600);
    expect(THEME1_DRAW_PRESENTATION_MS).toBe(1600);
  });

  it("starts with all 60 balls available when nothing has been drawn", () => {
    const result = deriveTheme1MachinePresentationState({
      recentBalls: [],
      featuredBallNumber: null,
      featuredBallIsPending: false,
    });

    expect(result.availableBallNumbers).toHaveLength(60);
    expect(result.outputBallNumber).toBeNull();
  });

  it("removes already drawn balls from the globe and keeps the latest drawn ball as output", () => {
    const result = deriveTheme1MachinePresentationState({
      recentBalls: [41, 17, 6],
      featuredBallNumber: 6,
      featuredBallIsPending: false,
    });

    expect(result.availableBallNumbers).not.toContain(41);
    expect(result.availableBallNumbers).not.toContain(17);
    expect(result.availableBallNumbers).not.toContain(6);
    expect(result.availableBallNumbers).toHaveLength(57);
    expect(result.outputBallNumber).toBe(6);
  });

  it("uses the pending featured ball as stable output when resuming mid-animation", () => {
    const result = deriveTheme1MachinePresentationState({
      recentBalls: [41, 17, 6],
      featuredBallNumber: 6,
      featuredBallIsPending: true,
    });

    expect(result.availableBallNumbers).toHaveLength(57);
    expect(result.outputBallNumber).toBe(6);
  });
});
