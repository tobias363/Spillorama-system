/**
 * P1-6 / R11 — Per-rom p50/p95/p99 latency-tracker.
 *
 * Mandat-ref: `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
 * §5 R11 + §6 R7. ADR-0020.
 *
 * **Hva:** Bounded sliding-window-tracker over (roomCode, action) som gir
 * rolling p50/p95/p99 over siste N minutter. Brukes for å detektere
 * "degraded" rom (hvor noen aksjoner er treigere enn andre rom — alarm).
 *
 * **Hvorfor:** R11 krever per-rom resource-isolation. Kun ved å se latency
 * per rom kan vi:
 *   1) Detektere hvilket rom som er treigt (ikke bare "totalbelastning øker")
 *   2) Triggere alert før det blir nedetid (p95 > 5s = degraded)
 *   3) Korrelere med circuit-breaker (ofte ser vi p95-økning før breaker
 *      åpner — gir oss tidligere advarsel)
 *
 * **Designprinsipper:**
 *   - **Bounded memory.** Per (roomCode, action) holder vi maks N samples
 *     (default 1000). Eldre samples shifte ut (FIFO).
 *   - **Time-windowed aggregat.** `getStats()` filtrerer samples eldre enn
 *     window-grensen (default 5 min) før beregning av p50/p95/p99.
 *   - **Pure compute.** Ingen DB, ingen klokke (klokke injiseres).
 *   - **Per-action partisjonering.** Ulike aksjoner (drawNextNumber,
 *     master.start, master.advance) har egne window-buckets — relevant
 *     siden de har forskjellige normalverdier (draw ~50ms, master.start
 *     ~500ms).
 *   - **Snapshot-friendly.** Ingen async I/O i hot-path. `record()` og
 *     `getStats()` er O(1) amortisert (med periodisk O(N) prune).
 *
 * **Metric-shape:**
 *   - `room_action_p50_ms{roomCode, action}` — median latency
 *   - `room_action_p95_ms{roomCode, action}` — 95th percentile
 *   - `room_action_p99_ms{roomCode, action}` — 99th percentile
 *   - `room_action_count{roomCode, action}` — antall samples i window
 *   - `room_action_failures{roomCode, action}` — antall failures i window
 *
 * **Konfigurasjon:**
 *   - `windowMs`: 5 * 60 * 1000 (5 min) — sliding-window-størrelse
 *   - `maxSamplesPerKey`: 1000 — bounded memory per (room, action)
 *   - `p95DegradedThresholdMs`: 5000 — over dette flagges rom som degraded
 *   - `gcStaleStateAfterMs`: 1 time — drop state for inaktive rom
 */

// ── Sample shape ───────────────────────────────────────────────────────────

interface LatencySample {
  /** Timestamp (ms) — for window-filtering. */
  atMs: number;
  /** Duration i millisekunder. */
  durationMs: number;
  /** Var det en feil? Tracking for context. */
  failed: boolean;
}

interface RoomActionState {
  samples: LatencySample[];
  /** Lifetime-counter for diagnostikk. */
  totalCount: number;
  totalFailures: number;
  lastTouchMs: number;
}

// ── Output stats ───────────────────────────────────────────────────────────

export interface LatencyStats {
  count: number;
  failures: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Min sample i window. */
  minMs: number | null;
  /** Max sample i window. */
  maxMs: number | null;
  /** Snitt-latency i window. */
  meanMs: number | null;
  /** Når siste sample ble registrert. */
  lastSampleMs: number | null;
}

const EMPTY_STATS: LatencyStats = {
  count: 0,
  failures: 0,
  p50Ms: null,
  p95Ms: null,
  p99Ms: null,
  minMs: null,
  maxMs: null,
  meanMs: null,
  lastSampleMs: null,
};

// ── Configuration ──────────────────────────────────────────────────────────

export interface LatencyTrackerConfig {
  /**
   * Sliding-window-størrelse (ms). Samples eldre enn dette filtreres
   * bort i `getStats()`. Default 5 min (300 000).
   */
  windowMs?: number;

  /**
   * Bounded sample-buffer per (room, action). Når full shifte vi ut
   * eldste sample. Default 1000.
   *
   * 1000 samples × 24 byte (timestamp + duration + bool) = ~24 KB per
   * key. 24 haller × 8 actions = 192 keys = ~5 MB. Trivielt.
   */
  maxSamplesPerKey?: number;

  /**
   * Hvis et rom-action ikke har vært touched på > dette, droppes state
   * (GC). Default 1 time.
   */
  gcStaleStateAfterMs?: number;
}

