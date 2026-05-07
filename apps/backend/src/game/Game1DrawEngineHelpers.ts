/**
 * Game1DrawEngineHelpers — pure helpers + konstanter for Game1DrawEngineService.
 *
 * Ekstrahert fra `Game1DrawEngineService.ts` i refactor/s4b-draw-engine-helpers
 * for å redusere service-ens LOC videre etter S4. Kontrakt:
 *
 *   - 100% rene funksjoner (ingen `this`, ingen state-closure, ingen IO).
 *   - Byte-identisk flytting — identisk input gir identisk output som før.
 *   - Kun re-eksporteres der den tidligere var fil-lokal.
 *
 * Brukes av:
 *   - `Game1DrawEngineService.ts` (primær caller).
 *   - `Game1DrawEnginePhysicalTickets.ts` via dependency-injection-port
 *     (`EvaluatePhysicalTicketsDeps`) — helper-en er fortsatt sendt inn
 *     eksplisitt i stedet for å lage direkte import-kobling, slik at
 *     PT-helper forblir uavhengig av service-fila.
 */

import type { Game1JackpotConfig } from "./Game1JackpotService.js";
import {
  buildVariantConfigFromSpill1Config,
  type Spill1ConfigInput,
} from "./spill1VariantMapper.js";
import type { GameVariantConfig, PatternConfig } from "./variantConfig.js";

// ── Pure helpers ────────────────────────────────────────────────────────────

export function parseDrawBag(raw: unknown): number[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is number => typeof x === "number" && Number.isInteger(x));
}

export function parseGridArray(raw: unknown): Array<number | null> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((v) => {
    if (v === null) return null;
    if (typeof v === "number" && Number.isInteger(v)) return v;
    return null;
  });
}

// ── Phase + config helpers (PR 4c) ──────────────────────────────────────────

/**
 * Map fase-nummer til admin-form-pattern-key.
 *   1 → "row_1", 2 → "row_2", 3 → "row_3", 4 → "row_4", 5 → "full_house".
 */
export function phaseToConfigKey(phase: number): string {
  if (phase === 5) return "full_house";
  return `row_${phase}`;
}

/** Norsk fase-navn for audit og logging. */
export function phaseDisplayName(phase: number): string {
  switch (phase) {
    case 1:
      return "1 Rad";
    case 2:
      return "2 Rader";
    case 3:
      return "3 Rader";
    case 4:
      return "4 Rader";
    case 5:
      return "Fullt Hus";
    default:
      return `Fase ${phase}`;
  }
}

export type ResolvedPhaseConfig =
  | { kind: "percent"; percent: number }
  | { kind: "fixed"; amountCents: number };

/**
 * Resolve phase-config fra ticket_config_json.
 *
 * Admin-form-shape (Spill1Config.ts): ticket_config.spill1.ticketColors[0]
 * .prizePerPattern[row_1..full_house] er prosent av pot.
 *
 * For PR 4c: bruk FØRSTE ticketColor's prizePerPattern[phase_key] som
 * prosent. I praksis skal alle farger ha samme prosent-fordeling. Hvis
 * ikke finnes eller er 0 → returnerer percent=0 (ingen utbetaling for
 * fasen, men fasen regnes fortsatt som "vunnet" slik at neste fase kan
 * starte).
 */
export function resolvePhaseConfig(
  rawTicketConfig: unknown,
  phase: number
): ResolvedPhaseConfig {
  let parsed: unknown = rawTicketConfig;
  if (typeof rawTicketConfig === "string") {
    try {
      parsed = JSON.parse(rawTicketConfig);
    } catch {
      return { kind: "percent", percent: 0 };
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { kind: "percent", percent: 0 };
  }
  const obj = parsed as Record<string, unknown>;
  const spill1 = obj.spill1 as Record<string, unknown> | undefined;
  const ticketColors = Array.isArray(spill1?.ticketColors)
    ? (spill1!.ticketColors as Array<Record<string, unknown>>)
    : Array.isArray(obj.ticketColors)
    ? (obj.ticketColors as Array<Record<string, unknown>>)
    : null;
  if (!ticketColors || ticketColors.length === 0) {
    return { kind: "percent", percent: 0 };
  }
  const key = phaseToConfigKey(phase);
  const first = ticketColors[0]!;
  const ppp = first.prizePerPattern as Record<string, unknown> | undefined;
  if (ppp) {
    const raw = ppp[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      return { kind: "percent", percent: raw };
    }
    if (typeof raw === "string") {
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n) && n >= 0) {
        return { kind: "percent", percent: n };
      }
    }
  }
  return { kind: "percent", percent: 0 };
}

