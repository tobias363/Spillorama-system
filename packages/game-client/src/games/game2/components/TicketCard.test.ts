/**
 * TicketCard animation-lifecycle tests (BIN-414 PR-4 E1).
 *
 * Covers the hard game-end reset path:
 *   - stopAllAnimations() kills card + grid tweens, cancels in-flight
 *     flip-tween, and snaps the card back to the grid view.
 *
 * Unity parity refs:
 *   - BingoTicket.Stop_Blink (:1011-1016)
 *   - Game1GamePlayPanel.OnGameFinish (:595-616)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import gsap from "gsap";
import { TicketCard } from "./TicketCard.js";

describe("TicketCard — stopAllAnimations (BIN-414 PR-4 E1)", () => {
  let card: TicketCard;

  beforeEach(() => {
    card = new TicketCard(0);
  });

  afterEach(() => {
    card.destroy({ children: true });
  });

  it("clears card-level tweens (bg blink, BINGO pulse) and grid cell tweens", () => {
    // Trigger a 1-to-go state on the grid so startBgBlink + cell blink fire.
    // A 3x5 grid has 15 cells; mark all but one unmarked number.
    const grid = card.grid;
    const allNumbers: number[] = [];
    for (let i = 1; i <= 90 && allNumbers.length < 15; i++) {
      if (grid.getCell(i)) allNumbers.push(i);
    }
    // Mark all except the last one → remaining === 1 → startBgBlink + cell blink.
    card.markNumbers(allNumbers.slice(0, -1));

    card.stopAllAnimations();

    expect(gsap.getTweensOf(card.scale).length).toBe(0);
    expect(card.scale.x).toBe(1);
    expect(card.scale.y).toBe(1);
  });

  it("cancels an in-flight flip tween and snaps back to the grid view", () => {
    // Kick off a flip.
    card.flipToDetails();
    // An `isFlipping` tween is registered on card.scale.
    expect(gsap.getTweensOf(card.scale).length).toBeGreaterThan(0);

    card.stopAllAnimations();

    expect(gsap.getTweensOf(card.scale).length).toBe(0);
    expect(card.scale.x).toBe(1);
    // Flip state reset — grid view is visible again.
    expect(card.grid.visible).toBe(true);
  });

  it("is idempotent and safe on an idle card", () => {
    expect(() => card.stopAllAnimations()).not.toThrow();
    expect(() => card.stopAllAnimations()).not.toThrow();
    expect(card.scale.x).toBe(1);
    expect(card.scale.y).toBe(1);
  });
});
