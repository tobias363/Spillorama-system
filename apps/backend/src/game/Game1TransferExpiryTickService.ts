/**
 * Task 1.6: expiry-tick for master-transfer-requests.
 *
 * Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md Appendix B.3.
 *
 * Separat tick-service (ikke utvidelse av Game1ScheduleTickService) for å holde
 * ansvar smalt: denne er kun for transfer-request-TTL-håndheving. Default
 * intervall: 5s — trenger ikke være hyppigere siden 60s TTL er grov.
 *
 * Algoritme:
 *   1. Game1TransferHallService.expireStaleTasks() gjør atomisk UPDATE
 *      status='expired' for alle pending + valid_till < NOW(), skriver audit
 *      per rad, og returnerer de expired requests.
 *   2. For hver expired request kaller vi broadcast-callback slik at
 *      `/admin-game1` + default-namespace får `game1:transfer-expired`.
 *
 * Broadcast-callback er valgfri for å holde service test-bar uten socket-miljø
 * (matcher Game1MasterControlService som late-binder broadcaster).
 */

import type { Game1TransferHallService, TransferRequest } from "./Game1TransferHallService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-transfer-expiry-tick" });

export type TransferExpiryBroadcastHook = (expired: TransferRequest) => void;

export interface Game1TransferExpiryTickServiceOptions {
  service: Game1TransferHallService;
  onExpiredBroadcast?: TransferExpiryBroadcastHook;
}

export interface Game1TransferExpiryTickResult {
  expiredCount: number;
  errors: number;
  errorMessages?: string[];
}

export class Game1TransferExpiryTickService {
  private readonly service: Game1TransferHallService;
  private onExpiredBroadcast: TransferExpiryBroadcastHook | null;

  constructor(options: Game1TransferExpiryTickServiceOptions) {
    this.service = options.service;
    this.onExpiredBroadcast = options.onExpiredBroadcast ?? null;
  }

  /** Late-bind broadcaster-callback (brukes av index.ts for å unngå sirkulær DI). */
  setBroadcastHook(hook: TransferExpiryBroadcastHook): void {
    this.onExpiredBroadcast = hook;
  }

  /** Én tick. Expirer pending-requests med valid_till < NOW(). */
  async tick(): Promise<Game1TransferExpiryTickResult> {
    const expired = await this.service.expireStaleTasks();
    let errors = 0;
    const errorMessages: string[] = [];

    if (this.onExpiredBroadcast) {
      for (const req of expired) {
        try {
          this.onExpiredBroadcast(req);
        } catch (err) {
          errors++;
          const msg = `${req.id}: ${(err as Error).message ?? "unknown"}`;
          if (errorMessages.length < 10) errorMessages.push(msg);
          log.warn(
            { err, requestId: req.id, gameId: req.gameId },
            "transfer-expiry: broadcast-hook feilet — fortsetter"
          );
        }
      }
    }

    if (expired.length > 0) {
      log.info(
        { expiredCount: expired.length, broadcastErrors: errors },
        "transfer-expiry tick completed"
      );
    }

    return {
      expiredCount: expired.length,
      errors,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
    };
  }
}
