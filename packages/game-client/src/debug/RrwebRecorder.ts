/**
 * RrwebRecorder — DOM session-replay via rrweb (Tobias-direktiv 2026-05-13).
 *
 * Bakgrunn:
 *   PR #1263 + EventStreamer (2026-05-12) gir oss strukturerte events. Det
 *   funker for å forstå "hva skjedde" på data-nivå, men når Tobias eller
 *   en pilot-spiller ser en bug, ønsker vi å kunne avspille NØYAKTIG hva
 *   de så som video — DOM-mutations, mouse-bevegelser, scroll, input.
 *
 *   Tobias-direktiv 2026-05-13:
 *   > "vi må nå bygge slik at test agenten får alt av mulig tilgjengelig
 *   >  informasjon igjennom consoll og andre områder slik at man lager en
 *   >  rapport som er så detaljert som mulig så vi finner ut av årsaken"
 *
 *   rrweb (MIT-licensed, open-source) løser DOM-replay-delen. Det
 *   serializer hele DOM-en på opptak-start og sender deretter inkrementelle
 *   mutations + interaksjoner. Sammen med EventStreamer får vi:
 *
 *     EventStreamer → "hva sa klienten på socket/REST"
 *     RrwebRecorder → "hva så brukeren på skjermen"
 *
 *   Kombinert = full bug-rapport.
 *
 * Designvalg:
 *   - Lazy-load rrweb via dynamic import når recorder starter — holder
 *     hovedbundle-størrelse lav i prod-build (rrweb er ~80 KB minified).
 *   - Batch + flush hvert 2s eller når buffer > 50 events, fire-and-forget
 *     fetch til backend (samme mønster som EventStreamer).
 *   - Session-id genereres engangs ved start(); sendes med hver batch
 *     slik at backend skriver alle events i samme JSONL-fil per session.
 *   - `recordCanvas: true` slik at Pixi.js-renderede game-areas fanges.
 *   - Adaptive sampling: mousemove hvert 50ms, scroll hvert 150ms — sparer
 *     bytes uten å miste viktig interaksjon.
 *   - Sensitive input-masking: vi setter `maskAllInputs: false` siden vi
 *     trenger å se hva spiller skrev i admin/debug-felter. Men vi MASKER
 *     felt med `password`-type via `maskInputOptions`.
 *
 * Personvern (GDPR):
 *   - Passord-felter maskes via rrweb's `maskInputOptions: { password: true }`.
 *   - `data-rr-private`-attributtet kan settes på element vi vil skjule i
 *     replay (eks. spillerens fulle navn). Future-work — flagget hvis
 *     nødvendig.
 *   - Session lagres på `/tmp` server-side, ikke permanent storage.
 *
 * Failure-modes:
 *   - Backend nede → fetch retries med backoff (samme som EventStreamer)
 *   - rrweb ikke tilgjengelig (build feilet?) → log warn én gang, fortsett
 *   - Token feil → log warn, drop events (samme policy som EventStreamer)
 *
 * Lifecycle:
 *   - `start()` — initialiser rrweb-recording, start interval
 *   - `stop()` — stopp rrweb + flush kø
 *   - `markBug(label)` — sett markør i strømmen som backend kan filtrere på
 *
 * Storage:
 *   - Server-side: `/tmp/rrweb-session-<id>.jsonl` (append-only JSONL)
 *   - Max 50 MB per fil → rotere via backend
 *   - Sessions er forgjengelige (overlever ikke server-restart per design)
 */

/**
 * Konfigurasjon for recorder. Alle felt unntatt `token` er optionelle.
 */
export interface RrwebRecorderOptions {
  /** Backend-URL for POST. Default `/api/_dev/debug/rrweb-events`. */
  endpoint?: string;
  /** Token til server (RESET_TEST_PLAYERS_TOKEN-match). Påkrevd. */
  token: string;
  /** Flush-interval i ms. Default 2000. */
  flushIntervalMs?: number;
  /** Max events per batch. Default 50. */
  maxBatchSize?: number;
  /** Mousemove-sampling i ms. Default 50. */
  mousemoveSamplingMs?: number;
  /** Scroll-sampling i ms. Default 150. */
  scrollSamplingMs?: number;
  /**
   * Hvis satt: bruk denne i stedet for å auto-generere. Brukes av tester
   * og for å koble RrwebRecorder-session med en EventStreamer-session.
   */
  sessionId?: string;
  /**
   * Skal canvas (Pixi.js) tas opp? Default `true` siden vi vil se game-area.
   * Disable hvis du vil teste DOM-only-recording (rrweb-canvas-recording
   * er CPU-tung).
   */
  recordCanvas?: boolean;
  /**
   * Fetch-implementasjon for tester. Default: `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * Override for rrweb's `record`-funksjon. Brukes KUN av tester — i
   * produksjon dynamisk-imorters rrweb fra `node_modules/rrweb`.
   *
   * Signatur matcher den minimale API-en vi trenger fra rrweb:
   *   `record({ emit, recordCanvas, sampling, maskInputOptions })`
   *   Returnerer en `() => void` for å stoppe recording.
   */
  recordFn?: RrwebRecordFn;
}

