import type { PatternDefinition, Ticket } from "@spillorama/shared-types/game";
import { BingoTicketHtml } from "./BingoTicketHtml.js";

/**
 * §5.9 (Tobias-direktiv 2026-05-15 IMMUTABLE) — pixel-perfect triple-rendering
 * for Stor X (3 brett). Tre Ticket-objekter med samme `purchaseId` rendres
 * som ÉN visuell triple-container (660 px bredde, 3 sub-grids side-om-side
 * med 1 px dividers) istedenfor 3 separate single-bonger.
 *
 * **Visuell spec** (matcher `packages/game-client/src/bong-design/bong-design.html`):
 * - Container-bredde: 660 px (default); max-width-respekterer parent grid
 * - `.bong-card` padding: `12px 18px 10px 18px`
 * - `.triple-grids`: `display: grid; grid-template-columns: 1fr 1px 1fr 1px 1fr`
 * - Dividers: 1 px `rgba(0, 0, 0, 0.15)` vertikale linjer mellom sub-grids
 * - Sub-grid padding: `padding: 0 10px` (med override 13 px på midt-sub)
 * - Header: "Gul - 3 bonger" / "Hvit - 3 bonger" / "Lilla - 3 bonger"
 *   (totalpris = entryFee × 3 multipliert i header)
 * - × cancel-knapp: én knapp som canceler hele purchase (alle 3 bonger)
 *
 * **Wrapper-pattern:** Triplet er en wrapper rundt 3 {@link BingoTicketHtml}-
 * instanser. Klassen eksponerer SAMME public API som BingoTicketHtml så
 * caller-laget (`TicketGridHtml`) kan lagre triplet- og single-bonger i
 * samme array uten branching i payload-laget.
 *
 * Sub-bongene har `headerHidden: true` (ny opts-felt på BingoTicketHtml)
 * som skjuler deres lokale header og × cancel-knapp via CSS-overrides
 * (`bong-triplet-card`-klassen på rotnoden). Triple-wrapperens header er
 * den eneste synlige.
 *
 * **Mark/state-flyt:** `markNumber(n)` propagerer til alle 3 sub-bonger.
 * `reset()`, `setActivePattern()` og `highlightLuckyNumber()` propagerer
 * også. `getRemainingCount()` summerer over alle 3 (brukes ikke i den
 * primære render-pathen men eksponeres for API-paritet).
 *
 * **Backwards-compat:** Hvis backend sender 3 large-tickets uten purchaseId
 * (legacy ticket-data uten purchase-binding) eller hvis bare 1-2 av 3
 * mottas, faller `TicketGridHtml` tilbake til å rendre hver som single
 * — denne komponenten brukes KUN når caller har grupperet 3 tickets med
 * identisk purchaseId.
 */
export interface BingoTicketTripletHtmlOptions {
  /** Eksakt 3 tickets med samme `purchaseId`, sortert på `sequenceInPurchase`. */
  tickets: [Ticket, Ticket, Ticket];
  /** Display-pris per enkelt-bong i kr — wrapperen viser `price × 3` i header. */
  price: number;
  /** Grid-dimensjoner — Bingo75 = 5×5 (samme som BingoTicketHtml.opts). */
  rows: number;
  cols: number;
  /** True = render én × cancel-knapp i wrapperens header som canceler hele purchase. */
  cancelable: boolean;
  /**
   * Kalles med purchase-ID-en når wrapperens cancel-knapp trykkes.
   * Caller forventes å kalle backend purchase-cancel-endpoint som sletter
   * alle 3 ticket-rader (én transaksjon på `purchase_id` i DB).
   */
  onCancel?: (purchaseId: string) => void;
}

/** Velg display-label fra ticket-color. Speilet fra `getFamilyDisplayName` i BingoTicketHtml. */
function getColorDisplayLabel(color: string | undefined): string {
  if (!color) return "Bong";
  const lower = color.toLowerCase();
  if (lower.includes("yellow")) return "Gul";
  if (lower.includes("white")) return "Hvit";
  if (lower.includes("purple")) return "Lilla";
  if (lower.includes("green")) return "Grønn";
  if (lower.includes("red")) return "Rød";
  if (lower.includes("orange")) return "Oransje";
  if (lower.includes("blue")) return "Blå";
  return "Bong";
}

