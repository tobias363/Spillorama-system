import type { PatternDefinition, Ticket } from "@spillorama/shared-types/game";
import { getTicketThemeByName, type TicketColorTheme } from "../colors/TicketColorThemes.js";
import { getElvisImageUrl, getElvisLabel, isElvisColor } from "../colors/ElvisAssetPaths.js";
import { remainingForPattern, oneToGoCellsForPattern } from "../logic/PatternMasks.js";

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

/**
 * Bong-palett (Bong.jsx-port). Flate pastellfarger for bong-bakgrunn + header-
 * tekst. Marked/free/pulse-styling er konstant (samme på tvers av fargevarianter).
 */
const BONG_COLORS: Record<string, { bg: string; text: string; header: string; footerText: string }> = {
  yellow:  { bg: "#f0b92e", text: "#2a1a00", header: "#2a1a00", footerText: "#3a2400" },
  purple:  { bg: "#b8a4e8", text: "#2a1040", header: "#2a1040", footerText: "#2a1040" },
  green:   { bg: "#7dc97a", text: "#0f3a10", header: "#0f3a10", footerText: "#0f3a10" },
  white:   { bg: "#e8e4dc", text: "#2a2420", header: "#2a2420", footerText: "#2a2420" },
  red:     { bg: "#dc2626", text: "#ffffff", header: "#ffffff", footerText: "#ffffff" },
  orange:  { bg: "#f97316", text: "#2a1400", header: "#2a1400", footerText: "#2a1400" },
  blue:    { bg: "#60a5fa", text: "#0a1f40", header: "#0a1f40", footerText: "#0a1f40" },
};

const MARKED_BG = "#7a1a1a";
const MARKED_TEXT = "#ffffff";
const FREE_BG = "#2d7a3f";
const FREE_TEXT = "#ffffff";
const UNMARKED_BG = "rgba(255,255,255,0.55)";

/** Velg Bong-palett fra ticket.color. Fallback yellow for ukjente/Elvis-varianter. */
function bongPaletteFor(colorName: string | undefined): typeof BONG_COLORS["yellow"] {
  const n = (colorName ?? "").toLowerCase();
  if (n.includes("yellow")) return BONG_COLORS.yellow;
  if (n.includes("white"))  return BONG_COLORS.white;
  if (n.includes("purple")) return BONG_COLORS.purple;
  if (n.includes("green"))  return BONG_COLORS.green;
  if (n.includes("red"))    return BONG_COLORS.red;
  if (n.includes("orange")) return BONG_COLORS.orange;
  if (n.includes("blue"))   return BONG_COLORS.blue;
  return BONG_COLORS.yellow;
}

