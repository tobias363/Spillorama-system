import type { ComplianceLedgerEntry, LedgerChannel, LedgerEventType, LedgerGameType } from "../game/BingoEngine.js";
import type { HallDefinition } from "../platform/PlatformService.js";

export const PLAYER_REPORT_PERIODS = ["today", "last7", "last30", "last365"] as const;
export type PlayerReportPeriod = (typeof PLAYER_REPORT_PERIODS)[number];

export interface PlayerReportRange {
  period: PlayerReportPeriod;
  from: string;
  to: string;
  label: string;
}

export interface PlayerReportSummary {
  stakeTotal: number;
  prizeTotal: number;
  netResult: number;
  totalEvents: number;
  totalPlays: number;
}

export interface PlayerReportBreakdownRow {
  hallId: string;
  hallName: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  stakeTotal: number;
  prizeTotal: number;
  netResult: number;
  totalEvents: number;
  totalPlays: number;
  lastActivityAt?: string;
}

export interface PlayerReportPlayRow {
  playId: string;
  hallId: string;
  hallName: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  roomCode?: string;
  gameId?: string;
  startedAt: string;
  lastActivityAt: string;
  stakeTotal: number;
  prizeTotal: number;
  netResult: number;
  totalEvents: number;
}

export interface PlayerReportEventRow {
  id: string;
  createdAt: string;
  hallId: string;
  hallName: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  eventType: LedgerEventType;
  amount: number;
  roomCode?: string;
  gameId?: string;
}

export interface PlayerReport {
  generatedAt: string;
  range: PlayerReportRange;
  hallId?: string;
  hallName?: string;
  summary: PlayerReportSummary;
  breakdown: PlayerReportBreakdownRow[];
  plays: PlayerReportPlayRow[];
  events: PlayerReportEventRow[];
}

function startOfLocalDay(reference: Date): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 0, 0, 0, 0);
}

function endOfLocalMoment(reference: Date): Date {
  return new Date(reference.getTime());
}

function addLocalDays(reference: Date, days: number): Date {
  return new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() + days,
    reference.getHours(),
    reference.getMinutes(),
    reference.getSeconds(),
    reference.getMilliseconds()
  );
}

function formatLocalDate(reference: Date): string {
  const day = String(reference.getDate()).padStart(2, "0");
  const month = String(reference.getMonth() + 1).padStart(2, "0");
  const year = reference.getFullYear();
  return `${day}.${month}.${year}`;
}

function buildRangeLabel(period: PlayerReportPeriod, from: Date, to: Date): string {
  if (period === "today") {
    return `I dag (${formatLocalDate(from)})`;
  }
  return `${formatLocalDate(from)}–${formatLocalDate(to)}`;
}

export function resolvePlayerReportRange(period: PlayerReportPeriod, now = new Date()): PlayerReportRange {
  const end = endOfLocalMoment(now);
  let start = startOfLocalDay(now);

  if (period === "last7") {
    start = startOfLocalDay(addLocalDays(now, -6));
  } else if (period === "last30") {
    start = startOfLocalDay(addLocalDays(now, -29));
  } else if (period === "last365") {
    start = startOfLocalDay(addLocalDays(now, -364));
  }

  return {
    period,
    from: start.toISOString(),
    to: end.toISOString(),
    label: buildRangeLabel(period, start, end)
  };
}

function getHallName(hallsById: Map<string, HallDefinition>, hallId: string): string {
  return hallsById.get(hallId)?.name ?? hallId;
}

