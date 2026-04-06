import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RealtimeRoomSnapshot } from "@/domain/realtime/contracts";
import { mapRoomSnapshotToTheme1 } from "@/domain/theme1/mappers/mapRoomSnapshotToTheme1";
import {
  THEME1_DEFAULT_ACTIVE_PATTERN_INDEXES,
  THEME1_DEFAULT_PATTERN_MASKS,
  resolveTheme1TopperPayoutAmounts,
} from "@/domain/theme1/theme1RuntimeConfig";
import { Theme1BoardGrid } from "@/features/theme1/components/Theme1BoardGrid";

const ROUND_COUNT = 1000;
const TOTAL_BET_KR = 8;
const CARD_COUNT = 4;
const MAX_DRAWS = 30;
const MAX_NUMBER = 60;

interface SimulationTicket {
  numbers: number[];
  grid: number[][];
}

interface SimulationSummary {
  rounds: number;
  totalTurnoverKr: number;
  boardsWithNearState: number;
  renderedNearLineLeaks: number;
  falseNearStateLeaks: number;
  prematureCompletedPatternLeaks: number;
}

function createMulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createShuffledNumbers(random: () => number, size: number) {
  const values = Array.from({ length: size }, (_, index) => index + 1);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex]!, values[index]!];
  }
  return values;
}

function createTicket(random: () => number): SimulationTicket {
  const numbers = createShuffledNumbers(random, MAX_NUMBER).slice(0, 15);
  return {
    numbers,
    grid: [
      numbers.slice(0, 5),
      numbers.slice(5, 10),
      numbers.slice(10, 15),
    ],
  };
}

function createSnapshot(
  drawnNumbers: number[],
  tickets: SimulationTicket[],
  gameId: string,
): RealtimeRoomSnapshot {
  return {
    code: "SIM1000",
    hallId: "hall-sim",
    hostPlayerId: "player-1",
    createdAt: "2026-03-15T12:00:00.000Z",
    players: [
      {
        id: "player-1",
        name: "Sim Player",
        walletId: "wallet-sim",
        balance: 100000,
      },
    ],
    currentGame: {
      id: gameId,
      status: drawnNumbers.length >= MAX_DRAWS ? "ENDED" : "RUNNING",
      entryFee: TOTAL_BET_KR,
      ticketsPerPlayer: CARD_COUNT,
      prizePool: TOTAL_BET_KR,
      remainingPrizePool: TOTAL_BET_KR,
      payoutPercent: 75,
      maxPayoutBudget: TOTAL_BET_KR,
      remainingPayoutBudget: TOTAL_BET_KR,
      drawnNumbers,
      remainingNumbers: MAX_NUMBER - drawnNumbers.length,
      claims: [],
      tickets: {
        "player-1": tickets,
      },
      marks: {
        "player-1": [],
      },
      startedAt: "2026-03-15T12:00:00.000Z",
    },
    preRoundTickets: undefined,
    gameHistory: [],
    scheduler: {
      enabled: true,
      liveRoundsIndependentOfBet: false,
      intervalMs: 30000,
      minPlayers: 1,
      playerCount: 1,
      armedPlayerCount: 1,
      armedPlayerIds: ["player-1"],
      entryFee: TOTAL_BET_KR,
      payoutPercent: 75,
      drawCapacity: 60,
      currentDrawCount: drawnNumbers.length,
      remainingDrawCapacity: MAX_NUMBER - drawnNumbers.length,
      nextStartAt: null,
      millisUntilNextStart: null,
      canStartNow: false,
      serverTime: "2026-03-15T12:00:00.000Z",
    },
  };
}

function runSimulation(rounds: number): SimulationSummary {
  const random = createMulberry32(20260315);
  let boardsWithNearState = 0;
  let renderedNearLineLeaks = 0;
  let falseNearStateLeaks = 0;
  let prematureCompletedPatternLeaks = 0;

  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const tickets = Array.from({ length: CARD_COUNT }, () => createTicket(random));
    const drawBag = createShuffledNumbers(random, MAX_NUMBER);

    for (let drawCount = 1; drawCount <= MAX_DRAWS; drawCount += 1) {
      const drawnNumbers = drawBag.slice(0, drawCount);
      const drawnSet = new Set(drawnNumbers);
      const snapshot = createSnapshot(drawnNumbers, tickets, `game-${roundIndex}`);
      const result = mapRoomSnapshotToTheme1(snapshot, {
        playerId: "player-1",
        cardSlotCount: CARD_COUNT,
        activePatternIndexes: THEME1_DEFAULT_ACTIVE_PATTERN_INDEXES,
        patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
        topperPayoutAmounts: resolveTheme1TopperPayoutAmounts(TOTAL_BET_KR),
      });

      for (let boardIndex = 0; boardIndex < result.model.boards.length; boardIndex += 1) {
        const board = result.model.boards[boardIndex]!;
        const card = result.renderState.cards[boardIndex]!;
        const ticket = tickets[boardIndex]!;

        if (board.activeNearPatterns.length > 0) {
          boardsWithNearState += 1;
          const markup = renderToStaticMarkup(<Theme1BoardGrid boards={[board]} />);
          if (markup.includes("board__pattern-layer--near")) {
            renderedNearLineLeaks += 1;
          }
        }

        for (const nearPattern of card.activeNearPatterns) {
          const matchedCount = nearPattern.cellIndices.filter((cellIndex) =>
            drawnSet.has(ticket.numbers[cellIndex] ?? -1),
          ).length;
          const targetNumber = ticket.numbers[nearPattern.targetCellIndex] ?? -1;
          if (
            drawnSet.has(targetNumber) ||
            matchedCount !== nearPattern.cellIndices.length - 1
          ) {
            falseNearStateLeaks += 1;
          }
        }

        for (const pattern of card.completedPatterns) {
          const isComplete = pattern.cellIndices.every((cellIndex) =>
            drawnSet.has(ticket.numbers[cellIndex] ?? -1),
          );
          if (!isComplete) {
            prematureCompletedPatternLeaks += 1;
          }
        }
      }
    }
  }

  return {
    rounds,
    totalTurnoverKr: rounds * TOTAL_BET_KR,
    boardsWithNearState,
    renderedNearLineLeaks,
    falseNearStateLeaks,
    prematureCompletedPatternLeaks,
  };
}

describe("theme1 pattern visibility simulation", () => {
  it(
    "keeps bong pattern lines hidden for one-to-go states across 1000 simulated games",
    () => {
      const summary = runSimulation(ROUND_COUNT);

      console.info("[theme1-pattern-visibility-simulation]", JSON.stringify(summary));

      expect(summary.rounds).toBe(ROUND_COUNT);
      expect(summary.totalTurnoverKr).toBe(ROUND_COUNT * TOTAL_BET_KR);
      expect(summary.boardsWithNearState).toBeGreaterThan(0);
      expect(summary.renderedNearLineLeaks).toBe(0);
      expect(summary.falseNearStateLeaks).toBe(0);
      expect(summary.prematureCompletedPatternLeaks).toBe(0);
    },
    60_000,
  );
});
