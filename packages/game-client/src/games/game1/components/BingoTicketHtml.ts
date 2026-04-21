import type { PatternDefinition, Ticket } from "@spillorama/shared-types/game";
import { getTicketThemeByName, type TicketColorTheme } from "../colors/TicketColorThemes.js";
import { getElvisImageUrl, getElvisLabel, isElvisColor } from "../colors/ElvisAssetPaths.js";
import { remainingForPattern } from "../logic/PatternMasks.js";

/**
 * HTML-based bingo ticket. Replaces the Pixi TicketCard pipeline for Game 1.
 *
 * Why HTML:
 *   - Native pointer events (no scroller mask / hitArea fights)
 *   - CSS 3D flip ("transform: rotateY(180deg)") instead of GSAP tween on pivot
 *   - Native scrolling in parent TicketGridHtml (no custom drag handler)
 *   - DOM destroy is synchronous — no Pixi render-loop crashes from stale refs
 *
 * Color theme still comes from {@link getTicketThemeByName}, just converted from 0xRRGGBB integers to CSS hex strings.
 */
export interface BingoTicketHtmlOptions {
  ticket: Ticket;
  /** Display price (kr). Shown right-aligned in the header. */
  price: number;
  /**
   * Grid dimensions — pulled from ticket.grid but kept explicit so we don't
   * have to re-compute in every render. Bingo75 is 5x5 with free center,
   * Bingo60 is 3x5 without.
   */
  rows: number;
  cols: number;
  /** True = render the × cancel button + call onCancel on click. */
  cancelable: boolean;
  onCancel?: (ticketId: string) => void;
}

/** Convert 0xRRGGBB integer → "#rrggbb". */
function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

