/**
 * HV-2 (Tobias 2026-04-30): Per-hall Spill 1 prize-floor service.
 *
 * Bakgrunn (HV2_BIR036_SPEC §2):
 *   Spill 1 (slug `bingo`) skal alltid utbetale per-fase-default-gevinster
 *   (Rad 1, 2, 3, 4 og Fullt Hus) **uavhengig av antall spillere /
 *   pool-størrelse**. Når buy-in-pool-en ikke dekker default-floor, må
 *   huset finansiere differansen (HV-2 Option A: house pre-fund gap).
 *
 * Skillelinje mot eksisterende mekanikk:
 *   * `PatternDefinition.minPrize` finnes allerede og brukes i engine via
 *     `Math.max(rawPhase, minPrize)`. Tidligere ble denne verdien lagt inn
 *     som per-spill admin-config (eller hardcoded i sub-variant-presets).
 *     Denne tjenesten persisterer floor-verdiene per-hall slik at en operatør
 *     kan justere baseline uten å touche per-spill-config.
 *   * `Spill1SubVariantType` (sub-variant-preset) kan ØKE floor utover
 *     hall-default men aldri senke den under hall-default. Validering skjer
 *     i B4 (admin-UI), ikke her — denne tjenesten leverer kun lookup +
 *     CRUD-skriving.
 *   * Spill 2/3 (`rocket`, `monsterbingo`) og SpinnGo (`spillorama`) er
 *     IKKE påvirket — variable-by-ticket-count semantikk gjelder uendret.
 *     Caller (variant-mapper) må sjekke `gameSlug === "bingo"` før den
 *     leser fra denne tjenesten.
 *
 * Wildcard-fallback:
 *   En `hall_id='*'`-rad seedes ved migrasjon. `getDefaults(hallId)` leser
 *   først hall-spesifikke rader; for fase-indekser uten override fall det
 *   tilbake til wildcard. Tomt resultat returnerer
 *   `SPILL1_SUB_VARIANT_DEFAULTS.standard`-baseline (defensiv — bør ikke
 *   skje siden migrasjonen seeder wildcard).
 *
 * Cache:
 *   In-memory cache per `hallId` med invalidering på `setDefault()`. Cache-en
 *   har ingen TTL — tjenesten brukes til admin-driftet konfig som endres
 *   sjelden. Tester kan kalle `clearCache()` for å reset state mellom kjøringer.
 *
 * House pre-fund gap (HV-2 Option A):
 *   Når buy-in-pool < floor og huset finansierer differansen skriver
 *   `PhasePayoutService` en `HOUSE_DEFICIT`-ledger-event med
 *   `metadata.reason = "FIXED_PRIZE_HOUSE_GUARANTEE"` (samme audit-shape
 *   som eksisterende fixed-prize hus-garanti). Denne tjenesten håndterer
 *   ikke ledger-skriving — caller (engine) eier den.
 *
 * @see SPILL1_SUB_VARIANT_DEFAULTS (packages/shared-types/src/spill1-sub-variants.ts)
 * @see PhasePayoutService.computeAndPayPhase
 */

import type { Pool, PoolClient } from "pg";
import { logger as rootLogger } from "../util/logger.js";
import { SPILL1_SUB_VARIANT_DEFAULTS } from "@spillorama/shared-types";

const log = rootLogger.child({ module: "spill1-prize-defaults-service" });

/** Wildcard-hall-ID brukt for fallback-rader i app_spill1_prize_defaults. */
export const SPILL1_DEFAULTS_WILDCARD_HALL = "*";

/** Phase-index for hver av de 5 fasene. Stabil — DB-PK avhengighet. */
export type Spill1PhaseIndex = 1 | 2 | 3 | 4 | 5;

export const SPILL1_PHASE_INDICES: readonly Spill1PhaseIndex[] = [1, 2, 3, 4, 5];

/**
 * Komplett floor-snapshot for en hall. Alle felt er i **kroner** (ikke øre)
 * for å matche `PatternDefinition.minPrize`-shape og admin-UI-input.
 *
 * Engine bruker disse verdiene som baseline `minPrize` i preset-patterns;
 * faktisk wallet-kreditering fortsatt skjer i kroner via ComplianceLedger.
 */
