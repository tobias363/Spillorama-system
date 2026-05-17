import { describe, expect, it, vi } from "vitest";
import { LoadingTransitionController } from "./LoadingTransitionController.js";

/**
 * Regresjons-tester for P0-3 (ekstern-konsulent-plan 2026-05-17).
 *
 * Pre-P0-3 var `PlayScreen.loadingTransitionDeadline` kun en wall-clock-
 * timestamp som ble sjekket inni `update(state)`. Hvis serveren sluttet å
 * sende `room:update` (frozen-state) etter `gameStatus`-transition
 * RUNNING → ikke-RUNNING, stoppet `update()` å kjøre — og loader-state
 * sto evig i UI fordi sjekken `Date.now() < deadline` aldri kjørte igjen.
 *
 * Disse testene verifiserer at `LoadingTransitionController`:
 * - Fyrer `onTimeout`-callback når timer går av uten manuell `clear()`
 * - IKKE fyrer hvis `clear()` kalles før timer
 * - Re-armering kanselerer forrige timer (idempotent)
 * - Wall-clock `isActive()` matcher faktisk timer-state
 * - `destroy()` cancler timer og blokkerer videre `arm()`-kall
 * - Cleanly håndterer callback-feil (fail-soft)
 */

interface TestHarness {
  fakeNow: number;
  setTimeoutSpy: ReturnType<typeof vi.fn>;
  clearTimeoutSpy: ReturnType<typeof vi.fn>;
  onTimeout: ReturnType<typeof vi.fn>;
  controller: LoadingTransitionController;
  /** Bump klokka og fyrer pending timer hvis delay passert. */
  advance: (ms: number) => void;
}

function buildHarness(timeoutMs = 10_000): TestHarness {
  let fakeNow = 1_000_000;
  let pendingTimer: { id: number; fireAt: number; cb: () => void } | null = null;
  let nextTimerId = 1;

  const setTimeoutSpy = vi.fn((cb: () => void, delay: number) => {
    const id = nextTimerId++;
    pendingTimer = { id, fireAt: fakeNow + delay, cb };
    return id;
  });
  const clearTimeoutSpy = vi.fn((id: number) => {
    if (pendingTimer && pendingTimer.id === id) {
      pendingTimer = null;
    }
  });
  const onTimeout = vi.fn();

  const controller = new LoadingTransitionController({
    timeoutMs,
    onTimeout,
    setTimeoutFn: setTimeoutSpy as unknown as typeof setTimeout,
    clearTimeoutFn: clearTimeoutSpy as unknown as typeof clearTimeout,
    now: () => fakeNow,
  });

  return {
    get fakeNow() { return fakeNow; },
    setTimeoutSpy,
    clearTimeoutSpy,
    onTimeout,
    controller,
    advance(ms: number) {
      fakeNow += ms;
      if (pendingTimer && fakeNow >= pendingTimer.fireAt) {
        const cb = pendingTimer.cb;
        pendingTimer = null;
        cb();
      }
    },
  };
}

