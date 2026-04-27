/**
 * @vitest-environment happy-dom
 *
 * ToastNotification — phase-won toaster + win-announcement toasts.
 *
 * Round 6 BLINK-fix dekning:
 *   - Hazard #6: box-shadow flatened (mindre paint-cost), transition-listen
 *     begrenset til opacity (transform tilbake-gått). Toasten hovrer over
 *     Pixi-canvas — paint-property-transition med rom for transition-frames
 *     ga sub-pixel jitter.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToastNotification } from "./ToastNotification.js";

describe("ToastNotification", () => {
  let parent: HTMLElement;
  let toaster: ToastNotification;

  beforeEach(() => {
    document.body.innerHTML = "";
    parent = document.createElement("div");
    document.body.appendChild(parent);
    toaster = new ToastNotification(parent);
  });

  afterEach(() => {
    toaster.destroy();
    parent.remove();
  });

  it("info() viser toast med riktig tekst", () => {
    toaster.info("Hello");
    const toast = parent.querySelector("div > div");
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toBe("Hello");
  });

  it("win() / error() / info() rendrer alle 3 samtidig", () => {
    toaster.info("a");
    toaster.win("b");
    toaster.error("c");
    const toasts = parent.querySelectorAll("div > div");
    // Container + 3 toasts
    expect(toasts.length).toBeGreaterThanOrEqual(3);
  });

  // BLINK-FIX round 6 hazard #6 regresjonstester.

  /**
   * Round 6 hazard #6 — transition-listen var tidligere `opacity 0.3s,
   * transform 0.3s`. Transform-transition over Pixi-canvas tvinger
   * composite-recalc i hver mellom-frame. Vi har strippet transform fra
   * transition-listen så toasten kun fader inn/ut via opacity.
   */
  it("hazard #6: toast-element har INGEN transform i transition-listen", () => {
    toaster.info("Test");
    // Toast sitter i toaster.container, som er første child av parent.
    // Bruk leaf-element (ingen children) for å plukke selve toasten,
    // ikke containeren.
    const toast = Array.from(parent.querySelectorAll<HTMLDivElement>("div"))
      .find((t) => t.textContent === "Test" && t.children.length === 0);
    expect(toast, "fant ikke toast-leaf med textContent='Test'").toBeDefined();
    // Happy-dom kan serialisere transition som style.cssText eller via
    // longhand-property; vi sjekker begge for robusthet.
    const inlineTrans = toast!.style.transition;
    const cssText = toast!.style.cssText;
    const combined = `${inlineTrans} ${cssText}`;
    expect(
      combined,
      `Toast har transition="${inlineTrans}" / cssText="${cssText}" — transform 0.3s skal IKKE være med (paint-trafikk over Pixi).`,
    ).not.toContain("transform 0.3s");
    expect(combined, "transition skal nevne opacity").toContain("opacity");
  });

  /**
   * Round 6 hazard #6 — box-shadow er paint-property. Tidligere brukte vi
   * `0 4px 16px rgba(0,0,0,0.4)`; nå flattened til 0 2px 8px / 0.25 alpha.
   * Visuelt nesten identisk men billigere paint per Pixi-frame.
   */
  it("hazard #6: toast-element bruker flatere box-shadow (mindre paint-cost)", () => {
    toaster.info("Test");
    const toast = Array.from(parent.querySelectorAll<HTMLDivElement>("div"))
      .find((t) => t.textContent === "Test" && t.children.length === 0);
    expect(toast).toBeDefined();
    const shadow = toast!.style.boxShadow;
    const cssText = toast!.style.cssText;
    const combined = `${shadow} ${cssText}`;
    // Den GAMLE blur-radius (16px) skal IKKE finnes lenger.
    expect(
      combined,
      `box-shadow="${shadow}" / cssText="${cssText}" bruker fortsatt 16px blur — round 6 fix-regresjon.`,
    ).not.toContain("16px");
  });
});