/**
 * Minimal type-signatur for rrweb's `record`-funksjon. Vi unngår å
 * importere `rrweb`-types direkte i den eksporterte API-en — det ville
 * tvunget alle test-callers til å importere rrweb selv.
 */
export type RrwebEvent = {
  type: number;
  data: unknown;
  timestamp: number;
};

export type RrwebRecordFn = (options: {
  emit: (event: RrwebEvent) => void;
  recordCanvas?: boolean;
  sampling?: { mousemove?: number; scroll?: number };
  maskInputOptions?: { password?: boolean };
  inlineStylesheet?: boolean;
}) => (() => void) | undefined;

/** Status-snapshot for debug-HUD. */
export interface RrwebRecorderStatus {
  running: boolean;
  sessionId: string | null;
  startedAt: number | null;
  flushCount: number;
  failureCount: number;
  eventsRecorded: number;
  eventsSent: number;
  queueLength: number;
  lastErrorCode: string | null;
  markedBugs: Array<{ label: string; at: number }>;
}

/**
 * Generer en kort session-id som er trygg å bruke i filnavn.
 *
 * Format: `<timestamp-ms>-<random-6-chars>` — sorterbart kronologisk.
 */
function generateSessionId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

export class RrwebRecorder {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly mousemoveSamplingMs: number;
  private readonly scrollSamplingMs: number;
  private readonly recordCanvas: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly recordFnOverride: RrwebRecordFn | undefined;

  /** Generert ved start() — koble alle events i denne sesjonen sammen. */
  private sessionId: string | null = null;
  private startedAt: number | null = null;

  /** Tilbakekall fra rrweb.record() — kall for å stoppe recording. */
  private stopRrweb: (() => void) | null = null;

  /** Pending events. */
  private queue: RrwebEvent[] = [];

  /** Flush-timer. `null` når stopped. */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Statistikk. */
  private flushCount = 0;
  private failureCount = 0;
  private eventsRecorded = 0;
  private eventsSent = 0;
  private lastErrorCode: string | null = null;

  /** Bug-markører som er satt under sesjonen. Speiles til backend. */
  private markedBugs: Array<{ label: string; at: number }> = [];

  /** Hindrer parallelle flush-kall fra å race. */
  private flushInFlight = false;

  /** Idempotency-guard så vi ikke kan ha 2 aktive sessions samtidig. */
  private running = false;

  constructor(opts: RrwebRecorderOptions) {
    if (typeof opts.token !== "string" || opts.token.trim().length === 0) {
      throw new Error("RrwebRecorder: token er påkrevd");
    }
    this.endpoint = opts.endpoint ?? "/api/_dev/debug/rrweb-events";
    this.token = opts.token;
    this.flushIntervalMs = Math.max(100, opts.flushIntervalMs ?? 2000);
    this.maxBatchSize = Math.max(1, opts.maxBatchSize ?? 50);
    this.mousemoveSamplingMs = Math.max(10, opts.mousemoveSamplingMs ?? 50);
    this.scrollSamplingMs = Math.max(10, opts.scrollSamplingMs ?? 150);
    this.recordCanvas = opts.recordCanvas ?? true;
    this.sessionId = opts.sessionId ?? null;
    this.recordFnOverride = opts.recordFn;

    const userFetch = opts.fetchImpl;
    if (userFetch) {
      this.fetchImpl = userFetch;
    } else if (typeof fetch !== "undefined") {
      // Wrap i arrow-funksjon — globalThis.fetch krever `this === globalThis`,
      // og direct assignment ville mistet bindingen. Samme pattern som EventStreamer.
      this.fetchImpl = ((input, init) => fetch(input, init)) as typeof fetch;
    } else {
      throw new Error(
        "RrwebRecorder: fetch er ikke tilgjengelig (Node uten polyfill?)",
      );
    }
  }

