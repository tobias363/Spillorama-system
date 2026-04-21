/**
 * Game variant configuration — ticket types, patterns, and multipliers.
 *
 * Ports the old AIS subGame1 system where admin configures:
 * - gameName → gameType ("standard" | "elvis" | "traffic-light")
 * - ticketColor → array of {name, type} with prices
 * - winning patterns → configurable per variant
 *
 * Stored in hall_game_schedules.variant_config JSONB column.
 *
 * References:
 * - unity-bingo-backend/Game/Game1/Controllers/GameController-old.js:78-84
 * - unity-bingo-backend/Game/Game1/Controllers/GameController-old.js:873-1034
 * - Unity: Game1GamePlayPanel.UpcomingGames.cs:Get_Ticket_Weight()
 */

import type { PatternDefinition } from "./types.js";

// ── Ticket type config ────────────────────────────────────────────────────────

export interface TicketTypeConfig {
  /** Display name matching Unity TicketColorManager, e.g. "Small Yellow", "Elvis 1". */
  name: string;
  /** Type code: "small", "large", "elvis", "traffic-light". */
  type: string;
  /** How many units of entryFee this ticket costs. small=1, large=3, elvis=2. */
  priceMultiplier: number;
  /** How many actual bingo tickets are generated per purchase. small=1, large=3, elvis=2. */
  ticketCount: number;
  /** For traffic-light: the 3 colors assigned to the generated tickets. */
  colors?: string[];
}

// ── Pattern config ────────────────────────────────────────────────────────────

export interface PatternConfig {
  name: string;
  claimType: "LINE" | "BINGO";
  /** Prize as percentage of pot (used for standard). 0 = use fixedPrize. */
  prizePercent: number;
  /** Fixed prize in kr (used for fixed-amount variants like Innsatsen). 0 = use prizePercent. */
  fixedPrize?: number;
  /** UI design: 0=custom mask, 1=single row, 2=two rows, 3=three rows, 4=four rows. */
  design: number;
  /** For design 0: 25-element bitmask (1=fill, 0=empty). */
  patternDataList?: number[];
  /**
   * BIN-615 / PR-C3b: G3 — pattern deactivates after this many balls drawn
   * without a winner. Absent for G1/G2 patterns and for Full House / Coverall
   * (those ignore threshold).
   * Legacy ref: `gamehelper/game3.js:738` (`obj.ballNumber >= count`).
   */
  ballNumberThreshold?: number;
  /**
   * BIN-615 / PR-C3b: G3 — fixed-kr prize amount when pattern wins. Used when
   * `winningType === "fixed"`. Legacy field name: prize1.
   */
  prize1?: number;
  /**
   * BIN-615 / PR-C3b: G3 — prize-calculation variant. "percent" = prizePercent
   * of pool (default). "fixed" = prize1 is a fixed kr amount.
   */
  winningType?: "percent" | "fixed";
}

// ── Full variant config ───────────────────────────────────────────────────────

