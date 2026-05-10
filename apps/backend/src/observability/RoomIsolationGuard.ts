/**
 * P1-6 / R11 — Room isolation guard (sirkel-bryter + p95-tracker kombinert).
 *
 * Mandat-ref: `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
 * §5 R11. ADR-0020.
 *
 * **Hva:** Tynt fasade-lag som komponerer `RoomCircuitBreaker` og
 * `RoomLatencyTracker` til ett enkelt API for kritiske kode-paths
 * (`engine.drawNextNumber`, `Game1MasterControlService.start/pause/...`).
 *
 * **Hvorfor:** Vi vil at hot-path-call-sites skal kunne wrappe seg selv
 * i én enkel `await guard.run(roomCode, action, async () => ...)` uten
 * å manuelt orkestrere breaker + tracker + metrics + R8-alerting.
 *
 * **Integrasjon med R8 (RoomAlertingService):**
 *   - Når sirkel-bryter åpnes for et rom emitter vi en alert via callback.
 *   - Når p95 krysser degraded-grensen emitter vi tilsvarende.
 *   - Selve alert-routing (Slack/PagerDuty) håndteres av R8 — guarden
 *     leverer kun event-en til en injicert listener.
 *
 * **Designprinsipper:**
 *   - **Lett-touch i hot-path.** `run()` er O(1) untatt percentile-
 *     kalkulasjon i degraded-deteksjon (som er O(N log N) men kun
 *     trigges på CLOSED → DEGRADED state-overgang, ikke hver kall).
 *   - **Fail-soft alert-listener.** Listener-feil aldri propagerer.
 *   - **Uavhengig av spill-arkitektur.** Bruker kun `roomCode + action`
 *     som identifiers — fungerer for Spill 1/2/3.
 */

import { logger as rootLogger } from "../util/logger.js";
import {
  CircuitOpenError,
  RoomCircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerEvent,
} from "./RoomCircuitBreaker.js";
import {
  RoomLatencyTracker,
  type DegradedEvent,
  type LatencyTrackerConfig,
} from "./RoomLatencyTracker.js";

const log = rootLogger.child({ module: "room-isolation-guard" });

// ── Combined event types ───────────────────────────────────────────────────

export type RoomIsolationEvent =
  | { type: "circuit"; payload: CircuitBreakerEvent }
  | { type: "degraded"; payload: DegradedEvent };

export type RoomIsolationListener = (event: RoomIsolationEvent) => void;

// ── Configuration ──────────────────────────────────────────────────────────

export interface RoomIsolationGuardConfig {
  circuit?: CircuitBreakerConfig;
  latency?: LatencyTrackerConfig;
}

// ── Main class ─────────────────────────────────────────────────────────────

export class RoomIsolationGuard {
  private readonly breaker: RoomCircuitBreaker;
  private readonly tracker: RoomLatencyTracker;
  private readonly listeners: RoomIsolationListener[] = [];

  constructor(config: RoomIsolationGuardConfig = {}) {
    this.breaker = new RoomCircuitBreaker(config.circuit);
    this.tracker = new RoomLatencyTracker(config.latency);

    // Vire interne listeners → eksterne.
    this.breaker.addListener((event) => {
      this.emit({ type: "circuit", payload: event });
    });
    this.tracker.addDegradedListener((event) => {
      this.emit({ type: "degraded", payload: event });
    });
  }

