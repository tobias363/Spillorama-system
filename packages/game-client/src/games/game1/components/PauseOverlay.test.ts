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

describe("PauseOverlay — MED-11 pause-context (countdown + fallback)", () => {
  let host: HTMLDivElement;
  // Frys "now" så countdown-aritmetikken er deterministisk.
  const FROZEN_NOW = new Date("2026-04-26T12:00:00.000Z").getTime();

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    host.remove();
    vi.useRealTimers();
  });

  it("uten pauseUntil/pauseReason viser default norsk fallback-tekst", () => {
    const overlay = new PauseOverlay(host);
    overlay.show({});
    const message = host.querySelectorAll("div div")[2] as HTMLDivElement;
    // Tredje barne-div er messageEl (etter icon + title).
    // Vi henter den via tekstinnhold for robusthet:
    const allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    const messageDiv = allDivs.find((d) => d.textContent === "Venter på hall-operatør");
    expect(messageDiv, "fallback skal være 'Venter på hall-operatør'").toBeTruthy();
    // Countdown-elementet skal ikke være synlig
    const countdownDiv = host.querySelector('[data-testid="pause-countdown"]') as HTMLDivElement | null;
    expect(countdownDiv?.style.display).toBe("none");
    // Konsumér message variable så TS ikke klager
    expect(message ?? null).toBeDefined();
  });

  it("med pauseReason='AWAITING_OPERATOR' viser samme fallback", () => {
    const overlay = new PauseOverlay(host);
    overlay.show({ pauseReason: "AWAITING_OPERATOR" });
    const allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    const messageDiv = allDivs.find((d) => d.textContent === "Venter på hall-operatør");
    expect(messageDiv).toBeTruthy();
  });

  it("med pauseUntil i fremtiden viser countdown M:SS", () => {
    const overlay = new PauseOverlay(host);
    const futureIso = new Date(FROZEN_NOW + 45_000).toISOString(); // 45s ut i fremtid
    overlay.show({ pauseUntil: futureIso });
    const allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    // Countdown-element skal vise "0:45"
    const countdownDiv = allDivs.find((d) => d.textContent === "0:45");
    expect(countdownDiv, "skal vise 0:45 countdown").toBeTruthy();
    expect(countdownDiv?.style.display).toBe("block");
  });

  it("countdown tikker ned hvert sekund", () => {
    const overlay = new PauseOverlay(host);
    const futureIso = new Date(FROZEN_NOW + 10_000).toISOString();
    overlay.show({ pauseUntil: futureIso });
    let allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    let countdownDiv = allDivs.find((d) => /^\d+:\d{2}$/.test(d.textContent ?? ""));
    expect(countdownDiv?.textContent).toBe("0:10");
    // Advansér 3s
    vi.advanceTimersByTime(3_000);
    allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    countdownDiv = allDivs.find((d) => /^\d+:\d{2}$/.test(d.textContent ?? ""));
    expect(countdownDiv?.textContent).toBe("0:07");
  });

  it("når countdown-tiden går ut, bytter klient til 'Venter på hall-operatør'", () => {
    const overlay = new PauseOverlay(host);
    const futureIso = new Date(FROZEN_NOW + 2_000).toISOString();
    overlay.show({ pauseUntil: futureIso });
    // Advansér forbi pauseUntil
    vi.advanceTimersByTime(3_500);
    const allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    const messageDiv = allDivs.find((d) => d.textContent === "Venter på hall-operatør");
    expect(messageDiv, "etter utløpt countdown skal teksten bytte til fallback").toBeTruthy();
    const zeroDiv = allDivs.find((d) => d.textContent === "0:00");
    expect(zeroDiv, "countdown skal stå på 0:00").toBeTruthy();
  });

  it("ugyldig pauseUntil ignoreres og faller tilbake til reason-tekst", () => {
    const overlay = new PauseOverlay(host);
    overlay.show({ pauseUntil: "not-a-date", pauseReason: "MANUAL_PAUSE_5MIN" });
    const allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    const fallbackDiv = allDivs.find((d) => d.textContent === "Venter på hall-operatør");
    expect(fallbackDiv).toBeTruthy();
    const countdownDiv = host.querySelector('[data-testid="pause-countdown"]') as HTMLDivElement | null;
    expect(countdownDiv?.style.display).toBe("none");
  });

  it("show(string) — legacy-form holder bakoverkompatibilitet", () => {
    const overlay = new PauseOverlay(host);
    overlay.show("Tilpasset melding fra master");
    const allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    const messageDiv = allDivs.find((d) => d.textContent === "Tilpasset melding fra master");
    expect(messageDiv).toBeTruthy();
    expect(overlay.isShowing()).toBe(true);
  });

  it("updateContent() oppdaterer tekst uten å fade ut/inn", () => {
    const overlay = new PauseOverlay(host);
    overlay.show({ pauseReason: "AWAITING_OPERATOR" });
    expect(overlay.isShowing()).toBe(true);
    // Master forlenger med konkret estimat
    overlay.updateContent({ pauseUntil: new Date(FROZEN_NOW + 30_000).toISOString() });
    const allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    const countdownDiv = allDivs.find((d) => d.textContent === "0:30");
    expect(countdownDiv).toBeTruthy();
    // Overlay skal fortsatt være synlig
    const backdrop = host.firstChild as HTMLDivElement;
    expect(backdrop.style.opacity).toBe("1");
    expect(backdrop.style.display).toBe("flex");
  });

  it("hide() stopper countdown-ticker så vi ikke lekker setInterval", () => {
    const overlay = new PauseOverlay(host);
    overlay.show({ pauseUntil: new Date(FROZEN_NOW + 60_000).toISOString() });
    overlay.hide();
    const allDivs = Array.from(host.querySelectorAll("div")) as HTMLDivElement[];
    const countdownDiv = host.querySelector('[data-testid="pause-countdown"]') as HTMLDivElement | null;
    const beforeText = countdownDiv?.textContent;
    // Advansér 5s — countdown skal IKKE oppdateres etter hide()
    vi.advanceTimersByTime(5_000);
    expect(countdownDiv?.textContent).toBe(beforeText);
  });
});
