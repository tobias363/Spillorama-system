/**
 * @vitest-environment happy-dom
 *
 * CenterBall tests (BIN-420 G23 — scheduler pause-bug).
 *
 * Unity-refs:
 *   - `Game1GamePlayPanel.SocketFlow.cs:672-696` — scheduler is server-authoritative.
 *     When the room is paused, the scheduler emits a frozen `millisUntilNextStart`
 *     and no decrement happens until resume. The client mirrors this by NOT
 *     ticking down the displayed countdown while `state.isPaused === true`.
 *
 * We assert that:
 *   1. While `isPaused === true`, the displayed number does not change.
 *   2. While not paused, the countdown ticks down normally.
 *   3. Toggling pause → resume resumes ticking.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CenterBall } from "./CenterBall.js";

function getDisplayedText(ball: CenterBall): string {
  // The last child is the numberText Text (Sprite child is added after async
  // load, so in happy-dom we only ever have [numberText]).
  // Access via private — safe for test.
  // @ts-expect-error — private field access for assertion only.
  return ball.numberText.text as string;
}

describe("CenterBall.startCountdown — pause-hook (Unity scheduler 672-696)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks down when not paused", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.startCountdown(5_000);
    // Initial display is 5 (ceil).
    expect(getDisplayedText(ball)).toBe("5");

    vi.advanceTimersByTime(1_100);
    // Should have ticked down by ~1 s.
    const after1s = Number(getDisplayedText(ball));
    expect(after1s).toBeLessThanOrEqual(4);
    expect(after1s).toBeGreaterThanOrEqual(3);

    ball.stopCountdown();
    ball.destroy();
  });

  it("does NOT tick down while bridge.isPaused === true", () => {
    const bridgeState = { isPaused: true };
    const ball = new CenterBall({ getState: () => bridgeState });
    ball.startCountdown(5_000);
    const initial = getDisplayedText(ball);

    // Advance 3 seconds of "wall clock" — but paused, so display must hold.
    vi.advanceTimersByTime(3_000);
    expect(getDisplayedText(ball)).toBe(initial);

    ball.stopCountdown();
    ball.destroy();
  });

  it("resumes ticking after pause → resume", () => {
    const bridgeState = { isPaused: true };
    const ball = new CenterBall({ getState: () => bridgeState });
    ball.startCountdown(10_000);
    const initial = getDisplayedText(ball);

    // Paused 4s — no change.
    vi.advanceTimersByTime(4_000);
    expect(getDisplayedText(ball)).toBe(initial);

    // Un-pause — ticking resumes.
    bridgeState.isPaused = false;
    vi.advanceTimersByTime(2_100);
    const afterResume = Number(getDisplayedText(ball));
    expect(afterResume).toBeLessThan(Number(initial));

    ball.stopCountdown();
    ball.destroy();
  });

  it("stopCountdown clears the interval", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.startCountdown(5_000);
    ball.stopCountdown();
    // After stopCountdown, advancing timers does not throw and text stays
    // stable (interval was cleared).
    const snapshot = getDisplayedText(ball);
    vi.advanceTimersByTime(5_000);
    expect(getDisplayedText(ball)).toBe(snapshot);
    ball.destroy();
  });
});
