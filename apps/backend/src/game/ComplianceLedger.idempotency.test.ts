// PILOT-STOP-SHIP 2026-04-28 — ComplianceLedger idempotency-key fix
//
// Verifiserer at ComplianceLedger.recordComplianceLedgerEvent skriver en
// deterministisk idempotency-key til persistens-laget, sa retry av samme
// logiske event ikke dobbel-skriver §71-rapport-rader.
//
// Migration `20260428080000_compliance_ledger_idempotency.sql` legger til
// UNIQUE-index pa `idempotency_key` + `INSERT ... ON CONFLICT (idempotency_key)
// DO NOTHING` i `PostgresResponsibleGamingStore.insertComplianceLedgerEntry`
// gir den faktiske retry-safe-oppforselen i prod. Denne testen bruker en
// in-memory fake-persistence som speiler UNIQUE-constraint-oppforselen.
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
import {
  ComplianceLedger,
  makeComplianceLedgerIdempotencyKey,
  stableEntryDiscriminatorHash
} from "./ComplianceLedger.js";
import type { ComplianceLedgerEntry } from "./ComplianceLedger.js";
import type {
  PersistedComplianceLedgerEntry,
  PersistedDailyReport,
  PersistedExtraPrizeEntry,
  PersistedHallOrganizationAllocation,
  PersistedLossEntry,
  PersistedLossLimit,
  PersistedOverskuddBatch,
  PersistedPayoutAuditEvent,
  PersistedPendingLossLimitChange,
  PersistedPlaySessionState,
  PersistedPrizePolicy,
  PersistedRestrictionState,
  ResponsibleGamingPersistenceAdapter,
  ResponsibleGamingPersistenceSnapshot
} from "./ResponsibleGamingPersistence.js";

// ── Minimal InMemoryWalletAdapter (mirror av ComplianceLedger.test.ts) ───
//
// Dupliseres her med vilje sa testen er stand-alone — den eneste callen
// recordComplianceLedgerEvent gjor mot wallet er ingen, sa minimal-stub
// ville ogsa fungert, men vi matcher den eksisterende test-fila for a
// gjore det enkelt for fremtidige refaktorer.

class InMemoryWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  private txCounter = 0;

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
    const normalizedAmount = Math.abs(amount);
    const fromTx = await this.adjustBalance(fromAccountId, -normalizedAmount, "TRANSFER_OUT", reason, toAccountId);
    const toTx = await this.adjustBalance(toAccountId, normalizedAmount, "TRANSFER_IN", reason, fromAccountId);
    return { fromTx, toTx };
  }

  async listTransactions(_accountId: string, limit = 100): Promise<WalletTransaction[]> {
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

// ── Fake-persistence som speiler UNIQUE(idempotency_key)-oppforselen ─────
//
// `app_rg_compliance_ledger.idempotency_key` har UNIQUE-index +
// `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` i
// `PostgresResponsibleGamingStore.insertComplianceLedgerEntry`. Denne
// fake-en herm-er den oppforselen sa vi kan teste retry-safe semantikk
// uten en faktisk Postgres.

class FakeIdempotentPersistence implements ResponsibleGamingPersistenceAdapter {
  public readonly inserts: PersistedComplianceLedgerEntry[] = [];
  /** Antall ganger en duplicate-key-conflict ble oversett (DO NOTHING). */
  public skippedDuplicates = 0;
  private readonly seenKeys = new Set<string>();

  async ensureInitialized(): Promise<void> {}
  async loadSnapshot(): Promise<ResponsibleGamingPersistenceSnapshot> {
    return {
      personalLossLimits: [],
      pendingLossLimitChanges: [],
      restrictions: [],
      playStates: [],
      lossEntries: [],
      prizePolicies: [],
      extraPrizeEntries: [],
      payoutAuditTrail: [],
      complianceLedger: [],
      dailyReports: []
    };
  }
  async upsertLossLimit(_entry: PersistedLossLimit): Promise<void> {}
  async upsertPendingLossLimitChange(_entry: PersistedPendingLossLimitChange): Promise<void> {}
  async deletePendingLossLimitChange(_walletId: string, _hallId: string): Promise<void> {}
  async upsertRestriction(_entry: PersistedRestrictionState): Promise<void> {}
  async deleteRestriction(_walletId: string): Promise<void> {}
  async upsertPlaySessionState(_entry: PersistedPlaySessionState): Promise<void> {}
  async deletePlaySessionState(_walletId: string): Promise<void> {}
  async insertLossEntry(_entry: PersistedLossEntry): Promise<void> {}
  async upsertPrizePolicy(_policy: PersistedPrizePolicy): Promise<void> {}
  async insertExtraPrizeEntry(_entry: PersistedExtraPrizeEntry): Promise<void> {}
  async insertPayoutAuditEvent(_event: PersistedPayoutAuditEvent): Promise<void> {}

  async insertComplianceLedgerEntry(entry: PersistedComplianceLedgerEntry): Promise<void> {
    const key = entry.idempotencyKey ?? entry.id;
    if (this.seenKeys.has(key)) {
      // Speiler `ON CONFLICT (idempotency_key) DO NOTHING` — silent skip.
      this.skippedDuplicates += 1;
      return;
    }
    this.seenKeys.add(key);
    this.inserts.push({ ...entry });
  }

  async upsertDailyReport(_report: PersistedDailyReport): Promise<void> {}
  async insertOverskuddBatch(_batch: PersistedOverskuddBatch): Promise<void> {}
  async getOverskuddBatch(_batchId: string): Promise<PersistedOverskuddBatch | null> { return null; }
  async listOverskuddBatches(_input: { hallId?: string; gameType?: string; channel?: string; dateFrom?: string; dateTo?: string; limit?: number }): Promise<PersistedOverskuddBatch[]> { return []; }
  async upsertHallOrganizationAllocation(_alloc: PersistedHallOrganizationAllocation): Promise<void> {}
  async listHallOrganizationAllocations(_hallId?: string): Promise<PersistedHallOrganizationAllocation[]> { return []; }
  async deleteHallOrganizationAllocation(_id: string): Promise<void> {}
  async shutdown(): Promise<void> {}
}

function makeLedgerWithFakePersistence(): {
  ledger: ComplianceLedger;
  persistence: FakeIdempotentPersistence;
} {
  const wallet = new InMemoryWalletAdapter();
  const persistence = new FakeIdempotentPersistence();
  const ledger = new ComplianceLedger({ walletAdapter: wallet, persistence });
  return { ledger, persistence };
}

// ── Tests ────────────────────────────────────────────────────────────────

test("PILOT-STOP-SHIP: makeComplianceLedgerIdempotencyKey følger spec-format", () => {
  const key = makeComplianceLedgerIdempotencyKey({
    eventType: "STAKE",
    gameId: "g-1",
    claimId: "c-1",
    playerId: "p-1",
    eventSubKey: "purchase-42"
  });
  // Format: `${eventType}:${gameId}:${claimId ?? playerId}:${eventSubKey}`
  // claimId vinner over playerId nar begge er satt.
  assert.equal(key, "STAKE:g-1:c-1:purchase-42");
});

test("PILOT-STOP-SHIP: makeComplianceLedgerIdempotencyKey defaulter manglende felter", () => {
  const key = makeComplianceLedgerIdempotencyKey({
    eventType: "PRIZE",
    eventSubKey: "phase-2"
  });
  assert.equal(key, "PRIZE:no-game:no-actor:phase-2");
});

test("PILOT-STOP-SHIP: makeComplianceLedgerIdempotencyKey faller tilbake til playerId nar claimId mangler", () => {
  const key = makeComplianceLedgerIdempotencyKey({
    eventType: "STAKE",
    gameId: "g-1",
    playerId: "p-tobias",
    eventSubKey: "purchase-7"
  });
  assert.equal(key, "STAKE:g-1:p-tobias:purchase-7");
});

test("PILOT-STOP-SHIP: stableEntryDiscriminatorHash er stabil for samme entry", () => {
  const baseEntry: ComplianceLedgerEntry = {
    id: "irrelevant-1",
    createdAt: "2026-04-28T08:00:00.000Z",
    createdAtMs: 1745827200000,
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType: "STAKE",
    amount: 100,
    currency: "NOK",
    metadata: { purchaseId: "p-1" }
  };
  const otherEntry: ComplianceLedgerEntry = {
    ...baseEntry,
    id: "irrelevant-2",
    createdAt: "2026-04-28T08:00:01.000Z",
    createdAtMs: 1745827201000
  };
  // Random id og timestamp pavirker IKKE hashen.
  assert.equal(
    stableEntryDiscriminatorHash(baseEntry),
    stableEntryDiscriminatorHash(otherEntry)
  );
});

test("PILOT-STOP-SHIP: stableEntryDiscriminatorHash skiller distinkte events", () => {
  const a: ComplianceLedgerEntry = {
    id: "a", createdAt: "x", createdAtMs: 0,
    hallId: "hall-1", gameType: "MAIN_GAME", channel: "INTERNET",
    eventType: "STAKE", amount: 100, currency: "NOK"
  };
  const bDifferentAmount: ComplianceLedgerEntry = { ...a, amount: 200 };
  const cDifferentMetadata: ComplianceLedgerEntry = { ...a, metadata: { purchaseId: "p-2" } };
  assert.notEqual(stableEntryDiscriminatorHash(a), stableEntryDiscriminatorHash(bDifferentAmount));
  assert.notEqual(stableEntryDiscriminatorHash(a), stableEntryDiscriminatorHash(cDifferentMetadata));
});

test("PILOT-STOP-SHIP: skrive samme STAKE-event 2x med samme eventSubKey gir kun 1 rad i DB", async () => {
  const { ledger, persistence } = makeLedgerWithFakePersistence();

  // Forste call — caller spesifiserer eventSubKey for stabil identitet.
  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType: "STAKE",
    amount: 100,
    gameId: "scheduled-1",
    playerId: "player-1",
    walletId: "wallet-1",
    metadata: { purchaseId: "purchase-1", reason: "GAME1_PURCHASE" },
    eventSubKey: "purchase-1"
  });

  // Andre call — soft-fail-retry pa samme logiske event (samme subKey).
  // Genererer ny random id, men idempotency-key er identisk.
  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType: "STAKE",
    amount: 100,
    gameId: "scheduled-1",
    playerId: "player-1",
    walletId: "wallet-1",
    metadata: { purchaseId: "purchase-1", reason: "GAME1_PURCHASE" },
    eventSubKey: "purchase-1"
  });

  assert.equal(persistence.inserts.length, 1, "Kun 1 rad i DB etter retry");
  assert.equal(persistence.skippedDuplicates, 1, "ON CONFLICT DO NOTHING ble truffet 1 gang");
  // In-memory ledger har imidlertid 2 entries — det er forventet. Det er
  // bare DB-laget som gjor idempotens. In-memory-listen er kun for live-
  // rapportering og dropper uansett gamle entries etter 50k-cap.
  assert.equal(ledger.listComplianceLedgerEntries().length, 2);
});

