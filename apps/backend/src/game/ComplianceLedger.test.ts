import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type {
  CreateWalletAccountInput,
  WalletAccount,
  WalletAdapter,
  WalletTransaction,
  WalletTransferResult
} from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import { ComplianceLedger } from "./ComplianceLedger.js";
import type { OrganizationAllocationInput } from "./ComplianceLedger.js";

// ── InMemoryWalletAdapter ────────────────────────────────────────────

class InMemoryWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  private txCounter = 0;
  public transferCallCount = 0;

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `wallet-${randomUUID()}`;
    const initialBalance = Number(input?.initialBalance ?? 1000);
    const allowExisting = Boolean(input?.allowExisting);
    const existing = this.accounts.get(accountId);
    if (existing) {
      if (!allowExisting) {
        throw new WalletError("ACCOUNT_EXISTS", "Konto finnes allerede.");
      }
      return { ...existing };
    }
    const now = new Date().toISOString();
    const account: WalletAccount = { id: accountId, balance: initialBalance, createdAt: now, updatedAt: now };
    this.accounts.set(accountId, account);
    return { ...account };
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const normalized = accountId.trim();
    if (this.accounts.has(normalized)) {
      return this.getAccount(normalized);
    }
    return this.createAccount({ accountId: normalized, initialBalance: 100_000, allowExisting: true });
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    const account = this.accounts.get(accountId.trim());
    if (!account) {
      throw new WalletError("ACCOUNT_NOT_FOUND", "Konto finnes ikke.");
    }
    return { ...account };
  }

  async listAccounts(): Promise<WalletAccount[]> {
    return [...this.accounts.values()].map((a) => ({ ...a }));
  }

  async getBalance(accountId: string): Promise<number> {
    const account = await this.getAccount(accountId);
    return account.balance;
  }

  async debit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, -Math.abs(amount), "DEBIT", reason);
  }

  async credit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, Math.abs(amount), "CREDIT", reason);
  }

  async topUp(accountId: string, amount: number, reason = "Top-up"): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, Math.abs(amount), "TOPUP", reason);
  }

  async withdraw(accountId: string, amount: number, reason = "Withdrawal"): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, -Math.abs(amount), "WITHDRAWAL", reason);
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Transfer"
  ): Promise<WalletTransferResult> {
    this.transferCallCount += 1;
    const normalizedAmount = Math.abs(amount);
    const fromTx = await this.adjustBalance(fromAccountId, -normalizedAmount, "TRANSFER_OUT", reason, toAccountId);
    const toTx = await this.adjustBalance(toAccountId, normalizedAmount, "TRANSFER_IN", reason, fromAccountId);
    return { fromTx, toTx };
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    return ([] as WalletTransaction[]).slice(-Math.max(0, limit));
  }

  private async adjustBalance(
    accountId: string,
    delta: number,
    type: WalletTransaction["type"],
    reason: string,
    relatedAccountId?: string
  ): Promise<WalletTransaction> {
    const normalized = accountId.trim();
    const account = await this.ensureAccount(normalized);
    const nextBalance = account.balance + delta;
    if (nextBalance < 0) {
      throw new WalletError("INSUFFICIENT_FUNDS", "Ikke nok saldo.");
    }
    const updated: WalletAccount = { ...account, balance: nextBalance, updatedAt: new Date().toISOString() };
    this.accounts.set(normalized, updated);
    const tx: WalletTransaction = {
      id: `tx-${++this.txCounter}`,
      accountId: normalized,
      type,
      amount: Math.abs(delta),
      reason,
      createdAt: new Date().toISOString(),
      relatedAccountId
    };
    return { ...tx };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeLedger(): { ledger: ComplianceLedger; wallet: InMemoryWalletAdapter } {
  const wallet = new InMemoryWalletAdapter();
  const ledger = new ComplianceLedger({ walletAdapter: wallet });
  return { ledger, wallet };
}

const TEST_ALLOCATIONS: OrganizationAllocationInput[] = [
  { organizationId: "org-1", organizationAccountId: "org-acc-1", sharePercent: 60 },
  { organizationId: "org-2", organizationAccountId: "org-acc-2", sharePercent: 40 }
];

// ── Tests ─────────────────────────────────────────────────────────────

test("recordComplianceLedgerEvent lagrer entry og kan hentes med listComplianceLedgerEntries", async () => {
  const { ledger } = makeLedger();

  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "DATABINGO",
    channel: "INTERNET",
    eventType: "STAKE",
    amount: 50
  });

  const entries = ledger.listComplianceLedgerEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hallId, "hall-1");
  assert.equal(entries[0].gameType, "DATABINGO");
  assert.equal(entries[0].channel, "INTERNET");
  assert.equal(entries[0].eventType, "STAKE");
  assert.equal(entries[0].amount, 50);
  assert.equal(entries[0].currency, "NOK");
  assert.ok(entries[0].id);
  assert.ok(entries[0].createdAt);
});

