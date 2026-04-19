/**
 * @vitest-environment happy-dom
 *
 * WheelOverlay tests (BIN-420 G21 — 50-segment redesign).
 *
 * Unity-refs:
 *   - `SpinWheelScript.cs:174,180,186` — 50 physical segments × 7.2° per segment,
 *     initial -3.6° offset, prize labels repeat modulo prizeList length.
 *   - `SpinWheelScript.cs:85` — per-frame decay `rotationSpeed *= rMultiplier`
 *     (0.96). Web reproduces via raf-loop with identical math.
 *   - `SpinWheelScript.cs:199` — final jitter `± 3.25°` around target angle.
 *   - `SpinWheelScript.cs:490` — pause-hook freezes auto-spin countdown.
 *
 * We assert the structural + behavioural contract without actually rendering
 * PixiJS pixels — the component is loaded in happy-dom with a minimal canvas
 * stub (PixiJS can be instantiated headlessly for our purposes).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WheelOverlay, __WheelOverlay_NUM_SEGMENTS__ } from "./WheelOverlay.js";

// Minimal bridge stub for pause-hook tests.
function makeBridge(isPaused = false): { getState: () => { isPaused: boolean } } {
  return { getState: () => ({ isPaused }) };
}

describe("WheelOverlay — 50 segments (Unity SpinWheelScript.cs:180)", () => {
  it("exposes the Unity-mandated 50-segment constant", () => {
    expect(__WheelOverlay_NUM_SEGMENTS__).toBe(50);
  });

  it("builds the wheel with 50 segment graphics + 50 prize labels + 1 ring", () => {
    const overlay = new WheelOverlay(800, 600, makeBridge());
    // wheelInner is the first child of wheelContainer which is the 3rd top-level
    // child (backdrop, title, wheelContainer). Segments = 50 fills + 50 labels
    // = 100 children, plus the outer ring = 101.
    const wheelContainer = overlay.children[2] as { children: unknown[] };
    const inner = wheelContainer.children[0] as { children: unknown[] };
    expect(inner.children.length).toBe(50 + 50 + 1);
    overlay.destroy();
  });
});

describe("WheelOverlay — pause-hook (Unity SpinWheelScript.cs:490)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT decrement auto-spin countdown while bridge.isPaused === true", () => {
    const bridgeState = { isPaused: true };
    const overlay = new WheelOverlay(800, 600, { getState: () => bridgeState });
    overlay.show({
      type: "wheelOfFortune",
      prizeList: [100, 200, 500, 1000],
      durationMs: 10000,
    } as never);

    // Spy on onPlay — auto-spin fires onPlay when countdown hits 0.
    const onPlay = vi.fn();
    overlay.setOnPlay(onPlay);

    // Advance 15s while paused — countdown should NOT fire.
    vi.advanceTimersByTime(15000);
    expect(onPlay).not.toHaveBeenCalled();

    // Un-pause, then advance — onPlay should fire within ~10s.
    bridgeState.isPaused = false;
    vi.advanceTimersByTime(11000);
    expect(onPlay).toHaveBeenCalledTimes(1);

    overlay.destroy();
  });

  it("ticks countdown normally when not paused", () => {
    const overlay = new WheelOverlay(800, 600, makeBridge(false));
    overlay.show({
      type: "wheelOfFortune",
      prizeList: [100, 200, 500, 1000],
      durationMs: 10000,
    } as never);

    const onPlay = vi.fn();
    overlay.setOnPlay(onPlay);

    vi.advanceTimersByTime(11000);
    expect(onPlay).toHaveBeenCalledTimes(1);
    overlay.destroy();
  });
});
