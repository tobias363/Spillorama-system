/**
 * BIN-761: Worker som poller `wallet_outbox` og dispatcher events.
 *
 * Lifecycle:
 *   start() → setInterval(tick, intervalMs)
 *   tick()  → claimNextBatch (FOR UPDATE SKIP LOCKED) → for hver rad,
 *             kall `dispatcher` → markProcessed på success / markFailed på
 *             exception. Etter MAX_ATTEMPTS retries → rad blir 'dead_letter'.
 *   stop()  → clearInterval + venter på pågående tick
 *
 * Dispatcher er pluggable: initialt en stub som logger. BIN-760 wirer
 * inn en socket-pusher som broadcaster `wallet:state` på `wallet:<accountId>`-
 * room.
 *
 * Hvorfor pluggable: separation of concerns. Worker eier polling/retry/
 * dead-letter; dispatcher eier transport-laget. Lett å bytte til Kafka
 * eller multi-transport senere uten å røre worker.
 *
 * Trygg parallell-eksekvering: `claimNextBatch` bruker `FOR UPDATE SKIP LOCKED`
 * — to workere kan kjøre samtidig uten å plukke samme rad. Standard
 * pattern for poll-baserte outbox-workere.
 */

import {
  WalletOutboxRepo,
  type WalletOutboxRow,
  WALLET_OUTBOX_MAX_ATTEMPTS,
} from "./WalletOutboxRepo.js";

/** Dispatcher-signatur. Kast for å trigge retry. */
export type WalletOutboxDispatcher = (row: WalletOutboxRow) => void | Promise<void>;

export interface WalletOutboxWorkerOptions {
  repo: WalletOutboxRepo;
  /** Dispatcher som broadcaster events. Stub-default logger til console. */
  dispatcher?: WalletOutboxDispatcher;
  /** Poll-interval ms. Default 1000. */
  intervalMs?: number;
  /** Batch-størrelse per tick. Default 50. */
  batchSize?: number;
  /** Optional callback for tests/telemetri etter hver tick. */
  onTick?: (result: WalletOutboxTickResult) => void;
}

export interface WalletOutboxTickResult {
  claimed: number;
  processed: number;
  failed: number;
  deadLettered: number;
}

/** No-op dispatcher som default — logger event-typen. Aldri prod-relevant. */
const defaultDispatcher: WalletOutboxDispatcher = (row) => {
  // eslint-disable-next-line no-console
  console.debug(
    `[WalletOutboxWorker] (stub) ${row.eventType} acc=${row.accountId} op=${row.operationId}`,
  );
};

export class WalletOutboxWorker {
  private readonly repo: WalletOutboxRepo;
  /** Mutable så `setDispatcher()` kan bytte etter konstruksjon. */
  private dispatcher: WalletOutboxDispatcher;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly onTick?: (result: WalletOutboxTickResult) => void;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;

  constructor(opts: WalletOutboxWorkerOptions) {
    this.repo = opts.repo;
    this.dispatcher = opts.dispatcher ?? defaultDispatcher;
    this.intervalMs = opts.intervalMs ?? 1000;
    this.batchSize = opts.batchSize ?? 50;
    this.onTick = opts.onTick;
  }

  /** Setter dispatcher etter konstruksjon. Brukt når BIN-760 wirer socket-pusher
   *  inn etter at io-instansen er opprettet. Idempotent. */
  setDispatcher(dispatcher: WalletOutboxDispatcher): void {
    this.dispatcher = dispatcher;
  }

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // unref så process.exit ikke blokkes på timer
    this.timer.unref?.();
  }

  /**
   * Stopper worker. Venter på at pågående tick er ferdig før resolve.
   * Idempotent.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Vent (best-effort, max 5s) på at en pågående tick er ferdig.
    const deadline = Date.now() + 5000;
    while (this.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /**
   * Kjør én poll → dispatch-batch. Eksponert for tests.
   *
   * Throttles via `running`-flag — hvis forrige tick ikke er ferdig hopper
   * vi over (samme mønster som WalletReservationExpiryService).
   */
  async tick(): Promise<WalletOutboxTickResult> {
    if (this.running || this.stopping) {
      return { claimed: 0, processed: 0, failed: 0, deadLettered: 0 };
    }
    this.running = true;
    let claimed = 0;
    let processed = 0;
    let failed = 0;
    let deadLettered = 0;
    try {
      const rows = await this.repo.claimNextBatch(this.batchSize);
      claimed = rows.length;
      const succeededIds: number[] = [];
      for (const row of rows) {
        try {
          await this.dispatcher(row);
          succeededIds.push(row.id);
          processed++;
        } catch (err) {
          // markFailed inkrementerer ikke attempts — claimNextBatch har
          // allerede gjort det. Bestemt om dead_letter basert på
          // row.attempts (som er post-increment).
          const message = err instanceof Error ? err.message : String(err);
          try {
            await this.repo.markFailed(row.id, message, row.attempts);
            if (row.attempts >= WALLET_OUTBOX_MAX_ATTEMPTS) {
              deadLettered++;
            } else {
              failed++;
            }
          } catch (markErr) {
            // markFailed selv feilet — log men la worker fortsette
            // eslint-disable-next-line no-console
            console.error("[WalletOutboxWorker] markFailed failed:", markErr);
            failed++;
          }
        }
      }
      if (succeededIds.length > 0) {
        await this.repo.markProcessed(succeededIds);
      }
    } catch (err) {
      // Klar feil i selve poll-en (DB nede o.l.) — log og vent på neste tick.
      // eslint-disable-next-line no-console
      console.error("[WalletOutboxWorker] tick failed:", err);
    } finally {
      this.running = false;
      const result: WalletOutboxTickResult = { claimed, processed, failed, deadLettered };
      this.onTick?.(result);
      return result;
    }
  }
}