/**
 * Resolve jackpot-config fra ticket_config_json. Returnerer null hvis
 * jackpot ikke er konfigurert.
 *
 * #316: prizeByColor er Record<string, number> med eksakte ticket-farger
 * (f.eks. "small_yellow") eller farge-familier ("yellow", "elvis"). Alle
 * verdier konverteres til numbers; ikke-numeriske filtreres bort.
 */
export function resolveJackpotConfig(
  rawTicketConfig: unknown
): Game1JackpotConfig | null {
  let parsed: unknown = rawTicketConfig;
  if (typeof rawTicketConfig === "string") {
    try {
      parsed = JSON.parse(rawTicketConfig);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const spill1 = obj.spill1 as Record<string, unknown> | undefined;
  const jp =
    (spill1?.jackpot as Record<string, unknown> | undefined) ??
    (obj.jackpot as Record<string, unknown> | undefined);
  if (!jp || typeof jp !== "object") return null;
  const pbcRaw = jp.prizeByColor as Record<string, unknown> | undefined;
  if (!pbcRaw || typeof pbcRaw !== "object") return null;
  const draw = typeof jp.draw === "number" ? jp.draw : Number.parseInt(String(jp.draw), 10);
  if (!Number.isFinite(draw) || draw <= 0) return null;
  const prizeByColor: Record<string, number> = {};
  for (const [key, val] of Object.entries(pbcRaw)) {
    const n = numberOrZero(val);
    if (n > 0) prizeByColor[key.toLowerCase()] = n;
  }
  return { prizeByColor, draw };
}

function numberOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// ── Scheduler-config-kobling helpers ────────────────────────────────────────

/**
 * Bygg `GameVariantConfig` fra `scheduled_games.game_config_json` (snapshot
 * av `GameManagement.config_json`). Returnerer null hvis ingen
 * `spill1`-sub-objekt finnes eller config er tom/ugyldig → caller faller
 * til flat-path (dagens atferd, bakoverkompat).
 *
 * Kanonisk shape: `{spill1: {...}}`. Direkte-shape (`{ticketColors: [...]}`
 * uten spill1-wrapper) tolereres for legacy, men er ikke forventet i
 * scheduled-games-context.
 */
export function buildVariantConfigFromGameConfigJson(
  rawGameConfig: unknown
): GameVariantConfig | null {
  let parsed: unknown = rawGameConfig;
  if (typeof rawGameConfig === "string") {
    try {
      parsed = JSON.parse(rawGameConfig);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  // Kanonisk form: {spill1: {...}}. Fallback: direkte-shape.
  const spill1Candidate: Spill1ConfigInput | null =
    obj.spill1 && typeof obj.spill1 === "object"
      ? (obj.spill1 as Spill1ConfigInput)
      : Array.isArray((obj as Record<string, unknown>).ticketColors)
      ? (obj as Spill1ConfigInput)
      : null;

  if (!spill1Candidate) return null;
  // Må ha minst én ticket-color-entry for å aktivere per-farge-path.
  // Uten ticketColors[] faller vi til flat-path (legacy ticket_config-parsing).
  if (!Array.isArray(spill1Candidate.ticketColors) || spill1Candidate.ticketColors.length === 0) {
    return null;
  }
  return buildVariantConfigFromSpill1Config(spill1Candidate);
}

/**
 * Resolve jackpot-config fra `game_config_json` (nestet `spill1.jackpot`).
 * Symmetrisk med `resolveJackpotConfig` som leser `ticket_config_json` — men
 * kilden er `GameManagement.config_json`, ikke subGame.jackpotData.
 */
export function resolveJackpotConfigFromGameConfig(
  rawGameConfig: unknown
): Game1JackpotConfig | null {
  let parsed: unknown = rawGameConfig;
  if (typeof rawGameConfig === "string") {
    try {
      parsed = JSON.parse(rawGameConfig);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const spill1 = obj.spill1 as Record<string, unknown> | undefined;
  const jp =
    (spill1?.jackpot as Record<string, unknown> | undefined) ??
    (obj.jackpot as Record<string, unknown> | undefined);
  if (!jp || typeof jp !== "object") return null;
  const pbcRaw = jp.prizeByColor as Record<string, unknown> | undefined;
  if (!pbcRaw || typeof pbcRaw !== "object") return null;
  const draw = typeof jp.draw === "number" ? jp.draw : Number.parseInt(String(jp.draw), 10);
  if (!Number.isFinite(draw) || draw <= 0) return null;
  const prizeByColor: Record<string, number> = {};
  for (const [key, val] of Object.entries(pbcRaw)) {
    const n = numberOrZero(val);
    if (n > 0) prizeByColor[key.toLowerCase()] = n;
  }
  return { prizeByColor, draw };
}

/**
 * Slug → engine-navn for ticket-colors. Admin-UI lagrer slug-form
 * ("small_yellow") mens `patternsByColor` nøkler på engine-navn
 * ("Small Yellow"). Denne tabellen speiler `COLOR_SLUG_TO_NAME` i
 * `spill1VariantMapper.ts` — holdt lokalt for å unngå å eksportere den
 * som public API fra mapperen.
 */
export const SCHEDULER_COLOR_SLUG_TO_NAME: Readonly<Record<string, string>> = {
  small_yellow: "Small Yellow",
  large_yellow: "Large Yellow",
  small_white: "Small White",
  large_white: "Large White",
  small_purple: "Small Purple",
  large_purple: "Large Purple",
  small_red: "Small Red",
  small_green: "Small Green",
  small_orange: "Small Orange",
  elvis1: "Elvis 1",
  elvis2: "Elvis 2",
  elvis3: "Elvis 3",
  elvis4: "Elvis 4",
  elvis5: "Elvis 5",
};

export function resolveEngineColorName(ticketColor: string): string | null {
  // Hvis fargen allerede er engine-navn ("Small Yellow") returnér den.
  // Slug-form ("small_yellow") konverteres til engine-navn.
  if (!ticketColor) return null;
  const slug = ticketColor.toLowerCase().trim();
  const mapped = SCHEDULER_COLOR_SLUG_TO_NAME[slug];
  if (mapped) return mapped;
  // Antall assignments lagrer ticket_color i slug-form (f.eks. "small_yellow")
  // via TicketSpec.color i Game1TicketPurchaseService. Hvis ikke truffet av
  // tabellen, returnér ticketColor uendret — resolvePatternsForColor
  // faller til __default__-matrisen.
  return ticketColor;
}

/**
 * Konverter `PatternConfig` til prize-beløp i øre basert på pot.
 *
 *   - `winningType: "fixed"` → `prize1` kroner × 100 (direkte per-fase-beløp).
 *   - `winningType: "percent"` eller udefinert → `prizePercent` av pot i øre.
 *
 * Matching semantisk med `BingoEngine.evaluateActivePhase` (PR B):
 *   - For fixed-modus brukes prize1 som beløp per fase, ikke per vinner.
 *     Multi-winner-split skjer i `payoutService.payoutPhase`.
 */
export function patternPrizeToCents(
  pattern: PatternConfig,
  potCents: number
): number {
  if (pattern.winningType === "fixed") {
    const prize1Nok = typeof pattern.prize1 === "number" && Number.isFinite(pattern.prize1) && pattern.prize1 >= 0
      ? pattern.prize1
      : 0;
    return Math.floor(prize1Nok * 100);
  }
  const percent = typeof pattern.prizePercent === "number" && Number.isFinite(pattern.prizePercent) && pattern.prizePercent >= 0
    ? pattern.prizePercent
    : 0;
  return Math.floor((potCents * percent) / 100);
}

// ── Oddsen variant-config (Pot-per-bongstørrelse, §6 + §9.5) ───────────────

/**
 * Pot-per-bongstørrelse-fix (2026-05-08): variant-level Oddsen-config for
 * Fullt Hus HIGH/LOW-overstyring. Lagres av bridge i
 * `ticket_config_json.spill1.oddsen` (eller `game_config_json` mirror).
 *
 * Brukes IKKE for Rad 1-4 — de følger standard auto-mult-pathen via
 * `patternsByColor`. Kun Fullt Hus-poten overstyres.
 *
 * Skiller seg fra `MiniGameOddsenEngine.OddsenConfig` (mini-game-pot under
 * Fullt Hus) — denne er top-level Fullt Hus-payout for catalog-rad-typer
 * `oddsen-55`/`56`/`57`.
 */
export interface OddsenVariantConfig {
  targetDraw: number;
  bingoBaseLow: number;
  bingoBaseHigh: number;
}

/**
 * Resolve Oddsen variant-config fra raw JSON-blokk
 * (`ticket_config_json` eller `game_config_json`). Leter på
 * `obj.spill1.oddsen` (kanonisk) og `obj.oddsen` (fallback). Returnerer
 * null hvis blokken mangler eller har ugyldige felter — caller faller
 * tilbake til standard auto-mult-pattern for Fullt Hus.
 */
export function resolveOddsenVariantConfig(
  raw: unknown,
): OddsenVariantConfig | null {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const spill1 = obj.spill1 as Record<string, unknown> | undefined;
  const oddsen =
    (spill1?.oddsen as Record<string, unknown> | undefined) ??
    (obj.oddsen as Record<string, unknown> | undefined);
  if (!oddsen || typeof oddsen !== "object") return null;

  const targetDraw = numberOrZero(oddsen.targetDraw);
  const bingoBaseLow = numberOrZero(oddsen.bingoBaseLow);
  const bingoBaseHigh = numberOrZero(oddsen.bingoBaseHigh);

  // targetDraw må være positivt; basene kan være 0 (eks. "ingen LOW-payout").
  if (targetDraw <= 0) return null;
  if (bingoBaseLow < 0) return null;
  if (bingoBaseHigh < 0) return null;

  return { targetDraw, bingoBaseLow, bingoBaseHigh };
}

/**
 * Pot-per-bongstørrelse-fix (2026-05-08): bongMultiplier-mapping per
 * §9.2 i SPILL_REGLER_OG_PAYOUT.md.
 *
 * Slug-form (`small_yellow`, `large_white`, ...) → multiplier:
 *   - Hvit (5 kr) bonger     → multiplier 1
 *   - Gul (10 kr) bonger     → multiplier 2 (small) eller 4 (large)
 *   - Lilla (15 kr) bonger   → multiplier 3 (small) eller 6 (large)
 *
 * **Viktig:** Etter bridge-konvensjon (LARGE_TICKET_PRICE_MULTIPLIER = 2)
 * koster `large_yellow` 20 kr, så multiplier = 4. `large_purple` koster
 * 30 kr → multiplier 6. Dette stemmer med formelen i §3.1:
 * `actualPrize = base × (ticketPrice / 500)`.
 *
 * Returnerer null for ukjente slugs — caller faller tilbake til
 * `patternPrizeToCents` (eksisterende auto-mult-path).
 */
export function bongMultiplierForColorSlug(slug: string): number | null {
  if (!slug) return null;
  const s = slug.toLowerCase().trim();
  // Family + size-prefix.
  // Hvit (5 kr): small × 1, large × 2.
  if (s === "small_white") return 1;
  if (s === "large_white") return 2;
  // Gul (10 kr): small × 2, large × 4.
  if (s === "small_yellow") return 2;
  if (s === "large_yellow") return 4;
  // Lilla (15 kr): small × 3, large × 6.
  if (s === "small_purple") return 3;
  if (s === "large_purple") return 6;
  // Ekstra bridge-farger (red/green/orange) — ukjent prising; behold null
  // og la auto-mult-pattern overstyre.
  return null;
}

export function parseMarkings(raw: unknown, expectedLength: number): boolean[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Array(expectedLength).fill(false);
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return Array(expectedLength).fill(false);
  }
  const marked = (parsed as { marked?: unknown }).marked;
  if (!Array.isArray(marked)) {
    return Array(expectedLength).fill(false);
  }
  const out = Array(expectedLength).fill(false);
  for (let i = 0; i < expectedLength; i++) {
    out[i] = Boolean(marked[i]);
  }
  return out;
}
