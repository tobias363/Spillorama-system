export type Theme1PatternMask = readonly number[];

export interface Theme1PatternDefinition {
  rawPatternIndex: number;
  rawPatternNumber: number;
  displayPatternNumber: number;
  title: string;
  note: string;
  mask: Theme1PatternMask;
  topperSlotIndex: number;
  overlaySymbolId: string | null;
  overlayPathDefinition: string | null;
}

const PATTERN_MASKS: readonly Theme1PatternMask[] = Object.freeze([
  Object.freeze([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
  Object.freeze([1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1]),
  Object.freeze([1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1]),
  Object.freeze([1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0]),
  Object.freeze([1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0]),
  Object.freeze([1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0]),
  Object.freeze([1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1]),
  Object.freeze([0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1]),
  Object.freeze([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]),
  Object.freeze([1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0]),
  Object.freeze([0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1]),
  Object.freeze([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]),
  Object.freeze([0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  Object.freeze([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]),
  Object.freeze([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
  Object.freeze([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
]);

export const THEME1_PATTERN_DEFINITIONS = Object.freeze<readonly Theme1PatternDefinition[]>([
  {
    rawPatternIndex: 0,
    rawPatternNumber: 1,
    displayPatternNumber: 12,
    title: "Mønster 12",
    note: "Full grid",
    mask: PATTERN_MASKS[0],
    topperSlotIndex: 0,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 50H450V250H50V50M150 50V250M250 50V250M350 50V250M50 150H450",
  },
  {
    rawPatternIndex: 1,
    rawPatternNumber: 2,
    displayPatternNumber: 11,
    title: "Mønster 11",
    note: "Outline",
    mask: PATTERN_MASKS[1],
    topperSlotIndex: 1,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 50H450V250H50V50",
  },
  {
    rawPatternIndex: 2,
    rawPatternNumber: 3,
    displayPatternNumber: 10,
    title: "Mønster 10",
    note: "Frame ladder",
    mask: PATTERN_MASKS[2],
    topperSlotIndex: 2,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 50H450M50 150H450M50 250H450M50 50V250M450 50V250",
  },
  {
    rawPatternIndex: 3,
    rawPatternNumber: 4,
    displayPatternNumber: 9,
    title: "Mønster 9",
    note: "Triangle",
    mask: PATTERN_MASKS[3],
    topperSlotIndex: 3,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 250H450M50 250L250 50L450 250",
  },
  {
    rawPatternIndex: 4,
    rawPatternNumber: 5,
    displayPatternNumber: 8,
    title: "Mønster 8",
    note: "Top beam",
    mask: PATTERN_MASKS[4],
    topperSlotIndex: 4,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 50H450M150 50V250M350 50V250",
  },
  {
    rawPatternIndex: 5,
    rawPatternNumber: 6,
    displayPatternNumber: 7,
    title: "Mønster 7",
    note: "Top + middle rows",
    mask: PATTERN_MASKS[5],
    topperSlotIndex: 5,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 50H450M50 150H450",
  },
  {
    rawPatternIndex: 6,
    rawPatternNumber: 7,
    displayPatternNumber: 7,
    title: "Mønster 7",
    note: "Top + bottom rows",
    mask: PATTERN_MASKS[6],
    topperSlotIndex: 5,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 50H450M50 250H450",
  },
  {
    rawPatternIndex: 7,
    rawPatternNumber: 8,
    displayPatternNumber: 7,
    title: "Mønster 7",
    note: "Middle + bottom rows",
    mask: PATTERN_MASKS[7],
    topperSlotIndex: 5,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 150H450M50 250H450",
  },
  {
    rawPatternIndex: 8,
    rawPatternNumber: 9,
    displayPatternNumber: 6,
    title: "Mønster 6",
    note: "Checker grid",
    mask: PATTERN_MASKS[8],
    topperSlotIndex: 6,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 50L150 150L250 50L350 150L450 50M50 250L150 150L250 250L350 150L450 250",
  },
  {
    rawPatternIndex: 9,
    rawPatternNumber: 10,
    displayPatternNumber: 5,
    title: "Mønster 5",
    note: "Bridge row",
    mask: PATTERN_MASKS[9],
    topperSlotIndex: 7,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 150H450M50 50V150M450 50V150M250 150V250",
  },
  {
    rawPatternIndex: 10,
    rawPatternNumber: 11,
    displayPatternNumber: 4,
    title: "Mønster 4",
    note: "Bottom crown",
    mask: PATTERN_MASKS[10],
    topperSlotIndex: 8,
    overlaySymbolId: null,
    overlayPathDefinition: "M50 250H450M50 250L250 50L450 250",
  },
  {
    rawPatternIndex: 11,
    rawPatternNumber: 12,
    displayPatternNumber: 3,
    title: "Mønster 3",
    note: "Side rails",
    mask: PATTERN_MASKS[11],
    topperSlotIndex: 9,
    overlaySymbolId: "pattern-12-sides",
    overlayPathDefinition: null,
  },
  {
    rawPatternIndex: 12,
    rawPatternNumber: 13,
    displayPatternNumber: 2,
    title: "Mønster 2",
    note: "Wide V",
    mask: PATTERN_MASKS[12],
    topperSlotIndex: 10,
    overlaySymbolId: "pattern-13-v",
    overlayPathDefinition: null,
  },
  {
    rawPatternIndex: 13,
    rawPatternNumber: 14,
    displayPatternNumber: 1,
    title: "Mønster 1",
    note: "Top row",
    mask: PATTERN_MASKS[13],
    topperSlotIndex: 11,
    overlaySymbolId: "pattern-14-top-row",
    overlayPathDefinition: null,
  },
  {
    rawPatternIndex: 14,
    rawPatternNumber: 15,
    displayPatternNumber: 1,
    title: "Mønster 1",
    note: "Middle row",
    mask: PATTERN_MASKS[14],
    topperSlotIndex: 11,
    overlaySymbolId: "pattern-15-middle-row",
    overlayPathDefinition: null,
  },
  {
    rawPatternIndex: 15,
    rawPatternNumber: 16,
    displayPatternNumber: 1,
    title: "Mønster 1",
    note: "Bottom row",
    mask: PATTERN_MASKS[15],
    topperSlotIndex: 11,
    overlaySymbolId: "pattern-16-bottom-row",
    overlayPathDefinition: null,
  },
]);

const patternDefinitionByRawIndex = new Map(
  THEME1_PATTERN_DEFINITIONS.map((definition) => [
    definition.rawPatternIndex,
    definition,
  ] as const),
);

export function getTheme1PatternDefinition(
  rawPatternIndex: number,
): Theme1PatternDefinition | undefined {
  return patternDefinitionByRawIndex.get(rawPatternIndex);
}

export function getTheme1PatternMask(
  rawPatternIndex: number,
): Theme1PatternMask | undefined {
  return patternDefinitionByRawIndex.get(rawPatternIndex)?.mask;
}
