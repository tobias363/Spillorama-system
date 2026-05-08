/**
 * BIN-806 A13: Wallet-adapter decorator som kjører anti-fraud-assessment
 * PRE-COMMIT for hver wallet-mutasjon.
 *
 * Hvorfor decorator framfor å modifisere wallet-koden direkte:
 *   - Non-invasivt: ett wrapper-lag rundt eksisterende adapter — ingen
 *     endringer i ledger-koden som er unik per backend (Postgres / File
 *     / Http). Mindre risiko for regression i wallet-integriteten.
 *   - Backend-agnostisk: samme decorator virker for alle 3 produksjons-
 *     adaptere uten kode-duplisering.
 *   - Conflict-mitigation (Agent U): vi kaller via `assessTransaction`
 *     uten å endre eksisterende debit/credit-bodies i PostgresWallet-
 *     adapteret. Inner-adapter forblir uberørt.
 *
 * Pipeline:
 *   1. Caller passerer `options.antiFraudContext` med userId/hallId/ip.
 *   2. Decorator kaller `assessTransaction()` → assessment + audit-rad.
 *   3. Hvis `risk === "critical"` → `DomainError("FRAUD_RISK_CRITICAL")`
 *      kastes; underliggende adapter aldri kalt → wallet uberørt.
 *   4. Ellers → adapter kjører normalt; assessment returneres ikke til
 *      caller (admin ser via /api/admin/anti-fraud/signals).
 *
 * Opt-in: hvis caller ikke setter `antiFraudContext`, decorator er
 * en pass-through. Brukes for system-interne flyt (house→house refund,
 * outbox-replay, osv) der fraud-vurdering ikke gir mening.
 */

// Side-effect: registrer module-augmentation av TransactionOptions slik at
// `antiFraudContext`-feltet er typet for callers og denne decoratoren.
import "./walletAdapterAugmentation.js";

import type {
  CommitReservationOptions,
  CreateWalletAccountInput,
  CreditOptions,
  CreditWithClientOptions,
  ReserveOptions,
  TransactionOptions,
  TransferOptions,
  WalletAccount,
  WalletAdapter,
  WalletBalance,
  WalletReservation,
  WalletTransaction,
  WalletTransferResult,
} from "../adapters/WalletAdapter.js";
import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import type {
  AntiFraudOperationType,
  AntiFraudService,
} from "./AntiFraudService.js";

const logger = rootLogger.child({ module: "anti-fraud-wallet-adapter" });

/**
 * Decorator som kjører anti-fraud pre-commit. Inner-adapter er uendret;
 * decorator-en wrapper kun debit/credit/topUp/withdraw/transfer + reservation-
 * commit. Read-operasjoner og skjema-konsultasjon er pass-through.
 */
export class AntiFraudWalletAdapter implements WalletAdapter {
  constructor(
    private readonly inner: WalletAdapter,
    private readonly antiFraud: AntiFraudService,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Kjør assessment hvis caller har sendt `antiFraudContext`. Kaster
   * `FRAUD_RISK_CRITICAL` ved blokkering; ellers no-op (resultat går til
   * audit-DB inni service-en).
   */
  private async assessOrThrow(
    options: TransactionOptions | undefined,
    operationType: AntiFraudOperationType,
    amount: number,
  ): Promise<void> {
    const ctx = options?.antiFraudContext;
    if (!ctx) return;
    try {
      const amountCents = this.amountToCents(amount);
      const assessment = await this.antiFraud.assessTransaction({
        userId: ctx.userId,
        hallId: ctx.hallId ?? null,
        amountCents,
        operationType: ctx.operationTypeOverride ?? operationType,
        ipAddress: ctx.ipAddress ?? null,
      });
      if (assessment.risk === "critical") {
        logger.warn(
          {
            userId: ctx.userId,
            operationType,
            signalId: assessment.signalId,
            signalCount: assessment.signals.length,
          },
          "[BIN-806 A13] CRITICAL risk — blocking wallet-mutation",
        );
        throw new DomainError(
          "FRAUD_RISK_CRITICAL",
          "Transaksjonen ble blokkert pga. mistenkelig aktivitet. Kontakt kundestøtte.",
          {
            signalId: assessment.signalId,
            signals: assessment.signals.map((s) => ({ code: s.code, level: s.level })),
          },
        );
      }
    } catch (err) {
      // Re-kast DomainError som-er (særlig FRAUD_RISK_CRITICAL).
      if (err instanceof DomainError) throw err;
      // Andre feil (DB-down, schema-init feilet) skal IKKE blokkere wallet —
      // assessment er beste-mulig-effort. Logg og fortsett.
      logger.warn(
        { err, operationType, userId: ctx.userId },
        "[BIN-806 A13] assessment feilet — fail-open (tillater mutasjon)",
      );
    }
  }

  /** Konverter "kroner" til "øre" — wallet-API bruker hele kroner over wire. */
  private amountToCents(amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) return 0;
    return Math.round(amount * 100);
  }

