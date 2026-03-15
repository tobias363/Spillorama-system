import { describe, expect, it } from "vitest";
import { mapRoomSnapshotToTheme1 } from "@/domain/theme1/mappers/mapRoomSnapshotToTheme1";
import {
  getTheme1PatternCatalogEntry,
} from "@/domain/theme1/patternCatalog";
import {
  THEME1_PATTERN_DEFINITIONS,
} from "@/domain/theme1/patternDefinitions";
import {
  THEME1_DEFAULT_PATTERN_MASKS,
  resolveTheme1PayoutSlotIndex,
} from "@/domain/theme1/theme1RuntimeConfig";
import type { RealtimeRoomSnapshot } from "@/domain/realtime/contracts";

function createSnapshotForPattern(
  drawnNumbers: number[],
): RealtimeRoomSnapshot {
  return {
    code: "ROOM42",
    hallId: "hall-1",
    hostPlayerId: "player-1",
    createdAt: "2026-03-13T10:00:00.000Z",
    players: [
      {
        id: "player-1",
        name: "Host",
        walletId: "wallet-1",
        balance: 1000,
      },
    ],
    currentGame: {
      id: "game-1",
      status: "RUNNING",
      entryFee: 30,
      ticketsPerPlayer: 1,
      prizePool: 30,
      remainingPrizePool: 30,
      payoutPercent: 90,
      maxPayoutBudget: 27,
      remainingPayoutBudget: 27,
      drawnNumbers,
      remainingNumbers: 60 - drawnNumbers.length,
      claims: [],
      tickets: {
        "player-1": [
          {
            numbers: Array.from({ length: 15 }, (_, index) => index + 1),
            grid: [
              [1, 2, 3, 4, 5],
              [6, 7, 8, 9, 10],
              [11, 12, 13, 14, 15],
            ],
          },
        ],
      },
      marks: {
        "player-1": [],
      },
      startedAt: "2026-03-13T10:00:00.000Z",
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
      entryFee: 30,
      payoutPercent: 90,
      drawCapacity: 60,
      currentDrawCount: drawnNumbers.length,
      remainingDrawCapacity: 60 - drawnNumbers.length,
      nextStartAt: null,
      millisUntilNextStart: null,
      canStartNow: false,
      serverTime: "2026-03-13T10:00:50.000Z",
    },
  };
}

function createPayoutAmountsForPatterns(
  overrides: ReadonlyArray<readonly [rawPatternIndex: number, amount: number]>,
): number[] {
  const payouts = Array.from({ length: 12 }, () => 0);

  for (const [rawPatternIndex, amount] of overrides) {
    const slotIndex = resolveTheme1PayoutSlotIndex(rawPatternIndex);
    if (slotIndex >= 0 && slotIndex < payouts.length) {
      payouts[slotIndex] = amount;
    }
  }

  return payouts;
}

