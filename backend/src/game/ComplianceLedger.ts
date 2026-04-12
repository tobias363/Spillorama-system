import { randomUUID } from "node:crypto";
import { DomainError } from "./BingoEngine.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type {
  PersistedComplianceLedgerEntry,
  PersistedDailyReport,
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
