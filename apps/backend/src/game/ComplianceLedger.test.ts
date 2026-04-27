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
    const account: WalletAccount = {
      id: accountId,
      balance: initialBalance,
      depositBalance: initialBalance,
      winningsBalance: 0,
      createdAt: now,
      updatedAt: now
    };
    this.accounts.set(accountId, account);
    return { ...account };
  }

  async getDepositBalance(accountId: string): Promise<number> {
    return (await this.getAccount(accountId)).depositBalance;
  }
  async getWinningsBalance(accountId: string): Promise<number> {
    return (await this.getAccount(accountId)).winningsBalance;
  }
  async getBothBalances(accountId: string): Promise<{ deposit: number; winnings: number; total: number }> {
    const a = await this.getAccount(accountId);
    return { deposit: a.depositBalance, winnings: a.winningsBalance, total: a.balance };
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
    const updated: WalletAccount = {
      ...account,
      balance: nextBalance,
      depositBalance: nextBalance,
      winningsBalance: 0,
      updatedAt: new Date().toISOString()
    };
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

// ── BIN-517: range report + game statistics ───────────────────────────────

type InternalLedgerEntry = {
  id: string; createdAt: string; createdAtMs: number;
  hallId: string; gameType: "DATABINGO" | "MAIN_GAME";
  channel: "HALL" | "INTERNET";
  // HIGH-6: HOUSE_RETAINED lagt til.
  eventType: "STAKE" | "PRIZE" | "EXTRA_PRIZE" | "ORG_DISTRIBUTION" | "HOUSE_RETAINED";
  amount: number; currency: "NOK";
  gameId?: string; playerId?: string;
};

function pushInternalEntries(ledger: ComplianceLedger, entries: InternalLedgerEntry[]): void {
  const internal = ledger as unknown as { complianceLedger: InternalLedgerEntry[] };
  internal.complianceLedger.push(...entries);
}

function dayMs(dateKey: string, offsetSec = 0): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getTime() + offsetSec * 1000;
}

test("BIN-517 generateRangeReport sums days across the inclusive range", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 10)).toISOString(), createdAtMs: dayMs("2026-04-14", 10),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 100, currency: "NOK" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 20)).toISOString(), createdAtMs: dayMs("2026-04-14", 20),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "PRIZE", amount: 60, currency: "NOK" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-16", 5)).toISOString(), createdAtMs: dayMs("2026-04-16", 5),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 200, currency: "NOK" },
  ]);
  const report = ledger.generateRangeReport({ startDate: "2026-04-14", endDate: "2026-04-16" });
  // Three days inclusive — even the middle empty day must appear.
  assert.equal(report.days.length, 3);
  assert.equal(report.days[0].date, "2026-04-14");
  assert.equal(report.days[1].date, "2026-04-15");
  assert.equal(report.days[2].date, "2026-04-16");
  assert.equal(report.days[1].rows.length, 0);
  assert.equal(report.totals.grossTurnover, 300);
  assert.equal(report.totals.prizesPaid, 60);
  assert.equal(report.totals.net, 240);
  assert.equal(report.totals.stakeCount, 2);
  assert.equal(report.totals.prizeCount, 1);
});

test("BIN-517 generateRangeReport rejects reversed dates", () => {
  const { ledger } = makeLedger();
  assert.throws(
    () => ledger.generateRangeReport({ startDate: "2026-04-20", endDate: "2026-04-10" }),
    /startDate må være ≤ endDate/,
  );
});

test("BIN-517 generateRangeReport caps to 366 days", () => {
  const { ledger } = makeLedger();
  assert.throws(
    () => ledger.generateRangeReport({ startDate: "2024-01-01", endDate: "2026-04-01" }),
    /Datointervall for stort/,
  );
});

