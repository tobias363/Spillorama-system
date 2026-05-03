/**
 * Unit tests for ticket.ts — pattern detection and ticket generation.
 * Covers: findFirstCompleteLinePatternIndex, hasAnyCompleteLine, hasFullBingo,
 * generateDatabingo60Ticket, ticketContainsNumber, makeShuffledBallBag.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  findFirstCompleteLinePatternIndex,
  hasAnyCompleteLine,
  hasFullBingo,
  generateDatabingo60Ticket,
  ticketContainsNumber,
  makeShuffledBallBag,
  makeRoomCode,
  uses75Ball,
  uses3x3Ticket,
  uses5x5NoCenterTicket,
  generateTicketForGame,
  generate3x3Ticket,
  generate5x5NoCenterTicket,
  BINGO75_SLUGS,
  GAME3_SLUGS,
} from "./ticket.js";
import type { Ticket } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a 3x5 grid with sequential numbers starting at `start`. */
function make3x5(start = 1): Ticket {
  return {
    grid: [
      [start, start + 1, start + 2, start + 3, start + 4],
      [start + 5, start + 6, start + 7, start + 8, start + 9],
      [start + 10, start + 11, start + 12, start + 13, start + 14],
    ],
  };
}

/** Create a 5x5 grid with free space at center [2][2] = 0. */
function make5x5(start = 1): Ticket {
  let n = start;
  const grid: number[][] = [];
  for (let r = 0; r < 5; r++) {
    const row: number[] = [];
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) {
        row.push(0);
      } else {
        row.push(n++);
      }
    }
    grid.push(row);
  }
  return { grid };
}

// ── findFirstCompleteLinePatternIndex ───────────────────────────────────────

describe("findFirstCompleteLinePatternIndex", () => {
  describe("3x5 grid", () => {
    test("returns -1 when no marks", () => {
      assert.equal(findFirstCompleteLinePatternIndex(make3x5(), new Set()), -1);
    });

    test("detects complete first row (index 0)", () => {
      const marks = new Set([1, 2, 3, 4, 5]);
      assert.equal(findFirstCompleteLinePatternIndex(make3x5(), marks), 0);
    });

    test("detects complete second row (index 1)", () => {
      const marks = new Set([6, 7, 8, 9, 10]);
      assert.equal(findFirstCompleteLinePatternIndex(make3x5(), marks), 1);
    });

    test("detects complete third row (index 2)", () => {
      const marks = new Set([11, 12, 13, 14, 15]);
      assert.equal(findFirstCompleteLinePatternIndex(make3x5(), marks), 2);
    });

    test("detects complete first column (index = rows + 0 = 3)", () => {
      const marks = new Set([1, 6, 11]);
      assert.equal(findFirstCompleteLinePatternIndex(make3x5(), marks), 3);
    });

    test("detects complete last column (index = rows + 4 = 7)", () => {
      const marks = new Set([5, 10, 15]);
      assert.equal(findFirstCompleteLinePatternIndex(make3x5(), marks), 7);
    });

    test("returns first found pattern (row before column)", () => {
      // Both row 0 and column 0 are complete
      const marks = new Set([1, 2, 3, 4, 5, 6, 11]);
      assert.equal(findFirstCompleteLinePatternIndex(make3x5(), marks), 0);
    });

    test("returns -1 with partial row", () => {
      const marks = new Set([1, 2, 3, 4]);
      assert.equal(findFirstCompleteLinePatternIndex(make3x5(), marks), -1);
    });

    test("returns -1 with partial column", () => {
      const marks = new Set([1, 6]);
      assert.equal(findFirstCompleteLinePatternIndex(make3x5(), marks), -1);
    });
  });

  describe("5x5 grid with free space", () => {
    test("returns -1 when no marks", () => {
      assert.equal(findFirstCompleteLinePatternIndex(make5x5(), new Set()), -1);
    });

    test("detects complete first row (index 0)", () => {
      const marks = new Set([1, 2, 3, 4, 5]);
      assert.equal(findFirstCompleteLinePatternIndex(make5x5(), marks), 0);
    });

    test("detects center row with free space (only 4 marks needed)", () => {
      // Center row [2]: 11, 12, 0(free), 13, 14
      const marks = new Set([11, 12, 13, 14]);
      assert.equal(findFirstCompleteLinePatternIndex(make5x5(), marks), 2);
    });

    test("detects center column with free space (only 4 marks needed)", () => {
      // Column 2: 3, 8, 0(free), 17, 22
      const marks = new Set([3, 8, 17, 22]);
      const result = findFirstCompleteLinePatternIndex(make5x5(), marks);
      // Column index = rows(5) + col(2) = 7
      assert.equal(result, 7);
    });

    test("returns -1 with scattered marks", () => {
      const marks = new Set([1, 7, 13, 19]);
      assert.equal(findFirstCompleteLinePatternIndex(make5x5(), marks), -1);
    });
  });
});

