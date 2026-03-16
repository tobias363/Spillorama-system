import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Theme1BoardState } from "@/domain/theme1/renderModel";
import { Theme1BoardGrid } from "@/features/theme1/components/Theme1BoardGrid";

function createBoardCell(index: number, value: number, tone: Theme1BoardState["cells"][number]["tone"]) {
  return {
    index,
    value,
    tone,
  };
}

describe("Theme1BoardGrid", () => {
  it("renders the one-to-go target cell without drawing a pattern line on the bong", () => {
    const board: Theme1BoardState = {
      id: "board-1",
      label: "Bong 1",
      stake: "30 kr",
      win: "0 kr",
      progressLabel: "",
      progressState: "hidden",
      cells: [
        createBoardCell(0, 1, "matched"),
        createBoardCell(1, 2, "idle"),
        createBoardCell(2, 3, "idle"),
        createBoardCell(3, 4, "matched"),
        createBoardCell(4, 5, "idle"),
        createBoardCell(5, 6, "idle"),
        createBoardCell(6, 7, "matched"),
        createBoardCell(7, 8, "idle"),
        createBoardCell(8, 9, "idle"),
        createBoardCell(9, 10, "matched"),
        createBoardCell(10, 11, "idle"),
        createBoardCell(11, 12, "idle"),
        createBoardCell(12, 13, "target"),
        createBoardCell(13, 14, "idle"),
        createBoardCell(14, 15, "idle"),
      ],
      completedPatterns: [],
      activeNearPatterns: [{
        key: "near-13",
        rawPatternIndex: 13,
        title: "Mønster 1",
        symbolId: "pattern-14-top-row",
        pathDefinition: null,
        cellIndices: [0, 1, 2, 3, 4],
      }],
      prizeStacks: [],
    };

    const markup = renderToStaticMarkup(<Theme1BoardGrid boards={[board]} />);

    expect(markup).toContain("board__cell board__cell--target");
    expect(markup).not.toContain("board__pattern-layer board__pattern-layer--near");
    expect(markup).not.toContain("45 kr");
  });

  it("adds celebrate classes to completed patterns and win labels when the bong is spotlighted for a win", () => {
    const board: Theme1BoardState = {
      id: "board-4",
      label: "Bong 4",
      stake: "7 kr",
      win: "20 kr",
      progressLabel: "",
      progressState: "hidden",
      cells: Array.from({ length: 15 }, (_, index) =>
        createBoardCell(index, index + 1, index % 3 === 0 ? "matched" : "idle"),
      ),
      completedPatterns: [
        {
          key: "pattern-win-1",
          rawPatternIndex: 0,
          title: "Mønster 12",
          symbolId: "pattern-01-full-grid",
          pathDefinition: null,
          cellIndices: [0, 1, 2, 3, 4],
          prizeLabel: "20 kr",
        },
        {
          key: "pattern-win-2",
          rawPatternIndex: 3,
          title: "Mønster 9",
          symbolId: null,
          pathDefinition: "M10 10 L200 10",
          cellIndices: [10, 11, 12, 13, 14],
          prizeLabel: "10 kr",
        },
      ],
      activeNearPatterns: [],
      prizeStacks: [
        {
          cellIndex: 4,
          anchor: "center",
          labels: [{ text: "20 kr", prizeAmountKr: 20, rawPatternIndex: 0 }],
        },
        {
          cellIndex: 14,
          anchor: "center",
          labels: [{ text: "10 kr", prizeAmountKr: 10, rawPatternIndex: 3 }],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <Theme1BoardGrid boards={[board]} spotlightByBoardId={{ "board-4": "win" }} />,
    );

    expect(markup).toContain("board-card board-card--spotlight-win");
    expect(markup).toContain("board__pattern-layer board__pattern-layer--celebrate");
    expect(markup).toContain("board__cell--with-prize");
    expect(markup).toContain("board__prize-chip");
    expect(markup).toContain("20 kr");
    expect(markup).toContain("board-card__topline-label board-card__topline-label--win board-card__topline-label--celebrate");
    expect(markup).not.toContain("board__pattern-badge");
    expect(markup).not.toContain("mønstre vunnet");
    expect(markup).not.toContain("board-card__progress-label");
  });

  it("renders legacy won-tone cells as regular matched cells without the yellow target state", () => {
    const board: Theme1BoardState = {
      id: "board-legacy-win",
      label: "Bong 1",
      stake: "30 kr",
      win: "45 kr",
      progressLabel: "",
      progressState: "hidden",
      cells: [
        createBoardCell(0, 1, "won"),
        ...Array.from({ length: 14 }, (_, index) => createBoardCell(index + 1, index + 2, "idle")),
      ],
      completedPatterns: [],
      activeNearPatterns: [],
      prizeStacks: [],
    };

    const markup = renderToStaticMarkup(<Theme1BoardGrid boards={[board]} />);

    expect(markup).toContain("board__cell board__cell--matched");
    expect(markup).not.toContain("board__cell board__cell--won");
    expect(markup).not.toContain("board__cell board__cell--target");
  });
});
