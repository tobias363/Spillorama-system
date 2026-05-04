/**
 * Game3PatternMiniGrid — STATIC 5×5 mini-grid for Spill 3.
 *
 * I motsetning til `game1/PatternMiniGrid` har dette gridet:
 *   - INGEN free-center-celle (Spill 3 spiller på 5×5 uten fri sentercelle).
 *   - INGEN fase-cykling/animasjon — viser ÉN pattern statisk.
 *   - Konfigurerbar cellestørrelse så fire grids passer side om side i
 *     `CenterTopPanel`-combo-panelet (~376px bredt, gap mellom dem).
 *
 * Kilde-pattern leses fra backendens `PatternDefinition.patternDataList`
 * (25-bit bitmask, row-major). Spill 3-engine sender denne 1:1 fra
 * `DEFAULT_GAME3_CONFIG.patterns[*].patternDataList` via
 * `patternConfigToDefinitions` (apps/backend/src/game/variantConfig.ts).
 *
 * Visuell stil følger samme `gold→orange`-gradient som `PatternMiniGrid.hit`
 * for konsistent merkevarefølelse på tvers av spill, men uten den løpende
 * background-position-animasjonen siden vi ikke skal indikere et "aktivt"
 * pattern her — alle 4 mønstre vises samtidig.
 *
 * Dim/won-state styres via `setWon()` (overstrøket utseende) og
 * `setActive()` (gul ramme rundt currently-pågående pattern), som
 * `Game3PatternRow` kaller fra `update()`.
 */

const GRID_SIZE = 5;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

/** CSS-styles globalt singleton — én injection per dokument. */
function ensureGame3MiniGridStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("g3-mini-grid-styles")) return;
  const s = document.createElement("style");
  s.id = "g3-mini-grid-styles";
  s.textContent = `
.g3-mini-grid {
  display: grid;
  /* Konkret cellestørrelse settes inline (constructor-arg) så fire grids
   * kan tunes uavhengig hvis layout-kravene endrer seg. */
}
.g3-mini-cell {
  border-radius: 1.5px;
  background: rgba(100, 20, 20, 0.4);
  border: 1px solid rgba(255, 80, 80, 0.2);
  box-sizing: border-box;
}
.g3-mini-cell.hit {
  background: linear-gradient(135deg, #f1c40f, #d35400);
  border-color: #ffcc00;
  box-shadow: inset 0 0 2px rgba(255, 255, 255, 0.3), 0 0 3px rgba(255, 150, 0, 0.4);
}
.g3-mini-grid.won .g3-mini-cell.hit {
  /* Vunnet pattern dimmes — overstrøket-stil. Behold gradient men senk
   * mettning og lysstyrke så det er tydelig at fasen er ferdig. */
  background: linear-gradient(135deg, rgba(241, 196, 15, 0.35), rgba(211, 84, 0, 0.35));
  border-color: rgba(255, 204, 0, 0.4);
  box-shadow: none;
}
.g3-mini-grid.won {
  opacity: 0.55;
}
.g3-mini-grid.active .g3-mini-cell.hit {
  /* Aktivt pattern (det som spilles om akkurat nå) — litt sterkere glow
   * så spilleren ser hvor turneringen står. */
  box-shadow: inset 0 0 3px rgba(255, 255, 255, 0.5), 0 0 5px rgba(255, 200, 0, 0.6);
}
`;
  document.head.appendChild(s);
}

export interface Game3PatternMiniGridOptions {
  /** Side-lengde i px per celle. Default 12 — gir 5×12=60px grid + gaps. */
  cellSize?: number;
  /** Gap i px mellom celler. Default 1.5. */
  cellGap?: number;
}

export class Game3PatternMiniGrid {
  readonly root: HTMLDivElement;
  private readonly cells: HTMLDivElement[] = [];
  private won = false;
  private active = false;

  constructor(opts: Game3PatternMiniGridOptions = {}) {
    ensureGame3MiniGridStyles();
    const cellSize = opts.cellSize ?? 12;
    const cellGap = opts.cellGap ?? 1.5;

    this.root = document.createElement("div");
    this.root.className = "g3-mini-grid";
    Object.assign(this.root.style, {
      gridTemplateColumns: `repeat(${GRID_SIZE}, ${cellSize}px)`,
      gridTemplateRows: `repeat(${GRID_SIZE}, ${cellSize}px)`,
      gap: `${cellGap}px`,
      flexShrink: "0",
    });

    for (let i = 0; i < CELL_COUNT; i++) {
      const cell = document.createElement("div");
      cell.className = "g3-mini-cell";
      this.cells.push(cell);
      this.root.appendChild(cell);
    }
  }

  /**
   * Sett mønsteret som skal highlightes.
   *
   * @param mask 25-element bitmask (row-major). 1 = highlight, 0 = empty.
   *             Mottas direkte fra `PatternDefinition.patternDataList` over
   *             socket-snapshot. Kortere arrays tolereres (mangler-celler
   *             treated as 0). Lengre arrays: kun de første 25 brukes.
   *
   * MERK: I MOTSETNING TIL Game1 PatternMiniGrid skipper VI IKKE center
   * (cell 12). Spill 3 har ingen fri sentercelle og DEFAULT_GAME3_CONFIG
   * inkluderer cell 12 i alle 4 mønstre.
   */
  setMask(mask: ReadonlyArray<number>): void {
    for (let i = 0; i < CELL_COUNT; i++) {
      const filled = i < mask.length && mask[i] === 1;
      this.cells[i].classList.toggle("hit", filled);
    }
  }

  /** Marker pattern som vunnet (dim + overstrøket utseende). */
  setWon(won: boolean): void {
    if (this.won === won) return;
    this.won = won;
    this.root.classList.toggle("won", won);
  }

  /** Marker pattern som aktivt (sterkere glow på hit-celler). */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.root.classList.toggle("active", active);
  }

  destroy(): void {
    this.root.remove();
  }
}
