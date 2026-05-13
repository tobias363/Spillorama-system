/**
 * EventTracker — comprehensive event tracking for Spill 1 client (Tobias-direktiv 2026-05-12).
 *
 * Bakgrunn:
 *   Tobias trenger 100 % synlighet i hva som skjer når han eller en
 *   pilot-spiller utfører handlinger i klient og master-konsoll.
 *   Eksisterende `[DRAW]`/`[ROOM]`-console-logger (gated på
 *   `?debug=1` + DEBUG_SPILL1_DRAWS) er bra for live-monitoring i
 *   devtools, men de overlever ikke en page-reload og kan ikke deles
 *   med PM/agent for diagnose.
 *
 *   EventTracker holder en ring-buffer av siste N events i memory, med
 *   en `export()`-funksjon som returnerer hele bufferen pluss
 *   session-kontekst. Spilleren trykker "Dump diagnose"-knapp i debug-
 *   HUD-en og får en JSON-fil de kan sende videre.
 *
 * Designvalg:
 *   - Ring-buffer (FIFO) — ingen unbounded memory growth selv ved
 *     langvarige sesjoner. Default 500 events ~= 30 min normal aktivitet.
 *   - Singleton-instans (`getEventTracker()`) — flere call-sites
 *     (Controller + BuyPopup + SocketActions + LobbyStateBinding) deler
 *     samme tracker uten å måtte snake-drag den gjennom konstruktører.
 *   - Pure data — events er rene objekter, ingen klasse-instanser.
 *   - Sanitize-helpers — strip sensitive payload-keys, behold kun
 *     `payloadKeys` for socket-events der full payload ville lekke
 *     bong-numre eller pattern-data.
 *
 * Personvern (GDPR):
 *   - userId/playerId/hallId loggis (pseudo-anonyme IDer)
 *   - Wallet-saldo loggis kun ved eksplisitt event (numeric, OK siden
 *     spilleren selv sender filen)
 *   - Socket-event payloads loggis som `payloadKeys: string[]`, IKKE
 *     full payload, for å unngå at bongnumre/pattern-detaljer lekker
 *   - Passord, JWT-tokens, og full PII er NEVER logget
 */

export type EventType =
  | "user.click"
  | "api.request"
  | "api.response"
  | "socket.emit"
  | "socket.recv"
  | "state.change"
  | "lobby.change"
  | "error.client"
  // Tobias-direktiv 2026-05-13: gi server-side monitor tilgang til
  // klient-konsoll og UI-state-gating som PM trenger for diagnose.
  | "console.log"
  | "console.warn"
  | "console.error"
  | "console.info"
  | "console.debug"
  | "popup.autoShowGate"
  | "popup.show"
  | "popup.hide"
  | "screen.mount"
  // Observability fix-PR 2026-05-13: bygge full debugging-instrumentering
  // slik at vi slutter å gjette på pilot-bugs. Disse erstatter / utvider
  // hvilke signaler EventTracker capturer:
  //   - `screen.transition` — bytte fra én screen til en annen (i Game1
  //     handler: LOADING → WAITING → PLAYING → ENDED). Komplementerer
  //     `screen.mount` som fyrer på første-render.
  //   - `rest.fetch` — HTTP-request via wrappet fetch (REST-flyt for
  //     ticket-purchase + lobby + master-actions).
  //   - `room.update.full` — komplett room:update-payload (chunked til
  //     2KB max per entry hvis nødvendig — vi vil ha hele payloaden i
  //     diagnose-rapporten, ikke kun payloadKeys).
  | "screen.transition"
  | "rest.fetch"
  | "room.update.full";

