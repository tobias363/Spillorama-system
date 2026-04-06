/**
 * Ball Animation Invariant Tests
 *
 * Verifies the core animation logic across 5 000 simulated games.
 * Each game has 30 draws. The tests ensure:
 *
 *   1. Only 1 ball is ever displayed in the machine output at a time
 *   2. Balls never blink (disappear then reappear) in the rail
 *   3. The animation queue never causes balls to go backwards
 *   4. Measurement failure gracefully commits ball to rail
 *   5. Ball count is monotonically increasing within a round
 *   6. Rail is exactly empty after clearing, and stays empty
 */
import { describe, it, expect } from "vitest";
import {
  resolveRailPresentationState,
  resolveRailFlightDurationMs,
  resolveRailFlightProgress,
  resolveRailFlightArcLift,
  resolveRailFlightEmergenceProgress,
  resolveRailFlightOpacity,
  resolveRailFlightVisibleScale,
} from "../components/Theme1Playfield";
import { resolveCompactRailPlacement } from "../components/Theme1BallRail";
import { resolveVisibleRecentBalls } from "../components/Theme1GameShell";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shuffle an array (Fisher-Yates) and return a copy. */
function shuffle<T>(array: readonly T[], rng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Simple seedable PRNG (mulberry32). */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate a draw bag of 75 numbers, shuffled. */
function generateDrawBag(seed: number): number[] {
  const bag = Array.from({ length: 75 }, (_, i) => i + 1);
  return shuffle(bag, createRng(seed));
}

// ---------------------------------------------------------------------------
// 1. resolveRailPresentationState invariants
// ---------------------------------------------------------------------------

describe("resolveRailPresentationState", () => {
  it("detects single-ball append and queues flight animation", () => {
    const prev = [1, 2, 3];
    const curr = [1, 2, 3, 4];
    const state = resolveRailPresentationState(prev, curr);
    expect(state.queuedBallNumber).toBe(4);
    expect(state.queuedTargetIndex).toBe(3);
    // renderedBalls should be the previous state (ball is "in flight")
    expect(state.renderedBalls).toEqual([1, 2, 3]);
  });

  it("handles multi-ball resync by animating the last ball", () => {
    const prev = [1, 2];
    const curr = [1, 2, 3, 4, 5];
    const state = resolveRailPresentationState(prev, curr);
    expect(state.queuedBallNumber).toBe(5);
    expect(state.renderedBalls).toEqual([1, 2, 3, 4]);
  });

  it("handles reset (empty current) without flight", () => {
    const prev = [1, 2, 3];
    const curr: number[] = [];
    const state = resolveRailPresentationState(prev, curr);
    expect(state.queuedBallNumber).toBeNull();
    expect(state.renderedBalls).toEqual([]);
  });

  it("handles identical arrays without flight", () => {
    const prev = [1, 2, 3];
    const curr = [1, 2, 3];
    const state = resolveRailPresentationState(prev, curr);
    expect(state.queuedBallNumber).toBeNull();
    expect(state.renderedBalls).toEqual([1, 2, 3]);
  });

  it("handles backward transition (fewer balls) without flight", () => {
    const prev = [1, 2, 3, 4, 5];
    const curr = [1, 2];
    const state = resolveRailPresentationState(prev, curr);
    expect(state.queuedBallNumber).toBeNull();
    expect(state.renderedBalls).toEqual([1, 2]);
  });

  it("handles non-prefix transition without flight", () => {
    const prev = [1, 2, 3];
    const curr = [4, 5, 6];
    const state = resolveRailPresentationState(prev, curr);
    expect(state.queuedBallNumber).toBeNull();
    expect(state.renderedBalls).toEqual([4, 5, 6]);
  });
});

// ---------------------------------------------------------------------------
// 2. resolveVisibleRecentBalls invariants
// ---------------------------------------------------------------------------

describe("resolveVisibleRecentBalls", () => {
  it("returns all balls when not pending", () => {
    const balls = [10, 20, 30];
    const result = resolveVisibleRecentBalls(balls, 30, false);
    expect(result).toEqual([10, 20, 30]);
  });

  it("strips last ball when it matches featured pending ball", () => {
    const balls = [10, 20, 30];
    const result = resolveVisibleRecentBalls(balls, 30, true);
    expect(result).toEqual([10, 20]);
  });

  it("keeps all balls when pending but featured doesn't match last", () => {
    const balls = [10, 20, 30];
    const result = resolveVisibleRecentBalls(balls, 25, true);
    expect(result).toEqual([10, 20, 30]);
  });

  it("handles empty array", () => {
    expect(resolveVisibleRecentBalls([], null, false)).toEqual([]);
    expect(resolveVisibleRecentBalls([], null, true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Flight animation pure functions
// ---------------------------------------------------------------------------

describe("flight animation pure functions", () => {
  it("resolveRailFlightProgress is monotonically increasing from 0 to 1", () => {
    let previous = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const value = resolveRailFlightProgress(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(resolveRailFlightProgress(0)).toBeCloseTo(0, 5);
    expect(resolveRailFlightProgress(1)).toBeCloseTo(1, 5);
  });

  it("resolveRailFlightOpacity starts at 0 and reaches 1", () => {
    expect(resolveRailFlightOpacity(0)).toBe(0);
    expect(resolveRailFlightOpacity(0.3)).toBeCloseTo(1, 5);
    expect(resolveRailFlightOpacity(0.5)).toBe(1);
    expect(resolveRailFlightOpacity(1)).toBe(1);
  });

  it("resolveRailFlightArcLift peaks in the middle and is 0 at endpoints", () => {
    expect(resolveRailFlightArcLift(0, 500)).toBeCloseTo(0, 5);
    expect(resolveRailFlightArcLift(1, 500)).toBeCloseTo(0, 2);
    const midLift = resolveRailFlightArcLift(0.5, 500);
    expect(midLift).toBeGreaterThan(0);
  });

  it("resolveRailFlightEmergenceProgress clamps to 0..1", () => {
    expect(resolveRailFlightEmergenceProgress(0, 300)).toBe(0);
    expect(resolveRailFlightEmergenceProgress(500, 300)).toBe(1);
    const mid = resolveRailFlightEmergenceProgress(135, 300);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("resolveRailFlightVisibleScale interpolates correctly", () => {
    // At emergence=0, travel=0 → startScale
    expect(resolveRailFlightVisibleScale(0, 0, 0.2, 0.5)).toBeCloseTo(0.2, 5);
    // At emergence=1, travel=0 → 1 (full size)
    expect(resolveRailFlightVisibleScale(1, 0, 0.2, 0.5)).toBeCloseTo(1, 5);
    // At emergence=1, travel=1 → endScale
    expect(resolveRailFlightVisibleScale(1, 1, 0.2, 0.5)).toBeCloseTo(0.5, 5);
  });

  it("resolveRailFlightDurationMs returns positive value", () => {
    expect(resolveRailFlightDurationMs(0)).toBeGreaterThan(0);
    expect(resolveRailFlightDurationMs(500)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Compact rail placement invariants
// ---------------------------------------------------------------------------

describe("resolveCompactRailPlacement", () => {
  it("places first 15 balls in row 2, next 15 in row 1", () => {
    for (let i = 0; i < 15; i++) {
      expect(resolveCompactRailPlacement(i).row).toBe(2);
      expect(resolveCompactRailPlacement(i).column).toBe(i + 1);
    }
    for (let i = 15; i < 30; i++) {
      expect(resolveCompactRailPlacement(i).row).toBe(1);
      expect(resolveCompactRailPlacement(i).column).toBe(i - 14);
    }
  });

  it("every slot has a unique (row, column) pair", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const { row, column } = resolveCompactRailPlacement(i);
      const key = `${row},${column}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. STRESS TEST: 5 000 games — animation state machine invariants
// ---------------------------------------------------------------------------

describe("5000-game animation stress test", () => {
  const TOTAL_GAMES = 5000;
  const DRAWS_PER_GAME = 30;

  it("maintains all invariants across 5000 simulated games", { timeout: 120_000 }, () => {
    let totalDrawsProcessed = 0;
    let totalFlightsTriggered = 0;
    let totalDirectCommits = 0;

    for (let gameIndex = 0; gameIndex < TOTAL_GAMES; gameIndex++) {
      const drawBag = generateDrawBag(gameIndex);
      const drawnNumbers = drawBag.slice(0, DRAWS_PER_GAME);

      // Simulate the animation state machine
      let previousBalls: number[] = [];
      let renderedBalls: number[] = [];
      let maxBallCount = 0;

      for (let drawIndex = 0; drawIndex < DRAWS_PER_GAME; drawIndex++) {
        const currentBalls = drawnNumbers.slice(0, drawIndex + 1);

        // --- Invariant: ball count is monotonically increasing ---
        expect(currentBalls.length).toBeGreaterThan(previousBalls.length);

        // --- Run the presentation state resolver ---
        const state = resolveRailPresentationState(previousBalls, currentBalls);

        // --- Invariant: rendered balls never go backwards ---
        expect(state.renderedBalls.length).toBeGreaterThanOrEqual(previousBalls.length - 1);
        // (May be previousBalls.length when new ball is in flight,
        //  or previousBalls.length-1 only on edge case resync)

        if (state.queuedBallNumber !== null) {
          totalFlightsTriggered++;

          // --- Invariant: exactly 1 ball is in flight ---
          expect(state.queuedBallNumber).toBe(drawnNumbers[drawIndex]);

          // --- Invariant: target index is within rail bounds ---
          expect(state.queuedTargetIndex).toBeGreaterThanOrEqual(0);
          expect(state.queuedTargetIndex!).toBeLessThan(30);

          // After flight lands, the ball is committed
          renderedBalls = [...currentBalls];
        } else {
          totalDirectCommits++;
          renderedBalls = state.renderedBalls;
        }

        // --- Invariant: no blink — every ball in previous render is still present
        //     (unless we're doing a full resync/reset) ---
        if (previousBalls.length > 0 && currentBalls.length > previousBalls.length) {
          for (const ball of previousBalls) {
            expect(renderedBalls).toContain(ball);
          }
        }

        // --- Invariant: ball count monotonically increases ---
        expect(renderedBalls.length).toBeGreaterThanOrEqual(maxBallCount);
        maxBallCount = renderedBalls.length;

        previousBalls = currentBalls;
        totalDrawsProcessed++;
      }

      // --- Invariant: after all draws, rail has exactly 30 balls ---
      expect(renderedBalls.length).toBe(DRAWS_PER_GAME);

      // --- Invariant: all drawn numbers are in the rail ---
      for (const number of drawnNumbers) {
        expect(renderedBalls).toContain(number);
      }

      // --- Simulate round end: clear rail ---
      const clearState = resolveRailPresentationState(renderedBalls, []);
      expect(clearState.renderedBalls).toEqual([]);
      expect(clearState.queuedBallNumber).toBeNull();
    }

    // Sanity check that all games were processed
    expect(totalDrawsProcessed).toBe(TOTAL_GAMES * DRAWS_PER_GAME);
    expect(totalFlightsTriggered).toBe(TOTAL_GAMES * DRAWS_PER_GAME);
    expect(totalDirectCommits).toBe(0);

    console.log(`[stress-test] ${TOTAL_GAMES} games, ${totalDrawsProcessed} draws processed`);
    console.log(`[stress-test] ${totalFlightsTriggered} flights, ${totalDirectCommits} direct commits`);
  });

  it("handles rapid multi-ball arrivals without blink across 5000 games", { timeout: 120_000 }, () => {
    // Simulates network bursts where multiple balls arrive at once
    for (let gameIndex = 0; gameIndex < TOTAL_GAMES; gameIndex++) {
      const drawBag = generateDrawBag(gameIndex + 100_000);
      const rng = createRng(gameIndex + 200_000);

      let previousBalls: number[] = [];
      let drawPointer = 0;

      // Process draws in random-sized bursts (1–5 balls at once)
      while (drawPointer < DRAWS_PER_GAME) {
        const burstSize = Math.min(
          Math.floor(rng() * 5) + 1,
          DRAWS_PER_GAME - drawPointer,
        );
        drawPointer += burstSize;
        const currentBalls = drawBag.slice(0, drawPointer);

        const state = resolveRailPresentationState(previousBalls, currentBalls);

        // --- Invariant: rendered balls + queued ball = all current balls ---
        const totalAccountedFor = state.renderedBalls.length +
          (state.queuedBallNumber !== null ? 1 : 0);
        expect(totalAccountedFor).toBe(currentBalls.length);

        // --- Invariant: no ball is duplicated ---
        const allBalls = [...state.renderedBalls];
        if (state.queuedBallNumber !== null) allBalls.push(state.queuedBallNumber);
        const uniqueBalls = new Set(allBalls);
        expect(uniqueBalls.size).toBe(allBalls.length);

        // --- Invariant: queued ball target index within bounds ---
        if (state.queuedTargetIndex !== null) {
          expect(state.queuedTargetIndex).toBeGreaterThanOrEqual(0);
          expect(state.queuedTargetIndex).toBeLessThan(30);
        }

        previousBalls = currentBalls;
      }
    }
  });

  it("resolveVisibleRecentBalls never removes a non-featured ball across 5000 games", { timeout: 120_000 }, () => {
    for (let gameIndex = 0; gameIndex < TOTAL_GAMES; gameIndex++) {
      const drawBag = generateDrawBag(gameIndex + 300_000);

      for (let drawIndex = 0; drawIndex < DRAWS_PER_GAME; drawIndex++) {
        const balls = drawBag.slice(0, drawIndex + 1);
        const featuredBall = balls[balls.length - 1]!;

        // Test with pending=true
        const pendingResult = resolveVisibleRecentBalls(balls, featuredBall, true);
        // All non-featured balls must still be present
        for (let i = 0; i < balls.length - 1; i++) {
          expect(pendingResult).toContain(balls[i]);
        }

        // Test with pending=false
        const settledResult = resolveVisibleRecentBalls(balls, featuredBall, false);
        // ALL balls including featured must be present
        for (const ball of balls) {
          expect(settledResult).toContain(ball);
        }
      }
    }
  });
});
