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
 * Oddsen target-draw config for Spill 1-katalog-varianter (oddsen-55/56/57).
 *
 * Kilde: `ticket_config_json.spill1.oddsen` skrevet av
 * `GamePlanEngineBridge.buildTicketConfigFromCatalog` når
 * `catalog.rules.gameVariant === "oddsen"`.
 *
 * Engine-regel ved Fullt Hus (drawSequenceAtWin = `nextSequence`):
 *   - drawSequenceAtWin <= targetDraw → bruk HIGH-tabellen for vinnerens farge
 *   - drawSequenceAtWin >  targetDraw → bruk LOW-tabellen for vinnerens farge
 *
 * Tabellene er per-bongfarge (engelsk: "yellow"/"white"/"purple") og
 * inneholder allerede auto-multiplikator (5 kr × 1, 10 kr × 2, 15 kr × 3
 * for low/high-base). Engine multiplikatorer dette IKKE ytterligere.
 */
export interface Game1OddsenConfig {
  targetDraw: number;
  bingoLowPrizes: Record<string, number>;
  bingoHighPrizes: Record<string, number>;
}

/**
 * Pure helper (2026-05-08): velg HIGH eller LOW prize-tabell for Oddsen
 * basert på `drawSequenceAtWin` mot `targetDraw`. Returnerer
 * `{ bucket, prizesTable }` så caller kan logge bucket-valget for audit.
 *
 * Regel: `drawSequenceAtWin <= targetDraw → "high"` (Fullt Hus innen
 * måltrekk gir høy premie); ellers `"low"`.
 */
export function selectOddsenBucket(
  oddsenCfg: Game1OddsenConfig,
  drawSequenceAtWin: number,
): { bucket: "high" | "low"; prizesTable: Record<string, number> } {
  const isHigh = drawSequenceAtWin <= oddsenCfg.targetDraw;
  return {
    bucket: isHigh ? "high" : "low",
    prizesTable: isHigh
      ? oddsenCfg.bingoHighPrizes
      : oddsenCfg.bingoLowPrizes,
  };
}

/**
 * Plan-shape for Oddsen Fullt-Hus-payout (testbar uten å kjøre wallet).
 *
 * Hver rad i `groups` representerer ÉN `payoutService.payoutPhase`-kall
 * som blir gjort av `Game1DrawEngineService.payoutOddsenFullHouse`.
 *
 * Multi-vinner-semantikk: hver vinner i en color-group får `perWinnerPrize`.
 * `totalPhasePrizeCents = perWinnerPrize × winnerCount` så split-rounding
 * i `payoutService.payoutPhase` produserer eksakt `perWinnerPrize` per
 * vinner.
 */
export interface OddsenPayoutPlanGroup {
  /** Color-family lookup-key ("yellow"/"white"/"purple"/etc.). */
  colorFamily: string;
  /** Antall vinner-bonger i gruppen. */
  winnerCount: number;
  /** Premie per vinner i øre (fra HIGH/LOW-tabellen). */
  perWinnerPrizeCents: number;
  /** `perWinnerPrize × winnerCount` — input til payoutPhase. */
  totalPhasePrizeCents: number;
}

export interface OddsenPayoutPlan {
  /** "high" eller "low" — hvilken tabell ble valgt for utbetaling. */
  bucket: "high" | "low";
  /** drawSequenceAtWin sammenlignet med targetDraw for diagnostikk. */
  drawSequenceAtWin: number;
  /** Effektiv targetDraw fra config. */
  targetDraw: number;
  /** Per-color-family payout-rader (én per gruppe med ≥1 vinner og prize > 0). */
  groups: OddsenPayoutPlanGroup[];
  /** Vinnere som ikke fikk gruppe (manglet prize for color-family). */
  skippedColorFamilies: Array<{ colorFamily: string; winnerCount: number }>;
}

/**
 * Pure helper (2026-05-08): planlegg Oddsen Fullt-Hus-payout.
 *
 * Tar liste av (ticketColor, count) og returnerer en plan over hvor mye
 * som skal utbetales per color-family-gruppe. Engine kaller deretter
 * `payoutService.payoutPhase` per `groups`-rad.
 *
 * `winnerColorCounts`-input er allerede aggregert per (string-)
 * ticketColor — caller (engine) deduplicerer ved trenger ikke fordi
 * `Game1DrawEngineService.payoutOddsenFullHouse` har full vinner-context
 * og itererer per assignment. Dette helper-snittet er der for å gjøre
 * computasjonen testbar isolert.
 *
 * `resolveColorFamily`-mapping må sendes inn av caller (avhenger av
 * `Game1JackpotService` som ikke skal være cyclic-importert i helpers).
 */
