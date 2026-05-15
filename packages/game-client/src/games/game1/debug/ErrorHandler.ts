/**
 * ErrorHandler — capture window.onerror + unhandledrejection og
 * route til EventTracker (Tobias-direktiv 2026-05-13).
 *
 * Bakgrunn:
 *   "vi må nå bygge slik at test agenten får alt av mulig tilgjengelig
 *   informasjon" — Tobias 2026-05-13.
 *
 *   Tobias har ved flere anledninger sagt "Det går rødt i konsollen, men
 *   jeg vet ikke hvorfor". Live-monitor må kunne SE samme stack-traces
 *   som Tobias.
 *
 * Mekanisme:
 *   - `window.addEventListener("error", ...)` — runtime-throws
 *   - `window.addEventListener("unhandledrejection", ...)` — Promise.reject
 *     uten .catch
 *   - Begge route til `getEventTracker().track("error.client", {...})`
 *
 * Designvalg:
 *   - Listener-pattern (ikke override) — vi kommer i tillegg til devtools,
 *     ikke i stedet for. Console.error fra browser-en kjører fortsatt.
 *   - Idempotent — re-kall er trygt.
 *   - Best-effort — feiler aldri stille opp i app-koden.
 *
 * Personvern:
 *   - Stack-trace logges ÅPENT (regnet som debug-info, ikke PII)
 *   - Error-message logges ÅPENT
 *   - Hvis error har `[REDACTED-fields]` i string, beholder vi det som-er
 */

import { getEventTracker } from "./EventTracker.js";

const ERROR_HANDLER_KEY = "__spilloramaErrorHandlerInstalled";

let errorListener: ((event: ErrorEvent) => void) | null = null;
let rejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;
let installed = false;

/**
 * Installer error- og rejection-handlers. Idempotent. Returnerer uninstall.
 *
 * Gate på `?debug=full` (Tobias-direktiv 2026-05-15) så vi ikke har overhead
 * i prod og full spillopplevelse er default. Defense-in-depth — kalles
 * uansett kun fra mountDebugHud som har samme gate.
 */
export function installErrorHandler(): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[ERROR_HANDLER_KEY] === true || installed) {
    return () => {};
  }

  const enabled = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("debug") === "full";
    } catch {
      return false;
    }
  })();
  if (!enabled) return () => {};

  errorListener = (event: ErrorEvent) => {
    try {
      const tracker = getEventTracker();
      const error = event.error;
      tracker.track("error.client", {
        kind: "runtime-error",
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack:
          error instanceof Error
            ? (error.stack ?? "(no-stack)").slice(0, 4000)
            : "(no-error-object)",
        errorName: error instanceof Error ? error.name : "(unknown)",
      });
    } catch {
      /* fail-soft — vi skal aldri felle app pga error-handler */
    }
  };

  rejectionListener = (event: PromiseRejectionEvent) => {
    try {
      const tracker = getEventTracker();
      const reason = event.reason;
      const isError = reason instanceof Error;
      tracker.track("error.client", {
        kind: "unhandled-rejection",
        message: isError ? reason.message : String(reason),
        stack: isError ? (reason.stack ?? "(no-stack)").slice(0, 4000) : "(no-stack)",
        errorName: isError ? reason.name : "(non-error-rejection)",
      });
    } catch {
      /* fail-soft */
    }
  };

  window.addEventListener("error", errorListener);
  window.addEventListener("unhandledrejection", rejectionListener);
  w[ERROR_HANDLER_KEY] = true;
  installed = true;

  return () => {
    if (errorListener) {
      window.removeEventListener("error", errorListener);
      errorListener = null;
    }
    if (rejectionListener) {
      window.removeEventListener("unhandledrejection", rejectionListener);
      rejectionListener = null;
    }
    w[ERROR_HANDLER_KEY] = undefined;
    installed = false;
  };
}
