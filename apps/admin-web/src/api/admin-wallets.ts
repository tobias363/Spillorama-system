// PR-B4 (BIN-646) — admin wallet API wrappers.
// Thin wrappers around `apps/backend/src/routes/wallet.ts` for
// walletManagement-listen og viewWallet-detaljvisning.
//
// PR-W4 wallet-split: `WalletAccount` utvidet med `depositBalance` og
// `winningsBalance`. `balance` beholdes som bakoverkompatibel total
// (deposit + winnings). `WalletTransaction` får valgfri `split` med
// { fromDeposit, fromWinnings } for å dokumentere hvordan et DEBIT-/TRANSFER_OUT-
// trekk fordelte seg mellom de to kontoene.

import { apiRequest } from "./client.js";

/**
 * PR-W4 wallet-split: hvilken side ("deposit" eller "winnings") en credit
 * landet på, eller en debit trakk fra. Alltid kroner, aldri cents.
 */
export type WalletAccountSide = "deposit" | "winnings";

export interface WalletTransactionSplit {
  /** Beløp trukket fra / kreditert til deposit-siden. */
  fromDeposit: number;
  /** Beløp trukket fra / kreditert til winnings-siden. */
  fromWinnings: number;
}

export interface WalletAccount {
  id: string;
  /** Bakoverkompatibel total-saldo (deposit + winnings). */
  balance: number;
  /** PR-W4: brukerens innskudd. Eneste som teller mot loss-limit. */
  depositBalance?: number;
  /** PR-W4: gevinster fra spill. Trekkes først ved kjøp. */
  winningsBalance?: number;
  createdAt: string;
  updatedAt: string;
}

export type WalletTransactionType =
  | "DEBIT"
  | "CREDIT"
  | "TOPUP"
  | "WITHDRAWAL"
  | "TRANSFER_OUT"
  | "TRANSFER_IN";

export interface WalletTransaction {
  id: string;
  accountId: string;
  type: WalletTransactionType;
  amount: number;
  reason: string;
  createdAt: string;
  relatedAccountId?: string;
  /**
   * PR-W4 wallet-split: fordeling mellom deposit- og winnings-siden for
   * DEBIT/TRANSFER_OUT (winnings-first-splitt) og CREDIT/TRANSFER_IN
   * (target-side-fordeling). `undefined` på legacy-transaksjoner.
   */
  split?: WalletTransactionSplit;
}

export interface WalletDetail {
  account: WalletAccount;
  transactions: WalletTransaction[];
}

export function listWallets(): Promise<WalletAccount[]> {
  return apiRequest<WalletAccount[]>("/api/wallets", { auth: true });
}

export function getWallet(walletId: string): Promise<WalletDetail> {
  return apiRequest<WalletDetail>(
    `/api/wallets/${encodeURIComponent(walletId)}`,
    { auth: true }
  );
}

export function listWalletTransactions(
  walletId: string,
  limit = 100
): Promise<WalletTransaction[]> {
  return apiRequest<WalletTransaction[]>(
    `/api/wallets/${encodeURIComponent(walletId)}/transactions?limit=${limit}`,
    { auth: true }
  );
}