test("BIN-517 generateGameStatistics groups by (hallId, gameType) and counts distinct rounds + players", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    // Hall-1 DATABINGO: 2 distinct rounds, 3 distinct players
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-15", 1)).toISOString(), createdAtMs: dayMs("2026-04-15", 1),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 50, currency: "NOK",
      gameId: "g-100", playerId: "p-a" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-15", 2)).toISOString(), createdAtMs: dayMs("2026-04-15", 2),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 50, currency: "NOK",
      gameId: "g-100", playerId: "p-b" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-15", 3)).toISOString(), createdAtMs: dayMs("2026-04-15", 3),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "PRIZE", amount: 80, currency: "NOK",
      gameId: "g-100", playerId: "p-a" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-16", 1)).toISOString(), createdAtMs: dayMs("2026-04-16", 1),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 50, currency: "NOK",
      gameId: "g-101", playerId: "p-c" },
    // Hall-2 MAIN_GAME: 1 round, 1 player (different bucket)
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-15", 5)).toISOString(), createdAtMs: dayMs("2026-04-15", 5),
      hallId: "hall-2", gameType: "MAIN_GAME", channel: "HALL", eventType: "STAKE", amount: 20, currency: "NOK",
      gameId: "g-200", playerId: "p-a" },
  ]);

  const report = ledger.generateGameStatistics({ startDate: "2026-04-15", endDate: "2026-04-16" });
  assert.equal(report.rows.length, 2);

  const hall1 = report.rows.find((r) => r.hallId === "hall-1" && r.gameType === "DATABINGO");
  assert.ok(hall1);
  assert.equal(hall1!.roundCount, 2);           // g-100, g-101
  assert.equal(hall1!.distinctPlayerCount, 3);  // p-a, p-b, p-c (PRIZE doesn't add player)
  assert.equal(hall1!.totalStakes, 150);
  assert.equal(hall1!.totalPrizes, 80);
  assert.equal(hall1!.net, 70);
  assert.equal(hall1!.averagePrizePerRound, 40);

  const hall2 = report.rows.find((r) => r.hallId === "hall-2" && r.gameType === "MAIN_GAME");
  assert.ok(hall2);
  assert.equal(hall2!.roundCount, 1);
  assert.equal(hall2!.distinctPlayerCount, 1);
  // Totals sum across the two buckets.
  assert.equal(report.totals.roundCount, 3);
  assert.equal(report.totals.totalStakes, 170);
});

test("BIN-517 generateGameStatistics filters by hallId", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-15", 1)).toISOString(), createdAtMs: dayMs("2026-04-15", 1),
      hallId: "hall-a", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 30, currency: "NOK",
      gameId: "g-1", playerId: "p-1" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-15", 2)).toISOString(), createdAtMs: dayMs("2026-04-15", 2),
      hallId: "hall-b", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 70, currency: "NOK",
      gameId: "g-2", playerId: "p-2" },
  ]);
  const filtered = ledger.generateGameStatistics({ startDate: "2026-04-15", endDate: "2026-04-15", hallId: "hall-a" });
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].hallId, "hall-a");
  assert.equal(filtered.totals.totalStakes, 30);
});


// ── BIN-587 B3.1: revenue + time-series + top-players + game-sessions ─────

test("BIN-587 B3.1: generateRevenueSummary returnerer totals med round/player/hall-teller", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 10)).toISOString(), createdAtMs: dayMs("2026-04-14", 10),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 100, currency: "NOK",
      gameId: "g-1", playerId: "p-1" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 20)).toISOString(), createdAtMs: dayMs("2026-04-14", 20),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "PRIZE", amount: 60, currency: "NOK",
      gameId: "g-1" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-15", 5)).toISOString(), createdAtMs: dayMs("2026-04-15", 5),
      hallId: "hall-2", gameType: "DATABINGO", channel: "HALL", eventType: "STAKE", amount: 50, currency: "NOK",
      gameId: "g-2", playerId: "p-2" },
  ]);
  const summary = ledger.generateRevenueSummary({ startDate: "2026-04-14", endDate: "2026-04-15" });
  assert.equal(summary.totalStakes, 150);
  assert.equal(summary.totalPrizes, 60);
  assert.equal(summary.net, 90);
  assert.equal(summary.roundCount, 2);
  assert.equal(summary.uniquePlayerCount, 2);
  assert.equal(summary.uniqueHallCount, 2);
});

test("BIN-587 B3.1: generateRevenueSummary hallId filter", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 10)).toISOString(), createdAtMs: dayMs("2026-04-14", 10),
      hallId: "hall-1", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 100, currency: "NOK",
      gameId: "g-1", playerId: "p-1" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 20)).toISOString(), createdAtMs: dayMs("2026-04-14", 20),
      hallId: "hall-2", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 200, currency: "NOK",
      gameId: "g-2", playerId: "p-2" },
  ]);
  const only1 = ledger.generateRevenueSummary({ startDate: "2026-04-14", endDate: "2026-04-14", hallId: "hall-1" });
  assert.equal(only1.totalStakes, 100);
  assert.equal(only1.uniqueHallCount, 1);
});

