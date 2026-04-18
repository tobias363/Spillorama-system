import { randomUUID } from "node:crypto";
import { DomainError } from "./BingoEngine.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type {
  PersistedComplianceLedgerEntry,
  PersistedDailyReport,
  PersistedOverskuddBatch,
  ResponsibleGamingPersistenceAdapter,
  ResponsibleGamingPersistenceSnapshot
} from "./ResponsibleGamingPersistence.js";

const logger = rootLogger.child({ module: "compliance-ledger" });

// ── Exported types ────────────────────────────────────────────────

export type LedgerGameType = "MAIN_GAME" | "DATABINGO";
export type LedgerChannel = "HALL" | "INTERNET";
export type LedgerEventType = "STAKE" | "PRIZE" | "EXTRA_PRIZE" | "ORG_DISTRIBUTION";

export interface ComplianceLedgerEntry {
  id: string;
  createdAt: string;
  createdAtMs: number;
  hallId: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  eventType: LedgerEventType;
  amount: number;
  currency: "NOK";
  roomCode?: string;
  gameId?: string;
  claimId?: string;
  playerId?: string;
  walletId?: string;
  sourceAccountId?: string;
  targetAccountId?: string;
  policyVersion?: string;
  batchId?: string;
  metadata?: Record<string, unknown>;
}

export interface DailyComplianceReportRow {
  hallId: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  grossTurnover: number;
  prizesPaid: number;
  net: number;
  stakeCount: number;
  prizeCount: number;
  extraPrizeCount: number;
}

export interface DailyComplianceReport {
  date: string;
  generatedAt: string;
  rows: DailyComplianceReportRow[];
  totals: {
    grossTurnover: number;
    prizesPaid: number;
    net: number;
    stakeCount: number;
    prizeCount: number;
    extraPrizeCount: number;
  };
}

/** BIN-517: multi-day range report used by the admin dashboard. */
export interface RangeComplianceReport {
  startDate: string;
  endDate: string;
  generatedAt: string;
  /** One entry per day in the range, even for days with no activity (empty rows). */
  days: DailyComplianceReport[];
  /** Sum across the full range. */
  totals: {
    grossTurnover: number;
    prizesPaid: number;
    net: number;
    stakeCount: number;
    prizeCount: number;
    extraPrizeCount: number;
  };
}

/** BIN-517: per-game-slug statistics (rounds, distinct players, money flow). */
export interface GameStatisticsRow {
  hallId: string;
  gameType: LedgerGameType;
  roundCount: number;
  distinctPlayerCount: number;
  totalStakes: number;
  totalPrizes: number;
  net: number;
  averagePrizePerRound: number;
}

/**
 * BIN-587 B3.1: time-series point for dashboard charts. `date` is
 * YYYY-MM-DD for day-granularity, YYYY-MM for month-granularity.
 */
export interface TimeSeriesPoint {
  date: string;
  stakes: number;
  prizes: number;
  net: number;
  gameCount: number;
  playerCount: number;
}

export type TimeSeriesGranularity = "day" | "month";

export interface TimeSeriesReport {
  startDate: string;
  endDate: string;
  granularity: TimeSeriesGranularity;
  generatedAt: string;
  points: TimeSeriesPoint[];
}

/** BIN-587 B3.1: top spillere etter stake over en periode. */
export interface TopPlayerRow {
  playerId: string;
  totalStakes: number;
  totalPrizes: number;
  net: number;
  gameCount: number;
}

export interface TopPlayersReport {
  startDate: string;
  endDate: string;
  generatedAt: string;
  limit: number;
  rows: TopPlayerRow[];
}

/**
 * BIN-587 B3.1: kompakt revenue-oppsummering for en periode. Like
 * `RangeComplianceReport.totals`, men med ekstra count-felt og uten
 * per-dag-brekking.
 */
export interface RevenueSummary {
  startDate: string;
  endDate: string;
  generatedAt: string;
  totalStakes: number;
  totalPrizes: number;
  net: number;
  roundCount: number;
  uniquePlayerCount: number;
  uniqueHallCount: number;
}

