/**
 * @vitest-environment happy-dom
 *
 * Game3PatternRow — verifiserer at Spill 3-pattern-listevisningen rendrer
 * 4 mini-grids (én per backend-pattern) med korrekte highlightes celler
 * fra `patternDataList`-bitmasken, og at won/active-state oppdateres uten
 * full DOM-rebuild.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";
import { Game3PatternRow } from "./Game3PatternRow.js";

function cellsToBitmask(cells: number[]): number[] {
  const mask = new Array(25).fill(0);
  for (const c of cells) mask[c] = 1;
  return mask;
}

/** Speiler `DEFAULT_GAME3_CONFIG.patterns` 1:1 så vi tester wire-formen. */
const G3_PATTERNS: PatternDefinition[] = [
  {
    id: "pattern-0",
    name: "Topp + midt",
    claimType: "BINGO",
    prizePercent: 25,
    order: 0,
    design: 0,
    patternDataList: cellsToBitmask([0, 1, 2, 3, 4, 7, 12, 17, 22]),
  },
  {
    id: "pattern-1",
    name: "Kryss",
    claimType: "BINGO",
    prizePercent: 25,
    order: 1,
    design: 0,
    patternDataList: cellsToBitmask([0, 4, 6, 8, 12, 16, 18, 20, 24]),
  },
  {
    id: "pattern-2",
    name: "Topp + diagonal",
    claimType: "BINGO",
    prizePercent: 25,
    order: 2,
    design: 0,
    patternDataList: cellsToBitmask([0, 1, 2, 3, 4, 8, 12, 16, 20]),
  },
  {
    id: "pattern-3",
    name: "Pyramide",
    claimType: "BINGO",
    prizePercent: 25,
    order: 3,
    design: 0,
    patternDataList: cellsToBitmask([12, 16, 17, 18, 20, 21, 22, 23, 24]),
  },
];

let row: Game3PatternRow;

beforeEach(() => {
  row = new Game3PatternRow();
  document.body.appendChild(row.root);
});

afterEach(() => {
  row.destroy();
});

describe("Game3PatternRow — initial render", () => {
  it("rendrer 4 tiles for 4 patterns", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const tiles = row.root.querySelectorAll(".g3-pattern-tile");
    expect(tiles.length).toBe(4);
  });

  it("rendrer 4 placeholder-tiles når patterns er tom (pre-game)", () => {
    row.update([], [], 0, false);
    const tiles = row.root.querySelectorAll(".g3-pattern-tile");
    expect(tiles.length).toBe(4);
  });

  it("hver tile har 25 celler (5×5 grid)", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const grids = row.root.querySelectorAll(".g3-mini-grid");
    expect(grids.length).toBe(4);
    grids.forEach((g) => {
      expect(g.querySelectorAll(".g3-mini-cell").length).toBe(25);
    });
  });
});

describe("Game3PatternRow — pattern-mask highlighting", () => {
  it("Topp + midt: highlightes 9 celler [0,1,2,3,4, 7, 12, 17, 22]", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const tiles = row.root.querySelectorAll(".g3-pattern-tile");
    const cells = tiles[0].querySelectorAll(".g3-mini-cell");
    const expected = new Set([0, 1, 2, 3, 4, 7, 12, 17, 22]);
    cells.forEach((cell, i) => {
      const isHit = cell.classList.contains("hit");
      if (expected.has(i)) {
        expect(isHit, `cell ${i} skal være hit i Topp+midt`).toBe(true);
      } else {
        expect(isHit, `cell ${i} skal IKKE være hit i Topp+midt`).toBe(false);
      }
    });
  });

  it("Kryss: highlightes 9 celler i X-form [0,4, 6,8, 12, 16,18, 20,24]", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const tiles = row.root.querySelectorAll(".g3-pattern-tile");
    const cells = tiles[1].querySelectorAll(".g3-mini-cell");
    const expected = new Set([0, 4, 6, 8, 12, 16, 18, 20, 24]);
    cells.forEach((cell, i) => {
      expect(cell.classList.contains("hit")).toBe(expected.has(i));
    });
  });

  it("Pyramide: highlightes 9 celler [12, 16,17,18, 20,21,22,23,24]", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const tiles = row.root.querySelectorAll(".g3-pattern-tile");
    const cells = tiles[3].querySelectorAll(".g3-mini-cell");
    const expected = new Set([12, 16, 17, 18, 20, 21, 22, 23, 24]);
    cells.forEach((cell, i) => {
      expect(cell.classList.contains("hit")).toBe(expected.has(i));
    });
  });

  it("center-cell (12) blir highlighted (Spill 3 har INGEN free center)", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const tiles = row.root.querySelectorAll(".g3-pattern-tile");
    // Alle 4 backend-mønstre inkluderer cell 12.
    for (let i = 0; i < 4; i++) {
      const cells = tiles[i].querySelectorAll(".g3-mini-cell");
      expect(cells[12].classList.contains("hit"), `tile ${i} cell 12`).toBe(true);
    }
  });
});

