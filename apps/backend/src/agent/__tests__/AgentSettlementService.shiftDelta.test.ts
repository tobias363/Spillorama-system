/**
 * K1 wireframe 17.40 — shift-delta-kalkulasjon.
 *
 * Tester AgentSettlementService.calculateShiftDelta mot wireframe-spec:
 *   difference_in_shifts = shift_start_to_end - innskudd_drop_safe - ending_opptall_kassie
 *
 * Dette er samme formel som klient-siden i SettlementBreakdownModal bruker.
 * Server-side håndhever integer-øre og avviser floats/negative ikke-delta-
 * felter.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AgentSettlementService } from "../AgentSettlementService.js";
import { DomainError } from "../../game/BingoEngine.js";

test("calculateShiftDelta: positiv diff ved overlevering-overskudd", () => {
  const r = AgentSettlementService.calculateShiftDelta({
    shiftStartToEndCents: 100_000, // 1000 NOK
    innskuddDropSafeCents: 30_000, // 300 NOK
    endingOpptallKassieCents: 60_000, // 600 NOK
  });
  // 1000 - 300 - 600 = 100 NOK = 10_000 øre
  assert.equal(r.differenceInShiftsCents, 10_000);
});

test("calculateShiftDelta: null-diff (balansert overlevering)", () => {
  const r = AgentSettlementService.calculateShiftDelta({
    shiftStartToEndCents: 100_000,
    innskuddDropSafeCents: 40_000,
    endingOpptallKassieCents: 60_000,
  });
  assert.equal(r.differenceInShiftsCents, 0);
});

test("calculateShiftDelta: negativ diff (underskudd i overlevering)", () => {
  const r = AgentSettlementService.calculateShiftDelta({
    shiftStartToEndCents: 50_000,
    innskuddDropSafeCents: 30_000,
    endingOpptallKassieCents: 25_000,
  });
  // 50k - 30k - 25k = -5k
  assert.equal(r.differenceInShiftsCents, -5_000);
});

test("calculateShiftDelta: store tall (1M NOK scenario, >100M øre)", () => {
  const r = AgentSettlementService.calculateShiftDelta({
    shiftStartToEndCents: 100_000_000, // 1M NOK
    innskuddDropSafeCents: 50_000_000,
    endingOpptallKassieCents: 49_000_000,
  });
  // 1M - 500k - 490k = 10k NOK = 1_000_000 øre
  assert.equal(r.differenceInShiftsCents, 1_000_000);
});

test("calculateShiftDelta: avviser float i shiftStartToEndCents", () => {
  assert.throws(
    () =>
      AgentSettlementService.calculateShiftDelta({
        shiftStartToEndCents: 100_000.5,
        innskuddDropSafeCents: 0,
        endingOpptallKassieCents: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("calculateShiftDelta: avviser negativ innskudd_drop_safe (UI skulle fange dette)", () => {
  assert.throws(
    () =>
      AgentSettlementService.calculateShiftDelta({
        shiftStartToEndCents: 100_000,
        innskuddDropSafeCents: -1,
        endingOpptallKassieCents: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("calculateShiftDelta: avviser negativ ending_opptall_kassie", () => {
  assert.throws(
    () =>
      AgentSettlementService.calculateShiftDelta({
        shiftStartToEndCents: 100_000,
        innskuddDropSafeCents: 0,
        endingOpptallKassieCents: -1,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("calculateShiftDelta: shift_start_to_end kan være negativt (edge: korreksjon)", () => {
  // Backend-wiring: negativ start-end betyr at shift-aggregeringen inneholdt
  // nedskrivninger. Funksjonen tillater dette; UI viser varsel.
  const r = AgentSettlementService.calculateShiftDelta({
    shiftStartToEndCents: -10_000,
    innskuddDropSafeCents: 0,
    endingOpptallKassieCents: 0,
  });
  assert.equal(r.differenceInShiftsCents, -10_000);
});

test("calculateShiftDelta: alle-nuller edge case", () => {
  const r = AgentSettlementService.calculateShiftDelta({
    shiftStartToEndCents: 0,
    innskuddDropSafeCents: 0,
    endingOpptallKassieCents: 0,
  });
  assert.equal(r.differenceInShiftsCents, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// K1-B: calculateWireframeShiftDelta (1:1 wireframe 16.25 / 17.10 formula)
// ═══════════════════════════════════════════════════════════════════════════

// Note: wireframe 16.25 viser eksempel-verdier (start=30558, ending=46169,
// endring=6613) som ikke er internt konsistente — 46169-30558 = 15611, ikke
// 6613. Vi følger formelen i wireframe-spec, ikke de spesifikke tallene.
// Den kanoniske test-saken under bruker tall som FAKTISK matcher formelen.

test("calculateWireframeShiftDelta: kanonisk eksempel (formelen verifiseres)", () => {
  // Konstruer scenario der formelen kan verifiseres deterministisk:
  //   start    =  10 000 NOK = 1 000 000 øre
  //   ending   =  16 613 NOK = 1 661 300 øre
  //   endring  =   6 613 NOK =   661 300 øre
  //   innskudd =   1 000 NOK =   100 000 øre
  //   påfyll   =   5 613 NOK =   561 300 øre
  //   totalt   =   6 613 NOK =   661 300 øre (= innskudd + påfyll)
  //   sum-kasse=   6 602 NOK =   660 200 øre
  //   diff     =      11 NOK =     1 100 øre
  const r = AgentSettlementService.calculateWireframeShiftDelta({
    kasseStartSkiftCents: 1_000_000,
    endingOpptallKassieCents: 1_661_300,
    innskuddDropSafeCents: 100_000,
    paafyllUtKasseCents: 561_300,
    totaltSumKasseFilCents: 660_200,
  });
  assert.equal(r.endringCents, 661_300);
  assert.equal(r.totaltDropsafePaafyllCents, 661_300);
  assert.equal(r.differenceInShiftsCents, 1_100);
  assert.equal(r.dropsafePaafyllMismatch, false);
});

test("calculateWireframeShiftDelta: dropsafePaafyllMismatch flagger inkonsistens", () => {
  // Endring er 6613, men innskudd+påfyll er 5000 → mismatch
  const r = AgentSettlementService.calculateWireframeShiftDelta({
    kasseStartSkiftCents: 1_000_000,
    endingOpptallKassieCents: 1_661_300, // endring = 661_300
    innskuddDropSafeCents: 100_000,
    paafyllUtKasseCents: 400_000, // total = 500_000 ≠ 661_300
    totaltSumKasseFilCents: 660_200,
  });
  assert.equal(r.dropsafePaafyllMismatch, true);
  // Difference-formel: (500_000 - 661_300) + 661_300 - 660_200 = -160_200
  assert.equal(r.differenceInShiftsCents, -160_200);
});

test("calculateWireframeShiftDelta: alle-nuller edge case", () => {
  const r = AgentSettlementService.calculateWireframeShiftDelta({
    kasseStartSkiftCents: 0,
    endingOpptallKassieCents: 0,
    innskuddDropSafeCents: 0,
    paafyllUtKasseCents: 0,
    totaltSumKasseFilCents: 0,
  });
  assert.equal(r.endringCents, 0);
  assert.equal(r.totaltDropsafePaafyllCents, 0);
  assert.equal(r.differenceInShiftsCents, 0);
  assert.equal(r.dropsafePaafyllMismatch, false);
});

test("calculateWireframeShiftDelta: påfyll kan være negativ (uttrekk fra kasse)", () => {
  // Scenario: agent tar 200 kr ut av kasse (påfyll = -200) for vekslepenger.
  //   start    = 10 000
  //   ending   =  9 800 (ned 200)
  //   endring  =   -200
  //   innskudd =      0
  //   påfyll   =   -200 (ut av kasse)
  //   totalt   =   -200 (= 0 + -200)
  //   diff     = (-200 - -200) + -200 - 0 = -200 (= -200 NOK)
  const r = AgentSettlementService.calculateWireframeShiftDelta({
    kasseStartSkiftCents: 1_000_000,
    endingOpptallKassieCents: 980_000,
    innskuddDropSafeCents: 0,
    paafyllUtKasseCents: -20_000,
    totaltSumKasseFilCents: 0,
  });
  assert.equal(r.endringCents, -20_000);
  assert.equal(r.totaltDropsafePaafyllCents, -20_000);
  assert.equal(r.differenceInShiftsCents, -20_000);
  assert.equal(r.dropsafePaafyllMismatch, false);
});

test("calculateWireframeShiftDelta: avviser float i kasse_start_skift", () => {
  assert.throws(
    () =>
      AgentSettlementService.calculateWireframeShiftDelta({
        kasseStartSkiftCents: 100_000.5,
        endingOpptallKassieCents: 0,
        innskuddDropSafeCents: 0,
        paafyllUtKasseCents: 0,
        totaltSumKasseFilCents: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("calculateWireframeShiftDelta: avviser negativ kasse_start_skift", () => {
  assert.throws(
    () =>
      AgentSettlementService.calculateWireframeShiftDelta({
        kasseStartSkiftCents: -1,
        endingOpptallKassieCents: 0,
        innskuddDropSafeCents: 0,
        paafyllUtKasseCents: 0,
        totaltSumKasseFilCents: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("calculateWireframeShiftDelta: avviser negativ innskudd_drop_safe", () => {
  assert.throws(
    () =>
      AgentSettlementService.calculateWireframeShiftDelta({
        kasseStartSkiftCents: 0,
        endingOpptallKassieCents: 0,
        innskuddDropSafeCents: -1,
        paafyllUtKasseCents: 0,
        totaltSumKasseFilCents: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("calculateWireframeShiftDelta: avviser negativ ending_opptall_kassie", () => {
  assert.throws(
    () =>
      AgentSettlementService.calculateWireframeShiftDelta({
        kasseStartSkiftCents: 0,
        endingOpptallKassieCents: -1,
        innskuddDropSafeCents: 0,
        paafyllUtKasseCents: 0,
        totaltSumKasseFilCents: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("calculateWireframeShiftDelta: store tall (1M NOK scenario, >100M øre)", () => {
  const r = AgentSettlementService.calculateWireframeShiftDelta({
    kasseStartSkiftCents: 100_000_000, // 1M NOK
    endingOpptallKassieCents: 200_000_000,
    innskuddDropSafeCents: 50_000_000,
    paafyllUtKasseCents: 50_000_000,
    totaltSumKasseFilCents: 99_000_000,
  });
  assert.equal(r.endringCents, 100_000_000);
  assert.equal(r.totaltDropsafePaafyllCents, 100_000_000);
  // (100M - 100M) + 100M - 99M = 1M
  assert.equal(r.differenceInShiftsCents, 1_000_000);
});
