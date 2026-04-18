import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

/**
 * Color theme for a bingo cell — matches Unity's TicketColorData.
 * Each ticket can have its own theme (7 themes available in Unity).
 */
export interface BingoCellColors {
  bgDefault: number;       // Grid cell background
  bgFree: number;          // Free/lucky number background
  bgHighlight: number;     // Highlighted cell background
  markerColor: number;     // Marked number circle fill
  textDefault: number;     // Normal number text
  textMarked: number;      // Marked number text
  textFree: number;        // Free/lucky number text
  borderColor: number;     // Cell border
}

export interface BingoCellOptions {
  size: number;
  number: number;
  isFreeSpace?: boolean;
  colors?: BingoCellColors;
}

/**
 * A single cell in a bingo grid.
 * Visual design matches Unity Spillorama: cream/tan cells with maroon markers.
 */
export class BingoCell extends Container {
  readonly cellNumber: number;
  private bg: Graphics;
  private marker: Graphics;
  private numberText: Text;
  private marked = false;
  private blinking = false;
  private highlighted = false;
  private blinkTimeline: gsap.core.Timeline | null = null;
  private size: number;
  private isFreeSpace: boolean;

  // Default Unity color palette (can be overridden per-cell via options.colors)
  static readonly DEFAULT_COLORS: BingoCellColors = {
    bgDefault: 0xffd6a7,    // Peachy tan (#FFD6A7)
    bgFree: 0xffe83d,       // Bright yellow
    bgHighlight: 0xffe83d,  // Yellow highlight
    markerColor: 0x7e001b,  // Deep maroon marker (#7E001B)
    textDefault: 0x1a0a0a,  // Near black
    textMarked: 0xffd6a7,   // Tan (matches cell bg for contrast)
    textFree: 0x790001,     // Dark maroon
    borderColor: 0xd4a574,  // Subtle border
  };

  private colors: BingoCellColors;

  constructor(options: BingoCellOptions) {
    super();
    this.cellNumber = options.number;
    this.size = options.size;
    this.isFreeSpace = options.isFreeSpace ?? false;
    this.colors = options.colors ?? BingoCell.DEFAULT_COLORS;

    // Cell background
    this.bg = new Graphics();
    this.drawBg(this.isFreeSpace ? this.colors.bgFree : this.colors.bgDefault);
    this.addChild(this.bg);

    // Marker circle (hidden until marked)
    this.marker = new Graphics();
    this.marker.visible = false;
    this.addChild(this.marker);

    // Number text
    const fontSize = Math.floor(this.size * 0.42);
    this.numberText = new Text({
      text: this.isFreeSpace ? "F" : String(options.number),
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize,
        fill: this.isFreeSpace ? this.colors.textFree : this.colors.textDefault,
        fontWeight: "bold",
        align: "center",
      },
    });
    this.numberText.anchor.set(0.5);
    this.numberText.x = this.size / 2;
    this.numberText.y = this.size / 2;
    this.addChild(this.numberText);

    if (this.isFreeSpace) {
      this.marked = true;
    }

    this.eventMode = "static";
    this.cursor = "pointer";
  }

  isMarked(): boolean {
    return this.marked;
  }

  mark(): void {
    if (this.marked) return;
    this.marked = true;
    this.showMarker();
    this.stopBlink();

    gsap.to(this.scale, {
      x: 1.12,
      y: 1.12,
      duration: 0.12,
      yoyo: true,
      repeat: 1,
      ease: "power2.out",
    });
  }

  unmark(): void {
    if (!this.marked || this.isFreeSpace) return;
    this.marked = false;
    this.hideMarker();
    this.stopBlink();
  }

  /**
   * Start one-to-go blink animation.
   * Matches Unity BingoTicketSingleCellData.Start_NumberBlink() (legacy/unity-client/
   * Assets/_Project/_Scripts/Prefabs/Bingo Tickets/BingoTicketSingleCellData.cs:212):
   *   LeanTween.scale(txtNumber, Vector3(1.5f,1.5f), 1.0f)
   *     .setEase(LeanTweenType.punch).setLoopCount(-1)
   *
   * LeanTween's "punch" ease is a one-shot swing that ends back at the
   * starting value (scale 1.0), not a ping-pong — so `yoyo` is WRONG here.
   * We emulate punch with a 1.0s GSAP tween that ends with `gsap.set` back
   * to scale 1.0 (mirroring Unity Stop_NumberBlink, which resets localScale
   * to Vector2.one at line :201), then repeat the timeline infinitely.
   *
   * Optional background color highlight: Unity imgCellOneToGo.Open().
   */
  startBlink(oneToGoColor?: number): void {
    if (this.blinking || this.marked) return;
    this.blinking = true;
    // Highlight cell background with one-to-go color (Unity: imgCellOneToGo)
    if (oneToGoColor !== undefined) {
      this.drawBg(oneToGoColor);
    }
    // Build a looping timeline: scale → 1.5 with elastic overshoot (punch-like),
    // then snap back to 1.0 and repeat. 1.0s per iteration (Unity match).
    this.blinkTimeline = gsap.timeline({ repeat: -1 });
    this.blinkTimeline.to(this.scale, {
      x: 1.5,
      y: 1.5,
      duration: 1.0,
      ease: "elastic.out(1, 0.3)",
    });
    this.blinkTimeline.call(() => {
      // Reset to 1.0 at the end of each punch (Unity Stop_NumberBlink:201).
      gsap.set(this.scale, { x: 1, y: 1 });
    });
  }

  stopBlink(): void {
    if (!this.blinking) return;
    this.blinking = false;
    if (this.blinkTimeline) {
      this.blinkTimeline.kill();
      this.blinkTimeline = null;
    }
    // Unity Stop_NumberBlink: txtNumber.transform.localScale = Vector2.one
    // (BingoTicketSingleCellData.cs:201). Hard reset, no animation.
    gsap.set(this.scale, { x: 1, y: 1 });
  }

  setHighlight(on: boolean): void {
    this.highlighted = on;
    if (on) {
      this.drawBg(this.colors.bgHighlight);
      this.numberText.style.fill = this.colors.textFree;
    } else if (this.marked) {
      this.showMarker();
    } else {
      this.drawBg(this.colors.bgDefault);
      this.numberText.style.fill = this.colors.textDefault;
    }
  }

  reset(): void {
    this.stopBlink();
    this.highlighted = false;
    if (!this.isFreeSpace) {
      this.marked = false;
      this.hideMarker();
      this.drawBg(this.colors.bgDefault);
      this.numberText.style.fill = this.colors.textDefault;
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  private drawBg(color: number): void {
    this.bg.clear();
    // Outer border
    this.bg.roundRect(0, 0, this.size, this.size, 4);
    this.bg.fill(this.colors.borderColor);
    // Inner fill
    this.bg.roundRect(1, 1, this.size - 2, this.size - 2, 3);
    this.bg.fill(color);
  }

  private showMarker(): void {
    const radius = (this.size - 6) / 2;
    this.marker.clear();
    this.marker.circle(this.size / 2, this.size / 2, radius);
    this.marker.fill(this.colors.markerColor);
    this.marker.visible = true;
    this.numberText.style.fill = this.colors.textMarked;
  }

  private hideMarker(): void {
    this.marker.visible = false;
    this.marker.clear();
    this.numberText.style.fill = this.colors.textDefault;
  }
}
