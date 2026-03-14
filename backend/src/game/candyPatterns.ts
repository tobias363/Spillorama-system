import type { Ticket } from "./types.js";

export type CandyPatternMask = readonly number[];

export interface CandyPatternDefinition {
  rawPatternIndex: number;
  rawPatternNumber: number;
  displayPatternNumber: number;
  title: string;
  note: string;
  mask: CandyPatternMask;
  topperSlotIndex: number;
  payoutWeight: number;
}

export interface CandyPatternFamilyDefinition {
  topperSlotIndex: number;
  displayPatternNumber: number;
  title: string;
  note: string;
  payoutWeight: number;
  expectedHitRatePerTicket: number;
  rawPatternIndexes: readonly number[];
  variants: readonly CandyPatternDefinition[];
}

export interface CandyPatternFamilyMatch {
  rawPatternIndex: number;
  displayPatternNumber: number;
  topperSlotIndex: number;
  title: string;
  note: string;
}

export interface CandyPatternFamilyNearMissMatch extends CandyPatternFamilyMatch {
  missingNumber: number;
  patternNumbers: readonly number[];
}

// Calibrated from 20k random 60-ball / 30-draw simulations with Candy 3x5 tickets.
// These values are per ticket and keep payout scaling tied to actual pattern frequency.
const PATTERN_FAMILY_HIT_RATE_PER_TICKET = Object.freeze([
  0,
  0.00006875,
  0.0001625,
  0.00044375,
  0.001,
  0.0012625,
  0.0023,
  0.0023625,
  0.0023125,
  0.0118,
  0.02599375,
  0.07708125,
]);

export const CANDY_PATTERN_PAYOUT_WEIGHTS = Object.freeze([
  2400,
  2200,
  2000,
  1800,
  1600,
  1400,
  1200,
  1000,
  800,
  600,
  400,
  200,
]);

