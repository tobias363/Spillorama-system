/**
 * Spill 2 Bong Mockup design — beige bong-kort med 3×3 tall-grid.
 *
 * Mockup-paritet med `bong.jsx` `Bong`-komponenten:
 *   - Beige base (`#dcc596`) med rounded 8px corners
 *   - Header: "Small Yellow" venstre, "20 kr" høyre, mørk tekst
 *   - 3×3 grid med tall (Inter 700/22px)
 *     · Umarkert celle: lys-hvit semi-transparent fyll, mørk tekst
 *     · Markert celle:  mørk-rød fyll (#7a1a1a) med hvit tekst
 *     · "FREE"-celle (sentrum): grønn (#2d7a3f) med hvit tekst
 *       → MERK: Spill 2 backend leverer 9 numre per ticket
 *         (ikke FREE i sentrum). Vi viser FREE bare hvis ticket-grid
 *         eksplisitt har "FREE" i sentrum, ellers rendres alle 9 tall.
 *         Se `loadTicket` for håndtering.
 *   - Footer: "X igjen" eller "ONE TO GO!" når 1 igjen
 *
 * Vi rendrer 3×3 direkte (uten å gjenbruke `BingoGrid`) fordi:
 *   - BingoGrid har egne tema-presumtions (gult highlight, lucky number
 *     osv.) som ikke matcher bong-stilen.
 *   - Vi vil at FREE-cellen kun vises betinget (Spill 2 har faktisk 9
 *     numre, ikke 8 + FREE).
 *   - Mark-animasjonen i bong-stilen er en farge-flip (ikke en sirkel-
 *     overlay som BingoCell), så det er enklere å eie sin egen celle.
 *
 * Backend-data:
 *   - `Ticket.grid`: number[][] — for Spill 2: 3×3 med 9 unike tall i
 *     [1,21]. Vi flat'er til 9-element-array og rendrer celle-for-celle.
 *
 * Kontrakt:
 *   - `loadTicket(ticket, marks)` — sett opp grid + initial-marks.
 *   - `markNumber(n)` — markér én celle (fra `numberDrawn`-event).
 *   - `getRemainingCount()` — antall umarkerte celler (for "X igjen").
 *
 * 2026-05-03 (Agent E, branch feat/spill2-bong-mockup-design): erstatter
 * den eksisterende `TicketCard`-bruken i Spill 2's PlayScreen for å
 * matche Bong Mockup-design. `TicketCard` beholdes uendret — den
 * brukes fortsatt på `ChooseTicketsScreen` og av tester.
 */

import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";
import type { Ticket } from "@spillorama/shared-types/game";

/** Bong-fargevariant — samsvarer med `BONG_COLORS` i bong.jsx. */
export type BongColorKey = "yellow" | "purple" | "green" | "white" | "red" | "orange" | "blue";

interface BongTheme {
  bg: number;
  text: number;
  header: number;
  footer: number;
}

const BONG_COLORS: Record<BongColorKey, BongTheme> = {
  yellow: { bg: 0xdcc596, text: 0x2a1a00, header: 0x2a1a00, footer: 0x3a2400 },
  purple: { bg: 0xc8bcc4, text: 0x2a1040, header: 0x2a1040, footer: 0x2a1040 },
  green:  { bg: 0xbbc4ae, text: 0x0f3a10, header: 0x0f3a10, footer: 0x0f3a10 },
  white:  { bg: 0xe8dcc4, text: 0x2a2420, header: 0x2a2420, footer: 0x2a2420 },
  red:    { bg: 0xc89088, text: 0x3a1010, header: 0x3a1010, footer: 0x3a1010 },
  orange: { bg: 0xd4b394, text: 0x2a1400, header: 0x2a1400, footer: 0x2a1400 },
  blue:   { bg: 0xb4bcc4, text: 0x0a1f40, header: 0x0a1f40, footer: 0x0a1f40 },
};

const MARKED_BG = 0x7a1a1a;
const MARKED_TEXT = 0xffffff;
const FREE_BG = 0x2d7a3f;
const FREE_TEXT = 0xffffff;
const CELL_BG = 0xffffff;
const CELL_BG_ALPHA = 0.55;

