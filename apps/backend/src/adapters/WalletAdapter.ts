export type WalletTransactionType =
  | "DEBIT"
  | "CREDIT"
  | "TOPUP"
  | "WITHDRAWAL"
  | "TRANSFER_OUT"
  | "TRANSFER_IN";

/**
 * PR-W1 wallet-split: hvilken logisk konto ("side") en credit-operasjon
 * målretter, eller en debit-entry trakk fra.
 *
 * - `deposit`  — brukerens innskudd. Målet for topup, refund, admin-correction.
 *                Eneste konto som teller mot Spillvett-tapsgrense.
 * - `winnings` — gevinster fra spill (payout). Trekkes først ved kjøp
 *                (winnings-first-policy). Admin-credit IKKE TILLATT —
 *                regulatorisk forbud: eneste credit-kilde er game-engine.
 */
export type WalletAccountSide = "deposit" | "winnings";

export interface WalletAccount {
  id: string;
  /**
   * Sum av deposit + winnings. Bakoverkompatibel total-saldo.
   *
   * For split-bevisst kode, bruk `depositBalance` / `winningsBalance` eller
   * `getBothBalances(walletId)`.
   */
  balance: number;
  /** PR-W1: brukerens innskudd. Loss-limit teller kun trekk herfra. */
  depositBalance: number;
  /** PR-W1: gevinster fra spill. Trekkes først ved kjøp. */
  winningsBalance: number;
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
  /**
   * PR-W1 wallet-split: hvordan beløpet fordelte seg mellom deposit- og
   * winnings-siden. Satt på DEBIT-transaksjoner etter winnings-first-splitt,
   * og på CREDIT-transaksjoner for å markere målkonto.
   *
   * Eksempel: debit kr 150 der winnings hadde kr 50 →
   *   `{ fromWinnings: 50, fromDeposit: 100 }`.
   *
   * `undefined` på legacy-transaksjoner fra før split-aktivering (backward-compat).
   */
  split?: WalletTransactionSplit;
}

/**
 * PR-W1 wallet-split: beskriver hvordan en transaksjon fordelte seg mellom
 * deposit- og winnings-siden av en wallet. Alltid kroner (major-units), aldri
 * cents — matcher `amount`-kontrakten ellers i interfacet.
 */
export interface WalletTransactionSplit {
  /** Beløp trukket fra / kreditert til winnings-siden. 0 hvis kun deposit. */
  fromWinnings: number;
  /** Beløp trukket fra / kreditert til deposit-siden. 0 hvis kun winnings. */
  fromDeposit: number;
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

/**
 * PR-W1 wallet-split: options for `credit()` — target account side.
 *
 * `to` styrer hvilken side en credit lander på:
 * - `"deposit"`  — topup, refund, manuell innskudd-korrigering (default).
 * - `"winnings"` — gevinst fra spill (Game1PayoutService, BingoEngine payout).
 *
 * Hvis ikke angitt: `"deposit"` (bakoverkompat — eksisterende callers som
 * ikke vet om split treffer samme konto som før split-aktivering).
 *
 * **Regulatorisk:** `to: "winnings"` skal KUN brukes av game-engine.
 * Admin-routes, topup-endepunkt og refund-flyt må aldri sende `"winnings"` —
 * det ville tilsvare admin-bonus, som er forbudt per pengespillforskriften.
 */
export interface CreditOptions extends TransactionOptions {
  to?: WalletAccountSide;
}

/**
 * PR-W1 wallet-split: saldo-breakdown for split-bevisst kode.
 *
 * `total = deposit + winnings`. Bakover-kompatibelt med `WalletAccount.balance`.
 */
export interface WalletBalance {
  deposit: number;
  winnings: number;
  total: number;
}

export interface WalletAdapter {
  createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount>;
  ensureAccount(accountId: string): Promise<WalletAccount>;
  getAccount(accountId: string): Promise<WalletAccount>;
  listAccounts(): Promise<WalletAccount[]>;
  /** Total-saldo (deposit + winnings). Bakover-kompatibelt. */
  getBalance(accountId: string): Promise<number>;
  /** PR-W1: kun innskudd-siden. Brukes for loss-limit-beregning. */
  getDepositBalance(accountId: string): Promise<number>;
  /** PR-W1: kun gevinst-siden. */
  getWinningsBalance(accountId: string): Promise<number>;
  /** PR-W1: både sider + total i én spørring (unngår dobbel-roundtrip mot DB). */
  getBothBalances(accountId: string): Promise<WalletBalance>;
  /**
   * Debit — trekker fra wallet med winnings-first-policy.
   *
   * Implementasjon aktiveres i PR-W2. I PR-W1 trekker debit fortsatt fra
   * deposit-siden (samme netto-oppførsel som før split for eksisterende
   * testsuiter). Returverdien inkluderer `split`-feltet så kall-sites kan
   * forberede loss-limit-integrasjon i PR-W5.
   */
  debit(accountId: string, amount: number, reason: string, options?: TransactionOptions): Promise<WalletTransaction>;
  /**
   * Credit — kreder wallet. `options.to` velger målkonto (`"deposit"` default).
   *
   * **Regulatorisk-krav:** `to: "winnings"` er kun tillatt fra game-engine
   * (payout-flyt). Admin-routes kan aldri sende `"winnings"` — se
   * CreditOptions-JSDoc.
   */
  credit(accountId: string, amount: number, reason: string, options?: CreditOptions): Promise<WalletTransaction>;
  /** Topup — alltid til deposit-siden (PM-beslutning, ikke overstyrbar). */
  topUp(accountId: string, amount: number, reason?: string, options?: TransactionOptions): Promise<WalletTransaction>;
  /** Withdraw — winnings-first-policy (PM-beslutning). */
  withdraw(accountId: string, amount: number, reason?: string, options?: TransactionOptions): Promise<WalletTransaction>;
  transfer(fromAccountId: string, toAccountId: string, amount: number, reason?: string, options?: TransactionOptions): Promise<WalletTransferResult>;
  listTransactions(accountId: string, limit?: number): Promise<WalletTransaction[]>;
}
