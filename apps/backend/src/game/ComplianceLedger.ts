// ── ComplianceLedger (core) ───────────────────────────────────────
//
// Regulatorisk kjerne for §11 pengespillforskriften: append-only
// ledger + daglig rapportering + overskudd-fordeling.
//
// PR-S3: filen er splittet per domene for å unngå god-class (1473 LOC
// → ~350 LOC core). Offentlig API er uendret — denne fila re-eksporterer
// alle typer og delegerer metode-kropper til:
//   - ./ComplianceLedgerTypes.js       (kontrakter)
//   - ./ComplianceLedgerValidators.js  (input-asserts, tidsnøkler)
//   - ./ComplianceLedgerAggregation.js (generate*-funksjoner + CSV)
//   - ./ComplianceLedgerOverskudd.js   (fordeling + preview)
//
// §11-INVARIANTER: netto-tap-formel, rundingsorden, 50k cap og
// 0.30/0.15 minstegrense bevares byte-identisk. Se modul-header i
// hver split-fil for detaljer.

import { randomUUID } from "node:crypto";
import { DomainError } from "./BingoEngine.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type {
  PersistedDailyReport,
  PersistedOverskuddBatch,
  ResponsibleGamingPersistenceAdapter
} from "./ResponsibleGamingPersistence.js";
import type {
  ComplianceLedgerConfig,
  ComplianceLedgerEntry,
  ComplianceLedgerHydrationSnapshot,
  DailyComplianceReport,
  GameSessionsReport,
  GameStatisticsReport,
  LedgerChannel,
  LedgerEventType,
  LedgerGameType,
  OrganizationAllocationInput,
  OverskuddDistributionBatch,
  RangeComplianceReport,
  RevenueSummary,
  TimeSeriesGranularity,
  TimeSeriesReport,
  TopPlayersReport
} from "./ComplianceLedgerTypes.js";
import {
  assertHallId,
  assertIsoTimestampMs,
  assertLedgerChannel,
  assertLedgerGameType,
  assertNonNegativeNumber,
  assertDateKey,
  dateKeyFromMs,
  makeHouseAccountId as makeHouseAccountIdImpl
} from "./ComplianceLedgerValidators.js";
import {
  exportDailyReportCsv as exportDailyReportCsvImpl,
  generateDailyReport as generateDailyReportImpl,
  generateGameSessions as generateGameSessionsImpl,
  generateGameStatistics as generateGameStatisticsImpl,
  generateRangeReport as generateRangeReportImpl,
  generateRevenueSummary as generateRevenueSummaryImpl,
  generateTimeSeries as generateTimeSeriesImpl,
  generateTopPlayers as generateTopPlayersImpl
} from "./ComplianceLedgerAggregation.js";
import {
  createOverskuddDistributionBatch as createOverskuddBatchImpl,
  previewOverskuddDistribution as previewOverskuddImpl
} from "./ComplianceLedgerOverskudd.js";

const logger = rootLogger.child({ module: "compliance-ledger" });