export interface Spill1PrizeDefaults {
  /** Rad 1 floor (kr). Standard fallback: 100. */
  phase1: number;
  /** Rad 2 floor (kr). Standard fallback: 200. */
  phase2: number;
  /** Rad 3 floor (kr). Standard fallback: 200. */
  phase3: number;
  /** Rad 4 floor (kr). Standard fallback: 200. */
  phase4: number;
  /** Fullt Hus floor (kr). Standard fallback: 1000. */
  phase5: number;
}

/**
 * Hardcoded fallback brukt når DB ikke har data (defensive). Matcher
 * `SPILL1_SUB_VARIANT_DEFAULTS.standard` byte-identisk.
 */
const HARDCODED_FALLBACK_DEFAULTS: Spill1PrizeDefaults = {
  phase1: SPILL1_SUB_VARIANT_DEFAULTS.standard.row1,
  phase2: SPILL1_SUB_VARIANT_DEFAULTS.standard.row2,
  phase3: SPILL1_SUB_VARIANT_DEFAULTS.standard.row3,
  phase4: SPILL1_SUB_VARIANT_DEFAULTS.standard.row4,
  phase5: SPILL1_SUB_VARIANT_DEFAULTS.standard.fullHouse,
};

/** DB-rad-shape — øre i BIGINT. */
interface DefaultsRow {
  hall_id: string;
  phase_index: number;
  min_prize_cents: string | number;
  updated_at: Date | string;
  updated_by: string | null;
}

/**
 * Konverter øre (BIGINT fra DB) → kroner (number, integer-trygg). Negative
 * verdier er invalid (CHECK-constraint dekker DB-side; client-side guard
 * for paranoia).
 */
function centsToNok(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Verdiene er hele kroner-multipler i seed-data, men vi støtter øre-presisjon
  // for fremtidig admin-justering. Math.round dekker float-imprecision.
  return Math.round(n / 100);
}

/** Konverter kroner → øre (BIGINT-trygg). */
function nokToCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

export interface Spill1PrizeDefaultsServiceOptions {
  pool: Pool;
  schema?: string;
}

export class Spill1PrizeDefaultsService {
  private readonly pool: Pool;
  private readonly schema: string;
  /** Hall-ID → defaults. Invalidert ved setDefault(). */
  private readonly cache = new Map<string, Spill1PrizeDefaults>();
  /** Wildcard-defaults (lazy-loaded ved første lookup). */
  private wildcardDefaults: Spill1PrizeDefaults | null = null;

