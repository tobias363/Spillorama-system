// ── Aggregation / report-generering ──────────────────────────────
//
// Splittet ut fra ComplianceLedger.ts (PR-S3). Alle generate*-funksjoner
// er pure: tar inn entries-array + input, returnerer rapport-objekt. Ingen
// state, ingen side-effekter, ingen persistence — caller (ComplianceLedger-
// klassen) eier state og bestemmer arkivering.
//
// §11-KRITISKE INVARIANTER (må bevares byte-identisk):
//   * Netto-tap-formelen: row.net = row.grossTurnover - row.prizesPaid
//   * Iterasjonsorden over complianceLedger-array (LIFO fra unshift)
//   * Rundingsorden — roundCurrency kalles på slutt-totals, ikke mellomsummer
//   * Sorteringsorden: hallId → gameType → channel (localeCompare)
//   * Cap: MAX_DAYS=366, MAX_MONTHS=60 (range/timeseries-beskyttelse)

import { DomainError } from "./BingoEngine.js";
import { roundCurrency } from "../util/currency.js";
import type {
  ComplianceLedgerEntry,
  DailyComplianceReport,
  DailyComplianceReportRow,
  GameSessionRow,
  GameSessionsReport,
  GameStatisticsReport,
  GameStatisticsRow,
  LedgerChannel,
  LedgerGameType,
  RangeComplianceReport,
  RevenueSummary,
  TimeSeriesGranularity,
  TimeSeriesPoint,
  TimeSeriesReport,
  TopPlayerRow,
  TopPlayersReport
} from "./ComplianceLedgerTypes.js";
import {
  assertDateKey,
  assertLedgerChannel,
  assertLedgerGameType,
  dateKeyFromMs,
  dayRangeMs
} from "./ComplianceLedgerValidators.js";

export function generateDailyReport(
  entries: ReadonlyArray<ComplianceLedgerEntry>,
  input: {
    date: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }
): DailyComplianceReport {
  const dateKey = assertDateKey(input.date, "date");
  const hallId = input.hallId?.trim();
  const gameType = input.gameType ? assertLedgerGameType(input.gameType) : undefined;
  const channel = input.channel ? assertLedgerChannel(input.channel) : undefined;
  const dateRange = dayRangeMs(dateKey);
  const rowsByKey = new Map<string, DailyComplianceReportRow>();

  for (const entry of entries) {
    if (entry.createdAtMs < dateRange.startMs || entry.createdAtMs > dateRange.endMs) {
      continue;
    }
    if (hallId && entry.hallId !== hallId) {
      continue;
    }
    if (gameType && entry.gameType !== gameType) {
      continue;
    }
    if (channel && entry.channel !== channel) {
      continue;
    }

    const key = `${entry.hallId}::${entry.gameType}::${entry.channel}`;
    const row = rowsByKey.get(key) ?? {
      hallId: entry.hallId,
      gameType: entry.gameType,
      channel: entry.channel,
      grossTurnover: 0,
      prizesPaid: 0,
      net: 0,
      stakeCount: 0,
      prizeCount: 0,
      extraPrizeCount: 0,
      houseRetained: 0,
      houseRetainedCount: 0
    };

    if (entry.eventType === "STAKE") {
      row.grossTurnover += entry.amount;
      row.stakeCount += 1;
    }
    if (entry.eventType === "PRIZE") {
      row.prizesPaid += entry.amount;
      row.prizeCount += 1;
    }
    if (entry.eventType === "EXTRA_PRIZE") {
      row.prizesPaid += entry.amount;
      row.extraPrizeCount += 1;
    }
    // HIGH-6: HOUSE_RETAINED er splitt-rest fra multi-winner-payout. Den
    // INNGÅR IKKE i prizesPaid/net (bevart byte-identisk for §11-formel),
    // men aggregeres separat så auditor kan re-konstruere dual-balance:
    //   net = grossTurnover - prizesPaid
    //   uavklart_margin = net - houseRetained
    if (entry.eventType === "HOUSE_RETAINED") {
      row.houseRetained += entry.amount;
      row.houseRetainedCount += 1;
    }

    row.net = row.grossTurnover - row.prizesPaid;
    rowsByKey.set(key, row);
  }

  const rows = [...rowsByKey.values()].sort((a, b) => {
    const byHall = a.hallId.localeCompare(b.hallId);
    if (byHall !== 0) {
      return byHall;
    }
    const byGame = a.gameType.localeCompare(b.gameType);
    if (byGame !== 0) {
      return byGame;
    }
    return a.channel.localeCompare(b.channel);
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.grossTurnover += row.grossTurnover;
      acc.prizesPaid += row.prizesPaid;
      acc.net += row.net;
      acc.stakeCount += row.stakeCount;
      acc.prizeCount += row.prizeCount;
      acc.extraPrizeCount += row.extraPrizeCount;
      acc.houseRetained += row.houseRetained;
      acc.houseRetainedCount += row.houseRetainedCount;
      return acc;
    },
    {
      grossTurnover: 0,
      prizesPaid: 0,
      net: 0,
      stakeCount: 0,
      prizeCount: 0,
      extraPrizeCount: 0,
      houseRetained: 0,
      houseRetainedCount: 0
    }
  );

  return {
    date: dateKey,
    generatedAt: new Date().toISOString(),
    rows,
    totals
  };
}

