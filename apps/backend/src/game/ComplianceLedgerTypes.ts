// ── Exported types for ComplianceLedger ──────────────────────────
//
// Split ut fra ComplianceLedger.ts (PR-S3) for å isolere kontrakter
// fra core-implementasjon. Offentlig API er uendret — alle typene
// re-eksporteres fra ComplianceLedger.ts (barrel) slik at kall-sites
// som importerer fra `./ComplianceLedger.js` fortsetter å virke.

import type {
  PersistedComplianceLedgerEntry,
  PersistedDailyReport,
  ResponsibleGamingPersistenceAdapter
} from "./ResponsibleGamingPersistence.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";

export type LedgerGameType = "MAIN_GAME" | "DATABINGO";
export type LedgerChannel = "HALL" | "INTERNET";
/**
 * HIGH-6 split-rounding-ledger: HOUSE_RETAINED dokumenterer rest-øren
 * fra multi-winner-split-rounding (floor(totalPhasePrize / winnerCount)
 * → rest til hus). Skrives av Game1PayoutService når houseRetainedCents > 0.
 *
 * Regulatorisk (§71 pengespillforskriften):
 *   - Auditor skal kunne verifisere at husets margin matcher §11-beregningen.
 *   - Uten HOUSE_RETAINED-entry vil daily_report.net (= stake - prize) vise
 *     et større "hus-overskudd" enn faktisk, fordi rest-øre er en del av
 *     pott (gjenstår for senere fase) og ikke ren retention.
 *   - Dual-balance-sjekk: stake = prize + houseRetained + uavklart-rest.
 */
export type LedgerEventType =
  | "STAKE"
  | "PRIZE"
  | "EXTRA_PRIZE"
  | "ORG_DISTRIBUTION"
  | "HOUSE_RETAINED";

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
  /**
   * HIGH-6: sum av split-rounding rest-øre som ble retained i denne
   * (hall, gameType, channel)-bucket. `net = grossTurnover - prizesPaid`
   * er bevart byte-identisk; `houseRetained` er en separat dimensjon som
   * lar auditor verifisere at deler av "net" er forklart av §11-rest.
   *
   * Dual-balance: grossTurnover - prizesPaid - houseRetained = uavklart
   * hus-margin. Hvis = 0 betyr alt revenue er enten utbetalt eller
   * dokumentert som split-rest.
   */
  houseRetained: number;
  houseRetainedCount: number;
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
    /** HIGH-6: aggregert split-rounding-rest på tvers av rader. */
    houseRetained: number;
    houseRetainedCount: number;
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
    /** HIGH-6: aggregert split-rounding-rest over hele intervallet. */
    houseRetained: number;
    houseRetainedCount: number;
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
