import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { getPoolTuning } from "../util/pgPool.js";
import type {
  CreateWalletAccountInput,
  CreditOptions,
  TransactionOptions,
  WalletAccount,
  WalletAccountSide,
  WalletAdapter,
  WalletBalance,
  WalletTransaction,
  WalletTransactionSplit,
  WalletTransferResult
} from "./WalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

type EntrySide = "DEBIT" | "CREDIT";

interface PostgresWalletAdapterOptions {
  connectionString: string;
  schema?: string;
  ssl?: boolean;
  defaultInitialBalance?: number;
}

interface AccountRow {
  id: string;
  balance: string | number;
  deposit_balance: string | number;
  winnings_balance: string | number;
  is_system: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface InsertTransactionInput {
  id: string;
  operationId: string;
  accountId: string;
  type: WalletTransaction["type"];
  amount: number;
  reason: string;
  relatedAccountId?: string;
  /** BIN-162: Idempotency key for deduplication */
  idempotencyKey?: string;
  /** PR-W1: hvordan beløpet fordelte seg på deposit/winnings. */
  split?: WalletTransactionSplit;
}

interface LedgerEntryInput {
  operationId: string;
  accountId: string;
  side: EntrySide;
  amount: number;
  transactionId?: string;
  /**
   * PR-W1: hvilken "side" av split-kontoen denne entry gjelder.
   * Default 'deposit' for system-kontoer og bakoverkompat.
   */
  accountSide?: WalletAccountSide;
}

interface LedgerExecutionInput {
  transactions: InsertTransactionInput[];
  entries: LedgerEntryInput[];
}

/**
 * PR-W1: intern representasjon av en wallet-konto med split. `balance` er sum
 * av deposit + winnings (matcher GENERATED STORED-kolonnen i DB).
 */
interface InternalAccountState {
  id: string;
  balance: number;
  depositBalance: number;
  winningsBalance: number;
  isSystem: boolean;
}

function asMoney(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new WalletError("INVALID_WALLET_RESPONSE", "Wallet DB returnerte ugyldig tallfelt.");
  }
  return parsed;
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function assertSchemaName(schema: string): string {
  const trimmed = schema.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new WalletError(
      "INVALID_WALLET_CONFIG",
      "WALLET_PG_SCHEMA er ugyldig. Bruk kun bokstaver, tall og underscore."
    );
  }
  return trimmed;
}

function splitDebitFromAccount(
  account: Pick<InternalAccountState, "depositBalance" | "winningsBalance">,
  amount: number
): WalletTransactionSplit {
  // PR-W1: winnings-first-policy — trekk fra winnings først, så deposit.
  const fromWinnings = Math.min(account.winningsBalance, amount);
  const fromDeposit = amount - fromWinnings;
  return { fromWinnings, fromDeposit };
}

export class PostgresWalletAdapter implements WalletAdapter {
  private readonly pool: Pool;

  private readonly schema: string;

  private readonly defaultInitialBalance: number;

  private initPromise: Promise<void> | null = null;

  private readonly houseAccountId = "__system_house__";

  private readonly externalCashAccountId = "__system_external_cash__";

