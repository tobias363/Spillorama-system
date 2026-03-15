import type {
  Player,
  RealtimeSession,
  RoomSnapshot,
  RoomSnapshotWithScheduler,
  Ticket,
} from "@/domain/realtime/contracts";
import {
  columnMajorIndexToUiIndex,
  convertColumnMajorIndexesToUi,
  getTheme1PatternCatalogEntry,
} from "@/domain/theme1/patternCatalog";
import {
  createEmptyTicketNumbers,
  flattenTicketNumbers,
  normalizeTicketNumbers,
  resolvePlayerContext,
  resolveVisibleTickets,
  type Theme1ResolvedPlayerContext,
  type Theme1RoomTicketSource,
} from "@/domain/theme1/mappers/theme1TicketResolution";
import {
  THEME1_CARD_CELL_COUNT,
  THEME1_DEFAULT_BALL_SLOT_COUNT,
  THEME1_DEFAULT_CARD_SLOT_COUNT,
  createEmptyTheme1RoundRenderState,
  type Theme1CardCellRenderState,
  type Theme1CardCellVisualState,
  type Theme1CellPrizeLabelRenderState,
  type Theme1CompletedPatternRenderState,
  type Theme1ConnectionPhase,
  type Theme1DataSource,
  type Theme1BoardPrizeAnchor,
  type Theme1BoardPrizeLabelState,
  type Theme1BoardPrizeStackState,
  type Theme1NearPatternRenderState,
  type Theme1PatternOverlayKind,
  type Theme1PrizeVisualState,
  type Theme1RoundRenderModel,
  type Theme1RoundRenderState,
  type Theme1TopperSlotRenderState,
  type Theme1WinLabelAnchor,
} from "@/domain/theme1/renderModel";
import {
  THEME1_DEFAULT_ACTIVE_PATTERN_INDEXES,
  THEME1_DEFAULT_PATTERN_MASKS,
  THEME1_DEFAULT_TOPPER_PRIZE_LABELS,
  THEME1_MAX_BALL_NUMBER,
  formatTheme1KrAmount,
  formatTheme1WholeNumber,
  resolveTheme1CardStakeAmount,
  resolveTheme1PayoutSlotIndex,
  resolveTheme1TopperPayoutAmounts,
  type Theme1PatternMask,
} from "@/domain/theme1/theme1RuntimeConfig";
import type {
  Theme1BoardPatternOverlayState,
  Theme1BoardState,
  Theme1CellTone,
  Theme1TopperState,
} from "@/domain/theme1/renderModel";

interface Theme1NearWinResult {
  rawPatternIndex: number;
  slotIndex: number;
  cardIndex: number;
  cellIndex: number;
  missingNumber: number;
  payoutAmount: number;
}

interface Theme1PatternDefinition {
  rawPatternIndex: number;
  slotIndex: number;
  cells: number[];
  payoutAmount: number;
  requiredCount: number;
}

interface Theme1CardPatternEvaluation {
  matchedPatternIndexes: Set<number>;
  nearWinsByCell: Map<number, Theme1NearWinResult[]>;
  nearWins: Theme1NearWinResult[];
}

interface Theme1PatternEvaluation {
  cards: Theme1CardPatternEvaluation[];
  nearWinsByTopperSlot: Map<number, Theme1NearWinResult[]>;
}

export {
  THEME1_DEFAULT_ACTIVE_PATTERN_INDEXES,
  THEME1_DEFAULT_PATTERN_MASKS,
} from "@/domain/theme1/theme1RuntimeConfig";
export type { Theme1PatternMask } from "@/domain/theme1/theme1RuntimeConfig";

export interface Theme1RoomSnapshotMapperOptions {
  playerId?: string;
  session?: RealtimeSession;
  mode?: Theme1DataSource;
  connectionPhase?: Theme1ConnectionPhase;
  connectionLabel?: string;
  cardSlotCount?: number;
  currentTicketPage?: number;
  duplicateSingleTicketAcrossCards?: boolean;
  ballSlotCount?: number;
  fallbackTopperSlotCount?: number;
  activePatternIndexes?: readonly number[];
  patternMasks?: readonly Theme1PatternMask[];
  preferredNearPatternIndexesByCard?: readonly number[];
  cardHeaderLabels?: readonly string[];
  cardBetLabels?: readonly string[];
  cardWinLabels?: readonly string[];
  topperPrizeLabels?: readonly string[];
  topperPayoutAmounts?: readonly number[];
  countdownLabel?: string;
  playerCountLabel?: string;
  creditLabel?: string;
  winningsLabel?: string;
  betLabel?: string;
}

export interface Theme1MappedRoomSnapshot {
  renderState: Theme1RoundRenderState;
  model: Theme1RoundRenderModel;
  resolvedPlayerId?: string;
  playerId?: string;
  ticketSource: Theme1RoomTicketSource;
  visibleTickets: number[][];
  activePatternIndexes: number[];
}

export function inferTheme1PlayerId(snapshot: RoomSnapshot): string | undefined {
  return resolvePlayerContext(snapshot).playerId;
}