export interface TrackedEvent {
  /** Monotont voksende ID (within session). Format: `evt-<n>`. */
  id: string;
  /** `Date.now()` ved track-tidspunkt. */
  timestamp: number;
  /** ISO 8601 string (UTC), avledet fra `timestamp`. */
  iso: string;
  /** Event-type. */
  type: EventType;
  /** Event-spesifikk payload. Kun ufarlige felter — sanitized opp-stream. */
  payload: Record<string, unknown>;
  /** Hvis kjent: traceId fra request/response-paret (backend correlate). */
  traceId?: string;
  /**
   * Hvis kjent: koble request/response-paret (eks. `api.request` ↔
   * `api.response` med samme correlationId, ELLER `user.click` ↔
   * `socket.emit` ↔ `socket.recv` (samme button-trigget kjede).
   */
  correlationId?: string;
}

export interface SessionContext {
  userId: string | null;
  playerId: string | null;
  hallId: string | null;
  roomCode: string | null;
  scheduledGameId: string | null;
  currentScreen: string | null;
}

export interface EventTrackerExport {
  generatedAt: string;
  userAgent: string;
  url: string;
  sessionContext: SessionContext;
  /** Total antall events tracked siden start (kan være > events.length pga ring-buffer drop). */
  totalTracked: number;
  /** Antall events droppet pga ring-buffer overflow (FIFO oldest-out). */
  droppedCount: number;
  /** Events i kronologisk rekkefølge (eldst først). */
  events: TrackedEvent[];
}

export interface EventTrackerOptions {
  /**
   * Maks antall events å holde i ring-bufferen. Når full, FIFO drop av
   * eldste. Default 500.
   */
  bufferSize?: number;
}

/**
 * Sentral event-tracker for Spill 1-klienten. Single-instance per page-load.
 *
 * Konsumeres av:
 *   - `Game1Controller` (state.change, socket.recv via bridge)
 *   - `Game1SocketActions` (api.request/response, socket.emit)
 *   - `Game1LobbyStateBinding` (lobby.change)
 *   - `Game1BuyPopup` / `PlayScreen` (user.click)
 *   - debug-HUD (export + render)
 */
export class EventTracker {
  private buffer: TrackedEvent[] = [];
  private nextId = 1;
  private totalTracked = 0;
  private droppedCount = 0;
  private readonly bufferSize: number;

  private session: SessionContext = {
    userId: null,
    playerId: null,
    hallId: null,
    roomCode: null,
    scheduledGameId: null,
    currentScreen: null,
  };

  private listeners: Set<(event: TrackedEvent) => void> = new Set();

  constructor(opts: EventTrackerOptions = {}) {
    // Tillat liten buffer-størrelse for tester. Produksjons-default 500.
    this.bufferSize = Math.max(1, opts.bufferSize ?? 500);
  }

