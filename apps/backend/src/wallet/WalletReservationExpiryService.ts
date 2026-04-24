/**
 * BIN-693 Option B: Bakgrunns-tick som markerer stale wallet-reservasjoner
 * som `expired`.
 *
 * Brukes for crash-recovery: hvis backend krasjer etter `bet:arm` men før
 * `startGame` har kjørt, ligger reservasjonen aktiv i DB og "låser" spiller-
 * saldo. TTL-grense (default 30 min) sikrer at stale reservasjoner frigis
 * automatisk så spiller ikke har penger bundet i ubrukt state.
 *
 * Env-konfig:
 *   WALLET_RESERVATION_EXPIRY_TICK_MS  (default 300000  — 5 min)
 *   WALLET_RESERVATION_TTL_MS          (default 1800000 — 30 min, brukt av
 *                                       `expires_at` DEFAULT i migrasjonen;
 *                                        service leser kun, endrer ikke DB-
 *                                        default)
 *
 * Samme mønster som andre tick-services (DrawScheduler / JobScheduler):
 *   - `start()` starter interval-loop
 *   - `stop()` canceller interval
 *   - `tick()` kan kalles manuelt fra tests
 */

import type { WalletAdapter, WalletReservation } from "../adapters/WalletAdapter.js";

export interface WalletReservationExpiryServiceOptions {
  walletAdapter: WalletAdapter;
  /** Tick-interval i ms. Default 300000 (5 min). */
  tickIntervalMs?: number;
  /** Invoked after each successful tick with antall expired. Optional — brukes
   *  av tests + telemetri. */
  onTick?: (expiredCount: number) => void;
  /** Invoked når en reservasjon blir expired — kalleren kan broadcaste
   *  wallet:state til affected klienter. Optional. */
  onReservationExpired?: (reservation: WalletReservation) => void;
}

export class WalletReservationExpiryService {
  private readonly adapter: WalletAdapter;
  private readonly tickIntervalMs: number;
  private readonly onTick?: (expiredCount: number) => void;
  private readonly onReservationExpired?: (reservation: WalletReservation) => void;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(opts: WalletReservationExpiryServiceOptions) {
    this.adapter = opts.walletAdapter;
    this.tickIntervalMs = opts.tickIntervalMs ?? 300_000;
    this.onTick = opts.onTick;
    this.onReservationExpired = opts.onReservationExpired;
  }

  start(): void {
    if (this.timer) return;
    // Første tick etter ett interval — ikke umiddelbart ved boot så vi
    // slipper race mot andre init-stages.
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
    // `setInterval` holder prosessen åpen; unref så process.exit kan avslutte
    // uten å blokkeres av denne timeren.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Kjør én expiry-sweep. Returnerer antall reservasjoner markert expired.
   * Eksponert for tests. Throttles med `running`-flag så overlappende ticks
   * ikke dobbel-behandler samme rad.
   */
  async tick(): Promise<number> {
    if (this.running) return 0;
    if (!this.adapter.expireStaleReservations) return 0;
    this.running = true;
    try {
      const count = await this.adapter.expireStaleReservations(Date.now());
      this.onTick?.(count);
      return count;
    } catch (err) {
      // Log men ikke rethrow — en feil i én tick skal ikke krasje servicen.
      // eslint-disable-next-line no-console
      console.error("[WalletReservationExpiry] tick failed:", err);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