/** Convert color to rgba() with given alpha. */
function rgba(n: number, alpha: number): string {
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

export class BingoTicketHtml {
  readonly root: HTMLDivElement;
  private readonly inner: HTMLDivElement;
  private readonly front: HTMLDivElement;
  private readonly back: HTMLDivElement;
  private readonly cellNodes: HTMLDivElement[] = [];
  private readonly toGoEl: HTMLDivElement;
  private readonly headerEl: HTMLDivElement;
  private readonly priceEl: HTMLDivElement;

  private ticket: Ticket;
  private theme: TicketColorTheme;
  private marks = new Set<number>();
  private flipTimer: ReturnType<typeof setTimeout> | null = null;
  private flipped = false;
  /** Fase-aktivt pattern — styrer "igjen"-teller ("X igjen til 1 Rad"). Null
   *  = whole-card-telling (pre-round / ukjent pattern). */
  private activePattern: PatternDefinition | null = null;
  /** Dimensions reported to parent (TicketGridHtml uses these for layout-card math). */
  readonly cardWidth = 240;
  readonly cardHeight = 300;

  constructor(private readonly opts: BingoTicketHtmlOptions) {
    this.ticket = opts.ticket;
    this.theme = getTicketThemeByName(opts.ticket.color, 0);

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      width: `${this.cardWidth}px`,
      height: `${this.cardHeight}px`,
      perspective: "1000px",
      cursor: "pointer",
      flex: "0 0 auto",
      userSelect: "none",
    });

    this.inner = document.createElement("div");
    Object.assign(this.inner.style, {
      position: "relative",
      width: "100%",
      height: "100%",
      transformStyle: "preserve-3d",
      transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
      transform: "rotateY(0deg)",
    });
    this.root.appendChild(this.inner);

    this.front = this.buildFace(false);
    this.back = this.buildFace(true);
    this.inner.appendChild(this.front);
    this.inner.appendChild(this.back);

    this.headerEl = this.front.querySelector(".ticket-header-name") as HTMLDivElement;
    this.priceEl = this.front.querySelector(".ticket-header-price") as HTMLDivElement;
    this.toGoEl = this.front.querySelector(".ticket-togo") as HTMLDivElement;

    this.buildCells();
    this.updateHeaderAndPrice();
    this.updateToGo();

    // Click-to-flip is on the whole card. The × cancel button (in the header)
    // calls e.stopPropagation() so it doesn't also trigger a flip.
    this.root.addEventListener("click", () => this.toggleFlip());
  }

  // ── Public API (mirrors what Controller/Grid consumes) ──────────────────

  /** Swap the underlying ticket (used by ticket:replace). Preserves mark set only
   *  for numbers that still exist in the new grid — the rest get dropped. */
  loadTicket(ticket: Ticket): void {
    this.ticket = ticket;
    this.theme = getTicketThemeByName(ticket.color, 0);
    this.syncElvisBanner();
    this.buildCells();
    this.updateHeaderAndPrice();
    this.updateToGo();
  }

  /**
   * Sørg for at Elvis-banneret i DOM matcher nåværende ticket.color.
   * Kalles kun fra {@link loadTicket} — under konstruksjon renderes banneret
   * direkte i {@link populateFront}.
   */
  private syncElvisBanner(): void {
    const existing = this.front.querySelector(".ticket-elvis-banner");
    const shouldHave = isElvisColor(this.ticket.color);
    if (shouldHave && !existing) {
      const banner = this.buildElvisBanner();
      const gridWrap = this.front.querySelector(".ticket-grid");
      this.front.insertBefore(banner, gridWrap);
    } else if (!shouldHave && existing) {
      existing.remove();
    } else if (shouldHave && existing) {
      // Refresh banner (bilde/label kan ha endret seg ved variant-swap).
      const replacement = this.buildElvisBanner();
      existing.replaceWith(replacement);
    }
  }

  /** Mark a drawn number. Returns true if the ticket contained it. */
  markNumber(number: number): boolean {
    if (this.marks.has(number)) return true;
    const hit = this.findCellIndex(number);
    if (hit < 0) return false;
    this.marks.add(number);
    this.paintCell(hit);
    this.updateToGo();
    return true;
  }

  markNumbers(numbers: number[]): void {
    for (const n of numbers) this.markNumber(n);
  }

  /** Reset marks (except the FREE centre cell, which is always "marked"). */
  reset(): void {
    this.marks.clear();
    for (let i = 0; i < this.cellNodes.length; i++) this.paintCell(i);
    this.updateToGo();
  }

  /** Highlight a specific number (usually the player's lucky number). */
  highlightLuckyNumber(number: number): void {
    const idx = this.findCellIndex(number);
    if (idx >= 0) this.cellNodes[idx].dataset.lucky = "true";
    this.paintCell(idx);
  }

  /** How many non-free cells are still unmarked. */
  getRemainingCount(): number {
    const { grid } = this.ticket;
    let remaining = 0;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const n = grid[r][c];
        if (n === 0) continue; // free centre
        if (!this.marks.has(n)) remaining++;
      }
    }
    return remaining;
  }

  /** Sett fase-aktivt pattern. Tekst endres til "X igjen til \<fase\>" når
   *  satt. Null = fallback til whole-card-telling. */
  setActivePattern(pattern: PatternDefinition | null): void {
    if (this.activePattern?.id === pattern?.id) return;
    this.activePattern = pattern;
    this.updateToGo();
  }

  destroy(): void {
    if (this.flipTimer !== null) clearTimeout(this.flipTimer);
    this.flipTimer = null;
    this.root.remove();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private buildFace(isBack: boolean): HTMLDivElement {
    const face = document.createElement("div");
    Object.assign(face.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      backfaceVisibility: "hidden",
      transform: isBack ? "rotateY(180deg)" : "rotateY(0deg)",
      background: hex(this.theme.cardBg),
      borderRadius: "10px",
      boxSizing: "border-box",
      padding: "6px 8px 10px 8px",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
      overflow: "hidden",
    });

    if (isBack) {
      this.populateBack(face);
    } else {
      this.populateFront(face);
    }

    return face;
  }

  private populateFront(face: HTMLDivElement): void {
    // Header row
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "6px",
      height: "26px",
      padding: "0 8px",
      background: hex(this.theme.headerBg),
      color: hex(this.theme.headerText),
      borderRadius: "6px",
      fontSize: "12px",
      fontWeight: "700",
    });

    // × cancel button (left side). Rendered whenever `cancelable=true` and
    // the ticket has a stable id — onCancel is optional so the UI doesn't
    // depend on controller wire-up timing. Missing handler = no-op click
    // (still stops propagation so it doesn't also flip the card).
    if (this.opts.cancelable && this.opts.ticket.id) {
      const btn = document.createElement("button");
      btn.textContent = "\u00d7";
      btn.setAttribute("aria-label", "Avbestill brett");
      Object.assign(btn.style, {
        width: "18px",
        height: "18px",
        borderRadius: "50%",
        border: "none",
        background: "rgba(0,0,0,0.35)",
        color: hex(this.theme.headerText),
        fontSize: "14px",
        fontWeight: "700",
        lineHeight: "1",
        cursor: "pointer",
        padding: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });
      const id = this.opts.ticket.id;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.opts.onCancel?.(id);
      });
      header.appendChild(btn);
    } else {
      // Placeholder to keep layout consistent.
      const spacer = document.createElement("span");
      spacer.style.width = "18px";
      header.appendChild(spacer);
    }

    const name = document.createElement("div");
    name.className = "ticket-header-name";
    name.style.flex = "1";
    name.style.textAlign = "center";
    name.style.whiteSpace = "nowrap";
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    header.appendChild(name);

    const price = document.createElement("div");
    price.className = "ticket-header-price";
    price.style.minWidth = "44px";
    price.style.textAlign = "right";
    header.appendChild(price);

    face.appendChild(header);

    // Elvis-banner — vises kun for Elvis-bonger (BIN-688).
    // Fargen ligger allerede i theme; bildet er egen placeholder-asset per
    // variant (1-5) og kan byttes uten kode-endring. Ukjent Elvis-variant
    // (f.eks. "elvis9") renderes tekst-bare uten bilde som fallback.
    if (isElvisColor(this.ticket.color)) {
      face.appendChild(this.buildElvisBanner());
    }

    // Grid container
    const gridWrap = document.createElement("div");
    gridWrap.className = "ticket-grid";
    Object.assign(gridWrap.style, {
      display: "grid",
      gridTemplateColumns: `repeat(${this.opts.cols}, 1fr)`,
      gridTemplateRows: `repeat(${this.opts.rows}, 1fr)`,
      gap: "3px",
      flex: "1",
    });
    face.appendChild(gridWrap);

    // ToGo footer
    const toGo = document.createElement("div");
    toGo.className = "ticket-togo";
    Object.assign(toGo.style, {
      textAlign: "center",
      fontSize: "12px",
      fontWeight: "700",
      color: hex(this.theme.toGoColor),
      height: "16px",
    });
    face.appendChild(toGo);
  }

  /**
   * Bygg Elvis-banner-elementet som vises øverst på Elvis-bonger.
   * Struktur: `<div class="ticket-elvis-banner">` med enten `<img>` + tekst
   * (kjent variant) eller bare tekst (ukjent variant — fallback).
   *
   * Img-URL hentes via {@link getElvisImageUrl} som returnerer `null` for
   * ukjent variant — da dropper vi `<img>`-noden og viser bare label ("ELVIS").
   */
  private buildElvisBanner(): HTMLDivElement {
    const banner = document.createElement("div");
    banner.className = "ticket-elvis-banner";
    Object.assign(banner.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "2px",
      padding: "4px 0 2px",
      flex: "0 0 auto",
    });

    const url = getElvisImageUrl(this.ticket.color);
    if (url !== null) {
      const img = document.createElement("img");
      img.className = "ticket-elvis-image";
      img.src = url;
      img.alt = getElvisLabel(this.ticket.color);
      Object.assign(img.style, {
        maxHeight: "64px",
        maxWidth: "100%",
        objectFit: "contain",
        display: "block",
      });
      banner.appendChild(img);
    }

    const label = document.createElement("div");
    label.className = "ticket-elvis-label";
    label.textContent = getElvisLabel(this.ticket.color);
    Object.assign(label.style, {
      fontSize: "11px",
      fontWeight: "800",
      letterSpacing: "1px",
      color: hex(this.theme.headerText),
      textAlign: "center",
    });
    banner.appendChild(label);

    return banner;
  }

  private populateBack(face: HTMLDivElement): void {
    const t = this.ticket;
    const ticketNum = t.ticketNumber ?? t.id ?? "—";
    const hall = t.hallName ?? "";
    const supplier = t.supplierName ?? "";
    const priceStr = typeof t.price === "number" ? `${Math.round(t.price)} kr` : `${this.opts.price} kr`;
    const boughtStr = t.boughtAt ? new Date(t.boughtAt).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" }) : "";

    const rows: Array<[string, string, number?]> = [
      [`Bong #${ticketNum}`, hex(this.theme.headerText), 16],
      [hall, "#444", 13],
      [supplier, "#444", 13],
      [priceStr, "#2a9d8f", 14],
      [boughtStr ? `Kjøpt ${boughtStr}` : "", "#666", 11],
    ];

    Object.assign(face.style, {
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
    });

    for (const [text, color, size] of rows) {
      if (!text) continue;
      const el = document.createElement("div");
      el.textContent = text;
      Object.assign(el.style, {
        color,
        fontSize: `${size ?? 13}px`,
        fontWeight: size && size >= 14 ? "700" : "500",
        lineHeight: "1.3",
        padding: "2px 10px",
        textAlign: "center",
      });
      face.appendChild(el);
    }
  }

  private buildCells(): void {
    const gridWrap = this.front.querySelector(".ticket-grid") as HTMLDivElement;
    gridWrap.innerHTML = "";
    this.cellNodes.length = 0;
    const { grid } = this.ticket;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const n = grid[r][c];
        const cell = document.createElement("div");
        cell.dataset.number = String(n);
        Object.assign(cell.style, {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "14px",
          fontWeight: "700",
          borderRadius: "6px",
          transition: "background 0.12s, color 0.12s, transform 0.12s",
        });
        cell.textContent = n === 0 ? "F" : String(n);
        gridWrap.appendChild(cell);
        this.cellNodes.push(cell);
      }
    }
    // Initial paint.
    for (let i = 0; i < this.cellNodes.length; i++) this.paintCell(i);
  }

  private paintCell(idx: number): void {
    const cell = this.cellNodes[idx];
    if (!cell) return;
    const n = Number(cell.dataset.number);
    const isFree = n === 0;
    const isMarked = isFree || this.marks.has(n);
    const isLucky = cell.dataset.lucky === "true";
    const c = this.theme.cellColors;

    if (isFree) {
      cell.style.background = hex(c.bgFree);
      cell.style.color = hex(c.textFree);
    } else if (isMarked) {
      cell.style.background = hex(c.markerColor);
      cell.style.color = hex(c.textMarked);
    } else if (isLucky) {
      cell.style.background = rgba(c.bgHighlight, 0.85);
      cell.style.color = hex(c.textDefault);
      cell.style.boxShadow = "inset 0 0 0 2px #ffe83d";
    } else {
      cell.style.background = hex(c.bgDefault);
      cell.style.color = hex(c.textDefault);
      cell.style.boxShadow = "none";
    }
  }

  private updateHeaderAndPrice(): void {
    // For Elvis-bonger normaliseres "elvis1"/"Elvis 1"/etc. til "ELVIS 1" i
    // header slik at spilleren alltid ser samme format uavhengig av kilde-case.
    const label = isElvisColor(this.ticket.color)
      ? getElvisLabel(this.ticket.color)
      : (this.ticket.color ?? "Bong");
    this.headerEl.textContent = label;
    this.priceEl.textContent = `${this.opts.price} kr`;
  }

  private updateToGo(): void {
    // Fase-aktivt pattern overstyrer whole-card-telling så spilleren ser
    // "X igjen til 1 Rad" i stedet for "24 igjen" (hele brettet).
    if (this.activePattern) {
      const phaseRemaining = remainingForPattern(
        this.ticket.grid,
        this.marks,
        this.activePattern.name,
      );
      if (phaseRemaining !== null) {
        if (phaseRemaining === 0) {
          this.toGoEl.textContent = `${this.activePattern.name} — klar!`;
          this.toGoEl.style.color = "#2a9d8f";
        } else {
          this.toGoEl.textContent = `${phaseRemaining} igjen til ${this.activePattern.name}`;
          this.toGoEl.style.color = hex(this.theme.toGoColor);
        }
        return;
      }
      // Ukjent pattern-navn → fall gjennom til whole-card-telling.
    }
    const remaining = this.getRemainingCount();
    if (remaining === 0) {
      this.toGoEl.textContent = "Ferdig!";
      this.toGoEl.style.color = "#2a9d8f";
    } else {
      this.toGoEl.textContent = `${remaining} igjen`;
      this.toGoEl.style.color = hex(this.theme.toGoColor);
    }
  }

  private findCellIndex(number: number): number {
    const { grid } = this.ticket;
    let idx = 0;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === number) return idx;
        idx++;
      }
    }
    return -1;
  }

  private toggleFlip(): void {
    this.flipped = !this.flipped;
    this.inner.style.transform = this.flipped ? "rotateY(180deg)" : "rotateY(0deg)";

    // Refresh back-face content each time we flip TO it, so the price / bought
    // timestamp reflect the latest ticket data (useful after ticket:replace).
    if (this.flipped) {
      this.back.innerHTML = "";
      this.populateBack(this.back);
      this.flipTimer = setTimeout(() => {
        if (this.flipped) this.toggleFlip();
      }, 3000);
    } else if (this.flipTimer !== null) {
      clearTimeout(this.flipTimer);
      this.flipTimer = null;
    }
  }
}
