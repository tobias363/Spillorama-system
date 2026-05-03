/**
 * @vitest-environment happy-dom
 *
 * LoadingOverlay state-machine tests.
 *
 * Originally added in BIN-673. Updated 2026-05-03 (Tobias-direktiv) for the
 * Spillorama-branded redesign + connection-error fallback:
 *
 *   - setState("READY") hides the overlay and cancels the stuck-timer
 *   - setState("CONNECTING") / "LOADING_ASSETS" / etc show the right message
 *   - stuck-timer surfaces the error-fallback after `stuckThresholdMs`
 *   - DISCONNECTED enters the error fallback immediately (no auto-recovery)
 *   - In the error state the WHOLE overlay is clickable → reload (Tobias)
 *   - Back-to-back setState calls reset the stuck-timer each time
 *   - Legacy show()/hide() API maps to setState() behavior
 *   - setError(msg) is the explicit-fallback escape hatch for non-socket
 *     paths (HTTP room-join failure etc.)
 *
 * Run: `npm --prefix packages/game-client test -- --run LoadingOverlay`
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LoadingOverlay, type LoadingState } from "./LoadingOverlay.js";

const ERROR_CLASS = "spillorama-loading-overlay--error";
const ERROR_TEXT = "Får ikke koblet til rom. Trykk her";

describe("LoadingOverlay state-machine", () => {
  let container: HTMLElement;
  let overlay: LoadingOverlay;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.useFakeTimers();
  });

  afterEach(() => {
    overlay?.destroy();
    container.remove();
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("defaults to READY (overlay hidden)", () => {
      overlay = new LoadingOverlay(container);
      expect(overlay.getState()).toBe("READY");
      expect(overlay.isShowing()).toBe(false);
    });

    it("renders the Spillorama wheel-logo + label scaffold in the DOM", () => {
      overlay = new LoadingOverlay(container);
      expect(container.querySelector("img.spillorama-loading-overlay__logo-img")).toBeTruthy();
      expect(container.querySelector(".spillorama-loading-overlay__label")).toBeTruthy();
      expect(container.querySelector(".spillorama-loading-overlay__dots")).toBeTruthy();
    });
  });

  describe("setState transitions", () => {
    const transitions: Array<[LoadingState, string]> = [
      ["CONNECTING", "Kobler til"],
      ["JOINING_ROOM", "Finner runden"],
      ["LOADING_ASSETS", "Laster spill"],
      ["SYNCING", "Henter rundedata"],
      ["RECONNECTING", "Kobler til igjen"],
      ["RESYNCING", "Oppdaterer spillet"],
    ];

    it.each(transitions)("state %s shows overlay with message %s", (state, expectedMsg) => {
      overlay = new LoadingOverlay(container);
      overlay.setState(state);
      expect(overlay.getState()).toBe(state);
      expect(overlay.isShowing()).toBe(true);
      expect(container.textContent).toContain(expectedMsg);
      expect(overlay.isInErrorState()).toBe(false);
    });

    it("setState('READY') hides overlay", () => {
      overlay = new LoadingOverlay(container);
      overlay.setState("CONNECTING");
      expect(overlay.isShowing()).toBe(true);
      overlay.setState("READY");
      expect(overlay.isShowing()).toBe(false);
    });

    it("custom message overrides the default for the state", () => {
      overlay = new LoadingOverlay(container);
      overlay.setState("CONNECTING", "Egendefinert melding");
      expect(container.textContent).toContain("Egendefinert melding");
      expect(container.textContent).not.toContain("Kobler til...");
    });
  });

  describe("error fallback (Tobias 2026-05-03)", () => {
    it("DISCONNECTED enters error state immediately with reload-on-click text", () => {
      overlay = new LoadingOverlay(container);
      overlay.setState("DISCONNECTED");
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      expect(root.classList.contains(ERROR_CLASS)).toBe(true);
      expect(overlay.isInErrorState()).toBe(true);
      expect(container.textContent).toContain(ERROR_TEXT);
    });

    it("non-DISCONNECTED states do NOT immediately show error fallback", () => {
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 5000 });
      overlay.setState("RECONNECTING");
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      expect(root.classList.contains(ERROR_CLASS)).toBe(false);
      expect(overlay.isInErrorState()).toBe(false);
    });

    it("error fallback appears after stuckThresholdMs for recoverable states", () => {
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 5000 });
      overlay.setState("RECONNECTING");
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;

      expect(root.classList.contains(ERROR_CLASS)).toBe(false);
      vi.advanceTimersByTime(4999);
      expect(root.classList.contains(ERROR_CLASS)).toBe(false);
      vi.advanceTimersByTime(1);
      expect(root.classList.contains(ERROR_CLASS)).toBe(true);
      expect(container.textContent).toContain(ERROR_TEXT);
    });

    it("transitioning to READY clears the error state + cancels stuck-timer", () => {
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 1000 });
      overlay.setState("RECONNECTING");
      vi.advanceTimersByTime(1001);
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      expect(root.classList.contains(ERROR_CLASS)).toBe(true);

      overlay.setState("READY");
      expect(root.classList.contains(ERROR_CLASS)).toBe(false);
      expect(overlay.isInErrorState()).toBe(false);
    });

    it("transitioning to a recoverable state clears any prior error state", () => {
      overlay = new LoadingOverlay(container);
      overlay.setState("DISCONNECTED");
      expect(overlay.isInErrorState()).toBe(true);

      overlay.setState("RECONNECTING");
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      expect(root.classList.contains(ERROR_CLASS)).toBe(false);
      expect(overlay.isInErrorState()).toBe(false);
    });

    it("new setState resets the stuck-timer", () => {
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 5000 });
      overlay.setState("CONNECTING");
      vi.advanceTimersByTime(4000);
      overlay.setState("JOINING_ROOM"); // resets timer
      vi.advanceTimersByTime(4000); // total 8s, but only 4s into new timer
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      expect(root.classList.contains(ERROR_CLASS)).toBe(false);
      vi.advanceTimersByTime(1000); // now hits 5s
      expect(root.classList.contains(ERROR_CLASS)).toBe(true);
    });

    it("clicking the overlay in error state invokes onReload", () => {
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 100, onReload });
      overlay.setState("CONNECTING");
      vi.advanceTimersByTime(101);
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      root.click();
      expect(onReload).toHaveBeenCalledOnce();
    });

    it("clicks while in non-error state do NOT trigger reload", () => {
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, { onReload });
      overlay.setState("CONNECTING");
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      root.click();
      expect(onReload).not.toHaveBeenCalled();
    });

    it("setError() jumps directly to the error fallback with a custom message", () => {
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, { onReload });
      overlay.setError("Tilkobling mislyktes — trykk for å laste på nytt");
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      expect(root.classList.contains(ERROR_CLASS)).toBe(true);
      expect(container.textContent).toContain("Tilkobling mislyktes");
      root.click();
      expect(onReload).toHaveBeenCalledOnce();
    });

    it("setError() with no arg uses the Tobias-direktiv default message", () => {
      overlay = new LoadingOverlay(container);
      overlay.setError();
      expect(container.textContent).toContain(ERROR_TEXT);
    });

    it("setError() cancels any pending stuck-timer (no double-fire)", () => {
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 1000, onReload });
      overlay.setState("RECONNECTING");
      overlay.setError();
      vi.advanceTimersByTime(2000);
      // Should not double-flag — just one click should still resolve to one reload.
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      root.click();
      expect(onReload).toHaveBeenCalledOnce();
    });
  });

  describe("legacy show()/hide() API", () => {
    it("show(msg) displays overlay with the message", () => {
      overlay = new LoadingOverlay(container);
      overlay.show("Egendefinert");
      expect(overlay.isShowing()).toBe(true);
      expect(container.textContent).toContain("Egendefinert");
    });

    it("hide() returns to READY", () => {
      overlay = new LoadingOverlay(container);
      overlay.show("foo");
      overlay.hide();
      expect(overlay.getState()).toBe("READY");
      expect(overlay.isShowing()).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("destroy() removes the backdrop from DOM", () => {
      overlay = new LoadingOverlay(container);
      overlay.setState("CONNECTING");
      expect(container.querySelector(".spillorama-loading-overlay")).toBeTruthy();
      overlay.destroy();
      expect(container.querySelector(".spillorama-loading-overlay")).toBeFalsy();
    });

    it("destroy() cancels pending stuck-timer", () => {
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 1000 });
      overlay.setState("RECONNECTING");
      overlay.destroy();
      vi.advanceTimersByTime(2000); // would have fired — but destroy cancelled it
      // After destroy the overlay is gone, so we can't query it from the
      // container — but the timer's callback would have thrown if it ran
      // (would try to access this.backdrop after removal).
      expect(container.querySelector(".spillorama-loading-overlay")).toBeFalsy();
    });

    it("destroy() removes the click listener so subsequent clicks no-op", () => {
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, { onReload });
      overlay.setError();
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      overlay.destroy();
      // Element is detached — clicking it after destroy should not reload.
      root.click();
      expect(onReload).not.toHaveBeenCalled();
    });
  });
});
