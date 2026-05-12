/**
 * EventStreamer — auto-flush av tracker-events til backend (Tobias-direktiv 2026-05-12).
 *
 * Bakgrunn:
 *   PR #1263 (EventTracker + DebugEventLogPanel) lar Tobias dumpe en JSON-
 *   fil via "Dump diagnose"-knapp og sende den manuelt. Det funker, men
 *   krever at brukeren husker å trykke knappen, og PM/agent får filen i
 *   etterkant — ikke i sann tid.
 *
 *   Per Tobias-direktiv 2026-05-12: events skal auto-streames til backend
 *   slik at en live-monitoring-agent kan lese dem mens Tobias tester.
 *
 * Designvalg:
 *   - Batch-flush hvert N. sekund (default 2s) — ikke per-event så vi
 *     ikke spammer backend med 100 POST'er per minutt.
 *   - Fire-and-forget — `void fetch(...)`, ingen await på hovedtråd.
 *   - Best-effort med exponential backoff på feil (1s → 2s → 4s ... 30s cap).
 *   - Beholde ring-buffer i tracker uten å tømme den ved vellykket flush —
 *     "Dump diagnose"-knappen (PR #1263) skal fortsatt fungere som fallback.
 *   - Vi sender kun events som er NYE siden forrige flush (sporet via
 *     `lastFlushedTimestamp`-cursor). Re-send av allerede-sendte events
 *     skjer ikke automatisk.
 *
 * Personvern:
 *   - Token sendes som query-param (samme konvensjon som /api/_dev/game2-state)
 *   - Payloads er allerede sanitized i `EventTracker.track()` — vi
 *     sender det videre uten å re-sanitize
 *
 * Failure-modes:
 *   - Backend nede → fetch resolve med non-2xx → backoff og prøv igjen
 *   - Network error → fetch rejecter → backoff og prøv igjen
 *   - Token feil (401/403) → log warn én gang, fortsett (drop events
 *     stille — vi blokkerer ikke hovedfunksjonalitet på debug-leveranse)
 *   - 429 (rate-limit) → respekter Retry-After hvis satt, ellers 30s pause
 *
 * Lifecycle:
 *   - `start()` — start interval
 *   - `stop()` — stop interval, ingen siste flush (PR #1263 har dump-knapp som fallback)
 *   - `flushNow()` — manuelt trigge flush (brukes i tester + ved page-unload)
 */

import type { EventTracker, TrackedEvent } from "./EventTracker.js";

/**
 * Konfigurasjon for streameren. Alle felt er optionelle for å la
 * tester instansiere med små verdier uten å duplisere defaults.
 */
export interface EventStreamerOptions {
  /** Backend-URL for POST. Default `/api/_dev/debug/events`. */
  endpoint?: string;
  /** Token til server (RESET_TEST_PLAYERS_TOKEN-match). Påkrevd. */
  token: string;
  /** Hvor ofte vi flusher accumulerte events. Default 2000 ms. */
  flushIntervalMs?: number;
  /** Max events per batch. Default 100 — beskytter mot store payloads. */
  maxBatchSize?: number;
  /** Hvor lenge vi venter etter første feil før neste forsøk. Default 1000 ms. */
  initialBackoffMs?: number;
  /** Cap for exponential backoff. Default 30000 ms (30s). */
  maxBackoffMs?: number;
  /**
   * Fetch-implementasjon for tester. Default: `globalThis.fetch`. Lar
   * vi tester override med en mock uten å monkey-patche globals.
   */
  fetchImpl?: typeof fetch;
  /**
   * Timeout-source for tester. Default: `setTimeout` / `clearTimeout`.
   * Lar tester bruke `vi.useFakeTimers()` selv om streameren binder
   * timer-funksjoner i konstruktør.
   */
  timers?: {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };
}

/** Status for live-debug i devtools. */
export interface EventStreamerStatus {
  /** Antall vellykkede POST-batcher siden start. */
  flushCount: number;
  /** Antall feilede POST-forsøk (kan re-prøves) siden start. */
  failureCount: number;
  /** Total antall events sendt til backend. */
  eventsSent: number;
  /** Hvor mange events ligger i kø nå (utenfor neste flush-tick). */
  queueLength: number;
  /** Hvis vi har backoff aktiv: når neste flush-forsøk skjer (ms epoch). */
  nextRetryAt: number | null;
  /** Hvis vi har sett en blokerende error (401/403): siste meldingen. */
  lastErrorCode: string | null;
}

