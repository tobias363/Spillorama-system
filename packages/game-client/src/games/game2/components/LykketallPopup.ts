/**
 * Spill 2 — Modal popup for lucky-number-valg.
 *
 * Erstatter tidligere inline lucky-number-grid i ComboPanel per Tobias-direktiv 2026-05-03:
 *
 *   "velg lykketall skal være en popup
 *    med da alle tallene som man kan velge mellom"
 *
 * Layout (matcher BuyPopup-stil for konsistens):
 *   ┌──────────────────────────────────┐ × ← lukke
 *   │       🍀  VELG LYKKETALL          │
 *   │                                   │
 *   │   ┌──┬──┬──┬──┬──┬──┐             │
 *   │   │ 1│ 2│ 3│ 4│ 5│ 6│             │
 *   │   ├──┼──┼──┼──┼──┼──┤             │
 *   │   │ 7│ 8│ 9│10│11│12│             │
 *   │   ├──┼──┼──┼──┼──┼──┤             │
 *   │   │13│14│15│16│17│18│             │
 *   │   ├──┼──┼──┼──┼──┼──┤             │
 *   │   │19│20│21│  │  │  │  ← 3 tomme  │
 *   │   └──┴──┴──┴──┴──┴──┘             │
 *   └──────────────────────────────────┘
 *
 * Spill 2 trekker fra 1-21 → 4×6 grid (24 celler, 3 inaktive).
 * Spilleren tapper en celle → callback fyres → popup lukkes umiddelbart.
 *
 * Bakgrunn-overlay er semi-transparent svart (matcher LuckyNumberPicker
 * og standard modal-mønster). Klikk utenfor panel lukker også popup.
 *
 * Kontrakt:
 *   - `show(currentSelected)` — viser popup, marker evt. allerede valgt tall
 *   - `hide()` — lukker popup
 *   - `setOnPick(cb)` — callback med valgt tall (fyres FØR auto-hide)
 *   - `isVisible()` — for trigger-gating i parent screens
 *
 * 2026-05-03 (Agent Y, branch feat/spill2-lykketall-popup): ny komponent.
 * Tegning av valgt-celle (gull-fyll + grønn dot) følger forrige inline
 * grid-design for visuell konsistens — spilleren skal kjenne seg igjen.
 */

import { Container, Graphics, Sprite, Text, Assets, type Texture } from "pixi.js";
import gsap from "gsap";

const COLS = 6;
const ROWS = 4;
const MAX_NUMBER = 21;
const PANEL_PADDING = 24;
const HEADER_HEIGHT = 56; // clover (40) + label (16)
const CELL_SIZE = 50;
const CELL_GAP = 8;
const CLOVER_SIZE = 40;
const CLOSE_BTN_SIZE = 28;

const CLOVER_URL = "/web/games/assets/game2/design/lucky-clover.png";

interface CellHandle {
  bg: Graphics;
  text: Text | null;
  number: number;
  marker: Graphics;
}

export class LykketallPopup extends Container {
  private overlay: Graphics;
  private panel: Container;
  private cells: CellHandle[] = [];
  private selectedNumber: number | null = null;
  private onPick: ((n: number) => void) | null = null;
  private screenW: number;
  private screenH: number;
  private clover: Sprite | Graphics | null = null;