// ── hasAnyCompleteLine ──────────────────────────────────────────────────────

describe("hasAnyCompleteLine", () => {
  test("delegates to findFirstCompleteLinePatternIndex (row)", () => {
    const marks = new Set([1, 2, 3, 4, 5]);
    assert.equal(hasAnyCompleteLine(make3x5(), marks), true);
  });

  test("delegates to findFirstCompleteLinePatternIndex (column)", () => {
    const marks = new Set([1, 6, 11]);
    assert.equal(hasAnyCompleteLine(make3x5(), marks), true);
  });

  test("returns false when no complete line", () => {
    assert.equal(hasAnyCompleteLine(make3x5(), new Set([1, 2, 3])), false);
  });

  test("5x5 free space counts as marked", () => {
    const marks = new Set([11, 12, 13, 14]); // center row, free space fills gap
    assert.equal(hasAnyCompleteLine(make5x5(), marks), true);
  });
});

// ── hasFullBingo ────────────────────────────────────────────────────────────

describe("hasFullBingo", () => {
  describe("3x5 grid", () => {
    test("returns false with no marks", () => {
      assert.equal(hasFullBingo(make3x5(), new Set()), false);
    });

    test("returns false with 14 of 15 cells marked", () => {
      const marks = new Set(Array.from({ length: 14 }, (_, i) => i + 1));
      assert.equal(hasFullBingo(make3x5(), marks), false);
    });

    test("returns true when all 15 cells marked", () => {
      const marks = new Set(Array.from({ length: 15 }, (_, i) => i + 1));
      assert.equal(hasFullBingo(make3x5(), marks), true);
    });

    test("returns true with extra marks beyond grid numbers", () => {
      const marks = new Set(Array.from({ length: 30 }, (_, i) => i + 1));
      assert.equal(hasFullBingo(make3x5(), marks), true);
    });
  });

  describe("5x5 grid with free space", () => {
    test("returns true when all 24 non-free cells marked", () => {
      const marks = new Set(Array.from({ length: 24 }, (_, i) => i + 1));
      assert.equal(hasFullBingo(make5x5(), marks), true);
    });

    test("returns false with 23 of 24 non-free cells marked", () => {
      const marks = new Set(Array.from({ length: 23 }, (_, i) => i + 1));
      assert.equal(hasFullBingo(make5x5(), marks), false);
    });

    test("free space does not need to be in marks set", () => {
      // All non-free cells marked, 0 not in set
      const marks = new Set(Array.from({ length: 24 }, (_, i) => i + 1));
      assert.ok(!marks.has(0));
      assert.equal(hasFullBingo(make5x5(), marks), true);
    });
  });
});

// ── generateDatabingo60Ticket ───────────────────────────────────────────────

