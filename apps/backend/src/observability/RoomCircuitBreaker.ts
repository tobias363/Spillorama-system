/**
 * P1-6 / R11 — Per-rom circuit-breaker (sirkel-bryter).
 *
 * Mandat-ref: `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
 * §5 R11 (per-rom resource-isolation). ADR-0020.
 *
 * **Hva:** Klassisk three-state circuit-breaker (CLOSED → OPEN → HALF_OPEN)
 * implementert per-rom med isolert state. Når et enkelt rom akkumulerer
 * gjentatte feil i kritiske paths (drawNextNumber, master-actions), åpner
 * vi bryteren for KUN det rommet — andre rom forblir uberørt.
 *
 * **Hvorfor:** Pilot-skala 4 haller × 250 spillere er lav risiko for
 * cross-room blast-radius, men 24 haller × 1500 spillere = 36 000
 * samtidige er IKKE verifisert. Hvis ett rom har en hot bug (race-
 * condition, DB-deadlock, infinite-retry-loop), kan det monopolisere
 * event-loopen og degradere alle andre rom. Sirkel-bryter forhindrer
 * dette ved å:
 *   1) Detektere persistent feil-mønster (5 sammenhengende på 60s)
 *   2) "Åpne" bryteren for det rommet → fail-fast på ALLE påfølgende
 *      kall i 30 sekunder (gir affekterte path-en pause til å recovere)
 *   3) Etter cooldown: HALF_OPEN — slipp gjennom én call. Hvis suksess
 *      → CLOSED igjen. Hvis ny feil → ny OPEN-periode.
 *
 * **Designprinsipper:**
 *   - **Pure state-machine.** Ingen DB, ingen Redis, ingen klokke (klokke
 *     injiseres). Testbar i isolasjon.
 *   - **In-process per Node.** Hver Node-instans har egen breaker-state.
 *     Forsettlig — vi vil ha lokal failure-isolation, ikke distributed
 *     consensus. Hvis en instans har problemer trenger ikke andre å vite.
 *   - **Bounded memory.** En `Map<roomCode, BreakerState>` med GC-rutine
 *     for rom som ikke har vært touched på > 1 time.
 *   - **Per-rom isolasjon.** Én rom OPEN → andre rom CLOSED. INGEN delt
 *     state mellom rom (untatt selve Map-en).
 *   - **Metrics-friendly.** Hver state-overgang emitter event slik at
 *     R8 alerting kan reagere på `room.circuit_open`.
 *
 * **State-machine:**
 * ```
 *  ┌─────────┐  consecutiveFailures >= threshold   ┌──────┐
 *  │ CLOSED  │ ──────────────────────────────────► │ OPEN │
 *  └─────────┘                                     └──────┘
 *       ▲                                              │
 *       │  HALF_OPEN succeeds                          │ cooldown elapsed
 *       │                                              ▼
 *       │                                         ┌───────────┐
 *       └──────────  fail (back to OPEN)  ◄──────│ HALF_OPEN │
 *                                                 └───────────┘
 * ```
 *
 * **Konfigurasjon (defaults):**
 *   - `failureThreshold`: 5 (sammenhengende failures innen window)
 *   - `failureWindowMs`: 60 000 (1 min)
 *   - `cooldownMs`: 30 000 (30 sek før HALF_OPEN)
 *   - `successThresholdHalfOpen`: 1 (én suksess for å lukke)
 *   - `gcStaleStateAfterMs`: 3 600 000 (1 time inaktiv → drop)
 */

// ── State definitions ──────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Per-rom circuit-breaker-state. Holdes intern i CircuitBreaker;
 * eksposert kun via `getStateSnapshot()` for tester og metrics.
 */
export interface BreakerStateSnapshot {
  state: CircuitState;
  /** Antall sammenhengende failures (reset ved success eller window-expiry). */
  consecutiveFailures: number;
  /** Timestamp første failure i nåværende window (ms). */
  firstFailureMs: number | null;
  /** Timestamp siste failure (ms). */
  lastFailureMs: number | null;
  /** Når bryteren ble OPEN (ms). null hvis ikke OPEN. */
  openedAtMs: number | null;
  /** Total transitions OPEN i levetiden (for diagnostikk). */
  totalOpens: number;
  /** Sist touch-tidspunkt (for GC). */
  lastTouchMs: number;
}

// ── Events (for alerting/metrics integrasjon) ──────────────────────────────

export type CircuitBreakerEvent =
  | {
      type: "circuit_opened";
      roomCode: string;
      consecutiveFailures: number;
      reason: string;
      atMs: number;
    }
  | {
      type: "circuit_closed";
      roomCode: string;
      atMs: number;
    }
  | {
      type: "circuit_half_open";
      roomCode: string;
      atMs: number;
    }
  | {
      type: "call_rejected";
      roomCode: string;
      atMs: number;
    };

