import { describe, expect, it } from "vitest";
import type { RealtimeRoomSnapshot, RealtimeSession } from "@/domain/realtime/contracts";
import {
  buildTheme1SessionKey,
  freezeBoardsFromPreviousModel,
  isSnapshotForActiveRoom,
  preservePendingPresentationVisuals,
  resolvePendingDrawNumberForSnapshot,
  shouldHoldPendingPresentationVisuals,
  shouldPromoteStateSnapshotToResume,
  shouldApplySyncResponse,
  shouldFreezeBoardsForUnarmedPlayer,
  shouldPreservePreviousViewOnTicketGap,
  type Theme1LiveRuntimeState,
} from "@/features/theme1/hooks/theme1LiveSync";
import type { Theme1RoundRenderModel } from "@/domain/theme1/renderModel";

function createSession(overrides: Partial<RealtimeSession> = {}): RealtimeSession {
  return {
    baseUrl: "https://example.com ",
    roomCode: " ROOM42 ",
    playerId: " player-1 ",
    accessToken: " token-123 ",
    hallId: " hall-1 ",
    ...overrides,
  };
}

function createRoomSnapshot(
  overrides: Partial<RealtimeRoomSnapshot> = {},
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
      status: "WAITING",
      entryFee: 30,
      ticketsPerPlayer: 1,
      prizePool: 30,
      remainingPrizePool: 30,
      payoutPercent: 90,
      maxPayoutBudget: 27,
      remainingPayoutBudget: 27,
      drawnNumbers: [],
      remainingNumbers: 60,
      claims: [],
      tickets: {},
      marks: {},
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
      currentDrawCount: 0,
      remainingDrawCapacity: 60,
      nextStartAt: null,
      millisUntilNextStart: null,
      canStartNow: false,
      serverTime: "2026-03-13T10:00:00.000Z",
    },
    ...overrides,
  };
}

function createRuntimeState(
  overrides: Partial<Theme1LiveRuntimeState> = {},
): Theme1LiveRuntimeState {
  return {
    lastTicketSource: "currentGame",
    lastSyncSource: "room:update",
    syncInFlight: true,
    pendingDrawNumber: 41,
    activeGameId: "game-1",
    seenClaimIds: [],
    activeSessionKey: "session-key",
    activeRoomCode: "ROOM42",
    nextSyncRequestId: 3,
    inFlightSyncRequestId: 3,
    ...overrides,
  };
}

function createModel(): Theme1RoundRenderModel {
  return {
    hud: {
      saldo: "1 000 kr",
      gevinst: "120 kr",
      innsats: "30 kr",
      nesteTrekkOm: "00:22",
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
        win: "120 kr",
        progressLabel: "",
        progressState: "hidden",
        cells: Array.from({ length: 15 }, (_, index) => ({
          index,
          value: index + 1,
          tone: index < 5 ? ("matched" as const) : ("idle" as const),
        })),
        completedPatterns: [],
        activeNearPatterns: [],
        prizeStacks: [],
      },
    ],
    meta: {
      source: "live",
      roomCode: "ROOM42",
      hallId: "hall-1",
      playerId: "player-1",
      hostPlayerId: "player-1",
      playerName: "Host",
      gameStatus: "ENDED",
      drawCount: 30,
      remainingNumbers: 30,
      connectionPhase: "connected",
      connectionLabel: "Live",
      backendUrl: "https://example.com",
    },
  };
}

