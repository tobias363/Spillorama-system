import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";

/**
 * Game 1 ticket purchase popup — 3-column grid with +/- per type.
 *
 * Shows each ticket type from the backend with its own quantity selector.
 * Player adjusts quantities and clicks "Kjøp" to arm for the next round.
 * Transparent backdrop so the draw is visible behind.
 */
export class Game1BuyPopup {
  private backdrop: HTMLDivElement;
  private card: HTMLDivElement;
  private typesContainer: HTMLDivElement;
  private totalLabel: HTMLDivElement;
  private statusMsg: HTMLDivElement;
  private buyBtn: HTMLButtonElement;

  private onBuy: ((selections: Array<{ type: string; qty: number }>) => void) | null = null;
  private typeRows: Array<{
    type: string;
    price: number;
    ticketCount: number;
    qty: number;
    qtyLabel: HTMLSpanElement;
  }> = [];

  constructor(private overlay: HtmlOverlayManager) {
    // Full-screen backdrop (transparent — game visible behind)
    this.backdrop = document.createElement("div");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.35)",
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
      padding: "24px 20px",
      boxSizing: "border-box",
      minWidth: "340px",
      maxWidth: "540px",
      width: "94%",
      maxHeight: "85vh",
      overflowY: "auto",
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

    // 3-column grid for ticket types
    this.typesContainer = document.createElement("div");
    this.typesContainer.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;";
    this.card.appendChild(this.typesContainer);

    // Separator
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

    // Status message
    this.statusMsg = document.createElement("div");
    Object.assign(this.statusMsg.style, {
      fontSize: "14px",
      color: "#ff6b6b",
      textAlign: "center",
      margin: "0 0 10px",
      minHeight: "20px",
    });
    this.card.appendChild(this.statusMsg);

