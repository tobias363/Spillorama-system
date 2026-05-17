/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from "vitest";
import { AutoReloadOnDisconnect } from "./AutoReloadOnDisconnect.js";

/**
 * Tester for auto-reload-on-disconnect (Tobias-bug 2026-05-12).
 *
 * Dekker:
 *   - armReload + cancelReload happy-path (ingen reload hvis cancelled)
 *   - armReload fyrer reload etter delayMs hvis ikke cancelled
 *   - reload-attempts persisteres i storage
 *   - >= maxAttempts → onMaxAttemptsReached callback fyrer i stedet for reload
 *   - eldre attempts utenfor window filtreres bort
 *   - resetAttempts nullstiller counter
 *   - storage-feil svelges (reload skjer uansett)
 *   - dobbel armReload er idempotent (timer ikke restartet)
 *   - PR #1247-regresjon: armReload er no-op før markConnected() er kalt
 *   - PR #1247-regresjon: armReload fyrer normalt etter markConnected()
 *   - PR #1247-regresjon: markConnected() er one-way (forblir true)
 *   - PR #1247-regresjon: default delayMs er 30s
 *
 * NB: Alle armReload-tester må kalle markConnected() FØRST — armReload er
 * no-op før socket har koblet til minst én gang. Dette er en defensive
 * gate mot reload-loop ved permanent initial-connect-failure.
 */

function makeMemoryStorage(): {
  store: Map<string, string>;
  api: Pick<Storage, "getItem" | "setItem" | "removeItem">;
} {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
}