// ── Re-export types for backward compatibility ────────────────────
// Call-sites importerer typer fra "./ComplianceLedger.js" — den
// kontrakten MÅ bevares uendret.
export type {
  ComplianceLedgerConfig,
  ComplianceLedgerEntry,
  ComplianceLedgerHydrationSnapshot,
  DailyComplianceReport,
  DailyComplianceReportRow,
  GameSessionRow,
  GameSessionsReport,
  GameStatisticsReport,
  GameStatisticsRow,
  LedgerChannel,
  LedgerEventType,
  LedgerGameType,
  OrganizationAllocationInput,
  OverskuddDistributionBatch,
  OverskuddDistributionTransfer,
  RangeComplianceReport,
  RevenueSummary,
  TimeSeriesGranularity,
  TimeSeriesPoint,
  TimeSeriesReport,
  TopPlayerRow,
  TopPlayersReport
} from "./ComplianceLedgerTypes.js";

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
      // HIGH-6: backwards-compat — gammel persistert rapport-JSON kan
      // mangle houseRetained/houseRetainedCount. Defaulter til 0 ved hydrate
      // så live-rapport-formen alltid har feltene satt.
      this.dailyReportArchive.set(report.date, {
        ...report,
        rows: report.rows.map((row) => ({
          ...row,
          houseRetained: row.houseRetained ?? 0,
          houseRetainedCount: row.houseRetainedCount ?? 0,
        })),
        totals: {
          ...report.totals,
          houseRetained: report.totals.houseRetained ?? 0,
          houseRetainedCount: report.totals.houseRetainedCount ?? 0,
        }
      });
    }
  }

  // ── Ledger write-path ───────────────────────────────────────────

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
      hallId: assertHallId(input.hallId),
      gameType: assertLedgerGameType(input.gameType),
      channel: assertLedgerChannel(input.channel),
      eventType: input.eventType,
      amount: roundCurrency(assertNonNegativeNumber(input.amount, "amount")),
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
    const fromMs = input?.dateFrom ? assertIsoTimestampMs(input.dateFrom, "dateFrom") : undefined;
    const toMs = input?.dateTo ? assertIsoTimestampMs(input.dateTo, "dateTo") : undefined;
    const hallId = input?.hallId?.trim();
    const walletId = input?.walletId?.trim();
    const gameType = input?.gameType ? assertLedgerGameType(input.gameType) : undefined;
    const channel = input?.channel ? assertLedgerChannel(input.channel) : undefined;

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

  // ── Report generation (delegates to aggregation module) ─────────

  generateDailyReport(input: {
    date: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): DailyComplianceReport {
    return generateDailyReportImpl(this.complianceLedger, input);
  }

  generateRangeReport(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): RangeComplianceReport {
    return generateRangeReportImpl(this.complianceLedger, input);
  }

  generateGameStatistics(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
  }): GameStatisticsReport {
    return generateGameStatisticsImpl(this.complianceLedger, input);
  }

  generateRevenueSummary(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): RevenueSummary {
    return generateRevenueSummaryImpl(this.complianceLedger, input);
  }

  generateTimeSeries(input: {
    startDate: string;
    endDate: string;
    granularity?: TimeSeriesGranularity;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): TimeSeriesReport {
    return generateTimeSeriesImpl(this.complianceLedger, input);
  }

  generateTopPlayers(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    limit?: number;
  }): TopPlayersReport {
    return generateTopPlayersImpl(this.complianceLedger, input);
  }

  generateGameSessions(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    limit?: number;
  }): GameSessionsReport {
    return generateGameSessionsImpl(this.complianceLedger, input);
  }

  async runDailyReportJob(input?: {
    date?: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): Promise<DailyComplianceReport> {
    const date = input?.date ?? dateKeyFromMs(Date.now());
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
    const date = assertDateKey(dateInput, "date");
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
    return exportDailyReportCsvImpl(report);
  }

  // ── Overskudd-fordeling (delegates to overskudd module) ─────────

  async createOverskuddDistributionBatch(input: {
    date: string;
    allocations: OrganizationAllocationInput[];
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): Promise<OverskuddDistributionBatch> {
    // Generate daily report internt for å få rad-grunnlag for fordeling.
    // assertDateKey kjøres også i createOverskuddBatchImpl (defense-in-depth).
    const date = assertDateKey(input.date, "date");
    const report = this.generateDailyReport({
      date,
      hallId: input.hallId,
      gameType: input.gameType,
      channel: input.channel
    });

    const batch = await createOverskuddBatchImpl(
      {
        walletAdapter: this.walletAdapter,
        recordOrgDistribution: async (entry) => {
          await this.recordComplianceLedgerEvent({
            ...entry,
            eventType: "ORG_DISTRIBUTION"
          });
        }
      },
      report,
      input
    );

    this.overskuddBatches.set(batch.id, batch);
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
    const gameType = input?.gameType ? assertLedgerGameType(input.gameType) : undefined;
    const channel = input?.channel ? assertLedgerChannel(input.channel) : undefined;
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
    const date = assertDateKey(input.date, "date");
    const report = this.generateDailyReport({
      date,
      hallId: input.hallId,
      gameType: input.gameType,
      channel: input.channel
    });
    return previewOverskuddImpl(report, input);
  }

  // ── Public helper (preserved for backward compat) ───────────────

  makeHouseAccountId(hallId: string, gameType: LedgerGameType, channel: LedgerChannel): string {
    return makeHouseAccountIdImpl(hallId, gameType, channel);
  }

  // ── Private helpers ─────────────────────────────────────────────

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
}
