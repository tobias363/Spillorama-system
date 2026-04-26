/**
 * WinningsCalculator tests — BIN-696 / Tobias 2026-04-26.
 *
 * Lock-in for UI-Gevinst-faktisk-bug: 1 Rad solo (100) + 2 Rader 5-veis
 * split (200/5 = 40 per vinner) → 144 kr DB-credit, må reflekteres som
 * 144 kr i UI-summen (ikke 1700 kr fra hardkodet phase-prize-sum).
 */

import { describe, it, expect } from "vitest";
import type { PatternResult } from "@spillorama/shared-types/game";
import { calculateMyRoundWinnings } from "./WinningsCalculator.js";

function makeResult(overrides: Partial<PatternResult>): PatternResult {
  return {
    patternId: "p?",
    patternName: "?",
    claimType: "LINE",
    isWon: false,
    ...overrides,
  };
}

describe("calculateMyRoundWinnings", () => {
  it("returnerer 0 når myPlayerId er null", () => {
    const results = [
      makeResult({
        patternId: "p1",
        isWon: true,
        winnerId: "u1",
        winnerIds: ["u1"],
        payoutAmount: 100,
      }),
    ];
    expect(calculateMyRoundWinnings(results, null)).toBe(0);
  });

  it("solo-vinner: summerer payoutAmount for fasen", () => {
    const results = [
      makeResult({
        patternId: "p1",
        patternName: "1 Rad",
        isWon: true,
        winnerId: "tobias",
        winnerIds: ["tobias"],
        payoutAmount: 100,
      }),
    ];
    expect(calculateMyRoundWinnings(results, "tobias")).toBe(100);
  });

  it("multi-winner-split (Tobias-bug): teller meg som 2.+ vinner", () => {
    // Fase 2 (2 Rader): 200 kr / 5 vinnere = 40 kr per vinner.
    // Tobias er #2 i winnerIds — gammel kode (winnerId === myPlayerId)
    // ville utelukket ham fordi winnerId = "u1". Ny kode med winnerIds[]
    // detekterer ham korrekt.
    const results = [
      makeResult({
        patternId: "p2",
        patternName: "2 Rader",
        isWon: true,
        winnerId: "u1", // første vinner ≠ Tobias
        winnerIds: ["u1", "tobias", "u3", "u4", "u5"],
        winnerCount: 5,
        payoutAmount: 40, // per-winner split
      }),
    ];
    expect(calculateMyRoundWinnings(results, "tobias")).toBe(40);
  });

  it("real-world-scenario: 1 Rad solo (100) + 2 Rader split (40) = 144 kr", () => {
    // Eksakt scenario fra Tobias 2026-04-26 bug-rapport. Spilleren vant
    // 1 Rad alene (full premie 100 kr) og var én av 5 i 2 Rader-split
    // (200/5 = 40, men note: 144 i bug-rapport er 100+44; den 44 stammer
    // fra et annet split der totalpot var 220 → 220/5 = 44). Vi tester
    // den generelle summerings-logikken med Tobias' faktiske tall.
    const results = [
      makeResult({
        patternId: "p1",
        patternName: "1 Rad",
        isWon: true,
        winnerId: "tobias",
        winnerIds: ["tobias"],
        winnerCount: 1,
        payoutAmount: 100, // solo-vinn
      }),
      makeResult({
        patternId: "p2",
        patternName: "2 Rader",
        isWon: true,
        winnerId: "u1", // første vinner ≠ Tobias
        winnerIds: ["u1", "tobias", "u3", "u4", "u5"],
        winnerCount: 5,
        payoutAmount: 44, // 220/5 split
      }),
      // Fase 3-5 ikke vunnet av noen ennå.
      makeResult({
        patternId: "p3",
        patternName: "3 Rader",
        isWon: false,
      }),
      makeResult({
        patternId: "p4",
        patternName: "4 Rader",
        isWon: false,
      }),
      makeResult({
        patternId: "p5",
        patternName: "Fullt Hus",
        claimType: "BINGO",
        isWon: false,
      }),
    ];
    expect(calculateMyRoundWinnings(results, "tobias")).toBe(144);
  });

  it("ekskluderer faser der jeg IKKE er vinner", () => {
    const results = [
      makeResult({
        patternId: "p1",
        isWon: true,
        winnerId: "u1",
        winnerIds: ["u1"],
        payoutAmount: 100,
      }),
      makeResult({
        patternId: "p2",
        isWon: true,
        winnerId: "u2",
        winnerIds: ["u2"],
        payoutAmount: 200,
      }),
    ];
    expect(calculateMyRoundWinnings(results, "tobias")).toBe(0);
  });

  it("ekskluderer ikke-vunne faser uavhengig av andre felt", () => {
    const results = [
      makeResult({
        patternId: "p1",
        isWon: false,
        // I praksis ville disse vært tomme før isWon=true, men noen
        // backend-bugs kan stå igjen — vi MÅ ikke summere dem.
        winnerId: "tobias",
        winnerIds: ["tobias"],
        payoutAmount: 999,
      }),
    ];
    expect(calculateMyRoundWinnings(results, "tobias")).toBe(0);
  });

  it("legacy event uten winnerIds[]: bruker winnerId som fallback", () => {
    // Old wire-shape (pre BIN-696) sendte kun `winnerId`. Helper må fortsatt
    // detektere solo-vinner i denne formen.
    const results = [
      makeResult({
        patternId: "p1",
        isWon: true,
        winnerId: "tobias",
        // winnerIds bevisst ikke satt
        payoutAmount: 100,
      }),
    ];
    expect(calculateMyRoundWinnings(results, "tobias")).toBe(100);
  });

  it("manglende payoutAmount: summen øker med 0, ikke NaN", () => {
    const results = [
      makeResult({
        patternId: "p1",
        isWon: true,
        winnerId: "tobias",
        winnerIds: ["tobias"],
        // payoutAmount bevisst ikke satt
      }),
    ];
    expect(calculateMyRoundWinnings(results, "tobias")).toBe(0);
  });
});
