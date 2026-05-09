/**
 * @vitest-environment happy-dom
 *
 * Spillerklient-rebuild Fase 3 (2026-05-10) — overlay-tester for
 * "venter på master"-state. Mounter overlay-en mot happy-dom uten Pixi
 * og verifiserer:
 *   W1 — show() mount-er DOM-noder med riktig display-name
 *   W2 — show() er idempotent (kun én DOM-node)
 *   W3 — update() endrer tekst uten å re-mount
 *   W4 — hide() fjerner DOM-noder, idempotent
 *   W5 — Default-display-name er "Bingo" når ingen state oppgis
 *   W6 — Plan-info-rad rendres når currentPosition + totalPositions er satt
 *   W7 — Plan-info-rad er tom når posisjons-data mangler
 *   W8 — Backdrop har pointer-events: none så BuyPopup kan klikkes under
 *   W9 — destroy() er idempotent og hindrer videre show()
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WaitingForMasterOverlay } from "./WaitingForMasterOverlay.js";

describe("WaitingForMasterOverlay", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentElement) {
      container.parentElement.removeChild(container);
    }
  });

  function findOverlays(): NodeListOf<Element> {
    return document.querySelectorAll("[data-spill1-waiting-for-master]");
  }

  function getHeadline(): string | null {
    const overlay = container.querySelector(
      "[data-spill1-waiting-for-master]",
    );
    return (
      overlay?.querySelector('[data-role="headline"]')?.textContent ?? null
    );
  }

  function getSubheadline(): string | null {
    const overlay = container.querySelector(
      "[data-spill1-waiting-for-master]",
    );
    return (
      overlay?.querySelector('[data-role="subheadline"]')?.textContent ?? null
    );
  }

  function getPlanInfo(): string | null {
    const overlay = container.querySelector(
      "[data-spill1-waiting-for-master]",
    );
    return (
      overlay?.querySelector('[data-role="plan-info"]')?.textContent ?? null
    );
  }

  // ── W1 ──────────────────────────────────────────────────────────────────
  it("W1 — show() mount-er overlay med oppgitt display-name", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: "Innsatsen" });

    expect(overlay.isVisible()).toBe(true);
    expect(findOverlays().length).toBe(1);
    expect(getHeadline()).toBe("Innsatsen");
    expect(getSubheadline()).toBe("Venter på master");

    overlay.destroy();
  });

  // ── W2 ──────────────────────────────────────────────────────────────────
  it("W2 — show() er idempotent (kun én DOM-node selv ved gjentatte kall)", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: "Bingo" });
    overlay.show({ catalogDisplayName: "Bingo" });
    overlay.show({ catalogDisplayName: "Bingo" });

    expect(findOverlays().length).toBe(1);

    overlay.destroy();
  });

  // ── W3 ──────────────────────────────────────────────────────────────────
  it("W3 — update() endrer tekst uten å re-mount-e DOM", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: "Bingo" });
    const firstNode = container.querySelector(
      "[data-spill1-waiting-for-master]",
    );

    overlay.update({ catalogDisplayName: "Trafikklys" });

    const secondNode = container.querySelector(
      "[data-spill1-waiting-for-master]",
    );
    // Same DOM node (no re-mount)
    expect(secondNode).toBe(firstNode);
    expect(getHeadline()).toBe("Trafikklys");

    overlay.destroy();
  });

  // ── W4 ──────────────────────────────────────────────────────────────────
  it("W4 — hide() fjerner DOM-noder og er idempotent", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: "Bingo" });

    overlay.hide();
    expect(overlay.isVisible()).toBe(false);
    expect(findOverlays().length).toBe(0);

    // Idempotent — repeated hide() er no-op
    overlay.hide();
    overlay.hide();
    expect(findOverlays().length).toBe(0);

    overlay.destroy();
  });

  // ── W5 ──────────────────────────────────────────────────────────────────
  it("W5 — default display-name er 'Bingo' når state er tom", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show();

    expect(getHeadline()).toBe("Bingo");
    expect(getSubheadline()).toBe("Venter på master");

    overlay.destroy();
  });

  // ── W6 ──────────────────────────────────────────────────────────────────
  it("W6 — plan-info rendres med posisjons-data + plan-navn", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({
      catalogDisplayName: "Bingo",
      currentPosition: 3,
      totalPositions: 13,
      planName: "Pilot Demo",
    });

    expect(getPlanInfo()).toBe("Spill 3 av 13 — Pilot Demo");

    overlay.destroy();
  });

  // ── W7 ──────────────────────────────────────────────────────────────────
  it("W7 — plan-info er tom når posisjons-data mangler", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: "Bingo" });

    expect(getPlanInfo()).toBe("");

    overlay.destroy();
  });

  it("W7b — plan-info rendrer kun plan-navn hvis posisjons-data mangler", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({
      catalogDisplayName: "Bingo",
      planName: "Pilot Demo",
    });

    expect(getPlanInfo()).toBe("Pilot Demo");

    overlay.destroy();
  });

  // ── W8 ──────────────────────────────────────────────────────────────────
  it("W8 — backdrop har pointer-events: none så BuyPopup ikke blokkeres", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: "Bingo" });

    const backdrop = container.querySelector(
      "[data-spill1-waiting-for-master]",
    ) as HTMLElement;
    expect(backdrop).toBeTruthy();
    // happy-dom doesn't run real CSS layout but reads inline styles
    expect(backdrop.style.pointerEvents).toBe("none");

    // Card-en (første barn) skal ha auto for å tillate fokus-styling
    const card = backdrop.firstElementChild as HTMLElement;
    expect(card.style.pointerEvents).toBe("auto");

    overlay.destroy();
  });

  // ── W9 ──────────────────────────────────────────────────────────────────
  it("W9 — destroy() er idempotent og blokkerer videre show()", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: "Bingo" });

    overlay.destroy();
    expect(findOverlays().length).toBe(0);

    // Etter destroy er videre show() no-op
    overlay.show({ catalogDisplayName: "Innsatsen" });
    expect(findOverlays().length).toBe(0);
    expect(overlay.isVisible()).toBe(false);

    // Idempotent destroy
    overlay.destroy();
  });

  it("W9b — update() etter destroy er no-op (ingen kast)", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: "Bingo" });
    overlay.destroy();

    expect(() => {
      overlay.update({ catalogDisplayName: "Trafikklys" });
    }).not.toThrow();
  });

  // ── Whitespace-only / empty display-name fallback ───────────────────────
  it("trims whitespace-only display-name og faller tilbake på Bingo", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: "   " });

    expect(getHeadline()).toBe("Bingo");

    overlay.destroy();
  });

  it("null display-name → fallback Bingo", () => {
    const overlay = new WaitingForMasterOverlay({ container });
    overlay.show({ catalogDisplayName: null });

    expect(getHeadline()).toBe("Bingo");

    overlay.destroy();
  });
});
