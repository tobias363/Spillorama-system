/**
 * Unified pipeline refactor — Fase 0.
 *
 * In-memory implementasjon av WalletPort.
 *
 * Self-contained — bruker IKKE eksisterende `InMemoryWalletAdapter` fordi:
 * 1. Adapteren opererer i `kroner` (number) mens porten opererer i `cents`
 *    (integer). Konvertering vil gi rounding-feil i invariant-tester.
 * 2. Adapter har bredere kontrakt (transfer, listAccounts osv.) som ikke
 *    er en del av Fase 0-snittet.
 *
 * Pure-cents-implementasjon med winnings-first-policy ved debit:
 * - debit: trekker først fra winnings, deretter deposit.
 * - credit: lander på `targetSide` (caller velger).
 * - reserve: holder beløpet låst (ikke trukket fra balance, men reduserer
 *   tilgjengelig saldo ved INSUFFICIENT_FUNDS-sjekk).
 * - commitReservation: konverterer reservasjonen til en faktisk transaksjon.
 * - releaseReservation: setter status `active → released`.
 *
 * Idempotency:
 * - reserve: samme `idempotencyKey` returnerer samme reservation.
 * - commit/release: idempotent på reservation-id.
 * - credit/debit: samme `idempotencyKey` returnerer samme tx.
 *
 * NB: Konto opprettes lazy ved første kall — `getBalance("ny-wallet")`
 * returnerer `{ deposit: 0, winnings: 0, total: 0 }` uten å kaste.
 */

import { randomUUID } from "node:crypto";
import type {
  CommitReservationInput,
  CreditInput,
  DebitInput,
  Reservation,
  ReserveInput,
  WalletPort,
} from "../WalletPort.js";
import type {
  WalletAccountSide,
  WalletBalance,
  WalletTransaction,
} from "../../adapters/WalletAdapter.js";
import { WalletError } from "../../adapters/WalletAdapter.js";

interface AccountState {
  /** Deposit-side (innskudd) i øre. */
  depositCents: number;
  /** Winnings-side (gevinst) i øre. */
  winningsCents: number;
}

interface PersistedReservation extends Reservation {
  /** Beløp i øre. `Reservation.amount` mappes som kroner ut, øre internt. */
  amountCents: number;
}

export class InMemoryWalletPort implements WalletPort {
  private readonly accounts = new Map<string, AccountState>();
  private readonly reservations = new Map<string, PersistedReservation>();
  private readonly reservationByIdempotencyKey = new Map<string, string>();
  private readonly txByIdempotencyKey = new Map<string, WalletTransaction>();

  /**
   * Seed en konto med et initialt deposit. Brukes av tester for å pre-
   * fylle balance før ops kjører.
   */
  seed(walletId: string, depositCents: number, winningsCents = 0): void {
    if (depositCents < 0 || winningsCents < 0) {
      throw new WalletError("INVALID_INPUT", "Seed kan ikke ha negativt beløp.");
    }
    this.accounts.set(walletId, { depositCents, winningsCents });
  }

  // ── WalletPort impl ──────────────────────────────────────────────────────