  constructor(options: PostgresWalletAdapterOptions) {
    const connectionString = options.connectionString?.trim();
    if (!connectionString) {
      throw new WalletError("INVALID_WALLET_CONFIG", "WALLET_PG_CONNECTION_STRING mangler.");
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.defaultInitialBalance = options.defaultInitialBalance ?? 1000;
    if (!Number.isFinite(this.defaultInitialBalance) || this.defaultInitialBalance < 0) {
      throw new WalletError("INVALID_WALLET_CONFIG", "WALLET_DEFAULT_INITIAL_BALANCE må være 0 eller større.");
    }

    this.pool = new Pool({
      connectionString,
      ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
      ...getPoolTuning()
    });
  }

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    await this.ensureInitialized();
    const accountId = this.normalizeUserWalletId(input?.accountId || `wallet-${randomUUID()}`);
    const initialBalance = input?.initialBalance ?? this.defaultInitialBalance;
    this.assertNonNegativeAmount(initialBalance);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await this.selectAccountForUpdate(client, accountId);
      if (existing) {
        if (input?.allowExisting) {
          await client.query("COMMIT");
          return this.toWalletAccount(existing);
        }
        throw new WalletError("ACCOUNT_EXISTS", `Wallet ${accountId} finnes allerede.`);
      }

      await this.insertAccount(client, accountId, false);
      if (initialBalance > 0) {
        const operationId = randomUUID();
        const txId = randomUUID();
        await this.executeLedger(
          client,
          {
            transactions: [
              {
                id: txId,
                operationId,
                accountId,
                type: "TOPUP",
                amount: initialBalance,
                reason: "Initial wallet funding",
                split: { fromDeposit: initialBalance, fromWinnings: 0 }
              }
            ],
            entries: [
              {
                operationId,
                accountId,
                side: "CREDIT",
                amount: initialBalance,
                transactionId: txId,
                accountSide: "deposit"
              },
              {
                operationId,
                accountId: this.externalCashAccountId,
                side: "DEBIT",
                amount: initialBalance,
                accountSide: "deposit"
              }
            ]
          }
        );
      }

      const created = await this.selectAccountForUpdate(client, accountId);
      if (!created) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${accountId} finnes ikke etter opprettelse.`);
      }
      await client.query("COMMIT");
      return this.toWalletAccount(created);
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        input?.allowExisting &&
        input.accountId &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        return this.getAccount(accountId);
      }
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const normalized = this.normalizeUserWalletId(accountId);
    try {
      return await this.getAccount(normalized);
    } catch (error) {
      if (error instanceof WalletError && error.code === "ACCOUNT_NOT_FOUND") {
        return this.createAccount({
          accountId: normalized,
          initialBalance: this.defaultInitialBalance,
          allowExisting: true
        });
      }
      throw error;
    }
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    await this.ensureInitialized();
    try {
      const normalized = this.normalizeAnyAccountId(accountId);
      const row = await this.selectAccount(normalized);
      if (!row) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }
      return this.toWalletAccount(row);
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  async listAccounts(): Promise<WalletAccount[]> {
    await this.ensureInitialized();
    try {
      const { rows } = await this.pool.query<AccountRow>(
        `SELECT id, balance, deposit_balance, winnings_balance, is_system, created_at, updated_at
         FROM ${this.accountsTable()}
         WHERE is_system = false
         ORDER BY created_at ASC`
      );
      return rows.map((row) => this.toWalletAccount(row));
    } catch (error) {
      throw this.wrapError(error);
    }
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

  async debit(accountId: string, amount: number, reason: string, options?: TransactionOptions): Promise<WalletTransaction> {
    const normalized = this.normalizeUserWalletId(accountId);
    this.assertPositiveAmount(amount);
    // PR-W1: debit bruker winnings-first-policy. Splitten bestemmes inne i
    // executeLedger under SELECT FOR UPDATE (unngår race mot parallell debit).
    const tx = await this.singleAccountMovement({
      accountId: normalized,
      type: "DEBIT",
      amount,
      reason: reason || "Debit",
      fromAccountId: normalized,
      toAccountId: this.houseAccountId,
      idempotencyKey: options?.idempotencyKey,
      splitStrategy: "winnings-first"
    });
    return tx;
  }

  async credit(accountId: string, amount: number, reason: string, options?: CreditOptions): Promise<WalletTransaction> {
    const normalized = this.normalizeUserWalletId(accountId);
    this.assertPositiveAmount(amount);
    const target: WalletAccountSide = options?.to ?? "deposit";
    return this.singleAccountMovement({
      accountId: normalized,
      type: "CREDIT",
      amount,
      reason: reason || "Credit",
      fromAccountId: this.houseAccountId,
      toAccountId: normalized,
      idempotencyKey: options?.idempotencyKey,
      creditTarget: target
    });
  }

  async topUp(accountId: string, amount: number, reason = "Manual top-up", options?: TransactionOptions): Promise<WalletTransaction> {
    const normalized = this.normalizeUserWalletId(accountId);
    this.assertPositiveAmount(amount);
    // PM-beslutning: topup → ALLTID deposit-konto. Ikke overstyrbar.
    return this.singleAccountMovement({
      accountId: normalized,
      type: "TOPUP",
      amount,
      reason,
      fromAccountId: this.externalCashAccountId,
      toAccountId: normalized,
      idempotencyKey: options?.idempotencyKey,
      creditTarget: "deposit"
    });
  }

  async withdraw(accountId: string, amount: number, reason = "Manual withdrawal", options?: TransactionOptions): Promise<WalletTransaction> {
    const normalized = this.normalizeUserWalletId(accountId);
    this.assertPositiveAmount(amount);
    // PM-beslutning: withdrawal → winnings-first, så deposit.
    return this.singleAccountMovement({
      accountId: normalized,
      type: "WITHDRAWAL",
      amount,
      reason,
      fromAccountId: normalized,
      toAccountId: this.externalCashAccountId,
      idempotencyKey: options?.idempotencyKey,
      splitStrategy: "winnings-first"
    });
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Wallet transfer",
    _options?: TransactionOptions
  ): Promise<WalletTransferResult> {
    await this.ensureInitialized();
    const fromId = this.normalizeUserWalletId(fromAccountId);
    const toId = this.normalizeUserWalletId(toAccountId);
    if (fromId === toId) {
      throw new WalletError("INVALID_TRANSFER", "Kan ikke overføre til samme wallet.");
    }
    this.assertPositiveAmount(amount);

    await this.ensureAccount(fromId);
    await this.ensureAccount(toId);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const operationId = randomUUID();
      const fromTxId = randomUUID();
      const toTxId = randomUUID();

      // Les from-account inne i samme FOR UPDATE som executeLedger vil holde,
      // for å beregne winnings-first splitt atomisk.
      const fromAccount = await this.selectAccountForUpdate(client, fromId);
      if (!fromAccount) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${fromId} finnes ikke.`);
      }
      const fromState: InternalAccountState = {
        id: fromAccount.id,
        balance: asMoney(fromAccount.balance),
        depositBalance: asMoney(fromAccount.deposit_balance),
        winningsBalance: asMoney(fromAccount.winnings_balance),
        isSystem: fromAccount.is_system
      };
      const fromSplit = splitDebitFromAccount(fromState, amount);

      // Mottaker får alt på deposit-siden (bakover-kompat for interne overføringer).
      const toSplit: WalletTransactionSplit = { fromDeposit: amount, fromWinnings: 0 };

      const entries: LedgerEntryInput[] = [];
      if (fromSplit.fromWinnings > 0) {
        entries.push({
          operationId,
          accountId: fromId,
          side: "DEBIT",
          amount: fromSplit.fromWinnings,
          transactionId: fromTxId,
          accountSide: "winnings"
        });
      }
      if (fromSplit.fromDeposit > 0) {
        entries.push({
          operationId,
          accountId: fromId,
          side: "DEBIT",
          amount: fromSplit.fromDeposit,
          transactionId: fromTxId,
          accountSide: "deposit"
        });
      }
      entries.push({
        operationId,
        accountId: toId,
        side: "CREDIT",
        amount,
        transactionId: toTxId,
        accountSide: "deposit"
      });

      const txRows = await this.executeLedger(client, {
        transactions: [
          {
            id: fromTxId,
            operationId,
            accountId: fromId,
            type: "TRANSFER_OUT",
            amount,
            reason,
            relatedAccountId: toId,
            split: fromSplit
          },
          {
            id: toTxId,
            operationId,
            accountId: toId,
            type: "TRANSFER_IN",
            amount,
            reason,
            relatedAccountId: fromId,
            split: toSplit
          }
        ],
        entries
      });

      await client.query("COMMIT");
      const fromTx = txRows.find((tx) => tx.id === fromTxId);
      const toTx = txRows.find((tx) => tx.id === toTxId);
      if (!fromTx || !toTx) {
        throw new WalletError("INVALID_WALLET_RESPONSE", "Transfer mangler transaksjonsrader.");
      }
      return {
        fromTx,
        toTx
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    await this.ensureInitialized();
    try {
      const normalized = this.normalizeAnyAccountId(accountId);
      const account = await this.selectAccount(normalized);
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }

      const parsedLimit = Number(limit);
      const cappedLimit =
        Number.isFinite(parsedLimit) && parsedLimit > 0
          ? Math.min(500, Math.max(1, Math.floor(parsedLimit)))
          : 100;
      const { rows } = await this.pool.query<{
        id: string;
        account_id: string;
        transaction_type: WalletTransaction["type"];
        amount: string | number;
        reason: string;
        related_account_id: string | null;
        created_at: Date | string;
        split_from_deposit: string | number | null;
        split_from_winnings: string | number | null;
      }>(
        `SELECT t.id, t.account_id, t.transaction_type, t.amount, t.reason,
                t.related_account_id, t.created_at,
                ${this.splitDepositSubquery()} AS split_from_deposit,
                ${this.splitWinningsSubquery()} AS split_from_winnings
         FROM ${this.transactionsTable()} t
         WHERE t.account_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [normalized, cappedLimit]
      );

      return rows.map((row) => this.rowToTransaction(row));
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  private async singleAccountMovement(input: {
    accountId: string;
    type: WalletTransaction["type"];
    amount: number;
    reason: string;
    fromAccountId: string;
    toAccountId: string;
    idempotencyKey?: string;
    /** For debit/withdrawal: winnings-first-policy. */
    splitStrategy?: "winnings-first";
    /** For credit/topup: hvilken side beløpet krediteres på. */
    creditTarget?: WalletAccountSide;
  }): Promise<WalletTransaction> {
    await this.ensureInitialized();

    // BIN-162: Idempotency check — return existing transaction if key was already used
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }

    await this.ensureAccount(input.accountId);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const operationId = randomUUID();
      const txId = randomUUID();

      // For debit: lås account-raden og beregn winnings-first-splitt atomisk.
      let split: WalletTransactionSplit;
      if (input.splitStrategy === "winnings-first") {
        const locked = await this.selectAccountForUpdate(client, input.accountId);
        if (!locked) {
          throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${input.accountId} finnes ikke.`);
        }
        split = splitDebitFromAccount(
          {
            depositBalance: asMoney(locked.deposit_balance),
            winningsBalance: asMoney(locked.winnings_balance)
          },
          input.amount
        );
      } else {
        // For credit: hele beløpet lander på `creditTarget` (default deposit).
        const target: WalletAccountSide = input.creditTarget ?? "deposit";
        split =
          target === "winnings"
            ? { fromWinnings: input.amount, fromDeposit: 0 }
            : { fromWinnings: 0, fromDeposit: input.amount };
      }

      const userSideForFromAccount: WalletAccountSide | undefined =
        input.accountId === input.fromAccountId ? undefined : "deposit"; // system-konto ⇒ deposit
      const userSideForToAccount: WalletAccountSide | undefined =
        input.accountId === input.toAccountId ? undefined : "deposit";

      const entries: LedgerEntryInput[] = [];

      // ── DEBIT-side ─────────────────────────────────────────────────────
      if (input.accountId === input.fromAccountId) {
        // Bruker-wallet er DEBIT-siden — splitt mellom winnings + deposit.
        if (split.fromWinnings > 0) {
          entries.push({
            operationId,
            accountId: input.fromAccountId,
            side: "DEBIT",
            amount: split.fromWinnings,
            transactionId: txId,
            accountSide: "winnings"
          });
        }
        if (split.fromDeposit > 0) {
          entries.push({
            operationId,
            accountId: input.fromAccountId,
            side: "DEBIT",
            amount: split.fromDeposit,
            transactionId: txId,
            accountSide: "deposit"
          });
        }
      } else {
        // Systemkonto på DEBIT-siden — alt på deposit (system har ikke winnings).
        entries.push({
          operationId,
          accountId: input.fromAccountId,
          side: "DEBIT",
          amount: input.amount,
          accountSide: userSideForFromAccount ?? "deposit"
        });
      }

      // ── CREDIT-side ────────────────────────────────────────────────────
      if (input.accountId === input.toAccountId) {
        // Bruker-wallet er CREDIT-siden — lander på `creditTarget` (alt eller intet).
        if (split.fromWinnings > 0) {
          entries.push({
            operationId,
            accountId: input.toAccountId,
            side: "CREDIT",
            amount: split.fromWinnings,
            transactionId: txId,
            accountSide: "winnings"
          });
        }
        if (split.fromDeposit > 0) {
          entries.push({
            operationId,
            accountId: input.toAccountId,
            side: "CREDIT",
            amount: split.fromDeposit,
            transactionId: txId,
            accountSide: "deposit"
          });
        }
      } else {
        // Systemkonto på CREDIT-siden — alt på deposit.
        entries.push({
          operationId,
          accountId: input.toAccountId,
          side: "CREDIT",
          amount: input.amount,
          accountSide: userSideForToAccount ?? "deposit"
        });
      }

      const txRows = await this.executeLedger(client, {
        transactions: [
          {
            id: txId,
            operationId,
            accountId: input.accountId,
            type: input.type,
            amount: input.amount,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            split
          }
        ],
        entries
      });
      await client.query("COMMIT");
      const tx = txRows.find((row) => row.id === txId);
      if (!tx) {
        throw new WalletError("INVALID_WALLET_RESPONSE", "Mangler transaksjonsrad for wallet-operasjon.");
      }
      return tx;
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  /** BIN-162: Find an existing transaction by idempotency key. */
  private async findByIdempotencyKey(key: string): Promise<WalletTransaction | undefined> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{
      id: string;
      account_id: string;
      transaction_type: WalletTransaction["type"];
      amount: string | number;
      reason: string;
      related_account_id: string | null;
      created_at: Date | string;
      split_from_deposit: string | number | null;
      split_from_winnings: string | number | null;
    }>(
      `SELECT t.id, t.account_id, t.transaction_type, t.amount, t.reason,
              t.related_account_id, t.created_at,
              ${this.splitDepositSubquery()} AS split_from_deposit,
              ${this.splitWinningsSubquery()} AS split_from_winnings
       FROM ${this.transactionsTable()} t
       WHERE t.idempotency_key = $1
       LIMIT 1`,
      [key]
    );
    if (rows.length === 0) return undefined;
    return this.rowToTransaction(rows[0]);
  }

  private async executeLedger(
    client: PoolClient,
    input: LedgerExecutionInput
  ): Promise<WalletTransaction[]> {
    const accountIds = [...new Set(input.entries.map((entry) => entry.accountId))];
    const accounts = await this.selectAccountsForUpdate(client, accountIds);
    for (const accountId of accountIds) {
      if (!accounts.has(accountId)) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${accountId} finnes ikke.`);
      }
    }

    // Beregn delta per konto og per side (deposit/winnings).
    // System-kontoer bruker kun deposit-siden.
    const depositDeltas = new Map<string, number>();
    const winningsDeltas = new Map<string, number>();
    for (const entry of input.entries) {
      const sign = entry.side === "CREDIT" ? 1 : -1;
      const side = entry.accountSide ?? "deposit";
      const target = side === "winnings" ? winningsDeltas : depositDeltas;
      target.set(entry.accountId, (target.get(entry.accountId) ?? 0) + sign * entry.amount);
    }

    // Valider: netto-saldo per side må være >= 0 for ikke-system-kontoer.
    for (const [accountId, delta] of [...depositDeltas.entries(), ...winningsDeltas.entries()]) {
      const account = accounts.get(accountId);
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${accountId} finnes ikke.`);
      }
    }

    // Oppdater state in-memory, valider, og persister.
    for (const [accountId, account] of accounts.entries()) {
      const depositDelta = depositDeltas.get(accountId) ?? 0;
      const winningsDelta = winningsDeltas.get(accountId) ?? 0;
      const nextDeposit = account.depositBalance + depositDelta;
      const nextWinnings = account.winningsBalance + winningsDelta;

      if (!account.isSystem) {
        if (nextDeposit < 0 || nextWinnings < 0) {
          throw new WalletError("INSUFFICIENT_FUNDS", `Wallet ${account.id} mangler saldo.`);
        }
      }
      // System-kontoer: winnings må være 0 (constraint i DB). Alle ledger-
      // entries for system bruker deposit-side, så dette holder.
      if (account.isSystem && nextWinnings !== 0) {
        throw new WalletError(
          "INVALID_WALLET_RESPONSE",
          `Systemkonto ${account.id} kan ikke ha winnings — alle ledger-entries for systemkonti må være account_side='deposit'.`
        );
      }

      account.depositBalance = nextDeposit;
      account.winningsBalance = nextWinnings;
      account.balance = nextDeposit + nextWinnings;
    }

    for (const account of accounts.values()) {
      // `balance` er GENERATED STORED — vi oppdaterer kun deposit + winnings.
      await client.query(
        `UPDATE ${this.accountsTable()}
           SET deposit_balance = $2, winnings_balance = $3, updated_at = now()
         WHERE id = $1`,
        [account.id, account.depositBalance, account.winningsBalance]
      );
    }

    const insertedTransactions: WalletTransaction[] = [];
    for (const tx of input.transactions) {
      const { rows } = await client.query<{
        id: string;
        account_id: string;
        transaction_type: WalletTransaction["type"];
        amount: string | number;
        reason: string;
        related_account_id: string | null;
        created_at: Date | string;
      }>(
        `INSERT INTO ${this.transactionsTable()}
          (id, operation_id, account_id, transaction_type, amount, reason, related_account_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, account_id, transaction_type, amount, reason, related_account_id, created_at`,
        [
          tx.id,
          tx.operationId,
          tx.accountId,
          tx.type,
          tx.amount,
          tx.reason,
          tx.relatedAccountId ?? null,
          tx.idempotencyKey ?? null
        ]
      );
      const row = rows[0];
      insertedTransactions.push({
        id: row.id,
        accountId: row.account_id,
        type: row.transaction_type,
        amount: asMoney(row.amount),
        reason: row.reason,
        createdAt: asIso(row.created_at),
        relatedAccountId: row.related_account_id ?? undefined,
        split: tx.split
      });
    }

    for (const entry of input.entries) {
      await client.query(
        `INSERT INTO ${this.entriesTable()}
          (operation_id, account_id, side, amount, transaction_id, account_side)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.operationId,
          entry.accountId,
          entry.side,
          entry.amount,
          entry.transactionId ?? null,
          entry.accountSide ?? "deposit"
        ]
      );
    }

    return insertedTransactions;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);

      // PR-W1 wallet-split: tabellen skapes alltid med split-kolonnene når
      // den lages fra scratch (f.eks. i integration-tests uten migration-kjøring).
      // `balance` er GENERATED for bakoverkompat.
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.accountsTable()} (
          id TEXT PRIMARY KEY,
          deposit_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
          winnings_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
          balance NUMERIC(20, 6) GENERATED ALWAYS AS (deposit_balance + winnings_balance) STORED,
          is_system BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT wallet_accounts_system_no_winnings
            CHECK (is_system = false OR winnings_balance = 0),
          CONSTRAINT wallet_accounts_nonneg_deposit_nonsystem
            CHECK (is_system = true OR deposit_balance >= 0),
          CONSTRAINT wallet_accounts_nonneg_winnings_nonsystem
            CHECK (is_system = true OR winnings_balance >= 0)
        )`
      );

      // Hvis tabellen allerede finnes (pre-W1 schema), sørg for at split-
      // kolonnene er lagt til. Idempotent med migrasjonen.
      await client.query(
        `ALTER TABLE ${this.accountsTable()}
           ADD COLUMN IF NOT EXISTS deposit_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
           ADD COLUMN IF NOT EXISTS winnings_balance NUMERIC(20, 6) NOT NULL DEFAULT 0`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.transactionsTable()} (
          id TEXT PRIMARY KEY,
          operation_id TEXT NOT NULL,
          account_id TEXT NOT NULL REFERENCES ${this.accountsTable()}(id),
          transaction_type TEXT NOT NULL,
          amount NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
          reason TEXT NOT NULL,
          related_account_id TEXT NULL,
          idempotency_key TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      // BIN-162: Idempotency key unique index (only for non-null keys)
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency_key
         ON ${this.transactionsTable()} (idempotency_key) WHERE idempotency_key IS NOT NULL`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.entriesTable()} (
          id BIGSERIAL PRIMARY KEY,
          operation_id TEXT NOT NULL,
          account_id TEXT NOT NULL REFERENCES ${this.accountsTable()}(id),
          side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
          amount NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
          transaction_id TEXT NULL REFERENCES ${this.transactionsTable()}(id),
          account_side TEXT NOT NULL DEFAULT 'deposit'
            CHECK (account_side IN ('deposit', 'winnings')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      // Hvis tabellen finnes fra før: sørg for account_side-kolonnen.
      await client.query(
        `ALTER TABLE ${this.entriesTable()}
           ADD COLUMN IF NOT EXISTS account_side TEXT NOT NULL DEFAULT 'deposit'`
      );

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_wallet_transactions_account_created
         ON ${this.transactionsTable()} (account_id, created_at DESC)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_wallet_entries_account_created
         ON ${this.entriesTable()} (account_id, created_at DESC)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_wallet_entries_operation
         ON ${this.entriesTable()} (operation_id)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_wallet_entries_account_side
         ON ${this.entriesTable()} (account_id, account_side, created_at DESC)`
      );

      await this.insertSystemAccountIfMissing(client, this.houseAccountId);
      await this.insertSystemAccountIfMissing(client, this.externalCashAccountId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  private async insertSystemAccountIfMissing(client: PoolClient, accountId: string): Promise<void> {
    await client.query(
      `INSERT INTO ${this.accountsTable()} (id, deposit_balance, winnings_balance, is_system)
       VALUES ($1, 0, 0, true)
       ON CONFLICT (id) DO NOTHING`,
      [accountId]
    );
  }

  private async insertAccount(
    client: PoolClient,
    accountId: string,
    isSystem: boolean
  ): Promise<AccountRow> {
    // Ny konto: start på 0. Initial funding skjer via TOPUP-transaksjon etterpå.
    const { rows } = await client.query<AccountRow>(
      `INSERT INTO ${this.accountsTable()} (id, deposit_balance, winnings_balance, is_system)
       VALUES ($1, 0, 0, $2)
       RETURNING id, balance, deposit_balance, winnings_balance, is_system, created_at, updated_at`,
      [accountId, isSystem]
    );
    return rows[0];
  }

  private async selectAccount(accountId: string): Promise<AccountRow | null> {
    const { rows } = await this.pool.query<AccountRow>(
      `SELECT id, balance, deposit_balance, winnings_balance, is_system, created_at, updated_at
       FROM ${this.accountsTable()}
       WHERE id = $1`,
      [accountId]
    );
    return rows[0] ?? null;
  }

  private async selectAccountForUpdate(client: PoolClient, accountId: string): Promise<AccountRow | null> {
    const { rows } = await client.query<AccountRow>(
      `SELECT id, balance, deposit_balance, winnings_balance, is_system, created_at, updated_at
       FROM ${this.accountsTable()}
       WHERE id = $1
       FOR UPDATE`,
      [accountId]
    );
    return rows[0] ?? null;
  }

  private async selectAccountsForUpdate(
    client: PoolClient,
    accountIds: string[]
  ): Promise<Map<string, InternalAccountState>> {
    if (accountIds.length === 0) {
      return new Map();
    }

    const { rows } = await client.query<{
      id: string;
      balance: string | number;
      deposit_balance: string | number;
      winnings_balance: string | number;
      is_system: boolean;
    }>(
      `SELECT id, balance, deposit_balance, winnings_balance, is_system
       FROM ${this.accountsTable()}
       WHERE id = ANY($1::text[])
       FOR UPDATE`,
      [accountIds]
    );

    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          balance: asMoney(row.balance),
          depositBalance: asMoney(row.deposit_balance),
          winningsBalance: asMoney(row.winnings_balance),
          isSystem: row.is_system
        } satisfies InternalAccountState
      ])
    );
  }

  private toWalletAccount(row: AccountRow): WalletAccount {
    return {
      id: row.id,
      balance: asMoney(row.balance),
      depositBalance: asMoney(row.deposit_balance),
      winningsBalance: asMoney(row.winnings_balance),
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }

  /**
   * PR-W1: rekonstruer split ved å summere wallet_entries per account_side
   * for transaksjonens eget account_id. Sub-query unngår N+1 roundtrips.
   */
  private splitDepositSubquery(): string {
    return `(
      SELECT COALESCE(SUM(e.amount), 0)
      FROM ${this.entriesTable()} e
      WHERE e.transaction_id = t.id AND e.account_side = 'deposit' AND e.account_id = t.account_id
    )`;
  }

  private splitWinningsSubquery(): string {
    return `(
      SELECT COALESCE(SUM(e.amount), 0)
      FROM ${this.entriesTable()} e
      WHERE e.transaction_id = t.id AND e.account_side = 'winnings' AND e.account_id = t.account_id
    )`;
  }

  private rowToTransaction(row: {
    id: string;
    account_id: string;
    transaction_type: WalletTransaction["type"];
    amount: string | number;
    reason: string;
    related_account_id: string | null;
    created_at: Date | string;
    split_from_deposit: string | number | null;
    split_from_winnings: string | number | null;
  }): WalletTransaction {
    const fromDeposit = row.split_from_deposit !== null ? asMoney(row.split_from_deposit) : 0;
    const fromWinnings = row.split_from_winnings !== null ? asMoney(row.split_from_winnings) : 0;
    // Hvis begge er 0 (f.eks. legacy transaksjon uten entries linket via transaction_id),
    // utelat `split` for å markere "ukjent" fordeling.
    const split: WalletTransactionSplit | undefined =
      fromDeposit === 0 && fromWinnings === 0 ? undefined : { fromDeposit, fromWinnings };
    return {
      id: row.id,
      accountId: row.account_id,
      type: row.transaction_type,
      amount: asMoney(row.amount),
      reason: row.reason,
      createdAt: asIso(row.created_at),
      relatedAccountId: row.related_account_id ?? undefined,
      split
    };
  }

  private normalizeAnyAccountId(accountId: string): string {
    const normalized = accountId.trim();
    if (!normalized) {
      throw new WalletError("INVALID_ACCOUNT_ID", "walletId kan ikke være tom.");
    }
    return normalized;
  }

  private normalizeUserWalletId(accountId: string): string {
    const normalized = this.normalizeAnyAccountId(accountId);
    if (normalized.startsWith("__system_")) {
      throw new WalletError("INVALID_ACCOUNT_ID", "walletId bruker reservert prefiks.");
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

  private wrapError(error: unknown): WalletError {
    if (error instanceof WalletError) {
      return error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[PostgresWalletAdapter] DB error:", detail, error);
    return new WalletError("WALLET_DB_ERROR", `Feil i wallet-databasen: ${detail}`);
  }

  private accountsTable(): string {
    return `"${this.schema}"."wallet_accounts"`;
  }

  private transactionsTable(): string {
    return `"${this.schema}"."wallet_transactions"`;
  }

  private entriesTable(): string {
    return `"${this.schema}"."wallet_entries"`;
  }
}
