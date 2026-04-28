/**
 * Unified pipeline refactor — Fase 0.
 *
 * Clock-port-implementasjoner for tester + prod.
 */

import type { ClockPort } from "../ClockPort.js";

/**
 * Bruker `Date.now()` direkte — produksjons-default.
 *
 * Note: Hvis du trenger Oslo-business-day-semantikk (f.eks. for
 * Game1JackpotStateService), bruk `OsloBusinessDayClockPort` (Fase 1)
 * i stedet. SystemClockPort returnerer rå UTC.
 */
export class SystemClockPort implements ClockPort {
  now(): Date {
    return new Date();
  }
  nowMs(): number {
    return Date.now();
  }
}

/**
 * Fryst klokke for invariant-tester. Konstrueres med en initial verdi
 * og kan flyttes via `advance(ms)` eller `set(date)`.
 *
 * Tester som lager FakeClockPort-instans må gjøre det per test (eller
 * kalle `set()` eksplisitt) — instansen er IKKE auto-reset mellom
 * tester (Node test-runner skaper ikke implisitt teardown).
 */
export class FakeClockPort implements ClockPort {
  private currentMs: number;

  constructor(initial: Date | number = new Date("2026-04-28T12:00:00.000Z")) {
    this.currentMs = typeof initial === "number" ? initial : initial.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  nowMs(): number {
    return this.currentMs;
  }

  /** Flytt klokken framover med `ms` millisekunder. */
  advance(ms: number): void {
    this.currentMs += ms;
  }

  /** Sett klokken til et eksplisitt tidspunkt. */
  set(date: Date | number): void {
    this.currentMs = typeof date === "number" ? date : date.getTime();
  }
}
