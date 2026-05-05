/**
 * @deprecated for Spill 2 (rocket) per PR #923 + #926.
 * BEHOLDES kun for Game5Controller (SpinnGo, post-pilot scope).
 * Slett i Bølge D når Game5 enten flyttes til games/game5/-mappe
 * eller fjernes fra registry.
 *
 * Se docs/architecture/CLEANUP_AUDIT_2026-05-05.md §3 (Kategori B)
 * og §6 (Kategori E.1) for full kontekst.
 */

import { Container, Graphics } from "pixi.js";
import gsap from "gsap";
import { TicketCard } from "./TicketCard.js";
import { sortByBestFirst } from "../logic/TicketSorter.js";

/**
 * Horizontal scrolling container for TicketCard instances.
 * Uses a mask for viewport clipping and pointer drag for scrolling.
 */
export class TicketScroller extends Container {
  private cards: TicketCard[] = [];
  private innerContainer: Container;
  private maskGraphics: Graphics;
  private viewportWidth: number;
  private viewportHeight: number;
  private gap = 12;

  // Drag state
  private dragging = false;
  private dragStartX = 0;
  private scrollStartX = 0;

  constructor(viewportWidth: number, viewportHeight: number) {
    super();
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;

    // Inner container holds all cards
    this.innerContainer = new Container();
    this.addChild(this.innerContainer);

    // Mask for viewport clipping
    this.maskGraphics = new Graphics();
    this.maskGraphics.rect(0, 0, viewportWidth, viewportHeight);
    this.maskGraphics.fill(0xffffff);
    this.addChild(this.maskGraphics);
    this.innerContainer.mask = this.maskGraphics;

    // Drag interaction
    this.eventMode = "static";
    this.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= viewportWidth && y >= 0 && y <= viewportHeight };

    this.on("pointerdown", this.onDragStart, this);
    this.on("pointermove", this.onDragMove, this);
    this.on("pointerup", this.onDragEnd, this);
    this.on("pointerupoutside", this.onDragEnd, this);
  }

  getCards(): TicketCard[] {
    return [...this.cards];
  }

  addCard(card: TicketCard): void {
    this.cards.push(card);
    this.innerContainer.addChild(card);
    this.layoutCards();
  }

  clearCards(): void {
    for (const card of this.cards) {
      card.stopCardAnimations();
      card.destroy();
    }
    this.innerContainer.removeChildren();
    this.cards = [];
  }

  /** Mark a number on all tickets. Returns true if any ticket was affected. */
  markNumberOnAll(number: number): boolean {
    let any = false;
    for (const card of this.cards) {
      if (card.markNumber(number)) any = true;
    }
    return any;
  }

  /** Sort tickets by best-first (fewest remaining). */
  sortBestFirst(): void {
    sortByBestFirst(this.cards);
    this.layoutCards();
  }

  /** Reposition cards horizontally. */
  private layoutCards(): void {
    let x = 0;
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].x = x;
      this.cards[i].y = 0;
      // Ensure visual order matches array order
      this.innerContainer.setChildIndex(this.cards[i], i);
      x += this.cards[i].cardWidth + this.gap;
    }
  }

  /** Clamp scroll to valid bounds. */
  private clampScroll(): void {
    const totalWidth = this.cards.reduce((sum, c) => sum + c.cardWidth + this.gap, -this.gap);
    const maxScroll = Math.max(0, totalWidth - this.viewportWidth);
    this.innerContainer.x = Math.min(0, Math.max(-maxScroll, this.innerContainer.x));
  }

  // ── Drag handling ─────────────────────────────────────────────────────

  private onDragStart(event: { global: { x: number } }): void {
    this.dragging = true;
    this.dragStartX = event.global.x;
    this.scrollStartX = this.innerContainer.x;
  }

  private onDragMove(event: { global: { x: number } }): void {
    if (!this.dragging) return;
    const dx = event.global.x - this.dragStartX;
    this.innerContainer.x = this.scrollStartX + dx;
    this.clampScroll();
  }

  private onDragEnd(): void {
    this.dragging = false;
  }

  setViewportSize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.maskGraphics.clear();
    this.maskGraphics.rect(0, 0, width, height);
    this.maskGraphics.fill(0xffffff);
    this.clampScroll();
  }

  /** Animate scroll by one card-width forward. */
  pageNext(): void {
    this.scrollByStep(+1);
  }

  /** Animate scroll by one card-width backward. */
  pagePrev(): void {
    this.scrollByStep(-1);
  }

  /** Returns 1-indexed current page + total page count. */
  getPageInfo(): { current: number; total: number } {
    if (this.cards.length === 0) return { current: 0, total: 0 };
    const step = this.stepWidth();
    const offset = -this.innerContainer.x;
    const current = Math.round(offset / step) + 1;
    const visibleCards = Math.max(1, Math.floor(this.viewportWidth / step));
    const total = Math.max(1, this.cards.length - visibleCards + 1);
    return { current: Math.min(current, total), total };
  }

  private stepWidth(): number {
    const first = this.cards[0];
    return first ? first.cardWidth + this.gap : this.viewportWidth;
  }

  private scrollByStep(direction: -1 | 1): void {
    if (this.cards.length === 0) return;
    const step = this.stepWidth();
    const totalWidth = this.cards.reduce((sum, c) => sum + c.cardWidth + this.gap, -this.gap);
    const maxScroll = Math.max(0, totalWidth - this.viewportWidth);
    const target = Math.min(0, Math.max(-maxScroll, this.innerContainer.x - direction * step));
    gsap.to(this.innerContainer, { x: target, duration: 0.25, ease: "power2.out" });
  }
}