export function mapRoomSnapshotToTheme1(
  snapshot: RoomSnapshot | RoomSnapshotWithScheduler,
  options: Theme1RoomSnapshotMapperOptions = {},
): Theme1MappedRoomSnapshot {
  const playerContext = resolvePlayerContext(snapshot, options.playerId);
  const selectedPlayerId = playerContext.playerId;
  const currentGame = snapshot.currentGame;
  const currentTicketPage = Math.max(0, options.currentTicketPage ?? 0);
  const cardSlotCount = Math.max(
    0,
    options.cardSlotCount ?? THEME1_DEFAULT_CARD_SLOT_COUNT,
  );
  const ballSlotCount = Math.max(
    0,
    options.ballSlotCount ?? THEME1_DEFAULT_BALL_SLOT_COUNT,
  );
  const duplicateSingleTicketAcrossCards =
    options.duplicateSingleTicketAcrossCards ?? true;
  const patternMasks = normalizePatternMasks(options.patternMasks);
  const activePatternIndexes = normalizeActivePatternIndexes(
    options.activePatternIndexes ?? currentGame?.activePatternIndexes,
    patternMasks.length,
  );
  const effectiveEntryFee = resolveEffectiveEntryFee(snapshot);
  const topperPayoutAmounts = normalizeTopperPayoutAmounts(
    options.topperPayoutAmounts ?? currentGame?.patternPayoutAmounts,
    effectiveEntryFee,
  );
  const topperSlotCount = resolveTopperSlotCount(options, topperPayoutAmounts);
  const topperPrizeLabels = resolveTopperPrizeLabels(
    options.topperPrizeLabels,
    topperPayoutAmounts,
    topperSlotCount,
  );
  const normalizedTopperPayoutAmounts = padNumberList(
    topperPayoutAmounts,
    topperSlotCount,
  );
  const ticketSets = playerContext.tickets.map((ticket) =>
    flattenTicketNumbers(ticket),
  );
  const visibleTickets = resolveVisibleTickets(
    ticketSets,
    cardSlotCount,
    currentTicketPage,
    duplicateSingleTicketAcrossCards,
  );
  const drawnNumbers = extractValidDrawnNumbers(currentGame?.drawnNumbers ?? []);
  const drawOrderByNumber = buildDrawOrderLookup(drawnNumbers);
  const patternEvaluation = evaluatePatterns(
    visibleTickets,
    drawnNumbers,
    activePatternIndexes,
    patternMasks,
    normalizedTopperPayoutAmounts,
    topperSlotCount,
  );
  const boardPatternEvaluation = evaluatePatterns(
    visibleTickets,
    drawnNumbers,
    THEME1_DEFAULT_ACTIVE_PATTERN_INDEXES,
    patternMasks,
    normalizedTopperPayoutAmounts,
    topperSlotCount,
  );

  const renderState = createEmptyTheme1RoundRenderState(
    cardSlotCount,
    ballSlotCount,
    topperSlotCount,
  );
  renderState.gameId = currentGame?.id ?? "";

  for (let cardIndex = 0; cardIndex < renderState.cards.length; cardIndex += 1) {
    const ticket = visibleTickets[cardIndex] ?? createEmptyTicketNumbers();
    const cardEvaluation = patternEvaluation.cards[cardIndex];
    const boardCardEvaluation = boardPatternEvaluation.cards[cardIndex];
    const matchedPatternIndexes = toSortedArray(
      boardCardEvaluation?.matchedPatternIndexes ?? new Set<number>(),
    );
    const completedPatterns = buildCompletedPatternStates(
      matchedPatternIndexes,
      ticket,
      drawOrderByNumber,
      patternMasks,
      normalizedTopperPayoutAmounts,
      topperSlotCount,
    );
    const activeNearPatterns =
      completedPatterns.length > 0
        ? []
        : buildActiveNearPatternStates(
            cardIndex,
            boardCardEvaluation,
            ticket,
            patternMasks,
            normalizedTopperPayoutAmounts,
            topperSlotCount,
          );
    const cardWinAmount = resolveCardWinAmount(
      boardCardEvaluation?.matchedPatternIndexes ?? new Set<number>(),
      normalizedTopperPayoutAmounts,
      topperSlotCount,
    );
    const fallbackWinLabel = readStringAt(options.cardWinLabels, cardIndex, "");
    const showWinLabel = cardWinAmount > 0;

    const cardState = renderState.cards[cardIndex];
    cardState.headerLabel = readStringAt(
      options.cardHeaderLabels,
      cardIndex,
      formatTheme1CardHeaderLabel(cardIndex),
    );
    cardState.betLabel = readStringAt(
      options.cardBetLabels,
      cardIndex,
      formatTheme1CardStakeLabel(effectiveEntryFee),
    );
    cardState.winLabel = showWinLabel
      ? formatTheme1CardWinLabel(cardWinAmount)
      : normalizeHiddenWinLabel(fallbackWinLabel);
    cardState.showWinLabel = showWinLabel;
    cardState.paylinesActive = Array.from(
      { length: patternMasks.length },
      (_, patternIndex) =>
        boardCardEvaluation?.matchedPatternIndexes.has(patternIndex) ?? false,
    );
    cardState.matchedPatternIndexes = matchedPatternIndexes;
    cardState.completedPatterns = completedPatterns;
    cardState.activeNearPatterns = activeNearPatterns;

    for (let cellIndex = 0; cellIndex < THEME1_CARD_CELL_COUNT; cellIndex += 1) {
      const number = ticket[cellIndex] ?? 0;
      const nearWins = boardCardEvaluation?.nearWinsByCell.get(cellIndex) ?? [];
      const targetNearPatterns = activeNearPatterns.filter(
        (pattern) => pattern.targetCellIndex === cellIndex,
      );
      const isNearTargetCell = targetNearPatterns.length > 0;
      const completedPatternIndexes = extractCompletedPatternIndexes(
        completedPatterns,
        cellIndex,
      );
      const nearWinPatternIndexes = extractNearWinPatternIndexes(nearWins);
      const prizeLabels = buildCellPrizeLabels(
        completedPatterns,
        activeNearPatterns,
        cellIndex,
      );
      const isPrizeCell = hasCompletedPrizeLabel(completedPatterns, cellIndex);
      const isMatchedByCompletedPattern = isCellMatchedByCompletedPatterns(
        cellIndex,
        completedPatterns,
      );
      const isMatchedByActiveNearPatterns = isCellMatchedByActiveNearPatterns(
        cellIndex,
        activeNearPatterns,
      );
      const visualState = resolveCellVisualState(
        isPrizeCell,
        isNearTargetCell,
        isMatchedByCompletedPattern,
        isMatchedByActiveNearPatterns,
      );
      const firstPrizeLabel = prizeLabels[0];

      cardState.cells[cellIndex] = {
        numberLabel: number > 0 ? String(number) : "-",
        isSelected: number > 0 && drawnNumbers.includes(number),
        isMissing: isNearTargetCell,
        isMatched: isMatchedByCompletedPattern,
        nearWinPatternIndex: isNearTargetCell
          ? targetNearPatterns[0]?.rawPatternIndex ?? -1
          : (nearWinPatternIndexes[0] ?? -1),
        nearWinPatternIndexes: isNearTargetCell
          ? targetNearPatterns.map((pattern) => pattern.rawPatternIndex)
          : nearWinPatternIndexes,
        missingNumber: isNearTargetCell
          ? targetNearPatterns[0]?.targetNumber ?? 0
          : resolveMissingNumber(number, nearWins),
        visualState,
        isPrizeCell,
        isNearTargetCell,
        prizeLabel: firstPrizeLabel?.text ?? "",
        prizeAnchor: firstPrizeLabel?.anchor ?? "BottomCenter",
        prizeLabels,
        completedPatternIndexes,
      };
    }
  }

  populateBallRack(renderState, drawnNumbers, ballSlotCount);
  populateHud(
    renderState,
    snapshot,
    playerContext.player,
    selectedPlayerId,
    effectiveEntryFee,
    options,
  );
  populateTopper(
    renderState,
    topperPrizeLabels,
    patternEvaluation,
    topperSlotCount,
  );

  const model = mapRenderStateToRoundModel(
    renderState,
    snapshot,
    playerContext.player,
    playerContext.source,
    selectedPlayerId,
    options,
  );

  return {
    renderState,
    model,
    resolvedPlayerId: selectedPlayerId,
    playerId: selectedPlayerId,
    ticketSource: playerContext.source,
    visibleTickets,
    activePatternIndexes,
  };
}

