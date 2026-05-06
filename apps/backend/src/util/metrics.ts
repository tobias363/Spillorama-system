/**
 * BIN-172: Prometheus metrics for bingo backend.
 *
 * Usage:
 *   import { metrics } from "../util/metrics.js";
 *   metrics.activeRooms.set(count);
 *   metrics.drawErrors.inc({ category: "TRANSIENT" });
 *
 * Endpoint:
 *   GET /metrics → text/plain Prometheus format
 */

import client from "prom-client";

// Collect default Node.js metrics (CPU, memory, event loop, GC)
client.collectDefaultMetrics({ prefix: "bingo_" });

export const register = client.register;

export const metrics = {
  // Game state
  activeRooms: new client.Gauge({
    name: "bingo_active_rooms",
    help: "Number of active game rooms"
  }),
  activePlayers: new client.Gauge({
    name: "bingo_active_players",
    help: "Total players across all rooms"
  }),
  gameRoundsTotal: new client.Counter({
    name: "bingo_game_rounds_total",
    help: "Total game rounds started"
  }),

  // Draw scheduler
  schedulerTickDuration: new client.Histogram({
    name: "bingo_scheduler_tick_duration_ms",
    help: "Duration of scheduler tick in milliseconds",
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000]
  }),
  drawErrors: new client.Counter({
    name: "bingo_draw_errors_total",
    help: "Total draw errors by category",
    labelNames: ["category"] as const
  }),
  stuckRooms: new client.Gauge({
    name: "bingo_stuck_rooms",
    help: "Number of rooms detected as stuck by watchdog"
  }),
  lockTimeouts: new client.Counter({
    name: "bingo_lock_timeouts_total",
    help: "Total scheduler lock timeouts (forced releases)"
  }),

  // Wallet operations
  walletOperationDuration: new client.Histogram({
    name: "bingo_wallet_operation_duration_ms",
    help: "Duration of wallet operations in milliseconds",
    labelNames: ["operation"] as const,
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000]
  }),

  // Circuit breaker
  circuitBreakerState: new client.Gauge({
    name: "bingo_circuit_breaker_open",
    help: "1 if circuit breaker is open, 0 if closed",
    labelNames: ["name"] as const
  }),

  /**
   * HIGH-8: per-state gauge for the wallet circuit breaker. Exactly one
   * label is `1` at any time; the others are `0`. Lets dashboards alert
   * on time-spent in OPEN or HALF_OPEN, not just open/closed-edge.
   *
   * Example PromQL:
   *   max(wallet_circuit_state{state="OPEN"}) > 0
   */
  walletCircuitState: new client.Gauge({
    name: "wallet_circuit_state",
    help: "Wallet circuit-breaker state (1 = active, 0 = inactive) per state label",
    labelNames: ["state"] as const,
  }),

  // Socket.IO
  socketConnections: new client.Gauge({
    name: "bingo_socket_connections",
    help: "Current Socket.IO connections"
  }),
  rateLimitRejections: new client.Counter({
    name: "bingo_rate_limit_rejections_total",
    help: "Total rate-limited socket events",
    labelNames: ["event"] as const
  }),

  // Webhooks
  webhookDeliveries: new client.Counter({
    name: "bingo_webhook_deliveries_total",
    help: "Total webhook deliveries by status",
    labelNames: ["status"] as const
  }),

  // BIN-539: Claims + payouts + reconnects — the three signals that tell us
  // whether a pilot run is healthy. `game` lets us split wheel/chest/bingo
  // variants once multi-slug hall scheduling lands; `hall` splits by room.
  claimSubmitted: new client.Counter({
    name: "spillorama_claim_submitted_total",
    help: "Total claim:submit events by game slug, hall, and claim type",
    labelNames: ["game", "hall", "type"] as const,
  }),
  payoutAmount: new client.Histogram({
    name: "spillorama_payout_amount",
    help: "Distribution of individual payout amounts in kroner (per claim)",
    labelNames: ["game", "hall", "type"] as const,
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000],
  }),
  reconnectTotal: new client.Counter({
    name: "spillorama_reconnect_total",
    help: "Total socket reconnects by reason (client-visible disconnect cause)",
    labelNames: ["reason"] as const,
  }),

  // BIN-767: Wallet idempotency-key TTL-cleanup (90-dager retention).
  // Inkrementeres av `idempotencyKeyCleanup` cron-job per nullsatt rad.
  // Industri-standard signal for at TTL-jobben holder UNIQUE-indexen ren.
  walletIdempotencyKeysPrunedTotal: new client.Counter({
    name: "wallet_idempotency_keys_pruned_total",
    help: "Total wallet_transactions.idempotency_key columns nullified by TTL-cleanup (BIN-767)",
  }),

  // BIN-763: nightly wallet reconciliation. `divergence_total` økes hver
  // gang en wallet_account-balanse avviker fra SUM(wallet_entries.amount)
  // for samme account_side med mer enn 0.01 NOK. `clean_total` økes når
  // hele reconciliation-runden fant null divergenser.
  walletReconciliationDivergence: new client.Counter({
    name: "wallet_reconciliation_divergence_total",
    help: "Total wallet reconciliation divergences detected (per account_id + side).",
    labelNames: ["account_id", "side"] as const,
  }),
  walletReconciliationClean: new client.Counter({
    name: "wallet_reconciliation_clean_total",
    help: "Total nightly reconciliation runs that found zero divergences.",
  }),
  walletReconciliationDuration: new client.Histogram({
    name: "wallet_reconciliation_duration_ms",
    help: "Duration of a full nightly wallet reconciliation tick in milliseconds.",
    buckets: [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 120_000],
  }),
  walletReconciliationAccountsScanned: new client.Counter({
    name: "wallet_reconciliation_accounts_scanned_total",
    help: "Total number of (account, side) tuples scanned during reconciliation.",
  }),

  // HIGH-4 (Casino Review): post-recovery integrity drift between
  // in-memory RoomState (currentGame.tickets/drawnNumbers) og siste
  // PostgreSQL-checkpoint. Inkrementeres fra
  // BingoEngineRecoveryIntegrityCheck. WARN i logger samtidig — alert
  // ops på `wallet_room_drift_total > 0`.
  walletRoomDriftTotal: new client.Counter({
    name: "wallet_room_drift_total",
    help: "Antall recovery-inkonsistenser mellom in-memory RoomState og siste PG-checkpoint",
    labelNames: ["room", "field"] as const,
  }),

  // HIGH-5 (Casino Review): per-room draw-lock-konflikter. Inkrementeres
  // når DRAW_IN_PROGRESS kastes — to samtidige draw:next mot samme rom.
  // Bør være ~0 i prod; spike → klient retry-loop eller dual-host.
  drawLockRejections: new client.Counter({
    name: "spillorama_draw_lock_rejections_total",
    help: "Antall draw:next-kall avvist fordi rommet allerede har en draw in-flight",
  }),

  // SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §3.1: mass-payout duration
  // observability. Counted per Spill 2/3 onDrawCompleted-hook execution.
  // Buckets aligned with audit-recommended 5s/10s alert thresholds.
  // `winnersBucket` label dimensjonerer på antall vinnere så p95 kan
  // segmenteres ("0-9 vinnere" vs "100+ vinnere") for kapasitets-planlegging.
  spill23OnDrawCompletedDuration: new client.Histogram({
    name: "spill23_ondrawcompleted_duration_ms",
    help: "Time spent in Spill 2/3 onDrawCompleted hook including mass-payout (ms)",
    labelNames: ["slug", "winnersBucket"] as const,
    buckets: [10, 50, 100, 500, 1_000, 5_000, 10_000, 30_000],
  }),

  // SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §3.1: mass-payout success/failure
  // counter. `outcome` = "success" | "partial" (Promise.allSettled rejected
  // some entries — investigate ledger-divergence) | "error" (whole batch
  // rejected). Alert: increase(...{outcome="partial"}[5m]) > 0.
  spill23MassPayoutOutcome: new client.Counter({
    name: "spill23_mass_payout_outcome_total",
    help: "Mass-payout batch outcomes (success/partial/error)",
    labelNames: ["slug", "outcome"] as const,
  }),

  // SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §3.4: race-detector. Inkrementeres
  // hver gang findG2Winners / buildTicketMasksByPlayer detekterer at en
  // spiller-record har blitt evicted MELLOM iterator-snapshot og payout.
  // Bør være ~0 — om denne tikker > 0 er det signal at parallel join-handler
  // muterer room.players uten å respektere snapshot-pattern.
  spill23RoomPlayersRaceDetected: new client.Counter({
    name: "spill23_room_players_race_total",
    help: "room.players mutated mid-iteration (defensive snapshot detected stale entry)",
    labelNames: ["slug"] as const,
  }),
};
