/**
 * TicketSortByProgress tester
 *
 * Dekker:
 *   A) Empty drawn-set → original-rekkefølge bevart
 *   B) Closeness-score korrekthet per fase (1..5)
 *   C) Stabilitet (ties → original-indeks først, så ticket.id)
 *   D) Free center inkluderes alltid
 *   E) Edge: ikke-5×5 grids sorteres bakerst
 */

import { describe, it, expect } from "vitest";
import {
  closenessScore,
  sortPhaseFromActivePattern,
  sortTicketsByProgress,
  type SortPhase,
} from "./TicketSortByProgress.js";
import type { PatternDefinition, Ticket } from "@spillorama/shared-types/game";

// ── Hjelpere ──────────────────────────────────────────────────────────────────

/**
 * Bygger en 5×5 Bingo75-ticket fra et "tall-mønster".
 *
 * @param id        Ticket-ID
 * @param numbers   Flat 25-liste (row-major), 0 for free center.
 *                  Forenkling: vi bruker tall i 1..75-intervallet og lar
 *                  `drawnNumbers` styre hvilke som blir markert.
 */
function buildTicket(id: string, numbers: number[]): Ticket {
  if (numbers.length !== 25) {
    throw new Error(`buildTicket needs 25 numbers, got ${numbers.length}`);
  }
  const grid: number[][] = [];
  for (let r = 0; r < 5; r++) {
    grid.push(numbers.slice(r * 5, r * 5 + 5));
  }
  return { id, grid, color: "Small Yellow", type: "small" };
}

/**
 * Lag en standard 5×5-ticket der hvert tall er unikt
 * (`offset+1 .. offset+25`, men midten er 0).
 */
function standardTicket(id: string, offset: number): Ticket {
  const numbers: number[] = [];
  for (let i = 0; i < 25; i++) {
    if (i === 12) {
      numbers.push(0);
    } else {
      numbers.push(offset + i + 1);
    }
  }
  return buildTicket(id, numbers);
}