export function planOddsenFullHousePayout(args: {
  oddsenCfg: Game1OddsenConfig;
  drawSequenceAtWin: number;
  /** Liste av vinnere med ticket-color (slug eller engelsk). */
  winners: ReadonlyArray<{ ticketColor: string }>;
  /** Funksjon som mapper ticket-color → color-family ("yellow" osv.). */
  resolveColorFamily: (ticketColor: string) => string;
}): OddsenPayoutPlan {
  const { oddsenCfg, drawSequenceAtWin, winners, resolveColorFamily } = args;
  const { bucket, prizesTable } = selectOddsenBucket(
    oddsenCfg,
    drawSequenceAtWin,
  );

  // Aggregér vinnere per color-family.
  const counts = new Map<string, number>();
  for (const w of winners) {
    const family = resolveColorFamily(w.ticketColor);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  const groups: OddsenPayoutPlanGroup[] = [];
  const skippedColorFamilies: Array<{
    colorFamily: string;
    winnerCount: number;
  }> = [];

  for (const [family, count] of counts.entries()) {
    const perWinnerPrize = prizesTable[family] ?? 0;
    if (perWinnerPrize <= 0) {
      skippedColorFamilies.push({ colorFamily: family, winnerCount: count });
      continue;
    }
    groups.push({
      colorFamily: family,
      winnerCount: count,
      perWinnerPrizeCents: perWinnerPrize,
      totalPhasePrizeCents: perWinnerPrize * count,
    });
  }

  return {
    bucket,
    drawSequenceAtWin,
    targetDraw: oddsenCfg.targetDraw,
    groups,
    skippedColorFamilies,
  };
}

/**
 * Resolve Oddsen-config fra `ticket_config_json`. Returnerer `null` hvis
 * spillet ikke er en Oddsen-variant (vanlig spill bruker pattern-baserte
 * payouts via `patternPrizeToCents`).
 *
 * Spec (Tobias 2026-05-07): targetDraw er heltall ≥ 1 (typisk 55/56/57).
 * Per-farge low/high-prizes er int øre. Manglende eller invalide felter
 * → return null (fail-safe → fallback til normal pattern-payout).
 */
export function resolveOddsenConfig(
  rawTicketConfig: unknown,
): Game1OddsenConfig | null {
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
  const spill1 = obj.spill1;
  if (!spill1 || typeof spill1 !== "object" || Array.isArray(spill1)) {
    return null;
  }
  const oddsenRaw = (spill1 as Record<string, unknown>).oddsen;
  if (!oddsenRaw || typeof oddsenRaw !== "object" || Array.isArray(oddsenRaw)) {
    return null;
  }
  const o = oddsenRaw as Record<string, unknown>;
  const targetDrawN =
    typeof o.targetDraw === "number"
      ? o.targetDraw
      : Number.parseInt(String(o.targetDraw), 10);
  if (
    !Number.isFinite(targetDrawN) ||
    !Number.isInteger(targetDrawN) ||
    targetDrawN < 1
  ) {
    return null;
  }
  const lowRaw = o.bingoLowPrizes;
  const highRaw = o.bingoHighPrizes;
  if (
    !lowRaw ||
    typeof lowRaw !== "object" ||
    Array.isArray(lowRaw) ||
    !highRaw ||
    typeof highRaw !== "object" ||
    Array.isArray(highRaw)
  ) {
    return null;
  }
  const bingoLowPrizes: Record<string, number> = {};
  const bingoHighPrizes: Record<string, number> = {};
  for (const [k, v] of Object.entries(lowRaw as Record<string, unknown>)) {
    const n = numberOrZero(v);
    if (n > 0) bingoLowPrizes[k.toLowerCase()] = Math.round(n);
  }
  for (const [k, v] of Object.entries(highRaw as Record<string, unknown>)) {
    const n = numberOrZero(v);
    if (n > 0) bingoHighPrizes[k.toLowerCase()] = Math.round(n);
  }
  if (Object.keys(bingoLowPrizes).length === 0) return null;
  return { targetDraw: targetDrawN, bingoLowPrizes, bingoHighPrizes };
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
