/**
 * Unified pipeline refactor — Fase 1 adapter (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Wrapper som lar eksisterende `WalletAdapter` (kroner-basert) brukes
 * gjennom `WalletPort`-kontrakten (cents-basert). Hovedformål: la
 * `PayoutService` kjøre mot prod-wallet uten å duplisere logikk.
 *
 * Konvertering:
 *   - cents-input fra `WalletPort` → `amountCents / 100` ved videresending
 *     til `WalletAdapter.credit/debit`. Vi sjekker at amountCents er heltall
 *     (Number.isInteger) for å unngå rundefeil — caller MÅ alltid sende øre.
 *   - WalletTransaction returneres uendret siden begge ports/adapters har
 *     samme `WalletTransaction`-interface (kroner-basert internt).
 *   - getBalance returnerer `WalletBalance` som er kroner-basert i begge.
 *
 * Reserve-flyten:
 *   - Hvis underliggende adapter ikke støtter `reserve` (det er optional på
 *     `WalletAdapter`), kaster vi `WalletError("RESERVATION_NOT_SUPPORTED")`
 *     ved første kall. Eksisterende prod-adaptere har `reserve` implementert.
 *
 * Ingen endring i regulatorisk policy:
 *   - `targetSide: "winnings"` videresendes som `to: "winnings"` (default
 *     "deposit"). Adapter har eget admin-route-forbud mot winnings — vi
 *     respekterer det her ved å videresende options uendret.
 *   - Idempotency-key videresendes som `options.idempotencyKey`.
 */

import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
import { WalletError } from "../../adapters/WalletAdapter.js";
import type {
  CommitReservationInput,
  CreditInput,
  DebitInput,
  Reservation,
  ReserveInput,
  WalletPort,
} from "../../ports/WalletPort.js";
import type { WalletBalance, WalletTransaction } from "../../adapters/WalletAdapter.js";

export class WalletAdapterPort implements WalletPort {
  constructor(private readonly adapter: WalletAdapter) {}

  async reserve(input: ReserveInput): Promise<Reservation> {
    if (!this.adapter.reserve) {
      throw new WalletError(
        "RESERVATION_NOT_SUPPORTED",
        "Underliggende WalletAdapter støtter ikke reserve-flyten.",
      );
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new WalletError(
        "INVALID_AMOUNT",
        `amountCents må være positivt heltall, fikk ${input.amountCents}.`,
      );
    }
    return this.adapter.reserve(input.walletId, input.amountCents / 100, {
      idempotencyKey: input.idempotencyKey,
      roomCode: input.roomCode,
      expiresAt: input.expiresAt,
    });
  }

  async commitReservation(input: CommitReservationInput): Promise<WalletTransaction> {
    if (!this.adapter.commitReservation) {
      throw new WalletError(
        "RESERVATION_NOT_SUPPORTED",
        "Underliggende WalletAdapter støtter ikke commitReservation.",
      );
    }
    const result = await this.adapter.commitReservation(
      input.reservationId,
      input.toAccountId,
      input.reason,
      {
        targetSide: input.targetSide,
        idempotencyKey: input.idempotencyKey,
        gameSessionId: input.gameSessionId,
      },
    );
    // WalletAdapter.commitReservation returns both fromTx (debit) og toTx
    // (credit til house-konto). For PayoutService brukes ikke commit-flyten
    // direkte (purchase-stake bruker reserve+commit, payout bruker credit).
    // Vi returnerer fromTx fordi det er spillerens debit-tx — den som er
    // mest relevant for audit-tracing av spillerens egen transaksjon.
    return result.fromTx;
  }

  async releaseReservation(reservationId: string): Promise<void> {
    if (!this.adapter.releaseReservation) {
      throw new WalletError(
        "RESERVATION_NOT_SUPPORTED",
        "Underliggende WalletAdapter støtter ikke releaseReservation.",
      );
    }
    await this.adapter.releaseReservation(reservationId);
  }

  async credit(input: CreditInput): Promise<WalletTransaction> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new WalletError(
        "INVALID_AMOUNT",
        `amountCents må være positivt heltall, fikk ${input.amountCents}.`,
      );
    }
    return this.adapter.credit(input.walletId, input.amountCents / 100, input.reason, {
      idempotencyKey: input.idempotencyKey,
      to: input.targetSide,
    });
  }

  async debit(input: DebitInput): Promise<WalletTransaction> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new WalletError(
        "INVALID_AMOUNT",
        `amountCents må være positivt heltall, fikk ${input.amountCents}.`,
      );
    }
    return this.adapter.debit(input.walletId, input.amountCents / 100, "wallet-port-debit", {
      idempotencyKey: input.idempotencyKey,
    });
  }

  async getBalance(walletId: string): Promise<WalletBalance> {
    return this.adapter.getBothBalances(walletId);
  }
}