function normalizePatternMasks(
  masks?: readonly Theme1PatternMask[],
): number[][] {
  const source = masks?.length ? masks : THEME1_DEFAULT_PATTERN_MASKS;
  return source.map((mask) => {
    const normalized = Array.from(
      { length: THEME1_CARD_CELL_COUNT },
      (_, index) => (mask[index] === 1 ? 1 : 0),
    );
    return normalized;
  });
}

function normalizeActivePatternIndexes(
  activePatternIndexes: readonly number[] | undefined,
  patternCount: number,
): number[] {
  const source =
    activePatternIndexes && activePatternIndexes.length > 0
      ? activePatternIndexes
      : THEME1_DEFAULT_ACTIVE_PATTERN_INDEXES;
  const values = new Set<number>();

  for (const patternIndex of source) {
    if (
      Number.isInteger(patternIndex) &&
      patternIndex >= 0 &&
      patternIndex < patternCount
    ) {
      values.add(patternIndex);
    }
  }

  return Array.from(values).sort((left, right) => left - right);
}

function normalizeTopperPayoutAmounts(
  payouts?: readonly number[],
  totalBetAmount = 0,
): number[] {
  const hasProvidedPayouts = Boolean(payouts && payouts.length > 0);
  const hasAnyPositiveProvidedPayout =
    hasProvidedPayouts &&
    payouts!.some((value) => Number.isFinite(value) && Number(value) > 0);
  const source = hasAnyPositiveProvidedPayout
    ? payouts!
    : resolveTheme1TopperPayoutAmounts(totalBetAmount);

  return source.map((value) =>
    Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0,
  );
}

function resolveTopperSlotCount(
  options: Theme1RoomSnapshotMapperOptions,
  payoutAmounts: readonly number[],
): number {
  return Math.max(
    0,
    options.topperPrizeLabels?.length ?? 0,
    payoutAmounts.length,
    options.fallbackTopperSlotCount ?? 0,
  );
}

function resolveTopperPrizeLabels(
  prizeLabels: readonly string[] | undefined,
  payoutAmounts: readonly number[],
  topperSlotCount: number,
): string[] {
  if (prizeLabels && prizeLabels.length > 0) {
    return Array.from({ length: topperSlotCount }, (_, index) =>
      prizeLabels[index]?.trim() ?? "",
    );
  }

  if (payoutAmounts.length > 0) {
    return Array.from({ length: topperSlotCount }, (_, index) =>
      payoutAmounts[index] !== undefined ? formatKrAmount(payoutAmounts[index]) : "",
    );
  }

  return Array.from({ length: topperSlotCount }, (_, index) =>
    THEME1_DEFAULT_TOPPER_PRIZE_LABELS[index] ?? "",
  );
}

function evaluatePatterns(
  visibleTickets: readonly number[][],
  drawnNumbers: readonly number[],
  activePatternIndexes: readonly number[],
  patternMasks: readonly number[][],
  payoutAmounts: readonly number[],
  topperCount: number,
): Theme1PatternEvaluation {
  const cards = visibleTickets.map<Theme1CardPatternEvaluation>(() => ({
    matchedPatternIndexes: new Set<number>(),
    nearWinsByCell: new Map<number, Theme1NearWinResult[]>(),
    nearWins: [],
  }));
  const evaluation: Theme1PatternEvaluation = {
    cards,
    nearWinsByTopperSlot: new Map<number, Theme1NearWinResult[]>(),
  };
  const definitions = buildPatternDefinitions(
    activePatternIndexes,
    patternMasks,
    payoutAmounts,
    topperCount,
  );

  if (definitions.length === 0 || cards.length === 0) {
    return evaluation;
  }

  const cellToPatternIndexes = buildCellPatternLookup(definitions);

  for (let cardIndex = 0; cardIndex < visibleTickets.length; cardIndex += 1) {
    const ticket = normalizeTicketNumbers(visibleTickets[cardIndex]);
    const cardResult = cards[cardIndex];
    const numberToCell = buildNumberToCellLookup(ticket);
    const markedCells = Array.from(
      { length: THEME1_CARD_CELL_COUNT },
      () => false,
    );
    const matchedCounts = Array.from({ length: definitions.length }, () => 0);

    for (const drawnNumber of drawnNumbers) {
      const cellIndex = numberToCell.get(drawnNumber);
      if (cellIndex === undefined || markedCells[cellIndex]) {
        continue;
      }

      markedCells[cellIndex] = true;
      const impactedPatterns = cellToPatternIndexes.get(cellIndex);
      if (!impactedPatterns) {
        continue;
      }

      for (const patternLookupIndex of impactedPatterns) {
        matchedCounts[patternLookupIndex] += 1;
      }
    }

    for (let definitionIndex = 0; definitionIndex < definitions.length; definitionIndex += 1) {
      const definition = definitions[definitionIndex];
      const matchedCount = matchedCounts[definitionIndex];
      if (matchedCount >= definition.requiredCount) {
        cardResult.matchedPatternIndexes.add(definition.rawPatternIndex);
        continue;
      }

      if (matchedCount !== definition.requiredCount - 1) {
        continue;
      }

      const missingCellIndex = resolveMissingCell(definition, markedCells);
      if (missingCellIndex < 0 || missingCellIndex >= ticket.length) {
        continue;
      }

      const nearWin: Theme1NearWinResult = {
        rawPatternIndex: definition.rawPatternIndex,
        slotIndex: definition.slotIndex,
        cardIndex,
        cellIndex: missingCellIndex,
        missingNumber: normalizeTheme1Number(ticket[missingCellIndex]),
        payoutAmount: definition.payoutAmount,
      };
      cardResult.nearWins.push(nearWin);
      pushMapList(cardResult.nearWinsByCell, missingCellIndex, nearWin);
      pushMapList(evaluation.nearWinsByTopperSlot, definition.slotIndex, nearWin);
    }
  }

  return evaluation;
}