  constructor(screenWidth: number, screenHeight: number) {
    super();
    this.screenW = screenWidth;
    this.screenH = screenHeight;

    // Beregn panel-dimensjoner basert på grid + header + padding.
    const gridW = COLS * CELL_SIZE + (COLS - 1) * CELL_GAP;
    const gridH = ROWS * CELL_SIZE + (ROWS - 1) * CELL_GAP;
    const panelW = gridW + PANEL_PADDING * 2;
    const panelH = HEADER_HEIGHT + gridH + PANEL_PADDING * 2;

    // ── overlay (klikk utenfor lukker) ────────────────────────────────────
    this.overlay = new Graphics();
    this.overlay.rect(0, 0, screenWidth, screenHeight).fill({ color: 0x000000, alpha: 0.55 });
    this.overlay.eventMode = "static";
    this.overlay.on("pointerdown", () => this.hide());
    this.addChild(this.overlay);

    // ── panel (BuyPopup-stil: mørk-rød med rødt border) ──────────────────
    this.panel = new Container();
    this.panel.x = (screenWidth - panelW) / 2;
    this.panel.y = (screenHeight - panelH) / 2;
    this.panel.eventMode = "static";
    // Stopper klikk i panel fra å nå overlay-en (som ville lukket popup-en).
    this.panel.on("pointerdown", (e) => e.stopPropagation());
    this.addChild(this.panel);

    const panelBg = new Graphics();
    panelBg.roundRect(0, 0, panelW, panelH, 14).fill({ color: 0x2e0000 });
    panelBg.roundRect(0, 0, panelW, panelH, 14).stroke({ color: 0x790001, width: 2 });
    // Topp-highlight (matcher ComboPanel-stil).
    panelBg.roundRect(2, 2, panelW - 4, 2, 1).fill({ color: 0xffffff, alpha: 0.08 });
    this.panel.addChild(panelBg);

    // ── header: kløver + tittel ───────────────────────────────────────────
    void this.loadClover();

    const title = new Text({
      text: "VELG LYKKETALL",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 16,
        fontWeight: "700",
        fill: 0xffe83d,
        letterSpacing: 1.4,
        align: "center",
      },
    });
    title.anchor.set(0.5, 0);
    title.x = panelW / 2;
    title.y = PANEL_PADDING + CLOVER_SIZE - 8;
    this.panel.addChild(title);

    // ── close-knapp øverst-høyre ──────────────────────────────────────────
    const closeBtn = this.createCloseButton();
    closeBtn.x = panelW - CLOSE_BTN_SIZE - 10;
    closeBtn.y = 10;
    this.panel.addChild(closeBtn);