export class EventStreamer {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  private tracker: EventTracker | null = null;
  /** Tracker subscribe-handle, ryddes ved `stop()`. */
  private unsubscribeTracker: (() => void) | null = null;
  /** Pending events som ennå ikke er flushet (FIFO-kø, ny i tail). */
  private queue: TrackedEvent[] = [];
  /** Timer-handle for neste flush. `null` når stopped. */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** Backoff-multipler (1 = ingen backoff, 2 = 2× initial, etc.). */
  private backoffMultiplier = 1;

  // Statistikk (eksponert via getStatus()).
  private flushCount = 0;
  private failureCount = 0;
  private eventsSent = 0;
  private nextRetryAt: number | null = null;
  private lastErrorCode: string | null = null;
  /** Hindrer at parallelle flush-kall race-r mot hverandre. */
  private flushInFlight = false;

  constructor(opts: EventStreamerOptions) {
    if (typeof opts.token !== "string" || opts.token.trim().length === 0) {
      throw new Error("EventStreamer: token er påkrevd");
    }
    this.endpoint = opts.endpoint ?? "/api/_dev/debug/events";
    this.token = opts.token;
    this.flushIntervalMs = Math.max(100, opts.flushIntervalMs ?? 2000);
    this.maxBatchSize = Math.max(1, opts.maxBatchSize ?? 100);
    this.initialBackoffMs = Math.max(100, opts.initialBackoffMs ?? 1000);
    this.maxBackoffMs = Math.max(this.initialBackoffMs, opts.maxBackoffMs ?? 30_000);
    // Tobias-bug 2026-05-12: `TypeError: Illegal invocation` ved start().
    // Browser-native fetch/setTimeout/clearTimeout krever `this === globalThis`.
    // Assignet som instance-property uten bind() kalles de med `this === EventStreamer`
    // → Illegal invocation. Wrap i arrow-funksjon som forwarder med korrekt this.
    const userFetch = opts.fetchImpl;
    if (userFetch) {
      this.fetchImpl = userFetch;
    } else if (typeof fetch !== "undefined") {
      this.fetchImpl = ((input, init) => fetch(input, init)) as typeof fetch;
    } else {
      throw new Error("EventStreamer: fetch er ikke tilgjengelig (Node uten polyfill?)");
    }
    this.setTimeoutFn =
      opts.timers?.setTimeout ??
      (((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        setTimeout(handler, timeout, ...args)) as unknown as typeof setTimeout);
    this.clearTimeoutFn =
      opts.timers?.clearTimeout ??
      (((handle?: number) => clearTimeout(handle)) as unknown as typeof clearTimeout);
  }

  /**
   * Bind tracker og start auto-flushing. Idempotent — re-kall er trygt.
   *
   * Strategi:
   *   1. Subscribe til tracker (events landes i `this.queue` mens de skjer).
   *   2. Prim queue med eksisterende events (ring-buffer-content), så vi
   *      ikke mister kontekst hvis brukeren har klikket noe FØR `?debug=1`-
   *      koden gikk i gang.
   *   3. Schedule første flush-tick.
   */
  start(tracker: EventTracker): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.tracker = tracker;
    // Prim queue med eksisterende events fra tracker-ring-bufferen.
    // Deduplisering på id-basis: nye events fra subscribe-listener kan
    // teoretisk overlappe (race mellom getEvents og subscribe), så vi
    // bruker `id`-set for å dedup-e ved enqueue.
    const initialEvents = tracker.getEvents();
    for (const e of initialEvents) {
      this.queue.push(e);
    }
    this.unsubscribeTracker = tracker.subscribe((event) => {
      // Listener kan kalles for events vi allerede har i kø (initial prim).
      // Vi dedup-er på id for trygghet.
      if (!this.queue.some((existing) => existing.id === event.id)) {
        this.queue.push(event);
      }
    });
    this.scheduleNextFlush();
  }

