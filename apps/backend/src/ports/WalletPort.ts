/**
 * Unified pipeline refactor — Fase 0 (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Narrow port for wallet-operasjonene som `PayoutService` og resten av
 * GameOrchestrator-pipelinen trenger. Dette er en bevisst innskrumpet
 * kontrakt sammenlignet med `WalletAdapter` (apps/backend/src/adapters/
 * WalletAdapter.ts):
 *
 * - Kun reserve/commit/release/credit/debit/getBalance er eksponert
 *   her — dvs. de operasjonene PayoutService gjør under normal payout-
 *   eller-rollback-flyt.
 * - Topup/withdraw/transfer (deposit-flyter, admin-overstyringer) er
 *   IKKE en del av game-pipelinen og holdes utenfor.
 * - getBalance returnerer det 3-tuple `WalletBalance` (deposit/
 *   winnings/total) slik at split-bevisst kode kan bruke porten direkte.
 *
 * Eksisterende `WalletAdapter`-implementasjoner trenger IKKE implementere
 * denne porten ennå — Fase 1 introduserer en tynn `WalletAdapterPort`-
 * adapter som mapper mellom de to. I Fase 0 finnes kun `InMemoryWalletPort`
 * som test-double.
 */

import type {
  WalletAccountSide,
  WalletBalance,
  WalletReservation,
  WalletTransaction,
} from "../adapters/WalletAdapter.js";

/**
 * Unified pipeline-versjonen av en aktiv reservasjon.
 *
 * Identisk med `WalletReservation` i adapter-laget — re-eksportert som
 * navngitt alias `Reservation` for at design-dokumentet skal kunne bruke
 * det kortere navnet uten å skape navnekollisjon med adapter-typen.
 */
export type Reservation = WalletReservation;

export type { WalletAccountSide, WalletBalance, WalletTransaction };

/**
 * Reservere et beløp i wallet.
 *
 * `idempotencyKey` MÅ være deterministisk på callers nivå (typisk
 * `IdempotencyKeyPort.forArm(roomCode, playerId, armCycleId, totalWeighted)`).
 * Re-kall med samme key skal returnere samme reservation uten å trekke
 * mer fra wallet. `roomCode` er påkrevd så `listReservationsByRoom()`
 * kan brukes til game-abort release-all.
 */
export interface ReserveInput {
  walletId: string;
  amountCents: number;
  idempotencyKey: string;
  roomCode: string;
  /** ISO-8601 expiration. Default 30 min hvis utelatt. */
  expiresAt?: string;
}

/**
 * Argumenter for `commitReservation`. `targetSide` lander beløpet på
 * deposit eller winnings — `winnings` er kun lov fra game-engine
 * (regulatorisk: admin-credit til winnings er forbudt).
 */
export interface CommitReservationInput {
  reservationId: string;
  toAccountId: string;
  reason: string;
  targetSide?: WalletAccountSide;
  idempotencyKey?: string;
  /** Game-session-id for traceability. */
  gameSessionId?: string;
}

/**
 * Direkte credit (uten reservasjon). Brukes av payout-flyt og admin-
 * korrigering. `targetSide` er påkrevd så caller eksplisitt må velge
 * deposit (default) vs winnings (kun game-engine).
 */
export interface CreditInput {
  walletId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
  targetSide: WalletAccountSide;
}

/**
 * Direkte debit (uten reservasjon). Brukes av salg-flyter som ikke går
 * via reservasjon (f.eks. kontant-kjøp via agent). winnings-first-policy
 * gjelder fortsatt — adapter velger trekk-rekkefølge.
 */
export interface DebitInput {
  walletId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}

/**
 * Smal wallet-kontrakt for unified pipeline.
 *
 * NB: Beløp er i `cents` (NOK-øre) i denne porten — ikke i kroner som i
 * adapter-laget. Designet med "money in cents"-pattern som er standard i
 * payout-libraries, og som matcher idempotency-key-helperen i design-
 * dokumentet (`forArm(... totalWeighted)`).
 *
 * Implementasjoner:
 * - `InMemoryWalletPort` (Fase 0) — for invariant-tester.
 * - `WalletAdapterPort` (Fase 1) — wrapper rundt eksisterende
 *   `WalletAdapter` i prod, som konverterer cents↔kroner.
 */
export interface WalletPort {
  /**
   * Opprett (eller hent, hvis idempotency-key matcher) en aktiv reservasjon.
   * Reservasjonen reduserer `getAvailableBalance` men ikke `getBalance`.
   * Kaster `INSUFFICIENT_FUNDS` hvis tilgjengelig saldo < amountCents.
   */
  reserve(input: ReserveInput): Promise<Reservation>;

  /**
   * Konverter en aktiv reservasjon til en faktisk wallet-transaksjon.
   * Status går fra `active → committed`. Idempotent på reservation-id.
   */
  commitReservation(input: CommitReservationInput): Promise<WalletTransaction>;

  /**
   * Frigi en aktiv reservasjon uten å gjennomføre commit. Status går
   * fra `active → released`. Idempotent — re-kall returnerer samme
   * (allerede-released) reservation.
   */
  releaseReservation(reservationId: string): Promise<void>;

  /**
   * Direkte credit (uten reservasjon). Idempotent på `idempotencyKey`.
   * `targetSide: "winnings"` er kun lov fra game-engine; admin-flyter
   * må alltid bruke `"deposit"`.
   */
  credit(input: CreditInput): Promise<WalletTransaction>;

  /**
   * Direkte debit (uten reservasjon). Idempotent på `idempotencyKey`.
   * Kaster `INSUFFICIENT_FUNDS` hvis total balance < amountCents.
   */
  debit(input: DebitInput): Promise<WalletTransaction>;

  /**
   * Hent saldo som `{ deposit, winnings, total }`. `total` er alltid
   * `deposit + winnings` og er aldri negativ for vanlige spillere
   * (system-kontoer kan gå negativt for fixed-prize-policy).
   */
  getBalance(walletId: string): Promise<WalletBalance>;
}