test("PILOT-STOP-SHIP: distinkte STAKE-events for samme spiller far distinkte keys (ingen falsk DO NOTHING)", async () => {
  const { ledger, persistence } = makeLedgerWithFakePersistence();

  // Kjop 1 — purchaseId p1
  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType: "STAKE",
    amount: 100,
    gameId: "scheduled-1",
    playerId: "player-1",
    walletId: "wallet-1",
    metadata: { purchaseId: "p1", reason: "GAME1_PURCHASE" },
    eventSubKey: "p1"
  });

  // Kjop 2 — samme spiller, samme game, men ANNEN purchaseId. Dette ER
  // distinkt logisk event og MA ikke svelges av UNIQUE-constraint.
  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType: "STAKE",
    amount: 50,
    gameId: "scheduled-1",
    playerId: "player-1",
    walletId: "wallet-1",
    metadata: { purchaseId: "p2", reason: "GAME1_PURCHASE" },
    eventSubKey: "p2"
  });

  assert.equal(persistence.inserts.length, 2, "Distinkte purchaseId-er skal gi 2 rader");
  assert.equal(persistence.skippedDuplicates, 0);
});

test("PILOT-STOP-SHIP: retry uten eksplisitt eventSubKey faller tilbake til stabil hash av input-feltene", async () => {
  const { ledger, persistence } = makeLedgerWithFakePersistence();

  // Caller setter ikke eventSubKey, men metadata er identisk pa retry.
  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "HOUSE_RETAINED",
    amount: 0.05,
    gameId: "scheduled-1",
    roomCode: "ABCDEF",
    metadata: { reason: "GAME1_SPLIT_ROUNDING_REST", phase: 3, winnerCount: 7 }
  });

  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "HOUSE_RETAINED",
    amount: 0.05,
    gameId: "scheduled-1",
    roomCode: "ABCDEF",
    metadata: { reason: "GAME1_SPLIT_ROUNDING_REST", phase: 3, winnerCount: 7 }
  });

  assert.equal(persistence.inserts.length, 1, "Identisk metadata gir samme fallback-hash → kun 1 rad");
  assert.equal(persistence.skippedDuplicates, 1);
});

test("PILOT-STOP-SHIP: distinkte HOUSE_RETAINED-events (forskjellig phase) gir distinkte keys uten eventSubKey", async () => {
  const { ledger, persistence } = makeLedgerWithFakePersistence();

  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "HOUSE_RETAINED",
    amount: 0.05,
    gameId: "scheduled-1",
    metadata: { reason: "GAME1_SPLIT_ROUNDING_REST", phase: 1 }
  });

  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "HOUSE_RETAINED",
    amount: 0.05,
    gameId: "scheduled-1",
    metadata: { reason: "GAME1_SPLIT_ROUNDING_REST", phase: 2 }
  });

  // Forskjellig phase → forskjellig metadata → forskjellig fallback-hash
  // → forskjellig idempotency-key → 2 rader.
  assert.equal(persistence.inserts.length, 2);
  assert.equal(persistence.skippedDuplicates, 0);
});

test("PILOT-STOP-SHIP: persisted entry inneholder idempotencyKey-feltet", async () => {
  const { ledger, persistence } = makeLedgerWithFakePersistence();
  await ledger.recordComplianceLedgerEvent({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType: "PRIZE",
    amount: 200,
    gameId: "scheduled-1",
    claimId: "phase-winner-99",
    playerId: "player-1",
    walletId: "wallet-1"
  });
  assert.equal(persistence.inserts.length, 1);
  // claimId-fallback (claim vinner over player) + tom subKey + fallback-hash
  // gjor at key ikke blir bare "PRIZE:scheduled-1:phase-winner-99:".
  const stored = persistence.inserts[0]!;
  assert.ok(stored.idempotencyKey, "Persistert entry har idempotencyKey satt");
  assert.match(
    stored.idempotencyKey!,
    /^PRIZE:scheduled-1:phase-winner-99:/,
    "Key starter med spec-format prefix"
  );
});