describe("generateDatabingo60Ticket", () => {
  test("generates a 3x5 grid", () => {
    const ticket = generateDatabingo60Ticket();
    assert.equal(ticket.grid.length, 3);
    for (const row of ticket.grid) {
      assert.equal(row.length, 5);
    }
  });

  test("all cells contain numbers 1–60", () => {
    const ticket = generateDatabingo60Ticket();
    for (const row of ticket.grid) {
      for (const cell of row) {
        assert.ok(cell >= 1 && cell <= 60, `cell ${cell} out of range`);
      }
    }
  });

  test("column ranges are correct (col 0: 1-12, col 1: 13-24, etc.)", () => {
    const ticket = generateDatabingo60Ticket();
    const ranges = [
      [1, 12], [13, 24], [25, 36], [37, 48], [49, 60],
    ];
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 3; row++) {
        const val = ticket.grid[row][col];
        assert.ok(
          val >= ranges[col][0] && val <= ranges[col][1],
          `grid[${row}][${col}]=${val} not in range [${ranges[col][0]}, ${ranges[col][1]}]`,
        );
      }
    }
  });

  test("columns are sorted ascending", () => {
    const ticket = generateDatabingo60Ticket();
    for (let col = 0; col < 5; col++) {
      const colValues = [ticket.grid[0][col], ticket.grid[1][col], ticket.grid[2][col]];
      assert.deepEqual(colValues, [...colValues].sort((a, b) => a - b));
    }
  });

  test("all 15 cells are unique", () => {
    const ticket = generateDatabingo60Ticket();
    const allNums = ticket.grid.flat();
    assert.equal(new Set(allNums).size, 15);
  });

  test("produces different tickets on repeated calls", () => {
    const tickets = Array.from({ length: 10 }, () => generateDatabingo60Ticket());
    const grids = tickets.map((t) => JSON.stringify(t.grid));
    const unique = new Set(grids);
    // With 10 random tickets, extremely unlikely all are identical
    assert.ok(unique.size > 1, "should produce varied tickets");
  });
});

// ── ticketContainsNumber ────────────────────────────────────────────────────

describe("ticketContainsNumber", () => {
  test("returns true for number on the grid", () => {
    assert.equal(ticketContainsNumber(make3x5(), 1), true);
    assert.equal(ticketContainsNumber(make3x5(), 15), true);
  });

  test("returns false for number not on the grid", () => {
    assert.equal(ticketContainsNumber(make3x5(), 16), false);
    assert.equal(ticketContainsNumber(make3x5(), 0), false);
  });

  test("works with 5x5 grid (free space 0)", () => {
    assert.equal(ticketContainsNumber(make5x5(), 1), true);
    assert.equal(ticketContainsNumber(make5x5(), 0), true); // free space
    assert.equal(ticketContainsNumber(make5x5(), 99), false);
  });
});

// ── makeShuffledBallBag ─────────────────────────────────────────────────────

describe("makeShuffledBallBag", () => {
  test("contains numbers 1 to 60 by default", () => {
    const bag = makeShuffledBallBag();
    assert.equal(bag.length, 60);
    const sorted = [...bag].sort((a, b) => a - b);
    assert.deepEqual(sorted, Array.from({ length: 60 }, (_, i) => i + 1));
  });

  test("respects custom maxNumber", () => {
    const bag = makeShuffledBallBag(75);
    assert.equal(bag.length, 75);
    const sorted = [...bag].sort((a, b) => a - b);
    assert.deepEqual(sorted, Array.from({ length: 75 }, (_, i) => i + 1));
  });

  test("is shuffled (not sorted)", () => {
    // Run 5 times — at least one should differ from sorted order
    const bags = Array.from({ length: 5 }, () => makeShuffledBallBag());
    const sorted = Array.from({ length: 60 }, (_, i) => i + 1);
    const allSorted = bags.every((b) => JSON.stringify(b) === JSON.stringify(sorted));
    assert.ok(!allSorted, "bags should not all be in sorted order");
  });
});

// ── makeRoomCode ────────────────────────────────────────────────────────────

describe("makeRoomCode", () => {
  test("generates a 6-character code", () => {
    const code = makeRoomCode(new Set());
    assert.equal(code.length, 6);
  });

  test("uses only allowed characters (no 0, O, I, 1)", () => {
    const allowed = new Set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    for (let i = 0; i < 20; i++) {
      const code = makeRoomCode(new Set());
      for (const ch of code) {
        assert.ok(allowed.has(ch), `character '${ch}' not in allowed set`);
      }
    }
  });

  test("does not collide with existing codes", () => {
    const existing = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const code = makeRoomCode(existing);
      assert.ok(!existing.has(code), "should not generate existing code");
      existing.add(code);
    }
  });
});

// ── 75-ball slug helpers ────────────────────────────────────────────────────

describe("uses75Ball", () => {
  test("returns true for canonical Game 1 slug", () => {
    assert.equal(uses75Ball("bingo"), true);
  });

  test("returns true for legacy numeric alias", () => {
    assert.equal(uses75Ball("game_1"), true);
  });

  test("returns false for other game slugs", () => {
    assert.equal(uses75Ball("rocket"), false);
    assert.equal(uses75Ball("game_2"), false);
    assert.equal(uses75Ball("monsterbingo"), false);
    assert.equal(uses75Ball("temabingo"), false);
    assert.equal(uses75Ball("spillorama"), false);
    assert.equal(uses75Ball("candy"), false);
  });

  test("returns false for nullish or empty input", () => {
    assert.equal(uses75Ball(undefined), false);
    assert.equal(uses75Ball(null), false);
    assert.equal(uses75Ball(""), false);
  });

  test("BINGO75_SLUGS only contains the two known aliases", () => {
    assert.deepEqual([...BINGO75_SLUGS].sort(), ["bingo", "game_1"]);
  });
});