test("BIN-587 B3.1: generateTimeSeries day-granularity inkluderer null-aktivitet-dager", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 10)).toISOString(), createdAtMs: dayMs("2026-04-14", 10),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 100, currency: "NOK",
      gameId: "g-1", playerId: "p-1" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-16", 5)).toISOString(), createdAtMs: dayMs("2026-04-16", 5),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "PRIZE", amount: 40, currency: "NOK",
      gameId: "g-2" },
  ]);
  const ts = ledger.generateTimeSeries({ startDate: "2026-04-14", endDate: "2026-04-16" });
  assert.equal(ts.granularity, "day");
  assert.equal(ts.points.length, 3);
  assert.equal(ts.points[0].date, "2026-04-14");
  assert.equal(ts.points[0].stakes, 100);
  assert.equal(ts.points[1].date, "2026-04-15");
  assert.equal(ts.points[1].stakes, 0);
  assert.equal(ts.points[1].playerCount, 0);
  assert.equal(ts.points[2].date, "2026-04-16");
  assert.equal(ts.points[2].prizes, 40);
});

test("BIN-587 B3.1: generateTimeSeries month-granularity bucker per YYYY-MM", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    { id: randomUUID(), createdAt: new Date(dayMs("2026-03-10", 0)).toISOString(), createdAtMs: dayMs("2026-03-10", 0),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 100, currency: "NOK",
      gameId: "g-mar", playerId: "p-1" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-03-20", 0)).toISOString(), createdAtMs: dayMs("2026-03-20", 0),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 50, currency: "NOK",
      gameId: "g-mar2", playerId: "p-2" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-05", 0)).toISOString(), createdAtMs: dayMs("2026-04-05", 0),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 200, currency: "NOK",
      gameId: "g-apr", playerId: "p-3" },
  ]);
  const ts = ledger.generateTimeSeries({ startDate: "2026-03-01", endDate: "2026-04-30", granularity: "month" });
  assert.equal(ts.granularity, "month");
  assert.equal(ts.points.length, 2);
  assert.equal(ts.points[0].date, "2026-03");
  assert.equal(ts.points[0].stakes, 150);
  assert.equal(ts.points[0].playerCount, 2);
  assert.equal(ts.points[1].date, "2026-04");
  assert.equal(ts.points[1].stakes, 200);
});

test("BIN-587 B3.1: generateTimeSeries rejects invalid granularity", () => {
  const { ledger } = makeLedger();
  assert.throws(
    () => ledger.generateTimeSeries({ startDate: "2026-04-14", endDate: "2026-04-16", granularity: "week" as unknown as "day" }),
    /granularity må være/,
  );
});

test("BIN-587 B3.1: generateTopPlayers sorterer etter totalStakes descending + begrenser til limit", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 10)).toISOString(), createdAtMs: dayMs("2026-04-14", 10),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 50, currency: "NOK",
      gameId: "g-1", playerId: "p-low" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 20)).toISOString(), createdAtMs: dayMs("2026-04-14", 20),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 500, currency: "NOK",
      gameId: "g-1", playerId: "p-high" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 30)).toISOString(), createdAtMs: dayMs("2026-04-14", 30),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 200, currency: "NOK",
      gameId: "g-2", playerId: "p-mid" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 40)).toISOString(), createdAtMs: dayMs("2026-04-14", 40),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "PRIZE", amount: 300, currency: "NOK",
      gameId: "g-1", playerId: "p-high" },
  ]);
  const report = ledger.generateTopPlayers({ startDate: "2026-04-14", endDate: "2026-04-14", limit: 2 });
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0].playerId, "p-high");
  assert.equal(report.rows[0].totalStakes, 500);
  assert.equal(report.rows[0].totalPrizes, 300);
  assert.equal(report.rows[0].net, 200);
  assert.equal(report.rows[1].playerId, "p-mid");
  assert.equal(report.limit, 2);
});