export interface GameVariantConfig {
  ticketTypes: TicketTypeConfig[];
  patterns: PatternConfig[];
  /** Elvis-specific: price to replace tickets between rounds. */
  replaceAmount?: number;
  /** BIN-465: Bonus prize (kr) if player's lucky number is drawn. Default: 0 (no bonus). */
  luckyNumberPrize?: number;
  /** BIN-461: Jackpot config — prize awarded if Full House is won within N draws. */
  jackpot?: {
    /** Draw number at which jackpot is active (e.g. 56 means "Full House within 56 balls"). */
    drawThreshold: number;
    /** Jackpot prize amount in kr. */
    prize: number;
    /** If true, show jackpot info to players. */
    isDisplay: boolean;
  };
  /**
   * BIN-615 / PR-C1: Maximum ball value (inclusive) for this variant.
   * Standard/Elvis/TrafficLight = 60, Bingo75 = 75, Game 2 Rocket/Tallspill = 21.
   * Falls back to gameSlug-derived default when omitted (keeps existing configs valid).
   */
  maxBallValue?: number;
  /**
   * BIN-615 / PR-C1: Number of balls generated into the draw bag.
   * Typically equal to maxBallValue. Legacy Game 2 draws from 1..21 with bag size 21.
   */
  drawBagSize?: number;
  /**
   * BIN-615 / PR-C1: When to evaluate patterns for winners.
   * - "manual-claim" (default): evaluate only on explicit claim:submit from player (G1 behaviour).
   * - "auto-claim-on-draw": evaluate after every draw server-side (G2 full-plate, G3 patterns).
   */
  patternEvalMode?: "manual-claim" | "auto-claim-on-draw";
  /**
   * BIN-615 / PR-C2: Game 2 jackpot-number-table — per-draw-count prize mapping.
   *
   * Legacy ref: Game/Common/Controllers/GameController.js:28-35 (createGame2JackpotDefinition)
   * and gamehelper/game2.js:1466-1625 (normalizeGame2JackpotData + processJackpotNumbers).
   *
   * Keys are draw-count strings: "9", "10", "11", "12", "13" and the special
   * "1421" entry which matches any draw count in the 14..21 range (legacy
   * "1421" bucket, see GameProcess.js:1538-1540).
   *
   * Value shape:
   *   - { price: N, isCash: true }  → fixed kr amount, paid when that draw-count hits
   *   - { price: P, isCash: false } → P percent of (ticketCount × ticketPrice), computed at payout
   *
   * Multi-winner split: price / winnerCount (legacy game2.js:1550-1553),
   * rounded via Math.round, audited through PayoutAuditTrail.
   */
  jackpotNumberTable?: Record<string, { price: number; isCash: boolean }>;
  /**
   * BIN-694: Når satt, evaluerer engine `evaluateActivePhase` etter
   * hver draw (3-fase norsk 75-ball bingo). Kun DEFAULT_NORSK_BINGO_CONFIG
   * setter denne — G2/G3 har egen auto-claim via onDrawCompleted-override.
   */
  autoClaimPhaseMode?: boolean;
}

// ── Default configs ───────────────────────────────────────────────────────────

const DEFAULT_TICKET_COLORS = ["Small Yellow", "Small White", "Small Purple", "Small Red", "Small Green", "Small Orange"];

/**
 * Legacy "standard"-variant. Beholdt for bakoverkompatibilitet med
 * eldre tester + `gameType: "standard"`-rom som ikke er migrert til
 * norsk 3-fase-bingo. 4 separate LINE-pattern + Fullt Hus, manual-claim.
 *
 * Nye rom bør bruke `DEFAULT_NORSK_BINGO_CONFIG` (3-fase, auto-claim).
 */
export const DEFAULT_STANDARD_CONFIG: GameVariantConfig = {
  ticketTypes: [
    ...DEFAULT_TICKET_COLORS.map((name) => ({
      name, type: "small", priceMultiplier: 1, ticketCount: 1,
    })),
    { name: "Large Yellow", type: "large", priceMultiplier: 3, ticketCount: 3 },
    { name: "Large White", type: "large", priceMultiplier: 3, ticketCount: 3 },
  ],
  patterns: [
    { name: "Row 1", claimType: "LINE" as const, prizePercent: 10, design: 1 },
    { name: "Row 2", claimType: "LINE" as const, prizePercent: 10, design: 2 },
    { name: "Row 3", claimType: "LINE" as const, prizePercent: 10, design: 3 },
    { name: "Row 4", claimType: "LINE" as const, prizePercent: 10, design: 4 },
    { name: "Full House", claimType: "BINGO" as const, prizePercent: 60, design: 0 },
  ],
};