/**
 * Event-listener for state-overganger. Brukes til å koble breaker-
 * hendelser til R8 RoomAlertingService og metrics. Listener må være
 * fail-soft — feil propageres ikke tilbake til breaker.
 */
export type CircuitBreakerListener = (event: CircuitBreakerEvent) => void;

// ── Configuration ──────────────────────────────────────────────────────────

export interface CircuitBreakerConfig {
  /**
   * Antall sammenhengende failures (innen failureWindowMs) som må
   * akkumuleres før bryteren åpner. Default 5.
   */
  failureThreshold?: number;

  /**
   * Hvor langt tilbake i tid vi teller failures. Hvis det går > dette
   * uten ny failure resettes telleren. Default 60 000 (1 min).
   *
   * Eksempel: med threshold=5, window=60s — 5 failures spredd over 90s
   * vil IKKE åpne bryteren (fordi window-resetter), men 5 innen 60s vil.
   */
  failureWindowMs?: number;

  /**
   * Hvor lenge bryteren forblir OPEN før vi går til HALF_OPEN.
   * Default 30 000 (30 sek).
   */
  cooldownMs?: number;

  /**
   * Antall sammenhengende success-er i HALF_OPEN som må til for å lukke.
   * Default 1 (single probe).
   */
  successThresholdHalfOpen?: number;

  /**
   * Hvis et rom ikke har blitt touched på > dette millisekund, dropper vi
   * state-en (GC). Forhindrer unbounded memory-vekst for døde rom.
   * Default 3 600 000 (1 time).
   */
  gcStaleStateAfterMs?: number;
}

const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  failureWindowMs: 60_000,
  cooldownMs: 30_000,
  successThresholdHalfOpen: 1,
  gcStaleStateAfterMs: 3_600_000,
};

// ── Internal mutable state ─────────────────────────────────────────────────

interface InternalState {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveHalfOpenSuccesses: number;
  firstFailureMs: number | null;
  lastFailureMs: number | null;
  openedAtMs: number | null;
  totalOpens: number;
  lastTouchMs: number;
}

function createFreshState(nowMs: number): InternalState {
  return {
    state: "CLOSED",
    consecutiveFailures: 0,
    consecutiveHalfOpenSuccesses: 0,
    firstFailureMs: null,
    lastFailureMs: null,
    openedAtMs: null,
    totalOpens: 0,
    lastTouchMs: nowMs,
  };
}

// ── Errors ─────────────────────────────────────────────────────────────────

/**
 * Kastes når caller forsøker å gjøre en operasjon mot et rom hvis breaker
 * er OPEN. Caller bør behandle dette som fail-fast (rapporter feil til
 * klient, IKKE retry på samme rom). Andre rom påvirkes ikke.
 *
 * Feil-melding inneholder roomCode + når bryteren ble åpnet, slik at
 * incident-response kan korrelere mot logger.
 */
export class CircuitOpenError extends Error {
  public readonly code = "CIRCUIT_OPEN";
  public readonly roomCode: string;
  public readonly openedAtMs: number;
  public readonly retryAfterMs: number;

  constructor(roomCode: string, openedAtMs: number, retryAfterMs: number) {
    super(
      `Circuit breaker OPEN for room ${roomCode} (opened ${
        Date.now() - openedAtMs
      }ms ago, retry in ${retryAfterMs}ms).`,
    );
    this.name = "CircuitOpenError";
    this.roomCode = roomCode;
    this.openedAtMs = openedAtMs;
    this.retryAfterMs = retryAfterMs;
  }
}

// ── Main class ─────────────────────────────────────────────────────────────

/**
 * Per-rom circuit-breaker. Threadsafe under Node single-thread-modell —
 * alle muteringer skjer synkront i guard()/recordFailure()/recordSuccess().
 *
 * Bruksmønster:
 * ```ts
 * const breaker = new RoomCircuitBreaker();
 *
 * // I drawNextNumber:
 * await breaker.guard(roomCode, async () => {
 *   return await doActualDraw(roomCode);
 * });
 * ```
 *
 * Hvis bryteren er OPEN kaster `guard()` en `CircuitOpenError` UTEN å
 * kjøre fn-en. Hvis CLOSED/HALF_OPEN kjøres fn — exception fra fn
 * registreres som failure, normal return registreres som success.
 */