const CARD_PADDING_X = 14;
const CARD_PADDING_TOP = 12;
const CARD_PADDING_BOTTOM = 10;
const CELL_GAP = 6;
const HEADER_HEIGHT = 20;
const HEADER_GAP = 10;
const FOOTER_HEIGHT = 18;
const FOOTER_GAP = 10;

export interface BongCardOptions {
  /** Visuell fargevariant. Default `yellow` (matcher Spill 2 default). */
  colorKey?: BongColorKey;
  /** Header-label, f.eks. "Small Yellow" eller en bong-ID. */
  label?: string;
  /** Pris i kroner. Default 20. */
  price?: number;
  /** Bredde i pixels. Default 240 (matcher mockup). */
  width?: number;
}

interface CellHandle {
  bg: Graphics;
  text: Text;
  number: number; // 0 = FREE
  marked: boolean;
  isFree: boolean;
}

export class BongCard extends Container {
  private bg: Graphics;
  private headerLabel: Text;
  private headerPrice: Text;
  private footerText: Text;
  private cells: CellHandle[] = [];
  private cellByNumber: Map<number, CellHandle> = new Map();
  private theme: BongTheme;
  private cardW: number;
  private cardH: number;
  private cellSize: number;
  private gridStartY: number;
  private ticket: Ticket | null = null;
  private oneToGoTween: gsap.core.Tween | null = null;
  private bingoOverlay: Text | null = null;

  constructor(options: BongCardOptions = {}) {
    super();
    this.theme = BONG_COLORS[options.colorKey ?? "yellow"];
    this.cardW = options.width ?? 240;
    const innerW = this.cardW - CARD_PADDING_X * 2;
    this.cellSize = (innerW - CELL_GAP * 2) / 3;
    this.gridStartY = CARD_PADDING_TOP + HEADER_HEIGHT + HEADER_GAP;
    const gridH = 3 * this.cellSize + CELL_GAP * 2;
    this.cardH = this.gridStartY + gridH + FOOTER_GAP + FOOTER_HEIGHT + CARD_PADDING_BOTTOM;

    // ── card background ──────────────────────────────────────────────────
    this.bg = new Graphics();
    this.bg.roundRect(0, 0, this.cardW, this.cardH, 8).fill({ color: this.theme.bg });
    // Subtle drop-shadow simulation: indre lett skygge nederst.
    this.bg.roundRect(2, this.cardH - 4, this.cardW - 4, 4, 4).fill({ color: 0x000000, alpha: 0.06 });
    this.addChild(this.bg);

    // ── header ───────────────────────────────────────────────────────────
    this.headerLabel = new Text({
      text: options.label ?? "Small Yellow",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "700",
        fill: this.theme.header,
        align: "left",
      },
    });
    this.headerLabel.anchor.set(0, 0);
    this.headerLabel.x = CARD_PADDING_X;
    this.headerLabel.y = CARD_PADDING_TOP;
    this.addChild(this.headerLabel);

