/**
 * BIN-615 / PR-C3: PatternCycler — per-round pattern threshold state machine.
 *
 * Ansvar: For a given round, hold the ordered list of PatternSpec and report
 * which patterns are active after each draw based on `ballNumber` threshold
 * and per-pattern `isPatternWin` state.
 *
 * Legacy reference: `gamehelper/game3.js:724-848` (`evaluatePatternsAndUpdate-
 * GameData`) — the key filter is at 738-745:
 *
 * ```js
 *   let availablePatterns = allPatternArray.filter(obj =>
 *     (obj.ballNumber >= count && obj.isPatternWin === "false") ||
 *     (!obj.patternType.includes(0) && obj.patternType !== '' && obj.isPatternWin === "false")
 *   );
 * ```
 *
 * Interpretation:
 * - `ballNumber` = the maximum draw index at which a pattern can still be won.
 *   While `drawnCount <= ballNumber` the pattern is active; at `drawnCount >
 *   ballNumber` (equivalently `parsedBallNumber < count` at bingo.js:800) the
 *   pattern deactivates and is marked `isPatternWin = "true"` to indicate
 *   closed-without-winner.
 * - Full-House patterns (legacy: `!patternType.includes(0)` → all 25 bits
 *   required) ignore the threshold and stay active until won.
 *
 * PR-C3 brief phrasing: "pattern aktivt til `drawnCount > ballNumberThreshold`".
 */
import type { PatternMask } from "@spillorama/shared-types";

/**
 * Per-round pattern descriptor consumed by the cycler. Converted from admin
 * Mongo docs at round start (snapshot copy — no live-binding, mirroring legacy
 * `allPatternArray` behaviour).
 */
export interface PatternSpec {
  /** Stable id — used by engine to mark winners and build emit payloads. */
  id: string;
  /** Display name — "Row 1", "Coverall", or custom name. */
  name: string;
  /**
   * Threshold — pattern deactivates when `drawnCount > ballThreshold` UNLESS
   * `isFullHouse` is true. Values < 0 mean "no threshold" (effectively always
   * active) but callers should prefer `isFullHouse: true`.
   */
  ballThreshold: number;
  /**
   * True if the pattern covers the entire 5×5 grid (Coverall / Full House) —
   * threshold is ignored and it stays active until won.
   */
  isFullHouse: boolean;
  /**
   * One or more 25-bit masks that satisfy this pattern. Row 1 has 10 masks
   * (any line), custom patterns typically have a single mask.
   */
  masks: readonly PatternMask[];
  /** Prize amount — interpreted by engine per `prizeMode`. */
  prize: number;
  /** "cash" = flat amount, "percent" = % of current prize pool. */
  prizeMode: "cash" | "percent";
  /**
   * Mutable — set to true by engine when a winner is found. Internal to the
   * cycler: `step()` also sets this when a pattern is deactivated without a
   * winner, matching legacy `finalObj.isWon = true` at bingo.js:800-802.
   */
  isPatternWin: boolean;
}

/**
 * Result of a single `step()` call.
 *
 * - `activePatterns` — patterns that should currently accept winners.
 * - `deactivatedPatterns` — patterns that transitioned from active → closed on
 *   this step (threshold exceeded without winner). Useful for the engine to
 *   emit "pattern closed" in its PatternChange payload.
 * - `changed` — true if the active set changed since the previous step. The
 *   engine uses this to decide whether to broadcast `g3:pattern:changed`
 *   (legacy parity: bingo.js:822 `if (currentPatternList.length !== currentLength …)`).
 */
export interface CyclerStep {
  activePatterns: PatternSpec[];
  deactivatedPatterns: PatternSpec[];
  changed: boolean;
}

/**
 * Per-round state machine over a snapshot of PatternSpecs. Not thread-safe;
 * one instance per room/round.
 */
export class PatternCycler {
  private readonly specs: PatternSpec[];
  private lastActiveIds: Set<string> = new Set();
  private initialised = false;

  constructor(specs: PatternSpec[]) {
    // Defensive copy so external mutations don't race with our isPatternWin
    // updates. We DO NOT deep-clone masks (readonly arrays); only the wrapper
    // object is copied.
    this.specs = specs.map((s) => ({ ...s }));
  }

  /**
   * Advance the cycler to the given draw count and return the active set.
   *
   * Semantics:
   * - A pattern is active iff `!isPatternWin` AND (`isFullHouse` OR
   *   `drawnCount <= ballThreshold`).
   * - On the transition where a pattern becomes inactive (threshold exceeded
   *   without winner), we set `isPatternWin = true` and report it in
   *   `deactivatedPatterns`. This mirrors legacy bingo.js:800-808.
   * - `changed` is true iff the set of active ids differs from the previous
   *   call (or this is the first call and there are active patterns).
   */
  step(drawnCount: number): CyclerStep {
    const active: PatternSpec[] = [];
    const deactivated: PatternSpec[] = [];

    for (const spec of this.specs) {
      if (spec.isPatternWin) continue;

      const withinThreshold = spec.isFullHouse || drawnCount <= spec.ballThreshold;
      if (withinThreshold) {
        active.push(spec);
      } else if (this.lastActiveIds.has(spec.id) || !this.initialised) {
        // Transition active → closed without winner. Even on the very first
        // step we want to mark patterns whose threshold was already exceeded
        // (e.g. replay scenarios where we start mid-round).
        spec.isPatternWin = true;
        deactivated.push(spec);
      }
    }

    const activeIds = new Set(active.map((s) => s.id));
    const changed = !sameIdSet(activeIds, this.lastActiveIds) || (!this.initialised && active.length > 0);
    this.lastActiveIds = activeIds;
    this.initialised = true;

    return { activePatterns: active, deactivatedPatterns: deactivated, changed };
  }

  /**
   * Mark the given pattern as won. Engine calls this after auto-claim
   * processing so the next `step()` excludes it from active.
   *
   * No-op if the pattern id is unknown or already won.
   */
  markWon(patternId: string): void {
    const spec = this.specs.find((s) => s.id === patternId);
    if (spec && !spec.isPatternWin) {
      spec.isPatternWin = true;
      // Intentionally do NOT touch `lastActiveIds` here: we want the next
      // `step()` to observe that the active set shrunk and report `changed=true`.
    }
  }

  /** True when every pattern has `isPatternWin === true`. */
  allResolved(): boolean {
    return this.specs.every((s) => s.isPatternWin);
  }

  /**
   * Read-only view of the underlying specs (including resolved patterns) —
   * used by the engine to build `PatternChange` payloads that include the
   * full pattern list.
   */
  snapshot(): readonly PatternSpec[] {
    return this.specs;
  }
}

/** True iff two sets contain exactly the same string keys. */
function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
