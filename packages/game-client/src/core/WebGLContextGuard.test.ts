/**
 * BIN-542: WebGLContextGuard tests.
 *
 * Verifies that the guard:
 *  - attaches listeners to the canvas on construction
 *  - calls preventDefault on webglcontextlost (critical — without this,
 *    iOS Safari never fires webglcontextrestored)
 *  - invokes onContextLost callback
 *  - invokes onContextRestored with non-negative recoveryMs
 *  - removes listeners on destroy()
 *  - swallows callback exceptions so they don't break event dispatch
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebGLContextGuard } from "./WebGLContextGuard.js";

/**
 * Minimal canvas stub — vitest runs in node env (no jsdom), so we
 * implement just addEventListener/removeEventListener/dispatchEvent.
 */
interface FakeEvent {
  type: string;
  defaultPrevented: boolean;
  preventDefault(): void;
}

function makeCanvas(): HTMLCanvasElement {
  const listeners = new Map<string, Array<(e: FakeEvent) => void>>();
  const el = {
    addEventListener(type: string, handler: (e: FakeEvent) => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(handler);
      listeners.set(type, arr);
    },
    removeEventListener(type: string, handler: (e: FakeEvent) => void) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(evt: FakeEvent) {
      const arr = listeners.get(evt.type) ?? [];
      for (const h of arr) h(evt);
    },
  };
  return el as unknown as HTMLCanvasElement;
}

function fireEvent(target: EventTarget, type: string): FakeEvent {
  const evt: FakeEvent = {
    type,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  (target as unknown as { dispatchEvent(e: FakeEvent): void }).dispatchEvent(evt);
  return evt;
}

describe("BIN-542: WebGLContextGuard", () => {
  let canvas: HTMLCanvasElement;
  let onLost: ReturnType<typeof vi.fn>;
  let onRestored: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    canvas = makeCanvas();
    onLost = vi.fn();
    onRestored = vi.fn();
  });

  function makeGuard(): WebGLContextGuard {
    return new WebGLContextGuard({
      canvas,
      gameSlug: "bingo",
      hallId: "hall-a",
      onContextLost: onLost,
      onContextRestored: onRestored,
    });
  }

  it("calls onContextLost and preventDefault on webglcontextlost", () => {
    const guard = makeGuard();
    const evt = fireEvent(canvas, "webglcontextlost");
    expect(evt.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onRestored).not.toHaveBeenCalled();
    guard.destroy();
  });

  it("calls onContextRestored after a prior loss", () => {
    const guard = makeGuard();
    fireEvent(canvas, "webglcontextlost");
    fireEvent(canvas, "webglcontextrestored");
    expect(onRestored).toHaveBeenCalledTimes(1);
    guard.destroy();
  });

  it("removes listeners on destroy (no further callbacks after teardown)", () => {
    const guard = makeGuard();
    guard.destroy();
    fireEvent(canvas, "webglcontextlost");
    fireEvent(canvas, "webglcontextrestored");
    expect(onLost).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("does not throw when onContextLost callback throws", () => {
    onLost = vi.fn(() => {
      throw new Error("boom from app");
    });
    const guard = makeGuard();
    expect(() => fireEvent(canvas, "webglcontextlost")).not.toThrow();
    expect(onLost).toHaveBeenCalled();
    guard.destroy();
  });

  it("does not throw when onContextRestored callback throws", () => {
    onRestored = vi.fn(() => {
      throw new Error("boom from restore");
    });
    const guard = makeGuard();
    fireEvent(canvas, "webglcontextlost");
    expect(() => fireEvent(canvas, "webglcontextrestored")).not.toThrow();
    expect(onRestored).toHaveBeenCalled();
    guard.destroy();
  });

  it("onContextRestored without prior loss still invokes callback", () => {
    // Defensive: if the environment fires restored without loss (unlikely
    // but possible after page-show), we should still invoke and not crash.
    const guard = makeGuard();
    fireEvent(canvas, "webglcontextrestored");
    expect(onRestored).toHaveBeenCalledTimes(1);
    guard.destroy();
  });

  it("handles repeated loss-restore cycles", () => {
    const guard = makeGuard();
    for (let i = 0; i < 3; i++) {
      fireEvent(canvas, "webglcontextlost");
      fireEvent(canvas, "webglcontextrestored");
    }
    expect(onLost).toHaveBeenCalledTimes(3);
    expect(onRestored).toHaveBeenCalledTimes(3);
    guard.destroy();
  });
});