/**
 * BIN-517: range report — calls generateDailyReport for each day in the
 * [startDate, endDate] inclusive range and sums the totals. Days with no
 * activity still produce an entry with empty `rows` so the dashboard
 * can render a zero-bar for that day (gap-free x-axis).
 */
export function generateRangeReport(
  entries: ReadonlyArray<ComplianceLedgerEntry>,
  input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }
): RangeComplianceReport {
  const startDate = assertDateKey(input.startDate, "startDate");
  const endDate = assertDateKey(input.endDate, "endDate");
  const startRange = dayRangeMs(startDate);
  const endRange = dayRangeMs(endDate);
  if (startRange.startMs > endRange.startMs) {
    throw new DomainError("INVALID_INPUT", "startDate må være ≤ endDate.");
  }
  // Hard cap to keep the dashboard response bounded. 366 days = full year +
  // leap day. Callers wanting larger windows should paginate.
  const MAX_DAYS = 366;
  const days: DailyComplianceReport[] = [];
  const totals = {
    grossTurnover: 0, prizesPaid: 0, net: 0,
    stakeCount: 0, prizeCount: 0, extraPrizeCount: 0,
    houseRetained: 0, houseRetainedCount: 0,
  };
  let cursorMs = startRange.startMs;
  let dayCount = 0;
  while (cursorMs <= endRange.startMs) {
    dayCount += 1;
    if (dayCount > MAX_DAYS) {
      throw new DomainError("INVALID_INPUT", `Datointervall for stort (maks ${MAX_DAYS} dager).`);
    }
    const dateKey = dateKeyFromMs(cursorMs);
    const day = generateDailyReport(entries, {
      date: dateKey,
      hallId: input.hallId,
      gameType: input.gameType,
      channel: input.channel,
    });
    days.push(day);
    totals.grossTurnover += day.totals.grossTurnover;
    totals.prizesPaid += day.totals.prizesPaid;
    totals.net += day.totals.net;
    totals.stakeCount += day.totals.stakeCount;
    totals.prizeCount += day.totals.prizeCount;
    totals.extraPrizeCount += day.totals.extraPrizeCount;
    totals.houseRetained += day.totals.houseRetained;
    totals.houseRetainedCount += day.totals.houseRetainedCount;
    cursorMs += 24 * 60 * 60 * 1000;
  }
  return {
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    days,
    totals: {
      grossTurnover: roundCurrency(totals.grossTurnover),
      prizesPaid: roundCurrency(totals.prizesPaid),
      net: roundCurrency(totals.net),
      stakeCount: totals.stakeCount,
      prizeCount: totals.prizeCount,
      extraPrizeCount: totals.extraPrizeCount,
      houseRetained: roundCurrency(totals.houseRetained),
      houseRetainedCount: totals.houseRetainedCount,
    },
  };
}

/**
 * BIN-517: per-game statistics for the admin dashboard.
 *
 * Groups ledger entries by (hallId, gameType) and counts:
 *   - roundCount = distinct gameId values with at least one entry
 *   - distinctPlayerCount = distinct playerId values that staked
 *   - totalStakes / totalPrizes (PRIZE + EXTRA_PRIZE)
 *
 * Player-count is scoped to the (hallId, gameType) bucket — a player
 * who staked in two halls counts once per hall, which is the right
 * granularity for "how many unique players did hall X serve".
 */
