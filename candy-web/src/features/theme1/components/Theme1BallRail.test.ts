import { describe, expect, it } from "vitest";
import { resolveCompactRailPlacement } from "@/features/theme1/components/Theme1BallRail";

describe("resolveCompactRailPlacement", () => {
  it("fills the first 15 balls on the bottom row from left to right", () => {
    expect(resolveCompactRailPlacement(0)).toEqual({ row: 2, column: 1 });
    expect(resolveCompactRailPlacement(4)).toEqual({ row: 2, column: 5 });
    expect(resolveCompactRailPlacement(14)).toEqual({ row: 2, column: 15 });
  });

  it("starts the second row above the first after the fifteenth ball", () => {
    expect(resolveCompactRailPlacement(15)).toEqual({ row: 1, column: 1 });
    expect(resolveCompactRailPlacement(16)).toEqual({ row: 1, column: 2 });
    expect(resolveCompactRailPlacement(29)).toEqual({ row: 1, column: 15 });
  });
});