const DEFAULT_CONFIG: Required<LatencyTrackerConfig> = {
  windowMs: 5 * 60 * 1000,
  maxSamplesPerKey: 1000,
  gcStaleStateAfterMs: 60 * 60 * 1000,
};

// ── Degraded-event listener ────────────────────────────────────────────────

export interface DegradedEvent {
  roomCode: string;
  action: string;
  p95Ms: number;
  thresholdMs: number;
  atMs: number;
  sampleCount: number;
}

export type DegradedEventListener = (event: DegradedEvent) => void;

// ── Main class ─────────────────────────────────────────────────────────────

/**
 * Per-rom latency-tracker med sliding-window p50/p95/p99-aggregat.
 *
 * Bruksmønster:
 * ```ts
 * const tracker = new RoomLatencyTracker();
 *
 * const start = Date.now();
 * try {
 *   await doDraw(roomCode);
 *   tracker.record(roomCode, "drawNextNumber", Date.now() - start, false);
 * } catch (err) {
 *   tracker.record(roomCode, "drawNextNumber", Date.now() - start, true);
 *   throw err;
 * }
 *
 * const stats = tracker.getStats(roomCode, "drawNextNumber");
 * if (stats.p95Ms && stats.p95Ms > 5000) {
 *   // Alert: degraded
 * }
 * ```
 */
export class RoomLatencyTracker {
  private readonly config: Required<LatencyTrackerConfig>;
  private readonly state = new Map<string, RoomActionState>();
  private readonly degradedListeners: DegradedEventListener[] = [];

  /**
   * P95-grensen som flagger rom som degraded. Kan settes per
   * (room, action) via `setDegradedThreshold` for finkornet kontroll.
   * Default for alle: 5000 ms.
   */
  private readonly degradedThresholdsByKey = new Map<string, number>();
  private degradedThresholdDefault: number = 5000;

  /**
   * In-memory tracking av siste degraded-emit per (room, action) for å
   * unngå spam. Vi emitter på state-overgang (CLOSED → DEGRADED), ikke
   * hver record().
   */
  private readonly lastDegradedStateByKey = new Map<string, boolean>();