export function generateGameStatistics(
  entries: ReadonlyArray<ComplianceLedgerEntry>,
  input: {
    startDate: string;
    endDate: string;
    hallId?: string;
  }
): GameStatisticsReport {
  const startDate = assertDateKey(input.startDate, "startDate");
  const endDate = assertDateKey(input.endDate, "endDate");
  const startRange = dayRangeMs(startDate);
  const endRange = dayRangeMs(endDate);
  if (startRange.startMs > endRange.startMs) {
    throw new DomainError("INVALID_INPUT", "startDate må være ≤ endDate.");
  }
  const hallFilter = input.hallId?.trim() || undefined;

  interface Bucket {
    hallId: string;
    gameType: LedgerGameType;
    gameIds: Set<string>;
    playerIds: Set<string>;
    totalStakes: number;
    totalPrizes: number;
  }
  const bucketByKey = new Map<string, Bucket>();

  for (const entry of entries) {
    if (entry.createdAtMs < startRange.startMs || entry.createdAtMs > endRange.endMs) continue;
    if (hallFilter && entry.hallId !== hallFilter) continue;
    const key = `${entry.hallId}::${entry.gameType}`;
    let bucket = bucketByKey.get(key);
    if (!bucket) {
      bucket = {
        hallId: entry.hallId,
        gameType: entry.gameType,
        gameIds: new Set<string>(),
        playerIds: new Set<string>(),
        totalStakes: 0,
        totalPrizes: 0,
      };
      bucketByKey.set(key, bucket);
    }
    if (entry.gameId) bucket.gameIds.add(entry.gameId);
    if (entry.eventType === "STAKE") {
      bucket.totalStakes += entry.amount;
      if (entry.playerId) bucket.playerIds.add(entry.playerId);
    } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      bucket.totalPrizes += entry.amount;
    }
  }

  const rows: GameStatisticsRow[] = [...bucketByKey.values()]
    .map((b) => {
      const roundCount = b.gameIds.size;
      const net = b.totalStakes - b.totalPrizes;
      const averagePrizePerRound = roundCount > 0 ? b.totalPrizes / roundCount : 0;
      return {
        hallId: b.hallId,
        gameType: b.gameType,
        roundCount,
        distinctPlayerCount: b.playerIds.size,
        totalStakes: roundCurrency(b.totalStakes),
        totalPrizes: roundCurrency(b.totalPrizes),
        net: roundCurrency(net),
        averagePrizePerRound: roundCurrency(averagePrizePerRound),
      };
    })
    .sort((a, b) => {
      const byHall = a.hallId.localeCompare(b.hallId);
      if (byHall !== 0) return byHall;
      return a.gameType.localeCompare(b.gameType);
    });

  const totals = rows.reduce(
    (acc, row) => {
      acc.roundCount += row.roundCount;
      acc.distinctPlayerCount += row.distinctPlayerCount;
      acc.totalStakes += row.totalStakes;
      acc.totalPrizes += row.totalPrizes;
      acc.net += row.net;
      return acc;
    },
    { roundCount: 0, distinctPlayerCount: 0, totalStakes: 0, totalPrizes: 0, net: 0 },
  );
  totals.totalStakes = roundCurrency(totals.totalStakes);
  totals.totalPrizes = roundCurrency(totals.totalPrizes);
  totals.net = roundCurrency(totals.net);

  return {
    startDate, endDate,
    generatedAt: new Date().toISOString(),
    rows,
    totals,
  };
}

/**
 * BIN-587 B3.1: kompakt revenue-oppsummering. Lik
 * `generateRangeReport().totals`, men uten per-dag-brekking og med
 * round/player/hall-teller. Brukes av dashboard KPI-boks og
 * `/api/admin/reports/revenue`.
 */