/** BIN-587 B3.1: én fullført spilleøkt med aggregater. */
export interface GameSessionRow {
  gameId: string;
  hallId: string;
  gameType: LedgerGameType;
  firstEventAt: string;
  lastEventAt: string;
  totalStakes: number;
  totalPrizes: number;
  net: number;
  playerCount: number;
}

export interface GameSessionsReport {
  startDate: string;
  endDate: string;
  generatedAt: string;
  rows: GameSessionRow[];
}

export interface GameStatisticsReport {
  startDate: string;
  endDate: string;
  generatedAt: string;
  rows: GameStatisticsRow[];
  totals: {
    roundCount: number;
    distinctPlayerCount: number;
    totalStakes: number;
    totalPrizes: number;
    net: number;
  };
}

export interface OrganizationAllocationInput {
  organizationId: string;
  organizationAccountId: string;
  sharePercent: number;
}

export interface OverskuddDistributionTransfer {
  id: string;
  batchId: string;
  createdAt: string;
  date: string;
  hallId: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  sourceAccountId: string;
  organizationId: string;
  organizationAccountId: string;
  amount: number;
  txIds: string[];
}

export interface OverskuddDistributionBatch {
  id: string;
  createdAt: string;
  date: string;
  hallId?: string;
  gameType?: LedgerGameType;
  channel?: LedgerChannel;
  requiredMinimum: number;
  distributedAmount: number;
  transfers: OverskuddDistributionTransfer[];
  allocations: OrganizationAllocationInput[];
}

// ── Hydration subset ──────────────────────────────────────────────

export interface ComplianceLedgerHydrationSnapshot {
  complianceLedger: PersistedComplianceLedgerEntry[];
  dailyReports: PersistedDailyReport[];
}

// ── Constructor config ────────────────────────────────────────────

export interface ComplianceLedgerConfig {
  walletAdapter: WalletAdapter;
  persistence?: ResponsibleGamingPersistenceAdapter;
}

// ── ComplianceLedger ──────────────────────────────────────────────

export class ComplianceLedger {
  private readonly complianceLedger: ComplianceLedgerEntry[] = [];
  private readonly dailyReportArchive = new Map<string, DailyComplianceReport>();
  private readonly overskuddBatches = new Map<string, OverskuddDistributionBatch>();

  private readonly walletAdapter: WalletAdapter;
  private readonly persistence?: ResponsibleGamingPersistenceAdapter;

  constructor(config: ComplianceLedgerConfig) {
    this.walletAdapter = config.walletAdapter;
    this.persistence = config.persistence;
  }

  // ── Hydration ───────────────────────────────────────────────────

  hydrateFromSnapshot(snapshot: ComplianceLedgerHydrationSnapshot): void {
    this.complianceLedger.length = 0;
    this.dailyReportArchive.clear();

    for (const entry of snapshot.complianceLedger) {
      this.complianceLedger.push({
        ...entry,
        metadata: entry.metadata ? { ...entry.metadata } : undefined
      });
    }

    for (const report of snapshot.dailyReports) {
      this.dailyReportArchive.set(report.date, {
        ...report,
        rows: report.rows.map((row) => ({ ...row })),
        totals: { ...report.totals }
      });
    }
  }

  // ── Public methods ──────────────────────────────────────────────

