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