  /**
   * Hovedmetode: kjør fn under sirkel-bryter-vakt + latency-tracking.
   *
   * @throws CircuitOpenError hvis bryteren er OPEN for rommet.
   * @throws Hva enn fn() kaster (etter at vi har registrert som failure).
   */
  async run<T>(
    roomCode: string,
    action: string,
    fn: () => Promise<T>,
    nowMs?: number,
  ): Promise<T> {
    const useInjectedClock = nowMs !== undefined;
    const start = useInjectedClock ? (nowMs as number) : Date.now();
    let failed = false;
    try {
      const result = await this.breaker.guard(roomCode, fn, start);
      return result;
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      // Hvis caller injicerte nowMs (test-modus) tracker vi på samme
      // timestamp slik at GC-tester er deterministiske. Ellers bruker
      // vi faktisk Date.now() for å få real-world duration.
      const end = useInjectedClock ? (nowMs as number) : Date.now();
      const duration = end - start;
      // Track latency uavhengig om kallet feilet — failures flagges separat.
      // Hvis breaker rejected før kallet kjørte (CircuitOpenError) er duration
      // ~0ms, men vi tracker det allikevel for synlighet.
      try {
        this.tracker.record(roomCode, action, duration, failed, end);
      } catch (trackErr) {
        // Tracker må aldri ta ned hot-path. Logg og fortsett.
        log.warn(
          { err: trackErr, roomCode, action },
          "[room-isolation-guard] tracker.record failed (fail-soft)",
        );
      }
    }
  }

  /**
   * Sjekk om et rom er tilgjengelig (breaker CLOSED eller HALF_OPEN).
   */
  isAllowed(roomCode: string, nowMs: number = Date.now()): boolean {
    return this.breaker.isAllowed(roomCode, nowMs);
  }

  /**
   * Hent breaker-state-snapshot.
   */
  getCircuitState(roomCode: string, nowMs: number = Date.now()) {
    return this.breaker.getStateSnapshot(roomCode, nowMs);
  }

  /**
   * Hent latency-stats for (room, action).
   */
  getLatencyStats(
    roomCode: string,
    action: string,
    nowMs: number = Date.now(),
  ) {
    return this.tracker.getStats(roomCode, action, nowMs);
  }

  /**
   * Hent samle-snapshot — alle breakers + alle latency-stats. Brukes av
   * admin-endpoint for dashbord.
   */
  getAllStates(nowMs: number = Date.now()) {
    return {
      breakers: this.breaker.getAllStates(nowMs),
      latency: this.tracker.getAllStats(nowMs),
    };
  }

  /**
   * Eksponert breaker (for tester eller spesielle ops-bruk som manuell
   * reset). Hovedflyt går via `run()`.
   */
  getBreaker(): RoomCircuitBreaker {
    return this.breaker;
  }

  /**
   * Eksponert tracker (samme som breaker — for tester / metrics-export).
   */
  getTracker(): RoomLatencyTracker {
    return this.tracker;
  }

  /**
   * Sett degraded-grense for (room, action) eller global default.
   */
  setDegradedThreshold(opts: {
    roomCode?: string;
    action?: string;
    thresholdMs: number;
  }): void {
    if (opts.roomCode && opts.action) {
      this.tracker.setDegradedThreshold(
        opts.roomCode,
        opts.action,
        opts.thresholdMs,
      );
    } else {
      this.tracker.setDegradedThresholdDefault(opts.thresholdMs);
    }
  }

  /**
   * Lytt på breaker- og degraded-events. Fail-soft — listeners kan ikke
   * ta ned guarden.
   */
  addListener(listener: RoomIsolationListener): void {
    this.listeners.push(listener);
  }

  /**
   * Manuell reset av breaker for et rom. Brukes av ops når underliggende
   * problem er kjent fikset.
   */
  reset(roomCode: string, nowMs: number = Date.now()): void {
    this.breaker.reset(roomCode, nowMs);
  }

  /**
   * Periodisk GC av stale state. Bør kalles fra cron (~hvert 10 min).
   */
  gc(nowMs: number = Date.now()): { breakers: number; tracker: number } {
    return {
      breakers: this.breaker.gc(nowMs),
      tracker: this.tracker.gc(nowMs),
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private emit(event: RoomIsolationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Fail-soft.
      }
    }
  }
}

// ── Re-export for convenience ─────────────────────────────────────────────

export { CircuitOpenError } from "./RoomCircuitBreaker.js";
