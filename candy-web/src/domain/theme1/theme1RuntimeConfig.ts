import {
  getTheme1PatternDefinition,
  THEME1_PATTERN_DEFINITIONS,
  type Theme1PatternMask,
} from "@/domain/theme1/patternDefinitions";

export type { Theme1PatternMask } from "@/domain/theme1/patternDefinitions";

export interface Theme1RuntimeConfig {
  maxBallNumber: number;
  defaultCardCount: number;
  defaultActivePatternIndexes: readonly number[];
  defaultPatternMasks: readonly Theme1PatternMask[];
  baseTopperPayoutAmounts: readonly number[];
  defaultTopperPayoutAmounts: readonly number[];
  defaultTopperPrizeLabels: readonly string[];
}

export const THEME1_MAX_BALL_NUMBER = 60;
export const THEME1_DEFAULT_CARD_COUNT = 4;

export const THEME1_BASE_TOPPER_PAYOUT_AMOUNTS = Object.freeze([
  1500,
  500,
  300,
  200,
  100,
  100,
  40,
  40,
  10,
  8,
  3,
  3,
]);

export const THEME1_DEFAULT_PATTERN_MASKS = Object.freeze<readonly Theme1PatternMask[]>(
  THEME1_PATTERN_DEFINITIONS.map((definition) => definition.mask),
);

export const THEME1_DEFAULT_ACTIVE_PATTERN_INDEXES = Object.freeze(
  THEME1_PATTERN_DEFINITIONS.map((definition) => definition.rawPatternIndex),
);

export const THEME1_DEFAULT_TOPPER_PAYOUT_AMOUNTS = Object.freeze([
  ...THEME1_BASE_TOPPER_PAYOUT_AMOUNTS,
]);

export const THEME1_DEFAULT_TOPPER_PRIZE_LABELS = Object.freeze(
  THEME1_DEFAULT_TOPPER_PAYOUT_AMOUNTS.map((amount) => formatTheme1KrAmount(amount)),
);

export const theme1RuntimeConfig: Theme1RuntimeConfig = Object.freeze({
  maxBallNumber: THEME1_MAX_BALL_NUMBER,
  defaultCardCount: THEME1_DEFAULT_CARD_COUNT,
  defaultActivePatternIndexes: THEME1_DEFAULT_ACTIVE_PATTERN_INDEXES,
  defaultPatternMasks: THEME1_DEFAULT_PATTERN_MASKS,
  baseTopperPayoutAmounts: THEME1_BASE_TOPPER_PAYOUT_AMOUNTS,
  defaultTopperPayoutAmounts: THEME1_DEFAULT_TOPPER_PAYOUT_AMOUNTS,
  defaultTopperPrizeLabels: THEME1_DEFAULT_TOPPER_PRIZE_LABELS,
});

export function resolveTheme1CardStakeAmount(totalBetAmount: number): number {
  if (!Number.isFinite(totalBetAmount) || totalBetAmount <= 0) {
    return 0;
  }

  return Math.max(0, Math.trunc(totalBetAmount)) / THEME1_DEFAULT_CARD_COUNT;
}

export function resolveTheme1TopperDisplayMultiplier(totalBetAmount: number): number {
  return Math.max(1, resolveTheme1CardStakeAmount(totalBetAmount));
}

export function resolveTheme1TopperPayoutAmounts(totalBetAmount: number): number[] {
  const multiplier = resolveTheme1TopperDisplayMultiplier(totalBetAmount);
  return THEME1_BASE_TOPPER_PAYOUT_AMOUNTS.map((amount) => amount * multiplier);
}

export function resolveTheme1TopperPrizeLabels(totalBetAmount: number): string[] {
  return resolveTheme1TopperPayoutAmounts(totalBetAmount).map((amount) =>
    formatTheme1KrAmount(amount),
  );
}

export function resolveTheme1PayoutSlotIndex(
  rawPatternIndex: number,
  payoutCount = THEME1_BASE_TOPPER_PAYOUT_AMOUNTS.length,
): number {
  if (payoutCount <= 0) {
    return -1;
  }

  const definition = getTheme1PatternDefinition(rawPatternIndex);
  if (!definition) {
    return clamp(rawPatternIndex, 0, payoutCount - 1);
  }

  return clamp(definition.topperSlotIndex, 0, payoutCount - 1);
}

export function formatTheme1KrAmount(amount: number): string {
  return `${formatTheme1WholeNumber(amount)} kr`;
}

export function formatTheme1WholeNumber(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })
    .format(Math.max(0, Math.trunc(amount)))
    .replaceAll(",", " ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
