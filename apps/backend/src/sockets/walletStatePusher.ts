/**
 * BIN-760: Authoritative `wallet:state` socket-pusher.
 *
 * Industristandard (Pragmatic Play / Evolution): wallet-state må flyte gjennom
 * en dedikert socket-channel separat fra game state. Tidligere piggybacket
 * `me.balance` på `room:update`. Hvis `room:update` manglet eller hadde
 * stale data, ble wallet-state-update også droppet og chip-en viste feil
 * saldo. BIN-760 eliminerer hele room:update-stale-balance-kategorien
 * permanent ved å pushe wallet-state via en separat, autoritativ event.
 *
 * Wire-flyt:
 *   1. Server commit wallet-operasjon (credit/debit/transfer/reserve/...)
 *   2. POST-commit kalles `pusher.pushForWallet(walletId, reason, source?)`
 *   3. Pusher-en henter ferskt `WalletAccount` + `getAvailableBalance` +
 *      sum(reservations) og emitter `wallet:state` til Socket.IO-rommet
 *      `wallet:<walletId>`
 *   4. Klient (GameBridge + lobby.js) abonnerer på `wallet:state` på
 *      socketen som joinet `wallet:<walletId>`-rommet ved auth/room-join.
 *   5. Klient oppdaterer chip umiddelbart med autoritativ payload — ingen
 *      refetch, ingen race med `room:update`.
 *
 * Backwards-compat:
 *   - `room:update.me.balance` skrives fortsatt; eldre klienter virker som
 *     før. Ny klient prefererer wallet:state.
 *
 * TODO BIN-761 (outbox):
 *   - Per i dag emittes direkte etter commit. Server-restart mellom commit
 *     og emit kan tape én push (klient refetcher på reconnect → riktig
 *     state). BIN-761 vil flytte emit-en gjennom en persistent outbox-
 *     tabell (`app_wallet_outbox`) slik at restart aldri kan tape state.
 *   - Når outbox-en lander, skal `pushForWallet` skrive en row i samme
 *     transaksjon som wallet-commit, og en bakgrunns-tick drainer outbox-
 *     en til Socket.IO. `WalletStatePusher`-API-et endres ikke.
 */

import type { Server as SocketServer } from "socket.io";
import {
  SocketEvents,
  type WalletStateEvent,
  type WalletStateReason,
  type WalletStateSource,
  type WalletAccountWithReservations,
} from "@spillorama/shared-types/socket-events";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "wallet-state-pusher" });

/**
 * Socket.IO room-key for per-wallet broadcasts. Sockets joiner dette rommet
 * etter at deres walletId er kjent (room:create / room:join / m.fl.).
 */
export function walletRoomKey(walletId: string): string {
  return `wallet:${walletId}`;
}

export interface WalletStatePusherDeps {
  io: SocketServer;
  walletAdapter: WalletAdapter;
  /** Optional now-ms-funktion for tests. Default: Date.now. */
  now?: () => number;
}

export interface WalletStatePusher {
  /**
   * Push autoritativ wallet-state til alle sockets i `wallet:<walletId>`-
   * rommet. Fail-soft: hvis fetch eller emit feiler, logges en warn og
   * caller får ikke kastet en feil — wallet-commit-en er allerede i DB.
   *
   * @param walletId — wallet å pushe for
   * @param reason   — hvilken operasjon utløste push-en (debug + telemetri)
   * @param source   — optional kontekst (gameId/roomCode/opId)
   */
  pushForWallet(
    walletId: string,
    reason: WalletStateReason,
    source?: WalletStateSource,
  ): Promise<void>;

  /**
   * Test-helper: beregn payload uten å emitte. Brukes av integration-tests
   * for å validere at `wallet:state` ville hatt riktig saldo + reservasjon
   * uten å sette opp full Socket.IO-handshake.
   */
  buildPayload(
    walletId: string,
    reason: WalletStateReason,
    source?: WalletStateSource,
  ): Promise<WalletStateEvent>;
}

export function createWalletStatePusher(
  deps: WalletStatePusherDeps,
): WalletStatePusher {
  const { io, walletAdapter, now = Date.now } = deps;

  async function fetchAccount(walletId: string): Promise<WalletAccountWithReservations> {
    // Hent split + total i én spørring (adapter-internt).
    const balances = await walletAdapter.getBothBalances(walletId);

    // BIN-693 Option B: hvis adapter eksponerer reservation-API, regn ut
    // tilgjengelig saldo og sum(reservations). Eldre adaptere (File/Http)
    // har ikke disse — fallback til "ingen reservasjoner" så payload-en
    // fortsatt er gyldig.
    let availableBalance = balances.total;
    let reservedAmount = 0;
    if (walletAdapter.getAvailableBalance) {
      try {
        availableBalance = await walletAdapter.getAvailableBalance(walletId);
        reservedAmount = Math.max(0, balances.total - availableBalance);
      } catch (err) {
        log.warn(
          { err, walletId },
          "getAvailableBalance feilet — fallback til total balance som available",
        );
        availableBalance = balances.total;
        reservedAmount = 0;
      }
    }

    return {
      walletId,
      balance: balances.total,
      depositBalance: balances.deposit,
      winningsBalance: balances.winnings,
      reservedAmount,
      availableBalance,
      // Per-side available — ikke alle adaptere kan beregne dette atomisk i
      // én spørring. Default: la deposit + winnings være "available" hvis
      // ingen reservasjoner; ved reservasjoner må klient-koden bruke total
      // availableBalance som autoritativ.
      availableDeposit: reservedAmount === 0 ? balances.deposit : undefined,
      availableWinnings: reservedAmount === 0 ? balances.winnings : undefined,
    };
  }

  async function buildPayload(
    walletId: string,
    reason: WalletStateReason,
    source?: WalletStateSource,
  ): Promise<WalletStateEvent> {
    const account = await fetchAccount(walletId);
    return {
      walletId,
      account,
      serverTimestamp: now(),
      reason,
      source,
    };
  }

  async function pushForWallet(
    walletId: string,
    reason: WalletStateReason,
    source?: WalletStateSource,
  ): Promise<void> {
    if (!walletId) {
      // Defensive: tomme/system-walletId-er skal aldri pushes (system-konti
      // har ingen klient-socket).
      return;
    }
    try {
      const payload = await buildPayload(walletId, reason, source);
      io.to(walletRoomKey(walletId)).emit(SocketEvents.WALLET_STATE, payload);
    } catch (err) {
      // Fail-soft: wallet-commit er allerede persistert. Klient refetcher
      // ved neste `room:update` eller `GET /api/wallet/me`. En tapt push
      // er ikke en saldo-bug, bare en optimaliserings-miss.
      log.warn(
        { err, walletId, reason, source },
        "wallet:state push feilet — commit er intakt; klient refetcher på neste tick",
      );
    }
  }

  return { pushForWallet, buildPayload };
}