/**
 * BIN-694: Norsk 75-ball bingo — 5 sekvensielle faser.
 *
 * Avklart av Tobias 2026-04-20:
 * - **Fase 1 (1 Rad)**: 1 hel rad (vannrett) ELLER 1 hel kolonne (loddrett)
 * - **Fase 2 (2 Rader)**: ≥2 hele vertikale kolonner (kun loddrett)
 * - **Fase 3 (3 Rader)**: ≥3 hele vertikale kolonner (kun loddrett)
 * - **Fase 4 (4 Rader)**: ≥4 hele vertikale kolonner (kun loddrett)
 * - **Fase 5 (Fullt Hus)**: alle 25 felt merket
 *
 * Ingen diagonaler teller i noen fase. "Rad N" i fase-terminologien
 * betyr **N hele vertikale kolonner** (ikke N horisontale rader) —
 * fase 1 er den eneste fasen som godtar horisontal rad.
 *
 * Trekningen stopper aldri mellom fasene — fortsetter til Fullt Hus er
 * vunnet. Ved samtidige vinnere i samme fase (flere spillere oppfyller
 * kravet ved samme trukket ball) deles premien likt (floor-div).
 *
 * Premie-prosenter 15/15/15/15/40 (sum 100%) — overstyrbar per hall
 * via `hall_game_schedules.variant_config` JSONB.
 *
 * `claimType` gjenbrukes fra eksisterende kontrakt:
 *   - "LINE"  = fase 1-4 (backend avgjør fase via pattern-navn)
 *   - "BINGO" = fase 5 (Fullt Hus)
 *
 * `patternEvalMode: "auto-claim-on-draw"` — server sjekker alle brett
 * etter hver trukket ball. Server-autoritativ evaluering basert på
 * `game.drawnNumbers` (ikke `game.marks`) slik at spillere som ikke
 * aktivt merker sine brett fortsatt får premie automatisk.
 */
export const DEFAULT_NORSK_BINGO_CONFIG: GameVariantConfig = {
  ticketTypes: [
    ...DEFAULT_TICKET_COLORS.map((name) => ({
      name, type: "small", priceMultiplier: 1, ticketCount: 1,
    })),
    { name: "Large Yellow", type: "large", priceMultiplier: 3, ticketCount: 3 },
    { name: "Large White", type: "large", priceMultiplier: 3, ticketCount: 3 },
  ],
  // Faste premiebeløp (2026-04-21, Tobias): 100 / 200 / 200 / 200 / 1000 kr.
  // `winningType: "fixed"` + `prize1` overstyrer `prizePercent` i
  // BingoEngine.evaluateActivePhase. Ved lav pool/RTP blir utbetaling capet
  // av eksisterende `applySinglePrizeCap` + `remainingPrizePool` i
  // payoutPhaseWinner — huset dekker ikke differansen.
  patterns: [
    { name: "1 Rad",    claimType: "LINE" as const,  prizePercent: 0, design: 1, winningType: "fixed" as const, prize1: 100 },
    { name: "2 Rader",  claimType: "LINE" as const,  prizePercent: 0, design: 2, winningType: "fixed" as const, prize1: 200 },
    { name: "3 Rader",  claimType: "LINE" as const,  prizePercent: 0, design: 3, winningType: "fixed" as const, prize1: 200 },
    { name: "4 Rader",  claimType: "LINE" as const,  prizePercent: 0, design: 4, winningType: "fixed" as const, prize1: 200 },
    { name: "Fullt Hus", claimType: "BINGO" as const, prizePercent: 0, design: 0, winningType: "fixed" as const, prize1: 1000 },
  ],
  patternEvalMode: "auto-claim-on-draw",
  autoClaimPhaseMode: true,
  maxBallValue: 75,
  drawBagSize: 75,
};

export const DEFAULT_ELVIS_CONFIG: GameVariantConfig = {
  ticketTypes: [
    { name: "Elvis 1", type: "elvis", priceMultiplier: 2, ticketCount: 2 },
    { name: "Elvis 2", type: "elvis", priceMultiplier: 2, ticketCount: 2 },
    { name: "Elvis 3", type: "elvis", priceMultiplier: 2, ticketCount: 2 },
    { name: "Elvis 4", type: "elvis", priceMultiplier: 2, ticketCount: 2 },
    { name: "Elvis 5", type: "elvis", priceMultiplier: 2, ticketCount: 2 },
  ],
  patterns: DEFAULT_STANDARD_CONFIG.patterns,
  replaceAmount: 0,
};

