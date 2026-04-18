import { Container, Graphics, Text } from "pixi.js";
import type { Ticket } from "@spillorama/shared-types/game";
import { TicketCard } from "../../game2/components/TicketCard.js";
import type { TicketColorTheme } from "../colors/TicketColorThemes.js";

/**
 * Variant of a multi-ticket group. Mirrors Unity's per-prefab ticket groups:
 *
 *  - "elvis"        → 2 mini-tickets laid out HORIZONTALLY.
 *                     Unity: Game1ViewPurchaseElvisTicket.cs:14-17
 *                     (List<Game1ViewPurchaseTicket> Mini_Tickets, count=2).
 *
 *  - "large"        → 3 mini-tickets stacked VERTICALLY.
 *                     Unity: PrefabBingoGame1LargeTicket5x5.cs:8
 *                     (List<PrefabBingoGame1Ticket5x5> Mini_Tickets, count=3).
 *                     Critically, large is NOT a single scaled-up ticket — cells
 *                     keep their small cellSize (44×37 per Unity prefab
 *                     `Prefab - Bingo Game 1 Large Ticket 5x5.prefab:10354`).
 *
 *  - "traffic"      → 3 mini-tickets stacked VERTICALLY (Red / Yellow / Green).
 *                     Each mini-ticket uses its own color theme; the group BG,
 *                     header and claim-bar are shared.
 */
export type TicketGroupVariant = "elvis" | "large" | "traffic";

export interface TicketGroupOptions {
  variant: TicketGroupVariant;
  /** One Ticket per mini-ticket. Length must match the variant (2 or 3). */
  tickets: Ticket[];
  /** Display name shown in the shared header (e.g. "Elvis 1", "Large Red"). */
  groupName: string;
  /** Total price for the whole group (Unity shows one price per group). */
  price: number;
  /** Theme for the shared BG / header / claim-bar.
   *  For traffic-light we still want one shared BG, so the caller picks one
   *  theme (typically the first ticket's theme) — the per-mini-ticket cell
   *  colors come from `miniThemes` below. */
  sharedTheme: TicketColorTheme;
  /** Per-mini-ticket themes. Same length as `tickets`. */
  miniThemes: TicketColorTheme[];
  /** Cell size — MUST match small tickets (Unity: 44×37, we use 44 square). */
  cellSize?: number;
  /** Grid size forwarded to each mini-ticket. */
  gridSize?: "3x5" | "5x5";
}

/**
 * TicketGroup — a single scroller-addable display unit that renders multiple
 * mini-tickets behind one shared card chrome. Replaces the previous
 * "one-TicketCard-per-Unity-ticket" layout for elvis / large / traffic-light
 * variants, so the UI matches Unity's shared-BG composition.
 *
 * Public surface mirrors TicketCard's scroller contract
 * (cardWidth/cardHeight/markNumber/markNumbers/getRemainingCount/
 *  stopCardAnimations/reset) so TicketGridScroller can treat groups and
 * solo cards uniformly.
 */
export class TicketGroup extends Container {
  readonly variant: TicketGroupVariant;
  /** The mini-tickets this group owns — ordered exactly as supplied. */
  readonly miniTickets: TicketCard[] = [];

  private cardBg: Graphics;
  private headerBg: Graphics;
  private headerText: Text;
  private priceText: Text;
  private claimBarBg: Graphics;
  private cardW = 0;
  private cardH = 0;
  private sharedBgColor: number;

  // Layout constants (shared across variants).
  private static readonly OUTER_PAD = 8;
  private static readonly HEADER_H = 28;
  private static readonly CLAIM_BAR_H = 28;
  private static readonly MINI_GAP = 6;
  private static readonly BORDER_RADIUS = 10;