  /**
   * Start rrweb-recording og scheduling av flush. Idempotent — re-kall er no-op.
   *
   * I prod laster vi rrweb via dynamic-import for å holde main bundle liten.
   * I tester sender callers en `recordFn` via opts som overstyrer importen.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.sessionId = this.sessionId ?? generateSessionId();
    this.startedAt = Date.now();

    const recordFn = this.recordFnOverride ?? (await loadRrwebRecord());
    if (!recordFn) {
      // rrweb ikke tilgjengelig — log warn én gang og gi opp graciously.
      // Hovedfunksjonalitet (spill / EventStreamer) ikke påvirket.
      // eslint-disable-next-line no-console
      console.warn(
        "[RrwebRecorder] rrweb ikke tilgjengelig, DOM-replay disabled.",
      );
      this.lastErrorCode = "RRWEB_NOT_AVAILABLE";
      this.running = false;
      return;
    }

    try {
      this.stopRrweb =
        recordFn({
          emit: (event: RrwebEvent) => {
            this.handleEvent(event);
          },
          recordCanvas: this.recordCanvas,
          sampling: {
            mousemove: this.mousemoveSamplingMs,
            scroll: this.scrollSamplingMs,
          },
          maskInputOptions: {
            password: true,
          },
          inlineStylesheet: true,
        }) ?? null;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[RrwebRecorder] rrweb.record() kastet:", err);
      this.lastErrorCode = "RRWEB_RECORD_THREW";
      this.running = false;
      this.stopRrweb = null;
      return;
    }

    this.scheduleNextFlush();
  }

  /**
   * Stopp recording. Pending events flushes IKKE automatisk — call må
   * eksplisitt kalle `flushNow()` etter `stop()` hvis ønskelig (vi gjør
   * dette i markBug-flyten for å garantere at bug-markøren når backend).
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.stopRrweb) {
      try {
        this.stopRrweb();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[RrwebRecorder] stopRrweb threw:", err);
      }
      this.stopRrweb = null;
    }
  }

  /**
   * Trigger en flush nå (utenfor interval-tick). Brukes av tester og av
   * `markBug()` for å garantere at bug-markører når backend før eventuelt
   * browser-close.
   */
  async flushNow(): Promise<void> {
    if (this.flushInFlight) {
      return;
    }
    await this.doFlush();
  }

  /**
   * Marker en bug i strømmen. Backend ser markøren som et spesielt event
   * med `__bugMark: true` slik at session-replay-UI kan hoppe rett til
   * marker-tidspunktet.
   *
   * Eksempel: Tobias ser en popup som ikke åpner → klikk "Lagre session
   * for bug-rapport" → markBug("popup-blocked") → strømmen tagget +
   * flushed → PM-agent kan trekke session-id og replay.
   */
  async markBug(label: string): Promise<void> {
    if (!this.running || !this.sessionId) {
      // eslint-disable-next-line no-console
      console.warn(
        "[RrwebRecorder] markBug kalt før start() — ignorert.",
      );
      return;
    }
    const at = Date.now();
    this.markedBugs.push({ label, at });
    // Synthetic event som backend kan filtrere på. type=99 er valgt utenfor
    // rrweb's egne event-types (0-8 brukt) for å unngå kollisjon.
    const marker: RrwebEvent = {
      type: 99,
      timestamp: at,
      data: { __bugMark: true, label, at },
    };
    this.queue.push(marker);
    this.eventsRecorded++;
    // Flush umiddelbart — vi vil at marker når backend selv om brukeren
    // lukker tab-en rett etterpå.
    await this.flushNow();
  }

  /** Status-snapshot for HUD / tester. */
  getStatus(): RrwebRecorderStatus {
    return {
      running: this.running,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      flushCount: this.flushCount,
      failureCount: this.failureCount,
      eventsRecorded: this.eventsRecorded,
      eventsSent: this.eventsSent,
      queueLength: this.queue.length,
      lastErrorCode: this.lastErrorCode,
      markedBugs: [...this.markedBugs],
    };
  }

  // ── Interne metoder ─────────────────────────────────────────────────────

