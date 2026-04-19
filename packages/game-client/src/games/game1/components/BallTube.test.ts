/**
 * BallTube colour-mapping tests (PR-5 C2 — Bingo75 column colours).
 *
 * Game 1 runs on the 75-ball bag — backend/src/util/roomState.ts:115 uses
 * generateBingo75Ticket for gameSlug "bingo". The tube's colour partition
 * must therefore be 5 columns × 15 balls (B/I/N/G/O), not 5 × 12 (Databingo60).
 *
 * Unity parity: Utility.GetGame1BallSprite (Utility.cs:183-195) keys on a
 * colour *string* from the server payload, but Spillorama doesn't emit
 * colour strings — BallTube derives colour from the ball number via the
 * canonical 75-ball column partition.
 */
import { describe, it, expect } from "vitest";
import { getBallColor, getMoveAnimationTime } from "./BallTube.js";

// Palette (hex) — reused in CalledNumbersOverlay tests to keep the two
// surfaces visually consistent.
const BLUE_CENTER = 0x3a7adf;
const RED_CENTER = 0xe84040;
const PURPLE_CENTER = 0xcc44cc;
const GREEN_CENTER = 0x6ecf3a;
const YELLOW_CENTER = 0xf0c020;

describe("BallTube.getBallColor — Bingo75 column partition", () => {
  it("column B (1-15) is blue", () => {
    expect(getBallColor(1).center).toBe(BLUE_CENTER);
    expect(getBallColor(8).center).toBe(BLUE_CENTER);
    expect(getBallColor(15).center).toBe(BLUE_CENTER);
  });

  it("column I (16-30) is red", () => {
    expect(getBallColor(16).center).toBe(RED_CENTER);
    expect(getBallColor(23).center).toBe(RED_CENTER);
    expect(getBallColor(30).center).toBe(RED_CENTER);
  });

  it("column N (31-45) is purple", () => {
    expect(getBallColor(31).center).toBe(PURPLE_CENTER);
    expect(getBallColor(38).center).toBe(PURPLE_CENTER);
    expect(getBallColor(45).center).toBe(PURPLE_CENTER);
  });

  it("column G (46-60) is green", () => {
    expect(getBallColor(46).center).toBe(GREEN_CENTER);
    expect(getBallColor(53).center).toBe(GREEN_CENTER);
    expect(getBallColor(60).center).toBe(GREEN_CENTER);
  });

  it("column O (61-75) is yellow", () => {
    expect(getBallColor(61).center).toBe(YELLOW_CENTER);
    expect(getBallColor(68).center).toBe(YELLOW_CENTER);
    expect(getBallColor(75).center).toBe(YELLOW_CENTER);
  });

  it("column boundaries flip at 15/16, 30/31, 45/46, 60/61", () => {
    expect(getBallColor(15).center).toBe(BLUE_CENTER);
    expect(getBallColor(16).center).toBe(RED_CENTER);
    expect(getBallColor(30).center).toBe(RED_CENTER);
    expect(getBallColor(31).center).toBe(PURPLE_CENTER);
    expect(getBallColor(45).center).toBe(PURPLE_CENTER);
    expect(getBallColor(46).center).toBe(GREEN_CENTER);
    expect(getBallColor(60).center).toBe(GREEN_CENTER);
    expect(getBallColor(61).center).toBe(YELLOW_CENTER);
  });

  it("returns matching edge + glow triplet (not just center)", () => {
    const blue = getBallColor(1);
    expect(blue).toEqual({ center: 0x3a7adf, edge: 0x0d2f8a, glow: 0x2850dc });
    const yellow = getBallColor(75);
    expect(yellow).toEqual({ center: 0xf0c020, edge: 0x8a7000, glow: 0xc8a814 });
  });
});

/**
 * BIN-619 Bug 6: Unity-parity move-time values at showcaseCount=5, limit=6,
 * MOVE_TIME=0.5s. These numerics are the contract with
 * `BingoBallPanelManager.cs:249 GetAnimationTime`. Any drift here means the
 * tube animates at a different pace than Unity — break the test before
 * touching the formula.
 *
 *   activeBefore=0 → (6-0)*0.5/6 = 0.5
 *   activeBefore=1 → (6-1)*0.5/6 ≈ 0.4167
 *   activeBefore=2 → (6-2)*0.5/6 ≈ 0.3333
 *   activeBefore=3 → (6-3)*0.5/6 = 0.25
 *   activeBefore=4 → (6-4)*0.5/6 ≈ 0.1667
 *   activeBefore=5 → overflow branch (6-5+1)*0.5/6 ≈ 0.1667
 */
describe("BallTube.getMoveAnimationTime — Unity-parity move-time", () => {
  const showcase = 5;
  // Use a small epsilon for 1/6 = 0.16666... floats.
  const near = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThan(0.0001);

  it("empty tube: full 0.5s slide for first ball", () => {
    near(getMoveAnimationTime(0, showcase), 0.5);
  });

  it("accelerates as tube fills", () => {
    near(getMoveAnimationTime(1, showcase), 5 / 12);   // 0.4167
    near(getMoveAnimationTime(2, showcase), 4 / 12);   // 0.3333
    near(getMoveAnimationTime(3, showcase), 3 / 12);   // 0.25
    near(getMoveAnimationTime(4, showcase), 2 / 12);   // 0.1667
  });

  it("overflow branch matches last pre-overflow step (Unity formula +1)", () => {
    // activeBefore=5 = showcaseCount → overflow branch kicks in.
    // Formula: (limit - active + 1) * MOVE_TIME / limit = (6-5+1)*0.5/6 = 1/6
    near(getMoveAnimationTime(5, showcase), 1 / 6);
  });

  it("scales correctly for a larger showcaseCount", () => {
    // showcaseCount=10, limit=11. Empty-tube should still be 0.5s.
    near(getMoveAnimationTime(0, 10), 0.5);
    near(getMoveAnimationTime(5, 10), (11 - 5) * 0.5 / 11); // 3/11 ≈ 0.2727
  });
});
