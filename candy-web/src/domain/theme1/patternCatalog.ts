import {
  getTheme1PatternDefinition,
  type Theme1PatternDefinition,
} from "@/domain/theme1/patternDefinitions";

export interface Theme1PatternCatalogEntry {
  rawPatternIndex: number;
  patternNumber: number;
  displayPatternNumber: number;
  title: string;
  note: string;
  overlaySymbolId: string | null;
  overlayPathDefinition: string | null;
}

export type { Theme1PatternDefinition } from "@/domain/theme1/patternDefinitions";

export const THEME1_BOARD_COLUMNS = 5;
export const THEME1_BOARD_ROWS = 3;
export const THEME1_BOARD_CELL_COUNT = THEME1_BOARD_COLUMNS * THEME1_BOARD_ROWS;

export function getTheme1PatternCatalogEntry(
  rawPatternIndex: number,
): Theme1PatternCatalogEntry {
  const definition = getTheme1PatternDefinition(rawPatternIndex);
  if (!definition) {
    return {
      rawPatternIndex,
      patternNumber: rawPatternIndex + 1,
      displayPatternNumber: rawPatternIndex + 1,
      title: `Pattern ${String(Math.max(0, rawPatternIndex) + 1).padStart(2, "0")}`,
      note: "",
      overlaySymbolId: null,
      overlayPathDefinition: null,
    };
  }

  return mapDefinitionToCatalogEntry(definition);
}

function mapDefinitionToCatalogEntry(
  definition: Theme1PatternDefinition,
): Theme1PatternCatalogEntry {
  return {
    rawPatternIndex: definition.rawPatternIndex,
    patternNumber: definition.rawPatternNumber,
    displayPatternNumber: definition.displayPatternNumber,
    title: definition.title,
    note: definition.note,
    overlaySymbolId: definition.overlaySymbolId,
    overlayPathDefinition: definition.overlayPathDefinition,
  };
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
