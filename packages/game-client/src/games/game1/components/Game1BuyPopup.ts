import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";

/**
 * Game 1 ticket purchase popup — matches Unity's Game1TicketPurchasePanel.
 *
 * Shows ticket type rows (currently "Bingo-brett") with qty +/- selectors,
 * total price, and buy/cancel buttons. Replaces the simpler PixiJS BuyPopup
 * from game2.
 *
 * Unity flow: Game1TicketPurchasePanel → SelectPurchaseTypePanel → BetArm(true)
 * In Unity, SelectPurchaseTypePanel is currently hardcoded to "realMoney",
 * so we skip it and go directly to bet:arm on confirm.
 */
export class Game1BuyPopup {
  private backdrop: HTMLDivElement;
  private card: HTMLDivElement;
  private qtyLabel: HTMLSpanElement;
  private totalLabel: HTMLDivElement;
  private buyBtn: HTMLButtonElement;
  private statusMsg: HTMLDivElement;

  private ticketPrice = 0;
  private currentQty = 1;
  private minQty = 1;
  private maxQty = 30;
  /** BIN-447: Weight = actual tickets generated per purchase unit. */
  private ticketWeight = 1;
  private onBuy: (() => void) | null = null;

  constructor(private overlay: HtmlOverlayManager) {
    // Full-screen backdrop
    this.backdrop = document.createElement("div");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.8)",
      backdropFilter: "blur(4px)",
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

    // Popup card
    this.card = document.createElement("div");
    Object.assign(this.card.style, {
      background: "linear-gradient(180deg, #3a0a0a 0%, #1a0000 100%)",
      border: "2px solid #790001",
      borderRadius: "16px",
      padding: "28px 32px",
      minWidth: "340px",
      maxWidth: "420px",
      width: "90%",
      boxShadow: "0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)",
    });
    this.backdrop.appendChild(this.card);

    // Title
    const title = document.createElement("h2");
    title.textContent = "Kjøp billetter";
    Object.assign(title.style, {
      margin: "0 0 20px 0",
      fontSize: "22px",
      fontWeight: "700",
      color: "#ffe83d",
      textAlign: "center",
    });
    this.card.appendChild(title);

    // Ticket type row
    const typeRow = document.createElement("div");
    Object.assign(typeRow.style, {
      background: "rgba(0,0,0,0.3)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "10px",
      padding: "16px",
      marginBottom: "20px",
    });

    // Type header: name + price
    const typeHeader = document.createElement("div");
    typeHeader.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;";

    const typeName = document.createElement("span");
    typeName.textContent = "Bingo-brett";
    Object.assign(typeName.style, {
      fontSize: "17px",
      fontWeight: "600",
      color: "#fff",
    });
    typeHeader.appendChild(typeName);

    const typePrice = document.createElement("span");
    typePrice.className = "g1-buy-price";
    Object.assign(typePrice.style, {
      fontSize: "15px",
      color: "#ccc",
    });
    typeHeader.appendChild(typePrice);
    this.card.querySelector(".g1-buy-price"); // reference later

    typeRow.appendChild(typeHeader);

    // Qty selector row
    const qtyRow = document.createElement("div");
    qtyRow.style.cssText = "display:flex;align-items:center;justify-content:center;gap:16px;";

    const minusBtn = this.createRoundBtn("\u2212");
    minusBtn.addEventListener("click", () => this.adjustQty(-1));
    qtyRow.appendChild(minusBtn);

    this.qtyLabel = document.createElement("span");
    this.qtyLabel.textContent = "1";
    Object.assign(this.qtyLabel.style, {
      fontSize: "28px",
      fontWeight: "700",
      color: "#fff",
      minWidth: "48px",
      textAlign: "center",
    });
    qtyRow.appendChild(this.qtyLabel);

    const plusBtn = this.createRoundBtn("+");
    plusBtn.addEventListener("click", () => this.adjustQty(1));
    qtyRow.appendChild(plusBtn);

    typeRow.appendChild(qtyRow);
    this.card.appendChild(typeRow);

    // Store price reference
    this.card.appendChild(this.createSep());

    // Total row
    this.totalLabel = document.createElement("div");
    Object.assign(this.totalLabel.style, {
      fontSize: "18px",
      fontWeight: "600",
      color: "#fff",
      textAlign: "center",
      margin: "14px 0 18px",
    });
    this.card.appendChild(this.totalLabel);

    // Status message (shown on error)
    this.statusMsg = document.createElement("div");
    Object.assign(this.statusMsg.style, {
      fontSize: "14px",
      color: "#ff6b6b",
      textAlign: "center",
      margin: "0 0 10px",
      minHeight: "20px",
    });
    this.card.appendChild(this.statusMsg);

    // Button row
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;flex-direction:column;gap:10px;";

    this.buyBtn = document.createElement("button");
    this.buyBtn.textContent = "Kjøp";
    this.stylePrimaryBtn(this.buyBtn);
    this.buyBtn.addEventListener("click", () => this.handleBuy());
    btnRow.appendChild(this.buyBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Avbryt";
    this.styleSecondaryBtn(cancelBtn);
    cancelBtn.addEventListener("click", () => this.hide());
    btnRow.appendChild(cancelBtn);

    this.card.appendChild(btnRow);

    // Store price label reference
    (typePrice as HTMLSpanElement).dataset.role = "price";
  }

