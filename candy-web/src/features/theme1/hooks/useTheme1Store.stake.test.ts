import { describe, expect, it } from "vitest";
import {
  clampStakeAmount,
  resolveAdjustedStakeAmount,
  resolveStakeAmountBeforeArming,
} from "@/features/theme1/hooks/useTheme1Store";

describe("theme1 stake controls", () => {
  it("uses 4 kr steps up to 20 kr", () => {
    expect(resolveAdjustedStakeAmount(0, 4)).toBe(4);
    expect(resolveAdjustedStakeAmount(4, 4)).toBe(8);
    expect(resolveAdjustedStakeAmount(8, 4)).toBe(12);
    expect(resolveAdjustedStakeAmount(12, 4)).toBe(16);
    expect(resolveAdjustedStakeAmount(16, 4)).toBe(20);
    expect(resolveAdjustedStakeAmount(20, 4)).toBe(20);
  });

  it("steps back down to 0 kr", () => {
    expect(resolveAdjustedStakeAmount(20, -4)).toBe(16);
    expect(resolveAdjustedStakeAmount(8, -4)).toBe(4);
    expect(resolveAdjustedStakeAmount(4, -4)).toBe(0);
    expect(resolveAdjustedStakeAmount(0, -4)).toBe(0);
  });

  it("clamps arbitrary stake values to valid total stake steps", () => {
    expect(clampStakeAmount(2)).toBe(0);
    expect(clampStakeAmount(6)).toBe(4);
    expect(clampStakeAmount(21)).toBe(20);
    expect(clampStakeAmount(99)).toBe(20);
  });

  it("auto-arms to 4 kr when the current stake is 0 kr", () => {
    expect(resolveStakeAmountBeforeArming(0)).toBe(4);
    expect(resolveStakeAmountBeforeArming(4)).toBe(4);
    expect(resolveStakeAmountBeforeArming(12)).toBe(12);
  });
});