test("BIN-587 B3.1: generateTopPlayers ignorerer entries uten playerId", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 10)).toISOString(), createdAtMs: dayMs("2026-04-14", 10),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 100, currency: "NOK",
      gameId: "g-1" /* no playerId */ },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 20)).toISOString(), createdAtMs: dayMs("2026-04-14", 20),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 50, currency: "NOK",
      gameId: "g-1", playerId: "p-known" },
  ]);
  const report = ledger.generateTopPlayers({ startDate: "2026-04-14", endDate: "2026-04-14" });
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].playerId, "p-known");
});

test("BIN-587 B3.1: generateGameSessions grupperer per gameId + sorterer på lastEventAt desc", () => {
  const { ledger } = makeLedger();
  pushInternalEntries(ledger, [
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 100)).toISOString(), createdAtMs: dayMs("2026-04-14", 100),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 100, currency: "NOK",
      gameId: "g-early", playerId: "p-1" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 200)).toISOString(), createdAtMs: dayMs("2026-04-14", 200),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "PRIZE", amount: 60, currency: "NOK",
      gameId: "g-early" },
    { id: randomUUID(), createdAt: new Date(dayMs("2026-04-14", 500)).toISOString(), createdAtMs: dayMs("2026-04-14", 500),
      hallId: "h", gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 200, currency: "NOK",
      gameId: "g-late", playerId: "p-2" },
  ]);
  const report = ledger.generateGameSessions({ startDate: "2026-04-14", endDate: "2026-04-14" });
  assert.equal(report.rows.length, 2);
  // Sorted by lastEventAt desc
  assert.equal(report.rows[0].gameId, "g-late");
  assert.equal(report.rows[1].gameId, "g-early");
  assert.equal(report.rows[1].totalStakes, 100);
  assert.equal(report.rows[1].totalPrizes, 60);
  assert.equal(report.rows[1].net, 40);
  assert.equal(report.rows[1].playerCount, 1);
});

test("BIN-587 B3.1: generateGameSessions respects limit", () => {
  const { ledger } = makeLedger();
  const entries = Array.from({ length: 5 }, (_, i) => ({
    id: randomUUID(),
    createdAt: new Date(dayMs("2026-04-14", i * 10)).toISOString(),
    createdAtMs: dayMs("2026-04-14", i * 10),
    hallId: "h", gameType: "DATABINGO" as const, channel: "INTERNET" as const,
    eventType: "STAKE" as const, amount: 10, currency: "NOK" as const,
    gameId: `g-${i}`, playerId: `p-${i}`,
  }));
  pushInternalEntries(ledger, entries);
  const report = ledger.generateGameSessions({ startDate: "2026-04-14", endDate: "2026-04-14", limit: 3 });
  assert.equal(report.rows.length, 3);
});

// ── HIGH-6: HOUSE_RETAINED daily-report dual-balance ───────────────────────
//
// Bug: ComplianceLedger.daily_report.totalStakes - totalPrizes viste et
// større tap enn faktisk fordi rest-øre fra split-rounding ikke ble
// compensert som houseRetained-event. Auditor kunne ikke verifisere at
// husets margin matcher §11-beregningen.
//
// Fix: ny LedgerEventType "HOUSE_RETAINED" + houseRetained/houseRetainedCount
// felt i DailyComplianceReportRow + totals. net (= grossTurnover - prizesPaid)
// er bevart byte-identisk; HOUSE_RETAINED er en parallell dimensjon.

