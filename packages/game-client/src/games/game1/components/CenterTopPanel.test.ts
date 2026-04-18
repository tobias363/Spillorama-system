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

/**
 * BIN-409 (D2) — persistent disable for the "Kjøp flere brett" button.
 *
 * Unity parity: `Game1GamePlayPanel.cs:170` `BuyMoreDisableFlagVal`; per-ball
 * sjekk i `.SocketFlow.cs:109-113, :457-461, :485-489`; server-gitt threshold
 * i `.SocketFlow.cs:174`.
 *
 * Rotårsak for BIN-451-buggen: `showButtonFeedback("buyMore", false)` brukte
 * en 1.5 s setTimeout som reset knappen — så spillere kunne klikke "Kjøp flere"
 * igjen etter et par sekunder selv om serveren hadde stengt kjøp. Den nye
 * `setBuyMoreDisabled(disabled, reason)` er idempotent og holder state til
 * den eksplisitt reversereres av enableBuyMore ved ny runde.
 *
 * Tooltip ("Kjøp er stengt — trekning pågår") er a11y-forbedring over Unity
 * (PM godkjent Q2 2026-04-18): Unity skjuler bare interactable-state, vi
 * legger til native `title` for hover-feedback til seende spillere.
 */
describe("CenterTopPanel — setBuyMoreDisabled (BIN-409 D2)", () => {
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

  function findBuyMoreBtn(): HTMLButtonElement | null {
    const btns = container.querySelectorAll("button");
    for (const b of btns) {
      if (b.textContent === "Kjøp flere brett") return b as HTMLButtonElement;
    }
    return null;
  }

  it("disables button and sets tooltip + opacity + cursor when disabled=true", () => {
    const btn = findBuyMoreBtn();
    expect(btn).not.toBeNull();
    panel.setBuyMoreDisabled(true, "Kjøp er stengt — trekning pågår");
    expect(btn!.disabled).toBe(true);
    expect(btn!.title).toBe("Kjøp er stengt — trekning pågår");
    expect(btn!.style.opacity).toBe("0.4");
    expect(btn!.style.cursor).toBe("not-allowed");
  });

  it("re-enables and clears tooltip when disabled=false", () => {
    const btn = findBuyMoreBtn();
    expect(btn).not.toBeNull();
    panel.setBuyMoreDisabled(true, "Kjøp er stengt — trekning pågår");
    panel.setBuyMoreDisabled(false);
    expect(btn!.disabled).toBe(false);
    expect(btn!.title).toBe("");
    expect(btn!.style.opacity).toBe("1");
    expect(btn!.style.cursor).toBe("pointer");
  });

  it("hover (mouseenter) does NOT change background while disabled", () => {
    const btn = findBuyMoreBtn();
    expect(btn).not.toBeNull();
    panel.setBuyMoreDisabled(true, "Kjøp er stengt");
    const bgBefore = btn!.style.background;
    btn!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    // Hover-handler er gated av `!btn.disabled` — bg skal ikke endres.
    expect(btn!.style.background).toBe(bgBefore);
  });

  it("uses empty-string reason when reason argument omitted", () => {
    const btn = findBuyMoreBtn();
    expect(btn).not.toBeNull();
    panel.setBuyMoreDisabled(true);
    expect(btn!.disabled).toBe(true);
    expect(btn!.title).toBe("");
  });
});
