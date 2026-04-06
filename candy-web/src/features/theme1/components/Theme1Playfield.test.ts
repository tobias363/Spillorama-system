import { describe, expect, it } from "vitest";
import {
  resolveRailFlightDurationMs,
  resolveRailFlightGeometry,
  resolveRailFlightOpacity,
  resolveRailPresentationState,
  resolveRailFlightVisibleScale,
} from "@/features/theme1/components/Theme1Playfield";

describe("resolveRailFlightDurationMs", () => {
  it("keeps the same transfer duration for every rail slot", () => {
    expect(resolveRailFlightDurationMs(10)).toBe(1500);
    expect(resolveRailFlightDurationMs(180)).toBe(1500);
    expect(resolveRailFlightDurationMs(4000)).toBe(1500);
  });

  it("grows out of the hole before shrinking toward the target slot", () => {
    expect(resolveRailFlightVisibleScale(0, 0, 0.22, 0.2)).toBeCloseTo(0.22, 6);
    expect(resolveRailFlightVisibleScale(1, 0, 0.22, 0.2)).toBeCloseTo(1, 6);
    expect(resolveRailFlightVisibleScale(1, 1, 0.22, 0.2)).toBeCloseTo(0.2, 6);
  });

  it("fades in during emergence and reaches full opacity", () => {
    expect(resolveRailFlightOpacity(0)).toBeCloseTo(0, 6);
    expect(resolveRailFlightOpacity(0.15)).toBeCloseTo(0.5, 6);
    expect(resolveRailFlightOpacity(0.3)).toBeCloseTo(1, 6);
    expect(resolveRailFlightOpacity(1)).toBeCloseTo(1, 6);
  });

  it("uses the shifted hole start point when calculating the landing delta", () => {
    expect(
      resolveRailFlightGeometry(
        { left: 0, top: 0 } as DOMRect,
        { left: 100, top: 200, width: 60, height: 60 } as DOMRect,
        { left: 400, top: 260, width: 58, height: 58 } as DOMRect,
      ),
    ).toEqual({
      startX: 129,
      startY: 236,
      deltaX: 300,
      deltaY: 53,
    });
  });
});

describe("resolveRailPresentationState", () => {
  it("keeps the first drawn ball out of the rail until its flight completes", () => {
    expect(resolveRailPresentationState([], [34])).toEqual({
      renderedBalls: [],
      queuedBallNumber: 34,
      queuedTargetIndex: 0,
    });
  });

  it("keeps the newly appended ball out of the rail until flight completes", () => {
    expect(resolveRailPresentationState([34], [34, 47])).toEqual({
      renderedBalls: [34],
      queuedBallNumber: 47,
      queuedTargetIndex: 1,
    });
  });

  it("keeps every later appended ball out of the rail until its own flight completes", () => {
    expect(resolveRailPresentationState([34, 47], [34, 47, 12])).toEqual({
      renderedBalls: [34, 47],
      queuedBallNumber: 12,
      queuedTargetIndex: 2,
    });
  });

  it("renders the full rail immediately when there is no single appended ball", () => {
    expect(resolveRailPresentationState([34, 47], [34, 47])).toEqual({
      renderedBalls: [34, 47],
      queuedBallNumber: null,
      queuedTargetIndex: null,
    });
  });

  it("animates the last ball and renders the rest immediately after a multi-ball resync", () => {
    expect(resolveRailPresentationState([34], [34, 47, 12])).toEqual({
      renderedBalls: [34, 47],
      queuedBallNumber: 12,
      queuedTargetIndex: 2,
    });
  });
});