describe("Game3PatternRow — labels", () => {
  it("bruker korte labels for kjente backend-navn", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const labels = Array.from(
      row.root.querySelectorAll(".g3-pattern-tile-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["T", "X", "7", "Pyramide"]);
  });

  it("faller tilbake til full backend-navn for ukjente patterns", () => {
    const customPattern: PatternDefinition = {
      id: "custom-x",
      name: "MyCustomShape",
      claimType: "BINGO",
      prizePercent: 100,
      order: 0,
      design: 0,
      patternDataList: cellsToBitmask([0]),
    };
    row.update([customPattern], [], 100, true);
    const label = row.root.querySelector(".g3-pattern-tile-label");
    expect(label?.textContent).toBe("MyCustomShape");
  });
});

describe("Game3PatternRow — prize display", () => {
  it("viser 25% av prizePool når winningType=percent", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const prizes = Array.from(
      row.root.querySelectorAll(".g3-pattern-tile-prize"),
    ).map((el) => el.textContent);
    // 25% av 1000 = 250 kr per pattern
    expect(prizes).toEqual(["250 kr", "250 kr", "250 kr", "250 kr"]);
  });

  it("bruker payoutAmount fra resultat når pattern er vunnet", () => {
    const results: PatternResult[] = [
      {
        patternId: "pattern-0",
        patternName: "Topp + midt",
        claimType: "BINGO",
        isWon: true,
        payoutAmount: 333,
      },
    ];
    row.update(G3_PATTERNS, results, 1000, true);
    const firstPrize = row.root.querySelectorAll(".g3-pattern-tile-prize")[0];
    expect(firstPrize.textContent).toBe("333 kr");
  });
});

describe("Game3PatternRow — won/active-state", () => {
  it("vunnet pattern får .won-klasse på tile + grid", () => {
    const results: PatternResult[] = [
      {
        patternId: "pattern-0",
        patternName: "Topp + midt",
        claimType: "BINGO",
        isWon: true,
        payoutAmount: 250,
      },
    ];
    row.update(G3_PATTERNS, results, 1000, true);
    const tiles = row.root.querySelectorAll(".g3-pattern-tile");
    expect(tiles[0].classList.contains("won")).toBe(true);
    expect(tiles[1].classList.contains("won")).toBe(false);
    const grids = row.root.querySelectorAll(".g3-mini-grid");
    expect(grids[0].classList.contains("won")).toBe(true);
  });

  it("første ikke-vunne pattern får .active-klasse", () => {
    const results: PatternResult[] = [
      {
        patternId: "pattern-0",
        patternName: "Topp + midt",
        claimType: "BINGO",
        isWon: true,
        payoutAmount: 250,
      },
    ];
    row.update(G3_PATTERNS, results, 1000, true);
    const grids = row.root.querySelectorAll(".g3-mini-grid");
    expect(grids[0].classList.contains("active")).toBe(false); // vunnet
    expect(grids[1].classList.contains("active")).toBe(true); // første ikke-vunne
    expect(grids[2].classList.contains("active")).toBe(false);
    expect(grids[3].classList.contains("active")).toBe(false);
  });

  it("gameRunning=false → ingen tiles får .won eller .active (utenfor runde)", () => {
    const results: PatternResult[] = G3_PATTERNS.map((p) => ({
      patternId: p.id,
      patternName: p.name,
      claimType: p.claimType,
      isWon: true,
      payoutAmount: 100,
    }));
    row.update(G3_PATTERNS, results, 1000, false);
    const tiles = row.root.querySelectorAll(".g3-pattern-tile");
    tiles.forEach((t) => expect(t.classList.contains("won")).toBe(false));
    const grids = row.root.querySelectorAll(".g3-mini-grid");
    grids.forEach((g) => expect(g.classList.contains("active")).toBe(false));
  });
});

describe("Game3PatternRow — diff-oppdatering (ingen unødvendig rebuild)", () => {
  it("repeterte update med identisk state → samme DOM-noder gjenbrukes", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const tilesBefore = Array.from(row.root.querySelectorAll(".g3-pattern-tile"));
    row.update(G3_PATTERNS, [], 1000, true);
    const tilesAfter = Array.from(row.root.querySelectorAll(".g3-pattern-tile"));
    for (let i = 0; i < tilesBefore.length; i++) {
      expect(tilesAfter[i]).toBe(tilesBefore[i]);
    }
  });

  it("prizePool-endring oppdaterer prize-tekst uten rebuild", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    const tile0Before = row.root.querySelector(".g3-pattern-tile");
    row.update(G3_PATTERNS, [], 2000, true);
    const tile0After = row.root.querySelector(".g3-pattern-tile");
    expect(tile0After).toBe(tile0Before);
    const prize = row.root.querySelector(".g3-pattern-tile-prize");
    expect(prize?.textContent).toBe("500 kr"); // 25% av 2000
  });
});

describe("Game3PatternRow — destroy", () => {
  it("rydder opp DOM ved destroy", () => {
    row.update(G3_PATTERNS, [], 1000, true);
    expect(document.body.contains(row.root)).toBe(true);
    row.destroy();
    expect(document.body.contains(row.root)).toBe(false);
  });
});
