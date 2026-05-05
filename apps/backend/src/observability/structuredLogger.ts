/**
 * Structured logger med error-code-context (Fase 2A — Tobias-direktiv 2026-05-05).
 *
 * Tynt lag på toppen av eksisterende `util/logger.ts` (pino + ALS-trace-context
 * fra MED-1) som tilfører:
 *   - `errorCode`-felt med automatisk metadata-merge (severity, category, runbook).
 *   - Side-effekt: incrementer error-counter brukt av admin-endpoint.
 *   - Side-effekt: addBreadcrumb til Sentry så error-code også vises der.
 *
 * Hvorfor ikke bare bruke logger.error direkte?
 *   `logger.error({ errorCode: "BIN-RKT-001" }, "tick failed")` mangler
 *   metadata. Hver call-site måtte kalt `lookupErrorCode` + repetere severity
 *   /category. Dette wrapper-laget gir DRY metadata + counter-increment i én
 *   call.
 *
 * Backwards-kompatibilitet:
 *   Eksisterende `logger.warn(...)`-call sites er IKKE påvirket. Wrapperen er
 *   strengt opt-in. Migrasjonen i Fase 2A flytter kun et utvalg av Spill 2/3-
 *   call-sites (PoC); resten kommer i Fase 2B-audit.
 *
 * Eksempel:
 *
 *   ```ts
 *   import { logError } from "../observability/structuredLogger.js";
 *
 *   try {
 *     await engine.drawNextNumber({ roomCode, actorPlayerId });
 *   } catch (err) {
 *     logError(
 *       {
 *         errorCode: "BIN-RKT-002",
 *         module: "Game2AutoDrawTickService",
 *         roomCode,
 *         drawIndex: snapshot.currentGame?.drawnNumbers.length,
 *       },
 *       "tick failed — engine.drawNextNumber threw",
 *       err,
 *     );
 *   }
 *   ```
 *
 * Output (JSON):
 *   ```json
 *   {
 *     "level": "error",
 *     "time": "2026-05-05T10:30:00.000Z",
 *     "msg": "tick failed — engine.drawNextNumber threw",
 *     "errorCode": "BIN-RKT-002",
 *     "severity": "HIGH",
 *     "category": "external-error",
 *     "runbook": "docs/runbooks/BIN-RKT-002.md",
 *     "module": "Game2AutoDrawTickService",
 *     "roomCode": "ROCKET-1",
 *     "drawIndex": 7,
 *     "traceId": "uuid-from-ALS",
 *     "err": { "name": "Error", "message": "...", "stack": "..." }
 *   }
 *   ```
 *
 * Trace-ID:
 *   `traceId` injectes automatisk via `logger.mixin()` (MED-1) fra ALS-context.
 *   Vi trenger ikke å threading den manuelt — så lenge calleren er inne i
 *   `runWithTraceContext(...)`-scope (HTTP-middleware / socket-middleware
 *   som vi har i index.ts).
 */

import { logger as rootLogger, type Logger } from "../util/logger.js";
import {
  ERROR_CODES,
  lookupErrorCode,
  type ErrorCode,
  type ErrorCodeMetadata,
} from "./errorCodes.js";
import { incrementErrorCounter } from "./errorMetrics.js";
import { addBreadcrumb, captureError } from "./sentry.js";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Strukturert logging-context. `traceId` injectes automatisk fra ALS — IKKE
 * sett den her (med mindre du logger på vegne av en annen request).
 *
 * `module` er påkrevd så ops-dashboards kan filtrere per service. Anbefalt
 * verdi er klassenavnet (`"Game2AutoDrawTickService"`) eller fil-stub
 * (`"perpetual-round"`).
 *
 * `errorCode` er optional — hvis satt slår vi opp metadata og merger inn
 * `severity`/`category`/`runbook`. Hvis ikke satt logges som "uncategorized".
 *
 * Alle andre felt er valgfri kontekst. Strukturen er åpen (`unknown`) for å
 * tillate domene-spesifikk metadata uten å trenge type-extensions.
 */
export interface StructuredLogContext {
  /** Modul-identifier — påkrevd. Brukes til filter i log-aggregator. */
  module: string;
  /** Optional error-code-key fra registry (compile-time-validert). */
  errorCode?: ErrorCode;
  /** Game-domene-felt (samme navn som engine bruker). */
  roomCode?: string;
  playerId?: string;
  hostPlayerId?: string;
  gameSlug?: string;
  gameId?: string;
  drawIndex?: number;
  /** Performance-felt — wall-clock duration på operasjonen. */
  durationMs?: number;
  /** Hall-domene. */
  hallId?: string;
  /** Wallet-domene (hashed for PII-safety i log-aggregator). */
  walletIdHash?: string;
  /** Free-form ekstra-felter. Brukes når domenet trenger one-off context. */
  [key: string]: unknown;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Bygger merge-objektet som sendes til pino. Slår opp error-code-metadata og
 * legger til `severity`/`category`/`runbook` slik at log-aggregator kan filter
 * uten å manuelt joine mot registry.
 */
function buildLogPayload(ctx: StructuredLogContext): Record<string, unknown> {
  const meta: ErrorCodeMetadata | undefined = ctx.errorCode
    ? ERROR_CODES[ctx.errorCode]
    : undefined;

  // Ekstrahér errorCode fra ctx — vi vil legge den eksplisitt etter metadata
  // så den ikke skygges av metadata-felt med samme navn.
  const { errorCode, ...rest } = ctx;

  if (!meta) {
    return errorCode
      ? { ...rest, errorCode, severity: "UNKNOWN", category: "uncategorized" }
      : { ...rest };
  }

  return {
    ...rest,
    errorCode,
    severity: meta.severity,
    category: meta.category,
    runbook: meta.runbook,
  };
}

/**
 * Serialiserer Error til en pino-vennlig payload. Pino sin egen serializer
 * gjør dette automatisk for `err`-property, men vi gjør det eksplisitt her
 * så vi alltid får {name, message, stack, code} uavhengig av pino-konfigen
 * i testmiljø (der serializers kan være avskrudd).
 */
function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      // Domain-error-code er separat fra error-code-registry. Tar med begge.
      code: (err as Error & { code?: string }).code,
    };
  }
  // Non-Error thrown values (string, object) — wrap defensively.
  return { message: String(err) };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Logg en error med structured-context. Side-effekter:
 *   1. pino emit error-line med metadata.
 *   2. Increment error-counter (admin-endpoint kan rapportere rate).
 *   3. Sentry-breadcrumb (hvis Sentry er enabled).
 *   4. Sentry capture-exception når severity er CRITICAL eller HIGH.
 *
 * Kalleren trenger ikke håndtere null-err — pass på `undefined` om operasjonen
 * ikke ga en concrete Error (f.eks. logging på recovery-event). Severity og
 * Sentry-capture trigger likevel basert på error-code-metadata.
 */
