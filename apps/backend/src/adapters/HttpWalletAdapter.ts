import type {
  CreateWalletAccountInput,
  CreditOptions,
  TransactionOptions,
  WalletAccount,
  WalletAdapter,
  WalletBalance,
  WalletTransaction,
  WalletTransactionSplit,
  WalletTransferResult
} from "./WalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";
import { CircuitBreaker, CircuitBreakerOpenError } from "../util/CircuitBreaker.js";

interface HttpWalletAdapterOptions {
  baseUrl: string;
  apiPrefix?: string;
  apiKey?: string;
  timeoutMs?: number;
  defaultInitialBalance?: number;
}

interface ApiErrorPayload {
  code?: string;
  message?: string;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: ApiErrorPayload;
}

function toWalletErrorCodeFromStatus(status: number): string {
  if (status === 400) {
    return "INVALID_INPUT";
  }
  if (status === 401 || status === 403) {
    return "UNAUTHORIZED";
  }
  if (status === 404) {
    return "ACCOUNT_NOT_FOUND";
  }
  if (status === 409) {
    return "ACCOUNT_EXISTS";
  }
  if (status === 429) {
    return "RATE_LIMITED";
  }
  if (status >= 500) {
    return "WALLET_API_ERROR";
  }
  return "WALLET_API_REQUEST_FAILED";
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toWalletAccount(payload: unknown): WalletAccount {
  if (!payload || typeof payload !== "object") {
    throw new WalletError("INVALID_WALLET_RESPONSE", "Ugyldig account payload fra wallet-API.");
  }
  const raw = payload as Record<string, unknown>;
  const id = asNonEmptyString(raw.id) ?? asNonEmptyString(raw.walletId) ?? asNonEmptyString(raw.accountId);
  const balance = asFiniteNumber(raw.balance);
  const createdAt = asNonEmptyString(raw.createdAt) ?? new Date().toISOString();
  const updatedAt = asNonEmptyString(raw.updatedAt) ?? createdAt;
  if (!id || balance === null) {
    throw new WalletError("INVALID_WALLET_RESPONSE", "Mangler id eller balance i wallet account.");
  }
  // PR-W1: splitt-felter er opt-in fra HTTP-API. Hvis API ikke returnerer dem
  // (legacy wallet-service), faller vi tilbake til: hele balance = deposit,
  // winnings = 0. Dette matcher migration-strategy for eksisterende data.
  const depositBalance = asFiniteNumber(raw.depositBalance) ?? balance;
  const winningsBalance = asFiniteNumber(raw.winningsBalance) ?? 0;
  return { id, balance, depositBalance, winningsBalance, createdAt, updatedAt };
}

function toWalletTransaction(payload: unknown): WalletTransaction {
  if (!payload || typeof payload !== "object") {
    throw new WalletError("INVALID_WALLET_RESPONSE", "Ugyldig transaction payload fra wallet-API.");
  }
  const raw = payload as Record<string, unknown>;
  const id = asNonEmptyString(raw.id);
  const accountId =
    asNonEmptyString(raw.accountId) ?? asNonEmptyString(raw.walletId) ?? asNonEmptyString(raw.account);
  const type = asNonEmptyString(raw.type);
  const amount = asFiniteNumber(raw.amount);
  const reason = asNonEmptyString(raw.reason) ?? "Wallet transaction";
  const createdAt = asNonEmptyString(raw.createdAt) ?? asNonEmptyString(raw.timestamp) ?? new Date().toISOString();
  const relatedAccountId =
    asNonEmptyString(raw.relatedAccountId) ??
    asNonEmptyString(raw.relatedWalletId) ??
    asNonEmptyString(raw.counterpartyAccountId);

  if (!id || !accountId || !type || amount === null) {
    throw new WalletError("INVALID_WALLET_RESPONSE", "Mangler felter i wallet transaction.");
  }

  // PR-W1: split-felt er opsjonelt fra HTTP-API. Hvis wallet-service ikke
  // returnerer det, forblir `split` undefined (legacy-oppførsel).
  let split: WalletTransactionSplit | undefined;
  const splitPayload = raw.split;
  if (splitPayload && typeof splitPayload === "object") {
    const splitRaw = splitPayload as Record<string, unknown>;
    const fromDeposit = asFiniteNumber(splitRaw.fromDeposit);
    const fromWinnings = asFiniteNumber(splitRaw.fromWinnings);
    if (fromDeposit !== null && fromWinnings !== null) {
      split = { fromDeposit, fromWinnings };
    }
  }

  return {
    id,
    accountId,
    type: type as WalletTransaction["type"],
    amount,
    reason,
    createdAt,
    relatedAccountId: relatedAccountId ?? undefined,
    split
  };
}

function toWalletTransferResult(payload: unknown): WalletTransferResult {
  if (!payload || typeof payload !== "object") {
    throw new WalletError("INVALID_WALLET_RESPONSE", "Ugyldig transfer payload fra wallet-API.");
  }

  const raw = payload as Record<string, unknown>;
  const fromSource = raw.fromTx ?? raw.debitTx ?? raw.fromTransaction;
  const toSource = raw.toTx ?? raw.creditTx ?? raw.toTransaction;

  if (!fromSource || !toSource) {
    throw new WalletError("INVALID_WALLET_RESPONSE", "Transfer payload mangler from/to transaction.");
  }

  return {
    fromTx: toWalletTransaction(fromSource),
    toTx: toWalletTransaction(toSource)
  };
}

export class HttpWalletAdapter implements WalletAdapter {
  private readonly baseUrl: string;

  private readonly apiPrefix: string;

  private readonly apiKey?: string;

  private readonly timeoutMs: number;

  private readonly defaultInitialBalance: number;

  /** BIN-165: Circuit breaker to prevent cascading failures when wallet API is down. */
  private readonly circuitBreaker: CircuitBreaker;

  constructor(options: HttpWalletAdapterOptions) {
    if (!options.baseUrl || !options.baseUrl.trim()) {
      throw new WalletError("INVALID_WALLET_CONFIG", "WALLET_API_BASE_URL mangler.");
    }
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.apiPrefix = options.apiPrefix ?? "/api";
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.defaultInitialBalance = options.defaultInitialBalance ?? 1000;
    this.circuitBreaker = new CircuitBreaker({ threshold: 5, resetMs: 30_000, name: "http-wallet" });
  }

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim();
    const initialBalance = input?.initialBalance ?? this.defaultInitialBalance;
    try {
      const payload = await this.request<unknown>("POST", "/wallets", {
        walletId: accountId || undefined,
        initialBalance
      });
      return toWalletAccount(payload);
    } catch (error) {
      if (error instanceof WalletError && error.code === "ACCOUNT_EXISTS" && input?.allowExisting && accountId) {
        return this.getAccount(accountId);
      }
      throw error;
    }
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const id = accountId.trim();
    if (!id) {
      throw new WalletError("INVALID_ACCOUNT_ID", "walletId kan ikke være tom.");
    }
    try {
      return await this.getAccount(id);
    } catch (error) {
      if (error instanceof WalletError && error.code === "ACCOUNT_NOT_FOUND") {
        return this.createAccount({
          accountId: id,
          allowExisting: true,
          initialBalance: this.defaultInitialBalance
        });
      }
      throw error;
    }
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    const id = accountId.trim();
    if (!id) {
      throw new WalletError("INVALID_ACCOUNT_ID", "walletId kan ikke være tom.");
    }
    const payload = await this.request<unknown>("GET", `/wallets/${encodeURIComponent(id)}`);
    if (payload && typeof payload === "object" && "account" in (payload as Record<string, unknown>)) {
      return toWalletAccount((payload as Record<string, unknown>).account);
    }
    return toWalletAccount(payload);
  }

  async listAccounts(): Promise<WalletAccount[]> {
    const payload = await this.request<unknown>("GET", "/wallets");
    const values = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && "accounts" in (payload as Record<string, unknown>)
      ? (payload as Record<string, unknown>).accounts
      : null;
    if (!Array.isArray(values)) {
      throw new WalletError("INVALID_WALLET_RESPONSE", "Wallet list returnerte ugyldig format.");
    }
    return values.map(toWalletAccount);
  }

  async getBalance(accountId: string): Promise<number> {
    const account = await this.getAccount(accountId);
    return account.balance;
  }

  async getDepositBalance(accountId: string): Promise<number> {
    const account = await this.getAccount(accountId);
    return account.depositBalance;
  }

  async getWinningsBalance(accountId: string): Promise<number> {
    const account = await this.getAccount(accountId);
    return account.winningsBalance;
  }

  async getBothBalances(accountId: string): Promise<WalletBalance> {
    const account = await this.getAccount(accountId);
    return {
      deposit: account.depositBalance,
      winnings: account.winningsBalance,
      total: account.balance
    };
  }

  async debit(accountId: string, amount: number, reason: string, options?: TransactionOptions): Promise<WalletTransaction> {
    const id = accountId.trim();
    const payload = await this.request<unknown>("POST", `/wallets/${encodeURIComponent(id)}/debit`, {
      amount,
      reason,
      idempotencyKey: options?.idempotencyKey
    });
    return toWalletTransaction(payload);
  }

  async credit(accountId: string, amount: number, reason: string, options?: CreditOptions): Promise<WalletTransaction> {
    const id = accountId.trim();
    // PR-W1: send `to` i HTTP-payload hvis gitt. Legacy wallet-service som ikke
    // gjenkjenner feltet ignorerer det og kreder default (deposit) — matcher vår
    // default-oppførsel.
    const payload = await this.request<unknown>("POST", `/wallets/${encodeURIComponent(id)}/credit`, {
      amount,
      reason,
      idempotencyKey: options?.idempotencyKey,
      to: options?.to
    });
    return toWalletTransaction(payload);
  }

  async topUp(accountId: string, amount: number, reason = "Manual top-up", options?: TransactionOptions): Promise<WalletTransaction> {
    const id = accountId.trim();
    const payload = await this.request<unknown>("POST", `/wallets/${encodeURIComponent(id)}/topup`, {
      amount,
      reason,
      idempotencyKey: options?.idempotencyKey
    });
    return toWalletTransaction(payload);
  }

  async withdraw(accountId: string, amount: number, reason = "Manual withdrawal", options?: TransactionOptions): Promise<WalletTransaction> {
    const id = accountId.trim();
    const payload = await this.request<unknown>("POST", `/wallets/${encodeURIComponent(id)}/withdraw`, {
      amount,
      reason,
      idempotencyKey: options?.idempotencyKey
    });
    return toWalletTransaction(payload);
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Wallet transfer",
    options?: TransactionOptions
  ): Promise<WalletTransferResult> {
    const payload = await this.request<unknown>("POST", "/wallets/transfer", {
      fromWalletId: fromAccountId,
      toWalletId: toAccountId,
      amount,
      reason,
      idempotencyKey: options?.idempotencyKey
    });
    return toWalletTransferResult(payload);
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    const id = accountId.trim();
    const payload = await this.request<unknown>(
      "GET",
      `/wallets/${encodeURIComponent(id)}/transactions?limit=${encodeURIComponent(String(limit))}`
    );
    const values = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && "transactions" in (payload as Record<string, unknown>)
      ? (payload as Record<string, unknown>).transactions
      : null;
    if (!Array.isArray(values)) {
      throw new WalletError("INVALID_WALLET_RESPONSE", "Transactions returnerte ugyldig format.");
    }
    return values.map(toWalletTransaction);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    // BIN-165: Circuit breaker check before making the request
    try {
      this.circuitBreaker.assertClosed();
    } catch (err) {
      if (err instanceof CircuitBreakerOpenError) {
        throw new WalletError("WALLET_API_UNAVAILABLE", err.message);
      }
      throw err;
    }

    const url = this.makeUrl(path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: "application/json"
      };
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
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }

      if (!response.ok) {
        // BIN-165: Trip circuit breaker on server errors (5xx), not business errors (4xx)
        if (response.status >= 500) {
          this.circuitBreaker.onFailure();
        }
        const apiMessage =
          parsed &&
          typeof parsed === "object" &&
          "error" in (parsed as Record<string, unknown>) &&
          typeof (parsed as Record<string, unknown>).error === "object"
            ? asNonEmptyString(
                ((parsed as Record<string, unknown>).error as Record<string, unknown>).message
              )
            : null;
        const message =
          apiMessage ?? `Wallet API feilet (${response.status}) ved ${method} ${this.makeRelativePath(path)}.`;
        throw new WalletError(toWalletErrorCodeFromStatus(response.status), message);
      }

      if (parsed && typeof parsed === "object" && "ok" in (parsed as Record<string, unknown>)) {
        const envelope = parsed as ApiEnvelope<T>;
        if (!envelope.ok) {
          throw new WalletError(
            envelope.error?.code ?? "WALLET_API_ERROR",
            envelope.error?.message ?? "Wallet API returnerte ok=false."
          );
        }
        return envelope.data as T;
      }

      // BIN-165: Successful response — reset circuit breaker
      this.circuitBreaker.onSuccess();
      return parsed as T;
    } catch (error) {
      if (error instanceof WalletError) {
        throw error;
      }
      // BIN-165: Infra failure — trip circuit breaker
      this.circuitBreaker.onFailure();
      if ((error as Error).name === "AbortError") {
        throw new WalletError("WALLET_API_TIMEOUT", "Timeout ved kall mot wallet-API.");
      }
      throw new WalletError("WALLET_API_UNAVAILABLE", "Kunne ikke kontakte wallet-API.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private makeUrl(path: string): string {
    const relative = this.makeRelativePath(path);
    return new URL(relative, this.baseUrl).toString();
  }

  private makeRelativePath(path: string): string {
    const normalizedPrefix = this.apiPrefix.startsWith("/") ? this.apiPrefix : `/${this.apiPrefix}`;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedPrefix}${normalizedPath}`;
  }
}

