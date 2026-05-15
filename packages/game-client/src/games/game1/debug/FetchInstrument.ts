/**
 * FetchInstrument — wrapper rundt `globalThis.fetch` som logger requests
 * og responses til EventTracker (Tobias-direktiv 2026-05-13).
 *
 * Bakgrunn:
 *   "vi må nå bygge slik at test agenten får alt av mulig tilgjengelig
 *   informasjon" — Tobias 2026-05-13.
 *
 *   Pilot-test-monitor poller `/api/_dev/debug/events/tail` for å se hva
 *   klienten gjør. Klikk → socket.emit fanges av SocketEmitInstrument.
 *   REST-kall (POST /api/agent/game1/buy, GET /api/games/spill1/lobby,
 *   etc.) trenger samme dekning.
 *
 * Designvalg:
 *   - Wrapper `globalThis.fetch` (monkey-patch) i stedet for å edite
 *     hvert kall-sted. Gir 100% dekning med 0 kode-endringer i
 *     forretnings-logikk.
 *   - Idempotent — re-kall er trygt. Bruker en sentinel-flag på fetch
 *     for å unngå dobbel-wrapping.
 *   - Sanitering — request-body strippes for kjente sensitive felter
 *     (Authorization-header, passord). Sjekker gjøres på lavt nivå så
 *     EventTracker selv slipper å klassifisere.
 *   - Best-effort fail-soft — hvis instrument-koden kaster, lar vi
 *     originalen passere uten å felle requesten.
 *   - Recursion-safe — `globalThis.fetch` brukt INNE i EventStreamer
 *     gjør at vi MÅ unngå å logge debug-stream-kallene selv. Vi
 *     hopper over hvis URLen matcher /api/_dev/debug/events.
 *
 * Personvern:
 *   - Authorization-header → `[REDACTED]`
 *   - Request-body som ser ut som JSON sanitiseres (password/token/etc.)
 *   - Response-body trunkeres til 2000 tegn for å unngå memory-bloat
 *
 * Lifecycle:
 *   - `installFetchInstrument()` returns uninstall-funksjon
 *   - Idempotent — første kall installer, etterfølgende returnerer no-op
 */

import { getEventTracker } from "./EventTracker.js";

const FETCH_INSTRUMENT_KEY = "__spilloramaFetchInstrumentInstalled";

/** URLer vi IKKE skal logge for å unngå rekursjon eller støy. */
const SKIP_URL_PATTERNS: readonly RegExp[] = [
  /\/api\/_dev\/debug\/events(\?|$)/,
  /\/api\/_dev\/debug\/bug-report(\?|$)/,
];

/** Max lengde på response-body i events-bufferen (sanitization gjør resten). */
const MAX_BODY_PREVIEW = 2000;

/** Header-keys som ALDRI loggés (matchet case-insensitive). */
const SENSITIVE_HEADER_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "x-api-key",
  "x-auth-token",
  "cookie",
]);

interface InstrumentDeps {
  /** For tester: override fetch-target (default = globalThis.fetch). */
  fetchTarget?: typeof fetch;
  /** For tester: override now (default = Date.now). */
  now?: () => number;
  /** For tester: korte ventetider er irrelevante — sett til 0 for fast-path. */
  maxBodyPreview?: number;
}

let originalFetch: typeof fetch | null = null;
let installed = false;

function shouldSkipUrl(url: string): boolean {
  return SKIP_URL_PATTERNS.some((p) => p.test(url));
}

function sanitizeHeaders(headersInit: HeadersInit | undefined): Record<string, string> {
  if (!headersInit) return {};
  const out: Record<string, string> = {};
  try {
    let entries: Iterable<[string, string]>;
    if (headersInit instanceof Headers) {
      entries = headersInit.entries();
    } else if (Array.isArray(headersInit)) {
      entries = headersInit as Array<[string, string]>;
    } else {
      entries = Object.entries(headersInit) as Array<[string, string]>;
    }
    for (const [k, v] of entries) {
      const lower = String(k).toLowerCase();
      out[k] = SENSITIVE_HEADER_KEYS.has(lower) ? "[REDACTED]" : String(v);
    }
  } catch {
    // ignorer — best-effort
  }
  return out;
}

