import { Container, Graphics, Text } from "pixi.js";
import type { TicketCard } from "../../game2/components/TicketCard.js";

/**
 * Vertical grid scroller for Game 1 tickets.
 *
 * Matches Unity's GridLayoutGroup layout:
 * - cellSize: 250×250 (Unity units → scaled to web pixels)
 * - spacing: 10×10
 * - startAxis: Horizontal (fills left→right, wraps down)
 * - ScrollRect: vertical only
 *
 * Replaces the horizontal TicketScroller from Game 2.
 *
 * Scroll input:
 * - Drag anywhere in viewport (PixiJS pointer events on this container)
 * - Mouse wheel: native DOM listener on window so it works even when
 *   the cursor is over interactive child elements (BingoCells, etc.)
 */
export class TicketGridScroller extends Container {
  private innerContainer: Container;
  private maskGraphics: Graphics;
  private cards: TicketCard[] = [];
  private viewportWidth: number;
  private viewportHeight: number;
  private readonly gap = 8;

  // Scroll indicator shown when content overflows below
  private scrollIndicator: Container;

  // Drag-to-scroll state
  private isDragging = false;
  private dragStartY = 0;
  private scrollStartY = 0;

  // Native wheel handler — stored for removal on destroy
  private readonly _wheelHandler: (e: WheelEvent) => void;

