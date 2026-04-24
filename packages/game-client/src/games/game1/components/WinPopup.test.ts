/**
 * @vitest-environment happy-dom
 *
 * WinPopup (fase 1-4 vinn) — port av WinPopup.jsx.
 * Dekker: mount/unmount, rows/amount/shared-visning, hide rydder DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WinPopup } from "./WinPopup.js";

function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("WinPopup", () => {
  let parent: HTMLElement;
  let popup: WinPopup;

  beforeEach(() => {
    document.body.innerHTML = "";
    parent = container();
    popup = new WinPopup(parent);
  });
  afterEach(() => {
    popup.destroy();
    parent.remove();
  });

  it("mount på show() — backdrop + kort i DOM", () => {
    popup.show({ rows: 1, amount: 100 });
    const backdrop = parent.querySelector("div");
    expect(backdrop).not.toBeNull();
    // "Gratulerer!"-heading finnes.
    expect(parent.textContent).toContain("Gratulerer!");
  });

  it("viser antall rader i subline (singular/plural)", () => {
    popup.show({ rows: 1, amount: 100 });
    expect(parent.textContent).toContain("1 rad");
    popup.hide();

    popup.show({ rows: 3, amount: 500 });
    expect(parent.textContent).toContain("3 rader");
  });

  it("formaterer amount med norsk tusenskiller", () => {
    popup.show({ rows: 2, amount: 12450 });
    // Norsk locale bruker non-breaking space (U+00A0) som tusenskiller.
    expect(parent.textContent).toContain("12\u00a0450 kr");
  });

  it("viser shared-info når shared=true + flere vinnere", () => {
    popup.show({ rows: 2, amount: 300, shared: true, sharedCount: 3 });
    expect(parent.textContent).toContain("Gevinsten deles");
    expect(parent.textContent).toContain("3 personer");
    expect(parent.textContent).toContain("2 rader");
  });

  it("skjuler shared-info når shared=false (default)", () => {
    popup.show({ rows: 1, amount: 100 });
    expect(parent.textContent).not.toContain("Gevinsten deles");
  });

  it("hide() fjerner popup fra DOM", () => {
    popup.show({ rows: 1, amount: 100 });
    expect(parent.children.length).toBeGreaterThan(0);
    popup.hide();
    expect(parent.children.length).toBe(0);
  });

  it("Lukk-knapp trigger onClose + fjerner popup", () => {
    let closed = false;
    popup.show({ rows: 1, amount: 100, onClose: () => { closed = true; } });

    const lukkBtn = Array.from(parent.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Lukk",
    );
    expect(lukkBtn).not.toBeUndefined();
    lukkBtn!.click();
    expect(closed).toBe(true);
    expect(parent.children.length).toBe(0);
  });

  it("singular personText når sharedCount=1", () => {
    // Edge case — 1 "person" (grammatisk, selv om shared=true typisk
    // impliserer ≥2). Sikrer at string-interpolering ikke brekker.
    popup.show({ rows: 1, amount: 100, shared: true, sharedCount: 1 });
    expect(parent.textContent).toContain("1 person");
    expect(parent.textContent).not.toContain("1 personer");
  });

  it("auto-close etter 3s (regel-endring 2026-04-24)", () => {
    vi.useFakeTimers();
    let closed = false;
    popup.show({ rows: 1, amount: 100, onClose: () => { closed = true; } });
    expect(parent.children.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(2999);
    expect(parent.children.length).toBeGreaterThan(0);
    expect(closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(parent.children.length).toBe(0);
    expect(closed).toBe(true);
    vi.useRealTimers();
  });

  it("manuell Lukk overstyrer auto-close timer", () => {
    vi.useFakeTimers();
    let closeCount = 0;
    popup.show({ rows: 1, amount: 100, onClose: () => { closeCount++; } });
    const lukkBtn = Array.from(parent.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Lukk",
    )!;
    lukkBtn.click();
    expect(closeCount).toBe(1);
    // Auto-close må IKKE trigge på toppen — ellers får vi dobbel onClose.
    vi.advanceTimersByTime(5000);
    expect(closeCount).toBe(1);
    vi.useRealTimers();
  });
});