function buildPatternDefinitions(
  activePatternIndexes: readonly number[],
  patternMasks: readonly number[][],
  payoutAmounts: readonly number[],
  topperCount: number,
): Theme1PatternDefinition[] {
  const definitions: Theme1PatternDefinition[] = [];

  for (const rawPatternIndex of activePatternIndexes) {
    if (rawPatternIndex < 0 || rawPatternIndex >= patternMasks.length) {
      continue;
    }

    const cells = extractPatternCells(patternMasks, rawPatternIndex);
    if (cells.length === 0) {
      continue;
    }

    const slotIndex = resolvePayoutSlotIndex(rawPatternIndex, topperCount);
    const payoutAmount =
      slotIndex >= 0 && slotIndex < payoutAmounts.length
        ? Math.max(0, payoutAmounts[slotIndex] ?? 0)
        : 0;

    definitions.push({
      rawPatternIndex,
      slotIndex,
      cells,
      payoutAmount,
      requiredCount: cells.length,
    });
  }

  return definitions;
}

function buildCellPatternLookup(
  definitions: readonly Theme1PatternDefinition[],
): Map<number, number[]> {
  const lookup = new Map<number, number[]>();

  for (let definitionIndex = 0; definitionIndex < definitions.length; definitionIndex += 1) {
    for (const cellIndex of definitions[definitionIndex].cells) {
      pushMapList(lookup, cellIndex, definitionIndex);
    }
  }

  return lookup;
}

function buildNumberToCellLookup(ticket: readonly number[]): Map<number, number> {
  const lookup = new Map<number, number>();

  for (let cellIndex = 0; cellIndex < ticket.length; cellIndex += 1) {
    const number = normalizeTheme1Number(ticket[cellIndex]);
    if (number > 0 && !lookup.has(number)) {
      lookup.set(number, cellIndex);
    }
  }

  return lookup;
}

function resolveMissingCell(
  definition: Theme1PatternDefinition,
  markedCells: readonly boolean[],
): number {
  for (const cellIndex of definition.cells) {
    if (cellIndex >= 0 && cellIndex < markedCells.length && !markedCells[cellIndex]) {
      return cellIndex;
    }
  }

  return -1;
}

function buildCompletedPatternStates(
  matchedPatternIndexes: readonly number[],
  ticket: readonly number[],
  drawOrderByNumber: Map<number, number>,
  patternMasks: readonly number[][],
  payoutAmounts: readonly number[],
  topperCount: number,
): Theme1CompletedPatternRenderState[] {
  const patterns: Theme1CompletedPatternRenderState[] = [];

  for (const rawPatternIndex of matchedPatternIndexes) {
    const cellIndices = extractPatternCells(patternMasks, rawPatternIndex);
    if (cellIndices.length === 0) {
      continue;
    }

    const triggerCellIndex = resolveTriggerCellIndex(
      ticket,
      cellIndices,
      drawOrderByNumber,
    );
    const prizeAmount = resolvePatternPrizeAmount(
      rawPatternIndex,
      payoutAmounts,
      topperCount,
    );

    patterns.push({
      rawPatternIndex,
      slotIndex: resolvePayoutSlotIndex(rawPatternIndex, topperCount),
      cellIndices,
      triggerCellIndex,
      triggerNumber: resolveCellNumber(ticket, triggerCellIndex),
      prizeAmountKr: prizeAmount,
      prizeLabel: prizeAmount > 0 ? formatKrAmount(prizeAmount) : "",
      prizeAnchor: resolvePrizeAnchor(triggerCellIndex),
      overlayKind: resolveOverlayKind(rawPatternIndex, cellIndices),
    });
  }

  patterns.sort((left, right) => {
    const leftDrawOrder = resolveTriggerDrawOrder(left, ticket, drawOrderByNumber);
    const rightDrawOrder = resolveTriggerDrawOrder(right, ticket, drawOrderByNumber);
    return leftDrawOrder !== rightDrawOrder
      ? leftDrawOrder - rightDrawOrder
      : left.rawPatternIndex - right.rawPatternIndex;
  });

  return patterns;
}

function buildActiveNearPatternStates(
  cardIndex: number,
  cardResult: Theme1CardPatternEvaluation | undefined,
  ticket: readonly number[],
  patternMasks: readonly number[][],
  payoutAmounts: readonly number[],
  topperCount: number,
): Theme1NearPatternRenderState[] {
  if (!cardResult || cardResult.nearWins.length === 0) {
    return [];
  }

  const states: Theme1NearPatternRenderState[] = [];
  const seen = new Set<string>();

  for (const candidate of cardResult.nearWins) {
    if (candidate.cardIndex !== cardIndex) {
      continue;
    }

    const key = `${candidate.rawPatternIndex}:${candidate.cellIndex}`;
    if (seen.has(key)) {
      continue;
    }

    const cellIndices = extractPatternCells(patternMasks, candidate.rawPatternIndex);
    if (cellIndices.length === 0) {
      continue;
    }

    const prizeAmount =
      candidate.payoutAmount > 0
        ? candidate.payoutAmount
        : resolvePatternPrizeAmount(
            candidate.rawPatternIndex,
            payoutAmounts,
            topperCount,
          );

    states.push({
      rawPatternIndex: candidate.rawPatternIndex,
      slotIndex: resolvePayoutSlotIndex(candidate.rawPatternIndex, topperCount),
      cellIndices,
      matchedCellIndices: extractMatchedCellIndices(cellIndices, candidate.cellIndex),
      targetCellIndex: candidate.cellIndex,
      targetNumber:
        candidate.missingNumber > 0
          ? candidate.missingNumber
          : resolveCellNumber(ticket, candidate.cellIndex),
      prizeAmountKr: prizeAmount,
      prizeLabel: prizeAmount > 0 ? formatKrAmount(prizeAmount) : "",
      prizeAnchor: resolvePrizeAnchor(candidate.cellIndex),
      overlayKind: resolveOverlayKind(candidate.rawPatternIndex, cellIndices),
    });
    seen.add(key);
  }

  states.sort((left, right) =>
    left.prizeAmountKr !== right.prizeAmountKr
      ? right.prizeAmountKr - left.prizeAmountKr
      : left.rawPatternIndex - right.rawPatternIndex,
  );

  return states;
}

