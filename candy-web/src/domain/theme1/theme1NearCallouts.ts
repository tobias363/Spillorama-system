import type { Theme1BoardState, Theme1CelebrationState, Theme1RoundRenderModel } from "@/domain/theme1/renderModel";
import { getTheme1PatternDefinition } from "@/domain/theme1/patternDefinitions";

const MAX_NEAR_CALLOUTS_PER_UPDATE = 2;

interface ExtractNewTheme1NearCalloutsInput {
  previousModel: Theme1RoundRenderModel;
  nextModel: Theme1RoundRenderModel;
}

export function extractNewTheme1NearCallouts(
  input: ExtractNewTheme1NearCalloutsInput,
): Theme1CelebrationState[] {
  const previousBoardsById = new Map(
    input.previousModel.boards.map((board) => [board.id, board] as const),
  );
  const candidates: NearCalloutCandidate[] = [];

  for (const board of input.nextModel.boards) {
    const previousBoard = previousBoardsById.get(board.id);
    const previousNearIndexes = new Set(
      previousBoard?.activeNearPatterns.map((pattern) => pattern.rawPatternIndex) ?? [],
    );
    const completedIndexes = new Set(
      board.completedPatterns.map((pattern) => pattern.rawPatternIndex),
    );

    for (const pattern of board.activeNearPatterns) {
      if (previousNearIndexes.has(pattern.rawPatternIndex) || completedIndexes.has(pattern.rawPatternIndex)) {
        continue;
      }

      const targetCell = resolveNearTargetCell(board, pattern.cellIndices);
      const patternDefinition = getTheme1PatternDefinition(pattern.rawPatternIndex);
      if (!targetCell || targetCell.value <= 0) {
        continue;
      }

      candidates.push({
        boardId: board.id,
        rawPatternIndex: pattern.rawPatternIndex,
        topperId: patternDefinition ? patternDefinition.topperSlotIndex + 1 : null,
        displayPriority: patternDefinition ? patternDefinition.topperSlotIndex : Number.MAX_SAFE_INTEGER,
        celebration: {
          claimId: `near-${board.id}-${pattern.rawPatternIndex}-${targetCell.value}`,
          kind: "near",
          title: "One to go",
          subtitle: `${pattern.title} • ${board.label}`,
          amount: `Mangler ${targetCell.value}`,
          topperId: patternDefinition ? patternDefinition.topperSlotIndex + 1 : null,
          boardId: board.id,
        },
      });
    }
  }

  const deduped = dedupeNearCalloutCandidates(candidates);
  deduped.sort(compareNearCalloutCandidates);

  return deduped
    .slice(0, MAX_NEAR_CALLOUTS_PER_UPDATE)
    .map((candidate) => candidate.celebration);
}

function resolveNearTargetCell(board: Theme1BoardState, patternCellIndices: readonly number[]) {
  return board.cells.find(
    (cell) => patternCellIndices.includes(cell.index) && cell.tone === "target",
  );
}

interface NearCalloutCandidate {
  boardId: string;
  rawPatternIndex: number;
  topperId: number | null;
  displayPriority: number;
  celebration: Theme1CelebrationState;
}

function dedupeNearCalloutCandidates(candidates: NearCalloutCandidate[]) {
  const deduped = new Map<string, NearCalloutCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.boardId}:${candidate.topperId ?? candidate.rawPatternIndex}`;
    const existing = deduped.get(key);
    if (!existing || compareNearCalloutCandidates(candidate, existing) < 0) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()];
}

function compareNearCalloutCandidates(left: NearCalloutCandidate, right: NearCalloutCandidate) {
  if (left.displayPriority !== right.displayPriority) {
    return left.displayPriority - right.displayPriority;
  }
  if ((left.topperId ?? Number.MAX_SAFE_INTEGER) !== (right.topperId ?? Number.MAX_SAFE_INTEGER)) {
    return (left.topperId ?? Number.MAX_SAFE_INTEGER) - (right.topperId ?? Number.MAX_SAFE_INTEGER);
  }
  return left.celebration.claimId.localeCompare(right.celebration.claimId);
}
