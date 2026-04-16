/**
 * StakeCalculator tester
 *
 * Dekker:
 *   A) Server-autoritativ modus (myStake definert)
 *   B) Fallback: alle kombinasjoner av spillstatus × armstatus × tickets
 *   C) Grensescenarioer
 */

import { describe, it, expect } from "vitest";
import { calculateStake } from "./StakeCalculator.js";
import type { StakeInput } from "./StakeCalculator.js";
import type { Ticket } from "@spillorama/shared-types/game";

// ── Hjelpere ──────────────────────────────────────────────────────────────────

const TICKET_TYPES = [
  { name: "Small Yellow", type: "small-yellow", priceMultiplier: 1, ticketCount: 1 },
  { name: "Large Yellow", type: "large-yellow", priceMultiplier: 3, ticketCount: 3 },
];

const ENTRY_FEE = 20;

/** Lager en minimal ticket med gitt type */
function ticket(type = "small-yellow"): Ticket {
  return { type, grid: [[1, 2, 3, 4, 5]], color: "yellow" };
}

/** Bygger et StakeInput-objekt med fornuftige defaults */
function input(overrides: Partial<StakeInput> = {}): StakeInput {
  return {
    gameStatus: "NONE",
    myTickets: [],
    preRoundTickets: [],
    isArmed: false,
    ticketTypes: TICKET_TYPES,
    entryFee: ENTRY_FEE,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// A) Server-autoritativ modus — myStake fra backend
// ═══════════════════════════════════════════════════════════════════════════════

describe("Server-autoritativ (myStake definert)", () => {
  it("bruker myStake direkte i stedet for klient-beregning", () => {
    const result = calculateStake(input({
      myStake: 42,
      gameStatus: "RUNNING",
      myTickets: [ticket()],
    }));
    expect(result).toBe(42);
  });

  it("myStake = 0 returnerer 0 (spectator)", () => {
    const result = calculateStake(input({
      myStake: 0,
      gameStatus: "RUNNING",
      myTickets: [ticket(), ticket()],
    }));
    expect(result).toBe(0);
  });

  it("myStake brukes mellom runder med armet spiller", () => {
    const result = calculateStake(input({
      myStake: 600,
      gameStatus: "NONE",
      isArmed: true,
      preRoundTickets: [ticket()],
    }));
    expect(result).toBe(600);
  });

  it("myStake ignorerer preRoundTickets og isArmed", () => {
    const result = calculateStake(input({
      myStake: 100,
      gameStatus: "NONE",
      isArmed: false,
      preRoundTickets: Array.from({ length: 30 }, () => ticket()),
    }));
    expect(result).toBe(100);
  });

  it("myStake med desimaler bevares korrekt", () => {
    const result = calculateStake(input({ myStake: 22.5 }));
    expect(result).toBe(22.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B) Fallback — klient-beregning (myStake undefined)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fallback: RUNNING — deltaker (myTickets > 0)", () => {
  it("beregner innsats fra myTickets (1 brett)", () => {
    const result = calculateStake(input({
      gameStatus: "RUNNING",
      myTickets: [ticket()],
    }));
    expect(result).toBe(20);
  });

  it("beregner innsats fra myTickets (3 brett à 20 kr)", () => {
    const result = calculateStake(input({
      gameStatus: "RUNNING",
      myTickets: [ticket(), ticket(), ticket()],
    }));
    expect(result).toBe(60);
  });

  it("bruker priceMultiplier fra ticketTypes (Large = 3×)", () => {
    const result = calculateStake(input({
      gameStatus: "RUNNING",
      myTickets: [ticket("large-yellow")],
    }));
    expect(result).toBe(60);
  });

  it("summerer mixed ticket-typer korrekt", () => {
    const result = calculateStake(input({
      gameStatus: "RUNNING",
      myTickets: [ticket("small-yellow"), ticket("large-yellow")],
    }));
    expect(result).toBe(80);
  });

  it("bruker multiplier 1 for ukjent ticket-type (fallback)", () => {
    const result = calculateStake(input({
      gameStatus: "RUNNING",
      myTickets: [ticket("ukjent-type")],
    }));
    expect(result).toBe(20);
  });
});

describe("Fallback: RUNNING — spectator (myTickets = 0)", () => {
  it("returnerer 0 selv om preRoundTickets er fylt", () => {
    const result = calculateStake(input({
      gameStatus: "RUNNING",
      myTickets: [],
      preRoundTickets: [ticket(), ticket()],
      isArmed: true,
    }));
    expect(result).toBe(0);
  });
});

describe("Fallback: NONE/WAITING — armet (isArmed = true)", () => {
  it("NONE + armet → bruker preRoundTickets", () => {
    const result = calculateStake(input({
      gameStatus: "NONE",
      isArmed: true,
      preRoundTickets: [ticket()],
    }));
    expect(result).toBe(20);
  });

  it("WAITING + armet → bruker preRoundTickets", () => {
    const result = calculateStake(input({
      gameStatus: "WAITING",
      isArmed: true,
      preRoundTickets: [ticket(), ticket()],
    }));
    expect(result).toBe(40);
  });

  it("armet med 30 standard-tickets", () => {
    const thirtyTickets = Array.from({ length: 30 }, () => ticket());
    const result = calculateStake(input({
      gameStatus: "NONE",
      isArmed: true,
      preRoundTickets: thirtyTickets,
    }));
    expect(result).toBe(600);
  });
});

describe("Fallback: NONE/WAITING — ikke armet (isArmed = false)", () => {
  it("returnerer 0 selv om preRoundTickets er fylt", () => {
    const result = calculateStake(input({
      gameStatus: "NONE",
      isArmed: false,
      preRoundTickets: [ticket(), ticket()],
    }));
    expect(result).toBe(0);
  });

  it("returnerer 0 med 30 auto-genererte tickets", () => {
    const thirtyTickets = Array.from({ length: 30 }, () => ticket());
    const result = calculateStake(input({
      gameStatus: "NONE",
      isArmed: false,
      preRoundTickets: thirtyTickets,
    }));
    expect(result).toBe(0);
  });

  it("ENDED → behandles som ikke-RUNNING → 0", () => {
    const result = calculateStake(input({
      gameStatus: "ENDED",
      isArmed: false,
      preRoundTickets: [ticket(), ticket()],
    }));
    expect(result).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C) Grensescenarioer
// ═══════════════════════════════════════════════════════════════════════════════

describe("Grensescenarioer", () => {
  it("tom state gir 0", () => {
    expect(calculateStake(input())).toBe(0);
  });

  it("0 kr entryFee gir 0 kr innsats (fallback)", () => {
    const result = calculateStake(input({
      gameStatus: "RUNNING",
      myTickets: [ticket()],
      entryFee: 0,
    }));
    expect(result).toBe(0);
  });

  it("myStake = undefined → bruker fallback-beregning", () => {
    const result = calculateStake(input({
      myStake: undefined,
      gameStatus: "RUNNING",
      myTickets: [ticket()],
    }));
    expect(result).toBe(20);
  });
});
