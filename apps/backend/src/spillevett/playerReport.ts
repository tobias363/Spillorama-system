import type { ComplianceLedgerEntry, LedgerChannel, LedgerEventType, LedgerGameType } from "../game/BingoEngine.js";
import type { HallDefinition } from "../platform/PlatformService.js";

export const PLAYER_REPORT_PERIODS = ["today", "last7", "last30", "last365", "week", "month", "year"] as const;
export type PlayerReportPeriod = (typeof PLAYER_REPORT_PERIODS)[number];

export interface PlayerReportRange {
  period: PlayerReportPeriod;
  from: string;
  to: string;
  label: string;
  offset: number;
}

export interface PlayerReportDailyEntry {
  date: string;   // "YYYY-MM-DD"
  wagered: number;
  won: number;
  net: number;
}

export interface PlayerReportGameEntry {
  gameType: LedgerGameType;
  hallId: string;
  hallName: string;
  wagered: number;
  won: number;
  net: number;
  plays: number;
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

export interface PlayerReportDailyGameEntry {
  date: string;          // "YYYY-MM-DD"
  gameType: LedgerGameType;
  hallId: string;
  hallName: string;
  wagered: number;
  won: number;
  net: number;
}

export interface PlayerReportHallEntry {
  hallId: string;
  hallName: string;
  wagered: number;
  won: number;
  net: number;
  plays: number;
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
  dailyBreakdown: PlayerReportDailyEntry[];
  gameBreakdown: PlayerReportGameEntry[];
  dailyGameBreakdown: PlayerReportDailyGameEntry[];
  hallBreakdown: PlayerReportHallEntry[];
}

const MONTH_NAMES_NB = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember"
];

function startOfLocalDay(reference: Date): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(reference: Date): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 23, 59, 59, 999);
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

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function buildRangeLabel(period: PlayerReportPeriod, from: Date, to: Date): string {
  if (period === "today") {
    return `I dag (${formatLocalDate(from)})`;
  }
  return `${formatLocalDate(from)}–${formatLocalDate(to)}`;
}