  constructor(options: Spill1PrizeDefaultsServiceOptions) {
    this.pool = options.pool;
    this.schema = (options.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
  }

  private table(): string {
    return `"${this.schema}"."app_spill1_prize_defaults"`;
  }

  /**
   * Hent floor-defaults for en hall. Lookup-rekkefølge:
   *   1) cache (hvis populated)
   *   2) hall-spesifikke rader (per phase-index)
   *   3) wildcard-rader for manglende phase-indekser
   *   4) hardcoded fallback (defensiv — bør aldri treffes etter migrasjon)
   *
   * Returverdien er **alltid komplett** (alle 5 faser har en verdi).
   *
   * @param hallId Hall som spør (eller "*" for direkte wildcard-lookup).
   */
  async getDefaults(hallId: string): Promise<Spill1PrizeDefaults> {
    const normalized = hallId?.trim() || SPILL1_DEFAULTS_WILDCARD_HALL;

    const cached = this.cache.get(normalized);
    if (cached) return { ...cached };

    // Last begge sett (hall + wildcard) i ett kall for å unngå dobbelt round-trip.
    const { rows } = await this.pool.query<DefaultsRow>(
      `SELECT hall_id, phase_index, min_prize_cents, updated_at, updated_by
         FROM ${this.table()}
        WHERE hall_id = $1 OR hall_id = $2`,
      [normalized, SPILL1_DEFAULTS_WILDCARD_HALL]
    );

    // Bygg per-phase lookups, prioriter hall-spesifikke over wildcard.
    const hallRows = new Map<number, number>();
    const wildcardRows = new Map<number, number>();
    for (const row of rows) {
      const cents = typeof row.min_prize_cents === "number"
        ? row.min_prize_cents
        : Number(row.min_prize_cents);
      if (!Number.isFinite(cents)) continue;
      const target = row.hall_id === SPILL1_DEFAULTS_WILDCARD_HALL ? wildcardRows : hallRows;
      target.set(row.phase_index, cents);
    }

    // Cache wildcard for senere kall (sjelden endret).
    if (wildcardRows.size > 0) {
      this.wildcardDefaults = {
        phase1: centsToNok(wildcardRows.get(1) ?? nokToCents(HARDCODED_FALLBACK_DEFAULTS.phase1)),
        phase2: centsToNok(wildcardRows.get(2) ?? nokToCents(HARDCODED_FALLBACK_DEFAULTS.phase2)),
        phase3: centsToNok(wildcardRows.get(3) ?? nokToCents(HARDCODED_FALLBACK_DEFAULTS.phase3)),
        phase4: centsToNok(wildcardRows.get(4) ?? nokToCents(HARDCODED_FALLBACK_DEFAULTS.phase4)),
        phase5: centsToNok(wildcardRows.get(5) ?? nokToCents(HARDCODED_FALLBACK_DEFAULTS.phase5)),
      };
    }

    const wildcardFallback = this.wildcardDefaults ?? HARDCODED_FALLBACK_DEFAULTS;

    // Per-phase lookup: hall-row → wildcard-row → hardcoded fallback.
    const resolved: Spill1PrizeDefaults = {
      phase1: hallRows.has(1)
        ? centsToNok(hallRows.get(1)!)
        : wildcardFallback.phase1,
      phase2: hallRows.has(2)
        ? centsToNok(hallRows.get(2)!)
        : wildcardFallback.phase2,
      phase3: hallRows.has(3)
        ? centsToNok(hallRows.get(3)!)
        : wildcardFallback.phase3,
      phase4: hallRows.has(4)
        ? centsToNok(hallRows.get(4)!)
        : wildcardFallback.phase4,
      phase5: hallRows.has(5)
        ? centsToNok(hallRows.get(5)!)
        : wildcardFallback.phase5,
    };

    this.cache.set(normalized, resolved);
    return { ...resolved };
  }

  /**
   * Synkron variant brukt av admin-settes/engine-state-hydration. Returnerer
   * cached verdi hvis den finnes, ellers hardcoded fallback (defensive
   * fallback for sync paths som ikke kan await).
   *
   * Caller bør prefer `getDefaults()` (async) der mulig — synk-pathen er
   * primært tenkt som fallback når engine kjører i isolerte kontekster
   * uten DB-pool (f.eks. unit-tester som ikke seeder defaults).
   */
  getDefaultsSync(hallId: string): Spill1PrizeDefaults {
    const normalized = hallId?.trim() || SPILL1_DEFAULTS_WILDCARD_HALL;
    const cached = this.cache.get(normalized);
    if (cached) return { ...cached };
    if (this.wildcardDefaults) return { ...this.wildcardDefaults };
    return { ...HARDCODED_FALLBACK_DEFAULTS };
  }

  /**
   * Sett floor for én fase. UPSERT — overskriver eksisterende rad atomært.
   * Invaliderer cache for `hallId`.
   *
   * @param hallId       Hall-ID. Pass `"*"` for å overskrive wildcard.
   * @param phaseIndex   1-5 (Rad 1, 2, 3, 4, Fullt Hus).
   * @param minPrizeNok  Floor i kroner. Må være >= 0.
   * @param actorUserId  Admin som gjør endringen (audit-spor).
   */
  async setDefault(
    hallId: string,
    phaseIndex: Spill1PhaseIndex,
    minPrizeNok: number,
    actorUserId: string,
  ): Promise<void> {
    const normalized = hallId?.trim();
    if (!normalized) {
      throw new Error("[spill1-defaults] hallId må ikke være tom");
    }
    if (!SPILL1_PHASE_INDICES.includes(phaseIndex)) {
      throw new Error(`[spill1-defaults] phaseIndex må være 1-5, fikk ${phaseIndex}`);
    }
    if (!Number.isFinite(minPrizeNok) || minPrizeNok < 0) {
      throw new Error(`[spill1-defaults] minPrizeNok må være >= 0, fikk ${minPrizeNok}`);
    }
    const cents = nokToCents(minPrizeNok);
    await this.pool.query(
      `INSERT INTO ${this.table()}
         (hall_id, phase_index, min_prize_cents, updated_at, updated_by)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (hall_id, phase_index) DO UPDATE
         SET min_prize_cents = EXCLUDED.min_prize_cents,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by`,
      [normalized, phaseIndex, cents, actorUserId]
    );

    // Invalider både hall-cache og wildcard-cache hvis vi endret wildcard.
    this.cache.delete(normalized);
    if (normalized === SPILL1_DEFAULTS_WILDCARD_HALL) {
      this.wildcardDefaults = null;
      // Wildcard-endring kan påvirke alle haller som faller tilbake — clear all.
      this.cache.clear();
    }

    log.info(
      { hallId: normalized, phaseIndex, minPrizeNok, actorUserId },
      "spill1.prize_defaults.upsert"
    );
  }

  /**
   * Last alle hall-spesifikke defaults i ett kall. Brukes for engine-state
   * hydration ved boot — undgår n+1-queries for haller som starter samtidig.
   *
   * Returnerer en Map<hallId, defaults> med kun hall-spesifikke rader; caller
   * bør falle tilbake til wildcard-defaults for haller utenfor map-en.
   */
  async loadAll(): Promise<Map<string, Spill1PrizeDefaults>> {
    const { rows } = await this.pool.query<DefaultsRow>(
      `SELECT hall_id, phase_index, min_prize_cents, updated_at, updated_by
         FROM ${this.table()}
        WHERE hall_id <> $1`,
      [SPILL1_DEFAULTS_WILDCARD_HALL]
    );

    // Group by hall.
    const grouped = new Map<string, Map<number, number>>();
    for (const row of rows) {
      const cents = typeof row.min_prize_cents === "number"
        ? row.min_prize_cents
        : Number(row.min_prize_cents);
      if (!Number.isFinite(cents)) continue;
      const inner = grouped.get(row.hall_id) ?? new Map<number, number>();
      inner.set(row.phase_index, cents);
      grouped.set(row.hall_id, inner);
    }

    // Sørg for wildcard er lastet (for fallback-felt).
    if (!this.wildcardDefaults) {
      // Trigger wildcard-load via getDefaults("*").
      await this.getDefaults(SPILL1_DEFAULTS_WILDCARD_HALL);
    }
    const wildcardFallback = this.wildcardDefaults ?? HARDCODED_FALLBACK_DEFAULTS;

    const out = new Map<string, Spill1PrizeDefaults>();
    for (const [hallId, phases] of grouped) {
      const resolved: Spill1PrizeDefaults = {
        phase1: phases.has(1) ? centsToNok(phases.get(1)!) : wildcardFallback.phase1,
        phase2: phases.has(2) ? centsToNok(phases.get(2)!) : wildcardFallback.phase2,
        phase3: phases.has(3) ? centsToNok(phases.get(3)!) : wildcardFallback.phase3,
        phase4: phases.has(4) ? centsToNok(phases.get(4)!) : wildcardFallback.phase4,
        phase5: phases.has(5) ? centsToNok(phases.get(5)!) : wildcardFallback.phase5,
      };
      out.set(hallId, resolved);
      this.cache.set(hallId, resolved);
    }
    return out;
  }

  /**
   * Test-hook for å rense cache mellom test-kjøringer. Ikke ment for prod-bruk.
   */
  clearCache(): void {
    this.cache.clear();
    this.wildcardDefaults = null;
  }
}

/**
 * In-memory implementation for tester som ikke kjører mot en faktisk
 * Postgres-instans. Mirrorer DB-semantikken: wildcard-fallback per phase,
 * cache-invalidering ved set, atomic upsert.
 *
 * Test-bruk:
 * ```typescript
 * const svc = new InMemorySpill1PrizeDefaultsService();
 * svc.seedWildcard({ phase1: 100, phase2: 200, ... });
 * svc.seedHall("hall-A", { phase1: 150 }); // override kun phase1
 * await svc.getDefaults("hall-A"); // → phase1=150, phase2/3/4/5 = wildcard
 * ```
 */
export class InMemorySpill1PrizeDefaultsService {
  private readonly hallRows = new Map<string, Map<Spill1PhaseIndex, number>>();
  private wildcardRows = new Map<Spill1PhaseIndex, number>();