export class RoomCircuitBreaker {
  private readonly config: Required<CircuitBreakerConfig>;
  private readonly states = new Map<string, InternalState>();
  private readonly listeners: CircuitBreakerListener[] = [];

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.failureThreshold < 1) {
      throw new Error("failureThreshold must be >= 1");
    }
    if (this.config.failureWindowMs < 1) {
      throw new Error("failureWindowMs must be >= 1");
    }
    if (this.config.cooldownMs < 1) {
      throw new Error("cooldownMs must be >= 1");
    }
  }

  /**
   * Registrer en listener som mottar state-overgangs-events. Brukes for
   * å koble til R8 alerting + metrics. Listener må være fail-soft —
   * exceptions catch'es av breaker og logges ikke videre (no-op).
   */
  addListener(listener: CircuitBreakerListener): void {
    this.listeners.push(listener);
  }

  /**
   * Kjør fn under sirkel-bryter-vakt. Hvis bryteren er OPEN kastes
   * CircuitOpenError UTEN å kjøre fn. Hvis CLOSED/HALF_OPEN: kjør fn,
   * registrer suksess/failure, oppdater state.
   *
   * @throws CircuitOpenError hvis bryteren er OPEN.
   * @throws Hva enn fn() kaster (etter at vi har registrert failure).
   */
  async guard<T>(
    roomCode: string,
    fn: () => Promise<T>,
    nowMs: number = Date.now(),
  ): Promise<T> {
    const state = this.tickState(roomCode, nowMs);

    if (state.state === "OPEN") {
      this.emit({
        type: "call_rejected",
        roomCode,
        atMs: nowMs,
      });
      const elapsed = nowMs - (state.openedAtMs ?? nowMs);
      const retryAfter = Math.max(0, this.config.cooldownMs - elapsed);
      throw new CircuitOpenError(
        roomCode,
        state.openedAtMs ?? nowMs,
        retryAfter,
      );
    }

    // CLOSED eller HALF_OPEN: prøv operasjonen.
    try {
      const result = await fn();
      this.recordSuccess(roomCode, nowMs);
      return result;
    } catch (err) {
      this.recordFailure(
        roomCode,
        err instanceof Error ? err.message : String(err),
        nowMs,
      );
      throw err;
    }
  }

  /**
   * Eksplisitt registrer en suksess uten å kalle guard(). Brukes når
   * caller vil styre selv hva som regnes som suksess.
   */
  recordSuccess(roomCode: string, nowMs: number = Date.now()): void {
    const state = this.tickState(roomCode, nowMs);

    if (state.state === "HALF_OPEN") {
      state.consecutiveHalfOpenSuccesses += 1;
      if (
        state.consecutiveHalfOpenSuccesses >=
        this.config.successThresholdHalfOpen
      ) {
        // HALF_OPEN → CLOSED.
        state.state = "CLOSED";
        state.consecutiveFailures = 0;
        state.consecutiveHalfOpenSuccesses = 0;
        state.firstFailureMs = null;
        state.lastFailureMs = null;
        state.openedAtMs = null;
        this.emit({
          type: "circuit_closed",
          roomCode,
          atMs: nowMs,
        });
      }
    } else if (state.state === "CLOSED") {
      // Reset failure-counter hvis vi har sett siste suksess.
      state.consecutiveFailures = 0;
      state.firstFailureMs = null;
      state.lastFailureMs = null;
    }

    state.lastTouchMs = nowMs;
  }

  /**
   * Eksplisitt registrer en failure uten å kalle guard().
   */
  recordFailure(
    roomCode: string,
    reason: string,
    nowMs: number = Date.now(),
  ): void {
    const state = this.tickState(roomCode, nowMs);

    if (state.state === "OPEN") {
      // Allerede åpen — ingen state-endring nødvendig.
      state.lastFailureMs = nowMs;
      state.lastTouchMs = nowMs;
      return;
    }

    if (state.state === "HALF_OPEN") {
      // Failure i HALF_OPEN → tilbake til OPEN umiddelbart.
      state.state = "OPEN";
      state.openedAtMs = nowMs;
      state.consecutiveHalfOpenSuccesses = 0;
      state.lastFailureMs = nowMs;
      state.totalOpens += 1;
      this.emit({
        type: "circuit_opened",
        roomCode,
        consecutiveFailures: state.consecutiveFailures,
        reason: `HALF_OPEN probe failed: ${reason}`,
        atMs: nowMs,
      });
      state.lastTouchMs = nowMs;
      return;
    }

    // CLOSED: track failure.
    // Sjekk om window har expired — hvis det er > failureWindowMs siden
    // første failure, resetter vi telleren.
    if (
      state.firstFailureMs !== null &&
      nowMs - state.firstFailureMs > this.config.failureWindowMs
    ) {
      state.consecutiveFailures = 0;
      state.firstFailureMs = null;
    }

    if (state.firstFailureMs === null) {
      state.firstFailureMs = nowMs;
    }
    state.consecutiveFailures += 1;
    state.lastFailureMs = nowMs;

    if (state.consecutiveFailures >= this.config.failureThreshold) {
      // CLOSED → OPEN.
      state.state = "OPEN";
      state.openedAtMs = nowMs;
      state.totalOpens += 1;
      this.emit({
        type: "circuit_opened",
        roomCode,
        consecutiveFailures: state.consecutiveFailures,
        reason,
        atMs: nowMs,
      });
    }

    state.lastTouchMs = nowMs;
  }

  /**
   * Hent snapshot av state for et rom. Returnerer initial-state hvis vi
   * aldri har sett rommet (CLOSED, 0 failures).
   */
  getStateSnapshot(roomCode: string, nowMs: number = Date.now()): BreakerStateSnapshot {
    const state = this.tickState(roomCode, nowMs);
    return {
      state: state.state,
      consecutiveFailures: state.consecutiveFailures,
      firstFailureMs: state.firstFailureMs,
      lastFailureMs: state.lastFailureMs,
      openedAtMs: state.openedAtMs,
      totalOpens: state.totalOpens,
      lastTouchMs: state.lastTouchMs,
    };
  }

  /**
   * Sjekk om bryteren tillater kall (uten å registrere noe).
   */
  isAllowed(roomCode: string, nowMs: number = Date.now()): boolean {
    const state = this.tickState(roomCode, nowMs);
    return state.state !== "OPEN";
  }

  /**
   * Hent state-snapshot for ALLE kjente rom. Brukes av admin-endpoint og
   * metrics-export.
   */
  getAllStates(nowMs: number = Date.now()): Map<string, BreakerStateSnapshot> {
    const result = new Map<string, BreakerStateSnapshot>();
    for (const [roomCode, state] of this.states) {
      // Tick først for å trigge cooldown-overganger.
      const ticked = this.tickState(roomCode, nowMs);
      result.set(roomCode, {
        state: ticked.state,
        consecutiveFailures: ticked.consecutiveFailures,
        firstFailureMs: ticked.firstFailureMs,
        lastFailureMs: ticked.lastFailureMs,
        openedAtMs: ticked.openedAtMs,
        totalOpens: ticked.totalOpens,
        lastTouchMs: ticked.lastTouchMs,
      });
    }
    // Suppress unused-warning — state er den lokale lookup, ticked er den oppdaterte.
    void result;
    return result;
  }

  /**
   * Manuell reset for et spesifikt rom (operatør-tool). Setter state til
   * CLOSED uavhengig av tidligere historikk. Brukes når ops vet at
   * underliggende problem er fikset.
   */
  reset(roomCode: string, nowMs: number = Date.now()): void {
    const state = this.states.get(roomCode);
    if (!state) return;
    const wasOpen = state.state === "OPEN" || state.state === "HALF_OPEN";
    state.state = "CLOSED";
    state.consecutiveFailures = 0;
    state.consecutiveHalfOpenSuccesses = 0;
    state.firstFailureMs = null;
    state.lastFailureMs = null;
    state.openedAtMs = null;
    state.lastTouchMs = nowMs;
    if (wasOpen) {
      this.emit({
        type: "circuit_closed",
        roomCode,
        atMs: nowMs,
      });
    }
  }

  /**
   * GC: drop state for rom som ikke har blitt touched på lenge. Kalles
   * fra periodisk cron eller første touch på et nytt rom.
   *
   * @returns Antall droppede rom.
   */
  gc(nowMs: number = Date.now()): number {
    const cutoff = nowMs - this.config.gcStaleStateAfterMs;
    let dropped = 0;
    for (const [roomCode, state] of this.states) {
      if (state.lastTouchMs < cutoff && state.state === "CLOSED") {
        // Kun drop CLOSED-state for trygghet. OPEN/HALF_OPEN beholdes
        // selv etter cutoff (det er pågående hendelser, ikke døde rom).
        this.states.delete(roomCode);
        dropped += 1;
      }
    }
    return dropped;
  }

  /**
   * @internal Test-only: hent count av rom under tracking.
   */
  size(): number {
    return this.states.size;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Hent state for et rom — opprett hvis ikke finnes — og prosesser
   * cooldown-transition (OPEN → HALF_OPEN). Idempotent på samme nowMs.
   */
  private tickState(roomCode: string, nowMs: number): InternalState {
    let state = this.states.get(roomCode);
    if (!state) {
      state = createFreshState(nowMs);
      this.states.set(roomCode, state);
      return state;
    }

    // Sjekk cooldown for OPEN-state.
    if (state.state === "OPEN" && state.openedAtMs !== null) {
      if (nowMs - state.openedAtMs >= this.config.cooldownMs) {
        // OPEN → HALF_OPEN.
        state.state = "HALF_OPEN";
        state.consecutiveHalfOpenSuccesses = 0;
        this.emit({
          type: "circuit_half_open",
          roomCode,
          atMs: nowMs,
        });
      }
    }

    state.lastTouchMs = nowMs;
    return state;
  }

  private emit(event: CircuitBreakerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Fail-soft: listeners må aldri ta ned breakeren.
      }
    }
  }
}
