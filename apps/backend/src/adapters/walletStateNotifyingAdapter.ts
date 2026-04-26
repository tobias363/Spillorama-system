/**
 * BIN-760: Wallet-adapter decorator som pusher autoritativ `wallet:state`
 * etter hver wallet-mutasjon.
 *
 * Hvorfor decorator framfor å modifisere `PostgresWalletAdapter` direkte:
 *   - Non-invasivt: ett wrapper-lag rundt eksisterende adapter — ingen
 *     endringer i ledger-koden som er unik per backend (Postgres / File /
 *     Http). Mindre risiko for regression i wallet-integriteten.
 *   - Backend-agnostisk: samme decorator virker for alle 3 produksjons-
 *     adaptere uten kode-duplisering.
 *   - Fail-soft: pusher-en kalles ETTER at adapter-metoden returnerte
 *     suksessfullt, slik at en push-feil aldri kan rulle tilbake en
 *     allerede-committed wallet-mutasjon.
 *
 * Pusher-en kalles for ALLE wallet-state-endrende operasjoner:
 *   - debit, credit, topUp, withdraw — én walletId
 *   - transfer — to walletId-er (begge får hver sin push)
 *   - reserve, increaseReservation, releaseReservation — én walletId
 *   - commitReservation — to walletId-er (samme som transfer)
 *
 * `expireStaleReservations` håndteres separat — TTL-expiry-tick henter ikke
 * walletId-listen direkte, så affected klient ser refresh på neste
 * `room:update`/refetch. Akseptert miss for MVP — TTL-expiry er en crash-
 * recovery-fail-safe (sjelden), ikke happy-path. BIN-761 (outbox) vil
 * løse dette uansett.
 *
 * TODO BIN-761 (outbox):
 *   - I dag emittes pusher direkte etter commit. Server-restart mellom
 *     commit og emit kan tape én push (klient refetcher på reconnect).
 *     BIN-761 vil flytte emit-en gjennom en persistent outbox-tabell.
 *   - Når outbox-en lander, skal denne decorator-en peke på outbox-
 *     skriveren i stedet for å kalle pusher direkte. API-et endres ikke.
 */

import type {
  CommitReservationOptions,
  CreateWalletAccountInput,
  CreditOptions,
  ReserveOptions,
  TransactionOptions,
  TransferOptions,
  WalletAccount,
  WalletAdapter,
  WalletBalance,
  WalletReservation,
  WalletTransaction,
  WalletTransferResult,
} from "./WalletAdapter.js";
import type { WalletStateReason, WalletStateSource } from "@spillorama/shared-types/socket-events";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "wallet-state-notifying-adapter" });

export interface WalletStatePushHook {
  pushForWallet(
    walletId: string,
    reason: WalletStateReason,
    source?: WalletStateSource,
  ): Promise<void>;
}

/**
 * Wrapper rundt en `WalletAdapter` som kaller `pusher.pushForWallet(...)`
 * etter hver write-operasjon. Read-operasjoner (`getBalance`, `listAccounts`,
 * etc.) er pass-through.
 *
 * Pusher-kall er fire-and-forget — feil i pusher swallowes og logges som
 * warn. Dette beskytter wallet-commit-integriteten (en push-feil skal
 * aldri rulle tilbake en commit).
 */
