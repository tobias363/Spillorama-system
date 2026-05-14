/**
 * @vitest-environment happy-dom
 *
 * LoadingOverlay state-machine tests.
 *
 * Originally added in BIN-673. Updated 2026-05-03 (Tobias-direktiv) for the
 * Spillorama-branded redesign + connection-error fallback. Tobias-bug
 * 2026-05-14 (BUG-A defense-in-depth) splittet stuck-fallback i to nivåer:
 *
 *   - setState("READY") hides the overlay and cancels both timers
 *   - setState("CONNECTING") / "LOADING_ASSETS" / etc show the right message
 *   - Soft fallback ved `softFallbackMs` (default 8s) — "Venter på neste
 *     spill" + retry-knapp. IKKE whole-overlay-click — kun knappen er
 *     interaktiv. Knappen kaller `onRetry` (eller `onReload` som fallback).
 *   - DISCONNECTED enters the harsh error fallback immediately (no
 *     auto-recovery is in-flight)
 *   - I harsh error state er HELE overlay-et klikkbart → reload (Tobias)
 *   - setError(msg) er den eksplisitte-fallback escape-hatch for ikke-socket-
 *     paths (HTTP room-join failure osv.)
 *   - Back-to-back setState calls resetter soft-fallback-timer hver gang
 *
 * Run: `npm --prefix packages/game-client test -- --run LoadingOverlay`
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  LoadingOverlay,
  type LoadingState,
  SOFT_FALLBACK_HEADLINE,
  SOFT_FALLBACK_RETRY_LABEL,
} from "./LoadingOverlay.js";

const ERROR_CLASS = "spillorama-loading-overlay--error";
const SOFT_CLASS = "spillorama-loading-overlay--soft-fallback";
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
    // Tobias-direktiv 2026-05-03: alle loading-states viser "Laster spill"
    // (LoadingOverlay.ts:45-54). Tidligere state-spesifikke meldinger er
    // fjernet for å gi spilleren én enhetlig opplevelse uavhengig av
    // underliggende socket/room/asset-fase. Tester ovenfor holder fortsatt
    // mer-spesifikke kontrakter (DISCONNECTED → ERROR_TEXT, error fallback).
    const recoverableStates: LoadingState[] = [
      "CONNECTING",
      "JOINING_ROOM",
      "LOADING_ASSETS",
      "SYNCING",
      "RECONNECTING",
      "RESYNCING",
    ];

    it.each(recoverableStates)("state %s shows overlay with unified 'Laster spill' message", (state) => {
      overlay = new LoadingOverlay(container);
      overlay.setState(state);
      expect(overlay.getState()).toBe(state);
      expect(overlay.isShowing()).toBe(true);
      expect(container.textContent).toContain("Laster spill");
      expect(overlay.isInErrorState()).toBe(false);
    });

    it("setState('READY') hides overlay", () => {
      overlay = new LoadingOverlay(container);
      overlay.setState("CONNECTING");
      expect(overlay.isShowing()).toBe(true);
      overlay.setState("READY");
      expect(overlay.isShowing()).toBe(false);
    });

    it("custom message is intentionally ignored (Tobias 2026-05-03 unified copy)", () => {
      // setState ignorerer customMessage og viser alltid "Laster spill"
      // i ikke-error-tilstander (LoadingOverlay.ts:326-330).
      overlay = new LoadingOverlay(container);
      overlay.setState("CONNECTING", "Egendefinert melding");
      expect(container.textContent).toContain("Laster spill");
      expect(container.textContent).not.toContain("Egendefinert melding");
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

    // Tobias-bug 2026-05-14 (BUG-A defense-in-depth): auto-firing av harsh
    // error fallback ved stuck-timeout er erstattet av soft fallback. Harsh
    // error trigges nå EKSKLUSIVT av `setError()` eller
    // `setState("DISCONNECTED")`. De gamle stuck-timer-tests er flyttet til
    // "soft fallback"-blokken (under).
    it("recoverable state does NOT auto-fire harsh error fallback (regression)", () => {
      overlay = new LoadingOverlay(container, { softFallbackMs: 5000 });
      overlay.setState("RECONNECTING");
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;

      // Selv etter at soft-fallback-timer firer (5s) skal harsh error-state
      // forbli inaktiv — den krever eksplisitt setError() eller DISCONNECTED.
      vi.advanceTimersByTime(10_000);
      expect(root.classList.contains(ERROR_CLASS)).toBe(false);
      expect(overlay.isInErrorState()).toBe(false);
    });

    it("transitioning to READY clears any harsh error state", () => {
      overlay = new LoadingOverlay(container);
      overlay.setError(); // Eksplisitt harsh fallback
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

    it("clicking the overlay in harsh error state invokes onReload", () => {
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, { onReload });
      overlay.setError(); // Eksplisitt harsh fallback (whole-overlay-click)
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

    it("setError() cancels any pending soft-fallback-timer (no double-fire)", () => {
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, { softFallbackMs: 1000, onReload });
      overlay.setState("RECONNECTING");
      overlay.setError();
      vi.advanceTimersByTime(2000);
      // Soft-fallback-timer-en skal være kanselert — vi skal ikke flippe
      // tilbake til soft fallback etter setError(). Whole-overlay-click
      // skal fortsatt trigge reload (én gang).
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      expect(root.classList.contains(SOFT_CLASS)).toBe(false);
      expect(overlay.isInSoftFallback()).toBe(false);
      root.click();
      expect(onReload).toHaveBeenCalledOnce();
    });
  });

  describe("soft fallback (Tobias-bug 2026-05-14, BUG-A defense-in-depth)", () => {
    // Tobias-trace 07:40:07-07:43: klient transitioner LOADING → WAITING,
    // åpner buy-popup gate (gameStatus=NONE), så 4+ min stillhet. Backend
    // hadde stuck plan-run og emittet aldri ny room:update. Frontend må
    // tilby actionable fallback i stedet for evig "Laster spill"-spinner.
    //
    // Krav per task:
    //  1. Timeout fyrer etter 8s uten state-update
    //  2. Timeout fyrer IKKE hvis state-update kommer innen 8s
    //  3. Retry-knapp trigger onRetry
    //  4. Etter retry: timeout-state resettes (caller styrer via setState)
    //  5. Multiple timeout-fyringer er idempotente (vis state vises bare én gang)

    it("aktiverer fallback etter softFallbackMs (default 8000)", () => {
      overlay = new LoadingOverlay(container);
      overlay.setState("JOINING_ROOM");
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;

      expect(overlay.isInSoftFallback()).toBe(false);
      vi.advanceTimersByTime(7999);
      expect(overlay.isInSoftFallback()).toBe(false);
      expect(root.classList.contains(SOFT_CLASS)).toBe(false);

      vi.advanceTimersByTime(1);
      expect(overlay.isInSoftFallback()).toBe(true);
      expect(root.classList.contains(SOFT_CLASS)).toBe(true);
      expect(container.textContent).toContain(SOFT_FALLBACK_HEADLINE);
    });

    it("rendrer retry-knapp med stabilt data-testid + label", () => {
      overlay = new LoadingOverlay(container, { softFallbackMs: 100 });
      overlay.setState("JOINING_ROOM");
      vi.advanceTimersByTime(101);

      const btn = container.querySelector<HTMLButtonElement>(
        '[data-testid="loading-overlay-retry"]',
      );
      expect(btn).not.toBeNull();
      expect(btn?.textContent).toBe(SOFT_FALLBACK_RETRY_LABEL);
      // Whole-overlay-click skal IKKE være aktiv i soft fallback — kun
      // knappen er interaktiv.
      const root = container.querySelector(".spillorama-loading-overlay") as HTMLElement;
      expect(root.classList.contains(ERROR_CLASS)).toBe(false);
    });

    it("setState før timeout canceller fallback (Krav 2)", () => {
      overlay = new LoadingOverlay(container, { softFallbackMs: 5000 });
      overlay.setState("JOINING_ROOM");
      vi.advanceTimersByTime(4000);
      // Fersk state-update — controlleren mottok room:update e.l.
      overlay.setState("SYNCING");
      // Original timer skulle fyrt nå — men setState canselerte den og
      // resatte 5s vinduet.
      vi.advanceTimersByTime(1000); // total 5s siden første state, men kun 1s siden ny
      expect(overlay.isInSoftFallback()).toBe(false);
      vi.advanceTimersByTime(4000); // nå 5s siden siste setState
      expect(overlay.isInSoftFallback()).toBe(true);
    });

    it("setState('READY') canceller fallback selv om timer hadde fyrt", () => {
      overlay = new LoadingOverlay(container, { softFallbackMs: 100 });
      overlay.setState("JOINING_ROOM");
      vi.advanceTimersByTime(101);
      expect(overlay.isInSoftFallback()).toBe(true);

      overlay.setState("READY");
      expect(overlay.isInSoftFallback()).toBe(false);
      expect(overlay.isShowing()).toBe(false);
    });

    it("retry-knapp kaller onRetry-callback (Krav 3)", async () => {
      const onRetry = vi.fn();
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, {
        softFallbackMs: 100,
        onRetry,
        onReload,
      });
      overlay.setState("JOINING_ROOM");
      vi.advanceTimersByTime(101);

      const btn = container.querySelector<HTMLButtonElement>(
        '[data-testid="loading-overlay-retry"]',
      );
      expect(btn).not.toBeNull();
      btn?.click();
      // onRetry skal kalles, IKKE onReload (vi vil ha non-destructive retry).
      expect(onRetry).toHaveBeenCalledOnce();
      expect(onReload).not.toHaveBeenCalled();
    });

    it("retry-knapp uten onRetry-handler faller tilbake til onReload", async () => {
      const onReload = vi.fn();
      overlay = new LoadingOverlay(container, {
        softFallbackMs: 100,
        onReload,
      });
      overlay.setState("JOINING_ROOM");
      vi.advanceTimersByTime(101);

      const btn = container.querySelector<HTMLButtonElement>(
        '[data-testid="loading-overlay-retry"]',
      );
      btn?.click();
      expect(onReload).toHaveBeenCalledOnce();
    });

    it("retry-knapp disabled mens callback in-flight, re-enabled etter (Krav 4)", async () => {
      let resolveRetry!: () => void;
      const retryPromise = new Promise<void>((r) => {
        resolveRetry = r;
      });
      const onRetry = vi.fn(() => retryPromise);
      overlay = new LoadingOverlay(container, { softFallbackMs: 100, onRetry });
      overlay.setState("JOINING_ROOM");
      vi.advanceTimersByTime(101);

      const btn = container.querySelector<HTMLButtonElement>(
        '[data-testid="loading-overlay-retry"]',
      );
      expect(btn?.disabled).toBe(false);

      btn?.click();
      expect(btn?.disabled).toBe(true);
      expect(onRetry).toHaveBeenCalledOnce();

      resolveRetry();
      await retryPromise; // drain microtasks
      await Promise.resolve();
      // Etter callback fullfører: re-enable (fallback er fortsatt aktiv).
      expect(btn?.disabled).toBe(false);
    });

    it("triggerSoftFallback() er idempotent (Krav 5)", () => {
      const onSoftFallback = vi.fn();
      overlay = new LoadingOverlay(container, {
        softFallbackMs: 100,
        onSoftFallback,
      });
      overlay.setState("JOINING_ROOM");

      overlay.triggerSoftFallback();
      overlay.triggerSoftFallback();
      overlay.triggerSoftFallback();

      expect(onSoftFallback).toHaveBeenCalledOnce();
      // DOM skal kun ha én retry-knapp.
      const btns = container.querySelectorAll('[data-testid="loading-overlay-retry"]');
      expect(btns.length).toBe(1);
    });

    it("onSoftFallback fires med riktig payload-shape", () => {
      const onSoftFallback = vi.fn();
      overlay = new LoadingOverlay(container, {
        softFallbackMs: 8000,
        onSoftFallback,
      });
      overlay.setState("RECONNECTING");
      vi.advanceTimersByTime(8000);

      expect(onSoftFallback).toHaveBeenCalledOnce();
      const info = onSoftFallback.mock.calls[0]?.[0];
      expect(info).toMatchObject({
        triggeredState: "RECONNECTING",
        triggeredAt: expect.any(Number),
        timeSinceLastUpdate: expect.any(Number),
      });
      expect(info.timeSinceLastUpdate).toBeGreaterThanOrEqual(7999);
      expect(info.timeSinceLastUpdate).toBeLessThanOrEqual(8500);
    });

    it("softFallbackMs=0 disable-er soft fallback helt", () => {
      overlay = new LoadingOverlay(container, { softFallbackMs: 0 });
      overlay.setState("JOINING_ROOM");
      vi.advanceTimersByTime(60_000);
      expect(overlay.isInSoftFallback()).toBe(false);
    });

    it("DISCONNECTED tar precedence over aktiv soft fallback", () => {
      overlay = new LoadingOverlay(container, { softFallbackMs: 100 });
      overlay.setState("RECONNECTING");
      vi.advanceTimersByTime(101);
      expect(overlay.isInSoftFallback()).toBe(true);

      overlay.setState("DISCONNECTED");
      expect(overlay.isInSoftFallback()).toBe(false);
      expect(overlay.isInErrorState()).toBe(true);
    });

    it("setError() tar precedence over aktiv soft fallback", () => {
      overlay = new LoadingOverlay(container, { softFallbackMs: 100 });
      overlay.setState("RECONNECTING");
      vi.advanceTimersByTime(101);
      expect(overlay.isInSoftFallback()).toBe(true);

      overlay.setError();
      expect(overlay.isInSoftFallback()).toBe(false);
      expect(overlay.isInErrorState()).toBe(true);
    });

    it("setRetryHandler() oppdaterer onRetry etter konstruksjon", () => {
      const initialRetry = vi.fn();
      const newRetry = vi.fn();
      overlay = new LoadingOverlay(container, {
        softFallbackMs: 100,
        onRetry: initialRetry,
      });
      overlay.setRetryHandler(newRetry);
      overlay.setState("JOINING_ROOM");
      vi.advanceTimersByTime(101);

      const btn = container.querySelector<HTMLButtonElement>(
        '[data-testid="loading-overlay-retry"]',
      );
      btn?.click();
      expect(newRetry).toHaveBeenCalledOnce();
      expect(initialRetry).not.toHaveBeenCalled();
    });

    it("stuckThresholdMs alias virker som softFallbackMs (backward compat)", () => {
      // Eldre call-sites bruker `stuckThresholdMs` — alias-en skal styre
      // soft-fallback-timer-en (ikke harsh-error som tidligere).
      overlay = new LoadingOverlay(container, { stuckThresholdMs: 100 });
      overlay.setState("RECONNECTING");
      vi.advanceTimersByTime(101);
      expect(overlay.isInSoftFallback()).toBe(true);
      // Harsh error skal IKKE være aktiv — det er nettopp endringen.
      expect(overlay.isInErrorState()).toBe(false);
    });

    it("softFallbackMs vinner over stuckThresholdMs hvis begge satt", () => {
      overlay = new LoadingOverlay(container, {
        softFallbackMs: 500,
        stuckThresholdMs: 2000,
      });
      overlay.setState("RECONNECTING");
      vi.advanceTimersByTime(499);
      expect(overlay.isInSoftFallback()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(overlay.isInSoftFallback()).toBe(true);
    });
  });

  describe("legacy show()/hide() API", () => {
    it("show(msg) displays overlay (msg arg ignored — unified copy per Tobias 2026-05-03)", () => {
      // show() forwarder til setState("SYNCING", message), men setState
      // ignorerer customMessage og viser alltid "Laster spill" i ikke-error-
      // tilstander. Behold show()/hide() for backward-compat med eldre
      // call-sites, men dokumenter at `message`-argumentet er no-op.
      overlay = new LoadingOverlay(container);
      overlay.show("Egendefinert");
      expect(overlay.isShowing()).toBe(true);
      expect(container.textContent).toContain("Laster spill");
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

    it("destroy() cancels pending soft-fallback-timer", () => {
      overlay = new LoadingOverlay(container, { softFallbackMs: 1000 });
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
