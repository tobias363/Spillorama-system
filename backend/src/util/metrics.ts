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
  })
};