test("generateDailyReport beregner riktig grossTurnover, prizesPaid og net per hall/gameType/channel", async () => {
  const { ledger } = makeLedger();

  const date = "2025-01-15";
  // Use a timestamp within 2025-01-15 (UTC+0 assumption in the ledger's dayRangeMs)
  const dayMs = new Date(2025, 0, 15).getTime(); // local midnight

  // Manually inject entries by recording events (they use Date.now internally)
  // We need events on a specific date — record them and set createdAtMs manually via the internal array
  const internalLedger = ledger as unknown as { complianceLedger: { createdAtMs: number; createdAt: string; id: string; hallId: string; gameType: string; channel: string; eventType: string; amount: number; currency: "NOK" }[] };

  internalLedger.complianceLedger.push(
    { id: randomUUID(), createdAt: new Date(dayMs + 1000).toISOString(), createdAtMs: dayMs + 1000, hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 100, currency: "NOK" },
    { id: randomUUID(), createdAt: new Date(dayMs + 2000).toISOString(), createdAtMs: dayMs + 2000, hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 50, currency: "NOK" },
    { id: randomUUID(), createdAt: new Date(dayMs + 3000).toISOString(), createdAtMs: dayMs + 3000, hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "PRIZE", amount: 40, currency: "NOK" },
    { id: randomUUID(), createdAt: new Date(dayMs + 4000).toISOString(), createdAtMs: dayMs + 4000, hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "EXTRA_PRIZE", amount: 10, currency: "NOK" }
  );

  const report = ledger.generateDailyReport({ date });

  assert.equal(report.date, date);
  assert.equal(report.rows.length, 1);

  const row = report.rows[0];
  assert.equal(row.hallId, "hall-1");
  assert.equal(row.gameType, "DATABINGO");
  assert.equal(row.channel, "INTERNET");
  assert.equal(row.grossTurnover, 150);
  assert.equal(row.prizesPaid, 50); // PRIZE 40 + EXTRA_PRIZE 10
  assert.equal(row.net, 100);
  assert.equal(row.stakeCount, 2);
  assert.equal(row.prizeCount, 1);
  assert.equal(row.extraPrizeCount, 1);

  assert.equal(report.totals.grossTurnover, 150);
  assert.equal(report.totals.prizesPaid, 50);
  assert.equal(report.totals.net, 100);
});

