/**
 * Pilot Q3 2026 (PR #1116, 2026-05-09): generic retry-helper med
 * exponential backoff for transient operasjoner.
 *
 * Designet for `MasterActionService` sin bridge-spawn-flyt der vi vil tåle
 * en flaky DB-glitch eller race-condition uten å eskalere til
 * `BRIDGE_FAILED`-state. Retry-policyen er bevisst kort (tre forsøk, totalt
 * ~2.6 s worst-case backoff) — vi vil hverken blokkere master-konsollet for
 * lenge eller mistenke et reelt strukturelt problem.
 *
 * Designvalg:
 *   - **Exponential backoff** med standard ms-tabell `[100, 500, 2000]`
 *     som matcher kravet i task-spec. Caller kan overstyre `delaysMs` for
 *     test-determinisme (sett `[0, 0, 0]` så blir kjøringen instant).
 *   - **shouldRetry**-prediakt — caller bestemmer per error-instans om
 *     retry er trygg. Default-implementasjonen i bruk fra
 *     `MasterActionService` filtrerer bort kjente domain-errors som ikke
 *     blir bedre av retry (`JACKPOT_SETUP_REQUIRED`, `HALL_NOT_IN_GROUP`,
 *     etc.) — disse skal propageres med en gang.
 *   - **Correlation-id** propageres til hver `onRetry`-callback slik at
 *     loggeren kan bygge en sammenhengende trace fra første forsøk til
 *     siste rollback.
 *   - **Fail-closed**: hvis alle forsøk feiler kaster vi den siste error-en
 *     uendret. Caller wrap-er denne i en domain-spesifikk feil
 *     (`BRIDGE_FAILED`-med-rollback, etc.) — retry-helperen forholder seg
 *     ikke til domene-semantikk.
 *
 * Hvorfor en egen helper i stedet for inline-loop?
 *   1. Testbarhet: vi kan unit-teste retry-policyen isolert (deterministisk
 *      via injected delay og fake-clock).
 *   2. Gjenbruk: andre services (eks. wallet-outbox-poller) kan trenge
 *      samme mønster senere uten å duplisere koden.
 *   3. Observability: én plass å hooke inn metrics/tracing senere.
 *
 * @see apps/backend/src/util/__tests__/retry.test.ts
 */

import { logger as rootLogger } from "./logger.js";

const log = rootLogger.child({ module: "retry" });

/**
 * Default backoff-sekvens for bridge-spawn (3 forsøk: 100ms → 500ms →
 * 2000ms = totalt ~2.6 s worst-case). Matcher task-spec eksplisitt.
 */
export const DEFAULT_RETRY_DELAYS_MS: ReadonlyArray<number> = [100, 500, 2000];

