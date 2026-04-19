/**
 * Unit tests for PatternCycler — per-round threshold state machine for Game 3.
 *
 * Covers:
 * - threshold-deaktivering (pattern active until drawnCount > ballThreshold)
 * - `changed` flag only true when active-list mutates
 * - Full House ignores threshold (always active until won)
 * - `markWon` removes pattern from active and `allResolved`
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { PatternCycler } from "./PatternCycler.js";
import type { PatternSpec } from "./PatternCycler.js";
import { FULL_HOUSE_MASK, ROW_1_MASKS } from "./PatternMatcher.js";

function spec(
  id: string,
  name: string,
  ballThreshold: number,
  isFullHouse = false,
  masks: readonly number[] = ROW_1_MASKS,
): PatternSpec {
  return {
    id,
    name,
    ballThreshold,
    isFullHouse,
    masks,
    prize: 100,
    prizeMode: "cash",
    isPatternWin: false,
  };
}

// ── Threshold behaviour ─────────────────────────────────────────────────────

describe("PatternCycler threshold deactivation", () => {
  test("pattern active at drawnCount === ballThreshold", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 15)]);
    const r = c.step(15);
    assert.equal(r.activePatterns.length, 1);
    assert.equal(r.activePatterns[0].id, "p1");
    assert.equal(r.deactivatedPatterns.length, 0);
  });

  test("pattern deactivates when drawnCount > ballThreshold", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 15)]);
    c.step(15); // initialise as active
    const r = c.step(16);
    assert.equal(r.activePatterns.length, 0);
    assert.equal(r.deactivatedPatterns.length, 1);
    assert.equal(r.deactivatedPatterns[0].id, "p1");
    assert.equal(r.deactivatedPatterns[0].isPatternWin, true);
  });

  test("deactivation is single-shot (deactivatedPatterns empty on subsequent steps)", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 10)]);
    c.step(10);
    const first = c.step(11);
    assert.equal(first.deactivatedPatterns.length, 1);
    const second = c.step(12);
    assert.equal(second.deactivatedPatterns.length, 0);
    assert.equal(second.activePatterns.length, 0);
  });

  test("multiple patterns with different thresholds deactivate independently", () => {
    const c = new PatternCycler([
      spec("row1", "Row 1", 10),
      spec("row2", "Row 2", 20),
      spec("row3", "Row 3", 30),
    ]);
    c.step(5);
    // At drawn=15: row1 deactivates, row2+row3 still active.
    const r15 = c.step(15);
    assert.deepEqual(r15.activePatterns.map((s) => s.id).sort(), ["row2", "row3"]);
    assert.deepEqual(r15.deactivatedPatterns.map((s) => s.id), ["row1"]);

    // At drawn=25: row2 deactivates.
    const r25 = c.step(25);
    assert.deepEqual(r25.activePatterns.map((s) => s.id), ["row3"]);
    assert.deepEqual(r25.deactivatedPatterns.map((s) => s.id), ["row2"]);
  });

  test("pattern whose threshold is already exceeded on FIRST step deactivates immediately", () => {
    // Replay scenario: cycler constructed at drawnCount=20 with threshold=10.
    const c = new PatternCycler([spec("p1", "Row 1", 10)]);
    const r = c.step(20);
    assert.equal(r.activePatterns.length, 0);
    // No prior active-set to transition from, so we do mark it deactivated.
    assert.equal(r.deactivatedPatterns.length, 1);
  });
});

// ── Full House / no-threshold ───────────────────────────────────────────────

describe("PatternCycler Full House", () => {
  test("isFullHouse ignores threshold (always active until won)", () => {
    const c = new PatternCycler([
      spec("fh", "Coverall", 5, true, [FULL_HOUSE_MASK]),
    ]);
    // Even at draw 100, far beyond threshold, Full House stays active.
    const r = c.step(100);
    assert.equal(r.activePatterns.length, 1);
    assert.equal(r.activePatterns[0].id, "fh");
  });

  test("Full House still deactivates when markWon is called", () => {
    const c = new PatternCycler([
      spec("fh", "Coverall", 5, true, [FULL_HOUSE_MASK]),
    ]);
    c.step(10);
    c.markWon("fh");
    const r = c.step(11);
    assert.equal(r.activePatterns.length, 0);
  });

  test("Full House mixes correctly with threshold patterns", () => {
    const c = new PatternCycler([
      spec("row1", "Row 1", 10),
      spec("fh", "Coverall", 999, true, [FULL_HOUSE_MASK]),
    ]);
    const r5 = c.step(5);
    assert.equal(r5.activePatterns.length, 2);

    const r50 = c.step(50);
    // row1 gone, fh remains.
    assert.deepEqual(r50.activePatterns.map((s) => s.id), ["fh"]);
  });
});

// ── `changed` flag semantics ────────────────────────────────────────────────

describe("PatternCycler changed flag", () => {
  test("changed=true on first step with any active patterns", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 15)]);
    const r = c.step(5);
    assert.equal(r.changed, true);
  });

  test("changed=false on first step when no patterns are active", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 10)]);
    const r = c.step(11); // already past threshold
    // All patterns deactivate — the active set goes from {} → {}, so `changed`
    // should be false even though there WAS a deactivation event. Engine uses
    // `changed` to decide whether to broadcast an active-set refresh; the
    // deactivatedPatterns array signals the transition separately.
    // Actually: spec says "changed=true only when aktiv-listen muteres". Empty
    // → empty is no mutation. But the very first initialisation does flip the
    // `initialised` flag. Confirming spec wins: no change in active set.
    assert.equal(r.changed, false);
  });

  test("changed=true on the step where active set shrinks", () => {
    const c = new PatternCycler([
      spec("p1", "Row 1", 10),
      spec("p2", "Row 2", 20),
    ]);
    c.step(5); // initialise active = {p1, p2}
    const r = c.step(6); // no change
    assert.equal(r.changed, false);
    const r2 = c.step(15); // p1 deactivates
    assert.equal(r2.changed, true);
  });

  test("changed=false when active set is stable across multiple draws", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 20)]);
    c.step(5);
    for (let i = 6; i <= 15; i += 1) {
      const r = c.step(i);
      assert.equal(r.changed, false, `changed=true at draw ${i}`);
    }
  });

  test("changed=true when markWon removes a pattern", () => {
    const c = new PatternCycler([
      spec("p1", "Row 1", 50),
      spec("p2", "Row 2", 50),
    ]);
    c.step(5); // {p1, p2}
    c.markWon("p1");
    const r = c.step(6);
    assert.equal(r.changed, true);
    assert.deepEqual(r.activePatterns.map((s) => s.id), ["p2"]);
  });
});

// ── markWon / allResolved ───────────────────────────────────────────────────

describe("PatternCycler markWon and allResolved", () => {
  test("markWon removes pattern from active list", () => {
    const c = new PatternCycler([
      spec("p1", "Row 1", 50),
      spec("p2", "Row 2", 50),
    ]);
    c.step(5);
    c.markWon("p1");
    const r = c.step(6);
    assert.deepEqual(r.activePatterns.map((s) => s.id), ["p2"]);
  });

  test("markWon on unknown id is no-op", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 50)]);
    c.markWon("unknown");
    const r = c.step(5);
    assert.equal(r.activePatterns.length, 1);
  });

  test("markWon twice is idempotent", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 50)]);
    c.step(5);
    c.markWon("p1");
    c.markWon("p1");
    const r = c.step(6);
    assert.equal(r.activePatterns.length, 0);
  });

  test("allResolved true only when every pattern is won OR deactivated", () => {
    const c = new PatternCycler([
      spec("p1", "Row 1", 10),
      spec("p2", "Coverall", 999, true, [FULL_HOUSE_MASK]),
    ]);
    assert.equal(c.allResolved(), false);
    c.step(11); // p1 deactivates, p2 still active
    assert.equal(c.allResolved(), false);
    c.markWon("p2");
    assert.equal(c.allResolved(), true);
  });

  test("snapshot returns specs including resolved state", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 10)]);
    c.step(5);
    c.markWon("p1");
    const snap = c.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0].isPatternWin, true);
  });
});

// ── Defensive copy ──────────────────────────────────────────────────────────

describe("PatternCycler defensive copy", () => {
  test("external mutation of input spec does not affect cycler state", () => {
    const input = spec("p1", "Row 1", 10);
    const c = new PatternCycler([input]);
    // Mutate input after construction.
    input.isPatternWin = true;
    const r = c.step(5);
    // Cycler should still treat p1 as active.
    assert.equal(r.activePatterns.length, 1);
  });
});

// ── Boundary cases ──────────────────────────────────────────────────────────

describe("PatternCycler boundary cases", () => {
  test("drawnCount = 0 works (no draws yet)", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 15)]);
    const r = c.step(0);
    assert.equal(r.activePatterns.length, 1);
  });

  test("empty spec list returns empty active and no changes", () => {
    const c = new PatternCycler([]);
    const r = c.step(10);
    assert.deepEqual(r.activePatterns, []);
    assert.deepEqual(r.deactivatedPatterns, []);
    assert.equal(r.changed, false);
    assert.equal(c.allResolved(), true);
  });

  test("pattern with threshold=0 deactivates at drawnCount=1", () => {
    const c = new PatternCycler([spec("p1", "Row 1", 0)]);
    const r0 = c.step(0);
    assert.equal(r0.activePatterns.length, 1);
    const r1 = c.step(1);
    assert.equal(r1.activePatterns.length, 0);
    assert.equal(r1.deactivatedPatterns.length, 1);
  });
});
