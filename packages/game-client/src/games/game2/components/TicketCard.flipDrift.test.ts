/**
 * TicketCard flip-drift regression (BIN-687).
 *
 * Bug: `flipToDetails()` sets `pivot.x = cardW/2` and `this.x += cardW/2`
 * so the scaleX animation pivots around the card's centre. `flipToGrid()`
 * tweened the scale back but **never reset `pivot.x` or the x-offset**,
 * so every flip accumulated another `cardW/2` on `this.x`. After a few
 * taps the card had drifted sideways and ended up behind its neighbour.
 *
 * Fix: reset pivot.x + x-offset in `flipToGrid()`'s inner `onComplete`,
 * mirroring what `stopAllAnimations()` already does on game-end.
 *
 * This test doesn't animate in real time — it fast-forwards every queued
 * gsap tween on `card.scale` to completion so the flip state-machine
 * progresses synchronously (the 2nd tween is scheduled inside the 1st's
 * onComplete, so we loop until no tweens remain).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import gsap from "gsap";
import { TicketCard } from "./TicketCard.js";

/** Synchronously drive every pending scale-tween to its `onComplete`. */
function drainFlipTweens(card: TicketCard): void {
  // Safety bound: each flip queues 2 tweens; we allow a generous budget so
  // a runaway chain fails loudly instead of hanging the runner.
  for (let i = 0; i < 10; i++) {
    const tweens = gsap.getTweensOf(card.scale);
    if (tweens.length === 0) return;
    for (const t of tweens) t.progress(1);
  }
  throw new Error("drainFlipTweens exceeded iteration budget — tween chain did not terminate");
}

describe("TicketCard.flipToGrid — BIN-687 drift regression", () => {
  let card: TicketCard;
  let initialX: number;

  beforeEach(() => {
    card = new TicketCard(0);
    // Simulate a positioned card (e.g. laid out by TicketOverlay at x=120).
    card.x = 120;
    initialX = card.x;
  });

  afterEach(() => {
    card.destroy({ children: true });
  });

  it("restores x and pivot.x to their pre-flip values after a full flip cycle", () => {
    card.flipToDetails();
    drainFlipTweens(card);
    // Auto-timer is scheduled inside onComplete — cancel via flipToGrid.
    card.flipToGrid();
    drainFlipTweens(card);

    expect(card.x).toBe(initialX);
    expect(card.pivot.x).toBe(0);
  });

  it("does NOT drift across three back-to-back flip cycles", () => {
    for (let i = 0; i < 3; i++) {
      card.flipToDetails();
      drainFlipTweens(card);
      card.flipToGrid();
      drainFlipTweens(card);
    }

    expect(card.x).toBe(initialX);
    expect(card.pivot.x).toBe(0);
  });

  it("applies the pivot offset mid-flip (front of flipToDetails)", () => {
    // Sanity check the intermediate state so a future refactor that
    // removes the pivot-around-centre behaviour doesn't silently regress
    // the visual "flip around the card's vertical centre" effect.
    card.flipToDetails();
    // Drain just the first tween (scale x → 0) by progressing its
    // current tween to completion.
    const first = gsap.getTweensOf(card.scale);
    expect(first.length).toBe(1);
    expect(card.pivot.x).toBeGreaterThan(0);
    expect(card.x).toBe(initialX + card.pivot.x);

    // Finish both tweens + the flip-back so afterEach leaves a clean card.
    drainFlipTweens(card);
    card.flipToGrid();
    drainFlipTweens(card);
  });
});
