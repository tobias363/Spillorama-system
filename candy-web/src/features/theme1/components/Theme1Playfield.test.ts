import { describe, expect, it } from "vitest";
import {
  resolveRailFlightDurationMs,
  resolveRailFlightVisibleScale,
} from "@/features/theme1/components/Theme1Playfield";

describe("resolveRailFlightDurationMs", () => {
  it("keeps the same transfer duration for every rail slot", () => {
    expect(resolveRailFlightDurationMs(10)).toBe(3200);
    expect(resolveRailFlightDurationMs(180)).toBe(3200);
    expect(resolveRailFlightDurationMs(4000)).toBe(3200);
  });

  it("shrinks the ball gradually across the whole flight", () => {
    expect(resolveRailFlightVisibleScale(0, 0.2)).toBeCloseTo(1, 6);
    expect(resolveRailFlightVisibleScale(0.5, 0.2)).toBeCloseTo(0.6, 6);
    expect(resolveRailFlightVisibleScale(1, 0.2)).toBeCloseTo(0.2, 6);
  });
});
