/**
 * @deprecated for Spill 2 (rocket) per PR #923 + #926.
 * BEHOLDES kun for Game5Controller (SpinnGo, post-pilot scope).
 * Slett i Bølge D når Game5 enten flyttes til games/game5/-mappe
 * eller fjernes fra registry.
 *
 * Se docs/architecture/CLEANUP_AUDIT_2026-05-05.md §3 (Kategori B)
 * og §6 (Kategori E.1) for full kontekst.
 */

import { Container } from "pixi.js";
import type { Ticket } from "@spillorama/shared-types/game";
import { BingoCell, type BingoCellColors } from "./BingoCell.js";

export type GridSize = "3x3" | "3x5" | "5x5";

export interface BingoGridOptions {
  /** Grid layout: "3x3" (Game 2,5), "3x5" (backend ticket format), "5x5" (Game 1,3) */
  gridSize: GridSize;
  /** Cell size in pixels */
  cellSize?: number;
  /** Gap between cells */
  gap?: number;
  /** Optional cell color theme (from Unity's TicketColorData) */
  cellColors?: BingoCellColors;
}

interface GridDimensions {
  rows: number;
  cols: number;
}

function parseGridSize(size: GridSize): GridDimensions {
  switch (size) {
    case "3x3": return { rows: 3, cols: 3 };
    case "3x5": return { rows: 3, cols: 5 };
    case "5x5": return { rows: 5, cols: 5 };
  }
}

/**
 * Reusable bingo grid component.
 *
 * Renders a grid of BingoCell instances from a Ticket.
 * Supports marking, 1-to-go blink, pattern highlighting.
 *
 * Backend Ticket format depends on game type:
 * - Databingo60 (Game 2-5): 3x5 grid (3 rows, 5 cols), numbers 1-60.
 * - Bingo75 (Game 1): 5x5 grid (5 rows, 5 cols), numbers 1-75, center=0 (free space).
 * For 3x3 grids (Game 2, 5), only the first 3x3 portion is used.
 */
export class BingoGrid extends Container {
  private cells: BingoCell[] = [];
  private cellMap = new Map<number, BingoCell>(); // number → cell
  private dims: GridDimensions;
  private cellSize: number;
  private gap: number;
  private cellColors?: BingoCellColors;

  constructor(options: BingoGridOptions) {
    super();
    this.dims = parseGridSize(options.gridSize);
    this.cellSize = options.cellSize ?? 60;
    this.gap = options.gap ?? 4;
    this.cellColors = options.cellColors;
  }

  /** Load ticket data into the grid. */
  loadTicket(ticket: Ticket): void {
    this.clearGrid();

    const numbers = this.extractNumbers(ticket);

    for (let row = 0; row < this.dims.rows; row++) {
      for (let col = 0; col < this.dims.cols; col++) {
        const index = row * this.dims.cols + col;
        const num = numbers[index];

        // Center cell in 5x5 grid is free space
        const isFreeSpace =
          this.dims.rows === 5 &&
          this.dims.cols === 5 &&
          row === 2 &&
          col === 2;

        const cell = new BingoCell({
          size: this.cellSize,
          number: isFreeSpace ? 0 : num,
          isFreeSpace,
          colors: this.cellColors,
        });

        cell.x = col * (this.cellSize + this.gap);
        cell.y = row * (this.cellSize + this.gap);

        // Click-to-mark handler
        cell.on("pointerdown", () => {
          this.emit("cellClicked", cell.cellNumber, cell);
        });

        this.addChild(cell);
        this.cells.push(cell);
        if (!isFreeSpace) {
          this.cellMap.set(num, cell);
        }
      }
    }
  }

  /** Mark a number on the grid (called when a ball is drawn). */
  markNumber(number: number): boolean {
    const cell = this.cellMap.get(number);
    if (!cell || cell.isMarked()) return false;
    cell.mark();
    return true;
  }

