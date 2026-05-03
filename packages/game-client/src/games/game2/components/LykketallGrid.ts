/**
 * Spill 2 Bong Mockup design — 5×5 lykketall-grid med kløver-ikon over.
 *
 * Mockup (`Bong Mockup.html`):
 *   ┌─────────────────────────────┐
 *   │       🍀 (lucky-clover)      │
 *   │     VELG LYKKETALL           │
 *   │   ┌──┬──┬──┬──┬──┐           │
 *   │   │ 1│ 2│ 3│ 4│ 5│  ← gul    │
 *   │   ├──┼──┼──┼──┼──┤    fyll   │
 *   │   │ 6│ 7│●8│ 9│10│  ● = sel.│
 *   │   ├──┼──┼──┼──┼──┤           │
 *   │   │11│12│13│14│15│           │
 *   │   ├──┼──┼──┼──┼──┤           │
 *   │   │16│17│18│19│20│           │
 *   │   ├──┼──┼──┼──┼──┤           │
 *   │   │21│  │  │  │  │  ← tomme  │
 *   │   └──┴──┴──┴──┴──┘    celler │
 *   └─────────────────────────────┘
 *
 * Spill 2 trekker fra 1-21 → vi viser 21 numre i 5×5-grid (4 tomme).
 * Spilleren tapper en celle for å sette lucky number; valgt celle får
 * en grønn dot-overlay (matcher CSS `.lykketall-cell.selected::after`).
 *
 * Kontrakt:
 *   - `setLuckyNumber(n)` markerer celle visuelt (kalles fra
 *     `PlayScreen` etter at server bekrefter via `room:update`).
 *   - `setOnSelect(cb)` setter callback som fyres ved klikk.
 *
 * 2026-05-03 (Agent E, branch feat/spill2-bong-mockup-design): erstatter
 * den modale `LuckyNumberPicker` for in-play-bruk. Modal-pickeren
 * beholdes på LobbyScreen for backward-compat, men flyttes inn i
 * panelet under runde.
 */

import { Container, Graphics, Sprite, Text, Assets, type Texture } from "pixi.js";

const COLS = 5;
const ROWS = 5;
// 2026-05-03 (Agent S, v2): grid-gap krympet 6→4 og panel-bredde 180→160
// per CSS `.lykketall-col { width: 160px; }` i v2-mockup. Kløver-ikon
// krympet fra 56→44 (CSS `.lykketall-clover`).
const CELL_GAP = 4;
const MAX_NUMBER = 21;
const PANEL_WIDTH = 160;
const HEADER_HEIGHT = 60; // clover (44) + label (16)
const CELL_SIZE = (PANEL_WIDTH - CELL_GAP * (COLS - 1)) / COLS;
const CLOVER_SIZE = 44;

const CLOVER_URL = "/web/games/assets/game2/design/lucky-clover.png";

interface CellHandle {
  bg: Graphics;
  text: Text | null;
  number: number; // 0 = empty
  marker: Graphics;
}

export class LykketallGrid extends Container {
  private cells: CellHandle[] = [];
  private selectedNumber: number | null = null;
  private onSelect: ((n: number) => void) | null = null;
  private clover: Sprite | null = null;
  private contentHeight: number;

  constructor() {
    super();

    // ── header: kløver + tittel ───────────────────────────────────────────
    void this.loadClover();

    const title = new Text({
      text: "VELG LYKKETALL",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 11,
        fontWeight: "700",
        fill: 0xeae0d2,
        letterSpacing: 1.2,
        align: "center",
      },
    });
    title.anchor.set(0.5, 0);
    title.x = PANEL_WIDTH / 2;
    title.y = HEADER_HEIGHT - 16;
    this.addChild(title);

