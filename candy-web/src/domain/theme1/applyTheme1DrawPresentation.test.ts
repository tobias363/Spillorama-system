import { describe, expect, it } from "vitest";
import { applyTheme1DrawPresentation } from "@/domain/theme1/applyTheme1DrawPresentation";
import { theme1MockSnapshot } from "@/features/theme1/data/theme1MockSnapshot";

describe("applyTheme1DrawPresentation", () => {
  it("promotes draw:new into a featured pending ball without losing the rail", () => {
    const baseModel = {
      ...theme1MockSnapshot,
      featuredBallNumber: 41,
      featuredBallIsPending: false,
      recentBalls: [3, 11, 18],
    };

    const result = applyTheme1DrawPresentation(baseModel, 27);

    expect(result.featuredBallNumber).toBe(27);
    expect(result.featuredBallIsPending).toBe(true);
    expect(result.recentBalls).toEqual([3, 11, 18, 27]);
  });

  it("marks matching bong cells immediately in purple when draw:new arrives", () => {
    const baseModel = {
      ...theme1MockSnapshot,
      featuredBallNumber: 41,
      featuredBallIsPending: false,
      recentBalls: [3, 11, 18],
    };

    const result = applyTheme1DrawPresentation(baseModel, 18);

    expect(result.boards[0]?.cells.find((cell) => cell.value === 18)?.tone).toBe("matched");
  });

  it("turns a one-to-go target cell into a matched cell as soon as its number is read", () => {
    const baseModel = {
      ...theme1MockSnapshot,
      featuredBallNumber: 41,
      featuredBallIsPending: false,
      recentBalls: [3, 11, 18],
    };

    const result = applyTheme1DrawPresentation(baseModel, 21);

    expect(result.boards[0]?.cells.find((cell) => cell.value === 21)?.tone).toBe("matched");
  });

  it("keeps bong cells idle during pending draw presentation when board marking is disabled", () => {
    const baseModel = {
      ...theme1MockSnapshot,
      featuredBallNumber: 41,
      featuredBallIsPending: false,
      recentBalls: [3, 11, 18],
    };

    const result = applyTheme1DrawPresentation(baseModel, 18, {
      markBoards: false,
    });

    expect(result.featuredBallNumber).toBe(18);
    expect(result.featuredBallIsPending).toBe(true);
    expect(result.recentBalls).toEqual([3, 11, 18]);
    expect(result.boards[0]?.cells.find((cell) => cell.value === 18)?.tone).toBe("idle");
  });

  it("clears the featured ball when there is no pending draw", () => {
    const baseModel = {
      ...theme1MockSnapshot,
      featuredBallNumber: 27,
      featuredBallIsPending: true,
      recentBalls: [3, 11, 18],
    };

    const result = applyTheme1DrawPresentation(baseModel, null);

    expect(result.featuredBallNumber).toBe(null);
    expect(result.featuredBallIsPending).toBe(false);
    expect(result.recentBalls).toEqual([3, 11, 18]);
  });
});