export function generateRevenueSummary(
  entries: ReadonlyArray<ComplianceLedgerEntry>,
  input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }
): RevenueSummary {
  const startDate = assertDateKey(input.startDate, "startDate");
  const endDate = assertDateKey(input.endDate, "endDate");
  const startRange = dayRangeMs(startDate);
  const endRange = dayRangeMs(endDate);
  if (startRange.startMs > endRange.startMs) {
    throw new DomainError("INVALID_INPUT", "startDate må være ≤ endDate.");
  }
  const hallFilter = input.hallId?.trim() || undefined;
  let totalStakes = 0;
  let totalPrizes = 0;
  const gameIds = new Set<string>();
  const playerIds = new Set<string>();
  const hallIds = new Set<string>();
  for (const entry of entries) {
    if (entry.createdAtMs < startRange.startMs || entry.createdAtMs > endRange.endMs) continue;
    if (hallFilter && entry.hallId !== hallFilter) continue;
    if (input.gameType && entry.gameType !== input.gameType) continue;
    if (input.channel && entry.channel !== input.channel) continue;
    hallIds.add(entry.hallId);
    if (entry.gameId) gameIds.add(entry.gameId);
    if (entry.eventType === "STAKE") {
      totalStakes += entry.amount;
      if (entry.playerId) playerIds.add(entry.playerId);
    } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      totalPrizes += entry.amount;
    }
  }
  return {
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    totalStakes: roundCurrency(totalStakes),
    totalPrizes: roundCurrency(totalPrizes),
    net: roundCurrency(totalStakes - totalPrizes),
    roundCount: gameIds.size,
    uniquePlayerCount: playerIds.size,
    uniqueHallCount: hallIds.size,
  };
}

/**
 * BIN-587 B3.1: time-series for dashboard-charts. Bucket-size er
 * `day` (YYYY-MM-DD) eller `month` (YYYY-MM). Returnerer point per
 * bucket i hele intervallet — også buckets uten aktivitet (zeros),
 * så UI kan tegne kontinuerlige linjer.
 */
export function generateTimeSeries(
  entries: ReadonlyArray<ComplianceLedgerEntry>,
  input: {
    startDate: string;
    endDate: string;
    granularity?: TimeSeriesGranularity;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }
): TimeSeriesReport {
  const startDate = assertDateKey(input.startDate, "startDate");
  const endDate = assertDateKey(input.endDate, "endDate");
  const startRange = dayRangeMs(startDate);
  const endRange = dayRangeMs(endDate);
  if (startRange.startMs > endRange.startMs) {
    throw new DomainError("INVALID_INPUT", "startDate må være ≤ endDate.");
  }
  const granularity: TimeSeriesGranularity = input.granularity ?? "day";
  if (granularity !== "day" && granularity !== "month") {
    throw new DomainError("INVALID_INPUT", "granularity må være 'day' eller 'month'.");
  }
  // Cap: 366 dager for day, 60 måneder for month — beskytter mot enorme responses.
  const MAX_DAYS = 366;
  const MAX_MONTHS = 60;
  const hallFilter = input.hallId?.trim() || undefined;

  interface Bucket {
    gameIds: Set<string>;
    playerIds: Set<string>;
    stakes: number;
    prizes: number;
  }
  const buckets = new Map<string, Bucket>();
  const bucketKey = (ms: number): string => {
    const iso = dateKeyFromMs(ms);
    return granularity === "day" ? iso : iso.slice(0, 7);
  };

  // Pre-seed buckets for hele intervallet så vi får null-aktivitet-points også.
  if (granularity === "day") {
    let cursor = startRange.startMs;
    let count = 0;
    while (cursor <= endRange.startMs) {
      count += 1;
      if (count > MAX_DAYS) {
        throw new DomainError("INVALID_INPUT", `Datointervall for stort (maks ${MAX_DAYS} dager).`);
      }
      buckets.set(bucketKey(cursor), {
        gameIds: new Set(), playerIds: new Set(), stakes: 0, prizes: 0,
      });
      cursor += 24 * 60 * 60 * 1000;
    }
  } else {
    // month
    const startYm = startDate.slice(0, 7);
    const endYm = endDate.slice(0, 7);
    const [sy, sm] = startYm.split("-").map((v) => Number(v));
    const [ey, em] = endYm.split("-").map((v) => Number(v));
    let y = sy!;
    let m = sm!;
    let count = 0;
    while (y < ey! || (y === ey! && m <= em!)) {
      count += 1;
      if (count > MAX_MONTHS) {
        throw new DomainError("INVALID_INPUT", `Månedsintervall for stort (maks ${MAX_MONTHS} måneder).`);
      }
      const ym = `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}`;
      buckets.set(ym, { gameIds: new Set(), playerIds: new Set(), stakes: 0, prizes: 0 });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }

  for (const entry of entries) {
    if (entry.createdAtMs < startRange.startMs || entry.createdAtMs > endRange.endMs) continue;
    if (hallFilter && entry.hallId !== hallFilter) continue;
    if (input.gameType && entry.gameType !== input.gameType) continue;
    if (input.channel && entry.channel !== input.channel) continue;
    const key = bucketKey(entry.createdAtMs);
    const bucket = buckets.get(key);
    if (!bucket) continue; // utenfor seeded range (burde ikke skje)
    if (entry.gameId) bucket.gameIds.add(entry.gameId);
    if (entry.eventType === "STAKE") {
      bucket.stakes += entry.amount;
      if (entry.playerId) bucket.playerIds.add(entry.playerId);
    } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      bucket.prizes += entry.amount;
    }
  }

  const points: TimeSeriesPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, b]) => ({
      date,
      stakes: roundCurrency(b.stakes),
      prizes: roundCurrency(b.prizes),
      net: roundCurrency(b.stakes - b.prizes),
      gameCount: b.gameIds.size,
      playerCount: b.playerIds.size,
    }));

  return {
    startDate,
    endDate,
    granularity,
    generatedAt: new Date().toISOString(),
    points,
  };
}