  constructor(viewportWidth: number, viewportHeight: number) {
    super();
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;

    this.innerContainer = new Container();
    this.addChild(this.innerContainer);

    // Clipping mask
    this.maskGraphics = new Graphics();
    this.maskGraphics.rect(0, 0, viewportWidth, viewportHeight);
    this.maskGraphics.fill(0xffffff);
    this.addChild(this.maskGraphics);
    this.innerContainer.mask = this.maskGraphics;

    // Scroll indicator (arrow + fade at bottom, only visible when more content is below)
    this.scrollIndicator = this.buildScrollIndicator(viewportWidth, viewportHeight);
    this.addChild(this.scrollIndicator);
    this.scrollIndicator.visible = false;

    // Pointer events for vertical drag-scroll
    this.eventMode = "static";
    this.hitArea = {
      contains: (x: number, y: number) =>
        x >= 0 && x <= viewportWidth && y >= 0 && y <= viewportHeight,
    };

    this.on("pointerdown", (e) => {
      this.isDragging = true;
      this.dragStartY = e.global.y;
      this.scrollStartY = this.innerContainer.y;
    });
    this.on("pointermove", (e) => {
      if (!this.isDragging) return;
      const dy = e.global.y - this.dragStartY;
      this.innerContainer.y = this.scrollStartY + dy;
      this.clampScroll();
    });
    this.on("pointerup", () => { this.isDragging = false; });
    this.on("pointerupoutside", () => { this.isDragging = false; });

    // Native DOM wheel event — fires even when cursor is over interactive PixiJS children
    // (PixiJS's own "wheel" event doesn't propagate through children with eventMode="static")
    this._wheelHandler = (e: WheelEvent) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();

      // Convert screen coords → PixiJS logical coords.
      // canvas.width = physical pixels; PixiJS logical = canvas.width / devicePixelRatio.
      // The canvas CSS size (rect.width) corresponds to PixiJS logical width.
      const scaleX = (canvas.width / window.devicePixelRatio) / rect.width;
      const scaleY = (canvas.height / window.devicePixelRatio) / rect.height;
      const pixiX = (e.clientX - rect.left) * scaleX;
      const pixiY = (e.clientY - rect.top) * scaleY;

      // Check if cursor is within this scroller's global (stage) bounds
      const globalOrigin = this.toGlobal({ x: 0, y: 0 });
      const withinX = pixiX >= globalOrigin.x && pixiX <= globalOrigin.x + this.viewportWidth;
      const withinY = pixiY >= globalOrigin.y && pixiY <= globalOrigin.y + this.viewportHeight;

      if (withinX && withinY) {
        e.preventDefault();
        this.innerContainer.y -= e.deltaY * 0.5;
        this.clampScroll();
      }
    };
    window.addEventListener("wheel", this._wheelHandler, { passive: false });
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    window.removeEventListener("wheel", this._wheelHandler);
    super.destroy(options);
  }

  addCard(card: TicketCard): void {
    this.cards.push(card);
    this.innerContainer.addChild(card);
    this.layoutCards();
    this.clampScroll();
  }

  clearCards(): void {
    for (const card of this.cards) card.destroy({ children: true });
    this.cards = [];
    this.innerContainer.removeChildren();
    this.innerContainer.y = 0;
    this.scrollIndicator.visible = false;
  }

  getCards(): TicketCard[] {
    return [...this.cards];
  }

  markNumberOnAll(number: number): void {
    for (const card of this.cards) card.markNumber(number);
  }

  /** Sort cards best-first (fewest remaining cells at top). */
  sortBestFirst(): void {
    this.cards.sort((a, b) => a.getRemainingCount() - b.getRemainingCount());
    this.innerContainer.removeChildren();
    for (const card of this.cards) this.innerContainer.addChild(card);
    this.layoutCards();
  }

  setViewportSize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;

    this.maskGraphics.clear();
    this.maskGraphics.rect(0, 0, width, height);
    this.maskGraphics.fill(0xffffff);

    this.hitArea = {
      contains: (x: number, y: number) =>
        x >= 0 && x <= width && y >= 0 && y <= height,
    };

    // Rebuild scroll indicator at new size
    this.scrollIndicator.destroy({ children: true });
    this.scrollIndicator = this.buildScrollIndicator(width, height);
    this.addChild(this.scrollIndicator);

    this.layoutCards();
    this.clampScroll();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private layoutCards(): void {
    if (this.cards.length === 0) return;

    const cardW = this.cards[0]?.cardWidth ?? 220;
    const cardH = this.cards[0]?.cardHeight ?? 280;
    const cols = Math.max(1, Math.floor((this.viewportWidth + this.gap) / (cardW + this.gap)));
    const totalRowWidth = cols * cardW + (cols - 1) * this.gap;
    const startX = Math.max(0, (this.viewportWidth - totalRowWidth) / 2);

    for (let i = 0; i < this.cards.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.cards[i].x = startX + col * (cardW + this.gap);
      this.cards[i].y = row * (cardH + this.gap);
    }
  }

  private clampScroll(): void {
    if (this.cards.length === 0) {
      this.innerContainer.y = 0;
      this.scrollIndicator.visible = false;
      return;
    }

    const cardH = this.cards[0]?.cardHeight ?? 280;
    const cardW = this.cards[0]?.cardWidth ?? 220;
    const cols = Math.max(1, Math.floor((this.viewportWidth + this.gap) / (cardW + this.gap)));
    const rows = Math.ceil(this.cards.length / cols);
    const totalH = rows * cardH + (rows - 1) * this.gap;
    const maxScroll = Math.max(0, totalH - this.viewportHeight);

    this.innerContainer.y = Math.min(0, Math.max(-maxScroll, this.innerContainer.y));

    // Show indicator only when there is hidden content below current scroll position
    const currentScroll = -this.innerContainer.y;
    this.scrollIndicator.visible = maxScroll > 0 && currentScroll < maxScroll - 5;
  }

  /**
   * Build the scroll indicator — a fade-out overlay at the bottom with a downward arrow.
   * Signals to the user that more content can be reached by scrolling.
   */
  private buildScrollIndicator(vpWidth: number, vpHeight: number): Container {
    const c = new Container();
    const indicatorH = 56;

    // Stepped gradient from transparent → dark (approximates a CSS gradient)
    const steps = 10;
    const grad = new Graphics();
    for (let i = 0; i < steps; i++) {
      const alpha = (i / steps) * 0.72;
      grad.rect(0, (indicatorH / steps) * i, vpWidth, Math.ceil(indicatorH / steps) + 1);
      grad.fill({ color: 0x1a0000, alpha });
    }
    c.addChild(grad);

    // Down-arrow text
    const arrow = new Text({
      text: "▼ Skroll ned",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "bold",
        fill: 0xffe83d,
        align: "center",
      },
    });
    arrow.anchor.set(0.5, 1);
    arrow.x = vpWidth / 2;
    arrow.y = indicatorH - 6;
    c.addChild(arrow);

    // Position at the bottom edge of the viewport
    c.y = vpHeight - indicatorH;

    return c;
  }
}