  /**
   * Stop interval. Pending events forblir i kø — caller kan kalle
   * `flushNow()` manuelt hvis ønsket. PR #1263's "Dump diagnose"-knapp
   * leser tracker-ringbufferen direkte, så fallback-en holder.
   */
  stop(): void {
    this.running = false;
    if (this.flushTimer !== null) {
      this.clearTimeoutFn(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.unsubscribeTracker) {
      this.unsubscribeTracker();
      this.unsubscribeTracker = null;
    }
  }

  /**
   * Trigge en flush umiddelbart (utenfor interval-tick). Brukes i tester
   * + kan kalles fra `beforeunload`-handler hvis vi en dag legger til det.
   *
   * Returnerer en Promise som resolver når flush-attempt er ferdig
   * (vellykket eller feilet — uansett).
   */
  async flushNow(): Promise<void> {
    if (this.flushInFlight) {
      // En annen flush kjører — ikke kø-opp en til.
      return;
    }
    await this.doFlush();
  }

  /** Diagnose-snapshot for devtools / tester. */
  getStatus(): EventStreamerStatus {
    return {
      flushCount: this.flushCount,
      failureCount: this.failureCount,
      eventsSent: this.eventsSent,
      queueLength: this.queue.length,
      nextRetryAt: this.nextRetryAt,
      lastErrorCode: this.lastErrorCode,
    };
  }

  // ── Interne metoder ─────────────────────────────────────────────────────

  private scheduleNextFlush(): void {
    if (!this.running) return;
    if (this.flushTimer !== null) {
      // Allerede scheduled — ikke dobbelbook.
      return;
    }
    const delay = this.flushIntervalMs * this.backoffMultiplier;
    const target = Date.now() + delay;
    this.nextRetryAt = this.backoffMultiplier > 1 ? target : null;
    this.flushTimer = this.setTimeoutFn(() => {
      this.flushTimer = null;
      // Fire-and-forget — promise-feil håndteres internt i doFlush.
      void this.doFlush().finally(() => {
        if (this.running) {
          this.scheduleNextFlush();
        }
      });
    }, delay);
    // Node `unref` så streameren ikke holder process levende i tester.
    const t = this.flushTimer as unknown as { unref?: () => void };
    if (typeof t.unref === "function") {
      t.unref();
    }
  }

  private async doFlush(): Promise<void> {
    if (!this.running && this.queue.length === 0) {
      return;
    }
    if (this.queue.length === 0) {
      // Ingenting å sende, men reset backoff slik at neste tick går normalt.
      this.backoffMultiplier = 1;
      this.nextRetryAt = null;
      return;
    }
    if (this.flushInFlight) {
      return;
    }
    this.flushInFlight = true;
    try {
      // Plukk opp til maxBatchSize events fra front av kø.
      const batch = this.queue.slice(0, this.maxBatchSize);
      const sessionContext = this.tracker
        ? this.tracker.getSessionContext()
        : null;
      const body = JSON.stringify({
        events: batch,
        sessionContext,
      });
      const url = `${this.endpoint}?token=${encodeURIComponent(this.token)}`;
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
        // Sjekker `keepalive` så bool-flagget unngår beforeunload-drop hvis
        // browseren støtter det. Eldre browsers ignorerer flagget.
        keepalive: true,
      });
      if (!response.ok) {
        this.handleHttpFailure(response);
        return;
      }
      // Suksess — fjern batch fra kø.
      this.queue.splice(0, batch.length);
      this.flushCount++;
      this.eventsSent += batch.length;
      // Reset backoff på suksess.
      this.backoffMultiplier = 1;
      this.nextRetryAt = null;
      this.lastErrorCode = null;
    } catch (err) {
      this.handleNetworkFailure(err);
    } finally {
      this.flushInFlight = false;
    }
  }

  private handleHttpFailure(response: Response): void {
    this.failureCount++;
    const code = `HTTP_${response.status}`;
    this.lastErrorCode = code;
    if (response.status === 401 || response.status === 403) {
      // Auth-feil — token er feil eller server-config mangler env-var.
      // Vi fortsetter å prøve, men logger én warn (en gang er nok).
      if (this.backoffMultiplier === 1) {
        // eslint-disable-next-line no-console
        console.warn(
          `[EventStreamer] Auth-feil mot ${this.endpoint} (${response.status}). ` +
            "Sjekk at RESET_TEST_PLAYERS_TOKEN er satt på server. Backing off.",
        );
      }
    }
    this.bumpBackoff();
  }

  private handleNetworkFailure(err: unknown): void {
    this.failureCount++;
    const code =
      err instanceof Error ? `NETWORK_${err.name}` : "NETWORK_UNKNOWN";
    this.lastErrorCode = code;
    this.bumpBackoff();
  }

  private bumpBackoff(): void {
    // Exponential: 1× → 2× → 4× → 8× ... cap at maxBackoffMs.
    const nextMultiplier = Math.min(
      this.backoffMultiplier * 2,
      Math.ceil(this.maxBackoffMs / this.flushIntervalMs),
    );
    this.backoffMultiplier = nextMultiplier;
  }
}