/** Injisér pulse-keyframes én gang per dokument (for One-to-go footer-badge). */
function ensureBongStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("bong-ticket-styles")) return;
  const s = document.createElement("style");
  s.id = "bong-ticket-styles";
  s.textContent = `
@keyframes bong-otg-badge {
  0%, 100% { opacity: 0.85; transform: scale(1); }
  50%      { opacity: 1; transform: scale(1.04); }
}
.bong-otg-pulse {
  animation: bong-otg-badge 1.3s ease-in-out infinite;
}

/* Per-celle "one to go"-puls — Bong.jsx-port.
 *
 * BLINK-FIX (round 3, hazard 3): Tidligere animerte vi BÅDE background (rgba)
 * OG box-shadow (4 lag, infinite). Box-shadow + background er ikke
 * composite-bar — Chrome må re-paint hver frame, og med 20-50+ "one-to-go"-
 * celler samtidig på alle billetter genererer dette nok GPU-pressure til at
 * Pixi-canvas blinker. Vi fjerner derfor:
 *  - bong-pulse-ring keyframe (4-lags box-shadow) helt
 *  - background-animasjon i bong-pulse-cell (kun transform: scale igjen)
 *  - statisk solid hvit bakgrunn + outline gir samme visuelle "one-to-go"
 *    signal uten paint-trafikk.
 * Transform er composite-bar i Chrome → kjører på GPU uten layout/paint.
 *
 * BLINK-FIX (round 5, hazard 3): Fjernet 'z-index: 1' og 'position: relative'.
 * Disse skapte et nytt stacking-context per pulse-celle. Late-game kan ha
 * 30 bonger × ~3 one-to-go-celler = 90+ stacking-contexts samtidig. Hver
 * stacking-context er kandidat for layer-promotion → GPU-pressure → blink.
 *
 * Outline er composite-bar (rendrer over uten å trenge stacking-context).
 * Transform: scale-pulsen virker fortsatt utmerket uten z-index — pulsen
 * skalerer cellen lokalt og overlapper naboceller pga. grid-gap (5px).
 * Hvis cellen i fremtiden trenger å løfte seg over naboer, bruk en isolert
 * pseudo-element-overlay i stedet for en hel stacking-context. */
@keyframes bong-pulse-cell {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.04); }
}
.bong-pulse {
  animation: bong-pulse-cell 1.3s ease-in-out infinite;
  background: rgba(255,255,255,0.95);
  outline: 2px solid #7a1a1a;
}
`;
  document.head.appendChild(s);
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
  /** Cell-indices (0-24) som har `bong-pulse`-klasse — cellene som ville
   *  fullføre aktivt pattern hvis de ble markert. Speilet brukes for å
   *  idempotent rydde/legge til klassen uten unødvendige DOM-writes. */
  private currentPulseCells = new Set<number>();
  /** Dimensions reported to parent (TicketGridHtml uses these for layout-card math). */
  readonly cardWidth = 240;
  readonly cardHeight = 300;

  constructor(private readonly opts: BingoTicketHtmlOptions) {
    ensureBongStyles();
    this.ticket = opts.ticket;
    this.theme = getTicketThemeByName(opts.ticket.color, 0);

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      // Bong.jsx-port: bongen fyller grid-cellens bredde opp til maxWidth 360px.
      // Høyden følger aspect-ratio 4:5 (240:300 → 0.8). `justifySelf: center`
      // sentraliserer bongen når celle-bredden overstiger maxWidth. På brede
      // skjermer (cell ≈ 275px) blir bongen ~275×344. På smale blir den
      // mindre men bevarer proporsjonene.
      //
      // BLINK-FIX (round 3, hazard 4): `perspective: 1000px` på root promoterer
      // hver bong til en permanent composite-layer. Med 30 bonger × ~12MB
      // GPU-tekstur-minne kan det utløse layer-eviction → blink. Vi aktiverer
      // `perspective` KUN under aktiv flip-animasjon i `toggleFlip()`.
      //
      // BLINK-FIX (round 5, hazard 1): `transform-style: preserve-3d` på inner
      // har samme layer-promotion-effekt som `perspective`. PR #492 fikset
      // bare perspective; preserve-3d sto fortsatt permanent → 30 composite-
      // layers gjenstod → 1/90s blink. Nå aktiveres `preserve-3d` KUN under
      // flip (samme livssyklus som perspective). Default-state = `flat`
      // (ingen 3D-rendering-context, ingen layer-promotion).
      width: "100%",
      maxWidth: "360px",
      aspectRatio: `${this.cardWidth} / ${this.cardHeight}`,
      justifySelf: "center",
      cursor: "pointer",
      userSelect: "none",
    });

    this.inner = document.createElement("div");
    Object.assign(this.inner.style, {
      position: "relative",
      width: "100%",
      height: "100%",
      // BLINK-FIX (round 5, hazard 1): `flat` default. `preserve-3d` settes
      // KUN i `toggleFlip()` ved flip-start, og fjernes via setTimeout etter
      // at transition er ferdig. Se `setFlipComposite()`-helperen.
      transformStyle: "flat",
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

  /** BLINK-FIX (round 6, hazard #7): Memo av sist bygget Elvis-color slik at
   *  vi unngår å rive banner-noden ned og bygge på nytt når
   *  loadTicket(ticket) kalles med samme farge som forrige ticket. Tidligere
   *  rebuilt vi banneret hver gang ticket-objektet ble swapped (selv ved
   *  identisk farge), noe som inkluderte img-decoding (Pixi-bilde-asset
   *  ble re-decoded → kort flash mens browseren brukte mellomliggende
   *  pixel-buffer). null = ingen banner i DOM nå. */
  private elvisBannerColorKey: string | null = null;

  /**
   * Sørg for at Elvis-banneret i DOM matcher nåværende ticket.color.
   * Kalles kun fra {@link loadTicket} — under konstruksjon renderes banneret
   * direkte i {@link populateFront}.
   */
  private syncElvisBanner(): void {
    const existing = this.front.querySelector(".ticket-elvis-banner");
    const shouldHave = isElvisColor(this.ticket.color);
    const colorKey = shouldHave ? (this.ticket.color ?? "") : null;

    if (shouldHave && !existing) {
      const banner = this.buildElvisBanner();
      const gridWrap = this.front.querySelector(".ticket-grid");
      this.front.insertBefore(banner, gridWrap);
      this.elvisBannerColorKey = colorKey;
    } else if (!shouldHave && existing) {
      existing.remove();
      this.elvisBannerColorKey = null;
    } else if (shouldHave && existing) {
      // BLINK-FIX (round 6, hazard #7): Skip rebuild hvis farge er identisk
      // med forrige bygging. Color-key inkluderer hele color-strengen så
      // variant-bytte (f.eks. "elvis1" → "elvis2") fortsatt trigger refresh.
      // Identisk farge → 0 DOM-mutasjoner, 0 img-decoding, ingen flash.
      if (this.elvisBannerColorKey === colorKey) return;
      const replacement = this.buildElvisBanner();
      existing.replaceWith(replacement);
      this.elvisBannerColorKey = colorKey;
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

  /** Highlight a specific number (usually the player's lucky number).
   *  Idempotent — if the cell already carries the lucky flag we skip paint
   *  to avoid a style-rewrite per room:update-tick. */
  highlightLuckyNumber(number: number): void {
    const idx = this.findCellIndex(number);
    if (idx < 0) return;
    const cell = this.cellNodes[idx];
    if (cell.dataset.lucky === "true") return;
    cell.dataset.lucky = "true";
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
    const palette = bongPaletteFor(this.ticket.color);
    Object.assign(face.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      backfaceVisibility: "hidden",
      transform: isBack ? "rotateY(180deg)" : "rotateY(0deg)",
      // Bong.jsx: flat pastell bakgrunn på hele kortet. Back-face beholder
      // original mørk stil så metadata er lesbar.
      background: isBack ? hex(this.theme.cardBg) : palette.bg,
      borderRadius: "8px",
      boxSizing: "border-box",
      padding: isBack ? "6px 8px 10px 8px" : "12px 14px 10px 14px",
      display: "flex",
      flexDirection: "column",
      gap: isBack ? "4px" : "10px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      overflow: "hidden",
      fontFamily: "'Inter', system-ui, sans-serif",
    });

    if (isBack) {
      this.populateBack(face);
    } else {
      this.populateFront(face);
    }

    return face;
  }

  private populateFront(face: HTMLDivElement): void {
    const palette = bongPaletteFor(this.ticket.color);

    // Header: label venstre + pris høyre (Bong.jsx-layout). Ingen bakgrunn —
    // teksten ligger direkte på bong-fargen.
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      color: palette.header,
      whiteSpace: "nowrap",
      position: "relative",
    });

    const name = document.createElement("div");
    name.className = "ticket-header-name";
    Object.assign(name.style, {
      fontSize: "13px",
      fontWeight: "700",
      letterSpacing: "-0.005em",
      flex: "1",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    header.appendChild(name);

    const price = document.createElement("div");
    price.className = "ticket-header-price";
    const showCancel = this.opts.cancelable && this.opts.ticket.id;
    Object.assign(price.style, {
      fontSize: "12px",
      fontWeight: "600",
      fontVariantNumeric: "tabular-nums",
      // × cancel-knapp er absolutt-posisjonert og tar ikke plass i flex-flow.
      // Skyv prisen til venstre når krysset vises, ellers overlapper "kr".
      marginRight: showCancel ? "18px" : "0",
    });
    header.appendChild(price);

    // × cancel-knapp — absolutt posisjonert øverst til høyre slik at den ikke
    // forstyrrer header-layout. Vises kun når cancelable + ticket har id.
    if (this.opts.cancelable && this.opts.ticket.id) {
      const btn = document.createElement("button");
      btn.textContent = "\u00d7";
      btn.setAttribute("aria-label", "Avbestill brett");
      Object.assign(btn.style, {
        position: "absolute",
        top: "-4px",
        right: "-6px",
        width: "18px",
        height: "18px",
        borderRadius: "50%",
        border: "none",
        background: "rgba(0,0,0,0.25)",
        color: palette.header,
        fontSize: "12px",
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
    }

    face.appendChild(header);

    // Elvis-banner — beholdt for Elvis-bonger (BIN-688). Tracker color-key
    // så loadTicket() kan skippe rebuild hvis farge er uendret (round 6 #7).
    if (isElvisColor(this.ticket.color)) {
      face.appendChild(this.buildElvisBanner());
      this.elvisBannerColorKey = this.ticket.color ?? "";
    }

    // Grid container — 5 kolonner, 5px gap.
    const gridWrap = document.createElement("div");
    gridWrap.className = "ticket-grid";
    Object.assign(gridWrap.style, {
      display: "grid",
      gridTemplateColumns: `repeat(${this.opts.cols}, 1fr)`,
      gridTemplateRows: `repeat(${this.opts.rows}, 1fr)`,
      gap: "5px",
      flex: "1",
    });
    face.appendChild(gridWrap);

    // ToGo footer — "X igjen" eller "One to go!" når kun én mark gjenstår.
    const toGo = document.createElement("div");
    toGo.className = "ticket-togo";
    Object.assign(toGo.style, {
      textAlign: "center",
      fontSize: "11px",
      fontWeight: "500",
      color: palette.footerText,
      opacity: "0.75",
      letterSpacing: "0",
      textTransform: "none",
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
          fontSize: "13px",
          fontWeight: "600",
          fontFamily: "'Inter', system-ui, sans-serif",
          fontVariantNumeric: "tabular-nums",
          lineHeight: "1",
          borderRadius: "3px",
          // Ingen aspect-ratio: 1/1 — det kombinert med grid-template-rows:
          // repeat(5, 1fr) gjør at celler blir høyere enn kolonne-bredden,
          // og aspect-ratio presser bredden utover → overflow/clip på høyre
          // celle-kolonne. 1fr×1fr fra grid-template gir uniforme celler
          // som tilpasser seg ticket-dimensjonene uten overflow.
          minWidth: "0",
          minHeight: "0",
          // BLINK-FIX (round 5, hazard 2): Fjernet `transition: background
          // 0.12s, color 0.12s`. `background` og `color` er paint-properties
          // (ikke composite-bar) → re-paint i hver mellom-frame av transition.
          // 30 bonger × 25 celler = potensielt 750+ transitionstart-events
          // per ball-trekk. Markering er nå instant (matcher Unity-paritet
          // der celle-color-bytte er instant). Visuell smoothness er ikke
          // nødvendig — markering er en diskret state-overgang, ikke en
          // animasjon.
        });
        if (n === 0) {
          // FREE-celle (Bong.jsx): grønn pille inne i hvit celle-ramme.
          const freeInner = document.createElement("div");
          Object.assign(freeInner.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "82%",
            height: "70%",
            background: FREE_BG,
            color: FREE_TEXT,
            borderRadius: "2px",
            fontSize: "8px",
            fontWeight: "700",
            letterSpacing: "0.04em",
          });
          freeInner.textContent = "FREE";
          cell.appendChild(freeInner);
        } else {
          cell.textContent = String(n);
        }
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
    const isMarked = !isFree && this.marks.has(n);
    const isLucky = cell.dataset.lucky === "true";
    const palette = bongPaletteFor(this.ticket.color);

    if (isFree) {
      // FREE-celle har hvit base (som unmarked) med grønn inner-pille.
      cell.style.background = UNMARKED_BG;
      cell.style.color = palette.text;
      cell.style.fontWeight = "600";
      cell.style.boxShadow = "none";
    } else if (isMarked) {
      cell.style.background = MARKED_BG;
      cell.style.color = MARKED_TEXT;
      cell.style.fontWeight = "700";
      cell.style.boxShadow = "none";
    } else if (isLucky) {
      cell.style.background = UNMARKED_BG;
      cell.style.color = palette.text;
      cell.style.fontWeight = "700";
      cell.style.boxShadow = "inset 0 0 0 2px #ffe83d";
    } else {
      cell.style.background = UNMARKED_BG;
      cell.style.color = palette.text;
      cell.style.fontWeight = "600";
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
    const palette = bongPaletteFor(this.ticket.color);
    const setOneToGo = () => {
      this.toGoEl.textContent = "One to go!";
      this.toGoEl.style.color = palette.footerText;
      this.toGoEl.style.opacity = "1";
      this.toGoEl.style.fontWeight = "700";
      this.toGoEl.style.letterSpacing = "0.06em";
      this.toGoEl.style.textTransform = "uppercase";
      this.toGoEl.classList.add("bong-otg-pulse");
    };
    const setNormal = (text: string, winColor = false) => {
      this.toGoEl.textContent = text;
      this.toGoEl.style.color = winColor ? "#2a9d8f" : palette.footerText;
      this.toGoEl.style.opacity = "0.75";
      this.toGoEl.style.fontWeight = "500";
      this.toGoEl.style.letterSpacing = "0";
      this.toGoEl.style.textTransform = "none";
      this.toGoEl.classList.remove("bong-otg-pulse");
    };

    // Per-celle "one to go"-puls. For aktiv pattern: finn celler som vil
    // fullføre en kandidat-maske hvis markert, legg til `bong-pulse`-klasse.
    // Idempotent via `currentPulseCells` for å unngå unødvendig DOM-writes.
    const nextPulse = new Set<number>();
    if (this.activePattern) {
      const cells = oneToGoCellsForPattern(
        this.ticket.grid,
        this.marks,
        this.activePattern.name,
      );
      if (cells) cells.forEach((i) => nextPulse.add(i));
    }
    for (const idx of this.currentPulseCells) {
      if (!nextPulse.has(idx)) this.cellNodes[idx]?.classList.remove("bong-pulse");
    }
    for (const idx of nextPulse) {
      if (!this.currentPulseCells.has(idx)) this.cellNodes[idx]?.classList.add("bong-pulse");
    }
    this.currentPulseCells = nextPulse;

    if (this.activePattern) {
      const phaseRemaining = remainingForPattern(
        this.ticket.grid,
        this.marks,
        this.activePattern.name,
      );
      if (phaseRemaining !== null) {
        if (phaseRemaining === 0) setNormal(`${this.activePattern.name} — klar!`, true);
        else if (phaseRemaining === 1) setOneToGo();
        else setNormal(`${phaseRemaining} igjen til ${this.activePattern.name}`);
        return;
      }
    }
    const remaining = this.getRemainingCount();
    if (remaining === 0) setNormal("Ferdig!", true);
    else if (remaining === 1) setOneToGo();
    else setNormal(`${remaining} igjen`);
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

  /** Aktiver flip-composite-state: perspective på root + preserve-3d på
   *  inner. Begge skaper layer-promotion → må kun være aktive under flip-
   *  animasjon, ikke permanent. Idempotent — flere kall er trygge.
   *
   *  BLINK-FIX (round 5, hazard 1): preserve-3d har samme layer-promotion-
   *  effekt som perspective. Begge må av/på i samme livssyklus. */
  private enableFlipComposite(): void {
    this.root.style.perspective = "1000px";
    this.inner.style.transformStyle = "preserve-3d";
  }

  /** Deaktiver flip-composite-state: tilbake til ingen perspective + flat
   *  transform-style. Frigjør GPU-laget. Kalles fra setTimeout etter at flip-
   *  transition er ferdig. */
  private disableFlipComposite(): void {
    this.root.style.perspective = "";
    this.inner.style.transformStyle = "flat";
  }

  private toggleFlip(): void {
    this.flipped = !this.flipped;

    // BLINK-FIX (round 3, hazard 4 + round 5, hazard 1): Aktiver `perspective`
    // OG `transform-style: preserve-3d` KUN under flip. Default-state har
    // verken perspective på root eller preserve-3d på inner → ingen permanent
    // composite-layer per bong. Begge er nødvendige sammen for at
    // `backface-visibility: hidden` skal skjule baksiden under rotasjonen.
    // Vi setter dem ved flip-start og fjerner dem 450ms etter at transition
    // er ferdig (transition er 400ms, vi gir 50ms slack).
    this.enableFlipComposite();
    this.inner.style.transform = this.flipped ? "rotateY(180deg)" : "rotateY(0deg)";

    // Refresh back-face content each time we flip TO it, so the price / bought
    // timestamp reflect the latest ticket data (useful after ticket:replace).
    if (this.flipped) {
      this.back.innerHTML = "";
      this.populateBack(this.back);
      this.flipTimer = setTimeout(() => {
        if (this.flipped) this.toggleFlip();
      }, 3000);
    } else {
      if (this.flipTimer !== null) {
        clearTimeout(this.flipTimer);
        this.flipTimer = null;
      }
      // Tilbake til front. Fjern composite-state når flip-transition er ferdig
      // så bong-laget kan slippes fra GPU og frigjøre tekstur-minne.
      setTimeout(() => {
        if (!this.flipped) this.disableFlipComposite();
      }, 450);
    }
  }
}