describe("theme1LiveSync", () => {
  it("builds a stable session key from trimmed session fields", () => {
    expect(buildTheme1SessionKey(createSession())).toBe(
      "https://example.com::ROOM42::player-1::token-123::hall-1",
    );
  });

  it("accepts room snapshots for the active room and rejects stale room pushes", () => {
    const snapshot = createRoomSnapshot();

    expect(isSnapshotForActiveRoom(snapshot, "ROOM42")).toBe(true);
    expect(isSnapshotForActiveRoom(snapshot, "ROOM99")).toBe(false);
    expect(isSnapshotForActiveRoom(snapshot, "")).toBe(true);
  });

  it("preserves the previous live view only for room:update ticket gaps outside running games", () => {
    expect(
      shouldPreservePreviousViewOnTicketGap({
        syncSource: "room:update",
        resultTicketSource: "empty",
        currentMode: "live",
        lastTicketSource: "preRoundTickets",
        gameStatus: "WAITING",
      }),
    ).toBe(true);

    expect(
      shouldPreservePreviousViewOnTicketGap({
        syncSource: "room:update",
        resultTicketSource: "empty",
        currentMode: "live",
        lastTicketSource: "currentGame",
        gameStatus: "WAITING",
      }),
    ).toBe(false);

    expect(
      shouldPreservePreviousViewOnTicketGap({
        syncSource: "room:state",
        resultTicketSource: "empty",
        currentMode: "live",
        lastTicketSource: "preRoundTickets",
        gameStatus: "WAITING",
      }),
    ).toBe(false);

    expect(
      shouldPreservePreviousViewOnTicketGap({
        syncSource: "room:update",
        resultTicketSource: "empty",
        currentMode: "live",
        lastTicketSource: "preRoundTickets",
        gameStatus: "RUNNING",
      }),
    ).toBe(false);
  });

  it("applies sync responses only when session key and request id still match", () => {
    expect(
      shouldApplySyncResponse({
        runtime: createRuntimeState(),
        expectedSessionKey: "session-key",
        requestId: 3,
      }),
    ).toBe(true);

    expect(
      shouldApplySyncResponse({
        runtime: createRuntimeState(),
        expectedSessionKey: "stale-session",
        requestId: 3,
      }),
    ).toBe(false);

    expect(
      shouldApplySyncResponse({
        runtime: createRuntimeState(),
        expectedSessionKey: "session-key",
        requestId: 4,
      }),
    ).toBe(false);
  });

  it("clears pending draw presentation once the snapshot contains the drawn number", () => {
    const withPendingNumber = createRoomSnapshot({
      currentGame: {
        ...createRoomSnapshot().currentGame!,
        drawnNumbers: [7, 18, 41],
        remainingNumbers: 57,
      },
    });

    const withoutPendingNumber = createRoomSnapshot({
      currentGame: {
        ...createRoomSnapshot().currentGame!,
        drawnNumbers: [7, 18],
        remainingNumbers: 58,
      },
    });

    expect(resolvePendingDrawNumberForSnapshot(withPendingNumber, 41)).toBeNull();
    expect(resolvePendingDrawNumberForSnapshot(withoutPendingNumber, 41)).toBe(41);
    expect(resolvePendingDrawNumberForSnapshot(withPendingNumber, null)).toBeNull();
  });

  it("holds board visuals while a pending draw is still being presented", () => {
    const withPendingNumber = createRoomSnapshot({
      currentGame: {
        ...createRoomSnapshot().currentGame!,
        drawnNumbers: [7, 18, 41],
        remainingNumbers: 57,
      },
    });

    expect(
      shouldHoldPendingPresentationVisuals({
        snapshot: withPendingNumber,
        pendingDrawNumber: 41,
      }),
    ).toBe(true);

    expect(
      shouldHoldPendingPresentationVisuals({
        snapshot: withPendingNumber,
        pendingDrawNumber: 12,
      }),
    ).toBe(false);
  });

  it("promotes an initial room:state sync to room:resume once player id is resolved", () => {
    expect(
      shouldPromoteStateSnapshotToResume({
        syncSource: "room:state",
        previousPlayerId: "",
        resolvedPlayerId: "player-1",
      }),
    ).toBe(true);

    expect(
      shouldPromoteStateSnapshotToResume({
        syncSource: "room:resume",
        previousPlayerId: "",
        resolvedPlayerId: "player-1",
      }),
    ).toBe(false);

    expect(
      shouldPromoteStateSnapshotToResume({
        syncSource: "room:state",
        previousPlayerId: "player-1",
        resolvedPlayerId: "player-1",
      }),
    ).toBe(false);
  });

  it("freezes the previous board results when the player is not armed for the next round", () => {
    const previousModel = createModel();
    const nextModel: Theme1RoundRenderModel = {
      ...previousModel,
      boards: [
        {
          ...previousModel.boards[0]!,
          stake: "0 kr",
          win: "0 kr",
          cells: previousModel.boards[0]!.cells.map((cell) => ({
            ...cell,
            tone: "idle" as const,
          })),
        },
      ],
      meta: {
        ...previousModel.meta,
        gameStatus: "RUNNING",
        drawCount: 1,
      },
    };
    const snapshot = createRoomSnapshot({
      currentGame: {
        ...createRoomSnapshot().currentGame!,
        id: "game-2",
        status: "RUNNING",
        drawnNumbers: [12],
        remainingNumbers: 59,
      },
      scheduler: {
        ...createRoomSnapshot().scheduler!,
        armedPlayerIds: [],
      },
    });

    expect(
      shouldFreezeBoardsForUnarmedPlayer({
        previousModel,
        snapshot,
        playerId: "player-1",
      }),
    ).toBe(true);

    const frozen = freezeBoardsFromPreviousModel(previousModel, nextModel);
    expect(frozen.boards).toEqual(previousModel.boards);
  });

  it("keeps previous winning boards visible during countdown when the player is not armed", () => {
    const previousModel = createModel();
    const snapshot = createRoomSnapshot({
      currentGame: {
        ...createRoomSnapshot().currentGame!,
        id: "game-2",
        status: "ENDED",
        drawnNumbers: [12, 18, 41],
        remainingNumbers: 57,
      },
      scheduler: {
        ...createRoomSnapshot().scheduler!,
        armedPlayerIds: [],
      },
    });

    expect(
      shouldFreezeBoardsForUnarmedPlayer({
        previousModel,
        snapshot,
        playerId: "player-1",
      }),
    ).toBe(true);
  });

  it("keeps previous winning boards visible in the first half of the next round when the player is not armed", () => {
    const previousModel = createModel();
    const snapshot = createRoomSnapshot({
      currentGame: {
        ...createRoomSnapshot().currentGame!,
        id: "game-3",
        status: "RUNNING",
        drawnNumbers: [1, 2, 3, 4, 5, 6, 7],
        remainingNumbers: 53,
      },
      scheduler: {
        ...createRoomSnapshot().scheduler!,
        armedPlayerIds: [],
      },
    });

    expect(
      shouldFreezeBoardsForUnarmedPlayer({
        previousModel,
        snapshot,
        playerId: "player-1",
      }),
    ).toBe(true);
  });

  it("releases previous boards halfway into the next round when the player is still not armed", () => {
    const previousModel = createModel();
    const snapshot = createRoomSnapshot({
      currentGame: {
        ...createRoomSnapshot().currentGame!,
        id: "game-3",
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 15 }, (_, index) => index + 1),
        remainingNumbers: 45,
      },
      scheduler: {
        ...createRoomSnapshot().scheduler!,
        armedPlayerIds: [],
      },
    });

    expect(
      shouldFreezeBoardsForUnarmedPlayer({
        previousModel,
        snapshot,
        playerId: "player-1",
      }),
    ).toBe(false);
  });

  it("preserves pending draw visuals until the presentation window closes", () => {
    const previousModel = createModel();
    const nextModel: Theme1RoundRenderModel = {
      ...previousModel,
      featuredBallNumber: 41,
      featuredBallIsPending: false,
      recentBalls: [7, 18, 41],
      toppers: [
        {
          id: 1,
          title: "Mønster 1",
          prize: "30 kr",
          highlighted: true,
          highlightKind: "win",
        },
      ],
      boards: [
        {
          ...previousModel.boards[0]!,
          cells: previousModel.boards[0]!.cells.map((cell, index) => ({
            ...cell,
            tone: index === 0 ? ("matched" as const) : ("idle" as const),
          })),
          completedPatterns: [
            {
              key: "13-0-30",
              rawPatternIndex: 13,
              title: "Mønster 14",
              symbolId: null,
              pathDefinition: "M 50 50 L 50 250",
              cellIndices: [0, 5, 10],
              prizeLabel: "30 kr",
            },
          ],
        },
      ],
    };

    const held = preservePendingPresentationVisuals(previousModel, nextModel);

    expect(held.boards).toEqual(previousModel.boards);
    expect(held.toppers).toEqual(previousModel.toppers);
    expect(held.featuredBallNumber).toBe(previousModel.featuredBallNumber);
    expect(held.featuredBallIsPending).toBe(previousModel.featuredBallIsPending);
    expect(held.recentBalls).toEqual(previousModel.recentBalls);
  });
});