/**
 * BIN-587 B3.1: top N spillere etter stake over en periode. Ikke
 * personidentifiserende i seg selv — returnerer kun playerId +
 * aggregater; kall-stedet må join mot bruker-tabellen for e-post/navn
 * hvis ønsket.
 */
export function generateTopPlayers(
  entries: ReadonlyArray<ComplianceLedgerEntry>,
  input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    limit?: number;
  }
): TopPlayersReport {
  const startDate = assertDateKey(input.startDate, "startDate");
  const endDate = assertDateKey(input.endDate, "endDate");
  const startRange = dayRangeMs(startDate);
  const endRange = dayRangeMs(endDate);
  if (startRange.startMs > endRange.startMs) {
    throw new DomainError("INVALID_INPUT", "startDate må være ≤ endDate.");
  }
  const limit =
    input.limit && input.limit > 0 ? Math.min(Math.floor(input.limit), 200) : 20;
  const hallFilter = input.hallId?.trim() || undefined;

  interface Bucket {
    totalStakes: number;
    totalPrizes: number;
    gameIds: Set<string>;
  }
  const byPlayer = new Map<string, Bucket>();
  for (const entry of entries) {
    if (!entry.playerId) continue;
    if (entry.createdAtMs < startRange.startMs || entry.createdAtMs > endRange.endMs) continue;
    if (hallFilter && entry.hallId !== hallFilter) continue;
    if (input.gameType && entry.gameType !== input.gameType) continue;
    let bucket = byPlayer.get(entry.playerId);
    if (!bucket) {
      bucket = { totalStakes: 0, totalPrizes: 0, gameIds: new Set() };
      byPlayer.set(entry.playerId, bucket);
    }
    if (entry.gameId) bucket.gameIds.add(entry.gameId);
    if (entry.eventType === "STAKE") {
      bucket.totalStakes += entry.amount;
    } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      bucket.totalPrizes += entry.amount;
    }
  }

  const rows: TopPlayerRow[] = [...byPlayer.entries()]
    .map(([playerId, b]) => ({
      playerId,
      totalStakes: roundCurrency(b.totalStakes),
      totalPrizes: roundCurrency(b.totalPrizes),
      net: roundCurrency(b.totalStakes - b.totalPrizes),
      gameCount: b.gameIds.size,
    }))
    .sort((a, b) => b.totalStakes - a.totalStakes)
    .slice(0, limit);

  return {
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    limit,
    rows,
  };
}

/**
 * BIN-587 B3.1: list fullførte spilleøkter (distinct gameIds) innenfor
 * et intervall med aggregater. Brukes av dashboard game-history og
 * per-game sessions-view. Begrenser til maks 1000 rader — callere som
 * trenger mer må snevre inn intervall/filter.
 */