    // ── 5×5 grid ──────────────────────────────────────────────────────────
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const num = idx + 1;
        const isEmpty = num > MAX_NUMBER;
        const cell = this.createCell(num, isEmpty);
        cell.bg.x = col * (CELL_SIZE + CELL_GAP);
        cell.bg.y = HEADER_HEIGHT + row * (CELL_SIZE + CELL_GAP);
        cell.marker.x = cell.bg.x;
        cell.marker.y = cell.bg.y;
        if (cell.text) {
          cell.text.x = cell.bg.x + CELL_SIZE / 2;
          cell.text.y = cell.bg.y + CELL_SIZE / 2;
        }
        this.cells.push(cell);
      }
    }

    this.contentHeight = HEADER_HEIGHT + ROWS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  }

  /** Total høyde for layout-beregning i `ComboPanel`. */
  get height(): number {
    return this.contentHeight;
  }

  /** Total bredde — fast 180px per design. */
  get width(): number {
    return PANEL_WIDTH;
  }

  /** Sett valgt lucky number — markerer celle visuelt. */
  setLuckyNumber(n: number | null): void {
    if (this.selectedNumber === n) return;
    this.selectedNumber = n;
    this.renderSelection();
  }

  /** Returnerer nåværende valgte tall. */
  getLuckyNumber(): number | null {
    return this.selectedNumber;
  }

  /** Callback ved klikk på celle. */
  setOnSelect(cb: (n: number) => void): void {
    this.onSelect = cb;
  }

  // ── interne ─────────────────────────────────────────────────────────────

  private createCell(num: number, isEmpty: boolean): CellHandle {
    const bg = new Graphics();
    drawCellBg(bg, false, isEmpty);
    bg.eventMode = isEmpty ? "none" : "static";
    bg.cursor = isEmpty ? "default" : "pointer";
    if (!isEmpty) {
      bg.on("pointerdown", () => {
        this.selectedNumber = num;
        this.renderSelection();
        this.onSelect?.(num);
      });
      bg.on("pointerover", () => {
        if (num === this.selectedNumber) return;
        bg.tint = 0xb86060;
      });
      bg.on("pointerout", () => {
        bg.tint = 0xffffff;
      });
    }
    this.addChild(bg);

    let text: Text | null = null;
    if (!isEmpty) {
      text = new Text({
        text: String(num),
        style: {
          fontFamily: "Inter, system-ui, Helvetica, sans-serif",
          fontSize: 13,
          fontWeight: "600",
          fill: 0xeae0d2,
          align: "center",
        },
      });
      text.anchor.set(0.5);
      this.addChild(text);
    }

    const marker = new Graphics();
    marker.visible = false;
    this.addChild(marker);

    return { bg, text, marker, number: num };
  }

  private renderSelection(): void {
    for (const cell of this.cells) {
      const isEmpty = cell.number > MAX_NUMBER;
      if (isEmpty) continue;
      const isSelected = cell.number === this.selectedNumber;
      drawCellBg(cell.bg, isSelected, false);
      if (cell.text) {
        cell.text.style.fill = isSelected ? 0x2b1a05 : 0xeae0d2;
      }
      // Grønn dot (selected::after) — vises bare på valgt celle.
      cell.marker.clear();
      if (isSelected) {
        const cx = CELL_SIZE / 2;
        const cy = CELL_SIZE / 2;
        cell.marker.circle(cx, cy, 7).fill({ color: 0x7dc97a });
        cell.marker.circle(cx - 1.5, cy - 1.5, 3).fill({ color: 0xffffff, alpha: 0.85 });
        cell.marker.circle(cx, cy, 8).stroke({ color: 0x2f7a32, width: 1.5, alpha: 0.7 });
        cell.marker.visible = true;
      } else {
        cell.marker.visible = false;
      }
    }
  }

  private async loadClover(): Promise<void> {
    try {
      const tex = (await Assets.load(CLOVER_URL)) as Texture;
      if (this.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.width = CLOVER_SIZE;
      sprite.height = CLOVER_SIZE;
      sprite.anchor.set(0.5, 0);
      sprite.x = PANEL_WIDTH / 2;
      sprite.y = 0;
      this.addChildAt(sprite, 0);
      this.clover = sprite;
    } catch {
      // Asset mangler — vi tegner en fallback-kløver med Graphics.
      if (this.destroyed) return;
      const fallback = new Graphics();
      fallback.x = PANEL_WIDTH / 2;
      fallback.y = CLOVER_SIZE / 2;
      // Enkel 4-blads-kløver: 4 sirkler + en sentrum-disk.
      const r = CLOVER_SIZE * 0.27;
      fallback.circle(0, -r, r).fill({ color: 0x2f7a32 });
      fallback.circle(r, 0, r).fill({ color: 0x2f7a32 });
      fallback.circle(0, r, r).fill({ color: 0x2f7a32 });
      fallback.circle(-r, 0, r).fill({ color: 0x2f7a32 });
      fallback.circle(0, 0, r * 0.8).fill({ color: 0x4a9a4a });
      this.addChildAt(fallback, 0);
    }
  }
}

function drawCellBg(g: Graphics, selected: boolean, isEmpty: boolean): void {
  g.clear();
  if (isEmpty) {
    g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 6).fill({ color: 0x501216, alpha: 0.25 });
    g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 6).stroke({ color: 0xffffff, alpha: 0.05, width: 1 });
    return;
  }
  if (selected) {
    // Gull-fyll (matcher `.filled`).
    g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 6).fill({ color: 0xe09a1e });
    g.roundRect(1, 1, CELL_SIZE - 2, CELL_SIZE - 2, 5).fill({ color: 0xf5c849, alpha: 0.85 });
    g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 6).stroke({ color: 0xffffff, alpha: 0.4, width: 1 });
    return;
  }
  g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 6).fill({ color: 0x501216, alpha: 0.55 });
  g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 6).stroke({ color: 0xffffff, alpha: 0.12, width: 1 });
}
