/**
 * @vitest-environment happy-dom
 *
 * HeaderBar tests — F3 (BIN-431) jackpot row.
 *
 * Unity parity: Game1GamePlayPanel.SocketFlow.cs:518-520 — sets the label
 * `"{draw} Jackpot : {winningAmount} kr"` and toggles visibility via
 * `JackpotObject.SetActive(isDisplay)`. When `isDisplay === false` the row
 * is hidden without touching the label.
 *
 * G17 parity: Game1GamePlayPanel.ChatLayout.cs:51-70, :112-125 — the header
 * slides -80px on chat-open and +80 back on close. We only unit-test the
 * offset setter here; PlayScreen drives the actual GSAP tween and is covered
 * separately.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HeaderBar } from "./HeaderBar.js";
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

function makeBar(): { bar: HeaderBar; container: HTMLElement; overlay: HtmlOverlayManager } {
  ensureResizeObserver();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const overlay = new HtmlOverlayManager(container);
  const bar = new HeaderBar(overlay);
  return { bar, container, overlay };
}

describe("HeaderBar — F3 jackpot row", () => {
  let bar: HeaderBar;
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;

  beforeEach(() => {
    ({ bar, container, overlay } = makeBar());
  });

  afterEach(() => {
    overlay.destroy();
    container.remove();
  });

  it("starts hidden when no jackpot data has been pushed", () => {
    expect(bar.isVisible()).toBe(false);
  });

  it("renders the Unity-format label when isDisplay=true", () => {
    bar.update({ drawThreshold: 56, prize: 12500, isDisplay: true });
    expect(bar.isVisible()).toBe(true);
    expect(bar.container.textContent).toBe("56 Jackpot : 12500 kr");
  });

  it("hides the row when isDisplay=false (even with non-zero values)", () => {
    bar.update({ drawThreshold: 56, prize: 12500, isDisplay: true });
    expect(bar.isVisible()).toBe(true);
    bar.update({ drawThreshold: 56, prize: 12500, isDisplay: false });
    expect(bar.isVisible()).toBe(false);
  });

  it("hides when jackpot is null (variant has no jackpot)", () => {
    bar.update({ drawThreshold: 56, prize: 12500, isDisplay: true });
    bar.update(null);
    expect(bar.isVisible()).toBe(false);
  });

  it("hides when jackpot is undefined (payload missing field)", () => {
    bar.update({ drawThreshold: 56, prize: 12500, isDisplay: true });
    bar.update(undefined);
    expect(bar.isVisible()).toBe(false);
  });

  it("applies translateX on setOffsetX (G17 chat-resize header shift)", () => {
    expect(bar.currentOffsetX).toBe(0);
    bar.setOffsetX(-80);
    expect(bar.currentOffsetX).toBe(-80);
    expect(bar.container.style.transform).toBe("translateX(-80px)");

    bar.setOffsetX(0);
    expect(bar.currentOffsetX).toBe(0);
    expect(bar.container.style.transform).toBe("translateX(0px)");
  });
});
