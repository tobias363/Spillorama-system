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

export interface WalletAdapter {
  createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount>;
  ensureAccount(accountId: string): Promise<WalletAccount>;
  getAccount(accountId: string): Promise<WalletAccount>;
  listAccounts(): Promise<WalletAccount[]>;
  getBalance(accountId: string): Promise<number>;
  debit(accountId: string, amount: number, reason: string): Promise<WalletTransaction>;
  credit(accountId: string, amount: number, reason: string): Promise<WalletTransaction>;
  topUp(accountId: string, amount: number, reason?: string): Promise<WalletTransaction>;
  withdraw(accountId: string, amount: number, reason?: string): Promise<WalletTransaction>;
  transfer(fromAccountId: string, toAccountId: string, amount: number, reason?: string): Promise<WalletTransferResult>;
  listTransactions(accountId: string, limit?: number): Promise<WalletTransaction[]>;
}
