/**
 * PR-R4: Lifecycle- og leaderboard-handlere.
 *
 * Inneholder:
 *   - leaderboard:get (global / room-scoped topplister — BIN-512)
 *   - disconnect      (socket-nedkobling — `engine.detachSocket`,
 *                      rate-limiter cleanup, prom-metrics + Sentry-breadcrumb)
 *
 * Disse er "generelle" lifecycle-events som ikke hører til noen spesifikk
 * spill-mekanikk. Leaderboard er read-only. Disconnect er Socket.IOs egen
 * "vi har mistet klienten"-event — vi MÅ rydde opp rate-limiter-state og
 * detacher player-socket så neste reconnect får ny `room:resume`.
 *
 * Uendret fra opprinnelig gameEvents.ts.
 */
import { addBreadcrumb } from "../../observability/sentry.js";
import { metrics as promMetrics } from "../../util/metrics.js";
import type { SocketContext } from "./context.js";
import type {
  AckResponse,
  LeaderboardEntry,
  LeaderboardPayload,
} from "./types.js";

export function registerLifecycleEvents(ctx: SocketContext): void {
  const { socket, engine, deps, ackSuccess, ackFailure, rateLimited } = ctx;
  const { socketRateLimiter, buildLeaderboard } = deps;

  // ── Leaderboard ──────────────────────────────────────────────────────────
  socket.on("leaderboard:get", rateLimited("leaderboard:get", async (payload: LeaderboardPayload, callback: (response: AckResponse<{ leaderboard: LeaderboardEntry[] }>) => void) => {
    try {
      const leaderboard = buildLeaderboard(payload?.roomCode);
      ackSuccess(callback, { leaderboard });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  socket.on("disconnect", (reason: string) => {
    engine.detachSocket(socket.id);
    socketRateLimiter.cleanup(socket.id);
    // BIN-539: Every disconnect rolls into reconnect/retry dashboards. The
    // `reason` label is bounded (Socket.IO enumerates it), so cardinality
    // stays safe for Prometheus.
    promMetrics.reconnectTotal.inc({ reason: reason || "unknown" });
    addBreadcrumb("socket.disconnected", { socketId: socket.id, reason }, "warning");
  });
}
