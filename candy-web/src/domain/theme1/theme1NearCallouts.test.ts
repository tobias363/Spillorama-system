import { describe, expect, it } from "vitest";
import type { Theme1RoundRenderModel } from "@/domain/theme1/renderModel";
import { extractNewTheme1NearCallouts } from "@/domain/theme1/theme1NearCallouts";

function createModel(): Theme1RoundRenderModel {
  return {
    hud: {
      saldo: "0 kr",
      gevinst: "0 kr",
      innsats: "30 kr",
      nesteTrekkOm: "",
      roomPlayers: "1 spiller",
    },
    toppers: [],
    featuredBallNumber: null,
    featuredBallIsPending: false,
    recentBalls: [],
    boards: [
      {
        id: "board-1",
        label: "Bong nr 1",
        stake: "30 kr",
        win: "0 kr",
        progressLabel: "",
        progressState: "hidden",
        cells: Array.from({ length: 15 }, (_, index) => ({
          index,
          value: index + 1,
          tone: "idle" as const,
        })),
        completedPatterns: [],
        activeNearPatterns: [],
        prizeStacks: [],
      },
    ],
    meta: {
      source: "live",
      roomCode: "ROOM01",
      hallId: "hall-1",
      playerId: "player-1",
      hostPlayerId: "player-1",
      playerName: "Tester",
      gameStatus: "RUNNING",
      drawCount: 15,
      remainingNumbers: 45,
      connectionPhase: "connected",
      connectionLabel: "Live",
      backendUrl: "https://example.com",
    },
  };
}

describe("extractNewTheme1NearCallouts", () => {
  it("creates a callout for a newly appeared one-to-go pattern", () => {
    const previousModel = createModel();
    const nextModel = createModel();
    nextModel.boards[0]!.cells[4] = { index: 4, value: 5, tone: "target" };
    nextModel.boards[0]!.activeNearPatterns = [
      {
        key: "near-13",
        rawPatternIndex: 13,
        title: "Mønster 1",
        symbolId: "pattern-14-top-row",
        pathDefinition: null,
        cellIndices: [0, 1, 2, 3, 4],
      },
    ];

    const result = extractNewTheme1NearCallouts({
      previousModel,
      nextModel,
    });

    expect(result).toEqual([
      {
        claimId: "near-board-1-13-5",
        kind: "near",
        title: "One to go",
        subtitle: "Mønster 1 • Bong nr 1",
        amount: "Mangler 5",
        topperId: 12,
        boardId: "board-1",
      },
    ]);
  });

  it("does not re-emit an existing near pattern or a completed one", () => {
    const previousModel = createModel();
    previousModel.boards[0]!.activeNearPatterns = [
      {
        key: "near-13",
        rawPatternIndex: 13,
        title: "Mønster 1",
        symbolId: "pattern-14-top-row",
        pathDefinition: null,
        cellIndices: [0, 1, 2, 3, 4],
      },
    ];

    const nextModel = createModel();
    nextModel.boards[0]!.cells[4] = { index: 4, value: 5, tone: "target" };
    nextModel.boards[0]!.activeNearPatterns = [
      {
        key: "near-13",
        rawPatternIndex: 13,
        title: "Mønster 1",
        symbolId: "pattern-14-top-row",
        pathDefinition: null,
        cellIndices: [0, 1, 2, 3, 4],
      },
    ];
    nextModel.boards[0]!.completedPatterns = [
      {
        key: "completed-13",
        rawPatternIndex: 13,
        title: "Mønster 1",
        symbolId: "pattern-14-top-row",
        pathDefinition: null,
        cellIndices: [0, 1, 2, 3, 4],
      },
    ];

    const result = extractNewTheme1NearCallouts({
      previousModel,
      nextModel,
    });

    expect(result).toEqual([]);
  });

  it("limits near callouts to the two highest-priority new patterns", () => {
    const previousModel = createModel();
    const nextModel = createModel();

    nextModel.boards[0]!.cells[4] = { index: 4, value: 5, tone: "target" };
    nextModel.boards[0]!.cells[10] = { index: 10, value: 11, tone: "target" };
    nextModel.boards[0]!.cells[14] = { index: 14, value: 15, tone: "target" };
    nextModel.boards[0]!.activeNearPatterns = [
      {
        key: "near-13",
        rawPatternIndex: 13,
        title: "Mønster 1",
        symbolId: "pattern-14-top-row",
        pathDefinition: null,
        cellIndices: [0, 1, 2, 3, 4],
      },
      {
        key: "near-10",
        rawPatternIndex: 10,
        title: "Mønster 4",
        symbolId: null,
        pathDefinition: "M50 250H450M50 250L250 50L450 250",
        cellIndices: [2, 4, 5, 6, 7, 9, 12, 14],
      },
      {
        key: "near-1",
        rawPatternIndex: 1,
        title: "Mønster 11",
        symbolId: null,
        pathDefinition: "M50 50H450V250H50V50",
        cellIndices: [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 13, 14],
      },
    ];

    const result = extractNewTheme1NearCallouts({
      previousModel,
      nextModel,
    });

    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.topperId)).toEqual([2, 9]);
  });

  it("dedupes multiple new row variants from the same family on the same board", () => {
    const previousModel = createModel();
    const nextModel = createModel();

    nextModel.boards[0]!.cells[4] = { index: 4, value: 5, tone: "target" };
    nextModel.boards[0]!.cells[9] = { index: 9, value: 10, tone: "target" };
    nextModel.boards[0]!.activeNearPatterns = [
      {
        key: "near-13",
        rawPatternIndex: 13,
        title: "Mønster 1",
        symbolId: "pattern-14-top-row",
        pathDefinition: null,
        cellIndices: [0, 1, 2, 3, 4],
      },
      {
        key: "near-14",
        rawPatternIndex: 14,
        title: "Mønster 1",
        symbolId: "pattern-15-middle-row",
        pathDefinition: null,
        cellIndices: [5, 6, 7, 8, 9],
      },
    ];

    const result = extractNewTheme1NearCallouts({
      previousModel,
      nextModel,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      claimId: "near-board-1-13-5",
      kind: "near",
      title: "One to go",
      subtitle: "Mønster 1 • Bong nr 1",
      amount: "Mangler 5",
      topperId: 12,
      boardId: "board-1",
    });
  });
});