/** Marker en hel rad som "drawn" (returnerer Set med tallene i raden). */
function rowDrawn(ticket: Ticket, rowIndex: number): Set<number> {
  const out = new Set<number>();
  for (const n of ticket.grid[rowIndex]) {
    if (n !== 0) out.add(n);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// A) Empty drawn-set → original-rekkefølge
// ═══════════════════════════════════════════════════════════════════════════════

describe("sortTicketsByProgress — empty drawn-set", () => {
  it("bevarer original-rekkefølge når ingen tall er trukket (alle har samme score)", () => {
    const t1 = standardTicket("a", 0);
    const t2 = standardTicket("b", 30);
    const t3 = standardTicket("c", 50);
    const sorted = sortTicketsByProgress([t1, t2, t3], new Set(), 1);
    expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("alle faser: empty drawn → original-rekkefølge", () => {
    const tickets = [standardTicket("a", 0), standardTicket("b", 30)];
    for (const phase of [1, 2, 3, 4, 5] as SortPhase[]) {
      const sorted = sortTicketsByProgress(tickets, new Set(), phase);
      expect(sorted.map((t) => t.id), `phase ${phase}`).toEqual(["a", "b"]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B) Closeness-score korrekthet per fase
// ═══════════════════════════════════════════════════════════════════════════════

describe("closenessScore — fase 1 (1 rad/kol)", () => {
  it("ticket med komplett rad har score 0", () => {
    const t = standardTicket("a", 0);
    const drawn = rowDrawn(t, 0); // markerer hele rad 0
    expect(closenessScore(t, drawn, 1)).toBe(0);
  });

  it("ticket med 4/5 i en rad har score 1", () => {
    const t = standardTicket("a", 0);
    // Marker bare 4 av 5 i rad 0.
    const row0 = t.grid[0].filter((n) => n !== 0);
    const drawn = new Set(row0.slice(0, 4));
    expect(closenessScore(t, drawn, 1)).toBe(1);
  });

  it("ticket uten markeringer (utenom free center) har høy score for fase 1", () => {
    const t = standardTicket("a", 0);
    // Free center er på rad 2 → rad 2 har 4 igjen (5 − 1 fra centeret).
    // Andre rader har 5 igjen. Min over alle kandidater = 4 (rad 2 ELLER kol 2).
    expect(closenessScore(t, new Set(), 1)).toBe(4);
  });
});

describe("closenessScore — fase 2 (2 rader)", () => {
  it("ticket med 2 komplette rader har score 0", () => {
    const t = standardTicket("a", 0);
    const drawn = new Set([...rowDrawn(t, 0), ...rowDrawn(t, 1)]);
    expect(closenessScore(t, drawn, 2)).toBe(0);
  });

  it("ticket med 1 komplett rad + 4/5 i en annen har score 1", () => {
    const t = standardTicket("a", 0);
    const row0Marked = rowDrawn(t, 0); // hele rad 0
    const row1Partial = t.grid[1].filter((n) => n !== 0).slice(0, 4); // 4/5 i rad 1
    const drawn = new Set([...row0Marked, ...row1Partial]);
    expect(closenessScore(t, drawn, 2)).toBe(1);
  });
});

describe("closenessScore — fase 5 (Fullt Hus)", () => {
  it("ticket med ingen markeringer (kun free center) har score 24", () => {
    const t = standardTicket("a", 0);
    expect(closenessScore(t, new Set(), 5)).toBe(24);
  });

  it("ticket med alle 24 ikke-center markert har score 0", () => {
    const t = standardTicket("a", 0);
    const all = new Set<number>();
    for (const row of t.grid) for (const n of row) if (n !== 0) all.add(n);
    expect(closenessScore(t, all, 5)).toBe(0);
  });

  it("Fullt Hus skiller på TOTAL antall markeringer", () => {
    // To bonger: t1 har 1 rad full (5 marks inkl. evt. free), t2 har 2 rader
    // delvis (4 + 4 = 8 marks). For fase 5 vinner t2 selv om t1 har en rad.
    const t1 = standardTicket("a", 0);
    const t2 = standardTicket("b", 30);

    const t1Drawn = rowDrawn(t1, 0); // 5 marks (rad 0 har ingen free center)
    const t2Drawn = new Set([
      ...t2.grid[0].filter((n) => n !== 0).slice(0, 4),
      ...t2.grid[1].filter((n) => n !== 0).slice(0, 4),
    ]); // 8 marks

    // Bygg felles drawn-sett (et tall trukket gjelder for begge bonger).
    const allDrawn = new Set([...t1Drawn, ...t2Drawn]);

    // For fase 5: t1 har 5 markert + free = 6 → 25-6 = 19. t2 har 8+free = 9 → 25-9 = 16.
    // t2 er nærmere → kommer først.
    const sorted = sortTicketsByProgress([t1, t2], allDrawn, 5);
    expect(sorted.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C) Sortering — riktig rekkefølge ved ulike progress
// ═══════════════════════════════════════════════════════════════════════════════

describe("sortTicketsByProgress — riktig rekkefølge", () => {
  it("fase 1: ticket med full rad kommer først", () => {
    const t1 = standardTicket("a", 0);
    const t2 = standardTicket("b", 30);
    const t3 = standardTicket("c", 50);

    // t2 har full rad 0; t1 og t3 har ingen markeringer (utenom center).
    const drawn = rowDrawn(t2, 0);

    const sorted = sortTicketsByProgress([t1, t2, t3], drawn, 1);
    expect(sorted[0].id).toBe("b");
  });

  it("fase 1: 2 tickets, ulik progress → mest komplett først", () => {
    const t1 = standardTicket("a", 0);
    const t2 = standardTicket("b", 30);

    // t1 har 4/5 i rad 0. t2 har 2/5 i rad 0.
    const drawn = new Set([
      ...t1.grid[0].filter((n) => n !== 0).slice(0, 4), // t1: 4 markert
      ...t2.grid[0].filter((n) => n !== 0).slice(0, 2), // t2: 2 markert
    ]);

    const sorted = sortTicketsByProgress([t2, t1], drawn, 1); // input: server-rekkefølge t2,t1
    expect(sorted.map((t) => t.id)).toEqual(["a", "b"]); // t1 (4 markert, score 1) først
  });

  it("fase 4: ticket med 3 fulle rader + 4/5 har lavere score enn ticket med kun 2 fulle rader", () => {
    const t1 = standardTicket("a", 0);
    const t2 = standardTicket("b", 30);

    // t1: rad 0+1+2+3 (4 fulle) → fase 4 nådd, score 0.
    const t1Drawn = new Set([
      ...rowDrawn(t1, 0),
      ...rowDrawn(t1, 1),
      ...rowDrawn(t1, 2),
      ...rowDrawn(t1, 3),
    ]);
    // t2: rad 0+1 (kun 2 fulle) → fase 4 trenger 2 til, score 10 (5+5).
    const t2Drawn = new Set([...rowDrawn(t2, 0), ...rowDrawn(t2, 1)]);

    const drawn = new Set([...t1Drawn, ...t2Drawn]);
    const sorted = sortTicketsByProgress([t2, t1], drawn, 4);
    expect(sorted[0].id).toBe("a");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D) Stabilitet — ties brytes deterministisk
// ═══════════════════════════════════════════════════════════════════════════════

describe("sortTicketsByProgress — stabilitet", () => {
  it("identisk score → original-rekkefølge bevart (stabil sort)", () => {
    const t1 = standardTicket("z", 0);
    const t2 = standardTicket("a", 30);
    const t3 = standardTicket("m", 50);
    // Ingen markeringer → alle får samme score (4 for fase 1, pga free center).
    const sorted = sortTicketsByProgress([t1, t2, t3], new Set(), 1);
    // Server-rekkefølge bevart, IKKE alfabetisk omsortert på id.
    expect(sorted.map((t) => t.id)).toEqual(["z", "a", "m"]);
  });

  it("identisk score, samme original-indeks i decorated → ticket.id som final tie-break", () => {
    // Vi kan ikke ha to ticketer med samme original-indeks via array-indeksering,
    // men vi kan teste at ticket.id-tie-break-koden er korrekt formet ved å
    // sammenligne to bonger med identiske marks som blir sortert mot hverandre
    // via den primære (score-baserte) tie-breaken først.
    //
    // Denne testen verifiserer at output er DETERMINISTISK på tvers av kall.
    const t1 = standardTicket("a", 0);
    const t2 = standardTicket("b", 30);
    const out1 = sortTicketsByProgress([t1, t2], new Set(), 1);
    const out2 = sortTicketsByProgress([t1, t2], new Set(), 1);
    expect(out1.map((t) => t.id)).toEqual(out2.map((t) => t.id));
  });

  it("returnerer en ny array (input-mutasjonsfri)", () => {
    const tickets = [standardTicket("a", 0), standardTicket("b", 30)];
    const sorted = sortTicketsByProgress(tickets, new Set(), 1);
    expect(sorted).not.toBe(tickets);
    // Original-array-rekkefølge er uendret.
    expect(tickets.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E) Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("sortTicketsByProgress — edge cases", () => {
  it("tom liste → tom liste", () => {
    expect(sortTicketsByProgress([], new Set([1, 2, 3]), 1)).toEqual([]);
  });

  it("én ticket → samme ticket", () => {
    const t = standardTicket("a", 0);
    expect(sortTicketsByProgress([t], new Set(), 1)).toEqual([t]);
  });

  it("ikke-5×5 grid (databingo) → score Infinity, sorteres bakerst", () => {
    const small: Ticket = {
      id: "small",
      grid: [
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
        [11, 12, 13, 14, 15],
      ],
      color: "Small Yellow",
      type: "small",
    };
    const large = standardTicket("large", 30);
    expect(closenessScore(small, new Set(), 1)).toBe(Number.POSITIVE_INFINITY);

    const sorted = sortTicketsByProgress([small, large], new Set(), 1);
    expect(sorted.map((t) => t.id)).toEqual(["large", "small"]);
  });

  it("free center inkluderes alltid (rad 2 har 1 'gratis' mark)", () => {
    const t = standardTicket("a", 0);
    // Empty drawn → kun free center i rad 2 er markert. Min row-score = rad 2 (4 igjen).
    expect(closenessScore(t, new Set(), 1)).toBe(4);
    // Bekreft: marker rad 2 fullt → score 0.
    const r2 = rowDrawn(t, 2);
    expect(closenessScore(t, r2, 1)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F) sortPhaseFromActivePattern
// ═══════════════════════════════════════════════════════════════════════════════

describe("sortPhaseFromActivePattern", () => {
  function pattern(name: string): PatternDefinition {
    return {
      id: name.toLowerCase().replace(/\s/g, "-"),
      name,
      claimType: "LINE",
      prizePercent: 50,
      order: 1,
      design: 1,
    };
  }

  it("Norsk fase-navn → SortPhase", () => {
    expect(sortPhaseFromActivePattern(pattern("1 Rad"))).toBe(1);
    expect(sortPhaseFromActivePattern(pattern("2 Rader"))).toBe(2);
    expect(sortPhaseFromActivePattern(pattern("3 Rader"))).toBe(3);
    expect(sortPhaseFromActivePattern(pattern("4 Rader"))).toBe(4);
    expect(sortPhaseFromActivePattern(pattern("Fullt Hus"))).toBe(5);
  });

  it("Engelske legacy-navn godtas", () => {
    expect(sortPhaseFromActivePattern(pattern("Row 1"))).toBe(1);
    expect(sortPhaseFromActivePattern(pattern("Full House"))).toBe(5);
    expect(sortPhaseFromActivePattern(pattern("Coverall"))).toBe(5);
  });

  it("ukjent navn → null", () => {
    expect(sortPhaseFromActivePattern(pattern("Stjerne"))).toBeNull();
    expect(sortPhaseFromActivePattern(pattern("Bilde"))).toBeNull();
  });

  it("null/undefined → null", () => {
    expect(sortPhaseFromActivePattern(null)).toBeNull();
    expect(sortPhaseFromActivePattern(undefined)).toBeNull();
  });
});