  /** Show the popup with entry fee. Matches Unity's Game1TicketPurchasePanel open flow. */
  show(entryFee: number, maxTickets = 30): void {
    this.ticketPrice = entryFee;
    this.ticketWeight = 1;
    this.maxQty = maxTickets;
    this.currentQty = 1;
    this.statusMsg.textContent = "";
    this.buyBtn.disabled = false;
    this.updateDisplay();
    this.backdrop.style.display = "flex";
  }

  /**
   * BIN-450: Show popup with multiple ticket types from gameVariant.
   * Each type has its own qty selector, weighted against max 30 total tickets.
   */
  showWithTypes(
    entryFee: number,
    ticketTypes: Array<{ name: string; type: string; priceMultiplier: number; ticketCount: number }>,
    maxTickets = 30,
  ): void {
    // For now, use the first ticket type's multiplier as the single-type price.
    // A full multi-type UI would need separate qty per type — but this provides
    // the correct price calculation for the active variant.
    const primaryType = ticketTypes[0];
    const effectivePrice = primaryType
      ? entryFee * primaryType.priceMultiplier
      : entryFee;

    // Update the type name label
    const priceEl = this.card.querySelector('[data-role="price"]') as HTMLSpanElement | null;
    if (priceEl) priceEl.textContent = `${effectivePrice} kr/stk`;

    // Update the type name in the header
    const nameEl = this.card.querySelector("span") as HTMLSpanElement | null;
    if (nameEl && primaryType) {
      const typeLabel = primaryType.type === "elvis" ? "Elvis-brett"
        : primaryType.type === "traffic-light" ? "Traffic Light"
        : primaryType.name;
      nameEl.textContent = typeLabel;
    }

    this.ticketPrice = effectivePrice;
    this.ticketWeight = primaryType?.ticketCount ?? 1;
    this.maxQty = Math.floor(maxTickets / this.ticketWeight);
    this.currentQty = 1;
    this.statusMsg.textContent = "";
    this.buyBtn.disabled = false;
    this.buyBtn.textContent = "Kjøp";
    this.buyBtn.style.opacity = "1";
    this.updateDisplay();
    this.backdrop.style.display = "flex";
  }

  hide(): void {
    this.backdrop.style.display = "none";
  }

  isShowing(): boolean {
    return this.backdrop.style.display !== "none";
  }

  setOnBuy(callback: () => void): void {
    this.onBuy = callback;
  }

  /** Show feedback after bet:arm response. */
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

  private adjustQty(delta: number): void {
    const newQty = this.currentQty + delta;
    if (newQty >= this.minQty && newQty <= this.maxQty) {
      this.currentQty = newQty;
      this.statusMsg.textContent = "";
      this.updateDisplay();
    }
  }

  private updateDisplay(): void {
    this.qtyLabel.textContent = String(this.currentQty);
    const total = this.currentQty * this.ticketPrice;
    const actualTickets = this.currentQty * this.ticketWeight;
    // BIN-447: Show both cost and actual ticket count when weight > 1
    if (this.ticketWeight > 1) {
      this.totalLabel.textContent = `Totalt: ${total} kr (${actualTickets} bonger)`;
    } else {
      this.totalLabel.textContent = `Totalt: ${total} kr`;
    }

    // Update price label in type row
    const priceEl = this.card.querySelector('[data-role="price"]') as HTMLSpanElement | null;
    if (priceEl) priceEl.textContent = `${this.ticketPrice} kr/stk`;
  }

  private handleBuy(): void {
    if (this.buyBtn.disabled) return;
    this.buyBtn.disabled = true;
    this.buyBtn.style.opacity = "0.6";
    this.buyBtn.textContent = "Vennligst vent...";
    this.statusMsg.textContent = "";
    this.onBuy?.();
  }

  private createRoundBtn(text: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    Object.assign(btn.style, {
      width: "44px",
      height: "44px",
      borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.3)",
      background: "rgba(255,255,255,0.08)",
      color: "#fff",
      fontSize: "22px",
      fontWeight: "700",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "background 0.15s",
      fontFamily: "inherit",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(255,255,255,0.18)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(255,255,255,0.08)";
    });
    return btn;
  }

  private createSep(): HTMLDivElement {
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;background:rgba(255,255,255,0.12);margin:4px 0;";
    return sep;
  }

  private stylePrimaryBtn(btn: HTMLButtonElement): void {
    Object.assign(btn.style, {
      padding: "14px",
      fontSize: "17px",
      fontWeight: "700",
      borderRadius: "10px",
      border: "none",
      background: "linear-gradient(180deg, #c41030 0%, #8a0020 100%)",
      color: "#fff",
      cursor: "pointer",
      textAlign: "center",
      fontFamily: "inherit",
      boxShadow: "0 2px 8px rgba(140,0,20,0.4)",
      transition: "opacity 0.15s",
    });
    btn.addEventListener("mouseenter", () => {
      if (!btn.disabled) btn.style.opacity = "0.85";
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.disabled) btn.style.opacity = "1";
    });
  }

  private styleSecondaryBtn(btn: HTMLButtonElement): void {
    Object.assign(btn.style, {
      padding: "12px",
      fontSize: "15px",
      fontWeight: "500",
      borderRadius: "10px",
      border: "1.5px solid rgba(255,255,255,0.25)",
      background: "transparent",
      color: "#ccc",
      cursor: "pointer",
      textAlign: "center",
      fontFamily: "inherit",
      transition: "background 0.15s",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(255,255,255,0.08)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
    });
  }
}
