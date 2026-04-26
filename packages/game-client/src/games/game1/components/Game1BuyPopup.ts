import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";

/**
 * Maks antall vektede brett én spiller kan kjøpe per runde.
 *
 * Speiler Unity `BingoTemplates.cs:86` (`maxPurchaseTicket = 30`) og backend
 * håndhevelse i `apps/backend/src/sockets/gameEvents.ts:533-547` + DB CHECK i
 * `migrations/20260413000002_max_tickets_30_all_games.sql`.
 */
const MAX_WEIGHTED_TICKETS = 30;

const FONT_STACK = "'Poppins', system-ui, sans-serif";

/** Brikke-farge fra type-navn. Speiler KjopsModal-paletten. */
function ticketColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("yellow")) return "#f5b841";
  if (n.includes("white")) return "#eeeae0";
  if (n.includes("purple")) return "#8b5cf6";
  if (n.includes("red")) return "#dc2626";
  if (n.includes("green")) return "#22c55e";
  if (n.includes("orange")) return "#f97316";
  return "#f5b841";
}

interface TypeRow {
  type: string;
  /** BIN-688: canonical ticket-type name sent to backend. */
  name: string;
  displayName: string;
  color: string;
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
 * Game 1 ticket purchase popup — KjopsModal-port (2026-04-24).
 *
 * 2-column layout med én rad per billett-type: [brett-ikon] [navn + pris] [stepper].
 * Beholder public API + 30-brett-grense-logikk fra forrige versjon.
 */
export class Game1BuyPopup {
  private backdrop: HTMLDivElement;
  private card: HTMLDivElement;
  private summaryEl: HTMLDivElement;
  private typesContainer: HTMLDivElement;
  private statusMsg: HTMLDivElement;
  private totalBrettEl: HTMLDivElement;
  private totalKrEl: HTMLDivElement;
  private buyBtn: HTMLButtonElement;

  private onBuy: ((selections: Array<{ type: string; qty: number; name?: string }>) => void) | null = null;
  private alreadyPurchased = 0;
  private typeRows: TypeRow[] = [];

  constructor(overlay: HtmlOverlayManager) {
    this.backdrop = document.createElement("div");
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
      if (e.target === this.backdrop) this.hide();
    });
    overlay.getRoot().appendChild(this.backdrop);

    this.card = document.createElement("div");
    Object.assign(this.card.style, {
      background: "radial-gradient(ellipse at top, #2a0f12 0%, #1a0809 70%, #140607 100%)",
      borderRadius: "18px",
      padding: "22px",
      color: "#f5e8d8",
      fontFamily: FONT_STACK,
      boxShadow: "0 30px 80px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255, 200, 120, 0.08)",
      width: "min(580px, 92vw)",
      maxHeight: "90vh",
      overflowY: "auto",
      position: "relative",
      boxSizing: "border-box",
    });
    this.backdrop.appendChild(this.card);

    // ── Header ─────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.style.cssText = "margin-bottom:18px;";
    const title = document.createElement("div");
    title.textContent = "Neste spill";
    Object.assign(title.style, {
      fontSize: "20px",
      fontWeight: "500",
      color: "#f5e8d8",
      letterSpacing: "-0.01em",
      lineHeight: "1.1",
    });
    header.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.textContent = "STANDARD";
    Object.assign(subtitle.style, {
      fontSize: "12px",
      fontWeight: "600",
      color: "#f5b841",
      letterSpacing: "0.14em",
      marginTop: "3px",
    });
    header.appendChild(subtitle);

    this.summaryEl = document.createElement("div");
    this.summaryEl.style.cssText = "margin-top:6px;";
    header.appendChild(this.summaryEl);

    this.card.appendChild(header);

