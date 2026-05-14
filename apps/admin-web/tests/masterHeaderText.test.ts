/**
 * Tests for `getMasterHeaderText` i `Spill1HallStatusBox` (2026-05-14).
 *
 * Bug-bakgrunn:
 *   Tobias rapporterte 3 ganger 2026-05-14 (07:55, 09:51, 12:44) at
 *   master-konsoll viste "Aktiv trekning - Bingo" som header selv om
 *   engine IKKE var running. Pre-fix-grenen behandlet `purchase_open` og
 *   `ready_to_start` som "aktiv trekning" — disse er PRE-start-tilstander
 *   hvor master kan starte spillet med ett klikk, men hvor INGEN trekk
 *   pågår. Resultatet var en motsigelse i UI: header sa "Aktiv trekning",
 *   master-knappen sa "▶ Start neste spill", og "Ingen pågående spill
 *   tilgjengelig..." vises samtidig.
 *
 * Fix:
 *   `getMasterHeaderText(state, gameName, info?)` er en pure helper som
 *   mapper hver mulig master-konsoll-state til riktig header-tekst.
 *   "Aktiv trekning" returneres KUN når state === "running".
 *
 * PITFALLS_LOG §7.20 dekker denne bug-en og krever at fremtidige endringer
 * i mapping-en MÅ ledsages av oppdaterte tester i denne filen.
 */

import { describe, it, expect } from "vitest";
import {
  getMasterHeaderText,
  type MasterHeaderState,
} from "../src/pages/cash-inout/Spill1HallStatusBox.js";

describe("getMasterHeaderText — state-aware master header (Tobias 3-gang-bug 2026-05-14)", () => {
  // ── Test 1: idle (ingen plan-run aktiv) ───────────────────────────────
  it('idle + "Bingo" → "Neste spill: Bingo"', () => {
    expect(getMasterHeaderText("idle", "Bingo")).toBe("Neste spill: Bingo");
  });

  // ── Test 2: scheduled (spawnet, ikke startet) ─────────────────────────
  it('scheduled + "Bingo" → "Klar til å starte: Bingo"', () => {
    expect(getMasterHeaderText("scheduled", "Bingo")).toBe(
      "Klar til å starte: Bingo",
    );
  });

  // ── Test 3: ready_to_start (master har trykket "Marker klar") ─────────
  it('ready_to_start + "Bingo" → "Klar til å starte: Bingo"', () => {
    expect(getMasterHeaderText("ready_to_start", "Bingo")).toBe(
      "Klar til å starte: Bingo",
    );
  });

  // ── Test 3b: purchase_open (bonge-salg åpent, IKKE running) ───────────
  //
  // DENNE er pre-fix-bug-en. Pre-fix returnerte "Aktiv trekning - Bingo".
  // Post-fix MÅ returnere "Klar til å starte" siden engine ikke er running.
  it('purchase_open + "Bingo" → "Klar til å starte: Bingo" (regression: Tobias 3-gang-bug)', () => {
    expect(getMasterHeaderText("purchase_open", "Bingo")).toBe(
      "Klar til å starte: Bingo",
    );
  });

  // ── Test 4: running (engine kjører trekk) ─────────────────────────────
  it('running + "Bingo" → "Aktiv trekning - Bingo"', () => {
    expect(getMasterHeaderText("running", "Bingo")).toBe(
      "Aktiv trekning - Bingo",
    );
  });

  // ── Test 5: paused ────────────────────────────────────────────────────
  it('paused + "Bingo" → "Pauset: Bingo"', () => {
    expect(getMasterHeaderText("paused", "Bingo")).toBe("Pauset: Bingo");
  });

  // ── Test 6: finished/completed ───────────────────────────────────────
  it('completed + "Bingo" → "Runde ferdig: Bingo"', () => {
    expect(getMasterHeaderText("completed", "Bingo")).toBe(
      "Runde ferdig: Bingo",
    );
  });

  it('cancelled + "Bingo" → "Runde ferdig: Bingo"', () => {
    expect(getMasterHeaderText("cancelled", "Bingo")).toBe(
      "Runde ferdig: Bingo",
    );
  });

  // ── Test 7: plan_completed_for_today ──────────────────────────────────
  it("plan_completed_for_today → \"Spilleplan ferdig for i dag\"", () => {
    expect(getMasterHeaderText("plan_completed_for_today", "Bingo")).toBe(
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

  // ── Test 8: closed / outside_opening_hours ────────────────────────────
  it("closed + nextOpeningTime → \"Stengt — åpner 18:00\"", () => {
    expect(
      getMasterHeaderText("closed", "Bingo", { nextOpeningTime: "18:00" }),
    ).toBe("Stengt — åpner 18:00");
  });

  it("outside_opening_hours + nextOpeningTime → \"Stengt — åpner 18:00\"", () => {
    expect(
      getMasterHeaderText("outside_opening_hours", null, {
        nextOpeningTime: "18:00",
      }),
    ).toBe("Stengt — åpner 18:00");
  });

  it("closed uten nextOpeningTime → fallback \"Stengt\"", () => {
    expect(getMasterHeaderText("closed", "Bingo")).toBe("Stengt");
  });

  // ── Test 9: null gameName → fallback til generisk tekst ───────────────
  it("running + null gameName → \"Aktiv trekning\"", () => {
    expect(getMasterHeaderText("running", null)).toBe("Aktiv trekning");
  });

  it("idle + null gameName → \"Neste spill\"", () => {
    expect(getMasterHeaderText("idle", null)).toBe("Neste spill");
  });

  it("paused + null gameName → \"Pauset\"", () => {
    expect(getMasterHeaderText("paused", null)).toBe("Pauset");
  });

  it("scheduled + null gameName → \"Klar til å starte\"", () => {
    expect(getMasterHeaderText("scheduled", null)).toBe("Klar til å starte");
  });

  it("completed + null gameName → \"Runde ferdig\"", () => {
    expect(getMasterHeaderText("completed", null)).toBe("Runde ferdig");
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
      "Aktiv trekning - &lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("gameName med & escapes til &amp;", () => {
    expect(getMasterHeaderText("running", "Bingo & Co")).toBe(
      "Aktiv trekning - Bingo &amp; Co",
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
  // Dette er kjernen i Tobias 3-gang-bug-en. Eksplisitt regression-test:
  // ingen andre state enn "running" skal kunne returnere "Aktiv trekning".
  it("regression Tobias 3-gang-bug: ingen ikke-running state returnerer 'Aktiv trekning'", () => {
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
});