/** Bong-bakgrunnsfarge per fargefamilie. Speilet 1:1 fra `BingoTicketHtml.BONG_COLORS`. */
const TRIPLE_BONG_BG: Record<string, string> = {
  yellow: "#f0b92e",
  purple: "#b8a4e8",
  green: "#7dc97a",
  white: "#e8e4dc",
  red: "#dc2626",
  orange: "#f97316",
  blue: "#60a5fa",
};

/** Header-tekst-farge per fargefamilie. Speilet fra `BONG_COLORS`-paletten. */
const TRIPLE_HEADER_COLOR: Record<string, string> = {
  yellow: "#2a1a00",
  purple: "#2a1040",
  green: "#0f3a10",
  white: "#2a2420",
  red: "#ffffff",
  orange: "#2a1400",
  blue: "#0a1f40",
};

function tripletBackgroundFor(color: string | undefined): string {
  const lower = (color ?? "").toLowerCase();
  if (lower.includes("yellow")) return TRIPLE_BONG_BG.yellow!;
  if (lower.includes("white")) return TRIPLE_BONG_BG.white!;
  if (lower.includes("purple")) return TRIPLE_BONG_BG.purple!;
  if (lower.includes("green")) return TRIPLE_BONG_BG.green!;
  if (lower.includes("red")) return TRIPLE_BONG_BG.red!;
  if (lower.includes("orange")) return TRIPLE_BONG_BG.orange!;
  if (lower.includes("blue")) return TRIPLE_BONG_BG.blue!;
  return TRIPLE_BONG_BG.yellow!;
}

function tripletHeaderColorFor(color: string | undefined): string {
  const lower = (color ?? "").toLowerCase();
  if (lower.includes("yellow")) return TRIPLE_HEADER_COLOR.yellow!;
  if (lower.includes("white")) return TRIPLE_HEADER_COLOR.white!;
  if (lower.includes("purple")) return TRIPLE_HEADER_COLOR.purple!;
  if (lower.includes("green")) return TRIPLE_HEADER_COLOR.green!;
  if (lower.includes("red")) return TRIPLE_HEADER_COLOR.red!;
  if (lower.includes("orange")) return TRIPLE_HEADER_COLOR.orange!;
  if (lower.includes("blue")) return TRIPLE_HEADER_COLOR.blue!;
  return TRIPLE_HEADER_COLOR.yellow!;
}

/**
 * Injisér wrapper-spesifikke styles én gang per dokument. Inkluderer:
 * - `.bong-triplet-card` container-klasse for triple-wrapper
 * - CSS-overrides som skjuler sub-bongers individuelle header + cancel-knapp
 *   slik at wrapperens header er den eneste synlige.
 *
 * BingoTicketHtml's `face`-noder har inline-styles (Object.assign), så vi
 * trenger `!important` for å overstyre. Vi targeter via klasse-prefix
 * `.bong-triplet-card .ticket-header-name`-selektor som matcher sub-bongens
 * header-noder.
 */
function ensureTripletStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("bong-triplet-styles")) return;
  const s = document.createElement("style");
  s.id = "bong-triplet-styles";
  s.textContent = `
.bong-triplet-card {
  width: 100%;
  max-width: 660px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 18px 10px 18px;
  box-sizing: border-box;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  font-family: 'Inter', system-ui, sans-serif;
  overflow: hidden;
}
.bong-triplet-card .bong-triplet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
  white-space: nowrap;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.15);
}
.bong-triplet-card .bong-triplet-name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bong-triplet-card .bong-triplet-price {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.bong-triplet-card .bong-triplet-cancel {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 18px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-left: auto;
}
.bong-triplet-card .bong-triplet-cancel:hover {
  opacity: 0.6;
}
/* 3 sub-grids + 2 tynne vertikale dividers (1px). */
.bong-triplet-card .bong-triplet-grids {
  display: grid;
  grid-template-columns: 1fr 1px 1fr 1px 1fr;
  gap: 0;
  align-items: stretch;
  flex: 1;
}
.bong-triplet-card .bong-triplet-divider {
  background: rgba(0, 0, 0, 0.15);
  width: 1px;
  align-self: stretch;
  margin: 4px 0;
}
/* Sub-grid har lett padding for å puste mot dividerne. Midt-sub får
 * 3px ekstra på hver side (Tobias-design 2026-05-15). */
.bong-triplet-card .bong-triplet-sub {
  display: flex;
  flex-direction: column;
  padding: 0 10px;
  min-width: 0;
}
.bong-triplet-card .bong-triplet-sub:first-child {
  padding-left: 0;
}
.bong-triplet-card .bong-triplet-sub:last-child {
  padding-right: 0;
}
.bong-triplet-card .bong-triplet-sub:nth-child(3) {
  padding-left: 13px;
  padding-right: 13px;
}
/* Hide the sub-bongens individuelle header + × cancel-knapp + container-
 * padding/skygge. Sub-bongen skal IKKE rendre sin egen "Gul - 3 bonger"-
 * header, fordi wrapperens header eier den. */
.bong-triplet-card .bong-triplet-sub > .triple-sub-root {
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  width: 100% !important;
  max-width: none !important;
  aspect-ratio: auto !important;
}
.bong-triplet-card .bong-triplet-sub .ticket-header-name,
.bong-triplet-card .bong-triplet-sub .ticket-header-price {
  display: none !important;
}
.bong-triplet-card .bong-triplet-sub button[aria-label="Avbestill brett"] {
  display: none !important;
}
`;
  document.head.appendChild(s);
}

/**
 * Wrapper-klasse som rendrer 3 sub-tickets med felles header.
 *
 * Public API speilet fra `BingoTicketHtml` så caller (`TicketGridHtml`)
 * ikke trenger å branche mellom single og triple.
 */
export class BingoTicketTripletHtml {
  readonly root: HTMLDivElement;
  private readonly inner: BingoTicketHtml[] = [];
  private readonly headerNameEl: HTMLDivElement;
  private readonly headerPriceEl: HTMLDivElement;

  /** purchaseId som identifiserer hele triple-gruppen (samme for alle 3 sub-tickets). */
  readonly purchaseId: string;

  /**
   * Eksponert for paritet med BingoTicketHtml. Caller-laget bruker første
   * ticket-id som identifikator i `ticketById`-Map. Hvis denne mangler
   * (in-game tickets uten `id`), beholdes purchaseId som fallback.
   */
  readonly primaryTicketId: string | undefined;

  /** Dimensjoner speilet for caller's layout-math. */
  readonly cardWidth = 660;
  readonly cardHeight = 300;