  // ── Read-operasjoner (pass-through) ──────────────────────────────────────
  createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    return this.inner.createAccount(input);
  }
  ensureAccount(accountId: string): Promise<WalletAccount> {
    return this.inner.ensureAccount(accountId);
  }
  getAccount(accountId: string): Promise<WalletAccount> {
    return this.inner.getAccount(accountId);
  }
  listAccounts(): Promise<WalletAccount[]> {
    return this.inner.listAccounts();
  }
  getBalance(accountId: string): Promise<number> {
    return this.inner.getBalance(accountId);
  }
  getDepositBalance(accountId: string): Promise<number> {
    return this.inner.getDepositBalance(accountId);
  }
  getWinningsBalance(accountId: string): Promise<number> {
    return this.inner.getWinningsBalance(accountId);
  }
  getBothBalances(accountId: string): Promise<WalletBalance> {
    return this.inner.getBothBalances(accountId);
  }
  listTransactions(accountId: string, limit?: number): Promise<WalletTransaction[]> {
    return this.inner.listTransactions(accountId, limit);
  }

  // ── Write-operasjoner (assess pre-commit) ────────────────────────────────

  async debit(
    accountId: string,
    amount: number,
    reason: string,
    options?: TransactionOptions,
  ): Promise<WalletTransaction> {
    await this.assessOrThrow(options, "DEBIT", amount);
    return this.inner.debit(accountId, amount, reason, options);
  }

  async credit(
    accountId: string,
    amount: number,
    reason: string,
    options?: CreditOptions,
  ): Promise<WalletTransaction> {
    await this.assessOrThrow(options, "CREDIT", amount);
    return this.inner.credit(accountId, amount, reason, options);
  }

  async creditWithClient(
    accountId: string,
    amount: number,
    reason: string,
    options: CreditWithClientOptions,
  ): Promise<WalletTransaction> {
    if (!this.inner.creditWithClient) {
      throw new DomainError(
        "WALLET_CREDIT_WITH_CLIENT_UNSUPPORTED",
        "Inner wallet-adapter implementerer ikke creditWithClient.",
      );
    }
    await this.assessOrThrow(options, "CREDIT", amount);
    return this.inner.creditWithClient(accountId, amount, reason, options);
  }

  async topUp(
    accountId: string,
    amount: number,
    reason?: string,
    options?: TransactionOptions,
  ): Promise<WalletTransaction> {
    await this.assessOrThrow(options, "TOPUP", amount);
    return this.inner.topUp(accountId, amount, reason, options);
  }

  async withdraw(
    accountId: string,
    amount: number,
    reason?: string,
    options?: TransactionOptions,
  ): Promise<WalletTransaction> {
    await this.assessOrThrow(options, "WITHDRAWAL", amount);
    return this.inner.withdraw(accountId, amount, reason, options);
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason?: string,
    options?: TransferOptions,
  ): Promise<WalletTransferResult> {
    await this.assessOrThrow(options, "TRANSFER", amount);
    return this.inner.transfer(fromAccountId, toAccountId, amount, reason, options);
  }

  // ── Reservation-API (pass-through; assess på commitReservation) ──────────

  get getAvailableBalance(): WalletAdapter["getAvailableBalance"] {
    return this.inner.getAvailableBalance
      ? (accountId: string) => this.inner.getAvailableBalance!(accountId)
      : undefined;
  }

  get reserve(): WalletAdapter["reserve"] {
    return this.inner.reserve
      ? async (accountId: string, amount: number, options: ReserveOptions): Promise<WalletReservation> => {
          // Reserve-flyt har ikke `antiFraudContext` på interface'et — assess
          // skjer ved `commitReservation` der vi har kjent transfer-shape.
          return this.inner.reserve!(accountId, amount, options);
        }
      : undefined;
  }

  get increaseReservation(): WalletAdapter["increaseReservation"] {
    return this.inner.increaseReservation
      ? (reservationId: string, extraAmount: number) =>
          this.inner.increaseReservation!(reservationId, extraAmount)
      : undefined;
  }

  get releaseReservation(): WalletAdapter["releaseReservation"] {
    return this.inner.releaseReservation
      ? (reservationId: string, amount?: number) =>
          this.inner.releaseReservation!(reservationId, amount)
      : undefined;
  }

  get commitReservation(): WalletAdapter["commitReservation"] {
    return this.inner.commitReservation
      ? async (
          reservationId: string,
          toAccountId: string,
          reason: string,
          options?: CommitReservationOptions,
        ): Promise<WalletTransferResult> => {
          // Hvis caller har antiFraudContext (alltid for player-flyt),
          // assess før vi committer. Reservasjons-amount er kjent fra
          // service-en internt; vi kan ikke trivielt hente det fra her,
          // så vi kjører assessment med amount=0 (kun velocity/multi-IP-
          // signaler vil treffe). Dette er akseptabelt for pilot — det
          // viktige sjekkpunktet er debit-tidspunktet (i singleAccount-
          // movement) der amount er kjent.
          await this.assessOrThrow(options, "TRANSFER", 0);
          return this.inner.commitReservation!(reservationId, toAccountId, reason, options);
        }
      : undefined;
  }

  get listActiveReservations(): WalletAdapter["listActiveReservations"] {
    return this.inner.listActiveReservations
      ? (accountId: string) => this.inner.listActiveReservations!(accountId)
      : undefined;
  }

  get listReservationsByRoom(): WalletAdapter["listReservationsByRoom"] {
    return this.inner.listReservationsByRoom
      ? (roomCode: string) => this.inner.listReservationsByRoom!(roomCode)
      : undefined;
  }

  get expireStaleReservations(): WalletAdapter["expireStaleReservations"] {
    return this.inner.expireStaleReservations
      ? (nowMs: number) => this.inner.expireStaleReservations!(nowMs)
      : undefined;
  }
}