export class WalletStateNotifyingAdapter implements WalletAdapter {
  constructor(
    private readonly inner: WalletAdapter,
    private readonly pusher: WalletStatePushHook,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────
  private firePush(
    walletId: string,
    reason: WalletStateReason,
    source?: WalletStateSource,
  ): void {
    // Fire-and-forget: pusher swallow-er egne feil, men vi catch-er ekstra
    // her som siste sikkerhet (skal aldri propagere fra return-veien).
    void this.pusher.pushForWallet(walletId, reason, source).catch((err) => {
      log.warn({ err, walletId, reason }, "wallet:state push feilet utenfor pusher");
    });
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

  // ── Write-operasjoner (push etter suksessfull commit) ────────────────────
  async debit(
    accountId: string,
    amount: number,
    reason: string,
    options?: TransactionOptions,
  ): Promise<WalletTransaction> {
    const tx = await this.inner.debit(accountId, amount, reason, options);
    this.firePush(tx.accountId, "debit");
    return tx;
  }

  async credit(
    accountId: string,
    amount: number,
    reason: string,
    options?: CreditOptions,
  ): Promise<WalletTransaction> {
    const tx = await this.inner.credit(accountId, amount, reason, options);
    this.firePush(tx.accountId, "credit");
    return tx;
  }

  async topUp(
    accountId: string,
    amount: number,
    reason?: string,
    options?: TransactionOptions,
  ): Promise<WalletTransaction> {
    const tx = await this.inner.topUp(accountId, amount, reason, options);
    this.firePush(tx.accountId, "credit");
    return tx;
  }

  async withdraw(
    accountId: string,
    amount: number,
    reason?: string,
    options?: TransactionOptions,
  ): Promise<WalletTransaction> {
    const tx = await this.inner.withdraw(accountId, amount, reason, options);
    this.firePush(tx.accountId, "debit");
    return tx;
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason?: string,
    options?: TransferOptions,
  ): Promise<WalletTransferResult> {
    const result = await this.inner.transfer(fromAccountId, toAccountId, amount, reason, options);
    // Begge sider får push — debit-siden ser tom-trekk umiddelbart, credit-
    // siden (typisk vinner) ser ny saldo umiddelbart.
    this.firePush(result.fromTx.accountId, "transfer");
    this.firePush(result.toTx.accountId, "transfer");
    return result;
  }

  // ── Reservation-API (BIN-693 Option B) ───────────────────────────────────
  // Optional på interface; vi delegerer kun hvis inner-adapter eksponerer
  // metoden. Hvis inner ikke støtter reservation, returnerer vi undefined
  // (samme som om wrapper var ikke-eksisterende).

  get getAvailableBalance(): WalletAdapter["getAvailableBalance"] {
    return this.inner.getAvailableBalance
      ? (accountId: string) => this.inner.getAvailableBalance!(accountId)
      : undefined;
  }

  get reserve(): WalletAdapter["reserve"] {
    return this.inner.reserve
      ? async (accountId: string, amount: number, options: ReserveOptions): Promise<WalletReservation> => {
          const reservation = await this.inner.reserve!(accountId, amount, options);
          this.firePush(reservation.walletId, "reservation", { roomCode: reservation.roomCode });
          return reservation;
        }
      : undefined;
  }

  get increaseReservation(): WalletAdapter["increaseReservation"] {
    return this.inner.increaseReservation
      ? async (reservationId: string, extraAmount: number): Promise<WalletReservation> => {
          const reservation = await this.inner.increaseReservation!(reservationId, extraAmount);
          this.firePush(reservation.walletId, "reservation", { roomCode: reservation.roomCode });
          return reservation;
        }
      : undefined;
  }

  get releaseReservation(): WalletAdapter["releaseReservation"] {
    return this.inner.releaseReservation
      ? async (reservationId: string, amount?: number): Promise<WalletReservation> => {
          const reservation = await this.inner.releaseReservation!(reservationId, amount);
          this.firePush(reservation.walletId, "release", { roomCode: reservation.roomCode });
          return reservation;
        }
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
          const result = await this.inner.commitReservation!(reservationId, toAccountId, reason, options);
          // commit = transfer + reservation-status-update; push begge sider.
          this.firePush(result.fromTx.accountId, "commit", { gameId: options?.gameSessionId });
          this.firePush(result.toTx.accountId, "commit", { gameId: options?.gameSessionId });
          return result;
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
    // Expiry-tick-en gir oss ikke walletId-listen direkte — affected klient
    // ser refresh på neste `room:update`/refetch. Pass-through her uten
    // å fire push.
    return this.inner.expireStaleReservations
      ? (nowMs: number) => this.inner.expireStaleReservations!(nowMs)
      : undefined;
  }
}
