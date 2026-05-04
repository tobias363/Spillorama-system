/**
 * @vitest-environment happy-dom
 *
 * Game3PatternMiniGrid — verifiserer at den STATIC 5×5-mini-griden:
 *   - rendrer 25 celler
 *   - highlightes celler basert på 25-element bitmask
 *   - INKLUDERER center-cell (12) når den er i mask (Spill 3 har ingen
 *     fri sentercelle, i motsetning til Spill 1)
 *   - oppdaterer won/active-state via CSS-klasser
 */
import { describe, it, expect } from "vitest";
import { Game3PatternMiniGrid } from "./Game3PatternMiniGrid.js";

describe("Game3PatternMiniGrid — initial render", () => {
  it("rendrer 25 celler i 5×5-grid", () => {
    const grid = new Game3PatternMiniGrid();
    const cells = grid.root.querySelectorAll(".g3-mini-cell");
    expect(cells.length).toBe(25);
    grid.destroy();
  });

  it("ingen celler er hit før setMask kalles", () => {
    const grid = new Game3PatternMiniGrid();
    const cells = grid.root.querySelectorAll(".g3-mini-cell");
    cells.forEach((c) => expect(c.classList.contains("hit")).toBe(false));
    grid.destroy();
  });
});

describe("Game3PatternMiniGrid — setMask", () => {
  it("highlightes nøyaktig de cellene som er 1 i mask", () => {
    const grid = new Game3PatternMiniGrid();
    const mask = new Array(25).fill(0);
    mask[0] = 1;
    mask[6] = 1;
    mask[12] = 1;
    mask[18] = 1;
    mask[24] = 1;
    grid.setMask(mask);
    const cells = grid.root.querySelectorAll(".g3-mini-cell");
    cells.forEach((c, i) => {
      expect(c.classList.contains("hit"), `cell ${i}`).toBe(mask[i] === 1);
    });
    grid.destroy();
  });

  it("INKLUDERER center-cell (12) — Spill 3 har ingen free space", () => {
    const grid = new Game3PatternMiniGrid();
    const mask = new Array(25).fill(0);
    mask[12] = 1;
    grid.setMask(mask);
    const cells = grid.root.querySelectorAll(".g3-mini-cell");
    expect(cells[12].classList.contains("hit")).toBe(true);
    grid.destroy();
  });

  it("ingen ikon eller img i center-cell (vs. Spill 1 PatternMiniGrid)", () => {
    const grid = new Game3PatternMiniGrid();
    const cells = grid.root.querySelectorAll(".g3-mini-cell");
    expect(cells[12].querySelector("img")).toBeNull();
    grid.destroy();
  });

  it("re-call setMask oppdaterer hit-state", () => {
    const grid = new Game3PatternMiniGrid();
    const mask1 = new Array(25).fill(0);
    mask1[0] = 1;
    grid.setMask(mask1);
    const cells = grid.root.querySelectorAll(".g3-mini-cell");
    expect(cells[0].classList.contains("hit")).toBe(true);

    const mask2 = new Array(25).fill(0);
    mask2[24] = 1;
    grid.setMask(mask2);
    expect(cells[0].classList.contains("hit")).toBe(false);
    expect(cells[24].classList.contains("hit")).toBe(true);
    grid.destroy();
  });
});

describe("Game3PatternMiniGrid — won/active-state", () => {
  it("setWon(true) legger til .won på root, setWon(false) fjerner den", () => {
    const grid = new Game3PatternMiniGrid();
    expect(grid.root.classList.contains("won")).toBe(false);
    grid.setWon(true);
    expect(grid.root.classList.contains("won")).toBe(true);
    grid.setWon(false);
    expect(grid.root.classList.contains("won")).toBe(false);
    grid.destroy();
  });

  it("setActive(true/false) toggler .active på root", () => {
    const grid = new Game3PatternMiniGrid();
    grid.setActive(true);
    expect(grid.root.classList.contains("active")).toBe(true);
    grid.setActive(false);
    expect(grid.root.classList.contains("active")).toBe(false);
    grid.destroy();
  });
});

describe("Game3PatternMiniGrid — cell sizing", () => {
  it("respekterer cellSize-option", () => {
    const grid = new Game3PatternMiniGrid({ cellSize: 18, cellGap: 2 });
    expect(grid.root.style.gridTemplateColumns).toBe("repeat(5, 18px)");
    expect(grid.root.style.gridTemplateRows).toBe("repeat(5, 18px)");
    expect(grid.root.style.gap).toBe("2px");
    grid.destroy();
  });

  it("default cellSize = 12, cellGap = 1.5", () => {
    const grid = new Game3PatternMiniGrid();
    expect(grid.root.style.gridTemplateColumns).toBe("repeat(5, 12px)");
    grid.destroy();
  });
});