export const DEFAULT_TRAFFIC_LIGHT_CONFIG: GameVariantConfig = {
  ticketTypes: [
    { name: "Traffic Light", type: "traffic-light", priceMultiplier: 3, ticketCount: 3,
      colors: ["Small Red", "Small Yellow", "Small Green"] },
  ],
  patterns: DEFAULT_STANDARD_CONFIG.patterns,
};

/**
 * BIN-615 / PR-C2: Game 2 (Rocket/Tallspill) default variant config.
 *
 * - Single 3×3-ticket type, priceMultiplier=1 (legacy G2 uses flat ticket price)
 * - 1..21 drawbag, max 21 draws (Helper/bingo.js:996-1012, GameProcess.js:167,175)
 * - No patterns (full-plate-only winner predicate via hasFull3x3)
 * - patternEvalMode="auto-claim-on-draw" — Game2Engine auto-checks after each draw
 * - jackpotNumberTable matches PM-approved values:
 *     Draw 9 → 25 000 kr fixed
 *     Draw 14-21 → 5% of pool (ticketCount × ticketPrice)
 */
export const DEFAULT_GAME2_CONFIG: GameVariantConfig = {
  ticketTypes: [
    { name: "Rocket", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 },
  ],
  patterns: [],
  maxBallValue: 21,
  drawBagSize: 21,
  patternEvalMode: "auto-claim-on-draw",
  jackpotNumberTable: {
    "9":    { price: 25000, isCash: true },
    "1421": { price: 5,     isCash: false }, // 5% of (ticketCount × ticketPrice)
  },
};

/**
 * BIN-615 / PR-C3b: Game 3 (Mønsterbingo) default variant config.
 *
 * - 5×5 1..75 tickets (no free centre) — see `generate5x5NoCenterTicket`
 * - maxBallValue=75, drawBagSize=75 (Helper/bingo.js:1014-1031, gamehelper/game3.js:663)
 * - patternEvalMode="auto-claim-on-draw" — Game3Engine auto-claims per draw
 * - Patterns: Row 1-4 (10% each) + Full House / Coverall (60%). Real halls
 *   override this with admin-defined patterns including custom 25-bit masks.
 * - No `jackpotNumberTable` — distinguishes G3 from G2 in the guard path.
 *
 * Legacy ref: gamehelper/game3.js:663-708 (`createGameData`), Helper/bingo.js:
 * 1197-1356 (per-ticket pattern pre-compute).
 */
