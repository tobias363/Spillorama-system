import oneLineBadgeUrl from "../../../assets/theme1/toppers/1l.png";
import twoLineBadgeUrl from "../../../assets/theme1/toppers/2l.png";

export type Theme1TopperTheme =
  | "red"
  | "pink"
  | "purple"
  | "blue"
  | "teal"
  | "green"
  | "yellow"
  | "orange";

export interface Theme1TopperDesign {
  id: number;
  displayNumber: number;
  uiCells: readonly number[];
  theme: Theme1TopperTheme;
  blankBoard?: boolean;
  heroBadgeUrl?: string;
  heroBadgeAlt?: string;
}

interface PreviewTopperCardDefinition {
  id: number;
  displayNumber: number;
  rawPattern: readonly number[];
  theme: Theme1TopperTheme;
  blankBoard?: boolean;
  heroBadgeUrl?: string;
  heroBadgeAlt?: string;
}

const PREVIEW_TOPPER_CARD_DEFINITIONS: readonly PreviewTopperCardDefinition[] = Object.freeze([
  {
    id: 1,
    displayNumber: 12,
    rawPattern: Object.freeze([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
    theme: "red",
  },
  {
    id: 2,
    displayNumber: 11,
    rawPattern: Object.freeze([1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1]),
    theme: "pink",
  },
  {
    id: 3,
    displayNumber: 10,
    rawPattern: Object.freeze([1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1]),
    theme: "blue",
  },
  {
    id: 4,
    displayNumber: 9,
    rawPattern: Object.freeze([1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0]),
    theme: "purple",
  },
  {
    id: 5,
    displayNumber: 8,
    rawPattern: Object.freeze([1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0]),
    theme: "orange",
  },
  {
    id: 6,
    displayNumber: 7,
    rawPattern: Object.freeze([1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0]),
    theme: "purple",
    blankBoard: true,
    heroBadgeUrl: twoLineBadgeUrl,
    heroBadgeAlt: "2L",
  },
  {
    id: 7,
    displayNumber: 6,
    rawPattern: Object.freeze([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]),
    theme: "teal",
  },
  {
    id: 8,
    displayNumber: 5,
    rawPattern: Object.freeze([1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0]),
    theme: "green",
  },
  {
    id: 9,
    displayNumber: 4,
    rawPattern: Object.freeze([0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1]),
    theme: "yellow",
  },
  {
    id: 10,
    displayNumber: 3,
    rawPattern: Object.freeze([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]),
    theme: "orange",
  },
  {
    id: 11,
    displayNumber: 2,
    rawPattern: Object.freeze([0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    theme: "orange",
  },
  {
    id: 12,
    displayNumber: 1,
    rawPattern: Object.freeze([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]),
    theme: "blue",
    blankBoard: true,
    heroBadgeUrl: oneLineBadgeUrl,
    heroBadgeAlt: "1L",
  },
]);

export const theme1TopperCatalog: readonly Theme1TopperDesign[] = Object.freeze(
  PREVIEW_TOPPER_CARD_DEFINITIONS.map((definition) => ({
    id: definition.id,
    displayNumber: definition.displayNumber,
    uiCells: convertColumnMajorPatternToUiCells(definition.rawPattern),
    theme: definition.theme,
    blankBoard: definition.blankBoard ?? false,
    heroBadgeUrl: definition.heroBadgeUrl,
    heroBadgeAlt: definition.heroBadgeAlt,
  })),
);

function convertColumnMajorPatternToUiCells(pattern: readonly number[]) {
  const uiCells = Array<number>(15).fill(0);

  for (let column = 0; column < 5; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      uiCells[row * 5 + column] = pattern[column * 3 + row] ?? 0;
    }
  }

  return Object.freeze(uiCells);
}
