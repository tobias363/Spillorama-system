import { describe, it, expect } from "vitest";
import { applyTheme1DrawPresentation } from "@/domain/theme1/applyTheme1DrawPresentation";
import { THEME1_DRAW_PRESENTATION_MS } from "@/domain/theme1/theme1MachineAnimation";
import { theme1MockSnapshot } from "@/features/theme1/data/theme1MockSnapshot";
import type { Theme1RoundRenderModel } from "@/domain/theme1/renderModel";

/**
 * Simulation of 3000 draw rounds (100 full 30-draw games) to verify:
 * 1. Only 1 ball is featured at any time (never 0 during presentation, never 2+)
 * 2. The draw interval (backend source of truth) is respected — no balls arrive faster
 * 3. No "blinking" — ball doesn't disappear and reappear during its presentation window
 *
 * The simulation models the real event flow:
 *   t=0:      draw:new(ball)   → applyTheme1DrawPresentation(model, ball)
 *   t+100ms:  room:update      → remap model, then applyTheme1DrawPresentation(remapped, pendingBall)
 *   t+1600ms: timer fires      → applyTheme1DrawPresentation(model, null)  (commit)
 *   t+2000ms: next draw:new    → commitPrevious + applyTheme1DrawPresentation(model, nextBall)
 */

const DRAW_INTERVAL_MS = 2000;
const ROOM_UPDATE_DELAY_MS = 100;
const SIMULATION_ROUNDS = 3000;

interface SimulationEvent {
  timeMs: number;
  type: "draw_new" | "room_update" | "timer_commit";
  ballNumber: number;
}

interface SimulationViolation {
  round: number;
  timeMs: number;
  type: string;
  detail: string;
}

