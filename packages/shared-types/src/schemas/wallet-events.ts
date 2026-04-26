// ── BIN-760: Authoritative `wallet:state` socket-event schema ───────────────
//
// Industristandard (Pragmatic Play / Evolution): wallet-state må flyte gjennom
// en dedikert socket-channel separat fra game state. Tidligere piggybacket
// `me.balance` på `room:update` — når room:update mangler eller har stale
// data, ble wallet-state-update også droppet, og klienten viste feil saldo.
//
// Wire-flyt:
//   1. Server commit wallet-operasjon (credit/debit/transfer/reserve/...)
//   2. POST-commit kalles `walletStatePusher.pushForWallet(walletId, reason)`
//   3. Server emitter `wallet:state` til Socket.IO-rommet `wallet:<walletId>`
//   4. Klient (GameBridge + lobby) abonnerer på `wallet:state` via en Socket
//      som joinet `wallet:<walletId>`-rommet ved auth/room-join.
//   5. Klient oppdaterer chip umiddelbart med autoritativ payload — ingen
//      refetch nødvendig, ingen race med `room:update`.
//
// `room:update.me.balance` skrives FORTSATT (backwards-compat) — eldre klienter
// kan bruke den. Ny klient prefererer `wallet:state` og dedup'er bort
// dupliserte chip-renders.
//
// Outbox-pattern: BIN-761 vil flytte emit-en gjennom et persistent outbox-table
// så et server-restart ikke kan tape pushes. Per i dag: direkte emit etter
// commit. Ved server-crash mellom commit og emit refetcher klienten på
// reconnect (room:update / GET /api/wallet/me).

import { z } from "zod";

/** Hvilken wallet-operasjon utløste push-en — for klient-debug + telemetri. */
export const WalletStateReasonSchema = z.enum([
  "credit",
  "debit",
  "transfer",
  "reservation",
  "expiry",
  "commit",
  "release",
]);
export type WalletStateReason = z.infer<typeof WalletStateReasonSchema>;

/** Optional kontekst for sporing (gameId/roomCode/opId). Alle felter optional. */
export const WalletStateSourceSchema = z.object({
  gameId: z.string().optional(),
  roomCode: z.string().optional(),
  opId: z.string().optional(),
});
export type WalletStateSource = z.infer<typeof WalletStateSourceSchema>;

/**
 * Snapshot av en wallet-konto med reservasjons-info. Speiler
 * `WalletAccount` + `WalletBalance` + reservasjons-felt fra
 * `apps/backend/src/adapters/WalletAdapter.ts`.
 *
 * Beløp er i kroner (major units), matchende eksisterende wallet-API.
 */
export const WalletAccountWithReservationsSchema = z.object({
  walletId: z.string().min(1),
  /** Total saldo (deposit + winnings) — bakover-kompatibelt med eldre klienter. */
  balance: z.number(),
  /** Innskudd-siden. Loss-limit teller kun trekk herfra (PR-W1). */
  depositBalance: z.number(),
  /** Gevinst-siden. Trekkes først ved kjøp (winnings-first). */
  winningsBalance: z.number(),
  /** Sum av aktive reservasjoner. 0 hvis ingen aktive. */
  reservedAmount: z.number().nonnegative(),
  /** Tilgjengelig saldo = balance − reservedAmount. Klient bruker denne for chip. */
  availableBalance: z.number(),
  /** Tilgjengelig deposit-saldo etter reservasjon-prorata. Optional (hvis adapter
   *  ikke eksponerer split-aware available, lar den være ekvivalent med
   *  depositBalance for bakover-kompat). */
  availableDeposit: z.number().optional(),
  /** Tilgjengelig winnings-saldo. Tilsvarende optional. */
  availableWinnings: z.number().optional(),
});
export type WalletAccountWithReservations = z.infer<
  typeof WalletAccountWithReservationsSchema
>;

/**
 * Server → Client: autoritativ wallet-state-push.
 *
 * Emittes til Socket.IO-rommet `wallet:<walletId>` etter hver wallet-commit.
 * Klient skal alltid foretrekke denne over `room:update.me.balance`.
 */
export const WalletStateEventSchema = z.object({
  walletId: z.string().min(1),
  account: WalletAccountWithReservationsSchema,
  /** Server-clock-timestamp (ms). Klient bruker for last-write-wins-dedup. */
  serverTimestamp: z.number().int().nonnegative(),
  reason: WalletStateReasonSchema,
  source: WalletStateSourceSchema.optional(),
});
export type WalletStateEvent = z.infer<typeof WalletStateEventSchema>;
