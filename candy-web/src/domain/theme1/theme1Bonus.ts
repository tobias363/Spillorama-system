import type {
  Theme1BonusPayoutEntry,
  Theme1BonusSlotState,
  Theme1BonusState,
  Theme1BonusSymbolId,
} from "@/domain/theme1/renderModel";

export const THEME1_BONUS_SLOT_COUNT = 9;
export const THEME1_BONUS_PICK_LIMIT = 3;

export const theme1BonusPayoutTable: readonly Theme1BonusPayoutEntry[] = [
  {
    symbolId: "asset-19",
    label: "30 kr figur",
    shortLabel: "30 kr",
    payoutKr: 30,
  },
  {
    symbolId: "asset-8",
    label: "60 kr figur",
    shortLabel: "60 kr",
    payoutKr: 60,
  },
  {
    symbolId: "asset-7",
    label: "100 kr figur",
    shortLabel: "100 kr",
    payoutKr: 100,
  },
  {
    symbolId: "asset-6",
    label: "300 kr figur",
    shortLabel: "300 kr",
    payoutKr: 300,
  },
  {
    symbolId: "asset-10",
    label: "500 kr figur",
    shortLabel: "500 kr",
    payoutKr: 500,
  },
  {
    symbolId: "asset-9",
    label: "1 500 kr figur",
    shortLabel: "1 500 kr",
    payoutKr: 1500,
  },
  {
    symbolId: "asset-4",
    label: "10 000 kr figur",
    shortLabel: "10 000 kr",
    payoutKr: 10000,
  },
] as const;

const THEME1_BONUS_EMPTY_RESULT = {
  matchedSymbolId: null,
  winAmount: 0,
  isWin: false,
} as const;

interface CreateTheme1BonusRoundOptions {
  random?: () => number;
  symbolTripletIds?: readonly Theme1BonusSymbolId[];
  shuffledSymbolIds?: readonly Theme1BonusSymbolId[];
}

export function createIdleTheme1BonusState(): Theme1BonusState {
  return {
    status: "idle",
    slotCount: THEME1_BONUS_SLOT_COUNT,
    pickLimit: THEME1_BONUS_PICK_LIMIT,
    selectedSlotIds: [],
    slots: createBonusSlots(Array.from({ length: THEME1_BONUS_SLOT_COUNT }, () => null)),
    payoutTable: [...theme1BonusPayoutTable],
    result: { ...THEME1_BONUS_EMPTY_RESULT },
  };
}

export function createTheme1BonusRound(
  options: CreateTheme1BonusRoundOptions = {},
): Theme1BonusState {
  const symbolIds = resolveRoundSymbolIds(options);

  return {
    status: "open",
    slotCount: THEME1_BONUS_SLOT_COUNT,
    pickLimit: THEME1_BONUS_PICK_LIMIT,
    selectedSlotIds: [],
    slots: createBonusSlots(symbolIds),
    payoutTable: [...theme1BonusPayoutTable],
    result: { ...THEME1_BONUS_EMPTY_RESULT },
  };
}

export function createTheme1WinningBonusRound(
  options: Pick<CreateTheme1BonusRoundOptions, "random"> & {
    winningSymbolId?: Theme1BonusSymbolId;
  } = {},
): Theme1BonusState {
  const random = options.random;
  const availableSymbolIds = theme1BonusPayoutTable.map((entry) => entry.symbolId);
  const winningSymbolId =
    options.winningSymbolId ?? shuffleItems(availableSymbolIds, random)[0];
  const fillerSymbolIds = shuffleItems(
    availableSymbolIds.filter((symbolId) => symbolId !== winningSymbolId),
    random,
  ).slice(0, 2);

  return createTheme1BonusRound({
    shuffledSymbolIds: [
      winningSymbolId,
      winningSymbolId,
      winningSymbolId,
      ...shuffleItems(
        fillerSymbolIds.flatMap((symbolId) => [symbolId, symbolId, symbolId]),
        random,
      ),
    ],
  });
}