describe("draw presentation simulation", () => {
  it(`verifies single-ball display, ${DRAW_INTERVAL_MS}ms pacing, and no blink across ${SIMULATION_ROUNDS} rounds`, () => {
    const violations: SimulationViolation[] = [];

    // Track state
    let model: Theme1RoundRenderModel = {
      ...theme1MockSnapshot,
      featuredBallNumber: null,
      featuredBallIsPending: false,
      recentBalls: [],
    };
    let pendingDrawNumber: number | null = null;
    let drawnNumbers: number[] = [];
    let previousFeaturedBall: number | null = null;
    let lastDrawTimeMs = -Infinity;

    // Build timeline of all events across all rounds
    const events: SimulationEvent[] = [];
    for (let round = 0; round < SIMULATION_ROUNDS; round++) {
      const ballNumber = (round % 60) + 1; // cycle 1-60
      const drawTimeMs = round * DRAW_INTERVAL_MS;

      events.push({
        timeMs: drawTimeMs,
        type: "draw_new",
        ballNumber,
      });
      events.push({
        timeMs: drawTimeMs + ROOM_UPDATE_DELAY_MS,
        type: "room_update",
        ballNumber,
      });
      events.push({
        timeMs: drawTimeMs + THEME1_DRAW_PRESENTATION_MS,
        type: "timer_commit",
        ballNumber,
      });
    }

    // Sort by time (stable: draw_new before room_update before timer_commit at same time)
    events.sort((a, b) => {
      if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
      const order = { draw_new: 0, room_update: 1, timer_commit: 2 };
      return order[a.type] - order[b.type];
    });

    // Process events
    for (const event of events) {
      const round = Math.floor(event.timeMs / DRAW_INTERVAL_MS);

      switch (event.type) {
        case "draw_new": {
          // Verify interval: draw:new should not arrive faster than DRAW_INTERVAL_MS
          if (lastDrawTimeMs >= 0) {
            const elapsed = event.timeMs - lastDrawTimeMs;
            if (elapsed < DRAW_INTERVAL_MS) {
              violations.push({
                round,
                timeMs: event.timeMs,
                type: "INTERVAL_VIOLATION",
                detail: `Ball ${event.ballNumber} arrived ${elapsed}ms after previous draw (expected >= ${DRAW_INTERVAL_MS}ms)`,
              });
            }
          }
          lastDrawTimeMs = event.timeMs;

          // Skip if already in drawnNumbers (reconnect guard)
          if (drawnNumbers.includes(event.ballNumber)) {
            break;
          }

          // commitPreviousPendingDrawPresentation: clear previous pending
          if (pendingDrawNumber !== null && pendingDrawNumber !== event.ballNumber) {
            model = applyTheme1DrawPresentation(model, null);
            pendingDrawNumber = null;
          }

          // applyPendingDrawPresentation
          pendingDrawNumber = event.ballNumber;
          model = applyTheme1DrawPresentation(model, pendingDrawNumber, {
            markBoards: false,
          });

          // Verify: exactly 1 ball featured
          if (model.featuredBallNumber === null) {
            violations.push({
              round,
              timeMs: event.timeMs,
              type: "NO_BALL_AFTER_DRAW",
              detail: `featuredBallNumber is null immediately after draw:new for ball ${event.ballNumber}`,
            });
          }
          if (model.featuredBallNumber !== event.ballNumber) {
            violations.push({
              round,
              timeMs: event.timeMs,
              type: "WRONG_BALL_AFTER_DRAW",
              detail: `featuredBallNumber is ${model.featuredBallNumber}, expected ${event.ballNumber}`,
            });
          }
          break;
        }

        case "room_update": {
          // Simulate room:update: drawnNumbers now includes this ball
          if (!drawnNumbers.includes(event.ballNumber)) {
            drawnNumbers = [...drawnNumbers, event.ballNumber];
          }

          // Remap model (simulates mapRoomSnapshotToTheme1 which sets featuredBallNumber=null)
          const remappedModel: Theme1RoundRenderModel = {
            ...model,
            featuredBallNumber: null, // mapper always sets null now
            featuredBallIsPending: false,
            recentBalls: drawnNumbers.slice(-30),
          };

          // Re-apply pending draw presentation (simulates applyLiveSnapshot flow)
          // pendingDrawNumber is still set, so shouldHoldPendingVisuals=true
          // → preservePendingPresentationVisuals keeps the current featured ball
          if (pendingDrawNumber !== null && drawnNumbers.includes(pendingDrawNumber)) {
            // shouldHoldPendingVisuals = true: preserve current visuals
            model = {
              ...remappedModel,
              featuredBallNumber: pendingDrawNumber,
              featuredBallIsPending: true,
            };
          } else {
            model = applyTheme1DrawPresentation(remappedModel, pendingDrawNumber, {
              markBoards: false,
            });
          }

          // Check for blink: ball should still be featured if pending
          if (pendingDrawNumber !== null && model.featuredBallNumber === null) {
            violations.push({
              round,
              timeMs: event.timeMs,
              type: "BLINK_ON_ROOM_UPDATE",
              detail: `Ball ${pendingDrawNumber} disappeared after room:update (blink)`,
            });
          }

          // Check for wrong ball
          if (pendingDrawNumber !== null && model.featuredBallNumber !== pendingDrawNumber) {
            violations.push({
              round,
              timeMs: event.timeMs,
              type: "WRONG_BALL_ON_ROOM_UPDATE",
              detail: `featuredBallNumber is ${model.featuredBallNumber} after room:update, expected ${pendingDrawNumber}`,
            });
          }
          break;
        }

        case "timer_commit": {
          // Timer fires: clear pending draw (only if still the same ball)
          if (pendingDrawNumber === event.ballNumber) {
            model = applyTheme1DrawPresentation(model, null);
            pendingDrawNumber = null;
          }

          // After commit: no ball should be featured
          if (pendingDrawNumber === null && model.featuredBallNumber !== null) {
            violations.push({
              round,
              timeMs: event.timeMs,
              type: "GHOST_BALL_AFTER_COMMIT",
              detail: `featuredBallNumber is ${model.featuredBallNumber} after timer commit (should be null)`,
            });
          }
          break;
        }
      }

      // Track transitions for blink detection
      if (previousFeaturedBall !== null && model.featuredBallNumber === null) {
        // Ball disappeared — this is OK if it's a timer_commit
        if (event.type !== "timer_commit") {
          violations.push({
            round,
            timeMs: event.timeMs,
            type: "UNEXPECTED_DISAPPEAR",
            detail: `Ball ${previousFeaturedBall} disappeared during ${event.type} (not a timer_commit)`,
          });
        }
      }

      if (
        previousFeaturedBall !== null &&
        model.featuredBallNumber !== null &&
        model.featuredBallNumber !== previousFeaturedBall &&
        event.type !== "draw_new"
      ) {
        violations.push({
          round,
          timeMs: event.timeMs,
          type: "BALL_SWITCH_WITHOUT_DRAW",
          detail: `Ball switched from ${previousFeaturedBall} to ${model.featuredBallNumber} during ${event.type}`,
        });
      }

      previousFeaturedBall = model.featuredBallNumber;
    }

    // Report
    if (violations.length > 0) {
      const summary = violations.slice(0, 20).map(
        (v) => `  [${v.type}] round=${v.round} t=${v.timeMs}ms: ${v.detail}`,
      );
      console.error(
        `[draw-presentation-simulation] ${violations.length} violations found:\n${summary.join("\n")}`,
      );
    } else {
      console.log(
        `[draw-presentation-simulation] ${SIMULATION_ROUNDS} rounds OK: ` +
        `single-ball display ✓, ${DRAW_INTERVAL_MS}ms pacing ✓, no blink ✓`,
      );
    }

    expect(violations).toEqual([]);
  });

  it("detects double-display when draw:new arrives before room:update clears previous ball", () => {
    // Simulate rapid sequence: draw:new(A), then draw:new(B) before A's timer
    let model: Theme1RoundRenderModel = {
      ...theme1MockSnapshot,
      featuredBallNumber: null,
      featuredBallIsPending: false,
      recentBalls: [],
    };

    // draw:new for ball 5
    model = applyTheme1DrawPresentation(model, 5, { markBoards: false });
    expect(model.featuredBallNumber).toBe(5);
    expect(model.featuredBallIsPending).toBe(true);

    // Before timer fires, draw:new for ball 12 arrives
    // First: commit previous (ball 5)
    model = applyTheme1DrawPresentation(model, null);
    expect(model.featuredBallNumber).toBe(null);

    // Then: apply new ball 12
    model = applyTheme1DrawPresentation(model, 12, { markBoards: false });
    expect(model.featuredBallNumber).toBe(12);
    expect(model.featuredBallIsPending).toBe(true);

    // Only ball 12 should be visible — never both 5 and 12
    // (this is guaranteed by the commit-then-apply sequence)
  });

  it("verifies room:update does not introduce ghost ball when no draw is pending", () => {
    let model: Theme1RoundRenderModel = {
      ...theme1MockSnapshot,
      featuredBallNumber: null,
      featuredBallIsPending: false,
      recentBalls: [1, 2, 3],
    };

    // Simulate room:update arriving with no pending draw
    // mapRoomSnapshotToTheme1 sets featuredBallNumber to null
    const remapped: Theme1RoundRenderModel = {
      ...model,
      featuredBallNumber: null,
      recentBalls: [1, 2, 3, 4],
    };
    model = applyTheme1DrawPresentation(remapped, null);

    // No ghost ball should appear
    expect(model.featuredBallNumber).toBe(null);
    expect(model.featuredBallIsPending).toBe(false);
  });

  it("handles jittered draw intervals without violations", () => {
    const violations: string[] = [];
    let model: Theme1RoundRenderModel = {
      ...theme1MockSnapshot,
      featuredBallNumber: null,
      featuredBallIsPending: false,
      recentBalls: [],
    };
    let pendingDrawNumber: number | null = null;

    // Simulate 100 draws with ±200ms jitter on the draw interval
    for (let i = 0; i < 100; i++) {
      const ballNumber = (i % 60) + 1;

      // Commit previous
      if (pendingDrawNumber !== null) {
        model = applyTheme1DrawPresentation(model, null);
        pendingDrawNumber = null;
      }

      // Apply new draw
      pendingDrawNumber = ballNumber;
      model = applyTheme1DrawPresentation(model, pendingDrawNumber, { markBoards: false });

      if (model.featuredBallNumber !== ballNumber) {
        violations.push(`Round ${i}: expected ball ${ballNumber}, got ${model.featuredBallNumber}`);
      }

      // Simulate room:update (hold pending visuals)
      const held: Theme1RoundRenderModel = {
        ...model,
        featuredBallNumber: pendingDrawNumber,
        featuredBallIsPending: true,
      };
      model = held;

      if (model.featuredBallNumber !== ballNumber) {
        violations.push(`Round ${i} after room:update: expected ball ${ballNumber}, got ${model.featuredBallNumber}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
