import type { RealtimeRoomSnapshot, RealtimeSession } from "@/domain/realtime/contracts";
import type { Theme1RoundRenderModel } from "@/domain/theme1/renderModel";

export type Theme1TicketSource = "currentGame" | "preRoundTickets" | "empty";
export type Theme1SyncSource = "mock" | "room:resume" | "room:state" | "room:update";
export type Theme1Mode = "mock" | "live";

export interface Theme1LiveRuntimeState {
  lastTicketSource: Theme1TicketSource;
  lastSyncSource: Theme1SyncSource;
  syncInFlight: boolean;
  pendingDrawNumber: number | null;
  activeGameId: string;
  seenClaimIds: string[];
  activeSessionKey: string;
  activeRoomCode: string;
  nextSyncRequestId: number;
  inFlightSyncRequestId: number | null;
}

const THEME1_UNARMED_BOARD_FREEZE_DRAW_THRESHOLD = 15;

export function buildTheme1SessionKey(session: RealtimeSession): string {
  return [
    session.baseUrl.trim(),
    session.roomCode.trim(),
    session.playerId.trim(),
    session.accessToken.trim(),
    session.hallId.trim(),
  ].join("::");
}

export function isSnapshotForActiveRoom(
  snapshot: RealtimeRoomSnapshot,
  activeRoomCode: string,
): boolean {
  return activeRoomCode.trim().length === 0 || snapshot.code === activeRoomCode;
}

export function shouldPreservePreviousViewOnTicketGap(input: {
  syncSource: Extract<Theme1SyncSource, "room:resume" | "room:state" | "room:update">;
  resultTicketSource: Theme1TicketSource;
  currentMode: Theme1Mode;
  lastTicketSource: Theme1TicketSource;
  gameStatus: string | undefined;
}): boolean {
  return (
    input.syncSource === "room:update" &&
    input.resultTicketSource === "empty" &&
    input.currentMode === "live" &&
    input.lastTicketSource === "preRoundTickets" &&
    input.gameStatus !== "RUNNING"
  );
}

export function shouldApplySyncResponse(input: {
  runtime: Theme1LiveRuntimeState;
  expectedSessionKey: string;
  requestId: number;
}): boolean {
  return (
    input.runtime.activeSessionKey === input.expectedSessionKey &&
    input.runtime.inFlightSyncRequestId === input.requestId
  );
}

export function resolvePendingDrawNumberForSnapshot(
  snapshot: RealtimeRoomSnapshot,
  pendingDrawNumber: number | null,
): number | null {
  if (pendingDrawNumber === null) {
    return null;
  }

  const drawnNumbers = snapshot.currentGame?.drawnNumbers ?? [];
  return drawnNumbers.includes(pendingDrawNumber) ? null : pendingDrawNumber;
}

export function shouldHoldPendingPresentationVisuals(input: {
  snapshot: RealtimeRoomSnapshot;
  pendingDrawNumber: number | null;
}): boolean {
  if (input.pendingDrawNumber === null) {
    return false;
  }

  const drawnNumbers = input.snapshot.currentGame?.drawnNumbers ?? [];
  return drawnNumbers.includes(input.pendingDrawNumber);
}

export function shouldPromoteStateSnapshotToResume(input: {
  syncSource: Extract<Theme1SyncSource, "room:resume" | "room:state" | "room:update">;
  previousPlayerId: string;
  resolvedPlayerId: string | undefined;
}): boolean {
  return (
    input.syncSource === "room:state" &&
    input.previousPlayerId.trim().length === 0 &&
    typeof input.resolvedPlayerId === "string" &&
    input.resolvedPlayerId.trim().length > 0
  );
}

export function shouldFreezeBoardsForUnarmedPlayer(input: {
  previousModel: Theme1RoundRenderModel;
  snapshot: RealtimeRoomSnapshot;
  playerId: string;
}): boolean {
  const playerId = input.playerId.trim();
  if (!playerId) {
    return false;
  }

  if (input.previousModel.meta.source !== "live") {
    return false;
  }

  if (!hasAnyBoardActivity(input.previousModel)) {
    return false;
  }

  const armedPlayerIds = input.snapshot.scheduler?.armedPlayerIds ?? [];
  if (armedPlayerIds.includes(playerId)) {
    return false;
  }

  const currentGameStatus = input.snapshot.currentGame?.status;
  if (currentGameStatus !== "RUNNING") {
    return true;
  }

  const drawCount = input.snapshot.currentGame?.drawnNumbers?.length ?? 0;
  return drawCount < THEME1_UNARMED_BOARD_FREEZE_DRAW_THRESHOLD;
}

export function freezeBoardsFromPreviousModel(
  previousModel: Theme1RoundRenderModel,
  nextModel: Theme1RoundRenderModel,
): Theme1RoundRenderModel {
  return {
    ...nextModel,
    boards: previousModel.boards,
    recentBalls: previousModel.recentBalls.length > 0
      ? previousModel.recentBalls
      : nextModel.recentBalls,
  };
}

export function preservePendingPresentationVisuals(
  previousModel: Theme1RoundRenderModel,
  nextModel: Theme1RoundRenderModel,
): Theme1RoundRenderModel {
  return {
    ...nextModel,
    toppers: previousModel.toppers,
    featuredBallNumber: previousModel.featuredBallNumber,
    featuredBallIsPending: previousModel.featuredBallIsPending,
    recentBalls: previousModel.recentBalls,
    boards: previousModel.boards,
  };
}

function hasAnyBoardActivity(model: Theme1RoundRenderModel): boolean {
  if (model.recentBalls.length > 0) {
    return true;
  }

  return model.boards.some((board) => {
    if (board.stake !== "0 kr" || board.win !== "0 kr") {
      return true;
    }

    if (board.completedPatterns.length > 0 || board.activeNearPatterns.length > 0) {
      return true;
    }

    return board.cells.some((cell) => cell.tone !== "idle");
  });
}