describe("AutoReloadOnDisconnect", () => {
  it("armReload + cancelReload → ingen reload", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 5000,
      reloadFn,
      storage: makeMemoryStorage().api,
    });
    reloader.markConnected();

    reloader.armReload();
    vi.advanceTimersByTime(2000);
    reloader.cancelReload();
    vi.advanceTimersByTime(10000);

    expect(reloadFn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("armReload uten cancel → reload etter delayMs", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 5000,
      reloadFn,
      storage: makeMemoryStorage().api,
    });
    reloader.markConnected();

    reloader.armReload();
    expect(reloadFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4999);
    expect(reloadFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(reloadFn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("attempts persisteres i storage", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const memStorage = makeMemoryStorage();
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 100,
      reloadFn,
      storage: memStorage.api,
      now: () => 1_000_000,
    });
    reloader.markConnected();

    reloader.armReload();
    vi.advanceTimersByTime(100);
    expect(reloadFn).toHaveBeenCalledTimes(1);
    expect(memStorage.store.get("spillorama:reload-attempts")).toBe(
      JSON.stringify([1_000_000]),
    );
    vi.useRealTimers();
  });

  it(">= maxAttempts → onMaxAttemptsReached fyrer + ingen reload", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const onMaxAttemptsReached = vi.fn();
    const memStorage = makeMemoryStorage();
    // Forhåndsutfyll storage med 3 attempts innenfor window.
    memStorage.store.set(
      "spillorama:reload-attempts",
      JSON.stringify([1_000_000, 1_000_001, 1_000_002]),
    );
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 100,
      maxAttempts: 3,
      windowMs: 60_000,
      reloadFn,
      onMaxAttemptsReached,
      storage: memStorage.api,
      now: () => 1_010_000, // 10s etter siste attempt
    });
    reloader.markConnected();

    reloader.armReload();
    vi.advanceTimersByTime(100);

    expect(reloadFn).not.toHaveBeenCalled();
    expect(onMaxAttemptsReached).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("attempts utenfor window filtreres bort", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const onMaxAttemptsReached = vi.fn();
    const memStorage = makeMemoryStorage();
    // 3 attempts MEN alle eldre enn 2 min — skal ikke telles.
    memStorage.store.set(
      "spillorama:reload-attempts",
      JSON.stringify([1_000_000, 1_000_001, 1_000_002]),
    );
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 100,
      maxAttempts: 3,
      windowMs: 60_000,
      reloadFn,
      onMaxAttemptsReached,
      storage: memStorage.api,
      now: () => 1_070_000, // 70s etter — alle 3 attempts utenfor window
    });
    reloader.markConnected();

    reloader.armReload();
    vi.advanceTimersByTime(100);

    expect(reloadFn).toHaveBeenCalledTimes(1);
    expect(onMaxAttemptsReached).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("resetAttempts nullstiller counter", () => {
    const memStorage = makeMemoryStorage();
    memStorage.store.set(
      "spillorama:reload-attempts",
      JSON.stringify([1_000_000]),
    );
    const reloader = new AutoReloadOnDisconnect({
      storage: memStorage.api,
    });

    expect(memStorage.store.has("spillorama:reload-attempts")).toBe(true);
    reloader.resetAttempts();
    expect(memStorage.store.has("spillorama:reload-attempts")).toBe(false);
  });

  it("hasExceededMaxAttempts returnerer true når 3+ attempts i storage", () => {
    const memStorage = makeMemoryStorage();
    memStorage.store.set(
      "spillorama:reload-attempts",
      JSON.stringify([1_000_000, 1_000_001, 1_000_002]),
    );
    const reloader = new AutoReloadOnDisconnect({
      maxAttempts: 3,
      storage: memStorage.api,
    });
    expect(reloader.hasExceededMaxAttempts()).toBe(true);
  });

  it("hasExceededMaxAttempts returnerer false ved < maxAttempts", () => {
    const memStorage = makeMemoryStorage();
    memStorage.store.set(
      "spillorama:reload-attempts",
      JSON.stringify([1_000_000]),
    );
    const reloader = new AutoReloadOnDisconnect({
      maxAttempts: 3,
      storage: memStorage.api,
    });
    expect(reloader.hasExceededMaxAttempts()).toBe(false);
  });

  it("dobbel armReload er idempotent (ingen restart av timer)", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 5000,
      reloadFn,
      storage: makeMemoryStorage().api,
    });
    reloader.markConnected();

    reloader.armReload();
    vi.advanceTimersByTime(3000);
    reloader.armReload(); // ikke restart fra 0
    vi.advanceTimersByTime(2001); // total 5001ms → reload skal fyre
    expect(reloadFn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("malformed storage-data behandles som tom liste", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const memStorage = makeMemoryStorage();
    memStorage.store.set("spillorama:reload-attempts", "not json");
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 100,
      reloadFn,
      storage: memStorage.api,
      now: () => 1_000_000,
    });
    reloader.markConnected();

    reloader.armReload();
    vi.advanceTimersByTime(100);

    expect(reloadFn).toHaveBeenCalledTimes(1);
    // Verifiserer at storage er overskrevet med korrekt JSON.
    expect(memStorage.store.get("spillorama:reload-attempts")).toBe(
      JSON.stringify([1_000_000]),
    );
    vi.useRealTimers();
  });

  // ── PR #1247-regresjon fix (Tobias 2026-05-12) ────────────────────────
  //
  // Brukeren ble kastet tilbake til lobby ved kortvarige nett-glipper.
  // Rot-årsak: armReload kunne fyre selv om socket aldri hadde lykkes
  // med initial-connect. Reload tok brukeren tilbake til shell-en, og
  // siden spill-state er kun i minnet, havnet de på lobby.
  //
  // Fix: markConnected()-gate + delayMs default 30s. Disse testene
  // verifiserer at gaten faktisk fungerer + at default-en er korrekt.

  it("PR #1247: armReload FØR markConnected() → no-op (ingen reload)", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 100,
      reloadFn,
      storage: makeMemoryStorage().api,
    });

    // Ikke kall markConnected() — simulerer scenarioet der socket aldri
    // har lykkes med å koble til server (eks. server nede ved sidelast,
    // auth-token utløpt). armReload skal være no-op her, ellers ville
    // brukeren bli reload-et inn i samme feil-tilstand i evighet.
    reloader.armReload();
    vi.advanceTimersByTime(10_000); // langt forbi delayMs

    expect(reloadFn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("PR #1247: armReload ETTER markConnected() → fyrer normalt", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 100,
      reloadFn,
      storage: makeMemoryStorage().api,
    });

    // Steg 1: armReload pre-connect = no-op.
    reloader.armReload();
    vi.advanceTimersByTime(200);
    expect(reloadFn).not.toHaveBeenCalled();

    // Steg 2: markConnected → simulerer at socket har koblet til.
    reloader.markConnected();

    // Steg 3: armReload skal nå fyre etter delayMs.
    reloader.armReload();
    vi.advanceTimersByTime(101);
    expect(reloadFn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("PR #1247: markConnected() er one-way (forblir true selv om kalt flere ganger)", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const reloader = new AutoReloadOnDisconnect({
      delayMs: 100,
      reloadFn,
      storage: makeMemoryStorage().api,
    });

    reloader.markConnected();
    reloader.markConnected(); // idempotent — ingen effekt
    reloader.markConnected();

    reloader.armReload();
    vi.advanceTimersByTime(101);
    expect(reloadFn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("PR #1247: default delayMs er 30s (ikke 5s)", () => {
    vi.useFakeTimers();
    const reloadFn = vi.fn();
    const reloader = new AutoReloadOnDisconnect({
      // ingen eksplisitt delayMs — bruk default.
      reloadFn,
      storage: makeMemoryStorage().api,
    });
    reloader.markConnected();

    reloader.armReload();

    // 5s default ville fyrt her — verifiserer at den IKKE gjør det.
    vi.advanceTimersByTime(5_001);
    expect(reloadFn).not.toHaveBeenCalled();

    // 30s default skal fyre nå.
    vi.advanceTimersByTime(25_000); // total 30_001ms
    expect(reloadFn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  // ── Ekstern-konsulent-plan P0-2 (2026-05-17): triggerImmediateReload ──

  describe("triggerImmediateReload (P0-2 LiveRoomRecoverySupervisor tier 3)", () => {
    it("fyrer reload umiddelbart uten å vente på timer", () => {
      const reloadFn = vi.fn();
      const reloader = new AutoReloadOnDisconnect({
        delayMs: 30_000,
        reloadFn,
        storage: makeMemoryStorage().api,
      });
      reloader.markConnected();

      reloader.triggerImmediateReload();

      expect(reloadFn).toHaveBeenCalledTimes(1);
    });

    it("er no-op før markConnected() er kalt (samme gate som armReload)", () => {
      const reloadFn = vi.fn();
      const reloader = new AutoReloadOnDisconnect({
        delayMs: 30_000,
        reloadFn,
        storage: makeMemoryStorage().api,
      });
      // markConnected ikke kalt

      reloader.triggerImmediateReload();

      expect(reloadFn).not.toHaveBeenCalled();
    });

    it("cancel-er pågående armert reload før immediate trigger", () => {
      vi.useFakeTimers();
      const reloadFn = vi.fn();
      const reloader = new AutoReloadOnDisconnect({
        delayMs: 5_000,
        reloadFn,
        storage: makeMemoryStorage().api,
      });
      reloader.markConnected();

      reloader.armReload();
      vi.advanceTimersByTime(1_000); // halvveis til armed reload

      reloader.triggerImmediateReload();
      expect(reloadFn).toHaveBeenCalledTimes(1);

      // Sørg for at den armerte timeren IKKE også fyrer.
      vi.advanceTimersByTime(10_000);
      expect(reloadFn).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("respekterer maxAttempts — onMaxAttemptsReached fyrer på 4. forsøk", () => {
      const reloadFn = vi.fn();
      const onMaxAttempts = vi.fn();
      const memStorage = makeMemoryStorage();
      const reloader = new AutoReloadOnDisconnect({
        maxAttempts: 3,
        windowMs: 60_000,
        reloadFn,
        onMaxAttemptsReached: onMaxAttempts,
        storage: memStorage.api,
        now: () => 1_000_000,
      });
      reloader.markConnected();

      // 3 lovlige reloads
      reloader.triggerImmediateReload();
      reloader.triggerImmediateReload();
      reloader.triggerImmediateReload();
      expect(reloadFn).toHaveBeenCalledTimes(3);

      // 4. — over grensen
      reloader.triggerImmediateReload();
      expect(reloadFn).toHaveBeenCalledTimes(3); // ikke kallet på nytt
      expect(onMaxAttempts).toHaveBeenCalledTimes(1);
    });

    it("teller felles attempts-counter med armReload-pathen (delt sessionStorage)", () => {
      vi.useFakeTimers();
      const reloadFn = vi.fn();
      const onMaxAttempts = vi.fn();
      const memStorage = makeMemoryStorage();
      const reloader = new AutoReloadOnDisconnect({
        maxAttempts: 2,
        delayMs: 1_000,
        windowMs: 60_000,
        reloadFn,
        onMaxAttemptsReached: onMaxAttempts,
        storage: memStorage.api,
        now: () => 1_000_000,
      });
      reloader.markConnected();

      // Først via armReload (disconnect-path)
      reloader.armReload();
      vi.advanceTimersByTime(1_500);
      expect(reloadFn).toHaveBeenCalledTimes(1);

      // Så via triggerImmediateReload (supervisor tier 3)
      reloader.triggerImmediateReload();
      expect(reloadFn).toHaveBeenCalledTimes(2);

      // 3. — over grensen (delt counter)
      reloader.triggerImmediateReload();
      expect(reloadFn).toHaveBeenCalledTimes(2);
      expect(onMaxAttempts).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });
});