describe("LoadingTransitionController", () => {
  describe("arm + clear lifecycle", () => {
    it("arm() setter deadline og armer timer", () => {
      const h = buildHarness();
      h.controller.arm();

      expect(h.controller.getDeadline()).toBe(h.fakeNow + 10_000);
      expect(h.controller.hasActiveTimer()).toBe(true);
      expect(h.controller.isActive()).toBe(true);
      expect(h.setTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    it("clear() rydder både deadline og timer", () => {
      const h = buildHarness();
      h.controller.arm();
      h.controller.clear();

      expect(h.controller.getDeadline()).toBe(null);
      expect(h.controller.hasActiveTimer()).toBe(false);
      expect(h.controller.isActive()).toBe(false);
      expect(h.clearTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    it("clear() er idempotent", () => {
      const h = buildHarness();
      h.controller.clear();
      h.controller.clear();
      expect(h.clearTimeoutSpy).not.toHaveBeenCalled();
    });

    it("arm() er idempotent — gjentatte arm() cancler forrige timer", () => {
      const h = buildHarness();
      h.controller.arm();
      h.controller.arm();
      h.controller.arm();

      expect(h.setTimeoutSpy).toHaveBeenCalledTimes(3);
      expect(h.clearTimeoutSpy).toHaveBeenCalledTimes(2); // 2× cancel before re-arm
      expect(h.controller.hasActiveTimer()).toBe(true);
    });
  });

  describe("onTimeout-callback", () => {
    it("fyres når timer går av uten clear()", () => {
      const h = buildHarness();
      h.controller.arm();
      h.advance(10_000);

      expect(h.onTimeout).toHaveBeenCalledTimes(1);
      expect(h.controller.getDeadline()).toBe(null);
      expect(h.controller.hasActiveTimer()).toBe(false);
    });

    it("IKKE fyres hvis clear() kalles før timer", () => {
      const h = buildHarness();
      h.controller.arm();
      h.advance(5_000);
      h.controller.clear();
      h.advance(10_000);

      expect(h.onTimeout).not.toHaveBeenCalled();
    });

    it("IKKE fyres etter destroy()", () => {
      const h = buildHarness();
      h.controller.arm();
      h.controller.destroy();
      h.advance(15_000);

      expect(h.onTimeout).not.toHaveBeenCalled();
    });

    it("fail-soft hvis onTimeout-callback kaster", () => {
      const h = buildHarness();
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      h.onTimeout.mockImplementationOnce(() => {
        throw new Error("update() crashed");
      });

      h.controller.arm();
      expect(() => h.advance(10_000)).not.toThrow();

      expect(h.onTimeout).toHaveBeenCalledTimes(1);
      // Controller skal være i ren state for neste arm()-syklus.
      expect(h.controller.getDeadline()).toBe(null);
      expect(h.controller.hasActiveTimer()).toBe(false);
      // Loggte feilen.
      expect(consoleSpy).toHaveBeenCalled();

      // Neste arm() skal fungere normalt.
      h.controller.arm();
      expect(h.controller.hasActiveTimer()).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe("isActive() — wall-clock-evaluering", () => {
    it("true mens deadline > now", () => {
      const h = buildHarness();
      h.controller.arm();
      h.advance(5_000);
      expect(h.controller.isActive()).toBe(true);
    });

    it("false når deadline = now (kantillfelle)", () => {
      const h = buildHarness();
      h.controller.arm();
      h.advance(10_000); // exactly at deadline — timer fyrer + clearer

      expect(h.controller.isActive()).toBe(false);
    });

    it("false når deadline har passert uten timer-trigger (race-window i samme tick)", () => {
      // Bygg en harness der vi kan bumpe `now()` UTEN å fyre timer-callback.
      // Dette simulerer en race hvor wall-clock har passert deadline men
      // timer-callback ennå ikke har kjørt (eks. lang task blokkerer
      // event-loop).
      let nowMs = 1_000_000;
      const noopSetTimeout = vi.fn(() => 1) as unknown as typeof setTimeout;
      const noopClearTimeout = vi.fn() as unknown as typeof clearTimeout;
      const controller = new LoadingTransitionController({
        timeoutMs: 10_000,
        onTimeout: () => {},
        setTimeoutFn: noopSetTimeout,
        clearTimeoutFn: noopClearTimeout,
        now: () => nowMs,
      });
      controller.arm();
      expect(controller.isActive()).toBe(true);

      // Bumpe nowMs forbi deadline uten å trigge noopSetTimeout-callback.
      nowMs += 11_000;
      expect(controller.isActive()).toBe(false);
      expect(controller.getDeadline()).toBe(1_000_000 + 10_000);
    });

    it("false når aldri armert", () => {
      const h = buildHarness();
      expect(h.controller.isActive()).toBe(false);
    });
  });

  describe("destroy() lifecycle", () => {
    it("destroy() cancler armert timer", () => {
      const h = buildHarness();
      h.controller.arm();
      h.controller.destroy();

      expect(h.clearTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(h.controller.hasActiveTimer()).toBe(false);
    });

    it("arm() etter destroy() er no-op", () => {
      const h = buildHarness();
      h.controller.destroy();
      h.controller.arm();

      expect(h.setTimeoutSpy).not.toHaveBeenCalled();
      expect(h.controller.hasActiveTimer()).toBe(false);
    });

    it("destroy() er idempotent", () => {
      const h = buildHarness();
      h.controller.arm();
      h.controller.destroy();
      h.controller.destroy();

      expect(h.clearTimeoutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("integrasjon — frozen-state-scenario", () => {
    it("hovedscenariet: arm → server slutter å sende update → timer fyrer cleanup", () => {
      const h = buildHarness();

      // RUNNING → ENDED transition i PlayScreen.update():
      h.controller.arm();
      expect(h.controller.isActive()).toBe(true);

      // 5 s passerer — fortsatt aktiv (normal pause før server-advance).
      h.advance(5_000);
      expect(h.controller.isActive()).toBe(true);
      expect(h.onTimeout).not.toHaveBeenCalled();

      // Serveren slutter å sende room:update. Ingen ny update() kalt
      // mellom her og deadline-passering. Timer fyrer cleanup.
      h.advance(5_000); // total 10 s
      expect(h.onTimeout).toHaveBeenCalledTimes(1);
      expect(h.controller.isActive()).toBe(false);
      expect(h.controller.getDeadline()).toBe(null);
    });

    it("happy path: arm → server sender slug-advance → controller cleared før timer", () => {
      const h = buildHarness();

      h.controller.arm();
      h.advance(50); // 50 ms — server-broadcast lander
      h.controller.clear(); // PlayScreen.setNextScheduledGameSlug

      h.advance(20_000); // langt over deadline
      expect(h.onTimeout).not.toHaveBeenCalled();
    });

    it("nye runder: arm → ny runde starter (RUNNING) → arm igjen → nytt RUNNING→ENDED", () => {
      const h = buildHarness();

      // Runde 1 ender
      h.controller.arm();
      // Backend sender room:update WAITING → RUNNING
      h.controller.clear();

      // Runde 2 ender (~30 s senere)
      h.advance(30_000);
      h.controller.arm();

      // Server stopper igjen
      h.advance(10_000);
      expect(h.onTimeout).toHaveBeenCalledTimes(1);
    });
  });
});
