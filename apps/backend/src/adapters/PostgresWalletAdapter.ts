import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import { getPoolTuning } from "../util/pgPool.js";
import { CircuitBreaker, CircuitBreakerOpenError, type CircuitState } from "../util/CircuitBreaker.js";
import { metrics } from "../util/metrics.js";
import { withWalletTx } from "../wallet/walletTxRetry.js";
import type {
  CommitReservationOptions,
  CreateWalletAccountInput,
  CreditOptions,
  CreditWithClientOptions,
  ReserveOptions,
  TransactionOptions,
  TransferOptions,
  WalletAccount,
  WalletAccountSide,
  WalletAdapter,
  WalletBalance,
  WalletReservation,
  WalletTransaction,
  WalletTransactionSplit,
  WalletTransferResult
} from "./WalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";
import type { WalletOutboxRepo } from "../wallet/WalletOutboxRepo.js";

type EntrySide = "DEBIT" | "CREDIT";

interface PostgresWalletAdapterOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the adapter
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
  ssl?: boolean;
  defaultInitialBalance?: number;
  /**
   * HIGH-8: tuning for the wallet circuit breaker. Defaults match
   * Pragmatic-Play-style behavior — open after 3 consecutive failures,
   * 30 s cool-down, half-open admits one probe. Tests override these
   * to inject deterministic timings; production code should leave them.
   */
  circuitBreaker?: {
    /** Consecutive failures before opening the circuit. Default: 3. */
    threshold?: number;
    /** Cool-down before transitioning OPEN → HALF_OPEN. Default: 30_000 ms. */
    resetMs?: number;
    /** Disable the breaker entirely (e.g. in tests that exercise raw DB code). */
    enabled?: boolean;
  };
  /**
   * BIN-761: Optional outbox repo. When set, every successful ledger
   * execution writes one event-row per non-system inserted transaction in
   * the SAME db-tx as ledger-INSERT. Worker (`WalletOutboxWorker`) polls
   * and dispatches asynchronously. Atomic guarantee: ledger commit ↔
   * outbox row. When unset, behavior is unchanged (backward-compatible).
   */
  outboxRepo?: WalletOutboxRepo;
}

const WALLET_CIRCUIT_NAME = "postgres-wallet";
const WALLET_CIRCUIT_STATES: CircuitState[] = ["CLOSED", "OPEN", "HALF_OPEN"];

/**
 * HIGH-8 re-entrancy guard. AsyncLocalStorage tracks per-async-context
 * whether we're already inside a breaker-wrapped call on this adapter.
 * When the inner write method calls another wrapped method (e.g.
 * `transfer` → `ensureAccount`), the inner `withBreaker` sees the
 * marker and bypasses the breaker so a single user-visible failure
 * isn't double-counted. Concurrent independent callers each get their
 * own context, so they're not affected.
 */
const breakerContext = new AsyncLocalStorage<true>();

interface AccountRow {
  id: string;
  balance: string | number;
  deposit_balance: string | number;
  winnings_balance: string | number;
  is_system: boolean;
  /** BIN-766: ISO 4217-valuta. NOK-only nå (DB CHECK-constraint). */
  currency?: string | null;
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

// ── BIN-764 Hash-chain audit trail ─────────────────────────────────────────
//
// Casino-grade tamper-evident audit-trail for wallet_entries. Hver entry får
// `entry_hash = SHA256(previous_entry_hash + canonical_json(entry_data))`.
// Per-konto-kjede: `previous_entry_hash` peker på forrige entry for samme
// `account_id`. Genesis-rad (første entry per konto) bruker zero-hash.
//
// Lotteritilsynet-revisjon kan walke kjeden og verifisere at logger ikke er
// manipulert post-hoc. WalletAuditVerifier kjører nightly og alarmerer på
// mismatch. Microgaming-pattern siden 2014.

/** Genesis-hash for første rad i hver konto-kjede (64 hex-zeros = SHA-256-bredde). */
export const WALLET_HASH_CHAIN_GENESIS = "0".repeat(64);

/**
 * Felter som inngår i hash-input. Eksplisitt valgt + sortert for å garantere
 * cross-platform/cross-version-stabilitet. Endring av disse feltene KAN ikke
 * gjøres uten en re-hash-migration.
 */
export interface WalletEntryHashInput {
  /** wallet_entries.id (BIGSERIAL → string for JSON-stabilitet). */
  id: string;
  operation_id: string;
  account_id: string;
  side: "DEBIT" | "CREDIT";
  /** Beløp som streng — undgår JS-float-flekkete JSON-output. */
  amount: string;
  transaction_id: string | null;
  account_side: "deposit" | "winnings";
  /** ISO-8601 UTC. */
  created_at: string;
}

/**
 * Canonical JSON for hash-input. Sorterer nøkler alfabetisk slik at samme rad
 * gir samme hash uavhengig av insert-rekkefølge. Bruker
 * `JSON.stringify(value, sortedKeys)` som er deterministisk i Node.
 */
export function canonicalJsonForEntry(input: WalletEntryHashInput): string {
  const keys = Object.keys(input).sort();
  return JSON.stringify(input, keys);
}

/**
 * SHA-256 hex over `previousHash + canonicalJson(input)`.
 * `previousHash` er forrige rad sin entry_hash (eller GENESIS for første rad).
 */
export function computeEntryHash(previousHash: string, input: WalletEntryHashInput): string {
  return createHash("sha256")
    .update(previousHash, "utf8")
    .update(canonicalJsonForEntry(input), "utf8")
    .digest("hex");
}

export class PostgresWalletAdapter implements WalletAdapter {
  private readonly pool: Pool;

  private readonly schema: string;

  private readonly defaultInitialBalance: number;

  private initPromise: Promise<void> | null = null;

  private readonly houseAccountId = "__system_house__";

  private readonly externalCashAccountId = "__system_external_cash__";

  /**
   * HIGH-8: circuit breaker around DB write paths. `null` when disabled
   * (e.g. opt-out via constructor for unit tests that hit a real DB
   * and need raw-error semantics).
   */
  private readonly breaker: CircuitBreaker | null;

  /** BIN-761: optional outbox repo. Set via constructor or `setOutboxRepo()`. */
  private outboxRepo: WalletOutboxRepo | undefined;