  /** Test-helper: sett wildcard-fallback (alle 5 faser eller subset). */
  seedWildcard(defaults: Partial<Spill1PrizeDefaults>): void {
    if (typeof defaults.phase1 === "number") this.wildcardRows.set(1, defaults.phase1);
    if (typeof defaults.phase2 === "number") this.wildcardRows.set(2, defaults.phase2);
    if (typeof defaults.phase3 === "number") this.wildcardRows.set(3, defaults.phase3);
    if (typeof defaults.phase4 === "number") this.wildcardRows.set(4, defaults.phase4);
    if (typeof defaults.phase5 === "number") this.wildcardRows.set(5, defaults.phase5);
  }

  /** Test-helper: sett hall-spesifikke overrides (subset av faser tillatt). */
  seedHall(hallId: string, defaults: Partial<Spill1PrizeDefaults>): void {
    const inner = this.hallRows.get(hallId) ?? new Map<Spill1PhaseIndex, number>();
    if (typeof defaults.phase1 === "number") inner.set(1, defaults.phase1);
    if (typeof defaults.phase2 === "number") inner.set(2, defaults.phase2);
    if (typeof defaults.phase3 === "number") inner.set(3, defaults.phase3);
    if (typeof defaults.phase4 === "number") inner.set(4, defaults.phase4);
    if (typeof defaults.phase5 === "number") inner.set(5, defaults.phase5);
    this.hallRows.set(hallId, inner);
  }

