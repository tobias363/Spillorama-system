import { randomUUID } from "node:crypto";
import type {
  CreateWalletAccountInput,
  WalletAccount,
  WalletAdapter,
  WalletTransaction,
  WalletTransactionType,
  WalletTransferResult
} from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type {
  ExternalWalletTransactionRequest,
  ExternalWalletTransactionResponse,
  ExternalWalletBalanceResponse
} from "./types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ExternalWalletAdapterOptions {
  /** Base URL for the provider's wallet API (e.g. "https://provider.example.com/api/wallet"). */
  baseUrl: string;
  /** API key or bearer token for authenticating with the provider. */
  apiKey?: string;
  /** HTTP timeout in milliseconds. Default 5000. */
  timeoutMs?: number;
  /** ISO 4217 currency code. Default "NOK". */
  currency?: string;
  /** Circuit breaker: consecutive failures before opening. Default 5. */
  circuitBreakerThreshold?: number;
  /** Circuit breaker: reset timeout in ms. Default 30000. */
  circuitBreakerResetMs?: number;
}

// ---------------------------------------------------------------------------
// Circuit breaker state
// ---------------------------------------------------------------------------

interface CircuitBreakerState {
  consecutiveFailures: number;
  openUntilMs: number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * WalletAdapter implementation that delegates to an external provider's
 * wallet API (balance / debit / credit).
 *
 * BingoEngine calls `transfer(player, house, amount)` for buy-in and
 * `transfer(house, player, amount)` for payouts. This adapter maps those
 * calls to debit/credit on the provider side:
 *
 *   transfer(player → house) → provider POST /debit
 *   transfer(house → player) → provider POST /credit
 *
 * House accounts (IDs starting with "house-") are virtual — they have no
 * balance on the provider side.
 */
export class ExternalWalletAdapter implements WalletAdapter {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly currency: string;
  private readonly cbThreshold: number;
  private readonly cbResetMs: number;

  /** Local transaction log for reconciliation. */
  private readonly localLedger: WalletTransaction[] = [];

  /** Virtual balances for house/system accounts. */
  private readonly virtualAccounts = new Map<string, WalletAccount>();

  /** Cached player balances (short TTL). */
  private readonly balanceCache = new Map<string, { balance: number; expiresAtMs: number }>();
  private readonly balanceCacheTtlMs = 5000;

  /** Circuit breaker. */
  private readonly cb: CircuitBreakerState = {
    consecutiveFailures: 0,
    openUntilMs: 0
  };

  constructor(options: ExternalWalletAdapterOptions) {
    if (!options.baseUrl?.trim()) {
      throw new WalletError("INVALID_WALLET_CONFIG", "WALLET_API_BASE_URL mangler.");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.currency = options.currency ?? "NOK";
    this.cbThreshold = options.circuitBreakerThreshold ?? 5;
    this.cbResetMs = options.circuitBreakerResetMs ?? 30_000;
  }

  // -----------------------------------------------------------------------
  // Account operations
  // -----------------------------------------------------------------------

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `ext-${randomUUID()}`;

    if (this.isHouseAccount(accountId)) {
      return this.ensureVirtualAccount(accountId);
    }

    // Player accounts exist on the provider side — we just fetch the balance.
    const balance = await this.fetchBalance(accountId);
    const now = new Date().toISOString();
    return { id: accountId, balance, createdAt: now, updatedAt: now };
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const id = this.assertAccountId(accountId);
    if (this.isHouseAccount(id)) {
      return this.ensureVirtualAccount(id);
    }
    return this.createAccount({ accountId: id, allowExisting: true });
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    const id = this.assertAccountId(accountId);
    if (this.isHouseAccount(id)) {
      return this.ensureVirtualAccount(id);
    }
    const balance = await this.fetchBalance(id);
    const now = new Date().toISOString();
    return { id, balance, createdAt: now, updatedAt: now };
  }

  async listAccounts(): Promise<WalletAccount[]> {
    // Only return known virtual (house) accounts; player accounts live on the provider.
    return [...this.virtualAccounts.values()].map((a) => ({ ...a }));
  }

