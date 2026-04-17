/**
 * BIN-165: Reusable circuit breaker for external API resilience.
 *
 * States: CLOSED (normal) → OPEN (blocking) → HALF_OPEN (probing)
 * Opens after `threshold` consecutive failures.
 * Auto-resets after `resetMs` (half-open: next request is a probe).
 */

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening the circuit. Default: 5 */
  threshold?: number;
  /** Milliseconds to keep circuit open before allowing a probe. Default: 30_000 */
  resetMs?: number;
  /** Name for logging/metrics. Default: "circuit-breaker" */
  name?: string;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntilMs = 0;
  private readonly threshold: number;
  private readonly resetMs: number;
  readonly name: string;

  // Metrics
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalRejections = 0;
  private lastStateChangeMs = 0;

  constructor(config?: CircuitBreakerConfig) {
    this.threshold = config?.threshold ?? 5;
    this.resetMs = config?.resetMs ?? 30_000;
    this.name = config?.name ?? "circuit-breaker";
  }

  /** Current state of the circuit. */
  get state(): CircuitState {
    if (this.openUntilMs <= 0) return "CLOSED";
    if (Date.now() >= this.openUntilMs) return "HALF_OPEN";
    return "OPEN";
  }

  /**
   * Assert that the circuit is not open. Throws if OPEN.
   * HALF_OPEN allows one request through (probe).
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
    }
  }

  /** Record a successful operation. Resets failure counter. */
  onSuccess(): void {
    this.totalSuccesses++;
    if (this.consecutiveFailures > 0 || this.openUntilMs > 0) {
      this.lastStateChangeMs = Date.now();
    }
    this.consecutiveFailures = 0;
    this.openUntilMs = 0;
  }

  /** Record a failed operation. Opens circuit after threshold. */
  onFailure(): void {
    this.totalFailures++;
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.threshold) {
      this.openUntilMs = Date.now() + this.resetMs;
      this.lastStateChangeMs = Date.now();
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