describe("generateTicketForGame", () => {
  test("Game 1 (bingo) → 5x5 grid with free centre cell", () => {
    const ticket = generateTicketForGame("bingo");
    assert.equal(ticket.grid.length, 5);
    assert.equal(ticket.grid[0].length, 5);
    assert.equal(ticket.grid[2][2], 0);
  });

  test("Game 1 (game_1 alias) → 5x5 grid with free centre cell", () => {
    const ticket = generateTicketForGame("game_1");
    assert.equal(ticket.grid.length, 5);
    assert.equal(ticket.grid[2][2], 0);
  });

  test("Game 1 ticket numbers are in B-I-N-G-O column ranges (1–75)", () => {
    const ticket = generateTicketForGame("bingo");
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const n = ticket.grid[row][col];
        if (row === 2 && col === 2) continue;
        const min = col * 15 + 1;
        const max = col * 15 + 15;
        assert.ok(n >= min && n <= max, `cell [${row}][${col}]=${n} outside ${min}-${max}`);
      }
    }
  });

  test("Game 2 (rocket) → 3x3 grid with numbers in 1..21", () => {
    const ticket = generateTicketForGame("rocket");
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 3);
    for (const row of ticket.grid) {
      for (const n of row) {
        assert.ok(n >= 1 && n <= 21, `number ${n} outside 1-21`);
      }
    }
  });

  test("Other games → 3x5 Databingo60 grid (no free cell)", () => {
    const ticket = generateTicketForGame("databingo");
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 5);
    for (const row of ticket.grid) {
      for (const n of row) {
        assert.ok(n >= 1 && n <= 60, `number ${n} outside 1-60`);
      }
    }
  });

  // BIN-672: Removed "Undefined slug → 3x5 (defensive default)" test —
  // fallback was root cause of BIN-619/BIN-671. generateTicketForGame
  // now throws; explicit throw-tests live in ticket.bin672.test.ts.

  test("color and type metadata pass through for 75-ball tickets", () => {
    const ticket = generateTicketForGame("bingo", "Small Yellow", "small");
    assert.equal(ticket.color, "Small Yellow");
    assert.equal(ticket.type, "small");
  });
});

// ── Game 3 slug helpers — Spill 3 = 3×3 / 1..21 (Tobias 2026-05-03) ─────────

describe("Spill 3 (Mønsterbingo) bruker nå 3×3 / 1..21 — Tobias 2026-05-03", () => {
  test("uses3x3Ticket dekker monsterbingo", () => {
    assert.equal(uses3x3Ticket("monsterbingo"), true);
    assert.equal(uses3x3Ticket("mønsterbingo"), true);
    assert.equal(uses3x3Ticket("game_3"), true);
  });

  test("uses3x3Ticket dekker fortsatt Spill 2 — felles 3×3-format", () => {
    assert.equal(uses3x3Ticket("rocket"), true);
    assert.equal(uses3x3Ticket("tallspill"), true);
    assert.equal(uses3x3Ticket("game_2"), true);
  });

  test("uses3x3Ticket returnerer false for Spill 1 + ukjente", () => {
    assert.equal(uses3x3Ticket("bingo"), false);
    assert.equal(uses3x3Ticket("game_1"), false);
    assert.equal(uses3x3Ticket("databingo"), false);
    assert.equal(uses3x3Ticket(undefined), false);
    assert.equal(uses3x3Ticket(null), false);
    assert.equal(uses3x3Ticket(""), false);
  });

  test("uses5x5NoCenterTicket er DEPRECATED og returnerer alltid false", () => {
    // 2026-05-03: Spill 3 portet til 3×3, så denne hjelperen returnerer ikke
    // lenger true for noen slug. Beholdt for bakoverkompat med callere som
    // fortsatt importerer den.
    assert.equal(uses5x5NoCenterTicket("monsterbingo"), false);
    assert.equal(uses5x5NoCenterTicket("mønsterbingo"), false);
    assert.equal(uses5x5NoCenterTicket("game_3"), false);
    assert.equal(uses5x5NoCenterTicket("bingo"), false);
    assert.equal(uses5x5NoCenterTicket(undefined), false);
  });

  test("GAME3_SLUGS bevarer de tre kjente aliasene", () => {
    assert.deepEqual([...GAME3_SLUGS].sort(), ["game_3", "monsterbingo", "mønsterbingo"]);
  });

  test("ingen leak: Spill 3-slugs ruter ikke til Spill 1's 75-ball-format", () => {
    assert.equal(uses75Ball("monsterbingo"), false);
    assert.equal(uses75Ball("mønsterbingo"), false);
    assert.equal(uses75Ball("game_3"), false);
  });
});