export function generateGameSessions(
  entries: ReadonlyArray<ComplianceLedgerEntry>,
  input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    limit?: number;
  }
): GameSessionsReport {
  const startDate = assertDateKey(input.startDate, "startDate");
  const endDate = assertDateKey(input.endDate, "endDate");
  const startRange = dayRangeMs(startDate);
  const endRange = dayRangeMs(endDate);
  if (startRange.startMs > endRange.startMs) {
    throw new DomainError("INVALID_INPUT", "startDate må være ≤ endDate.");
  }
  const limit =
    input.limit && input.limit > 0 ? Math.min(Math.floor(input.limit), 1000) : 200;
  const hallFilter = input.hallId?.trim() || undefined;

  interface SessionBucket {
    gameId: string;
    hallId: string;
    gameType: LedgerGameType;
    firstMs: number;
    lastMs: number;
    totalStakes: number;
    totalPrizes: number;
    playerIds: Set<string>;
  }
  const byGame = new Map<string, SessionBucket>();
  for (const entry of entries) {
    if (!entry.gameId) continue;
    if (entry.createdAtMs < startRange.startMs || entry.createdAtMs > endRange.endMs) continue;
    if (hallFilter && entry.hallId !== hallFilter) continue;
    if (input.gameType && entry.gameType !== input.gameType) continue;
    let bucket = byGame.get(entry.gameId);
    if (!bucket) {
      bucket = {
        gameId: entry.gameId,
        hallId: entry.hallId,
        gameType: entry.gameType,
        firstMs: entry.createdAtMs,
        lastMs: entry.createdAtMs,
        totalStakes: 0,
        totalPrizes: 0,
        playerIds: new Set(),
      };
      byGame.set(entry.gameId, bucket);
    }
    if (entry.createdAtMs < bucket.firstMs) bucket.firstMs = entry.createdAtMs;
    if (entry.createdAtMs > bucket.lastMs) bucket.lastMs = entry.createdAtMs;
    if (entry.eventType === "STAKE") {
      bucket.totalStakes += entry.amount;
      if (entry.playerId) bucket.playerIds.add(entry.playerId);
    } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      bucket.totalPrizes += entry.amount;
    }
  }
  const rows: GameSessionRow[] = [...byGame.values()]
    .sort((a, b) => b.lastMs - a.lastMs)
    .slice(0, limit)
    .map((b) => ({
      gameId: b.gameId,
      hallId: b.hallId,
      gameType: b.gameType,
      firstEventAt: new Date(b.firstMs).toISOString(),
      lastEventAt: new Date(b.lastMs).toISOString(),
      totalStakes: roundCurrency(b.totalStakes),
      totalPrizes: roundCurrency(b.totalPrizes),
      net: roundCurrency(b.totalStakes - b.totalPrizes),
      playerCount: b.playerIds.size,
    }));
  return {
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    rows,
  };
}

/**
 * CSV-export av daglig rapport. Headers + én linje per row + summary-rad
 * med "ALL" som hall/game/channel. Brukes av admin download-endpoint.
 */
export function exportDailyReportCsv(report: DailyComplianceReport): string {
  // HIGH-6: house_retained + house_retained_count lagt til som nye kolonner
  // i CSV-eksporten. Backwards-kompatible kolonner først, så nye til sist.
  const headers = [
    "date",
    "hall_id",
    "game_type",
    "channel",
    "gross_turnover",
    "prizes_paid",
    "net",
    "stake_count",
    "prize_count",
    "extra_prize_count",
    "house_retained",
    "house_retained_count"
  ];
  const lines = [headers.join(",")];

  for (const row of report.rows) {
    lines.push(
      [
        report.date,
        row.hallId,
        row.gameType,
        row.channel,
        row.grossTurnover,
        row.prizesPaid,
        row.net,
        row.stakeCount,
        row.prizeCount,
        row.extraPrizeCount,
        row.houseRetained,
        row.houseRetainedCount
      ].join(",")
    );
  }

  lines.push(
    [
      report.date,
      "ALL",
      "ALL",
      "ALL",
      report.totals.grossTurnover,
      report.totals.prizesPaid,
      report.totals.net,
      report.totals.stakeCount,
      report.totals.prizeCount,
      report.totals.extraPrizeCount,
      report.totals.houseRetained,
      report.totals.houseRetainedCount
    ].join(",")
  );
  return lines.join("\n");
}
