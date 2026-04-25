/**
 * @vitest-environment happy-dom
 *
 * BLINK-FIX (round 3, hazard 1) regression tests.
 *
 * Bakgrunn: Auto-pause-flyt etter hver phase-won (Rad 1, Rad 2, Rad 3, Fullt
 * Hus = 4 ganger per runde) trigget tidligere INSTANT removal av en
 * 100%-canvas-overdekkende rgba(0,0,0,0.85)-div mens Pixi-canvas re-rendret.
 * Dette ga 4-5 blinks/2min på Spill 1.
 *
 * Fix: PauseOverlay fader nå opacity 0 → 1 på show og 1 → 0 på hide (0.4s),
 * og holder display:flex til transition er ferdig. show() under aktiv hide()
 * canceller pågående fade-out og re-fader inn umiddelbart.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PauseOverlay } from "./PauseOverlay.js";

describe("PauseOverlay — fade transition (BLINK-FIX round 3)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    vi.useFakeTimers();
  });

  afterEach(() => {
    host.remove();
    vi.useRealTimers();
  });

  it("starts with display:none and opacity:0", () => {
    const overlay = new PauseOverlay(host);
    const backdrop = host.firstChild as HTMLDivElement;
    expect(backdrop.style.display).toBe("none");
    expect(backdrop.style.opacity).toBe("0");
    expect(overlay.isShowing()).toBe(false);
  });

  it("show() flips to display:flex and opacity:1", () => {
    const overlay = new PauseOverlay(host);
    const backdrop = host.firstChild as HTMLDivElement;
    overlay.show();
    expect(backdrop.style.display).toBe("flex");
    expect(backdrop.style.opacity).toBe("1");
    expect(overlay.isShowing()).toBe(true);
  });

  it("hide() flips opacity to 0 immediately and isShowing→false", () => {
    const overlay = new PauseOverlay(host);
    const backdrop = host.firstChild as HTMLDivElement;
    overlay.show();
    overlay.hide();
    // Opacity transitions immediately; display stays flex during fade.
    expect(backdrop.style.opacity).toBe("0");
    expect(backdrop.style.display).toBe("flex");
    expect(overlay.isShowing()).toBe(false);
  });

  it("hide() flips display:none AFTER fade completes (~420ms)", () => {
    const overlay = new PauseOverlay(host);
    const backdrop = host.firstChild as HTMLDivElement;
    overlay.show();
    overlay.hide();
    // Before timer fires, display is still flex
    vi.advanceTimersByTime(400);
    expect(backdrop.style.display).toBe("flex");
    // After timer fires (420ms total)
    vi.advanceTimersByTime(50);
    expect(backdrop.style.display).toBe("none");
  });

  it("show() during fade-out cancels the hide timer and fades back in", () => {
    const overlay = new PauseOverlay(host);
    const backdrop = host.firstChild as HTMLDivElement;
    overlay.show();
    overlay.hide();
    vi.advanceTimersByTime(200); // mid-fade
    overlay.show("ny melding");
    vi.advanceTimersByTime(500);
    // Should NOT have flipped to display:none — show() cleared the timer
    expect(backdrop.style.display).toBe("flex");
    expect(backdrop.style.opacity).toBe("1");
    expect(overlay.isShowing()).toBe(true);
  });

  it("backdrop has the opacity transition (no instant pop)", () => {
    new PauseOverlay(host);
    const backdrop = host.firstChild as HTMLDivElement;
    // happy-dom serialiserer transition uten å normalisere; vi sjekker substring.
    expect(backdrop.style.transition).toContain("opacity");
    expect(backdrop.style.transition).toContain("0.4s");
  });

  it("destroy() removes element and clears any pending hide timer", () => {
    const overlay = new PauseOverlay(host);
    overlay.show();
    overlay.hide();
    overlay.destroy();
    expect(host.children.length).toBe(0);
    // Advancing timers should not throw or affect a removed node.
    vi.advanceTimersByTime(1000);
  });
});