export interface RetryOptions<TError = unknown> {
  /**
   * Operasjonsnavn brukt i logging. Må beskrive HVA som retries (eks.
   * `"engine-bridge.spawn"`). Brukes i correlation-trace.
   */
  operationName: string;
  /**
   * ms-delay mellom hvert forsøk. Lengden av arrayet bestemmer maksimalt
   * antall RETRY-er; FØRSTE forsøk teller ikke som retry. Eks.
   * `[100, 500, 2000]` → opptil 4 totale forsøk (1 initial + 3 retries).
   *
   * Default: `DEFAULT_RETRY_DELAYS_MS`.
   *
   * Service-callers bør holde dette under ~3 sekunder totalt for å unngå
   * å blokkere master-konsoll-respons. Tester kan sende `[0, 0, 0]` for å
   * gjøre kjøringen synkron-i-praksis.
   */
  delaysMs?: ReadonlyArray<number>;
  /**
   * Predikat som tar feilen og bestemmer om retry er trygg. Returner
   * `false` for å avbryte med en gang (eks. for `INVALID_INPUT` eller
   * andre permanente feil).
   *
   * Default: alltid `true` — alle feil retries-es. Caller bør oppgi en
   * eksplisitt predikat for å unngå retries på domain-errors som ikke
   * blir bedre av nytt forsøk.
   */
  shouldRetry?: (err: TError, attemptNumber: number) => boolean;
  /**
   * Optional correlation-id propagert til hver `onRetry`-logg-linje. Hvis
   * udefinert genererer vi en intern-id basert på now() + operationName
   * for å sikre traceability.
   */
  correlationId?: string;
  /**
   * Hook kalt FØR hver retry (etter at vi har bekreftet at vi skal
   * prøve igjen). Brukes typisk til strukturert logging eller metrics.
   *
   * `attemptNumber` er 1-basert (1 = første retry, dvs. andre forsøk
   * totalt). `delayMs` er hvor lenge vi venter før neste forsøk.
   */
  onRetry?: (info: {
    operationName: string;
    correlationId: string;
    attemptNumber: number;
    delayMs: number;
    err: TError;
  }) => void;
  /**
   * Klokke-injection for testbarhet. Standard-implementasjonen bruker
   * `setTimeout`. Tester kan sende en mock som umiddelbart resolver.
   */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Resultat av en retry-kjøring. Returneres for å gjøre observerbarhet enkelt
 * for caller (vet om operasjonen lykkes på første forsøk eller etter retries).
 */
export interface RetryResult<T> {
  /** Verdi returnert av siste vellykkede forsøk. */
  value: T;
  /**
   * Antall forsøk gjort totalt (1 = lykkes på første forsøk, 2 = lykkes
   * etter én retry, etc.).
   */
  attempts: number;
  /** Correlation-id brukt under kjøringen (auto-generert hvis ikke gitt). */
  correlationId: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultShouldRetry = <TError>(_err: TError, _attempt: number): boolean =>
  true;

function generateCorrelationId(operationName: string): string {
  // Lett-vekt correlation-id: navn + timestamp + 6-tegn random suffix.
  // Vi bruker IKKE crypto.randomUUID her fordi denne ID-en kun brukes til
  // logging-korrelasjon, ikke som global uniqueness-garanti.
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${operationName}-${ts}-${rand}`;
}

/**
 * Kjør `op` med retry + exponential backoff. Returnerer resultatet av
 * første vellykkede forsøk. Hvis alle forsøk feiler, kastes siste feil
 * uendret — caller wrap-er videre i domene-spesifikk feil-shape.
 *
 * Algoritme:
 *   1. Forsøk 1 (umiddelbart).
 *   2. Hvis feil OG `shouldRetry(err, 1)` → vent `delaysMs[0]` ms.
 *   3. Forsøk 2.
 *   4. Hvis feil OG `shouldRetry(err, 2)` → vent `delaysMs[1]` ms.
 *   5. Forsøk 3.
 *   6. Hvis feil OG `shouldRetry(err, 3)` → vent `delaysMs[2]` ms.
 *   7. Forsøk 4 (siste forsøk).
 *   8. Hvis feil → kast.
 *
 * Default `delaysMs` = `[100, 500, 2000]` → opptil 4 forsøk totalt.
 */
export async function withRetry<T, TError = unknown>(
  op: () => Promise<T>,
  options: RetryOptions<TError>,
): Promise<RetryResult<T>> {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const correlationId =
    options.correlationId ?? generateCorrelationId(options.operationName);
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  // We may attempt up to (delays.length + 1) times: 1 initial + N retries.
  const maxAttempts = delays.length + 1;

  // The outer loop is just for clarity; we exit either via successful return
  // or by re-throwing the last error after exhausting retries.
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const value = await op();
      if (attempt > 1) {
        log.info(
          {
            operationName: options.operationName,
            correlationId,
            attempts: attempt,
          },
          "[retry] operation succeeded after retries",
        );
      }
      return { value, attempts: attempt, correlationId };
    } catch (err) {
      const isLastAttempt = attempt >= maxAttempts;
      const retrySafe = shouldRetry(err as TError, attempt);

      if (isLastAttempt || !retrySafe) {
        log.warn(
          {
            err,
            operationName: options.operationName,
            correlationId,
            attemptNumber: attempt,
            maxAttempts,
            reason: isLastAttempt ? "max-attempts-reached" : "shouldRetry=false",
          },
          "[retry] operation failed permanently",
        );
        throw err;
      }

      // We will retry: pick the next delay from the table and notify caller.
      // attempt is 1-based so delays[attempt - 1] is the wait before retry #attempt.
      const delayMs = delays[attempt - 1] ?? 0;
      log.warn(
        {
          err,
          operationName: options.operationName,
          correlationId,
          attemptNumber: attempt,
          nextDelayMs: delayMs,
        },
        "[retry] operation failed, retrying with backoff",
      );
      if (options.onRetry) {
        try {
          options.onRetry({
            operationName: options.operationName,
            correlationId,
            attemptNumber: attempt,
            delayMs,
            err: err as TError,
          });
        } catch (hookErr) {
          // Hook-failure must never block the retry path itself.
          log.warn(
            { err: hookErr, operationName: options.operationName, correlationId },
            "[retry] onRetry hook threw — ignoring",
          );
        }
      }
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      // Loop to next attempt.
    }
  }

  // Unreachable: the loop either returns or throws inside.
  throw new Error(
    `withRetry exhausted all attempts without resolution (${options.operationName})`,
  );
}
