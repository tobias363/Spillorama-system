/**
 * BongCard mark-sync tests (Tobias-direktiv 2026-05-04, Bug 3).
 *
 * Verifiserer at `markNumbers([n1, n2, ...])` er idempotent og at re-kall
 * med samme array er trygt. Dette er fundamentet for Bug 3-fixen i
 * `PlayScreen.updateInfo` — vi re-syncer `state.myMarks` til alle bonger
 * ved hver state-tikk for å håndtere `room:update` etter resync (gap-
 * detection trigget av missed `draw:new`-events).
 *
 * Test-strategi: bygg et 3×3-ticket der vi vet hvilke tall som er på,
 * markNumbers([trekkbar+ikke-trekkbar]), verifiser at trekkbar er marked
 * og ikke-trekkbar ignoreres. Re-kjør markNumbers og bekreft at samme
 * sluttilstand opprettholdes (Set-add er idempotent).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BongCard } from "./BongCard.js";
import type { Ticket } from "@spillorama/shared-types/game";

function makeFakeTicket(numbers: number[]): Ticket {
  // 3×3 grid med 9 tall — bruker spec-strukturen Spill 2 sender.
  const grid: number[][] = [
    [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0],
    [numbers[3] ?? 0, numbers[4] ?? 0, numbers[5] ?? 0],
    [numbers[6] ?? 0, numbers[7] ?? 0, numbers[8] ?? 0],
  ];
  return {
    id: "t-1",
    color: "Standard",
    type: "game2-3x3",
    grid,
    drawnNumbers: [],
  } as unknown as Ticket;
}

describe("BongCard — markNumbers idempotency (Tobias 2026-05-04, Bug 3)", () => {
  let card: BongCard;

  beforeEach(() => {
    card = new BongCard({ colorKey: "yellow", label: "Standard", price: 10 });
  });

  afterEach(() => {
    card.destroy({ children: true });
  });

  it("markNumbers([n]) markerer celler som matcher; ignorerer celler som ikke er på bongen", () => {
    const ticket = makeFakeTicket([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    card.loadTicket(ticket, []);
    expect(card.getRemainingCount()).toBe(9);

    // Mark 5 (on grid) + 99 (not on grid) — resultat: 8 igjen, ikke 7.
    card.markNumbers([5, 99]);
    expect(card.getRemainingCount()).toBe(8);
  });

  it("markNumbers([5, 5]) er idempotent — dobbelt-mark teller én gang", () => {
    const ticket = makeFakeTicket([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    card.loadTicket(ticket, []);
    card.markNumbers([5, 5]);
    expect(card.getRemainingCount()).toBe(8);
  });

  it("re-mark av samme set (snapshot-resync-flow) er trygt og endrer ingen state", () => {
    const ticket = makeFakeTicket([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    card.loadTicket(ticket, []);
    card.markNumbers([3, 5]);
    const remainingAfterFirst = card.getRemainingCount();
    expect(remainingAfterFirst).toBe(7);

    // Simuler en `room:update` etter resync — server sender samme marks.
    card.markNumbers([3, 5]);
    expect(card.getRemainingCount()).toBe(remainingAfterFirst);
  });

  it("delvis overlappende markNumbers — kun nye numre påvirker remaining", () => {
    const ticket = makeFakeTicket([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    card.loadTicket(ticket, [1, 2]);
    expect(card.getRemainingCount()).toBe(7);

    // Server sender oppdatert mark-state med 1,2 (allerede markert) + 3,4 (nytt).
    card.markNumbers([1, 2, 3, 4]);
    expect(card.getRemainingCount()).toBe(5);
  });
});