function extractPatternCells(
  patternMasks: readonly number[][],
  rawPatternIndex: number,
): number[] {
  const mask = patternMasks[rawPatternIndex];
  if (!mask) {
    return [];
  }

  const values: number[] = [];
  for (let cellIndex = 0; cellIndex < mask.length; cellIndex += 1) {
    if (mask[cellIndex] === 1) {
      values.push(cellIndex);
    }
  }

  return values;
}

function resolvePatternPrizeAmount(
  rawPatternIndex: number,
  payoutAmounts: readonly number[],
  topperCount: number,
): number {
  const slotIndex = resolvePayoutSlotIndex(rawPatternIndex, topperCount);
  return slotIndex >= 0 && slotIndex < payoutAmounts.length
    ? Math.max(0, payoutAmounts[slotIndex] ?? 0)
    : 0;
}

function resolveTriggerCellIndex(
  ticket: readonly number[],
  cellIndices: readonly number[],
  drawOrderByNumber: Map<number, number>,
): number {
  let triggerCellIndex = cellIndices[0] ?? -1;
  let bestDrawOrder = Number.NEGATIVE_INFINITY;

  for (const cellIndex of cellIndices) {
    const number = resolveCellNumber(ticket, cellIndex);
    const drawOrder = drawOrderByNumber.get(number);
    if (drawOrder === undefined) {
      continue;
    }

    if (drawOrder > bestDrawOrder) {
      bestDrawOrder = drawOrder;
      triggerCellIndex = cellIndex;
    }
  }

  return triggerCellIndex;
}

function resolveTriggerDrawOrder(
  pattern: Theme1CompletedPatternRenderState,
  ticket: readonly number[],
  drawOrderByNumber: Map<number, number>,
): number {
  const triggerNumber = resolveCellNumber(ticket, pattern.triggerCellIndex);
  return drawOrderByNumber.get(triggerNumber) ?? Number.MAX_SAFE_INTEGER;
}

function buildDrawOrderLookup(
  drawnNumbers: readonly number[],
): Map<number, number> {
  const lookup = new Map<number, number>();

  for (let drawIndex = 0; drawIndex < drawnNumbers.length; drawIndex += 1) {
    const number = normalizeTheme1Number(drawnNumbers[drawIndex]);
    if (number > 0) {
      lookup.set(number, drawIndex);
    }
  }

  return lookup;
}

function extractMatchedCellIndices(
  cellIndices: readonly number[],
  targetCellIndex: number,
): number[] {
  return cellIndices.filter((cellIndex) => cellIndex !== targetCellIndex);
}

function extractNearWinPatternIndexes(
  nearWins: readonly Theme1NearWinResult[],
): number[] {
  const values = new Set<number>();

  for (const nearWin of nearWins) {
    values.add(nearWin.rawPatternIndex);
  }

  return toSortedArray(values);
}

function resolveMissingNumber(
  fallbackNumber: number,
  nearWins: readonly Theme1NearWinResult[],
): number {
  for (const nearWin of nearWins) {
    if (nearWin.missingNumber > 0) {
      return nearWin.missingNumber;
    }
  }

  return fallbackNumber;
}

function resolveCardWinAmount(
  matchedPatternIndexes: ReadonlySet<number>,
  payoutAmounts: readonly number[],
  topperCount: number,
): number {
  let total = 0;

  for (const rawPatternIndex of matchedPatternIndexes) {
    const slotIndex = resolvePayoutSlotIndex(rawPatternIndex, topperCount);
    if (slotIndex >= 0 && slotIndex < payoutAmounts.length) {
      total += Math.max(0, payoutAmounts[slotIndex] ?? 0);
    }
  }

  return total;
}

function isCellMatchedByCompletedPatterns(
  cellIndex: number,
  completedPatterns: readonly Theme1CompletedPatternRenderState[],
): boolean {
  return completedPatterns.some((pattern) => pattern.cellIndices.includes(cellIndex));
}

function isCellMatchedByActiveNearPatterns(
  cellIndex: number,
  activeNearPatterns: readonly Theme1NearPatternRenderState[],
): boolean {
  return activeNearPatterns.some((pattern) =>
    pattern.matchedCellIndices.includes(cellIndex),
  );
}

function extractCompletedPatternIndexes(
  completedPatterns: readonly Theme1CompletedPatternRenderState[],
  cellIndex: number,
): number[] {
  return completedPatterns
    .filter((pattern) => pattern.cellIndices.includes(cellIndex))
    .map((pattern) => pattern.rawPatternIndex);
}

function hasCompletedPrizeLabel(
  completedPatterns: readonly Theme1CompletedPatternRenderState[],
  cellIndex: number,
): boolean {
  return completedPatterns.some(
    (pattern) => pattern.triggerCellIndex === cellIndex,
  );
}

function buildCellPrizeLabels(
  completedPatterns: readonly Theme1CompletedPatternRenderState[],
  _activeNearPatterns: readonly Theme1NearPatternRenderState[],
  cellIndex: number,
): Theme1CellPrizeLabelRenderState[] {
  void completedPatterns;
  void cellIndex;
  return [];
}

function resolveCellVisualState(
  isPrizeCell: boolean,
  isNearTargetCell: boolean,
  isMatchedByCompletedPattern: boolean,
  isMatchedByActiveNearPattern: boolean,
): Theme1CardCellVisualState {
  if (isPrizeCell) {
    return "WonPrize";
  }

  if (isMatchedByCompletedPattern) {
    return "WonHit";
  }

  if (isNearTargetCell) {
    return "NearTarget";
  }

  if (isMatchedByActiveNearPattern) {
    return "NearHit";
  }

  return "Normal";
}

function resolvePrizeAnchor(cellIndex: number): Theme1WinLabelAnchor {
  if (cellIndex < 0) {
    return "BottomCenter";
  }

  const column = Math.trunc(cellIndex / 3);
  if (column === 0) {
    return "BottomLeft";
  }

  if (column === 4) {
    return "BottomRight";
  }

  return "BottomCenter";
}

function resolveOverlayKind(
  rawPatternIndex: number,
  cellIndices: readonly number[],
): Theme1PatternOverlayKind {
  if (cellIndices.length === 0) {
    return "None";
  }

  if (isSingleRowPattern(cellIndices)) {
    return "HorizontalLine";
  }

  if (rawPatternIndex >= 0 && rawPatternIndex < 16 && cellIndices.length <= 6) {
    return "SvgStroke";
  }

  return "SvgMask";
}

function isSingleRowPattern(cellIndices: readonly number[]): boolean {
  if (cellIndices.length < 5) {
    return false;
  }

  const row = cellIndices[0] % 3;
  return cellIndices.every((cellIndex) => cellIndex % 3 === row);
}

