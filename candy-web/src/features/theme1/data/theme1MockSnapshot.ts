import { getTheme1PatternCatalogEntry } from "@/domain/theme1/patternCatalog";
import type {
  Theme1BoardPatternOverlayState,
  Theme1BoardPrizeStackState,
  Theme1BoardState,
  Theme1RoundRenderModel,
} from "@/domain/theme1/renderModel";

const CANDY_COLUMN_RANGES: Array<readonly [number, number]> = [
  [1, 12],
  [13, 24],
  [25, 36],
  [37, 48],
  [49, 60],
];

const boardNumbers = [
  [1, 6, 11, 16, 21, 2, 7, 12, 17, 22, 3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24, 5, 10, 15, 20, 25, 26, 31, 36, 41, 46],
  [27, 32, 37, 42, 47, 28, 33, 38, 43, 48, 29, 34, 39, 44, 49],
  [30, 35, 40, 45, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60],
];

function buildCompletedPattern(
  rawPatternIndex: number,
  cellIndices: number[],
): Theme1BoardPatternOverlayState {
  const pattern = getTheme1PatternCatalogEntry(rawPatternIndex);
  return {
    key: `${rawPatternIndex}-${cellIndices.join("-")}`,
    rawPatternIndex,
    title: pattern.title,
    symbolId: pattern.overlaySymbolId,
    pathDefinition: pattern.overlayPathDefinition,
    cellIndices,
  };
}

function buildNearPattern(
  rawPatternIndex: number,
  cellIndices: number[],
): Theme1BoardPatternOverlayState {
  const pattern = getTheme1PatternCatalogEntry(rawPatternIndex);
  return {
    key: `near-${rawPatternIndex}-${cellIndices.join("-")}`,
    rawPatternIndex,
    title: pattern.title,
    symbolId: pattern.overlaySymbolId,
    pathDefinition: pattern.overlayPathDefinition,
    cellIndices,
  };
}

function buildPrizeStack(
  cellIndex: number,
  text: string,
  rawPatternIndex: number,
  anchor: Theme1BoardPrizeStackState["anchor"] = "center",
): Theme1BoardPrizeStackState {
  return {
    cellIndex,
    anchor,
    labels: [{ text, prizeAmountKr: Number.parseInt(text, 10) || 0, rawPatternIndex }],
  };
}

function buildBoard(
  id: number,
  tones: number[],
  target?: number,
  completedPatterns: Theme1BoardPatternOverlayState[] = [],
  activeNearPatterns: Theme1BoardPatternOverlayState[] = [],
  prizeStacks: Theme1BoardPrizeStackState[] = [],
): Theme1BoardState {
  const source = boardNumbers[id - 1];

  return {
    id: `board-${id}`,
    label: `Bong ${id}`,
    stake: "30 kr",
    win: completedPatterns.length > 0 ? "120 kr" : "0 kr",
    progressLabel:
      completedPatterns.length > 0 ? `${completedPatterns.length} mønstre vunnet · flere mulig` : "",
    progressState: completedPatterns.length > 0 ? "ongoing" : "hidden",
    cells: source.map((value, index) => ({
      index,
      value,
      tone:
        target === index
          ? "target"
          : prizeStacks.some((stack) => stack.cellIndex === index)
            ? "won"
            : tones.includes(index)
              ? "matched"
            : "idle",
    })),
    completedPatterns,
    activeNearPatterns,
    prizeStacks,
  };
}

export function createTheme1MockTicketNumbers(random = Math.random): number[] {
  const columnValues = CANDY_COLUMN_RANGES.map(([start, end]) =>
    pickUniqueValuesInRange(start, end, 3, random),
  );

  return Array.from({ length: 15 }, (_, index) => {
    const row = Math.floor(index / 5);
    const column = index % 5;
    return columnValues[column]?.[row] ?? 0;
  });
}

export function rerollTheme1MockBoards(previousBoards: Theme1BoardState[]): Theme1BoardState[] {
  return previousBoards.map((board, index) => {
    const nextNumbers = createTheme1MockTicketNumbers();

    return {
      ...board,
      win: "0 kr",
      progressLabel: "",
      progressState: "hidden",
      completedPatterns: [],
      activeNearPatterns: [],
      prizeStacks: [],
      cells: nextNumbers.map((value, cellIndex) => ({
        index: cellIndex,
        value,
        tone: "idle" as const,
      })),
    };
  });
}

function pickUniqueValuesInRange(
  start: number,
  end: number,
  count: number,
  random: () => number,
) {
  const values = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  shuffle(values, random);
  return values.slice(0, count).sort((left, right) => left - right);
}

function shuffle<T>(values: T[], random: () => number) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }

  return values;
}

export const theme1MockSnapshot: Theme1RoundRenderModel = {
  hud: {
    saldo: "1 240 kr",
    gevinst: "120 kr",
    innsats: "0 kr",
    nesteTrekkOm: "00:45",
    roomPlayers: "28 spillere",
  },
  toppers: [
    { id: 1, title: "Pattern 01", prize: "3 kr", highlighted: true },
    { id: 2, title: "Pattern 02", prize: "6 kr" },
    { id: 3, title: "Pattern 03", prize: "9 kr" },
    { id: 4, title: "Pattern 04", prize: "12 kr" },
    { id: 5, title: "Pattern 05", prize: "15 kr" },
  ],
  featuredBallNumber: 41,
  featuredBallIsPending: false,
  recentBalls: [3, 11, 18, 24, 33, 41],
  boards: [
    buildBoard(
      1,
      [0, 1, 2, 3],
      4,
      [],
      [buildNearPattern(13, [0, 1, 2, 3, 4])],
      [buildPrizeStack(4, "3 kr", 13, "right")],
    ),
    buildBoard(
      2,
      [0, 1, 2, 3, 4],
      undefined,
      [buildCompletedPattern(13, [0, 1, 2, 3, 4])],
      [],
      [buildPrizeStack(4, "3 kr", 13, "right")],
    ),
    buildBoard(
      3,
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      undefined,
      [
        buildCompletedPattern(13, [0, 1, 2, 3, 4]),
        buildCompletedPattern(14, [5, 6, 7, 8, 9]),
      ],
      [],
      [
        buildPrizeStack(4, "3 kr", 13, "right"),
        buildPrizeStack(9, "6 kr", 14, "center"),
      ],
    ),
    buildBoard(
      4,
      [0, 4, 5, 9, 10, 11, 12, 14],
      13,
      [buildCompletedPattern(11, [0, 4, 5, 9, 10, 14])],
      [],
      [
        buildPrizeStack(14, "12 kr", 11, "right"),
        buildPrizeStack(13, "15 kr", 15, "center"),
      ],
    ),
  ],
  meta: {
    source: "mock",
    roomCode: "MOCK01",
    hallId: "mock-hall",
    playerId: "mock-player",
    hostPlayerId: "mock-player",
    playerName: "Mock Player",
    gameStatus: "RUNNING",
    drawCount: 18,
    remainingNumbers: 42,
    connectionPhase: "mock",
    connectionLabel: "Mock",
    backendUrl: "http://127.0.0.1:4000",
  },
};
