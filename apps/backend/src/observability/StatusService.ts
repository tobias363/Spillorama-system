/**
 * BIN-791: Public Status Page service.
 *
 * Aggregerer per-komponent helsestatus for offentlig status-side
 * (`https://spillorama-system.onrender.com/status`). Returnerer simple
 * `operational | degraded | outage`-status som spillere og hall-operatører
 * kan sjekke ved problemer.
 *
 * Designprinsipper:
 *   - Read-only / aggregat-only: ingen mutasjon av source-state.
 *   - In-memory cache 30s for å avlaste backenden hvis status-siden får
 *     mye trafikk (ved en faktisk hendelse vil mange refreshe).
 *   - Fail-open i komponent-sjekkene: hvis selve sjekken kaster, regner
 *     vi komponenten som `outage` og merker med en kort melding. Aldri
 *     kast videre — status-siden må selv være tilgjengelig.
 *   - Pure compute der mulig: `computeOverallStatus` er testbar uten DB.
 *
 * Komponentene som sjekkes:
 *   - api          : Backend-prosessen kjører (alltid `operational` hvis vi
 *                    kan svare overhodet).
 *   - database     : Postgres-pool kan kjøre `SELECT 1`.
 *   - bingo        : Spill 1 — engine eksisterer + kan liste rom.
 *   - rocket       : Spill 2 (60-ball 3×5).
 *   - monsterbingo : Spill 3 (60-ball 5×5).
 *   - spillorama   : SpinnGo (Spill 4 / databingo).
 *   - wallet       : Wallet-adapter kan sjekkes.
 *   - auth         : Auth-token-tjeneste tilgjengelig (wallet+auth-trafikk
 *                    avgjør effektiv tilgjengelighet, så dette er en
 *                    overall `degraded` hvis sjekken feiler).
 *   - admin        : Admin-tjenester tilgjengelig (samme som auth-merking).
 *   - tv           : TV-skjerm-routes (ikke avhengig av auth, men av rom).
 *
 * Hver komponent-sjekk er en port (DI'd hook). Det gir tre fordeler:
 *   1. Unit-testbart uten å starte hele backenden.
 *   2. Hver service kan bruke sin egen helse-implementasjon.
 *   3. Status-page-koden vet ikke om implementasjons-detaljer.
 */

import type { Pool } from "pg";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "status-service" });

// ── Domain types ─────────────────────────────────────────────────────────────

/**
 * Helsestatus per komponent. Mappet 1:1 til UI-fargekoder (grønn/gul/rød).
 *   - `operational`: Komponenten fungerer normalt.
 *   - `degraded`   : Komponenten fungerer, men har advarsler (treg, partial).
 *   - `outage`     : Komponenten er nede.
 */
export type ComponentStatus = "operational" | "degraded" | "outage";

/**
 * Overall systemstatus. Beregnes som:
 *   - Hvis ALLE komponenter er `operational` → `operational`.
 *   - Hvis MINST ÉN er `outage` → `outage`.
 *   - Ellers (én eller flere `degraded`) → `degraded`.
 */
export type OverallStatus = ComponentStatus;

export interface ComponentHealth {
  /** Stabil teknisk identifier — brukes i URL-fragmenter, audit. */
  component: string;
  /** Menneskevennlig navn for UI-tabellen. */
  displayName: string;
  /** Helsestatus. */
  status: ComponentStatus;
  /** Kort beskrivelse hvis status er `degraded`/`outage`. `null` for OK. */
  message: string | null;
  /** Sist sjekket (ISO-8601). Brukes til staleness-indikator i UI. */
  lastCheckedAt: string;
}

export interface StatusSnapshot {
  overall: OverallStatus;
  /** Sist beregnet (ISO). Under cache-vinduet vil flere kall returnere samme. */
  generatedAt: string;
  components: ComponentHealth[];
}

/**
 * Per-komponent uptime-bøtte (én bøtte = ett tidsvindu, default 1 time).
 * UI tegner siste 24 bøtter som en grønn/gul/rød tidslinje.
 */
export interface UptimeBucket {
  /** Bøtte-start (ISO-8601). */
  startsAt: string;
  /** Bøtte-slutt (ISO-8601). */
  endsAt: string;
  /** Verste status observert i bøtta. */
  worstStatus: ComponentStatus;
  /** Antall sjekker registrert i bøtta. */
  sampleCount: number;
}

export interface ComponentUptime {
  component: string;
  displayName: string;
  buckets: UptimeBucket[];
}

// ── Component-check ports ────────────────────────────────────────────────────

