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
/**
 * Cell unmarked-bakgrunn — Tobias-bekreftet bong-design 2026-05-15 IMMUTABLE
 * (SPILL1_IMPLEMENTATION_STATUS §5.9): cream-farge #fbf3df. Avviker fra
 * tidligere semi-transparent rgba(255,255,255,0.55). Cream-fargen gir konsistent
 * paritet mot bong-design.html mockup uavhengig av bong-bakgrunn-fargen.
 */
const UNMARKED_BG = "#fbf3df";

/**
 * Logo-bilde som erstatter "FREE"-tekst i sentercellen (Tobias 2026-04-26).
 * Source: `apps/backend/public/web/games/assets/game1/design/spillorama-logo.png`
 * (1024×1024 PNG). Brukes også av WinPopup som hovedlogo.
 *
 * Beholdes etter §5.9 bong-design-refaktor 2026-05-15 — spec slår eksplisitt
 * fast at FREE-cellen skal beholde Spillorama-logo (firkløver) i prod selv om
 * mockup viser ren "FREE"-tekst.
 */
const FREE_LOGO_URL = "/web/games/assets/game1/design/spillorama-logo.png";

/**
 * Per-bokstav-farger for BINGO-header — Tobias-design 2026-05-15 IMMUTABLE.
 * Hver bokstav har distinkt fyllfarge med svart text-stroke (paint-order:
 * stroke fill) for å sikre lesbarhet på tvers av alle 7 bong-fargene.
 */
const BINGO_LETTER_COLORS: Record<"B" | "I" | "N" | "G" | "O", string> = {
  B: "#c45656", // dus rød
  I: "#e0c068", // dus gul
  N: "#6a8cd6", // dus blå
  G: "#f3eee4", // dus hvit
  O: "#7aa874", // dus grønn
};

/**
 * Color-display-mapping fra backend-Unity-navn (eks. "Small Yellow") til
 * norsk kapitalisert label (eks. "Gul"). Brukes i header-tekst per §5.9.
 *
 * Familienavn ("Yellow") matches case-insensitivt så vi tolererer kjente
 * varianter ("Small Yellow", "Large Yellow", "yellow", "small_yellow"...).
 */
const COLOR_DISPLAY_NAMES: Record<string, string> = {
  yellow: "Gul",
  white: "Hvit",
  purple: "Lilla",
  green: "Grønn",
  red: "Rød",
  orange: "Oransje",
  blue: "Blå",
};

/**
 * Konverter en backend-ticket-color til norsk display-label.
 *
 * Eksempler:
 *   "Small Yellow"   → "Gul"
 *   "Large Yellow"   → "Gul"
 *   "Small Green"    → "Grønn"
 *   "Small Elvis1"   → null (Elvis-bonger styres separat via Elvis-banner)
 *   ""               → null
 *
 * Null returneres når fargen ikke matches — caller faller tilbake til
 * rå color-streng eller egen Elvis-håndtering.
 */
function getColorDisplayName(colorName: string | undefined): string | null {
  if (!colorName) return null;
  const lower = colorName.toLowerCase();
  for (const [family, display] of Object.entries(COLOR_DISPLAY_NAMES)) {
    if (lower.includes(family)) return display;
  }
  return null;
}

/**
 * Avgjør om ticket-typen er "stor" (3 brett-bundle). §5.9 sier at store
 * bonger får header-suffiks " - 3 bonger". Backend wire-payloaden sender
 * 3 SEPARATE ticket-objekter per Large-kjøp (per
 * `TicketGridHtml.largeMultiplicity.test.ts`), men hver av disse skal vise
 * det suffikset så spilleren ser at bongen tilhører en stor-bunt.
 *
 * Sjekker både `ticket.type` (kanonisk "small" / "large" fra catalog) og
 * `ticket.color` (Unity-navn "Large Yellow" / "Small Yellow") som backup.
 */
