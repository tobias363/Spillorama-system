import { Container, Graphics, Text } from "pixi.js";
import type { Ticket } from "@spillorama/shared-types/game";
import { BingoGrid, type GridSize } from "../../../components/BingoGrid.js";
import type { BingoCellColors } from "../../../components/BingoCell.js";
import { ONE_TO_GO_COLOR } from "../../game1/colors/TicketColorThemes.js";

export interface TicketCardOptions {
  gridSize?: GridSize;
  cellSize?: number;
  /** Card-level color overrides (Unity TicketColorTheme) */
  cardBg?: number;
  headerBg?: number;
  headerText?: number;
  toGoColor?: number;
  toGoCloseColor?: number;
  /** Cell-level color overrides (Unity TicketColorData) */
  cellColors?: BingoCellColors;
}

/**
 * Ticket card with Unity-matching design: header bar + BingoGrid + to-go counter.
 */
export class TicketCard extends Container {
  readonly grid: BingoGrid;
  private cardBg: Graphics;
  private headerBg: Graphics;
  private headerText: Text;
  private priceText: Text;
  private toGoText: Text;
  private ticket: Ticket | null = null;
  private cardW: number;
  private cardH: number;

  // Default Unity colors (overridable via options)
  private static readonly DEFAULT_CARD_BG = 0xfff2ce;
  private static readonly DEFAULT_HEADER_BG = 0x790001;
  private static readonly DEFAULT_HEADER_TEXT = 0xffe83d;
  private static readonly DEFAULT_TOGO_NORMAL = 0x790001;
  private static readonly DEFAULT_TOGO_CLOSE = 0xe63946;

  private toGoNormalColor: number;
  private toGoCloseColor: number;

  constructor(index: number, options?: TicketCardOptions) {
    super();
    const gridSize = options?.gridSize ?? "3x5";
    const cellSize = options?.cellSize ?? (gridSize === "5x5" ? 36 : 44);

    // Theme colors (from Unity TicketColorTheme or defaults)
    const cardBgColor = options?.cardBg ?? TicketCard.DEFAULT_CARD_BG;
    const headerBgColor = options?.headerBg ?? TicketCard.DEFAULT_HEADER_BG;
    const headerTextColor = options?.headerText ?? TicketCard.DEFAULT_HEADER_TEXT;
    this.toGoNormalColor = options?.toGoColor ?? TicketCard.DEFAULT_TOGO_NORMAL;
    this.toGoCloseColor = options?.toGoCloseColor ?? TicketCard.DEFAULT_TOGO_CLOSE;

    // Grid first to get dimensions
    this.grid = new BingoGrid({ gridSize, cellSize, gap: 2, cellColors: options?.cellColors });
    this.cardW = this.grid.gridWidth + 16;
    const headerH = 28;
    const toGoH = 24;
    this.cardH = headerH + this.grid.gridHeight + toGoH + 20;

    // Card background
    this.cardBg = new Graphics();
    this.cardBg.roundRect(0, 0, this.cardW, this.cardH, 8);
    this.cardBg.fill(cardBgColor);
    this.addChild(this.cardBg);

    // Header bar
    this.headerBg = new Graphics();
    this.headerBg.roundRect(0, 0, this.cardW, headerH, 8);
    this.headerBg.fill(headerBgColor);
    this.addChild(this.headerBg);

    // Header text (ticket number)
    this.headerText = new Text({
      text: `${index + 1}-standard`,
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "bold",
        fill: headerTextColor,
      },
    });
    this.headerText.x = 8;
    this.headerText.y = 5;
    this.addChild(this.headerText);

    // Price text (right side of header)
    this.priceText = new Text({
      text: "20kr",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "bold",
        fill: headerTextColor,
      },
    });
    this.priceText.anchor.set(1, 0);
    this.priceText.x = this.cardW - 8;
    this.priceText.y = 5;
    this.addChild(this.priceText);

    // Grid
    this.grid.x = 8;
    this.grid.y = headerH + 4;
    this.addChild(this.grid);

    // "To go" text
    this.toGoText = new Text({
      text: "",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 14,
        fontWeight: "bold",
        fill: this.toGoNormalColor,
        align: "center",
      },
    });
    this.toGoText.anchor.set(0.5, 0);
    this.toGoText.x = this.cardW / 2;
    this.toGoText.y = headerH + this.grid.gridHeight + 8;
    this.addChild(this.toGoText);
  }

  loadTicket(ticket: Ticket): void {
    this.ticket = ticket;
    this.grid.loadTicket(ticket);
    this.updateToGo();
  }

  markNumber(number: number): boolean {
    const marked = this.grid.markNumber(number);
    if (marked) this.updateToGo();
    return marked;
  }

  markNumbers(numbers: number[]): void {
    this.grid.markNumbers(numbers);
    this.updateToGo();
  }

  getRemainingCount(): number {
    return this.grid.getRemainingCount();
  }

  highlightLuckyNumber(luckyNumber: number): void {
    const cell = this.grid.getCell(luckyNumber);
    if (cell) cell.setHighlight(true);
  }

  reset(): void {
    this.grid.reset();
    this.updateToGo();
  }

  get cardWidth(): number {
    return this.cardW;
  }

  get cardHeight(): number {
    return this.cardH;
  }

  /** Update the header label (e.g. for Elvis variant: "Elvis 1" or Traffic Light colors). */
  setHeaderLabel(label: string): void {
    this.headerText.text = label;
  }

  private updateToGo(): void {
    const remaining = this.grid.getRemainingCount();
    if (remaining === 0) {
      this.toGoText.text = "Ferdig!";
      this.toGoText.style.fill = 0x2a9d8f;
      // Stop any one-to-go blink animations (Unity: Stop_Blink)
      this.grid.stopAllBlinks();
    } else if (remaining === 1) {
      this.toGoText.text = "1 ToGo!";
      this.toGoText.style.fill = this.toGoCloseColor;
      // Blink the remaining unmarked cell with one-to-go color (Unity: Start_NumberBlink + imgCellOneToGo)
      this.grid.blinkCells(this.grid.getUnmarkedNumbers(), ONE_TO_GO_COLOR);
    } else {
      this.toGoText.text = `${remaining} ToGo`;
      this.toGoText.style.fill = remaining <= 3 ? this.toGoCloseColor : this.toGoNormalColor;
    }
  }
}