export const DEFAULT_GAME3_CONFIG: GameVariantConfig = {
  ticketTypes: [
    ...DEFAULT_TICKET_COLORS.map((name) => ({
      name, type: "small", priceMultiplier: 1, ticketCount: 1,
    })),
    { name: "Large Yellow", type: "large", priceMultiplier: 3, ticketCount: 3 },
  ],
  patterns: [
    { name: "Row 1", claimType: "LINE" as const, prizePercent: 10, design: 1, ballNumberThreshold: 15 },
    { name: "Row 2", claimType: "LINE" as const, prizePercent: 10, design: 2, ballNumberThreshold: 25 },
    { name: "Row 3", claimType: "LINE" as const, prizePercent: 10, design: 3, ballNumberThreshold: 40 },
    { name: "Row 4", claimType: "LINE" as const, prizePercent: 10, design: 4, ballNumberThreshold: 55 },
    { name: "Full House", claimType: "BINGO" as const, prizePercent: 60, design: 0 },
  ],
  maxBallValue: 75,
  drawBagSize: 75,
  patternEvalMode: "auto-claim-on-draw",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get default variant config for a game_type. */
export function getDefaultVariantConfig(gameType: string): GameVariantConfig {
  switch (gameType) {
    case "elvis": return DEFAULT_ELVIS_CONFIG;
    case "traffic-light": return DEFAULT_TRAFFIC_LIGHT_CONFIG;
    // BIN-615 / PR-C2: Game 2 Rocket/Tallspill — 3x3 + 1..21 drawbag
    case "game_2":
    case "rocket":
    case "tallspill":
      return DEFAULT_GAME2_CONFIG;
    // BIN-615 / PR-C3b: Game 3 Mønsterbingo — 5×5 no-centre + 1..75 drawbag
    case "game_3":
    case "monsterbingo":
    case "mønsterbingo":
      return DEFAULT_GAME3_CONFIG;
    // BIN-694: Norsk 75-ball bingo (Game 1) — 3-fase auto-claim
    case "game_1":
    case "bingo":
    case "norsk-bingo":
      return DEFAULT_NORSK_BINGO_CONFIG;
    // BIN-694: `"standard"` beholdt for eldre tester + legacy rom.
    // Nye G1-rom bruker `gameType: "bingo"` → DEFAULT_NORSK_BINGO_CONFIG.
    default: return DEFAULT_STANDARD_CONFIG;
  }
}

/** Parse variant_config from JSONB, with fallback to defaults. */
export function parseVariantConfig(json: unknown, gameType: string): GameVariantConfig {
  const defaults = getDefaultVariantConfig(gameType);
  if (!json || typeof json !== "object") return defaults;

  const obj = json as Record<string, unknown>;
  const patternEvalMode =
    obj.patternEvalMode === "auto-claim-on-draw" || obj.patternEvalMode === "manual-claim"
      ? obj.patternEvalMode
      : defaults.patternEvalMode;
  return {
    ticketTypes: Array.isArray(obj.ticketTypes) && obj.ticketTypes.length > 0
      ? (obj.ticketTypes as TicketTypeConfig[])
      : defaults.ticketTypes,
    patterns: Array.isArray(obj.patterns) && obj.patterns.length > 0
      ? (obj.patterns as PatternConfig[])
      : defaults.patterns,
    replaceAmount: typeof obj.replaceAmount === "number" ? obj.replaceAmount : defaults.replaceAmount,
    luckyNumberPrize: typeof obj.luckyNumberPrize === "number" ? obj.luckyNumberPrize : defaults.luckyNumberPrize,
    jackpot: (obj.jackpot && typeof obj.jackpot === "object")
      ? (obj.jackpot as GameVariantConfig["jackpot"])
      : defaults.jackpot,
    maxBallValue: typeof obj.maxBallValue === "number" && obj.maxBallValue > 0
      ? Math.floor(obj.maxBallValue)
      : defaults.maxBallValue,
    drawBagSize: typeof obj.drawBagSize === "number" && obj.drawBagSize > 0
      ? Math.floor(obj.drawBagSize)
      : defaults.drawBagSize,
    patternEvalMode,
    jackpotNumberTable: (obj.jackpotNumberTable && typeof obj.jackpotNumberTable === "object")
      ? (obj.jackpotNumberTable as GameVariantConfig["jackpotNumberTable"])
      : defaults.jackpotNumberTable,
  };
}

/** Convert PatternConfig[] to PatternDefinition[] (adds id and order). */
export function patternConfigToDefinitions(patterns: PatternConfig[]): PatternDefinition[] {
  return patterns.map((p, i) => {
    const def: PatternDefinition = {
      id: `pattern-${i}`,
      name: p.name,
      claimType: p.claimType,
      prizePercent: p.prizePercent,
      order: i,
      design: p.design,
    };
    if (p.patternDataList) def.patternDataList = [...p.patternDataList];
    // BIN-615 / PR-C3b: propagate G3 pattern metadata into PatternDefinition so
    // Game3Engine.buildCycler() can read it without re-resolving the variantConfig.
    if (typeof p.ballNumberThreshold === "number") def.ballNumberThreshold = p.ballNumberThreshold;
    if (typeof p.prize1 === "number") def.prize1 = p.prize1;
    if (p.winningType === "percent" || p.winningType === "fixed") def.winningType = p.winningType;
    return def;
  });
}

/**
 * BIN-688: expand armed `TicketSelection[]` to a per-ticket colour/type
 * list so pre-round tickets in `preRoundTickets` render in the exact
 * colour the player picked.
 *
 * Resolution order (first match wins):
 *   1. `selection.name` matches a `TicketTypeConfig.name` → use that
 *      config's name + type. Handles "Small Yellow" vs "Small Purple".
 *   2. `selection.type` matches a `TicketTypeConfig.type` → use that
 *      config's name (first match) + type. Handles legacy clients that
 *      only send the type code.
 *   3. Nothing matches → fall back to `assignTicketColors` sequential
 *      cycling for the remaining count.
 *
 * For each selection, we expand `qty × ticketCount` ticket-slots. For
 * bundle tickets (large=3 brett per kjøp, elvis=2, traffic-light=3), each
 * slot inherits the bundle's colour. Traffic-light is expanded via its
 * per-bundle `colors` triplet (Red/Yellow/Green) so each of the 3 brett
 * gets a distinct colour.
 */
export function expandSelectionsToTicketColors(
  selections: ReadonlyArray<{ type: string; qty: number; name?: string }>,
  variantConfig: GameVariantConfig,
  gameType: string,
): { color: string; type: string }[] {
  const out: { color: string; type: string }[] = [];
  const ticketTypes = variantConfig.ticketTypes;

  for (const sel of selections) {
    if (sel.qty <= 0) continue;

    // Prefer name-match (distinguishes Small Yellow vs Small Purple).
    let tt = sel.name
      ? ticketTypes.find((t) => t.name === sel.name)
      : undefined;
    // Fallback: match by type code (ambiguous for multi-colour types,
    // but preserves legacy-client behaviour).
    if (!tt) tt = ticketTypes.find((t) => t.type === sel.type);

    if (!tt) continue; // Unknown type — skipped; filled by fallback below.

    const slotsPerQty = Math.max(1, tt.ticketCount);
    for (let q = 0; q < sel.qty; q++) {
      // Traffic-light: each bundle yields 3 brett in distinct colours.
      if (tt.type === "traffic-light" && tt.colors && tt.colors.length > 0) {
        for (let s = 0; s < slotsPerQty; s++) {
          const c = tt.colors[s % tt.colors.length];
          out.push({ color: c, type: "traffic-" + c.split(" ")[1]?.toLowerCase() });
        }
      } else {
        // Small/large/elvis: all brett in the bundle share the colour.
        for (let s = 0; s < slotsPerQty; s++) {
          out.push({ color: tt.name, type: tt.type });
        }
      }
    }
  }

  // If callers armed something we couldn't resolve (unknown selection
  // or zero-overlap) fall back so every slot still has a colour.
  if (out.length === 0) {
    return assignTicketColors(0, variantConfig, gameType);
  }
  return out;
}

/**
 * Determine ticket colors for a player based on variant config.
 *
 * For standard: cycle through available small colors.
 * For traffic-light: assign Red/Yellow/Green in groups of 3.
 * For elvis: assign Elvis color (all same).
 */
export function assignTicketColors(
  ticketCount: number,
  variantConfig: GameVariantConfig,
  gameType: string,
): { color: string; type: string }[] {
  const assignments: { color: string; type: string }[] = [];

  if (gameType === "traffic-light") {
    // Traffic light: groups of 3 (Red, Yellow, Green)
    const colors = variantConfig.ticketTypes[0]?.colors ?? ["Small Red", "Small Yellow", "Small Green"];
    for (let i = 0; i < ticketCount; i++) {
      assignments.push({ color: colors[i % colors.length], type: "traffic-" + colors[i % colors.length].split(" ")[1].toLowerCase() });
    }
  } else if (gameType === "elvis") {
    // Elvis: all same color based on random Elvis 1-5
    const elvisTypes = variantConfig.ticketTypes.filter((t) => t.type === "elvis");
    const chosen = elvisTypes[Math.floor(Math.random() * elvisTypes.length)] ?? elvisTypes[0];
    for (let i = 0; i < ticketCount; i++) {
      assignments.push({ color: chosen?.name ?? "Elvis1", type: "elvis" });
    }
  } else {
    // Standard: cycle through small colors
    const smallTypes = variantConfig.ticketTypes.filter((t) => t.type === "small");
    for (let i = 0; i < ticketCount; i++) {
      const tt = smallTypes[i % smallTypes.length];
      assignments.push({ color: tt?.name ?? DEFAULT_TICKET_COLORS[i % DEFAULT_TICKET_COLORS.length], type: "small" });
    }
  }

  return assignments;
}
