/**
 * @vitest-environment happy-dom
 *
 * LoadingOverlay state-machine tests (BIN-673).
 *
 * Exercises the typed state-machine added in BIN-673 commit 1:
 *   - setState("READY") hides the overlay and cancels the stuck-timer
 *   - setState("CONNECTING") / "LOADING_ASSETS" / etc show the right message
 *   - stuck-timer surfaces the reload button after `stuckThresholdMs`
 *   - DISCONNECTED shows the reload button immediately (no auto-recovery)
 *   - Back-to-back setState calls reset the stuck-timer each time
 *   - Legacy show()/hide() API maps to setState() behavior
 *
 * Run: `npm --prefix packages/game-client test -- --run LoadingOverlay`
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LoadingOverlay, type LoadingState } from "./LoadingOverlay.js";

describe("LoadingOverlay state-machine (BIN-673)", () => {
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
  });

  describe("setState transitions", () => {
    const transitions: Array<[LoadingState, string]> = [
      ["CONNECTING", "Kobler til..."],
      ["JOINING_ROOM", "Finner runden..."],
      ["LOADING_ASSETS", "Laster spill..."],
      ["SYNCING", "Henter rundedata..."],
      ["RECONNECTING", "Kobler til igjen..."],
      ["RESYNCING", "Oppdaterer spillet..."],
      ["DISCONNECTED", "Frakoblet — prøver igjen..."],
    ];

    it.each(transitions)("state %s shows overlay with message %s", (state, expectedMsg) => {
      overlay = new LoadingOverlay(container);
      overlay.setState(state);
      expect(overlay.getState()).toBe(state);
      expect(overlay.isShowing()).toBe(true);
      expect(container.textContent).toContain(expectedMsg);
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

  describe("stuck-timer → reload button (BIN-673 user-escape)", () => {
    it("reload button is hidden initially", () => {
      overlay = new LoadingOverlay(container);
      overlay.setState("CONNECTING");
      const btn = container.querySelector("button");
      expect(btn?.textContent).toBe("Last siden på nytt");
      expect(getComputedStyle(btn!).display).toBe("none");
    });

    it("reload button appears after stuckThresholdMs", () => {
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 5000 });
      overlay.setState("RECONNECTING");
      const btn = container.querySelector("button")!;

      expect(btn.style.display).toBe("none");
      vi.advanceTimersByTime(4999);
      expect(btn.style.display).toBe("none");
      vi.advanceTimersByTime(1);
      expect(btn.style.display).toBe("inline-block");
    });

    it("DISCONNECTED shows reload button immediately (no auto-recovery)", () => {
      overlay = new LoadingOverlay(container);
      overlay.setState("DISCONNECTED");
      const btn = container.querySelector("button")!;
      expect(btn.style.display).toBe("inline-block");
    });

    it("transitioning to READY hides reload button + cancels stuck-timer", () => {
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 1000 });
      overlay.setState("RECONNECTING");
      vi.advanceTimersByTime(1001);
      const btn = container.querySelector("button")!;
      expect(btn.style.display).toBe("inline-block");

      overlay.setState("READY");
      expect(btn.style.display).toBe("none");
    });

    it("new setState resets the stuck-timer", () => {
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 5000 });
      overlay.setState("CONNECTING");
      vi.advanceTimersByTime(4000);
      overlay.setState("JOINING_ROOM"); // resets timer
      vi.advanceTimersByTime(4000); // total 8s, but only 4s into new timer
      const btn = container.querySelector("button")!;
      expect(btn.style.display).toBe("none");
      vi.advanceTimersByTime(1000); // now hits 5s
      expect(btn.style.display).toBe("inline-block");
    });

    it("reload button click invokes onReload callback", () => {
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 100, onReload });
      overlay.setState("CONNECTING");
      vi.advanceTimersByTime(101);
      const btn = container.querySelector("button") as HTMLButtonElement;
      btn.click();
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
      expect(container.querySelector("div")).toBeTruthy();
      overlay.destroy();
      expect(container.querySelector("div")).toBeFalsy();
    });

    it("destroy() cancels pending stuck-timer", () => {
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 1000 });
      overlay.setState("RECONNECTING");
      overlay.destroy();
      vi.advanceTimersByTime(2000); // would have fired — but destroy cancelled it
      // No button to find since overlay was destroyed — if timer had fired it
      // would have thrown trying to access this.reloadBtn.
      expect(container.querySelector("button")).toBeFalsy();
    });
  });
});
