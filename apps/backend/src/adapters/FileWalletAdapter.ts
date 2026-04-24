import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CommitReservationOptions,
  CreateWalletAccountInput,
  CreditOptions,
  ReserveOptions,
  TransactionOptions,
  TransferOptions,
  WalletAccount,
  WalletAccountSide,
  WalletAdapter,
  WalletBalance,
  WalletReservation,
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
  /**
   * PR-W1: bakoverkompat for disk-format. Eldre `wallets.json` har bare
   * `balance` — vi migrerer `balance → depositBalance` ved load.
   */
  balance?: number;
}

interface WalletStore {
  accounts: Record<string, InternalAccount>;
  transactions: WalletTransaction[];
}

interface FileWalletAdapterOptions {
  dataFilePath: string;
  defaultInitialBalance?: number;
}

export class FileWalletAdapter implements WalletAdapter {
  private readonly dataFilePath: string;

  private readonly defaultInitialBalance: number;

  private loaded = false;

  private store: WalletStore = {
    accounts: {},
    transactions: []
  };

  private mutex: Promise<void> = Promise.resolve();

  constructor(options: FileWalletAdapterOptions) {
    this.dataFilePath = options.dataFilePath;
    this.defaultInitialBalance = options.defaultInitialBalance ?? 1000;
  }

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    return this.withLock(async () => {
      await this.load();
      const accountId = input?.accountId?.trim() || `wallet-${randomUUID()}`;
      if (!accountId) {
        throw new WalletError("INVALID_ACCOUNT_ID", "walletId kan ikke være tom.");
      }

      const existing = this.store.accounts[accountId];
      if (existing) {
        if (input?.allowExisting) {
          return this.toPublic(existing);
        }
        throw new WalletError("ACCOUNT_EXISTS", `Wallet ${accountId} finnes allerede.`);
      }

      const initialBalance = input?.initialBalance ?? this.defaultInitialBalance;
      this.assertNonNegativeAmount(initialBalance);

      const now = new Date().toISOString();
      const account: InternalAccount = {
        id: accountId,
        depositBalance: initialBalance,
        winningsBalance: 0,
        createdAt: now,
        updatedAt: now
      };
      this.store.accounts[accountId] = account;

      if (initialBalance > 0) {
        this.recordTx(accountId, "TOPUP", initialBalance, "Initial wallet funding", undefined, {
          fromDeposit: initialBalance,
          fromWinnings: 0
        });
      }
      await this.persist();
      return this.toPublic(account);
    });
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const accountIdTrimmed = accountId.trim();
    if (!accountIdTrimmed) {
      throw new WalletError("INVALID_ACCOUNT_ID", "walletId kan ikke være tom.");
    }
    return this.withLock(async () => {
      await this.load();
      const existing = this.store.accounts[accountIdTrimmed];
      if (existing) {
        return this.toPublic(existing);
      }
      const now = new Date().toISOString();
      const account: InternalAccount = {
        id: accountIdTrimmed,
        depositBalance: this.defaultInitialBalance,
        winningsBalance: 0,
        createdAt: now,
        updatedAt: now
      };
      this.store.accounts[accountIdTrimmed] = account;
      if (this.defaultInitialBalance > 0) {
        this.recordTx(accountIdTrimmed, "TOPUP", this.defaultInitialBalance, "Initial wallet funding", undefined, {
          fromDeposit: this.defaultInitialBalance,
          fromWinnings: 0
        });
      }
      await this.persist();
      return this.toPublic(account);
    });
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    return this.withLock(async () => {
      await this.load();
      const normalized = this.assertAccountId(accountId);
      const account = this.store.accounts[normalized];
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }
      return this.toPublic(account);
    });
  }

  async listAccounts(): Promise<WalletAccount[]> {
    return this.withLock(async () => {
      await this.load();
      return Object.values(this.store.accounts)
        .map((account) => this.toPublic(account))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }

  async getBalance(accountId: string): Promise<number> {
    const account = await this.ensureAccount(accountId);
    return account.balance;
  }

  async getDepositBalance(accountId: string): Promise<number> {
    const account = await this.ensureAccount(accountId);
    return account.depositBalance;
  }

  async getWinningsBalance(accountId: string): Promise<number> {
    const account = await this.ensureAccount(accountId);
    return account.winningsBalance;
  }

  async getBothBalances(accountId: string): Promise<WalletBalance> {
    const account = await this.ensureAccount(accountId);
    return {
      deposit: account.depositBalance,
      winnings: account.winningsBalance,
      total: account.balance
    };
  }

  async debit(accountId: string, amount: number, reason: string, _options?: TransactionOptions): Promise<WalletTransaction> {
    return this.withLock(async () => {
      await this.load();
      const normalized = this.assertAccountId(accountId);
      this.assertPositiveAmount(amount);
      const account = this.store.accounts[normalized];
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }
      const total = account.depositBalance + account.winningsBalance;
      if (total < amount) {
        throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${account.id} mangler saldo.`);
      }

      // PR-W1: winnings-first-policy for debit.
      const split = this.splitDebit(account, amount);
      account.depositBalance -= split.fromDeposit;
      account.winningsBalance -= split.fromWinnings;
      account.updatedAt = new Date().toISOString();
      const tx = this.recordTx(account.id, "DEBIT", amount, reason || "Debit", undefined, split);
      await this.persist();
      return tx;
    });
  }

  async credit(accountId: string, amount: number, reason: string, options?: CreditOptions): Promise<WalletTransaction> {
    return this.withLock(async () => {
      await this.load();
      const normalized = this.assertAccountId(accountId);
      this.assertPositiveAmount(amount);
      const account = this.store.accounts[normalized];
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }
      const target: WalletAccountSide = options?.to ?? "deposit";
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
      const tx = this.recordTx(account.id, "CREDIT", amount, reason || "Credit", undefined, split);
      await this.persist();
      return tx;
    });
  }

  async topUp(accountId: string, amount: number, reason = "Manual top-up", _options?: TransactionOptions): Promise<WalletTransaction> {
    return this.withLock(async () => {
      await this.load();
      const normalized = this.assertAccountId(accountId);
      this.assertPositiveAmount(amount);
      const account = this.store.accounts[normalized];
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }

      // PM-beslutning: topup → ALLTID deposit.
      account.depositBalance += amount;
      account.updatedAt = new Date().toISOString();
      const tx = this.recordTx(account.id, "TOPUP", amount, reason, undefined, {
        fromDeposit: amount,
        fromWinnings: 0
      });
      await this.persist();
      return tx;
    });
  }

  async withdraw(accountId: string, amount: number, reason = "Manual withdrawal", _options?: TransactionOptions): Promise<WalletTransaction> {
    return this.withLock(async () => {
      await this.load();
      const normalized = this.assertAccountId(accountId);
      this.assertPositiveAmount(amount);
      const account = this.store.accounts[normalized];
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }
      const total = account.depositBalance + account.winningsBalance;
      if (total < amount) {
        throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${account.id} mangler saldo.`);
      }

      // PM-beslutning: withdrawal → winnings-first.
      const split = this.splitDebit(account, amount);
      account.depositBalance -= split.fromDeposit;
      account.winningsBalance -= split.fromWinnings;
      account.updatedAt = new Date().toISOString();
      const tx = this.recordTx(account.id, "WITHDRAWAL", amount, reason, undefined, split);
      await this.persist();
      return tx;
    });
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Wallet transfer",
    options?: TransferOptions
  ): Promise<WalletTransferResult> {
    return this.withLock(async () => {
      await this.load();
      const fromId = this.assertAccountId(fromAccountId);
      const toId = this.assertAccountId(toAccountId);
      if (fromId === toId) {
        throw new WalletError("INVALID_TRANSFER", "Kan ikke overføre til samme wallet.");
      }
      this.assertPositiveAmount(amount);

      const from = this.store.accounts[fromId];
      const to = this.store.accounts[toId];
      if (!from) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${fromId} finnes ikke.`);
      }
      if (!to) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${toId} finnes ikke.`);
      }
      const fromTotal = from.depositBalance + from.winningsBalance;
      if (fromTotal < amount) {
        throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${from.id} mangler saldo.`);
      }

      const fromSplit = this.splitDebit(from, amount);
      from.depositBalance -= fromSplit.fromDeposit;
      from.winningsBalance -= fromSplit.fromWinnings;
      from.updatedAt = new Date().toISOString();

      // PR-W3: CREDIT-siden bruker `targetSide` (default deposit).
      const targetSide: WalletAccountSide = options?.targetSide ?? "deposit";
      const toSplit: WalletTransactionSplit =
        targetSide === "winnings"
          ? { fromDeposit: 0, fromWinnings: amount }
          : { fromDeposit: amount, fromWinnings: 0 };
      if (targetSide === "winnings") {
        to.winningsBalance += amount;
      } else {
        to.depositBalance += amount;
      }
      to.updatedAt = new Date().toISOString();

      const fromTx = this.recordTx(from.id, "TRANSFER_OUT", amount, reason, to.id, fromSplit);
      const toTx = this.recordTx(to.id, "TRANSFER_IN", amount, reason, from.id, toSplit);
      await this.persist();
      return { fromTx, toTx };
    });
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    return this.withLock(async () => {
      await this.load();
      const normalized = this.assertAccountId(accountId);
      if (!this.store.accounts[normalized]) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }
      return this.store.transactions
        .filter((tx) => tx.accountId === normalized)
        .slice(-limit)
        .reverse()
        .map((tx) => ({ ...tx }));
    });
  }

  // ── BIN-693 Option B: Wallet-reservasjon ──────────────────────────────────
  // PR 1 scope: in-memory reservasjoner. Persistens kommer i PR 2 sammen med
  // Postgres-adapter — inntil da mister file-adapter reservasjoner ved
  // backend-restart (same som in-memory armed-state i BingoEngine).

  private readonly reservations = new Map<string, WalletReservation>();
  private readonly reservationByIdempotencyKey = new Map<string, string>();

  async getAvailableBalance(accountId: string): Promise<number> {
    return this.withLock(async () => {
      await this.load();
      const normalized = this.assertAccountId(accountId);
      const account = this.store.accounts[normalized];
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }
      const reserved = this.sumActiveReservations(normalized);
      return Math.max(0, account.depositBalance + account.winningsBalance - reserved);
    });
  }

  async reserve(
    accountId: string,
    amount: number,
    options: ReserveOptions,
  ): Promise<WalletReservation> {
    return this.withLock(async () => {
      await this.load();
      if (amount <= 0) throw new WalletError("INVALID_INPUT", "amount må være > 0.");
      const normalized = this.assertAccountId(accountId);
      const account = this.store.accounts[normalized];
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }

      const existingId = this.reservationByIdempotencyKey.get(options.idempotencyKey);
      if (existingId) {
        const existing = this.reservations.get(existingId);
        if (existing && existing.status === "active") {
          if (existing.amount !== amount) {
            throw new WalletError(
              "IDEMPOTENCY_MISMATCH",
              `Reservasjon med samme key (${options.idempotencyKey}) har beløp ${existing.amount}, ikke ${amount}.`,
            );
          }
          return { ...existing };
        }
      }

      const available = account.depositBalance + account.winningsBalance - this.sumActiveReservations(normalized);
      if (available < amount) {
        throw new WalletError(
          "INSUFFICIENT_FUNDS",
          `Wallet ${normalized} har ikke tilstrekkelig tilgjengelig saldo (${available} < ${amount}).`,
        );
      }

      const now = new Date();
      const expiresAt = options.expiresAt ?? new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      const reservation: WalletReservation = {
        id: randomUUID(),
        walletId: normalized,
        amount,
        idempotencyKey: options.idempotencyKey,
        status: "active",
        roomCode: options.roomCode,
        gameSessionId: null,
        createdAt: now.toISOString(),
        releasedAt: null,
        committedAt: null,
        expiresAt,
      };
      this.reservations.set(reservation.id, reservation);
      this.reservationByIdempotencyKey.set(options.idempotencyKey, reservation.id);
      return { ...reservation };
    });
  }

  async increaseReservation(
    reservationId: string,
    extraAmount: number,
  ): Promise<WalletReservation> {
    return this.withLock(async () => {
      await this.load();
      if (extraAmount <= 0) throw new WalletError("INVALID_INPUT", "extraAmount må være > 0.");
      const existing = this.reservations.get(reservationId);
      if (!existing) {
        throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${reservationId} finnes ikke.`);
      }
      if (existing.status !== "active") {
        throw new WalletError(
          "INVALID_STATE",
          `Reservasjon ${reservationId} er ${existing.status}, kan ikke økes.`,
        );
      }
      const account = this.store.accounts[existing.walletId];
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${existing.walletId} finnes ikke.`);
      }
      const available = account.depositBalance + account.winningsBalance - this.sumActiveReservations(existing.walletId);
      if (available < extraAmount) {
        throw new WalletError(
          "INSUFFICIENT_FUNDS",
          `Wallet ${existing.walletId} har ikke tilstrekkelig tilgjengelig saldo for økning (${available} < ${extraAmount}).`,
        );
      }
      const updated: WalletReservation = { ...existing, amount: existing.amount + extraAmount };
      this.reservations.set(reservationId, updated);
      return { ...updated };
    });
  }

  async releaseReservation(reservationId: string, amount?: number): Promise<WalletReservation> {
    const existing = this.reservations.get(reservationId);
    if (!existing) {
      throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${reservationId} finnes ikke.`);
    }
    if (existing.status !== "active") {
      throw new WalletError(
        "INVALID_STATE",
        `Reservasjon ${reservationId} er ${existing.status}, kan ikke frigis.`,
      );
    }
    if (amount === undefined || amount >= existing.amount) {
      const updated: WalletReservation = {
        ...existing,
        status: "released",
        releasedAt: new Date().toISOString(),
      };
      this.reservations.set(reservationId, updated);
      return { ...updated };
    }
    if (amount <= 0) throw new WalletError("INVALID_INPUT", "amount må være > 0.");
    const updated: WalletReservation = {
      ...existing,
      amount: existing.amount - amount,
    };
    this.reservations.set(reservationId, updated);
    return { ...updated };
  }

  async commitReservation(
    reservationId: string,
    toAccountId: string,
    reason: string,
    options?: CommitReservationOptions,
  ): Promise<WalletTransferResult> {
    const existing = this.reservations.get(reservationId);
    if (!existing) {
      throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${reservationId} finnes ikke.`);
    }
    if (existing.status !== "active") {
      throw new WalletError(
        "INVALID_STATE",
        `Reservasjon ${reservationId} er ${existing.status}, kan ikke committes.`,
      );
    }
    const transfer = await this.transfer(
      existing.walletId,
      toAccountId,
      existing.amount,
      reason,
      options,
    );
    this.reservations.set(reservationId, {
      ...existing,
      status: "committed",
      committedAt: new Date().toISOString(),
      gameSessionId: options?.gameSessionId ?? null,
    });
    return transfer;
  }

  async listActiveReservations(accountId: string): Promise<WalletReservation[]> {
    const normalized = this.assertAccountId(accountId);
    return Array.from(this.reservations.values())
      .filter((r) => r.walletId === normalized && r.status === "active")
      .map((r) => ({ ...r }));
  }

  async listReservationsByRoom(roomCode: string): Promise<WalletReservation[]> {
    return Array.from(this.reservations.values())
      .filter((r) => r.roomCode === roomCode)
      .map((r) => ({ ...r }));
  }

  async expireStaleReservations(nowMs: number): Promise<number> {
    const now = new Date(nowMs).toISOString();
    let expired = 0;
    for (const [id, r] of this.reservations) {
      if (r.status === "active" && r.expiresAt < now) {
        this.reservations.set(id, { ...r, status: "expired", releasedAt: now });
        expired++;
      }
    }
    return expired;
  }

  private sumActiveReservations(walletId: string): number {
    let total = 0;
    for (const r of this.reservations.values()) {
      if (r.walletId === walletId && r.status === "active") total += r.amount;
    }
    return total;
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const run = this.mutex.then(work, work);
    this.mutex = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      const raw = await readFile(this.dataFilePath, "utf8");
      const parsed = JSON.parse(raw) as WalletStore;
      const accounts: Record<string, InternalAccount> = {};
      // PR-W1: migrer gamle accounts med bare `balance` → depositBalance.
      for (const [id, entry] of Object.entries(parsed.accounts ?? {})) {
        const anyEntry = entry as Partial<InternalAccount>;
        const depositBalance = typeof anyEntry.depositBalance === "number"
          ? anyEntry.depositBalance
          : typeof anyEntry.balance === "number"
            ? anyEntry.balance
            : 0;
        const winningsBalance = typeof anyEntry.winningsBalance === "number" ? anyEntry.winningsBalance : 0;
        accounts[id] = {
          id: anyEntry.id ?? id,
          depositBalance,
          winningsBalance,
          createdAt: anyEntry.createdAt ?? new Date().toISOString(),
          updatedAt: anyEntry.updatedAt ?? new Date().toISOString()
        };
      }
      this.store = {
        accounts,
        transactions: parsed.transactions ?? []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.persist();
      } else {
        throw error;
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.dataFilePath), { recursive: true });
    await writeFile(this.dataFilePath, JSON.stringify(this.store, null, 2), "utf8");
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
    this.store.transactions.push(tx);
    return { ...tx };
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