function populateBallRack(
  renderState: Theme1RoundRenderState,
  drawnNumbers: readonly number[],
  ballSlotCount: number,
): void {
  const count = drawnNumbers.length;
  renderState.ballRack.showBallMachine = count > 0;
  renderState.ballRack.showExtraBallMachine = false;
  renderState.ballRack.showBallOutMachine = true;
  renderState.ballRack.showBigBall = count > 0;
  renderState.ballRack.bigBallNumber = count > 0 ? String(drawnNumbers[count - 1]) : "";
  renderState.ballRack.slots = Array.from({ length: ballSlotCount }, (_, slotIndex) => {
    const value = drawnNumbers[slotIndex];
    return {
      isVisible: value > 0,
      numberLabel: value > 0 ? String(value) : "",
    };
  });
}

function populateHud(
  renderState: Theme1RoundRenderState,
  snapshot: RoomSnapshot | RoomSnapshotWithScheduler,
  player: Player | undefined,
  playerId: string | undefined,
  effectiveEntryFee: number,
  options: Theme1RoomSnapshotMapperOptions,
): void {
  renderState.hud.countdownLabel =
    options.countdownLabel ??
    formatCountdownLabel(getScheduler(snapshot)?.millisUntilNextStart ?? null);
  renderState.hud.playerCountLabel =
    options.playerCountLabel ?? formatPlayerCountLabel(snapshot.players.length);
  renderState.hud.creditLabel =
    options.creditLabel ??
    formatWholeNumber(player ? normalizeCurrencyAmount(player.balance) : 0);
  renderState.hud.winningsLabel =
    options.winningsLabel ??
    formatWholeNumber(resolveCurrentRoundWinnings(snapshot, playerId));
  renderState.hud.betLabel =
    options.betLabel ?? formatWholeNumber(effectiveEntryFee);
}

function populateTopper(
  renderState: Theme1RoundRenderState,
  topperPrizeLabels: readonly string[],
  patternEvaluation: Theme1PatternEvaluation,
  topperSlotCount: number,
): void {
  renderState.topper.slots = Array.from(
    { length: topperSlotCount },
    (_, slotIndex): Theme1TopperSlotRenderState => {
      const matchedSelection = resolveRepresentativeMatchedTopperSelection(
        patternEvaluation,
        slotIndex,
        topperSlotCount,
      );
      const nearWins = patternEvaluation.nearWinsByTopperSlot.get(slotIndex) ?? [];
      const representativeNearWins = resolveRepresentativeNearWins(nearWins);

      if (matchedSelection) {
        return {
          prizeLabel: topperPrizeLabels[slotIndex] ?? "",
          showPattern: true,
          showMatchedPattern: true,
          missingCellsVisible: [],
          prizeVisualState: "Matched",
          activePatternIndexes: [matchedSelection.rawPatternIndex],
          activeCardIndexes: [matchedSelection.cardIndex],
        };
      }

      if (representativeNearWins.length > 0) {
        return {
          prizeLabel: topperPrizeLabels[slotIndex] ?? "",
          showPattern: true,
          showMatchedPattern: false,
          missingCellsVisible: buildTopperMissingCells(representativeNearWins),
          prizeVisualState: "NearWin",
          activePatternIndexes: extractTopperActivePatternIndexes(representativeNearWins),
          activeCardIndexes: extractTopperActiveCardIndexes(representativeNearWins),
        };
      }

      return {
        prizeLabel: topperPrizeLabels[slotIndex] ?? "",
        showPattern: true,
        showMatchedPattern: false,
        missingCellsVisible: [],
        prizeVisualState: "Normal",
        activePatternIndexes: [],
        activeCardIndexes: [],
      };
    },
  );
}

function resolveRepresentativeMatchedTopperSelection(
  patternEvaluation: Theme1PatternEvaluation,
  slotIndex: number,
  topperSlotCount: number,
): { cardIndex: number; rawPatternIndex: number } | null {
  for (let cardIndex = 0; cardIndex < patternEvaluation.cards.length; cardIndex += 1) {
    const matchingPatternIndexes = toSortedArray(
      new Set(
        [...patternEvaluation.cards[cardIndex].matchedPatternIndexes].filter(
          (rawPatternIndex) =>
            resolvePayoutSlotIndex(rawPatternIndex, topperSlotCount) === slotIndex,
        ),
      ),
    );

    if (matchingPatternIndexes.length > 0) {
      return {
        cardIndex,
        rawPatternIndex: matchingPatternIndexes[0] ?? -1,
      };
    }
  }

  return null;
}

function buildTopperMissingCells(
  nearWins: readonly Theme1NearWinResult[],
): boolean[] {
  const visible = Array.from({ length: THEME1_CARD_CELL_COUNT }, () => false);

  for (const nearWin of nearWins) {
    if (nearWin.cellIndex >= 0 && nearWin.cellIndex < visible.length) {
      visible[nearWin.cellIndex] = true;
    }
  }

  return visible;
}

function extractTopperActivePatternIndexes(
  nearWins: readonly Theme1NearWinResult[],
): number[] {
  return toSortedArray(new Set(nearWins.map((nearWin) => nearWin.rawPatternIndex)));
}

function resolveRepresentativeNearWins(
  nearWins: readonly Theme1NearWinResult[],
): Theme1NearWinResult[] {
  if (nearWins.length === 0) {
    return [];
  }

  const firstNearWin = nearWins[0];
  if (!firstNearWin) {
    return [];
  }

  return nearWins.filter(
    (nearWin) =>
      nearWin.cardIndex === firstNearWin.cardIndex &&
      nearWin.rawPatternIndex === firstNearWin.rawPatternIndex,
  );
}

function extractTopperActiveCardIndexes(
  nearWins: readonly Theme1NearWinResult[],
): number[] {
  return toSortedArray(new Set(nearWins.map((nearWin) => nearWin.cardIndex)));
}

function resolveCurrentRoundWinnings(
  snapshot: RoomSnapshot | RoomSnapshotWithScheduler,
  playerId: string | undefined,
): number {
  if (!playerId) {
    return 0;
  }

  const validClaims = snapshot.currentGame?.claims ?? [];
  return validClaims.reduce((sum, claim) => {
    if (!claim.valid || claim.playerId !== playerId) {
      return sum;
    }

    return sum + normalizeCurrencyAmount(claim.payoutAmount ?? 0);
  }, 0);
}

