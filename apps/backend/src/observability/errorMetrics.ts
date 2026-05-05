/**
 * Error-metrics counter (Fase 2A — Tobias-direktiv 2026-05-05).
 *
 * In-memory counter per error-code som driver:
 *   - admin-endpoint `GET /api/admin/observability/error-rates`
 *   - dashboard-charts (rate per minutt, p95-resolution-tid)
 *   - alerter (rate-threshold matchet mot ERROR_CODES[code].alertRule)
 *
 * Hvorfor in-memory og ikke Prometheus/StatsD?
 *   Pilot-skala (24 haller, 36k WebSocket) klarer in-memory-counter med god
 *   margin (16-byte counter-value × ~25 codes × 24 haller = trivielt minne).
 *   Hvis pilot lykkes og vi går prod-skala (hundrevis av haller) bytter vi
 *   til Prometheus-exporter — interface holdes stabilt så call-sites ikke
 *   trenger endring.
 *
 * Bucket-strategi:
 *   Vi holder to vinduer:
 *     - "lifetime"   total siden process-start (for diagnostikk)
 *     - "lastMinute" rolling 60s sliding-window (for rate-alerts)
 *
 *   Sliding-window er implementert med 60×1s-bucket-array. Hver bucket har
 *   en timestamp + count. Når et minute har gått kalles `pruneOldBuckets`
 *   som dropper buckets > 60s gamle. Aggregat (`getErrorRates`) summerer
 *   alle buckets i vinduet og deler på 60 for per-sekund-rate.
 *
 * Multi-process-warning:
 *   Hvis vi senere kjører flere Node-processer (cluster mode) er counter-en
 *   per-process — admin-endpoint vil rapportere kun lokal process. Da må vi
 *   bytte til Redis-counter eller fan-out til Prometheus. Pilot kjører single-
 *   process per Render-instans, så dette er OK p.t.
 */

import type { ErrorCode } from "./errorCodes.js";
import { ERROR_CODES } from "./errorCodes.js";

// ── Internal state ──────────────────────────────────────────────────────────

/**
 * Per-bucket count. Bucket-id er Math.floor(timestamp / 1000) → én bucket
 * per sekund. Det gir oss 60 buckets i et 60s sliding-window.
 */
interface CountBucket {
  /** Sekund-timestamp (Math.floor(Date.now() / 1000)). */
  readonly secondId: number;
  /** Antall events i denne bucket-en. Mutert ved hvert increment. */
  count: number;
}

/**
 * Per-error-code state. Vi holder:
 *   - `lifetime`: total siden process-start.
 *   - `buckets`: array av siste 60 bucket-er, sortert eldst → nyest.
 *   - `lastSeenAt`: Date for sist increment (for diagnostikk-display).
 */
interface ErrorCounterState {
  lifetime: number;
  buckets: CountBucket[];
  lastSeenAt: Date | null;
}

const counters = new Map<string, ErrorCounterState>();

/**
 * Window-størrelse i sekunder for rate-aggregat. 60s = "rate per minutt".
 * Holdes som konstant så testene kan oppgi en kjent verdi.
 */
const WINDOW_SECONDS = 60;

/**
 * Pruner buckets i `state.buckets` som er > WINDOW_SECONDS gamle. Kalles ved
 * hvert increment OG ved hvert read (`getErrorRates`) så stale buckets aldri
 * akkumulerer.
 */
function pruneOldBuckets(state: ErrorCounterState, nowSec: number): void {
  const cutoff = nowSec - WINDOW_SECONDS;
  while (state.buckets.length > 0 && state.buckets[0].secondId <= cutoff) {
    state.buckets.shift();
  }
}

/**
 * Initialiserer state for en code som ikke har vært sett før. Skiller seg
 * fra `Map.get → null check + new`-mønsteret med å returnere en stable
 * referanse vi kan mutere.
 */
