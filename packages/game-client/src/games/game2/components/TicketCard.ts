import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";
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
  private cardBgColor: number;

  // Card-level animations (background blink, BINGO pulse)
  private bgBlinkTween: gsap.core.Tween | null = null;
  private bingoTimeline: gsap.core.Timeline | null = null;
  private bingoOverlay: Text | null = null;

  // ── Flip animation state ────────────────────────────────────────────
  private isFlipped = false;
  private isFlipping = false;
  private flipAutoTimer: ReturnType<typeof setTimeout> | null = null;
  private detailsOverlay: Container | null = null;
  private ticketIndex: number;
  private headerTextColor: number;

  constructor(index: number, options?: TicketCardOptions) {
    super();
    this.ticketIndex = index;
    const gridSize = options?.gridSize ?? "3x5";
    const cellSize = options?.cellSize ?? (gridSize === "5x5" ? 36 : 44);

    // Theme colors (from Unity TicketColorTheme or defaults)
    const cardBgColor = options?.cardBg ?? TicketCard.DEFAULT_CARD_BG;
    this.cardBgColor = cardBgColor;
    const headerBgColor = options?.headerBg ?? TicketCard.DEFAULT_HEADER_BG;
    const headerTextColor = options?.headerText ?? TicketCard.DEFAULT_HEADER_TEXT;
    this.headerTextColor = headerTextColor;
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

    // ── Flip interaction (tap/click to show ticket details) ───────────
    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerdown", () => {
      if (this.isFlipping) return;
      if (this.isFlipped) {
        this.flipToGrid();
      } else {
        this.flipToDetails();
      }
    });
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

  /** Set the price display on the card (right side of header bar). */
  setPrice(amount: number): void {
    this.priceText.text = `${amount}kr`;
  }

  /** Stop all card-level animations (background blink, BINGO pulse, flip timer). */
  stopCardAnimations(): void {
    this.stopBgBlink();
    this.stopBingoAnimation();
    if (this.flipAutoTimer !== null) {
      clearTimeout(this.flipAutoTimer);
      this.flipAutoTimer = null;
    }
  }

  // ── Flip animation (Unity: Y-rotation 0→90→0 mapped to scaleX) ─────

  /**
   * Flip the card to show details (ticket number, price, type).
   * GSAP animation: scaleX 1→0 (0.25s), swap content, scaleX 0→1 (0.25s).
   * Auto-flips back after 3.0s.
   */
  flipToDetails(): void {
    if (this.isFlipping || this.isFlipped) return;
    this.isFlipping = true;

    // Build details overlay if it doesn't exist yet
    if (!this.detailsOverlay) {
      this.detailsOverlay = new Container();

      // Background matching the card
      const bg = new Graphics();
      bg.roundRect(0, 0, this.cardW, this.cardH, 8);
      bg.fill(this.cardBgColor);
      this.detailsOverlay.addChild(bg);

      const centerX = this.cardW / 2;
      const centerY = this.cardH / 2;

      // Ticket number
      const numText = new Text({
        text: `Bong #${this.ticketIndex + 1}`,
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 20,
          fontWeight: "bold",
          fill: this.headerTextColor,
          align: "center",
        },
      });
      numText.anchor.set(0.5);
      numText.x = centerX;
      numText.y = centerY - 30;
      this.detailsOverlay.addChild(numText);

      // Price
      const priceInfo = new Text({
        text: this.priceText.text,
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 16,
          fontWeight: "bold",
          fill: 0x2a9d8f,
          align: "center",
        },
      });
      priceInfo.anchor.set(0.5);
      priceInfo.x = centerX;
      priceInfo.y = centerY;
      this.detailsOverlay.addChild(priceInfo);

      // Type/color name (from header text)
      const typeInfo = new Text({
        text: this.headerText.text,
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 14,
          fill: 0xcccccc,
          align: "center",
        },
      });
      typeInfo.anchor.set(0.5);
      typeInfo.x = centerX;
      typeInfo.y = centerY + 28;
      this.detailsOverlay.addChild(typeInfo);

      this.detailsOverlay.visible = false;
      this.addChild(this.detailsOverlay);
    }

    // Update details text to current values
    const detailTexts = this.detailsOverlay.children.filter(
      (c): c is Text => c instanceof Text,
    );
    if (detailTexts.length >= 2) {
      detailTexts[1].text = this.priceText.text;
    }
    if (detailTexts.length >= 3) {
      detailTexts[2].text = this.headerText.text;
    }

    // Animate: scale X to 0, swap, scale X back to 1
    const pivotX = this.cardW / 2;
    this.pivot.x = pivotX;
    this.x += pivotX;

    gsap.to(this.scale, {
      x: 0,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => {
        // Hide front, show back
        this.grid.visible = false;
        this.toGoText.visible = false;
        this.headerBg.visible = false;
        this.headerText.visible = false;
        this.priceText.visible = false;
        this.cardBg.visible = false;
        if (this.detailsOverlay) this.detailsOverlay.visible = true;

        gsap.to(this.scale, {
          x: 1,
          duration: 0.25,
          ease: "power2.out",
          onComplete: () => {
            this.isFlipping = false;
            this.isFlipped = true;

            // Auto-flip back after 3.0s
            this.flipAutoTimer = setTimeout(() => {
              this.flipAutoTimer = null;
              this.flipToGrid();
            }, 3000);
          },
        });
      },
    });
  }

  /**
   * Flip the card back to show the normal grid view.
   */
  flipToGrid(): void {
    if (this.isFlipping || !this.isFlipped) return;
    this.isFlipping = true;

    // Cancel auto-flip timer if still pending
    if (this.flipAutoTimer !== null) {
      clearTimeout(this.flipAutoTimer);
      this.flipAutoTimer = null;
    }

    gsap.to(this.scale, {
      x: 0,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => {
        // Show front, hide back
        this.grid.visible = true;
        this.toGoText.visible = true;
        this.headerBg.visible = true;
        this.headerText.visible = true;
        this.priceText.visible = true;
        this.cardBg.visible = true;
        if (this.detailsOverlay) this.detailsOverlay.visible = false;

        gsap.to(this.scale, {
          x: 1,
          duration: 0.25,
          ease: "power2.out",
          onComplete: () => {
            this.isFlipping = false;
            this.isFlipped = false;
          },
        });
      },
    });
  }

  private updateToGo(): void {
    const remaining = this.grid.getRemainingCount();
    if (remaining === 0) {
      this.toGoText.text = "Ferdig!";
      this.toGoText.style.fill = 0x2a9d8f;
      // Stop any one-to-go blink animations (Unity: Stop_Blink)
      this.grid.stopAllBlinks();
      this.stopBgBlink();
      // Play BINGO celebration animation (Unity: pattern complete pulse)
      this.playBingoAnimation();
    } else if (remaining === 1) {
      this.toGoText.text = "1 ToGo!";
      this.toGoText.style.fill = this.toGoCloseColor;
      // Blink the remaining unmarked cell with one-to-go color (Unity: Start_NumberBlink + imgCellOneToGo)
      this.grid.blinkCells(this.grid.getUnmarkedNumbers(), ONE_TO_GO_COLOR);
      // Blink the entire card background (Unity: Blink_On_1_Color, 0.5s ping-pong)
      this.startBgBlink();
    } else {
      this.toGoText.text = `${remaining} ToGo`;
      this.toGoText.style.fill = remaining <= 3 ? this.toGoCloseColor : this.toGoNormalColor;
      // Stop card-level blinks when no longer 1-to-go
      this.stopBgBlink();
    }
  }

  // ── Card background blink (Unity: Blink_On_1_Color) ──────────────────

  /** Highlight color for 1-to-go background blink (bright gold / yellow). */
  private static readonly BLINK_ON_1_COLOR = 0xffe83d;

  /**
   * Start blinking the card background between its normal color and
   * the highlight color.  Unity: 0.5s per color transition, infinite yoyo.
   */
  private startBgBlink(): void {
    if (this.bgBlinkTween) return; // already blinking

    // GSAP color tween requires an object proxy — we interpolate a 0→1 ratio
    // and redraw the card background each frame.
    const proxy = { t: 0 };
    this.bgBlinkTween = gsap.to(proxy, {
      t: 1,
      duration: 0.5,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
      onUpdate: () => {
        const blended = this.lerpColor(this.cardBgColor, TicketCard.BLINK_ON_1_COLOR, proxy.t);
        this.cardBg.clear();
        this.cardBg.roundRect(0, 0, this.cardW, this.cardH, 8);
        this.cardBg.fill(blended);
      },
    });
  }

  private stopBgBlink(): void {
    if (!this.bgBlinkTween) return;
    this.bgBlinkTween.kill();
    this.bgBlinkTween = null;
    // Restore original card background
    this.cardBg.clear();
    this.cardBg.roundRect(0, 0, this.cardW, this.cardH, 8);
    this.cardBg.fill(this.cardBgColor);
  }

  // ── BINGO pulse animation (Unity: scale 0.85→1.05, 0.25s, 5 reps) ───

  /**
   * Play the BINGO celebration animation when a pattern is completed.
   * Unity: ticket scales 0.85x → 1.05x, 0.25s per phase, 5 repetitions,
   * then a "BINGO!" overlay text appears.
   */
  playBingoAnimation(): void {
    this.stopBingoAnimation();

    // Scale pulse timeline
    this.bingoTimeline = gsap.timeline();
    for (let i = 0; i < 5; i++) {
      this.bingoTimeline
        .to(this.scale, { x: 0.85, y: 0.85, duration: 0.25, ease: "power2.inOut" })
        .to(this.scale, { x: 1.05, y: 1.05, duration: 0.25, ease: "power2.inOut" });
    }
    // Settle back to 1.0 at the end
    this.bingoTimeline.to(this.scale, { x: 1, y: 1, duration: 0.15, ease: "power2.out" });

    // Show "BINGO!" overlay text on the card
    if (!this.bingoOverlay) {
      this.bingoOverlay = new Text({
        text: "BINGO!",
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 28,
          fontWeight: "bold",
          fill: 0xffe83d,
          stroke: { color: 0x790001, width: 3 },
          align: "center",
        },
      });
      this.bingoOverlay.anchor.set(0.5);
      this.bingoOverlay.x = this.cardW / 2;
      this.bingoOverlay.y = this.cardH / 2;
      this.addChild(this.bingoOverlay);
    }
    this.bingoOverlay.visible = true;
    this.bingoOverlay.alpha = 0;
    gsap.to(this.bingoOverlay, { alpha: 1, duration: 0.3, delay: 0.5 });
  }

  private stopBingoAnimation(): void {
    if (this.bingoTimeline) {
      this.bingoTimeline.kill();
      this.bingoTimeline = null;
    }
    gsap.set(this.scale, { x: 1, y: 1 });
    if (this.bingoOverlay) {
      this.bingoOverlay.visible = false;
    }
  }

  // ── Utility ──────────────────────────────────────────────────────────

  /** Linear interpolation between two 0xRRGGBB colors. */
  private lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | bl;
  }
}
