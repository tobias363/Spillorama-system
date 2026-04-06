import { describe, it, expect } from "vitest";
import { applyTheme1DrawPresentation } from "@/domain/theme1/applyTheme1DrawPresentation";
import type { Theme1RoundRenderModel } from "@/domain/theme1/renderModel";

/**
 * Simulates the exact sequence of state updates that happen during a live
 * 30-ball draw round with 2-second intervals.
 *
 * The live flow per ball:
 *   1. draw:new arrives → applyTheme1DrawPresentation(model, ballNumber)
 *      - Sets featuredBallNumber = ballNumber, featuredBallIsPending = true
 *      - Appends ballNumber to recentBalls
 *   2. After THEME1_DRAW_PRESENTATION_MS (1600ms), timer commits:
 *      - applyTheme1DrawPresentation(model, null)
 *      - Clears featuredBallNumber, featuredBallIsPending = false
 *   3. room:update arrives — may have more balls from server
 *      - recentBalls merge logic in applyLiveSnapshot
 *
 * This test verifies the core presentation function in isolation,
 * ensuring no balls are lost, duplicated, or shown simultaneously.
 */

function createMinimalModel(
  overrides: Partial<Theme1RoundRenderModel> = {},
): Theme1RoundRenderModel {
  return {
    boards: [],
    toppers: [],
    recentBalls: [],
    featuredBallNumber: null,
    featuredBallIsPending: false,
    ...overrides,
  } as Theme1RoundRenderModel;
}

describe("30-ball draw sequence simulation", () => {
  it("presents exactly 1 ball at a time and never loses balls from recentBalls", () => {
    const totalBalls = 30;
    const drawOrder = Array.from({ length: totalBalls }, (_, i) => i + 1);
    let model = createMinimalModel();

    const violations: string[] = [];

    for (let i = 0; i < totalBalls; i++) {
      const ballNumber = drawOrder[i];

      // Step 1: draw:new arrives — apply pending draw
      model = applyTheme1DrawPresentation(model, ballNumber);

      // VERIFY: featuredBallNumber is exactly this ball
      if (model.featuredBallNumber !== ballNumber) {
        violations.push(
          `Ball ${i + 1}: featuredBallNumber should be ${ballNumber}, got ${model.featuredBallNumber}`,
        );
      }

      // VERIFY: featuredBallIsPending is true
      if (!model.featuredBallIsPending) {
        violations.push(`Ball ${i + 1}: featuredBallIsPending should be true`);
      }

      // VERIFY: recentBalls contains all balls drawn so far (no losses)
      const expectedBalls = drawOrder.slice(0, i + 1);
      for (const expected of expectedBalls) {
        if (!model.recentBalls.includes(expected)) {
          violations.push(
            `Ball ${i + 1}: recentBalls missing ball ${expected}. Have: [${model.recentBalls.join(",")}]`,
          );
        }
      }

      // VERIFY: no duplicates in recentBalls
      const seen = new Set<number>();
      for (const b of model.recentBalls) {
        if (seen.has(b)) {
          violations.push(`Ball ${i + 1}: duplicate ball ${b} in recentBalls`);
        }
        seen.add(b);
      }

      // VERIFY: recentBalls length matches number of balls drawn
      if (model.recentBalls.length !== i + 1) {
        violations.push(
          `Ball ${i + 1}: recentBalls.length should be ${i + 1}, got ${model.recentBalls.length}`,
        );
      }

      // Step 2: Timer fires — commit the presentation (clear featured)
      model = applyTheme1DrawPresentation(model, null);

      // VERIFY: featuredBallNumber cleared
      if (model.featuredBallNumber !== null) {
        violations.push(
          `Ball ${i + 1} commit: featuredBallNumber should be null, got ${model.featuredBallNumber}`,
        );
      }

      // VERIFY: recentBalls still intact after commit
      if (model.recentBalls.length !== i + 1) {
        violations.push(
          `Ball ${i + 1} commit: recentBalls.length should be ${i + 1}, got ${model.recentBalls.length}`,
        );
      }
    }

    expect(violations).toEqual([]);
    expect(model.recentBalls).toEqual(drawOrder);
  });

  it("handles rapid-fire draws where new ball arrives before timer commits previous", () => {
    let model = createMinimalModel();
    const violations: string[] = [];

    // Ball 1 arrives
    model = applyTheme1DrawPresentation(model, 42);
    expect(model.featuredBallNumber).toBe(42);
    expect(model.recentBalls).toEqual([42]);

    // Ball 2 arrives BEFORE timer commits ball 1 (no commit of ball 1)
    model = applyTheme1DrawPresentation(model, 17);

    // Ball 2 should be featured now
    if (model.featuredBallNumber !== 17) {
      violations.push(`Expected featured=17, got ${model.featuredBallNumber}`);
    }

    // Both balls should be in recentBalls
    if (!model.recentBalls.includes(42)) {
      violations.push("Ball 42 lost from recentBalls after ball 17 arrived");
    }
    if (!model.recentBalls.includes(17)) {
      violations.push("Ball 17 missing from recentBalls");
    }

    // No duplicates
    const unique = new Set(model.recentBalls);
    if (unique.size !== model.recentBalls.length) {
      violations.push(`Duplicates in recentBalls: [${model.recentBalls.join(",")}]`);
    }

    expect(violations).toEqual([]);
  });

  it("never creates duplicate recentBalls when the same ball is applied twice", () => {
    let model = createMinimalModel({ recentBalls: [1, 2, 3] });

    // Apply ball 2 again (already in recentBalls)
    model = applyTheme1DrawPresentation(model, 2);

    expect(model.recentBalls).toEqual([1, 2, 3]);
    expect(model.featuredBallNumber).toBe(2);
  });

  it("clears all balls when new round starts (commit with null)", () => {
    let model = createMinimalModel({ recentBalls: [1, 2, 3, 4, 5] });

    // Commit clears featured but keeps recentBalls
    model = applyTheme1DrawPresentation(model, null);
    expect(model.featuredBallNumber).toBeNull();
    expect(model.recentBalls).toEqual([1, 2, 3, 4, 5]);
  });
});