export function selectTheme1BonusSlot(
  currentState: Theme1BonusState,
  slotId: string,
): Theme1BonusState {
  if (currentState.status !== "open") {
    return currentState;
  }

  if (currentState.selectedSlotIds.length >= currentState.pickLimit) {
    return currentState;
  }

  const slot = currentState.slots.find((candidate) => candidate.id === slotId);
  if (!slot || slot.selected || slot.symbolId === null) {
    return currentState;
  }

  const selectedSlotIds = [...currentState.selectedSlotIds, slotId];
  const slots = currentState.slots.map((candidate) =>
    candidate.id === slotId
      ? {
          ...candidate,
          selected: true,
          revealed: true,
        }
      : candidate,
  );

  if (selectedSlotIds.length < currentState.pickLimit) {
    return {
      ...currentState,
      selectedSlotIds,
      slots,
    };
  }

  const selectedSymbols = selectedSlotIds
    .map((selectedId) => slots.find((candidate) => candidate.id === selectedId)?.symbolId ?? null)
    .filter((symbolId): symbolId is Theme1BonusSymbolId => symbolId !== null);
  const matchedSymbolId =
    selectedSymbols.length === currentState.pickLimit &&
    selectedSymbols.every((symbolId) => symbolId === selectedSymbols[0])
      ? selectedSymbols[0]
      : null;
  const payoutEntry = matchedSymbolId
    ? currentState.payoutTable.find((entry) => entry.symbolId === matchedSymbolId)
    : undefined;

  return {
    ...currentState,
    status: "resolved",
    selectedSlotIds,
    slots,
    result: {
      matchedSymbolId,
      winAmount: payoutEntry?.payoutKr ?? 0,
      isWin: Boolean(matchedSymbolId),
    },
  };
}

function createBonusSlots(
  symbolIds: readonly (Theme1BonusSymbolId | null)[],
): Theme1BonusSlotState[] {
  return symbolIds.map((symbolId, index) => ({
    id: `bonus-slot-${index + 1}`,
    revealed: false,
    selected: false,
    symbolId,
  }));
}

function resolveRoundSymbolIds(
  options: CreateTheme1BonusRoundOptions,
): Theme1BonusSymbolId[] {
  if (options.shuffledSymbolIds) {
    return validateShuffledSymbolIds(options.shuffledSymbolIds);
  }

  const tripletIds =
    options.symbolTripletIds ?? drawDistinctBonusSymbols(theme1BonusPayoutTable, options.random);
  const validatedTripletIds = validateTripletIds(tripletIds);
  const symbolIds = validatedTripletIds.flatMap((symbolId) => [symbolId, symbolId, symbolId]);

  return shuffleItems(symbolIds, options.random);
}

function validateTripletIds(
  symbolTripletIds: readonly Theme1BonusSymbolId[],
): readonly Theme1BonusSymbolId[] {
  if (symbolTripletIds.length !== 3) {
    throw new Error("Theme1 bonus round requires exactly 3 distinct symbols.");
  }

  const uniqueSymbolIds = new Set(symbolTripletIds);
  if (uniqueSymbolIds.size !== symbolTripletIds.length) {
    throw new Error("Theme1 bonus round requires distinct symbols per triplet.");
  }

  return symbolTripletIds;
}

function validateShuffledSymbolIds(
  shuffledSymbolIds: readonly Theme1BonusSymbolId[],
): Theme1BonusSymbolId[] {
  if (shuffledSymbolIds.length !== THEME1_BONUS_SLOT_COUNT) {
    throw new Error("Theme1 bonus round requires exactly 9 slot symbols.");
  }

  return [...shuffledSymbolIds];
}

function drawDistinctBonusSymbols(
  payoutTable: readonly Theme1BonusPayoutEntry[],
  random: (() => number) | undefined,
): Theme1BonusSymbolId[] {
  return shuffleItems(
    payoutTable.map((entry) => entry.symbolId),
    random,
  ).slice(0, 3);
}

function shuffleItems<T>(items: readonly T[], random = Math.random): T[] {
  const shuffledItems = [...items];

  for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffledItems[index], shuffledItems[swapIndex]] = [
      shuffledItems[swapIndex],
      shuffledItems[index],
    ];
  }

  return shuffledItems;
}
