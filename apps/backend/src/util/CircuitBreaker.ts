/**
 * BIN-165 / HIGH-8: Reusable circuit breaker for external API + DB resilience.
 *
 * States: CLOSED (normal) → OPEN (fail-fast) → HALF_OPEN (one probe).
 *
 * Transitions:
 *   - CLOSED → OPEN: after `threshold` consecutive failures.
 *   - OPEN → HALF_OPEN: automatic when `resetMs` has elapsed since the
 *     circuit opened.
 *   - HALF_OPEN → CLOSED: probe request succeeds.
 *   - HALF_OPEN → OPEN: probe request fails — re-open immediately for
 *     another `resetMs` cool-down (no waiting for `threshold` failures).
 *
 * `execute()` is the recommended entry-point: it serializes state
 * transitions, ensures only one in-flight probe during HALF_OPEN, and
 * fires the optional `onStateChange` observer (used to update Prometheus
 * gauges).
 *
 * Backwards-compat: callers that want manual control can still use
 * `assertClosed()` + `onSuccess()` / `onFailure()`. Those keep the
 * earlier BIN-165 semantics where HALF_OPEN auto-resets to CLOSED on
 * `assertClosed()` and only re-opens after `threshold` more failures.
 */

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening the circuit. Default: 5 */
  threshold?: number;
  /** Milliseconds to keep circuit open before allowing a probe. Default: 30_000 */
  resetMs?: number;
  /** Name for logging/metrics. Default: "circuit-breaker" */
  name?: string;
  /**
   * Optional observer fired whenever the breaker transitions between
   * CLOSED, OPEN, and HALF_OPEN. Used to update Prometheus gauges so
   * the dashboard never lags behind the actual breaker state.
   */
  onStateChange?: (state: CircuitState, name: string) => void;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntilMs = 0;
  /**
   * HIGH-8: explicit HALF_OPEN guard. When true, a probe is in flight
   * and the circuit treats the next request as the deciding probe —
   * second concurrent caller during HALF_OPEN is rejected as if OPEN.
   */
  private probeInFlight = false;
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly onStateChange?: (state: CircuitState, name: string) => void;
  readonly name: string;

  // Metrics
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalRejections = 0;
  private lastStateChangeMs = 0;
  /**
   * Tracks the last CircuitState we emitted to `onStateChange`. Starts as
   * `null` so the first call (in the constructor) always emits the
   * initial CLOSED baseline — useful for Prometheus gauges that need a
   * known starting value.
   */
  private lastReportedState: CircuitState | null = null;

  constructor(config?: CircuitBreakerConfig) {
    this.threshold = config?.threshold ?? 5;
    this.resetMs = config?.resetMs ?? 30_000;
    this.name = config?.name ?? "circuit-breaker";
    this.onStateChange = config?.onStateChange;
    // Emit an initial CLOSED-state notification so observers (Prometheus)
    // start tracking from a known baseline.
    this.notifyStateChange();
  }

  /** Current state of the circuit. */
  get state(): CircuitState {
    if (this.openUntilMs <= 0) return "CLOSED";
    if (Date.now() >= this.openUntilMs) return "HALF_OPEN";
    return "OPEN";
  }

  /**
   * Assert that the circuit is not open. Throws if OPEN.
   * HALF_OPEN allows one request through (probe) — but auto-resets to
   * CLOSED, so failure of that probe must be reported via `onFailure()`
   * which re-opens after `threshold` more failures. For strict HALF_OPEN
   * semantics where one failed probe re-opens immediately, use
   * `execute()` instead.
   */
  assertClosed(): void {
    const now = Date.now();
    if (this.openUntilMs > 0 && now < this.openUntilMs) {
      this.totalRejections++;
      throw new CircuitBreakerOpenError(this.name, this.openUntilMs - now);
    }
    // Auto-reset: if the open window has passed, allow probe (HALF_OPEN)
    if (this.openUntilMs > 0 && now >= this.openUntilMs) {
      this.openUntilMs = 0;
      this.consecutiveFailures = 0;
      this.lastStateChangeMs = now;
      this.notifyStateChange();
    }
  }

  /** Record a successful operation. Resets failure counter. */
  onSuccess(): void {
    this.totalSuccesses++;
    const wasNotClosed = this.consecutiveFailures > 0 || this.openUntilMs > 0;
    if (wasNotClosed) {
      this.lastStateChangeMs = Date.now();
    }
    this.consecutiveFailures = 0;
    this.openUntilMs = 0;
    if (wasNotClosed) {
      this.notifyStateChange();
    }
  }

  /** Record a failed operation. Opens circuit after threshold. */
  onFailure(): void {
    this.totalFailures++;
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.threshold && this.openUntilMs === 0) {
      this.openUntilMs = Date.now() + this.resetMs;
      this.lastStateChangeMs = Date.now();
      this.notifyStateChange();
    }
  }

  /**
   * HIGH-8: run `fn` through the breaker with strict HALF_OPEN semantics.
   *
   * - CLOSED: forwards directly. On failure, `consecutiveFailures` ticks
   *   up; threshold reached → OPEN.
   * - OPEN: rejects with `CircuitBreakerOpenError` until cool-down passes.
   * - HALF_OPEN: exactly one probe is admitted. Concurrent calls while
   *   the probe is in flight are rejected. Probe success → CLOSED.
   *   Probe failure → OPEN immediately (no waiting for `threshold`).
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // OPEN — fail-fast.
    if (this.openUntilMs > 0 && now < this.openUntilMs) {
      this.totalRejections++;
      throw new CircuitBreakerOpenError(this.name, this.openUntilMs - now);
    }

    // HALF_OPEN — admit a single probe.
    let isProbe = false;
    if (this.openUntilMs > 0 && now >= this.openUntilMs) {
      if (this.probeInFlight) {
        // Another probe is already running — reject so we don't pile-on
        // a still-failing dependency.
        this.totalRejections++;
        // remainingMs = 1 because the breaker is in HALF_OPEN, not OPEN
        // for a known duration; consumer should retry shortly.
        throw new CircuitBreakerOpenError(this.name, 1);
      }
      this.probeInFlight = true;
      isProbe = true;
      // Notify observers we entered HALF_OPEN.
      this.lastStateChangeMs = now;
      this.notifyStateChange();
    }

    try {
      const result = await fn();
      // Probe success or normal CLOSED success.
      if (isProbe) {
        this.openUntilMs = 0;
        this.consecutiveFailures = 0;
        this.lastStateChangeMs = Date.now();
      }
      this.totalSuccesses++;
      const wasNotClosed = this.consecutiveFailures > 0 || this.openUntilMs > 0;
      this.consecutiveFailures = 0;
      this.openUntilMs = 0;
      if (wasNotClosed || isProbe) {
        this.notifyStateChange();
      }
      return result;
    } catch (error) {
      this.totalFailures++;
      if (isProbe) {
        // HIGH-8: HALF_OPEN failure → re-open immediately for another
        // cool-down window. Do NOT wait for `threshold` more failures.
        this.openUntilMs = Date.now() + this.resetMs;
        this.consecutiveFailures = this.threshold;
        this.lastStateChangeMs = Date.now();
        this.notifyStateChange();
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.threshold && this.openUntilMs === 0) {
          this.openUntilMs = Date.now() + this.resetMs;
          this.lastStateChangeMs = Date.now();
          this.notifyStateChange();
        }
      }
      throw error;
    } finally {
      if (isProbe) {
        this.probeInFlight = false;
      }
    }
  }

  /** Metrics for health endpoint. */
  metrics(): CircuitBreakerMetrics {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      threshold: this.threshold,
      resetMs: this.resetMs,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalRejections: this.totalRejections,
      lastStateChangeMs: this.lastStateChangeMs
    };
  }

  /**
   * Fire the `onStateChange` observer if the high-level state has
   * transitioned. We compare against the last-reported state to avoid
   * duplicate emits when nothing meaningful changed.
   */
  private notifyStateChange(): void {
    if (!this.onStateChange) return;
    const next = this.state;
    if (next !== this.lastReportedState) {
      this.lastReportedState = next;
      try {
        this.onStateChange(next, this.name);
      } catch {
        // Observer must never break the breaker — swallow.
      }
    }
  }
}

export interface CircuitBreakerMetrics {
  name: string;
  state: CircuitState;
  consecutiveFailures: number;
  threshold: number;
  resetMs: number;
  totalSuccesses: number;
  totalFailures: number;
  totalRejections: number;
  lastStateChangeMs: number;
}

export class CircuitBreakerOpenError extends Error {
  readonly code = "CIRCUIT_BREAKER_OPEN";
  readonly remainingMs: number;

  constructor(name: string, remainingMs: number) {
    super(`Circuit breaker "${name}" is open. Retry in ${Math.ceil(remainingMs / 1000)}s.`);
    this.remainingMs = remainingMs;
  }
}
