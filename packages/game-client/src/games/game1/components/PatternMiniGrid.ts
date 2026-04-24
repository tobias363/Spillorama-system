/**
 * 5×5 mini-grid som visualiserer aktiv fase i top-panelet.
 *
 * Speiler backend-reglen i `BingoEngine.meetsPhaseRequirement` (apps/backend/
 * src/game/BingoEngine.ts) — slik at spillere ser samme geometri som backend
 * faktisk belønner:
 *   - design 0 = custom mask (static highlight fra patternDataList)
 *   - design 1 ("1 Rad") = én hel rad ELLER én hel kolonne — cycler alle 10
 *   - design 2 ("2 Rader") = 2 vertikale KOLONNER — C(5,2) = 10 kombinasjoner
 *   - design 3 ("3 Rader") = 3 vertikale KOLONNER — C(5,3) = 10 kombinasjoner
 *   - design 4 ("4 Rader") = 4 vertikale KOLONNER — C(5,4) = 5 kombinasjoner
 *   - design ≥ 5 = clear (ingen highlight)
 *
 * Merk: Pattern-navnene er "N Rader" fra legacy, men backend krever VERTIKALE
 * kolonner fra fase 2. Mini-gridet reflekterer backend, ikke navnet.
 */

const GRID_SIZE = 5;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
// Mockup `.bingo-grid` is 136px wide, 5 cols, 2px gap → ~25.6px per cell.
const CELL_SIZE = 25;
const CELL_GAP = 2;
const TOTAL_SIZE = GRID_SIZE * CELL_SIZE + (GRID_SIZE - 1) * CELL_GAP;
const FILL_BG = "linear-gradient(135deg, #f1c40f, #d35400)";
const FILL_BORDER = "#ffcc00";
const FILL_SHADOW = "inset 0 0 4px rgba(255,255,255,0.4), 0 0 4px rgba(255,150,0,0.5)";
const NORMAL_BG = "rgba(100,20,20,0.4)";
const NORMAL_BORDER = "1px solid rgba(255,80,80,0.2)";
const CENTER_INDEX = 12; // row 2, col 2 — free space

/** Axis-tag for en linje i combinasjonen. */
type Line = { axis: "row" | "col"; index: number };

export class PatternMiniGrid {
  readonly root: HTMLDivElement;
  private cells: HTMLDivElement[] = [];
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  /** Indices av celler som er i hit-state akkurat nå. Brukes av highlightLines
   *  for å diffe mot neste combo — kun celler som faktisk bytter state får
   *  style-writes. Uten diffing ville alle 25 celler fått 3 style-writes per
   *  1-sek-step (75 writes/sek) — synlig som subtil flimring, spesielt under
   *  blur (f.eks. backdrop-filter bak buy-popup). */
  private currentHitIndices = new Set<number>();