  constructor(options: PostgresWalletAdapterOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    this.defaultInitialBalance = options.defaultInitialBalance ?? 1000;
    if (!Number.isFinite(this.defaultInitialBalance) || this.defaultInitialBalance < 0) {
      throw new WalletError("INVALID_WALLET_CONFIG", "WALLET_DEFAULT_INITIAL_BALANCE må være 0 eller større.");
    }

    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
        ...getPoolTuning()
      });
    } else {
      throw new WalletError("INVALID_WALLET_CONFIG", "PostgresWalletAdapter krever pool eller connectionString.");
    }

    const breakerEnabled = options.circuitBreaker?.enabled ?? true;
    this.breaker = breakerEnabled
      ? new CircuitBreaker({
          name: WALLET_CIRCUIT_NAME,
          threshold: options.circuitBreaker?.threshold ?? 3,
          resetMs: options.circuitBreaker?.resetMs ?? 30_000,
          onStateChange: (state) => {
            // HIGH-8: keep wallet_circuit_state{state} in sync with
            // the breaker. Only one label is "1" at a time so dashboards
            // can alert on time-spent in OPEN/HALF_OPEN.
            for (const candidate of WALLET_CIRCUIT_STATES) {
              metrics.walletCircuitState.set({ state: candidate }, candidate === state ? 1 : 0);
            }
          },
        })
      : null;

    this.outboxRepo = options.outboxRepo;
  }

  /**
   * HIGH-8: run a DB write through the breaker. Maps
   * `CircuitBreakerOpenError` to a Norwegian-language `WalletError` so
   * upstream callers (game engine, payout) can surface a friendly
   * message instead of leaking internal breaker terminology.
   *
   * Re-entrancy: an inner breaker-wrapped call (e.g. `transfer`'s
   * internal `ensureAccount`) bypasses the breaker because the outer
   * wrap already records success/failure. AsyncLocalStorage scopes the
   * marker to the current async chain so concurrent independent callers
   * each go through the breaker normally.
   *
   * Read paths (getBalance, listAccounts, listTransactions) deliberately
   * bypass the breaker — failing-fast on those would mask the wallet's
   * actual state from operators looking at the admin UI. The cost of a
   * blocked read is small; the cost of a hung write is a stuck round.
   */
  private async withBreaker<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.breaker) {
      return fn();
    }
    if (breakerContext.getStore()) {
      // Already inside an outer breaker call in the same async chain —
      // don't double-count.
      return fn();
    }
    try {
      return await breakerContext.run(true, () => this.breaker!.execute(fn));
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        throw new WalletError(
          "WALLET_CIRCUIT_OPEN",
          "Lommebok midlertidig utilgjengelig. Prøv igjen om 30 sekunder.",
        );
      }
      throw error;
    }
  }

  /**
   * HIGH-8: test-only inspection hook. Returns the current breaker
   * state for tests to assert on. `null` when the breaker is disabled.
   */
  getCircuitState(): CircuitState | null {
    return this.breaker?.state ?? null;
  }

  /**
   * BIN-761: Wire up outbox-repo post-construction (lar `index.ts` opprette
   * adapter + repo i hvilken som helst rekkefølge med samme pool). Idempotent
   * — call multiple times if needed. Settes til `undefined` for å disable.
   */
  setOutboxRepo(repo: WalletOutboxRepo | undefined): void {
    this.outboxRepo = repo;
  }

  /** BIN-761: pool-aksess for outbox-repo + observability. */
  getPool(): Pool {
    return this.pool;
  }

  /** BIN-761: schema-aksess slik at outbox-repo bruker samme schema. */
  getSchema(): string {
    return this.schema;
  }

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    return this.withBreaker(() => this.createAccountImpl(input));
  }

  /**
   * HIGH-8: bypass-breaker variant for nested calls from other write
   * methods (e.g. `ensureAccountImpl` reaching here on ACCOUNT_NOT_FOUND).
   * The outer method already runs through the breaker; nesting again
   * would double-count the same logical failure.
   */
  private async createAccountImpl(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    await this.ensureInitialized();
    const accountId = this.normalizeUserWalletId(input?.accountId || `wallet-${randomUUID()}`);
    const initialBalance = input?.initialBalance ?? this.defaultInitialBalance;
    this.assertNonNegativeAmount(initialBalance);
    // FIXED-PRIZE-FIX: hus-konti markeres som system slik at de kan gå
    // negativt når faste premier overgår pool. Spiller-konti forblir
    // ikke-system (deposit/winnings >= 0 enforced).
    const isSystem = this.isSystemAccountId(accountId);

    try {
      // BIN-762: REPEATABLE READ + retry på 40001/40P01 via withWalletTx.
      return await withWalletTx(this.pool, async (client) => {
        const existing = await this.selectAccountForUpdate(client, accountId);
        if (existing) {
          if (input?.allowExisting) {
            return this.toWalletAccount(existing);
          }
          throw new WalletError("ACCOUNT_EXISTS", `Wallet ${accountId} finnes allerede.`);
        }

        await this.insertAccount(client, accountId, isSystem);
        // System-konti (house-*) skal IKKE få initial-funding via
        // external_cash. De starter på 0 og fyller seg fra player-stakes
        // (eller går negativt når faste premier overgår pool).
        if (!isSystem && initialBalance > 0) {
          const operationId = randomUUID();
          const txId = randomUUID();
          await this.executeLedger(client, {
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
          });
        }

        const created = await this.selectAccountForUpdate(client, accountId);
        if (!created) {
          throw new WalletError(
            "ACCOUNT_NOT_FOUND",
            `Wallet ${accountId} finnes ikke etter opprettelse.`
          );
        }
        return this.toWalletAccount(created);
      });
    } catch (error) {
      // Bevar tidligere `allowExisting + 23505` race-fallback. WalletError og
      // WALLET_SERIALIZATION_FAILURE propageres uendret via wrapError.
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
    }
  }

  /**
   * HIGH-8: `ensureAccount` may write (via `createAccount` on the
   * not-found path), so it goes through the breaker. The
   * `breakerContext` AsyncLocalStorage marker prevents double-counting
   * when an outer write method (transfer, debit, ...) already wrapped
   * its call.
   */
  async ensureAccount(accountId: string): Promise<WalletAccount> {
    return this.withBreaker(() => this.ensureAccountImpl(accountId));
  }

  private async ensureAccountImpl(accountId: string): Promise<WalletAccount> {
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
    return this.withBreaker(async () => {
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
    });
  }

  async credit(accountId: string, amount: number, reason: string, options?: CreditOptions): Promise<WalletTransaction> {
    return this.withBreaker(async () => {
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
    });
  }

  /**
   * CRIT-5 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26): credit som deltar i
   * caller's allerede-åpne transaksjon. Brukes av
   * Game1MiniGameOrchestrator slik at wallet-credit + UPDATE av
   * `completed_at` skjer atomisk.
   *
   * Forventer at caller har kjørt `BEGIN` på passed `client` og vil
   * `COMMIT`/`ROLLBACK` selv. Adapteret kjører IKKE BEGIN/COMMIT —
   * bare ledger-operasjonene mot den passede client.
   *
   * Idempotency: hvis `idempotencyKey` allerede er brukt, returneres
   * eksisterende transaksjon UTEN å skrive ny. Caller's tx forblir
   * trygt — vi har bare gjort en SELECT.
   */
  async creditWithClient(
    accountId: string,
    amount: number,
    reason: string,
    options: CreditWithClientOptions,
  ): Promise<WalletTransaction> {
    return this.withBreaker(async () => {
      const client = options.client as PoolClient;
      if (!client || typeof client.query !== "function") {
        throw new WalletError(
          "INVALID_WALLET_CLIENT",
          "creditWithClient krever en gyldig PoolClient via options.client.",
        );
      }
      const normalized = this.normalizeUserWalletId(accountId);
      this.assertPositiveAmount(amount);
      const target: WalletAccountSide = options.to ?? "deposit";
      return this.singleAccountMovementWithClient(client, {
        accountId: normalized,
        type: "CREDIT",
        amount,
        reason: reason || "Credit",
        fromAccountId: this.houseAccountId,
        toAccountId: normalized,
        idempotencyKey: options.idempotencyKey,
        creditTarget: target,
      });
    });
  }

  async topUp(accountId: string, amount: number, reason = "Manual top-up", options?: TransactionOptions): Promise<WalletTransaction> {
    return this.withBreaker(async () => {
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
    });
  }

  async withdraw(accountId: string, amount: number, reason = "Manual withdrawal", options?: TransactionOptions): Promise<WalletTransaction> {
    return this.withBreaker(async () => {
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
    });
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Wallet transfer",
    options?: TransferOptions
  ): Promise<WalletTransferResult> {
    return this.withBreaker(() => this.transferImpl(fromAccountId, toAccountId, amount, reason, options));
  }

  private async transferImpl(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason: string,
    options?: TransferOptions
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

    // PR-W3: targetSide styrer hvilken side CREDIT-siden lander på. Hvis
    // mottaker er systemkonto ignoreres feltet (CHECK-constraint winnings=0).
    const requestedTarget: WalletAccountSide = options?.targetSide ?? "deposit";

    try {
      // BIN-762: REPEATABLE READ + retry på 40001/40P01 via withWalletTx.
      return await withWalletTx(this.pool, async (client) => {
        const operationId = randomUUID();
        const fromTxId = randomUUID();
        const toTxId = randomUUID();

        // Les from-account inne i samme FOR UPDATE som executeLedger vil holde,
        // for å beregne winnings-first splitt atomisk.
        const fromAccount = await this.selectAccountForUpdate(client, fromId);
        if (!fromAccount) {
          throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${fromId} finnes ikke.`);
        }
        const toAccount = await this.selectAccountForUpdate(client, toId);
        if (!toAccount) {
          throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${toId} finnes ikke.`);
        }
        const fromState: InternalAccountState = {
          id: fromAccount.id,
          balance: asMoney(fromAccount.balance),
          depositBalance: asMoney(fromAccount.deposit_balance),
          winningsBalance: asMoney(fromAccount.winnings_balance),
          isSystem: fromAccount.is_system
        };

        // PR-W3: system-konto som avsender bruker deposit-siden (winnings = 0).
        // For brukerkonto: winnings-first-split.
        const fromSplit: WalletTransactionSplit = fromState.isSystem
          ? { fromDeposit: amount, fromWinnings: 0 }
          : splitDebitFromAccount(fromState, amount);

        // PR-W3: effektivt target — system-konto som mottaker tvinger deposit
        // (CHECK-constraint winnings_balance=0 for system).
        const effectiveTarget: WalletAccountSide = toAccount.is_system
          ? "deposit"
          : requestedTarget;

        const toSplit: WalletTransactionSplit =
          effectiveTarget === "winnings"
            ? { fromDeposit: 0, fromWinnings: amount }
            : { fromDeposit: amount, fromWinnings: 0 };

        const entries: LedgerEntryInput[] = [];
        // DEBIT-siden: avsender
        if (fromState.isSystem) {
          // System: alt på deposit (winnings er alltid 0).
          entries.push({
            operationId,
            accountId: fromId,
            side: "DEBIT",
            amount,
            transactionId: fromTxId,
            accountSide: "deposit"
          });
        } else {
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
        }
        // CREDIT-siden: mottaker — alt lander på effectiveTarget.
        entries.push({
          operationId,
          accountId: toId,
          side: "CREDIT",
          amount,
          transactionId: toTxId,
          accountSide: effectiveTarget
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
              idempotencyKey: options?.idempotencyKey,
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

        const fromTx = txRows.find((tx) => tx.id === fromTxId);
        const toTx = txRows.find((tx) => tx.id === toTxId);
        if (!fromTx || !toTx) {
          throw new WalletError(
            "INVALID_WALLET_RESPONSE",
            "Transfer mangler transaksjonsrader."
          );
        }
        return { fromTx, toTx };
      });
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  /**
   * Intern transfer-helper som kjører i en eksisterende transaksjon.
   * Caller eier BEGIN/COMMIT/ROLLBACK + connection-livssyklus.
   *
   * Refaktorert ut av `transfer()` for PR #513 §1.2 — slik at
   * `commitReservation()` kan dele samme transaksjon som SELECT FOR UPDATE
   * på reservation-raden, og dermed eliminerer TOCTOU-racet mot
   * `expireStaleReservations`-tick.
   */
  private async executeTransferInTx(
    client: PoolClient,
    fromId: string,
    toId: string,
    amount: number,
    reason: string,
    options?: TransferOptions,
  ): Promise<WalletTransferResult> {
    // PR-W3: targetSide styrer hvilken side CREDIT-siden lander på. Hvis
    // mottaker er systemkonto ignoreres feltet (CHECK-constraint winnings=0).
    const requestedTarget: WalletAccountSide = options?.targetSide ?? "deposit";

    const operationId = randomUUID();
    const fromTxId = randomUUID();
    const toTxId = randomUUID();

    // Les from-account inne i samme FOR UPDATE som executeLedger vil holde,
    // for å beregne winnings-first splitt atomisk.
    const fromAccount = await this.selectAccountForUpdate(client, fromId);
    if (!fromAccount) {
      throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${fromId} finnes ikke.`);
    }
    const toAccount = await this.selectAccountForUpdate(client, toId);
    if (!toAccount) {
      throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${toId} finnes ikke.`);
    }
    const fromState: InternalAccountState = {
      id: fromAccount.id,
      balance: asMoney(fromAccount.balance),
      depositBalance: asMoney(fromAccount.deposit_balance),
      winningsBalance: asMoney(fromAccount.winnings_balance),
      isSystem: fromAccount.is_system
    };

    // PR-W3: system-konto som avsender bruker deposit-siden (winnings = 0).
    // For brukerkonto: winnings-first-split.
    const fromSplit: WalletTransactionSplit = fromState.isSystem
      ? { fromDeposit: amount, fromWinnings: 0 }
      : splitDebitFromAccount(fromState, amount);

    // PR-W3: effektivt target — system-konto som mottaker tvinger deposit
    // (CHECK-constraint winnings_balance=0 for system).
    const effectiveTarget: WalletAccountSide = toAccount.is_system ? "deposit" : requestedTarget;

    const toSplit: WalletTransactionSplit =
      effectiveTarget === "winnings"
        ? { fromDeposit: 0, fromWinnings: amount }
        : { fromDeposit: amount, fromWinnings: 0 };

    const entries: LedgerEntryInput[] = [];
    // DEBIT-siden: avsender
    if (fromState.isSystem) {
      // System: alt på deposit (winnings er alltid 0).
      entries.push({
        operationId,
        accountId: fromId,
        side: "DEBIT",
        amount,
        transactionId: fromTxId,
        accountSide: "deposit"
      });
    } else {
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
    }
    // CREDIT-siden: mottaker — alt lander på effectiveTarget.
    entries.push({
      operationId,
      accountId: toId,
      side: "CREDIT",
      amount,
      transactionId: toTxId,
      accountSide: effectiveTarget
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
          idempotencyKey: options?.idempotencyKey,
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

    const fromTx = txRows.find((tx) => tx.id === fromTxId);
    const toTx = txRows.find((tx) => tx.id === toTxId);
    if (!fromTx || !toTx) {
      throw new WalletError("INVALID_WALLET_RESPONSE", "Transfer mangler transaksjonsrader.");
    }
    return { fromTx, toTx };
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

    try {
      // BIN-762: REPEATABLE READ + retry på 40001/40P01 via withWalletTx.
      // Bruker shared `runSingleAccountMovementOnClient` (CRIT-5/PR #551) slik at
      // BEGIN/COMMIT/ROLLBACK + isolation + retry håndteres av withWalletTx, mens
      // selve ledger-skrivingen er felles med `singleAccountMovementWithClient`.
      return await withWalletTx(this.pool, (client) =>
        this.runSingleAccountMovementOnClient(client, input)
      );
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  /**
   * CRIT-5 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26): variant av
   * `singleAccountMovement` som deltar i en allerede-åpen transaksjon
   * (caller kontrollerer BEGIN/COMMIT/ROLLBACK på passed client).
   *
   * Brukes av `creditWithClient` slik at Game1MiniGameOrchestrator kan
   * koordinere wallet-credit + UPDATE i samme atomiske transaksjon.
   *
   * Idempotency-sjekk: bruker pool.query (egen connection) for å lese
   * eksisterende tx — det er trygt fordi en commit-et tx er synlig fra
   * alle connections, og vi vil ikke skrive duplikat fra denne path-en.
   */
  private async singleAccountMovementWithClient(
    client: PoolClient,
    input: {
      accountId: string;
      type: WalletTransaction["type"];
      amount: number;
      reason: string;
      fromAccountId: string;
      toAccountId: string;
      idempotencyKey?: string;
      splitStrategy?: "winnings-first";
      creditTarget?: WalletAccountSide;
    },
  ): Promise<WalletTransaction> {
    await this.ensureInitialized();

    // BIN-162: Idempotency check — return existing transaction if key was already used.
    // Bruker pool.query (egen connection) for å unngå å rote med caller's tx-state.
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }

    // Sørg for at konto eksisterer før vi prøver å skrive ledger-rader.
    // Dette må også kjøre uten å rote med caller's tx — vi bruker egen
    // connection. ensureAccount er idempotent og uten side-effekter
    // utover INSERT på første kall.
    await this.ensureAccount(input.accountId);

    return this.runSingleAccountMovementOnClient(client, input);
  }

  /**
   * Felles ledger-skriving — caller har allerede åpnet client + BEGIN
   * (eller adapteret håndterer det selv via singleAccountMovement-wrapper).
   *
   * Gjør IKKE BEGIN/COMMIT — kun ledger-mutasjoner.
   */
  private async runSingleAccountMovementOnClient(
    client: PoolClient,
    input: {
      accountId: string;
      type: WalletTransaction["type"];
      amount: number;
      reason: string;
      fromAccountId: string;
      toAccountId: string;
      idempotencyKey?: string;
      splitStrategy?: "winnings-first";
      creditTarget?: WalletAccountSide;
    },
  ): Promise<WalletTransaction> {
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
    const tx = txRows.find((row) => row.id === txId);
    if (!tx) {
      throw new WalletError("INVALID_WALLET_RESPONSE", "Mangler transaksjonsrad for wallet-operasjon.");
    }
    return tx;
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

    // BIN-764: insert entry, deretter compute hash og UPDATE med hash.
    // Vi gjør dette per entry sekvensielt fordi forrige hash trengs for å
    // beregne neste i samme konto-kjede. Insert-INTO + RETURNING gir oss
    // BIGSERIAL-id + created_at som er bestanddeler av hashen.
    for (const entry of input.entries) {
      const accountSide = entry.accountSide ?? "deposit";
      const { rows } = await client.query<{
        id: string;
        operation_id: string;
        account_id: string;
        side: "DEBIT" | "CREDIT";
        amount: string;
        transaction_id: string | null;
        account_side: "deposit" | "winnings";
        created_at: Date | string;
      }>(
        `INSERT INTO ${this.entriesTable()}
          (operation_id, account_id, side, amount, transaction_id, account_side)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, operation_id, account_id, side, amount::text, transaction_id, account_side, created_at`,
        [
          entry.operationId,
          entry.accountId,
          entry.side,
          entry.amount,
          entry.transactionId ?? null,
          accountSide,
        ]
      );
      const inserted = rows[0]!;

      // Hent forrige hash for samme konto. Locker raden mot parallell-skriving
      // så lenge vi er i samme transaksjon (selectAccountsForUpdate har allerede
      // FOR UPDATE-låst kontoen, så ingen annen ledger-skriving kan smyge seg
      // inn med høyere id i mellomtiden).
      const previousHash = await this.selectPreviousEntryHash(
        client,
        inserted.account_id,
        inserted.id
      );

      const hashInput: WalletEntryHashInput = {
        id: String(inserted.id),
        operation_id: inserted.operation_id,
        account_id: inserted.account_id,
        side: inserted.side,
        amount: inserted.amount,
        transaction_id: inserted.transaction_id,
        account_side: inserted.account_side,
        created_at: asIso(inserted.created_at),
      };
      const entryHash = computeEntryHash(previousHash, hashInput);

      await client.query(
        `UPDATE ${this.entriesTable()}
            SET entry_hash = $2, previous_entry_hash = $3
          WHERE id = $1`,
        [inserted.id, entryHash, previousHash]
      );
    }

    // BIN-761: outbox-enqueue MÅ skje i samme tx som ledger-INSERT-ene.
    // Én outbox-rad per inserted non-system transaction. Worker dispatcher
    // bruker payload til å broadcaste `wallet:state` (BIN-760) uten ekstra
    // DB-lookup.
    //
    // System-kontoer (__system_house__, __system_external_cash__) får ingen
    // outbox-rad — ingen klient abonnerer på dem, og det halvere outbox-volum.
    if (this.outboxRepo) {
      for (const tx of insertedTransactions) {
        const acc = accounts.get(tx.accountId);
        if (!acc || acc.isSystem) continue;
        const eventType = `wallet.${tx.type.toLowerCase()}`;
        await this.outboxRepo.enqueue(client, {
          // operationId her = transaction.id (UUID). Idempotent dispatcher
          // kan bruke dette som de-dup-key. Merk at flere outbox-rader kan
          // dele samme underliggende ledger-operationId hvis en operasjon
          // berører to spiller-kontoer (transfer) — og det er ønsket
          // (separat broadcast per affected wallet).
          operationId: tx.id,
          accountId: tx.accountId,
          eventType,
          payload: {
            transactionId: tx.id,
            accountId: tx.accountId,
            type: tx.type,
            amount: tx.amount,
            reason: tx.reason,
            relatedAccountId: tx.relatedAccountId ?? null,
            split: tx.split ?? null,
            depositBalance: acc.depositBalance,
            winningsBalance: acc.winningsBalance,
            balance: acc.balance,
            createdAt: tx.createdAt,
          },
        });
      }
    }

    return insertedTransactions;
  }

  /**
   * BIN-764: hent forrige rads entry_hash for samme konto. Returnerer
   * GENESIS hvis dette er første entry. `currentId` ekskluderes for å håndtere
   * caller-en som allerede har inserted, men ikke skrevet hash ennå.
   *
   * Bruker `<` på id (ikke `<=`) for å være sikker på at vi ikke får current
   * raden tilbake. Hvis tidligere rader har NULL i entry_hash (f.eks. legacy
   * pre-BIN-764-rader som ennå ikke er backfillet), bruker vi GENESIS — det
   * tilsvarer at backfill vil resette kjeden ved første grace-punktet.
   */
  private async selectPreviousEntryHash(
    client: PoolClient,
    accountId: string,
    currentId: string,
  ): Promise<string> {
    const { rows } = await client.query<{ entry_hash: string | null }>(
      `SELECT entry_hash
         FROM ${this.entriesTable()}
        WHERE account_id = $1 AND id < $2
        ORDER BY id DESC
        LIMIT 1`,
      [accountId, currentId]
    );
    if (rows.length === 0) {
      return WALLET_HASH_CHAIN_GENESIS;
    }
    return rows[0]!.entry_hash ?? WALLET_HASH_CHAIN_GENESIS;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  /**
   * DB-P0-001: idempotent CHECK-constraint addition.
   *
   * Before this helper, schema-init ran `DROP CONSTRAINT IF EXISTS X` followed
   * by `ADD CONSTRAINT X CHECK (...)` on every cold-boot. ADD CONSTRAINT
   * triggers a full-table validation scan under EXCLUSIVE lock — wallet-writes
   * could freeze for minutes after a Render redeploy on a populated table.
   *
   * The fix queries `pg_constraint` first. If the constraint already exists
   * (the migration `20260926000000_wallet_currency_readiness.sql` created it),
   * the ADD is skipped entirely — no lock, no validation scan.
   *
   * Tests with fresh `test_<uuid>` schemas hit the empty-table path: the
   * ADD runs once on zero rows (instant). In production the table already
   * has the constraint from migration, so this method is a fast no-op.
   *
   * Schema-name is matched explicitly so the same constraint name in two
   * different schemas (test isolation) doesn't trigger a false positive.
   */
  private async ensureCheckConstraint(
    client: PoolClient,
    table: string,
    constraintName: string,
    checkExpr: string
  ): Promise<void> {
    const exists = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t  ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE c.conname = $1
           AND t.relname = $2
           AND n.nspname = $3
           AND c.contype = 'c'
      ) AS exists`,
      [constraintName, table, this.schema]
    );
    if (exists.rows[0]?.exists) {
      // Already in place — nothing to do. Crucially, no DROP/ADD cycle and
      // no full-table validation scan.
      return;
    }
    await client.query(
      `ALTER TABLE "${this.schema}"."${table}"
         ADD CONSTRAINT ${constraintName} CHECK (${checkExpr})`
    );
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

      // BIN-766: multi-currency-readiness. NOK-only nå (CHECK enforcing).
      await client.query(
        `ALTER TABLE ${this.accountsTable()}
           ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NOK'`
      );
      // BIN-766 / DB-P0-001: CHECK-constraint NOK-only. Idempotent via
      // pg_constraint lookup — ADD only fires if the constraint is absent
      // (fresh test schema). In production the migration
      // `20260926000000_wallet_currency_readiness.sql` already added it so
      // this is a no-op; no DROP+RE-ADD cycle, no full-table validation
      // scan, no EXCLUSIVE lock on cold-boot.
      await this.ensureCheckConstraint(
        client,
        "wallet_accounts",
        "wallet_accounts_currency_nok_only",
        "currency = 'NOK'"
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
          currency TEXT NOT NULL DEFAULT 'NOK',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      // BIN-766: defensiv ADD COLUMN i tilfelle pre-BIN-766-DB.
      await client.query(
        `ALTER TABLE ${this.transactionsTable()}
           ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NOK'`
      );
      // DB-P0-001: idempotent via pg_constraint lookup — see comment on
      // wallet_accounts above. Production no-op; test-schema first-boot only.
      await this.ensureCheckConstraint(
        client,
        "wallet_transactions",
        "wallet_transactions_currency_nok_only",
        "currency = 'NOK'"
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
          currency TEXT NOT NULL DEFAULT 'NOK',
          entry_hash TEXT NULL,
          previous_entry_hash TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      // Hvis tabellen finnes fra før: sørg for account_side-kolonnen.
      await client.query(
        `ALTER TABLE ${this.entriesTable()}
           ADD COLUMN IF NOT EXISTS account_side TEXT NOT NULL DEFAULT 'deposit'`
      );
      // BIN-766: defensiv ADD COLUMN i tilfelle pre-BIN-766-DB.
      await client.query(
        `ALTER TABLE ${this.entriesTable()}
           ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NOK'`
      );
      // DB-P0-001: idempotent via pg_constraint lookup — see comment on
      // wallet_accounts above. Production no-op; test-schema first-boot only.
      await this.ensureCheckConstraint(
        client,
        "wallet_entries",
        "wallet_entries_currency_nok_only",
        "currency = 'NOK'"
      );
      // BIN-764: hash-chain audit-felter. NULL initielt for backwards-compat;
      // nye inserts får entry_hash + previous_entry_hash satt av executeLedger.
      await client.query(
        `ALTER TABLE ${this.entriesTable()}
           ADD COLUMN IF NOT EXISTS entry_hash TEXT,
           ADD COLUMN IF NOT EXISTS previous_entry_hash TEXT`
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
      // BIN-764: index for chain-walking per konto (rekkefølge etter id).
      // Brukes av WalletAuditVerifier for re-beregning og av
      // selectPreviousEntryHash i hot-path.
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_wallet_entries_hash_chain
         ON ${this.entriesTable()} (account_id, id)`
      );

      // BIN-693 Option B + PR #513 §1.1: app_wallet_reservations.
      // Mirror av migration `20260724100000_wallet_reservations.sql` +
      // `20260425000000_wallet_reservations_numeric.sql`. Inline CREATE her
      // gjør at integration-tester med fresh schema (test_<uuid>) har tabellen
      // klar uten å måtte kjøre migration-CLI separat.
      //
      // amount_cents er NUMERIC(20,6) — IKKE BIGINT — for å matche
      // wallet-balance-presisjon og støtte fractional NOK (eks. 12.50 kr).
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.reservationsTable()} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          wallet_id TEXT NOT NULL,
          amount_cents NUMERIC(20, 6) NOT NULL CHECK (amount_cents > 0),
          idempotency_key TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'released', 'committed', 'expired')),
          room_code TEXT NOT NULL,
          game_session_id TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          released_at TIMESTAMPTZ NULL,
          committed_at TIMESTAMPTZ NULL,
          expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
        )`
      );
      // PR #513 §1.1: oppgrader eksisterende BIGINT-kolonne til NUMERIC(20,6).
      // Idempotent: ALTER COLUMN TYPE er no-op hvis typen allerede stemmer.
      await client.query(
        `ALTER TABLE ${this.reservationsTable()}
           ALTER COLUMN amount_cents TYPE NUMERIC(20, 6) USING amount_cents::numeric(20, 6)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_wallet_reservations_wallet_active
         ON ${this.reservationsTable()}(wallet_id) WHERE status = 'active'`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_wallet_reservations_expires_active
         ON ${this.reservationsTable()}(expires_at) WHERE status = 'active'`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_wallet_reservations_room
         ON ${this.reservationsTable()}(room_code)`
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
      // BIN-766: defensiv default — eldre rader uten currency-kolonne
      // (skulle ikke skje siden migration setter NOT NULL DEFAULT, men
      // type-systemet tillater null hvis kolonnen mangler i SELECT).
      currency: row.currency ?? "NOK",
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

  /**
   * FIXED-PRIZE-FIX: Hus-konti (`house-<hallId>-<gameType>-<channel>`) og
   * legacy system-konti (`__house__`, `__system_*`) skal markeres som
   * `is_system=true` slik at de kan gå negativt — nødvendig når faste
   * premier (winningType=fixed) overgår pool. Hus garanterer annonserte
   * premier (legacy spillorama-paritet).
   *
   * DB-constraint:
   *   `CHECK (is_system = true OR deposit_balance >= 0)`.
   */
  private isSystemAccountId(accountId: string): boolean {
    return (
      accountId.startsWith("house-") ||
      accountId.startsWith("__house__") ||
      accountId.startsWith("__system_")
    );
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

  // ── BIN-693 Option B: Wallet-reservasjon (Postgres SQL-impl) ──────────────

  private reservationsTable(): string {
    return `"${this.schema}"."app_wallet_reservations"`;
  }

  private mapReservationRow(row: {
    id: string;
    wallet_id: string;
    amount_cents: string | number;
    idempotency_key: string;
    status: WalletReservation["status"];
    room_code: string;
    game_session_id: string | null;
    created_at: Date | string;
    released_at: Date | string | null;
    committed_at: Date | string | null;
    expires_at: Date | string;
  }): WalletReservation {
    return {
      id: row.id,
      walletId: row.wallet_id,
      amount: Number(row.amount_cents),
      idempotencyKey: row.idempotency_key,
      status: row.status,
      roomCode: row.room_code,
      gameSessionId: row.game_session_id,
      createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
      releasedAt: row.released_at
        ? typeof row.released_at === "string"
          ? row.released_at
          : row.released_at.toISOString()
        : null,
      committedAt: row.committed_at
        ? typeof row.committed_at === "string"
          ? row.committed_at
          : row.committed_at.toISOString()
        : null,
      expiresAt: typeof row.expires_at === "string" ? row.expires_at : row.expires_at.toISOString(),
    };
  }

  async getAvailableBalance(accountId: string): Promise<number> {
    await this.ensureInitialized();
    const normalized = this.normalizeAnyAccountId(accountId);
    const { rows } = await this.pool.query<{ total: string; reserved: string | null }>(
      `SELECT
         (COALESCE(a.deposit_balance, 0) + COALESCE(a.winnings_balance, 0))::text AS total,
         (SELECT COALESCE(SUM(r.amount_cents), 0)
            FROM ${this.reservationsTable()} r
            WHERE r.wallet_id = a.id AND r.status = 'active')::text AS reserved
       FROM ${this.accountsTable()} a
       WHERE a.id = $1`,
      [normalized],
    );
    const row = rows[0];
    if (!row) throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
    const total = Number(row.total);
    const reserved = Number(row.reserved ?? 0);
    return Math.max(0, total - reserved);
  }

  async reserve(
    accountId: string,
    amount: number,
    options: ReserveOptions,
  ): Promise<WalletReservation> {
    return this.withBreaker(() => this.reserveImpl(accountId, amount, options));
  }

  private async reserveImpl(
    accountId: string,
    amount: number,
    options: ReserveOptions,
  ): Promise<WalletReservation> {
    await this.ensureInitialized();
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new WalletError("INVALID_INPUT", "amount må være > 0.");
    }
    const normalized = this.normalizeAnyAccountId(accountId);

    // BIN-762: REPEATABLE READ + retry på 40001/40P01 via withWalletTx.
    return await withWalletTx(this.pool, async (client) => {
      // Lås wallet-row for å beregne available_balance atomisk — hindrer
      // race mot parallell reserve/transfer fra samme wallet.
      const account = await this.selectAccountForUpdate(client, normalized);
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${normalized} finnes ikke.`);
      }

      // Idempotens: samme key + beløp → returnér eksisterende aktiv
      // reservasjon. Annet beløp → IDEMPOTENCY_MISMATCH.
      const existingByKey = await client.query(
        `SELECT id, wallet_id, amount_cents, idempotency_key, status, room_code,
                game_session_id, created_at, released_at, committed_at, expires_at
           FROM ${this.reservationsTable()}
           WHERE idempotency_key = $1
           LIMIT 1`,
        [options.idempotencyKey],
      );
      if (existingByKey.rowCount && existingByKey.rowCount > 0) {
        const row = existingByKey.rows[0];
        if (row.status === "active") {
          if (Number(row.amount_cents) !== amount) {
            throw new WalletError(
              "IDEMPOTENCY_MISMATCH",
              `Reservasjon med samme key (${options.idempotencyKey}) har beløp ${row.amount_cents}, ikke ${amount}.`,
            );
          }
          return this.mapReservationRow(row);
        }
        // Hvis status != active (released/committed/expired), UNIQUE
        // constraint ville blokkert INSERT. Kast klart feil.
        throw new WalletError(
          "INVALID_STATE",
          `Idempotency-key ${options.idempotencyKey} er allerede brukt (status=${row.status}).`,
        );
      }

      // Beregn sum av aktive reservations på denne walleten (inkludert de
      // som låses av andre transaksjoner i SELECT FOR UPDATE over).
      const sumRes = await client.query<{ reserved: string | null }>(
        `SELECT COALESCE(SUM(amount_cents), 0)::text AS reserved
           FROM ${this.reservationsTable()}
           WHERE wallet_id = $1 AND status = 'active'`,
        [normalized],
      );
      const reserved = Number(sumRes.rows[0]?.reserved ?? 0);
      const total = asMoney(account.deposit_balance) + asMoney(account.winnings_balance);
      const available = total - reserved;
      if (available < amount) {
        throw new WalletError(
          "INSUFFICIENT_FUNDS",
          `Wallet ${normalized} har ikke tilstrekkelig tilgjengelig saldo (${available} < ${amount}).`,
        );
      }

      const id = randomUUID();
      const expiresAt = options.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const insert = await client.query(
        `INSERT INTO ${this.reservationsTable()}
           (id, wallet_id, amount_cents, idempotency_key, status, room_code, expires_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)
         RETURNING id, wallet_id, amount_cents, idempotency_key, status, room_code,
                   game_session_id, created_at, released_at, committed_at, expires_at`,
        [id, normalized, amount, options.idempotencyKey, options.roomCode, expiresAt],
      );
      return this.mapReservationRow(insert.rows[0]);
    });
  }

  async increaseReservation(
    reservationId: string,
    extraAmount: number,
  ): Promise<WalletReservation> {
    return this.withBreaker(() => this.increaseReservationImpl(reservationId, extraAmount));
  }

  private async increaseReservationImpl(
    reservationId: string,
    extraAmount: number,
  ): Promise<WalletReservation> {
    await this.ensureInitialized();
    if (!Number.isFinite(extraAmount) || extraAmount <= 0) {
      throw new WalletError("INVALID_INPUT", "extraAmount må være > 0.");
    }
    // BIN-762: REPEATABLE READ + retry på 40001/40P01 via withWalletTx.
    return await withWalletTx(this.pool, async (client) => {
      const resRows = await client.query(
        `SELECT id, wallet_id, amount_cents, idempotency_key, status, room_code,
                game_session_id, created_at, released_at, committed_at, expires_at
           FROM ${this.reservationsTable()}
           WHERE id = $1
           FOR UPDATE`,
        [reservationId],
      );
      if (resRows.rowCount === 0) {
        throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${reservationId} finnes ikke.`);
      }
      const existing = resRows.rows[0];
      if (existing.status !== "active") {
        throw new WalletError(
          "INVALID_STATE",
          `Reservasjon ${reservationId} er ${existing.status}, kan ikke økes.`,
        );
      }
      const account = await this.selectAccountForUpdate(client, existing.wallet_id);
      if (!account) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${existing.wallet_id} finnes ikke.`);
      }
      const sumRes = await client.query<{ reserved: string | null }>(
        `SELECT COALESCE(SUM(amount_cents), 0)::text AS reserved
           FROM ${this.reservationsTable()}
           WHERE wallet_id = $1 AND status = 'active'`,
        [existing.wallet_id],
      );
      const reserved = Number(sumRes.rows[0]?.reserved ?? 0);
      const total = asMoney(account.deposit_balance) + asMoney(account.winnings_balance);
      const available = total - reserved;
      if (available < extraAmount) {
        throw new WalletError(
          "INSUFFICIENT_FUNDS",
          `Wallet ${existing.wallet_id} har ikke tilstrekkelig tilgjengelig saldo for økning (${available} < ${extraAmount}).`,
        );
      }
      const updated = await client.query(
        `UPDATE ${this.reservationsTable()}
           SET amount_cents = amount_cents + $1
           WHERE id = $2
         RETURNING id, wallet_id, amount_cents, idempotency_key, status, room_code,
                   game_session_id, created_at, released_at, committed_at, expires_at`,
        [extraAmount, reservationId],
      );
      return this.mapReservationRow(updated.rows[0]);
    });
  }

  async releaseReservation(
    reservationId: string,
    amount?: number,
  ): Promise<WalletReservation> {
    return this.withBreaker(() => this.releaseReservationImpl(reservationId, amount));
  }

  private async releaseReservationImpl(
    reservationId: string,
    amount?: number,
  ): Promise<WalletReservation> {
    await this.ensureInitialized();
    // BIN-762: REPEATABLE READ + retry på 40001/40P01 via withWalletTx.
    return await withWalletTx(this.pool, async (client) => {
      const resRows = await client.query(
        `SELECT id, wallet_id, amount_cents, idempotency_key, status, room_code,
                game_session_id, created_at, released_at, committed_at, expires_at
           FROM ${this.reservationsTable()}
           WHERE id = $1
           FOR UPDATE`,
        [reservationId],
      );
      if (resRows.rowCount === 0) {
        throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${reservationId} finnes ikke.`);
      }
      const existing = resRows.rows[0];
      if (existing.status !== "active") {
        throw new WalletError(
          "INVALID_STATE",
          `Reservasjon ${reservationId} er ${existing.status}, kan ikke frigis.`,
        );
      }
      const existingAmount = Number(existing.amount_cents);

      if (amount === undefined || amount >= existingAmount) {
        const updated = await client.query(
          `UPDATE ${this.reservationsTable()}
             SET status = 'released', released_at = NOW()
             WHERE id = $1
           RETURNING id, wallet_id, amount_cents, idempotency_key, status, room_code,
                     game_session_id, created_at, released_at, committed_at, expires_at`,
          [reservationId],
        );
        return this.mapReservationRow(updated.rows[0]);
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new WalletError("INVALID_INPUT", "amount må være > 0.");
      }
      const updated = await client.query(
        `UPDATE ${this.reservationsTable()}
           SET amount_cents = amount_cents - $1
           WHERE id = $2
         RETURNING id, wallet_id, amount_cents, idempotency_key, status, room_code,
                   game_session_id, created_at, released_at, committed_at, expires_at`,
        [amount, reservationId],
      );
      return this.mapReservationRow(updated.rows[0]);
    });
  }

  async commitReservation(
    reservationId: string,
    toAccountId: string,
    reason: string,
    options?: CommitReservationOptions,
  ): Promise<WalletTransferResult> {
    return this.withBreaker(() => this.commitReservationImpl(reservationId, toAccountId, reason, options));
  }

  private async commitReservationImpl(
    reservationId: string,
    toAccountId: string,
    reason: string,
    options?: CommitReservationOptions,
  ): Promise<WalletTransferResult> {
    await this.ensureInitialized();
    const toId = this.normalizeUserWalletId(toAccountId);

    // PR #513 §1.2 (TOCTOU-fix): hele commit-en kjøres i én atomisk
    // transaksjon. Tidligere mønster var:
    //   1. SELECT reservation (ingen lås)
    //   2. transfer()  — egen tx, debiterer wallet
    //   3. UPDATE reservation status='committed' WHERE status='active'
    // Hvis `expireStaleReservations` kjørte en sweep mellom (1) og (3),
    // ble reservasjonen markert 'expired' samtidig som walleten ble debitert,
    // og UPDATE i (3) traff null rader (status != 'active'). Resultat:
    // wallet trukket, reservation-audit sier 'expired'. Compliance-ledger
    // og reservation-historikk i desync.
    //
    // Fix: SELECT ... FOR UPDATE låser reservation-raden, transfer() kjøres
    // via shared client (executeTransferInTx), og UPDATE skjer i samme tx.
    // expireStaleReservations vil blokkere på row-låsen til vi committer.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // FOR UPDATE: blokker expireStaleReservations + parallel commit-attempts.
      const { rows } = await client.query(
        `SELECT id, wallet_id, amount_cents, status
           FROM ${this.reservationsTable()}
           WHERE id = $1
           FOR UPDATE`,
        [reservationId],
      );
      if (rows.length === 0) {
        throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${reservationId} finnes ikke.`);
      }
      const res = rows[0];
      if (res.status !== "active") {
        throw new WalletError(
          "INVALID_STATE",
          `Reservasjon ${reservationId} er ${res.status}, kan ikke committes.`,
        );
      }

      const fromId = this.normalizeUserWalletId(res.wallet_id);
      if (fromId === toId) {
        throw new WalletError("INVALID_TRANSFER", "Kan ikke overføre til samme wallet.");
      }

      // ensureAccount-er via separate connections er trygt — vi har ikke
      // begynt å mutere account-rader ennå. Disse oppretter system-kontoer
      // hvis de mangler (idempotent ON CONFLICT DO NOTHING).
      await this.ensureAccount(fromId);
      await this.ensureAccount(toId);

      // Utfør faktisk transfer i samme transaksjon — winnings-først,
      // compliance-ledger, split-entries.
      const transfer = await this.executeTransferInTx(
        client,
        fromId,
        toId,
        Number(res.amount_cents),
        reason,
        options,
      );

      // Marker reservasjon committed. Inne i samme tx — hvis dette feiler
      // ruller vi tilbake hele debit-en også, så wallet og reservation
      // forblir konsistente.
      await client.query(
        `UPDATE ${this.reservationsTable()}
           SET status = 'committed', committed_at = NOW(), game_session_id = $1
           WHERE id = $2`,
        [options?.gameSessionId ?? null, reservationId],
      );

      await client.query("COMMIT");
      return transfer;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err instanceof WalletError ? err : this.wrapError(err);
    } finally {
      client.release();
    }
  }

  async listActiveReservations(accountId: string): Promise<WalletReservation[]> {
    await this.ensureInitialized();
    const normalized = this.normalizeAnyAccountId(accountId);
    const { rows } = await this.pool.query(
      `SELECT id, wallet_id, amount_cents, idempotency_key, status, room_code,
              game_session_id, created_at, released_at, committed_at, expires_at
         FROM ${this.reservationsTable()}
         WHERE wallet_id = $1 AND status = 'active'
         ORDER BY created_at ASC`,
      [normalized],
    );
    return rows.map((r) => this.mapReservationRow(r));
  }

  async listReservationsByRoom(roomCode: string): Promise<WalletReservation[]> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query(
      `SELECT id, wallet_id, amount_cents, idempotency_key, status, room_code,
              game_session_id, created_at, released_at, committed_at, expires_at
         FROM ${this.reservationsTable()}
         WHERE room_code = $1
         ORDER BY created_at ASC`,
      [roomCode],
    );
    return rows.map((r) => this.mapReservationRow(r));
  }

  async expireStaleReservations(nowMs: number): Promise<number> {
    return this.withBreaker(async () => {
      await this.ensureInitialized();
      // `nowMs` godtas for test-ergonomi — i prod bruker vi NOW() for ikke
      // å ha clock-skew mellom app-server og DB.
      const cutoff = new Date(nowMs).toISOString();
      const { rowCount } = await this.pool.query(
        `UPDATE ${this.reservationsTable()}
           SET status = 'expired', released_at = NOW()
           WHERE status = 'active' AND expires_at < $1`,
        [cutoff],
      );
      return rowCount ?? 0;
    });
  }
}
