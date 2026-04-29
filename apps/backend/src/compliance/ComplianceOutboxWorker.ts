/**
 * COMP-P0-002: Worker som poller `app_compliance_outbox` og dispatcher
 * pending compliance-events til underliggende ComplianceLedgerPort.
 *
 * Lifecycle:
 *   start() → setInterval(tick, intervalMs)
 *   tick()  → claimNextBatch (FOR UPDATE SKIP LOCKED) → for hver rad,
 *             call dispatcher → markProcessed på success / markFailed på
 *             exception. Etter MAX_ATTEMPTS retries → rad blir 'dead_letter'.
 *   stop()  → clearInterval + venter på pågående tick
 *
 * Dispatcher er underliggende ComplianceLedgerPort — typisk
 * `BingoEngine.getComplianceLedgerPort()` som persisterer til
 * `app_rg_compliance_ledger`. ComplianceLedger har egen `ON CONFLICT
 * (idempotency_key) DO NOTHING` så worker-retry er trygt: én outbox-rad
 * → maks én §71-rad uavhengig av antall retries.
 *
 * Trygg parallell-eksekvering: `claimNextBatch` bruker `FOR UPDATE SKIP
 * LOCKED` — to workere kan kjøre samtidig uten å plukke samme rad.
 *
 * Throttling: `running`-flag forhindrer overlappende ticks (samme mønster
 * som WalletOutboxWorker).
 *
 * Mønsteret er identisk med BIN-761 WalletOutboxWorker — dette er bevisst.
 * Code review-ready og enklere å vedlikeholde når begge outbox-systemer
 * deler operasjonell intuisjon.
 */

import pino from "pino";

import {
  type ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";
import {
  COMPLIANCE_OUTBOX_MAX_ATTEMPTS,
  ComplianceOutboxRepo,
  type ComplianceOutboxRow,
} from "./ComplianceOutboxRepo.js";

const log = pino({ name: "ComplianceOutboxWorker" });

export interface ComplianceOutboxWorkerOptions {
  repo: ComplianceOutboxRepo;
  /**
   * Underliggende dispatcher — typisk `BingoEngine.getComplianceLedgerPort()`.
   * IKKE wrappede i `ComplianceOutboxComplianceLedgerPort` (det ville gi
   * uendelig løkke). Worker må gå direkte til underliggende port.
   */
  dispatcher: ComplianceLedgerPort;
  /** Poll-interval ms. Default 1000. */
  intervalMs?: number;
  /** Batch-størrelse per tick. Default 50. */
  batchSize?: number;
  /** Optional callback for tests/telemetri etter hver tick. */
  onTick?: (result: ComplianceOutboxTickResult) => void;
}

export interface ComplianceOutboxTickResult {
  claimed: number;
  processed: number;
  failed: number;
  deadLettered: number;
}

export class ComplianceOutboxWorker {
  private readonly repo: ComplianceOutboxRepo;
  private readonly dispatcher: ComplianceLedgerPort;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly onTick?: (result: ComplianceOutboxTickResult) => void;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;

  constructor(opts: ComplianceOutboxWorkerOptions) {
    this.repo = opts.repo;
    this.dispatcher = opts.dispatcher;
    this.intervalMs = opts.intervalMs ?? 1000;
    this.batchSize = opts.batchSize ?? 50;
    this.onTick = opts.onTick;
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
   * vi over (samme mønster som WalletOutboxWorker).
   */
  async tick(): Promise<ComplianceOutboxTickResult> {
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
          await this.dispatch(row);
          succeededIds.push(row.id);
          processed++;
        } catch (err) {
          // markFailed inkrementerer ikke attempts — claimNextBatch har
          // allerede gjort det. Bestemt om dead_letter basert på
          // row.attempts (som er post-increment).
          const message = err instanceof Error ? err.message : String(err);
          try {
            await this.repo.markFailed(row.id, message, row.attempts);
            if (row.attempts >= COMPLIANCE_OUTBOX_MAX_ATTEMPTS) {
              deadLettered++;
              log.error(
                {
                  outboxId: row.id,
                  idempotencyKey: row.idempotencyKey,
                  eventType: row.payload.eventType,
                  hallId: row.payload.hallId,
                  amount: row.payload.amount,
                  attempts: row.attempts,
                  lastError: message,
                },
                "[COMP-P0-002] compliance-outbox-rad nådde MAX_ATTEMPTS — DEAD-LETTER. Manuell ops-replay kreves.",
              );
            } else {
              failed++;
            }
          } catch (markErr) {
            // markFailed selv feilet — log men la worker fortsette
            log.error(
              { err: markErr, outboxId: row.id },
              "[COMP-P0-002] markFailed feilet — worker fortsetter",
            );
            failed++;
          }
        }
      }
      if (succeededIds.length > 0) {
        await this.repo.markProcessed(succeededIds);
      }
    } catch (err) {
      // Klar feil i selve poll-en (DB nede o.l.) — log og vent på neste tick.
      log.error({ err }, "[COMP-P0-002] worker tick feilet");
    } finally {
      this.running = false;
      const result: ComplianceOutboxTickResult = { claimed, processed, failed, deadLettered };
      this.onTick?.(result);
      return result;
    }
  }

  /**
   * Dispatch én outbox-rad til underliggende ComplianceLedgerPort.
   * Rekonstruerer call-en fra payload-feltene (samme shape som
   * ComplianceLedgerEventInput).
   */
  private async dispatch(row: ComplianceOutboxRow): Promise<void> {
    await this.dispatcher.recordComplianceLedgerEvent({
      hallId: row.payload.hallId,
      gameType: row.payload.gameType,
      channel: row.payload.channel,
      eventType: row.payload.eventType,
      amount: row.payload.amount,
      roomCode: row.payload.roomCode,
      gameId: row.payload.gameId,
      claimId: row.payload.claimId,
      playerId: row.payload.playerId,
      walletId: row.payload.walletId,
      sourceAccountId: row.payload.sourceAccountId,
      targetAccountId: row.payload.targetAccountId,
      policyVersion: row.payload.policyVersion,
      batchId: row.payload.batchId,
      metadata: row.payload.metadata,
    });
  }
}
