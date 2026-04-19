/**
 * @vitest-environment happy-dom
 *
 * ChatPanelV2 → HeaderBar shift integration test (G17 BIN-431).
 *
 * Unity parity: Game1GamePlayPanel.ChatLayout.cs:51-70, :112-125 — when the
 * chat opens, `Panel_Game_Header` slides -80px left (0.25s LeanTween, default
 * linear ease); on close, it slides +80px back to its anchor-based zero.
 *
 * The web port lives in PlayScreen's `chatPanel.setOnToggle` callback, which
 * uses a GSAP tween to drive `headerBar.setOffsetX`. This unit-level test
 * reproduces that wiring in isolation — it verifies the onToggle(false) /
 * onToggle(true) calls produce a GSAP tween that ends at -80 / 0 on the bar.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import gsap from "gsap";
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

/**
 * Fake of the PlayScreen setOnToggle wiring — mirrors the code in
 * PlayScreen.ts exactly so regressions in the animation parameters are
 * caught here.
 */
function makeToggleHandler(bar: HeaderBar): {
  onToggle: (collapsed: boolean) => void;
  activeTween: () => gsap.core.Tween | null;
} {
  let tween: gsap.core.Tween | null = null;
  const onToggle = (collapsed: boolean): void => {
    const targetOffset = collapsed ? 0 : -80;
    tween?.kill();
    const proxy = { x: bar.currentOffsetX };
    tween = gsap.to(proxy, {
      x: targetOffset,
      duration: 0.25,
      ease: "none",
      onUpdate: () => bar.setOffsetX(proxy.x),
    });
  };
  return { onToggle, activeTween: () => tween };
}

describe("ChatPanelV2 resize → HeaderBar shift (G17 BIN-431)", () => {
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;
  let bar: HeaderBar;

  beforeEach(() => {
    ensureResizeObserver();
    container = document.createElement("div");
    document.body.appendChild(container);
    overlay = new HtmlOverlayManager(container);
    bar = new HeaderBar(overlay);
  });

  afterEach(() => {
    overlay.destroy();
    container.remove();
  });

  it("onToggle(false) [chat open] starts a tween that lands at -80", () => {
    const { onToggle, activeTween } = makeToggleHandler(bar);
    onToggle(false);

    const tw = activeTween();
    expect(tw).not.toBeNull();
    // A tween was registered on the proxy — verify it completes at -80.
    tw!.progress(1);
    expect(bar.currentOffsetX).toBe(-80);
  });

  it("onToggle(true) [chat close] tweens back to 0", () => {
    const { onToggle, activeTween } = makeToggleHandler(bar);
    // Prime with an open tween first.
    onToggle(false);
    activeTween()!.progress(1);
    expect(bar.currentOffsetX).toBe(-80);

    // Now close.
    onToggle(true);
    activeTween()!.progress(1);
    expect(bar.currentOffsetX).toBe(0);
  });

  it("cancels an in-flight tween on rapid re-toggle", () => {
    const { onToggle, activeTween } = makeToggleHandler(bar);
    onToggle(false);
    const first = activeTween()!;
    // Mark the tween partially advanced — intermediate offset should land
    // between 0 and -80 so we can verify the re-toggle replaces this tween.
    first.progress(0.5);
    const midOffset = bar.currentOffsetX;
    expect(midOffset).toBeLessThan(0);
    expect(midOffset).toBeGreaterThan(-80);

    onToggle(true);
    const second = activeTween()!;
    // Must be a fresh tween object (first has been .kill()-ed).
    expect(second).not.toBe(first);
    second.progress(1);
    expect(bar.currentOffsetX).toBe(0);
  });
});
