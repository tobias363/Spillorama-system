/**
 * @vitest-environment happy-dom
 *
 * WinScreenV2 (Fullt Hus fullskjerm) — port av WinScreenV2.jsx.
 * Dekker: mount/unmount, shared-info, rAF-cleanup ved destroy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WinScreenV2 } from "./WinScreenV2.js";

function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("WinScreenV2", () => {
  let parent: HTMLElement;
  let screen: WinScreenV2;

  beforeEach(() => {
    document.body.innerHTML = "";
    parent = container();
    screen = new WinScreenV2(parent);
  });
  afterEach(() => {
    screen.destroy();
    parent.remove();
  });

  it("mount på show() — fullskjerm-rot med headline", () => {
    screen.show({ amount: 12450 });
    expect(parent.textContent).toContain("BINGO! DU VANT");
    expect(parent.textContent).toContain("GRATULERER MED GEVINSTEN");
  });

  it("rendrer 70 partikkel-noder i fontene-container", () => {
    screen.show({ amount: 100 });
    // Emitter er dypt nestet; partiklene har img-child.
    const imgs = parent.querySelectorAll("img");
    // WinScreen har bare partikkel-logoer (ingen andre img-tags).
    expect(imgs.length).toBe(70);
  });

  it("viser shared-info når shared=true", () => {
    screen.show({ amount: 5000, shared: true, sharedCount: 2 });
    expect(parent.textContent).toContain("Gevinsten deles");
    expect(parent.textContent).toContain("2 personer");
  });

  it("skjuler shared-info når shared=false", () => {
    screen.show({ amount: 5000 });
    expect(parent.textContent).not.toContain("Gevinsten deles");
  });

  it("singular personText når sharedCount=1", () => {
    screen.show({ amount: 5000, shared: true, sharedCount: 1 });
    expect(parent.textContent).toContain("1 person");
    expect(parent.textContent).not.toContain("1 personer");
  });

  it("hide() fjerner scene fra DOM", () => {
    screen.show({ amount: 100 });
    expect(parent.children.length).toBeGreaterThan(0);
    screen.hide();
    expect(parent.children.length).toBe(0);
  });

  it("Tilbake-knapp trigger onDismiss + fjerner scene", () => {
    let dismissed = false;
    screen.show({ amount: 100, onDismiss: () => { dismissed = true; } });
    const backBtn = Array.from(parent.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Tilbake",
    );
    expect(backBtn).not.toBeUndefined();
    backBtn!.click();
    expect(dismissed).toBe(true);
    expect(parent.children.length).toBe(0);
  });

  it("kun Tilbake-knapp — ingen Spill av på nytt / Skru av (regel-endring 2026-04-24)", () => {
    screen.show({ amount: 100 });
    const buttonTexts = Array.from(parent.querySelectorAll("button")).map(
      (b) => b.textContent?.trim(),
    );
    expect(buttonTexts).toEqual(["Tilbake"]);
  });

  it("destroy() er idempotent", () => {
    screen.show({ amount: 100 });
    screen.destroy();
    screen.destroy(); // skal ikke kaste
    expect(parent.children.length).toBe(0);
  });

  it("show() etter destroy() re-mount'er korrekt", () => {
    screen.show({ amount: 100 });
    screen.destroy();
    screen.show({ amount: 200 });
    expect(parent.textContent).toContain("BINGO! DU VANT");
  });

  it("auto-close 5s etter animasjonen er ferdig (regel-endring 2026-04-24 rev 3)", () => {
    // Total delay = FOSS_DURATION_MS (3600) + COUNT_UP_DURATION_MS (2200)
    //               + POST_ANIMATION_DWELL_MS (5000) = 10800ms.
    vi.useFakeTimers();
    let dismissed = false;
    screen.show({ amount: 100, onDismiss: () => { dismissed = true; } });
    expect(parent.children.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(10799);
    expect(parent.children.length).toBeGreaterThan(0);
    expect(dismissed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(parent.children.length).toBe(0);
    expect(dismissed).toBe(true);
    vi.useRealTimers();
  });

  it("manuell Tilbake overstyrer auto-close timer (ingen dobbel onDismiss)", () => {
    vi.useFakeTimers();
    let dismissCount = 0;
    screen.show({ amount: 100, onDismiss: () => { dismissCount++; } });
    const backBtn = Array.from(parent.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Tilbake",
    )!;
    backBtn.click();
    expect(dismissCount).toBe(1);
    vi.advanceTimersByTime(12000);
    expect(dismissCount).toBe(1);
    vi.useRealTimers();
  });
});