    // Buttons: Kjøp + Avbryt
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
  }

  /**
   * Show popup with ticket types from backend.
   * Each type gets a card with +/- qty selector in a 3-column grid.
   * If ticketTypes is empty, does nothing (waits for backend data).
   */
  showWithTypes(
    entryFee: number,
    ticketTypes: Array<{ name: string; type: string; priceMultiplier: number; ticketCount: number }>,
  ): void {
    if (ticketTypes.length === 0) return;

    this.typesContainer.innerHTML = "";
    this.typeRows = [];

    for (const tt of ticketTypes) {
      const price = Math.round(entryFee * tt.priceMultiplier);
      this.buildTypeCard(this.getDisplayName(tt), tt.type, price, tt.ticketCount);
    }

    this.updateTotal();
    this.statusMsg.textContent = "";
    this.buyBtn.disabled = false;
    this.buyBtn.textContent = "Kjøp";
    this.buyBtn.style.opacity = "1";
    this.buyBtn.style.cursor = "pointer";
    this.backdrop.style.display = "flex";
  }

  hide(): void {
    this.backdrop.style.display = "none";
  }

  isShowing(): boolean {
    return this.backdrop.style.display !== "none";
  }

  setOnBuy(callback: (selections: Array<{ type: string; qty: number }>) => void): void {
    this.onBuy = callback;
  }

  /** Returns the total number of tickets selected across all types. */
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

  private buildTypeCard(name: string, type: string, price: number, ticketCount: number): void {
    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "rgba(0,0,0,0.3)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "10px",
      padding: "10px 8px",
    });

    const nameEl = document.createElement("div");
    nameEl.textContent = ticketCount > 1 ? `${name} (${ticketCount} brett)` : name;
    Object.assign(nameEl.style, {
      fontSize: "13px", fontWeight: "600", color: "#fff",
      textAlign: "center", lineHeight: "1.3", marginBottom: "2px",
    });
    card.appendChild(nameEl);

    const priceEl = document.createElement("div");
    priceEl.textContent = `${price} kr`;
    Object.assign(priceEl.style, {
      fontSize: "12px", color: "#ccc", textAlign: "center", marginBottom: "8px",
    });
    card.appendChild(priceEl);

    const qtyRow = document.createElement("div");
    qtyRow.style.cssText = "display:flex;align-items:center;justify-content:center;gap:10px;";

    const qtyLabel = document.createElement("span");
    qtyLabel.textContent = "0";
    Object.assign(qtyLabel.style, {
      fontSize: "22px", fontWeight: "700", color: "#fff",
      minWidth: "32px", textAlign: "center",
    });

    const entry = { type, price, ticketCount, qty: 0, qtyLabel };
    this.typeRows.push(entry);

    const minusBtn = this.createRoundBtn("\u2212");
    minusBtn.addEventListener("click", () => {
      if (entry.qty > 0) { entry.qty--; qtyLabel.textContent = String(entry.qty); this.updateTotal(); }
    });

    const plusBtn = this.createRoundBtn("+");
    plusBtn.addEventListener("click", () => {
      entry.qty++; qtyLabel.textContent = String(entry.qty); this.updateTotal();
    });

    qtyRow.appendChild(minusBtn);
    qtyRow.appendChild(qtyLabel);
    qtyRow.appendChild(plusBtn);
    card.appendChild(qtyRow);

    this.typesContainer.appendChild(card);
  }

  private updateTotal(): void {
    const total = this.typeRows.reduce((sum, r) => sum + r.qty * r.price, 0);
    const totalTickets = this.typeRows.reduce((sum, r) => sum + r.qty, 0);
    this.totalLabel.textContent = `Totalt: ${total} kr`;

    if (totalTickets === 0) {
      this.buyBtn.disabled = true;
      this.buyBtn.style.opacity = "0.5";
      this.buyBtn.style.cursor = "default";
    } else {
      this.buyBtn.disabled = false;
      this.buyBtn.style.opacity = "1";
      this.buyBtn.style.cursor = "pointer";
    }
  }

  private handleBuy(): void {
    if (this.buyBtn.disabled) return;
    this.buyBtn.disabled = true;
    this.buyBtn.style.opacity = "0.6";
    this.buyBtn.textContent = "Vennligst vent...";
    this.statusMsg.textContent = "";
    const selections = this.typeRows
      .filter((r) => r.qty > 0)
      .map((r) => ({ type: r.type, qty: r.qty }));
    this.onBuy?.(selections);
  }

  private createRoundBtn(text: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    Object.assign(btn.style, {
      width: "36px", height: "36px", borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.3)",
      background: "rgba(255,255,255,0.08)",
      color: "#fff", fontSize: "22px", fontWeight: "700",
      cursor: "pointer", display: "flex", alignItems: "center",
      justifyContent: "center", transition: "background 0.15s",
      fontFamily: "inherit",
    });
    btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,0.18)"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "rgba(255,255,255,0.08)"; });
    return btn;
  }

  private createSep(): HTMLDivElement {
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;background:rgba(255,255,255,0.12);margin:4px 0;";
    return sep;
  }

  private stylePrimaryBtn(btn: HTMLButtonElement): void {
    Object.assign(btn.style, {
      padding: "14px", fontSize: "17px", fontWeight: "700",
      borderRadius: "10px", border: "none",
      background: "linear-gradient(180deg, #c41030 0%, #8a0020 100%)",
      color: "#fff", cursor: "pointer", textAlign: "center",
      fontFamily: "inherit", boxShadow: "0 2px 8px rgba(140,0,20,0.4)",
      transition: "opacity 0.15s",
    });
    btn.addEventListener("mouseenter", () => { if (!btn.disabled) btn.style.opacity = "0.85"; });
    btn.addEventListener("mouseleave", () => { if (!btn.disabled) btn.style.opacity = "1"; });
  }

  private styleSecondaryBtn(btn: HTMLButtonElement): void {
    Object.assign(btn.style, {
      padding: "12px", fontSize: "15px", fontWeight: "500",
      borderRadius: "10px", border: "1.5px solid rgba(255,255,255,0.25)",
      background: "transparent", color: "#ccc", cursor: "pointer",
      textAlign: "center", fontFamily: "inherit", transition: "background 0.15s",
    });
    btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,0.08)"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; });
  }
}
