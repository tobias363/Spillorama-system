/**
 * BIN-615 / PR-C1: Sub-game sequence planner for Game 2 (Tallspill / Spill 2)
 * and Game 3 (Mønsterbingo).
 *
 * Pure planning logic — no DB I/O. PlatformService owns persistence.
 *
 * Legacy reference: Game/Common/Controllers/GameController.js:334-521 (createChildGame):
 *   - Each parent spawns N sequential children (one per entry in subGames[]).
 *   - Child gameNumber format: "CH_<seq>_<createID>_G2" or "CH_<seq>_<createID>_G3".
 *   - G3 patterns are sorted by ascending fill-count before children are written
 *     (rows win first, then custom patterns by count of 1s in the 25-bitmask).
 *
 * Eager creation (match legacy 1:1 — decision per PM Q3):
 *   - All children are planned up front when the parent is created.
 *   - Lazy "create next child when current ends" is explicitly out of scope for PR-C1.
 */

import type { PatternConfig } from "./variantConfig.js";

export type SubGameParentType = "game_2" | "game_3";

/**
 * Input for a single sub-game. variantConfig is per-sub-game and matches the
 * JSONB stored on hall_game_schedules.variant_config. Shape is sub-game-specific:
 *   - G2: { patterns, luckyNumberPrize, jackpotNumberTable, maxBallValue: 21, ... }
 *   - G3: { patterns, luckyNumberPrize, winningType, ... }
 */
export interface SubGameInput {
  /** Display name for this sub-game (legacy: subGame.name). */
  name: string;
  /** Ticket price in kr (legacy: subGame.ticketPrice). */
  ticketPrice: number;
  /** Full variant config for this specific sub-game. */
  variantConfig: Record<string, unknown>;
}

export interface PlanChildrenInput {
  /** Parent hall_game_schedules.id — children will reference this via parent_schedule_id. */
  parentScheduleId: string;
  /** Parent game type — determines the GX suffix in gameNumber. */
  gameType: SubGameParentType;
  /** Ordered list of sub-games to plan. Must be non-empty. */
  subGames: SubGameInput[];
  /**
   * Timestamp ID for gameNumber (legacy: dateTimeFunction(Date.now()) → YYYYMMDDHHmmss).
   * When omitted, derived from Date.now(). Provide for deterministic tests.
   */
  createID?: string;
}

export interface PlannedChildGame {
  /** 1-based sequence index within the parent. */
  sequence: number;
  /** Legacy-compatible gameNumber "CH_<seq>_<createID>_G2|G3". */
  subGameNumber: string;
  /** Display name propagated from SubGameInput. */
  displayName: string;
  /** Ticket price in kr. */
  ticketPrice: number;
  /** Per-sub-game variant config (patterns already sorted for G3). */
  variantConfig: Record<string, unknown>;
  /** Parent schedule id — convenience copy for callers. */
  parentScheduleId: string;
}

export class SubGameManager {
  /**
   * Plan the full child sequence for a parent game.
   *
   * Throws if subGames is empty — matches legacy behaviour that a parent with
   * zero sub-games is an invalid configuration (would create no children).
   */
  planChildren(input: PlanChildrenInput): PlannedChildGame[] {
    if (!input.subGames || input.subGames.length === 0) {
      throw new Error("SubGameManager.planChildren: subGames must be non-empty");
    }
    const suffix = input.gameType === "game_2" ? "G2" : "G3";
    const createID = input.createID ?? SubGameManager.defaultCreateID(Date.now());

    return input.subGames.map((sg, i) => {
      const sequence = i + 1;
      const variantConfig =
        input.gameType === "game_3"
          ? SubGameManager.withSortedG3Patterns(sg.variantConfig)
          : sg.variantConfig;
      return {
        sequence,
        subGameNumber: `CH_${sequence}_${createID}_${suffix}`,
        displayName: sg.name,
        ticketPrice: sg.ticketPrice,
        variantConfig,
        parentScheduleId: input.parentScheduleId,
      };
    });
  }

  /**
   * Legacy-compatible timestamp ID. Legacy uses dateTimeFunction(ms) which
   * returns "YYYYMMDDHHmmss". We replicate that format.
   */
  static defaultCreateID(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return (
      d.getUTCFullYear().toString() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds())
    );
  }

  /**
   * Returns a copy of the variantConfig with patterns sorted by ascending fill-count,
   * matching legacy Game3 ordering (GameController.js:451-460):
   *   - "Row 1".."Row 4" → fillCount = rowNumber × 5
   *   - Custom patterns → count of 1s in the 25-bitmask (patternDataList)
   *
   * This ensures simpler patterns are won first during the round.
   * Non-G3 configs and configs without patterns are returned unchanged.
   */
  static withSortedG3Patterns(
    variantConfig: Record<string, unknown>,
  ): Record<string, unknown> {
    const patterns = variantConfig.patterns;
    if (!Array.isArray(patterns) || patterns.length === 0) return variantConfig;
    const sorted = [...(patterns as PatternConfig[])].sort(
      (a, b) => SubGameManager.patternFillCount(a) - SubGameManager.patternFillCount(b),
    );
    return { ...variantConfig, patterns: sorted };
  }

  /**
   * Count the number of filled cells in a pattern — used to order G3 patterns.
   *
   * Legacy semantics:
   *   - "Row N" (N=1..4) → N × 5 (row covers 5 cells per row)
   *   - Custom pattern → number of 1s in patternDataList (25-cell bitmask)
   *   - Unknown → Number.POSITIVE_INFINITY (sort to end)
   */
  static patternFillCount(pattern: PatternConfig): number {
    const rowMatch = /^Row\s+(\d+)$/.exec(pattern.name);
    if (rowMatch) {
      const rowNumber = Number(rowMatch[1]);
      if (Number.isFinite(rowNumber) && rowNumber > 0) return rowNumber * 5;
    }
    if (Array.isArray(pattern.patternDataList)) {
      return pattern.patternDataList.reduce(
        (count, cell) => count + (cell === 1 ? 1 : 0),
        0,
      );
    }
    return Number.POSITIVE_INFINITY;
  }
}