    this.headerPrice = new Text({
      text: `${options.price ?? 20} kr`,
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 12,
        fontWeight: "600",
        fill: this.theme.header,
        align: "right",
      },
    });
    this.headerPrice.anchor.set(1, 0);
    this.headerPrice.x = this.cardW - CARD_PADDING_X;
    this.headerPrice.y = CARD_PADDING_TOP + 1;
    this.addChild(this.headerPrice);

    // ── footer ───────────────────────────────────────────────────────────
    this.footerText = new Text({
      text: "",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 11,
        fontWeight: "500",
        fill: this.theme.footer,
        align: "center",
      },
    });
    this.footerText.anchor.set(0.5, 0);
    this.footerText.x = this.cardW / 2;
    this.footerText.y = this.cardH - CARD_PADDING_BOTTOM - FOOTER_HEIGHT + 2;
    this.footerText.alpha = 0.75;
    this.addChild(this.footerText);
  }

  /** Total kort-bredde — for layout-beregning. */
  get cardWidth(): number {
    return this.cardW;
  }

  /** Total kort-høyde — for layout-beregning. */
  get cardHeight(): number {
    return this.cardH;
  }

  /**
   * Last data fra et ticket. Backend leverer `Ticket.grid` som
   * `number[][]` (3×3 = 9 numre for Spill 2). `marks` kan inneholde
   * tall som allerede skal være markert (snapshot-restore).
   *
   * Hvis grid-cellen i sentrum (1,1) er `0` tolkes det som FREE.
   * Backend sender ikke FREE i Spill 2 (alle 9 celler er numre), men
   * vi støtter det fall designet senere bytter til FREE-modus.
   */
  loadTicket(ticket: Ticket, marks: number[] = []): void {
    this.ticket = ticket;
    this.clearCells();

    // Flat'er ut til en 9-element array. Hvis det kommer en 3×5-grid
    // (en eldre runde) tar vi første 3 verdier per rad.
    const flat: number[] = [];
    for (let row = 0; row < 3; row++) {
      const r = ticket.grid[row] ?? [];
      for (let col = 0; col < 3; col++) {
        flat.push(r[col] ?? 0);
      }
    }
    if (flat.length !== 9) return;

    const markedSet = new Set(marks);
    for (let i = 0; i < 9; i++) {
      const num = flat[i];
      const row = Math.floor(i / 3);
      const col = i % 3;
      const x = CARD_PADDING_X + col * (this.cellSize + CELL_GAP);
      const y = this.gridStartY + row * (this.cellSize + CELL_GAP);
      const isFree = num === 0;
      const cell = this.createCell(num, isFree, x, y);
      if (markedSet.has(num) && !isFree) {
        cell.marked = true;
      }
      this.drawCell(cell);
      this.cells.push(cell);
      if (!isFree) {
        this.cellByNumber.set(num, cell);
      }
    }
    this.updateFooter();
  }

  /** Markér én celle. Returnerer `true` hvis cellen ble markert. */
  markNumber(n: number): boolean {
    const cell = this.cellByNumber.get(n);
    if (!cell || cell.marked) return false;
    cell.marked = true;
    this.drawCell(cell);
    // Liten pop-animasjon på selve teksten.
    gsap.fromTo(
      cell.text.scale,
      { x: 1.0, y: 1.0 },
      { x: 1.18, y: 1.18, duration: 0.10, yoyo: true, repeat: 1, ease: "power2.out" },
    );
    this.updateFooter();
    return true;
  }

  /** Markér flere celler (snapshot-restore). */
  markNumbers(numbers: number[]): void {
    let any = false;
    for (const n of numbers) {
      const cell = this.cellByNumber.get(n);
      if (!cell || cell.marked) continue;
      cell.marked = true;
      this.drawCell(cell);
      any = true;
    }
    if (any) this.updateFooter();
  }

  getRemainingCount(): number {
    let c = 0;
    for (const cell of this.cells) {
      if (!cell.isFree && !cell.marked) c += 1;
    }
    return c;
  }

  /** Oppdater header-label dynamisk (f.eks. fra socket-event). */
  setHeaderLabel(label: string): void {
    this.headerLabel.text = label;
  }

  /** Oppdater pris (kr). */
  setPrice(amount: number): void {
    this.headerPrice.text = `${amount} kr`;
  }

  /** Stopp alle aktive animasjoner — kalles ved game-end. */
  stopAllAnimations(): void {
    if (this.oneToGoTween) {
      this.oneToGoTween.kill();
      this.oneToGoTween = null;
    }
    for (const cell of this.cells) {
      gsap.killTweensOf(cell.text.scale);
      cell.text.scale.set(1, 1);
    }
    if (this.bingoOverlay) {
      gsap.killTweensOf(this.bingoOverlay);
      this.bingoOverlay.alpha = 1;
    }
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.stopAllAnimations();
    super.destroy(options);
  }

  // ── interne helpers ─────────────────────────────────────────────────────

  private createCell(num: number, isFree: boolean, x: number, y: number): CellHandle {
    const bg = new Graphics();
    bg.x = x;
    bg.y = y;
    this.addChild(bg);

    const text = new Text({
      text: isFree ? "FREE" : String(num),
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: isFree ? 14 : 22,
        fontWeight: "700",
        fill: isFree ? FREE_TEXT : this.theme.text,
        align: "center",
        letterSpacing: isFree ? 0.5 : -0.2,
      },
    });
    text.anchor.set(0.5);
    text.x = x + this.cellSize / 2;
    text.y = y + this.cellSize / 2;
    this.addChild(text);

    return { bg, text, number: num, marked: isFree, isFree };
  }

  private drawCell(cell: CellHandle): void {
    cell.bg.clear();
    if (cell.isFree) {
      // Outer light frame matching `.bong-cell` then inner FREE pill.
      cell.bg.roundRect(0, 0, this.cellSize, this.cellSize, 3).fill({ color: CELL_BG, alpha: CELL_BG_ALPHA });
      const pillW = this.cellSize * 0.82;
      const pillH = this.cellSize * 0.70;
      const pillX = (this.cellSize - pillW) / 2;
      const pillY = (this.cellSize - pillH) / 2;
      cell.bg.roundRect(pillX, pillY, pillW, pillH, 3).fill({ color: FREE_BG });
      return;
    }
    if (cell.marked) {
      cell.bg.roundRect(0, 0, this.cellSize, this.cellSize, 4).fill({ color: MARKED_BG });
      cell.text.style.fill = MARKED_TEXT;
      return;
    }
    cell.bg.roundRect(0, 0, this.cellSize, this.cellSize, 4).fill({ color: CELL_BG, alpha: CELL_BG_ALPHA });
    cell.text.style.fill = this.theme.text;
  }

  private clearCells(): void {
    for (const cell of this.cells) {
      gsap.killTweensOf(cell.text.scale);
      cell.bg.destroy();
      cell.text.destroy();
    }
    this.cells = [];
    this.cellByNumber.clear();
    if (this.oneToGoTween) {
      this.oneToGoTween.kill();
      this.oneToGoTween = null;
    }
  }

  private updateFooter(): void {
    const remaining = this.getRemainingCount();
    if (remaining === 0) {
      this.footerText.text = "BINGO!";
      this.footerText.style.letterSpacing = 1.2;
      this.footerText.style.fontWeight = "800";
      this.footerText.style.fill = 0x2d7a3f;
      this.footerText.alpha = 1;
      this.stopOneToGoTween();
      this.playBingoFlourish();
      return;
    }
    if (remaining === 1) {
      this.footerText.text = "ONE TO GO!";
      this.footerText.style.letterSpacing = 1.2;
      this.footerText.style.fontWeight = "700";
      this.footerText.style.fill = this.theme.footer;
      this.footerText.alpha = 1;
      this.startOneToGoTween();
      return;
    }
    this.footerText.text = `${remaining} igjen`;
    this.footerText.style.letterSpacing = 0;
    this.footerText.style.fontWeight = "500";
    this.footerText.style.fill = this.theme.footer;
    this.footerText.alpha = 0.75;
    this.stopOneToGoTween();
  }

  private startOneToGoTween(): void {
    if (this.oneToGoTween) return;
    this.oneToGoTween = gsap.to(this.footerText, {
      alpha: 0.7,
      duration: 0.65,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
    });
  }

  private stopOneToGoTween(): void {
    if (this.oneToGoTween) {
      this.oneToGoTween.kill();
      this.oneToGoTween = null;
      this.footerText.alpha = 1;
    }
  }

  private playBingoFlourish(): void {
    if (!this.bingoOverlay) {
      this.bingoOverlay = new Text({
        text: "BINGO!",
        style: {
          fontFamily: "Inter, system-ui, Helvetica, sans-serif",
          fontSize: 28,
          fontWeight: "800",
          fill: 0xffe83d,
          stroke: { color: 0x7a1a1a, width: 3 },
          align: "center",
        },
      });
      this.bingoOverlay.anchor.set(0.5);
      this.bingoOverlay.x = this.cardW / 2;
      this.bingoOverlay.y = this.cardH / 2;
      this.addChild(this.bingoOverlay);
    }
    this.bingoOverlay.alpha = 0;
    this.bingoOverlay.scale.set(0.6);
    gsap.to(this.bingoOverlay, { alpha: 1, duration: 0.20, ease: "power2.out" });
    gsap.to(this.bingoOverlay.scale, {
      x: 1.0,
      y: 1.0,
      duration: 0.40,
      ease: "back.out(1.8)",
    });
  }
}