/**
 * Hook som returnerer `null` hvis komponenten er OK, ellers en feilmelding
 * for `degraded`. Kast-fra-hooken regnes som `outage`.
 *
 * Hooks SKAL være rask (≤ 1s). Hvis en check kan ta lang tid, bygg den med
 * `Promise.race` mot en timeout og returnér en string-melding.
 */
export type ComponentCheck = () => Promise<{ status: ComponentStatus; message: string | null }>;

export interface StatusServiceDeps {
  /** Postgres-pool. Brukes for db-helsesjekk og uptime-historikk. */
  pool?: Pool;
  /**
   * Per-komponent helsesjekk-hooks. Kallsiden (index.ts) bygger disse
   * basert på sine services. Status-tjenesten vet ikke om
   * implementasjons-detaljer.
   */
  checks: Array<{
    component: string;
    displayName: string;
    check: ComponentCheck;
  }>;
  /** Cache-tid (ms). Default 30 000 (30s). */
  cacheTtlMs?: number;
  /** Klokke (test-injekteres). */
  now?: () => number;
}

const DEFAULT_CACHE_TTL_MS = 30_000;

/**
 * Pure compute — beregn overall fra komponent-sett.
 * Testbar uten DB, uten klokke, uten engine.
 */
export function computeOverallStatus(components: readonly ComponentHealth[]): OverallStatus {
  if (components.length === 0) {
    // Ingen komponenter registrert: regn som outage så vi ikke serverer en
    // misvisende grønn side under feil-konfigurasjon.
    return "outage";
  }
  const hasOutage = components.some((c) => c.status === "outage");
  if (hasOutage) return "outage";
  const hasDegraded = components.some((c) => c.status === "degraded");
  if (hasDegraded) return "degraded";
  return "operational";
}

/**
 * Hjelpe-builder for vanlige komponent-sjekker. Kallsiden trenger ikke huske
 * shape-en på `ComponentCheck`-returverdien.
 */
export function operational(): { status: ComponentStatus; message: string | null } {
  return { status: "operational", message: null };
}

export function degraded(message: string): { status: ComponentStatus; message: string | null } {
  return { status: "degraded", message };
}

export function outage(message: string): { status: ComponentStatus; message: string | null } {
  return { status: "outage", message };
}

// ── Service ──────────────────────────────────────────────────────────────────

interface CachedSnapshot {
  snapshot: StatusSnapshot;
  expiresAtMs: number;
}

export class StatusService {
  private readonly pool?: Pool;
  private readonly checks: ReadonlyArray<{
    component: string;
    displayName: string;
    check: ComponentCheck;
  }>;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cache: CachedSnapshot | null = null;
  /**
   * In-memory ringbuffer av siste sample per komponent. Fylles opp ved hver
   * `getSnapshot`-kall og brukes til 24-timers uptime-grafen. For å holde
   * minne-forbruket lavt kapper vi 24*60 = 1440 samples per komponent
   * (ett kall per minutt × 24 timer er romslig).
   */
  private readonly uptimeHistory: Map<string, Array<{ ts: number; status: ComponentStatus }>>;
  private readonly maxHistoryPerComponent = 1440;

  constructor(deps: StatusServiceDeps) {
    this.pool = deps.pool;
    this.checks = deps.checks;
    this.cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = deps.now ?? (() => Date.now());
    this.uptimeHistory = new Map();
  }

  /**
   * Hovedkall — returnerer cachet status-snapshot eller bygger en ny.
   */
  async getSnapshot(): Promise<StatusSnapshot> {
    const nowMs = this.now();

    if (this.cache && this.cache.expiresAtMs > nowMs) {
      return this.cache.snapshot;
    }

    const snapshot = await this.buildSnapshot(nowMs);
    this.cache = {
      snapshot,
      expiresAtMs: nowMs + this.cacheTtlMs,
    };
    this.recordSamples(snapshot, nowMs);
    return snapshot;
  }

  /**
   * Tving en ny sjekk uten å bruke cache. Brukes når en admin manuelt
   * trigger en re-check (post-incident-cleanup).
   */
  async refresh(): Promise<StatusSnapshot> {
    this.cache = null;
    return this.getSnapshot();
  }

