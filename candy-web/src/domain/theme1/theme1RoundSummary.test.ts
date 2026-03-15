import { describe, expect, it } from "vitest";
import type { RealtimeRoomSnapshot } from "@/domain/realtime/contracts";
import type { Theme1RoundRenderModel } from "@/domain/theme1/renderModel";
import { extractTheme1RoundSummary } from "@/domain/theme1/theme1RoundSummary";

function createPreviousModel(gameStatus: Theme1RoundRenderModel["meta"]["gameStatus"]): Theme1RoundRenderModel {
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
    boards: [],
    meta: {
      source: "live",
      roomCode: "ROOM01",
      hallId: "hall-1",
      playerId: "player-1",
      hostPlayerId: "player-1",
      playerName: "Tester",
      gameStatus,
      drawCount: 30,
      remainingNumbers: 30,
      connectionPhase: "connected",
      connectionLabel: "Live",
      backendUrl: "https://bingosystem-staging.onrender.com",
    },
  };
}

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
      status: "ENDED",
      entryFee: 30,
      ticketsPerPlayer: 4,
      prizePool: 900,
      remainingPrizePool: 840,
      payoutPercent: 75,
      maxPayoutBudget: 675,
      remainingPayoutBudget: 615,
      activePatternIndexes: [13, 14, 15],
      patternPayoutAmounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 45, 30],
      drawnNumbers: Array.from({ length: 30 }, (_, index) => index + 1),
      remainingNumbers: 30,
      claims: [],
      tickets: {
        "player-1": [
          {
            grid: [
              [1, 2, 3, 4, 5],
              [6, 7, 8, 9, 10],
              [11, 12, 13, 14, 15],
            ],
          },
        ],
      },
      marks: {},
      startedAt: "2026-03-13T10:00:10.000Z",
      endedAt: "2026-03-13T10:00:40.000Z",
      endedReason: "draw-capacity-reached",
    },
    preRoundTickets: {},
    gameHistory: [],
    scheduler: {
      enabled: true,
      liveRoundsIndependentOfBet: true,
      intervalMs: 30000,
      minPlayers: 1,
      playerCount: 1,
      armedPlayerCount: 0,
      armedPlayerIds: [],
      entryFee: 30,
      payoutPercent: 75,
      drawCapacity: 30,
      currentDrawCount: 30,
      remainingDrawCapacity: 0,
      nextStartAt: "2026-03-13T10:01:10.000Z",
      millisUntilNextStart: 30000,
      canStartNow: false,
      serverTime: "2026-03-13T10:00:40.000Z",
    },
  };
}

describe("extractTheme1RoundSummary", () => {
  it("returns a round summary when the live round ends with winnings", () => {
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
        ticketIndex: 0,
        payoutAmount: 30,
        createdAt: "2026-03-13T10:00:36.000Z",
      },
      {
        id: "claim-b",
        playerId: "player-1",
        type: "PATTERN",
        valid: true,
        claimKind: "PATTERN_FAMILY",
        winningPatternIndex: 10,
        displayPatternNumber: 5,
        ticketIndex: 0,
        payoutAmount: 45,
        createdAt: "2026-03-13T10:00:38.000Z",
      },
    );

    expect(
      extractTheme1RoundSummary(snapshot, {
        playerId: "player-1",
        previousModel: createPreviousModel("RUNNING"),
      }),
    ).toEqual({
      claimId: "summary-game-1",
      kind: "summary",
      title: "Runde ferdig",
      subtitle: "1 vinnende bong",
      amount: "75 kr totalt",
      details: ["Bong nr 1: Mønster 1, Mønster 5"],
      topperId: null,
    });
  });

  it("does not emit a summary on repeated ended snapshots or without winnings", () => {
    const snapshot = createSnapshot();
    snapshot.currentGame?.claims.push({
      id: "claim-a",
      playerId: "player-1",
      type: "PATTERN",
      valid: true,
      winningPatternIndex: 13,
      displayPatternNumber: 1,
      ticketIndex: 0,
      payoutAmount: 30,
      createdAt: "2026-03-13T10:00:36.000Z",
    });

    expect(
      extractTheme1RoundSummary(snapshot, {
        playerId: "player-1",
        previousModel: createPreviousModel("ENDED"),
      }),
    ).toBeNull();

    snapshot.currentGame!.claims = [];

    expect(
      extractTheme1RoundSummary(snapshot, {
        playerId: "player-1",
        previousModel: createPreviousModel("RUNNING"),
      }),
    ).toBeNull();
  });
});
