/**
 * @vitest-environment happy-dom
 *
 * CenterTopPanel tests (PR-5 C3 — Update_Pattern_Amount flash).
 *
 * Unity parity: PrefabBingoGame1Pattern.Update_Pattern_Amount
 * (PrefabBingoGame1Pattern.cs:107-110) writes the new `amount` to
 * `txtAmount.text`. The web port adds a GSAP flash (scale 1.0 → 1.2,
 * yoyo; colour #ffe83d → baseline) so players notice mid-round payout
 * changes — visual reinforcement for the same underlying data update.
 *
 * We verify that:
 *   1. The first render seeds the amount without triggering a flash
 *      (no "previous" value to diff against).
 *   2. A re-render with the same amount does NOT flash.
 *   3. A re-render with a changed amount DOES flash (GSAP tween active
 *      on the row's span).
 *   4. Once a pattern is won, subsequent updates do NOT flash (guards
 *      against spurious flashes during the Unity-style green-check
 *      highlight state).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import gsap from "gsap";
import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";
import { CenterTopPanel } from "./CenterTopPanel.js";
import { HtmlOverlayManager } from "./HtmlOverlayManager.js";

function ensureResizeObserver(): void {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

function makePanel(): { panel: CenterTopPanel; container: HTMLElement; overlay: HtmlOverlayManager } {
  ensureResizeObserver();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const overlay = new HtmlOverlayManager(container);
  const panel = new CenterTopPanel(overlay);
  return { panel, container, overlay };
}

const PATTERNS: PatternDefinition[] = [
  { id: "row1", name: "Row 1", claimType: "LINE", design: 1, prizePercent: 10, order: 1 },
  { id: "row2", name: "Row 2", claimType: "LINE", design: 1, prizePercent: 15, order: 2 },
];

function results(row1Payout?: number, row1Won = false): PatternResult[] {
  const out: PatternResult[] = [];
  if (row1Payout !== undefined) {
    out.push({
      patternId: "row1",
      patternName: "Row 1",
      claimType: "LINE",
      isWon: row1Won,
      payoutAmount: row1Payout,
    });
  }
  return out;
}

function findSpanForPattern(container: HTMLElement, displayNamePrefix: string): HTMLSpanElement | null {
  const spans = container.querySelectorAll("span");
  for (const s of spans) {
    if (s.textContent && s.textContent.includes(displayNamePrefix)) return s as HTMLSpanElement;
  }
  return null;
}

describe("CenterTopPanel — Update_Pattern_Amount flash (PR-5 C3)", () => {
  let panel: CenterTopPanel;
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;

  beforeEach(() => {
    ({ panel, container, overlay } = makePanel());
  });

  afterEach(() => {
    panel.destroy();
    overlay.destroy();
    container.remove();
  });

  it("does NOT flash on the first render (no previous amount to diff)", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    expect(gsap.getTweensOf(span!).length).toBe(0);
  });

  it("does NOT flash when the amount is unchanged", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    panel.updatePatterns(PATTERNS, results(100), 1000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    expect(gsap.getTweensOf(span!).length).toBe(0);
  });

  it("DOES flash when the payout amount for a pattern changes", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    panel.updatePatterns(PATTERNS, results(150), 1000);

    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    // Two tweens queued by flashAmount: one scale yoyo, one colour tween.
    expect(gsap.getTweensOf(span!).length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flash once a pattern is won (green-check state is terminal)", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    // Mark as won with a different payout — still shouldn't flash.
    panel.updatePatterns(PATTERNS, results(200, /* won */ true), 1000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    expect(gsap.getTweensOf(span!).length).toBe(0);
  });

  it("prunes tracking state for patterns that disappear between rounds", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    // New round with only row2 — row1 should be forgotten, so when it
    // reappears it's a "first render" and must NOT flash.
    const onlyRow2: PatternDefinition[] = [PATTERNS[1]];
    panel.updatePatterns(onlyRow2, [], 1000);
    panel.updatePatterns(PATTERNS, results(100), 1000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    expect(gsap.getTweensOf(span!).length).toBe(0);
  });
});
