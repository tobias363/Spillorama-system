export type WalletTransactionType =
  | "DEBIT"
  | "CREDIT"
  | "TOPUP"
  | "WITHDRAWAL"
  | "TRANSFER_OUT"
  | "TRANSFER_IN";

export interface WalletAccount {
  id: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export class WalletError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface WalletTransaction {
  id: string;
  accountId: string;
  type: WalletTransactionType;
  amount: number;
  reason: string;
  createdAt: string;
  relatedAccountId?: string;
}

export interface CreateWalletAccountInput {
  accountId?: string;
  initialBalance?: number;
  allowExisting?: boolean;
}

export interface WalletTransferResult {
  fromTx: WalletTransaction;
  toTx: WalletTransaction;
}

/** BIN-162: Options for wallet operations — supports idempotency. */
export interface TransactionOptions {
  /** If provided, duplicate calls with the same key return the original result. */
  idempotencyKey?: string;
}

export interface WalletAdapter {
  createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount>;
  ensureAccount(accountId: string): Promise<WalletAccount>;
  getAccount(accountId: string): Promise<WalletAccount>;
  listAccounts(): Promise<WalletAccount[]>;
  getBalance(accountId: string): Promise<number>;
  debit(accountId: string, amount: number, reason: string, options?: TransactionOptions): Promise<WalletTransaction>;
  credit(accountId: string, amount: number, reason: string, options?: TransactionOptions): Promise<WalletTransaction>;
  topUp(accountId: string, amount: number, reason?: string, options?: TransactionOptions): Promise<WalletTransaction>;
  withdraw(accountId: string, amount: number, reason?: string, options?: TransactionOptions): Promise<WalletTransaction>;
  transfer(fromAccountId: string, toAccountId: string, amount: number, reason?: string, options?: TransactionOptions): Promise<WalletTransferResult>;
  listTransactions(accountId: string, limit?: number): Promise<WalletTransaction[]>;
}
