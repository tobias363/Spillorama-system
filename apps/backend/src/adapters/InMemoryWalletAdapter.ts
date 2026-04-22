import { randomUUID } from "node:crypto";
import type {
  CreateWalletAccountInput,
  CreditOptions,
  TransactionOptions,
  WalletAccount,
  WalletAccountSide,
  WalletAdapter,
  WalletBalance,
  WalletTransaction,
  WalletTransactionType,
  WalletTransactionSplit,
  WalletTransferResult
} from "./WalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

interface InternalAccount {
  id: string;
  depositBalance: number;
  winningsBalance: number;
  createdAt: string;
  updatedAt: string;
}

export class InMemoryWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, InternalAccount>();

  private readonly ledger: WalletTransaction[] = [];

  constructor(private readonly defaultInitialBalance = 1000) {}

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `wallet-${randomUUID()}`;
    const existing = this.accounts.get(accountId);
    if (existing) {
      if (input?.allowExisting) {
        return this.toPublic(existing);
      }
      throw new WalletError("ACCOUNT_EXISTS", `Wallet ${accountId} finnes allerede.`);
    }
    const initialBalance = input?.initialBalance ?? this.defaultInitialBalance;
    this.assertNonNegativeAmount(initialBalance);

    const now = new Date().toISOString();
    // PR-W1: initial funding lander alltid på deposit (PM-beslutning: topup → deposit).
    const account: InternalAccount = {
      id: accountId,
      depositBalance: initialBalance,
      winningsBalance: 0,
      createdAt: now,
      updatedAt: now
    };
    this.accounts.set(accountId, account);

    if (initialBalance > 0) {
      this.recordTx(accountId, "TOPUP", initialBalance, "Initial wallet funding", undefined, undefined, {
        fromDeposit: initialBalance,
        fromWinnings: 0
      });
    }
    return this.toPublic(account);
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const trimmed = this.assertAccountId(accountId);
    const existing = this.accounts.get(trimmed);
    if (existing) {
      return this.toPublic(existing);
    }
    return this.createAccount({ accountId: trimmed, allowExisting: true });
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    const account = await this.ensureAccountInternal(accountId);
    return this.toPublic(account);
  }

  async listAccounts(): Promise<WalletAccount[]> {
    return [...this.accounts.values()]
      .map((account) => this.toPublic(account))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getBalance(accountId: string): Promise<number> {
    const account = await this.ensureAccountInternal(accountId);
    return account.depositBalance + account.winningsBalance;
  }

  async getDepositBalance(accountId: string): Promise<number> {
    const account = await this.ensureAccountInternal(accountId);
    return account.depositBalance;
  }

  async getWinningsBalance(accountId: string): Promise<number> {
    const account = await this.ensureAccountInternal(accountId);
    return account.winningsBalance;
  }

  async getBothBalances(accountId: string): Promise<WalletBalance> {
    const account = await this.ensureAccountInternal(accountId);
    return {
      deposit: account.depositBalance,
      winnings: account.winningsBalance,
      total: account.depositBalance + account.winningsBalance
    };
  }

  async debit(accountId: string, amount: number, reason: string, options?: TransactionOptions): Promise<WalletTransaction> {
    const existing = this.findByIdempotencyKey(options?.idempotencyKey);
    if (existing) return existing;

    this.assertPositiveAmount(amount);
    const account = await this.ensureAccountInternal(accountId);
    const total = account.depositBalance + account.winningsBalance;
    if (total < amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${account.id} mangler saldo.`);
    }

    // PR-W1: winnings-first-policy (aktiveres fullt i PR-W2, men logikken er
    // additiv allerede nå slik at callers får riktig `split` tilbake).
    const split = this.splitDebit(account, amount);
    account.depositBalance -= split.fromDeposit;
    account.winningsBalance -= split.fromWinnings;
    account.updatedAt = new Date().toISOString();
    this.accounts.set(account.id, account);
    return this.recordTx(account.id, "DEBIT", amount, reason || "Debit", undefined, options?.idempotencyKey, split);
  }

  async credit(accountId: string, amount: number, reason: string, options?: CreditOptions): Promise<WalletTransaction> {
    const existing = this.findByIdempotencyKey(options?.idempotencyKey);
    if (existing) return existing;

    this.assertPositiveAmount(amount);
    const target: WalletAccountSide = options?.to ?? "deposit";
    const account = await this.ensureAccountInternal(accountId);

    const split: WalletTransactionSplit =
      target === "winnings"
        ? { fromWinnings: amount, fromDeposit: 0 }
        : { fromWinnings: 0, fromDeposit: amount };

    if (target === "winnings") {
      account.winningsBalance += amount;
    } else {
      account.depositBalance += amount;
    }
    account.updatedAt = new Date().toISOString();
    this.accounts.set(account.id, account);
    return this.recordTx(account.id, "CREDIT", amount, reason || "Credit", undefined, options?.idempotencyKey, split);
  }

  async topUp(accountId: string, amount: number, reason = "Manual top-up", options?: TransactionOptions): Promise<WalletTransaction> {
    const existing = this.findByIdempotencyKey(options?.idempotencyKey);
    if (existing) return existing;

    this.assertPositiveAmount(amount);
    // PM-beslutning: topup → ALLTID deposit. Ikke overstyrbar.
    const account = await this.ensureAccountInternal(accountId);
    account.depositBalance += amount;
    account.updatedAt = new Date().toISOString();
    this.accounts.set(account.id, account);
    return this.recordTx(account.id, "TOPUP", amount, reason, undefined, options?.idempotencyKey, {
      fromDeposit: amount,
      fromWinnings: 0
    });
  }

  async withdraw(accountId: string, amount: number, reason = "Manual withdrawal", options?: TransactionOptions): Promise<WalletTransaction> {
    const existing = this.findByIdempotencyKey(options?.idempotencyKey);
    if (existing) return existing;

    this.assertPositiveAmount(amount);
    const account = await this.ensureAccountInternal(accountId);
    const total = account.depositBalance + account.winningsBalance;
    if (total < amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${account.id} mangler saldo.`);
    }
    // PM-beslutning: withdrawal → winnings-first, så deposit.
    const split = this.splitDebit(account, amount);
    account.depositBalance -= split.fromDeposit;
    account.winningsBalance -= split.fromWinnings;
    account.updatedAt = new Date().toISOString();
    this.accounts.set(account.id, account);
    return this.recordTx(account.id, "WITHDRAWAL", amount, reason, undefined, options?.idempotencyKey, split);
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Wallet transfer",
    _options?: TransactionOptions
  ): Promise<WalletTransferResult> {
    const fromId = this.assertAccountId(fromAccountId);
    const toId = this.assertAccountId(toAccountId);
    if (fromId === toId) {
      throw new WalletError("INVALID_TRANSFER", "Kan ikke overføre til samme wallet.");
    }
    this.assertPositiveAmount(amount);

    const from = await this.ensureAccountInternal(fromId);
    const to = await this.ensureAccountInternal(toId);
    const fromTotal = from.depositBalance + from.winningsBalance;
    if (fromTotal < amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${from.id} mangler saldo.`);
    }

    // PR-W1: transfer følger samme winnings-first-policy som debit på avsender-
    // side, og krediterer deposit-siden på mottaker-side. Dette matcher den
    // konservative default — callers som trenger winnings-payout skal bruke
    // `credit(..., { to: "winnings" })` (game-engine) i stedet for transfer.
    const fromSplit = this.splitDebit(from, amount);
    from.depositBalance -= fromSplit.fromDeposit;
    from.winningsBalance -= fromSplit.fromWinnings;
    from.updatedAt = new Date().toISOString();

    const toSplit: WalletTransactionSplit = { fromDeposit: amount, fromWinnings: 0 };
    to.depositBalance += amount;
    to.updatedAt = new Date().toISOString();

    this.accounts.set(from.id, from);
    this.accounts.set(to.id, to);

    const fromTx = this.recordTx(from.id, "TRANSFER_OUT", amount, reason, to.id, undefined, fromSplit);
    const toTx = this.recordTx(to.id, "TRANSFER_IN", amount, reason, from.id, undefined, toSplit);
    return { fromTx, toTx };
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    const normalized = this.assertAccountId(accountId);
    await this.ensureAccountInternal(normalized);
    return this.ledger
      .filter((tx) => tx.accountId === normalized)
      .slice(-limit)
      .reverse()
      .map((tx) => ({ ...tx }));
  }

  /** BIN-162: Look up an existing transaction by idempotency key. */
  private findByIdempotencyKey(key?: string): WalletTransaction | undefined {
    if (!key) return undefined;
    return this.ledger.find((tx) => (tx as any)._idempotencyKey === key);
  }

  private splitDebit(account: InternalAccount, amount: number): WalletTransactionSplit {
    const fromWinnings = Math.min(account.winningsBalance, amount);
    const fromDeposit = amount - fromWinnings;
    return { fromWinnings, fromDeposit };
  }

  private recordTx(
    accountId: string,
    type: WalletTransactionType,
    amount: number,
    reason: string,
    relatedAccountId?: string,
    idempotencyKey?: string,
    split?: WalletTransactionSplit
  ): WalletTransaction {
    const tx: WalletTransaction = {
      id: randomUUID(),
      accountId,
      type,
      amount,
      reason,
      createdAt: new Date().toISOString(),
      relatedAccountId,
      split
    };
    if (idempotencyKey) {
      (tx as any)._idempotencyKey = idempotencyKey;
    }
    this.ledger.push(tx);
    return { ...tx };
  }

  private async ensureAccountInternal(accountId: string): Promise<InternalAccount> {
    const trimmed = this.assertAccountId(accountId);
    const existing = this.accounts.get(trimmed);
    if (existing) {
      return existing;
    }
    await this.createAccount({ accountId: trimmed, allowExisting: true });
    const created = this.accounts.get(trimmed);
    if (!created) {
      throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${trimmed} finnes ikke.`);
    }
    return created;
  }

  private toPublic(account: InternalAccount): WalletAccount {
    return {
      id: account.id,
      balance: account.depositBalance + account.winningsBalance,
      depositBalance: account.depositBalance,
      winningsBalance: account.winningsBalance,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    };
  }

  private assertAccountId(accountId: string): string {
    const normalized = accountId.trim();
    if (!normalized) {
      throw new WalletError("INVALID_ACCOUNT_ID", "walletId kan ikke være tom.");
    }
    return normalized;
  }

  private assertPositiveAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new WalletError("INVALID_AMOUNT", "Beløp må være større enn 0.");
    }
  }

  private assertNonNegativeAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new WalletError("INVALID_AMOUNT", "Beløp må være 0 eller større.");
    }
  }
}
