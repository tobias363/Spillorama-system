/**
 * 5x5 mini-grid showing a pattern visualization with cycling animations.
 *
 * Design types (from Unity):
 *   0 = custom mask (static highlight from patternDataList)
 *   1 = single row cycle (rows then columns, 1s delay)
 *   2 = two-row combinations cycle
 *   3 = three-row combinations cycle
 *   4 = four-row combinations (all minus 1 row)
 */

const GRID_SIZE = 5;
const CELL_SIZE = 10;
const CELL_GAP = 2;
const TOTAL_SIZE = GRID_SIZE * CELL_SIZE + (GRID_SIZE - 1) * CELL_GAP;
const FILL_COLOR = "#ffe83d";
const NORMAL_COLOR = "rgba(255,255,255,0.15)";
const CENTER_INDEX = 12; // row 2, col 2 (free space)

export class PatternMiniGrid {
  readonly root: HTMLDivElement;
  private cells: HTMLDivElement[] = [];
  private animationTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      display: "grid",
      gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
      gap: `${CELL_GAP}px`,
      width: `${TOTAL_SIZE}px`,
      flexShrink: "0",
    });

    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const cell = document.createElement("div");
      Object.assign(cell.style, {
        width: `${CELL_SIZE}px`,
        height: `${CELL_SIZE}px`,
        borderRadius: "2px",
        background: NORMAL_COLOR,
        transition: "background 0.2s ease",
      });
      this.cells.push(cell);
      this.root.appendChild(cell);
    }
  }

  /**
   * Set pattern visualization based on design type.
   * @param design  0=custom, 1=single row, 2=two rows, 3=three rows, 4=four rows
   * @param patternDataList  For design 0: array of 25 ints (1=fill, 0=empty)
   */
  setDesign(design: number, patternDataList?: number[]): void {
    this.stopAnimation();

    switch (design) {
      case 0:
        this.showCustomMask(patternDataList ?? []);
        break;
      case 1:
        this.startRowCycleAnimation(1);
        break;
      case 2:
        this.startRowCycleAnimation(2);
        break;
      case 3:
        this.startRowCycleAnimation(3);
        break;
      case 4:
        this.startRowCycleAnimation(4);
        break;
      default:
        this.clearAll();
        break;
    }
  }

  /** Design 0: Static highlight from patternDataList bitmask. */
  private showCustomMask(mask: number[]): void {
    for (let i = 0; i < this.cells.length; i++) {
      const filled = i < mask.length && mask[i] === 1 && i !== CENTER_INDEX;
      this.cells[i].style.background = filled ? FILL_COLOR : NORMAL_COLOR;
      if (filled) {
        this.cells[i].style.transform = "scale(1)";
        this.pulseCell(this.cells[i]);
      }
    }
  }

  /**
   * Design 1-4: Cycling row combinations.
   * Design 1: each single row, then each column
   * Design 2: each pair of rows
   * Design 3: each triple of rows
   * Design 4: all rows minus one (4 highlighted)
   */
  private startRowCycleAnimation(rowCount: number): void {
    const combinations = this.getRowCombinations(rowCount);
    let stepIndex = 0;

    const step = () => {
      if (combinations.length === 0) return;
      const combo = combinations[stepIndex % combinations.length];
      this.highlightRows(combo);
      stepIndex++;
    };

    step(); // Show first immediately
    this.animationTimer = setInterval(step, 1000);
  }

  /** Generate all row combinations of given size, plus columns for design 1. */
  private getRowCombinations(count: number): number[][] {
    const combos: number[][] = [];

    if (count === 1) {
      // Design 1: cycle rows 0-4 then columns 0-4
      for (let r = 0; r < GRID_SIZE; r++) combos.push([r]);
      // Add column indices as negative numbers (convention: -1 = col 0, -5 = col 4)
      for (let c = 0; c < GRID_SIZE; c++) combos.push([-(c + 1)]);
      return combos;
    }

    // Generate all C(5, count) combinations of rows
    const rows = [0, 1, 2, 3, 4];
    const generate = (start: number, current: number[]): void => {
      if (current.length === count) {
        combos.push([...current]);
        return;
      }
      for (let i = start; i < rows.length; i++) {
        current.push(rows[i]);
        generate(i + 1, current);
        current.pop();
      }
    };
    generate(0, []);
    return combos;
  }

  /** Highlight specific rows (or columns if negative indices). */
  private highlightRows(indices: number[]): void {
    // Reset all
    for (const cell of this.cells) {
      cell.style.background = NORMAL_COLOR;
      cell.style.transform = "scale(1)";
    }

    for (const idx of indices) {
      if (idx >= 0) {
        // Row index
        for (let col = 0; col < GRID_SIZE; col++) {
          const cellIdx = idx * GRID_SIZE + col;
          if (cellIdx !== CENTER_INDEX) {
            this.cells[cellIdx].style.background = FILL_COLOR;
            this.pulseCell(this.cells[cellIdx]);
          }
        }
      } else {
        // Column index (negative, -1 = col 0)
        const col = -(idx + 1);
        for (let row = 0; row < GRID_SIZE; row++) {
          const cellIdx = row * GRID_SIZE + col;
          if (cellIdx !== CENTER_INDEX) {
            this.cells[cellIdx].style.background = FILL_COLOR;
            this.pulseCell(this.cells[cellIdx]);
          }
        }
      }
    }
  }

  /**
   * CSS breathe animation on a cell.
   */
  private pulseCell(cell: HTMLDivElement): void {
    cell.style.animation = "pattern-pulse 0.5s ease-in-out infinite alternate";
  }

  private clearAll(): void {
    for (const cell of this.cells) {
      cell.style.background = NORMAL_COLOR;
      cell.style.transform = "scale(1)";
      cell.style.animation = "";
    }
  }

  stopAnimation(): void {
    if (this.animationTimer !== null) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    this.clearAll();
  }

  destroy(): void {
    this.stopAnimation();
    this.root.remove();
  }
}

// Inject CSS animation keyframe (once)
if (typeof document !== "undefined" && !document.getElementById("pattern-pulse-style")) {
  const style = document.createElement("style");
  style.id = "pattern-pulse-style";
  style.textContent = `@keyframes pattern-pulse { from { transform: scale(1); } to { transform: scale(1.06); } }`;
  document.head.appendChild(style);
}
