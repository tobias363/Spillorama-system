import { describe, expect, it } from "vitest";
import { validateRealtimeRoomSnapshot } from "@/domain/realtime/validateRealtimeRoomSnapshot";
import type { RealtimeRoomSnapshot } from "@/domain/realtime/contracts";

function createValidSnapshot(): RealtimeRoomSnapshot {
  return {
    code: "ABCD12",
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
      drawnNumbers: [1, 2, 3],
      remainingNumbers: 57,
      claims: [],
      tickets: {
        "player-1": [
          {
            numbers: [1, 2, 3, 4, 5],
            grid: [
              [1, 2, 3, 4, 5],
              [6, 7, 8, 9, 10],
              [11, 12, 13, 14, 15],
            ],
          },
        ],
      },
      marks: {
        "player-1": [1, 2, 3],
      },
      startedAt: "2026-03-13T10:00:00.000Z",
    },
    preRoundTickets: {
      "player-1": [
        {
          numbers: [1, 2, 3, 4, 5],
          grid: [
            [1, 2, 3, 4, 5],
            [6, 7, 8, 9, 10],
            [11, 12, 13, 14, 15],
          ],
        },
      ],
    },
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
      currentDrawCount: 3,
      remainingDrawCapacity: 57,
      nextStartAt: "2026-03-13T10:01:00.000Z",
      millisUntilNextStart: 10000,
      canStartNow: true,
      serverTime: "2026-03-13T10:00:50.000Z",
    },
  };
}

describe("validateRealtimeRoomSnapshot", () => {
  it("accepts a valid realtime snapshot", () => {
    const result = validateRealtimeRoomSnapshot(createValidSnapshot());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe("ABCD12");
      expect(result.value.currentGame?.status).toBe("RUNNING");
    }
  });

  it("rejects malformed snapshots before they reach the mapper", () => {
    const invalidSnapshot = createValidSnapshot() as unknown as {
      currentGame: { drawnNumbers: unknown };
    };
    invalidSnapshot.currentGame.drawnNumbers = ["1", "2"];

    const result = validateRealtimeRoomSnapshot(invalidSnapshot);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("snapshot.currentGame.drawnNumbers[0]");
    }
  });
});
