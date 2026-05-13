/**
 * OBS-7 (2026-05-14): Postgres pool-instrumentation for Sentry-tracing.
 *
 * Wrappes hver `pool.query()`-kall i en Sentry-span (`db.sql.query`) slik at
 * vi i Sentry Performance-tab kan se:
 *   - Hvilke queries kjører per HTTP-request / per master-action
 *   - Slow-query-paths (`mean_exec_time > 100ms` per query)
 *   - N+1-mønstre (10× samme query i én request)
 *   - DB-vs-CPU-balanse innenfor hver trace
 *
 * Dette komplementerer:
 *   - pg_stat_statements (aggregated stats over tid — bruk for finding the
 *     top-N slow queries)
 *   - pgPoolMetrics (pool-saturation gauges — bruk for connection-pool-helse)
 *   - PgHero (UI rundt pg_stat_statements + index-suggesions)
 *
 * Hvorfor ikke @sentry/integrations sin Postgres-integration?
 *   @sentry/node v10 har ikke en first-class pg-integration, men exposer
 *   `startSpan`/`startInactiveSpan` API. Vi gjør manuell wrapping fordi:
 *     1. Vi har KUN to pools (shared + wallet) — minimal wrap-overhead.
 *     2. Vi kontrollerer span-attrs presist (db.system, db.statement,
 *        db.operation) per OpenTelemetry semantic-conventions.
 *     3. Wrap er en no-op når Sentry ikke er init-ed (SENTRY_DSN unset).
 *
 * Idempotens:
 *   `instrumentPgPool()` setter en flagg på pool-instansen (`__sentryWrapped`)
 *   slik at re-kall er gratis. Tester kan dermed kalle den uten å bygge opp
 *   et lag med wraps.
 *
 * Sample-rate:
 *   Spans-en respekterer Sentry sin `tracesSampleRate`. På 0.1 (prod-default)
 *   betyr det at ~10 % av queries får full span; resten teller kun mot
 *   pg_stat_statements / pgPoolMetrics. Det er bra — vi unngår å spamme
 *   Sentry-quota med trivielle wallet-debit-queries.
 *
 * PII-håndtering:
 *   `db.statement` settes til SQL-tekst som inneholder parametre kun hvis
 *   parametrene IKKE inneholder PII. Default er at vi bare logger
 *   normalized template (`SELECT * FROM users WHERE id = $1`) — IKKE
 *   verdiene `$1`. Pg.Pool-query API gir oss både template og verdier;
 *   vi velger template-only.
 */

import type { Pool } from "pg";

// ── Lazy Sentry-import ──────────────────────────────────────────────────────
// Vi kan ikke statisk importere `@sentry/node` her fordi den blir lazy-loadet
// i `sentry.ts` (kun når SENTRY_DSN er satt). Hvis modulen ikke er lastet,
// no-op-er vi span-wrapping helt. `dynamicSentry` populates ved første kall.

type SentryStartSpan = <T>(
  ctx: { name: string; op: string; attributes?: Record<string, unknown> },
  cb: () => T,
) => T;

let cachedStartSpan: SentryStartSpan | null = null;
let cacheAttempted = false;

async function getSentryStartSpan(): Promise<SentryStartSpan | null> {
  if (cachedStartSpan) return cachedStartSpan;
  if (cacheAttempted) return null;
  cacheAttempted = true;
  try {
    // Dynamic import: kun lastet hvis Sentry-modulen er på CRP.
    // Hvis `@sentry/node` ikke er installert (dev uten DSN), returner null.
    const mod = (await import("@sentry/node").catch(() => null)) as
      | { startSpan?: SentryStartSpan }
      | null;
    if (mod && typeof mod.startSpan === "function") {
      cachedStartSpan = mod.startSpan;
      return cachedStartSpan;
    }
  } catch {
    // Best-effort; aldri kast videre fra instrumentering.
  }
  return null;
}

// ── Pool-wrap-marker ────────────────────────────────────────────────────────
// Marker på pool-instansen så `instrumentPgPool()` blir idempotent.
// Symbol unngår navnekollisjon med pg-internals.
const WRAPPED_MARKER = Symbol.for("spillorama.dbInstrumentation.wrapped");

type WrappablePool = Pool & {
  [WRAPPED_MARKER]?: boolean;
};

// ── Span-builder ─────────────────────────────────────────────────────────────

/**
 * Trim SQL til en kort, lesbar span-navn. Vi vil ha noe som "SELECT app_users"
 * eller "INSERT app_wallet_entries" — ikke hele JOIN-eksperter.
 *
 * Heuristikk:
 *   - Plukk ut første ord (SELECT/INSERT/UPDATE/DELETE/BEGIN/COMMIT/...)
 *   - Hvis SELECT: prøv å finne tabellen etter `FROM`
 *   - Hvis INSERT/UPDATE/DELETE: tabellen kommer rett etter verbet
 *   - Cap til 60 chars
 *
 * Eksempler:
 *   "SELECT id FROM app_users WHERE email=$1"        → "SELECT app_users"
 *   "INSERT INTO app_wallet_entries (...) VALUES..."  → "INSERT app_wallet_entries"
 *   "WITH cte AS (...) SELECT ... FROM x JOIN y ..."  → "WITH cte..."
 */
