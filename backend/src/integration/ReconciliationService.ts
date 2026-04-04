import type { WalletTransaction } from "../adapters/WalletAdapter.js";
import type { ExternalWalletAdapter } from "./ExternalWalletAdapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconciliationDiscrepancy {
  /** Our local transaction ID. */
  transactionId: string;
  /** Type of discrepancy. */
  type: "missing_on_provider" | "amount_mismatch" | "missing_locally";
  /** Our local record (if exists). */
  localTransaction?: WalletTransaction;
  /** Provider's record (if exists). */
  providerTransaction?: ProviderTransactionRecord;
  /** Human-readable description. */
  description: string;
}

export interface ReconciliationReport {
  /** Timestamp when this report was generated. */
  generatedAt: string;
  /** Period covered. */
  periodStart: string;
  periodEnd: string;
  /** Total local transactions checked. */
  localTransactionCount: number;
  /** Total provider transactions checked. */
  providerTransactionCount: number;
  /** Discrepancies found. */
  discrepancies: ReconciliationDiscrepancy[];
  /** Overall status. */
  status: "ok" | "discrepancies_found";
}

/** Represents a transaction record from the provider's system. */
export interface ProviderTransactionRecord {
  transactionId: string;
  playerId: string;
  amount: number;
  type: "debit" | "credit";
  timestamp: string;
  roundId?: string;
}

export interface ReconciliationServiceOptions {
  /** The external wallet adapter to get local ledger from. */
  walletAdapter: ExternalWalletAdapter;
  /** Optional: function to fetch provider transaction history.
   *  If not provided, reconciliation only reports local-side data. */
  fetchProviderTransactions?: (periodStart: string, periodEnd: string) => Promise<ProviderTransactionRecord[]>;
  /** Threshold: number of discrepancies to trigger alarm. Default: 1. */
  alarmThreshold?: number;
  /** Optional alarm callback. */
  onAlarm?: (report: ReconciliationReport) => void;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReconciliationService {
  private readonly walletAdapter: ExternalWalletAdapter;
  private readonly fetchProviderTransactions?: (start: string, end: string) => Promise<ProviderTransactionRecord[]>;
  private readonly alarmThreshold: number;
  private readonly onAlarm?: (report: ReconciliationReport) => void;

  /** History of generated reports (in-memory for now). */
  private readonly reports: ReconciliationReport[] = [];

  constructor(options: ReconciliationServiceOptions) {
    this.walletAdapter = options.walletAdapter;
    this.fetchProviderTransactions = options.fetchProviderTransactions;
    this.alarmThreshold = options.alarmThreshold ?? 1;
    this.onAlarm = options.onAlarm;
  }

  /**
   * Run reconciliation for a given time period.
   *
   * Compares local ledger entries within the period against provider records.
   * If no provider fetch function is configured, reports local-only summary.
   */
  async reconcile(periodStart: string, periodEnd: string): Promise<ReconciliationReport> {
    const startMs = new Date(periodStart).getTime();
    const endMs = new Date(periodEnd).getTime();

    // Get local transactions in the period.
    const allLocal = this.walletAdapter.getFullLedger();
    const localInPeriod = allLocal.filter((tx) => {
      const txMs = new Date(tx.createdAt).getTime();
      return txMs >= startMs && txMs <= endMs;
    });

    const discrepancies: ReconciliationDiscrepancy[] = [];

    if (this.fetchProviderTransactions) {
      const providerTxs = await this.fetchProviderTransactions(periodStart, periodEnd);

      // Build a map of provider transactions by ID.
      const providerMap = new Map<string, ProviderTransactionRecord>();
      for (const ptx of providerTxs) {
        providerMap.set(ptx.transactionId, ptx);
      }

      // Build a set of local transaction IDs.
      const localIds = new Set<string>();

      // Check each local transaction against provider.
      for (const localTx of localInPeriod) {
        localIds.add(localTx.id);
        const providerTx = providerMap.get(localTx.id);

        if (!providerTx) {
          discrepancies.push({
            transactionId: localTx.id,
            type: "missing_on_provider",
            localTransaction: localTx,
            description: `Transaksjon ${localTx.id} finnes lokalt men ikke hos leverandøren.`
          });
          continue;
        }

        // Compare amounts.
        if (Math.abs(localTx.amount - providerTx.amount) > 0.005) {
          discrepancies.push({
            transactionId: localTx.id,
            type: "amount_mismatch",
            localTransaction: localTx,
            providerTransaction: providerTx,
            description: `Beløpsavvik for ${localTx.id}: lokalt ${localTx.amount}, leverandør ${providerTx.amount}.`
          });
        }
      }

      // Check for provider transactions missing locally.
      for (const ptx of providerTxs) {
        if (!localIds.has(ptx.transactionId)) {
          discrepancies.push({
            transactionId: ptx.transactionId,
            type: "missing_locally",
            providerTransaction: ptx,
            description: `Transaksjon ${ptx.transactionId} finnes hos leverandøren men ikke lokalt.`
          });
        }
      }

      const report: ReconciliationReport = {
        generatedAt: new Date().toISOString(),
        periodStart,
        periodEnd,
        localTransactionCount: localInPeriod.length,
        providerTransactionCount: providerTxs.length,
        discrepancies,
        status: discrepancies.length > 0 ? "discrepancies_found" : "ok"
      };

      this.reports.push(report);
      if (discrepancies.length >= this.alarmThreshold && this.onAlarm) {
        this.onAlarm(report);
      }

      return report;
    }

    // No provider fetch — local-only report.
    const report: ReconciliationReport = {
      generatedAt: new Date().toISOString(),
      periodStart,
      periodEnd,
      localTransactionCount: localInPeriod.length,
      providerTransactionCount: 0,
      discrepancies: [],
      status: "ok"
    };

    this.reports.push(report);
    return report;
  }

  /**
   * Run reconciliation for the last N hours. Convenience wrapper.
   */
  async reconcileLastHours(hours: number = 24): Promise<ReconciliationReport> {
    const now = new Date();
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
    return this.reconcile(start.toISOString(), now.toISOString());
  }

  /**
   * Get all stored reports.
   */
  getReports(): ReconciliationReport[] {
    return this.reports.map((r) => ({ ...r }));
  }

  /**
   * Get the most recent report, or null if none exists.
   */
  getLatestReport(): ReconciliationReport | null {
    return this.reports.length > 0 ? { ...this.reports[this.reports.length - 1] } : null;
  }
}