function sumPrizeLabelTexts(labels: readonly string[]): number {
  return labels.reduce((total, label) => {
    const numeric = Number.parseInt(label.replaceAll(/\D/g, ""), 10);
    return total + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
}

describe("theme1 pattern definitions", () => {
  it("keeps all pattern metadata and masks in one source", () => {
    expect(THEME1_PATTERN_DEFINITIONS).toHaveLength(16);
    expect(THEME1_DEFAULT_PATTERN_MASKS).toHaveLength(16);
    expect(
      THEME1_PATTERN_DEFINITIONS.every(
        (definition) =>
          definition.mask.length === 15 &&
          (definition.overlaySymbolId !== null ||
            definition.overlayPathDefinition !== null),
      ),
    ).toBe(true);
  });

  it("resolves payout slot indexes from the unified pattern definitions", () => {
    expect(resolveTheme1PayoutSlotIndex(0)).toBe(0);
    expect(resolveTheme1PayoutSlotIndex(6)).toBe(5);
    expect(resolveTheme1PayoutSlotIndex(15)).toBe(11);
  });

  it("carries explicit overlay paths from the catalog into board overlays", () => {
    const snapshot = createSnapshotForPattern([1, 2, 5, 8, 9, 11, 13, 14]);
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [9],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
    });

    const overlay = result.model.boards[0]?.completedPatterns[0];
    const catalogEntry = getTheme1PatternCatalogEntry(9);

    expect(overlay?.rawPatternIndex).toBe(9);
    expect(overlay?.pathDefinition).toBe(catalogEntry.overlayPathDefinition);
    expect(overlay?.symbolId).toBe(catalogEntry.overlaySymbolId);
  });

  it("resolves one-to-go overlays from the same pattern source as completed patterns", () => {
    const snapshot = createSnapshotForPattern([1, 4, 7, 10]);
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [13],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
      preferredNearPatternIndexesByCard: [13],
    });

    const nearPattern = result.model.boards[0]?.activeNearPatterns[0];
    const catalogEntry = getTheme1PatternCatalogEntry(13);

    expect(nearPattern?.rawPatternIndex).toBe(13);
    expect(nearPattern?.pathDefinition).toBe(catalogEntry.overlayPathDefinition);
    expect(nearPattern?.symbolId).toBe(catalogEntry.overlaySymbolId);
  });

  it("marks the final one-to-go number as the yellow target cell and exposes the pending prize", () => {
    const snapshot = createSnapshotForPattern([1, 4, 7, 10]);
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [13],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
      topperPayoutAmounts: createPayoutAmountsForPatterns([[13, 45]]),
    });

    const board = result.model.boards[0]!;
    const targetCell = board.cells.find((cell) => cell.value === 13);
    const matchedCells = board.cells.filter((cell) =>
      [1, 4, 7, 10].includes(cell.value),
    );
    expect(board.activeNearPatterns.map((pattern) => pattern.rawPatternIndex)).toContain(13);
    expect(targetCell?.tone).toBe("target");
    expect(matchedCells.every((cell) => cell.tone === "matched")).toBe(true);
    expect(board.prizeStacks).toHaveLength(0);
  });

  it("keeps all one-to-go patterns visible on the same bong when multiple rows are one number away", () => {
    const snapshot = createSnapshotForPattern([1, 4, 7, 10, 2, 5, 8, 11]);
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [13],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
      topperPayoutAmounts: createPayoutAmountsForPatterns([
        [13, 30],
        [14, 30],
      ]),
    });

    const board = result.model.boards[0]!;
    const nearPatternIndexes = board.activeNearPatterns.map((pattern) => pattern.rawPatternIndex);
    const targetValues = board.cells
      .filter((cell) => cell.tone === "target")
      .map((cell) => cell.value)
      .sort((left, right) => left - right);
    expect(nearPatternIndexes).toContain(13);
    expect(nearPatternIndexes).toContain(14);
    expect(targetValues).toEqual([13, 14]);
    expect(board.prizeStacks).toHaveLength(0);
  });

  it("shows the won pattern overlay and payout label on the bong when the pattern completes", () => {
    const snapshot = createSnapshotForPattern([1, 4, 7, 10, 13]);
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [13],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
      topperPayoutAmounts: createPayoutAmountsForPatterns([[13, 45]]),
    });

    const board = result.model.boards[0]!;
    const completedPattern = board.completedPatterns[0];

    expect(board.activeNearPatterns).toHaveLength(0);
    expect(board.completedPatterns).toHaveLength(1);
    expect(completedPattern?.rawPatternIndex).toBe(13);
    expect(completedPattern?.prizeLabel).toBe("45 kr");
    expect(board.win).toBe("45 kr");
    expect(board.cells.find((cell) => cell.value === 13)?.tone).toBe("matched");
    expect(board.prizeStacks).toHaveLength(0);
  });

  it("hides one-to-go highlights on a bong once any pattern on that bong is won", () => {
    const snapshot = createSnapshotForPattern([1, 3, 5, 7, 9, 11, 15]);
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: THEME1_PATTERN_DEFINITIONS.map(
        (definition) => definition.rawPatternIndex,
      ),
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
      topperPayoutAmounts: createPayoutAmountsForPatterns([
        [8, 30],
        [12, 30],
      ]),
    });

    const board = result.model.boards[0]!;

    expect(board.completedPatterns.map((pattern) => pattern.rawPatternIndex)).toContain(12);
    expect(board.activeNearPatterns).toHaveLength(0);
    expect(board.cells.some((cell) => cell.tone === "target")).toBe(false);
  });

  it("keeps multiple completed patterns on the same bong and sums their winnings", () => {
    const snapshot = createSnapshotForPattern([1, 4, 7, 10, 13, 2, 5, 8, 11, 14]);
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [13, 14],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
      topperPayoutAmounts: createPayoutAmountsForPatterns([[13, 30]]),
    });

    const board = result.model.boards[0]!;
    const winningPatternIndexes = board.completedPatterns.map((pattern) => pattern.rawPatternIndex);
    const labelTexts = board.completedPatterns.map((pattern) => pattern.prizeLabel ?? "");
    const totalDisplayedPrizeAmount = sumPrizeLabelTexts(labelTexts);

    expect(board.completedPatterns.length).toBeGreaterThanOrEqual(2);
    expect(winningPatternIndexes).toContain(13);
    expect(winningPatternIndexes).toContain(14);
    expect(board.win).toBe(`${totalDisplayedPrizeAmount} kr`);
    expect(labelTexts.filter((text) => text === "30 kr").length).toBeGreaterThanOrEqual(2);
    expect(board.prizeStacks).toHaveLength(0);
  });

  it("keeps adding won patterns on the bong as later draw numbers complete more pattern rows", () => {
    const snapshot = createSnapshotForPattern([1, 4, 7, 10, 13, 2, 5, 8, 11, 14]);
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [13],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
      topperPayoutAmounts: createPayoutAmountsForPatterns([
        [13, 30],
        [14, 30],
      ]),
    });

    const board = result.model.boards[0]!;
    const winningPatternIndexes = board.completedPatterns.map((pattern) => pattern.rawPatternIndex);
    const labelTexts = board.completedPatterns.map((pattern) => pattern.prizeLabel ?? "");
    const totalDisplayedPrizeAmount = sumPrizeLabelTexts(labelTexts);

    expect(winningPatternIndexes).toContain(13);
    expect(winningPatternIndexes).toContain(14);
    expect(board.completedPatterns.length).toBeGreaterThanOrEqual(2);
    expect(board.win).toBe(`${totalDisplayedPrizeAmount} kr`);
    expect(labelTexts.filter((text) => text === "30 kr").length).toBeGreaterThanOrEqual(2);
    expect(board.prizeStacks).toHaveLength(0);
  });

  it("reveals every won pattern on the bong after 30 draws even if the live round only tracked a subset", () => {
    const snapshot = createSnapshotForPattern(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [13],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
      topperPayoutAmounts: createPayoutAmountsForPatterns([
        [13, 30],
        [14, 30],
        [15, 30],
      ]),
    });

    const board = result.model.boards[0]!;
    const winningPatternIndexes = board.completedPatterns.map((pattern) => pattern.rawPatternIndex);

    expect(board.activeNearPatterns).toHaveLength(0);
    expect(winningPatternIndexes).toContain(13);
    expect(winningPatternIndexes).toContain(14);
    expect(winningPatternIndexes).toContain(15);
    expect(board.completedPatterns).toHaveLength(16);
  });

  it("marks drawn ticket numbers as matched cells even outside completed patterns", () => {
    const snapshot = createSnapshotForPattern([1]);
    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
    });

    expect(result.model.boards[0]?.cells[0]?.value).toBe(1);
    expect(result.model.boards[0]?.cells[0]?.tone).toBe("matched");
    expect(result.model.boards[0]?.cells[1]?.tone).toBe("idle");
  });

  it("binds saldo to the authoritative player balance and gevinst to valid current-round claims", () => {
    const snapshot = createSnapshotForPattern([1, 2, 3]);
    snapshot.players[0]!.balance = 1120;
    snapshot.currentGame!.claims = [
      {
        id: "claim-1",
        playerId: "player-1",
        type: "LINE",
        valid: true,
        payoutAmount: 60,
        createdAt: "2026-03-13T10:00:20.000Z",
      },
      {
        id: "claim-2",
        playerId: "player-1",
        type: "LINE",
        valid: true,
        payoutAmount: 15,
        createdAt: "2026-03-13T10:00:25.000Z",
      },
      {
        id: "claim-3",
        playerId: "player-2",
        type: "LINE",
        valid: true,
        payoutAmount: 40,
        createdAt: "2026-03-13T10:00:30.000Z",
      },
      {
        id: "claim-4",
        playerId: "player-1",
        type: "LINE",
        valid: false,
        payoutAmount: 999,
        createdAt: "2026-03-13T10:00:35.000Z",
      },
    ];

    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
    });

    expect(result.model.hud.saldo).toBe("1 120 kr");
    expect(result.model.hud.gevinst).toBe("75 kr");
  });

  it("moves winnings into saldo on the next round by clearing gevinst when the new game has no claims", () => {
    const snapshot = createSnapshotForPattern([]);
    snapshot.players[0]!.balance = 1075;
    snapshot.currentGame!.status = "WAITING";
    snapshot.currentGame!.claims = [];

    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      activePatternIndexes: [],
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
    });

    expect(result.model.hud.saldo).toBe("1 075 kr");
    expect(result.model.hud.gevinst).toBe("0 kr");
  });

  it("falls back to stake-based topper prizes during countdown when snapshot payouts are zeroed", () => {
    const snapshot = createSnapshotForPattern([]);
    snapshot.currentGame!.status = "WAITING";
    snapshot.currentGame!.claims = [];
    snapshot.currentGame!.patternPayoutAmounts = Array.from({ length: 12 }, () => 0);

    const result = mapRoomSnapshotToTheme1(snapshot, {
      playerId: "player-1",
      cardSlotCount: 1,
      patternMasks: THEME1_DEFAULT_PATTERN_MASKS,
    });

    expect(result.model.toppers[0]?.prize).toBe("11 250 kr");
    expect(result.model.toppers[9]?.prize).toBe("60 kr");
    expect(result.model.toppers[11]?.prize).toBe("22 kr");
    expect(result.model.toppers.every((topper) => topper.prize !== "0 kr")).toBe(true);
  });
});
