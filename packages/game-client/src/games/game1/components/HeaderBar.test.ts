/**
 * @vitest-environment happy-dom
 *
 * HeaderBar — redesign 2026-04-23.
 *
 * Jackpot display moved into `CenterTopPanel` (mockup `.jackpot-display`).
 * HeaderBar is retained as a no-op stub so PlayScreen's construction +
 * ChatPanelV2 resize wiring (G17 BIN-431) don't need ripple refactoring.
 * Jackpot-visibility coverage now lives in CenterTopPanel.test.ts.
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

describe("HeaderBar — no-op stub (jackpot moved to CenterTopPanel)", () => {
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

  it("stays hidden regardless of jackpot payload", () => {
    expect(bar.isVisible()).toBe(false);
    bar.update({ drawThreshold: 56, prize: 12500, isDisplay: true });
    expect(bar.isVisible()).toBe(false);
  });

  it("accepts null/undefined without throwing", () => {
    expect(() => bar.update(null)).not.toThrow();
    expect(() => bar.update(undefined)).not.toThrow();
    expect(bar.isVisible()).toBe(false);
  });

  it("applies translateX on setOffsetX (G17 chat-resize wiring)", () => {
    expect(bar.currentOffsetX).toBe(0);
    bar.setOffsetX(-80);
    expect(bar.currentOffsetX).toBe(-80);
    expect(bar.container.style.transform).toBe("translateX(-80px)");

    bar.setOffsetX(0);
    expect(bar.currentOffsetX).toBe(0);
    expect(bar.container.style.transform).toBe("translateX(0px)");
  });
});
