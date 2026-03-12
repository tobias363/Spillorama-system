export const THEME1_BOARD_COLUMNS = 5;
export const THEME1_BOARD_ROWS = 3;
export const THEME1_BOARD_CELL_COUNT = THEME1_BOARD_COLUMNS * THEME1_BOARD_ROWS;

export interface Theme1PatternCatalogEntry {
  rawPatternIndex: number;
  patternNumber: number;
  title: string;
  note: string;
  overlaySymbolId: string | null;
}

const patternOverlayByNumber: Record<number, string> = {
  2: "pattern-02-perimeter",
  3: "pattern-03-cross",
  4: "pattern-04-crown",
  5: "pattern-05-goalposts",
  12: "pattern-12-sides",
  13: "pattern-13-v",
  14: "pattern-14-top-row",
  15: "pattern-15-middle-row",
  16: "pattern-16-bottom-row",
};

const patternDefinitions = [
  { patternNumber: 1, note: "Full grid" },
  { patternNumber: 2, note: "Perimeter" },
  { patternNumber: 3, note: "Cross" },
  { patternNumber: 4, note: "Crown" },
  { patternNumber: 5, note: "Goalposts" },
  { patternNumber: 6, note: "Top + middle rows" },
  { patternNumber: 7, note: "Top + bottom rows" },
  { patternNumber: 8, note: "Middle + bottom rows" },
  { patternNumber: 9, note: "Diamond cross" },
  { patternNumber: 10, note: "Top arc" },
  { patternNumber: 11, note: "Bottom arc" },
  { patternNumber: 12, note: "Side rails" },
  { patternNumber: 13, note: "V shape" },
  { patternNumber: 14, note: "Top row" },
  { patternNumber: 15, note: "Middle row" },
  { patternNumber: 16, note: "Bottom row" },
].map<Theme1PatternCatalogEntry>((definition, index) => ({
  rawPatternIndex: index,
  patternNumber: definition.patternNumber,
  title: `Pattern ${String(definition.patternNumber).padStart(2, "0")}`,
  note: definition.note,
  overlaySymbolId: patternOverlayByNumber[definition.patternNumber] ?? null,
}));

const patternCatalogByRawIndex = new Map(
  patternDefinitions.map((entry) => [entry.rawPatternIndex, entry] as const),
);

export function getTheme1PatternCatalogEntry(
  rawPatternIndex: number,
): Theme1PatternCatalogEntry {
  return (
    patternCatalogByRawIndex.get(rawPatternIndex) ?? {
      rawPatternIndex,
      patternNumber: rawPatternIndex + 1,
      title: `Pattern ${String(Math.max(0, rawPatternIndex) + 1).padStart(2, "0")}`,
      note: "",
      overlaySymbolId: null,
    }
  );
}

export function columnMajorIndexToUiIndex(columnMajorIndex: number): number {
  if (columnMajorIndex < 0) {
    return columnMajorIndex;
  }

  const column = Math.trunc(columnMajorIndex / THEME1_BOARD_ROWS);
  const row = columnMajorIndex % THEME1_BOARD_ROWS;
  return row * THEME1_BOARD_COLUMNS + column;
}

export function convertColumnMajorIndexesToUi(
  cellIndexes: readonly number[],
): number[] {
  return cellIndexes
    .map((cellIndex) => columnMajorIndexToUiIndex(cellIndex))
    .filter(
      (cellIndex, index, values) =>
        cellIndex >= 0 &&
        cellIndex < THEME1_BOARD_CELL_COUNT &&
        values.indexOf(cellIndex) === index,
    )
    .sort((left, right) => left - right);
}
