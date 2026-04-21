import type { TicketCard } from "../components/TicketCard.js";

/**
 * Sort tickets by "best card first" — fewest remaining unmarked cells.
 */
export function sortByBestFirst(cards: TicketCard[]): void {
  cards.sort((a, b) => a.getRemainingCount() - b.getRemainingCount());
}