  async getDefaults(hallId: string): Promise<Spill1PrizeDefaults> {
    return this.getDefaultsSync(hallId);
  }

  getDefaultsSync(hallId: string): Spill1PrizeDefaults {
    const normalized = hallId?.trim() || SPILL1_DEFAULTS_WILDCARD_HALL;
    const inner = this.hallRows.get(normalized) ?? new Map<Spill1PhaseIndex, number>();
    return {
      phase1: inner.get(1) ?? this.wildcardRows.get(1) ?? HARDCODED_FALLBACK_DEFAULTS.phase1,
      phase2: inner.get(2) ?? this.wildcardRows.get(2) ?? HARDCODED_FALLBACK_DEFAULTS.phase2,
      phase3: inner.get(3) ?? this.wildcardRows.get(3) ?? HARDCODED_FALLBACK_DEFAULTS.phase3,
      phase4: inner.get(4) ?? this.wildcardRows.get(4) ?? HARDCODED_FALLBACK_DEFAULTS.phase4,
      phase5: inner.get(5) ?? this.wildcardRows.get(5) ?? HARDCODED_FALLBACK_DEFAULTS.phase5,
    };
  }

  async setDefault(
    hallId: string,
    phaseIndex: Spill1PhaseIndex,
    minPrizeNok: number,
    _actorUserId: string,
  ): Promise<void> {
    const normalized = hallId?.trim();
    if (!normalized) throw new Error("[in-memory-spill1-defaults] hallId må ikke være tom");
    if (!SPILL1_PHASE_INDICES.includes(phaseIndex)) {
      throw new Error(`[in-memory-spill1-defaults] phaseIndex må være 1-5`);
    }
    if (!Number.isFinite(minPrizeNok) || minPrizeNok < 0) {
      throw new Error(`[in-memory-spill1-defaults] minPrizeNok må være >= 0`);
    }
    if (normalized === SPILL1_DEFAULTS_WILDCARD_HALL) {
      this.wildcardRows.set(phaseIndex, minPrizeNok);
    } else {
      const inner = this.hallRows.get(normalized) ?? new Map<Spill1PhaseIndex, number>();
      inner.set(phaseIndex, minPrizeNok);
      this.hallRows.set(normalized, inner);
    }
  }

  async loadAll(): Promise<Map<string, Spill1PrizeDefaults>> {
    const out = new Map<string, Spill1PrizeDefaults>();
    for (const hallId of this.hallRows.keys()) {
      out.set(hallId, this.getDefaultsSync(hallId));
    }
    return out;
  }

  clearCache(): void {
    this.hallRows.clear();
    this.wildcardRows.clear();
  }
}