function buildSpanName(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) return "pg.query";

  const first = trimmed.split(/\s+/, 1)[0]?.toUpperCase() ?? "QUERY";
  // SELECT-tabellen er etter `FROM <ident>`
  if (first === "SELECT") {
    const m = /from\s+([a-zA-Z0-9_."]+)/i.exec(trimmed);
    if (m) return `SELECT ${stripQuotes(m[1])}`.slice(0, 60);
  }
  // INSERT INTO <table> (...) VALUES ...
  if (first === "INSERT") {
    const m = /into\s+([a-zA-Z0-9_."]+)/i.exec(trimmed);
    if (m) return `INSERT ${stripQuotes(m[1])}`.slice(0, 60);
  }
  // UPDATE <table> SET ...
  if (first === "UPDATE") {
    const m = /update\s+([a-zA-Z0-9_."]+)/i.exec(trimmed);
    if (m) return `UPDATE ${stripQuotes(m[1])}`.slice(0, 60);
  }
  // DELETE FROM <table>
  if (first === "DELETE") {
    const m = /from\s+([a-zA-Z0-9_."]+)/i.exec(trimmed);
    if (m) return `DELETE ${stripQuotes(m[1])}`.slice(0, 60);
  }
  // Fallback: bare første 60 tegn med whitespace flattened.
  return trimmed.replace(/\s+/g, " ").slice(0, 60);
}

function stripQuotes(ident: string): string {
  return ident.replace(/^"(.*)"$/, "$1");
}

/**
 * Hent SQL-tekst fra `pool.query`-argumentet. node-pg støtter:
 *   pool.query("SELECT ...")
 *   pool.query("SELECT ... WHERE x = $1", [value])
 *   pool.query({ text: "SELECT ...", values: [...] })
 *   pool.query({ name: "prepared-name", text: "...", values: [...] })
 *
 * Vi bryr oss kun om `text` — verdiene logger vi aldri (PII).
 */
function extractSqlText(args: unknown[]): string {
  if (args.length === 0) return "";
  const first = args[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object") {
    const obj = first as { text?: unknown };
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Wrap en `pg.Pool`-instans med Sentry-span-tracking rundt hver `query()`.
 *
 * Idempotent — andre gang kallet ignoreres (sjekker `WRAPPED_MARKER`).
 *
 * Wrappes:
 *   - `pool.query()` (Pool-nivå, mest brukte path i koden vår)
 *
 * Wrappes IKKE (foreløpig):
 *   - `pool.connect()` + per-client `client.query()` — disse brukes mest av
 *     wallet-adapter for REPEATABLE READ-transaksjoner. Hver transaksjon er
 *     allerede én logisk operasjon i call-graf; å spanne hver intra-tx-query
 *     ville produsere mye støy. Vi får disse via pg_stat_statements i
 *     stedet.
 *
 * Sentry no-op:
 *   Hvis `@sentry/node` ikke er importert (dev uten DSN), wrapper vi
 *   `query` med en pass-through — ingen span, ingen latency-overhead.
 *
 * Returverdi:
 *   `true` hvis pool ble wrappet (eller allerede var det); `false` hvis
 *   pool-en ikke er en valid pg.Pool.
 */
export function instrumentPgPool(pool: Pool): boolean {
  const wrappable = pool as WrappablePool;
  if (wrappable[WRAPPED_MARKER] === true) {
    return true; // allerede wrappet
  }
  if (typeof pool.query !== "function") {
    return false;
  }

  const originalQuery = pool.query.bind(pool) as (
    ...args: unknown[]
  ) => Promise<unknown>;

  // Replace pool.query med wrapper. TypeScript-cast for å unngå overload-hell;
  // node-pg sin `query()` har 6+ overloads og vi propagerer args 1:1.
  (pool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = function (
    ...args: unknown[]
  ): Promise<unknown> {
    const sql = extractSqlText(args);
    // Hvis vi ikke kan finne SQL-teksten (sjelden), bare propager raw.
    if (!sql) return originalQuery(...args);

    const spanName = buildSpanName(sql);

    // Synkron path: ingen Sentry tilgjengelig → ren pass-through.
    if (!cachedStartSpan && cacheAttempted) {
      return originalQuery(...args);
    }

    // Async path: prøv å laste Sentry, deretter wrap. Hvis loading feiler,
    // fall tilbake til pass-through.
    return (async () => {
      const startSpan = await getSentryStartSpan();
      if (!startSpan) return originalQuery(...args);
      return startSpan(
        {
          name: spanName,
          op: "db.sql.query",
          attributes: {
            "db.system": "postgresql",
            "db.statement": sql,
            "db.operation": sql.split(/\s+/, 1)[0]?.toUpperCase() ?? "QUERY",
          },
        },
        () => originalQuery(...args),
      );
    })();
  };

  wrappable[WRAPPED_MARKER] = true;
  return true;
}

/**
 * @internal — test-hook for å resette span-loading state mellom tester.
 */
export function __resetDbInstrumentationForTests(): void {
  cachedStartSpan = null;
  cacheAttempted = false;
}
