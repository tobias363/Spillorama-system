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
const CENTER_INDEX = 12; // row 2, col 2 — free space

/**
 * BIN-blink-permanent-fix 2026-04-24: all cell-styling via CSS-klasser.
 * Tidligere hver cycle (1/sek) gjorde `cell.style.background/boxShadow = ...`
 * direkte + `transition: background 0.2s` trigget transitionstart-events
 * (20+ per sekund). Nå styres alt via `.mini-cell` / `.mini-cell.hit` så
 * class-toggle gir én attr:class-mutasjon i stedet for fem style-writes.
 */
function ensureMiniGridStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("mini-grid-cell-styles")) return;
  const s = document.createElement("style");
  s.id = "mini-grid-cell-styles";
  // Round 3 blink-fix (2026-04-24): tidligere brukte `.mini-cell.hit` en
  // per-celle `scale(1→1.06) 0.5s alternate`-pulse. CSS-animasjoner er
  // stateless per-element, så hver gang en celle byttet fra normal→hit
  // (hvert sekund under fase-cycling) startet pulsen på nytt fra scale 1.
  // Det ga en synlig "pop" når nye celler ble farget inn, selv om diff-
  // gaten i highlightLines allerede hindret style-writes på UENDREDE
  // celler.
  //
  // Valgt løsning: gradient-sveip på `.mini-cell.hit` via
  // `background-position`-animasjon. Sveipet er ankret til container-nivå
  // (større background-size enn cellen), så når en ny celle legges til
  // `.hit` får den samme position-offset som naboene — ingen visuell
  // restart. Eliminerer den største gjenværende "blink"-kilden i top-
  // panelet. Beholder scale-utseende via statisk transform for fylde.
  s.textContent = `
@keyframes pattern-sweep {
  0%   { background-position: 0% 50%; }
  100% { background-position: 100% 50%; }
}
.mini-cell {
  width: ${CELL_SIZE}px;
  height: ${CELL_SIZE}px;
  border-radius: 2px;
  background: rgba(100,20,20,0.4);
  border: 1px solid rgba(255,80,80,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  /* INGEN CSS-transition på background/box-shadow — ville gitt
   * transitionstart-events for hver cell-swap. */
}
.mini-cell.hit {
  /* Bred gradient (300% av cellens bredde) sveipes via background-position.
   * Phase-locket via inline animation-delay (negativ, per cell-index)
   * så en celle som bytter fra normal->hit mid-cycle hopper inn i pågående
   * sveip i stedet for å restarte fra position: 0%. Longhand-properties
   * brukes så inline animation-delay ikke blir overstyrt av animation-
   * shorthanden. */
  background: linear-gradient(90deg, #f1c40f, #d35400, #f1c40f, #d35400);
  background-size: 300% 100%;
  border-color: #ffcc00;
  box-shadow: inset 0 0 4px rgba(255,255,255,0.4), 0 0 4px rgba(255,150,0,0.5);
  animation-name: pattern-sweep;
  animation-duration: 3s;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
`;
  document.head.appendChild(s);
}

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
    ensureMiniGridStyles();
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
      cell.className = "mini-cell";
      // Phase-lock sweepet per cell-posisjon: negativ `animation-delay`
      // hopper inn i pågående sveip i stedet for å starte fra 0. Uten
      // dette ville hver nye `.hit`-celle starte sveipet sitt på nytt
      // (CSS-animasjoner er stateless per-element) og gitt den "pop"-
      // effekten vi prøver å eliminere. Med delta = cell-index / total
      // × cycle-lengde er alle celler deterministisk fordelt over
      // sveipets faser.
      const offsetSec = ((i % CELL_COUNT) / CELL_COUNT) * 3;
      cell.style.animationDelay = `-${offsetSec.toFixed(3)}s`;
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
    }
    this.currentHitIndices = allHits;
  }

  /** Design 0: statisk highlight fra 25-cellers patternDataList. */
  private showCustomMask(mask: number[]): void {
    for (let i = 0; i < this.cells.length; i++) {
      const filled = i < mask.length && mask[i] === 1 && i !== CENTER_INDEX;
      this.applyCellState(this.cells[i], filled);
    }
  }

  private applyCellState(cell: HTMLDivElement, hit: boolean): void {
    // BIN-blink-permanent-fix: én class-toggle i stedet for 3 style-writes.
    // `pattern-pulse`-animasjonen ligger i `.mini-cell.hit`-selector så
    // animationstart fyrer kun når klassen faktisk legges til, ikke hver
    // sek. Diff-gate (`highlightLines`) sikrer at dette kun skjer på
    // celler som faktisk bytter state.
    cell.classList.toggle("hit", hit);
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

    // hit → normal (celler som var hit forrige step men ikke nå).
    // BIN-blink-permanent-fix: én classList.toggle per celle, ikke
    // tre separate style-writes + animation-reset.
    for (const idx of this.currentHitIndices) {
      if (newHits.has(idx)) continue;
      this.applyCellState(this.cells[idx], false);
    }
    // normal → hit (nye treff)
    for (const idx of newHits) {
      if (this.currentHitIndices.has(idx)) continue;
      this.applyCellState(this.cells[idx], true);
    }

    this.currentHitIndices = newHits;
  }

  private clearAll(): void {
    // Diff mot nåværende hit-set — bare celler som faktisk var hit trenger reset.
    for (const idx of this.currentHitIndices) {
      this.applyCellState(this.cells[idx], false);
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

// CSS keyframe + .mini-cell / .mini-cell.hit styles defined in
// `ensureMiniGridStyles` (#mini-grid-cell-styles) — injected on first
// constructor call (only once per document).