describe("generate3x3Ticket genererer Spill 3-bonger korrekt", () => {
  test("produserer et 3×3-grid", () => {
    const ticket = generate3x3Ticket();
    assert.equal(ticket.grid.length, 3, "3 rader");
    for (const row of ticket.grid) {
      assert.equal(row.length, 3, "3 kolonner");
    }
  });

  test("alle 9 celler i [1, 21] og unike", () => {
    for (let i = 0; i < 20; i += 1) {
      const ticket = generate3x3Ticket();
      const flat = ticket.grid.flat();
      assert.equal(flat.length, 9);
      assert.equal(new Set(flat).size, 9, "alle 9 celler må være unike");
      for (const n of flat) {
        assert.ok(n >= 1 && n <= 21, `tall ${n} må være i [1, 21]`);
      }
    }
  });

  test("color og type-metadata følger med", () => {
    const ticket = generate3x3Ticket("Standard", "game3-3x3");
    assert.equal(ticket.color, "Standard");
    assert.equal(ticket.type, "game3-3x3");
  });

  test("genererer ulike brett ved gjentatt kall", () => {
    const tickets = Array.from({ length: 10 }, () => generate3x3Ticket());
    const grids = tickets.map((t) => JSON.stringify(t.grid));
    assert.ok(new Set(grids).size > 1, "bør produsere varierte brett");
  });
});

describe("generate5x5NoCenterTicket — DEPRECATED men fortsatt funksjonell (dead code)", () => {
  // Beholdt for bakoverkompat. Hjelperen kalles ikke fra `generateTicketForGame`
  // for noen kjent slug etter 2026-05-03.
  test("genererer fortsatt et gyldig 5×5-grid uten fri sentercelle hvis kalt eksplisitt", () => {
    const ticket = generate5x5NoCenterTicket();
    assert.equal(ticket.grid.length, 5);
    assert.equal(ticket.grid[0].length, 5);
    assert.notEqual(ticket.grid[2][2], 0);
  });

  test("color og type-metadata følger med", () => {
    const ticket = generate5x5NoCenterTicket("Legacy", "deprecated");
    assert.equal(ticket.color, "Legacy");
    assert.equal(ticket.type, "deprecated");
  });
});

describe("generateTicketForGame ruter Spill 3 til 3×3 (Tobias 2026-05-03)", () => {
  test("'monsterbingo' → 3×3 grid med tall i [1, 21]", () => {
    const ticket = generateTicketForGame("monsterbingo");
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 3);
    for (const row of ticket.grid) {
      for (const cell of row) {
        assert.ok(cell >= 1 && cell <= 21, `cell ${cell} ute av range`);
      }
    }
  });

  test("'mønsterbingo' alias ruter til 3×3", () => {
    const ticket = generateTicketForGame("mønsterbingo");
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 3);
  });

  test("'game_3' legacy-alias ruter til 3×3", () => {
    const ticket = generateTicketForGame("game_3");
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 3);
  });

  test("Spill 1 ('bingo') ruter fortsatt til 5×5 med fri sentercelle (regression guard)", () => {
    const ticket = generateTicketForGame("bingo");
    assert.equal(ticket.grid.length, 5);
    assert.equal(ticket.grid[2][2], 0, "Spill 1 fri sentercelle må bevares");
  });

  test("Spill 2 ('rocket') ruter fortsatt til 3×3 (samme format som Spill 3)", () => {
    const ticket = generateTicketForGame("rocket");
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 3);
  });
});

