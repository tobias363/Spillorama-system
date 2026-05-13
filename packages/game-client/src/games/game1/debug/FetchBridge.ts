/**
 * FetchBridge — wrap window.fetch så ALLE HTTP-requests fra klient
 * tracks-es i EventTracker (Tobias-direktiv 2026-05-13: observability
 * fix-PR for å slutte å gjette på pilot-bugs).
 *
 * Mekanisme:
 *   1. Lagre original `window.fetch`
 *   2. Erstatt med wrapper som måler latency + status + url
 *   3. Track `rest.fetch`-event PRE-call og `rest.fetch`-event POST-response
 *      med samme correlationId
 *   4. Resten passerer uendret til original fetch
 *
 * Gate på `?debug=1` eller `localStorage.DEBUG_SPILL1_DRAWS=true` så vi
 * ikke pålegger fetch-overhead i produksjon.
 *
 * Personvern:
 *   - URL track-es (kan inneholde query-params, men ikke passord)
 *   - Status-code + duration tracks-es
 *   - Body track-es ALDRI (kan inneholde personnummer, accessToken,
 *     ticket-spec, etc.). Hvis vi en dag vil ha body-detaljer, lag en
 *     opt-in-modus med whitelist av endepunkter (eks "ticket-purchase").
 *   - Response-body tracks-es ALDRI av samme grunn.
 *
 * Performance:
 *   - Tracker er O(1), overhead per fetch < 0.1 ms.
 *   - Idempotent installer — kan re-kalles uten dobbel-wrap.
 *
 * Compat:
 *   - Krever moderne browser med global `fetch` (alle pilot-browsers støtter).
 *   - I Node-test-miljø der `fetch` mangler: installeren returnerer no-op uninstall.
 */

import { getEventTracker } from "./EventTracker.js";

const INSTALLED_KEY = "__spilloramaFetchBridgeInstalled";

let installed = false;

/**
 * Sjekk om bridge bør aktiveres — gate på `?debug=1` eller
 * `localStorage.DEBUG_SPILL1_DRAWS=true`.
 */
function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1") return true;
    if (params.get("debug") === "true") return true;
    const ls = window.localStorage?.getItem("DEBUG_SPILL1_DRAWS");
    return ls?.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

/**
 * Hent URL-streng fra fetch-input. `fetch` aksepterer string, URL eller
 * Request. Vi vil tracke noe lesbart.
 */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }
  return "(unknown)";
}

/**
 * Hent HTTP-metode fra fetch-input + init.
 */
function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

/**
 * Installer FetchBridge på `window.fetch`. Idempotent — gjentatte kall
 * er trygge.
 *
 * Returnerer uninstall-funksjon for tester / hot-reload.
 */
export function installFetchBridge(): () => void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return () => {};
  }
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[INSTALLED_KEY] === true || installed) {
    return () => {};
  }
  if (!isEnabled()) return () => {};

  const original: typeof window.fetch = window.fetch.bind(window);

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = methodOf(input, init);
    const correlationId = `rest-fetch-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const startedAt = (typeof performance !== "undefined" && performance.now)
      ? performance.now()
      : Date.now();

    try {
      getEventTracker().track(
        "rest.fetch",
        { phase: "request", method, url },
        { correlationId },
      );
    } catch {
      /* tracker er best-effort */
    }

    const promise = original(input as RequestInfo, init);
    return promise.then(
      (response) => {
        const elapsedMs = Math.round(
          ((typeof performance !== "undefined" && performance.now)
            ? performance.now()
            : Date.now()) - startedAt,
        );
        try {
          getEventTracker().track(
            "rest.fetch",
            {
              phase: "response",
              method,
              url,
              status: response.status,
              ok: response.ok,
              elapsedMs,
            },
            { correlationId },
          );
        } catch {
          /* best-effort */
        }
        return response;
      },
      (err) => {
        const elapsedMs = Math.round(
          ((typeof performance !== "undefined" && performance.now)
            ? performance.now()
            : Date.now()) - startedAt,
        );
        try {
          getEventTracker().track(
            "rest.fetch",
            {
              phase: "error",
              method,
              url,
              elapsedMs,
              message: String((err as Error)?.message ?? err),
            },
            { correlationId },
          );
        } catch {
          /* best-effort */
        }
        throw err;
      },
    );
  }) as typeof window.fetch;

  w[INSTALLED_KEY] = true;
  installed = true;

  return () => {
    window.fetch = original;
    w[INSTALLED_KEY] = undefined;
    installed = false;
  };
}