  async recordComplianceLedgerEvent(input: {
    hallId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    eventType: LedgerEventType;
    amount: number;
    roomCode?: string;
    gameId?: string;
    claimId?: string;
    playerId?: string;
    walletId?: string;
    sourceAccountId?: string;
    targetAccountId?: string;
    policyVersion?: string;
    batchId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const nowMs = Date.now();
    const entry: ComplianceLedgerEntry = {
      id: randomUUID(),
      createdAt: new Date(nowMs).toISOString(),
      createdAtMs: nowMs,
      hallId: this.assertHallId(input.hallId),
      gameType: this.assertLedgerGameType(input.gameType),
      channel: this.assertLedgerChannel(input.channel),
      eventType: input.eventType,
      amount: roundCurrency(this.assertNonNegativeNumber(input.amount, "amount")),
      currency: "NOK",
      roomCode: input.roomCode?.trim() || undefined,
      gameId: input.gameId?.trim() || undefined,
      claimId: input.claimId?.trim() || undefined,
      playerId: input.playerId?.trim() || undefined,
      walletId: input.walletId?.trim() || undefined,
      sourceAccountId: input.sourceAccountId?.trim() || undefined,
      targetAccountId: input.targetAccountId?.trim() || undefined,
      policyVersion: input.policyVersion?.trim() || undefined,
      batchId: input.batchId?.trim() || undefined,
      metadata: input.metadata
    };
    this.complianceLedger.unshift(entry);
    if (this.complianceLedger.length > 50_000) {
      this.complianceLedger.length = 50_000;
    }
    if (this.persistence) {
      await this.persistence.insertComplianceLedgerEntry({
        ...entry,
        metadata: entry.metadata ? { ...entry.metadata } : undefined
      });
    }
  }

  listComplianceLedgerEntries(input?: {
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
    hallId?: string;
    walletId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): ComplianceLedgerEntry[] {
    const limit = Number.isFinite(input?.limit) ? Math.max(1, Math.min(10_000, Math.floor(input!.limit!))) : 200;
    const fromMs = input?.dateFrom ? this.assertIsoTimestampMs(input.dateFrom, "dateFrom") : undefined;
    const toMs = input?.dateTo ? this.assertIsoTimestampMs(input.dateTo, "dateTo") : undefined;
    const hallId = input?.hallId?.trim();
    const walletId = input?.walletId?.trim();
    const gameType = input?.gameType ? this.assertLedgerGameType(input.gameType) : undefined;
    const channel = input?.channel ? this.assertLedgerChannel(input.channel) : undefined;

    return this.complianceLedger
      .filter((entry) => {
        if (fromMs !== undefined && entry.createdAtMs < fromMs) {
          return false;
        }
        if (toMs !== undefined && entry.createdAtMs > toMs) {
          return false;
        }
        if (hallId && entry.hallId !== hallId) {
          return false;
        }
        if (walletId && entry.walletId !== walletId) {
          return false;
        }
        if (gameType && entry.gameType !== gameType) {
          return false;
        }
        if (channel && entry.channel !== channel) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
  }

  async recordAccountingEvent(input: {
    hallId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    eventType: "STAKE" | "PRIZE" | "EXTRA_PRIZE";
    amount: number;
    metadata?: Record<string, unknown>;
  }): Promise<ComplianceLedgerEntry> {
    await this.recordComplianceLedgerEvent({
      hallId: input.hallId,
      gameType: input.gameType,
      channel: input.channel,
      eventType: input.eventType,
      amount: input.amount,
      metadata: input.metadata
    });
    const latest = this.complianceLedger[0];
    return { ...latest };
  }

  generateDailyReport(input: {
    date: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): DailyComplianceReport {
    const dateKey = this.assertDateKey(input.date, "date");
    const hallId = input.hallId?.trim();
    const gameType = input.gameType ? this.assertLedgerGameType(input.gameType) : undefined;
    const channel = input.channel ? this.assertLedgerChannel(input.channel) : undefined;
    const dateRange = this.dayRangeMs(dateKey);
    const rowsByKey = new Map<string, DailyComplianceReportRow>();

    for (const entry of this.complianceLedger) {
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
        extraPrizeCount: 0
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
        return acc;
      },
      {
        grossTurnover: 0,
        prizesPaid: 0,
        net: 0,
        stakeCount: 0,
        prizeCount: 0,
        extraPrizeCount: 0
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
  generateRangeReport(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): RangeComplianceReport {
    const startDate = this.assertDateKey(input.startDate, "startDate");
    const endDate = this.assertDateKey(input.endDate, "endDate");
    const startRange = this.dayRangeMs(startDate);
    const endRange = this.dayRangeMs(endDate);
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
    };
    let cursorMs = startRange.startMs;
    let dayCount = 0;
    while (cursorMs <= endRange.startMs) {
      dayCount += 1;
      if (dayCount > MAX_DAYS) {
        throw new DomainError("INVALID_INPUT", `Datointervall for stort (maks ${MAX_DAYS} dager).`);
      }
      const dateKey = this.dateKeyFromMs(cursorMs);
      const day = this.generateDailyReport({
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
  generateGameStatistics(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
  }): GameStatisticsReport {
    const startDate = this.assertDateKey(input.startDate, "startDate");
    const endDate = this.assertDateKey(input.endDate, "endDate");
    const startRange = this.dayRangeMs(startDate);
    const endRange = this.dayRangeMs(endDate);
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

    for (const entry of this.complianceLedger) {
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

  // ── BIN-587 B3.1: dashboard + revenue + drill-down ──────────────────────

  /**
   * BIN-587 B3.1: kompakt revenue-oppsummering. Lik
   * `generateRangeReport().totals`, men uten per-dag-brekking og med
   * round/player/hall-teller. Brukes av dashboard KPI-boks og
   * `/api/admin/reports/revenue`.
   */
  generateRevenueSummary(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): RevenueSummary {
    const startDate = this.assertDateKey(input.startDate, "startDate");
    const endDate = this.assertDateKey(input.endDate, "endDate");
    const startRange = this.dayRangeMs(startDate);
    const endRange = this.dayRangeMs(endDate);
    if (startRange.startMs > endRange.startMs) {
      throw new DomainError("INVALID_INPUT", "startDate må være ≤ endDate.");
    }
    const hallFilter = input.hallId?.trim() || undefined;
    let totalStakes = 0;
    let totalPrizes = 0;
    const gameIds = new Set<string>();
    const playerIds = new Set<string>();
    const hallIds = new Set<string>();
    for (const entry of this.complianceLedger) {
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
  generateTimeSeries(input: {
    startDate: string;
    endDate: string;
    granularity?: TimeSeriesGranularity;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): TimeSeriesReport {
    const startDate = this.assertDateKey(input.startDate, "startDate");
    const endDate = this.assertDateKey(input.endDate, "endDate");
    const startRange = this.dayRangeMs(startDate);
    const endRange = this.dayRangeMs(endDate);
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
      const iso = this.dateKeyFromMs(ms);
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

    for (const entry of this.complianceLedger) {
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
  generateTopPlayers(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    limit?: number;
  }): TopPlayersReport {
    const startDate = this.assertDateKey(input.startDate, "startDate");
    const endDate = this.assertDateKey(input.endDate, "endDate");
    const startRange = this.dayRangeMs(startDate);
    const endRange = this.dayRangeMs(endDate);
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
    for (const entry of this.complianceLedger) {
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
  generateGameSessions(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    limit?: number;
  }): GameSessionsReport {
    const startDate = this.assertDateKey(input.startDate, "startDate");
    const endDate = this.assertDateKey(input.endDate, "endDate");
    const startRange = this.dayRangeMs(startDate);
    const endRange = this.dayRangeMs(endDate);
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
    for (const entry of this.complianceLedger) {
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

  async runDailyReportJob(input?: {
    date?: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): Promise<DailyComplianceReport> {
    const date = input?.date ?? this.dateKeyFromMs(Date.now());
    const report = this.generateDailyReport({
      date,
      hallId: input?.hallId,
      gameType: input?.gameType,
      channel: input?.channel
    });
    this.dailyReportArchive.set(report.date, report);
    if (this.persistence) {
      await this.persistence.upsertDailyReport(this.toPersistedDailyReport(report));
    }
    return report;
  }

  getArchivedDailyReport(dateInput: string): DailyComplianceReport | null {
    const date = this.assertDateKey(dateInput, "date");
    const archived = this.dailyReportArchive.get(date);
    if (!archived) {
      return null;
    }
    return {
      ...archived,
      rows: archived.rows.map((row) => ({ ...row })),
      totals: { ...archived.totals }
    };
  }

  exportDailyReportCsv(input: {
    date: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): string {
    const report = this.generateDailyReport(input);
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
      "extra_prize_count"
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
          row.extraPrizeCount
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
        report.totals.extraPrizeCount
      ].join(",")
    );
    return lines.join("\n");
  }

  async createOverskuddDistributionBatch(input: {
    date: string;
    allocations: OrganizationAllocationInput[];
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): Promise<OverskuddDistributionBatch> {
    const date = this.assertDateKey(input.date, "date");
    const allocations = this.assertOrganizationAllocations(input.allocations);
    const report = this.generateDailyReport({
      date,
      hallId: input.hallId,
      gameType: input.gameType,
      channel: input.channel
    });

    const rowsWithMinimum = report.rows
      .map((row) => {
        const minimumPercent = row.gameType === "DATABINGO" ? 0.3 : 0.15;
        const net = Math.max(0, row.net);
        const minimumAmount = roundCurrency(net * minimumPercent);
        return {
          row,
          minimumPercent,
          minimumAmount
        };
      })
      .filter((entry) => entry.minimumAmount > 0);

    const requiredMinimum = roundCurrency(
      rowsWithMinimum.reduce((sum, entry) => sum + entry.minimumAmount, 0)
    );
    const batchId = randomUUID();
    const createdAt = new Date().toISOString();
    const transfers: OverskuddDistributionTransfer[] = [];

    for (const { row, minimumAmount } of rowsWithMinimum) {
      const sourceAccountId = this.makeHouseAccountId(row.hallId, row.gameType, row.channel);
      const parts = this.allocateAmountByShares(minimumAmount, allocations.map((allocation) => allocation.sharePercent));
      for (let i = 0; i < allocations.length; i += 1) {
        const amount = parts[i];
        if (amount <= 0) {
          continue;
        }
        const allocation = allocations[i];
        const transfer = await this.walletAdapter.transfer(
          sourceAccountId,
          allocation.organizationAccountId,
          amount,
          `Overskudd ${batchId} ${date}`
        );
        const record: OverskuddDistributionTransfer = {
          id: randomUUID(),
          batchId,
          createdAt: new Date().toISOString(),
          date,
          hallId: row.hallId,
          gameType: row.gameType,
          channel: row.channel,
          sourceAccountId,
          organizationId: allocation.organizationId,
          organizationAccountId: allocation.organizationAccountId,
          amount,
          txIds: [transfer.fromTx.id, transfer.toTx.id]
        };
        transfers.push(record);

        await this.recordComplianceLedgerEvent({
          hallId: row.hallId,
          gameType: row.gameType,
          channel: row.channel,
          eventType: "ORG_DISTRIBUTION",
          amount,
          sourceAccountId,
          targetAccountId: allocation.organizationAccountId,
          batchId,
          metadata: {
            organizationId: allocation.organizationId,
            date
          }
        });
      }
    }

    const distributedAmount = roundCurrency(transfers.reduce((sum, transfer) => sum + transfer.amount, 0));
    const batch: OverskuddDistributionBatch = {
      id: batchId,
      createdAt,
      date,
      hallId: input.hallId?.trim() || undefined,
      gameType: input.gameType ? this.assertLedgerGameType(input.gameType) : undefined,
      channel: input.channel ? this.assertLedgerChannel(input.channel) : undefined,
      requiredMinimum,
      distributedAmount,
      transfers: transfers.map((transfer) => ({ ...transfer, txIds: [...transfer.txIds] })),
      allocations: allocations.map((allocation) => ({ ...allocation }))
    };
    this.overskuddBatches.set(batchId, batch);
    if (this.persistence) {
      await this.persistence.insertOverskuddBatch(this.toPersistedOverskuddBatch(batch));
    }
    return batch;
  }

  getOverskuddDistributionBatch(batchIdInput: string): OverskuddDistributionBatch {
    const batchId = batchIdInput.trim();
    if (!batchId) {
      throw new DomainError("INVALID_INPUT", "batchId mangler.");
    }
    const batch = this.overskuddBatches.get(batchId);
    if (!batch) {
      throw new DomainError("BATCH_NOT_FOUND", "Fordelingsbatch finnes ikke.");
    }
    return {
      ...batch,
      transfers: batch.transfers.map((transfer) => ({ ...transfer, txIds: [...transfer.txIds] })),
      allocations: batch.allocations.map((allocation) => ({ ...allocation }))
    };
  }

  listOverskuddDistributionBatches(input?: {
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): OverskuddDistributionBatch[] {
    const limit = Number.isFinite(input?.limit) ? Math.max(1, Math.min(1000, Math.floor(input!.limit!))) : 200;
    const hallId = input?.hallId?.trim();
    const gameType = input?.gameType ? this.assertLedgerGameType(input.gameType) : undefined;
    const channel = input?.channel ? this.assertLedgerChannel(input.channel) : undefined;
    const dateFrom = input?.dateFrom?.trim();
    const dateTo = input?.dateTo?.trim();

    const allBatches = [...this.overskuddBatches.values()].sort((a, b) => b.date.localeCompare(a.date));

    return allBatches
      .filter((batch) => {
        if (hallId && batch.hallId !== hallId) {
          return false;
        }
        if (gameType && batch.gameType !== gameType) {
          return false;
        }
        if (channel && batch.channel !== channel) {
          return false;
        }
        if (dateFrom && batch.date < dateFrom) {
          return false;
        }
        if (dateTo && batch.date > dateTo) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map((batch) => ({
        ...batch,
        transfers: batch.transfers.map((transfer) => ({ ...transfer, txIds: [...transfer.txIds] })),
        allocations: batch.allocations.map((allocation) => ({ ...allocation }))
      }));
  }

  previewOverskuddDistribution(input: {
    date: string;
    allocations: OrganizationAllocationInput[];
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): OverskuddDistributionBatch {
    const date = this.assertDateKey(input.date, "date");
    const allocations = this.assertOrganizationAllocations(input.allocations);
    const report = this.generateDailyReport({
      date,
      hallId: input.hallId,
      gameType: input.gameType,
      channel: input.channel
    });

    const rowsWithMinimum = report.rows
      .map((row) => {
        const minimumPercent = row.gameType === "DATABINGO" ? 0.3 : 0.15;
        const net = Math.max(0, row.net);
        const minimumAmount = roundCurrency(net * minimumPercent);
        return {
          row,
          minimumPercent,
          minimumAmount
        };
      })
      .filter((entry) => entry.minimumAmount > 0);

    const requiredMinimum = roundCurrency(
      rowsWithMinimum.reduce((sum, entry) => sum + entry.minimumAmount, 0)
    );

    const transfers: OverskuddDistributionTransfer[] = [];
    const createdAt = new Date().toISOString();

    for (const { row, minimumAmount } of rowsWithMinimum) {
      const sourceAccountId = this.makeHouseAccountId(row.hallId, row.gameType, row.channel);
      const parts = this.allocateAmountByShares(minimumAmount, allocations.map((allocation) => allocation.sharePercent));
      for (let i = 0; i < allocations.length; i += 1) {
        const amount = parts[i];
        if (amount <= 0) {
          continue;
        }
        const allocation = allocations[i];
        const record: OverskuddDistributionTransfer = {
          id: randomUUID(),
          batchId: "PREVIEW",
          createdAt,
          date,
          hallId: row.hallId,
          gameType: row.gameType,
          channel: row.channel,
          sourceAccountId,
          organizationId: allocation.organizationId,
          organizationAccountId: allocation.organizationAccountId,
          amount,
          txIds: []
        };
        transfers.push(record);
      }
    }

    const distributedAmount = roundCurrency(transfers.reduce((sum, transfer) => sum + transfer.amount, 0));

    return {
      id: "PREVIEW",
      createdAt,
      date,
      hallId: input.hallId?.trim() || undefined,
      gameType: input.gameType ? this.assertLedgerGameType(input.gameType) : undefined,
      channel: input.channel ? this.assertLedgerChannel(input.channel) : undefined,
      requiredMinimum,
      distributedAmount,
      transfers,
      allocations: allocations.map((allocation) => ({ ...allocation }))
    };
  }

  // ── Private helpers ─────────────────────────────────────────────

  makeHouseAccountId(hallId: string, gameType: LedgerGameType, channel: LedgerChannel): string {
    return `house-${hallId.trim()}-${gameType.toLowerCase()}-${channel.toLowerCase()}`;
  }

  private toPersistedDailyReport(report: DailyComplianceReport): PersistedDailyReport {
    return {
      ...report,
      rows: report.rows.map((row) => ({ ...row })),
      totals: { ...report.totals }
    };
  }

  private toPersistedOverskuddBatch(batch: OverskuddDistributionBatch): PersistedOverskuddBatch {
    return {
      id: batch.id,
      createdAt: batch.createdAt,
      date: batch.date,
      hallId: batch.hallId,
      gameType: batch.gameType,
      channel: batch.channel,
      requiredMinimum: batch.requiredMinimum,
      distributedAmount: batch.distributedAmount,
      transfersJson: JSON.stringify(batch.transfers),
      allocationsJson: JSON.stringify(batch.allocations)
    };
  }

  private assertLedgerGameType(value: string): LedgerGameType {
    const normalized = value.trim().toUpperCase();
    if (normalized === "MAIN_GAME" || normalized === "DATABINGO") {
      return normalized;
    }
    throw new DomainError("INVALID_INPUT", "gameType må være MAIN_GAME eller DATABINGO.");
  }

  private assertLedgerChannel(value: string): LedgerChannel {
    const normalized = value.trim().toUpperCase();
    if (normalized === "HALL" || normalized === "INTERNET") {
      return normalized;
    }
    throw new DomainError("INVALID_INPUT", "channel må være HALL eller INTERNET.");
  }

  private assertDateKey(value: string, fieldName: string): string {
    const normalized = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være i format YYYY-MM-DD.`);
    }
    const [yearText, monthText, dayText] = normalized.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new DomainError("INVALID_INPUT", `${fieldName} er ikke en gyldig dato.`);
    }
    return normalized;
  }

  private dayRangeMs(dateKey: string): { startMs: number; endMs: number } {
    const normalized = this.assertDateKey(dateKey, "date");
    const [yearText, monthText, dayText] = normalized.split("-");
    const startMs = new Date(Number(yearText), Number(monthText) - 1, Number(dayText)).getTime();
    const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
    return { startMs, endMs };
  }

  private dateKeyFromMs(referenceMs: number): string {
    const date = new Date(referenceMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private assertOrganizationAllocations(
    allocations: OrganizationAllocationInput[]
  ): OrganizationAllocationInput[] {
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new DomainError("INVALID_INPUT", "allocations må inneholde minst én organisasjon.");
    }

    const normalized = allocations.map((allocation) => {
      const organizationId = allocation.organizationId?.trim();
      const organizationAccountId = allocation.organizationAccountId?.trim();
      const sharePercent = Number(allocation.sharePercent);
      if (!organizationId) {
        throw new DomainError("INVALID_INPUT", "organizationId mangler.");
      }
      if (!organizationAccountId) {
        throw new DomainError("INVALID_INPUT", "organizationAccountId mangler.");
      }
      if (!Number.isFinite(sharePercent) || sharePercent <= 0) {
        throw new DomainError("INVALID_INPUT", "sharePercent må være større enn 0.");
      }
      return {
        organizationId,
        organizationAccountId,
        sharePercent
      };
    });

    const totalShare = normalized.reduce((sum, allocation) => sum + allocation.sharePercent, 0);
    if (Math.abs(totalShare - 100) > 0.0001) {
      throw new DomainError("INVALID_INPUT", "Summen av sharePercent må være 100.");
    }
    return normalized;
  }

  private allocateAmountByShares(totalAmount: number, shares: number[]): number[] {
    const total = roundCurrency(totalAmount);
    if (shares.length === 0) {
      return [];
    }
    const sumShares = shares.reduce((sum, share) => sum + share, 0);
    if (!Number.isFinite(sumShares) || sumShares <= 0) {
      throw new DomainError("INVALID_INPUT", "Ugyldige andeler for fordeling.");
    }

    const amounts = shares.map((share) => roundCurrency((total * share) / sumShares));
    const allocated = roundCurrency(amounts.reduce((sum, amount) => sum + amount, 0));
    const remainder = roundCurrency(total - allocated);
    amounts[0] = roundCurrency(amounts[0] + remainder);
    return amounts;
  }

  private assertHallId(hallId: string): string {
    const normalized = hallId.trim();
    if (!normalized || normalized.length > 120) {
      throw new DomainError("INVALID_HALL_ID", "hallId er ugyldig.");
    }
    return normalized;
  }

  private assertIsoTimestampMs(value: string, fieldName: string): number {
    const normalized = value.trim();
    if (!normalized) {
      throw new DomainError("INVALID_INPUT", `${fieldName} mangler.`);
    }
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed)) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være ISO-8601 dato/tid.`);
    }
    return parsed;
  }

  private assertNonNegativeNumber(value: number, fieldName: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være 0 eller større.`);
    }
    return value;
  }
}
