import type { Theme1RoundRenderModel } from "@/domain/theme1/renderModel";

export function applyTheme1DrawPresentation(
  model: Theme1RoundRenderModel,
  pendingDrawNumber: number | null,
  options?: {
    markBoards?: boolean;
  },
): Theme1RoundRenderModel {
  const shouldMarkBoards = options?.markBoards ?? true;
  const normalizedPending =
    typeof pendingDrawNumber === "number" &&
    Number.isFinite(pendingDrawNumber) &&
    pendingDrawNumber > 0
      ? Math.trunc(pendingDrawNumber)
      : null;

  const recentBalls = model.recentBalls.filter(
    (value, index, values) =>
      Number.isFinite(value) &&
      value > 0 &&
      values.indexOf(value) === index,
  );
  const boards =
    normalizedPending === null || !shouldMarkBoards
      ? model.boards
      : model.boards.map((board) => ({
          ...board,
          cells: board.cells.map((cell) => {
            if (cell.value !== normalizedPending || cell.tone === "won") {
              return cell;
            }

            return {
              ...cell,
              tone: "matched" as const,
            };
          }),
        }));

  if (normalizedPending === null) {
    return {
      ...model,
      boards,
      featuredBallNumber: null,
      featuredBallIsPending: false,
      recentBalls,
    };
  }

  const mergedRecentBalls = recentBalls.includes(normalizedPending)
    ? recentBalls
    : [...recentBalls, normalizedPending];

  return {
    ...model,
    boards,
    featuredBallNumber: normalizedPending,
    featuredBallIsPending: true,
    recentBalls: mergedRecentBalls,
  };
}