  constructor() {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      display: "grid",
      gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
      gap: `${CELL_GAP}px`,
      width: `${TOTAL_SIZE}px`,
      flexShrink: "0",
    });

    for (let i = 0; i < CELL_COUNT; i++) {
      const cell = document.createElement("div");
      Object.assign(cell.style, {
        width: `${CELL_SIZE}px`,
        height: `${CELL_SIZE}px`,
        borderRadius: "2px",
        background: NORMAL_BG,
        border: NORMAL_BORDER,
        transition: "background 0.2s ease, box-shadow 0.2s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });
      if (i === CENTER_INDEX) {
        // Free-space marker (mockup `Asset 4.png` — roulette/clover icon).
        const icon = document.createElement("img");
        icon.src = "/web/games/assets/game1/design/center-free.png";
        icon.alt = "";
        icon.style.cssText = "width:85%;height:85%;object-fit:contain;pointer-events:none;";
        cell.appendChild(icon);
      }
      this.cells.push(cell);
      this.root.appendChild(cell);
    }
  }

  /**
   * Sett hvilken fase/design som skal vises.
   * @param design  0=custom mask, 1=fase 1 (rad/kolonne), 2-4=fase 2-4 (N kolonner),
   *                5=Fullt Hus (alle 25 celler markert statisk)
   * @param patternDataList  kun for design 0 — 25-cellers bitmaske (1=fill)
   */
  setDesign(design: number, patternDataList?: number[]): void {
    this.stopAnimation();

    if (design === 0) {
      this.showCustomMask(patternDataList ?? []);
      return;
    }
    if (design >= 1 && design <= 4) {
      this.startPhaseCycleAnimation(design);
      return;
    }
    if (design === 5) {
      this.showFullHouse();
      return;
    }
    this.clearAll();
  }

  /** Fullt Hus: alle 24 ikke-center-celler markert statisk med pulse. */
  private showFullHouse(): void {
    const allHits = new Set<number>();
    for (let i = 0; i < CELL_COUNT; i++) {
      if (i === CENTER_INDEX) continue;
      allHits.add(i);
      this.applyCellState(this.cells[i], true);
      this.pulseCell(this.cells[i]);
    }
    this.currentHitIndices = allHits;
  }

  /** Design 0: statisk highlight fra 25-cellers patternDataList. */
  private showCustomMask(mask: number[]): void {
    for (let i = 0; i < this.cells.length; i++) {
      const filled = i < mask.length && mask[i] === 1 && i !== CENTER_INDEX;
      this.applyCellState(this.cells[i], filled);
      if (filled) this.pulseCell(this.cells[i]);
    }
  }

  private applyCellState(cell: HTMLDivElement, hit: boolean): void {
    if (hit) {
      cell.style.background = FILL_BG;
      cell.style.borderColor = FILL_BORDER;
      cell.style.boxShadow = FILL_SHADOW;
    } else {
      cell.style.background = NORMAL_BG;
      cell.style.borderColor = "rgba(255,80,80,0.2)";
      cell.style.boxShadow = "";
    }
  }

  /** Cycler alle kombinasjoner for gitt fase (1-4), 1 sek per frame. */
  private startPhaseCycleAnimation(phase: number): void {
    const combinations = this.getPhaseCombinations(phase);
    if (combinations.length === 0) return;
    let stepIndex = 0;

    const step = () => {
      this.highlightLines(combinations[stepIndex % combinations.length]);
      stepIndex++;
    };

    step();
    this.animationTimer = setInterval(step, 1000);
  }

  /**
   * Generér kandidat-kombinasjoner for fase-animasjonen:
   *   - fase 1: 5 rader + 5 kolonner (10 enkeltlinjer — rad ELLER kolonne)
   *   - fase 2-4: KUN adjacent horisontale rader (side-om-side). Regel fra
   *     Tobias 2026-04-24: viser alltid sammenhengende rader slik at spiller
   *     ser tydelig hvor mange rader som spilles om. Vinner-detektering
   *     godtar fortsatt alle C(5,k) rad-kombinasjoner (via shared-types
   *     PHASE_*_MASKS), men animasjonen cycler kun adjacent-variantene.
   *
   * Eksponert for testing. Private i praksis.
   */
  getPhaseCombinations(phase: number): Line[][] {
    if (phase === 1) {
      const combos: Line[][] = [];
      for (let r = 0; r < GRID_SIZE; r++) combos.push([{ axis: "row", index: r }]);
      for (let c = 0; c < GRID_SIZE; c++) combos.push([{ axis: "col", index: c }]);
      return combos;
    }
    if (phase < 2 || phase > 4) return [];
    // Adjacent vindu: rad-start fra 0 til GRID_SIZE - phase. Fase 2 → 4 vinduer
    // (0-1, 1-2, 2-3, 3-4), fase 3 → 3 vinduer, fase 4 → 2 vinduer.
    const combos: Line[][] = [];
    for (let start = 0; start + phase <= GRID_SIZE; start++) {
      const rows: Line[] = [];
      for (let r = start; r < start + phase; r++) {
        rows.push({ axis: "row" as const, index: r });
      }
      combos.push(rows);
    }
    return combos;
  }

  /** Farg alle celler i de gitte linjene (rader eller kolonner), minus center.
   *
   *  Diff-basert: beregn nye hit-indices, så bare celler som faktisk bytter
   *  state får style-writes. Celler som forblir hit beholder sin CSS pulse-
   *  animation uten reset (som tidligere avbrøt pulsen hver sekund). */
  private highlightLines(lines: Line[]): void {
    const newHits = new Set<number>();
    for (const line of lines) {
      const cellsInLine = line.axis === "row"
        ? rowCellIndices(line.index)
        : colCellIndices(line.index);
      for (const idx of cellsInLine) {
        if (idx !== CENTER_INDEX) newHits.add(idx);
      }
    }

    // hit → normal (celler som var hit forrige step men ikke nå)
    for (const idx of this.currentHitIndices) {
      if (newHits.has(idx)) continue;
      this.applyCellState(this.cells[idx], false);
      this.cells[idx].style.animation = "";
      this.cells[idx].style.transform = "scale(1)";
    }
    // normal → hit (nye treff)
    for (const idx of newHits) {
      if (this.currentHitIndices.has(idx)) continue;
      this.applyCellState(this.cells[idx], true);
      this.pulseCell(this.cells[idx]);
    }

    this.currentHitIndices = newHits;
  }

  private pulseCell(cell: HTMLDivElement): void {
    cell.style.animation = "pattern-pulse 0.5s ease-in-out infinite alternate";
  }

  private clearAll(): void {
    // Diff mot nåværende hit-set — bare celler som faktisk var hit trenger reset.
    for (const idx of this.currentHitIndices) {
      this.applyCellState(this.cells[idx], false);
      this.cells[idx].style.transform = "scale(1)";
      this.cells[idx].style.animation = "";
    }
    this.currentHitIndices.clear();
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

/** Celle-indekser (row-major) for en gitt rad. */
function rowCellIndices(row: number): number[] {
  return [0, 1, 2, 3, 4].map((c) => row * GRID_SIZE + c);
}

/** Celle-indekser (row-major) for en gitt kolonne. */
function colCellIndices(col: number): number[] {
  return [0, 1, 2, 3, 4].map((r) => r * GRID_SIZE + col);
}

// Inject CSS keyframe én gang per dokument.
if (typeof document !== "undefined" && !document.getElementById("pattern-pulse-style")) {
  const style = document.createElement("style");
  style.id = "pattern-pulse-style";
  style.textContent = `@keyframes pattern-pulse { from { transform: scale(1); } to { transform: scale(1.06); } }`;
  document.head.appendChild(style);
}
