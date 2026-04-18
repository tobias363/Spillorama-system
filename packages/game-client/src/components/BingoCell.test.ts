/**
 * BingoCell animation-lifecycle tests (BIN-414 PR-4 E1).
 *
 * Covers the dual stop-API introduced in PR-4:
 *   - stopBlink()        → soft-stop of 1-to-go pulse during active play
 *   - stopAllAnimations() → hard reset at game-end / scene reset
 *
 * Unity parity refs:
 *   - BingoTicketSingleCellData.Stop_NumberBlink (:195-205)
 *   - BingoTicket.Stop_Blink (:1011-1016)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import gsap from "gsap";
import { BingoCell } from "./BingoCell.js";

describe("BingoCell — stopAllAnimations (BIN-414 PR-4 E1)", () => {
  let cell: BingoCell;

  beforeEach(() => {
    cell = new BingoCell({ size: 44, number: 17 });
  });

  afterEach(() => {
    cell.destroy({ children: true });
  });

  it("stopAllAnimations clears blink state and snaps scale to 1:1 without tweening", () => {
    cell.startBlink(0xb0d4a1);
    // A blink timeline was registered on this target.
    expect(gsap.getTweensOf(cell.scale).length).toBeGreaterThan(0);

    cell.stopAllAnimations();

    expect(gsap.getTweensOf(cell.scale).length).toBe(0);
    expect(cell.scale.x).toBe(1);
    expect(cell.scale.y).toBe(1);
    // Internal blink-state (via behavior): a subsequent startBlink must
    // actually start a new timeline — i.e. the `blinking` guard was reset.
    cell.startBlink();
    expect(gsap.getTweensOf(cell.scale).length).toBeGreaterThan(0);
  });

  it("stopAllAnimations kills a residual mark() scale tween (0.12s yoyo)", () => {
    // mark() kicks off a 0.12s yoyo scale tween.
    cell.mark();
    expect(gsap.getTweensOf(cell.scale).length).toBeGreaterThan(0);

    cell.stopAllAnimations();

    expect(gsap.getTweensOf(cell.scale).length).toBe(0);
    expect(cell.scale.x).toBe(1);
    expect(cell.scale.y).toBe(1);
  });

  it("stopAllAnimations is idempotent and safe on an idle cell", () => {
    expect(() => cell.stopAllAnimations()).not.toThrow();
    expect(cell.scale.x).toBe(1);
    expect(cell.scale.y).toBe(1);
    // Second call also fine.
    expect(() => cell.stopAllAnimations()).not.toThrow();
  });
});
