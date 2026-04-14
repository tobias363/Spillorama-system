import { describe, it, expect } from "vitest";
import { sortByBestFirst } from "./TicketSorter.js";

// TicketCard is a heavy PixiJS Container — we stub only what sortByBestFirst needs.
function fakeCard(remaining: number) {
  return { getRemainingCount: () => remaining } as any;
}

describe("sortByBestFirst", () => {
  it("sorts cards with fewest remaining first", () => {
    const cards = [fakeCard(5), fakeCard(1), fakeCard(3)];
    sortByBestFirst(cards);
    expect(cards.map((c) => c.getRemainingCount())).toEqual([1, 3, 5]);
  });

  it("preserves order for equal remaining counts", () => {
    const a = fakeCard(2);
    const b = fakeCard(2);
    const c = fakeCard(1);
    const cards = [a, b, c];
    sortByBestFirst(cards);
    expect(cards[0]).toBe(c);
    // a and b both have 2 remaining — stable sort preserves original order
    expect(cards[1]).toBe(a);
    expect(cards[2]).toBe(b);
  });

  it("handles single card", () => {
    const cards = [fakeCard(7)];
    sortByBestFirst(cards);
    expect(cards[0].getRemainingCount()).toBe(7);
  });

  it("handles empty array", () => {
    const cards: any[] = [];
    sortByBestFirst(cards);
    expect(cards).toEqual([]);
  });

  it("puts completed card (0 remaining) first", () => {
    const cards = [fakeCard(3), fakeCard(0), fakeCard(1)];
    sortByBestFirst(cards);
    expect(cards.map((c) => c.getRemainingCount())).toEqual([0, 1, 3]);
  });
});
