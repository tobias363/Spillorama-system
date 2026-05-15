/**
 * Tests for `getMasterHeaderText` i `Spill1HallStatusBox`.
 *
 * Tobias-direktiv 2026-05-15 (IMMUTABLE):
 *   "Uavhengig av hvilken status agentene har skal teksten ALLTID være FØR
 *    spillet starter: 'Neste spill: {neste spill på lista}'. Når spillet er
 *    i gang: 'Aktiv trekning: {neste spill på lista}'."
 *
 * Bug-bakgrunn:
 *   Tobias rapporterte 2026-05-15 to feil:
 *     - Image 1 (direkte etter dev:nuke): Header viste "Neste spill" UTEN
 *       navn — skulle vise "Neste spill: Bingo".
 *     - Image 2 (etter Marker Klar): Header viste "Klar til å starte: Bingo"
 *       — skulle vise "Neste spill: Bingo".
 *
 *   Tobias 2026-05-14 (forrige iterasjon, PITFALLS §7.20) rapporterte at
 *   purchase_open/ready_to_start ble vist som "Aktiv trekning" — det er
 *   også feil. Denne fix-en konsoliderer slik at KUN running gir "Aktiv
 *   trekning"; alle pre-running-states (idle, scheduled, purchase_open,
 *   ready_to_start, completed, cancelled) gir "Neste spill: {name}".
 *
 * Fix:
 *   `getMasterHeaderText(state, gameName, info?)` er en pure helper med
 *   forenklet mapping:
 *     - running                           → "Aktiv trekning: {name}" (kolon)
 *     - paused                            → "Pauset: {name}" (midt i runde)
 *     - alle andre pre-running states     → "Neste spill: {name}"
 *     - plan_completed_for_today          → "Spilleplan ferdig for i dag"
 *     - closed / outside_opening_hours    → "Stengt — åpner HH:MM"
 *
 * PITFALLS_LOG §7.20 + ny §7.21 dekker dette og krever at fremtidige
 * endringer i mapping-en MÅ ledsages av oppdaterte tester i denne filen.
 */

import { describe, it, expect } from "vitest";
import {
  getMasterHeaderText,
  type MasterHeaderState,
} from "../src/pages/cash-inout/Spill1HallStatusBox.js";

