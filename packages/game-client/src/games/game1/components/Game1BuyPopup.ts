import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";
// OBS-5: PostHog event-analytics. trackEvent is a no-op when
// VITE_POSTHOG_API_KEY is unset; in prod we record buy-popup-show +
// confirm-success/error so we can build a per-hall purchase funnel.
import { trackEvent as posthogTrackEvent } from "../../../observability/posthogBootstrap.js";

/**
 * Maks antall vektede brett én spiller kan kjøpe per runde.
 *
 * Speiler Unity `BingoTemplates.cs:86` (`maxPurchaseTicket = 30`) og backend
 * håndhevelse i `apps/backend/src/sockets/gameEvents.ts:533-547` + DB CHECK i
 * `migrations/20260413000002_max_tickets_30_all_games.sql`.
 */
const MAX_WEIGHTED_TICKETS = 30;

const FONT_STACK = "'Poppins', system-ui, sans-serif";

/**
 * Tobias-bekreftet 2026-05-15 IMMUTABLE design fra
 * `packages/game-client/src/kjopsmodal-design/kjopsmodal-design.html` mockup.
 *
 * Bong-farge-palette matcher COLORS i mockup-JSX. Samme hex som
 * mockup-JSX (kjopsmodal-design.jsx linjene 19-23).
 */
interface BongPaletteEntry {
  /** Bakgrunns-farge på premie-cellen og BongMini-rutene. */
  bg: string;
  /** Border-farge på premie-cellen (`box-shadow inset`). */
  border: string;
  /** Tekstfarge på premie-cellen (mørk for kontrast). */
  inkOnBg: string;
}

const BONG_PALETTE: Record<"white" | "yellow" | "purple", BongPaletteEntry> = {
  white: { bg: "#e8e4dc", border: "rgba(255,255,255,0.4)", inkOnBg: "#1a0808" },
  yellow: { bg: "#f0b92e", border: "rgba(240,185,46,0.6)", inkOnBg: "#2a1a00" },
  purple: { bg: "#b8a4e8", border: "rgba(184,164,232,0.55)", inkOnBg: "#2a1040" },
};

const COLOR_DISPLAY_NAMES: Record<"white" | "yellow" | "purple", string> = {
  white: "Hvit",
  yellow: "Gul",
  purple: "Lilla",
};

/**
 * Premietabell-rader (5 faser). Brukes både i `PrizeMatrix` over kjøpslisten
 * og som premie-data over `ticketConfig`. Base-beløp er i ØRE, og auto-
 * multiplikatoren `actualPrize = base × (ticketPriceCents / 500)` matcher
 * `SPILL_REGLER_OG_PAYOUT.md §3.1`.
 *
 * Tobias-direktiv 2026-05-15: hvis backend ikke har levert plan-runtime
 * phases-data, fall tilbake til disse baselines fra mockup-en:
 *   1 Rad     = 100 kr
 *   2 Rader   = 200 kr
 *   3 Rader   = 200 kr
 *   4 Rader   = 200 kr
 *   Fullt Hus = 1000 kr
 */
interface PhaseRow {
  /** Kort intern id. */
  id: "rad1" | "rad2" | "rad3" | "rad4" | "fullhus";
  /** Visuell label i premietabellen. */
  label: string;
  /** Base-premie i ØRE (multipliseres med ticketPrice/500). */
  baseCents: number;
}

const DEFAULT_PHASES: ReadonlyArray<PhaseRow> = [
  { id: "rad1", label: "1 Rad", baseCents: 10000 },
  { id: "rad2", label: "2 Rader", baseCents: 20000 },
  { id: "rad3", label: "3 Rader", baseCents: 20000 },
  { id: "rad4", label: "4 Rader", baseCents: 20000 },
  { id: "fullhus", label: "Fullt Hus", baseCents: 100000 },
];

/**
 * Mockup-palette konstanter (gjentas fra `kjopsmodal-design.jsx` så de er
 * eksplisitte i koden).
 */
const TEXT = "#f5e8d8";
const TEXT_DIM = "rgba(245,232,216,0.55)";
const TEXT_FAINT = "rgba(245,232,216,0.4)";
const GOLD = "#f5c842";

/** Helper: konverter `#RRGGBB` → `R,G,B`-tuple for rgba-bruk. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/**
 * Map canonical farge-navn til palette-key. Robust mot case + sub-strings
 * (Small Yellow / Large Yellow / yellow / Yellow → "yellow").
 *
 * Ukjente farger faller tilbake til "yellow" så vi aldri throw'er — gjøres
 * dette skjult slik at hvis backend en gang sender en ny farge (eks. green),
 * popup-en rendrer noe gjenkjennelig istedenfor å crashe.
 */
function paletteKeyForColor(name: string): "white" | "yellow" | "purple" {
  const n = name.toLowerCase();
  if (n.includes("white") || n === "hvit") return "white";
  if (n.includes("purple") || n === "lilla") return "purple";
  return "yellow";
}

/** Brikke-farge fra type-navn. Speiler KjopsModal-paletten. */
function ticketColor(name: string): string {
  return BONG_PALETTE[paletteKeyForColor(name)].bg;
}

interface TypeRow {
  type: string;
  /** BIN-688: canonical ticket-type name sent to backend. */
  name: string;
  displayName: string;
  color: string;
  paletteKey: "white" | "yellow" | "purple";
  price: number;
  ticketCount: number;
  qty: number;
  row: HTMLDivElement;
  qtyLabel: HTMLSpanElement;
  plusBtn: HTMLButtonElement;
  minusBtn: HTMLButtonElement;
  stepper: HTMLDivElement;
}

/**
 * Tobias 2026-04-29 (post-orphan-fix UX): tap-status fra server.
 * Brukes til å rendere "Brukt i dag: X / Y kr"-header og advarsel
 * når < 25% gjenstår av grensen.
 */
export interface LossStateForBuyPopup {
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
  /** Optional walletBalance fra server (NOK). Hvis null, vises ikke. */
  walletBalance: number | null;
}

/**
 * Game 1 ticket purchase popup — kjøpsmodal-design.html prod-implementasjon
 * (Tobias-bekreftet 2026-05-15 IMMUTABLE).
 *
 * DOM-struktur (card.children — denne rekkefølgen er bevart for å holde
 * eksisterende test-helpers funksjonelle):
 *   [0] header        — title + summaryEl + lossStateEl
 *   [1] typesContainer — 6 ticket-rader (2-col grid)
 *   [2] prizeMatrixEl — NY: premietabell (5 phases × 3 farger)
 *   [3] statusMsg     — error / 30-brett-grense melding
 *   [4] sep           — separator før totalRow
 *   [5] buyBtn        — primær (grønn ved aktiv)
 *   [6] cancelBtn     — sekundær
 *
 * NB: typesContainer er fortsatt `card.children[1]` (test-kompatibelt).
 * PrizeMatrix er lagt til som ny child[2] mellom typesContainer og
 * statusMsg. totalRow er flyttet inn i en wrapper og slått sammen med
 * sep+buyBtn+cancelBtn rekkefølge for å bevare statusMsg=[3], buyBtn=[5].
 *
 * Beholder hele runtime-API uendret:
 *   - `showWithTypes(entryFee, ticketTypes, alreadyPurchased?, lossState?, displayName?)`
 *   - `setDisplayName(displayName)`
 *   - `setOnBuy(callback)`
 *   - `showResult(success, message?)`
 *   - `showPartialBuyResult({accepted, rejected, rejectionReason, lossState})`
 *   - `updateLossState(lossState)`
 *   - `getTotalTicketCount()`
 *   - `isShowing()` / `hide()`
 *   - `destroy()`
 */