function sanitizeBody(body: BodyInit | null | undefined): unknown {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") {
    // Prøv JSON.parse for å la EventTracker sanitize på key-basis.
    try {
      return JSON.parse(body);
    } catch {
      // Ikke JSON — trunkér.
      return body.length > MAX_BODY_PREVIEW
        ? body.slice(0, MAX_BODY_PREVIEW) + "...(truncated)"
        : body;
    }
  }
  if (body instanceof FormData) {
    return { type: "FormData", entries: "(elided)" };
  }
  if (body instanceof URLSearchParams) {
    return { type: "URLSearchParams", value: body.toString() };
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return { type: "binary", byteLength: (body as ArrayBuffer).byteLength };
  }
  if (body instanceof Blob) {
    return { type: "Blob", size: body.size, mime: body.type };
  }
  return { type: "(unknown-body-type)" };
}

async function safePreviewResponse(
  response: Response,
  maxPreview: number,
): Promise<{ body: unknown; truncated: boolean }> {
  // Klon for å unngå at downstream-konsumenter mister bodyen.
  try {
    const cloned = response.clone();
    const text = await cloned.text();
    // Prøv JSON-parse for å gi struktur.
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        return { body: JSON.parse(text), truncated: false };
      } catch {
        return {
          body: text.length > maxPreview ? text.slice(0, maxPreview) + "..." : text,
          truncated: text.length > maxPreview,
        };
      }
    }
    return {
      body:
        text.length > maxPreview ? text.slice(0, maxPreview) + "..." : text,
      truncated: text.length > maxPreview,
    };
  } catch {
    return { body: "(could-not-read-body)", truncated: false };
  }
}

/**
 * Install fetch-instrument. Idempotent — gjentatte kall er trygge.
 * Returnerer uninstall-funksjon for test-isolasjon.
 */
export function installFetchInstrument(
  deps: InstrumentDeps = {},
): () => void {
  // Browser-only — skip i Node/test-miljø der `fetch` mangler.
  if (typeof globalThis === "undefined") return () => {};
  const target = deps.fetchTarget ?? globalThis.fetch;
  if (typeof target !== "function") return () => {};

  const w = globalThis as unknown as Record<string, boolean | undefined>;
  if (w[FETCH_INSTRUMENT_KEY] === true || installed) {
    return () => {};
  }

  // Gate på `?debug=full` (Tobias-direktiv 2026-05-15) samme som ConsoleBridge.
  // Defense-in-depth — funksjonen kalles uansett kun fra mountDebugHud.
  const enabled = (() => {
    try {
      if (typeof window === "undefined") return false;
      const params = new URLSearchParams(window.location.search);
      return params.get("debug") === "full";
    } catch {
      return false;
    }
  })();
  if (!enabled) return () => {};

  originalFetch = target;
  const now = deps.now ?? Date.now;
  const maxPreview = deps.maxBodyPreview ?? MAX_BODY_PREVIEW;

  const wrappedFetch: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const startMs = now();
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    // Skip-list — debug-stream + bug-report må ikke logges (rekursjon).
    if (shouldSkipUrl(url)) {
      return originalFetch!(input, init);
    }

    // Track request (fail-soft)
    try {
      const tracker = getEventTracker();
      tracker.track("api.request", {
        url,
        method,
        headers: sanitizeHeaders(init?.headers),
        body: sanitizeBody(init?.body),
        startMs,
      });
    } catch {
      // ignore
    }

    let response: Response;
    try {
      response = await originalFetch!(input, init);
    } catch (err) {
      // Network-feil — track som api.response med status -1
      try {
        const tracker = getEventTracker();
        tracker.track("api.response", {
          url,
          method,
          status: -1,
          ok: false,
          durationMs: now() - startMs,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {
        /* ignore */
      }
      throw err;
    }

    // Track response (fail-soft) — preview body etter at vi har klonet
    void (async () => {
      try {
        const preview = await safePreviewResponse(response, maxPreview);
        const tracker = getEventTracker();
        tracker.track("api.response", {
          url,
          method,
          status: response.status,
          ok: response.ok,
          durationMs: now() - startMs,
          body: preview.body,
          bodyTruncated: preview.truncated,
        });
      } catch {
        /* ignore */
      }
    })();

    return response;
  };

  // Monkey-patch
  (globalThis as unknown as { fetch: typeof fetch }).fetch = wrappedFetch;
  w[FETCH_INSTRUMENT_KEY] = true;
  installed = true;

  return () => {
    if (originalFetch) {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }
    w[FETCH_INSTRUMENT_KEY] = undefined;
    installed = false;
    originalFetch = null;
  };
}

// Test-exports
export const __TEST_ONLY__ = {
  sanitizeHeaders,
  sanitizeBody,
  shouldSkipUrl,
};
