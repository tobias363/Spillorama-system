import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from "prom-client";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

// ---------------------------------------------------------------------------
// Game metrics
// ---------------------------------------------------------------------------

export const gamesStartedTotal = new Counter({
  name: "bingo_games_started_total",
  help: "Total number of games started",
  labelNames: ["room_code"] as const,
  registers: [metricsRegistry],
});

export const gamesEndedTotal = new Counter({
  name: "bingo_games_ended_total",
  help: "Total number of games ended",
  labelNames: ["room_code"] as const,
  registers: [metricsRegistry],
});

export const drawsTotal = new Counter({
  name: "bingo_draws_total",
  help: "Total number of balls drawn",
  labelNames: ["room_code", "source"] as const,
  registers: [metricsRegistry],
});

export const claimsTotal = new Counter({
  name: "bingo_claims_total",
  help: "Total number of claims submitted",
  labelNames: ["room_code", "type"] as const,
  registers: [metricsRegistry],
});

export const payoutsTotal = new Counter({
  name: "bingo_payouts_total",
  help: "Total number of payout events",
  labelNames: ["kind"] as const,
  registers: [metricsRegistry],
});

export const payoutAmountTotal = new Counter({
  name: "bingo_payout_amount_nok_total",
  help: "Total payout amount in NOK",
  labelNames: ["kind"] as const,
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Connection metrics
// ---------------------------------------------------------------------------

export const socketConnectionsActive = new Gauge({
  name: "bingo_socket_connections_active",
  help: "Number of active socket.io connections",
  registers: [metricsRegistry],
});

export const activeRooms = new Gauge({
  name: "bingo_active_rooms",
  help: "Number of active rooms in memory",
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Latency metrics
// ---------------------------------------------------------------------------

export const drawDurationMs = new Histogram({
  name: "bingo_draw_duration_ms",
  help: "Time taken to process a draw (ms)",
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [metricsRegistry],
});

export const claimDurationMs = new Histogram({
  name: "bingo_claim_duration_ms",
  help: "Time taken to process a claim (ms)",
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [metricsRegistry],
});
