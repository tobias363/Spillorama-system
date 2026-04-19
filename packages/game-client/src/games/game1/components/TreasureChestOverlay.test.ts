/**
 * @vitest-environment happy-dom
 *
 * TreasureChestOverlay tests (BIN-420 G22 — Unity parity polish).
 *
 * Unity-refs:
 *   - `TreasureChestPanel.cs:541-542` — client-side shuffle of prize list
 *     (`OrderBy(Guid.NewGuid())`) so players don't see the same chest order
 *     every round. Cosmetic — server still picks the winning index.
 *   - `TreasureChestPanel.cs:611` — 12 s auto-back after reveal (was 5 s in
 *     web port before this change).
 *   - `TreasureChestPanel.cs:633,643` — pause-hook: countdowns freeze while
 *     the round is paused (server-authoritative state).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TreasureChestOverlay,
  shufflePrizes,
  __TreasureChest_AUTO_BACK_SECONDS__,
} from "./TreasureChestOverlay.js";

function makeBridge(isPaused = false): { getState: () => { isPaused: boolean } } {
  return { getState: () => ({ isPaused }) };
}

describe("TreasureChestOverlay — auto-back delay (Unity 12 s, was 5 s)", () => {
  it("uses 12 s auto-back (not 5 s) per TreasureChestPanel.cs:611", () => {
    expect(__TreasureChest_AUTO_BACK_SECONDS__).toBe(12);
  });
});

describe("shufflePrizes — Unity OrderBy(Guid.NewGuid()) parity", () => {
  it("returns a permutation of the input (same length, same elements)", () => {
    const input = [10, 20, 30, 40, 50, 60, 70, 80];
    const shuffled = shufflePrizes(input);
    expect(shuffled).toHaveLength(input.length);
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(input.slice().sort((a, b) => a - b));
  });

  it("can produce a different order than the input (deterministic with stubbed Math.random)", () => {
    // Stub Math.random so the Fisher–Yates swaps always use index 0 — this
    // produces a predictable rotation that differs from the input ordering.
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const input = [1, 2, 3, 4, 5];
      const shuffled = shufflePrizes(input);
      expect(shuffled).not.toEqual(input);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not mutate the source array", () => {
    const input = [1, 2, 3, 4];
    const snapshot = input.slice();
    shufflePrizes(input);
    expect(input).toEqual(snapshot);
  });
});

describe("TreasureChestOverlay — pause-hook (Unity TreasureChestPanel.cs:633)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT auto-select while bridge.isPaused === true", () => {
    const bridgeState = { isPaused: true };
    const overlay = new TreasureChestOverlay(800, 600, { getState: () => bridgeState });
    const onPlay = vi.fn();
    overlay.setOnPlay(onPlay);
    overlay.show({
      type: "treasureChest",
      prizeList: [100, 200, 300, 400, 500, 600, 700, 800],
      durationMs: 10000,
    } as never);

    // Paused — no auto-select even after 30s.
    vi.advanceTimersByTime(30000);
    expect(onPlay).not.toHaveBeenCalled();

    // Resume — auto-select fires within the 10s countdown.
    bridgeState.isPaused = false;
    vi.advanceTimersByTime(11000);
    expect(onPlay).toHaveBeenCalledTimes(1);

    overlay.destroy();
  });

  it("renders one chest per prizeList entry (matches backend-driven count)", () => {
    const overlay = new TreasureChestOverlay(800, 600, makeBridge());
    const prizeList = [100, 200, 300, 400, 500, 600, 700, 800]; // 8 (Unity default)
    overlay.show({
      type: "treasureChest",
      prizeList,
      durationMs: 10000,
    } as never);

    // @ts-expect-error — accessing private chests for test assertion.
    expect(overlay.chests.length).toBe(prizeList.length);
    overlay.destroy();
  });
});