test("createOverskuddDistributionBatch beregner riktig requiredMinimum og kaller walletAdapter.transfer", async () => {
  const { ledger, wallet } = makeLedger();

  const date = "2025-02-10";
  const dayMs = new Date(2025, 1, 10).getTime();

  const internalLedger = ledger as unknown as { complianceLedger: { createdAtMs: number; createdAt: string; id: string; hallId: string; gameType: string; channel: string; eventType: string; amount: number; currency: "NOK" }[] };

  // net = 1000 - 300 = 700, DATABINGO => requiredMinimum = 700 * 0.30 = 210
  internalLedger.complianceLedger.push(
    { id: randomUUID(), createdAt: new Date(dayMs + 1000).toISOString(), createdAtMs: dayMs + 1000, hallId: "hall-db", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 1000, currency: "NOK" },
    { id: randomUUID(), createdAt: new Date(dayMs + 2000).toISOString(), createdAtMs: dayMs + 2000, hallId: "hall-db", gameType: "DATABINGO", channel: "INTERNET", eventType: "PRIZE", amount: 300, currency: "NOK" }
  );

  const transfersBefore = wallet.transferCallCount;
  const batch = await ledger.createOverskuddDistributionBatch({
    date,
    allocations: TEST_ALLOCATIONS
  });

  assert.equal(batch.requiredMinimum, 210);
  assert.equal(batch.distributedAmount, 210);
  assert.ok(batch.id !== "PREVIEW");
  assert.equal(batch.transfers.length, 2); // two orgs
  assert.ok(wallet.transferCallCount > transfersBefore);

  // check amounts: 210 * 60% = 126, 210 * 40% = 84
  const org1Transfer = batch.transfers.find((t) => t.organizationId === "org-1");
  const org2Transfer = batch.transfers.find((t) => t.organizationId === "org-2");
  assert.ok(org1Transfer);
  assert.ok(org2Transfer);
  assert.equal(org1Transfer.amount, 126);
  assert.equal(org2Transfer.amount, 84);
});

test("createOverskuddDistributionBatch skriver ORG_DISTRIBUTION events til ledger", async () => {
  const { ledger } = makeLedger();

  const date = "2025-03-05";
  const dayMs = new Date(2025, 2, 5).getTime();

  const internalLedger = ledger as unknown as { complianceLedger: { createdAtMs: number; createdAt: string; id: string; hallId: string; gameType: string; channel: string; eventType: string; amount: number; currency: "NOK"; batchId?: string }[] };

  // MAIN_GAME: net = 400, requiredMinimum = 400 * 0.15 = 60
  internalLedger.complianceLedger.push(
    { id: randomUUID(), createdAt: new Date(dayMs + 1000).toISOString(), createdAtMs: dayMs + 1000, hallId: "hall-mg", gameType: "MAIN_GAME", channel: "HALL", eventType: "STAKE", amount: 400, currency: "NOK" }
  );

  const batch = await ledger.createOverskuddDistributionBatch({
    date,
    allocations: TEST_ALLOCATIONS
  });

  const entries = ledger.listComplianceLedgerEntries();
  const orgDistributions = entries.filter((e) => e.eventType === "ORG_DISTRIBUTION");
  assert.equal(orgDistributions.length, 2);

  for (const entry of orgDistributions) {
    assert.equal(entry.batchId, batch.id);
    assert.equal(entry.hallId, "hall-mg");
    assert.equal(entry.gameType, "MAIN_GAME");
    assert.equal(entry.channel, "HALL");
  }
});

test("previewOverskuddDistribution returnerer riktige tall UTEN å kalle walletAdapter.transfer", async () => {
  const { ledger, wallet } = makeLedger();

  const date = "2025-04-01";
  const dayMs = new Date(2025, 3, 1).getTime();

  const internalLedger = ledger as unknown as { complianceLedger: { createdAtMs: number; createdAt: string; id: string; hallId: string; gameType: string; channel: string; eventType: string; amount: number; currency: "NOK" }[] };

  // DATABINGO: net = 500, requiredMinimum = 500 * 0.30 = 150
  internalLedger.complianceLedger.push(
    { id: randomUUID(), createdAt: new Date(dayMs + 1000).toISOString(), createdAtMs: dayMs + 1000, hallId: "hall-p", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 500, currency: "NOK" }
  );

  const transfersBefore = wallet.transferCallCount;

  const batch = ledger.previewOverskuddDistribution({
    date,
    allocations: TEST_ALLOCATIONS
  });

  assert.equal(batch.id, "PREVIEW");
  assert.equal(batch.requiredMinimum, 150);
  assert.equal(batch.distributedAmount, 150);
  assert.equal(batch.transfers.length, 2);

  // No transfers should happen for preview
  assert.equal(wallet.transferCallCount, transfersBefore);

  // All txIds should be empty arrays
  for (const transfer of batch.transfers) {
    assert.deepEqual(transfer.txIds, []);
  }

  // Batch should NOT be stored in in-memory map
  const internalBatches = (ledger as unknown as { overskuddBatches: Map<string, unknown> }).overskuddBatches;
  assert.equal(internalBatches.size, 0);
});