  constructor(opts: BingoTicketTripletHtmlOptions) {
    ensureTripletStyles();

    if (opts.tickets.length !== 3) {
      throw new Error(
        `BingoTicketTripletHtml requires exactly 3 tickets, got ${opts.tickets.length}`,
      );
    }

    const firstTicket = opts.tickets[0];
    this.purchaseId = firstTicket.purchaseId ?? "";
    this.primaryTicketId = firstTicket.id;

    // ── Container ──────────────────────────────────────────────────────────
    this.root = document.createElement("div");
    this.root.className = "bong-triplet-card";
    this.root.setAttribute("data-test", "ticket-triplet");
    this.root.setAttribute("data-test-purchase-id", this.purchaseId);
    this.root.setAttribute("data-test-ticket-color", firstTicket.color ?? "");
    this.root.setAttribute("data-test-ticket-type", firstTicket.type ?? "large");
    // Per-bong-pris × 3 så total kan parses av Playwright-tester.
    this.root.setAttribute("data-test-ticket-price", String(Math.round(opts.price * 3)));

    const bg = tripletBackgroundFor(firstTicket.color);
    const headerColor = tripletHeaderColorFor(firstTicket.color);
    Object.assign(this.root.style, {
      background: bg,
      color: headerColor,
    });

    // ── Header: navn + pris + × cancel ────────────────────────────────────
    const header = document.createElement("div");
    header.className = "bong-triplet-header";

    this.headerNameEl = document.createElement("div");
    this.headerNameEl.className = "bong-triplet-name";
    const colorLabel = getColorDisplayLabel(firstTicket.color);
    this.headerNameEl.textContent = `${colorLabel} - 3 bonger`;
    header.appendChild(this.headerNameEl);

    this.headerPriceEl = document.createElement("div");
    this.headerPriceEl.className = "bong-triplet-price";
    // Trippel-pris: per-ticket price × 3. opts.price er allerede skalert
    // av TicketGridHtml.computePrice for ticket-color (auto-mult 1/2/3).
    const totalPrice = Math.round(opts.price * 3);
    this.headerPriceEl.textContent =
      typeof opts.price === "number" && opts.price > 0 ? `${totalPrice} kr` : "";
    header.appendChild(this.headerPriceEl);

    if (opts.cancelable && this.purchaseId) {
      const btn = document.createElement("button");
      btn.className = "bong-triplet-cancel";
      btn.textContent = "×";
      btn.setAttribute("aria-label", "Avbestill trippel-bong");
      const purchaseId = this.purchaseId;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        opts.onCancel?.(purchaseId);
      });
      header.appendChild(btn);
    }

    this.root.appendChild(header);

    // ── 3 sub-grids + 2 dividers ──────────────────────────────────────────
    const gridsContainer = document.createElement("div");
    gridsContainer.className = "bong-triplet-grids";

    for (let i = 0; i < 3; i++) {
      const sub = document.createElement("div");
      sub.className = "bong-triplet-sub";

      const subTicket = opts.tickets[i];
      // Sub-bongens cancel-knapp er IKKE rendret (header er skjult av CSS),
      // men vi setter `cancelable: false` for å være eksplisitt — sub-bongen
      // skal ALDRI canceleres individuelt.
      const child = new BingoTicketHtml({
        ticket: subTicket,
        price: opts.price,
        rows: opts.rows,
        cols: opts.cols,
        cancelable: false,
      });
      // Marker sub-bongens root med en klasse så CSS-overridene matcher.
      child.root.classList.add("triple-sub-root");
      sub.appendChild(child.root);
      this.inner.push(child);

      gridsContainer.appendChild(sub);

      // Mellom sub 0-1 og 1-2: legg inn 1px-divider.
      if (i < 2) {
        const divider = document.createElement("div");
        divider.className = "bong-triplet-divider";
        gridsContainer.appendChild(divider);
      }
    }

    this.root.appendChild(gridsContainer);
  }

  // ── Public API (speilet fra BingoTicketHtml) ──────────────────────────────

  /** Mark a drawn number on alle 3 sub-tickets. Returnerer true hvis noen matchet. */
  markNumber(number: number): boolean {
    let anyHit = false;
    for (const child of this.inner) {
      if (child.markNumber(number)) anyHit = true;
    }
    return anyHit;
  }

  markNumbers(numbers: number[]): void {
    for (const child of this.inner) {
      child.markNumbers(numbers);
    }
  }

  /** Reset alle sub-bongers mark-state. */
  reset(): void {
    for (const child of this.inner) {
      child.reset();
    }
  }

  /** Highlight lucky-number på alle 3 sub-bonger. */
  highlightLuckyNumber(number: number): void {
    for (const child of this.inner) {
      child.highlightLuckyNumber(number);
    }
  }

  /** Aggregert remaining-count (sum av alle 3). Brukes ikke av default caller-pathen
   *  men eksponeres for API-paritet med BingoTicketHtml. */
  getRemainingCount(): number {
    let sum = 0;
    for (const child of this.inner) {
      sum += child.getRemainingCount();
    }
    return sum;
  }

  /** Propager aktiv pattern til alle 3 sub-bonger. */
  setActivePattern(pattern: PatternDefinition | null): void {
    for (const child of this.inner) {
      child.setActivePattern(pattern);
    }
  }

  /**
   * `loadTicket` er ikke støttet på triplets — sub-tickets endrer ikke
   * struktur etter konstruksjon. Hvis purchase-data endres må caller rive
   * ned triplet og bygge en ny via `TicketGridHtml.setTickets()`. Method
   * eksponeres for API-paritet men logger advarsel hvis kalt.
   */
  loadTicket(_ticket: Ticket): void {
    if (typeof console !== "undefined") {
      console.warn(
        "[BingoTicketTripletHtml] loadTicket() not supported; rebuild the triplet via TicketGridHtml.setTickets()",
      );
    }
  }

  destroy(): void {
    for (const child of this.inner) {
      child.destroy();
    }
    this.inner.length = 0;
    this.root.remove();
  }
}