function isLargeTicket(type: string | undefined, color: string | undefined): boolean {
  const t = (type ?? "").toLowerCase();
  if (t === "large") return true;
  const c = (color ?? "").toLowerCase();
  return c.includes("large");
}

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
    // data-test attributes consumed by Playwright pilot-flow tests
    // (tests/e2e/spill1-pilot-flow.spec.ts). Inert in production.
    this.root.setAttribute("data-test", "ticket-card");
    this.root.setAttribute("data-test-ticket-id", opts.ticket.id ?? "");
    this.root.setAttribute(
      "data-test-ticket-color",
      String(opts.ticket.color ?? ""),
    );
    this.root.setAttribute(
      "data-test-ticket-type",
      String(opts.ticket.type ?? ""),
    );
    this.root.setAttribute("data-test-ticket-price", String(opts.price));
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
      // §5.9 bong-design 2026-05-15 IMMUTABLE: padding 12px 18px 10px 18px
      // (front) — matcher bong-design.html mockup. Back beholder eldre layout.
      padding: isBack ? "6px 8px 10px 8px" : "12px 18px 10px 18px",
      display: "flex",
      flexDirection: "column",
      // §5.9: gap 10px (front) mellom header og body — matcher mockup.
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

    // §5.9 bong-design 2026-05-15 IMMUTABLE — header-layout:
    //   - flex med name (venstre), price (mid), × cancel (høyre)
    //   - gap 22px, padding-bottom 5px, border-bottom 1px rgba(0,0,0,0.15)
    //   - × cancel-knapp er INLINE i flex-flow (ikke absolutt-posisjonert
    //     som før) og pushes til høyre via `marginLeft: auto`. Rent ×
    //     uten sirkel-bakgrunn — `background: transparent` + `color: inherit`.
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "22px",
      color: palette.header,
      whiteSpace: "nowrap",
      paddingBottom: "5px",
      borderBottom: "1px solid rgba(0, 0, 0, 0.15)",
    });

    const name = document.createElement("div");
    name.className = "ticket-header-name";
    Object.assign(name.style, {
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "-0.005em",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    header.appendChild(name);

    const price = document.createElement("div");
    price.className = "ticket-header-price";
    Object.assign(price.style, {
      fontSize: "12px",
      fontWeight: "600",
      fontVariantNumeric: "tabular-nums",
    });
    header.appendChild(price);

    // §5.9 IMMUTABLE: × cancel-knapp er INLINE i flex-flow (ikke lenger
    // absolutt-posisjonert). Vises kun når cancelable + ticket har id.
    if (this.opts.cancelable && this.opts.ticket.id) {
      const btn = document.createElement("button");
      btn.textContent = "\u00d7";
      btn.setAttribute("aria-label", "Avbestill brett");
      // §5.9 IMMUTABLE: × cancel-knapp er INLINE i flex-flow (ikke absolutt-
      // posisjonert som før). Transparent bakgrunn, rent × i palette-fargen
      // (color: inherit fra header), marginLeft: auto pusher knappen til
      // høyre kant.
      Object.assign(btn.style, {
        width: "18px",
        height: "18px",
        border: "none",
        background: "transparent",
        color: "inherit",
        fontSize: "18px",
        fontWeight: "500",
        lineHeight: "1",
        cursor: "pointer",
        padding: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        marginLeft: "auto",
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
    // Elvis-banneret er UTENFOR .ticket-body (matcher tidligere layout) så
    // det vises mellom header og body når aktivt.
    if (isElvisColor(this.ticket.color)) {
      face.appendChild(this.buildElvisBanner());
      this.elvisBannerColorKey = this.ticket.color ?? "";
    }

    // §5.9 IMMUTABLE: .ticket-body wrapper — inneholder BINGO-letters + grid
    // + footer med gap: 4px mellom (matcher mockup .triple-sub-strukturen).
    // Wrapper gjør at single-bong er pixel-identisk med en triple-sub-grid
    // hvis backend en gang i framtiden sender en triple-ticket data-modell
    // (per 2026-05-15 sender backend 3 separate Ticket-objekter per Large-
    // kjøp — denne komponenten rendrer ett av dem). Wrapper er IKKE en
    // strukturell endring som krever backend-koordinasjon.
    const body = document.createElement("div");
    body.className = "ticket-body";
    Object.assign(body.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      flex: "1",
    });
    face.appendChild(body);

    // §5.9 IMMUTABLE: BINGO-header med per-bokstav fyllfarger + svart text-
    // stroke (paint-order: stroke fill). Bruker `gridTemplateColumns:
    // repeat(cols, 1fr)` for kolonne-alignment med grid-noden under.
    // For 5-kolonne-bonger vises standard B/I/N/G/O med distinkte farger
    // (B=#c45656 / I=#e0c068 / N=#6a8cd6 / G=#f3eee4 / O=#7aa874).
    // For andre kolonne-tellinger faller vi tilbake til burgundy uten
    // per-letter-farger (defensiv fallback — Spill 2 bruker BongCard.ts og
    // treffer ikke denne pathen). Inter 900, 16px, letter-spacing 0.02em.
    const bingoHeader = document.createElement("div");
    bingoHeader.className = "ticket-bingo-header";
    Object.assign(bingoHeader.style, {
      display: "grid",
      gridTemplateColumns: `repeat(${this.opts.cols}, 1fr)`,
      gap: "5px",
      flex: "0 0 auto",
    });
    const BINGO_LETTERS = "BINGO";
    for (let i = 0; i < this.opts.cols; i++) {
      const letterChar = BINGO_LETTERS[i % BINGO_LETTERS.length] ?? "";
      const letter = document.createElement("div");
      letter.textContent = letterChar;
      const letterColor =
        this.opts.cols === 5 && letterChar in BINGO_LETTER_COLORS
          ? BINGO_LETTER_COLORS[letterChar as "B" | "I" | "N" | "G" | "O"]
          : MARKED_BG;
      // Inline-style assign — Object.assign aksepterer string-felter for
      // WebkitTextStroke + paintOrder (vendor + non-standard CSS).
      const letterStyle: Record<string, string> = {
        textAlign: "center",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "16px",
        fontWeight: "900",
        color: letterColor,
        letterSpacing: "0.02em",
        lineHeight: "1",
        fontFamily: "'Inter', system-ui, sans-serif",
        // §5.9 IMMUTABLE: text-stroke 1.8px svart + paint-order: stroke fill
        // så fyllet er INNI strøken. Sikrer lesbarhet på tvers av alle 7
        // bong-fargene (cream/gul/lilla osv).
        WebkitTextStroke: "1.8px #000",
        paintOrder: "stroke fill",
      };
      Object.assign(letter.style, letterStyle);
      bingoHeader.appendChild(letter);
    }
    body.appendChild(bingoHeader);

    // Grid container — 5 kolonner, 5px gap. Identisk med tidligere versjon.
    const gridWrap = document.createElement("div");
    gridWrap.className = "ticket-grid";
    Object.assign(gridWrap.style, {
      display: "grid",
      gridTemplateColumns: `repeat(${this.opts.cols}, 1fr)`,
      gridTemplateRows: `repeat(${this.opts.rows}, 1fr)`,
      gap: "5px",
      flex: "1",
    });
    body.appendChild(gridWrap);

    // §5.9 IMMUTABLE: ToGo footer — "X igjen" eller "One to go!" når kun én
    // mark gjenstår. text-align center, font-size 11px, font-weight 500,
    // color #000 (svart, ikke palette-farge), margin-top 4px.
    // `palette` er fortsatt referert via header-coloren over, men footer-
    // teksten er nå svart per spec (uavhengig av bong-bakgrunn) for å
    // matche mockup-en.
    void palette;
    const toGo = document.createElement("div");
    toGo.className = "ticket-togo";
    Object.assign(toGo.style, {
      textAlign: "center",
      fontSize: "11px",
      fontWeight: "500",
      color: "#000",
      marginTop: "4px",
      letterSpacing: "0",
      textTransform: "none",
    });
    body.appendChild(toGo);
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
    // Tobias-bug 2026-05-14: bong-pris vises som "0 kr" under aktiv trekning.
    // `t.price === 0` skal IKKE rendres — kjøpt bong kan aldri ha pris 0.
    // Fall til `opts.price` (TicketGridHtml.computePrice fallback) som er
    // basert på lobby-config + per-bong-multiplikator. Hvis BÅDE er 0,
    // skjul price-rad istedenfor å vise misvisende "0 kr".
    const ticketPriceValid = typeof t.price === "number" && t.price > 0;
    const fallbackPriceValid = typeof this.opts.price === "number" && this.opts.price > 0;
    const priceStr = ticketPriceValid
      ? `${Math.round(t.price as number)} kr`
      : fallbackPriceValid
      ? `${this.opts.price} kr`
      : "";
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
          // §5.9 IMMUTABLE: fontSize 14px, fontWeight 700, borderRadius 4px.
          // Tekstfarge settes i paintCell (burgundy unmarked / hvit marked).
          fontSize: "14px",
          fontWeight: "700",
          fontFamily: "'Inter', system-ui, sans-serif",
          fontVariantNumeric: "tabular-nums",
          lineHeight: "1",
          borderRadius: "4px",
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
          // FREE-celle (Tobias 2026-04-26): bytter ut tidligere "FREE"-tekst-pille
          // med Spillorama-logo-bilde. Logoen fyller hele cellen (100% × 100%
          // med contain-fit, så den skaleres ned hvis cellen er ikke-kvadrat).
          // Bakgrunnen blir transparent slik at logoens egen gull/grønn-design
          // ikke konkurrerer med en ekstra fyllfarge.
          const freeImg = document.createElement("img");
          freeImg.src = FREE_LOGO_URL;
          freeImg.alt = "FREE";
          freeImg.draggable = false;
          Object.assign(freeImg.style, {
            width: "100%",
            height: "100%",
            objectFit: "contain",
            pointerEvents: "none",
            userSelect: "none",
            display: "block",
          });
          // Bruk konstantene defensivt for å unngå "unused" type-error fra strict.
          void FREE_BG;
          void FREE_TEXT;
          cell.appendChild(freeImg);
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

    // Tobias 2026-04-30: lucky-cell skal vise firkløver-ikonet (samme asset
    // som "Velg lykketall"-knappen i sidebar) så spilleren visuelt ser at
    // lykketallet hen valgte er på et brett som er i spill. Tidligere kun
    // gul ramme (`inset 0 0 0 2px #ffe83d`) — det var for diskret.
    //
    // Implementasjon: layered backgrounds. background-image = lucky-clover,
    // background-color = UNMARKED_BG. Når cellen IKKE er lucky må vi nullstille
    // backgroundImage eksplisitt så remnant ikke overlever state-transisjoner.
    // §5.9 IMMUTABLE — cell-styling:
    //   - Unmarked: cream (#fbf3df) bakgrunn + burgundy (#7a1a1a) tall
    //   - Marked: burgundy bakgrunn + hvit tall
    //   - FREE-celle: beholder Spillorama-logo (sentercellen) — buildCells
    //     setter logo-img direkte, paintCell setter cream-bakgrunn under
    //   - Lucky: cream-base med firkløver-overlay + gul innskrytt ramme
    //
    // Tekstfargen er nå BURGUNDY for unmarked (ikke palette.text som varierte
    // per bong-farge) for å matche mockup-konsistens på tvers av alle 7
    // bong-farger. `palette` brukes ikke lenger her — `void` for å unngå
    // "unused"-feil i strict TypeScript.
    void palette;
    const UNMARKED_TEXT = MARKED_BG; // burgundy tall på cream bakgrunn (samme hex)
    if (isFree) {
      cell.style.background = UNMARKED_BG;
      cell.style.backgroundImage = "";
      cell.style.color = UNMARKED_TEXT;
      cell.style.fontWeight = "700";
      cell.style.boxShadow = "none";
    } else if (isMarked) {
      cell.style.background = MARKED_BG;
      cell.style.backgroundImage = "";
      cell.style.color = MARKED_TEXT;
      cell.style.fontWeight = "700";
      cell.style.boxShadow = "none";
    } else if (isLucky) {
      // Bakgrunn = firkløver oppå cream base. 55% size så ikonet er tydelig
      // synlig men dekker ikke tallet (som rendres oppå via cell.textContent).
      cell.style.backgroundColor = UNMARKED_BG;
      cell.style.backgroundImage =
        "url('/web/games/assets/game1/design/lucky-clover.png')";
      cell.style.backgroundSize = "55%";
      cell.style.backgroundPosition = "center";
      cell.style.backgroundRepeat = "no-repeat";
      cell.style.color = UNMARKED_TEXT;
      cell.style.fontWeight = "700";
      cell.style.boxShadow = "inset 0 0 0 2px #ffe83d";
    } else {
      cell.style.background = UNMARKED_BG;
      cell.style.backgroundImage = "";
      cell.style.color = UNMARKED_TEXT;
      cell.style.fontWeight = "700";
      cell.style.boxShadow = "none";
    }
  }

  private updateHeaderAndPrice(): void {
    // §5.9 IMMUTABLE 2026-05-15 — header-tekst-format:
    //   - Liten X (1 brett, ticket.type="small"):  KUN fargen ("Gul" / "Hvit" / "Lilla")
    //   - Stor X (3 brett, ticket.type="large"):   "Farge - 3 bonger"
    //   - Elvis-varianter: behold getElvisLabel() ("Elvis 1" etc.) som før
    //   - Ukjent farge: fall til rå color-streng eller "Bong"
    //
    // Backend wire-format sender 3 separate Ticket-objekter per Large-kjøp
    // (per TicketGridHtml.largeMultiplicity.test.ts). Hver av disse rendres
    // av denne komponenten — header-suffikset signaliserer spilleren at
    // bongen tilhører en 3-brett-bunt.
    const isElvis = isElvisColor(this.ticket.color);
    let label: string;
    if (isElvis) {
      label = getElvisLabel(this.ticket.color);
    } else {
      const displayName = getColorDisplayName(this.ticket.color);
      const baseName = displayName ?? this.ticket.color ?? "Bong";
      const isLarge = isLargeTicket(this.ticket.type, this.ticket.color);
      label = isLarge ? `${baseName} - 3 bonger` : baseName;
    }
    this.headerEl.textContent = label;
    // Tobias-bug 2026-05-14: skjul price-rad hvis price er 0/ugyldig
    // istedenfor å rendre misvisende "0 kr" på en kjøpt bonge. Kombinert
    // med backend-fix og TicketGridHtml.computePrice-fallback skal dette
    // sjelden trigge, men er defensiv mot fremtidige regression.
    this.priceEl.textContent =
      typeof this.opts.price === "number" && this.opts.price > 0
        ? `${this.opts.price} kr`
        : "";
  }

  private updateToGo(): void {
    // §5.9 IMMUTABLE: footer-tekst er svart (#000) per spec, uavhengig av
    // bong-bakgrunnsfarge. Tidligere brukte vi palette.footerText som var
    // ulik per bong-farge (mörk for hvit/gul/lilla, lys for rød). Nå er
    // teksten konsistent svart for å matche mockup.
    // `palette` slipps her — vi beholder bongPaletteFor-kall ikke nødvendig
    // i denne funksjonen lenger.
    const FOOTER_COLOR = "#000";
    const setOneToGo = () => {
      this.toGoEl.textContent = "One to go!";
      this.toGoEl.style.color = FOOTER_COLOR;
      this.toGoEl.style.opacity = "1";
      this.toGoEl.style.fontWeight = "700";
      this.toGoEl.style.letterSpacing = "0.06em";
      this.toGoEl.style.textTransform = "uppercase";
      this.toGoEl.classList.add("bong-otg-pulse");
    };
    const setNormal = (text: string, winColor = false) => {
      this.toGoEl.textContent = text;
      this.toGoEl.style.color = winColor ? "#2a9d8f" : FOOTER_COLOR;
      // §5.9: ingen opacity-reduksjon på footer-tekst (mockup viser full
      // svart-tekst). Tidligere 0.75 satt tekst mot bong-bakgrunn.
      this.toGoEl.style.opacity = "1";
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
