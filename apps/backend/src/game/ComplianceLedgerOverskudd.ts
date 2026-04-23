// ── Overskudd-fordeling ──────────────────────────────────────────
//
// Splittet ut fra ComplianceLedger.ts (PR-S3). Håndterer beregning av
// minste-fordeling (§11: 30% DATABINGO / 15% MAIN_GAME) og faktisk
// wallet-transfer mot organisasjons-kontoer.
//
// §11-KRITISKE INVARIANTER (må bevares byte-identisk):
//   * minimumPercent: DATABINGO => 0.30, MAIN_GAME => 0.15
//   * net = Math.max(0, row.net) — fordeler ikke negative tap
//   * minimumAmount = roundCurrency(net * minimumPercent)
//   * Rundingsrest tillegges første allocation (`amounts[0] + remainder`)
//   * Rekkefølge av transfers: ytre loop per row, indre loop per allocation
//   * Hver transfer-amount skrives som egen ORG_DISTRIBUTION ledger-entry
//
// Preview og create deler identisk kalkulasjon — preview hopper over
// walletAdapter.transfer() og batchId, ellers byte-identisk.

import { randomUUID } from "node:crypto";
import { DomainError } from "./BingoEngine.js";
import { roundCurrency } from "../util/currency.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type {
  DailyComplianceReport,
  DailyComplianceReportRow,
  LedgerChannel,
  LedgerGameType,
  OrganizationAllocationInput,
  OverskuddDistributionBatch,
  OverskuddDistributionTransfer
} from "./ComplianceLedgerTypes.js";
import {
  assertDateKey,
  assertLedgerChannel,
  assertLedgerGameType,
  assertOrganizationAllocations,
  makeHouseAccountId
} from "./ComplianceLedgerValidators.js";

/**
 * Fordel `totalAmount` over `shares` proporsjonalt. Rundingsrest
 * tillegges første allocation for å bevare sum-invariant
 * (`sum(amounts) === total`).
 */
export function allocateAmountByShares(totalAmount: number, shares: number[]): number[] {
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

interface RowWithMinimum {
  row: DailyComplianceReportRow;
  minimumPercent: number;
  minimumAmount: number;
}

/**
 * §11-kalkyle: for hver rad i daily-report, hvor mye minste-fordeling
 * kreves. Filtrerer bort rader med 0 i minimumAmount (ingen netto-gevinst).
 * Rekkefølge av rader bevares fra report.rows.
 */
function computeRowsWithMinimum(report: DailyComplianceReport): RowWithMinimum[] {
  return report.rows
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
}

export interface CreateOverskuddBatchDeps {
  walletAdapter: WalletAdapter;
  /** Called for hver transfer — caller (ComplianceLedger) skriver ORG_DISTRIBUTION til ledger. */
  recordOrgDistribution: (input: {
    hallId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    amount: number;
    sourceAccountId: string;
    targetAccountId: string;
    batchId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
}

/**
 * Faktisk overskudd-distribusjon: genererer batchId, kjører
 * walletAdapter.transfer() for hver allocation, og skriver én
 * ORG_DISTRIBUTION-ledger-entry per transfer. Returnerer batch-record
 * som caller kan arkivere.
 */
export async function createOverskuddDistributionBatch(
  deps: CreateOverskuddBatchDeps,
  report: DailyComplianceReport,
  input: {
    date: string;
    allocations: OrganizationAllocationInput[];
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }
): Promise<OverskuddDistributionBatch> {
  const date = assertDateKey(input.date, "date");
  const allocations = assertOrganizationAllocations(input.allocations);
  const rowsWithMinimum = computeRowsWithMinimum(report);

  const requiredMinimum = roundCurrency(
    rowsWithMinimum.reduce((sum, entry) => sum + entry.minimumAmount, 0)
  );
  const batchId = randomUUID();
  const createdAt = new Date().toISOString();
  const transfers: OverskuddDistributionTransfer[] = [];

  for (const { row, minimumAmount } of rowsWithMinimum) {
    const sourceAccountId = makeHouseAccountId(row.hallId, row.gameType, row.channel);
    const parts = allocateAmountByShares(minimumAmount, allocations.map((allocation) => allocation.sharePercent));
    for (let i = 0; i < allocations.length; i += 1) {
      const amount = parts[i];
      if (amount <= 0) {
        continue;
      }
      const allocation = allocations[i];
      const transfer = await deps.walletAdapter.transfer(
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

      await deps.recordOrgDistribution({
        hallId: row.hallId,
        gameType: row.gameType,
        channel: row.channel,
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
    gameType: input.gameType ? assertLedgerGameType(input.gameType) : undefined,
    channel: input.channel ? assertLedgerChannel(input.channel) : undefined,
    requiredMinimum,
    distributedAmount,
    transfers: transfers.map((transfer) => ({ ...transfer, txIds: [...transfer.txIds] })),
    allocations: allocations.map((allocation) => ({ ...allocation }))
  };
  return batch;
}

/**
 * Preview: samme kalkyle som create, men uten wallet-kall og uten
 * ledger-skriving. batchId = "PREVIEW", txIds tomme arrays.
 */
export function previewOverskuddDistribution(
  report: DailyComplianceReport,
  input: {
    date: string;
    allocations: OrganizationAllocationInput[];
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }
): OverskuddDistributionBatch {
  const date = assertDateKey(input.date, "date");
  const allocations = assertOrganizationAllocations(input.allocations);
  const rowsWithMinimum = computeRowsWithMinimum(report);

  const requiredMinimum = roundCurrency(
    rowsWithMinimum.reduce((sum, entry) => sum + entry.minimumAmount, 0)
  );

  const transfers: OverskuddDistributionTransfer[] = [];
  const createdAt = new Date().toISOString();

  for (const { row, minimumAmount } of rowsWithMinimum) {
    const sourceAccountId = makeHouseAccountId(row.hallId, row.gameType, row.channel);
    const parts = allocateAmountByShares(minimumAmount, allocations.map((allocation) => allocation.sharePercent));
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
    gameType: input.gameType ? assertLedgerGameType(input.gameType) : undefined,
    channel: input.channel ? assertLedgerChannel(input.channel) : undefined,
    requiredMinimum,
    distributedAmount,
    transfers,
    allocations: allocations.map((allocation) => ({ ...allocation }))
  };
}