    // ── Types grid (2-col) ─────────────────────────────────────────────────
    this.typesContainer = document.createElement("div");
    Object.assign(this.typesContainer.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      rowGap: "16px",
      columnGap: "65px",
    });
    this.card.appendChild(this.typesContainer);

    // ── Separator ──────────────────────────────────────────────────────────
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;background:rgba(245,232,216,0.08);margin:18px 0 14px;";
    this.card.appendChild(sep);

    // ── Status message (for 30-brett-grense) ───────────────────────────────
    this.statusMsg = document.createElement("div");
    Object.assign(this.statusMsg.style, {
      fontSize: "13px",
      color: "#ff6b6b",
      textAlign: "center",
      minHeight: "18px",
      marginBottom: "8px",
    });
    this.card.appendChild(this.statusMsg);

    // ── Total row ──────────────────────────────────────────────────────────
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
      color: "rgba(245,232,216,0.6)",
      fontWeight: "500",
    });
    this.totalBrettEl = document.createElement("div");
    this.totalBrettEl.textContent = "0 brett";
    Object.assign(this.totalBrettEl.style, {
      fontSize: "22px",
      fontWeight: "600",
      color: "#f5e8d8",
      fontVariantNumeric: "tabular-nums",
      marginTop: "2px",
      letterSpacing: "-0.015em",
    });
    totalLeft.appendChild(totalLbl);
    totalLeft.appendChild(this.totalBrettEl);
    totalRow.appendChild(totalLeft);

    this.totalKrEl = document.createElement("div");
    this.totalKrEl.textContent = "0 kr";
    Object.assign(this.totalKrEl.style, {
      fontSize: "22px",
      fontWeight: "600",
      color: "#f5e8d8",
      fontVariantNumeric: "tabular-nums",
      letterSpacing: "-0.015em",
    });
    totalRow.appendChild(this.totalKrEl);
    this.card.appendChild(totalRow);

    // ── Buttons ────────────────────────────────────────────────────────────
    this.buyBtn = document.createElement("button");
    this.buyBtn.textContent = "Velg brett for å kjøpe";
    this.stylePrimaryBtn(this.buyBtn);
    this.buyBtn.addEventListener("click", () => this.handleBuy());
    this.card.appendChild(this.buyBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Avbryt";
    this.styleSecondaryBtn(cancelBtn);
    cancelBtn.addEventListener("click", () => this.hide());
    this.card.appendChild(cancelBtn);
  }

  showWithTypes(
    entryFee: number,
    ticketTypes: Array<{ name: string; type: string; priceMultiplier: number; ticketCount: number }>,
    alreadyPurchased = 0,
  ): void {
    if (ticketTypes.length === 0) return;

    this.alreadyPurchased = Math.max(0, alreadyPurchased);
    this.typesContainer.innerHTML = "";
    this.typeRows = [];

    for (const tt of ticketTypes) {
      const price = Math.round(entryFee * tt.priceMultiplier);
      const displayName = this.getDisplayName(tt);
      this.buildTypeRow(displayName, tt.type, tt.name, price, tt.ticketCount);
    }

    this.statusMsg.textContent = "";
    this.updateTotal();
    this.backdrop.style.display = "flex";
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
      this.statusMsg.style.color = "#81c784";
      this.statusMsg.textContent = "Registrert! Du er med i neste spill.";
      this.buyBtn.disabled = true;
      this.buyBtn.style.opacity = "0.5";
      this.buyBtn.style.cursor = "default";
      setTimeout(() => this.hide(), 1500);
    } else {
      this.statusMsg.style.color = "#ff6b6b";
      this.statusMsg.textContent = message || "Kjøp feilet. Prøv igjen.";
      this.buyBtn.disabled = false;
      this.buyBtn.style.opacity = "1";
      this.buyBtn.style.cursor = "pointer";
    }
  }

  destroy(): void {
    this.backdrop.remove();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private getDisplayName(tt: { name: string; type: string }): string {
    if (tt.type === "elvis") return tt.name;
    if (tt.type === "traffic-light") return "Traffic Light";
    return tt.name;
  }

  private buildTypeRow(
    displayName: string,
    type: string,
    canonicalName: string,
    price: number,
    ticketCount: number,
  ): void {
    const color = ticketColor(canonicalName);

    const row = document.createElement("div");
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

    const brettMini = this.createBrettMini(color);
    left.appendChild(brettMini);

    const info = document.createElement("div");
    info.style.cssText = "min-width:0;";
    const label = document.createElement("div");
    label.textContent = displayName;
    Object.assign(label.style, {
      fontSize: "14px",
      fontWeight: "500",
      color: "#f5e8d8",
      lineHeight: "1.2",
    });
    info.appendChild(label);

    const meta = document.createElement("div");
    Object.assign(meta.style, {
      fontSize: "12px",
      color: "rgba(245,232,216,0.5)",
      marginTop: "2px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
    });
    const priceTxt = document.createElement("span");
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

    const minusBtn = this.createStepBtn("\u2212");
    const qtyLabel = document.createElement("span");
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
  private createBrettMini(color: string): HTMLDivElement {
    const isLight = color === "#eeeae0";
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

    // SelectedSummary pills
    this.renderSummary();

    // Buy-knapp state
    const canBuy = !atHardCap && totalBrett > 0;
    this.buyBtn.disabled = !canBuy;
    if (canBuy) {
      this.buyBtn.textContent = `Kjøp ${totalBrett} brett · ${totalKr} kr`;
      this.buyBtn.style.background = "linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)";
      this.buyBtn.style.color = "#fff";
      this.buyBtn.style.cursor = "pointer";
      this.buyBtn.style.boxShadow = "0 4px 14px rgba(220,38,38,0.35), inset 0 1px 0 rgba(255,255,255,0.2)";
    } else {
      this.buyBtn.textContent = "Velg brett for å kjøpe";
      this.buyBtn.style.background = "rgba(220, 38, 38, 0.25)";
      this.buyBtn.style.color = "rgba(245,232,216,0.4)";
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
        boxShadow: r.color === "#eeeae0"
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
    this.buyBtn.disabled = true;
    this.buyBtn.style.opacity = "0.6";
    this.buyBtn.textContent = "Vennligst vent...";
    this.statusMsg.textContent = "";
    const selections = this.typeRows
      .filter((r) => r.qty > 0)
      .map((r) => ({ type: r.type, qty: r.qty, name: r.name }));
    this.onBuy?.(selections);
  }

  private stylePrimaryBtn(btn: HTMLButtonElement): void {
    Object.assign(btn.style, {
      width: "100%",
      border: "none",
      borderRadius: "10px",
      padding: "13px 16px",
      background: "rgba(220, 38, 38, 0.25)",
      color: "rgba(245,232,216,0.4)",
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
