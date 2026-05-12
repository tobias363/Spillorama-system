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

    reloader.armReload();
    vi.advanceTimersByTime(100);

    expect(reloadFn).toHaveBeenCalledTimes(1);
    // Verifiserer at storage er overskrevet med korrekt JSON.
    expect(memStorage.store.get("spillorama:reload-attempts")).toBe(
      JSON.stringify([1_000_000]),
    );
    vi.useRealTimers();
  });
});