  constructor(options: TicketGroupOptions) {
    super();
    this.variant = options.variant;
    this.sharedBgColor = options.sharedTheme.cardBg;

    const cellSize = options.cellSize ?? 44;
    const gridSize = options.gridSize ?? "3x5";

    const expectedCount = options.variant === "elvis" ? 2 : 3;
    if (options.tickets.length !== expectedCount) {
      console.warn(
        `[TicketGroup] variant "${options.variant}" expects ${expectedCount} tickets, got ${options.tickets.length}`,
      );
    }
    if (options.miniThemes.length !== options.tickets.length) {
      console.warn(
        `[TicketGroup] miniThemes length mismatch: ${options.miniThemes.length} vs ${options.tickets.length}`,
      );
    }

    // ── Build shared card background (placeholder — resized once we know mini size) ──
    this.cardBg = new Graphics();
    this.addChild(this.cardBg);

    // ── Shared header bar (Unity: Ticket_Name_Txt + Ticket_BG together) ──
    this.headerBg = new Graphics();
    this.addChild(this.headerBg);

    this.headerText = new Text({
      text: options.groupName,
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "bold",
        fill: options.sharedTheme.headerText,
      },
    });
    this.headerText.x = TicketGroup.OUTER_PAD + 4;
    this.headerText.y = TicketGroup.OUTER_PAD + 5;
    this.addChild(this.headerText);

