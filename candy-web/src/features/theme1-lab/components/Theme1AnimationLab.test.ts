import { describe, expect, it } from "vitest";
import { resolveVisibleRecentBalls } from "@/features/theme1/components/Theme1GameShell";

describe("Theme1AnimationLab rail visibility contract", () => {
  it("keeps the very first pending ball out of the visible rail", () => {
    expect(resolveVisibleRecentBalls([34], 34, true)).toEqual([]);
  });

  it("keeps a pending drawn ball out of the visible rail just like the game shell", () => {
    expect(resolveVisibleRecentBalls([34, 47], 47, true)).toEqual([34]);
  });

  it("shows the full visible rail once the pending ball has settled", () => {
    expect(resolveVisibleRecentBalls([34, 47], 47, false)).toEqual([34, 47]);
  });
});