  /**
   * Returnerer per-komponent-uptime fordelt på bøtter for siste `windowMs`.
   * UI viser typisk 24 bøtter à 1 time = siste døgn.
   */
  getUptime(options: { windowMs?: number; bucketMs?: number } = {}): ComponentUptime[] {
    const windowMs = options.windowMs ?? 24 * 60 * 60 * 1000;
    const bucketMs = options.bucketMs ?? 60 * 60 * 1000; // 1h
    const nowMs = this.now();
    const cutoff = nowMs - windowMs;

    const result: ComponentUptime[] = [];
    for (const cfg of this.checks) {
      const samples = this.uptimeHistory.get(cfg.component) ?? [];
      const inWindow = samples.filter((s) => s.ts >= cutoff);

      // Bøtter er aligned slik at SISTE bøtte ender på `nowMs`, ikke
      // `cutoff + N*bucketMs`. Det sikrer at sample-er tatt rett før vi
      // genererte uptime-en lander i siste bøtte uavhengig av om
      // klokken matcher bøtte-grensen eksakt. Begge endpoints inkludert
      // for siste bøtte (inkluderer nowMs).
      const bucketCount = Math.ceil(windowMs / bucketMs);
      const buckets: UptimeBucket[] = [];
      for (let i = 0; i < bucketCount; i++) {
        const endsAt = nowMs - (bucketCount - 1 - i) * bucketMs;
        const startsAt = endsAt - bucketMs;
        const isLastBucket = i === bucketCount - 1;
        const inBucket = inWindow.filter((s) =>
          isLastBucket ? s.ts >= startsAt && s.ts <= endsAt : s.ts >= startsAt && s.ts < endsAt,
        );
        buckets.push({
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          worstStatus: worstStatusOf(inBucket.map((s) => s.status)),
          sampleCount: inBucket.length,
        });
      }
      result.push({
        component: cfg.component,
        displayName: cfg.displayName,
        buckets,
      });
    }
    return result;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async buildSnapshot(nowMs: number): Promise<StatusSnapshot> {
    // Kjør alle sjekker parallelt — én treg sjekk skal ikke blokkere de andre.
    const components: ComponentHealth[] = await Promise.all(
      this.checks.map(async (cfg) => {
        const lastCheckedAt = new Date(nowMs).toISOString();
        try {
          const result = await runWithTimeout(cfg.check(), 5_000);
          return {
            component: cfg.component,
            displayName: cfg.displayName,
            status: result.status,
            message: result.message,
            lastCheckedAt,
          };
        } catch (err) {
          // Hook kastet → outage. Vi logger bevisst på warn (ikke error)
          // siden status-side-failures ikke er ekte ops-feil — det er
          // selve INFORMASJONEN status-siden er ment å gi.
          log.warn(
            { err, component: cfg.component },
            "[status] component check threw — marking outage",
          );
          return {
            component: cfg.component,
            displayName: cfg.displayName,
            status: "outage" as ComponentStatus,
            message: err instanceof Error ? err.message : "Sjekk feilet",
            lastCheckedAt,
          };
        }
      }),
    );

    return {
      overall: computeOverallStatus(components),
      generatedAt: new Date(nowMs).toISOString(),
      components,
    };
  }

  private recordSamples(snapshot: StatusSnapshot, nowMs: number): void {
    for (const c of snapshot.components) {
      const existing = this.uptimeHistory.get(c.component) ?? [];
      existing.push({ ts: nowMs, status: c.status });
      // Trim ringbuffer.
      if (existing.length > this.maxHistoryPerComponent) {
        existing.splice(0, existing.length - this.maxHistoryPerComponent);
      }
      this.uptimeHistory.set(c.component, existing);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Race en lovet sjekk mot en timeout. Brukes så en hengende komponent ikke
 * blokkerer status-siden i 30+ sekunder.
 */
async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Helsesjekk timeout etter ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Returnerer verste status (outage > degraded > operational > "operational"
 * hvis tom). Brukes for uptime-bøtte-aggregering.
 */
function worstStatusOf(statuses: readonly ComponentStatus[]): ComponentStatus {
  if (statuses.length === 0) return "operational";
  if (statuses.includes("outage")) return "outage";
  if (statuses.includes("degraded")) return "degraded";
  return "operational";
}

// ── Common factory hooks ─────────────────────────────────────────────────────

/**
 * Bygg en database-helsesjekk basert på en Postgres-pool. Kjører `SELECT 1`
 * med 1s timeout.
 */
export function buildDatabaseCheck(pool: Pool): ComponentCheck {
  return async () => {
    try {
      await runWithTimeout(pool.query("SELECT 1"), 1_000);
      return operational();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ukjent feil";
      return outage(`Database utilgjengelig: ${message}`);
    }
  };
}

/**
 * Bygg en API-helsesjekk. Returnerer alltid operational hvis koden kjører —
 * status-side-besvarelsen er i seg selv beviset på at API-en er oppe.
 */
export function buildApiCheck(): ComponentCheck {
  return async () => operational();
}