function mapRenderStateToRoundModel(
  renderState: Theme1RoundRenderState,
  snapshot: RoomSnapshot | RoomSnapshotWithScheduler,
  player: Player | undefined,
  ticketSource: Theme1RoomTicketSource,
  resolvedPlayerId: string | undefined,
  options: Theme1RoomSnapshotMapperOptions,
): Theme1RoundRenderModel {
  const currentGame = snapshot.currentGame;
  const connectionPhase = options.connectionPhase ?? "connected";
  const mode = options.mode ?? "live";
  const connectionLabel =
    options.connectionLabel ?? defaultConnectionLabel(connectionPhase);
  const drawCount = currentGame?.drawnNumbers.length ?? 0;

  return {
    hud: {
      saldo: formatPanelValue(renderState.hud.creditLabel),
      gevinst: formatPanelValue(renderState.hud.winningsLabel),
      innsats: formatPanelValue(renderState.hud.betLabel),
      nesteTrekkOm: renderState.hud.countdownLabel || "00:00",
      roomPlayers: renderState.hud.playerCountLabel,
    },
    toppers: renderState.topper.slots.map((slot, index) =>
      mapTopperSlotToViewState(slot, index),
    ),
    featuredBallNumber:
      renderState.ballRack.showBigBall &&
      Number.parseInt(renderState.ballRack.bigBallNumber, 10) > 0
        ? Number.parseInt(renderState.ballRack.bigBallNumber, 10)
        : null,
    featuredBallIsPending: false,
    recentBalls: renderState.ballRack.slots
      .filter((slot) => slot.isVisible)
      .map((slot) => Number(slot.numberLabel))
      .filter((value) => Number.isFinite(value) && value > 0),
    boards: renderState.cards.map((card, index) =>
      mapCardToBoardState(card, index, currentGame?.status ?? "WAITING", drawCount),
    ),
    meta: {
      source: mode,
      roomCode: snapshot.code,
      hallId: snapshot.hallId,
      playerId: resolvedPlayerId ?? options.session?.playerId ?? "",
      hostPlayerId: snapshot.hostPlayerId,
      playerName: player?.name ?? "",
      gameStatus: currentGame?.status ?? "WAITING",
      drawCount,
      remainingNumbers:
        currentGame?.remainingNumbers ??
        Math.max(0, THEME1_MAX_BALL_NUMBER - drawCount),
      connectionPhase,
      connectionLabel:
        ticketSource === "empty" && mode === "live"
          ? `${connectionLabel} (ingen lokale bonger)`
          : connectionLabel,
      backendUrl: options.session?.baseUrl ?? "",
    },
  };
}

function mapTopperSlotToViewState(
  slot: Theme1TopperSlotRenderState,
  index: number,
): Theme1TopperState {
  const firstPatternIndex = slot.activePatternIndexes[0];
  const title = Number.isInteger(firstPatternIndex)
    ? formatPatternTitle(firstPatternIndex)
    : formatPatternTitle(index);

  return {
    id: index + 1,
    title,
    prize: slot.prizeLabel.trim().length > 0 ? slot.prizeLabel : "0 kr",
    highlighted: slot.prizeVisualState !== "Normal",
    showMatchedPattern: slot.showMatchedPattern,
    activePatternIndexes: [...slot.activePatternIndexes],
    missingCellIndexes: convertTopperMissingCellsToUi(slot.missingCellsVisible),
    highlightKind:
      slot.prizeVisualState === "Matched"
        ? "win"
        : slot.prizeVisualState === "NearWin"
          ? "near"
          : "normal",
  };
}

function convertTopperMissingCellsToUi(missingCellsVisible: readonly boolean[]): number[] {
  const columnMajorIndexes: number[] = [];

  for (let cellIndex = 0; cellIndex < missingCellsVisible.length; cellIndex += 1) {
    if (missingCellsVisible[cellIndex]) {
      columnMajorIndexes.push(cellIndex);
    }
  }

  return convertColumnMajorIndexesToUi(columnMajorIndexes);
}

function mapCardToBoardState(
  card: Theme1RoundRenderState["cards"][number],
  index: number,
  gameStatus: string,
  drawCount: number,
): Theme1BoardState {
  const cells = Array.from({ length: THEME1_CARD_CELL_COUNT }, (_, uiIndex) => ({
    index: uiIndex,
    value: 0,
    tone: "idle" as Theme1CellTone,
  }));

  for (let columnMajorIndex = 0; columnMajorIndex < card.cells.length; columnMajorIndex += 1) {
    const uiIndex = columnMajorIndexToUiIndex(columnMajorIndex);
    cells[uiIndex] = {
      index: uiIndex,
      value: parseCellValue(card.cells[columnMajorIndex]),
      tone: mapCellToTone(card.cells[columnMajorIndex]),
    };
  }

  return {
    id: `board-${index + 1}`,
    label: card.headerLabel || `Bong ${index + 1}`,
    stake: stripKnownLabelPrefix(card.betLabel, "Innsats - "),
    win: card.showWinLabel
      ? stripKnownLabelPrefix(card.winLabel, "Gevinst - ")
      : "0 kr",
    progressLabel: resolveBoardProgressLabel(card, gameStatus, drawCount),
    progressState: resolveBoardProgressState(card, gameStatus, drawCount),
    cells,
    completedPatterns: card.completedPatterns.map((pattern) =>
      mapPatternToBoardOverlayState(
        pattern.rawPatternIndex,
        pattern.cellIndices,
        `${pattern.rawPatternIndex}-${pattern.triggerCellIndex}-${pattern.prizeAmountKr}`,
        pattern.prizeLabel,
      ),
    ),
    activeNearPatterns: card.activeNearPatterns.map((pattern) =>
      mapPatternToBoardOverlayState(
        pattern.rawPatternIndex,
        pattern.cellIndices,
        `near-${pattern.rawPatternIndex}-${pattern.targetCellIndex}-${pattern.prizeAmountKr}`,
      ),
    ),
    prizeStacks: buildBoardPrizeStacks(card.cells),
  };
}

function resolveBoardProgressLabel(
  card: Theme1RoundRenderState["cards"][number],
  gameStatus: string,
  drawCount: number,
) {
  void card;
  void gameStatus;
  void drawCount;
  return "";
}

function resolveBoardProgressState(
  card: Theme1RoundRenderState["cards"][number],
  gameStatus: string,
  drawCount: number,
): Theme1BoardState["progressState"] {
  void card;
  void gameStatus;
  void drawCount;
  return "hidden";
}

