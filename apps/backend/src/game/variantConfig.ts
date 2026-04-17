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
}

// ── Default configs ───────────────────────────────────────────────────────────

const DEFAULT_TICKET_COLORS = ["Small Yellow", "Small White", "Small Purple", "Small Red", "Small Green", "Small Orange"];

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get default variant config for a game_type. */
export function getDefaultVariantConfig(gameType: string): GameVariantConfig {
  switch (gameType) {
    case "elvis": return DEFAULT_ELVIS_CONFIG;
    case "traffic-light": return DEFAULT_TRAFFIC_LIGHT_CONFIG;
    default: return DEFAULT_STANDARD_CONFIG;
  }
}

/** Parse variant_config from JSONB, with fallback to defaults. */
export function parseVariantConfig(json: unknown, gameType: string): GameVariantConfig {
  const defaults = getDefaultVariantConfig(gameType);
  if (!json || typeof json !== "object") return defaults;

  const obj = json as Record<string, unknown>;
  return {
    ticketTypes: Array.isArray(obj.ticketTypes) && obj.ticketTypes.length > 0
      ? (obj.ticketTypes as TicketTypeConfig[])
      : defaults.ticketTypes,
    patterns: Array.isArray(obj.patterns) && obj.patterns.length > 0
      ? (obj.patterns as PatternConfig[])
      : defaults.patterns,
    replaceAmount: typeof obj.replaceAmount === "number" ? obj.replaceAmount : defaults.replaceAmount,
  };
}

/** Convert PatternConfig[] to PatternDefinition[] (adds id and order). */
export function patternConfigToDefinitions(patterns: PatternConfig[]): PatternDefinition[] {
  return patterns.map((p, i) => ({
    id: `pattern-${i}`,
    name: p.name,
    claimType: p.claimType,
    prizePercent: p.prizePercent,
    order: i,
    design: p.design,
  }));
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