function toNetResult(stakeTotal: number, prizeTotal: number): number {
  return roundCurrency(prizeTotal - stakeTotal);
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildPlayerReport(input: {
  entries: ComplianceLedgerEntry[];
  halls: HallDefinition[];
  range: PlayerReportRange;
  hallId?: string;
}): PlayerReport {
  const hallId = input.hallId?.trim() || undefined;
  const hallsById = new Map(input.halls.map((hall) => [hall.id, hall]));
  const entries = input.entries
    .filter((entry) => !hallId || entry.hallId === hallId)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  const breakdownMap = new Map<string, PlayerReportBreakdownRow>();
  const playMap = new Map<
    string,
    {
      playId: string;
      hallId: string;
      hallName: string;
      gameType: LedgerGameType;
      channel: LedgerChannel;
      roomCode?: string;
      gameId?: string;
      startedAtMs: number;
      lastActivityAtMs: number;
      stakeTotal: number;
      prizeTotal: number;
      totalEvents: number;
    }
  >();

  let stakeTotal = 0;
  let prizeTotal = 0;

  for (const entry of entries) {
    const hallName = getHallName(hallsById, entry.hallId);
    const breakdownKey = `${entry.hallId}::${entry.gameType}::${entry.channel}`;
    const breakdown = breakdownMap.get(breakdownKey) ?? {
      hallId: entry.hallId,
      hallName,
      gameType: entry.gameType,
      channel: entry.channel,
      stakeTotal: 0,
      prizeTotal: 0,
      netResult: 0,
      totalEvents: 0,
      totalPlays: 0,
      lastActivityAt: undefined
    };

    const playDiscriminator = entry.roomCode?.trim() || entry.gameId?.trim() || entry.id;
    const playKey = `${entry.hallId}::${entry.gameType}::${entry.channel}::${playDiscriminator}`;
    const play = playMap.get(playKey) ?? {
      playId: playKey,
      hallId: entry.hallId,
      hallName,
      gameType: entry.gameType,
      channel: entry.channel,
      roomCode: entry.roomCode,
      gameId: entry.gameId,
      startedAtMs: entry.createdAtMs,
      lastActivityAtMs: entry.createdAtMs,
      stakeTotal: 0,
      prizeTotal: 0,
      totalEvents: 0
    };

    if (entry.eventType === "STAKE") {
      stakeTotal += entry.amount;
      breakdown.stakeTotal += entry.amount;
      play.stakeTotal += entry.amount;
    }
    if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      prizeTotal += entry.amount;
      breakdown.prizeTotal += entry.amount;
      play.prizeTotal += entry.amount;
    }

    breakdown.totalEvents += 1;
    breakdown.lastActivityAt =
      !breakdown.lastActivityAt || new Date(entry.createdAt).getTime() > new Date(breakdown.lastActivityAt).getTime()
        ? entry.createdAt
        : breakdown.lastActivityAt;
    play.totalEvents += 1;
    play.startedAtMs = Math.min(play.startedAtMs, entry.createdAtMs);
    play.lastActivityAtMs = Math.max(play.lastActivityAtMs, entry.createdAtMs);

    breakdownMap.set(breakdownKey, breakdown);
    playMap.set(playKey, play);
  }

  for (const play of playMap.values()) {
    const breakdownKey = `${play.hallId}::${play.gameType}::${play.channel}`;
    const breakdown = breakdownMap.get(breakdownKey);
    if (breakdown) {
      breakdown.totalPlays += 1;
      breakdown.netResult = toNetResult(breakdown.stakeTotal, breakdown.prizeTotal);
    }
  }

  const breakdown = [...breakdownMap.values()].sort((a, b) => {
    const hallCompare = a.hallName.localeCompare(b.hallName, "nb");
    if (hallCompare !== 0) {
      return hallCompare;
    }
    const gameCompare = a.gameType.localeCompare(b.gameType, "nb");
    if (gameCompare !== 0) {
      return gameCompare;
    }
    return a.channel.localeCompare(b.channel, "nb");
  });

  const plays: PlayerReportPlayRow[] = [...playMap.values()]
    .map((play) => ({
      playId: play.playId,
      hallId: play.hallId,
      hallName: play.hallName,
      gameType: play.gameType,
      channel: play.channel,
      roomCode: play.roomCode,
      gameId: play.gameId,
      startedAt: new Date(play.startedAtMs).toISOString(),
      lastActivityAt: new Date(play.lastActivityAtMs).toISOString(),
      stakeTotal: roundCurrency(play.stakeTotal),
      prizeTotal: roundCurrency(play.prizeTotal),
      netResult: toNetResult(play.stakeTotal, play.prizeTotal),
      totalEvents: play.totalEvents
    }))
    .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

  const events: PlayerReportEventRow[] = entries.slice(0, 100).map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    hallId: entry.hallId,
    hallName: getHallName(hallsById, entry.hallId),
    gameType: entry.gameType,
    channel: entry.channel,
    eventType: entry.eventType,
    amount: entry.amount,
    roomCode: entry.roomCode,
    gameId: entry.gameId
  }));

  return {
    generatedAt: new Date().toISOString(),
    range: input.range,
    hallId,
    hallName: hallId ? getHallName(hallsById, hallId) : undefined,
    summary: {
      stakeTotal: roundCurrency(stakeTotal),
      prizeTotal: roundCurrency(prizeTotal),
      netResult: toNetResult(stakeTotal, prizeTotal),
      totalEvents: entries.length,
      totalPlays: plays.length
    },
    breakdown,
    plays: plays.slice(0, 100),
    events
  };
}