  /**
   * Track a new event. Returnerer event-IDen så caller kan bruke den til
   * å sette `correlationId` på etterfølgende relaterte events.
   */
  track(
    type: EventType,
    payload: Record<string, unknown> = {},
    options: { traceId?: string; correlationId?: string } = {},
  ): string {
    const id = `evt-${this.nextId++}`;
    const timestamp = Date.now();
    const event: TrackedEvent = {
      id,
      timestamp,
      iso: new Date(timestamp).toISOString(),
      type,
      payload: sanitizePayload(payload),
      traceId: options.traceId,
      correlationId: options.correlationId,
    };
    this.totalTracked++;
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
      this.droppedCount++;
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // En syk listener må ikke ta ned tracker-en. Logg + fortsett.
        // eslint-disable-next-line no-console
        console.warn("[EventTracker] listener kastet:", err);
      }
    }
    return id;
  }

  /**
   * Subscribe på nye events (real-time fan-out til debug-HUD).
   * Returnerer unsubscribe-funksjon. Initial-emit skjer IKKE — caller
   * kan hente eksisterende events via `getEvents()` om ønskelig.
   */
  subscribe(listener: (event: TrackedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Update session-context. Partial — kun feltene som er satt overskriver
   * eksisterende verdier. Kalt fra Game1Controller når roomCode/playerId/
   * scheduledGameId endres.
   */
  setSessionContext(partial: Partial<SessionContext>): void {
    this.session = { ...this.session, ...partial };
  }

  /** Returner kopi av session-context (for unit-tester / inspeksjon). */
  getSessionContext(): SessionContext {
    return { ...this.session };
  }

  /** Returner kopi av events-buffer (eldste først). */
  getEvents(): TrackedEvent[] {
    return [...this.buffer];
  }

  /** Tøm bufferen. Brukes av debug-HUD "Clear log"-knappen. */
  clear(): void {
    this.buffer = [];
    this.droppedCount = 0;
    this.totalTracked = 0;
  }

  /**
   * Bygg eksport-rapport. Kalt fra "Dump diagnose"-knappen i debug-HUD.
   * Returnerer rent JSON-objekt — caller (debug-HUD) gjør
   * `JSON.stringify(report, null, 2)` og trigger fil-download.
   */
  export(): EventTrackerExport {
    const userAgent =
      typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
        ? navigator.userAgent
        : "(unknown)";
    const url =
      typeof window !== "undefined" && typeof window.location?.href === "string"
        ? window.location.href
        : "(unknown)";
    return {
      generatedAt: new Date().toISOString(),
      userAgent,
      url,
      sessionContext: this.getSessionContext(),
      totalTracked: this.totalTracked,
      droppedCount: this.droppedCount,
      events: this.getEvents(),
    };
  }
}

// ── Sanitize-helpers ──────────────────────────────────────────────────────

/**
 * Liste over felt-navn som ALDRI skal eksponeres i tracker-payloads. Hvis
 * en payload har en av disse keys, blir verdien erstattet med `"[REDACTED]"`.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "jwt",
  "authorization",
  "apiKey",
  "api_key",
  "ssn",
  "personnummer",
  "nationalId",
]);

/**
 * Sanitize en payload før tracking. Strip sensitive keys og truncate
 * lange strenger.
 *
 * Strategi:
 *   - Nøkler som matcher SENSITIVE_KEYS → "[REDACTED]"
 *   - Strenger > 500 tegn → trunkert med "...(truncated)"-suffix
 *   - Arrays > 50 elementer → trunkert med count-marker
 *   - Nested-objekter: rekursivt sanitized (maks 3 nivåer dypt for å unngå
 *     unbounded recursion / sirkulære referanser)
 */
function sanitizePayload(
  input: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > 3) {
    return { __truncated: "(max-depth-reached)" };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitizeValue(value, depth);
  }
  return out;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 500) {
      return value.slice(0, 500) + "...(truncated)";
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 50) {
      return [
        ...value.slice(0, 50).map((v) => sanitizeValue(v, depth + 1)),
        `...(${value.length - 50} more)`,
      ];
    }
    return value.map((v) => sanitizeValue(v, depth + 1));
  }
  if (typeof value === "object") {
    return sanitizePayload(value as Record<string, unknown>, depth + 1);
  }
  // function, symbol, bigint — stringify til type-marker
  return `[${typeof value}]`;
}

// ── Singleton-instans ─────────────────────────────────────────────────────

/**
 * Lazy-init singleton. Første kall til `getEventTracker()` lager
 * instansen; etterfølgende kall returnerer samme.
 *
 * Singleton fordi:
 *   - Flere call-sites (Controller + actions + popup + binding) skal dele
 *     samme buffer.
 *   - Debug-HUD må kunne hente same buffer uten å bli passert som dep.
 *   - Tester kan kalle `resetEventTracker()` i `beforeEach`.
 */
let _instance: EventTracker | null = null;

export function getEventTracker(opts: EventTrackerOptions = {}): EventTracker {
  if (_instance === null) {
    _instance = new EventTracker(opts);
  }
  return _instance;
}

/**
 * Reset singleton. Brukes av tester for å få en ren state per case.
 * Kan også kalles fra debug-HUD "Clear log"-knappen hvis vi ønsker
 * full reset (foretrukket: `getEventTracker().clear()`).
 */
export function resetEventTracker(): void {
  _instance = null;
}

// ── Helpers for socket-event tracking ────────────────────────────────────