  async reserve(input: ReserveInput): Promise<Reservation> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new WalletError("INVALID_AMOUNT", `amountCents må være positivt heltall, fikk ${input.amountCents}.`);
    }
    const account = this.ensureAccount(input.walletId);

    // Idempotens.
    const existingId = this.reservationByIdempotencyKey.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.reservations.get(existingId);
      if (existing && existing.status === "active") {
        if (existing.amountCents !== input.amountCents) {
          throw new WalletError(
            "IDEMPOTENCY_MISMATCH",
            `Reservasjon med key ${input.idempotencyKey} har amountCents ${existing.amountCents}, ikke ${input.amountCents}.`,
          );
        }
        return cloneReservation(existing);
      }
    }

    const reservedCents = this.sumActiveReservationCents(input.walletId);
    const availableCents = account.depositCents + account.winningsCents - reservedCents;
    if (availableCents < input.amountCents) {
      throw new WalletError(
        "INSUFFICIENT_FUNDS",
        `Wallet ${input.walletId} har ikke tilstrekkelig tilgjengelig saldo (${availableCents} < ${input.amountCents}).`,
      );
    }

    const now = new Date();
    const expiresAt = input.expiresAt ?? new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const reservation: PersistedReservation = {
      id: randomUUID(),
      walletId: input.walletId,
      amount: input.amountCents / 100,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      status: "active",
      roomCode: input.roomCode,
      gameSessionId: null,
      createdAt: now.toISOString(),
      releasedAt: null,
      committedAt: null,
      expiresAt,
    };
    this.reservations.set(reservation.id, reservation);
    this.reservationByIdempotencyKey.set(input.idempotencyKey, reservation.id);
    return cloneReservation(reservation);
  }

  async commitReservation(input: CommitReservationInput): Promise<WalletTransaction> {
    const existing = this.reservations.get(input.reservationId);
    if (!existing) {
      throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${input.reservationId} finnes ikke.`);
    }
    if (existing.status === "committed") {
      // Idempotent — finn matchende tx ved key.
      const cached = input.idempotencyKey ? this.txByIdempotencyKey.get(input.idempotencyKey) : undefined;
      if (cached) return cached;
      // Generer en placeholder for at retry skal være pålitelig (kall som
      // ikke ga en idempotency-key får ikke samme tx-id, men ingen
      // dobbel-debit fordi reservation allerede er committed).
      throw new WalletError(
        "RESERVATION_ALREADY_COMMITTED",
        `Reservasjon ${input.reservationId} er allerede committed (uten idempotencyKey).`,
      );
    }
    if (existing.status !== "active") {
      throw new WalletError(
        "INVALID_STATE",
        `Reservasjon ${input.reservationId} er ${existing.status}, kan ikke commit.`,
      );
    }

    // Trekk fra wallet (winnings-first).
    this.applyWinningsFirstDebit(existing.walletId, existing.amountCents);

    const tx: WalletTransaction = {
      id: randomUUID(),
      accountId: existing.walletId,
      type: "TRANSFER_OUT",
      amount: existing.amountCents / 100,
      reason: input.reason,
      createdAt: new Date().toISOString(),
      relatedAccountId: input.toAccountId,
    };
    if (input.idempotencyKey) {
      this.txByIdempotencyKey.set(input.idempotencyKey, tx);
    }

    // Mark reservation as committed.
    const updated: PersistedReservation = {
      ...existing,
      status: "committed",
      committedAt: new Date().toISOString(),
      gameSessionId: input.gameSessionId ?? null,
    };
    this.reservations.set(existing.id, updated);

    return tx;
  }

  async releaseReservation(reservationId: string): Promise<void> {
    const existing = this.reservations.get(reservationId);
    if (!existing) {
      throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${reservationId} finnes ikke.`);
    }
    if (existing.status === "released") {
      // Idempotent — re-kall er no-op.
      return;
    }
    if (existing.status !== "active") {
      throw new WalletError(
        "INVALID_STATE",
        `Reservasjon ${reservationId} er ${existing.status}, kan ikke frigis.`,
      );
    }
    const updated: PersistedReservation = {
      ...existing,
      status: "released",
      releasedAt: new Date().toISOString(),
    };
    this.reservations.set(reservationId, updated);
  }

  async credit(input: CreditInput): Promise<WalletTransaction> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new WalletError("INVALID_AMOUNT", `amountCents må være positivt heltall, fikk ${input.amountCents}.`);
    }
    // Idempotens.
    const cached = this.txByIdempotencyKey.get(input.idempotencyKey);
    if (cached) return cached;

    const account = this.ensureAccount(input.walletId);
    if (input.targetSide === "winnings") {
      account.winningsCents += input.amountCents;
    } else {
      account.depositCents += input.amountCents;
    }

    const tx: WalletTransaction = {
      id: randomUUID(),
      accountId: input.walletId,
      type: "CREDIT",
      amount: input.amountCents / 100,
      reason: input.reason,
      createdAt: new Date().toISOString(),
      split: input.targetSide === "winnings"
        ? { fromDeposit: 0, fromWinnings: input.amountCents / 100 }
        : { fromDeposit: input.amountCents / 100, fromWinnings: 0 },
    };
    this.txByIdempotencyKey.set(input.idempotencyKey, tx);
    return tx;
  }

  async debit(input: DebitInput): Promise<WalletTransaction> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new WalletError("INVALID_AMOUNT", `amountCents må være positivt heltall, fikk ${input.amountCents}.`);
    }
    // Idempotens.
    const cached = this.txByIdempotencyKey.get(input.idempotencyKey);
    if (cached) return cached;

    const account = this.ensureAccount(input.walletId);
    const totalCents = account.depositCents + account.winningsCents;
    if (totalCents < input.amountCents) {
      throw new WalletError(
        "INSUFFICIENT_FUNDS",
        `Wallet ${input.walletId} har saldo ${totalCents}, kan ikke debit ${input.amountCents}.`,
      );
    }

    const split = this.applyWinningsFirstDebit(input.walletId, input.amountCents);
    const tx: WalletTransaction = {
      id: randomUUID(),
      accountId: input.walletId,
      type: "DEBIT",
      amount: input.amountCents / 100,
      reason: input.reason,
      createdAt: new Date().toISOString(),
      split: {
        fromWinnings: split.fromWinningsCents / 100,
        fromDeposit: split.fromDepositCents / 100,
      },
    };
    this.txByIdempotencyKey.set(input.idempotencyKey, tx);
    return tx;
  }

  async getBalance(walletId: string): Promise<WalletBalance> {
    const account = this.accounts.get(walletId);
    if (!account) {
      return { deposit: 0, winnings: 0, total: 0 };
    }
    return {
      deposit: account.depositCents / 100,
      winnings: account.winningsCents / 100,
      total: (account.depositCents + account.winningsCents) / 100,
    };
  }

  // ── Test-helpers ─────────────────────────────────────────────────────────

  /** Hent saldo i øre — bypass kroner-konvertering for invariant-tester. */
  getBalanceCents(walletId: string): { depositCents: number; winningsCents: number; totalCents: number } {
    const account = this.accounts.get(walletId);
    if (!account) {
      return { depositCents: 0, winningsCents: 0, totalCents: 0 };
    }
    return {
      depositCents: account.depositCents,
      winningsCents: account.winningsCents,
      totalCents: account.depositCents + account.winningsCents,
    };
  }

  /** Antall reservasjoner per status. */
  reservationCountByStatus(): Record<Reservation["status"], number> {
    const counts: Record<Reservation["status"], number> = {
      active: 0,
      released: 0,
      committed: 0,
      expired: 0,
    };
    for (const r of this.reservations.values()) {
      counts[r.status]++;
    }
    return counts;
  }

  /** Fjern alle entries — for tester som vil gjenbruke samme port. */
  clear(): void {
    this.accounts.clear();
    this.reservations.clear();
    this.reservationByIdempotencyKey.clear();
    this.txByIdempotencyKey.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private ensureAccount(walletId: string): AccountState {
    let account = this.accounts.get(walletId);
    if (!account) {
      account = { depositCents: 0, winningsCents: 0 };
      this.accounts.set(walletId, account);
    }
    return account;
  }

  private sumActiveReservationCents(walletId: string): number {
    let total = 0;
    for (const r of this.reservations.values()) {
      if (r.walletId === walletId && r.status === "active") {
        total += r.amountCents;
      }
    }
    return total;
  }

  private applyWinningsFirstDebit(
    walletId: string,
    amountCents: number,
  ): { fromWinningsCents: number; fromDepositCents: number } {
    const account = this.ensureAccount(walletId);
    const totalCents = account.depositCents + account.winningsCents;
    if (totalCents < amountCents) {
      throw new WalletError(
        "INSUFFICIENT_FUNDS",
        `Wallet ${walletId} har saldo ${totalCents}, kan ikke debit ${amountCents}.`,
      );
    }
    const fromWinningsCents = Math.min(account.winningsCents, amountCents);
    const fromDepositCents = amountCents - fromWinningsCents;
    account.winningsCents -= fromWinningsCents;
    account.depositCents -= fromDepositCents;
    return { fromWinningsCents, fromDepositCents };
  }
}

function cloneReservation(r: PersistedReservation): Reservation {
  // Returner Reservation-shape (uten internal amountCents). Vi beholder
  // amount i kroner som matcher WalletReservation-typen.
  const { amountCents: _amountCents, ...rest } = r;
  void _amountCents;
  return { ...rest };
}

// Re-eksport av WalletAccountSide for at konsumenter ikke trenger
// adapter-import bare for å bruke porten.
export type { WalletAccountSide };
