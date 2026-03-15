import { describe, expect, it } from "vitest";
import {
  resolveRailFlightDurationMs,
  resolveRailFlightVisibleScale,
} from "@/features/theme1/components/Theme1Playfield";

describe("resolveRailFlightDurationMs", () => {
  it("gives longer rail flights more time at the same speed", () => {
    expect(resolveRailFlightDurationMs(60)).toBeLessThan(resolveRailFlightDurationMs(180));
    expect(resolveRailFlightDurationMs(180)).toBeLessThan(resolveRailFlightDurationMs(300));
  });

  it("clamps very short and very long flights to safe bounds", () => {
    expect(resolveRailFlightDurationMs(10)).toBe(1800);
    expect(resolveRailFlightDurationMs(4000)).toBe(4600);
  });

  it("shrinks the ball gradually across the whole flight", () => {
    expect(resolveRailFlightVisibleScale(0, 0.2)).toBeCloseTo(1, 6);
    expect(resolveRailFlightVisibleScale(0.5, 0.2)).toBeCloseTo(0.6, 6);
    expect(resolveRailFlightVisibleScale(1, 0.2)).toBeCloseTo(0.2, 6);
  });
});
