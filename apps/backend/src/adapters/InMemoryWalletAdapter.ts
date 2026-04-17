import { randomUUID } from "node:crypto";
import type {
  CreateWalletAccountInput,
  TransactionOptions,
  WalletAccount,
  WalletAdapter,
  WalletTransaction,
  WalletTransactionType,
  WalletTransferResult
} from "./WalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

export class InMemoryWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();

  private readonly ledger: WalletTransaction[] = [];

  constructor(private readonly defaultInitialBalance = 1000) {}

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `wallet-${randomUUID()}`;
    const existing = this.accounts.get(accountId);
    if (existing) {
      if (input?.allowExisting) {
        return existing;
      }
      throw new WalletError("ACCOUNT_EXISTS", `Wallet ${accountId} finnes allerede.`);
    }
    const initialBalance = input?.initialBalance ?? this.defaultInitialBalance;
    this.assertNonNegativeAmount(initialBalance);

    const now = new Date().toISOString();
    const account: WalletAccount = {
      id: accountId,
      balance: initialBalance,
      createdAt: now,
      updatedAt: now
    };
    this.accounts.set(accountId, account);

    if (initialBalance > 0) {
      this.recordTx(accountId, "TOPUP", initialBalance, "Initial wallet funding");
    }
    return account;
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const trimmed = this.assertAccountId(accountId);
    const existing = this.accounts.get(trimmed);
    if (existing) {
      return existing;
    }
    return this.createAccount({ accountId: trimmed, allowExisting: true });
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    const account = await this.ensureAccount(accountId);
    return { ...account };
  }

  async listAccounts(): Promise<WalletAccount[]> {
    return [...this.accounts.values()]
      .map((account) => ({ ...account }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getBalance(accountId: string): Promise<number> {
    const account = await this.ensureAccount(accountId);
    return account.balance;
  }

  async debit(accountId: string, amount: number, reason: string, options?: TransactionOptions): Promise<WalletTransaction> {
    const existing = this.findByIdempotencyKey(options?.idempotencyKey);
    if (existing) return existing;

    this.assertPositiveAmount(amount);
    const account = await this.ensureAccount(accountId);
    if (account.balance < amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${account.id} mangler saldo.`);
    }

    account.balance -= amount;
    account.updatedAt = new Date().toISOString();
    this.accounts.set(account.id, account);
    return this.recordTx(account.id, "DEBIT", amount, reason || "Debit", undefined, options?.idempotencyKey);
  }

  async credit(accountId: string, amount: number, reason: string, options?: TransactionOptions): Promise<WalletTransaction> {
    const existing = this.findByIdempotencyKey(options?.idempotencyKey);
    if (existing) return existing;

    this.assertPositiveAmount(amount);
    const account = await this.ensureAccount(accountId);
    account.balance += amount;
    account.updatedAt = new Date().toISOString();
    this.accounts.set(account.id, account);
    return this.recordTx(account.id, "CREDIT", amount, reason || "Credit", undefined, options?.idempotencyKey);
  }

  async topUp(accountId: string, amount: number, reason = "Manual top-up", options?: TransactionOptions): Promise<WalletTransaction> {
    const existing = this.findByIdempotencyKey(options?.idempotencyKey);
    if (existing) return existing;

    this.assertPositiveAmount(amount);
    const account = await this.ensureAccount(accountId);
    account.balance += amount;
    account.updatedAt = new Date().toISOString();
    this.accounts.set(account.id, account);
    return this.recordTx(account.id, "TOPUP", amount, reason, undefined, options?.idempotencyKey);
  }

  async withdraw(accountId: string, amount: number, reason = "Manual withdrawal", options?: TransactionOptions): Promise<WalletTransaction> {
    const existing = this.findByIdempotencyKey(options?.idempotencyKey);
    if (existing) return existing;

    this.assertPositiveAmount(amount);
    const account = await this.ensureAccount(accountId);
    if (account.balance < amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${account.id} mangler saldo.`);
    }
    account.balance -= amount;
    account.updatedAt = new Date().toISOString();
    this.accounts.set(account.id, account);
    return this.recordTx(account.id, "WITHDRAWAL", amount, reason, undefined, options?.idempotencyKey);
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Wallet transfer",
    options?: TransactionOptions
  ): Promise<WalletTransferResult> {
    const fromId = this.assertAccountId(fromAccountId);
    const toId = this.assertAccountId(toAccountId);
    if (fromId === toId) {
      throw new WalletError("INVALID_TRANSFER", "Kan ikke overføre til samme wallet.");
    }
    this.assertPositiveAmount(amount);

    const from = await this.ensureAccount(fromId);
    const to = await this.ensureAccount(toId);
    if (from.balance < amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${from.id} mangler saldo.`);
    }

    from.balance -= amount;
    from.updatedAt = new Date().toISOString();
    to.balance += amount;
    to.updatedAt = new Date().toISOString();
    this.accounts.set(from.id, from);
    this.accounts.set(to.id, to);

    const fromTx = this.recordTx(from.id, "TRANSFER_OUT", amount, reason, to.id);
    const toTx = this.recordTx(to.id, "TRANSFER_IN", amount, reason, from.id);
    return { fromTx, toTx };
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    const normalized = this.assertAccountId(accountId);
    await this.ensureAccount(normalized);
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

  private recordTx(
    accountId: string,
    type: WalletTransactionType,
    amount: number,
    reason: string,
    relatedAccountId?: string,
    idempotencyKey?: string
  ): WalletTransaction {
    const tx: WalletTransaction = {
      id: randomUUID(),
      accountId,
      type,
      amount,
      reason,
      createdAt: new Date().toISOString(),
      relatedAccountId
    };
    if (idempotencyKey) {
      (tx as any)._idempotencyKey = idempotencyKey;
    }
    this.ledger.push(tx);
    return { ...tx };
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