  async getBalance(accountId: string): Promise<number> {
    const id = this.assertAccountId(accountId);
    if (this.isHouseAccount(id)) {
      return this.ensureVirtualAccount(id).balance;
    }
    return this.fetchBalance(id);
  }

  // -----------------------------------------------------------------------
  // Debit / Credit
  // -----------------------------------------------------------------------

  async debit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    this.assertPositiveAmount(amount);
    const id = this.assertAccountId(accountId);

    if (this.isHouseAccount(id)) {
      // House debit is virtual — just track locally.
      const account = this.ensureVirtualAccount(id);
      account.balance -= amount;
      account.updatedAt = new Date().toISOString();
      return this.recordLocalTx(id, "DEBIT", amount, reason);
    }

    // Player debit → call provider.
    const txId = randomUUID();
    const response = await this.providerDebit({
      playerId: id,
      amount,
      transactionId: txId,
      roundId: this.extractRoundId(reason),
      currency: this.currency
    });
    this.updateBalanceCache(id, response.balance);
    return this.recordLocalTx(id, "DEBIT", amount, reason);
  }

  async credit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    this.assertPositiveAmount(amount);
    const id = this.assertAccountId(accountId);

    if (this.isHouseAccount(id)) {
      const account = this.ensureVirtualAccount(id);
      account.balance += amount;
      account.updatedAt = new Date().toISOString();
      return this.recordLocalTx(id, "CREDIT", amount, reason);
    }

