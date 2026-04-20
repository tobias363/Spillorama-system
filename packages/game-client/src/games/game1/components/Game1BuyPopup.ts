import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";

/**
 * Maks antall vektede brett én spiller kan kjøpe per runde.
 *
 * Speiler Unity `BingoTemplates.cs:86` (`maxPurchaseTicket = 30`) og backend
 * håndhevelse i `apps/backend/src/sockets/gameEvents.ts:533-547` + DB CHECK i
 * `migrations/20260413000002_max_tickets_30_all_games.sql`.
 *
 * Én "Large"/"Elvis" med `ticketCount=3` teller som 3 vektede brett. Klienten
 * er kun UX-lag — serveren er autoritativ.
 */
const MAX_WEIGHTED_TICKETS = 30;

/**
 * Game 1 ticket purchase popup — 3-column grid with +/- per type.
 *
 * Shows each ticket type from the backend with its own quantity selector.
 * Player adjusts quantities and clicks "Kjøp" to arm for the next round.
 * Transparent backdrop so the draw is visible behind.
 *
 * Implementerer også Unity-avledet 30-brett-grense:
 *   - Plus-knapp per rad disables når rad ville overskride remaining-kapasitet
 *     (Unity: `Game1PurchaseTicket.cs:67-93`, `PrefabGame1TicketPurchaseSubType.cs:48-58`).
 *   - `alreadyPurchased` (antall brett allerede kjøpt denne runden) fratrekkes
 *     før remaining beregnes (Unity: `Game1PurchaseTicket.cs:69`).
 *   - X-knapp per rad nullstiller qty (klient-state, ingen popup).
 */
export class Game1BuyPopup {
  private backdrop: HTMLDivElement;
  private card: HTMLDivElement;
  private typesContainer: HTMLDivElement;
  private totalLabel: HTMLDivElement;
  private statusMsg: HTMLDivElement;
  private buyBtn: HTMLButtonElement;

  private onBuy: ((selections: Array<{ type: string; qty: number; name?: string }>) => void) | null = null;
  private alreadyPurchased = 0;
  private typeRows: Array<{
    type: string;
    /** BIN-688: ticket-type name (e.g. "Small Yellow") — sent to backend so
     * pre-round brett render in the colour the player actually selected. */
    name: string;
    price: number;
    ticketCount: number;
    qty: number;
    qtyLabel: HTMLSpanElement;
    plusBtn: HTMLButtonElement;
    minusBtn: HTMLButtonElement;
    clearBtn: HTMLButtonElement;
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
   *
   * @param alreadyPurchased Antall brett spilleren allerede har kjøpt denne
   *   runden (typisk `state.myTickets.length`). Speiler Unity
   *   `Game1PurchaseTicket.cs:69` hvor serveren-gitt ticket-count subtraheres
   *   fra 30-grensen før plus-knappene evalueres.
   */
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
      // BIN-688: pass `tt.name` separately from display-name so the
      // backend gets the canonical colour name ("Small Yellow") regardless
      // of any UI formatting applied in getDisplayName.
      this.buildTypeCard(this.getDisplayName(tt), tt.type, tt.name, price, tt.ticketCount);
    }

    this.updateTotal();
    this.buyBtn.textContent = "Kjøp";
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