    this.priceText = new Text({
      text: `${options.price}kr`,
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "bold",
        fill: options.sharedTheme.headerText,
      },
    });
    this.priceText.anchor.set(1, 0);
    this.priceText.y = TicketGroup.OUTER_PAD + 5;
    this.addChild(this.priceText);

    // ── Build mini-tickets ──
    // Each mini-ticket is a TicketCard with its own cellColors / theme, but we
    // hide its internal cardBg / header / price / toGo text so only the grid
    // is visible. The group provides the surrounding chrome.
    for (let i = 0; i < options.tickets.length; i++) {
      const theme = options.miniThemes[i] ?? options.sharedTheme;
      const mini = new TicketCard(i, {
        gridSize,
        cellSize,
        cardBg: theme.cardBg,
        headerBg: theme.headerBg,
        headerText: theme.headerText,
        toGoColor: theme.toGoColor,
        toGoCloseColor: theme.toGoCloseColor,
        cellColors: theme.cellColors,
      });
      mini.loadTicket(options.tickets[i]);
      // Hide each mini-ticket's own chrome (bg/header/price/toGo) — the group
      // provides a single shared set of those. Also disable flip interaction
      // since the group owns interaction semantics.
      mini.setMiniMode();
      mini.eventMode = "none";
      mini.cursor = "default";
      this.miniTickets.push(mini);
      this.addChild(mini);
    }

    // ── Shared claim / delete bar (Unity: deleteBtn + Replace_Amount_Txt). ──
    // Placeholder graphics — actual button wiring is opt-in via setters below.
    this.claimBarBg = new Graphics();
    this.addChild(this.claimBarBg);

    // ── Layout once all children are built ──
    this.layoutMiniTickets();
    this.paintChrome(options.sharedTheme.headerBg);
  }

  // ── Layout ─────────────────────────────────────────────────────────────

  private layoutMiniTickets(): void {
    const pad = TicketGroup.OUTER_PAD;
    const headerH = TicketGroup.HEADER_H;
    const gap = TicketGroup.MINI_GAP;
    const claimH = TicketGroup.CLAIM_BAR_H;

    const first = this.miniTickets[0];
    if (!first) return;
    const miniW = first.cardWidth;
    const miniH = first.cardHeight;

    if (this.variant === "elvis") {
      // 2 horizontal — Unity Game1ViewPurchaseElvisTicket layout.
      const count = this.miniTickets.length;
      const totalW = count * miniW + (count - 1) * gap;
      this.cardW = totalW + pad * 2;
      this.cardH = headerH + miniH + claimH + pad * 2;
      for (let i = 0; i < count; i++) {
        this.miniTickets[i].x = pad + i * (miniW + gap);
        this.miniTickets[i].y = pad + headerH;
      }
    } else {
      // 3 vertical — Unity PrefabBingoGame1LargeTicket5x5 / traffic stack.
      const count = this.miniTickets.length;
      const totalH = count * miniH + (count - 1) * gap;
      this.cardW = miniW + pad * 2;
      this.cardH = headerH + totalH + claimH + pad * 2;
      for (let i = 0; i < count; i++) {
        this.miniTickets[i].x = pad;
        this.miniTickets[i].y = pad + headerH + i * (miniH + gap);
      }
    }

    // Position price text at right edge of the header.
    this.priceText.x = this.cardW - pad - 4;
  }

  private paintChrome(headerBgColor: number): void {
    // Shared outer BG (Unity: Ticket_BG / imageBG colored via Large_BG_Color).
    this.cardBg.clear();
    this.cardBg.roundRect(0, 0, this.cardW, this.cardH, TicketGroup.BORDER_RADIUS);
    this.cardBg.fill(this.sharedBgColor);

    // Header bar.
    this.headerBg.clear();
    this.headerBg.roundRect(
      TicketGroup.OUTER_PAD,
      TicketGroup.OUTER_PAD,
      this.cardW - TicketGroup.OUTER_PAD * 2,
      TicketGroup.HEADER_H - 4,
      6,
    );
    this.headerBg.fill(headerBgColor);

    // Shared claim bar stripe at the bottom — a simple visual marker that
    // all mini-tickets share a claim/delete affordance (Unity: deleteBtn +
    // Replace_Amount_Txt live below the mini-tickets in one row).
    this.claimBarBg.clear();
    const claimY = this.cardH - TicketGroup.OUTER_PAD - TicketGroup.CLAIM_BAR_H + 4;
    this.claimBarBg.roundRect(
      TicketGroup.OUTER_PAD,
      claimY,
      this.cardW - TicketGroup.OUTER_PAD * 2,
      TicketGroup.CLAIM_BAR_H - 4,
      6,
    );
    this.claimBarBg.fill(headerBgColor);
  }

  // ── Public API (mirrors TicketCard's scroller contract) ───────────────

  get cardWidth(): number {
    return this.cardW;
  }
  get cardHeight(): number {
    return this.cardH;
  }

  /** Mark a drawn number on every mini-ticket. Returns true if ANY matched. */
  markNumber(number: number): boolean {
    let any = false;
    for (const mini of this.miniTickets) {
      if (mini.markNumber(number)) any = true;
    }
    return any;
  }

  /** Mark a set of numbers across every mini-ticket (bulk, no return). */
  markNumbers(numbers: number[]): void {
    for (const mini of this.miniTickets) {
      mini.markNumbers(numbers);
    }
  }

  /** Lowest remaining count across mini-tickets — used by "best first" sort.
   *  (Unity sorts groups by their nearest-to-win mini-ticket.) */
  getRemainingCount(): number {
    let min = Number.POSITIVE_INFINITY;
    for (const mini of this.miniTickets) {
      const r = mini.getRemainingCount();
      if (r < min) min = r;
    }
    return Number.isFinite(min) ? min : 0;
  }

  /** Highlight a lucky number on every mini-ticket that contains it. */
  highlightLuckyNumber(luckyNumber: number): void {
    for (const mini of this.miniTickets) {
      mini.highlightLuckyNumber(luckyNumber);
    }
  }

  /** Reset every mini-ticket to its initial marked state. */
  reset(): void {
    for (const mini of this.miniTickets) {
      mini.reset();
    }
  }

  /** Stop any card-level animations on all mini-tickets (called by scroller). */
  stopCardAnimations(): void {
    for (const mini of this.miniTickets) {
      mini.stopCardAnimations();
    }
  }

  /**
   * Hard reset of ALL animations across every mini-ticket — used at game-end.
   *
   * Delegates to {@link TicketCard.stopAllAnimations} on each mini, which in
   * turn hard-resets cell blinks + mark-bounces + flip tweens. See
   * TicketCard.stopAllAnimations for the Unity reference.
   */
  stopAllAnimations(): void {
    for (const mini of this.miniTickets) {
      mini.stopAllAnimations();
    }
  }
}
