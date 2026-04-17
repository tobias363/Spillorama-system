import { DomainError } from "./BingoEngine.js";

export function assertTicketsPerPlayerWithinHallLimit(
  ticketsPerPlayer: number | undefined,
  hallMaxTicketsPerPlayer: number
): void {
  if (!Number.isInteger(hallMaxTicketsPerPlayer) || hallMaxTicketsPerPlayer < 1 || hallMaxTicketsPerPlayer > 30) {
    throw new DomainError(
      "INVALID_HALL_CONFIG",
      "Hall-konfigurasjon for maxTicketsPerPlayer må være et heltall mellom 1 og 30."
    );
  }

  if (ticketsPerPlayer === undefined) {
    return;
  }

  if (ticketsPerPlayer > hallMaxTicketsPerPlayer) {
    throw new DomainError(
      "TICKETS_ABOVE_HALL_LIMIT",
      `ticketsPerPlayer kan ikke være høyere enn hall-grense (${hallMaxTicketsPerPlayer}).`
    );
  }
}