describe("getMasterHeaderText — Tobias spec 2026-05-15", () => {
  // ── PRE-RUNNING-STATES (alle gir "Neste spill: {name}") ───────────────

  it('idle + "Bingo" → "Neste spill: Bingo"', () => {
    expect(getMasterHeaderText("idle", "Bingo")).toBe("Neste spill: Bingo");
  });

  it('scheduled + "Bingo" → "Neste spill: Bingo"', () => {
    expect(getMasterHeaderText("scheduled", "Bingo")).toBe(
      "Neste spill: Bingo",
    );
  });

  it('purchase_open + "Bingo" → "Neste spill: Bingo"', () => {
    expect(getMasterHeaderText("purchase_open", "Bingo")).toBe(
      "Neste spill: Bingo",
    );
  });

  it('ready_to_start + "Bingo" → "Neste spill: Bingo" (Tobias bug 2026-05-15)', () => {
    // Image 2 i Tobias-rapport 2026-05-15: pre-fix viste "Klar til å starte:
    // Bingo" — post-fix MÅ vise "Neste spill: Bingo".
    expect(getMasterHeaderText("ready_to_start", "Bingo")).toBe(
      "Neste spill: Bingo",
    );
  });

  it('completed + "1000-spill" → "Neste spill: 1000-spill" (når plan har advanced)', () => {
    expect(getMasterHeaderText("completed", "1000-spill")).toBe(
      "Neste spill: 1000-spill",
    );
  });

  it('cancelled + "1000-spill" → "Neste spill: 1000-spill"', () => {
    expect(getMasterHeaderText("cancelled", "1000-spill")).toBe(
      "Neste spill: 1000-spill",
    );
  });

  // ── RUNNING (eneste state hvor "Aktiv trekning" er gyldig) ─────────────

  it('running + "Bingo" → "Aktiv trekning: Bingo" (kolon, IKKE bindestrek)', () => {
    expect(getMasterHeaderText("running", "Bingo")).toBe(
      "Aktiv trekning: Bingo",
    );
  });

  // ── PAUSET (midt i runde, beholder egen tekst) ─────────────────────────

  it('paused + "Bingo" → "Pauset: Bingo" (uendret — midt i runde)', () => {
    expect(getMasterHeaderText("paused", "Bingo")).toBe("Pauset: Bingo");
  });

  // ── PLAN-COMPLETED ─────────────────────────────────────────────────────

  it('plan_completed → "Spilleplan ferdig for i dag" (uendret)', () => {
    expect(getMasterHeaderText("plan_completed_for_today", null)).toBe(
      "Spilleplan ferdig for i dag",
    );
  });

  it("plan_completed_for_today + nextOpeningTime → inkluderer neste-dag-info", () => {
    expect(
      getMasterHeaderText("plan_completed_for_today", "Bingo", {
        nextOpeningTime: "18:00",
      }),
    ).toBe("Spilleplan ferdig for i dag — neste plan: 18:00 neste dag");
  });

  // ── CLOSED / OUTSIDE_OPENING_HOURS ─────────────────────────────────────

  it('closed + nextOpeningTime → "Stengt — åpner 18:00"', () => {
    expect(
      getMasterHeaderText("closed", "Bingo", { nextOpeningTime: "18:00" }),
    ).toBe("Stengt — åpner 18:00");
  });

  it('outside_opening_hours + nextOpeningTime → "Stengt — åpner 18:00"', () => {
    expect(
      getMasterHeaderText("outside_opening_hours", null, {
        nextOpeningTime: "18:00",
      }),
    ).toBe("Stengt — åpner 18:00");
  });

  it('closed uten nextOpeningTime → fallback "Stengt"', () => {
    expect(getMasterHeaderText("closed", "Bingo")).toBe("Stengt");
  });

  // ── NULL gameName fallback ─────────────────────────────────────────────

  it('running + null gameName → "Aktiv trekning"', () => {
    expect(getMasterHeaderText("running", null)).toBe("Aktiv trekning");
  });

  it('idle + null gameName → "Neste spill"', () => {
    expect(getMasterHeaderText("idle", null)).toBe("Neste spill");
  });

  it('paused + null gameName → "Pauset"', () => {
    expect(getMasterHeaderText("paused", null)).toBe("Pauset");
  });

  it('scheduled + null gameName → "Neste spill"', () => {
    expect(getMasterHeaderText("scheduled", null)).toBe("Neste spill");
  });

  it('purchase_open + null gameName → "Neste spill"', () => {
    expect(getMasterHeaderText("purchase_open", null)).toBe("Neste spill");
  });

  it('ready_to_start + null gameName → "Neste spill"', () => {
    expect(getMasterHeaderText("ready_to_start", null)).toBe("Neste spill");
  });

  it('completed + null gameName → "Neste spill"', () => {
    expect(getMasterHeaderText("completed", null)).toBe("Neste spill");
  });

  it('cancelled + null gameName → "Neste spill"', () => {
    expect(getMasterHeaderText("cancelled", null)).toBe("Neste spill");
  });

  // ── Defensive: null / undefined / ukjent state → idle ─────────────────

  it("null state → behandles som idle", () => {
    expect(getMasterHeaderText(null, "Bingo")).toBe("Neste spill: Bingo");
  });

  it("undefined state → behandles som idle", () => {
    expect(getMasterHeaderText(undefined, "Bingo")).toBe(
      "Neste spill: Bingo",
    );
  });

  it("ukjent state-string → behandles som idle", () => {
    expect(getMasterHeaderText("totally-bogus-status", "Bingo")).toBe(
      "Neste spill: Bingo",
    );
  });

  // ── XSS-sikkerhet: gameName escapes til HTML-trygg form ───────────────

  it("gameName med HTML-entiteter escapes (XSS-beskyttelse)", () => {
    expect(getMasterHeaderText("running", "<script>alert(1)</script>")).toBe(
      "Aktiv trekning: &lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("gameName med & escapes til &amp;", () => {
    expect(getMasterHeaderText("running", "Bingo & Co")).toBe(
      "Aktiv trekning: Bingo &amp; Co",
    );
  });

  // ── Type-coverage: alle states i enum dekkes av minst én test ──────
  //
  // Type-safety regression-guard: hvis noen legger til en ny state i
  // MasterHeaderState uten å oppdatere helper-en, kompilerer ikke
  // switch-en fordi default-grenen bare returnerer "Neste spill". Denne
  // testen er en sanity-check: helper-en skal returnere noe (ikke kaste,
  // ikke `undefined`) for hver kjente state.
  const allStates: MasterHeaderState[] = [
    "idle",
    "scheduled",
    "purchase_open",
    "ready_to_start",
    "running",
    "paused",
    "completed",
    "cancelled",
    "plan_completed_for_today",
    "closed",
    "outside_opening_hours",
  ];
  for (const state of allStates) {
    it(`state="${state}" returnerer non-empty string`, () => {
      const result = getMasterHeaderText(state, "Bingo");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  }

  // ── Bug-regression-trip-wire: "Aktiv trekning" KUN ved running ────────
  //
  // Tobias-bug 2026-05-14 (PITFALLS §7.20): purchase_open/ready_to_start
  // viste "Aktiv trekning" — feil. Eksplisitt regression-test: ingen andre
  // state enn "running" skal kunne returnere "Aktiv trekning".
  it("regression Tobias 2026-05-14: ingen ikke-running state returnerer 'Aktiv trekning'", () => {
    const nonRunningStates: MasterHeaderState[] = [
      "idle",
      "scheduled",
      "purchase_open",
      "ready_to_start",
      "paused",
      "completed",
      "cancelled",
      "plan_completed_for_today",
      "closed",
      "outside_opening_hours",
    ];
    for (const state of nonRunningStates) {
      const result = getMasterHeaderText(state, "Bingo");
      expect(
        result.startsWith("Aktiv trekning"),
        `state="${state}" → "${result}" skal ALDRI starte med "Aktiv trekning"`,
      ).toBe(false);
    }
  });

  // ── Bug-regression-trip-wire: "Klar til å starte" og "Runde ferdig" er FJERNET ───
  //
  // Tobias-bug 2026-05-15: header skal ALDRI vise "Klar til å starte" eller
  // "Runde ferdig" — alle pre-running-states skal være "Neste spill: {name}".
  it("regression Tobias 2026-05-15: ingen state returnerer 'Klar til å starte'", () => {
    for (const state of allStates) {
      const result = getMasterHeaderText(state, "Bingo");
      expect(
        result.startsWith("Klar til å starte"),
        `state="${state}" → "${result}" skal ALDRI starte med "Klar til å starte"`,
      ).toBe(false);
    }
  });

  it("regression Tobias 2026-05-15: ingen state returnerer 'Runde ferdig'", () => {
    for (const state of allStates) {
      const result = getMasterHeaderText(state, "Bingo");
      expect(
        result.startsWith("Runde ferdig"),
        `state="${state}" → "${result}" skal ALDRI starte med "Runde ferdig"`,
      ).toBe(false);
    }
  });

  // ── Bug-regression-trip-wire: "Aktiv trekning" bruker KOLON, ikke bindestrek ───
  //
  // Tobias-direktiv 2026-05-15 IMMUTABLE: "Aktiv trekning: {name}" med kolon.
  // Pre-fix-formatet "Aktiv trekning - {name}" med bindestrek er ugyldig.
  it("regression Tobias 2026-05-15: running format bruker kolon, ikke bindestrek", () => {
    const result = getMasterHeaderText("running", "Bingo");
    expect(result).toBe("Aktiv trekning: Bingo");
    expect(result).not.toContain(" - ");
  });
});