  /** Mark multiple numbers (restore state from snapshot). */
  markNumbers(numbers: number[]): void {
    for (const n of numbers) {
      this.markNumber(n);
    }
  }

  /** Get cell by number. */
  getCell(number: number): BingoCell | undefined {
    return this.cellMap.get(number);
  }

  /** Get all cells. */
  getCells(): BingoCell[] {
    return [...this.cells];
  }

  /** Get unmarked numbers. */
  getUnmarkedNumbers(): number[] {
    const unmarked: number[] = [];
    for (const [num, cell] of this.cellMap) {
      if (!cell.isMarked()) unmarked.push(num);
    }
    return unmarked;
  }

  /** Count remaining unmarked cells (excluding free space). */
  getRemainingCount(): number {
    return this.getUnmarkedNumbers().length;
  }

  /** Start blink on specific cells (1-to-go), optionally with background highlight color. */
  blinkCells(numbers: number[], oneToGoColor?: number): void {
    for (const n of numbers) {
      this.cellMap.get(n)?.startBlink(oneToGoColor);
    }
  }

  /** Stop all blinking. */
  stopAllBlinks(): void {
    for (const cell of this.cells) {
      cell.stopBlink();
    }
  }

  /**
   * Hard reset of ALL cell animations — used at game-end / scene reset.
   *
   * Delegates to {@link BingoCell.stopAllAnimations} which kills every
   * tween targeting cell scale (mark bounce, blink) and snaps scale back
   * to 1:1 without any animation. See BingoCell.stopAllAnimations for the
   */
  stopAllAnimations(): void {
    for (const cell of this.cells) {
      cell.stopAllAnimations();
    }
  }

  /** Highlight cells for a pattern. */
  highlightPattern(cellNumbers: number[]): void {
    // Clear previous highlights
    for (const cell of this.cells) cell.setHighlight(false);
    // Highlight pattern cells
    for (const n of cellNumbers) {
      this.cellMap.get(n)?.setHighlight(true);
    }
  }

  /** Clear all highlights. */
  clearHighlights(): void {
    for (const cell of this.cells) cell.setHighlight(false);
  }

  /** Reset all cells to initial state. */
  reset(): void {
    for (const cell of this.cells) cell.reset();
  }

  /** Get total grid width in pixels. */
  get gridWidth(): number {
    return this.dims.cols * (this.cellSize + this.gap) - this.gap;
  }

  /** Get total grid height in pixels. */
  get gridHeight(): number {
    return this.dims.rows * (this.cellSize + this.gap) - this.gap;
  }

  // ── Private ───────────────────────────────────────────────────────────

  private extractNumbers(ticket: Ticket): number[] {
    const ticketRows = ticket.grid.length;
    const ticketCols = ticket.grid[0]?.length ?? 0;
    const flat = ticket.grid.flat();

    if (this.dims.rows === 3 && this.dims.cols === 5) {
      // 3x5 — use as-is
      return flat;
    }

    if (this.dims.rows === 3 && this.dims.cols === 3) {
      // 3x3 — take first 3 cols from each of 3 rows
      const nums: number[] = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          nums.push(ticket.grid[r][c]);
        }
      }
      return nums;
    }

    if (this.dims.rows === 5 && this.dims.cols === 5) {
      // Native 5x5 ticket from backend (75-ball bingo) — use as-is
      if (ticketRows === 5 && ticketCols === 5) {
        return flat;
      }
      // Legacy fallback: reshape 3x5 (15 numbers) into 5x5 (25 slots) with center free
      const nums: number[] = [];
      let srcIdx = 0;
      for (let i = 0; i < 25; i++) {
        if (i === 12) {
          nums.push(0); // free space
        } else {
          nums.push(flat[srcIdx] ?? 0);
          srcIdx++;
        }
      }
      return nums;
    }

    return flat;
  }

  private clearGrid(): void {
    for (const cell of this.cells) {
      cell.destroy();
    }
    this.removeChildren();
    this.cells = [];
    this.cellMap.clear();
  }
}
