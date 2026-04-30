import type { GameState } from "../../../bridge/GameBridge.js";
import { activePatternFromState } from "../logic/PatternMasks.js";
import {
  sortPhaseFromActivePattern,
  sortTicketsByProgress,
} from "../logic/TicketSortByProgress.js";
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
  /** Mark-state signature (drawn-count + last-drawn + lucky + activePattern).
   *  Used by setTickets to skip `applyMarks` when nothing that affects marks
   *  has changed since the last call. Backend sends room:update every ~1.2s
   *  during drawing; without this short-circuit we re-iterate every live
   *  ticket × every drawn number on every state-tick even when nothing is
   *  new (BIN-blink round 3). */
  private lastMarkStateSig: string | null = null;
  private cancelable = false;
  /** Antall live (spillende) brett — første N av `tickets`. Pre-round-brett
   *  (index ≥ liveCount) skal IKKE merkes av `markNumberOnAll`. Oppdateres
   *  av `setTickets`. */
  private liveCount = 0;
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

    // ── Sortér live-bonger etter "nærmest å fullføre fasen" ─────────────────
    // Tobias 2026-04-26: server sender bonger i kjøps-rekkefølge, men spillere
    // synes det er vanskelig å se hvilken bong som er nærmest å vinne. Vi
    // sorterer KUN live-bonger (index < liveCount). Pre-round-bonger beholder
    // sin original-posisjon (de spiller ikke i nåværende runde).
    //
    // Hvis active-pattern ikke kan klassifiseres til en Spill 1-fase
    // (Spill 3 jubilee, ukjent custom-navn), beholdes server-rekkefølge.
    const orderedTickets = this.applyProgressSort(tickets, opts.state, liveCount);

    const signature = this.computeSignature(orderedTickets, opts.cancelable, liveCount);
    const markSig = this.computeMarkStateSig(opts.state, liveCount);

    if (signature === this.lastSignature) {
      // Same shape — only re-apply marks when the mark-state actually changed.
      // Backend sends room:update ~1.2s/tick; without this short-circuit we
      // iterate every live ticket × every drawn number on every tick.
      this.liveCount = liveCount;
      if (markSig !== this.lastMarkStateSig) {
        this.applyMarks(opts.state, liveCount);
        this.lastMarkStateSig = markSig;
      }
      return;
    }
    this.cancelable = opts.cancelable;
    this.liveCount = liveCount;
    this.rebuild(orderedTickets, opts, liveCount);
    // Assign signature AFTER rebuild — rebuild() calls clear() which resets
    // lastSignature, so setting it beforehand gets overwritten.
    this.lastSignature = signature;
    this.applyMarks(opts.state, liveCount);
    this.lastMarkStateSig = markSig;
    this.updateScrollMask();
  }

  /**
   * Returnér en ny array hvor live-bongene (index < liveCount) er sortert
   * etter closeness-til-fullføring. Pre-round-bonger (index ≥ liveCount)
   * beholder sin relative rekkefølge bak live-bongene.
   *
   * Faller tilbake til input-array hvis det ikke er noen live-bonger,
   * eller hvis active-pattern ikke kan klassifiseres til en Spill 1-fase.
   */
  private applyProgressSort(
    tickets: Ticket[],
    state: GameState,
    liveCount: number,
  ): Ticket[] {
    if (liveCount <= 0 || tickets.length === 0) return tickets;
    const activePattern = activePatternFromState(state.patterns, state.patternResults);
    const phase = sortPhaseFromActivePattern(activePattern);
    if (phase === null) return tickets;
    const drawn = new Set(state.drawnNumbers ?? []);
    const live = tickets.slice(0, liveCount);
    const preRound = tickets.slice(liveCount);
    const sortedLive = sortTicketsByProgress(live, drawn, phase);
    return [...sortedLive, ...preRound];
  }

  /** Mark a newly-drawn number across every LIVE ticket. Returns true if at
   *  least one live ticket actually matched — caller gates et one-shot "mark"-
   *  lydeffekt på returverdien.
   *
   *  Pre-round-brett (index ≥ liveCount) ignoreres: de spiller ikke i nåværende
   *  runde og skal ikke ha marks før de blir live ved neste round-start. */
  markNumberOnAll(number: number): boolean {
    let any = false;
    for (let i = 0; i < this.tickets.length; i++) {
      if (i >= this.liveCount) continue;
      if (this.tickets[i].markNumber(number)) any = true;
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
    this.lastMarkStateSig = null;
  }

  destroy(): void {
    this.clear();
    this.root.remove();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private computeSignature(tickets: Ticket[], cancelable: boolean, liveCount: number): string {
    // BUG-FIX (Tobias 2026-04-27): in-game tickets har Ticket.id=undefined per
    // shared-types/game.ts:9 ("Absent on in-game tickets"). Hvis flere tickets
    // har samme color+type (typisk: 4 Small Yellow), ble signature IDENTISK
    // uansett rekkefølge — sort-rekkefølge ble derfor aldri reflektert i DOM
    // fordi setTickets()-shortcircuit traff lastSignature===signature.
    //
    // Fix: inkluder grid-fingerprint (første rad) per ticket. Hvert brett har
    // unike numre, så grid[0] gir stabil unik identifikasjon selv uten id.
    const parts = tickets.map((t) => {
      const fingerprint = t.id ?? (t.grid?.[0] ? t.grid[0].join(",") : "_");
      return `${fingerprint}:${t.color ?? "_"}:${t.type ?? "_"}`;
    });
    parts.push(`c=${cancelable ? 1 : 0}`);
    parts.push(`l=${liveCount}`);
    return parts.join("|");
  }

  /** Summerer alt i GameState som påvirker mark-rendering. Backend appender
   *  bare til `drawnNumbers`, så {length, last} er tilstrekkelig uten full
   *  join. Lucky-number og active-pattern-id dekker resten av markerings-
   *  triggerne. PatternResults-endring gir ny active-pattern → ny sig. */
  private computeMarkStateSig(state: GameState, liveCount: number): string {
    const drawn = state.drawnNumbers ?? [];
    const last = drawn.length > 0 ? drawn[drawn.length - 1] : "_";
    const lucky = state.myLuckyNumber ?? "_";
    const active = activePatternFromState(state.patterns, state.patternResults);
    const activeId = active?.id ?? "_";
    return `d=${drawn.length}:${last}|lu=${lucky}|ap=${activeId}|l=${liveCount}`;
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
    // Per-brett pris (det som vises på hvert enkelt brett-kort), ikke bundle-pris.
    // `priceMultiplier` skalerer bundle-pris fra base-entryFee (Small Yellow=1×,
    // Large Yellow=3× osv.). `ticketCount` er antall brett bundlen utgjør
    // (Small=1 brett, Large=3 brett). Deler vi bundle-pris på ticketCount får vi
    // pris per enkelt brett:
    //   Small Yellow:  10 × 1 / 1 = 10 kr per brett ✅
    //   Large Yellow:  10 × 3 / 3 = 10 kr per brett ✅ (3 brett bundled, totalt 30 kr)
    // Tidligere returnerte denne 30 kr per Large-brett — bundle-pris i stedet
    // for per-brett-pris (verifisert live 2026-04-30 av Tobias).
    const priceMultiplier = tt?.priceMultiplier ?? 1;
    const ticketCount = tt?.ticketCount ?? 1;
    const bundlePrice = opts.entryFee * priceMultiplier;
    return Math.round(bundlePrice / ticketCount);
  }

  private applyMarks(state: GameState, liveCount: number): void {
    // Live brett (index < liveCount) får ALLTID alle trukne tall applisert.
    // Tidligere versjon prioriterte `state.myMarks[i]` først og falt tilbake
    // til `drawnNumbers` kun hvis myMarks var tom — det ga "tilfeldig
    // marking" når rebuild nullstilte ticket-state og myMarks var ufullstendig
    // (f.eks. rett etter rebuild, eller når backend ikke hadde synket per-
    // ticket-marks). `BingoTicketHtml.markNumber` er idempotent og matcher
    // kun celler som faktisk inneholder tallet, så `drawnNumbers` er trygg
    // autoritativ kilde uansett rebuild-state.
    //
    // Pre-round brett (index ≥ liveCount) forblir umerket — de er preview for
    // neste runde. Eier-beslutning 2026-04-19: "selvfølgelig ikke disse
    // bongene aktive i den trekningen".
    const activePattern = activePatternFromState(state.patterns, state.patternResults);
    const drawn = state.drawnNumbers ?? [];
    for (let i = 0; i < this.tickets.length; i++) {
      const ticket = this.tickets[i];
      const isLive = i < liveCount;
      if (isLive) {
        if (drawn.length > 0) ticket.markNumbers(drawn);
        if (state.myLuckyNumber) ticket.highlightLuckyNumber(state.myLuckyNumber);
        ticket.setActivePattern(activePattern);
      } else {
        ticket.setActivePattern(null);
      }
    }
  }
}