test("listOverskuddDistributionBatches returnerer opprettede batches med filtrering", async () => {
  const { ledger } = makeLedger();

  const date = "2025-05-20";
  const dayMs = new Date(2025, 4, 20).getTime();

  const internalLedger = ledger as unknown as { complianceLedger: { createdAtMs: number; createdAt: string; id: string; hallId: string; gameType: string; channel: string; eventType: string; amount: number; currency: "NOK" }[] };

  internalLedger.complianceLedger.push(
    { id: randomUUID(), createdAt: new Date(dayMs + 1000).toISOString(), createdAtMs: dayMs + 1000, hallId: "hall-a", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 200, currency: "NOK" }
  );

  await ledger.createOverskuddDistributionBatch({ date, allocations: TEST_ALLOCATIONS, hallId: "hall-a" });

  const all = ledger.listOverskuddDistributionBatches();
  assert.equal(all.length, 1);
  assert.equal(all[0].date, date);

  const filtered = ledger.listOverskuddDistributionBatches({ hallId: "hall-a" });
  assert.equal(filtered.length, 1);

  const noMatch = ledger.listOverskuddDistributionBatches({ hallId: "hall-x" });
  assert.equal(noMatch.length, 0);

  const byGameType = ledger.listOverskuddDistributionBatches({ gameType: "MAIN_GAME" });
  // batch has no gameType filter set (hallId only), so it won't have gameType "MAIN_GAME"
  // but the batch itself has no gameType (undefined), so it won't match "MAIN_GAME"
  assert.equal(byGameType.length, 0);

  const byDate = ledger.listOverskuddDistributionBatches({ dateFrom: "2025-05-20", dateTo: "2025-05-20" });
  assert.equal(byDate.length, 1);

  const outsideDate = ledger.listOverskuddDistributionBatches({ dateFrom: "2025-06-01" });
  assert.equal(outsideDate.length, 0);
});

test("exportDailyReportCsv genererer gyldig CSV med header og total-rad", async () => {
  const { ledger } = makeLedger();

  const date = "2025-06-10";
  const dayMs = new Date(2025, 5, 10).getTime();

  const internalLedger = ledger as unknown as { complianceLedger: { createdAtMs: number; createdAt: string; id: string; hallId: string; gameType: string; channel: string; eventType: string; amount: number; currency: "NOK" }[] };

  internalLedger.complianceLedger.push(
    { id: randomUUID(), createdAt: new Date(dayMs + 1000).toISOString(), createdAtMs: dayMs + 1000, hallId: "hall-csv", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 300, currency: "NOK" },
    { id: randomUUID(), createdAt: new Date(dayMs + 2000).toISOString(), createdAtMs: dayMs + 2000, hallId: "hall-csv", gameType: "DATABINGO", channel: "INTERNET", eventType: "PRIZE", amount: 100, currency: "NOK" }
  );

  const csv = ledger.exportDailyReportCsv({ date });
  const lines = csv.split("\n");

  // Must have at least 3 lines: header, data row, total row
  assert.ok(lines.length >= 3);

  const header = lines[0];
  assert.ok(header.includes("date"));
  assert.ok(header.includes("hall_id"));
  assert.ok(header.includes("gross_turnover"));
  assert.ok(header.includes("prizes_paid"));
  assert.ok(header.includes("net"));

  // Last line should be the total row with "ALL"
  const totalRow = lines[lines.length - 1];
  assert.ok(totalRow.includes("ALL"));
  assert.ok(totalRow.includes(date));

  // Data row should have correct values
  const dataRow = lines[1];
  assert.ok(dataRow.includes("hall-csv"));
  assert.ok(dataRow.includes("300"));
  assert.ok(dataRow.includes("100"));
  assert.ok(dataRow.includes("200")); // net
});
