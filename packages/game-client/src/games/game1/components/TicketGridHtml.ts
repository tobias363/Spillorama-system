import type { GameState } from "../../../bridge/GameBridge.js";
import { activePatternFromState } from "../logic/PatternMasks.js";
import type { Ticket } from "@spillorama/shared-types/game";
import { BingoTicketHtml } from "./BingoTicketHtml.js";

/**
 * HTML grid scroller for Game 1 tickets. Replaces the Pixi TicketGridScroller
 * + TicketGroup pair. Uses native `overflow-y: auto` and CSS grid — the
 * platform handles wheel / touch / keyboard scrolling for free.
 *
 * Responsibilities:
 *   - Mount inside an HtmlOverlayManager absolute-positioned slot
 *   - Render one BingoTicketHtml per ticket
 *   - Diff-render on `setTickets` so unchanged tickets don't rebuild (preserves
 *     cell mark animations and flip state)
 *   - Propagate mark-number events to every child ticket
 */

export interface TicketGridHtmlOptions {
  onCancelTicket?: (ticketId: string) => void;
}

export class TicketGridHtml {
  readonly root: HTMLDivElement;
  private readonly scrollArea: HTMLDivElement;
  private readonly gridEl: HTMLDivElement;
  private tickets: BingoTicketHtml[] = [];
  private ticketById = new Map<string, BingoTicketHtml>();
  /** Cache of the last rendered tickets' identity + colour, keyed by id. */
  private lastSignature: string | null = null;
  private cancelable = false;
  private onCancelTicket: ((ticketId: string) => void) | null;