function getOrCreateState(code: string): ErrorCounterState {
  let state = counters.get(code);
  if (!state) {
    state = {
      lifetime: 0,
      buckets: [],
      lastSeenAt: null,
    };
    counters.set(code, state);
  }
  return state;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Increment counter for én error-code. Tygger en bucket per sekund så
 * sliding-window er presist på sekund-nivå (godt nok for rate-alerts;
 * tighter resolution gir kun marginale gevinster og 4× mer minne).
 *
 * Aksepterer `string` (ikke bare `ErrorCode`) for at runtime-input fra
 * eksterne kilder (database-replay, importert log) skal kunne incrementes
 * uten compile-time-typing.
 */
export function incrementErrorCounter(code: ErrorCode | string): void {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const state = getOrCreateState(code);

  pruneOldBuckets(state, nowSec);

  // Gjenbruk siste bucket hvis den er for samme sekund.
  const lastBucket = state.buckets[state.buckets.length - 1];
  if (lastBucket && lastBucket.secondId === nowSec) {
    lastBucket.count += 1;
  } else {
    state.buckets.push({ secondId: nowSec, count: 1 });
  }

  state.lifetime += 1;
  state.lastSeenAt = new Date(now);
}

/**
 * Snapshot av rate-tall for én eller alle error-codes. Brukes av admin-
 * endpoint og av tester.
 *
 * `perMinute` = sum av siste 60 bucket-counter. Approx-tall siden vinduet
 * glir kontinuerlig — to opphentinger 30s fra hverandre kan gi forskjellige
 * tall selv om ingen nye events skjedde, fordi gamle bucketspruner ut.
 */
export interface ErrorRateSnapshot {
  /** Error-code (string for at unknown koder også kan rapporteres). */
  readonly code: string;
  /** Total siden process-start. */
  readonly lifetime: number;
  /** Antall events i siste 60s sliding window. */
  readonly perMinute: number;
  /** Siste-sett-timestamp, eller null hvis aldri sett. */
  readonly lastSeenAt: Date | null;
  /** Severity fra registry, eller "UNKNOWN" hvis koden ikke er kjent. */
  readonly severity: string;
  /** Category fra registry, eller "uncategorized" for ukjente koder. */
  readonly category: string;
}

/**
 * Returner rate-snapshot for alle counters som har vært incremented siden
 * process-start, sortert etter `lifetime` desc. Inkluderer også koder fra
 * registry som aldri har vært trigget — slik at dashboard kan vise "0/min"
 * for hver kode i stedet for å skjule den.
 *
 * `includeZero=false` (default): kun koder med lifetime > 0.
 * `includeZero=true`: alle koder fra registry + alle ukjente koder seen.
 */
export function getErrorRates(includeZero = false): ErrorRateSnapshot[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const result: ErrorRateSnapshot[] = [];

  // Først alle counters som har sett events (kan inkludere ukjente koder).
  for (const [code, state] of counters.entries()) {
    pruneOldBuckets(state, nowSec);
    const perMinute = state.buckets.reduce((sum, b) => sum + b.count, 0);

    if (!includeZero && state.lifetime === 0) continue;

    const meta = (ERROR_CODES as Record<string, { severity: string; category: string }>)[code];
    result.push({
      code,
      lifetime: state.lifetime,
      perMinute,
      lastSeenAt: state.lastSeenAt,
      severity: meta?.severity ?? "UNKNOWN",
      category: meta?.category ?? "uncategorized",
    });
  }

  // Hvis includeZero — fyll inn registry-koder som ikke har en counter ennå.
  if (includeZero) {
    for (const code of Object.keys(ERROR_CODES)) {
      if (counters.has(code)) continue;
      const meta = ERROR_CODES[code as ErrorCode];
      result.push({
        code,
        lifetime: 0,
        perMinute: 0,
        lastSeenAt: null,
        severity: meta.severity,
        category: meta.category,
      });
    }
  }

  // Sort: lifetime desc, så code alfabetisk for deterministisk rendering.
  result.sort((a, b) => {
    if (b.lifetime !== a.lifetime) return b.lifetime - a.lifetime;
    return a.code.localeCompare(b.code);
  });

  return result;
}

/**
 * Hent rate-snapshot for én spesifikk code. Returnerer `null` hvis koden
 * aldri har vært seen og ikke er i registry.
 */
export function getErrorRate(code: string): ErrorRateSnapshot | null {
  const state = counters.get(code);
  const meta = (ERROR_CODES as Record<string, { severity: string; category: string }>)[code];

  if (!state && !meta) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (state) pruneOldBuckets(state, nowSec);

  return {
    code,
    lifetime: state?.lifetime ?? 0,
    perMinute: state?.buckets.reduce((sum, b) => sum + b.count, 0) ?? 0,
    lastSeenAt: state?.lastSeenAt ?? null,
    severity: meta?.severity ?? "UNKNOWN",
    category: meta?.category ?? "uncategorized",
  };
}

/**
 * Reset alle counters. Brukes KUN i tests — production-kode skal aldri
 * kalle denne. Eksportert for at unit-tester ikke skal lekke state mellom
 * suites.
 */
export function __resetCountersForTests(): void {
  counters.clear();
}