test("HIGH-6: generateDailyReport aggregerer HOUSE_RETAINED som egen dimensjon, ikke i prizesPaid", () => {
  // Scenario: 100 kr stake, 99.99 kr utbetalt som PRIZE, 0.01 kr som HOUSE_RETAINED.
  // Forventet: net = 0.01, houseRetained = 0.01 → uavklart_margin = 0.
  const { ledger } = makeLedger();
  const date = "2026-05-01";
  pushInternalEntries(ledger, [
    {
      id: randomUUID(),
      createdAt: new Date(dayMs(date, 1)).toISOString(),
      createdAtMs: dayMs(date, 1),
      hallId: "hall-h6",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 100,
      currency: "NOK",
    },
    {
      id: randomUUID(),
      createdAt: new Date(dayMs(date, 2)).toISOString(),
      createdAtMs: dayMs(date, 2),
      hallId: "hall-h6",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "PRIZE",
      amount: 99.99,
      currency: "NOK",
    },
    {
      id: randomUUID(),
      createdAt: new Date(dayMs(date, 3)).toISOString(),
      createdAtMs: dayMs(date, 3),
      hallId: "hall-h6",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "HOUSE_RETAINED",
      amount: 0.01,
      currency: "NOK",
    },
  ]);

  const report = ledger.generateDailyReport({ date });
  assert.equal(report.rows.length, 1);

  const row = report.rows[0]!;
  assert.equal(row.grossTurnover, 100);
  assert.equal(row.prizesPaid, 99.99, "HOUSE_RETAINED skal IKKE telle som prize");
  assert.equal(
    Math.round(row.net * 100) / 100,
    0.01,
    "net = stake - prize bevart byte-identisk"
  );
  assert.equal(row.houseRetained, 0.01, "HOUSE_RETAINED aggregert som egen dimensjon");
  assert.equal(row.houseRetainedCount, 1);

  // Dual-balance: net - houseRetained = 0 (alt revenue forklart)
  const uavklartMargin = Math.round((row.net - row.houseRetained) * 100) / 100;
  assert.equal(uavklartMargin, 0, "dual-balance: ingen uavklart margin");

  assert.equal(report.totals.houseRetained, 0.01);
  assert.equal(report.totals.houseRetainedCount, 1);
});

test("HIGH-6: generateDailyReport — multiple HOUSE_RETAINED events i samme bucket akkumuleres", () => {
  // 3 fase-payouts i samme runde, hver med sin lille rest. Auditor må se
  // total rest aggregert per (hall, gameType, channel)-bucket.
  const { ledger } = makeLedger();
  const date = "2026-05-02";
  pushInternalEntries(ledger, [
    {
      id: randomUUID(), createdAt: new Date(dayMs(date, 1)).toISOString(),
      createdAtMs: dayMs(date, 1), hallId: "hall-x", gameType: "MAIN_GAME",
      channel: "INTERNET", eventType: "HOUSE_RETAINED", amount: 0.01, currency: "NOK",
    },
    {
      id: randomUUID(), createdAt: new Date(dayMs(date, 2)).toISOString(),
      createdAtMs: dayMs(date, 2), hallId: "hall-x", gameType: "MAIN_GAME",
      channel: "INTERNET", eventType: "HOUSE_RETAINED", amount: 0.04, currency: "NOK",
    },
    {
      id: randomUUID(), createdAt: new Date(dayMs(date, 3)).toISOString(),
      createdAtMs: dayMs(date, 3), hallId: "hall-x", gameType: "MAIN_GAME",
      channel: "INTERNET", eventType: "HOUSE_RETAINED", amount: 0.02, currency: "NOK",
    },
  ]);

  const report = ledger.generateDailyReport({ date });
  const row = report.rows.find((r) => r.hallId === "hall-x");
  assert.ok(row);
  // Floating-point safety: rund til 2 desimaler.
  assert.equal(Math.round(row!.houseRetained * 100) / 100, 0.07);
  assert.equal(row!.houseRetainedCount, 3);
});

test("HIGH-6: backwards-compat — gammel rapport uten HOUSE_RETAINED-events gir houseRetained=0", () => {
  // Verifiser at gamle rapporter (ingen HOUSE_RETAINED-entries på dagen)
  // får houseRetained=0 og houseRetainedCount=0 (ikke undefined).
  const { ledger } = makeLedger();
  const date = "2026-05-03";
  pushInternalEntries(ledger, [
    {
      id: randomUUID(), createdAt: new Date(dayMs(date, 1)).toISOString(),
      createdAtMs: dayMs(date, 1), hallId: "hall-old", gameType: "MAIN_GAME",
      channel: "INTERNET", eventType: "STAKE", amount: 50, currency: "NOK",
    },
    {
      id: randomUUID(), createdAt: new Date(dayMs(date, 2)).toISOString(),
      createdAtMs: dayMs(date, 2), hallId: "hall-old", gameType: "MAIN_GAME",
      channel: "INTERNET", eventType: "PRIZE", amount: 30, currency: "NOK",
    },
  ]);

  const report = ledger.generateDailyReport({ date });
  const row = report.rows[0]!;
  assert.equal(row.houseRetained, 0);
  assert.equal(row.houseRetainedCount, 0);
  assert.equal(report.totals.houseRetained, 0);
  assert.equal(report.totals.houseRetainedCount, 0);
});
