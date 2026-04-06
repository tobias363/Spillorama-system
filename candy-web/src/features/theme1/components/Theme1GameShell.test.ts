import { describe, expect, it } from "vitest";
import { resolveVisibleRecentBalls } from "@/features/theme1/components/Theme1GameShell";

describe("resolveVisibleRecentBalls", () => {
  it("keeps the pending featured ball out of the visible rail until it is settled", () => {
    expect(resolveVisibleRecentBalls([34, 47], 47, true)).toEqual([34]);
  });

  it("shows the full rail when the featured ball is no longer pending", () => {
    expect(resolveVisibleRecentBalls([34, 47], 47, false)).toEqual([34, 47]);
  });

  it("does not trim the rail when the featured ball does not match the newest recent ball", () => {
    expect(resolveVisibleRecentBalls([34, 47], 12, true)).toEqual([34, 47]);
  });
});