  private handleEvent(event: RrwebEvent): void {
    this.queue.push(event);
    this.eventsRecorded++;
    // Hvis vi har mer enn maxBatchSize × 4, flushh umiddelbart for å unngå
    // OOM ved høy event-rate (eks. mye canvas-animasjon).
    if (this.queue.length >= this.maxBatchSize * 4) {
      void this.flushNow();
    }
  }

  private scheduleNextFlush(): void {
    if (!this.running) return;
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.doFlush().finally(() => {
        if (this.running) {
          this.scheduleNextFlush();
        }
      });
    }, this.flushIntervalMs);
    // Unref så node ikke holder process levende i tester.
    const t = this.flushTimer as unknown as { unref?: () => void };
    if (typeof t.unref === "function") {
      t.unref();
    }
  }

  private async doFlush(): Promise<void> {
    if (this.queue.length === 0) return;
    if (this.flushInFlight) return;
    if (!this.sessionId) return;
    this.flushInFlight = true;
    try {
      const batch = this.queue.slice(0, this.maxBatchSize);
      const body = JSON.stringify({
        sessionId: this.sessionId,
        startedAt: this.startedAt,
        events: batch,
      });
      const url = `${this.endpoint}?token=${encodeURIComponent(this.token)}`;
      // OBS-2 keepalive-fix 2026-05-14 (Tobias pilot-test): `keepalive: true`
      // har 64KB body-limit i Chrome/Safari. Rrweb-batches er typisk
      // 100-500KB → browser aborterte fetch FØR backend så den. Resultat:
      // "Failed to fetch" + tight retry-loop som frøs nettleseren under
      // pilot-bug-test 2026-05-13 ~23:00. Vi mister evnen til å flushe
      // siste batch ved pagehide/unload, men det er en akseptabel trade-off
      // mot at observability fungerer i det hele tatt under runtime.
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!response.ok) {
        this.failureCount++;
        this.lastErrorCode = `HTTP_${response.status}`;
        // 401/403 → token bad → ikke retry, drop batch
        if (response.status === 401 || response.status === 403) {
          this.queue.splice(0, batch.length);
        }
        return;
      }
      // Suksess — fjern batch fra kø.
      this.queue.splice(0, batch.length);
      this.flushCount++;
      this.eventsSent += batch.length;
      this.lastErrorCode = null;
    } catch (err) {
      this.failureCount++;
      this.lastErrorCode =
        err instanceof Error ? `NETWORK_${err.name}` : "NETWORK_UNKNOWN";
    } finally {
      this.flushInFlight = false;
    }
  }
}

/**
 * Lazy-load rrweb's `record`-funksjon via dynamic import. Returnerer null
 * hvis import feiler (eks. bundle-build skipped rrweb). Caller logger
 * warning og fortsetter uten DOM-replay.
 *
 * NB: Dynamic import er nødvendig for at hovedbundlen IKKE skal trekke
 * inn rrweb (~80 KB) i prod-build hvor debug ikke er aktivert.
 */
async function loadRrwebRecord(): Promise<RrwebRecordFn | null> {
  try {
    // Type-cast: rrweb's `record`-export matcher RrwebRecordFn-signaturen
    // for de feltene vi bruker. Vi caster gjennom unknown for å unngå at
    // typesystem kaster på sub-set-mismatch (rrweb tilbyr flere opt-felter
    // enn vi bruker).
    const mod = (await import("rrweb")) as unknown as { record?: RrwebRecordFn };
    if (typeof mod.record === "function") {
      return mod.record;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Singleton-instans ─────────────────────────────────────────────────────

/**
 * Singleton-pattern matcher EventTracker. Flere call-sites (HUD-knapp +
 * Game1Controller + bug-trigger) skal dele samme recorder.
 */
let _instance: RrwebRecorder | null = null;

/**
 * Hent recorder-singleton. Hvis ikke initialisert: callers må først kalle
 * `setupRrwebRecorder()` med token + opts.
 */
export function getRrwebRecorder(): RrwebRecorder | null {
  return _instance;
}

/**
 * Initialiser singleton. Idempotent — re-kall returnerer eksisterende
 * instans uten å re-konfigurere.
 */
export function setupRrwebRecorder(opts: RrwebRecorderOptions): RrwebRecorder {
  if (_instance === null) {
    _instance = new RrwebRecorder(opts);
  }
  return _instance;
}

/**
 * Reset singleton. Brukes av tester for ren state per case.
 */
export function resetRrwebRecorder(): void {
  if (_instance && _instance.getStatus().running) {
    _instance.stop();
  }
  _instance = null;
}
