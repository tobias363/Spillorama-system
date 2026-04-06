import { describe, expect, it } from "vitest";
import type { RealtimeRoomSnapshot } from "@/domain/realtime/contracts";
import { extractNewTheme1Celebrations } from "@/domain/theme1/theme1ClaimCelebrations";

function createSnapshot(): RealtimeRoomSnapshot {
  return {
    code: "ROOM01",
    hallId: "hall-1",
    hostPlayerId: "player-1",
    createdAt: "2026-03-13T10:00:00.000Z",
    players: [
      {
        id: "player-1",
        name: "Tester",
        walletId: "wallet-1",
        balance: 1200,
      },
    ],
    currentGame: {
      id: "game-1",
      status: "RUNNING",
      entryFee: 30,
      ticketsPerPlayer: 4,
      prizePool: 900,
      remainingPrizePool: 840,
      payoutPercent: 75,
      maxPayoutBudget: 675,
      remainingPayoutBudget: 615,
      activePatternIndexes: [13, 14, 15],
      patternPayoutAmounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 45, 30],
      drawnNumbers: [1, 2, 3],
      remainingNumbers: 57,
      claims: [],
      tickets: {},
      marks: {},
      startedAt: "2026-03-13T10:00:10.000Z",
    },
    preRoundTickets: {},
    gameHistory: [],
    scheduler: {
      enabled: true,
      liveRoundsIndependentOfBet: true,
      intervalMs: 30000,
      minPlayers: 1,
      playerCount: 1,
      armedPlayerCount: 1,
      armedPlayerIds: ["player-1"],
      entryFee: 30,
      payoutPercent: 75,
      drawCapacity: 30,
      currentDrawCount: 3,
      remainingDrawCapacity: 27,
      nextStartAt: null,
      millisUntilNextStart: null,
      canStartNow: false,
      serverTime: "2026-03-13T10:00:20.000Z",
    },
  };
}

describe("extractNewTheme1Celebrations", () => {
  it("returns new valid pattern celebrations for the active player", () => {
    const snapshot = createSnapshot();
    snapshot.currentGame?.claims.push(
      {
        id: "claim-a",
        playerId: "player-1",
        type: "PATTERN",
        valid: true,
        claimKind: "PATTERN_FAMILY",
        winningPatternIndex: 13,
        displayPatternNumber: 1,
        topperSlotIndex: 11,
        ticketIndex: 2,
        payoutAmount: 30,
        createdAt: "2026-03-13T10:00:20.000Z",
      },
      {
        id: "claim-b",
        playerId: "player-2",
        type: "PATTERN",
        valid: true,
        winningPatternIndex: 12,
        displayPatternNumber: 2,
        ticketIndex: 0,
        payoutAmount: 45,
        createdAt: "2026-03-13T10:00:21.000Z",
      },
      {
        id: "claim-c",
        playerId: "player-1",
        type: "PATTERN",
        valid: false,
        winningPatternIndex: 10,
        displayPatternNumber: 4,
        ticketIndex: 1,
        payoutAmount: 60,
        createdAt: "2026-03-13T10:00:22.000Z",
      },
    );

    const result = extractNewTheme1Celebrations(snapshot, {
      playerId: "player-1",
      knownClaimIds: [],
      previousGameId: "game-1",
    });

    expect(result.nextKnownClaimIds).toContain("claim-a");
    expect(result.celebrations).toEqual([
      {
        claimId: "claim-a",
        kind: "win",
        title: "Mønster 1",
        subtitle: "Bong nr 3",
        amount: "30 kr",
        topperId: 12,
        boardId: "board-3",
      },
    ]);
  });

  it("does not re-emit known claims in the same game and resets on a new game", () => {
    const snapshot = createSnapshot();
    snapshot.currentGame!.claims = [
      {
        id: "claim-known",
        playerId: "player-1",
        type: "PATTERN",
        valid: true,
        winningPatternIndex: 12,
        displayPatternNumber: 2,
        ticketIndex: 0,
        payoutAmount: 45,
        createdAt: "2026-03-13T10:00:20.000Z",
      },
    ];

    const sameGame = extractNewTheme1Celebrations(snapshot, {
      playerId: "player-1",
      knownClaimIds: ["claim-known"],
      previousGameId: "game-1",
    });
    expect(sameGame.celebrations).toEqual([]);

    snapshot.currentGame!.id = "game-2";

    const newGame = extractNewTheme1Celebrations(snapshot, {
      playerId: "player-1",
      knownClaimIds: ["claim-known"],
      previousGameId: "game-1",
    });
    expect(newGame.nextGameId).toBe("game-2");
    expect(newGame.celebrations).toHaveLength(1);
    expect(newGame.celebrations[0]?.title).toBe("Mønster 2");
  });

  it("groups multiple new pattern claims on the same bong into one celebration", () => {
    const snapshot = createSnapshot();
    snapshot.currentGame!.claims = [
      {
        id: "claim-a",
        playerId: "player-1",
        type: "PATTERN",
        valid: true,
        winningPatternIndex: 13,
        displayPatternNumber: 1,
        topperSlotIndex: 11,
        ticketIndex: 1,
        payoutAmount: 30,
        createdAt: "2026-03-13T10:00:20.000Z",
      },
      {
        id: "claim-b",
        playerId: "player-1",
        type: "PATTERN",
        valid: true,
        winningPatternIndex: 10,
        displayPatternNumber: 4,
        topperSlotIndex: 8,
        ticketIndex: 1,
        payoutAmount: 45,
        createdAt: "2026-03-13T10:00:21.000Z",
      },
    ];

    const result = extractNewTheme1Celebrations(snapshot, {
      playerId: "player-1",
      knownClaimIds: [],
      previousGameId: "game-1",
    });

    expect(result.celebrations).toEqual([
      {
        claimId: "claim-a+claim-b",
        kind: "win",
        title: "2 mønstre!",
        subtitle: "Bong nr 2",
        amount: "75 kr",
        topperId: 9,
        boardId: "board-2",
        details: ["Mønster 1", "Mønster 4"],
      },
    ]);
  });
});