export function resolvePlayerReportRange(
  period: PlayerReportPeriod,
  now = new Date(),
  offset = 0
): PlayerReportRange {
  const clampedOffset = Math.max(-60, Math.min(0, Math.trunc(offset) || 0));

  // ── Calendar week (ISO: Monday–Sunday) ──────────────────────────────────
  if (period === "week") {
    const dow = now.getDay(); // 0=Sun … 6=Sat
    const daysToMonday = dow === 0 ? -6 : 1 - dow;
    const thisMonday = startOfLocalDay(addLocalDays(now, daysToMonday));
    const monday = addLocalDays(thisMonday, clampedOffset * 7);
    const sunday = addLocalDays(monday, 6);
    const to = clampedOffset === 0 ? endOfLocalMoment(now) : endOfLocalDay(sunday);
    const week = isoWeekNumber(monday);
    return {
      period,
      from: monday.toISOString(),
      to: to.toISOString(),
      label: `Uke ${week}, ${monday.getFullYear()}`,
      offset: clampedOffset
    };
  }

  // ── Calendar month ───────────────────────────────────────────────────────
  if (period === "month") {
    const ref = new Date(now.getFullYear(), now.getMonth() + clampedOffset, 1);
    const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const monthLastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    const to = clampedOffset === 0 ? endOfLocalMoment(now) : endOfLocalDay(monthLastDay);
    const monthName = MONTH_NAMES_NB[monthStart.getMonth()];
    const label = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${monthStart.getFullYear()}`;
    return {
      period,
      from: monthStart.toISOString(),
      to: to.toISOString(),
      label,
      offset: clampedOffset
    };
  }

  // ── Rolling 12 months ────────────────────────────────────────────────────
  if (period === "year") {
    const start = startOfLocalDay(addLocalDays(now, -364));
    return {
      period,
      from: start.toISOString(),
      to: endOfLocalMoment(now).toISOString(),
      label: "Siste 12 måneder",
      offset: 0
    };
  }

  // ── Legacy rolling windows ───────────────────────────────────────────────
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
    label: buildRangeLabel(period, start, end),
    offset: 0
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

  // ── Daily-game breakdown (per date + gameType + hall) ────────────────────
  const dailyGameMap = new Map<string, PlayerReportDailyGameEntry>();
  for (const entry of entries) {
    const dateKey = entry.createdAt.slice(0, 10);
    const key = `${dateKey}::${entry.gameType}::${entry.hallId}`;
    const item = dailyGameMap.get(key) ?? {
      date: dateKey,
      gameType: entry.gameType,
      hallId: entry.hallId,
      hallName: getHallName(hallsById, entry.hallId),
      wagered: 0,
      won: 0,
      net: 0
    };
    if (entry.eventType === "STAKE") item.wagered += entry.amount;
    if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") item.won += entry.amount;
    item.net = roundCurrency(item.won - item.wagered);
    dailyGameMap.set(key, item);
  }
  const dailyGameBreakdown: PlayerReportDailyGameEntry[] = [...dailyGameMap.values()]
    .map((e) => ({ ...e, wagered: roundCurrency(e.wagered), won: roundCurrency(e.won) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Hall breakdown (per hallId) ───────────────────────────────────────────
  const hallMap = new Map<string, { hallId: string; hallName: string; wagered: number; won: number; plays: number }>();
  for (const entry of entries) {
    const item = hallMap.get(entry.hallId) ?? {
      hallId: entry.hallId,
      hallName: getHallName(hallsById, entry.hallId),
      wagered: 0,
      won: 0,
      plays: 0
    };
    if (entry.eventType === "STAKE") {
      item.wagered += entry.amount;
      item.plays += 1;
    }
    if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      item.won += entry.amount;
    }
    hallMap.set(entry.hallId, item);
  }
  const hallBreakdown: PlayerReportHallEntry[] = [...hallMap.values()].map((h) => ({
    hallId: h.hallId,
    hallName: h.hallName,
    wagered: roundCurrency(h.wagered),
    won: roundCurrency(h.won),
    net: roundCurrency(h.won - h.wagered),
    plays: h.plays
  }));

  // ── Daily breakdown (for "Ditt forbruk" chart) ──────────────────────────
  const dailyMap = new Map<string, { wagered: number; won: number }>();
  for (const entry of entries) {
    const dateKey = entry.createdAt.slice(0, 10); // "YYYY-MM-DD"
    const day = dailyMap.get(dateKey) ?? { wagered: 0, won: 0 };
    if (entry.eventType === "STAKE") day.wagered += entry.amount;
    if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") day.won += entry.amount;
    dailyMap.set(dateKey, day);
  }
  const dailyBreakdown: PlayerReportDailyEntry[] = [];
  {
    const rangeFrom = startOfLocalDay(new Date(input.range.from));
    const rangeTo = new Date(input.range.to);
    let cursor = new Date(rangeFrom);
    while (cursor <= rangeTo) {
      const dateKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      const day = dailyMap.get(dateKey) ?? { wagered: 0, won: 0 };
      dailyBreakdown.push({
        date: dateKey,
        wagered: roundCurrency(day.wagered),
        won: roundCurrency(day.won),
        net: roundCurrency(day.won - day.wagered)
      });
      cursor = addLocalDays(cursor, 1);
    }
  }

  // ── Game breakdown (for donut charts) ───────────────────────────────────
  const gameMap = new Map<string, PlayerReportGameEntry>();
  for (const entry of entries) {
    const key = `${entry.gameType}::${entry.hallId}`;
    const game = gameMap.get(key) ?? {
      gameType: entry.gameType,
      hallId: entry.hallId,
      hallName: getHallName(hallsById, entry.hallId),
      wagered: 0, won: 0, net: 0, plays: 0
    };
    if (entry.eventType === "STAKE") {
      game.wagered += entry.amount;
      game.plays += 1;
    }
    if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      game.won += entry.amount;
    }
    gameMap.set(key, game);
  }
  const gameBreakdown: PlayerReportGameEntry[] = [...gameMap.values()].map((g) => ({
    ...g,
    wagered: roundCurrency(g.wagered),
    won: roundCurrency(g.won),
    net: roundCurrency(g.won - g.wagered)
  }));

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
    events,
    dailyBreakdown,
    gameBreakdown,
    dailyGameBreakdown,
    hallBreakdown
  };
}