/**
 * Strip payload til kun nøkler — brukes for socket.emit / socket.recv
 * der full payload kan inneholde bong-data eller pattern-detaljer.
 *
 * Eks: payload = { roomCode: "X", drawnNumbers: [1,2,3], tickets: [...] }
 *      → { payloadKeys: ["roomCode", "drawnNumbers", "tickets"] }
 *
 * Kombiner med `pickSafeFields()` hvis du vil beholde noen safe-felter:
 *      → { payloadKeys: [...], roomCode: "X", drawCount: 3 }
 */
export function payloadKeysOnly(
  payload: Record<string, unknown> | null | undefined,
): { payloadKeys: string[] } {
  if (!payload || typeof payload !== "object") {
    return { payloadKeys: [] };
  }
  return { payloadKeys: Object.keys(payload) };
}

/**
 * Plukk ut spesifikke trygge felter fra en payload (eks roomCode,
 * drawIndex, status) for å tracke i klart. Resten av payloaden representeres
 * kun via `payloadKeys`.
 */
export function pickSafeFields(
  payload: Record<string, unknown> | null | undefined,
  safeFields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = payloadKeysOnly(payload);
  if (!payload) return out;
  for (const field of safeFields) {
    if (field in payload) {
      out[field] = payload[field];
    }
  }
  return out;
}

// ── Large-payload chunking (observability fix-PR 2026-05-13) ─────────────

/**
 * Max bytes per event-payload-fragment når vi tracker en stor payload
 * (eks. full room:update). 2 KB matcher Tobias-direktiv om å chunk-e
 * istedenfor å droppe — slik at vi ser hele snapshoten i diagnose-fil
 * uten å OOM-e ring-bufferen på lange sesjoner.
 *
 * 2 KB er rikelig for normale snapshots (<= 50 keys ≈ 1-1.5 KB). Vi
 * chunker kun når snapshoten er over thresholden — small snapshots
 * tracked som ett enkelt event.
 */
const LARGE_PAYLOAD_CHUNK_BYTES = 2048;

/**
 * Track a potentially large payload by chunking til ~2KB per event slik at
 * monitor / dump kan rekonstruere hele payloaden uten å sprenge ring-
 * bufferen. Returnerer event-IDene for alle chunks.
 *
 * Bruks-mønster:
 *   trackLargePayload(tracker, "room.update.full", { roomCode, snapshot });
 *
 * Implementasjon: JSON.stringify payload, split i N substring-chunks
 * (string-level, ikke UTF-8-byte-presist — godt nok for diagnose).
 * Hver chunk får `chunkIndex`, `chunkCount`, og `correlationId` slik at
 * monitor kan slå dem sammen igjen.
 *
 * Fail-soft: ved sirkulær referanse logger vi en `chunked.error`-marker
 * og skipper. Tracker krasher aldri caller.
 */
export function trackLargePayload(
  tracker: EventTracker,
  type: EventType,
  payload: Record<string, unknown>,
  options: { correlationId?: string; traceId?: string } = {},
): string[] {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (err) {
    tracker.track(type, {
      __chunked: true,
      __chunkError: String((err as Error)?.message ?? err),
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
    });
    return [];
  }

  if (serialized.length <= LARGE_PAYLOAD_CHUNK_BYTES) {
    // Liten nok til ett event — bruk normal track-path.
    return [tracker.track(type, payload, options)];
  }

  const correlationId =
    options.correlationId ??
    `chunked-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const chunks: string[] = [];
  for (let i = 0; i < serialized.length; i += LARGE_PAYLOAD_CHUNK_BYTES) {
    chunks.push(serialized.slice(i, i + LARGE_PAYLOAD_CHUNK_BYTES));
  }
  const ids: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const id = tracker.track(
      type,
      {
        __chunked: true,
        chunkIndex: i,
        chunkCount: chunks.length,
        chunk: chunks[i],
      },
      { correlationId, traceId: options.traceId },
    );
    ids.push(id);
  }
  return ids;
}