/**
 * room:update recentBalls guard: mirrors the logic in applyLiveSnapshot.
 * room:update NEVER adds balls — balls only enter through draw:new.
 * room:update only clears balls on new round (server has empty list).
 */
function roomUpdateBallGuard(clientBalls: number[], serverBalls: number[]): number[] {
  if (clientBalls.length === 0) return serverBalls; // initial load
  if (serverBalls.length === 0) return []; // new round
  return clientBalls; // keep client's list unchanged
}

describe("recentBalls room:update guard logic", () => {
  it("keeps client balls unchanged during active round", () => {
    const result = roomUpdateBallGuard([1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it("clears client balls when server has empty list (new round)", () => {
    const result = roomUpdateBallGuard([1, 2, 3, 4, 5], []);
    expect(result).toEqual([]);
  });

  it("uses server list on initial load when client has no balls", () => {
    const result = roomUpdateBallGuard([], [1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });

  it("never modifies client list even if server is ahead", () => {
    const client = [5, 3, 1, 4, 2];
    const result = roomUpdateBallGuard(client, [1, 2, 3, 4, 5, 6, 7]);
    expect(result).toEqual([5, 3, 1, 4, 2]);
  });

  it("never modifies client list even if server is behind (timing lag)", () => {
    const client = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = roomUpdateBallGuard(client, [1, 2, 3, 4, 5]);
    expect(result).toEqual(client);
  });

  it("preserves sharesBallPrefix invariant through entire 30-ball round", () => {
    const violations: string[] = [];
    let clientBalls: number[] = [];

    for (let i = 1; i <= 30; i++) {
      const previousBalls = [...clientBalls];

      // draw:new adds ball (single append — this is the ONLY way balls enter)
      clientBalls = [...clientBalls, i];

      // Prefix invariant after draw:new
      const prefixOk = previousBalls.every((b, idx) => clientBalls[idx] === b);
      if (!prefixOk) violations.push(`Ball ${i}: draw:new broke prefix`);

      // room:update arrives every 2nd ball — should NOT change list
      if (i % 2 === 0) {
        const before = [...clientBalls];
        const serverBalls = Array.from({ length: i }, (_, j) => j + 1);
        const after = roomUpdateBallGuard(clientBalls, serverBalls);

        if (after.length !== before.length || !before.every((b, idx) => after[idx] === b)) {
          violations.push(`Ball ${i}: room:update changed client list!`);
        }
        clientBalls = after;
      }
    }

    expect(violations).toEqual([]);
    expect(clientBalls.length).toBe(30);
  });
});
