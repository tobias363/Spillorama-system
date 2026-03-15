import type {
  CandyRoomSchedulerState,
  ClaimType,
  ClaimRecord,
  GameStatus,
  GameSnapshot,
  Player,
  RealtimeRoomSnapshot,
  Ticket,
} from "@/domain/realtime/contracts";

type ValidationSuccess<T> = {
  ok: true;
  value: T;
};

type ValidationFailure = {
  ok: false;
  error: string;
};

export type RealtimeSnapshotValidationResult<T> =
  | ValidationSuccess<T>
  | ValidationFailure;

const GAME_STATUSES: ReadonlySet<GameStatus> = new Set([
  "WAITING",
  "RUNNING",
  "ENDED",
]);
const CLAIM_TYPES: ReadonlySet<ClaimType> = new Set([
  "LINE",
  "BINGO",
  "PATTERN",
]);
const CLAIM_KINDS = new Set([
  "LEGACY_LINE",
  "LEGACY_BINGO",
  "PATTERN_FAMILY",
] as const);

export function validateRealtimeRoomSnapshot(
  input: unknown,
): RealtimeSnapshotValidationResult<RealtimeRoomSnapshot> {
  return validateRoomSnapshot(input, "snapshot");
}

function validateRoomSnapshot(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<RealtimeRoomSnapshot> {
  const objectResult = expectRecord(input, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const source = objectResult.value;
  const code = readString(source, "code", path);
  if (!code.ok) {
    return code;
  }

  const hallId = readString(source, "hallId", path);
  if (!hallId.ok) {
    return hallId;
  }

  const hostPlayerId = readString(source, "hostPlayerId", path);
  if (!hostPlayerId.ok) {
    return hostPlayerId;
  }

  const createdAt = readString(source, "createdAt", path);
  if (!createdAt.ok) {
    return createdAt;
  }

  const players = validateArray<Player>(
    source.players,
    `${path}.players`,
    validatePlayer,
  );
  if (!players.ok) {
    return players;
  }

  const currentGame = validateOptional(
    source.currentGame,
    `${path}.currentGame`,
    validateGameSnapshot,
  );
  if (!currentGame.ok) {
    return currentGame;
  }

  const preRoundTickets = validateOptionalRecord<Ticket[]>(
    source.preRoundTickets,
    `${path}.preRoundTickets`,
    validateTicketsForPlayer,
  );
  if (!preRoundTickets.ok) {
    return preRoundTickets;
  }

  const gameHistory = validateArray<GameSnapshot>(
    source.gameHistory,
    `${path}.gameHistory`,
    validateGameSnapshot,
  );
  if (!gameHistory.ok) {
    return gameHistory;
  }

  const scheduler = validateSchedulerState(source.scheduler, `${path}.scheduler`);
  if (!scheduler.ok) {
    return scheduler;
  }

  return {
    ok: true,
    value: {
      code: code.value,
      hallId: hallId.value,
      hostPlayerId: hostPlayerId.value,
      createdAt: createdAt.value,
      players: players.value,
      currentGame: currentGame.value,
      preRoundTickets: preRoundTickets.value,
      gameHistory: gameHistory.value,
      scheduler: scheduler.value,
    },
  };
}

function validatePlayer(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<Player> {
  const objectResult = expectRecord(input, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const source = objectResult.value;
  const id = readString(source, "id", path);
  if (!id.ok) {
    return id;
  }

  const name = readString(source, "name", path);
  if (!name.ok) {
    return name;
  }

  const walletId = readString(source, "walletId", path);
  if (!walletId.ok) {
    return walletId;
  }

  const balance = readNumber(source, "balance", path);
  if (!balance.ok) {
    return balance;
  }

  const socketId = readOptionalString(source, "socketId", path);
  if (!socketId.ok) {
    return socketId;
  }

  return {
    ok: true,
    value: {
      id: id.value,
      name: name.value,
      walletId: walletId.value,
      balance: balance.value,
      socketId: socketId.value,
    },
  };
}

function validateTicket(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<Ticket> {
  const objectResult = expectRecord(input, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const source = objectResult.value;
  const numbers = validateOptionalNumberArray(source.numbers, `${path}.numbers`);
  if (!numbers.ok) {
    return numbers;
  }

  const grid = validateGrid(source.grid, `${path}.grid`);
  if (!grid.ok) {
    return grid;
  }

  return {
    ok: true,
    value: {
      numbers: numbers.value,
      grid: grid.value,
    },
  };
}

function validateTicketsForPlayer(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<Ticket[]> {
  return validateArray<Ticket>(input, path, validateTicket);
}

function validateClaimRecord(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<ClaimRecord> {
  const objectResult = expectRecord(input, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const source = objectResult.value;
  const id = readString(source, "id", path);
  if (!id.ok) {
    return id;
  }

  const playerId = readString(source, "playerId", path);
  if (!playerId.ok) {
    return playerId;
  }

  const type = readStringEnum(source, "type", path, CLAIM_TYPES);
  if (!type.ok) {
    return type;
  }

  const valid = readBoolean(source, "valid", path);
  if (!valid.ok) {
    return valid;
  }

  const reason = readOptionalString(source, "reason", path);
  if (!reason.ok) {
    return reason;
  }

  const winningPatternIndex = readOptionalNumber(
    source,
    "winningPatternIndex",
    path,
  );
  if (!winningPatternIndex.ok) {
    return winningPatternIndex;
  }

  const patternIndex = readOptionalNumber(source, "patternIndex", path);
  if (!patternIndex.ok) {
    return patternIndex;
  }

  const claimKind = readOptionalStringEnum(source, "claimKind", path, CLAIM_KINDS);
  if (!claimKind.ok) {
    return claimKind;
  }

  const displayPatternNumber = readOptionalNumber(
    source,
    "displayPatternNumber",
    path,
  );
  if (!displayPatternNumber.ok) {
    return displayPatternNumber;
  }

  const topperSlotIndex = readOptionalNumber(source, "topperSlotIndex", path);
  if (!topperSlotIndex.ok) {
    return topperSlotIndex;
  }

  const ticketIndex = readOptionalNumber(source, "ticketIndex", path);
  if (!ticketIndex.ok) {
    return ticketIndex;
  }

  const bonusTriggered = readOptionalBoolean(source, "bonusTriggered", path);
  if (!bonusTriggered.ok) {
    return bonusTriggered;
  }

  const bonusAmount = readOptionalNumber(source, "bonusAmount", path);
  if (!bonusAmount.ok) {
    return bonusAmount;
  }

  const payoutAmount = readOptionalNumber(source, "payoutAmount", path);
  if (!payoutAmount.ok) {
    return payoutAmount;
  }

  const payoutPolicyVersion = readOptionalString(
    source,
    "payoutPolicyVersion",
    path,
  );
  if (!payoutPolicyVersion.ok) {
    return payoutPolicyVersion;
  }

  const payoutWasCapped = readOptionalBoolean(source, "payoutWasCapped", path);
  if (!payoutWasCapped.ok) {
    return payoutWasCapped;
  }

  const rtpBudgetBefore = readOptionalNumber(source, "rtpBudgetBefore", path);
  if (!rtpBudgetBefore.ok) {
    return rtpBudgetBefore;
  }

  const rtpBudgetAfter = readOptionalNumber(source, "rtpBudgetAfter", path);
  if (!rtpBudgetAfter.ok) {
    return rtpBudgetAfter;
  }

  const rtpCapped = readOptionalBoolean(source, "rtpCapped", path);
  if (!rtpCapped.ok) {
    return rtpCapped;
  }

  const createdAt = readString(source, "createdAt", path);
  if (!createdAt.ok) {
    return createdAt;
  }

  return {
    ok: true,
    value: {
      id: id.value,
      playerId: playerId.value,
      type: type.value,
      valid: valid.value,
      reason: reason.value,
      claimKind: claimKind.value,
      winningPatternIndex: winningPatternIndex.value,
      patternIndex: patternIndex.value,
      displayPatternNumber: displayPatternNumber.value,
      topperSlotIndex: topperSlotIndex.value,
      ticketIndex: ticketIndex.value,
      bonusTriggered: bonusTriggered.value,
      bonusAmount: bonusAmount.value,
      payoutAmount: payoutAmount.value,
      payoutPolicyVersion: payoutPolicyVersion.value,
      payoutWasCapped: payoutWasCapped.value,
      rtpBudgetBefore: rtpBudgetBefore.value,
      rtpBudgetAfter: rtpBudgetAfter.value,
      rtpCapped: rtpCapped.value,
      createdAt: createdAt.value,
    },
  };
}

function validateGameSnapshot(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<GameSnapshot> {
  const objectResult = expectRecord(input, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const source = objectResult.value;
  const id = readString(source, "id", path);
  if (!id.ok) {
    return id;
  }

  const status = readStringEnum(source, "status", path, GAME_STATUSES);
  if (!status.ok) {
    return status;
  }

  const entryFee = readNumber(source, "entryFee", path);
  if (!entryFee.ok) {
    return entryFee;
  }

  const ticketsPerPlayer = readNumber(source, "ticketsPerPlayer", path);
  if (!ticketsPerPlayer.ok) {
    return ticketsPerPlayer;
  }

  const prizePool = readNumber(source, "prizePool", path);
  if (!prizePool.ok) {
    return prizePool;
  }

  const remainingPrizePool = readNumber(source, "remainingPrizePool", path);
  if (!remainingPrizePool.ok) {
    return remainingPrizePool;
  }

  const payoutPercent = readNumber(source, "payoutPercent", path);
  if (!payoutPercent.ok) {
    return payoutPercent;
  }

  const maxPayoutBudget = readNumber(source, "maxPayoutBudget", path);
  if (!maxPayoutBudget.ok) {
    return maxPayoutBudget;
  }

  const remainingPayoutBudget = readNumber(
    source,
    "remainingPayoutBudget",
    path,
  );
  if (!remainingPayoutBudget.ok) {
    return remainingPayoutBudget;
  }

  const activePatternIndexes = validateOptionalNumberArray(
    source.activePatternIndexes,
    `${path}.activePatternIndexes`,
  );
  if (!activePatternIndexes.ok) {
    return activePatternIndexes;
  }

  const patternPayoutAmounts = validateOptionalNumberArray(
    source.patternPayoutAmounts,
    `${path}.patternPayoutAmounts`,
  );
  if (!patternPayoutAmounts.ok) {
    return patternPayoutAmounts;
  }

  const drawnNumbers = validateNumberArray(source.drawnNumbers, `${path}.drawnNumbers`);
  if (!drawnNumbers.ok) {
    return drawnNumbers;
  }

  const remainingNumbers = readNumber(source, "remainingNumbers", path);
  if (!remainingNumbers.ok) {
    return remainingNumbers;
  }

  const nearMissTargetRateApplied = readOptionalNumber(
    source,
    "nearMissTargetRateApplied",
    path,
  );
  if (!nearMissTargetRateApplied.ok) {
    return nearMissTargetRateApplied;
  }

  const lineWinnerId = readOptionalString(source, "lineWinnerId", path);
  if (!lineWinnerId.ok) {
    return lineWinnerId;
  }

  const bingoWinnerId = readOptionalString(source, "bingoWinnerId", path);
  if (!bingoWinnerId.ok) {
    return bingoWinnerId;
  }

  const claims = validateArray<ClaimRecord>(
    source.claims,
    `${path}.claims`,
    validateClaimRecord,
  );
  if (!claims.ok) {
    return claims;
  }

  const tickets = validateRecord<Ticket[]>(
    source.tickets,
    `${path}.tickets`,
    validateTicketsForPlayer,
  );
  if (!tickets.ok) {
    return tickets;
  }

  const marks = validateRecord<number[]>(
    source.marks,
    `${path}.marks`,
    validateNumberArray,
  );
  if (!marks.ok) {
    return marks;
  }

  const startedAt = readString(source, "startedAt", path);
  if (!startedAt.ok) {
    return startedAt;
  }

  const endedAt = readOptionalString(source, "endedAt", path);
  if (!endedAt.ok) {
    return endedAt;
  }

  const endedReason = readOptionalString(source, "endedReason", path);
  if (!endedReason.ok) {
    return endedReason;
  }

  return {
    ok: true,
    value: {
      id: id.value,
      status: status.value,
      entryFee: entryFee.value,
      ticketsPerPlayer: ticketsPerPlayer.value,
      prizePool: prizePool.value,
      remainingPrizePool: remainingPrizePool.value,
      payoutPercent: payoutPercent.value,
      maxPayoutBudget: maxPayoutBudget.value,
      remainingPayoutBudget: remainingPayoutBudget.value,
      activePatternIndexes: activePatternIndexes.value,
      patternPayoutAmounts: patternPayoutAmounts.value,
      drawnNumbers: drawnNumbers.value,
      remainingNumbers: remainingNumbers.value,
      nearMissTargetRateApplied: nearMissTargetRateApplied.value,
      lineWinnerId: lineWinnerId.value,
      bingoWinnerId: bingoWinnerId.value,
      claims: claims.value,
      tickets: tickets.value,
      marks: marks.value,
      startedAt: startedAt.value,
      endedAt: endedAt.value,
      endedReason: endedReason.value,
    },
  };
}

function validateSchedulerState(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<CandyRoomSchedulerState> {
  const objectResult = expectRecord(input, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const source = objectResult.value;
  const enabled = readBoolean(source, "enabled", path);
  if (!enabled.ok) {
    return enabled;
  }

  const liveRoundsIndependentOfBet = readBoolean(
    source,
    "liveRoundsIndependentOfBet",
    path,
  );
  if (!liveRoundsIndependentOfBet.ok) {
    return liveRoundsIndependentOfBet;
  }

  const intervalMs = readNumber(source, "intervalMs", path);
  if (!intervalMs.ok) {
    return intervalMs;
  }

  const minPlayers = readNumber(source, "minPlayers", path);
  if (!minPlayers.ok) {
    return minPlayers;
  }

  const playerCount = readNumber(source, "playerCount", path);
  if (!playerCount.ok) {
    return playerCount;
  }

  const armedPlayerCount = readNumber(source, "armedPlayerCount", path);
  if (!armedPlayerCount.ok) {
    return armedPlayerCount;
  }

  const armedPlayerIds = validateStringArray(
    source.armedPlayerIds,
    `${path}.armedPlayerIds`,
  );
  if (!armedPlayerIds.ok) {
    return armedPlayerIds;
  }

  const entryFee = readNumber(source, "entryFee", path);
  if (!entryFee.ok) {
    return entryFee;
  }

  const payoutPercent = readNumber(source, "payoutPercent", path);
  if (!payoutPercent.ok) {
    return payoutPercent;
  }

  const drawCapacity = readNumber(source, "drawCapacity", path);
  if (!drawCapacity.ok) {
    return drawCapacity;
  }

  const currentDrawCount = readNumber(source, "currentDrawCount", path);
  if (!currentDrawCount.ok) {
    return currentDrawCount;
  }

  const remainingDrawCapacity = readNumber(
    source,
    "remainingDrawCapacity",
    path,
  );
  if (!remainingDrawCapacity.ok) {
    return remainingDrawCapacity;
  }

  const nextStartAt = readNullableString(source, "nextStartAt", path);
  if (!nextStartAt.ok) {
    return nextStartAt;
  }

  const millisUntilNextStart = readNullableNumber(
    source,
    "millisUntilNextStart",
    path,
  );
  if (!millisUntilNextStart.ok) {
    return millisUntilNextStart;
  }

  const canStartNow = readBoolean(source, "canStartNow", path);
  if (!canStartNow.ok) {
    return canStartNow;
  }

  const serverTime = readString(source, "serverTime", path);
  if (!serverTime.ok) {
    return serverTime;
  }

  return {
    ok: true,
    value: {
      enabled: enabled.value,
      liveRoundsIndependentOfBet: liveRoundsIndependentOfBet.value,
      intervalMs: intervalMs.value,
      minPlayers: minPlayers.value,
      playerCount: playerCount.value,
      armedPlayerCount: armedPlayerCount.value,
      armedPlayerIds: armedPlayerIds.value,
      entryFee: entryFee.value,
      payoutPercent: payoutPercent.value,
      drawCapacity: drawCapacity.value,
      currentDrawCount: currentDrawCount.value,
      remainingDrawCapacity: remainingDrawCapacity.value,
      nextStartAt: nextStartAt.value,
      millisUntilNextStart: millisUntilNextStart.value,
      canStartNow: canStartNow.value,
      serverTime: serverTime.value,
    },
  };
}

function validateGrid(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<number[][]> {
  return validateArray<number[]>(input, path, validateNumberArray);
}

function validateArray<T>(
  input: unknown,
  path: string,
  itemValidator: (item: unknown, path: string) => RealtimeSnapshotValidationResult<T>,
): RealtimeSnapshotValidationResult<T[]> {
  if (!Array.isArray(input)) {
    return fail(`${path} must be an array.`);
  }

  const values: T[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const itemResult = itemValidator(input[index], `${path}[${index}]`);
    if (!itemResult.ok) {
      return itemResult;
    }

    values.push(itemResult.value);
  }

  return { ok: true, value: values };
}

function validateRecord<T>(
  input: unknown,
  path: string,
  valueValidator: (value: unknown, path: string) => RealtimeSnapshotValidationResult<T>,
): RealtimeSnapshotValidationResult<Record<string, T>> {
  const objectResult = expectRecord(input, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const values: Record<string, T> = {};
  for (const [key, value] of Object.entries(objectResult.value)) {
    const validatedValue = valueValidator(value, `${path}.${key}`);
    if (!validatedValue.ok) {
      return validatedValue;
    }

    values[key] = validatedValue.value;
  }

  return { ok: true, value: values };
}

function validateOptionalRecord<T>(
  input: unknown,
  path: string,
  valueValidator: (value: unknown, path: string) => RealtimeSnapshotValidationResult<T>,
): RealtimeSnapshotValidationResult<Record<string, T> | undefined> {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }

  return validateRecord(input, path, valueValidator);
}

function validateOptional<T>(
  input: unknown,
  path: string,
  validator: (value: unknown, path: string) => RealtimeSnapshotValidationResult<T>,
): RealtimeSnapshotValidationResult<T | undefined> {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }

  return validator(input, path);
}

function validateNumberArray(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<number[]> {
  if (!Array.isArray(input)) {
    return fail(`${path} must be an array.`);
  }

  const values: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fail(`${path}[${index}] must be a finite number.`);
    }

    values.push(value);
  }

  return { ok: true, value: values };
}

function validateOptionalNumberArray(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<number[] | undefined> {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }

  return validateNumberArray(input, path);
}

function validateStringArray(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<string[]> {
  if (!Array.isArray(input)) {
    return fail(`${path} must be an array.`);
  }

  const values: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (typeof value !== "string") {
      return fail(`${path}[${index}] must be a string.`);
    }

    values.push(value);
  }

  return { ok: true, value: values };
}

function readString(
  source: Record<string, unknown>,
  key: string,
  path: string,
): RealtimeSnapshotValidationResult<string> {
  const value = source[key];
  if (typeof value !== "string") {
    return fail(`${path}.${key} must be a string.`);
  }

  return { ok: true, value };
}

function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
): RealtimeSnapshotValidationResult<string | undefined> {
  const value = source[key];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== "string") {
    return fail(`${path}.${key} must be a string when present.`);
  }

  return { ok: true, value };
}

function readNullableString(
  source: Record<string, unknown>,
  key: string,
  path: string,
): RealtimeSnapshotValidationResult<string | null> {
  const value = source[key];
  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return fail(`${path}.${key} must be a string or null.`);
  }

  return { ok: true, value };
}

function readNumber(
  source: Record<string, unknown>,
  key: string,
  path: string,
): RealtimeSnapshotValidationResult<number> {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(`${path}.${key} must be a finite number.`);
  }

  return { ok: true, value };
}

function readOptionalNumber(
  source: Record<string, unknown>,
  key: string,
  path: string,
): RealtimeSnapshotValidationResult<number | undefined> {
  const value = source[key];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(`${path}.${key} must be a finite number when present.`);
  }

  return { ok: true, value };
}

function readNullableNumber(
  source: Record<string, unknown>,
  key: string,
  path: string,
): RealtimeSnapshotValidationResult<number | null> {
  const value = source[key];
  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(`${path}.${key} must be a finite number or null.`);
  }

  return { ok: true, value };
}

function readBoolean(
  source: Record<string, unknown>,
  key: string,
  path: string,
): RealtimeSnapshotValidationResult<boolean> {
  const value = source[key];
  if (typeof value !== "boolean") {
    return fail(`${path}.${key} must be a boolean.`);
  }

  return { ok: true, value };
}

function readOptionalBoolean(
  source: Record<string, unknown>,
  key: string,
  path: string,
): RealtimeSnapshotValidationResult<boolean | undefined> {
  const value = source[key];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== "boolean") {
    return fail(`${path}.${key} must be a boolean when present.`);
  }

  return { ok: true, value };
}

function readStringEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowedValues: ReadonlySet<T>,
): RealtimeSnapshotValidationResult<T> {
  const value = source[key];
  if (typeof value !== "string" || !allowedValues.has(value as T)) {
    return fail(
      `${path}.${key} must be one of: ${Array.from(allowedValues).join(", ")}.`,
    );
  }

  return { ok: true, value: value as T };
}

function readOptionalStringEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowedValues: ReadonlySet<T>,
): RealtimeSnapshotValidationResult<T | undefined> {
  const value = source[key];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== "string" || !allowedValues.has(value as T)) {
    return fail(
      `${path}.${key} must be one of: ${Array.from(allowedValues).join(", ")} when present.`,
    );
  }

  return { ok: true, value: value as T };
}

function expectRecord(
  input: unknown,
  path: string,
): RealtimeSnapshotValidationResult<Record<string, unknown>> {
  if (!isRecord(input)) {
    return fail(`${path} must be an object.`);
  }

  return { ok: true, value: input };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(error: string): ValidationFailure {
  return {
    ok: false,
    error,
  };
}
