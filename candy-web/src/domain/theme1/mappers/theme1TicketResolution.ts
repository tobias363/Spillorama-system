import type { Player, RoomSnapshot, Ticket } from "@/domain/realtime/contracts";
import {
  THEME1_CARD_CELL_COUNT,
} from "@/domain/theme1/renderModel";
import { THEME1_MAX_BALL_NUMBER } from "@/domain/theme1/theme1RuntimeConfig";

export type Theme1RoomTicketSource = "currentGame" | "preRoundTickets" | "empty";

export interface Theme1ResolvedPlayerContext {
  playerId?: string;
  player?: Player;
  tickets: Ticket[];
  source: Theme1RoomTicketSource;
}

export function resolvePlayerContext(
  snapshot: RoomSnapshot,
  preferredPlayerId?: string,
): Theme1ResolvedPlayerContext {
  const gameTicketMap = snapshot.currentGame?.tickets ?? {};
  const preRoundTicketMap = snapshot.preRoundTickets ?? {};
  const currentGameStatus = snapshot.currentGame?.status;
  const shouldUseCurrentGameTickets = currentGameStatus === "RUNNING";
  const normalizedPreferredPlayerId = preferredPlayerId?.trim();

  if (normalizedPreferredPlayerId) {
    const gameTickets = gameTicketMap[normalizedPreferredPlayerId];
    if (
      shouldUseCurrentGameTickets &&
      Array.isArray(gameTickets) &&
      gameTickets.length > 0
    ) {
      return {
        playerId: normalizedPreferredPlayerId,
        player: snapshot.players.find((player) => player.id === normalizedPreferredPlayerId),
        tickets: gameTickets,
        source: "currentGame",
      };
    }

    const preRoundTickets = preRoundTicketMap[normalizedPreferredPlayerId];
    if (Array.isArray(preRoundTickets) && preRoundTickets.length > 0) {
      return {
        playerId: normalizedPreferredPlayerId,
        player: snapshot.players.find((player) => player.id === normalizedPreferredPlayerId),
        tickets: preRoundTickets,
        source: "preRoundTickets",
      };
    }

    return {
      playerId: normalizedPreferredPlayerId,
      player: snapshot.players.find((player) => player.id === normalizedPreferredPlayerId),
      tickets: [],
      source: "empty",
    };
  }

  const gameTicketKeys = Object.keys(gameTicketMap);
  const preRoundTicketKeys = Object.keys(preRoundTicketMap);
  const candidatePlayerIds = uniqueStrings([
    ...(gameTicketKeys.length === 1 ? gameTicketKeys : []),
    ...(preRoundTicketKeys.length === 1 ? preRoundTicketKeys : []),
    snapshot.hostPlayerId,
    ...gameTicketKeys,
    ...preRoundTicketKeys,
    ...snapshot.players.map((player) => player.id),
  ]);

  for (const playerId of candidatePlayerIds) {
    const gameTickets = gameTicketMap[playerId];
    if (
      shouldUseCurrentGameTickets &&
      Array.isArray(gameTickets) &&
      gameTickets.length > 0
    ) {
      return {
        playerId,
        player: snapshot.players.find((player) => player.id === playerId),
        tickets: gameTickets,
        source: "currentGame",
      };
    }

    const preRoundTickets = preRoundTicketMap[playerId];
    if (Array.isArray(preRoundTickets) && preRoundTickets.length > 0) {
      return {
        playerId,
        player: snapshot.players.find((player) => player.id === playerId),
        tickets: preRoundTickets,
        source: "preRoundTickets",
      };
    }
  }

  const fallbackPlayerId =
    candidatePlayerIds[0] ?? snapshot.players[0]?.id ?? undefined;

  return {
    playerId: fallbackPlayerId,
    player: snapshot.players.find((player) => player.id === fallbackPlayerId),
    tickets: [],
    source: "empty",
  };
}

export function resolveVisibleTickets(
  ticketSets: readonly number[][],
  cardSlotCount: number,
  currentTicketPage: number,
  duplicateSingleTicketAcrossCards: boolean,
): number[][] {
  const visibleTickets: number[][] = Array.from(
    { length: cardSlotCount },
    () => createEmptyTicketNumbers(),
  );
  const pageStartIndex = Math.max(0, currentTicketPage) * Math.max(1, cardSlotCount);

  for (let cardIndex = 0; cardIndex < cardSlotCount; cardIndex += 1) {
    const ticketIndex = pageStartIndex + cardIndex;
    const directTicket = ticketSets[ticketIndex];
    const duplicatedTicket =
      ticketSets.length === 1 && duplicateSingleTicketAcrossCards
        ? ticketSets[0]
        : undefined;
    visibleTickets[cardIndex] = normalizeTicketNumbers(
      directTicket ?? duplicatedTicket,
    );
  }

  return visibleTickets;
}

export function flattenTicketNumbers(ticket: Ticket): number[] {
  if (Array.isArray(ticket.numbers) && ticket.numbers.length > 0) {
    return normalizeTicketNumbers(ticket.numbers);
  }

  if (!Array.isArray(ticket.grid) || ticket.grid.length === 0) {
    return createEmptyTicketNumbers();
  }

  const flattened = ticket.grid.flatMap((row) =>
    Array.isArray(row) ? row : [],
  );
  return normalizeTicketNumbers(flattened);
}

export function normalizeTicketNumbers(source?: readonly number[]): number[] {
  return Array.from({ length: THEME1_CARD_CELL_COUNT }, (_, index) =>
    normalizeTheme1Number(source?.[index] ?? 0),
  );
}

export function createEmptyTicketNumbers(): number[] {
  return Array.from({ length: THEME1_CARD_CELL_COUNT }, () => 0);
}

function normalizeTheme1Number(value: number): number {
  return Number.isInteger(value) && value > 0 && value <= THEME1_MAX_BALL_NUMBER
    ? value
    : 0;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}