    // Player credit → call provider.
    const txId = randomUUID();
    const response = await this.providerCredit({
      playerId: id,
      amount,
      transactionId: txId,
      roundId: this.extractRoundId(reason),
      currency: this.currency
    });
    this.updateBalanceCache(id, response.balance);
    return this.recordLocalTx(id, "CREDIT", amount, reason);
  }

  // -----------------------------------------------------------------------
  // TopUp / Withdraw — not supported for external wallets
  // -----------------------------------------------------------------------

  async topUp(_accountId: string, _amount: number, _reason?: string): Promise<WalletTransaction> {
    throw new WalletError(
      "NOT_SUPPORTED",
      "TopUp støttes ikke for ekstern lommebok — leverandøren administrerer innskudd."
    );
  }

  async withdraw(_accountId: string, _amount: number, _reason?: string): Promise<WalletTransaction> {
    throw new WalletError(
      "NOT_SUPPORTED",
      "Withdraw støttes ikke for ekstern lommebok — leverandøren administrerer uttak."
    );
  }

  // -----------------------------------------------------------------------
  // Transfer — the main method BingoEngine calls
  // -----------------------------------------------------------------------

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Wallet transfer"
  ): Promise<WalletTransferResult> {
    const fromId = this.assertAccountId(fromAccountId);
    const toId = this.assertAccountId(toAccountId);
    if (fromId === toId) {
      throw new WalletError("INVALID_TRANSFER", "Kan ikke overføre til samme wallet.");
    }
    this.assertPositiveAmount(amount);

    const fromIsHouse = this.isHouseAccount(fromId);
    const toIsHouse = this.isHouseAccount(toId);

    if (!fromIsHouse && toIsHouse) {
      // Player → House = BUY-IN → debit player on provider side.
      const txId = randomUUID();
      const response = await this.providerDebit({
        playerId: fromId,
        amount,
        transactionId: txId,
        roundId: this.extractRoundId(reason),
        currency: this.currency
      });
      this.updateBalanceCache(fromId, response.balance);

      // Track house side virtually.
      const houseAccount = this.ensureVirtualAccount(toId);
      houseAccount.balance += amount;
      houseAccount.updatedAt = new Date().toISOString();

      const fromTx = this.recordLocalTx(fromId, "TRANSFER_OUT", amount, reason, toId);
      const toTx = this.recordLocalTx(toId, "TRANSFER_IN", amount, reason, fromId);
      return { fromTx, toTx };
    }

    if (fromIsHouse && !toIsHouse) {
      // House → Player = PAYOUT → credit player on provider side.
      const txId = randomUUID();
      const response = await this.providerCredit({
        playerId: toId,
        amount,
        transactionId: txId,
        roundId: this.extractRoundId(reason),
        currency: this.currency
      });
      this.updateBalanceCache(toId, response.balance);

      // Track house side virtually.
      const houseAccount = this.ensureVirtualAccount(fromId);
      houseAccount.balance -= amount;
      houseAccount.updatedAt = new Date().toISOString();

      const fromTx = this.recordLocalTx(fromId, "TRANSFER_OUT", amount, reason, toId);
      const toTx = this.recordLocalTx(toId, "TRANSFER_IN", amount, reason, fromId);
      return { fromTx, toTx };
    }

    if (fromIsHouse && toIsHouse) {
      // House → House: purely virtual.
      const from = this.ensureVirtualAccount(fromId);
      const to = this.ensureVirtualAccount(toId);
      from.balance -= amount;
      from.updatedAt = new Date().toISOString();
      to.balance += amount;
      to.updatedAt = new Date().toISOString();
      const fromTx = this.recordLocalTx(fromId, "TRANSFER_OUT", amount, reason, toId);
      const toTx = this.recordLocalTx(toId, "TRANSFER_IN", amount, reason, fromId);
      return { fromTx, toTx };
    }

    // Player → Player: not expected in normal game flow.
    throw new WalletError(
      "NOT_SUPPORTED",
      "Overføring mellom to spillerkontoer støttes ikke i integrasjonsmodus."
    );
  }

  // -----------------------------------------------------------------------
  // Transaction log
  // -----------------------------------------------------------------------

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    const id = this.assertAccountId(accountId);
    return this.localLedger
      .filter((tx) => tx.accountId === id)
      .slice(-limit)
      .reverse()
      .map((tx) => ({ ...tx }));
  }

  /** Expose the full local ledger for reconciliation jobs. */
  getFullLedger(): WalletTransaction[] {
    return this.localLedger.map((tx) => ({ ...tx }));
  }

  // -----------------------------------------------------------------------
  // Provider HTTP calls
  // -----------------------------------------------------------------------

  private async fetchBalance(playerId: string): Promise<number> {
    // Check cache first.
    const cached = this.balanceCache.get(playerId);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.balance;
    }

    this.assertCircuitClosed();
    const url = `${this.baseUrl}/balance?playerId=${encodeURIComponent(playerId)}`;

    try {
      const data = await this.httpRequest<ExternalWalletBalanceResponse>("GET", url);
      this.cbSuccess();
      this.updateBalanceCache(playerId, data.balance);
      return data.balance;
    } catch (error) {
      this.cbFailure();
      throw error;
    }
  }

  private async providerDebit(
    req: ExternalWalletTransactionRequest
  ): Promise<ExternalWalletTransactionResponse> {
    this.assertCircuitClosed();
    const url = `${this.baseUrl}/debit`;

    try {
      const data = await this.httpRequest<ExternalWalletTransactionResponse>("POST", url, req);
      if (!data.success) {
        const code = data.errorCode ?? "WALLET_API_ERROR";
        throw new WalletError(code, data.errorMessage ?? `Debit avvist: ${code}`);
      }
      this.cbSuccess();
      return data;
    } catch (error) {
      if (error instanceof WalletError && error.code === "INSUFFICIENT_FUNDS") {
        // Insufficient funds is a business error, not an infra failure — don't trip breaker.
        throw error;
      }
      this.cbFailure();
      throw error;
    }
  }

  private async providerCredit(
    req: ExternalWalletTransactionRequest
  ): Promise<ExternalWalletTransactionResponse> {
    // Credits (payouts) are critical — retry with exponential backoff.
    const maxAttempts = 5;
    const baseDelayMs = 1000;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        this.assertCircuitClosed();
        const url = `${this.baseUrl}/credit`;
        const data = await this.httpRequest<ExternalWalletTransactionResponse>("POST", url, req);
        if (!data.success) {
          const code = data.errorCode ?? "WALLET_API_ERROR";
          // DUPLICATE_TRANSACTION means a prior retry succeeded — treat as success.
          if (code === "DUPLICATE_TRANSACTION") {
            this.cbSuccess();
            return data;
          }
          throw new WalletError(code, data.errorMessage ?? `Credit avvist: ${code}`);
        }
        this.cbSuccess();
        return data;
      } catch (error) {
        lastError = error;
        this.cbFailure();

        if (attempt < maxAttempts - 1) {
          const delayMs = baseDelayMs * Math.pow(2, attempt);
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -----------------------------------------------------------------------
  // Generic HTTP helper
  // -----------------------------------------------------------------------

  private async httpRequest<T>(
    method: "GET" | "POST",
    url: string,
    body?: object
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new WalletError(
          "INVALID_WALLET_RESPONSE",
          `Ugyldig JSON fra leverandør-API (${response.status}).`
        );
      }

      if (!response.ok) {
        const data = parsed as Partial<ExternalWalletTransactionResponse> | undefined;
        const code = data?.errorCode ?? this.httpStatusToCode(response.status);
        const message = data?.errorMessage ?? `Leverandør-API feilet (${response.status}).`;
        throw new WalletError(code, message);
      }

      return parsed as T;
    } catch (error) {
      if (error instanceof WalletError) {
        throw error;
      }
      if ((error as Error).name === "AbortError") {
        throw new WalletError("WALLET_TIMEOUT", "Timeout ved kall mot leverandør-API.");
      }
      throw new WalletError("WALLET_UNAVAILABLE", "Kunne ikke kontakte leverandør-API.");
    } finally {
      clearTimeout(timeout);
    }
  }

  // -----------------------------------------------------------------------
  // Circuit breaker helpers
  // -----------------------------------------------------------------------

  private assertCircuitClosed(): void {
    if (this.cb.openUntilMs > 0 && Date.now() < this.cb.openUntilMs) {
      throw new WalletError(
        "WALLET_UNAVAILABLE",
        "Circuit breaker åpen — leverandør-API er midlertidig utilgjengelig."
      );
    }
    // Auto-reset: if the open window has passed, allow the next request through.
    if (this.cb.openUntilMs > 0 && Date.now() >= this.cb.openUntilMs) {
      this.cb.openUntilMs = 0;
      this.cb.consecutiveFailures = 0;
    }
  }

  private cbSuccess(): void {
    this.cb.consecutiveFailures = 0;
    this.cb.openUntilMs = 0;
  }

  private cbFailure(): void {
    this.cb.consecutiveFailures++;
    if (this.cb.consecutiveFailures >= this.cbThreshold) {
      this.cb.openUntilMs = Date.now() + this.cbResetMs;
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private isHouseAccount(accountId: string): boolean {
    return accountId.startsWith("house-") || accountId.startsWith("__");
  }

  private ensureVirtualAccount(accountId: string): WalletAccount {
    const existing = this.virtualAccounts.get(accountId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const account: WalletAccount = {
      id: accountId,
      balance: 0,
      createdAt: now,
      updatedAt: now
    };
    this.virtualAccounts.set(accountId, account);
    return account;
  }

  private recordLocalTx(
    accountId: string,
    type: WalletTransactionType,
    amount: number,
    reason: string,
    relatedAccountId?: string
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
    this.localLedger.push(tx);
    return { ...tx };
  }

  private updateBalanceCache(playerId: string, balance: number): void {
    this.balanceCache.set(playerId, {
      balance,
      expiresAtMs: Date.now() + this.balanceCacheTtlMs
    });
  }

  private extractRoundId(reason: string): string {
    // BingoEngine passes reasons like "Bingo buy-in ABCD" or "Line prize ABCD".
    // Extract the room/round code from the end.
    const parts = reason.split(/\s+/);
    return parts[parts.length - 1] || randomUUID();
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

  private httpStatusToCode(status: number): string {
    if (status === 402) return "INSUFFICIENT_FUNDS";
    if (status === 404) return "PLAYER_NOT_FOUND";
    if (status === 409) return "DUPLICATE_TRANSACTION";
    if (status === 429) return "RATE_LIMITED";
    if (status >= 500) return "WALLET_API_ERROR";
    return "WALLET_API_REQUEST_FAILED";
  }
}