  constructor(opts: TicketGridHtmlOptions = {}) {
    this.onCancelTicket = opts.onCancelTicket ?? null;

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      display: "flex",
      flexDirection: "column",
      pointerEvents: "auto",
      boxSizing: "border-box",
      // Higher than the sibling flex children inside HtmlOverlayManager.root
      // — otherwise `CenterTopPanel` (flex: 1, default align-items: stretch)
      // stretches to full height and visually covers the ticket grid, and
      // also soaks up pointer events in its empty lower half.
      zIndex: "5",
    });

    this.scrollArea = document.createElement("div");
    Object.assign(this.scrollArea.style, {
      flex: "1 1 auto",
      overflowY: "auto",
      overflowX: "hidden",
      padding: "8px",
      // Hide scrollbar visually but keep it scrollable (Pixi aesthetic match).
      scrollbarWidth: "thin",
      scrollbarColor: "rgba(255,255,255,0.25) transparent",
    });
    // Dynamisk fade-maske: ingen fade når skrollet helt opp / helt ned;
    // 16px fade når det er mer innhold i den retningen.
    this.scrollArea.addEventListener("scroll", () => this.updateScrollMask());
    this.root.appendChild(this.scrollArea);

    this.gridEl = document.createElement("div");
    Object.assign(this.gridEl.style, {
      display: "grid",
      gridTemplateColumns: "repeat(5, minmax(0px, 1fr))",
      gap: "10px",
      alignContent: "start",
    });
    this.scrollArea.appendChild(this.gridEl);
  }

  /**
   * Mount the grid under an HTML overlay parent. Call once, right after
   * constructing the PlayScreen.
   */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  /**
   * Absolute-position the grid inside its overlay parent. Coordinates are in
   * the same logical space as HtmlOverlayManager (which tracks the Pixi
   * canvas rect for DPR-correct positioning).
   */
  setBounds(x: number, y: number, width: number, height: number): void {
    Object.assign(this.root.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    // Bounds-endring kan endre hvorvidt innhold overflower → oppdater maske.
    this.updateScrollMask();
  }

  /** Oppdater fade-maske basert på scroll-posisjon. Ingen fade i topp når
   *  scrollTop==0; ingen fade i bunn når scrollet helt ned. 16px fade-zone.
   *  Kun skriv til DOM hvis masken faktisk endrer seg (unngå re-paint-blink). */
  private lastMaskStr: string | null = null;
  private updateScrollMask(): void {
    const el = this.scrollArea;
    const atTop = el.scrollTop <= 1;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const topStop = atTop ? "0" : "16px";
    const bottomStop = atBottom ? "100%" : "calc(100% - 16px)";
    const mask = `linear-gradient(to bottom, transparent 0, #000 ${topStop}, #000 ${bottomStop}, transparent 100%)`;
    if (mask === this.lastMaskStr) return;
    console.debug("[blink] TicketGrid.scrollMask change", { atTop, atBottom });
    this.lastMaskStr = mask;
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
  }

  /**
   * Render (or update) the grid from a list of tickets.
   *
   * Signature-based diff: tickets with unchanged `id` + `color` are kept
   * in-place (preserving marks + flip state). New/changed ones rebuild.
   *
   * `liveTicketCount` splits the input array: the first N tickets are the
   * player's active brett for the current round (marked by drawn numbers,
   * NOT cancelable — already paid for). The remaining tickets are the
   * pre-round queue for the next round (cancelable via ×, not markable).
   * Allows us to show both in the same grid during mid-round additive buys.
   */
  setTickets(
    tickets: Ticket[],
    opts: { cancelable: boolean; entryFee: number; state: GameState; liveTicketCount?: number },
  ): void {
    const liveCount = opts.liveTicketCount ?? 0;
    const signature = this.computeSignature(tickets, opts.cancelable, liveCount);

    if (signature === this.lastSignature) {
      // Same shape — just refresh marks from state (in case we missed any).
      this.applyMarks(opts.state, liveCount);
      return;
    }
    this.cancelable = opts.cancelable;
    this.rebuild(tickets, opts, liveCount);
    // Assign signature AFTER rebuild — rebuild() calls clear() which resets
    // lastSignature, so setting it beforehand gets overwritten.
    this.lastSignature = signature;
    this.applyMarks(opts.state, liveCount);
    this.updateScrollMask();
  }

  /** Mark a newly-drawn number across every ticket in the grid. Returns true
   *  if at least one ticket actually matched — caller uses this to gate a
   *  one-shot "mark" sound effect. */
  markNumberOnAll(number: number): boolean {
    let any = false;
    for (const t of this.tickets) {
      if (t.markNumber(number)) any = true;
    }
    return any;
  }

  /** Highlight the player's lucky number on every ticket that contains it. */
  highlightLuckyNumber(number: number): void {
    for (const t of this.tickets) t.highlightLuckyNumber(number);
  }

  /** Reset all tickets' marks. Called on game reset / new round. */
  reset(): void {
    for (const t of this.tickets) t.reset();
  }

  /** Clear all rendered tickets (e.g. during a full state rebuild). */
  clear(): void {
    for (const t of this.tickets) t.destroy();
    this.tickets = [];
    this.ticketById.clear();
    this.gridEl.innerHTML = "";
    this.lastSignature = "__empty__";
  }

  destroy(): void {
    this.clear();
    this.root.remove();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private computeSignature(tickets: Ticket[], cancelable: boolean, liveCount: number): string {
    const parts = tickets.map((t) => `${t.id ?? "_"}:${t.color ?? "_"}:${t.type ?? "_"}`);
    parts.push(`c=${cancelable ? 1 : 0}`);
    parts.push(`l=${liveCount}`);
    return parts.join("|");
  }

  private rebuild(
    tickets: Ticket[],
    opts: { cancelable: boolean; entryFee: number; state: GameState },
    liveCount: number,
  ): void {
    console.debug("[blink] TicketGrid.rebuild", {
      count: tickets.length,
      cancelable: opts.cancelable,
      liveCount,
      prevSig: this.lastSignature,
    });
    this.clear();
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const isLive = i < liveCount;
      // Live (already-paid) brett are never cancelable. Pre-round ones follow
      // the caller's cancelable flag (true during WAITING / mid-round-queue).
      const cancelable = isLive ? false : opts.cancelable;
      const price = this.computePrice(ticket, opts);
      const rows = ticket.grid?.length ?? 5;
      const cols = ticket.grid?.[0]?.length ?? 5;
      const child = new BingoTicketHtml({
        ticket,
        price,
        rows,
        cols,
        cancelable,
        onCancel: this.onCancelTicket ?? undefined,
      });
      // Fade pre-round brett slightly during RUNNING to signal "next round".
      if (!isLive && liveCount > 0) {
        child.root.style.opacity = "0.72";
      }
      this.tickets.push(child);
      if (ticket.id) this.ticketById.set(ticket.id, child);
      this.gridEl.appendChild(child.root);
    }
  }

  private computePrice(ticket: Ticket, opts: { entryFee: number; state: GameState }): number {
    if (typeof ticket.price === "number") return Math.round(ticket.price);
    const tt = opts.state.ticketTypes?.find((x) => x.type === ticket.type);
    return Math.round(opts.entryFee * (tt?.priceMultiplier ?? 1));
  }

  private applyMarks(state: GameState, liveCount: number): void {
    // `myMarks` / drawnNumbers apply ONLY to live brett. Pre-round brett
    // (index >= liveCount) stay unmarked — they're a preview for next round,
    // owner decision 2026-04-19: "selvfølgelig ikke disse bongene aktive i
    // den trekningen".
    const marksByIndex = state.myMarks ?? [];
    const activePattern = activePatternFromState(state.patterns, state.patternResults);
    for (let i = 0; i < this.tickets.length; i++) {
      const ticket = this.tickets[i];
      const isLive = i < liveCount;
      if (isLive) {
        const marks = marksByIndex[i];
        if (marks && marks.length > 0) {
          ticket.markNumbers(marks);
        } else if (state.drawnNumbers && state.drawnNumbers.length > 0) {
          ticket.markNumbers(state.drawnNumbers);
        }
        if (state.myLuckyNumber) ticket.highlightLuckyNumber(state.myLuckyNumber);
        // Fase-aktiv pattern styrer "igjen"-teller i footer. Pre-round-
        // bonger beholder whole-card-telling (null) — de spiller ikke i
        // aktiv runde.
        ticket.setActivePattern(activePattern);
      } else {
        ticket.setActivePattern(null);
      }
    }
  }
}