export function logError(
  ctx: StructuredLogContext,
  message: string,
  err?: unknown,
): void {
  const payload = buildLogPayload(ctx);
  const errPayload = serializeError(err);
  const fullPayload = errPayload ? { ...payload, err: errPayload } : payload;

  rootLogger.error(fullPayload, message);

  if (ctx.errorCode) {
    incrementErrorCounter(ctx.errorCode);

    // Defensive lookup: errorCode kan være en string som ikke er i registry
    // (typisk migrasjon-bug eller ekstern source). Vi logger likevel — bare
    // skipper Sentry-capture og bruker null-defaults for breadcrumb.
    const meta = (ERROR_CODES as Record<string, { severity: string; category: string }>)[ctx.errorCode];

    addBreadcrumb(`error.${ctx.errorCode}`, {
      module: ctx.module,
      roomCode: ctx.roomCode,
      severity: meta?.severity ?? "UNKNOWN",
    }, "error");

    // CRITICAL/HIGH severity skal også til Sentry. MEDIUM/LOW + UNKNOWN bare
    // counter + breadcrumb — ellers drukner vi Sentry i game-logic-events
    // som ikke er alvorlige nok til paging.
    if (meta && (meta.severity === "CRITICAL" || meta.severity === "HIGH")) {
      captureError(err ?? new Error(`[${ctx.errorCode}] ${message}`), {
        errorCode: ctx.errorCode,
        severity: meta.severity,
        category: meta.category,
        module: ctx.module,
        roomCode: ctx.roomCode,
      });
    }
  }
}

/**
 * Logg en warn med structured-context. Brukes for forventede edge-cases
 * (race-conditions, recovery-events) som vi vil måle men ikke alerte på.
 *
 * Side-effekter (subset av logError):
 *   1. pino emit warn-line med metadata.
 *   2. Increment error-counter.
 *   3. Sentry-breadcrumb.
 *
 * Sentry capture-exception kjøres IKKE — warn er for events vi forventer.
 */
export function logWarn(
  ctx: StructuredLogContext,
  message: string,
  err?: unknown,
): void {
  const payload = buildLogPayload(ctx);
  const errPayload = serializeError(err);
  const fullPayload = errPayload ? { ...payload, err: errPayload } : payload;

  rootLogger.warn(fullPayload, message);

  if (ctx.errorCode) {
    incrementErrorCounter(ctx.errorCode);
    // Lookup defensively så ukjent code logger uten å kaste her.
    addBreadcrumb(`warn.${ctx.errorCode}`, {
      module: ctx.module,
      roomCode: ctx.roomCode,
    }, "warning");
  }
}

/**
 * Logg en info-event med structured-context. Brukes til recovery-flows
 * (host-fallback applied, stale-room recovery) der vi vil ha telemetri men
 * eventet i seg selv ikke er en feil.
 *
 * Increment-counter trigges fortsatt fordi recovery-events er nyttig å
 * måle — "hvor ofte skjer host-fallback?" er en helse-indikator.
 */
export function logInfo(
  ctx: StructuredLogContext,
  message: string,
): void {
  const payload = buildLogPayload(ctx);
  rootLogger.info(payload, message);

  if (ctx.errorCode) {
    incrementErrorCounter(ctx.errorCode);
  }
}

/**
 * Logg debug-event med structured-context. For diagnostisk telemetri som
 * bare interesserer ops/utviklere ved aktiv feilsøking. Counter trigges
 * IKKE for debug — vi vil ikke at LOG_LEVEL-bytte skal endre rate-tall.
 */
export function logDebug(
  ctx: StructuredLogContext,
  message: string,
): void {
  const payload = buildLogPayload(ctx);
  rootLogger.debug(payload, message);
}

/**
 * Lag en pino child-logger med fast `module`-felt. Brukes når en service vil
 * ha alle log-lines auto-tagget med modul. Returnerer pino-loggeren direkte
 * (ikke wrapper) så eksisterende `log.info(...)`-API fortsatt fungerer.
 *
 * Kombiner gjerne med `logError(...)` for error-paths — child-loggeren er
 * for happy-path-info, structured-helpers er for error/warn med error-code.
 */
export function createModuleLogger(module: string): Logger {
  return rootLogger.child({ module });
}