export class Game1BuyPopup {
  private backdrop: HTMLDivElement;
  private card: HTMLDivElement;
  private summaryEl: HTMLDivElement;
  /**
   * Spillerklient-rebuild Fase 1 (2026-05-10): subtitle-element holdes på
   * instans-state slik at Game1Controller kan oppdatere det live når plan-
   * runtime aggregator pusher state-update (f.eks. master byttet plan-item).
   *
   * Default-tekst er "Bingo" (ikke "STANDARD") per Tobias-direktiv 2026-05-09:
   * spilleren skal ALDRI se en degradert variant-string.
   *
   * Tobias-bekreftet 2026-05-15 (kjopsmodal-design.html): hele header er
   * sentrert. Subtitle er fortsatt en `<div>` (test-kompatibel —
   * `Game1BuyPopup.displayName.test.ts` søker `overlay.querySelectorAll("div")`
   * etter letter-spacing 0.14em som uniqueness-marker).
   */
  private subtitleEl: HTMLDivElement;
  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): tap-status-header viser
   * "Brukt i dag: X / Y kr" + advarsel ved < 25% gjenstår. Skjult
   * når lossState ikke er gitt (legacy clients).
   */
  private lossStateEl: HTMLDivElement;
  private typesContainer: HTMLDivElement;
  /**
   * Premie-tabell (kjopsmodal-design.html). 5 phases × 3 farger. Plasseres
   * mellom typesContainer og statusMsg (card.children[2]). Re-rendres ved
   * hver `showWithTypes` med oppdaterte farger fra ticketConfig.
   */
  private prizeMatrixEl: HTMLDivElement;
  private statusMsg: HTMLDivElement;
  private totalBrettEl: HTMLDivElement;
  private totalKrEl: HTMLDivElement;
  private buyBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  /**
   * Sist-kjente catalog-display-navn fra plan-runtime aggregator. Brukes til
   * å holde subtitle synkronisert mellom show()-kall og live state-update
   * via `setDisplayName`. Default "Bingo" — vises hvis aggregator ikke har
   * noen plan som dekker (rommet er fortsatt åpent men ingen runde planlagt).
   */
  private currentDisplayName = "Bingo";

  /** Cached entryFee for prize-matrix render (oppdateres i `showWithTypes`). */
  private currentEntryFee = 10;
  /** Cached ticketTypes for prize-matrix farger (oppdateres i `showWithTypes`). */
  private currentTicketTypes: Array<{ name: string; type: string; priceMultiplier: number; ticketCount: number }> = [];

  private onBuy: ((selections: Array<{ type: string; qty: number; name?: string }>) => void) | null = null;
  private alreadyPurchased = 0;
  private typeRows: TypeRow[] = [];
  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): tracker hvilken state
   * popup-en er i. `idle` → bruker velger brett. `confirming` → har
   * sendt bet:arm, venter på ack. `error` → ack feilet, viser melding,
   * lar bruker prøve igjen. `success` → ack ok, popup auto-skjules.
   */
  private uiState: "idle" | "confirming" | "error" | "success" = "idle";

  constructor(overlay: HtmlOverlayManager) {
    this.backdrop = document.createElement("div");
    // data-test attributes (inert in production — only consumed by Playwright
    // pilot-flow tests in tests/e2e/spill1-pilot-flow.spec.ts). Adds zero
    // runtime cost since browsers store attribute strings; not used by CSS.
    this.backdrop.setAttribute("data-test", "buy-popup-backdrop");
    // KRITISK: Ingen backdrop-filter (PR #468-mønster) — popup ligger over Pixi-canvas;
    // backdrop-filter trigger composite-recompute hver Pixi-frame → blink ved ball-trekk.
    // Mørkere semi-transparent bakgrunn alene gir tilsvarende fokus-effekt.
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0, 0, 0, 0.78)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "60",
      pointerEvents: "auto",
    });
    this.backdrop.addEventListener("click", (e) => {
      if (e.target !== this.backdrop) return;
      // Tobias 2026-04-29 (UX-fix): blokk lukking under `confirming` —
      // bruker MÅ se ack-result.
      if (this.uiState === "confirming") return;
      this.hide();
    });
    overlay.getRoot().appendChild(this.backdrop);

    this.card = document.createElement("div");
    Object.assign(this.card.style, {
      background: "radial-gradient(ellipse at top, #2a0f12 0%, #1a0809 70%, #140607 100%)",
      borderRadius: "18px",
      padding: "22px",
      color: TEXT,
      fontFamily: FONT_STACK,
      boxShadow: "0 30px 80px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255, 200, 120, 0.08)",
      width: "min(580px, 92vw)",
      maxHeight: "90vh",
      overflowY: "auto",
      position: "relative",
      boxSizing: "border-box",
    });
    this.backdrop.appendChild(this.card);

    // ── [0] Header (centered "Neste spill" + subtitle) ─────────────────────
    //
    // Test-kompatibilitet:
    //   header.children[0] = title-div ("Neste spill")
    //   header.children[1] = subtitle-div (letter-spacing 0.14em — uniqueness-marker for displayName.test.ts)
    //   header.children[2] = summaryEl
    //   header.children[3] = lossStateEl
    //
    // Mockup viser title som "Neste spill: Bingo" sentrert. Vi holder
    // strukturen som to separate `<div>`-er istedet for inline-span fordi
    // displayName.test.ts kun søker `<div>`-elementer for å finne subtitle.
    // Resultatet visuelt: "Neste spill" på linje 1, "Bingo" på linje 2 med
    // gull-farge — som matcher mockup-en "Neste spill: <highlighted-name>".
    const header = document.createElement("div");
    Object.assign(header.style, {
      marginBottom: "18px",
      textAlign: "center",
    });

    const title = document.createElement("div");
    title.textContent = "Neste spill";
    Object.assign(title.style, {
      fontSize: "20px",
      fontWeight: "500",
      color: TEXT,
      letterSpacing: "-0.01em",
      lineHeight: "1.1",
    });
    header.appendChild(title);

    // Subtitle-div — letter-spacing 0.14em er uniqueness-marker for
    // displayName.test.ts. Default "Bingo" (catalog-display-navn).
    this.subtitleEl = document.createElement("div");
    this.subtitleEl.textContent = this.currentDisplayName;
    Object.assign(this.subtitleEl.style, {
      fontSize: "16px",
      fontWeight: "600",
      color: GOLD,
      letterSpacing: "0.14em",
      marginTop: "4px",
    });
    header.appendChild(this.subtitleEl);

    this.summaryEl = document.createElement("div");
    this.summaryEl.style.cssText = "margin-top:6px;";
    header.appendChild(this.summaryEl);

    // Tobias 2026-04-29 (post-orphan-fix UX): tap-status-header.
    // Skjult når lossState ikke er satt (legacy / tom).
    this.lossStateEl = document.createElement("div");
    Object.assign(this.lossStateEl.style, {
      marginTop: "10px",
      padding: "8px 10px",
      background: "rgba(255, 255, 255, 0.04)",
      border: "1px solid rgba(255, 255, 255, 0.06)",
      borderRadius: "6px",
      fontSize: "12px",
      lineHeight: "1.5",
      color: "rgba(245, 232, 216, 0.7)",
      display: "none",
    });
    header.appendChild(this.lossStateEl);

    this.card.appendChild(header);

    // ── [1] Types grid (2-col) ─────────────────────────────────────────────
    this.typesContainer = document.createElement("div");
    Object.assign(this.typesContainer.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      rowGap: "16px",
      columnGap: "65px",
    });
    this.card.appendChild(this.typesContainer);

    // ── [2] PrizeMatrix (NY: kjopsmodal-design.html, Tobias 2026-05-15) ────
    this.prizeMatrixEl = document.createElement("div");
    Object.assign(this.prizeMatrixEl.style, {
      padding: "14px 14px 12px",
      background: "rgba(245,184,65,0.07)",
      border: "1px solid rgba(255,255,255,0.22)",
      borderRadius: "12px",
      marginTop: "18px",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(255,255,255,0.04)",
    });
    this.card.appendChild(this.prizeMatrixEl);

    // ── [3] Status message (for 30-brett-grense) ───────────────────────────
    this.statusMsg = document.createElement("div");
    Object.assign(this.statusMsg.style, {
      fontSize: "13px",
      color: "#ff6b6b",
      textAlign: "center",
      minHeight: "18px",
      marginTop: "18px",
      marginBottom: "8px",
    });
    this.card.appendChild(this.statusMsg);

    // ── [4] Separator (mellom statusMsg og totalRow) ───────────────────────
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;background:rgba(245,232,216,0.08);margin:0 0 14px;";
    this.card.appendChild(sep);

    // ── Total row (inni en wrapper-div for å bevare child-indices) ─────────
    //
    // NB: totalRow legges inn FØR buyBtn/cancelBtn for å holde card.children-
    // indices stabile for test-helpers (buyBtn=[5], cancelBtn=[6]).
    // Tests beregner sep=[4] men leser ikke fra det direkte; totalRow er
    // hoist-et inn i sep-elementet (wrapper) for å holde child-tellet.
    const totalRow = document.createElement("div");
    Object.assign(totalRow.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "14px",
    });

    const totalLeft = document.createElement("div");
    const totalLbl = document.createElement("div");
    totalLbl.textContent = "Totalt";
    Object.assign(totalLbl.style, {
      fontSize: "13px",
      color: TEXT_DIM,
      fontWeight: "500",
    });
    this.totalBrettEl = document.createElement("div");
    this.totalBrettEl.setAttribute("data-test", "buy-popup-total-brett");
    this.totalBrettEl.textContent = "0 brett";
    Object.assign(this.totalBrettEl.style, {
      fontSize: "22px",
      fontWeight: "600",
      color: TEXT,
      fontVariantNumeric: "tabular-nums",
      marginTop: "2px",
      letterSpacing: "-0.015em",
    });
    totalLeft.appendChild(totalLbl);
    totalLeft.appendChild(this.totalBrettEl);
    totalRow.appendChild(totalLeft);

    this.totalKrEl = document.createElement("div");
    this.totalKrEl.setAttribute("data-test", "buy-popup-total-kr");
    this.totalKrEl.textContent = "0 kr";
    Object.assign(this.totalKrEl.style, {
      fontSize: "22px",
      fontWeight: "600",
      color: TEXT,
      fontVariantNumeric: "tabular-nums",
      letterSpacing: "-0.015em",
    });
    totalRow.appendChild(this.totalKrEl);
    // Append totalRow til sep-elementet (gjør sep-elementet en wrapper).
    // Dette holder card.children-indices stabile uten å bryte layout.
    sep.appendChild(totalRow);

    // ── [5] Buy button ─────────────────────────────────────────────────────
    this.buyBtn = document.createElement("button");
    this.buyBtn.setAttribute("data-test", "buy-popup-confirm");
    this.buyBtn.textContent = "Velg brett for å kjøpe";
    this.stylePrimaryBtn(this.buyBtn);
    this.buyBtn.addEventListener("click", () => this.handleBuy());
    this.card.appendChild(this.buyBtn);

    // ── [6] Cancel button ──────────────────────────────────────────────────
    this.cancelBtn = document.createElement("button");
    this.cancelBtn.setAttribute("data-test", "buy-popup-cancel");
    this.cancelBtn.textContent = "Avbryt";
    this.styleSecondaryBtn(this.cancelBtn);
    this.cancelBtn.addEventListener("click", () => {
      // Tobias 2026-04-29 (UX-fix): blokk lukking under `confirming` —
      // bruker MÅ se ack-result. Kjøpet kan ikke avbrytes etter bet:arm.
      if (this.uiState === "confirming") return;
      this.hide();
    });
    this.card.appendChild(this.cancelBtn);

    // Initial premie-matrise (default-phases, default-bongfarger).
    this.renderPrizeMatrix();
  }

  showWithTypes(
    entryFee: number,
    ticketTypes: Array<{ name: string; type: string; priceMultiplier: number; ticketCount: number }>,
    alreadyPurchased = 0,
    /**
     * Tobias 2026-04-29 (post-orphan-fix UX): tap-status fra server.
     * Hvis ikke gitt, lossState-headeren er skjult (legacy clients
     * eller free-play-rom uten compliance-tracking).
     */
    lossState?: LossStateForBuyPopup,
    /**
     * Spillerklient-rebuild Fase 1 (2026-05-10): valgfri override av
     * subtitle-displayName. Hvis ikke gitt beholder vi siste verdi satt
     * via `setDisplayName` (eller default "Bingo").
     */
    displayName?: string,
  ): void {
    if (ticketTypes.length === 0) return;

    // [BUY-DEBUG] Tobias-direktiv 2026-05-13: logger ticketTypes input
    // og resultater (per-row price) slik at vi kan se hva BuyPopup faktisk
    // viser per rad. Korrelerer med backend ENABLE_BUY_DEBUG-logs.
    const buyDebugEnabled =
      typeof window !== "undefined" &&
      typeof window.location !== "undefined" &&
      /[?&]debug=1/.test(window.location.search);
    if (buyDebugEnabled) {
      // eslint-disable-next-line no-console
      console.log("[BUY-DEBUG][client][Game1BuyPopup.showWithTypes][input]", {
        entryFee,
        ticketTypes,
        alreadyPurchased,
        lossState: lossState
          ? {
              dailyUsed: lossState.dailyUsed,
              dailyLimit: lossState.dailyLimit,
              walletBalance: lossState.walletBalance,
            }
          : null,
        displayName,
        rows: ticketTypes.map((tt) => ({
          name: tt.name,
          type: tt.type,
          priceMultiplier: tt.priceMultiplier,
          ticketCount: tt.ticketCount,
          rowLabelPriceKr: Math.round(entryFee * tt.priceMultiplier),
          formula: `entryFee(${entryFee}) × priceMultiplier(${tt.priceMultiplier}) = ${Math.round(entryFee * tt.priceMultiplier)} kr (bundle-pris pr. kjøp)`,
        })),
      });
    }

    this.alreadyPurchased = Math.max(0, alreadyPurchased);
    this.currentEntryFee = entryFee;
    this.currentTicketTypes = ticketTypes.slice();
    this.typesContainer.innerHTML = "";
    this.typeRows = [];
    this.uiState = "idle";

    if (displayName !== undefined) {
      this.setDisplayName(displayName);
    }

    for (const tt of ticketTypes) {
      const price = Math.round(entryFee * tt.priceMultiplier);
      const displayName = this.getDisplayName(tt);
      this.buildTypeRow(displayName, tt.type, tt.name, price, tt.ticketCount);
    }

    // Re-render premie-matrise med oppdaterte farger fra current ticket-set.
    this.renderPrizeMatrix();

    // Tobias-bug 2026-05-13 (autonomous-pilot-test-loop): etter en
    // vellykket kjøp setter `showResult(true)` cancelBtn til styled-disabled
    // (opacity 0.5, cursor:default). Hvis spilleren åpner popup-en på nytt
    // (eks. via "Kjøp flere brett"-knapp) er cancelBtn-staten STALE og
    // brukeren kan ikke avbryte. updateTotal() reseter buyBtn men IKKE
    // cancelBtn. Vi resetter cancelBtn eksplisitt her som del av
    // showWithTypes-init.
    this.cancelBtn.disabled = false;
    this.cancelBtn.style.opacity = "1";
    this.cancelBtn.style.cursor = "pointer";
    this.cancelBtn.textContent = "Avbryt";

    this.statusMsg.textContent = "";
    this.renderLossState(lossState);
    this.updateTotal();
    this.backdrop.style.display = "flex";

    // OBS-5: PostHog analytics — popup-show event. Lets us measure
    // open-rate, abandonment, and which ticket-types the player saw.
    posthogTrackEvent("client.buy.popup.show", {
      entryFee,
      ticketTypeCount: ticketTypes.length,
      alreadyPurchased: this.alreadyPurchased,
      displayName: this.currentDisplayName,
      walletBalance: lossState?.walletBalance ?? null,
      dailyUsed: lossState?.dailyUsed ?? null,
      dailyLimit: lossState?.dailyLimit ?? null,
    });
  }

  /**
   * Spillerklient-rebuild Fase 1 (2026-05-10): oppdater subtitle med
   * catalog-display-navn fra plan-runtime aggregator. Trygt å kalle både
   * mens popup-en er åpen og lukket — når åpen oppdateres DOM live; når
   * lukket lagres verdien til neste `showWithTypes`.
   *
   * Tom string eller falsy verdi mappes til "Bingo" (vi viser ALDRI tom
   * subtitle eller "STANDARD"-fallback per Tobias-direktiv 2026-05-09).
   */
  setDisplayName(displayName: string | null | undefined): void {
    const next = (displayName ?? "").trim() || "Bingo";
    this.currentDisplayName = next;
    if (this.subtitleEl) {
      this.subtitleEl.textContent = next;
    }
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): oppdater tap-status-header
   * dynamisk uten å gjenoppbygge popup-en. Brukes når `wallet:loss-state`
   * push kommer mens popup-en er åpen.
   */
  updateLossState(lossState: LossStateForBuyPopup | null): void {
    this.renderLossState(lossState ?? undefined);
  }

  private renderLossState(lossState?: LossStateForBuyPopup): void {
    if (!lossState) {
      this.lossStateEl.style.display = "none";
      return;
    }

    const dailyRemaining = Math.max(0, lossState.dailyLimit - lossState.dailyUsed);
    const monthlyRemaining = Math.max(0, lossState.monthlyLimit - lossState.monthlyUsed);
    const dailyPctLeft = lossState.dailyLimit > 0 ? dailyRemaining / lossState.dailyLimit : 1;
    const monthlyPctLeft = lossState.monthlyLimit > 0 ? monthlyRemaining / lossState.monthlyLimit : 1;
    const lowDaily = dailyPctLeft < 0.25;
    const lowMonthly = monthlyPctLeft < 0.25;
    const atDailyLimit = dailyRemaining === 0;
    const atMonthlyLimit = monthlyRemaining === 0;

    // Tone: rød hvis på grensen, oransje hvis < 25 % gjenstår, ellers
    // standard mute. Gir rolig progresjon mot regulatorisk varsel.
    let borderColor = "rgba(255, 255, 255, 0.06)";
    let bgColor = "rgba(255, 255, 255, 0.04)";
    let textColor = "rgba(245, 232, 216, 0.75)";
    if (atDailyLimit || atMonthlyLimit) {
      borderColor = "rgba(220, 38, 38, 0.4)";
      bgColor = "rgba(220, 38, 38, 0.08)";
      textColor = "#ffb3b3";
    } else if (lowDaily || lowMonthly) {
      borderColor = "rgba(245, 158, 11, 0.4)";
      bgColor = "rgba(245, 158, 11, 0.08)";
      textColor = "#fbd38d";
    }

    this.lossStateEl.style.display = "block";
    this.lossStateEl.style.borderColor = borderColor;
    this.lossStateEl.style.background = bgColor;
    this.lossStateEl.style.color = textColor;

    const lines: string[] = [];
    if (atDailyLimit) {
      lines.push(`<strong>Du har nådd dagens tapsgrense (${lossState.dailyUsed} / ${lossState.dailyLimit} kr)</strong>`);
    } else {
      lines.push(`Brukt i dag: <strong>${lossState.dailyUsed}</strong> / ${lossState.dailyLimit} kr (${dailyRemaining} kr igjen)`);
    }
    if (atMonthlyLimit) {
      lines.push(`<strong>Du har nådd månedens tapsgrense (${lossState.monthlyUsed} / ${lossState.monthlyLimit} kr)</strong>`);
    } else {
      lines.push(`Brukt i måned: <strong>${lossState.monthlyUsed}</strong> / ${lossState.monthlyLimit} kr (${monthlyRemaining} kr igjen)`);
    }
    if (typeof lossState.walletBalance === "number") {
      lines.push(`Saldo: <strong>${Math.round(lossState.walletBalance)}</strong> kr`);
    }
    this.lossStateEl.innerHTML = lines.join("<br>");
  }

  hide(): void {
    this.backdrop.style.display = "none";
  }

  isShowing(): boolean {
    return this.backdrop.style.display !== "none";
  }

  setOnBuy(callback: (selections: Array<{ type: string; qty: number; name?: string }>) => void): void {
    this.onBuy = callback;
  }

  getTotalTicketCount(): number {
    return this.typeRows.reduce((sum, r) => sum + r.qty * r.ticketCount, 0);
  }

  showResult(success: boolean, message?: string): void {
    if (success) {
      this.uiState = "success";
      this.statusMsg.style.color = "#81c784";
      this.statusMsg.textContent = message || "Registrert! Du er med i neste spill.";
      this.buyBtn.disabled = true;
      this.buyBtn.style.opacity = "0.5";
      this.buyBtn.style.cursor = "default";
      setTimeout(() => this.hide(), 1500);
      // OBS-5: PostHog analytics — confirm-success. Lets us measure the
      // open→confirm conversion rate per hall + ticket-count.
      posthogTrackEvent("client.buy.confirm.success", {
        ticketCount: this.getTotalTicketCount(),
        displayName: this.currentDisplayName,
      });
    } else {
      this.uiState = "error";
      this.statusMsg.style.color = "#ff6b6b";
      this.statusMsg.textContent = message || "Kjøp feilet. Prøv igjen.";
      this.buyBtn.disabled = false;
      this.buyBtn.style.opacity = "1";
      this.buyBtn.style.cursor = "pointer";
      this.buyBtn.textContent = "Prøv igjen";
      // Re-aktivér avbryt-knapp.
      this.cancelBtn.disabled = false;
      this.cancelBtn.style.opacity = "1";
      this.cancelBtn.style.cursor = "pointer";
      // OBS-5: PostHog analytics — confirm-error. Lets ops + product
      // identify error patterns (insufficient balance, daily limit etc.)
      // via PostHog cohort breakdown of the `message` property.
      posthogTrackEvent("client.buy.confirm.error", {
        ticketCount: this.getTotalTicketCount(),
        displayName: this.currentDisplayName,
        errorMessage: message ?? null,
      });
    }
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): vis partial-buy-result.
   * Forskjell fra `showResult(true)`: her viser vi en klar melding om
   * hva som ble avvist, ikke bare success.
   */
  showPartialBuyResult(input: {
    accepted: number;
    rejected: number;
    rejectionReason: "DAILY_LIMIT" | "MONTHLY_LIMIT" | null;
    lossState?: LossStateForBuyPopup;
  }): void {
    this.uiState = "success";
    const reasonText =
      input.rejectionReason === "MONTHLY_LIMIT"
        ? "månedens tapsgrense nådd"
        : "dagens tapsgrense nådd";
    const message = `${input.accepted} av ${input.accepted + input.rejected} bonger kjøpt — ${input.rejected} avvist (${reasonText}).`;
    this.statusMsg.style.color = "#fbbf24"; // amber for partial — neither full success nor failure
    this.statusMsg.textContent = message;
    if (input.lossState) {
      this.renderLossState(input.lossState);
    }
    this.buyBtn.disabled = true;
    this.buyBtn.style.opacity = "0.5";
    this.buyBtn.style.cursor = "default";
    // Lengre timeout enn vanlig success — bruker trenger tid til å lese
    // melding om hva som ble avvist.
    setTimeout(() => this.hide(), 3500);
  }

  destroy(): void {
    this.backdrop.remove();
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Tobias-direktiv 2026-05-11: norske UI-navn istedenfor engelske canonical.
   * `tt.name` (eks "Small White") brukes server-side for routing — vi MÅ
   * IKKE endre den. Display-navnet vises kun i UI.
   *
   *   "Small White"  → "Liten hvit"
   *   "Small Yellow" → "Liten gul"
   *   "Small Purple" → "Liten lilla"
   *   "Large White"  → "Stor hvit"
   *   "Large Yellow" → "Stor gul"
   *   "Large Purple" → "Stor lilla"
   */
  private static readonly NORWEGIAN_DISPLAY_NAMES: Readonly<Record<string, string>> = {
    "Small White": "Liten hvit",
    "Small Yellow": "Liten gul",
    "Small Purple": "Liten lilla",
    "Large White": "Stor hvit",
    "Large Yellow": "Stor gul",
    "Large Purple": "Stor lilla",
  };

  private getDisplayName(tt: { name: string; type: string }): string {
    if (tt.type === "elvis") return tt.name;
    if (tt.type === "traffic-light") return "Traffic Light";
    return Game1BuyPopup.NORWEGIAN_DISPLAY_NAMES[tt.name] ?? tt.name;
  }

  private buildTypeRow(
    displayName: string,
    type: string,
    canonicalName: string,
    price: number,
    ticketCount: number,
  ): void {
    const paletteKey = paletteKeyForColor(canonicalName);
    const color = BONG_PALETTE[paletteKey].bg;

    const row = document.createElement("div");
    // data-test slug uses canonical backend name (Small White / Large Yellow)
    // since that's stable, lowercase with hyphens. Inert in production.
    const rowTestSlug = canonicalName.toLowerCase().replace(/\s+/g, "-");
    row.setAttribute("data-test", `buy-popup-row-${rowTestSlug}`);
    Object.assign(row.style, {
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "10px 10px",
      margin: "0 -10px",
      borderRadius: "8px",
      background: "transparent",
    });

    // Left: brett-ikon + label + metadata
    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:11px;min-width:0;flex:1;";

    const brettMini = this.createBrettMini(color, paletteKey);
    left.appendChild(brettMini);

    const info = document.createElement("div");
    info.style.cssText = "min-width:0;";
    const label = document.createElement("div");
    label.textContent = displayName;
    Object.assign(label.style, {
      fontSize: "14px",
      fontWeight: "500",
      color: TEXT,
      lineHeight: "1.2",
    });
    info.appendChild(label);

    const meta = document.createElement("div");
    Object.assign(meta.style, {
      fontSize: "12px",
      color: TEXT_DIM,
      marginTop: "2px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
    });
    const priceTxt = document.createElement("span");
    priceTxt.setAttribute("data-test", `buy-popup-price-${rowTestSlug}`);
    priceTxt.textContent = `${price} kr`;
    meta.appendChild(priceTxt);

    const sep = document.createElement("span");
    sep.textContent = "·";
    sep.style.opacity = "0.4";
    meta.appendChild(sep);

    const brettBadge = document.createElement("span");
    brettBadge.innerHTML = `${ticketCount}&nbsp;brett`;
    Object.assign(brettBadge.style, {
      display: "inline-flex",
      alignItems: "center",
      padding: "1px 6px",
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "4px",
      fontSize: "11px",
      fontWeight: "500",
      color: "rgba(245,232,216,0.7)",
      whiteSpace: "nowrap",
      flexShrink: "0",
    });
    meta.appendChild(brettBadge);

    info.appendChild(meta);
    left.appendChild(info);
    row.appendChild(left);

    // Right: stepper (−/count/+)
    const stepper = document.createElement("div");
    Object.assign(stepper.style, {
      display: "inline-flex",
      alignItems: "center",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "8px",
      overflow: "hidden",
      height: "32px",
      fontFamily: FONT_STACK,
    });

    const minusBtn = this.createStepBtn("−");
    minusBtn.setAttribute("data-test", `buy-popup-minus-${rowTestSlug}`);
    const qtyLabel = document.createElement("span");
    qtyLabel.setAttribute("data-test", `buy-popup-qty-${rowTestSlug}`);
    qtyLabel.textContent = "0";
    Object.assign(qtyLabel.style, {
      minWidth: "26px",
      textAlign: "center",
      fontSize: "14px",
      fontWeight: "600",
      color: "rgba(245,232,216,0.55)",
      fontVariantNumeric: "tabular-nums",
    });
    const plusBtn = this.createStepBtn("+");
    plusBtn.setAttribute("data-test", `buy-popup-plus-${rowTestSlug}`);

    stepper.appendChild(minusBtn);
    stepper.appendChild(qtyLabel);
    stepper.appendChild(plusBtn);
    row.appendChild(stepper);

    // Legacy DOM-compat for eksisterende tester: qtyRow er siste child på `row`,
    // rekkefølge [minus, qtyLabel, plus] matcher forventet struktur.

    const entry: TypeRow = {
      type,
      name: canonicalName,
      displayName,
      color,
      paletteKey,
      price,
      ticketCount,
      qty: 0,
      row,
      qtyLabel,
      plusBtn,
      minusBtn,
      stepper,
    };
    this.typeRows.push(entry);

    minusBtn.addEventListener("click", () => {
      if (entry.qty > 0) {
        entry.qty--;
        this.updateTotal();
      }
    });
    plusBtn.addEventListener("click", () => {
      if (plusBtn.disabled) return;
      entry.qty++;
      this.updateTotal();
    });

    this.typesContainer.appendChild(row);
  }

  /** BrettMini: 3×3 grid med små fargede ruter. */
  private createBrettMini(color: string, paletteKey?: "white" | "yellow" | "purple"): HTMLDivElement {
    // Fall-back: hvis paletteKey ikke gitt, infer fra color (gammel call-site
    // compat — tester kan kalle uten paletteKey).
    const key = paletteKey ?? (color === BONG_PALETTE.white.bg ? "white" : color === BONG_PALETTE.purple.bg ? "purple" : "yellow");
    const isLight = key === "white";
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      display: "grid",
      gridTemplateColumns: "repeat(3, 5px)",
      gap: "1.5px",
      padding: "3px",
      background: "rgba(0,0,0,0.25)",
      borderRadius: "3px",
      border: "1px solid rgba(255,255,255,0.06)",
      flexShrink: "0",
    });
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("div");
      Object.assign(cell.style, {
        width: "5px",
        height: "5px",
        background: color,
        borderRadius: "1px",
        boxShadow: isLight ? "inset 0 0 0 0.5px rgba(0,0,0,0.1)" : "none",
      });
      wrap.appendChild(cell);
    }
    return wrap;
  }

  private createStepBtn(text: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    Object.assign(btn.style, {
      width: "30px",
      height: "100%",
      border: "none",
      background: "transparent",
      color: "rgba(245,232,216,0.75)",
      fontSize: "15px",
      cursor: "pointer",
      padding: "0",
      fontFamily: FONT_STACK,
    });
    return btn;
  }

  // ── PrizeMatrix render (kjopsmodal-design.html, Tobias 2026-05-15) ──────

  /**
   * MiniBongChip — liten dekorativ chip (18×13) i header-kolonnene over
   * premie-radene. Speiler `MiniBongChip` i mockup-JSX.
   */
  private createMiniBongChip(paletteEntry: BongPaletteEntry): HTMLDivElement {
    const chip = document.createElement("div");
    Object.assign(chip.style, {
      width: "18px",
      height: "13px",
      borderRadius: "2.5px",
      background: paletteEntry.bg,
      boxShadow: `0 1px 3px rgba(0,0,0,0.4), inset 0 0 0 1px ${paletteEntry.border}`,
      position: "relative",
      flexShrink: "0",
    });
    const inner = document.createElement("div");
    Object.assign(inner.style, {
      position: "absolute",
      inset: "2px",
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gridTemplateRows: "repeat(2, 1fr)",
      gap: "0.8px",
    });
    for (let i = 0; i < 6; i++) {
      const dot = document.createElement("div");
      Object.assign(dot.style, {
        background: "rgba(0,0,0,0.22)",
        borderRadius: "0.5px",
      });
      inner.appendChild(dot);
    }
    chip.appendChild(inner);
    return chip;
  }

  /**
   * Resolverer hvilke bongfarger som skal vises i premie-matrise-headeren.
   *
   * Foretrukket rekkefølge:
   *   1. Unike paletteKeys fra `currentTicketTypes` (filter til de 3 vi
   *      kjenner i `BONG_PALETTE`)
   *   2. Hvis tom — fall tilbake til ["white", "yellow", "purple"] i
   *      kanonisk rekkefølge (gir noe meningsfullt før første `showWithTypes`)
   */
  private resolveMatrixColors(): Array<"white" | "yellow" | "purple"> {
    const seen = new Set<"white" | "yellow" | "purple">();
    for (const tt of this.currentTicketTypes) {
      const key = paletteKeyForColor(tt.name);
      seen.add(key);
    }
    // Stabil kanonisk rekkefølge — så Hvit kommer alltid før Gul før Lilla.
    const order: Array<"white" | "yellow" | "purple"> = ["white", "yellow", "purple"];
    const filtered = order.filter((k) => seen.has(k));
    return filtered.length > 0 ? filtered : order;
  }

  /**
   * Resolverer ticket-price (cents) per palette-farge fra
   * `currentTicketTypes`. Brukes til auto-multiplikator i premie-matrisen.
   *
   * Fall-back: 5/10/15 kr (500/1000/1500 øre) hvis ingen aktiv config.
   *
   * Tobias-direktiv 2026-05-15: hvis flere bonger har samme farge (eks.
   * Small Yellow + Large Yellow), bruker vi billigste (Small) som basis
   * for premie-matrisen — den representerer "denne fargen koster X kr per
   * brett" og auto-multiplikatoren skalerer derfra.
   */
  private ticketPriceCentsForColor(key: "white" | "yellow" | "purple"): number {
    const matching = this.currentTicketTypes.filter(
      (tt) => paletteKeyForColor(tt.name) === key,
    );
    if (matching.length === 0) {
      // Default fra mockup: white=500 / yellow=1000 / purple=1500
      return key === "white" ? 500 : key === "yellow" ? 1000 : 1500;
    }
    // Sort by priceMultiplier ascending — small (1) < large (3). Bruk
    // billigste som basis (den representerer enkelt-brett-pris i fargen).
    matching.sort((a, b) => a.priceMultiplier - b.priceMultiplier);
    const cheapest = matching[0]!;
    // entryFee * priceMultiplier = bundle-pris i kr. ticketCount = antall
    // brett i bundle. Per-brett-pris i øre = bundle-kr * 100 / ticketCount.
    const ticketCount = Math.max(1, cheapest.ticketCount);
    return Math.round((this.currentEntryFee * cheapest.priceMultiplier * 100) / ticketCount);
  }

  /**
   * Auto-multiplikator-formel fra `SPILL_REGLER_OG_PAYOUT.md §3.1`:
   *   `actualPrize = base × (ticketPriceCents / 500)`
   *
   * Returnerer NOK (heltall) for visning i premie-matrisen.
   */
  private calculatePrizeForRow(baseCents: number, ticketPriceCents: number): number {
    const actualCents = (baseCents * ticketPriceCents) / 500;
    // Returner i kroner (avrundet ned via Math.round for konsistens med
    // backend payout — som bruker `Math.round(rawCents / 100)` på samme måte).
    return Math.round(actualCents / 100);
  }

  /**
   * Render premie-matrise. Idempotent — kalles fra constructor (default)
   * og fra `showWithTypes` (når ticketTypes endrer seg).
   */
  private renderPrizeMatrix(): void {
    this.prizeMatrixEl.innerHTML = "";

    const colors = this.resolveMatrixColors();
    const gridTemplate = `92px repeat(${colors.length}, minmax(0, 1fr))`;

    // ── Header-rad: "PREMIETABELL" + farge-chips ─────────────────────────
    const headerRow = document.createElement("div");
    Object.assign(headerRow.style, {
      display: "grid",
      gridTemplateColumns: gridTemplate,
      columnGap: "6px",
      alignItems: "center",
      padding: "0 10px 8px",
    });

    const headerLabel = document.createElement("div");
    headerLabel.textContent = "Premietabell";
    Object.assign(headerLabel.style, {
      fontSize: "11px",
      fontWeight: "700",
      color: GOLD,
      // letter-spacing 0.12em — bevisst forskjellig fra subtitle (0.14em)
      // for å unngå at displayName.test.ts sin getSubtitleText() finner
      // dette elementet i stedet for subtitle-spanen.
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      textAlign: "center",
    });
    headerRow.appendChild(headerLabel);

    for (const key of colors) {
      const palette = BONG_PALETTE[key];
      const headerCell = document.createElement("div");
      Object.assign(headerCell.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "5px",
      });
      headerCell.appendChild(this.createMiniBongChip(palette));
      const nameLabel = document.createElement("span");
      nameLabel.textContent = COLOR_DISPLAY_NAMES[key];
      Object.assign(nameLabel.style, {
        fontSize: "11px",
        fontWeight: "700",
        color: TEXT,
        letterSpacing: "0.02em",
      });
      headerCell.appendChild(nameLabel);
      headerRow.appendChild(headerCell);
    }

    this.prizeMatrixEl.appendChild(headerRow);

    // ── Premie-rader (5 phases) ──────────────────────────────────────────
    const rowsWrap = document.createElement("div");
    Object.assign(rowsWrap.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    });

    for (const phase of DEFAULT_PHASES) {
      const phaseRow = document.createElement("div");
      Object.assign(phaseRow.style, {
        display: "grid",
        gridTemplateColumns: gridTemplate,
        columnGap: "6px",
        alignItems: "center",
        padding: "5px 10px",
        background: "rgba(0,0,0,0.38)",
        borderRadius: "999px",
        border: "1px solid rgba(255,255,255,0.22)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.25)",
      });

      const phaseLabel = document.createElement("div");
      phaseLabel.textContent = phase.label;
      Object.assign(phaseLabel.style, {
        fontSize: "13px",
        fontWeight: "700",
        color: TEXT,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        textAlign: "center",
      });
      phaseRow.appendChild(phaseLabel);

      for (const key of colors) {
        const palette = BONG_PALETTE[key];
        const ticketPriceCents = this.ticketPriceCentsForColor(key);
        const prize = this.calculatePrizeForRow(phase.baseCents, ticketPriceCents);

        const cell = document.createElement("div");
        cell.setAttribute("data-test", `buy-popup-prize-${phase.id}-${key}`);
        Object.assign(cell.style, {
          display: "flex",
          alignItems: "baseline",
          justifyContent: "center",
          gap: "3px",
          padding: "3px 8px",
          borderRadius: "6px",
          background: `linear-gradient(180deg, ${palette.bg} 0%, rgba(${hexToRgb(palette.bg)},0.88) 100%)`,
          boxShadow: `inset 0 0 0 1px ${palette.border}, 0 1px 3px rgba(0,0,0,0.3)`,
          color: palette.inkOnBg,
          fontVariantNumeric: "tabular-nums",
          lineHeight: "1",
          whiteSpace: "nowrap",
        });

        const prizeAmount = document.createElement("span");
        prizeAmount.textContent = String(prize);
        Object.assign(prizeAmount.style, {
          fontSize: "13px",
          fontWeight: "700",
          letterSpacing: "-0.01em",
        });
        cell.appendChild(prizeAmount);

        const prizeUnit = document.createElement("span");
        prizeUnit.textContent = "kr";
        Object.assign(prizeUnit.style, {
          fontSize: "9px",
          fontWeight: "500",
          opacity: "0.65",
        });
        cell.appendChild(prizeUnit);

        phaseRow.appendChild(cell);
      }

      rowsWrap.appendChild(phaseRow);
    }

    this.prizeMatrixEl.appendChild(rowsWrap);
  }

  /**
   * Rekalkuler total, status-melding, aktiv-styling og plus-knapp state.
   *
   * Vektet: `remaining = MAX - alreadyPurchased - Σ(qty × ticketCount)`.
   * Plus-knapp disables når ticketCount > remaining. Fra Unity
   * `PrefabGame1TicketPurchaseSubType.cs:48-58,76` (`AllowMorePurchase`).
   */
  private updateTotal(): void {
    const totalKr = this.typeRows.reduce((sum, r) => sum + r.qty * r.price, 0);
    const totalBrett = this.typeRows.reduce((sum, r) => sum + r.qty * r.ticketCount, 0);
    const remaining = MAX_WEIGHTED_TICKETS - this.alreadyPurchased - totalBrett;
    const atHardCap = this.alreadyPurchased >= MAX_WEIGHTED_TICKETS;

    // Oppdater total-visning
    this.totalKrEl.textContent = `${totalKr} kr`;
    this.totalBrettEl.textContent = `${totalBrett} brett`;

    // Per-rad: aktiv/inaktiv styling + plus-disabling + qty-label
    for (const r of this.typeRows) {
      r.qtyLabel.textContent = String(r.qty);
      const active = r.qty > 0;

      // Qty-label farge
      r.qtyLabel.style.color = active ? "#f5b841" : "rgba(245,232,216,0.55)";

      // Stepper-pill styling — aktiv = gyllen glow
      r.stepper.style.background = active ? "rgba(245, 184, 65, 0.12)" : "rgba(255,255,255,0.04)";
      r.stepper.style.border = `1px solid ${active ? "rgba(245, 184, 65, 0.4)" : "rgba(255,255,255,0.08)"}`;

      // Row-level highlight
      r.row.style.background = active ? "rgba(245,184,65,0.05)" : "transparent";
      r.row.style.boxShadow = active ? "inset 0 0 0 1px rgba(245,184,65,0.18)" : "none";

      // Plus-disabling
      const disable = atHardCap || r.ticketCount > remaining;
      r.plusBtn.disabled = disable;
      r.plusBtn.style.opacity = disable ? "0.35" : "1";
      r.plusBtn.style.cursor = disable ? "not-allowed" : "pointer";
    }

    // Status-melding
    if (atHardCap) {
      this.statusMsg.style.color = "#ffe83d";
      this.statusMsg.textContent = "Du har maks 30 brett denne runden";
    } else if (totalBrett === 0) {
      this.statusMsg.textContent = "";
    } else if (remaining === 0) {
      this.statusMsg.style.color = "#81c784";
      this.statusMsg.textContent = "Maks 30 brett valgt";
    } else {
      this.statusMsg.textContent = "";
    }

    // SelectedSummary pills (i header.summaryEl).
    this.renderSummary();

    // Buy-knapp state — grønn primær (kjopsmodal-design.html, Tobias 2026-05-15).
    const canBuy = !atHardCap && totalBrett > 0;
    this.buyBtn.disabled = !canBuy;
    if (canBuy) {
      this.buyBtn.textContent = `Kjøp ${totalBrett} brett · ${totalKr} kr`;
      this.buyBtn.style.background = "linear-gradient(180deg, #10b981 0%, #047857 100%)";
      this.buyBtn.style.color = "#fff";
      this.buyBtn.style.cursor = "pointer";
      this.buyBtn.style.boxShadow =
        "0 4px 14px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.22)";
    } else {
      this.buyBtn.textContent = "Velg brett for å kjøpe";
      this.buyBtn.style.background = "rgba(16,185,129,0.2)";
      this.buyBtn.style.color = TEXT_FAINT;
      this.buyBtn.style.cursor = "not-allowed";
      this.buyBtn.style.boxShadow = "none";
    }
  }

  private renderSummary(): void {
    const selected = this.typeRows.filter((r) => r.qty > 0);
    this.summaryEl.innerHTML = "";

    if (selected.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "Ingen brett valgt";
      Object.assign(empty.style, {
        fontSize: "12px",
        color: "rgba(245,232,216,0.4)",
        fontStyle: "italic",
        marginTop: "2px",
      });
      this.summaryEl.appendChild(empty);
      return;
    }

    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "6px",
      marginTop: "6px",
    });

    const label = document.createElement("span");
    label.textContent = "Du kjøper:";
    Object.assign(label.style, {
      fontSize: "12px",
      color: "rgba(245,232,216,0.55)",
      marginRight: "2px",
    });
    wrap.appendChild(label);

    for (const r of selected) {
      const pill = document.createElement("span");
      Object.assign(pill.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        background: "rgba(245,184,65,0.1)",
        border: "1px solid rgba(245,184,65,0.25)",
        borderRadius: "999px",
        padding: "3px 9px 3px 6px",
        fontSize: "12px",
        color: "#f5e8d8",
        fontWeight: "500",
      });
      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "10px",
        height: "10px",
        borderRadius: "2px",
        background: r.color,
        boxShadow: r.paletteKey === "white"
          ? "inset 0 0 0 1px rgba(0,0,0,0.15)"
          : "inset 0 1px 0 rgba(255,255,255,0.2)",
      });
      pill.appendChild(dot);
      pill.appendChild(document.createTextNode(`${r.qty}× ${r.displayName}`));
      wrap.appendChild(pill);
    }

    this.summaryEl.appendChild(wrap);
  }

  private handleBuy(): void {
    if (this.buyBtn.disabled) return;
    // Tobias 2026-04-29 (post-orphan-fix UX): transition til `confirming`-
    // state. Brukeren ser "Bekrefter kjøp..." mens vi venter på server-ack.
    // Cancel-knapp + backdrop-klikk er låst til ack kommer (success eller
    // error). Ingen bonger blir rendret før ack returneres.
    this.uiState = "confirming";
    this.buyBtn.disabled = true;
    this.buyBtn.style.opacity = "0.6";
    this.buyBtn.textContent = "Bekrefter kjøp…";
    this.cancelBtn.disabled = true;
    this.cancelBtn.style.opacity = "0.5";
    this.cancelBtn.style.cursor = "not-allowed";
    this.statusMsg.style.color = "rgba(245, 232, 216, 0.7)";
    this.statusMsg.textContent = "Sender forespørsel til server…";
    const selections = this.typeRows
      .filter((r) => r.qty > 0)
      .map((r) => ({ type: r.type, qty: r.qty, name: r.name }));

    // [BUY-DEBUG] Tobias-direktiv 2026-05-13: log eksakt selections array
    // som sendes til SocketActions.buy. Inkluderer alle typeRows (også
    // qty=0) for å se hva spilleren MÅSKE valgte men avviste.
    const buyDebugEnabled =
      typeof window !== "undefined" &&
      typeof window.location !== "undefined" &&
      /[?&]debug=1/.test(window.location.search);
    if (buyDebugEnabled) {
      // eslint-disable-next-line no-console
      console.log("[BUY-DEBUG][client][Game1BuyPopup.handleBuy][submit]", {
        selectionsSent: selections,
        allTypeRows: this.typeRows.map((r) => ({
          type: r.type,
          name: r.name,
          displayName: r.displayName,
          qty: r.qty,
          ticketCount: r.ticketCount,
        })),
        totalSelections: selections.length,
        totalQty: selections.reduce((sum, s) => sum + s.qty, 0),
        totalTickets: this.typeRows.reduce(
          (sum, r) => sum + r.qty * r.ticketCount,
          0,
        ),
      });
    }

    this.onBuy?.(selections);
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): test-helper — eksponert
   * for unit-tests.
   */
  getUiState(): "idle" | "confirming" | "error" | "success" {
    return this.uiState;
  }

  private stylePrimaryBtn(btn: HTMLButtonElement): void {
    Object.assign(btn.style, {
      width: "100%",
      border: "none",
      borderRadius: "10px",
      padding: "13px 16px",
      background: "rgba(16,185,129,0.2)",
      color: TEXT_FAINT,
      fontSize: "14px",
      fontWeight: "600",
      fontFamily: "inherit",
      cursor: "not-allowed",
      boxShadow: "none",
    });
  }

  private styleSecondaryBtn(btn: HTMLButtonElement): void {
    Object.assign(btn.style, {
      width: "100%",
      border: "1px solid rgba(245,232,216,0.14)",
      borderRadius: "10px",
      padding: "12px 16px",
      background: "transparent",
      color: "rgba(245,232,216,0.85)",
      fontSize: "14px",
      fontWeight: "500",
      fontFamily: "inherit",
      cursor: "pointer",
      marginTop: "8px",
    });
    btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,0.05)"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; });
  }
}