  private buildTypeCard(displayName: string, type: string, canonicalName: string, price: number, ticketCount: number): void {
    // `displayName` is used for the label (may differ from canonicalName, e.g.
    // "Traffic Light" vs individual colours). `canonicalName` is the variant
    // config's `name` field and is what the backend needs to colour pre-round
    // tickets correctly (BIN-688).
    const name = displayName;
    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "rgba(0,0,0,0.3)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "10px",
      padding: "10px 8px",
      position: "relative",
    });

    // X-knapp (delete/clear) — synlig kun når qty > 0. Klient-state, ingen popup.
    // Mønster fra Unity `Game1ViewPurchaseElvisTicket.cs:17,49-76` (deleteBtn),
    // tilpasset til vår per-rad UX: X nullstiller qty i stedet for å delete
    // en ikke-eksisterende server-bong.
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "\u00d7";
    clearBtn.setAttribute("aria-label", `Fjern ${name}`);
    Object.assign(clearBtn.style, {
      position: "absolute",
      top: "4px",
      right: "4px",
      width: "22px",
      height: "22px",
      borderRadius: "50%",
      border: "1px solid rgba(255,255,255,0.3)",
      background: "rgba(0,0,0,0.5)",
      color: "#fff",
      fontSize: "14px",
      lineHeight: "1",
      fontWeight: "700",
      cursor: "pointer",
      padding: "0",
      display: "none",
      opacity: "1",
      transition: "opacity 0.15s",
      fontFamily: "inherit",
    });
    card.appendChild(clearBtn);

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

    const minusBtn = this.createRoundBtn("\u2212");
    const plusBtn = this.createRoundBtn("+");

    const entry = {
      type,
      name: canonicalName,
      price,
      ticketCount,
      qty: 0,
      qtyLabel,
      plusBtn,
      minusBtn,
      clearBtn,
    };
    this.typeRows.push(entry);

    minusBtn.addEventListener("click", () => {
      if (entry.qty > 0) {
        entry.qty--;
        qtyLabel.textContent = String(entry.qty);
        this.updateTotal();
      }
    });

    plusBtn.addEventListener("click", () => {
      if (plusBtn.disabled) return;
      entry.qty++;
      qtyLabel.textContent = String(entry.qty);
      this.updateTotal();
    });

    clearBtn.addEventListener("click", () => {
      if (entry.qty === 0) return;
      // 150ms fade på X-knappen i det raden resettes (UX-valg jf. PR-3-plan).
      clearBtn.style.opacity = "0";
      entry.qty = 0;
      qtyLabel.textContent = "0";
      this.updateTotal();
      // updateTotal() skjuler X via display:none når qty=0; opacity nullstilles
      // via reset i updateTotal slik at neste visning starter på full opacity.
    });

    qtyRow.appendChild(minusBtn);
    qtyRow.appendChild(qtyLabel);
    qtyRow.appendChild(plusBtn);
    card.appendChild(qtyRow);

    this.typesContainer.appendChild(card);
  }

  /**
   * Rekalkuler total, status-melding og per-rad plus/X-knapp tilgjengelighet.
   *
   * Vektet logikk: `remaining = MAX - alreadyPurchased - Σ(qty × ticketCount)`.
   * Plus-knapp for rad disables når å legge til én til ville overskride remaining
   * (dvs. når `ticketCount > remaining`). Mønster fra Unity
   * `PrefabGame1TicketPurchaseSubType.cs:48-58,76` (`AllowMorePurchase`).
   *
   * Edge case: dersom `alreadyPurchased >= MAX` skjules alle plus-knapper, buy
   * disables, og en dedikert melding vises.
   */
  private updateTotal(): void {
    const total = this.typeRows.reduce((sum, r) => sum + r.qty * r.price, 0);
    const weightedSelected = this.typeRows.reduce((sum, r) => sum + r.qty * r.ticketCount, 0);
    const remaining = MAX_WEIGHTED_TICKETS - this.alreadyPurchased - weightedSelected;

    this.totalLabel.textContent = `Totalt: ${total} kr`;

    // Edge case: spiller har allerede nådd 30 → ingen flere brett kan legges til.
    const atHardCap = this.alreadyPurchased >= MAX_WEIGHTED_TICKETS;

    for (const row of this.typeRows) {
      // Plus disables når rad-vekten ikke får plass i remaining, eller ved hard cap.
      const disable = atHardCap || row.ticketCount > remaining;
      row.plusBtn.disabled = disable;
      row.plusBtn.style.opacity = disable ? "0.35" : "1";
      row.plusBtn.style.cursor = disable ? "not-allowed" : "pointer";

      // X-knapp synlig kun når qty > 0. Reset opacity til 1 når vi skjuler den
      // slik at neste visning starter rent (pairs med fade-out i onClick).
      if (row.qty > 0) {
        row.clearBtn.style.display = "block";
        row.clearBtn.style.opacity = "1";
      } else {
        row.clearBtn.style.display = "none";
        row.clearBtn.style.opacity = "1";
      }
    }

    // Status-melding og buy-knapp state
    if (atHardCap) {
      this.statusMsg.style.color = "#ffe83d";
      this.statusMsg.textContent = "Du har maks 30 brett denne runden";
      this.buyBtn.disabled = true;
      this.buyBtn.style.opacity = "0.5";
      this.buyBtn.style.cursor = "default";
      return;
    }

    if (weightedSelected === 0) {
      this.statusMsg.textContent = "";
      this.buyBtn.disabled = true;
      this.buyBtn.style.opacity = "0.5";
      this.buyBtn.style.cursor = "default";
      return;
    }

    if (remaining === 0) {
      // Sum av alreadyPurchased + selected == MAX → grønn "maks valgt"-melding.
      this.statusMsg.style.color = "#81c784";
      this.statusMsg.textContent = "Maks 30 brett valgt";
    } else {
      this.statusMsg.textContent = "";
    }

    this.buyBtn.disabled = false;
    this.buyBtn.style.opacity = "1";
    this.buyBtn.style.cursor = "pointer";
  }

  private handleBuy(): void {
    if (this.buyBtn.disabled) return;
    this.buyBtn.disabled = true;
    this.buyBtn.style.opacity = "0.6";
    this.buyBtn.textContent = "Vennligst vent...";
    this.statusMsg.textContent = "";
    // BIN-688: include `name` so the backend can colour each pre-round
    // ticket according to the specific variant (Small Yellow vs Small
    // Purple — both have `type === "small"`, name is the distinguisher).
    const selections = this.typeRows
      .filter((r) => r.qty > 0)
      .map((r) => ({ type: r.type, qty: r.qty, name: r.name }));
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
      justifyContent: "center", transition: "background 0.15s, opacity 0.15s",
      fontFamily: "inherit",
    });
    btn.addEventListener("mouseenter", () => {
      if (!btn.disabled) btn.style.background = "rgba(255,255,255,0.18)";
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.disabled) btn.style.background = "rgba(255,255,255,0.08)";
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