const PATTERN_MASKS: readonly CandyPatternMask[] = Object.freeze([
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

export const CANDY_PATTERN_DEFINITIONS = Object.freeze<readonly CandyPatternDefinition[]>([
  {
    rawPatternIndex: 0,
    rawPatternNumber: 1,
    displayPatternNumber: 12,
    title: "Mønster 12",
    note: "Full grid",
    mask: PATTERN_MASKS[0],
    topperSlotIndex: 0,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[0],
  },
  {
    rawPatternIndex: 1,
    rawPatternNumber: 2,
    displayPatternNumber: 11,
    title: "Mønster 11",
    note: "Outline",
    mask: PATTERN_MASKS[1],
    topperSlotIndex: 1,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[1],
  },
  {
    rawPatternIndex: 2,
    rawPatternNumber: 3,
    displayPatternNumber: 10,
    title: "Mønster 10",
    note: "Frame ladder",
    mask: PATTERN_MASKS[2],
    topperSlotIndex: 2,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[2],
  },
  {
    rawPatternIndex: 3,
    rawPatternNumber: 4,
    displayPatternNumber: 9,
    title: "Mønster 9",
    note: "Triangle",
    mask: PATTERN_MASKS[3],
    topperSlotIndex: 3,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[3],
  },
  {
    rawPatternIndex: 4,
    rawPatternNumber: 5,
    displayPatternNumber: 8,
    title: "Mønster 8",
    note: "Top beam",
    mask: PATTERN_MASKS[4],
    topperSlotIndex: 4,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[4],
  },
  {
    rawPatternIndex: 5,
    rawPatternNumber: 6,
    displayPatternNumber: 7,
    title: "Mønster 7",
    note: "Top + middle rows",
    mask: PATTERN_MASKS[5],
    topperSlotIndex: 5,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[5],
  },
  {
    rawPatternIndex: 6,
    rawPatternNumber: 7,
    displayPatternNumber: 7,
    title: "Mønster 7",
    note: "Top + bottom rows",
    mask: PATTERN_MASKS[6],
    topperSlotIndex: 5,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[5],
  },
  {
    rawPatternIndex: 7,
    rawPatternNumber: 8,
    displayPatternNumber: 7,
    title: "Mønster 7",
    note: "Middle + bottom rows",
    mask: PATTERN_MASKS[7],
    topperSlotIndex: 5,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[5],
  },
  {
    rawPatternIndex: 8,
    rawPatternNumber: 9,
    displayPatternNumber: 6,
    title: "Mønster 6",
    note: "Checker grid",
    mask: PATTERN_MASKS[8],
    topperSlotIndex: 6,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[6],
  },
  {
    rawPatternIndex: 9,
    rawPatternNumber: 10,
    displayPatternNumber: 5,
    title: "Mønster 5",
    note: "Bridge row",
    mask: PATTERN_MASKS[9],
    topperSlotIndex: 7,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[7],
  },
  {
    rawPatternIndex: 10,
    rawPatternNumber: 11,
    displayPatternNumber: 4,
    title: "Mønster 4",
    note: "Bottom crown",
    mask: PATTERN_MASKS[10],
    topperSlotIndex: 8,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[8],
  },
  {
    rawPatternIndex: 11,
    rawPatternNumber: 12,
    displayPatternNumber: 3,
    title: "Mønster 3",
    note: "Side rails",
    mask: PATTERN_MASKS[11],
    topperSlotIndex: 9,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[9],
  },
  {
    rawPatternIndex: 12,
    rawPatternNumber: 13,
    displayPatternNumber: 2,
    title: "Mønster 2",
    note: "Wide V",
    mask: PATTERN_MASKS[12],
    topperSlotIndex: 10,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[10],
  },
  {
    rawPatternIndex: 13,
    rawPatternNumber: 14,
    displayPatternNumber: 1,
    title: "Mønster 1",
    note: "Top row",
    mask: PATTERN_MASKS[13],
    topperSlotIndex: 11,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[11],
  },
  {
    rawPatternIndex: 14,
    rawPatternNumber: 15,
    displayPatternNumber: 1,
    title: "Mønster 1",
    note: "Middle row",
    mask: PATTERN_MASKS[14],
    topperSlotIndex: 11,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[11],
  },
  {
    rawPatternIndex: 15,
    rawPatternNumber: 16,
    displayPatternNumber: 1,
    title: "Mønster 1",
    note: "Bottom row",
    mask: PATTERN_MASKS[15],
    topperSlotIndex: 11,
    payoutWeight: CANDY_PATTERN_PAYOUT_WEIGHTS[11],
  },
]);

const groupedFamilies = new Map<number, CandyPatternDefinition[]>();
for (const definition of CANDY_PATTERN_DEFINITIONS) {
  const existing = groupedFamilies.get(definition.topperSlotIndex);
  if (existing) {
    existing.push(definition);
    continue;
  }
  groupedFamilies.set(definition.topperSlotIndex, [definition]);
}

export const CANDY_PATTERN_FAMILIES = Object.freeze(
  [...groupedFamilies.entries()]
    .sort(([left], [right]) => left - right)
    .map(([topperSlotIndex, variants]): CandyPatternFamilyDefinition => {
      const primary = variants[0];
      return {
        topperSlotIndex,
        displayPatternNumber: primary.displayPatternNumber,
        title: primary.title,
        note: primary.note,
        payoutWeight: primary.payoutWeight,
        expectedHitRatePerTicket:
          PATTERN_FAMILY_HIT_RATE_PER_TICKET[topperSlotIndex] ?? 0,
        rawPatternIndexes: variants.map((variant) => variant.rawPatternIndex),
        variants,
      };
    }),
);

const PATTERN_FAMILY_BY_SLOT = new Map(
  CANDY_PATTERN_FAMILIES.map((family) => [family.topperSlotIndex, family] as const),
);

const EXPECTED_WEIGHTED_HIT_LOAD_PER_TICKET = CANDY_PATTERN_FAMILIES.reduce(
  (sum, family) => sum + family.expectedHitRatePerTicket * family.payoutWeight,
  0,
);
// Empirical correction from engine-level 60-ball / 30-draw simulations.
// Pattern-family math is close to target on paper, but real rounds land slightly
// under because of ticket/draw correlations and settlement ordering.
const CANDY_PATTERN_RTP_CALIBRATION_FACTOR = 1;

export function getCandyPatternFamilyDefinition(
  topperSlotIndex: number,
): CandyPatternFamilyDefinition | undefined {
  return PATTERN_FAMILY_BY_SLOT.get(topperSlotIndex);
}

export function getCandyActivePatternIndexes(): number[] {
  return CANDY_PATTERN_DEFINITIONS.map((definition) => definition.rawPatternIndex);
}

export function resolveCandyPatternPayoutAmounts(
  entryFee: number,
  payoutPercent: number,
  ticketsPerPlayer: number,
): number[] {
  const normalizedEntryFee =
    Number.isFinite(entryFee) && entryFee > 0 ? Math.max(0, entryFee) : 0;
  const normalizedPayoutPercent =
    Number.isFinite(payoutPercent) && payoutPercent > 0
      ? Math.max(0, payoutPercent)
      : 0;
  const normalizedTicketsPerPlayer =
    Number.isFinite(ticketsPerPlayer) && ticketsPerPlayer > 0
      ? Math.max(1, Math.floor(ticketsPerPlayer))
      : 1;

  if (
    normalizedEntryFee <= 0 ||
    normalizedPayoutPercent <= 0 ||
    EXPECTED_WEIGHTED_HIT_LOAD_PER_TICKET <= 0
  ) {
    return CANDY_PATTERN_FAMILIES.map(() => 0);
  }

  const expectedWeightedHitLoadPerPlayer =
    EXPECTED_WEIGHTED_HIT_LOAD_PER_TICKET * normalizedTicketsPerPlayer;
  const payoutTargetPerPlayer =
    normalizedEntryFee * (normalizedPayoutPercent / 100);
  const payoutUnit =
    expectedWeightedHitLoadPerPlayer > 0
      ? (payoutTargetPerPlayer / expectedWeightedHitLoadPerPlayer) *
        CANDY_PATTERN_RTP_CALIBRATION_FACTOR
      : 0;

  return CANDY_PATTERN_FAMILIES.map((family) => family.payoutWeight * payoutUnit);
}

export function findCompletedCandyPatternFamilies(
  ticket: Ticket,
  markedNumbers: ReadonlySet<number>,
): CandyPatternFamilyMatch[] {
  const flatNumbers = getFlatTicketNumbers(ticket);
  const matches: CandyPatternFamilyMatch[] = [];

  for (const family of CANDY_PATTERN_FAMILIES) {
    const completedVariant = family.variants.find((variant) =>
      variant.mask.every(
        (required, index) =>
          required !== 1 || markedNumbers.has(flatNumbers[index] ?? -1),
      ),
    );
    if (!completedVariant) {
      continue;
    }

    matches.push({
      rawPatternIndex: completedVariant.rawPatternIndex,
      displayPatternNumber: completedVariant.displayPatternNumber,
      topperSlotIndex: completedVariant.topperSlotIndex,
      title: completedVariant.title,
      note: completedVariant.note,
    });
  }

  return matches;
}

export function findNearMissCandyPatternFamilies(
  ticket: Ticket,
  markedNumbers: ReadonlySet<number>,
  settledTopperSlotIndexes?: ReadonlySet<number>,
): CandyPatternFamilyNearMissMatch[] {
  const flatNumbers = getFlatTicketNumbers(ticket);
  const matches: CandyPatternFamilyNearMissMatch[] = [];

  for (const family of CANDY_PATTERN_FAMILIES) {
    if (settledTopperSlotIndexes?.has(family.topperSlotIndex)) {
      continue;
    }

    const nearVariant = family.variants.find((definition) => {
      let missingCount = 0;
      for (let index = 0; index < definition.mask.length; index += 1) {
        if (definition.mask[index] !== 1) {
          continue;
        }

        const number = flatNumbers[index] ?? -1;
        if (!markedNumbers.has(number)) {
          missingCount += 1;
          if (missingCount > 1) {
            return false;
          }
        }
      }
      return missingCount === 1;
    });
    if (!nearVariant) {
      continue;
    }

    const patternNumbers = resolvePatternNumbers(flatNumbers, nearVariant.mask);
    const missingNumber = patternNumbers.find((number) => !markedNumbers.has(number)) ?? 0;
    if (missingNumber <= 0) {
      continue;
    }

    matches.push({
      rawPatternIndex: nearVariant.rawPatternIndex,
      displayPatternNumber: nearVariant.displayPatternNumber,
      topperSlotIndex: nearVariant.topperSlotIndex,
      title: nearVariant.title,
      note: nearVariant.note,
      missingNumber,
      patternNumbers,
    });
  }

  return matches;
}

export function countNearMissCandyPatternFamilies(
  ticket: Ticket,
  markedNumbers: ReadonlySet<number>,
  settledTopperSlotIndexes?: ReadonlySet<number>,
): number {
  return findNearMissCandyPatternFamilies(ticket, markedNumbers, settledTopperSlotIndexes).length;
}

export function getCandyPatternNumberSets(ticket: Ticket): number[][] {
  const flatNumbers = getFlatTicketNumbers(ticket);
  return CANDY_PATTERN_DEFINITIONS.map((definition) =>
    [...resolvePatternNumbers(flatNumbers, definition.mask)],
  );
}

function getFlatTicketNumbers(ticket: Ticket): readonly number[] {
  return Array.isArray(ticket?.numbers) && ticket.numbers.length > 0
    ? ticket.numbers
    : ticket?.grid?.flat?.() ?? [];
}

function resolvePatternNumbers(
  flatNumbers: readonly number[],
  mask: CandyPatternMask,
): readonly number[] {
  const numbers: number[] = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 1) {
      continue;
    }

    const number = Math.trunc(flatNumbers[index] ?? 0);
    if (number > 0) {
      numbers.push(number);
    }
  }
  return numbers;
}