    // ── 4×6 nummer-grid (1-21 + 3 tomme) ──────────────────────────────────
    const gridX = PANEL_PADDING;
    const gridY = HEADER_HEIGHT + PANEL_PADDING;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const num = idx + 1;
        const isEmpty = num > MAX_NUMBER;
        const cell = this.createCell(num, isEmpty);
        cell.bg.x = gridX + col * (CELL_SIZE + CELL_GAP);
        cell.bg.y = gridY + row * (CELL_SIZE + CELL_GAP);
        cell.marker.x = cell.bg.x;
        cell.marker.y = cell.bg.y;
        if (cell.text) {
          cell.text.x = cell.bg.x + CELL_SIZE / 2;
          cell.text.y = cell.bg.y + CELL_SIZE / 2;
        }
        this.cells.push(cell);
      }
    }

    this.visible = false;
  }

  /**
   * Vis popup. Hvis `currentSelected` er ikke-null markeres cellen som valgt
   * så spilleren ser hva som er aktivt.
   */
  show(currentSelected: number | null): void {
    this.selectedNumber = currentSelected;
    this.renderSelection();
    this.visible = true;
    this.panel.alpha = 0;
    this.panel.scale.set(0.9);
    gsap.to(this.panel, { alpha: 1, duration: 0.2 });
    gsap.to(this.panel.scale, { x: 1, y: 1, duration: 0.2, ease: "back.out(1.5)" });
  }

  hide(): void {
    if (!this.visible) return;
    gsap.to(this.panel, {
      alpha: 0,
      duration: 0.15,
      onComplete: () => {
        this.visible = false;
      },
    });
  }

  setOnPick(cb: (n: number) => void): void {
    this.onPick = cb;
  }

  isVisible(): boolean {
    return this.visible;
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
        // Fyr callback FØR hide så parent kan oppdatere combo-panel-tekst
        // umiddelbart — popup-fade kjører parallelt.
        this.onPick?.(num);
        this.hide();
      });
      bg.on("pointerover", () => {
        if (num === this.selectedNumber) return;
        bg.tint = 0xb86060;
      });
      bg.on("pointerout", () => {
        bg.tint = 0xffffff;
      });
    }
    this.panel.addChild(bg);

    let text: Text | null = null;
    if (!isEmpty) {
      text = new Text({
        text: String(num),
        style: {
          fontFamily: "Inter, system-ui, Helvetica, sans-serif",
          fontSize: 18,
          fontWeight: "700",
          fill: 0xeae0d2,
          align: "center",
        },
      });
      text.anchor.set(0.5);
      this.panel.addChild(text);
    }

    const marker = new Graphics();
    marker.visible = false;
    this.panel.addChild(marker);

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
      cell.marker.clear();
      if (isSelected) {
        const cx = CELL_SIZE / 2;
        const cy = CELL_SIZE / 2;
        cell.marker.circle(cx, cy, 8).fill({ color: 0x7dc97a });
        cell.marker.circle(cx - 1.5, cy - 1.5, 3).fill({ color: 0xffffff, alpha: 0.85 });
        cell.marker.circle(cx, cy, 9).stroke({ color: 0x2f7a32, width: 1.5, alpha: 0.7 });
        cell.marker.visible = true;
      } else {
        cell.marker.visible = false;
      }
    }
  }

  private createCloseButton(): Container {
    const btn = new Container();
    const bg = new Graphics();
    bg.circle(CLOSE_BTN_SIZE / 2, CLOSE_BTN_SIZE / 2, CLOSE_BTN_SIZE / 2).fill({
      color: 0x501216,
      alpha: 0.85,
    });
    bg.circle(CLOSE_BTN_SIZE / 2, CLOSE_BTN_SIZE / 2, CLOSE_BTN_SIZE / 2).stroke({
      color: 0xffffff,
      alpha: 0.5,
      width: 1.5,
    });
    btn.addChild(bg);

    const x = new Text({
      text: "×",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 22,
        fontWeight: "700",
        fill: 0xffffff,
        align: "center",
      },
    });
    x.anchor.set(0.5);
    x.x = CLOSE_BTN_SIZE / 2;
    x.y = CLOSE_BTN_SIZE / 2 - 1;
    btn.addChild(x);

    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", () => this.hide());
    return btn;
  }

  private async loadClover(): Promise<void> {
    try {
      const tex = (await Assets.load(CLOVER_URL)) as Texture;
      if (this.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.width = CLOVER_SIZE;
      sprite.height = CLOVER_SIZE;
      sprite.anchor.set(0.5, 0);
      // Plassering: sentrert horisontalt over tittelen.
      const panelW = COLS * CELL_SIZE + (COLS - 1) * CELL_GAP + PANEL_PADDING * 2;
      sprite.x = panelW / 2;
      sprite.y = PANEL_PADDING - 8;
      this.panel.addChild(sprite);
      this.clover = sprite;
    } catch {
      if (this.destroyed) return;
      // Fallback: enkel 4-blads-kløver med Graphics (samme stil som tidligere inline grid).
      const fallback = new Graphics();
      const panelW = COLS * CELL_SIZE + (COLS - 1) * CELL_GAP + PANEL_PADDING * 2;
      fallback.x = panelW / 2;
      fallback.y = PANEL_PADDING - 8 + CLOVER_SIZE / 2;
      const r = CLOVER_SIZE * 0.27;
      fallback.circle(0, -r, r).fill({ color: 0x2f7a32 });
      fallback.circle(r, 0, r).fill({ color: 0x2f7a32 });
      fallback.circle(0, r, r).fill({ color: 0x2f7a32 });
      fallback.circle(-r, 0, r).fill({ color: 0x2f7a32 });
      fallback.circle(0, 0, r * 0.8).fill({ color: 0x4a9a4a });
      this.panel.addChild(fallback);
      this.clover = fallback;
    }
  }
}

function drawCellBg(g: Graphics, selected: boolean, isEmpty: boolean): void {
  g.clear();
  if (isEmpty) {
    g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 8).fill({ color: 0x501216, alpha: 0.2 });
    g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 8).stroke({ color: 0xffffff, alpha: 0.05, width: 1 });
    return;
  }
  if (selected) {
    g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 8).fill({ color: 0xe09a1e });
    g.roundRect(1, 1, CELL_SIZE - 2, CELL_SIZE - 2, 7).fill({ color: 0xf5c849, alpha: 0.85 });
    g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 8).stroke({ color: 0xffffff, alpha: 0.4, width: 1 });
    return;
  }
  g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 8).fill({ color: 0x501216, alpha: 0.55 });
  g.roundRect(0, 0, CELL_SIZE, CELL_SIZE, 8).stroke({ color: 0xffffff, alpha: 0.18, width: 1 });
}