function mapPatternToBoardOverlayState(
  rawPatternIndex: number,
  columnMajorCellIndices: readonly number[],
  key: string,
  prizeLabel = "",
): Theme1BoardPatternOverlayState {
  const patternMeta = getTheme1PatternCatalogEntry(rawPatternIndex);
  return {
    key,
    rawPatternIndex,
    title: patternMeta.title,
    symbolId: patternMeta.overlaySymbolId,
    pathDefinition: patternMeta.overlayPathDefinition,
    cellIndices: convertColumnMajorIndexesToUi(columnMajorCellIndices),
    prizeLabel,
  };
}

function mapCellToTone(cell: Theme1CardCellRenderState): Theme1CellTone {
  if (cell.visualState === "NearTarget") {
    return "target";
  }

  if (cell.visualState === "WonPrize") {
    return "matched";
  }

  if (cell.isSelected) {
    return "matched";
  }

  if (
    cell.visualState === "WonHit" ||
    cell.visualState === "NearHit"
  ) {
    return "matched";
  }

  return "idle";
}

function buildBoardPrizeStacks(
  cells: readonly Theme1CardCellRenderState[],
): Theme1BoardPrizeStackState[] {
  return cells
    .map((cell, columnMajorIndex) => {
      if (cell.prizeLabels.length === 0) {
        return null;
      }

      return {
        cellIndex: columnMajorIndexToUiIndex(columnMajorIndex),
        anchor: mapWinLabelAnchorToBoardAnchor(cell.prizeAnchor),
        labels: cell.prizeLabels.map<Theme1BoardPrizeLabelState>((label) => ({
          text: label.text,
          prizeAmountKr: label.prizeAmountKr,
          rawPatternIndex: label.rawPatternIndex,
        })),
      };
    })
    .filter((stack): stack is Theme1BoardPrizeStackState => stack !== null);
}

function mapWinLabelAnchorToBoardAnchor(
  anchor: Theme1WinLabelAnchor,
): Theme1BoardPrizeAnchor {
  switch (anchor) {
    case "BottomLeft":
      return "left";
    case "BottomRight":
      return "right";
    case "BottomCenter":
    default:
      return "center";
  }
}

function parseCellValue(cell: Theme1CardCellRenderState): number {
  const parsed = Number.parseInt(cell.numberLabel, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractValidDrawnNumbers(drawnNumbers: readonly number[]): number[] {
  const values: number[] = [];

  for (const drawnNumber of drawnNumbers) {
    const normalized = normalizeTheme1Number(drawnNumber);
    if (normalized > 0) {
      values.push(normalized);
    }
  }

  return values;
}

function resolveEffectiveEntryFee(
  snapshot: RoomSnapshot | RoomSnapshotWithScheduler,
): number {
  const schedulerEntryFee = getScheduler(snapshot)?.entryFee;
  return normalizeCurrencyAmount(
    snapshot.currentGame?.entryFee ?? schedulerEntryFee ?? 0,
  );
}

function getScheduler(
  snapshot: RoomSnapshot | RoomSnapshotWithScheduler,
): RoomSnapshotWithScheduler["scheduler"] | undefined {
  return "scheduler" in snapshot ? snapshot.scheduler : undefined;
}

function resolvePayoutSlotIndex(rawPatternIndex: number, payoutCount: number): number {
  return resolveTheme1PayoutSlotIndex(rawPatternIndex, payoutCount);
}

function resolveCellNumber(ticket: readonly number[], cellIndex: number): number {
  return cellIndex >= 0 && cellIndex < ticket.length
    ? normalizeTheme1Number(ticket[cellIndex])
    : 0;
}

function readStringAt(
  values: readonly string[] | undefined,
  index: number,
  fallback: string,
): string {
  const value = values?.[index]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function normalizeHiddenWinLabel(value: string): string {
  return value.trim().length > 0 ? value : "";
}

function formatTheme1CardHeaderLabel(cardIndex: number): string {
  return `Bong nr ${Math.max(0, cardIndex) + 1}`;
}

function formatTheme1CardStakeLabel(totalBetAmount: number): string {
  return `Innsats - ${formatWholeNumber(resolveTheme1CardStakeAmount(totalBetAmount))} kr`;
}

function formatTheme1CardWinLabel(amount: number): string {
  return `Gevinst - ${formatWholeNumber(amount)} kr`;
}

function formatKrAmount(amount: number): string {
  return formatTheme1KrAmount(amount);
}

function formatWholeNumber(amount: number): string {
  return formatTheme1WholeNumber(amount);
}

function formatCountdownLabel(millisUntilNextStart: number | null): string {
  if (millisUntilNextStart === null || !Number.isFinite(millisUntilNextStart)) {
    return "";
  }

  const totalSeconds = Math.max(0, Math.floor(millisUntilNextStart / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatPlayerCountLabel(playerCount: number): string {
  const normalizedCount = Math.max(0, Math.trunc(playerCount));
  return `${normalizedCount} ${normalizedCount === 1 ? "spiller" : "spillere"}`;
}

function formatPanelValue(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return "0 kr";
  }

  return normalized.includes("kr") ? normalized : `${normalized} kr`;
}

function stripKnownLabelPrefix(value: string, prefix: string): string {
  const normalized = value.trim();
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length).trim();
  }

  return normalized.length > 0 ? normalized : "0 kr";
}

function formatPatternTitle(patternIndex: number): string {
  return `Pattern ${String(Math.max(0, patternIndex) + 1).padStart(2, "0")}`;
}

function defaultConnectionLabel(
  connectionPhase: Theme1ConnectionPhase,
): string {
  switch (connectionPhase) {
    case "mock":
      return "Mock";
    case "connecting":
      return "Kobler til";
    case "disconnected":
      return "Frakoblet";
    case "error":
      return "Feil";
    case "connected":
    default:
      return "Live";
  }
}

function normalizeCurrencyAmount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function padNumberList(values: readonly number[], length: number): number[] {
  return Array.from({ length }, (_, index) => values[index] ?? 0);
}

function normalizeTheme1Number(value: number): number {
  return Number.isInteger(value) && value > 0 && value <= THEME1_MAX_BALL_NUMBER
    ? value
    : 0;
}

function toSortedArray(values: ReadonlySet<number>): number[] {
  return Array.from(values).sort((left, right) => left - right);
}

function pushMapList<T>(map: Map<number, T[]>, key: number, value: T): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }

  map.set(key, [value]);
}