  constructor(config: LatencyTrackerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.windowMs < 1) {
      throw new Error("windowMs must be >= 1");
    }
    if (this.config.maxSamplesPerKey < 1) {
      throw new Error("maxSamplesPerKey must be >= 1");
    }
  }

  /**
   * Sett global default p95-grense for degraded-deteksjon.
   */
  setDegradedThresholdDefault(thresholdMs: number): void {
    if (thresholdMs <= 0) throw new Error("thresholdMs must be > 0");
    this.degradedThresholdDefault = thresholdMs;
  }

  /**
   * Sett per (room, action) p95-grense. Overstyrer default.
   */
  setDegradedThreshold(
    roomCode: string,
    action: string,
    thresholdMs: number,
  ): void {
    if (thresholdMs <= 0) throw new Error("thresholdMs must be > 0");
    this.degradedThresholdsByKey.set(this.makeKey(roomCode, action), thresholdMs);
  }

  /**
   * Registrer et degraded-event-listener. Kalles når p95 krysser
   * grensen oppover (CLOSED → DEGRADED). Ikke kalt for hver record().
   */
  addDegradedListener(listener: DegradedEventListener): void {
    this.degradedListeners.push(listener);
  }

  /**
   * Registrer en latency-sample.
   */
  record(
    roomCode: string,
    action: string,
    durationMs: number,
    failed: boolean,
    nowMs: number = Date.now(),
  ): void {
    const key = this.makeKey(roomCode, action);
    const sample: LatencySample = { atMs: nowMs, durationMs, failed };

    let state = this.state.get(key);
    if (!state) {
      state = {
        samples: [],
        totalCount: 0,
        totalFailures: 0,
        lastTouchMs: nowMs,
      };
      this.state.set(key, state);
    }

    state.samples.push(sample);
    state.totalCount += 1;
    if (failed) state.totalFailures += 1;
    state.lastTouchMs = nowMs;

    // Bounded buffer — drop eldste hvis over kapasitet.
    if (state.samples.length > this.config.maxSamplesPerKey) {
      state.samples.shift();
    }

    // Sjekk om vi har krysset degraded-grensen (CLOSED → DEGRADED).
    this.checkDegradedTransition(roomCode, action, key, nowMs);
  }

  /**
   * Hent stats over siste sliding-window for (roomCode, action).
   */
  getStats(
    roomCode: string,
    action: string,
    nowMs: number = Date.now(),
  ): LatencyStats {
    const key = this.makeKey(roomCode, action);
    const state = this.state.get(key);
    if (!state || state.samples.length === 0) return { ...EMPTY_STATS };

    const cutoff = nowMs - this.config.windowMs;
    const inWindow = state.samples.filter((s) => s.atMs >= cutoff);
    if (inWindow.length === 0) return { ...EMPTY_STATS };

    const durations = inWindow
      .map((s) => s.durationMs)
      .sort((a, b) => a - b);
    const failures = inWindow.filter((s) => s.failed).length;
    const sum = durations.reduce((acc, x) => acc + x, 0);

    return {
      count: durations.length,
      failures,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      minMs: durations[0],
      maxMs: durations[durations.length - 1],
      meanMs: sum / durations.length,
      lastSampleMs: inWindow[inWindow.length - 1].atMs,
    };
  }

  /**
   * Hent stats for ALLE (room, action)-kombinasjoner. Brukes av
   * admin-endpoint og metrics-eksport.
   */
  getAllStats(
    nowMs: number = Date.now(),
  ): Map<string, { roomCode: string; action: string; stats: LatencyStats }> {
    const result = new Map<
      string,
      { roomCode: string; action: string; stats: LatencyStats }
    >();
    for (const key of this.state.keys()) {
      const { roomCode, action } = this.parseKey(key);
      result.set(key, {
        roomCode,
        action,
        stats: this.getStats(roomCode, action, nowMs),
      });
    }
    return result;
  }

  /**
   * Sjekk om et rom-action er degraded.
   */
  isDegraded(
    roomCode: string,
    action: string,
    nowMs: number = Date.now(),
  ): boolean {
    const stats = this.getStats(roomCode, action, nowMs);
    if (stats.p95Ms === null) return false;
    const threshold = this.getDegradedThreshold(roomCode, action);
    return stats.p95Ms > threshold;
  }

  /**
   * GC: drop state for (room, action) som ikke har vært touched på lenge.
   */
  gc(nowMs: number = Date.now()): number {
    const cutoff = nowMs - this.config.gcStaleStateAfterMs;
    let dropped = 0;
    for (const [key, s] of this.state) {
      if (s.lastTouchMs < cutoff) {
        this.state.delete(key);
        this.lastDegradedStateByKey.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  /**
   * Total memory-fotavtrykk (samples summert over alle keys).
   */
  totalSampleCount(): number {
    let sum = 0;
    for (const s of this.state.values()) sum += s.samples.length;
    return sum;
  }

  /**
   * @internal Test-only: antall (room, action)-keys.
   */
  size(): number {
    return this.state.size;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private makeKey(roomCode: string, action: string): string {
    return `${roomCode}::${action}`;
  }

  private parseKey(key: string): { roomCode: string; action: string } {
    const idx = key.indexOf("::");
    if (idx < 0) return { roomCode: key, action: "unknown" };
    return {
      roomCode: key.substring(0, idx),
      action: key.substring(idx + 2),
    };
  }

  private getDegradedThreshold(roomCode: string, action: string): number {
    const key = this.makeKey(roomCode, action);
    return this.degradedThresholdsByKey.get(key) ?? this.degradedThresholdDefault;
  }

  /**
   * Sjekk om (room, action) har gått fra CLOSED til DEGRADED siden sist
   * record. Hvis ja, emit DegradedEvent. Vi tracker forrige state for å
   * unngå å spamme alerts på hver enkelt sample.
   */
  private checkDegradedTransition(
    roomCode: string,
    action: string,
    key: string,
    nowMs: number,
  ): void {
    const stats = this.getStats(roomCode, action, nowMs);
    if (stats.p95Ms === null || stats.count < 5) {
      // Ikke nok samples — ikke flagg.
      return;
    }
    const threshold = this.getDegradedThreshold(roomCode, action);
    const isDegraded = stats.p95Ms > threshold;
    const wasDegraded = this.lastDegradedStateByKey.get(key) ?? false;

    if (isDegraded && !wasDegraded) {
      // CLOSED → DEGRADED.
      this.lastDegradedStateByKey.set(key, true);
      const event: DegradedEvent = {
        roomCode,
        action,
        p95Ms: stats.p95Ms,
        thresholdMs: threshold,
        atMs: nowMs,
        sampleCount: stats.count,
      };
      for (const listener of this.degradedListeners) {
        try {
          listener(event);
        } catch {
          // Fail-soft.
        }
      }
    } else if (!isDegraded && wasDegraded) {
      // DEGRADED → CLOSED.
      this.lastDegradedStateByKey.set(key, false);
    }
  }
}

/**
 * Beregn percentile. Bruker NIST-metode (linear interpolation).
 * Forventer sortert array (ascending).
 */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const frac = rank - low;
  return sorted[low] * (1 - frac) + sorted[high] * frac;
}
