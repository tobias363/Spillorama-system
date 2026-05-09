/**
 * @vitest-environment happy-dom
 *
 * Game1BuyPopup subtitle-displayName-tester (Spillerklient-rebuild Fase 1,
 * 2026-05-10).
 *
 * Bakgrunn (Tobias-direktiv 2026-05-09):
 *   Spillerklient viste hardkodet "STANDARD" i buy-popup-subtitle istedenfor
 *   plan-runtime catalog-display-navn ("Bingo", "Innsatsen", "Oddsen 55"...).
 *   Disse testene forsikrer at:
 *     1) Default-subtitle er "Bingo" — IKKE "STANDARD"
 *     2) `setDisplayName(...)` oppdaterer DOM live (også når popup er åpen)
 *     3) `setDisplayName(null)` / tom string mappes til "Bingo" (vi viser
 *        ALDRI tom subtitle eller "STANDARD"-fallback)
 *     4) `showWithTypes(..., displayName)` overstyrer current value
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Game1BuyPopup } from "./Game1BuyPopup.js";
import { HtmlOverlayManager } from "./HtmlOverlayManager.js";

const ENTRY_FEE = 10;
const TYPES = [
  { name: "Small", type: "small-yellow", priceMultiplier: 1, ticketCount: 1 },
];

function makePopup(): { popup: Game1BuyPopup; container: HTMLElement } {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const overlay = new HtmlOverlayManager(container);
  const popup = new Game1BuyPopup(overlay);
  return { popup, container };
}

function getSubtitleText(container: HTMLElement): string | null {
  // Subtitle-elementet er det andre direkte-barnet av header-divet.
  // Vi finner det ved å lete i hele card-treet etter et element med
  // letter-spacing 0.14em (uniqueness-marker fra subtitle-stylingen).
  const overlay = container.querySelector(".g1-overlay-root");
  if (!overlay) return null;
  const allDivs = overlay.querySelectorAll("div");
  for (const div of Array.from(allDivs)) {
    const ls = (div as HTMLElement).style.letterSpacing;
    if (ls === "0.14em") {
      return div.textContent;
    }
  }
  return null;
}

describe("Game1BuyPopup subtitle displayName (Fase 1)", () => {
  let popup: Game1BuyPopup;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    const made = makePopup();
    popup = made.popup;
    container = made.container;
  });

  it("default-subtitle er 'Bingo' (ikke 'STANDARD')", () => {
    expect(getSubtitleText(container)).toBe("Bingo");
  });

  it("setDisplayName('Innsatsen') oppdaterer subtitle live", () => {
    popup.setDisplayName("Innsatsen");
    expect(getSubtitleText(container)).toBe("Innsatsen");
  });

  it("setDisplayName(null) faller tilbake til 'Bingo'", () => {
    popup.setDisplayName("Oddsen 55");
    expect(getSubtitleText(container)).toBe("Oddsen 55");
    popup.setDisplayName(null);
    expect(getSubtitleText(container)).toBe("Bingo");
  });

  it("setDisplayName('') mappes til 'Bingo' (aldri tom subtitle)", () => {
    popup.setDisplayName("");
    expect(getSubtitleText(container)).toBe("Bingo");
  });

  it("setDisplayName trim-mer whitespace og mapper kun-whitespace til 'Bingo'", () => {
    popup.setDisplayName("   ");
    expect(getSubtitleText(container)).toBe("Bingo");
    popup.setDisplayName("  Trafikklys  ");
    expect(getSubtitleText(container)).toBe("Trafikklys");
  });

  it("showWithTypes med displayName-param overstyrer current value", () => {
    popup.setDisplayName("Bingo");
    popup.showWithTypes(ENTRY_FEE, TYPES, 0, undefined, "TV-Extra");
    expect(getSubtitleText(container)).toBe("TV-Extra");
  });

  it("showWithTypes uten displayName-param beholder current value", () => {
    popup.setDisplayName("Jackpot");
    popup.showWithTypes(ENTRY_FEE, TYPES, 0);
    expect(getSubtitleText(container)).toBe("Jackpot");
  });

  it("setDisplayName virker når popup er lukket og persistert til neste show()", () => {
    popup.setDisplayName("5×500");
    // popup er ikke vist enda — verify at DOM allerede holder verdien
    expect(getSubtitleText(container)).toBe("5×500");
    popup.showWithTypes(ENTRY_FEE, TYPES, 0);
    expect(getSubtitleText(container)).toBe("5×500");
  });
});
