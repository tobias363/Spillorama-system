/**
 * Unified pipeline refactor — Fase 0 (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Narrow port for tids-relaterte operasjoner. Erstatter direkte kall til
 * `Date.now()` / `new Date()` i game-pipelinen.
 *
 * Bug-bakgrunn:
 *   Game1JackpotStateService hadde Oslo-tz-bug (#584) fordi tidsregning
 *   var hardkodet `Date.now()` mot UTC i stedet for Oslo-business-day.
 *   Med ClockPort kan en `OsloBusinessDayClockPort` injisere riktig
 *   tidsone, og tester kan bruke `FakeClockPort` til å fryse tid.
 *
 * Implementasjoner:
 * - `SystemClockPort` (Fase 0) — bruker `Date.now()` direkte.
 * - `FakeClockPort` (Fase 0) — fryst tid, mutable for tester.
 * - `OsloBusinessDayClockPort` (Fase 1) — vrir tid til Europe/Oslo
 *   business-day-grense for jackpot-akkumulering.
 */

export interface ClockPort {
  /**
   * Nåværende tidspunkt som `Date`-objekt. Bruk når du trenger ISO-string,
   * dag/måned-utregning eller skal lagre i DB.
   */
  now(): Date;

  /**
   * Nåværende tidspunkt som millisekunder siden epoch. Bruk når du
   * trenger billig diff (ttl-sjekker, expiry-tick, performance-counters).
   */
  nowMs(): number;
}
